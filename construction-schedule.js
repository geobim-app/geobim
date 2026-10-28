/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// ===============================
// CONSTRUCTION SCHEDULE (4D) v1.0
// Plays the IFC construction schedule (IfcWorkSchedule / IfcTask / IfcTaskTime)
// as an animation along a timeline
// ===============================
// The geobim tiler (1.9.4) writes schedule.json next to tileset.json:
//   { version: 1, name, start, finish,
//     tasks: [{ id, name, type, start, finish, parent }],   // parent = index of the phase
//     elements: { <GlobalId>: [taskIndex, ...] } }
// Models with that file get a calendar button on their asset card. A
// Cesium3DTileStyle with its own evaluators looks every feature up by its
// globalId: hidden before its construction starts, orange while it is built,
// red while it is demolished, hidden afterwards. Elements without a task stay
// visible. Unlike sequencing.js (integer "stage" property) this works on dates.
'use strict';

(function() {

  var REMOVAL = { DEMOLITION: 1, DISMANTLE: 1, REMOVAL: 1, DISPOSAL: 1 };
  var NEUTRAL = { OPERATION: 1, MAINTENANCE: 1, LOGISTIC: 1, MOVE: 1, ATTENDANCE: 1, NOTDEFINED: 1 };
  var DAY = 86400000;
  var SPEEDS = [  // timeline days per second of playback
    { days: 1, label: '1 day/s' },
    { days: 7, label: '1 week/s' },
    { days: 30, label: '1 month/s' },
    { days: 91, label: '1 quarter/s' },
    { days: 365, label: '1 year/s' }
  ];
  var DEFAULT_SPEED = 30;
  var MILESTONE_DAYS = 2;
  var BLEND_AMOUNT = 0.75;
  var RESTYLE_MS = 80;  // at most ~12 restyles per second while playing
  var COLOR_BUILD = Cesium.Color.fromCssColorString('#FF9A1F');
  var COLOR_REMOVE = Cesium.Color.fromCssColorString('#E5484D');

  BimViewer.constructionSchedule = {
    byAsset: new Map(),  // assetId → Promise<prepared schedule | null>
    state: null          // { assetId, tileset, data, time, playing, speed, raf, lastFrame, lastStyle, prevStyle, bar }
  };

  // =====================================
  // DATA
  // =====================================

  function tilesetFile(assetId) {
    var ad = BimViewer.loadedAssets.get(assetId);
    return ad && ad.tileset && ad.modelDef && ad.modelDef.type === 'TILESET' ? ad.modelDef.file : null;
  }

  function besideTileset(file, name) {
    return file.replace(/tileset\.json(\?.*)?$/, name);
  }

  // IFC dates carry no time zone: read them as UTC so the timeline shows the
  // dates of the file wherever the viewer is.
  function parseDate(s) {
    if (!s) return NaN;
    s = String(s);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00';
    if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += 'Z';
    return Date.parse(s);
  }

  // Per element: when it is built and when it is removed (ms, NaN = never).
  function prepare(d) {
    if (!d || !Array.isArray(d.tasks) || !d.elements) return null;
    var tasks = d.tasks.map(function(t, i) {
      var start = parseDate(t.start), finish = parseDate(t.finish);
      if (!isFinite(finish)) finish = start;
      return { index: i, id: t.id || '', name: t.name || '', type: String(t.type || '').toUpperCase(),
               start: start, finish: Math.max(start, finish), parent: t.parent, hasChildren: false };
    });
    tasks.forEach(function(t) {
      if (t.parent != null && tasks[t.parent]) tasks[t.parent].hasChildren = true;
    });
    var elements = new Map();
    Object.keys(d.elements).forEach(function(gid) {
      var e = { bs: NaN, be: NaN, rs: NaN, re: NaN };
      (d.elements[gid] || []).forEach(function(i) {
        var t = tasks[i];
        if (!t || !isFinite(t.start) || NEUTRAL[t.type]) return;
        if (REMOVAL[t.type]) {
          e.rs = isFinite(e.rs) ? Math.min(e.rs, t.start) : t.start;
          e.re = isFinite(e.re) ? Math.max(e.re, t.finish) : t.finish;
        } else {
          e.bs = isFinite(e.bs) ? Math.min(e.bs, t.start) : t.start;
          e.be = isFinite(e.be) ? Math.max(e.be, t.finish) : t.finish;
        }
      });
      // A build of two days or less is a milestone ("existing bridge present"):
      // the element appears without the orange phase.
      if (e.be - e.bs <= MILESTONE_DAYS * DAY) e.be = e.bs;
      elements.set(gid, e);
    });
    var dated = tasks.filter(function(t) { return isFinite(t.start); });
    if (!dated.length) return null;
    var start = parseDate(d.start), finish = parseDate(d.finish);
    if (!isFinite(start)) start = Math.min.apply(null, dated.map(function(t) { return t.start; }));
    if (!isFinite(finish)) finish = Math.max.apply(null, dated.map(function(t) { return t.finish; }));
    return {
      name: d.name || 'Construction schedule',
      start: start, finish: Math.max(finish, start + DAY),
      tasks: dated, elements: elements,
      phases: dated.filter(function(t) { return t.parent == null; })
    };
  }

  // A missing file is the normal case (models without a schedule, tilers before
  // 1.9.4), so a 404 resolves to null quietly.
  function loadSchedule(assetId) {
    var cache = BimViewer.constructionSchedule.byAsset;
    if (cache.has(assetId)) return cache.get(assetId);
    var file = tilesetFile(assetId);
    var p = !file ? Promise.resolve(null) :
      fetch(besideTileset(file, 'schedule.json'), { cache: 'no-cache' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(prepare)
        .catch(function() { return null; });
    cache.set(assetId, p);
    return p;
  }

  // =====================================
  // STYLE
  // =====================================

  // 'hidden' | 'build' | 'remove' | 'done'; undefined = not in the schedule
  function elementState(e, t) {
    if (!e) return undefined;
    if (isFinite(e.re) && t >= e.re) return 'hidden';
    if (isFinite(e.rs) && t >= e.rs) return 'remove';
    if (isFinite(e.bs)) {
      if (t < e.bs) return 'hidden';
      if (t < e.be) return 'build';
    }
    return 'done';
  }

  function featureState(st, feature) {
    var gid;
    try { gid = feature.getProperty('globalId'); } catch (e) { gid = undefined; }
    return gid ? elementState(st.data.elements.get(String(gid)), st.time) : undefined;
  }

  function buildStyle(st) {
    var style = new Cesium.Cesium3DTileStyle();
    style.show = {
      evaluate: function(feature) { return featureState(st, feature) !== 'hidden'; }
    };
    style.color = {
      evaluateColor: function(feature, result) {
        var s = featureState(st, feature);
        var c = s === 'build' ? COLOR_BUILD : s === 'remove' ? COLOR_REMOVE : Cesium.Color.WHITE;
        return Cesium.Color.clone(c, result);
      }
    };
    return style;
  }

  function restyle(st, force) {
    var now = performance.now();
    if (!force && now - st.lastStyle < RESTYLE_MS) return;
    st.lastStyle = now;
    if (st.tileset.style !== st.style) st.tileset.style = st.style;
    else st.tileset.makeStyleDirty();
  }

  // =====================================
  // ACTIVATE / DEACTIVATE
  // =====================================

  BimViewer.toggleConstructionSchedule = function(assetId) {
    assetId = String(assetId);
    var st = this.constructionSchedule.state;
    if (st && st.assetId === assetId) { this.deactivateConstructionSchedule(); return; }
    this.activateConstructionSchedule(assetId);
  };

  BimViewer.activateConstructionSchedule = function(assetId) {
    var self = this;
    assetId = String(assetId);
    loadSchedule(assetId).then(function(data) {
      var ad = self.loadedAssets.get(assetId);
      if (!data || !ad || !ad.tileset) {
        self.updateStatus('No construction schedule for this model', 'warning');
        return;
      }
      if (self.constructionSchedule.state) self.deactivateConstructionSchedule();
      if (self.sequencing && self.sequencing.activeAssetId && typeof self.deactivateSequencing === 'function') {
        self.deactivateSequencing();
      }
      var st = {
        assetId: assetId, tileset: ad.tileset, data: data, time: data.start,
        playing: false, speed: DEFAULT_SPEED, raf: null, lastFrame: 0, lastStyle: 0,
        prevStyle: ad.tileset.style,
        prevBlend: { mode: ad.tileset.colorBlendMode, amount: ad.tileset.colorBlendAmount }
      };
      // HIGHLIGHT (the default) multiplies: orange on dark steel turns red like a
      // demolition. MIX shows the colours; white features keep their own.
      ad.tileset.colorBlendMode = Cesium.Cesium3DTileColorBlendMode.MIX;
      ad.tileset.colorBlendAmount = BLEND_AMOUNT;
      st.style = buildStyle(st);
      // IFC filter, PBR and lighting set their own style as tiles load; while
      // the timeline is open it keeps the tileset, and the latest other style
      // comes back when it closes.
      st.guard = self.viewer.scene.preRender.addEventListener(function() {
        if (st.tileset.isDestroyed() || st.tileset.style === st.style) return;
        st.prevStyle = st.tileset.style;
        st.tileset.style = st.style;
      });
      self.constructionSchedule.state = st;
      st.bar = buildBar(st);
      document.body.appendChild(st.bar);
      if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide', node: st.bar });
      requestAnimationFrame(function() { st.bar.classList.add('visible'); });
      setTime(st, data.start);
      restyle(st, true);
      var btn = document.getElementById('scheduleBtn_' + assetId);
      if (btn) btn.classList.add('active');
      self.updateStatus('Construction schedule: ' + data.tasks.length + ' tasks, ' +
        data.elements.size + ' elements', 'success');
      if (typeof plausible !== 'undefined' && !self._scheduleTracked) {
        plausible('Feature Used', { props: { feature: 'Construction schedule' } });
        self._scheduleTracked = true;
      }
    });
  };

  BimViewer.deactivateConstructionSchedule = function() {
    var st = this.constructionSchedule.state;
    if (!st) return;
    pause(st);
    this.constructionSchedule.state = null;
    if (st.guard) st.guard();
    if (!st.tileset.isDestroyed()) {
      st.tileset.colorBlendMode = st.prevBlend.mode;
      st.tileset.colorBlendAmount = st.prevBlend.amount;
    }
    if (!st.tileset.isDestroyed() && st.tileset.style === st.style) {
      st.tileset.style = st.prevStyle;
      if (typeof this.applyIFCFilter === 'function') this.applyIFCFilter();
    }
    if (st.bar) st.bar.remove();
    var btn = document.getElementById('scheduleBtn_' + st.assetId);
    if (btn) btn.classList.remove('active');
  };

  // =====================================
  // PLAYBACK
  // =====================================

  function setTime(st, t) {
    st.time = Math.min(st.data.finish, Math.max(st.data.start, t));
    updateBar(st);
    restyle(st, !st.playing);
  }

  function frame(now) {
    var st = BimViewer.constructionSchedule.state;
    if (!st || !st.playing) return;
    var dt = st.lastFrame ? Math.min(now - st.lastFrame, 250) : 0;
    st.lastFrame = now;
    var t = st.time + dt / 1000 * st.speed * DAY;
    if (t >= st.data.finish) {
      setTime(st, st.data.finish);
      pause(st);
      restyle(st, true);
      return;
    }
    setTime(st, t);
    st.raf = requestAnimationFrame(frame);
  }

  function play(st) {
    if (st.playing) return;
    if (st.time >= st.data.finish) setTime(st, st.data.start);
    st.playing = true;
    st.lastFrame = 0;
    st.raf = requestAnimationFrame(frame);
    updatePlayButton(st);
  }

  function pause(st) {
    st.playing = false;
    if (st.raf) cancelAnimationFrame(st.raf);
    st.raf = null;
    updatePlayButton(st);
  }

  // =====================================
  // UI
  // =====================================

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function icon(name) {
    var i = document.createElement('i');
    i.setAttribute('data-lucide', name);
    return i;
  }

  function dateText(t) {
    return new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  function buildBar(st) {
    var d = st.data;
    var bar = el('div', 'schedule-player');
    bar.id = 'schedulePlayer';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Construction schedule');

    var head = el('div', 'schedule-player-head');
    head.appendChild(icon('calendar-range'));
    var title = el('span', 'schedule-player-name', d.name);
    title.title = d.name;
    head.appendChild(title);
    var close = el('button', 'schedule-player-btn');
    close.title = 'Close construction schedule';
    close.setAttribute('aria-label', 'Close construction schedule');
    close.appendChild(icon('x'));
    close.onclick = function() { BimViewer.deactivateConstructionSchedule(); };
    head.appendChild(close);

    var dateRow = el('div', 'schedule-player-row');
    var date = el('span', 'schedule-player-date');
    var phase = el('span', 'schedule-player-phase');
    dateRow.appendChild(date);
    dateRow.appendChild(phase);

    var track = el('div', 'schedule-player-track');
    var slider = el('input', 'schedule-player-slider');
    slider.type = 'range';
    slider.min = String(d.start);
    slider.max = String(d.finish);
    slider.step = String(DAY);
    slider.setAttribute('aria-label', 'Date in the schedule');
    slider.oninput = function() { setTime(st, +slider.value); };
    track.appendChild(slider);
    var ticks = el('div', 'schedule-player-ticks');
    d.phases.forEach(function(p) {
      var tick = el('span', 'schedule-player-tick');
      tick.style.left = ((p.start - d.start) / (d.finish - d.start) * 100) + '%';
      tick.title = p.name + ' (' + dateText(p.start) + ' – ' + dateText(p.finish) + ')';
      tick.onclick = function() { setTime(st, p.start); };
      ticks.appendChild(tick);
    });
    track.appendChild(ticks);

    var row = el('div', 'schedule-player-row');
    var playBtn = el('button', 'schedule-player-btn schedule-player-play');
    playBtn.onclick = function() { st.playing ? pause(st) : play(st); };
    var speed = el('select', 'modern-select schedule-player-select');
    speed.setAttribute('aria-label', 'Playback speed');
    SPEEDS.forEach(function(s) {
      var o = el('option', null, s.label);
      o.value = String(s.days);
      if (s.days === DEFAULT_SPEED) o.selected = true;
      speed.appendChild(o);
    });
    speed.onchange = function() { st.speed = +speed.value; };
    var tasks = el('span', 'schedule-player-tasks');
    var legend = el('span', 'schedule-player-legend');
    legend.innerHTML = '<span class="schedule-swatch build"></span>Under construction' +
      '<span class="schedule-swatch remove"></span>Demolition';
    row.appendChild(playBtn);
    row.appendChild(speed);
    row.appendChild(tasks);
    row.appendChild(legend);

    var range = el('div', 'schedule-player-range');
    range.appendChild(el('span', null, dateText(d.start)));
    range.appendChild(el('span', null, dateText(d.finish)));

    bar.appendChild(head);
    bar.appendChild(dateRow);
    bar.appendChild(track);
    bar.appendChild(range);
    bar.appendChild(row);
    st.ui = { date: date, phase: phase, slider: slider, play: playBtn, tasks: tasks };
    updatePlayButton(st);
    return bar;
  }

  function updatePlayButton(st) {
    if (!st.ui) return;
    var b = st.ui.play;
    var label = st.playing ? 'Pause' : 'Play';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = '';
    b.appendChild(icon(st.playing ? 'pause' : 'play'));
    if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide', node: b });
  }

  function updateBar(st) {
    if (!st.ui) return;
    var t = st.time;
    st.ui.date.textContent = dateText(t);
    st.ui.slider.value = String(t);
    var running = st.data.tasks.filter(function(k) { return k.start <= t && t < k.finish; });
    var phases = running.filter(function(k) { return k.parent == null; });
    var leaves = running.filter(function(k) { return !k.hasChildren; });
    st.ui.phase.textContent = phases.map(function(k) { return k.name; }).join(' · ');
    st.ui.phase.title = st.ui.phase.textContent;
    var text = leaves.length ? leaves.slice(0, 2).map(function(k) { return k.name; }).join(', ') +
      (leaves.length > 2 ? ' +' + (leaves.length - 2) : '') : 'No task running';
    st.ui.tasks.textContent = text;
    st.ui.tasks.title = leaves.map(function(k) {
      return k.name + ' (' + dateText(k.start) + ' – ' + dateText(k.finish) + ')';
    }).join('\n');
  }

  // Space: play / pause while the bar is open (not while typing).
  document.addEventListener('keydown', function(e) {
    var st = BimViewer.constructionSchedule.state;
    if (!st || e.code !== 'Space' || e.repeat) return;
    var tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT|BUTTON/.test(tag) || (e.target && e.target.isContentEditable)) return;
    e.preventDefault();
    st.playing ? pause(st) : play(st);
  });

  // =====================================
  // ASSET CARD BUTTON
  // =====================================

  BimViewer.injectScheduleButton = function(assetId) {
    assetId = String(assetId);
    if (!tilesetFile(assetId)) return;
    loadSchedule(assetId).then(function(data) {
      if (!data) return;
      var assetDiv = document.getElementById('asset_' + assetId);
      var controlsDiv = assetDiv && assetDiv.querySelector('.modern-asset-controls');
      if (!controlsDiv || document.getElementById('scheduleBtn_' + assetId)) return;
      var btn = document.createElement('button');
      btn.id = 'scheduleBtn_' + assetId;
      btn.className = 'modern-icon-btn schedule-card-btn';
      btn.title = 'Construction schedule (4D)';
      btn.innerHTML = '<i data-lucide="calendar-range"></i>';
      btn.onclick = function(e) { e.stopPropagation(); BimViewer.toggleConstructionSchedule(assetId); };
      var st = BimViewer.constructionSchedule.state;
      if (st && st.assetId === assetId) btn.classList.add('active');
      controlsDiv.insertBefore(btn, controlsDiv.lastElementChild);
      if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide', node: btn });
    });
  };

  // =====================================
  // HOOKS
  // =====================================

  if (window.BimViewerUI && typeof BimViewerUI.createAssetControls === 'function') {
    var origCreateAssetControls = BimViewerUI.createAssetControls.bind(BimViewerUI);
    BimViewerUI.createAssetControls = function(assetId) {
      origCreateAssetControls(assetId);
      BimViewer.injectScheduleButton(assetId);
    };
  }

  // The stage sequencing and the schedule both own the tileset's style.
  if (typeof BimViewer.activateSequencing === 'function') {
    var origActivateSequencing = BimViewer.activateSequencing;
    BimViewer.activateSequencing = function() {
      BimViewer.deactivateConstructionSchedule();
      return origActivateSequencing.apply(this, arguments);
    };
  }

  var origUnloadAsset = BimViewer.unloadAsset;
  BimViewer.unloadAsset = function(assetId) {
    var id = String(assetId);
    var cs = BimViewer.constructionSchedule;
    if (cs.state && cs.state.assetId === id) BimViewer.deactivateConstructionSchedule();
    cs.byAsset.delete(id);
    return origUnloadAsset.apply(this, arguments);
  };

  console.log('📅 Construction schedule module loaded v1.0');

})();
