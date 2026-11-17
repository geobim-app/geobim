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
// 3D Tiles. Saved with scenes by site-analysis-scenes.js (see STATE below).
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

  // The terrain provider without this module's grading (see GRADING)
  function baseTerrainProvider() {
    var p = viewer().terrainProvider;
    return p && p._saBase ? p._saBase : p;
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
  async function sampleHeights(lons, lats, job, label, sourceKey) {
    var count = lons.length;
    var midLon = lons[Math.floor(count / 2)], midLat = lats[Math.floor(count / 2)];

    if ((sourceKey || SA.settings.source) === 'mapterhorn') {
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
    var provider = baseTerrainProvider();   // never the graded terrain of this module
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

  // opts: { name, quiet } (scene restore)
  function addSite(ringDeg, origin, opts) {
    opts = opts || {};
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
      name: opts.name ? String(opts.name).slice(0, 60) : 'Site ' + seq,
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
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, Math.max(30000, Math.sqrt(area) * 40))
      }
    }));
    SA.sites.push(site);
    if (!opts.quiet) status(site.name + ' added — ' + num(area / 10000, 2) + ' ha. Click "Analyze terrain".', 'ok');
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
    if (site.grading) {
      var gid = site.grading.group;
      clearGradingEntities(site);
      site.grading = null;
      if (gid && SA.groups[gid]) {
        var rest = groupMembers(gid);
        if (rest.length < 2) { rest.forEach(function(s) { s.grading.group = null; if (s.grading.result) drawGrading(s); }); dropGroup(gid); }
        else if (!SA.clearing) computeGroup(gid);
      }
    }
    site.entities.forEach(function(e) { ds().entities.remove(e); });
    SA.sites.splice(SA.sites.indexOf(site), 1);
    updateTerrain();
    refreshProfileGrading();
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

  // pad: extra metres around the polygon (grading band)
  function planGrid(site, cell, pad) {
    pad = pad || 0;
    var xs = site.local.map(function(p) { return p[0]; }), ys = site.local.map(function(p) { return p[1]; });
    var minX = Math.min.apply(null, xs) - pad, maxX = Math.max.apply(null, xs) + pad;
    var minY = Math.min.apply(null, ys) - pad, maxY = Math.max.apply(null, ys) + pad;
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

  // opts: { source, cell } override the section settings (scene restore)
  async function analyzeSite(site, opts) {
    opts = opts || {};
    var sourceKey = opts.source || SA.settings.source;
    var plan = planGrid(site, Number(opts.cell) || SA.settings.cell);
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

      var res = await sampleHeights(lons, lats, job, site.name, sourceKey);
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
        sourceKey: sourceKey,
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

  // Depth raster with the edge between cells: per output pixel the depth dz
  // and the slope excess (see drawSurface) are interpolated bilinearly from
  // the cell centres; pixels with excess < 0 stay clear, so the coloured area
  // ends on the same line as the dashed slope edge instead of in cell steps.
  function depthCanvas(nx, ny, dz, edge, colorOf) {
    var s = Math.max(1, Math.min(8, Math.floor(RASTER_MAX_PX / Math.max(nx, ny))));
    var w = nx * s, h = ny * s;
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d'), img = ctx.createImageData(w, h), px = img.data;
    for (var y = 0; y < h; y++) {
      var fy = Math.min(ny - 1, Math.max(0, (y + 0.5) / s - 0.5)), j0 = Math.min(ny - 2, Math.floor(fy)), ty = fy - j0;
      if (ny < 2) { j0 = 0; ty = 0; }
      for (var x = 0; x < w; x++) {
        var fx = Math.min(nx - 1, Math.max(0, (x + 0.5) / s - 0.5)), i0 = Math.min(nx - 2, Math.floor(fx)), tx = fx - i0;
        if (nx < 2) { i0 = 0; tx = 0; }
        var a = j0 * nx + i0, b = a + (nx > 1 ? 1 : 0), c = a + (ny > 1 ? nx : 0), d = c + (nx > 1 ? 1 : 0);
        var w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        var e = edge[a] * w00 + edge[b] * w10 + edge[c] * w01 + edge[d] * w11;
        if (!(e >= 0)) continue;
        var col = colorOf(dz[a] * w00 + dz[b] * w10 + dz[c] * w01 + dz[d] * w11), o = (y * w + x) * 4;
        px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = col[3];
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
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
  // GRADING (planum with slopes, applied to the terrain)
  // One formula for volumes, display, terrain and export — planum level t,
  // slope ratios 1:nC (cut) and 1:nF (fill), d = distance to the polygon
  // (0 inside), existing height T:
  //   R = min(max(T, t − d/nF), t + d/nC)
  // A planum with a gradient g (fraction) falling towards bearing β is the
  // plane P(x, y) = t − g·(x·sin β + y·cos β), t its height at the site centre
  // (frame origin). Inside the polygon R = P(x, y); outside, the slopes start
  // at the planum height of the nearest edge point: t → P(nearest point).
  // Outside the slopes R = T. The grading grid covers the polygon plus a band
  // wide enough for the slopes; T always comes from the unchanged terrain.
  // ===============================

  var GRADING_MAX_BAND = 300;          // m
  var SLOPE_DEFAULT = { cut: 1.5, fill: 2 };

  function segDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    var u = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    u = u < 0 ? 0 : (u > 1 ? 1 : u);
    return Math.hypot(px - ax - u * dx, py - ay - u * dy);
  }

  // Distance to the polygon in its local metres, 0 inside
  function polyDist(x, y, pts) {
    if (inRing(x, y, pts)) return 0;
    var m = Infinity;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var dd = segDist(x, y, pts[j][0], pts[j][1], pts[i][0], pts[i][1]);
      if (dd < m) m = dd;
    }
    return m;
  }

  // [distance, x, y] of the nearest polygon point (the point itself inside)
  function polyNearest(x, y, pts) {
    if (inRing(x, y, pts)) return [0, x, y];
    var best = [Infinity, x, y];
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var ax = pts[j][0], ay = pts[j][1], dx = pts[i][0] - ax, dy = pts[i][1] - ay, l2 = dx * dx + dy * dy;
      var u = l2 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
      u = u < 0 ? 0 : (u > 1 ? 1 : u);
      var qx = ax + u * dx, qy = ay + u * dy, dd = Math.hypot(x - qx, y - qy);
      if (dd < best[0]) best = [dd, qx, qy];
    }
    return best;
  }

  var COMPASS = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
  function bearingName(b) { return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((Number(b) || 0) % 360 + 360) % 360 / 45) % 8]; }

  // Planum offset P − t at a local point, or null for a level planum
  function planumOffsetFn(gr) {
    var g = (Number(gr.gradient) || 0) / 100;
    if (!g) return null;
    var b = (Number(gr.bearing) || 0) * Math.PI / 180, sx = g * Math.sin(b), sy = g * Math.cos(b);
    return function(x, y) { return -(x * sx + y * sy); };
  }

  // Downhill bearing and gradient of the plane fitted to the site's heights
  // (least squares z = a + b·x + c·y over the cells inside the polygon)
  function terrainFit(site) {
    var g = site.grid;
    if (!g) return null;
    var n = 0, sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0;
    for (var k = 0; k < g.h.length; k++) {
      if (!g.inside[k] || !isFinite(g.h[k])) continue;
      var i = k % g.nx, j = (k - i) / g.nx, x = cellX(g, i), y = cellY(g, j), z = g.h[k];
      n++; sx += x; sy += y; sz += z; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z;
    }
    if (n < 3) return null;
    var mx = sx / n, my = sy / n, mz = sz / n;
    var cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my, cxz = sxz / n - mx * mz, cyz = syz / n - my * mz;
    var det = cxx * cyy - cxy * cxy;
    if (Math.abs(det) < 1e-9) return null;
    var b = (cxz * cyy - cyz * cxy) / det, c = (cyz * cxx - cxz * cxy) / det;
    var bearing = (Math.atan2(-b, -c) * 180 / Math.PI + 360) % 360;
    return { bearing: Math.round(bearing), percent: Math.hypot(b, c) * 100 };
  }

  // Bearing the planum falls towards: a compass direction or along the terrain
  function resolveBearing(site, gr) {
    if (gr.dir === 'terrain') {
      var f = terrainFit(site);
      gr.terrain = f;
      return f ? f.bearing : 0;
    }
    gr.terrain = null;
    return COMPASS[gr.dir] !== undefined ? COMPASS[gr.dir] : 0;
  }

  // Per-cell planum offset of the grading grid (from the nearest polygon point)
  function ensureOffsets(gr) {
    var gg = gr.grid, key = (Number(gr.gradient) || 0) + '/' + (Number(gr.bearing) || 0);
    if (gg.offKey === key) return;
    var off = planumOffsetFn(gr);
    gg.O = null;
    if (off) {
      gg.O = new Float32Array(gg.T.length);
      for (var k = 0; k < gg.T.length; k++) if (gg.D[k] <= gg.W) gg.O[k] = off(gg.PX[k], gg.PY[k]);
    }
    gg.offKey = key;
  }

  function gradeCell(gg, k, t, nC, nF) {
    return gradeHeight(gg.T[k], gg.D[k], gg.O ? t + gg.O[k] : t, nC, nF);
  }

  function gradeHeight(T, d, t, nC, nF) {
    return Math.min(Math.max(T, t - d / nF), t + d / nC);
  }

  // gg: { T, D, cell, W } — volumes split into planum (d = 0) and slopes
  function gradingVolumes(gg, t, nC, nF) {
    var a = gg.cell * gg.cell, r = { cut: 0, fill: 0, cutPlanum: 0, fillPlanum: 0, affected: 0, maxWidth: 0, bandHit: false };
    var edge = gg.W - 1.5 * gg.cell;
    for (var k = 0; k < gg.T.length; k++) {
      var d = gg.D[k], T = gg.T[k];
      if (!(d <= gg.W) || !isFinite(T)) continue;
      var diff = T - gradeCell(gg, k, t, nC, nF);
      if (diff > 0) { r.cut += diff * a; if (d === 0) r.cutPlanum += diff * a; }
      else if (diff < 0) { r.fill -= diff * a; if (d === 0) r.fillPlanum -= diff * a; }
      if (Math.abs(diff) > CUT_EPS || d === 0) {
        r.affected++;
        if (d > r.maxWidth && Math.abs(diff) > CUT_EPS) r.maxWidth = d;
        if (d >= edge && Math.abs(diff) > CUT_EPS) r.bandHit = true;
      }
    }
    r.affectedM2 = r.affected * a;
    r.net = r.cut - r.fill;
    return r;
  }

  // Planum level where cut = fill, slopes included (cut falls, fill rises with t)
  function gradingBalanced(gg, nC, nF) {
    var lo = Infinity, hi = -Infinity;
    for (var k = 0; k < gg.T.length; k++) {
      if (gg.D[k] !== 0 || !isFinite(gg.T[k])) continue;
      var tk = gg.O ? gg.T[k] - gg.O[k] : gg.T[k];   // t that puts the planum on this cell
      if (tk < lo) lo = tk;
      if (tk > hi) hi = tk;
    }
    for (var it = 0; it < 50; it++) {
      var mid = (lo + hi) / 2, v = gradingVolumes(gg, mid, nC, nF);
      if (v.cut > v.fill) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function newGrading() {
    return { levelMode: 'balanced', level: null, slopeCut: SLOPE_DEFAULT.cut, slopeFill: SLOPE_DEFAULT.fill,
             gradient: 0, dir: 'terrain', bearing: 0, terrain: null,
             applied: true, depth: false, grid: null, result: null, entities: [] };
  }

  // Band width for the slopes: the full height range of the site times the
  // flatter ratio, plus two cells
  function gradingBand(site, gr) {
    var st = site.grid.stats, span = 0;
    site.local.forEach(function(p) { span = Math.max(span, Math.hypot(p[0], p[1])); });
    var rise = (Number(gr.gradient) || 0) / 100 * 2 * span;   // planum height range across the site
    return Math.min(GRADING_MAX_BAND, (st.max - st.min + rise + 2) * Math.max(gr.slopeCut, gr.slopeFill) + 2 * site.grid.cell);
  }

  // Samples the existing terrain over polygon + band (only cells within the band)
  async function sampleGradingGrid(site, W, job) {
    var plan = planGrid(site, site.grid.cell, W);
    if (!plan) throw new Error('The grading area is too large');
    var n = plan.nx * plan.ny, D = new Float32Array(n), PX = new Float32Array(n), PY = new Float32Array(n), idx = [], lons = [], lats = [];
    for (var k = 0; k < n; k++) {
      var i = k % plan.nx, j = (k - i) / plan.nx;
      var x = cellX(plan, i), y = cellY(plan, j);
      var near = polyNearest(x, y, site.local), d = near[0];
      D[k] = d <= W ? d : Infinity;
      PX[k] = near[1]; PY[k] = near[2];
      if (d > W) continue;
      var deg = site.frame.toDeg(x, y);
      idx.push(k); lons.push(deg[0]); lats.push(deg[1]);
    }
    var res = await sampleHeights(lons, lats, job, site.name + ' grading', site.grid.sourceKey);
    var T = new Float32Array(n).fill(NaN), need = new Uint8Array(n);
    for (k = 0; k < idx.length; k++) { T[idx[k]] = res.heights[k]; need[idx[k]] = 1; }
    if (!fillGaps(T, need, plan.nx, plan.ny)) throw new Error('No height data for the grading area');
    var west = site.frame.lon0 + plan.x0 / site.frame.m.lon;
    var north = site.frame.lat0 + plan.yTop / site.frame.m.lat;
    return {
      nx: plan.nx, ny: plan.ny, cell: plan.cell, coarsened: plan.coarsened, x0: plan.x0, yTop: plan.yTop, W: W,
      west: west, east: west + plan.nx * plan.cell / site.frame.m.lon,
      north: north, south: north - plan.ny * plan.cell / site.frame.m.lat,
      T: T, D: D, PX: PX, PY: PY, sourceKey: site.grid.sourceKey
    };
  }

  // (Re)computes the grading of a site: samples the band when needed, then
  // level, volumes, slope edge, depth raster and terrain
  // fromGroup: called by computeGroup for a terrace's own planum level only
  async function computeGrading(site, fromGroup) {
    if (!site.grid) return;
    var gr = site.grading || (site.grading = newGrading());
    gr.bearing = resolveBearing(site, gr);
    var W = gradingBand(site, gr);
    var needSample = !gr.grid || gr.grid.W < W || gr.grid.sourceKey !== site.grid.sourceKey || gr.grid.cell !== site.grid.cell;
    if (needSample) {
      var job = startJob();
      if (!job) return;
      try {
        gr.grid = await sampleGradingGrid(site, W, job);
        var r0 = evaluateGrading(site);
        // Slopes still reach the band edge: widen once
        if (r0.bandHit && W < GRADING_MAX_BAND) {
          gr.grid = await sampleGradingGrid(site, Math.min(GRADING_MAX_BAND, W * 1.5), job);
        }
      } catch (err) {
        if (err && err.message === 'cancelled') status('Cancelled', '');
        else { console.error('Grading failed:', err); status(err.message || String(err), 'error'); }
        gr.grid = null;
        return;
      } finally {
        endJob();
      }
    }
    gr.result = evaluateGrading(site);
    gr.result.N = (await undulation(site.frame.lon0, site.frame.lat0)).n;
    if (gr.levelMode === 'balanced') gr.level = Math.round(gr.result.t * 100) / 100;
    if (fromGroup) return;
    if (groupOf(site)) { await computeGroup(gr.group); return; }
    drawGrading(site);
    updateTerrain();
    refreshProfileGrading();
    status(site.name + ': planum at ' + num(gr.result.t, 2) + ' m' + (gr.gradient ? ' (centre, ' + num(gr.gradient, 1) + ' % to ' + bearingName(gr.bearing) + ')' : '') +
      ' — cut ' + num(gr.result.cut) + ' m³, fill ' + num(gr.result.fill) + ' m³', 'ok');
    renderSites();
    requestRender();
  }

  function evaluateGrading(site) {
    var gr = site.grading, gg = gr.grid;
    ensureOffsets(gr);
    var t = gr.levelMode === 'fixed' && isFinite(gr.level) && gr.level !== null ? Number(gr.level) : gradingBalanced(gg, gr.slopeCut, gr.slopeFill);
    var v = gradingVolumes(gg, t, gr.slopeCut, gr.slopeFill);
    v.t = t;
    v.pMin = t; v.pMax = t;
    if (gg.O) for (var k = 0; k < gg.T.length; k++) {
      if (gg.D[k] !== 0) continue;
      v.pMin = Math.min(v.pMin, t + gg.O[k]); v.pMax = Math.max(v.pMax, t + gg.O[k]);
    }
    v.cutSlopes = v.cut - v.cutPlanum;
    v.fillSlopes = v.fill - v.fillPlanum;
    return v;
  }

  // How far the existing ground lies beyond the slope cones at cell k:
  // max(T − cut cone, fill cone − T), cones from the planum P at distance d.
  // > 0 where the grading changes the ground, < 0 where it stays; it runs on
  // linearly through the edge, so its zero line is where the slope surface
  // meets the terrain (as a CAD intersection does), not a cell boundary.
  function slopeExcess(T, d, P, nC, nF) {
    return Math.max(T - (P + d / nC), (P - d / nF) - T);
  }

  // Slope edge (boundary of the changed area) as dashed ground lines + optional
  // depth raster. u: grading unit (gradingUnit), target: { entities, canvas }
  function drawSurface(target, u, depth) {
    var gg = u.gg, n = gg.T.length, mask = new Float32Array(n), R = new Float32Array(n), dmax = 0;
    var edge = new Float32Array(n).fill(-1000);  // outside the band: unchanged
    for (var k = 0; k < n; k++) {
      if (!u.inBand(k)) continue;
      R[k] = u.R(k);
      var diff = gg.T[k] - R[k];
      mask[k] = Math.abs(diff) > CUT_EPS || u.planum(k) ? 1 : 0;
      if (mask[k]) dmax = Math.max(dmax, Math.abs(diff));
      // On the planum the edge is never inside (at least CUT_EPS above the level)
      edge[k] = (u.planum(k) ? Math.max(Math.abs(diff), 2 * CUT_EPS) : u.excess(k)) - CUT_EPS;
    }
    var mg = { nx: gg.nx, ny: gg.ny, h: edge, need: new Uint8Array(n).fill(1) };
    var color = cesiumColor('--brand-teal', '#2ECFB0'), toDeg = u.site.frame.toDeg;
    traceLevel(mg, 0).forEach(function(line) {
      if (line.length < 3) return;
      var pts = line.map(function(p) { return toDeg(gg.x0 + (p[0] + 0.5) * gg.cell, gg.yTop - (p[1] + 0.5) * gg.cell); });
      target.entities.push(ds().entities.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(flatDeg(pts, false)),
          clampToGround: true,
          width: 2.5,
          material: new Cesium.PolylineDashMaterialProperty({ color: color, dashLength: 10 }),
          classificationType: Cesium.ClassificationType.BOTH
        }
      }));
    });
    if (depth) {
      var p = palette(), dz = new Float32Array(n);
      for (var k1 = 0; k1 < n; k1++) if (u.inBand(k1)) dz[k1] = gg.T[k1] - R[k1];
      var canvas = depthCanvas(gg.nx, gg.ny, dz, edge, function(diff) {
        if (Math.abs(diff) < CUT_EPS) return [p.grade[0], p.grade[1], p.grade[2], 70];
        var c = diff > 0 ? p.cut : p.fill;
        return [c[0], c[1], c[2], Math.round(90 + 130 * Math.min(1, Math.abs(diff) / (dmax || 1)))];
      });
      target.canvas = canvas;
      target.entities.push(ds().entities.add({
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(gg.west, gg.south, gg.east, gg.north),
          material: new Cesium.ImageMaterialProperty({ image: canvas, transparent: true, color: Cesium.Color.WHITE.withAlpha(0.75) }),
          classificationType: Cesium.ClassificationType.BOTH
        }
      }));
    }
  }

  function drawGrading(site) {
    clearGradingEntities(site);
    if (groupOf(site)) return;              // a terrace: the group draws
    drawSurface(site.grading, gradingUnit(site), site.grading.depth);
  }

  function clearGradingEntities(site) {
    var gr = site.grading;
    if (!gr) return;
    gr.entities.forEach(function(e) { ds().entities.remove(e); });
    gr.entities = [];
  }

  function removeGrading(site) {
    if (!site.grading) return;
    if (site.grading.group) unlinkSite(site, true);
    clearGradingEntities(site);
    site.grading = null;
    updateTerrain();
    refreshProfileGrading();
  }

  // ===============================
  // TERRACE GROUPS
  // Graded sites linked into one earthwork: each keeps its planum (level or
  // gradient, its own level); the group samples one grid over all of them
  // plus the slope band, so no volume is counted twice. Inside a site
  // R = its planum P_i; outside, the fill cones bound the ground from below
  // and the cut cones from above:
  //   R = min(max(T, max_i(P_i − d_i/nF_i)), min_i(P_i + d_i/nC_i))
  // One site gives the single-site formula. "Balance" moves all planums by
  // one common shift s so that cut = fill for the whole group; the steps
  // between terraces stay as their own levels define them.
  // ===============================

  SA.groups = SA.groups || {};
  var groupSeq = 0;

  function newGroup(gid) { return { id: gid, balance: true, grid: null, result: null, entities: [], canvas: null }; }

  function groupMembers(gid) {
    return SA.sites.filter(function(s) { return s.grading && s.grading.group === gid; });
  }

  // The group of a terrace, or null (a group needs two members)
  function groupOf(site) {
    var gid = site && site.grading && site.grading.group;
    return gid && SA.groups[gid] && groupMembers(gid).length > 1 ? SA.groups[gid] : null;
  }

  function groupName(g) { return groupMembers(g.id).map(function(s) { return s.name; }).join(' + '); }

  function clearGroupEntities(g) {
    g.entities.forEach(function(e) { ds().entities.remove(e); });
    g.entities = [];
  }

  function dropGroup(gid) {
    var g = SA.groups[gid];
    if (!g) return;
    clearGroupEntities(g);
    delete SA.groups[gid];
  }

  async function linkSites(a, b) {
    if (!a.grid || !b.grid) { status('Analyze both sites first', 'error'); return; }
    if (!a.grading) a.grading = newGrading();
    if (!b.grading) b.grading = newGrading();
    var gid = (a.grading.group && SA.groups[a.grading.group]) ? a.grading.group : (b.grading.group && SA.groups[b.grading.group]) ? b.grading.group : null;
    if (!gid) { gid = 'g' + (++groupSeq); SA.groups[gid] = newGroup(gid); }
    [a.grading.group, b.grading.group].forEach(function(old) {
      if (!old || old === gid) return;
      SA.sites.forEach(function(s) { if (s.grading && s.grading.group === old) s.grading.group = gid; });
      dropGroup(old);
    });
    a.grading.group = gid; b.grading.group = gid;
    a.grading.applied = b.grading.applied = true;
    await computeGroup(gid);
  }

  // quiet: the caller redraws (grading removed right after)
  function unlinkSite(site, quiet) {
    var gid = site.grading && site.grading.group;
    if (!gid) return;
    site.grading.group = null;
    var rest = groupMembers(gid);
    if (rest.length < 2) {
      rest.forEach(function(s) { s.grading.group = null; });
      dropGroup(gid);
      rest.forEach(function(s) { if (s.grading.result) drawGrading(s); });
      if (!quiet && site.grading.result) drawGrading(site);
      updateTerrain();
      refreshProfileGrading();
      renderSites();
      requestRender();
    } else {
      if (!quiet && site.grading.result) drawGrading(site);
      computeGroup(gid);
    }
  }

  function groupParams(members) {
    return members.map(function(s) { return { nC: s.grading.slopeCut, nF: s.grading.slopeFill }; });
  }

  // Graded height of group cell k; lv = planum level per terrace (shift included)
  function groupCell(gg, k, lv, prm) {
    var T = gg.T[k], L = -Infinity, U = Infinity;
    for (var m = 0; m < lv.length; m++) {
      var d = gg.D[m][k];
      if (!(d <= gg.W)) continue;
      var P = lv[m] + (gg.O[m] ? gg.O[m][k] : 0);
      if (d === 0) return P;
      L = Math.max(L, P - d / prm[m].nF);
      U = Math.min(U, P + d / prm[m].nC);
    }
    if (L === -Infinity) return T;
    return Math.min(Math.max(T, L), U);
  }

  // slopeExcess for a group cell: the highest fill cone and the lowest cut cone
  function groupExcess(gg, k, lv, prm) {
    var T = gg.T[k], L = -Infinity, U = Infinity;
    for (var m = 0; m < lv.length; m++) {
      var d = gg.D[m][k];
      if (!(d <= gg.W)) continue;
      var P = lv[m] + (gg.O[m] ? gg.O[m][k] : 0);
      L = Math.max(L, P - d / prm[m].nF);
      U = Math.min(U, P + d / prm[m].nC);
    }
    if (L === -Infinity) return -1000;
    return Math.max(T - U, L - T);
  }

  function groupBand(members) {
    var lo = Infinity, hi = -Infinity, ratio = 0, cell = 0;
    members.forEach(function(s) {
      var st = s.grid.stats, r = s.grading.result;
      lo = Math.min(lo, st.min, r.pMin); hi = Math.max(hi, st.max, r.pMax);
      ratio = Math.max(ratio, s.grading.slopeCut, s.grading.slopeFill);
      cell = Math.max(cell, s.grid.cell);
    });
    return Math.min(GRADING_MAX_BAND, (hi - lo + 2) * ratio + 2 * cell);
  }

  // What the group grid depends on (levels and slope ratios only move R)
  function groupKey(members) {
    return members.map(function(s) {
      var gr = s.grading;
      return [s.id, Number(gr.gradient) || 0, Number(gr.bearing) || 0, s.grid.cell, s.grid.sourceKey].join(':');
    }).join('|') + '|' + Math.round(groupBand(members));
  }

  async function sampleGroupGrid(members, job) {
    var all = [];
    members.forEach(function(s) { all = all.concat(s.ring); });
    var fg = frame(all);
    var rings = members.map(function(s) { return s.ring.map(function(p) { return fg.toLocal(p[0], p[1]); }); });
    var cell = Math.max.apply(null, members.map(function(s) { return s.grid.cell; }));
    var W = groupBand(members);
    var plan = planGrid({ local: [].concat.apply([], rings) }, cell, W);
    if (!plan) throw new Error('The terrace group is too large');
    var n = plan.nx * plan.ny, M = members.length;
    var offs = members.map(function(s) { return planumOffsetFn(s.grading); });
    var D = members.map(function() { return new Float32Array(n).fill(Infinity); });
    var O = offs.map(function(f) { return f ? new Float32Array(n) : null; });
    var idx = [], lons = [], lats = [];
    for (var k = 0; k < n; k++) {
      var i = k % plan.nx, j = (k - i) / plan.nx, x = cellX(plan, i), y = cellY(plan, j), any = false;
      for (var m = 0; m < M; m++) {
        var near = polyNearest(x, y, rings[m]);
        if (near[0] > W) continue;
        D[m][k] = near[0];
        any = true;
        if (O[m]) {
          var deg = fg.toDeg(near[1], near[2]), loc = members[m].frame.toLocal(deg[0], deg[1]);
          O[m][k] = offs[m](loc[0], loc[1]);
        }
      }
      if (!any) continue;
      var dd = fg.toDeg(x, y);
      idx.push(k); lons.push(dd[0]); lats.push(dd[1]);
    }
    var first = members[0].grid;
    var res = await sampleHeights(lons, lats, job, 'terrace group', first.sourceKey);
    var T = new Float32Array(n).fill(NaN), need = new Uint8Array(n);
    for (k = 0; k < idx.length; k++) { T[idx[k]] = res.heights[k]; need[idx[k]] = 1; }
    if (!fillGaps(T, need, plan.nx, plan.ny)) throw new Error('No height data for the terrace group');
    var west = fg.lon0 + plan.x0 / fg.m.lon, north = fg.lat0 + plan.yTop / fg.m.lat;
    return {
      nx: plan.nx, ny: plan.ny, cell: plan.cell, coarsened: plan.coarsened, x0: plan.x0, yTop: plan.yTop, W: W,
      frame: fg, rings: rings, west: west, east: west + plan.nx * plan.cell / fg.m.lon,
      north: north, south: north - plan.ny * plan.cell / fg.m.lat,
      T: T, D: D, O: O, need: need, sourceKey: first.sourceKey, datum: first.datum, source: first.source
    };
  }

  function groupVolumes(gg, lv, prm) {
    var a = gg.cell * gg.cell, r = { cut: 0, fill: 0, cutPlanum: 0, fillPlanum: 0, affected: 0, conflict: 0, bandHit: false };
    var edge = gg.W - 1.5 * gg.cell, M = lv.length;
    for (var k = 0; k < gg.T.length; k++) {
      if (!gg.need[k] || !isFinite(gg.T[k])) continue;
      var R = groupCell(gg, k, lv, prm), diff = gg.T[k] - R, inside = false, dmin = Infinity, L = -Infinity, U = Infinity;
      for (var m = 0; m < M; m++) {
        var d = gg.D[m][k];
        if (d === 0) inside = true;
        if (!(d <= gg.W)) continue;
        dmin = Math.min(dmin, d);
        var P = lv[m] + (gg.O[m] ? gg.O[m][k] : 0);
        L = Math.max(L, P - d / prm[m].nF); U = Math.min(U, P + d / prm[m].nC);
      }
      if (diff > 0) { r.cut += diff * a; if (inside) r.cutPlanum += diff * a; }
      else if (diff < 0) { r.fill -= diff * a; if (inside) r.fillPlanum -= diff * a; }
      if (Math.abs(diff) > CUT_EPS || inside) r.affected++;
      if (!inside && L > U + 0.05) r.conflict++;
      if (dmin >= edge && Math.abs(diff) > CUT_EPS) r.bandHit = true;
    }
    r.affectedM2 = r.affected * a;
    r.conflictM2 = r.conflict * a;
    r.net = r.cut - r.fill;
    return r;
  }

  function evaluateGroup(g, members) {
    var gg = g.grid, prm = groupParams(members);
    var base = members.map(function(s) { return s.grading.result.t; });
    var shift = 0;
    if (g.balance) {
      var tlo = Infinity, thi = -Infinity;
      for (var k = 0; k < gg.T.length; k++) if (gg.need[k]) { tlo = Math.min(tlo, gg.T[k]); thi = Math.max(thi, gg.T[k]); }
      var lo = tlo - Math.max.apply(null, base) - 5, hi = thi - Math.min.apply(null, base) + 5;
      for (var it = 0; it < 50; it++) {
        var mid = (lo + hi) / 2, v = groupVolumes(gg, base.map(function(t) { return t + mid; }), prm);
        if (v.cut > v.fill) lo = mid; else hi = mid;    // a higher shift means more fill
      }
      shift = (lo + hi) / 2;
    }
    var lv = base.map(function(t) { return t + shift; });
    var r = groupVolumes(gg, lv, prm);
    r.shift = shift;
    r.levels = lv;
    r.ids = members.map(function(s) { return s.id; });
    r.cutSlopes = r.cut - r.cutPlanum;
    r.fillSlopes = r.fill - r.fillPlanum;
    r.N = members[0].grading.result.N || 0;
    return r;
  }

  async function computeGroup(gid) {
    var g = SA.groups[gid], members = groupMembers(gid);
    if (!g || members.length < 2) return;
    if (members.some(function(s) { return !s.grid; })) { status('Analyze every terrace first', 'error'); return; }
    // every terrace needs its own planum level first
    for (var i = 0; i < members.length; i++) {
      if (!members[i].grading.result) {
        await computeGrading(members[i], true);
        if (!members[i].grading.result) return;
      }
    }
    var key = groupKey(members);
    if (!g.grid || g.grid.key !== key) {
      var job = startJob();
      if (!job) return;
      try {
        g.grid = await sampleGroupGrid(members, job);
        g.grid.key = key;
      } catch (err) {
        if (err && err.message === 'cancelled') status('Cancelled', '');
        else { console.error('Terrace group failed:', err); status(err.message || String(err), 'error'); }
        g.grid = null;
        return;
      } finally {
        endJob();
      }
    }
    g.result = evaluateGroup(g, members);
    members.forEach(clearGradingEntities);
    clearGroupEntities(g);
    drawSurface(g, gradingUnit(members[0]), members.some(function(s) { return s.grading.depth; }));
    updateTerrain();
    refreshProfileGrading();
    status('Terraces ' + groupName(g) + ': cut ' + num(g.result.cut) + ' m³, fill ' + num(g.result.fill) + ' m³' +
      (g.balance ? ' (common shift ' + (g.result.shift >= 0 ? '+' : '') + num(g.result.shift, 2) + ' m)' : ''), 'ok');
    renderSites();
    requestRender();
  }

  // One grading as the exports, drawing and terrain see it: a single site or
  // the group the site belongs to
  function gradingUnit(site) {
    var g = groupOf(site);
    if (g && g.grid && g.result) {
      var members = groupMembers(g.id), prm = groupParams(members), gg = g.grid, r = g.result, lv = r.levels;
      return {
        site: { name: groupName(g), frame: gg.frame, grid: { datum: gg.datum, source: gg.source } },
        gg: gg, t: lv[0], cut: r.cut, fill: r.fill,
        R: function(k) { return groupCell(gg, k, lv, prm); },
        excess: function(k) { return groupExcess(gg, k, lv, prm); },
        planum: function(k) { for (var m = 0; m < gg.D.length; m++) if (gg.D[m][k] === 0) return true; return false; },
        inBand: function(k) { return !!gg.need[k] && isFinite(gg.T[k]); },
        desc: 'Terraces ' + members.map(function(s, m) {
          var gr = s.grading;
          return s.name + ' ' + lv[m].toFixed(2) + ' m' + (gr.gradient ? ' (' + gr.gradient + ' % to ' + gr.bearing + ' deg)' : '') + ' slopes 1:' + gr.slopeCut + '/1:' + gr.slopeFill;
        }).join('; ') + ', cut ' + r.cut.toFixed(1) + ' m3, fill ' + r.fill.toFixed(1) + ' m3',
        extras: {
          terraces: members.map(function(s, m) {
            var gr = s.grading;
            return { site: s.name, planumLevel: Number(lv[m].toFixed(3)), slopeCut: gr.slopeCut, slopeFill: gr.slopeFill,
                     gradientPercent: Number(gr.gradient) || 0, gradientBearingDeg: Number(gr.gradient) ? Number(gr.bearing) || 0 : 0 };
          }),
          commonShift: Number(r.shift.toFixed(3)), cutM3: Number(r.cut.toFixed(1)), fillM3: Number(r.fill.toFixed(1))
        }
      };
    }
    var gr = site.grading, gs = gr.grid, rs = gr.result;
    return {
      site: site, gg: gs, t: rs.t, cut: rs.cut, fill: rs.fill,
      R: function(k) { return gradeCell(gs, k, rs.t, gr.slopeCut, gr.slopeFill); },
      excess: function(k) { return slopeExcess(gs.T[k], gs.D[k], gs.O ? rs.t + gs.O[k] : rs.t, gr.slopeCut, gr.slopeFill); },
      planum: function(k) { return gs.D[k] === 0; },
      inBand: function(k) { return gs.D[k] <= gs.W && isFinite(gs.T[k]); },
      desc: 'Planum ' + rs.t.toFixed(2) + ' m' + (gr.gradient ? ' at the site centre, gradient ' + gr.gradient + ' % towards ' + gr.bearing + ' deg' : '') +
        ', slopes cut 1:' + gr.slopeCut + ' fill 1:' + gr.slopeFill + ', cut ' + rs.cut.toFixed(1) + ' m3, fill ' + rs.fill.toFixed(1) + ' m3',
      extras: {
        planumLevel: Number(rs.t.toFixed(3)), slopeCut: gr.slopeCut, slopeFill: gr.slopeFill,
        gradientPercent: Number(gr.gradient) || 0, gradientBearingDeg: Number(gr.gradient) ? Number(gr.bearing) || 0 : 0,
        cutM3: Number(rs.cut.toFixed(1)), fillM3: Number(rs.fill.toFixed(1))
      }
    };
  }

  // ---- Terrain: wrap the active heightmap provider ----

  var currentWrapper = null;
  var installing = false;
  var terrainListener = false;

  function activeGradings() {
    return SA.sites.filter(function(s) { return s.grading && s.grading.applied && s.grading.result; });
  }

  // 'ok' | 'google' | 'quantized' | 'none'
  function terrainSupport() {
    var v = viewer();
    if (!v) return 'none';
    if (BimViewer.googleTiles && BimViewer.googleTiles.enabled) return 'google';
    var base = baseTerrainProvider();
    if (!base || base instanceof Cesium.EllipsoidTerrainProvider) return 'none';
    if (base instanceof Cesium.CesiumTerrainProvider) return 'quantized';
    return 'ok';
  }

  // One item per applied grading (a site, or a terrace group once):
  // heightAt(lon, lat, T) gives the graded orthometric height for existing T
  function gradingItems() {
    var items = [], done = {};
    activeGradings().forEach(function(site) {
      var g = groupOf(site);
      if (g) {
        if (done[g.id] || !g.result) return;
        done[g.id] = true;
        items.push(groupItem(g));
      } else {
        items.push(siteItem(site));
      }
    });
    return items;
  }

  function siteItem(site) {
    var gr = site.grading, gg = gr.grid, r = gr.result, off = planumOffsetFn(gr), fr = site.frame;
    return {
      N: r.N || 0,
      rect: Cesium.Rectangle.fromDegrees(gg.west, gg.south, gg.east, gg.north),
      heightAt: function(lon, lat, T) {
        var loc = fr.toLocal(lon, lat);
        var near = off ? polyNearest(loc[0], loc[1], site.local) : null;
        var d = near ? near[0] : polyDist(loc[0], loc[1], site.local);
        if (d > gg.W) return T;
        return gradeHeight(T, d, near ? r.t + off(near[1], near[2]) : r.t, gr.slopeCut, gr.slopeFill);
      }
    };
  }

  function groupItem(g) {
    var members = groupMembers(g.id), gg = g.grid, fr = gg.frame, lv = g.result.levels, prm = groupParams(members);
    var offs = members.map(function(s) { return planumOffsetFn(s.grading); });
    return {
      N: g.result.N,
      rect: Cesium.Rectangle.fromDegrees(gg.west, gg.south, gg.east, gg.north),
      heightAt: function(lon, lat, T) {
        var loc = fr.toLocal(lon, lat), L = -Infinity, U = Infinity;
        for (var m = 0; m < members.length; m++) {
          var near = polyNearest(loc[0], loc[1], gg.rings[m]);
          if (near[0] > gg.W) continue;
          var P = lv[m];
          if (offs[m]) { var deg = fr.toDeg(near[1], near[2]), ml = members[m].frame.toLocal(deg[0], deg[1]); P += offs[m](ml[0], ml[1]); }
          if (near[0] === 0) return P;
          L = Math.max(L, P - near[0] / prm[m].nF);
          U = Math.min(U, P + near[0] / prm[m].nC);
        }
        if (L === -Infinity) return T;
        return Math.min(Math.max(T, L), U);
      }
    };
  }

  // Heights of a heightmap tile with the gradings applied (ellipsoidal in and out)
  function gradeTile(data, rect, mercator, items) {
    var st = data._structure || {};
    if ((st.heightScale || 1) !== 1 || (st.heightOffset || 0) !== 0 || (st.elementsPerHeight || 1) !== 1) return data;
    var w = data._width, h = data._height, out = new Float32Array(data._buffer), changed = false;
    var north = mercator ? Cesium.WebMercatorProjection.geodeticLatitudeToMercatorAngle(rect.north) : rect.north;
    var south = mercator ? Cesium.WebMercatorProjection.geodeticLatitudeToMercatorAngle(rect.south) : rect.south;
    for (var row = 0; row < h; row++) {
      var tt = north + (south - north) * row / (h - 1);
      var lat = Cesium.Math.toDegrees(mercator ? Cesium.WebMercatorProjection.mercatorAngleToGeodeticLatitude(tt) : tt);
      for (var col = 0; col < w; col++) {
        var lon = Cesium.Math.toDegrees(rect.west + (rect.east - rect.west) * col / (w - 1));
        var i = row * w + col;
        for (var q = 0; q < items.length; q++) {
          var it = items[q], T = out[i] - it.N, R = it.heightAt(lon, lat, T);
          if (R !== T) { out[i] = R + it.N; changed = true; }
        }
      }
    }
    if (!changed) return data;
    return new Cesium.HeightmapTerrainData({
      buffer: out, width: w, height: h,
      childTileMask: data._childTileMask, waterMask: data._waterMask, structure: data._structure
    });
  }

  function wrapProvider(base) {
    var ts = base.tilingScheme, mercator = ts instanceof Cesium.WebMercatorTilingScheme;
    var items = gradingItems();
    var wrapped = Object.create(base);
    wrapped._saBase = base;
    wrapped._saGraded = true;
    wrapped.requestTileGeometry = function(x, y, level, request) {
      var promise = base.requestTileGeometry(x, y, level, request);
      if (!promise) return promise;
      var rect = ts.tileXYToRectangle(x, y, level);
      var hits = items.filter(function(it) { return !!Cesium.Rectangle.intersection(rect, it.rect, new Cesium.Rectangle()); });
      if (!hits.length) return promise;
      return promise.then(function(data) {
        if (!(data instanceof Cesium.HeightmapTerrainData) || !data._buffer) return data;
        return gradeTile(data, rect, mercator, hits);
      });
    };
    return wrapped;
  }

  // Puts the gradings onto the terrain (new provider object → tiles reload)
  function updateTerrain() {
    var v = viewer();
    if (!v) return;
    if (!terrainListener) {
      terrainListener = true;
      // Someone else switched the terrain (Layers, scene, Google 3D Tiles off):
      // wrap the new provider again, or drop a stale wrapper
      v.scene.globe.terrainProviderChanged.addEventListener(function(p) {
        if (installing) return;
        if ((p && p._saGraded && p !== currentWrapper) || (activeGradings().length && !(p && p._saGraded))) {
          setTimeout(updateTerrain, 0);
        }
        setTimeout(renderSites, 0);
      });
    }
    var cur = v.terrainProvider, base = cur && cur._saBase ? cur._saBase : cur;
    var sites = terrainSupport() === 'ok' ? activeGradings() : [];
    installing = true;
    try {
      if (!sites.length) {
        currentWrapper = null;
        if (cur !== base) v.terrainProvider = base;
      } else {
        currentWrapper = wrapProvider(base);
        v.terrainProvider = currentWrapper;
      }
    } finally {
      installing = false;
    }
    requestRender();
  }

  // ---- Profile: graded line next to the existing one ----

  function gradedProfileHeights(p) {
    var items = gradingItems();
    if (!items.length) return null;
    var out = p.heights.slice(), any = false;
    for (var i = 0; i < out.length; i++) {
      items.forEach(function(it) {
        var R = it.heightAt(p.lons[i], p.lats[i], out[i]);
        if (Math.abs(R - out[i]) > 1e-3) { out[i] = R; any = true; }
      });
    }
    return any ? out : null;
  }

  function refreshProfileGrading() {
    if (!SA.profile) return;
    SA.profile.graded = gradedProfileHeights(SA.profile);
    if (profilePanel && profilePanel.classList.contains('visible')) renderProfile();
  }

  // ---- Exports: LandXML surface, GLB ----

  // Grid cells of the mesh: changed area + planum, one cell around
  function gradingMeshMask(u) {
    var gg = u.gg, n = gg.T.length, nx = gg.nx, ny = gg.ny;
    var core = new Uint8Array(n), mask = new Uint8Array(n);
    for (var k = 0; k < n; k++) {
      if (!u.inBand(k)) continue;
      if (Math.abs(gg.T[k] - u.R(k)) > CUT_EPS || u.planum(k)) core[k] = 1;
    }
    for (k = 0; k < n; k++) {
      if (!core[k]) continue;
      var i = k % nx, j = (k - i) / nx;
      for (var dj = -1; dj <= 1; dj++) for (var di = -1; di <= 1; di++) {
        var ii = i + di, jj = j + dj, m = jj * nx + ii;
        if (ii >= 0 && jj >= 0 && ii < nx && jj < ny && u.inBand(m)) mask[m] = 1;
      }
    }
    return mask;
  }

  // Vertices (one per masked cell) and triangles (two per fully masked square)
  function gradingMesh(u) {
    var gg = u.gg, nx = gg.nx, ny = gg.ny;
    var mask = gradingMeshMask(u), index = new Int32Array(gg.T.length).fill(-1);
    var verts = [];
    for (var k = 0; k < mask.length; k++) {
      if (!mask[k]) continue;
      var i = k % nx, j = (k - i) / nx;
      index[k] = verts.length;
      verts.push({ x: cellX(gg, i), y: cellY(gg, j), T: gg.T[k], R: u.R(k), planum: u.planum(k) });
    }
    var tris = [];
    for (var jj = 0; jj < ny - 1; jj++) {
      for (var ii = 0; ii < nx - 1; ii++) {
        var a = index[jj * nx + ii], b = index[jj * nx + ii + 1], c = index[(jj + 1) * nx + ii], d = index[(jj + 1) * nx + ii + 1];
        if (a < 0 || b < 0 || c < 0 || d < 0) continue;
        // counter-clockwise seen from above (x east, y north; row j+1 is south)
        tris.push(a, c, b, b, c, d);
      }
    }
    return { verts: verts, tris: tris };
  }

  async function utmProjector(site) {
    if (!window.GEOBIM_PROJ) throw new Error('Projected coordinates are not available');
    var u = await GEOBIM_PROJ.utmFromWGS84(site.frame.lat0, site.frame.lon0);
    if (!u || !window.proj4) throw new Error('No UTM zone for this site');
    var def = '+proj=utm +zone=' + u.zone + (u.south ? ' +south' : '') + ' +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
    return {
      info: u,
      name: u.datum + ' / UTM zone ' + u.zone + (u.south ? 'S' : 'N'),
      en: function(x, y) { var d = site.frame.toDeg(x, y); return proj4('WGS84', def, [d[0], d[1]]); }
    };
  }

  function xmlEsc(s) { return esc(s).replace(/'/g, '&apos;'); }

  async function exportLandXml(site0) {
    if (!site0.grading || !site0.grading.result) return;
    var u = gradingUnit(site0), site = u.site;
    status('Preparing LandXML…', '');
    var proj = await utmProjector(site), mesh = gradingMesh(u);
    var now = new Date(), date = now.toISOString().slice(0, 10), time = now.toISOString().slice(11, 19);
    var en = mesh.verts.map(function(v) { return proj.en(v.x, v.y); });
    function surface(name, desc, key) {
      var out = ['    <Surface name="' + xmlEsc(name) + '" desc="' + xmlEsc(desc) + '">',
                 '      <Definition surfType="TIN">', '        <Pnts>'];
      mesh.verts.forEach(function(v, i) {
        out.push('          <P id="' + (i + 1) + '">' + en[i][1].toFixed(3) + ' ' + en[i][0].toFixed(3) + ' ' + v[key].toFixed(3) + '</P>');
      });
      out.push('        </Pnts>', '        <Faces>');
      for (var t = 0; t < mesh.tris.length; t += 3) {
        out.push('          <F>' + (mesh.tris[t] + 1) + ' ' + (mesh.tris[t + 1] + 1) + ' ' + (mesh.tris[t + 2] + 1) + '</F>');
      }
      out.push('        </Faces>', '      </Definition>', '    </Surface>');
      return out.join('\n');
    }
    var g = site.grid, desc = u.desc + '; heights ' + g.datum + '; source ' + g.source;
    var xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="' + date + '" time="' + time + '">',
      '  <Units><Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="milliBars" angularUnit="decimal degrees" directionUnit="decimal degrees"/></Units>',
      '  <CoordinateSystem epsgCode="' + proj.info.epsg + '" name="' + xmlEsc(proj.name) + '" horizontalDatum="' + xmlEsc(proj.info.datum) + '" desc="Heights: ' + xmlEsc(g.datum) + '"/>',
      '  <Application name="geoBIM.app" manufacturer="geoBIM.app" desc="Site analysis — grading"/>',
      '  <Surfaces>',
      surface(site.name + ' graded', desc, 'R'),
      surface(site.name + ' existing', 'Existing terrain over the same area; ' + g.source, 'T'),
      '  </Surfaces>',
      '</LandXML>'
    ].join('\n');
    download(fileBase(site) + '-grading.xml', xml, 'application/xml');
    status('LandXML: ' + num(mesh.verts.length) + ' points, ' + num(mesh.tris.length / 3) + ' triangles, EPSG:' + proj.info.epsg, 'ok');
  }

  // Binary glTF: graded surface in local metres (origin = site centre on the
  // planum level; X east, Y up, Z south), vertex colours planum / cut / fill
  async function exportGlb(site0) {
    if (!site0.grading || !site0.grading.result) return;
    var u = gradingUnit(site0), site = u.site;
    var mesh = gradingMesh(u), r = { t: u.t }, nv = mesh.verts.length;
    if (!nv || !mesh.tris.length) { status('Nothing to export', 'error'); return; }
    var utm = null;
    try { utm = (await utmProjector(site)).info; } catch (e) { /* origin in WGS84 only */ }
    var p = palette(), planum = rgb(cssVar('--sa-planum', '#b9b2a3'));
    var pos = new Float32Array(nv * 3), col = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
    var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    mesh.verts.forEach(function(v, i) {
      var xyz = [v.x, v.R - r.t, -v.y];
      for (var a = 0; a < 3; a++) { pos[i * 3 + a] = xyz[a]; min[a] = Math.min(min[a], xyz[a]); max[a] = Math.max(max[a], xyz[a]); }
      var diff = v.T - v.R, c = v.planum ? planum : (diff > CUT_EPS ? p.cut : (diff < -CUT_EPS ? p.fill : p.grade));
      for (a = 0; a < 3; a++) col[i * 3 + a] = Math.pow(c[a] / 255, 2.2);   // linear colour space
    });
    // The map winding (counter-clockwise from above) stays counter-clockwise
    // seen from +Y with Z = −north, so the triangles face up as they are
    var idx = new Uint32Array(mesh.tris);
    for (var t = 0; t < idx.length; t += 3) {
      var ia = idx[t] * 3, ib = idx[t + 1] * 3, ic = idx[t + 2] * 3;
      var ux = pos[ib] - pos[ia], uy = pos[ib + 1] - pos[ia + 1], uz = pos[ib + 2] - pos[ia + 2];
      var vx = pos[ic] - pos[ia], vy = pos[ic + 1] - pos[ia + 1], vz = pos[ic + 2] - pos[ia + 2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;   // u × v
      [ia, ib, ic].forEach(function(o) { nor[o] += nx; nor[o + 1] += ny; nor[o + 2] += nz; });
    }
    for (var i = 0; i < nv; i++) {
      var l = Math.hypot(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]) || 1;
      nor[i * 3] /= l; nor[i * 3 + 1] /= l; nor[i * 3 + 2] /= l;
    }

    var views = [pos, nor, col, idx], offsets = [], total = 0;
    views.forEach(function(a) { offsets.push(total); total += a.byteLength; total = (total + 3) & ~3; });
    var bin = new Uint8Array(total);
    views.forEach(function(a, n) { bin.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), offsets[n]); });
    var gltf = {
      asset: {
        version: '2.0', generator: 'geoBIM.app site analysis',
        extras: { geobim: Object.assign({
          site: site.name, upAxis: 'Y', axes: 'X east, Y up, Z south (local metres)',
          origin: { longitude: site.frame.lon0, latitude: site.frame.lat0, height: Number(r.t.toFixed(3)), heightDatum: site.grid.datum },
          utm: utm ? { epsg: utm.epsg, easting: Number(utm.easting.toFixed(3)), northing: Number(utm.northing.toFixed(3)) } : null
        }, u.extras) }
      },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: site.name + ' graded' }],
      meshes: [{ name: site.name + ' graded', primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0 }] }],
      materials: [{ name: 'Graded terrain', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } }],
      buffers: [{ byteLength: total }],
      bufferViews: [
        { buffer: 0, byteOffset: offsets[0], byteLength: pos.byteLength, target: 34962 },
        { buffer: 0, byteOffset: offsets[1], byteLength: nor.byteLength, target: 34962 },
        { buffer: 0, byteOffset: offsets[2], byteLength: col.byteLength, target: 34962 },
        { buffer: 0, byteOffset: offsets[3], byteLength: idx.byteLength, target: 34963 }
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: nv, type: 'VEC3', min: min, max: max },
        { bufferView: 1, componentType: 5126, count: nv, type: 'VEC3' },
        { bufferView: 2, componentType: 5126, count: nv, type: 'VEC3' },
        { bufferView: 3, componentType: 5125, count: idx.length, type: 'SCALAR' }
      ]
    };
    var json = new TextEncoder().encode(JSON.stringify(gltf));
    var jsonLen = (json.length + 3) & ~3;
    var glb = new ArrayBuffer(12 + 8 + jsonLen + 8 + total), dv = new DataView(glb), u8 = new Uint8Array(glb);
    dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, glb.byteLength, true);
    dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4E4F534A, true);
    u8.set(json, 20);
    for (var s = json.length; s < jsonLen; s++) u8[20 + s] = 0x20;
    dv.setUint32(20 + jsonLen, total, true); dv.setUint32(24 + jsonLen, 0x004E4942, true);
    u8.set(bin, 28 + jsonLen);
    download(fileBase(site) + '-grading_' + site.frame.lon0.toFixed(6) + '_' + site.frame.lat0.toFixed(6) + '_' + r.t.toFixed(2) + 'm.glb',
             new Blob([glb], { type: 'model/gltf-binary' }), 'model/gltf-binary');
    status('GLB: ' + num(nv) + ' vertices, ' + num(idx.length / 3) + ' triangles', 'ok');
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

  // opts: { source, exaggeration } (scene restore)
  async function runProfile(ptsDeg, opts) {
    opts = opts || {};
    var sourceKey = opts.source || SA.settings.source;
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
      var res = await sampleHeights(lons, lats, job, 'Profile', sourceKey);
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
        source: res.source, datum: res.datum, N: N.n, sourceKey: sourceKey,
        exaggeration: opts.exaggeration || 'auto', entities: []
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
      SA.profile.graded = gradedProfileHeights(SA.profile);
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
    var lo = p.stats.min, hi = p.stats.max;
    if (p.graded) {
      lo = Math.min(lo, Math.min.apply(null, p.graded));
      hi = Math.max(hi, Math.max.apply(null, p.graded));
    }
    var span = Math.max(0.5, hi - lo);
    var yRange = span * 1.1, ex;
    if (p.exaggeration !== 'auto') {
      var wanted = Number(p.exaggeration);
      yRange = Math.max(yRange, ph / (sx * wanted));
    }
    var mid = (hi + lo) / 2;
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
    svgEl('path', { d: d, class: 'sa-chart-line' + (p.graded ? ' sa-chart-line-existing' : '') }, svg);
    if (p.graded) {
      var dg = '';
      for (var gi = 0; gi < p.graded.length; gi++) {
        dg += (gi ? 'L' : 'M') + X(p.stations[gi]).toFixed(1) + ',' + Y(p.graded[gi]).toFixed(1);
      }
      svgEl('path', { d: dg, class: 'sa-chart-line-graded' }, svg);
    }
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
      (p.graded ? '<span class="sa-profile-legend"><span class="sa-key sa-key-existing"></span>existing <span class="sa-key sa-key-graded"></span>graded</span>' : '') +
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
      byId('saProfileReadout').textContent = 'Station ' + num(p.stations[i], 1) + ' m · height ' + num(p.heights[i], 2) + ' m' +
        (p.graded && Math.abs(p.graded[i] - p.heights[i]) > 1e-3 ? ' · graded ' + num(p.graded[i], 2) + ' m (' + (p.graded[i] > p.heights[i] ? 'fill ' : 'cut ') + num(Math.abs(p.graded[i] - p.heights[i]), 2) + ' m)' : '');
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
    var rows = [['Station (m)', 'Height (m)'].concat(p.graded ? ['Graded (m)'] : [], ['Longitude', 'Latitude'])];
    for (var i = 0; i < p.heights.length; i++) {
      rows.push([csvNum(p.stations[i], 2), csvNum(p.heights[i], 3)].concat(p.graded ? [csvNum(p.graded[i], 3)] : [],
                [csvNum(p.lons[i], 7), csvNum(p.lats[i], 7)]));
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
      '.sa-chart-line{fill:none;stroke:#1a8f7a;stroke-width:2}' +
      '.sa-chart-line-existing{stroke:#7a7a7a;stroke-dasharray:5 4}' +
      '.sa-chart-line-graded{fill:none;stroke:#1a8f7a;stroke-width:2.5}';
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

  var SUPPORT_TEXT = {
    google: 'Google 3D Tiles are shown: the graded terrain is under them. Switch them off in Layers to see it.',
    quantized: 'This terrain (Cesium World Terrain) cannot be changed in the browser — switch to Mapterhorn or ArcGIS terrain.',
    none: 'No terrain loaded — switch to Mapterhorn terrain to see the grading.'
  };

  function gradingBlock(site) {
    var gr = site.grading, sid = site.id, busy = !!SA.job, r = gr && gr.result;
    var on = !!(gr && gr.applied && r);
    var html = '<div class="sa-layer">' +
      '<button type="button" class="sa-layer-toggle' + (on ? ' sa-on' : '') + '" data-sa="grading" data-site="' + sid + '" aria-pressed="' + on + '"' +
        ' title="' + (r ? (on ? 'Remove the planum from the terrain' : 'Apply the planum to the terrain') : 'Model a level planum with slopes') + '"' + (busy ? ' disabled' : '') + '>' +
        '<i data-lucide="' + (r ? (on ? 'eye' : 'eye-off') : 'shovel') + '"></i><span>Grading (planum + slopes)</span></button>' +
      (r ? iconBtn('grading-landxml', site, null, 'file-code', 'Export LandXML surface') +
           iconBtn('grading-glb', site, null, 'box', 'Export GLB model') +
           iconBtn('grading-remove', site, null, 'x', 'Remove grading') : '') +
      '</div>';
    if (!gr) return html;
    html += '<div class="sa-grading">' +
      '<div class="sa-field-row">' +
        '<label class="modern-label-small" for="saGrMode' + sid + '">Planum</label>' +
        '<select id="saGrMode' + sid + '" class="modern-select sa-select-small" data-sa-input="gr-mode" data-site="' + sid + '">' +
          '<option value="balanced"' + (gr.levelMode === 'balanced' ? ' selected' : '') + '>Balanced incl. slopes</option>' +
          '<option value="fixed"' + (gr.levelMode === 'fixed' ? ' selected' : '') + '>Fixed level</option>' +
        '</select>' +
        '<input type="number" step="0.01" class="modern-input sa-input-small" aria-label="Planum level (m)" title="Planum level (m)" value="' +
          (isFinite(gr.level) && gr.level !== null ? Number(gr.level).toFixed(2) : '') + '" data-sa-input="gr-level" data-site="' + sid + '"' +
          (gr.levelMode === 'balanced' ? ' disabled' : '') + '>' +
      '</div>' +
      '<div class="sa-field-row">' +
        '<span class="modern-label-small">Slopes</span>' +
        '<label class="sa-ratio">cut 1:<input type="number" step="0.1" min="0.3" max="10" class="modern-input sa-input-tiny" value="' + gr.slopeCut +
          '" data-sa-input="gr-cut" data-site="' + sid + '" aria-label="Cut slope 1:n"></label>' +
        '<label class="sa-ratio">fill 1:<input type="number" step="0.1" min="0.3" max="10" class="modern-input sa-input-tiny" value="' + gr.slopeFill +
          '" data-sa-input="gr-fill" data-site="' + sid + '" aria-label="Fill slope 1:n"></label>' +
      '</div>' +
      '<div class="sa-field-row">' +
        '<label class="modern-label-small" for="saGrGrad' + sid + '">Gradient</label>' +
        '<label class="sa-ratio"><input id="saGrGrad' + sid + '" type="number" step="0.1" min="0" max="15" class="modern-input sa-input-tiny" value="' + (Number(gr.gradient) || 0) +
          '" data-sa-input="gr-grad" data-site="' + sid + '" aria-label="Planum gradient in percent"> %</label>' +
        '<select class="modern-select sa-select-small" data-sa-input="gr-dir" data-site="' + sid + '" aria-label="Direction the planum falls towards"' + (Number(gr.gradient) ? '' : ' disabled') + '>' +
          ['terrain'].concat(Object.keys(COMPASS)).map(function(k) {
            return '<option value="' + k + '"' + (gr.dir === k ? ' selected' : '') + '>' + (k === 'terrain' ? 'along terrain' : 'falls to ' + k) + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +
      (Number(gr.gradient) && gr.dir === 'terrain' && gr.terrain
        ? '<div class="sa-hint">Falls to ' + bearingName(gr.bearing) + ' (' + gr.bearing + '°) like the terrain, which falls ' + num(gr.terrain.percent, 1) + ' % there</div>'
        : '');
    html += terraceBlock(site);
    var grp = groupOf(site);
    if (r && grp && grp.result) {
      var gres = grp.result, mi = gres.ids.indexOf(site.id);
      html += '<div class="sa-cf-sum">' +
        '<span>This terrace <b>' + num(gres.levels[mi], 2) + ' m</b>' + (Number(gr.gradient) ? ' at its centre' : '') + '</span>' +
        '<span class="sa-cf-cut"><span class="sa-sw sa-sw-cut"></span>Cut <b>' + num(gres.cut) + ' m³</b> <small>planums ' + num(gres.cutPlanum) + ' · slopes ' + num(gres.cutSlopes) + '</small></span>' +
        '<span class="sa-cf-fill"><span class="sa-sw sa-sw-fill"></span>Fill <b>' + num(gres.fill) + ' m³</b> <small>planums ' + num(gres.fillPlanum) + ' · slopes ' + num(gres.fillSlopes) + '</small></span>' +
        '<span>Net <b>' + num(gres.net) + ' m³</b></span>' +
        '<span>Changed area <b>' + num(gres.affectedM2 / 10000, 2) + ' ha</b></span>' +
        '</div>' +
        '<label class="sa-check"><input type="checkbox" data-sa-input="gr-depth" data-site="' + sid + '"' + (gr.depth ? ' checked' : '') + '> Depth raster (cut / fill)</label>';
      if (gres.conflictM2 > 0) html += '<div class="sa-warn"><i data-lucide="info"></i>Terraces too close for their slopes on ' + num(gres.conflictM2) + ' m² — the lower slope cuts into the upper one there</div>';
      if (gres.bandHit) html += '<div class="sa-warn"><i data-lucide="info"></i>Slopes reach beyond ' + num(grp.grid.W) + ' m — volumes are cut off there</div>';
    } else if (r) {
      html += '<div class="sa-cf-sum">' +
        (Number(gr.gradient)
          ? '<span>Planum <b>' + num(r.t, 2) + ' m</b> at the centre, <b>' + num(r.pMin, 2) + '–' + num(r.pMax, 2) + ' m</b></span>'
          : '<span>Planum <b>' + num(r.t, 2) + ' m</b></span>') +
        '<span class="sa-cf-cut"><span class="sa-sw sa-sw-cut"></span>Cut <b>' + num(r.cut) + ' m³</b> <small>planum ' + num(r.cutPlanum) + ' · slopes ' + num(r.cutSlopes) + '</small></span>' +
        '<span class="sa-cf-fill"><span class="sa-sw sa-sw-fill"></span>Fill <b>' + num(r.fill) + ' m³</b> <small>planum ' + num(r.fillPlanum) + ' · slopes ' + num(r.fillSlopes) + '</small></span>' +
        '<span>Net <b>' + num(r.net) + ' m³</b></span>' +
        '<span>Changed area <b>' + num(r.affectedM2 / 10000, 2) + ' ha</b></span>' +
        '<span>Slopes up to <b>' + num(r.maxWidth, 1) + ' m</b> wide</span>' +
        '</div>' +
        '<label class="sa-check"><input type="checkbox" data-sa-input="gr-depth" data-site="' + sid + '"' + (gr.depth ? ' checked' : '') + '> Depth raster (cut / fill)</label>';
      if (gr.grid.coarsened) html += '<div class="sa-warn"><i data-lucide="info"></i>Grading grid coarsened to ' + num(gr.grid.cell, 1) + ' m (max. ' + num(MAX_SAMPLES) + ' cells)</div>';
      if (r.bandHit) html += '<div class="sa-warn"><i data-lucide="info"></i>Slopes reach beyond ' + num(gr.grid.W) + ' m from the site — volumes are cut off there</div>';
      var support = terrainSupport();
      if (gr.applied && support !== 'ok') {
        html += '<div class="sa-warn"><i data-lucide="info"></i>' + SUPPORT_TEXT[support] + '</div>';
        if (support !== 'google' && window.LayerManager && LayerManager.switchTerrain) {
          html += '<button type="button" class="modern-btn modern-btn-small sa-full" data-sa="grading-mapterhorn"><i data-lucide="mountain"></i><span>Switch to Mapterhorn terrain</span></button>';
        }
      }
    }
    return html + '</div>';
  }

  // Link the grading of this site with another one into terrace groups
  function terraceBlock(site) {
    var gr = site.grading, sid = site.id, grp = groupOf(site);
    if (!gr || !gr.result) return '';
    if (grp) {
      return '<div class="sa-field-row sa-terraces">' +
          '<span class="modern-label-small">Terraces</span>' +
          '<span class="sa-terrace-names">' + esc(groupName(grp)) + '</span>' +
          '<button type="button" class="modern-btn modern-btn-small" data-sa="grading-unlink" data-site="' + sid + '" title="Grade this site on its own again">Unlink</button>' +
        '</div>' +
        '<label class="sa-check"><input type="checkbox" data-sa-input="gr-gbal" data-site="' + sid + '"' + (grp.balance ? ' checked' : '') + '> Balance all terraces (common shift' +
          (grp.result && grp.balance ? ' ' + (grp.result.shift >= 0 ? '+' : '') + num(grp.result.shift, 2) + ' m' : '') + ')</label>';
    }
    var others = SA.sites.filter(function(s) { return s !== site && s.grid; });
    if (!others.length) return '';
    return '<div class="sa-field-row sa-terraces">' +
        '<label class="modern-label-small" for="saGrLink' + sid + '">Terraces</label>' +
        '<select id="saGrLink' + sid + '" class="modern-select sa-select-small" data-sa-input="gr-link" data-site="' + sid + '">' +
          '<option value="">Link with…</option>' +
          others.map(function(s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; }).join('') +
        '</select>' +
      '</div>';
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

    html += gradingBlock(site);

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
      case 'site-analyze':
        // A new grid invalidates the grading band: sample it again afterwards
        if (site) analyzeSite(site).then(function() {
          if (site.grading && site.grid) { site.grading.grid = null; computeGrading(site); }
        });
        break;
      case 'grading':
        if (!site || !site.grid) break;
        if (!site.grading || !site.grading.result) { computeGrading(site); break; }
        var onNow = !site.grading.applied, grpT = groupOf(site);
        (grpT ? groupMembers(grpT.id) : [site]).forEach(function(s) { s.grading.applied = onNow; });
        updateTerrain();
        refreshProfileGrading();
        renderSites();
        break;
      case 'grading-remove': if (site) { removeGrading(site); renderSites(); requestRender(); } break;
      case 'grading-unlink': if (site) unlinkSite(site); break;
      case 'grading-landxml':
        if (site) exportLandXml(site).catch(function(err) { status(err.message || String(err), 'error'); });
        break;
      case 'grading-glb':
        if (site) exportGlb(site).catch(function(err) { status(err.message || String(err), 'error'); });
        break;
      case 'grading-mapterhorn':
        if (window.LayerManager && LayerManager.switchTerrain) LayerManager.switchTerrain('mapterhorn');
        break;
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
      } else if (kind.indexOf('gr-') === 0 && site.grading) {
        var gr = site.grading;
        if (kind === 'gr-mode') gr.levelMode = t.value === 'fixed' ? 'fixed' : 'balanced';
        else if (kind === 'gr-level') { var lv = Number(t.value); if (t.value === '' || !isFinite(lv)) return; gr.level = lv; }
        else if (kind === 'gr-grad') {
          var gp = Number(t.value);
          if (t.value === '' || !isFinite(gp) || gp < 0 || gp > 15) { status('Gradient between 0 and 15 %', 'error'); return; }
          gr.gradient = gp;
        } else if (kind === 'gr-dir') {
          gr.dir = t.value === 'terrain' || COMPASS[t.value] !== undefined ? t.value : 'terrain';
        } else if (kind === 'gr-cut' || kind === 'gr-fill') {
          var n = Number(t.value);
          if (!isFinite(n) || n < 0.3 || n > 10) { status('Slope ratio 1:n with n between 0.3 and 10', 'error'); return; }
          if (kind === 'gr-cut') gr.slopeCut = n; else gr.slopeFill = n;
        } else if (kind === 'gr-link') {
          var other = t.value ? findSite(t.value) : null;
          if (other) linkSites(site, other);
          return;
        } else if (kind === 'gr-gbal') {
          var gb = groupOf(site);
          if (gb) { gb.balance = t.checked; computeGroup(gb.id); }
          return;
        } else if (kind === 'gr-depth') {
          gr.depth = t.checked;
          var gd = groupOf(site);
          if (gd) { computeGroup(gd.id); return; }
          if (gr.result) drawGrading(site);
          renderSites();
          requestRender();
          return;
        }
        computeGrading(site);   // samples again only when the band has to grow
        return;
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

  // ===============================
  // STATE (scenes: site-analysis-scenes.js)
  // Sites, settings, layers and profile line as plain JSON. The height grids
  // are not stored (up to 250 000 values per site, Firestore documents end at
  // 1 MB): a restore samples again and recomputes, the stored "summary" only
  // documents the results at save time.
  // ===============================

  var STATE_VERSION = 1;
  var LAYER_NAMES = ['contours', 'slope', 'aspect', 'cutfill'];

  function round(n, d) { var f = Math.pow(10, d); return Math.round(n * f) / f; }

  function exportState() {
    if (!SA.sites.length && !SA.profile) return null;
    var sites = SA.sites.map(function(site) {
      var g = site.grid, layers = {};
      LAYER_NAMES.forEach(function(name) {
        var l = site.layers[name];
        if (!l) return;
        layers[name] = { show: l.show !== false };
        if (typeof l.opacity === 'number') layers[name].opacity = round(l.opacity, 2);
      });
      var out = {
        name: site.name,
        origin: site.origin,
        ring: site.ring.map(function(p) { return [round(p[0], 8), round(p[1], 8)]; }),
        analysis: g ? { source: g.sourceKey, cell: g.requested } : null,
        contourInterval: site.contourInterval,
        cut: { mode: site.cut.mode, target: isFinite(site.cut.target) ? round(site.cut.target, 2) : null, swell: site.cut.swell },
        layers: layers
      };
      if (g) {
        out.summary = {
          source: g.source, datum: g.datum, cell: g.cell,
          areaM2: round(g.stats.cells * g.cell * g.cell, 1),
          heightMin: round(g.stats.min, 2), heightMedian: round(g.stats.median, 2), heightMax: round(g.stats.max, 2),
          meanSlopeDeg: round(g.stats.meanSlope, 2)
        };
        var r = site.layers.cutfill && site.cut.result;
        if (r) {
          out.summary.gradeLevel = round(r.target, 2);
          out.summary.cutM3 = round(r.cut, 1);
          out.summary.fillM3 = round(r.fill, 1);
        }
      }
      var gr = site.grading;
      if (gr) {
        out.grading = {
          levelMode: gr.levelMode, level: isFinite(gr.level) && gr.level !== null ? round(gr.level, 2) : null,
          slopeCut: gr.slopeCut, slopeFill: gr.slopeFill, gradient: Number(gr.gradient) || 0, dir: gr.dir,
          group: groupOf(site) ? gr.group : null, groupBalance: groupOf(site) ? !!groupOf(site).balance : undefined,
          applied: !!gr.applied, depth: !!gr.depth
        };
        if (gr.result && out.summary) {
          out.summary.planumLevel = round(gr.result.t, 2);
          out.summary.gradingCutM3 = round(gr.result.cut, 1);
          out.summary.gradingFillM3 = round(gr.result.fill, 1);
          out.summary.gradingAreaM2 = round(gr.result.affectedM2, 1);
        }
      }
      return out;
    });
    var p = SA.profile;
    return {
      version: STATE_VERSION,
      sites: sites,
      profile: p ? {
        points: p.ptsDeg.map(function(q) { return [round(q[0], 8), round(q[1], 8)]; }),
        source: p.sourceKey,
        exaggeration: p.exaggeration,
        lengthM: round(p.length, 2)
      } : null
    };
  }

  async function waitIdle() {
    if (SA.job) SA.job.cancelled = true;
    for (var i = 0; SA.job && i < 100; i++) await new Promise(function(r) { setTimeout(r, 100); });
  }

  // Removes every site and the profile (scene load replaces, never mixes)
  function clearAll() {
    stopDraw();
    SA.clearing = true;
    try { SA.sites.slice().forEach(removeSite); } finally { SA.clearing = false; }
    Object.keys(SA.groups).forEach(dropGroup);
    if (profilePanel) profilePanel.classList.remove('visible');
    clearProfile();
    status('', '');
    renderSites();
  }

  function validRing(r) {
    return Array.isArray(r) && r.length >= 3 && r.every(function(p) {
      return Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
    });
  }

  function validSource(s) { return s === 'mapterhorn' || s === 'active' ? s : 'mapterhorn'; }

  // Rebuilds sites, grids, layers and the profile. Resolves a list of problems.
  async function importState(state) {
    await waitIdle();
    clearAll();
    var problems = [];
    if (!state || typeof state !== 'object') return problems;
    var list = Array.isArray(state.sites) ? state.sites : [];
    var restored = [];
    list.forEach(function(s) {
      if (!s || !validRing(s.ring)) { problems.push('Site analysis: a site without a valid outline was skipped'); return; }
      var site = addSite(s.ring.map(function(p) { return [Number(p[0]), Number(p[1])]; }), s.origin || 'scene', { name: s.name, quiet: true });
      if (!site) { problems.push('Site analysis: "' + (s.name || 'site') + '" could not be added'); return; }
      if (s.contourInterval === 'auto' || CONTOUR_STEPS.indexOf(Number(s.contourInterval)) !== -1) site.contourInterval = s.contourInterval;
      restored.push({ site: site, data: s });
    });

    for (var i = 0; i < restored.length; i++) {
      var site = restored[i].site, s = restored[i].data;
      if (!s.analysis) continue;
      await analyzeSite(site, { source: validSource(s.analysis.source), cell: s.analysis.cell });
      if (!site.grid) { problems.push('Site analysis: heights for "' + site.name + '" could not be loaded'); continue; }
      var cut = s.cut || {};
      site.cut.mode = cut.mode === 'fixed' ? 'fixed' : 'balanced';
      site.cut.target = isFinite(cut.target) && cut.target !== null ? Number(cut.target) : null;
      site.cut.swell = isFinite(cut.swell) && cut.swell >= 1 ? Number(cut.swell) : 1;
      var layers = s.layers || {};
      LAYER_NAMES.forEach(function(name) {
        var l = layers[name];
        if (!l) return;
        try {
          if (name === 'contours') showContours(site);
          else if (name === 'cutfill') showCutFill(site);
          else showRaster(site, name);
          if (isFinite(l.opacity) && site.layers[name].entities.length && site.layers[name].entities[0].rectangle) {
            setOpacity(site, name, Math.max(0.1, Math.min(1, Number(l.opacity))));
          }
          if (l.show === false) setLayerShown(site, name, false);
        } catch (err) {
          problems.push('Site analysis: ' + name + ' of "' + site.name + '": ' + (err.message || err));
        }
      });
      var sg = s.grading;
      if (sg && typeof sg === 'object') {
        var gr = site.grading = newGrading();
        gr.levelMode = sg.levelMode === 'fixed' ? 'fixed' : 'balanced';
        gr.level = isFinite(sg.level) && sg.level !== null ? Number(sg.level) : null;
        if (isFinite(sg.slopeCut) && sg.slopeCut >= 0.3 && sg.slopeCut <= 10) gr.slopeCut = Number(sg.slopeCut);
        if (isFinite(sg.slopeFill) && sg.slopeFill >= 0.3 && sg.slopeFill <= 10) gr.slopeFill = Number(sg.slopeFill);
        if (isFinite(sg.gradient) && sg.gradient >= 0 && sg.gradient <= 15) gr.gradient = Number(sg.gradient);
        if (sg.dir === 'terrain' || COMPASS[sg.dir] !== undefined) gr.dir = sg.dir;
        if (typeof sg.group === 'string' && /^g\d+$/.test(sg.group)) {
          gr.group = sg.group;
          if (!SA.groups[sg.group]) SA.groups[sg.group] = newGroup(sg.group);
          if (sg.groupBalance === false) SA.groups[sg.group].balance = false;
          groupSeq = Math.max(groupSeq, Number(sg.group.slice(1)));
        }
        gr.applied = sg.applied !== false;
        gr.depth = !!sg.depth;
        await computeGrading(site);
        if (!gr.result) problems.push('Site analysis: the grading of "' + site.name + '" could not be computed');
      }
    }

    // Terrace groups once all their terraces are graded
    var gids = Object.keys(SA.groups);
    for (var gi = 0; gi < gids.length; gi++) {
      if (groupMembers(gids[gi]).length < 2) {
        groupMembers(gids[gi]).forEach(function(s) { s.grading.group = null; });
        dropGroup(gids[gi]);
        continue;
      }
      await computeGroup(gids[gi]);
      if (!SA.groups[gids[gi]] || !SA.groups[gids[gi]].result) problems.push('Site analysis: a terrace group could not be computed');
    }

    var p = state.profile;
    if (p && Array.isArray(p.points) && p.points.length >= 2 && p.points.every(function(q) { return Array.isArray(q) && isFinite(q[0]) && isFinite(q[1]); })) {
      var ex = ['auto', '1', '2', '5', '10'].indexOf(String(p.exaggeration)) !== -1 ? String(p.exaggeration) : 'auto';
      await runProfile(p.points.map(function(q) { return [Number(q[0]), Number(q[1])]; }), { source: validSource(p.source), exaggeration: ex });
      if (!SA.profile) problems.push('Site analysis: the elevation profile could not be loaded');
    }
    renderSites();
    requestRender();
    if (restored.length || SA.profile) {
      status(problems.length ? problems.length + ' item(s) of the site analysis could not be restored' : 'Site analysis restored from the scene',
             problems.length ? 'error' : 'ok');
    }
    return problems;
  }

  // Public API (console, tests, other modules)
  SA.exportState = exportState;
  SA.importState = importState;
  SA.clearAll = clearAll;
  SA.waitIdle = waitIdle;
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
                    balancedTarget: balancedTarget, fillGaps: fillGaps, simplify: simplify,
                    polyDist: polyDist, gradeHeight: gradeHeight, gradingVolumes: gradingVolumes, gradingBalanced: gradingBalanced };
  SA.computeGrading = function(site) {
    site = site && typeof site === 'object' ? site : findSite(site);
    return site ? computeGrading(site) : Promise.resolve();
  };
  SA.exportLandXml = exportLandXml;
  SA.exportGlb = exportGlb;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
