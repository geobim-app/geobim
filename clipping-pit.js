/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/*
 * Excavation pit for clipping polygons.
 *
 * A clipping polygon (clipping.js) cuts a hole into the terrain; Cesium draws
 * no inside of the globe, so one looked straight through to the other side of
 * the earth. This module fills each hole with a pit: walls along the polygon
 * edge from the terrain down to a floor, the floor at
 *   (lowest terrain height on the edge) − depth   (default 20 m, adjustable).
 * The pit comes from the polygon itself — no model needed; a model standing in
 * it is simply visible from the side.
 *
 * clipping.js stays unchanged: wrappers around its functions call syncPits(),
 * which adds pits for new polygons, removes those of deleted ones and sets
 * their visibility (clipping on, not inverse, not in split view).
 */
(function() {
  'use strict';

  var STORE_KEY = 'geobim.clip.pit';
  var STEP_M = 2;            // terrain sample spacing along the edge
  var MAX_POINTS = 2000;     // per polygon
  var OUTSET_M = 0.5;        // sample just outside the hole (the hole has no terrain)
  var TOP_DROP_M = 0.05;     // wall top slightly below the terrain: no fence above ground
  var DEPTH_MIN = 2, DEPTH_MAX = 200, DEPTH_DEFAULT = 20;
  var WALL_COLOR = '#6B5640';
  var FLOOR_COLOR = '#4A3C2D';
  var EDGE_COLOR = '#2ECFB0';  // brand teal

  var settings = load();
  var pits = new Map();      // polygon id -> {walls, floor, edge, edgeHeights, cartos, minHeight, seq}
  var seq = 0;

  function load() {
    var s = { on: true, depth: DEPTH_DEFAULT };
    try {
      var raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        if (typeof raw.on === 'boolean') s.on = raw.on;
        if (isFinite(raw.depth)) s.depth = Math.min(DEPTH_MAX, Math.max(DEPTH_MIN, Number(raw.depth)));
      }
    } catch (e) {}
    return s;
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) {}
  }

  function viewer() { return window.BimViewer && BimViewer.viewer; }

  function visible() {
    var c = BimViewer.clipping;
    return settings.on && c && c.enabled && !c.inverse && !BimViewer.splitMode;
  }

  // ------------------------------------------------------------------
  // Geometry
  // ------------------------------------------------------------------

  // Edge points every ~STEP_M (closed ring, first point repeated at the end)
  function densify(points) {
    var n = points.length, perimeter = 0, i;
    for (i = 0; i < n; i++) perimeter += Cesium.Cartesian3.distance(points[i], points[(i + 1) % n]);
    var step = Math.max(STEP_M, perimeter / MAX_POINTS);
    var out = [];
    for (i = 0; i < n; i++) {
      var a = points[i], b = points[(i + 1) % n];
      var parts = Math.max(1, Math.ceil(Cesium.Cartesian3.distance(a, b) / step));
      for (var k = 0; k < parts; k++) out.push(Cesium.Cartesian3.lerp(a, b, k / parts, new Cesium.Cartesian3()));
    }
    out.push(Cesium.Cartesian3.clone(out[0]));
    return out.map(function(p) { return Cesium.Cartographic.fromCartesian(p); });
  }

  // The same points moved OUTSET_M away from the polygon's centre (lon/lat)
  function outset(cartos) {
    var lon = 0, lat = 0, n = cartos.length - 1;
    for (var i = 0; i < n; i++) { lon += cartos[i].longitude; lat += cartos[i].latitude; }
    lon /= n; lat /= n;
    var mPerRadLat = 6371000;
    return cartos.map(function(c) {
      var mPerRadLon = mPerRadLat * Math.cos(c.latitude);
      var dx = (c.longitude - lon) * mPerRadLon, dy = (c.latitude - lat) * mPerRadLat;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      return new Cesium.Cartographic(c.longitude + (dx / d) * OUTSET_M / mPerRadLon,
        c.latitude + (dy / d) * OUTSET_M / mPerRadLat, 0);
    });
  }

  // Terrain heights along the edge: the Google 3D Tiles surface when they are
  // on (globe hidden), else the terrain provider (as section-profile.js does)
  async function sampleHeights(cartos) {
    var v = viewer(), scene = v.scene;
    var google = !!(BimViewer.googleTiles && BimViewer.googleTiles.enabled) && scene.sampleHeightSupported;
    var provider = v.terrainProvider;
    if (provider instanceof Cesium.EllipsoidTerrainProvider) provider = null;
    if (!google && !provider) return cartos.map(function() { return 0; });
    var query = outset(cartos);
    var result;
    if (google) {
      var exclude = [];
      BimViewer.loadedAssets.forEach(function(a) {
        if (a.tileset) exclude.push(a.tileset);
        if (a.model) exclude.push(a.model);
      });
      pits.forEach(function(p) { [p.walls, p.floor, p.edge].forEach(function(e) { if (e) exclude.push(e); }); });
      result = await scene.sampleHeightMostDetailed(query, exclude);
    } else {
      result = await Cesium.sampleTerrainMostDetailed(provider, query);
    }
    var heights = result.map(function(c) { return c && isFinite(c.height) ? c.height : NaN; });
    // Gaps: nearest valid neighbour, else 0
    var valid = heights.filter(function(h) { return isFinite(h); });
    var fallback = valid.length ? valid.reduce(function(a, b) { return a + b; }) / valid.length : 0;
    return heights.map(function(h, i) {
      if (isFinite(h)) return h;
      for (var d = 1; d < heights.length; d++) {
        if (isFinite(heights[i - d])) return heights[i - d];
        if (isFinite(heights[i + d])) return heights[i + d];
      }
      return fallback;
    });
  }

  function floorHeight(pit) {
    return pit.minHeight - settings.depth;
  }

  // ------------------------------------------------------------------
  // Entities
  // ------------------------------------------------------------------

  function addEntities(id, polygon, cartos, heights) {
    var v = viewer();
    var tops = heights.map(function(h) { return h - TOP_DROP_M; });
    var minHeight = Math.min.apply(null, heights);
    var pit = { cartos: cartos, edgeHeights: tops, minHeight: minHeight };
    var bottom = floorHeight(pit);
    var positions = cartos.map(function(c) { return Cesium.Cartographic.toCartesian(c); });

    pit.walls = v.entities.add({
      id: 'clipping_pit_wall_' + id,
      wall: {
        positions: positions,
        maximumHeights: tops,
        minimumHeights: tops.map(function() { return bottom; }),
        material: Cesium.Color.fromCssColorString(WALL_COLOR)
      }
    });
    pit.floor = v.entities.add({
      id: 'clipping_pit_floor_' + id,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(polygon.points),
        height: bottom,
        material: Cesium.Color.fromCssColorString(FLOOR_COLOR)
      }
    });
    pit.edge = v.entities.add({
      id: 'clipping_pit_edge_' + id,
      polyline: {
        positions: cartos.map(function(c, i) { return Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, tops[i]); }),
        width: 2,
        material: Cesium.Color.fromCssColorString(EDGE_COLOR).withAlpha(0.9)
      }
    });
    return pit;
  }

  function removeEntities(pit) {
    var v = viewer();
    if (!v || !pit) return;
    ['walls', 'floor', 'edge'].forEach(function(k) { if (pit[k]) v.entities.remove(pit[k]); });
  }

  function applyDepth(pit) {
    var bottom = floorHeight(pit);
    if (pit.walls) pit.walls.wall.minimumHeights = pit.edgeHeights.map(function() { return bottom; });
    if (pit.floor) pit.floor.polygon.height = bottom;
  }

  function applyVisibility() {
    var show = visible();
    pits.forEach(function(p) {
      if (p.walls) p.walls.show = show;
      if (p.floor) p.floor.show = show;
      if (p.edge) p.edge.show = show;
    });
  }

  // ------------------------------------------------------------------
  // Sync with clipping.js
  // ------------------------------------------------------------------

  async function build(polygon) {
    var id = polygon.id;
    var mySeq = ++seq;
    pits.set(id, { pending: mySeq });
    try {
      var cartos = densify(polygon.points);
      var heights = await sampleHeights(cartos);
      var current = pits.get(id);
      if (!current || current.pending !== mySeq) return;   // removed or rebuilt meanwhile
      if (!BimViewer.clipping.polygons.some(function(p) { return p.id === id; })) { pits.delete(id); return; }
      pits.set(id, addEntities(id, polygon, cartos, heights));
      applyVisibility();
    } catch (err) {
      console.warn('Clipping pit: terrain sampling failed', err);
      if (pits.get(id) && pits.get(id).pending === mySeq) pits.delete(id);
    }
  }

  function syncPits() {
    if (!viewer() || !BimViewer.clipping) return;
    var ids = new Set(BimViewer.clipping.polygons.map(function(p) { return p.id; }));
    pits.forEach(function(pit, id) {
      if (!ids.has(id)) { removeEntities(pit); pits.delete(id); }
    });
    BimViewer.clipping.polygons.forEach(function(p) {
      if (!pits.has(p.id)) build(p);
    });
    applyVisibility();
  }

  function rebuildAll() {
    pits.forEach(function(pit) { removeEntities(pit); });
    pits.clear();
    syncPits();
  }

  function wrap(name, after) {
    var orig = BimViewer[name];
    if (typeof orig !== 'function' || orig._pitWrapped) return;
    BimViewer[name] = function() {
      var r = orig.apply(this, arguments);
      after();
      return r;
    };
    BimViewer[name]._pitWrapped = true;
  }

  function hook() {
    // Every add / remove / clear ends with updateClippingPolygonList()
    wrap('updateClippingPolygonList', syncPits);
    ['toggleClippingEnabled', 'toggleInverseClipping', 'applyClipping', 'disableAllClipping'].forEach(function(n) {
      wrap(n, applyVisibility);
    });
    // "Flip orientation" reverses the points: same outline, nothing to do.
    // Split view (ui-split-section.js) flips BimViewer.splitMode in its click handler
    document.addEventListener('click', function(e) {
      if (e.target.closest && e.target.closest('#toggleSplitView')) setTimeout(applyVisibility, 0);
    });
    // Google 3D Tiles on/off changes the surface the walls follow
    ['toggleGoogle3DTiles'].forEach(function(n) {
      var orig = BimViewer[n];
      if (typeof orig !== 'function') return;
      BimViewer[n] = async function() {
        var r = await orig.apply(this, arguments);
        if (pits.size) rebuildAll();
        return r;
      };
    });
  }

  // ------------------------------------------------------------------
  // UI: "Pit" switch and depth slider in the clip options
  // ------------------------------------------------------------------

  var depthTimer = null;

  function controlsHtml() {
    return '<div class="clip-pit-row">' +
        '<span class="clip-pit-label"><i data-lucide="shovel"></i>Excavation pit</span>' +
        '<button type="button" id="clipPitToggle" class="modern-btn modern-btn-small clip-pit-toggle" aria-pressed="false"></button>' +
      '</div>' +
      '<div class="clip-pit-row clip-pit-depth">' +
        '<label class="clip-pit-label" for="clipPitDepth">Pit depth</label>' +
        '<input type="range" id="clipPitDepth" class="modern-slider-small" min="' + DEPTH_MIN + '" max="' + DEPTH_MAX + '" step="1">' +
        '<span id="clipPitDepthValue" class="clip-pit-value"></span>' +
      '</div>' +
      '<p class="clip-pit-hint">Fills the hole with walls and a floor below the lowest terrain point of the polygon, instead of looking through the globe.</p>';
  }

  function updateControls() {
    var btn = document.getElementById('clipPitToggle');
    var slider = document.getElementById('clipPitDepth');
    var value = document.getElementById('clipPitDepthValue');
    if (btn) {
      btn.textContent = settings.on ? 'On' : 'Off';
      btn.classList.toggle('active', settings.on);
      btn.setAttribute('aria-pressed', settings.on ? 'true' : 'false');
    }
    if (slider) { slider.value = String(settings.depth); slider.disabled = !settings.on; }
    if (value) value.textContent = settings.depth + ' m';
  }

  function insertControls() {
    if (document.getElementById('clipPitControls')) return true;
    var box = document.createElement('div');
    box.id = 'clipPitControls';
    box.className = 'clip-pit';
    // Panel UI: inside the Clip panel's "Options" node; classic: after the controls
    var panelOptions = document.querySelector('[data-node="c:options"] > .pnl-sub');
    var classicAnchor = document.getElementById('toggleClippingVisualization');
    if (panelOptions) {
      box.classList.add('clip-pit-panel');
      panelOptions.appendChild(box);
    } else if (classicAnchor && !document.documentElement.classList.contains('ui-panels')) {
      var group = classicAnchor.closest('.modern-group');
      if (!group) return false;
      group.parentNode.insertBefore(box, group.nextSibling);
    } else {
      return false;
    }
    box.innerHTML = controlsHtml();
    box.querySelector('#clipPitToggle').addEventListener('click', function(e) {
      e.currentTarget.blur();
      settings.on = !settings.on;
      save();
      updateControls();
      applyVisibility();
    });
    box.querySelector('#clipPitDepth').addEventListener('input', function(e) {
      settings.depth = Math.min(DEPTH_MAX, Math.max(DEPTH_MIN, Number(e.target.value) || DEPTH_DEFAULT));
      updateControls();
      clearTimeout(depthTimer);
      depthTimer = setTimeout(function() {
        save();
        pits.forEach(function(p) { if (p.walls) applyDepth(p); });
      }, 150);
    });
    updateControls();
    if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide', node: box });
    return true;
  }

  // ------------------------------------------------------------------
  // Start: clipping.js and the UI are built after the viewer starts
  // ------------------------------------------------------------------
  var hooked = false, tries = 0;
  (function wait() {
    if (!hooked && window.BimViewer && typeof BimViewer.updateClippingPolygonList === 'function' && BimViewer.clipping) {
      hook();
      hooked = true;
    }
    var placed = insertControls();
    if ((hooked && placed) || ++tries > 120) return;
    setTimeout(wait, 500);
  })();

  window.BimClippingPit = {
    sync: syncPits,
    rebuild: rebuildAll,
    getSettings: function() { return Object.assign({}, settings); },
    setDepth: function(m) {
      settings.depth = Math.min(DEPTH_MAX, Math.max(DEPTH_MIN, Number(m) || DEPTH_DEFAULT));
      save(); updateControls();
      pits.forEach(function(p) { if (p.walls) applyDepth(p); });
    }
  };
})();
