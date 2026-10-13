/**
 * geobim.app — Storey filter and Isolate (BimViewer.modelScope)
 *
 * Shared by the classic sidebar and the panel UI; the logic lives here only,
 * so geoBIM Desktop can mirror it.
 *
 * STOREYS
 *   Per tileset the first property of STOREY_KEYS that carries values is the
 *   storey key (geoBIM Tiler: "storey"; Revit: "levelIdName" / "ebeneName").
 *   The Cesium ion IFC tiler writes no storey, those models get a hint.
 *   Values are collected from the tiles loaded so far (tileLoad), so storeys
 *   out of view can appear later. A tileset may list its storeys up front in
 *   tileset.json extras: { "geobim": { "storeys": [{ "name", "elevation" }] } }
 *   — then the list is complete and ordered by elevation (top first);
 *   otherwise by name (numeric-aware).
 *   Switched-off storeys are kept by name, shared across models.
 *
 * ISOLATE
 *   One element (by globalId / uniqueId / elementId / expressId), one IFC
 *   class / Revit category, or one storey. The rest is ghosted (default) or
 *   hidden. Elements switched off by the class or storey filter stay hidden;
 *   hide mode (hideFeatures.js) always wins.
 *
 * Both work as an extra condition inside the IFC / Revit / PBR styles:
 * features.js and pbr-materials.js call scopeShow() and scopeGhostCondition().
 * While 4D sequencing drives a style, both are paused.
 *
 * Keys: I isolate the selected element, Shift+I or Esc exit isolate.
 */
(function() {
  'use strict';

  var STOREY_KEYS = ['storey', 'Storey', 'BuildingStorey', 'IfcBuildingStorey', 'buildingStorey',
    'levelIdName', 'Level', 'level', 'ebeneName'];
  var ID_KEYS = ['globalId', 'GlobalId', 'uniqueId', 'elementId', 'expressId'];
  var NO_STOREY = '\u0000none';
  var NO_STOREY_LABEL = '(no storey)';
  var GHOST_COLOR = "color('#A0A8B4', 0.12)";
  var MODE_KEY = 'geobim_isolate_mode';
  var collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  var tracked = new Map();     // assetId → { ad, tileset, key, idKey, storeys: Map, remove }
  var disabled = new Set();    // switched-off storey names
  var isolate = null;          // { kind: 'element'|'class'|'storey', label, ... }
  var ghost = true;
  var listeners = [];
  var notifyTimer = null;
  var banner = null;

  try { ghost = localStorage.getItem(MODE_KEY) !== 'hide'; } catch (_) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

  function literal(v) { return typeof v === 'number' ? String(v) : "'" + esc(v) + "'"; }

  function and(a, b) {
    if (a === false || b === false) return false;
    if (a === true || a === undefined) return b === undefined ? true : b;
    if (b === true || b === undefined) return a;
    return '(' + a + ') && (' + b + ')';
  }

  function paused() {
    return !!(BimViewer.sequencing && BimViewer.sequencing.activeAssetId);
  }

  function storeyName(v) {
    return v === undefined || v === null || v === '' ? NO_STOREY : String(v);
  }

  function assetIdOf(ad) {
    var found = null;
    tracked.forEach(function(t, id) { if (t.ad === ad) found = id; });
    if (found !== null) return found;
    BimViewer.loadedAssets.forEach(function(a, id) { if (a === ad) found = id; });
    return found;
  }

  function trackedByTileset(tileset) {
    var found = null;
    tracked.forEach(function(t) { if (t.tileset === tileset) found = t; });
    return found;
  }

  function isBimAsset(ad) {
    return !!(ad && (ad.ifcPropertyName || ad.categoryPropertyName === 'categoryName'));
  }

  // ---------------------------------------------------------------------------
  // Collecting storeys
  // ---------------------------------------------------------------------------
  function scanContent(t, content) {
    if (!content || !content.featuresLength) return false;
    var changed = false;
    if (!t.key || !t.idKey) {
      var ids;
      try { ids = content.getFeature(0).getPropertyIds(); } catch (_) { ids = []; }
      if (!t.idKey) t.idKey = ID_KEYS.filter(function(k) { return ids.indexOf(k) !== -1; })[0] || null;
      if (!t.key) {
        var candidates = STOREY_KEYS.filter(function(k) { return ids.indexOf(k) !== -1; });
        for (var c = 0; c < candidates.length && !t.key; c++) {
          for (var i = 0; i < content.featuresLength; i++) {
            var v = content.getFeature(i).getProperty(candidates[c]);
            if (v !== undefined && v !== null && v !== '') { t.key = candidates[c]; changed = true; break; }
          }
        }
      }
    }
    if (!t.key) return changed;
    for (var j = 0; j < content.featuresLength; j++) {
      var f = content.getFeature(j);
      var raw = f.getProperty(t.key);
      var name = storeyName(raw);
      var s = t.storeys.get(name);
      if (!s) {
        s = { name: name, raw: raw, ids: new Set(), count: 0 };
        t.storeys.set(name, s);
        changed = true;
      }
      var id = t.idKey ? f.getProperty(t.idKey) : undefined;
      if (id !== undefined && id !== null) {
        if (!s.ids.has(id)) { s.ids.add(id); changed = true; }
      } else {
        s.count++;
        changed = true;
      }
    }
    return changed;
  }

  function scanLoaded(t) {
    var changed = false;
    (function visit(tile) {
      if (!tile) return;
      if (tile.content && tile.contentReady !== false) changed = scanContent(t, tile.content) || changed;
      (tile.children || []).forEach(visit);
    })(t.tileset.root);
    return changed;
  }

  function track(id, ad) {
    var tileset = ad.tileset;
    var t = { ad: ad, tileset: tileset, key: null, idKey: null, storeys: new Map(), elevations: null };
    try {
      var listed = tileset.extras && tileset.extras.geobim && tileset.extras.geobim.storeys;
      if (Array.isArray(listed)) {
        t.elevations = new Map();
        listed.forEach(function(s) {
          if (!s || s.name === undefined) return;
          t.elevations.set(String(s.name), typeof s.elevation === 'number' ? s.elevation : null);
          if (!t.storeys.has(String(s.name))) t.storeys.set(String(s.name), { name: String(s.name), raw: s.name, ids: new Set(), count: 0 });
        });
      }
    } catch (_) {}
    t.remove = tileset.tileLoad.addEventListener(function(tile) {
      if (scanContent(t, tile.content)) notify();
    });
    tracked.set(id, t);
    scanLoaded(t);
  }

  function syncAssets() {
    if (!window.BimViewer || !BimViewer.loadedAssets) return;
    var changed = false;
    BimViewer.loadedAssets.forEach(function(ad, id) {
      if (tracked.has(id) || !ad || !ad.tileset || ad.isPointCloud || ad.isGLB || !ad.tileset.tileLoad) return;
      track(id, ad);
      changed = true;
    });
    tracked.forEach(function(t, id) {
      if (BimViewer.loadedAssets.get(id) === t.ad) return;
      if (t.remove) t.remove();
      tracked.delete(id);
      changed = true;
      if (isolate && isolate.assetId === id) exitIsolate();
    });
    // detection of the IFC / Revit kind happens after loading
    var kinds = bimKinds();
    var sig = kinds.ifc + ',' + kinds.revit;
    if (sig !== syncAssets.kinds) { syncAssets.kinds = sig; changed = true; }
    if (changed) notify();
  }

  function bimKinds() {
    var k = { ifc: false, revit: false };
    if (!BimViewer.loadedAssets) return k;
    BimViewer.loadedAssets.forEach(function(ad) {
      if (!ad) return;
      if (ad.categoryPropertyName === 'categoryName' || /\(revit\)\s*$/i.test(ad.name || '')) k.revit = true;
      else if (ad.ifcPropertyName) k.ifc = true;
    });
    return k;
  }

  // ---------------------------------------------------------------------------
  // Public state
  // ---------------------------------------------------------------------------
  function getStoreys() {
    var all = new Map();
    tracked.forEach(function(t) {
      if (!t.key && !t.elevations) return;
      t.storeys.forEach(function(s, name) {
        var e = all.get(name);
        if (!e) {
          e = { name: name, label: name === NO_STOREY ? NO_STOREY_LABEL : name, count: 0, elevation: null };
          all.set(name, e);
        }
        e.count += s.ids.size + s.count;
        if (t.elevations && t.elevations.has(name) && t.elevations.get(name) !== null) e.elevation = t.elevations.get(name);
      });
    });
    var list = Array.from(all.values());
    list.forEach(function(e) { e.enabled = !disabled.has(e.name); });
    list.sort(function(a, b) {
      if (a.name === NO_STOREY) return 1;
      if (b.name === NO_STOREY) return -1;
      if (a.elevation !== null && b.elevation !== null) return b.elevation - a.elevation;
      if (a.elevation !== null) return -1;
      if (b.elevation !== null) return 1;
      return collator.compare(a.name, b.name);
    });
    return list;
  }

  function hasStoreyData() {
    var any = false;
    tracked.forEach(function(t) { if (t.key || t.elevations) any = true; });
    return any;
  }

  function hasBimModel() {
    var k = bimKinds();
    return k.ifc || k.revit;
  }

  function notify() {
    if (notifyTimer) return;
    notifyTimer = setTimeout(function() {
      notifyTimer = null;
      listeners.forEach(function(fn) { try { fn(); } catch (e) { console.warn('modelScope listener:', e); } });
    }, 250);
  }

  // ---------------------------------------------------------------------------
  // Style conditions (called by features.js / pbr-materials.js)
  // ---------------------------------------------------------------------------
  function storeyCondition(t, name) {
    if (name === NO_STOREY) return '(${' + t.key + '} === undefined || ${' + t.key + "} === '')";
    var s = t.storeys.get(name);
    return '${' + t.key + '} === ' + literal(s && s.raw !== undefined && s.raw !== null ? s.raw : name);
  }

  function storeyShow(t) {
    if (!t || !t.key || !disabled.size) return true;
    var off = [];
    disabled.forEach(function(name) { off.push(storeyCondition(t, name)); });
    return '!(' + off.join(' || ') + ')';
  }

  // Expression for "is in the isolated set" for one asset (true / false / string)
  function inSet(ad, t) {
    if (!isolate) return true;
    var id = assetIdOf(ad);
    if (isolate.kind === 'element') {
      if (id !== isolate.assetId) return false;
      return '${' + isolate.idKey + '} === ' + literal(isolate.id);
    }
    if (isolate.kind === 'class') {
      if (isolate.source === 'ifc') {
        if (!ad.ifcPropertyName) return false;
        return '${' + ad.ifcPropertyName + '} === ' + literal(isolate.value);
      }
      if (ad.categoryPropertyName !== 'categoryName') return false;
      return '(' + revitVariants(isolate.value).map(function(v) {
        return '${categoryName} === ' + literal(v);
      }).join(' || ') + ')';
    }
    if (isolate.kind === 'storey') {
      if (!t || !t.key) return false;
      return storeyCondition(t, isolate.value);
    }
    return true;
  }

  function revitVariants(category) {
    return typeof BimViewer.getRevitCategoryVariants === 'function'
      ? BimViewer.getRevitCategoryVariants(category) : [category];
  }

  function scopeShow(ad, base) {
    if (base === false || paused()) return base;
    var t = tracked.get(assetIdOf(ad));
    var show = and(base, storeyShow(t));
    if (isolate && !ghost) show = and(show, inSet(ad, t));
    return show;
  }

  function scopeGhostCondition(ad) {
    if (!isolate || !ghost || paused()) return null;
    var s = inSet(ad, tracked.get(assetIdOf(ad)));
    if (s === true) return null;
    return [s === false ? 'true' : '!(' + s + ')', GHOST_COLOR];
  }

  // Same test in JS, for picking: ghosted elements are not selectable
  function isGhosted(feature) {
    if (!isolate || !ghost || paused() || !feature || !(feature instanceof Cesium.Cesium3DTileFeature)) return false;
    var t = trackedByTileset(feature.tileset);
    if (!t) return false;
    var ad = t.ad;
    try {
      if (isolate.kind === 'element') return assetIdOf(ad) !== isolate.assetId || feature.getProperty(isolate.idKey) !== isolate.id;
      if (isolate.kind === 'class') {
        if (isolate.source === 'ifc') return !ad.ifcPropertyName || feature.getProperty(ad.ifcPropertyName) !== isolate.value;
        return ad.categoryPropertyName !== 'categoryName' || revitVariants(isolate.value).indexOf(feature.getProperty('categoryName')) === -1;
      }
      if (isolate.kind === 'storey') return !t.key || storeyName(feature.getProperty(t.key)) !== isolate.value;
    } catch (_) {}
    return false;
  }

  // ---------------------------------------------------------------------------
  // Applying
  // ---------------------------------------------------------------------------
  function apply() {
    if (paused()) {
      if (BimViewer.updateStatus) BimViewer.updateStatus('Storey filter and isolate are paused while 4D sequencing runs', 'warning');
      return;
    }
    if (typeof BimViewer.applyIFCFilter === 'function') BimViewer.applyIFCFilter();
    if (typeof BimViewer.applyRevitFilter === 'function') BimViewer.applyRevitFilter();
  }

  function setStorey(name, on) {
    if (on) disabled.delete(name); else disabled.add(name);
    apply();
    notify();
  }

  function setAllStoreys(on) {
    if (on) disabled.clear();
    else getStoreys().forEach(function(s) { disabled.add(s.name); });
    apply();
    notify();
  }

  function startIsolate(spec) {
    isolate = spec;
    apply();
    renderBanner();
    notify();
    if (BimViewer.updateStatus) BimViewer.updateStatus('Isolated: ' + spec.label, 'success');
    if (typeof plausible !== 'undefined' && !startIsolate.tracked) {
      plausible('Feature Used', { props: { feature: 'Isolate' } });
      startIsolate.tracked = true;
    }
  }

  function isolateSelected() {
    var f = BimViewer.selectedFeature;
    if (!f || !(f instanceof Cesium.Cesium3DTileFeature)) {
      if (BimViewer.updateStatus) BimViewer.updateStatus('Select an element first, then isolate it', 'warning');
      return false;
    }
    syncAssets();
    var t = trackedByTileset(f.tileset);
    var id = t && t.idKey ? f.getProperty(t.idKey) : undefined;
    if (!t || id === undefined || id === null) {
      if (BimViewer.updateStatus) BimViewer.updateStatus('This element has no ID to isolate it by', 'warning');
      return false;
    }
    var ad = t.ad;
    var name = f.getProperty('name') || f.getProperty('Name');
    var type = ad.ifcPropertyName ? f.getProperty(ad.ifcPropertyName) : f.getProperty('categoryName');
    var label = [type, name].filter(function(x) { return x !== undefined && x !== null && x !== ''; }).join(' · ') || 'Element';
    startIsolate({ kind: 'element', label: label, assetId: assetIdOf(ad), idKey: t.idKey, id: id });
    return true;
  }

  function isolateClass(source, value, label) {
    startIsolate({ kind: 'class', source: source, value: value, label: label || value });
  }

  function isolateStorey(name) {
    startIsolate({ kind: 'storey', value: name, label: name === NO_STOREY ? NO_STOREY_LABEL : name });
  }

  function exitIsolate() {
    if (!isolate) return;
    isolate = null;
    apply();
    renderBanner();
    notify();
    if (BimViewer.updateStatus) BimViewer.updateStatus('Isolate ended', 'success');
  }

  function setGhost(on) {
    ghost = !!on;
    try { localStorage.setItem(MODE_KEY, ghost ? 'ghost' : 'hide'); } catch (_) {}
    if (isolate) apply();
    renderBanner();
    notify();
  }

  // ---------------------------------------------------------------------------
  // Banner "Isolated: … · Ghost | Hide · Exit isolate"
  // ---------------------------------------------------------------------------
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function iconButton(cls, icon, text, title) {
    var b = el('button', cls);
    b.type = 'button';
    if (title) b.title = title;
    var i = el('i');
    i.setAttribute('data-lucide', icon);
    b.appendChild(i);
    if (text) b.appendChild(el('span', null, text));
    return b;
  }

  function renderBanner() {
    if (!isolate) {
      if (banner) banner.hidden = true;
      return;
    }
    if (!banner) {
      banner = el('div', 'scope-banner');
      banner.id = 'isolateBanner';
      banner.setAttribute('role', 'status');
      document.body.appendChild(banner);
      banner.addEventListener('click', function(e) {
        var b = e.target.closest('button');
        if (!b) return;
        b.blur();
        if (b.dataset.action === 'exit') exitIsolate();
        else if (b.dataset.action === 'ghost') setGhost(true);
        else if (b.dataset.action === 'hide') setGhost(false);
      });
    }
    banner.innerHTML = '';
    var icon = el('i');
    icon.setAttribute('data-lucide', 'focus');
    var text = el('span', 'scope-banner-text');
    text.appendChild(el('span', 'scope-banner-kind', 'Isolated'));
    text.appendChild(el('span', 'scope-banner-label', isolate.label));
    text.title = isolate.label;
    var seg = el('div', 'scope-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Show the rest');
    [['ghost', 'Ghost', 'Show the rest semi-transparent'], ['hide', 'Hide', 'Hide the rest']].forEach(function(m) {
      var b = el('button', 'scope-seg-btn', m[1]);
      b.type = 'button';
      b.dataset.action = m[0];
      b.title = m[2];
      var on = (m[0] === 'ghost') === ghost;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      seg.appendChild(b);
    });
    var exit = iconButton('scope-exit', 'x', 'Exit isolate', 'Exit isolate (Esc / Shift+I)');
    exit.dataset.action = 'exit';
    banner.appendChild(icon);
    banner.appendChild(text);
    banner.appendChild(seg);
    banner.appendChild(exit);
    banner.hidden = false;
    if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide', node: banner });
  }

  // ---------------------------------------------------------------------------
  // InfoBox button + keys
  // ---------------------------------------------------------------------------
  function addInfoBoxButton() {
    var controls = document.querySelector('#infoBoxHeader .floating-panel-controls');
    if (!controls || document.getElementById('infoBoxIsolateBtn')) return;
    var b = iconButton('floating-panel-btn scope-infobox-btn', 'focus', null, 'Isolate this element (I)');
    b.id = 'infoBoxIsolateBtn';
    b.setAttribute('aria-label', 'Isolate this element');
    b.addEventListener('click', function() { b.blur(); isolateSelected(); });
    controls.insertBefore(b, controls.firstChild);
    if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide', node: controls });
  }

  function escOwnedElsewhere() {
    var bv = window.BimViewer;
    if (bv.measurement && bv.measurement.active) return true;
    if (bv.hiddenFeatures && bv.hiddenFeatures.isHideMode) return true;
    if (window.BimGizmo && BimGizmo.gizmo && (BimGizmo.gizmo.active || BimGizmo.gizmo.transformMode || BimGizmo.gizmo.dragging)) return true;
    if (window.BimFirstPerson && BimFirstPerson.isActive()) return true;
    if (document.pointerLockElement) return true;
    return ['aboutDialog', 'tourOverlay', 'authGateOverlay'].some(function(d) {
      var e = document.getElementById(d);
      if (!e) return false;
      var cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      var r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }

  // Capture phase, registered before panels-ui.js: Esc ends isolate first
  window.addEventListener('keydown', function(e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || (e.target && e.target.isContentEditable)) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (window.BimFirstPerson && BimFirstPerson.isActive()) return;
    if (e.key === 'Escape') {
      if (!isolate || escOwnedElsewhere()) return;
      e.stopImmediatePropagation();
      exitIsolate();
      return;
    }
    if (e.key === 'i' || e.key === 'I') {
      e.preventDefault();
      if (e.shiftKey) exitIsolate();
      else isolateSelected();
    }
  }, true);

  // ---------------------------------------------------------------------------
  // Classic sidebar: "Storeys" block at the top of the IFC Filter section
  // ---------------------------------------------------------------------------
  function buildClassic() {
    if (window.GEOBIM_UI === 'panels') return true;
    var list = document.getElementById('ifcFiltersList');
    if (!list) return false;
    var box = el('div', 'scope-storeys');
    box.id = 'storeyFilterBlock';
    box.hidden = true;
    var head = el('div', 'scope-storeys-head');
    var title = el('span', 'scope-storeys-title', 'Storeys');
    var meta = el('span', 'scope-storeys-meta');
    var all = el('button', 'scope-link', 'All');
    var none = el('button', 'scope-link', 'None');
    all.type = none.type = 'button';
    head.appendChild(title);
    head.appendChild(meta);
    head.appendChild(all);
    head.appendChild(none);
    var hint = el('p', 'modern-hint scope-hint', 'No storey data in this model.');
    var rows = el('div', 'scope-storey-rows');
    box.appendChild(head);
    box.appendChild(hint);
    box.appendChild(rows);
    var section = list.parentElement;
    section.insertBefore(box, section.firstChild);

    all.addEventListener('click', function() { all.blur(); setAllStoreys(true); });
    none.addEventListener('click', function() { none.blur(); setAllStoreys(false); });
    rows.addEventListener('change', function(e) {
      var cb = e.target.closest('input[type="checkbox"]');
      if (cb) setStorey(cb.value, cb.checked);
    });
    rows.addEventListener('click', function(e) {
      var b = e.target.closest('[data-isolate]');
      if (!b) return;
      b.blur();
      isolateStorey(b.dataset.isolate);
    });

    function render() {
      var bim = hasBimModel() || hasStoreyData();
      box.hidden = !bim;
      if (!bim) return;
      var data = hasStoreyData();
      hint.hidden = data;
      head.hidden = !data;
      rows.innerHTML = '';
      if (!data) return;
      var list = getStoreys();
      meta.textContent = list.filter(function(s) { return s.enabled; }).length + '/' + list.length;
      list.forEach(function(s) {
        var row = el('div', 'scope-storey-row' + (isolate && isolate.kind === 'storey' && isolate.value === s.name ? ' isolated' : ''));
        var label = el('label', 'scope-storey-label');
        var cb = el('input');
        cb.type = 'checkbox';
        cb.value = s.name;
        cb.checked = s.enabled;
        label.appendChild(cb);
        label.appendChild(el('span', 'scope-storey-name', s.label));
        label.title = s.label;
        row.appendChild(label);
        if (s.count) row.appendChild(el('span', 'scope-storey-count', String(s.count)));
        var iso = iconButton('scope-iso-btn', 'focus', null, 'Isolate this storey');
        iso.dataset.isolate = s.name;
        iso.setAttribute('aria-label', 'Isolate ' + s.label);
        row.appendChild(iso);
        rows.appendChild(row);
      });
      if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide', node: rows });
    }
    listeners.push(render);
    render();
    return true;
  }

  // ---------------------------------------------------------------------------
  window.BimViewer = window.BimViewer || {};
  BimViewer.modelScope = {
    NO_STOREY: NO_STOREY,
    getStoreys: getStoreys,
    hasStoreyData: hasStoreyData,
    hasBimModel: hasBimModel,
    setStorey: setStorey,
    setAllStoreys: setAllStoreys,
    isolateSelected: isolateSelected,
    isolateClass: isolateClass,
    isolateStorey: isolateStorey,
    exitIsolate: exitIsolate,
    setGhost: setGhost,
    isGhost: function() { return ghost; },
    getIsolate: function() { return isolate ? Object.assign({}, isolate) : null; },
    isGhosted: isGhosted,
    onChange: function(fn) { listeners.push(fn); },
    refresh: function() { syncAssets(); notify(); }
  };
  BimViewer.scopeShow = scopeShow;
  BimViewer.scopeGhostCondition = scopeGhostCondition;

  var classicDone = false;
  var infoDone = false;
  (function wait() {
    if (!infoDone && document.getElementById('infoBoxHeader')) { addInfoBoxButton(); infoDone = true; }
    if (!classicDone) classicDone = buildClassic();
    if (!infoDone || !classicDone) { setTimeout(wait, 300); return; }
  })();
  setInterval(syncAssets, 1000);
})();
