/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// ===============================
// GIS TRACK PLAYER — replay a timed GPX track as a camera flight
// ===============================
// Started from the play button of a GPX row in gis-files.js. Reads the track
// points with their timestamps from the file, puts them on the terrain (GPS
// heights are rough and above sea level), and drives the scene clock: a marker
// runs along the track with a glowing trail, the camera follows from behind,
// looks from above, or stays free. The clock (and with it the sun) is set to
// the real time of the track and restored when playback stops.
'use strict';

window.GEOBIM_TRACK_PLAYER = (function() {

  var SPEEDS = [10, 30, 60, 120, 300];
  var DEFAULT_SPEED = 60;
  var LIFT = 1.5;             // marker height above the terrain (m)
  var HEADING_WINDOW = 8;     // seconds before/after for the direction of travel
  var CAMERA = {
    follow: { pitch: -22, range: 110 },
    top: { pitch: -89.9, range: 650 }
  };

  var state = null;

  // ---- Track data ----

  // Timed points of all <trkpt> in the file, sorted, without duplicate times
  async function readTrack(file) {
    var text = await file.text();
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    var nodes = doc.getElementsByTagNameNS('*', 'trkpt');
    var pts = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var timeEl = n.getElementsByTagNameNS('*', 'time')[0];
      var eleEl = n.getElementsByTagNameNS('*', 'ele')[0];
      var lat = parseFloat(n.getAttribute('lat')), lon = parseFloat(n.getAttribute('lon'));
      var t = timeEl ? Date.parse(timeEl.textContent.trim()) : NaN;
      if (!isFinite(lat) || !isFinite(lon) || !isFinite(t)) continue;
      pts.push({ lat: lat, lon: lon, t: t, ele: eleEl ? parseFloat(eleEl.textContent) : 0 });
    }
    pts.sort(function(a, b) { return a.t - b.t; });
    return pts.filter(function(p, i) { return i === 0 || p.t > pts[i - 1].t; });
  }

  function hasTrack(layer) {
    return !!(layer && layer.track && layer.file);
  }

  // Ground heights for all points; falls back to GPS height + geoid
  async function groundHeights(viewer, pts) {
    var cartos = pts.map(function(p) { return Cesium.Cartographic.fromDegrees(p.lon, p.lat); });
    try {
      if (!(viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider)) {
        var CHUNK = 2000;
        for (var i = 0; i < cartos.length; i += CHUNK) {
          await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartos.slice(i, i + CHUNK));
        }
        return cartos.map(function(c) { return c.height || 0; });
      }
    } catch (e) { console.warn('Track: terrain sampling failed, using GPS heights', e); }
    return pts.map(function(p) {
      var g = typeof GEOBIM_GEOID !== 'undefined' ? GEOBIM_GEOID.toOrthometric(0, p.lat, p.lon) : null;
      return p.ele + (g ? g.undulation : 0);
    });
  }

  // ---- Formatting ----

  function clockText(sec) {
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    var mm = (h ? String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
    return h ? h + ':' + mm : mm;
  }

  function paceText(sec, km) {
    if (km < 0.05) return '–';
    return clockText(sec / km) + ' /km';
  }

  // ---- UI ----

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

  function buildBar(name) {
    var bar = el('div', 'track-player');
    bar.id = 'trackPlayer';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Track playback');

    var head = el('div', 'track-player-head');
    head.appendChild(icon('footprints'));
    var title = el('span', 'track-player-name', name);
    title.title = name;
    head.appendChild(title);
    var close = el('button', 'track-player-btn track-player-close');
    close.title = 'Stop playback';
    close.setAttribute('aria-label', 'Stop playback');
    close.appendChild(icon('x'));
    head.appendChild(close);

    var slider = el('input', 'track-player-slider');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1000';
    slider.step = '1';
    slider.value = '0';
    slider.setAttribute('aria-label', 'Position in the track');

    var row = el('div', 'track-player-row');
    var play = el('button', 'track-player-btn track-player-play');
    play.title = 'Play / pause';
    play.setAttribute('aria-label', 'Play / pause');
    var stats = el('span', 'track-player-stats');
    var speed = el('select', 'modern-select track-player-select');
    speed.setAttribute('aria-label', 'Playback speed');
    SPEEDS.forEach(function(s) {
      var o = el('option', null, s + '×');
      o.value = String(s);
      if (s === DEFAULT_SPEED) o.selected = true;
      speed.appendChild(o);
    });
    var cam = el('select', 'modern-select track-player-select');
    cam.setAttribute('aria-label', 'Camera');
    [['follow', 'Follow'], ['top', 'From above'], ['free', 'Free camera']].forEach(function(c) {
      var o = el('option', null, c[1]);
      o.value = c[0];
      cam.appendChild(o);
    });
    row.appendChild(play);
    row.appendChild(stats);
    row.appendChild(speed);
    row.appendChild(cam);

    bar.appendChild(head);
    bar.appendChild(slider);
    bar.appendChild(row);
    document.body.appendChild(bar);
    return { bar: bar, close: close, slider: slider, play: play, stats: stats, speed: speed, cam: cam };
  }

  function setPlayIcon(playing) {
    if (!state) return;
    var b = state.ui.play;
    b.innerHTML = '';
    b.appendChild(icon(playing ? 'pause' : 'play'));
    b.classList.toggle('active', playing);
    if (window.lucide) lucide.createIcons();
  }

  // ---- Playback ----

  function secondsAt(time) {
    return Cesium.JulianDate.secondsDifference(time, state.start);
  }

  // Distance covered at a given second (linear between samples)
  function distanceAt(sec) {
    var s = state.secs, d = state.dist;
    if (sec <= 0) return 0;
    if (sec >= s[s.length - 1]) return d[d.length - 1];
    var lo = 0, hi = s.length - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (s[mid] <= sec) lo = mid; else hi = mid;
    }
    var f = (sec - s[lo]) / (s[hi] - s[lo]);
    return d[lo] + (d[hi] - d[lo]) * f;
  }

  function headingAt(time) {
    var a = state.position.getValue(Cesium.JulianDate.addSeconds(time, -HEADING_WINDOW, new Cesium.JulianDate()))
      || state.position.getValue(state.start);
    var b = state.position.getValue(Cesium.JulianDate.addSeconds(time, HEADING_WINDOW, new Cesium.JulianDate()))
      || state.position.getValue(state.stop);
    var p = state.position.getValue(time);
    if (!a || !b || !p) return null;
    var inv = Cesium.Matrix4.inverseTransformation(Cesium.Transforms.eastNorthUpToFixedFrame(p), new Cesium.Matrix4());
    var d = Cesium.Cartesian3.subtract(b, a, new Cesium.Cartesian3());
    var local = Cesium.Matrix4.multiplyByPointAsVector(inv, d, new Cesium.Cartesian3());
    if (Math.abs(local.x) + Math.abs(local.y) < 0.5) return null;
    return Math.atan2(local.x, local.y);
  }

  function updateCamera(time, dt) {
    var viewer = BimViewer.viewer;
    if (state.mode === 'free') return;
    var p = state.position.getValue(time);
    if (!p) return;
    var cfg = CAMERA[state.mode];
    var heading = 0;
    if (state.mode === 'follow') {
      var target = headingAt(time);
      if (target !== null) {
        if (state.heading === null) state.heading = target;
        var diff = Math.atan2(Math.sin(target - state.heading), Math.cos(target - state.heading));
        state.heading += diff * Math.min(1, dt * 2);
      }
      heading = state.heading || 0;
    }
    viewer.camera.lookAt(p, new Cesium.HeadingPitchRange(heading, Cesium.Math.toRadians(cfg.pitch), cfg.range));
  }

  function updateUi(time) {
    var sec = Math.min(Math.max(secondsAt(time), 0), state.total);
    if (!state.dragging) state.ui.slider.value = String(Math.round(sec / state.total * 1000));
    var km = distanceAt(sec) / 1000;
    state.ui.stats.textContent = clockText(sec) + ' / ' + clockText(state.total) +
      ' · ' + km.toFixed(2) + ' km · ' + paceText(sec, km);
    var playing = BimViewer.viewer.clock.shouldAnimate && sec < state.total;
    if (playing !== state.playing) {
      state.playing = playing;
      setPlayIcon(playing);
    }
  }

  function onPreRender(scene, time) {
    if (!state) return;
    var now = performance.now();
    var dt = state.lastFrame ? (now - state.lastFrame) / 1000 : 0;
    state.lastFrame = now;
    updateCamera(time, dt);
    updateUi(time);
  }

  function setMode(mode) {
    state.mode = mode;
    state.heading = null;
    if (mode === 'free') BimViewer.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  }

  async function start(layer) {
    if (!hasTrack(layer) || typeof BimViewer === 'undefined' || !BimViewer.viewer) return false;
    stop();
    var viewer = BimViewer.viewer;
    var status = BimViewer.updateStatus ? BimViewer.updateStatus.bind(BimViewer) : function() {};
    status('Preparing track...', 'loading');

    var pts = await readTrack(layer.file);
    if (pts.length < 2) {
      status('This track has no timestamps to play', 'error');
      return false;
    }
    var heights = await groundHeights(viewer, pts);

    if (typeof BimViewer.deactivateAllTools === 'function') {
      try { BimViewer.deactivateAllTools(); } catch (e) { /* not essential */ }
    }

    var times = pts.map(function(p) { return Cesium.JulianDate.fromDate(new Date(p.t)); });
    var positions = pts.map(function(p, i) { return Cesium.Cartesian3.fromDegrees(p.lon, p.lat, heights[i] + LIFT); });
    var position = new Cesium.SampledPositionProperty();
    position.addSamples(times, positions);
    position.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
    position.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD;

    var secs = [], dist = [0];
    pts.forEach(function(p, i) {
      secs.push((p.t - pts[0].t) / 1000);
      if (i) dist.push(dist[i - 1] + Cesium.Cartesian3.distance(positions[i - 1], positions[i]));
    });

    var start = times[0], stopTime = times[times.length - 1];
    var total = Cesium.JulianDate.secondsDifference(stopTime, start);
    var color = Cesium.Color.fromCssColorString(layer.color || '#2ECFB0');

    var runner = viewer.entities.add({
      name: layer.name,
      availability: new Cesium.TimeIntervalCollection([new Cesium.TimeInterval({ start: start, stop: stopTime })]),
      position: position,
      point: {
        pixelSize: 14,
        color: color,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 3,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      path: {
        leadTime: 0,
        trailTime: total + 1,
        width: 6,
        resolution: 2,
        material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.2, color: color })
      }
    });

    var clock = viewer.clock;
    var saved = {
      startTime: clock.startTime.clone(),
      stopTime: clock.stopTime.clone(),
      currentTime: clock.currentTime.clone(),
      multiplier: clock.multiplier,
      clockRange: clock.clockRange,
      clockStep: clock.clockStep,
      shouldAnimate: clock.shouldAnimate,
      requestRenderMode: viewer.scene.requestRenderMode
    };
    clock.startTime = start.clone();
    clock.stopTime = stopTime.clone();
    clock.currentTime = start.clone();
    clock.clockRange = Cesium.ClockRange.CLAMPED;
    clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK_MULTIPLIER;
    clock.multiplier = DEFAULT_SPEED;
    viewer.scene.requestRenderMode = false;
    if (viewer.timeline) viewer.timeline.zoomTo(start, stopTime);

    // The GPX data source has its own moving pin; hide it while playing
    var gpxEntity = layer.track.entity;
    var gpxPinShown = gpxEntity && gpxEntity.billboard ? gpxEntity.billboard.show : undefined;
    if (gpxEntity && gpxEntity.billboard) gpxEntity.billboard.show = false;   // show is undefined (= visible) by default

    state = {
      layer: layer,
      runner: runner,
      position: position,
      start: start,
      stop: stopTime,
      total: total,
      secs: secs,
      dist: dist,
      saved: saved,
      gpxEntity: gpxEntity,
      gpxPinShown: gpxPinShown,
      mode: 'follow',
      heading: null,
      playing: null,
      lastFrame: 0,
      dragging: false,
      ui: buildBar(layer.name)
    };

    var ui = state.ui;
    ui.close.addEventListener('click', stop);
    ui.play.addEventListener('click', function() {
      if (!state) return;
      var c = viewer.clock;
      if (!c.shouldAnimate && Cesium.JulianDate.compare(c.currentTime, state.stop) >= 0) c.currentTime = state.start.clone();
      c.shouldAnimate = !c.shouldAnimate;
    });
    ui.speed.addEventListener('change', function() { viewer.clock.multiplier = parseInt(ui.speed.value, 10); });
    ui.cam.addEventListener('change', function() { setMode(ui.cam.value); });
    ui.slider.addEventListener('input', function() {
      state.dragging = true;
      viewer.clock.currentTime = Cesium.JulianDate.addSeconds(state.start, state.total * ui.slider.value / 1000, new Cesium.JulianDate());
    });
    ui.slider.addEventListener('change', function() { if (state) state.dragging = false; });

    state.removePreRender = viewer.scene.preRender.addEventListener(onPreRender);
    if (window.lucide) lucide.createIcons();
    requestAnimationFrame(function() { if (state) state.ui.bar.classList.add('visible'); });

    clock.shouldAnimate = true;
    status('Playing ' + layer.name + ' (' + clockText(total) + ', ' + (dist[dist.length - 1] / 1000).toFixed(2) + ' km)', 'success');
    return true;
  }

  function stop() {
    if (!state) return;
    var viewer = BimViewer.viewer;
    var s = state;
    state = null;
    if (s.removePreRender) s.removePreRender();
    viewer.entities.remove(s.runner);
    if (s.gpxEntity && s.gpxEntity.billboard) s.gpxEntity.billboard.show = s.gpxPinShown !== undefined ? s.gpxPinShown : true;
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    var c = viewer.clock, v = s.saved;
    c.shouldAnimate = false;
    c.startTime = v.startTime;
    c.stopTime = v.stopTime;
    c.currentTime = v.currentTime;
    c.multiplier = v.multiplier;
    c.clockRange = v.clockRange;
    c.clockStep = v.clockStep;
    c.shouldAnimate = v.shouldAnimate;
    viewer.scene.requestRenderMode = v.requestRenderMode;
    if (viewer.timeline) viewer.timeline.zoomTo(v.startTime, v.stopTime);
    s.ui.bar.remove();
    if (typeof GEOBIM_GIS_FILES !== 'undefined') GEOBIM_GIS_FILES.render();
  }

  // Esc ends playback (keys typed into fields and buttons are ignored)
  document.addEventListener('keydown', function(e) {
    if (!state || e.key !== 'Escape') return;
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
    stop();
  });

  return {
    start: start,
    stop: stop,
    isPlaying: function(layerId) { return !!state && (!layerId || state.layer.id === layerId); },
    hasTrack: hasTrack
  };

})();
