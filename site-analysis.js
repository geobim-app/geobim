/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// ===============================
// SITE ANALYSIS v1.0
// Terrain analysis for a site: contours, slope, aspect, cut & fill (balanced
// or a given grade level, regions with volumes) and an elevation profile
// along a line — each exportable (GeoJSON, CSV, PNG, SVG).
//
// Area: drawn here (polygon / rectangle; right-click or tap adds points,
// double right-click or Enter finishes, Esc cancels, Backspace removes the
// last point) or taken from a clipping polygon (clipping.js).
// Heights: the Mapterhorn source tiles read directly (mapterhorn-terrain.js
// sampleOrtho: orthometric, native resolution, bare-earth DGM in most of
// Germany) or the active terrain / Google 3D Tiles surface (ellipsoidal,
// minus the geoid at the site centre).
// One height grid per site (cell centres, rows north → south, local
// east/north metres) feeds every analysis. Rasters are canvas images on
// ground rectangles, contours ground polylines — both drape on terrain and
// 3D Tiles. Session only, nothing is stored.
// Section markup: ui-site-section.js; styles and palettes:
// site-analysis-styles.css.
// ===============================
'use strict';

(function() {

  var MAX_SAMPLES = 250000;       // grid cells per site
  var MAX_AREA_M2 = 25e6;         // 25 km²
  var CELL_STEPS = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50];
  var CHUNK = 5000;               // points per sampleTerrain / sampleHeight call
  var FLAT_DEG = 2;               // aspect: flatter counts as "flat"
  var SLOPE_BREAKS = [2, 5, 10, 15, 25, 35, 45];
  var STEEP_DEG = 15;
  var ASPECT_NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  var CONTOUR_STEPS = [0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100];
  var MAX_LEVELS = 400;
  var MAX_CONTOUR_LINES = 4000;
  var MAX_LABELS = 80;
  var PROFILE_MAX_POINTS = 5000;
  var GRADE_WINDOW_M = 10;
  var DOUBLE_CLICK_MS = 500;
  var CUT_EPS = 0.05;             // m: |Δh| below this is on grade
  var RASTER_MAX_PX = 2048;
  var EARTH_CIRC = 40075016.686;

  // Used when the CSS custom properties (site-analysis-styles.css) are missing
  var FALLBACK = {
    slope: ['#1a9850', '#66bd63', '#a6d96a', '#fee08b', '#fdae61', '#f46d43', '#d73027', '#a50026'],
    aspect: ['#e41a1c', '#ff7f00', '#ffff33', '#4daf4a', '#00c5cd', '#377eb8', '#3a3aff', '#c51bff'],
    flat: '#9e9e9e',
    cut: '#d7301f',
    fill: '#2b8cbe',
    grade: '#f0f0f0',
    contour: '#ffffff',
    contourMajor: '#ffd54f'
  };

  var SA = BimViewer.siteAnalysis = {
    sites: [],
    settings: { source: 'mapterhorn', cell: 1 },
    drawing: null,
    profile: null,
    job: null
  };

  var seq = 0;
  var dataSource = null;
  var lastPointer = 'mouse';
  var drawBar = null;
  var profilePanel = null;

  // ===============================
  // HELPERS
  // ===============================

  function viewer() { return BimViewer.viewer; }
  function byId(id) { return document.getElementById(id); }
  function icons() { if (window.lucide) lucide.createIcons(); }
  function requestRender() { var v = viewer(); if (v) v.scene.requestRender(); }
  function isTouch() { return lastPointer === 'touch' || lastPointer === 'pen'; }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function num(n, d) {
    if (!isFinite(n)) return '–';
    return Number(n).toLocaleString(undefined, { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  }

  // CSV with ; and decimal comma (Excel in German locale)
  function csvNum(n, d) {
    if (!isFinite(n)) return '';
    var s = n.toFixed(d);
    if (Number(s) === 0) s = (0).toFixed(d);   // no "-0,0"
    return s.replace('.', ',');
  }

  function status(msg, kind) {
    var s = byId('saStatus');
    if (!s) return;
    s.textContent = msg || '';
    s.className = 'sa-status' + (kind ? ' sa-status-' + kind : '');
  }

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function rgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function palette() {
    var p = { slope: [], aspect: [] };
    for (var i = 0; i < 8; i++) {
      p.slope.push(rgb(cssVar('--sa-slope-' + i, FALLBACK.slope[i])));
      p.aspect.push(rgb(cssVar('--sa-aspect-' + i, FALLBACK.aspect[i])));
    }
    p.flat = rgb(cssVar('--sa-flat', FALLBACK.flat));
    p.cut = rgb(cssVar('--sa-cut', FALLBACK.cut));
    p.fill = rgb(cssVar('--sa-fill', FALLBACK.fill));
    p.grade = rgb(cssVar('--sa-grade', FALLBACK.grade));
    return p;
  }

  function cesiumColor(name, fallback) {
    return Cesium.Color.fromCssColorString(cssVar(name, fallback));
  }

  function download(name, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
  }

  function fileBase(site) {
    return site.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  // ---- Local metric frame (equirectangular around the site centre) ----

  function metersPerDeg(latDeg) {
    var p = latDeg * Math.PI / 180;
    return {
      lat: 111132.954 - 559.822 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p),
      lon: 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p)
    };
  }

  function frame(ringDeg) {
    var lon0 = 0, lat0 = 0;
    ringDeg.forEach(function(p) { lon0 += p[0]; lat0 += p[1]; });
    lon0 /= ringDeg.length; lat0 /= ringDeg.length;
    var m = metersPerDeg(lat0);
    return {
      lon0: lon0, lat0: lat0, m: m,
      toLocal: function(lon, lat) { return [(lon - lon0) * m.lon, (lat - lat0) * m.lat]; },
      toDeg: function(x, y) { return [lon0 + x / m.lon, lat0 + y / m.lat]; }
    };
  }

  function ringArea(pts) {
    var a = 0;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
    return Math.abs(a / 2);
  }

  function lineLength(pts, closed) {
    var l = 0;
    for (var i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (closed && pts.length > 2) l += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
    return l;
  }

  function inRing(x, y, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function cartesianToDeg(c) {
    var carto = Cesium.Cartographic.fromCartesian(c);
    return [Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude)];
  }

  function flatDeg(pts, close) {
    var out = [];
    pts.forEach(function(p) { out.push(p[0], p[1]); });
    if (close && pts.length) out.push(pts[0][0], pts[0][1]);
    return out;
  }

  function ds() {
    if (!dataSource) {
      dataSource = new Cesium.CustomDataSource('siteAnalysis');
      viewer().dataSources.add(dataSource);
    }
    return dataSource;
  }

  // ===============================
  // HEIGHTS
  // ===============================

  var undulationCache = new Map();

  // Geoid undulation N at a point: GCG2016 / EGM2008 (mapterhorn-terrain.js),
  // else EGM96 (geoid.js), else 0
  async function undulation(lon, lat) {
    var k = lon.toFixed(3) + '/' + lat.toFixed(3);
    if (undulationCache.has(k)) return undulationCache.get(k);
    var res = { n: 0, model: null };
    try {
      if (window.GEOBIM_MAPTERHORN) {
        await GEOBIM_MAPTERHORN.loadGeoid();
        var n = GEOBIM_MAPTERHORN.geoidHeight(lat, lon);
        if (n !== null) res = { n: n, model: GEOBIM_MAPTERHORN.gcg2016(lat, lon) !== null ? 'GCG2016' : 'EGM2008' };
      }
    } catch (e) { /* fall through to EGM96 */ }
    if (!res.model && window.GEOBIM_GEOID) {
      try {
        await GEOBIM_GEOID.load();
        var r = GEOBIM_GEOID.toOrthometric(0, lat, lon);
        if (r) res = { n: r.undulation, model: r.model };
      } catch (e) { /* ellipsoidal */ }
    }
    undulationCache.set(k, res);
    return res;
  }

  function pixelSize(zoom, latDeg) {
    return EARTH_CIRC * Math.cos(latDeg * Math.PI / 180) / (Math.pow(2, zoom) * 512);
  }

  function useGoogle() {
    var v = viewer();
    return !!(BimViewer.googleTiles && BimViewer.googleTiles.enabled) && v.scene.sampleHeightSupported;
  }

  // Overlays of this module must not be hit by sampleHeightMostDetailed
  function setOverlaysShown(show) {
    if (dataSource) dataSource.show = show;
    SA.sites.forEach(function(s) {
      var c = s.layers.contours;
      if (c && c.primitive) c.primitive.show = show && c.show;
    });
  }

  // Orthometric heights for points (degrees). Resolves
  // { heights: Float64Array, source, datum, zoom, pixelM }
  async function sampleHeights(lons, lats, job, label) {
    var count = lons.length;
    var midLon = lons[Math.floor(count / 2)], midLat = lats[Math.floor(count / 2)];

    if (SA.settings.source === 'mapterhorn') {
      if (!window.GEOBIM_MAPTERHORN || !GEOBIM_MAPTERHORN.sampleOrtho) throw new Error('Mapterhorn terrain is not available');
      progress(0, label + ': loading terrain tiles');
      var r = await GEOBIM_MAPTERHORN.sampleOrtho(lons, lats, {
        isCancelled: function() { return job.cancelled; },
        onProgress: function(d, t) { progress(d / t, label + ': terrain tile ' + d + ' / ' + t); }
      });
      return {
        heights: r.heights,
        source: 'Mapterhorn DGM',
        datum: 'orthometric (Mapterhorn; NHN in Germany)',
        zoom: r.minZoom,
        pixelM: pixelSize(r.minZoom, midLat)
      };
    }

    var v = viewer(), scene = v.scene;
    var google = useGoogle();
    var provider = v.terrainProvider;
    if (provider instanceof Cesium.EllipsoidTerrainProvider) provider = null;
    if (!google && !provider) throw new Error('No terrain loaded — choose "Mapterhorn DGM" or switch on a terrain in Layers');
    var N = await undulation(midLon, midLat);
    var exclude = [];
    if (google) {
      BimViewer.loadedAssets.forEach(function(a) {
        if (a.tileset) exclude.push(a.tileset);
        if (a.model) exclude.push(a.model);
      });
    }
    var out = new Float64Array(count).fill(NaN);
    setOverlaysShown(false);
    try {
      for (var s = 0; s < count; s += CHUNK) {
        if (job.cancelled) throw new Error('cancelled');
        var e = Math.min(count, s + CHUNK), cartos = [];
        for (var i = s; i < e; i++) cartos.push(Cesium.Cartographic.fromDegrees(lons[i], lats[i]));
        var res = google ? await scene.sampleHeightMostDetailed(cartos, exclude)
                         : await Cesium.sampleTerrainMostDetailed(provider, cartos);
        for (var k = 0; k < res.length; k++) {
          var c = res[k];
          out[s + k] = c && isFinite(c.height) ? c.height - N.n : NaN;
        }
        progress(e / count, label + ': ' + num(e) + ' / ' + num(count) + ' points');
      }
    } finally {
      setOverlaysShown(true);
    }
    return {
      heights: out,
      source: google ? 'Google 3D Tiles (surface incl. buildings and trees)' : 'Active terrain',
      datum: N.model ? 'orthometric (' + N.model + ')' : 'ellipsoidal (no geoid)',
      zoom: null,
      pixelM: null
    };
  }

  // ===============================
  // JOB / PROGRESS
  // ===============================

  function startJob() {
    if (SA.job) { status('Another computation is running', 'error'); return null; }
    SA.job = { cancelled: false };
    var p = byId('saProgress');
    if (p) p.classList.remove('hidden');
    progress(0, 'Starting…');
    renderSites();
    return SA.job;
  }

  function endJob() {
    SA.job = null;
    var p = byId('saProgress');
    if (p) p.classList.add('hidden');
    renderSites();
  }

  function progress(frac, text) {
    var f = byId('saProgressFill'), t = byId('saProgressText');
    if (f) f.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
    if (t) t.textContent = text || '';
  }

  // ===============================
  // SITES
  // ===============================

  function addSite(ringDeg, origin) {
    if (!viewer()) return null;
    if (ringDeg.length < 3) { status('A site needs at least 3 points', 'error'); return null; }
    var fr = frame(ringDeg);
    var local = ringDeg.map(function(p) { return fr.toLocal(p[0], p[1]); });
    var area = ringArea(local);
    if (area < 4) { status('The area is too small', 'error'); return null; }
    if (area > MAX_AREA_M2) { status('The area is larger than ' + num(MAX_AREA_M2 / 1e6) + ' km² — draw a smaller site', 'error'); return null; }

    seq++;
    var site = {
      id: seq,
      name: 'Site ' + seq,
      origin: origin,
      ring: ringDeg,
      frame: fr,
      local: local,
      area: area,
      perimeter: lineLength(local, true),
      grid: null,
      layers: {},
      contourInterval: 'auto',
      cut: { mode: 'balanced', target: null, swell: 1 },
      entities: []
    };
    var brand = cesiumColor('--brand-teal', '#2ECFB0');
    site.entities.push(ds().entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(flatDeg(ringDeg, true)),
        clampToGround: true,
        width: 3,
        material: brand,
        classificationType: Cesium.ClassificationType.BOTH
      }
    }));
    site.entities.push(ds().entities.add({
      position: Cesium.Cartesian3.fromDegrees(fr.lon0, fr.lat0),
      label: {
        text: site.name,
        font: '600 13px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM
      }
    }));
    SA.sites.push(site);
    status(site.name + ' added — ' + num(area / 10000, 2) + ' ha. Click "Analyze terrain".', 'ok');
    renderSites();
    requestRender();
    return site;
  }

  function findSite(id) {
    id = Number(id);
    for (var i = 0; i < SA.sites.length; i++) if (SA.sites[i].id === id) return SA.sites[i];
    return null;
  }

  function removeLayer(site, name) {
    var l = site.layers[name];
    if (!l) return;
    (l.entities || []).forEach(function(e) { ds().entities.remove(e); });
    if (l.primitive) viewer().scene.groundPrimitives.remove(l.primitive);
    delete site.layers[name];
  }

  function removeSite(site) {
    Object.keys(site.layers).forEach(function(n) { removeLayer(site, n); });
    site.entities.forEach(function(e) { ds().entities.remove(e); });
    SA.sites.splice(SA.sites.indexOf(site), 1);
    status(site.name + ' removed', '');
    renderSites();
    requestRender();
  }

  function flyToLocal(site, x, y, radius, hOrtho) {
    var v = viewer();
    var p = site.frame.toDeg(x, y);
    var h = isFinite(hOrtho) ? hOrtho : 0;
    var n = site.grid ? site.grid.N : 0;
    var center = Cesium.Cartesian3.fromDegrees(p[0], p[1], h + n);
    v.camera.flyToBoundingSphere(new Cesium.BoundingSphere(center, radius), {
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-50), Math.max(80, radius * 2.6)),
      duration: 1.2
    });
  }

  function zoomToSite(site) {
    // Without a grid the height is unknown: let Cesium frame the clamped outline
    if (!site.grid) { viewer().flyTo(site.entities[0], { duration: 1.2 }); return; }
    var xs = site.local.map(function(p) { return p[0]; }), ys = site.local.map(function(p) { return p[1]; });
    var cx = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2;
    var cy = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;
    var r = Math.hypot(Math.max.apply(null, xs) - cx, Math.max.apply(null, ys) - cy);
    flyToLocal(site, cx, cy, r, site.grid ? site.grid.stats.median : NaN);
  }

  // ===============================
  // HEIGHT GRID
  // ===============================

  function planGrid(site, cell) {
    var xs = site.local.map(function(p) { return p[0]; }), ys = site.local.map(function(p) { return p[1]; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var w = maxX - minX, h = maxY - minY;
    var c = cell, coarsened = false;
    while (Math.ceil(w / c + 1) * Math.ceil(h / c + 1) > MAX_SAMPLES) {
      var bigger = CELL_STEPS.filter(function(s) { return s > c; });
      if (!bigger.length) return null;
      c = bigger[0];
      coarsened = true;
    }
    var nx = Math.max(2, Math.ceil(w / c) + 1), ny = Math.max(2, Math.ceil(h / c) + 1);
    var x0 = (minX + maxX) / 2 - nx * c / 2;
    var yTop = (minY + maxY) / 2 + ny * c / 2;
    return { cell: c, requested: cell, coarsened: coarsened, nx: nx, ny: ny, x0: x0, yTop: yTop };
  }

  function cellX(g, i) { return g.x0 + (i + 0.5) * g.cell; }
  function cellY(g, j) { return g.yTop - (j + 0.5) * g.cell; }

  async function analyzeSite(site) {
    var plan = planGrid(site, SA.settings.cell);
    if (!plan) { status('The area is too large for the grid (max. ' + num(MAX_SAMPLES) + ' cells)', 'error'); return; }
    var job = startJob();
    if (!job) return;
    try {
      var nx = plan.nx, ny = plan.ny, n = nx * ny;
      var inside = new Uint8Array(n), need = new Uint8Array(n);
      for (var j = 0; j < ny; j++) {
        for (var i = 0; i < nx; i++) {
          if (inRing(cellX(plan, i), cellY(plan, j), site.local)) inside[j * nx + i] = 1;
        }
      }
      // Sample one cell beyond the polygon: slope and contours need neighbours
      for (j = 0; j < ny; j++) {
        for (i = 0; i < nx; i++) {
          if (!inside[j * nx + i]) continue;
          for (var dj = -1; dj <= 1; dj++) {
            for (var di = -1; di <= 1; di++) {
              var ii = i + di, jj = j + dj;
              if (ii >= 0 && jj >= 0 && ii < nx && jj < ny) need[jj * nx + ii] = 1;
            }
          }
        }
      }
      var idx = [], lons = [], lats = [];
      for (var k = 0; k < n; k++) {
        if (!need[k]) continue;
        var ci = k % nx, cj = (k - ci) / nx;
        var d = site.frame.toDeg(cellX(plan, ci), cellY(plan, cj));
        idx.push(k); lons.push(d[0]); lats.push(d[1]);
      }
      if (!idx.length) throw new Error('The grid has no cells inside the area');

      var res = await sampleHeights(lons, lats, job, site.name);
      var h = new Float32Array(n).fill(NaN);
      for (k = 0; k < idx.length; k++) h[idx[k]] = res.heights[k];
      if (!fillGaps(h, need, nx, ny)) throw new Error('No height data for this area');

      var N = await undulation(site.frame.lon0, site.frame.lat0);
      var west = site.frame.lon0 + plan.x0 / site.frame.m.lon;
      var north = site.frame.lat0 + plan.yTop / site.frame.m.lat;
      var g = {
        nx: nx, ny: ny, cell: plan.cell, requested: plan.requested, coarsened: plan.coarsened,
        x0: plan.x0, yTop: plan.yTop,
        west: west, east: west + nx * plan.cell / site.frame.m.lon,
        north: north, south: north - ny * plan.cell / site.frame.m.lat,
        inside: inside, need: need, h: h,
        source: res.source, datum: res.datum, zoom: res.zoom, pixelM: res.pixelM,
        sourceKey: SA.settings.source,
        N: N.n
      };
      derivatives(g);
      g.stats = gridStats(g);

      // Old layers belong to the old grid
      Object.keys(site.layers).forEach(function(name) { removeLayer(site, name); });
      site.grid = g;
      site.cut.target = null;
      status(site.name + ': ' + num(g.stats.cells) + ' cells at ' + num(g.cell, g.cell < 1 ? 1 : 0) + ' m', 'ok');
    } catch (err) {
      if (err && err.message === 'cancelled') status('Cancelled', '');
      else { console.error('Site analysis failed:', err); status(err.message || String(err), 'error'); }
    } finally {
      endJob();
      requestRender();
    }
  }

  // Cells without a height take the nearest valid one (breadth first)
  function fillGaps(h, need, nx, ny) {
    var queue = [];
    for (var k = 0; k < h.length; k++) if (need[k] && isFinite(h[k])) queue.push(k);
    if (!queue.length) return false;
    for (var head = 0; head < queue.length; head++) {
      var c = queue[head], i = c % nx, j = (c - i) / nx;
      var nb = [i > 0 ? c - 1 : -1, i < nx - 1 ? c + 1 : -1, j > 0 ? c - nx : -1, j < ny - 1 ? c + nx : -1];
      for (var q = 0; q < 4; q++) {
        var m = nb[q];
        if (m >= 0 && need[m] && !isFinite(h[m])) { h[m] = h[c]; queue.push(m); }
      }
    }
    return true;
  }

  // Slope and aspect by Horn (3×3); missing neighbours take the centre height
  function derivatives(g) {
    var nx = g.nx, ny = g.ny, h = g.h, c = g.cell, n = nx * ny;
    var slope = new Float32Array(n).fill(NaN), aspect = new Float32Array(n).fill(NaN);
    function at(i, j, e) {
      if (i < 0 || j < 0 || i >= nx || j >= ny) return e;
      var v = h[j * nx + i];
      return isFinite(v) ? v : e;
    }
    for (var j = 0; j < ny; j++) {
      for (var i = 0; i < nx; i++) {
        var k = j * nx + i;
        if (!g.inside[k]) continue;
        var e = h[k];
        var a = at(i - 1, j - 1, e), b = at(i, j - 1, e), cc = at(i + 1, j - 1, e);
        var d = at(i - 1, j, e), f = at(i + 1, j, e);
        var gg = at(i - 1, j + 1, e), hh = at(i, j + 1, e), ii = at(i + 1, j + 1, e);
        var dzdx = ((cc + 2 * f + ii) - (a + 2 * d + gg)) / (8 * c);   // east
        var dzdy = ((a + 2 * b + cc) - (gg + 2 * hh + ii)) / (8 * c);  // north (row j-1 is north)
        slope[k] = Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI;
        var az = Math.atan2(-dzdx, -dzdy) * 180 / Math.PI;          // downhill direction
        aspect[k] = az < 0 ? az + 360 : az;
      }
    }
    g.slope = slope;
    g.aspect = aspect;
  }

  function gridStats(g) {
    var hs = [], sum = 0, steep = 0, flat = 0, dirs = [0, 0, 0, 0, 0, 0, 0, 0];
    for (var k = 0; k < g.h.length; k++) {
      if (!g.inside[k]) continue;
      hs.push(g.h[k]);
      sum += g.slope[k];
      if (g.slope[k] > STEEP_DEG) steep++;
      if (g.slope[k] < FLAT_DEG) flat++;
      else dirs[Math.round(g.aspect[k] / 45) % 8]++;
    }
    hs.sort(function(a, b) { return a - b; });
    var count = hs.length;
    return {
      cells: count,
      min: hs[0],
      max: hs[count - 1],
      median: hs[Math.floor(count / 2)],
      meanSlope: sum / count,
      steepShare: steep / count,
      flatShare: flat / count,
      dirShare: dirs.map(function(d) { return d / count; })
    };
  }

  // ===============================
  // RASTERS (slope, aspect, cut & fill)
  // ===============================

  function slopeClass(s) {
    var c = 0;
    while (c < SLOPE_BREAKS.length && s >= SLOPE_BREAKS[c]) c++;
    return c;
  }

  // RGBA per cell → canvas, upscaled with nearest neighbour so class edges stay sharp
  function rasterCanvas(g, colorAt) {
    var small = document.createElement('canvas');
    small.width = g.nx; small.height = g.ny;
    var ctx = small.getContext('2d');
    var img = ctx.createImageData(g.nx, g.ny), px = img.data;
    for (var k = 0; k < g.h.length; k++) {
      if (!g.inside[k]) continue;
      var c = colorAt(k);
      if (!c) continue;
      px[k * 4] = c[0]; px[k * 4 + 1] = c[1]; px[k * 4 + 2] = c[2]; px[k * 4 + 3] = c[3];
    }
    ctx.putImageData(img, 0, 0);
    var scale = Math.max(1, Math.min(8, Math.floor(RASTER_MAX_PX / Math.max(g.nx, g.ny))));
    if (scale === 1) return small;
    var big = document.createElement('canvas');
    big.width = g.nx * scale; big.height = g.ny * scale;
    var bctx = big.getContext('2d');
    bctx.imageSmoothingEnabled = false;
    bctx.drawImage(small, 0, 0, big.width, big.height);
    return big;
  }

  function rasterColorFn(site, name) {
    var g = site.grid, p = palette();
    if (name === 'slope') {
      return function(k) { var c = p.slope[slopeClass(g.slope[k])]; return [c[0], c[1], c[2], 255]; };
    }
    if (name === 'aspect') {
      return function(k) {
        var c = g.slope[k] < FLAT_DEG ? p.flat : p.aspect[Math.round(g.aspect[k] / 45) % 8];
        return [c[0], c[1], c[2], 255];
      };
    }
    // cut & fill
    var t = site.cut.result.target, dmax = site.cut.result.dmax || 1;
    return function(k) {
      var d = g.h[k] - t;
      if (Math.abs(d) < CUT_EPS) return [p.grade[0], p.grade[1], p.grade[2], 90];
      var c = d > 0 ? p.cut : p.fill;
      return [c[0], c[1], c[2], Math.round(110 + 145 * Math.min(1, Math.abs(d) / dmax))];
    };
  }

  function showRaster(site, name) {
    var g = site.grid;
    var prev = site.layers[name];
    var opacity = prev ? prev.opacity : 0.8;
    if (prev) removeLayer(site, name);
    var canvas = rasterCanvas(g, rasterColorFn(site, name));
    var entity = ds().entities.add({
      rectangle: {
        coordinates: Cesium.Rectangle.fromDegrees(g.west, g.south, g.east, g.north),
        material: new Cesium.ImageMaterialProperty({
          image: canvas,
          transparent: true,
          color: Cesium.Color.WHITE.withAlpha(opacity)
        }),
        classificationType: Cesium.ClassificationType.BOTH
      }
    });
    site.layers[name] = { show: true, opacity: opacity, entities: [entity], canvas: canvas };
  }

  function setOpacity(site, name, value) {
    var l = site.layers[name];
    if (!l || !l.entities.length || !l.entities[0].rectangle) return;
    l.opacity = value;
    l.entities[0].rectangle.material.color = Cesium.Color.WHITE.withAlpha(value);
    requestRender();
  }

  function setLayerShown(site, name, show) {
    var l = site.layers[name];
    if (!l) return;
    l.show = show;
    l.entities.forEach(function(e) { e.show = show; });
    if (l.primitive) l.primitive.show = show;
    requestRender();
  }

  // ===============================
  // CONTOURS (marching squares on the cell centres)
  // ===============================

  function autoInterval(stats) {
    var target = (stats.max - stats.min) / 12;
    for (var i = 0; i < CONTOUR_STEPS.length; i++) if (CONTOUR_STEPS[i] >= target) return CONTOUR_STEPS[i];
    return CONTOUR_STEPS[CONTOUR_STEPS.length - 1];
  }

  function contourInterval(site) {
    return site.contourInterval === 'auto' ? autoInterval(site.grid.stats) : Number(site.contourInterval);
  }

  // Polylines in grid coordinates (fx, fy) for one level
  function traceLevel(g, level) {
    var nx = g.nx, ny = g.ny, h = g.h, need = g.need;
    var segs = [];      // [keyA, keyB]
    var pts = {};       // edge key → [fx, fy]
    function edge(k, fx, fy) { if (!pts[k]) pts[k] = [fx, fy]; return k; }
    function interp(a, b) { return (level - a) / (b - a); }

    for (var j = 0; j < ny - 1; j++) {
      for (var i = 0; i < nx - 1; i++) {
        var k = j * nx + i;
        if (!need[k] || !need[k + 1] || !need[k + nx] || !need[k + nx + 1]) continue;
        var tl = h[k], tr = h[k + 1], bl = h[k + nx], br = h[k + nx + 1];
        var lo = Math.min(tl, tr, bl, br), hi = Math.max(tl, tr, bl, br);
        // Corners equal to the level count as high: all high or all low → no line
        if (lo >= level || hi < level) continue;
        var cs = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0);
        if (cs === 0 || cs === 15) continue;
        var T = null, R = null, B = null, L = null;
        if ((tl >= level) !== (tr >= level)) T = edge('h' + k, i + interp(tl, tr), j);
        if ((tr >= level) !== (br >= level)) R = edge('v' + (k + 1), i + 1, j + interp(tr, br));
        if ((bl >= level) !== (br >= level)) B = edge('h' + (k + nx), i + interp(bl, br), j + 1);
        if ((tl >= level) !== (bl >= level)) L = edge('v' + k, i, j + interp(tl, bl));
        var crossed = [T, R, B, L].filter(function(e) { return e !== null; });
        if (crossed.length === 2) {
          segs.push(crossed);
        } else if (crossed.length === 4) {
          var centreHigh = (tl + tr + bl + br) / 4 >= level;
          // cs 5: tr+bl high; cs 10: tl+br high
          var isolateTlBr = (cs === 5) === centreHigh;
          if (isolateTlBr) { segs.push([L, T]); segs.push([B, R]); }
          else { segs.push([T, R]); segs.push([L, B]); }
        }
      }
    }

    // Stitch segments sharing an edge point
    var byKey = {};
    segs.forEach(function(s, idx) {
      (byKey[s[0]] = byKey[s[0]] || []).push(idx);
      (byKey[s[1]] = byKey[s[1]] || []).push(idx);
    });
    var used = new Uint8Array(segs.length), lines = [];
    function extend(chain, fromKey) {
      var keyNow = fromKey;
      for (;;) {
        var cand = (byKey[keyNow] || []).filter(function(x) { return !used[x]; });
        if (!cand.length) break;
        var sIdx = cand[0];
        used[sIdx] = 1;
        var s = segs[sIdx];
        keyNow = s[0] === keyNow ? s[1] : s[0];
        chain.push(keyNow);
      }
    }
    for (var s = 0; s < segs.length; s++) {
      if (used[s]) continue;
      used[s] = 1;
      var fwd = [segs[s][0], segs[s][1]];
      extend(fwd, segs[s][1]);
      var back = [];
      extend(back, segs[s][0]);
      var chain = back.reverse().concat(fwd);
      lines.push(chain.map(function(key) { return pts[key]; }));
    }
    return lines;
  }

  // Douglas–Peucker on [x, y] in metres
  function simplify(pts, tol) {
    if (pts.length < 3) return pts;
    var keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    var stack = [[0, pts.length - 1]];
    while (stack.length) {
      var r = stack.pop(), a = pts[r[0]], b = pts[r[1]];
      var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1e-9;
      var maxD = 0, idx = -1;
      for (var i = r[0] + 1; i < r[1]; i++) {
        var d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / len;
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > tol && idx > 0) { keep[idx] = 1; stack.push([r[0], idx], [idx, r[1]]); }
    }
    return pts.filter(function(p, i) { return keep[i]; });
  }

  // Contours of a site: [{ level, major, pts: [[lon, lat], …] }]
  function computeContours(site) {
    var g = site.grid, I = contourInterval(site);
    var first = Math.ceil(g.stats.min / I) * I, last = Math.floor(g.stats.max / I) * I;
    var levels = Math.round((last - first) / I) + 1;
    if (levels > MAX_LEVELS) throw new Error('Too many contour levels (' + levels + ') — choose a larger interval');
    var out = [];
    for (var n = 0; n < levels; n++) {
      var level = Math.round((first + n * I) * 1000) / 1000;
      var major = Math.abs(level / (5 * I) - Math.round(level / (5 * I))) < 1e-6;
      traceLevel(g, level).forEach(function(line) {
        // grid coordinates → local metres, then cut at the site boundary
        var run = [];
        function flush() {
          if (run.length >= 2 && lineLength(run, false) > g.cell * 0.1) {
            var simple = simplify(run, g.cell * 0.25);
            out.push({ level: level, major: major, pts: simple.map(function(p) { return site.frame.toDeg(p[0], p[1]); }) });
          }
          run = [];
        }
        line.forEach(function(p) {
          var x = g.x0 + (p[0] + 0.5) * g.cell, y = g.yTop - (p[1] + 0.5) * g.cell;
          if (inRing(x, y, site.local)) run.push([x, y]);
          else flush();
        });
        flush();
      });
      if (out.length > MAX_CONTOUR_LINES) throw new Error('More than ' + num(MAX_CONTOUR_LINES) + ' contour lines — choose a larger interval');
    }
    return { interval: I, lines: out };
  }

  function showContours(site) {
    var prev = site.layers.contours;
    if (prev) removeLayer(site, 'contours');
    var c = computeContours(site);
    var minor = cesiumColor('--sa-contour', FALLBACK.contour).withAlpha(0.75);
    var major = cesiumColor('--sa-contour-major', FALLBACK.contourMajor);
    var instances = c.lines.map(function(l) {
      return new Cesium.GeometryInstance({
        geometry: new Cesium.GroundPolylineGeometry({
          positions: Cesium.Cartesian3.fromDegreesArray(flatDeg(l.pts, false)),
          width: l.major ? 2.5 : 1.2
        }),
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(l.major ? major : minor) }
      });
    });
    var primitive = null;
    if (instances.length) {
      primitive = viewer().scene.groundPrimitives.add(new Cesium.GroundPolylinePrimitive({
        geometryInstances: instances,
        appearance: new Cesium.PolylineColorAppearance(),
        classificationType: Cesium.ClassificationType.BOTH,
        asynchronous: true
      }));
    }
    // Labels on major lines (longest first, thinned out)
    var entities = [];
    var candidates = c.lines.filter(function(l) { return l.major && l.pts.length >= 2; })
      .sort(function(a, b) { return b.pts.length - a.pts.length; });
    var placed = [], minDist = Math.sqrt(site.area) / 6;
    candidates.forEach(function(l) {
      if (entities.length >= MAX_LABELS) return;
      var p = l.pts[Math.floor(l.pts.length / 2)], loc = site.frame.toLocal(p[0], p[1]);
      if (placed.some(function(q) { return Math.hypot(q[0] - loc[0], q[1] - loc[1]) < minDist; })) return;
      placed.push(loc);
      entities.push(ds().entities.add({
        position: Cesium.Cartesian3.fromDegrees(p[0], p[1]),
        label: {
          text: num(l.level, l.level % 1 ? 2 : 0) + ' m',
          font: '600 12px sans-serif',
          fillColor: major,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, Math.max(2000, Math.sqrt(site.area) * 8))
        }
      }));
    });
    site.layers.contours = { show: true, primitive: primitive, entities: entities, data: c };
  }

  // ===============================
  // CUT & FILL
  // ===============================

  function volumesAt(g, t) {
    var cut = 0, fill = 0, a = g.cell * g.cell;
    for (var k = 0; k < g.h.length; k++) {
      if (!g.inside[k]) continue;
      var d = g.h[k] - t;
      if (d > 0) cut += d * a; else fill -= d * a;
    }
    return { cut: cut, fill: fill };
  }

  // Grade level where cut = fill (cut − fill falls monotonically with t)
  function balancedTarget(g) {
    var lo = g.stats.min, hi = g.stats.max;
    for (var it = 0; it < 60; it++) {
      var mid = (lo + hi) / 2, v = volumesAt(g, mid);
      if (v.cut > v.fill) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function cutFillRegions(site, t) {
    var g = site.grid, nx = g.nx, ny = g.ny, a = g.cell * g.cell;
    var label = new Int32Array(g.h.length), regions = [];
    function sign(k) { var d = g.h[k] - t; return d >= CUT_EPS ? 1 : (d <= -CUT_EPS ? -1 : 0); }
    for (var k0 = 0; k0 < g.h.length; k0++) {
      if (!g.inside[k0] || label[k0]) continue;
      var s0 = sign(k0);
      if (!s0) continue;
      var r = { type: s0 > 0 ? 'cut' : 'fill', cells: 0, volume: 0, sx: 0, sy: 0, sh: 0,
                minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
      var id = regions.length + 1, queue = [k0];
      label[k0] = id;
      for (var head = 0; head < queue.length; head++) {
        var k = queue[head], i = k % nx, j = (k - i) / nx;
        var x = cellX(g, i), y = cellY(g, j);
        r.cells++;
        r.volume += Math.abs(g.h[k] - t) * a;
        r.sx += x; r.sy += y; r.sh += g.h[k];
        if (x < r.minX) r.minX = x; if (x > r.maxX) r.maxX = x;
        if (y < r.minY) r.minY = y; if (y > r.maxY) r.maxY = y;
        var nb = [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, j > 0 ? k - nx : -1, j < ny - 1 ? k + nx : -1];
        for (var q = 0; q < 4; q++) {
          var m = nb[q];
          if (m >= 0 && g.inside[m] && !label[m] && sign(m) === s0) { label[m] = id; queue.push(m); }
        }
      }
      r.area = r.cells * a;
      r.cx = r.sx / r.cells; r.cy = r.sy / r.cells; r.meanH = r.sh / r.cells;
      r.radius = Math.max(g.cell, Math.hypot(r.maxX - r.minX, r.maxY - r.minY) / 2);
      regions.push(r);
    }
    regions.sort(function(p, q) { return q.volume - p.volume; });
    regions.forEach(function(r, i) { r.no = i + 1; });
    return regions;
  }

  function computeCutFill(site) {
    var g = site.grid;
    var t = site.cut.mode === 'balanced' || !isFinite(site.cut.target) ? balancedTarget(g) : site.cut.target;
    if (site.cut.mode === 'balanced') site.cut.target = Math.round(t * 100) / 100;
    var v = volumesAt(g, t), dmax = 0;
    for (var k = 0; k < g.h.length; k++) if (g.inside[k]) dmax = Math.max(dmax, Math.abs(g.h[k] - t));
    site.cut.result = {
      target: t, cut: v.cut, fill: v.fill, net: v.cut - v.fill, dmax: dmax,
      regions: cutFillRegions(site, t)
    };
  }

  function showCutFill(site) {
    computeCutFill(site);
    showRaster(site, 'cutfill');
  }

  // ===============================
  // LAYER SWITCHING
  // ===============================

  function toggleLayer(site, name) {
    if (!site.grid) return;
    var l = site.layers[name];
    if (l) { setLayerShown(site, name, !l.show); renderSites(); return; }
    try {
      if (name === 'contours') showContours(site);
      else if (name === 'cutfill') showCutFill(site);
      else showRaster(site, name);
      status('', '');
    } catch (err) {
      console.error('Site analysis layer failed:', err);
      status(err.message || String(err), 'error');
    }
    renderSites();
    requestRender();
  }

  // ===============================
  // EXPORT
  // ===============================

  function exportContours(site) {
    var c = site.layers.contours && site.layers.contours.data;
    if (!c) return;
    var gj = {
      type: 'FeatureCollection',
      name: site.name + ' contours',
      features: c.lines.map(function(l) {
        return {
          type: 'Feature',
          properties: {
            elevation: l.level, major: l.major, interval: c.interval,
            datum: site.grid.datum, source: site.grid.source, site: site.name
          },
          geometry: {
            type: 'LineString',
            coordinates: l.pts.map(function(p) {
              return [Number(p[0].toFixed(7)), Number(p[1].toFixed(7)), l.level];
            })
          }
        };
      })
    };
    download(fileBase(site) + '-contours.geojson', JSON.stringify(gj), 'application/geo+json');
  }

  function exportCutFill(site) {
    var r = site.cut.result, g = site.grid;
    if (!r) return;
    var rows = [
      ['Site', site.name],
      ['Height source', g.source],
      ['Datum', g.datum],
      ['Grid cell (m)', csvNum(g.cell, 2)],
      ['Area (m²)', csvNum(g.stats.cells * g.cell * g.cell, 1)],
      ['Grade level (m)', csvNum(r.target, 2)],
      ['Cut (m³)', csvNum(r.cut, 1)],
      ['Fill (m³)', csvNum(r.fill, 1)],
      ['Net cut − fill (m³)', csvNum(r.net, 1)],
      ['Swell factor', csvNum(site.cut.swell, 2)],
      ['Cut, loose (m³)', csvNum(r.cut * site.cut.swell, 1)],
      [],
      ['Region', 'Type', 'Area (m²)', 'Volume (m³)', 'Mean depth (m)', 'Longitude', 'Latitude']
    ];
    r.regions.forEach(function(reg) {
      var p = site.frame.toDeg(reg.cx, reg.cy);
      rows.push([reg.no, reg.type === 'cut' ? 'Cut' : 'Fill', csvNum(reg.area, 1), csvNum(reg.volume, 1),
                 csvNum(reg.volume / reg.area, 2), csvNum(p[0], 7), csvNum(p[1], 7)]);
    });
    var csv = '﻿' + rows.map(function(row) { return row.join(';'); }).join('\r\n');
    download(fileBase(site) + '-cut-fill.csv', csv, 'text/csv;charset=utf-8');
  }

  function legendItems(site, name) {
    var p = palette();
    function hex(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }
    if (name === 'slope') {
      return p.slope.map(function(c, i) {
        var lo = i ? SLOPE_BREAKS[i - 1] : 0, hi = SLOPE_BREAKS[i];
        return [hex(c), hi === undefined ? '> ' + lo + '°' : lo + '–' + hi + '°'];
      });
    }
    if (name === 'aspect') {
      return [[hex(p.flat), 'flat']].concat(p.aspect.map(function(c, i) { return [hex(c), ASPECT_NAMES[i]]; }));
    }
    var r = site.cut.result;
    return [[hex(p.cut), 'Cut ' + num(r.cut) + ' m³'], [hex(p.fill), 'Fill ' + num(r.fill) + ' m³'],
            [hex(p.grade), 'Grade ' + num(r.target, 2) + ' m']];
  }

  function exportPng(site, name) {
    var l = site.layers[name];
    if (!l || !l.canvas) return;
    var titles = { slope: 'Slope', aspect: 'Aspect', cutfill: 'Cut & fill' };
    var src = l.canvas, w = Math.max(480, Math.min(1600, src.width)), h = Math.round(src.height * w / src.width);
    var items = legendItems(site, name), pad = 16, legendH = 34 + Math.ceil(items.length / 3) * 22 + 34;
    var c = document.createElement('canvas');
    c.width = w + 2 * pad; c.height = h + legendH + 2 * pad;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, pad, pad, w, h);
    ctx.strokeStyle = '#999999';
    ctx.strokeRect(pad, pad, w, h);
    var y = pad + h + 26;
    ctx.fillStyle = '#111111';
    ctx.font = '600 15px sans-serif';
    ctx.fillText(site.name + ' — ' + titles[name], pad, y);
    ctx.font = '12px sans-serif';
    items.forEach(function(it, i) {
      var x = pad + (i % 3) * (w / 3), yy = y + 14 + Math.floor(i / 3) * 22;
      ctx.fillStyle = it[0];
      ctx.fillRect(x, yy, 14, 14);
      ctx.strokeStyle = '#666666';
      ctx.strokeRect(x, yy, 14, 14);
      ctx.fillStyle = '#111111';
      ctx.fillText(it[1], x + 20, yy + 11);
    });
    ctx.fillStyle = '#555555';
    ctx.font = '11px sans-serif';
    ctx.fillText('North up · cell ' + num(site.grid.cell, 2) + ' m · ' + site.grid.source + ' · ' + site.grid.datum + ' · geoBIM.app',
                 pad, c.height - pad + 2);
    c.toBlob(function(blob) { download(fileBase(site) + '-' + name + '.png', blob, 'image/png'); }, 'image/png');
  }

  // ===============================
  // DRAWING (polygon, rectangle, profile line)
  // ===============================

  function pickSurface(pos) {
    var scene = viewer().scene, c;
    if (scene.pickPositionSupported) c = scene.pickPosition(pos);
    if (!c) {
      var ray = viewer().camera.getPickRay(pos);
      if (ray) c = scene.globe.pick(ray, scene);
    }
    return c || null;
  }

  function rectangleRing(a, b) {
    return [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];
  }

  function previewPoints(d) {
    var pts = d.points.slice();
    if (d.mouse) pts.push(d.mouse);
    if (d.mode === 'rectangle') {
      if (pts.length < 2) return [];
      return flatDeg(rectangleRing(pts[0], pts[1]), true);
    }
    if (pts.length < 2) return [];
    return flatDeg(pts, d.mode === 'polygon' && pts.length > 2);
  }

  function canFinish(d) {
    if (d.mode === 'polygon') return d.points.length >= 3;
    if (d.mode === 'line') return d.points.length >= 2;
    return d.points.length >= 2;
  }

  function startDraw(mode) {
    var v = viewer();
    if (!v) return;
    if (SA.job) { status('Wait until the computation has finished', 'error'); return; }
    if (BimViewer.clipping && BimViewer.clipping.isDrawing) { status('Finish or cancel the clipping polygon first', 'error'); return; }
    stopDraw();
    var d = SA.drawing = { mode: mode, points: [], mouse: null, lastRight: 0, markers: [] };
    d.handler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas);
    d.preview = ds().entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(function() {
          var flat = previewPoints(d);
          return flat.length >= 4 ? Cesium.Cartesian3.fromDegreesArray(flat) : [];
        }, false),
        clampToGround: true,
        width: 3,
        material: new Cesium.PolylineDashMaterialProperty({ color: cesiumColor('--brand-teal', '#2ECFB0'), dashLength: 12 }),
        classificationType: Cesium.ClassificationType.BOTH
      }
    });
    d.handler.setInputAction(function(click) { addPoint(click.position, true); }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    d.handler.setInputAction(function(click) { if (isTouch()) addPoint(click.position, false); }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    d.handler.setInputAction(function(move) {
      var c = pickSurface(move.endPosition);
      d.mouse = c ? cartesianToDeg(c) : null;
      requestRender();
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    showDrawBar();
    renderDrawState();
  }

  function addPoint(pos, right) {
    var d = SA.drawing;
    if (!d) return;
    var now = Date.now();
    if (right && now - d.lastRight < DOUBLE_CLICK_MS && canFinish(d)) { d.lastRight = 0; finishDraw(); return; }
    d.lastRight = right ? now : 0;
    var c = pickSurface(pos);
    if (!c) { status('No surface at this point', 'error'); return; }
    var p = cartesianToDeg(c);
    d.points.push(p);
    d.markers.push(ds().entities.add({
      position: Cesium.Cartesian3.fromDegrees(p[0], p[1]),
      point: {
        pixelSize: 8,
        color: cesiumColor('--brand-teal', '#2ECFB0'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1.5,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    }));
    if (d.mode === 'rectangle' && d.points.length === 2) { finishDraw(); return; }
    updateDrawBar();
    requestRender();
  }

  function undoPoint() {
    var d = SA.drawing;
    if (!d || !d.points.length) return;
    d.points.pop();
    ds().entities.remove(d.markers.pop());
    updateDrawBar();
    requestRender();
  }

  function stopDraw() {
    var d = SA.drawing;
    if (!d) return;
    if (d.handler) d.handler.destroy();
    if (d.preview) ds().entities.remove(d.preview);
    d.markers.forEach(function(m) { ds().entities.remove(m); });
    SA.drawing = null;
    hideDrawBar();
    renderDrawState();
    requestRender();
  }

  function finishDraw() {
    var d = SA.drawing;
    if (!d || !canFinish(d)) return;
    var pts = d.points.slice(), mode = d.mode;
    stopDraw();
    if (mode === 'polygon') addSite(pts, 'drawn');
    else if (mode === 'rectangle') addSite(rectangleRing(pts[0], pts[1]), 'drawn');
    else runProfile(pts);
  }

  var DRAW_TEXT = {
    polygon: 'Site polygon — right-click or tap adds points, double right-click or Enter finishes',
    rectangle: 'Site rectangle — two corners',
    line: 'Profile line — right-click or tap adds points, double right-click or Enter finishes'
  };

  function showDrawBar() {
    if (!drawBar) {
      drawBar = document.createElement('div');
      drawBar.className = 'sa-draw-bar';
      drawBar.setAttribute('role', 'toolbar');
      drawBar.setAttribute('aria-label', 'Site analysis drawing');
      drawBar.innerHTML =
        '<span class="sa-draw-text" id="saDrawText"></span>' +
        '<button type="button" class="modern-btn modern-btn-small" data-sa="draw-undo" title="Remove last point (Backspace)"><i data-lucide="undo-2"></i><span>Undo</span></button>' +
        '<button type="button" class="modern-btn modern-btn-small modern-btn-primary" data-sa="draw-finish" title="Finish (Enter)"><i data-lucide="check"></i><span>Finish</span></button>' +
        '<button type="button" class="modern-btn modern-btn-small" data-sa="draw-cancel" title="Cancel (Esc)"><i data-lucide="x"></i><span>Cancel</span></button>';
      document.body.appendChild(drawBar);
      icons();
    }
    drawBar.classList.add('visible');
    updateDrawBar();
  }

  function updateDrawBar() {
    var d = SA.drawing, t = byId('saDrawText');
    if (!d || !t) return;
    t.textContent = DRAW_TEXT[d.mode] + ' · ' + d.points.length + ' point' + (d.points.length === 1 ? '' : 's');
    var fin = drawBar.querySelector('[data-sa="draw-finish"]');
    if (fin) fin.disabled = !canFinish(d);
  }

  function hideDrawBar() { if (drawBar) drawBar.classList.remove('visible'); }

  function renderDrawState() {
    var mode = SA.drawing && SA.drawing.mode;
    document.querySelectorAll('[data-sa^="draw-"][data-mode]').forEach(function(b) {
      var on = b.dataset.mode === mode;
      b.classList.toggle('sa-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // ===============================
  // ELEVATION PROFILE
  // ===============================

  async function runProfile(ptsDeg) {
    var fr = frame(ptsDeg);
    var local = ptsDeg.map(function(p) { return fr.toLocal(p[0], p[1]); });
    var length = lineLength(local, false);
    if (length < 1) { status('The line is too short', 'error'); return; }
    var step = Math.max(1, length / PROFILE_MAX_POINTS);
    var stations = [], xs = [], ys = [];
    var acc = 0;
    for (var s = 1; s < local.length; s++) {
      var a = local[s - 1], b = local[s], segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      var nSteps = Math.max(1, Math.ceil(segLen / step));
      for (var k = s === 1 ? 0 : 1; k <= nSteps; k++) {
        var t = k / nSteps;
        stations.push(acc + t * segLen);
        xs.push(a[0] + t * (b[0] - a[0]));
        ys.push(a[1] + t * (b[1] - a[1]));
      }
      acc += segLen;
    }
    var lons = [], lats = [];
    for (var i = 0; i < xs.length; i++) { var d = fr.toDeg(xs[i], ys[i]); lons.push(d[0]); lats.push(d[1]); }

    var job = startJob();
    if (!job) return;
    try {
      var res = await sampleHeights(lons, lats, job, 'Profile');
      var hs = Array.from(res.heights);
      var valid = hs.filter(isFinite);
      if (!valid.length) throw new Error('No height data along the line');
      for (i = 0; i < hs.length; i++) {
        if (isFinite(hs[i])) continue;
        for (var dd = 1; dd < hs.length; dd++) {
          if (isFinite(hs[i - dd])) { hs[i] = hs[i - dd]; break; }
          if (isFinite(hs[i + dd])) { hs[i] = hs[i + dd]; break; }
        }
      }
      clearProfile();
      var N = await undulation(fr.lon0, fr.lat0);
      SA.profile = {
        ptsDeg: ptsDeg, stations: stations, lons: lons, lats: lats, heights: hs, length: length,
        source: res.source, datum: res.datum, N: N.n, exaggeration: 'auto', entities: []
      };
      SA.profile.entities.push(ds().entities.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(flatDeg(ptsDeg, false)),
          clampToGround: true,
          width: 3,
          material: cesiumColor('--brand-teal', '#2ECFB0'),
          classificationType: Cesium.ClassificationType.BOTH
        }
      }));
      SA.profile.marker = ds().entities.add({
        show: false,
        position: Cesium.Cartesian3.fromDegrees(lons[0], lats[0]),
        point: {
          pixelSize: 11,
          color: Cesium.Color.WHITE,
          outlineColor: cesiumColor('--brand-teal', '#2ECFB0'),
          outlineWidth: 3,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      });
      SA.profile.entities.push(SA.profile.marker);
      SA.profile.stats = profileStats(SA.profile);
      openProfilePanel();
      status('Profile: ' + num(length, 1) + ' m', 'ok');
    } catch (err) {
      if (err && err.message === 'cancelled') status('Cancelled', '');
      else { console.error('Profile failed:', err); status(err.message || String(err), 'error'); }
    } finally {
      endJob();
      requestRender();
    }
  }

  function profileStats(p) {
    var h = p.heights, st = p.stations, up = 0, down = 0, maxGrade = 0, j = 0;
    for (var i = 1; i < h.length; i++) {
      var dh = h[i] - h[i - 1];
      if (dh > 0) up += dh; else down -= dh;
    }
    for (i = 0; i < h.length; i++) {
      while (j < h.length - 1 && st[j] - st[i] < GRADE_WINDOW_M) j++;
      if (st[j] - st[i] >= GRADE_WINDOW_M) {
        var gr = Math.abs((h[j] - h[i]) / (st[j] - st[i]));
        if (gr > maxGrade) maxGrade = gr;
      }
    }
    return {
      min: Math.min.apply(null, h), max: Math.max.apply(null, h),
      start: h[0], end: h[h.length - 1], up: up, down: down, maxGrade: maxGrade * 100
    };
  }

  function clearProfile() {
    if (!SA.profile) return;
    SA.profile.entities.forEach(function(e) { ds().entities.remove(e); });
    SA.profile = null;
    requestRender();
  }

  function openProfilePanel() {
    if (!profilePanel) {
      profilePanel = document.createElement('div');
      profilePanel.className = 'sa-profile-panel';
      profilePanel.setAttribute('role', 'dialog');
      profilePanel.setAttribute('aria-label', 'Elevation profile');
      profilePanel.innerHTML =
        '<div class="sa-profile-header" data-sa-drag>' +
          '<i data-lucide="chart-line"></i><span class="sa-profile-title">Elevation profile</span>' +
          '<label class="sa-sr-only" for="saProfileExag">Vertical exaggeration</label>' +
          '<select id="saProfileExag" class="modern-select sa-profile-exag" data-sa-input="profile-exag" title="Vertical exaggeration">' +
            '<option value="auto">Fit</option><option value="1">1×</option><option value="2">2×</option>' +
            '<option value="5">5×</option><option value="10">10×</option></select>' +
          '<button type="button" class="modern-icon-btn" data-sa="profile-csv" title="Export CSV" aria-label="Export CSV"><i data-lucide="file-spreadsheet"></i></button>' +
          '<button type="button" class="modern-icon-btn" data-sa="profile-svg" title="Export SVG" aria-label="Export SVG"><i data-lucide="image-down"></i></button>' +
          '<button type="button" class="modern-icon-btn" data-sa="profile-close" title="Close" aria-label="Close"><i data-lucide="x"></i></button>' +
        '</div>' +
        '<div class="sa-profile-stats" id="saProfileStats"></div>' +
        '<div class="sa-profile-chart" id="saProfileChart"></div>' +
        '<div class="sa-profile-readout" id="saProfileReadout">Move over the chart to see the point in 3D</div>';
      document.body.appendChild(profilePanel);
      makeDraggable(profilePanel, profilePanel.querySelector('[data-sa-drag]'));
      icons();
    }
    var exag = byId('saProfileExag');
    if (exag) exag.value = SA.profile.exaggeration;
    profilePanel.classList.add('visible');
    renderProfile();
  }

  function closeProfilePanel() {
    if (profilePanel) profilePanel.classList.remove('visible');
    clearProfile();
  }

  function makeDraggable(panel, handle) {
    handle.addEventListener('pointerdown', function(e) {
      if (e.target.closest('button, select, input')) return;
      var r = panel.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      handle.setPointerCapture(e.pointerId);
      function move(ev) {
        var x = Math.max(0, Math.min(window.innerWidth - r.width, ev.clientX - dx));
        var y = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy));
        panel.style.left = x + 'px';
        panel.style.top = y + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      }
      function up() {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      }
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svgEl(name, attrs, parent) {
    var e = document.createElementNS(SVG_NS, name);
    Object.keys(attrs).forEach(function(k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }

  function niceStep(span, target) {
    var raw = span / target, p = Math.pow(10, Math.floor(Math.log10(raw)));
    var f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  function buildProfileSvg(p, W, H) {
    var padL = 52, padR = 12, padT = 10, padB = 26;
    var pw = W - padL - padR, ph = H - padT - padB;
    var sx = pw / p.length;
    var span = Math.max(0.5, p.stats.max - p.stats.min);
    var yRange = span * 1.1, ex;
    if (p.exaggeration !== 'auto') {
      var wanted = Number(p.exaggeration);
      yRange = Math.max(yRange, ph / (sx * wanted));
    }
    var mid = (p.stats.max + p.stats.min) / 2;
    var y0 = mid - yRange / 2, sy = ph / yRange;
    ex = sy / sx;
    function X(s) { return padL + s * sx; }
    function Y(h) { return padT + ph - (h - y0) * sy; }

    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, class: 'sa-profile-svg' });
    var grid = svgEl('g', { class: 'sa-chart-grid' }, svg);
    var stepY = niceStep(yRange, 4);
    for (var v = Math.ceil(y0 / stepY) * stepY; v <= y0 + yRange; v += stepY) {
      svgEl('line', { x1: padL, x2: W - padR, y1: Y(v), y2: Y(v) }, grid);
      var t = svgEl('text', { x: padL - 6, y: Y(v) + 4, class: 'sa-chart-label sa-chart-label-y' }, svg);
      t.textContent = num(v, stepY < 1 ? 1 : 0);
    }
    var stepX = niceStep(p.length, 6);
    for (var s = 0; s <= p.length + 1e-6; s += stepX) {
      svgEl('line', { x1: X(s), x2: X(s), y1: padT, y2: padT + ph }, grid);
      var tx = svgEl('text', { x: X(s), y: H - 8, class: 'sa-chart-label sa-chart-label-x' }, svg);
      tx.textContent = num(s, stepX < 1 ? 1 : 0) + (s === 0 ? ' m' : '');
    }
    var d = '', area = 'M' + X(0) + ',' + (padT + ph);
    for (var i = 0; i < p.heights.length; i++) {
      var pt = X(p.stations[i]).toFixed(1) + ',' + Y(p.heights[i]).toFixed(1);
      d += (i ? 'L' : 'M') + pt;
      area += 'L' + pt;
    }
    area += 'L' + X(p.length) + ',' + (padT + ph) + 'Z';
    svgEl('path', { d: area, class: 'sa-chart-area' }, svg);
    svgEl('path', { d: d, class: 'sa-chart-line' }, svg);
    var ext = svgEl('text', { x: W - padR, y: padT + 12, class: 'sa-chart-label sa-chart-label-x sa-chart-note' }, svg);
    ext.textContent = 'vertical ' + num(ex, ex < 10 ? 1 : 0) + '×';
    return { svg: svg, X: X, Y: Y, padL: padL, padT: padT, pw: pw, ph: ph, sx: sx };
  }

  function renderProfile() {
    var p = SA.profile;
    if (!p || !profilePanel) return;
    var st = p.stats;
    byId('saProfileStats').innerHTML =
      '<span><b>' + num(p.length, 1) + ' m</b> length</span>' +
      '<span><b>' + num(st.end - st.start, 2) + ' m</b> Δh</span>' +
      '<span><b>' + num(st.min, 2) + ' / ' + num(st.max, 2) + ' m</b> min / max</span>' +
      '<span><b>+' + num(st.up, 1) + ' / −' + num(st.down, 1) + ' m</b> up / down</span>' +
      '<span><b>' + num(st.maxGrade, 1) + ' %</b> max grade (' + GRADE_WINDOW_M + ' m)</span>' +
      '<span class="sa-profile-source">' + esc(p.source) + ' · ' + esc(p.datum) + '</span>';
    var holder = byId('saProfileChart');
    holder.innerHTML = '';
    var W = Math.max(320, holder.clientWidth || 560), H = 210;
    var chart = buildProfileSvg(p, W, H);
    holder.appendChild(chart.svg);
    var cursor = svgEl('line', { x1: 0, x2: 0, y1: chart.padT, y2: chart.padT + chart.ph, class: 'sa-chart-cursor hidden' }, chart.svg);
    var dot = svgEl('circle', { r: 4, cx: 0, cy: 0, class: 'sa-chart-dot hidden' }, chart.svg);

    function hover(ev) {
      var r = chart.svg.getBoundingClientRect();
      var x = (ev.clientX - r.left) * (W / r.width);
      var s = (x - chart.padL) / chart.sx;
      if (s < 0 || s > p.length) { leave(); return; }
      var lo = 0, hi = p.stations.length - 1;
      while (hi - lo > 1) { var m = (lo + hi) >> 1; if (p.stations[m] < s) lo = m; else hi = m; }
      var i = s - p.stations[lo] < p.stations[hi] - s ? lo : hi;
      var cx = chart.X(p.stations[i]), cy = chart.Y(p.heights[i]);
      cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx);
      dot.setAttribute('cx', cx); dot.setAttribute('cy', cy);
      cursor.classList.remove('hidden'); dot.classList.remove('hidden');
      byId('saProfileReadout').textContent = 'Station ' + num(p.stations[i], 1) + ' m · height ' + num(p.heights[i], 2) + ' m';
      p.marker.position = Cesium.Cartesian3.fromDegrees(p.lons[i], p.lats[i]);
      p.marker.show = true;
      requestRender();
    }
    function leave() {
      cursor.classList.add('hidden'); dot.classList.add('hidden');
      if (p.marker) p.marker.show = false;
      requestRender();
    }
    chart.svg.addEventListener('pointermove', hover);
    chart.svg.addEventListener('pointerleave', leave);
  }

  function exportProfileCsv() {
    var p = SA.profile;
    if (!p) return;
    var rows = [['Station (m)', 'Height (m)', 'Longitude', 'Latitude']];
    for (var i = 0; i < p.heights.length; i++) {
      rows.push([csvNum(p.stations[i], 2), csvNum(p.heights[i], 3), csvNum(p.lons[i], 7), csvNum(p.lats[i], 7)]);
    }
    var head = '# ' + p.source + '; ' + p.datum + '\r\n';
    download('elevation-profile.csv', '﻿' + head + rows.map(function(r) { return r.join(';'); }).join('\r\n'), 'text/csv;charset=utf-8');
  }

  function exportProfileSvg() {
    var p = SA.profile;
    if (!p) return;
    var chart = buildProfileSvg(p, 1000, 360);
    var style = svgEl('style', {}, null);
    style.textContent =
      '.sa-chart-grid line{stroke:#d0d0d0;stroke-width:1}' +
      '.sa-chart-label{font:12px sans-serif;fill:#333}' +
      '.sa-chart-label-y{text-anchor:end}.sa-chart-label-x{text-anchor:middle}.sa-chart-note{text-anchor:end}' +
      '.sa-chart-area{fill:rgba(46,207,176,0.18);stroke:none}' +
      '.sa-chart-line{fill:none;stroke:#1a8f7a;stroke-width:2}';
    chart.svg.insertBefore(style, chart.svg.firstChild);
    var bg =svgEl('rect', { x: 0, y: 0, width: 1000, height: 360, fill: '#ffffff' }, null);
    chart.svg.insertBefore(bg, style.nextSibling);
    chart.svg.setAttribute('xmlns', SVG_NS);
    download('elevation-profile.svg', new XMLSerializer().serializeToString(chart.svg), 'image/svg+xml');
  }

  // ===============================
  // SECTION RENDERING
  // ===============================

  function eyeBtn(site, name, label) {
    var l = site.layers[name], on = !!(l && l.show);
    return '<button type="button" class="sa-layer-toggle' + (on ? ' sa-on' : '') + '" data-sa="layer" data-site="' + site.id +
      '" data-layer="' + name + '" aria-pressed="' + on + '" title="' + (l ? (on ? 'Hide ' : 'Show ') : 'Compute ') + label + '"' +
      (SA.job ? ' disabled' : '') + '><i data-lucide="' + (on ? 'eye' : (l ? 'eye-off' : 'play')) + '"></i><span>' + label + '</span></button>';
  }

  function iconBtn(action, site, name, icon, title, danger) {
    return '<button type="button" class="modern-icon-btn sa-icon-btn' + (danger ? ' modern-icon-btn-danger' : '') +
      '" data-sa="' + action + '" data-site="' + site.id + '"' + (name ? ' data-layer="' + name + '"' : '') +
      ' title="' + title + '" aria-label="' + title + '"><i data-lucide="' + icon + '"></i></button>';
  }

  function opacityRow(site, name) {
    var l = site.layers[name];
    if (!l || !l.show) return '';
    return '<label class="sa-opacity"><span>Opacity</span><input type="range" class="modern-slider" min="0.1" max="1" step="0.05" value="' +
      l.opacity + '" data-sa-input="opacity" data-site="' + site.id + '" data-layer="' + name + '" aria-label="Opacity"></label>';
  }

  function legend(site, name) {
    var l = site.layers[name];
    if (!l || !l.show) return '';
    var html = '<div class="sa-legend">';
    if (name === 'slope') {
      for (var i = 0; i < 8; i++) {
        var lo = i ? SLOPE_BREAKS[i - 1] : 0, hi = SLOPE_BREAKS[i];
        html += '<span class="sa-legend-item"><span class="sa-sw sa-sw-slope-' + i + '"></span>' +
          (hi === undefined ? '&gt; ' + lo : lo + '–' + hi) + '°</span>';
      }
    } else if (name === 'aspect') {
      html += '<span class="sa-legend-item"><span class="sa-sw sa-sw-flat"></span>flat ' + num(site.grid.stats.flatShare * 100) + ' %</span>';
      ASPECT_NAMES.forEach(function(n, k) {
        html += '<span class="sa-legend-item"><span class="sa-sw sa-sw-aspect-' + k + '"></span>' + n + ' ' +
          num(site.grid.stats.dirShare[k] * 100) + ' %</span>';
      });
    }
    return html + '</div>';
  }

  // Aspect rose: 8 wedges, radius by area share
  function aspectRose(site) {
    var l = site.layers.aspect;
    if (!l || !l.show) return '';
    var share = site.grid.stats.dirShare, max = Math.max.apply(null, share) || 1;
    var html = '<svg class="sa-rose" viewBox="0 0 100 100" role="img" aria-label="Aspect rose">' +
      '<circle cx="50" cy="50" r="45" class="sa-rose-ring"></circle><circle cx="50" cy="50" r="22.5" class="sa-rose-ring"></circle>';
    share.forEach(function(s, k) {
      var r = 45 * s / max;
      if (r < 0.5) return;
      var a1 = (k * 45 - 22.5) * Math.PI / 180, a2 = (k * 45 + 22.5) * Math.PI / 180;
      var x1 = 50 + r * Math.sin(a1), y1 = 50 - r * Math.cos(a1), x2 = 50 + r * Math.sin(a2), y2 = 50 - r * Math.cos(a2);
      html += '<path class="sa-fill-aspect-' + k + '" d="M50,50L' + x1.toFixed(2) + ',' + y1.toFixed(2) +
        'A' + r.toFixed(2) + ',' + r.toFixed(2) + ' 0 0 1 ' + x2.toFixed(2) + ',' + y2.toFixed(2) + 'Z"></path>';
    });
    return html + '<text x="50" y="9" class="sa-rose-n">N</text></svg>';
  }

  function cutFillBlock(site) {
    var l = site.layers.cutfill;
    if (!l || !l.show || !site.cut.result) return '';
    var r = site.cut.result, sid = site.id;
    var html = '<div class="sa-cutfill">' +
      '<div class="sa-field-row">' +
        '<label class="modern-label-small" for="saCfMode' + sid + '">Grade level</label>' +
        '<select id="saCfMode' + sid + '" class="modern-select sa-select-small" data-sa-input="cf-mode" data-site="' + sid + '">' +
          '<option value="balanced"' + (site.cut.mode === 'balanced' ? ' selected' : '') + '>Balanced (cut = fill)</option>' +
          '<option value="fixed"' + (site.cut.mode === 'fixed' ? ' selected' : '') + '>Fixed level</option>' +
        '</select>' +
      '</div>' +
      '<div class="sa-field-row">' +
        '<label class="modern-label-small" for="saCfTarget' + sid + '">Level (m)</label>' +
        '<input id="saCfTarget' + sid + '" type="number" step="0.01" class="modern-input sa-input-small" value="' + r.target.toFixed(2) +
          '" data-sa-input="cf-target" data-site="' + sid + '"' + (site.cut.mode === 'balanced' ? ' disabled' : '') + '>' +
        '<label class="modern-label-small" for="saCfSwell' + sid + '">Swell</label>' +
        '<input id="saCfSwell' + sid + '" type="number" step="0.01" min="1" max="2" class="modern-input sa-input-small" value="' +
          site.cut.swell + '" data-sa-input="cf-swell" data-site="' + sid + '" title="Swell factor for the loose cut volume">' +
      '</div>' +
      '<div class="sa-cf-sum">' +
        '<span class="sa-cf-cut"><span class="sa-sw sa-sw-cut"></span>Cut <b>' + num(r.cut) + ' m³</b></span>' +
        '<span class="sa-cf-fill"><span class="sa-sw sa-sw-fill"></span>Fill <b>' + num(r.fill) + ' m³</b></span>' +
        '<span>Net <b>' + num(r.net) + ' m³</b></span>' +
        (site.cut.swell !== 1 ? '<span>Cut, loose <b>' + num(r.cut * site.cut.swell) + ' m³</b></span>' : '') +
      '</div>';
    if (r.regions.length) {
      html += '<table class="sa-table"><thead><tr><th>#</th><th>Type</th><th>Area m²</th><th>Volume m³</th></tr></thead><tbody>';
      r.regions.slice(0, 20).forEach(function(reg) {
        html += '<tr tabindex="0" data-sa="cf-region" data-site="' + sid + '" data-region="' + reg.no + '" title="Fly to region ' + reg.no + '">' +
          '<td>' + reg.no + '</td><td><span class="sa-sw sa-sw-' + reg.type + '"></span>' + (reg.type === 'cut' ? 'Cut' : 'Fill') + '</td>' +
          '<td>' + num(reg.area) + '</td><td>' + num(reg.volume) + '</td></tr>';
      });
      html += '</tbody></table>';
      if (r.regions.length > 20) html += '<div class="sa-note">' + (r.regions.length - 20) + ' smaller regions in the CSV export</div>';
    }
    return html + '</div>';
  }

  function siteCard(site) {
    var g = site.grid, sid = site.id, busy = !!SA.job;
    var html = '<div class="sa-site" data-site="' + sid + '">' +
      '<div class="sa-site-head">' +
        '<span class="sa-site-name">' + esc(site.name) + '</span>' +
        '<span class="sa-site-meta">' + num(site.area / 10000, 2) + ' ha · ' + num(site.perimeter) + ' m</span>' +
        iconBtn('site-zoom', site, null, 'crosshair', 'Zoom to ' + esc(site.name)) +
        iconBtn('site-remove', site, null, 'trash-2', 'Remove ' + esc(site.name), true) +
      '</div>';
    if (!g) {
      html += '<button type="button" class="modern-btn modern-btn-primary sa-full" data-sa="site-analyze" data-site="' + sid + '"' +
        (busy ? ' disabled' : '') + '><i data-lucide="scan-search"></i><span>Analyze terrain</span></button>';
      return html + '</div>';
    }
    var st = g.stats;
    html += '<dl class="sa-stats">' +
      '<dt>Height</dt><dd>' + num(st.min, 1) + ' / ' + num(st.median, 1) + ' / ' + num(st.max, 1) + ' m <small>min / median / max</small></dd>' +
      '<dt>Slope</dt><dd>⌀ ' + num(st.meanSlope, 1) + '° · ' + num(st.steepShare * 100) + ' % steeper than ' + STEEP_DEG + '°</dd>' +
      '<dt>Grid</dt><dd>' + num(g.cell, g.cell % 1 ? 1 : 0) + ' m · ' + num(st.cells) + ' cells</dd>' +
      '<dt>Source</dt><dd>' + esc(g.source) + (g.pixelM ? ' · data ≈ ' + num(g.pixelM, g.pixelM < 10 ? 1 : 0) + ' m' : '') + '</dd>' +
      '<dt>Datum</dt><dd>' + esc(g.datum) + '</dd>' +
      '</dl>';
    if (g.coarsened) html += '<div class="sa-warn"><i data-lucide="info"></i>Grid coarsened from ' + num(g.requested, 1) + ' m to ' + num(g.cell, 1) + ' m (max. ' + num(MAX_SAMPLES) + ' cells)</div>';
    if (g.pixelM && g.cell < g.pixelM * 0.75) html += '<div class="sa-warn"><i data-lucide="info"></i>The terrain data here is coarser (≈ ' + num(g.pixelM, 1) + ' m) than the grid</div>';
    if (g.sourceKey === 'active' && /3D Tiles/.test(g.source)) html += '<div class="sa-warn"><i data-lucide="info"></i>Surface model: buildings and trees count as terrain</div>';

    // Contours
    var c = site.layers.contours, interval = site.contourInterval;
    html += '<div class="sa-layer">' + eyeBtn(site, 'contours', 'Contours') +
      '<select class="modern-select sa-select-small" data-sa-input="contour-interval" data-site="' + sid + '" aria-label="Contour interval" title="Contour interval">' +
      '<option value="auto"' + (interval === 'auto' ? ' selected' : '') + '>auto (' + num(autoInterval(st), 2) + ' m)</option>' +
      CONTOUR_STEPS.map(function(s) { return '<option value="' + s + '"' + (String(s) === String(interval) ? ' selected' : '') + '>' + num(s, 2) + ' m</option>'; }).join('') +
      '</select>' +
      (c ? iconBtn('layer-export', site, 'contours', 'download', 'Export contours (GeoJSON)') + iconBtn('layer-remove', site, 'contours', 'x', 'Remove contours') : '') +
      '</div>';
    if (c && c.show) html += '<div class="sa-note">' + num(c.data.lines.length) + ' lines, every ' + num(c.data.interval, 2) + ' m, bold every ' + num(c.data.interval * 5, 2) + ' m</div>';

    ['slope', 'aspect', 'cutfill'].forEach(function(name) {
      var label = { slope: 'Slope', aspect: 'Aspect', cutfill: 'Cut & fill' }[name], l = site.layers[name];
      html += '<div class="sa-layer">' + eyeBtn(site, name, label) +
        (l ? iconBtn('layer-export', site, name, name === 'cutfill' ? 'file-spreadsheet' : 'image-down', name === 'cutfill' ? 'Export volumes (CSV)' : 'Export ' + label + ' (PNG)') +
             (name === 'cutfill' ? iconBtn('layer-png', site, name, 'image-down', 'Export cut & fill (PNG)') : '') +
             iconBtn('layer-remove', site, name, 'x', 'Remove ' + label) : '') +
        '</div>' + opacityRow(site, name);
      if (name === 'aspect') html += '<div class="sa-aspect">' + aspectRose(site) + legend(site, name) + '</div>';
      else if (name === 'slope') html += legend(site, name);
      else html += cutFillBlock(site);
    });

    html += '<button type="button" class="modern-btn modern-btn-small sa-full" data-sa="site-analyze" data-site="' + sid + '"' + (busy ? ' disabled' : '') +
      ' title="Sample again with the current source and resolution"><i data-lucide="refresh-cw"></i><span>Re-sample</span></button>';
    return html + '</div>';
  }

  function renderSites() {
    var list = byId('saSiteList');
    if (!list) return;
    if (!SA.sites.length) {
      list.innerHTML = '<div class="sa-empty">No site yet — draw a polygon or rectangle, or take a clipping polygon.</div>';
    } else {
      list.innerHTML = SA.sites.map(siteCard).join('');
    }
    document.querySelectorAll('[data-sa="draw-polygon"], [data-sa="draw-rectangle"], [data-sa="draw-line"]').forEach(function(b) {
      b.disabled = !!SA.job;
    });
    refreshClipOptions();
    renderDrawState();
    icons();
  }

  function refreshClipOptions() {
    var sel = byId('saClipSelect');
    if (!sel) return;
    var polys = (BimViewer.clipping && BimViewer.clipping.polygons) || [];
    var html = '<option value="">' + (polys.length ? 'From clipping polygon…' : 'No clipping polygon') + '</option>';
    polys.forEach(function(p, i) {
      html += '<option value="' + i + '">Clipping polygon ' + (i + 1) + ' (' + (p.points ? p.points.length : 0) + ' points)</option>';
    });
    sel.innerHTML = html;
    sel.disabled = !polys.length || !!SA.job;
  }

  // ===============================
  // EVENTS
  // ===============================

  function onClick(e) {
    var b = e.target.closest('[data-sa]');
    if (!b || b.disabled) return;
    var action = b.dataset.sa, site = b.dataset.site ? findSite(b.dataset.site) : null, name = b.dataset.layer;
    switch (action) {
      case 'draw-polygon': SA.drawing && SA.drawing.mode === 'polygon' ? stopDraw() : startDraw('polygon'); break;
      case 'draw-rectangle': SA.drawing && SA.drawing.mode === 'rectangle' ? stopDraw() : startDraw('rectangle'); break;
      case 'draw-line': SA.drawing && SA.drawing.mode === 'line' ? stopDraw() : startDraw('line'); break;
      case 'draw-undo': undoPoint(); break;
      case 'draw-finish': finishDraw(); break;
      case 'draw-cancel': stopDraw(); break;
      case 'cancel': if (SA.job) SA.job.cancelled = true; break;
      case 'site-analyze': if (site) analyzeSite(site); break;
      case 'site-zoom': if (site) zoomToSite(site); break;
      case 'site-remove': if (site) removeSite(site); break;
      case 'layer': if (site) toggleLayer(site, name); break;
      case 'layer-remove': if (site) { removeLayer(site, name); renderSites(); requestRender(); } break;
      case 'layer-export':
        if (!site) break;
        if (name === 'contours') exportContours(site);
        else if (name === 'cutfill') exportCutFill(site);
        else exportPng(site, name);
        break;
      case 'layer-png': if (site) exportPng(site, name); break;
      case 'cf-region':
        if (site && site.cut.result) {
          var reg = site.cut.result.regions[Number(b.dataset.region) - 1];
          if (reg) flyToLocal(site, reg.cx, reg.cy, reg.radius, reg.meanH);
        }
        break;
      case 'profile-close': closeProfilePanel(); break;
      case 'profile-csv': exportProfileCsv(); break;
      case 'profile-svg': exportProfileSvg(); break;
    }
  }

  function onInput(e) {
    var t = e.target;
    if (t.id === 'saSource') { SA.settings.source = t.value; return; }
    if (t.id === 'saCell') { SA.settings.cell = Number(t.value); return; }
    if (t.id === 'saClipSelect') {
      if (e.type !== 'change' || t.value === '') return;
      var poly = BimViewer.clipping.polygons[Number(t.value)];
      t.value = '';
      if (poly && poly.points) addSite(poly.points.map(cartesianToDeg), 'clipping');
      return;
    }
    var kind = t.dataset && t.dataset.saInput;
    if (!kind) return;
    if (kind === 'profile-exag') {
      if (e.type === 'change' && SA.profile) { SA.profile.exaggeration = t.value; renderProfile(); }
      return;
    }
    var site = findSite(t.dataset.site);
    if (!site) return;
    if (kind === 'opacity') { setOpacity(site, t.dataset.layer, Number(t.value)); return; }
    if (e.type !== 'change') return;
    try {
      if (kind === 'contour-interval') {
        site.contourInterval = t.value;
        if (site.layers.contours) showContours(site);
      } else if (kind === 'cf-mode') {
        site.cut.mode = t.value;
        showCutFill(site);
      } else if (kind === 'cf-target') {
        var v = Number(t.value);
        if (!isFinite(v)) return;
        site.cut.target = v;
        showCutFill(site);
      } else if (kind === 'cf-swell') {
        var f = Number(t.value);
        site.cut.swell = isFinite(f) && f >= 1 ? f : 1;
      }
      status('', '');
    } catch (err) {
      status(err.message || String(err), 'error');
    }
    renderSites();
    requestRender();
  }

  function onKey(e) {
    var tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || e.target.isContentEditable) return;
    // Enter on a focused cut & fill region row flies there
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.sa === 'cf-region') { onClick(e); return; }
    if (!SA.drawing) return;
    if (window.BimFirstPerson && typeof BimFirstPerson.isActive === 'function' && BimFirstPerson.isActive()) return;
    if (e.key === 'Enter') { e.preventDefault(); finishDraw(); }
    else if (e.key === 'Escape') { e.preventDefault(); stopDraw(); }
    else if (e.key === 'Backspace') { e.preventDefault(); undoPoint(); }
  }

  function init() {
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onInput);
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', function(e) { if (e.target.id === 'saClipSelect') refreshClipOptions(); });
    document.addEventListener('pointerdown', function(e) { lastPointer = e.pointerType || 'mouse'; }, true);

    // A tap that places a point is not an element pick (same as touch-draw.js)
    var origSelect = BimViewer.handleIFCSelection;
    if (typeof origSelect === 'function') {
      BimViewer.handleIFCSelection = function() {
        if (SA.drawing && isTouch()) return;
        return origSelect.apply(this, arguments);
      };
    }

    // The section is built by ui.js after DOMContentLoaded
    var tries = 0;
    (function waitForSection() {
      if (byId('saSiteList')) { renderSites(); return; }
      if (++tries < 100) setTimeout(waitForSection, 200);
    })();
  }

  // Public API (console, tests, other modules)
  SA.addSite = addSite;
  SA.analyze = function(site) {
    site = site && typeof site === 'object' ? site : findSite(site);
    return site ? analyzeSite(site) : Promise.resolve();
  };
  SA.startDraw = startDraw;
  SA.stopDraw = stopDraw;
  SA.toggleLayer = function(site, name) {
    site = site && typeof site === 'object' ? site : findSite(site);
    if (site) toggleLayer(site, name);
  };
  SA.profileAlong = runProfile;
  SA.render = renderSites;
  // Pure grid functions, exposed for checks with synthetic grids
  SA._internals = { derivatives: derivatives, gridStats: gridStats, traceLevel: traceLevel, volumesAt: volumesAt,
                    balancedTarget: balancedTarget, fillGaps: fillGaps, simplify: simplify };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
