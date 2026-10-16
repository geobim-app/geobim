/**
 * geoBIM.app
 * © 2026 Christof Lorenz. All rights reserved.
 *
 * Licensed under the Business Source License 1.1 (BSL 1.1)
 * Non-commercial use, evaluation, research, and education permitted.
 * Commercial use requires written permission.
 * Contact: info@geobim.app
 *
 * Change Date: 2030-03-01 — converts to MIT License
 */

// ===============================
// MAPTERHORN TERRAIN (preview) — open terrain tiles as Cesium terrain
// ===============================
// Mapterhorn (mapterhorn.com) serves open DEMs as Terrarium-encoded WebP tiles
// (512 px, Web Mercator): Copernicus GLO-30 worldwide up to z12, national
// DGMs above (Germany mostly 1 m, Bavaria up to z16). Heights are orthometric
// (NHN in Germany); Cesium needs ellipsoidal heights, so every sample is lifted
// by the geoid: GCG2016 (BKG, DHHN2016) inside Germany, EGM2008 elsewhere.
//
// Cesium level L uses the Mapterhorn tile at z = L - 2 (one source tile feeds
// 4×4 Cesium tiles of 129 samples ≈ one sample per source pixel). Missing
// tiles (404) fall back to the parent tile; levels beyond the data upsample.
// No ion token needed — also for guests.
'use strict';

window.GEOBIM_MAPTERHORN = (function() {

  var TERRAIN_ID = 'mapterhorn';
  var TERRAIN_NAME = 'Mapterhorn open terrain (Preview)';
  var TILE_URL = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
  var SRC_SIZE = 512;
  var SRC_MAX_Z = 17;
  var LEVEL_OFFSET = 2;            // Cesium level - source zoom
  var SAMPLES = 129;               // heightmap width/height per Cesium tile
  var MAX_LEVEL = SRC_MAX_Z + LEVEL_OFFSET;
  var MAX_FETCHES = 8;             // parallel tile downloads
  var CACHE_TILES = 48;            // decoded source tiles kept (1 MB each)

  // GCG2016 (BKG, CC BY 4.0) every 4th node of the PROJ-data grid
  // de_bkg_gcg2016.tif, uint16 millimetres, 0 = no data (outside Germany)
  var GCG = {
    url: '/geodesy/de_bkg_gcg2016_x4.u16?v=20261016',
    rows: 263, cols: 238,
    lon0: 3.25625, lat0: 55.979166667,   // first node (north-west)
    dLon: 0.05, dLat: 0.033333333335872,
    data: null
  };
  // EGM2008 1° grid (also used by geoid_terrain.js): row 0 = 90° N, col 0 = 0° E
  var EGM = { url: '/data/egm2008_1deg.bin', rows: 181, cols: 361, data: null };

  var geoidPromise = null;
  var cache = new Map();           // 'z/x/y' -> Promise<Float32Array|null>
  var missing = new Set();         // 'z/x/y' known to be 404
  var fetching = 0;
  var provider = null;

  // ---- Geoid ----

  var gcgPromise = null;

  function bin(url) {
    return fetch(url).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.arrayBuffer();
    });
  }

  // GCG2016 only (also used by the coordinate tool via geoid.js)
  function loadGCG() {
    if (gcgPromise) return gcgPromise;
    gcgPromise = bin(GCG.url).then(function(buf) {
      GCG.data = new Uint16Array(buf);
    }).catch(function(err) {
      gcgPromise = null;
      throw err;
    });
    return gcgPromise;
  }

  function loadGeoid() {
    if (geoidPromise) return geoidPromise;
    geoidPromise = Promise.all([loadGCG(), bin(EGM.url)]).then(function(res) {
      EGM.data = new Float32Array(res[1]);
    }).catch(function(err) {
      geoidPromise = null;
      throw err;
    });
    return geoidPromise;
  }

  function gcg2016(lat, lon) {
    var c = (lon - GCG.lon0) / GCG.dLon;
    var r = (GCG.lat0 - lat) / GCG.dLat;
    var c0 = Math.floor(c), r0 = Math.floor(r);
    if (c0 < 0 || r0 < 0 || c0 >= GCG.cols - 1 || r0 >= GCG.rows - 1) return null;
    var i = r0 * GCG.cols + c0, d = GCG.data;
    var q00 = d[i], q01 = d[i + 1], q10 = d[i + GCG.cols], q11 = d[i + GCG.cols + 1];
    if (!q00 || !q01 || !q10 || !q11) return null;
    var fc = c - c0, fr = r - r0;
    return (q00 * (1 - fc) * (1 - fr) + q01 * fc * (1 - fr) + q10 * (1 - fc) * fr + q11 * fc * fr) / 1000;
  }

  function egm2008(lat, lon) {
    lat = Math.max(-90, Math.min(90, lat));
    lon = ((lon % 360) + 360) % 360;
    var r = 90 - lat, c = lon;
    var r0 = Math.min(Math.floor(r), EGM.rows - 2), c0 = Math.min(Math.floor(c), EGM.cols - 2);
    var fr = r - r0, fc = c - c0, d = EGM.data, i = r0 * EGM.cols + c0;
    return d[i] * (1 - fc) * (1 - fr) + d[i + 1] * fc * (1 - fr) +
           d[i + EGM.cols] * (1 - fc) * fr + d[i + EGM.cols + 1] * fc * fr;
  }

  function geoidHeight(lat, lon) {
    var n = gcg2016(lat, lon);
    return n === null ? egm2008(lat, lon) : n;
  }

  // ---- Source tiles ----

  function key(z, x, y) { return z + '/' + x + '/' + y; }

  // Decoded orthometric heights of one 512×512 Mapterhorn tile, null if missing
  function loadSource(z, x, y) {
    var k = key(z, x, y);
    var hit = cache.get(k);
    if (hit) {
      cache.delete(k); cache.set(k, hit);   // LRU: move to the end
      return hit;
    }
    fetching++;
    var url = TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    var p = fetch(url).then(function(res) {
      if (res.status === 404) { missing.add(k); return null; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.blob();
    }).then(function(blob) {
      if (!blob) return null;
      return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    }).then(function(bmp) {
      if (!bmp) return null;
      var w = bmp.width, ht = bmp.height;
      var canvas = new OffscreenCanvas(w, ht);
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      var px = ctx.getImageData(0, 0, w, ht).data;
      bmp.close();
      var h = new Float32Array(w * ht);
      for (var i = 0, j = 0; i < h.length; i++, j += 4) {
        h[i] = px[j] * 256 + px[j + 1] + px[j + 2] / 256 - 32768;   // Terrarium
      }
      return h;
    }).finally(function() {
      fetching--;
    });
    p.catch(function() { cache.delete(k); });   // retry on the next request
    cache.set(k, p);
    while (cache.size > CACHE_TILES) cache.delete(cache.keys().next().value);
    return p;
  }

  // Deepest available source tile at or above zoom z that covers Cesium tile (x, y, level).
  // undefined = too many downloads running (only for the first lookup; Cesium asks again
  // later), parents of a missing tile are always fetched.
  function sourceFor(x, y, level, z, force) {
    var d = level - z;
    var sx = x >> d, sy = y >> d;
    var k = key(z, sx, sy);
    if (z > 0 && missing.has(k)) return sourceFor(x, y, level, z - 1, force);
    if (!force && !cache.has(k) && fetching >= MAX_FETCHES) return undefined;
    return loadSource(z, sx, sy).then(function(h) {
      if (h || z === 0) return { z: z, sx: sx, sy: sy, heights: h };
      return sourceFor(x, y, level, z - 1, true);
    });
  }

  // ---- Heightmap for one Cesium tile ----

  function buildTile(x, y, level, src) {
    var out = new Float32Array(SAMPLES * SAMPLES);
    var d = level - src.z, n = 1 << d;
    var fx0 = (x - src.sx * n) / n, fy0 = (y - src.sy * n) / n;   // tile offset inside the source tile
    var worldTiles = Math.pow(2, level);
    var h = src.heights, S = SRC_SIZE, last = S - 1;
    for (var row = 0; row < SAMPLES; row++) {
      var t = row / (SAMPLES - 1);
      var py = (fy0 + t / n) * S - 0.5;
      py = py < 0 ? 0 : (py > last ? last : py);
      var y0 = Math.floor(py), y1 = Math.min(y0 + 1, last), wy = py - y0;
      var merc = Math.PI * (1 - 2 * (y + t) / worldTiles);
      var lat = Math.atan(Math.sinh(merc)) * 180 / Math.PI;
      for (var col = 0; col < SAMPLES; col++) {
        var s = col / (SAMPLES - 1);
        var lon = (x + s) / worldTiles * 360 - 180;
        var ortho = 0;
        if (h) {
          var pxx = (fx0 + s / n) * S - 0.5;
          pxx = pxx < 0 ? 0 : (pxx > last ? last : pxx);
          var x0 = Math.floor(pxx), x1 = Math.min(x0 + 1, last), wx = pxx - x0;
          var a = h[y0 * S + x0], b = h[y0 * S + x1], c = h[y1 * S + x0], e = h[y1 * S + x1];
          ortho = (a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + e * wx) * wy;
        }
        out[row * SAMPLES + col] = ortho + geoidHeight(lat, lon);
      }
    }
    return out;
  }

  // ---- Provider ----

  function createProvider() {
    if (provider) return Promise.resolve(provider);
    return loadGeoid().then(function() {
      var tilingScheme = new Cesium.WebMercatorTilingScheme();
      var p = new Cesium.CustomHeightmapTerrainProvider({
        width: SAMPLES,
        height: SAMPLES,
        tilingScheme: tilingScheme,
        credit: new Cesium.Credit('Terrain © <a href="https://mapterhorn.com/attribution" target="_blank" rel="noopener">Mapterhorn and its sources</a>; geoid GCG2016 © <a href="https://www.bkg.bund.de" target="_blank" rel="noopener">BKG</a> (CC BY 4.0)', false),
        callback: function(x, y, level) {
          var src = sourceFor(x, y, level, Math.max(0, Math.min(SRC_MAX_Z, level - LEVEL_OFFSET)));
          if (src === undefined) return undefined;
          return src.then(function(s) { return buildTile(x, y, level, s); });
        }
      });
      // sampleTerrainMostDetailed (measurements, Z offset, clamping) needs tile availability
      var availability = new Cesium.TileAvailability(tilingScheme, MAX_LEVEL);
      for (var lvl = 0; lvl <= MAX_LEVEL; lvl++) {
        var count = 1 << lvl;
        availability.addAvailableTileRange(lvl, 0, 0, count - 1, count - 1);
      }
      Object.defineProperty(p, 'availability', { value: availability });
      provider = p;
      return p;
    });
  }

  // ---- Layer Manager integration ----

  function register() {
    if (typeof LayerManager === 'undefined' || !LayerManager.terrainLayers) return;
    if (LayerManager.terrainLayers.some(function(t) { return t.id === TERRAIN_ID; })) return;
    var world = LayerManager.terrainLayers.findIndex(function(t) { return t.id === 'world'; });
    LayerManager.terrainLayers.splice(world + 1, 0, { id: TERRAIN_ID, name: TERRAIN_NAME, assetId: null, active: false });
    LayerManager.updateTerrainUI();
  }

  function hook() {
    if (typeof LayerManager === 'undefined') return;

    var origInit = LayerManager.init;
    LayerManager.init = async function() {
      var result = await origInit.apply(this, arguments);
      register();
      return result;
    };
    if (LayerManager.viewer) register();   // init already ran

    var origSwitch = LayerManager.switchTerrain;
    LayerManager.switchTerrain = async function(terrainId) {
      if (terrainId !== TERRAIN_ID) return origSwitch.apply(this, arguments);
      var target = this.terrainLayers.find(function(t) { return t.id === TERRAIN_ID; });
      if (!this.viewer || !target) return;
      try {
        BimViewer.updateStatus('Loading Mapterhorn terrain...', 'loading');
        var p = await createProvider();
        this.terrainLayers.forEach(function(t) { t.active = false; });
        this.viewer.terrainProvider = p;
        if (BimViewer.terrain) BimViewer.terrain.current = TERRAIN_ID;
        target.active = true;
        this.activeTerrain = TERRAIN_ID;
        this.updateTerrainUI();
        BimViewer.updateStatus('Terrain: ' + TERRAIN_NAME, 'success');
      } catch (err) {
        console.error('Mapterhorn terrain failed:', err);
        BimViewer.updateStatus('Mapterhorn terrain not available: ' + err.message, 'error');
        this.updateTerrainUI();
      }
    };
  }

  hook();

  return {
    TERRAIN_ID: TERRAIN_ID,
    createProvider: createProvider,
    geoidHeight: function(lat, lon) { return GCG.data && EGM.data ? geoidHeight(lat, lon) : null; },
    // GCG2016 undulation in Germany, null outside or before loadGCG() finished
    gcg2016: function(lat, lon) { return GCG.data ? gcg2016(lat, lon) : null; },
    loadGCG: loadGCG,
    loadGeoid: loadGeoid
  };

})();
