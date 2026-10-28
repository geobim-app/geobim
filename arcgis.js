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
// ARCGIS — Esri basemaps, ArcGIS MapServer layers, World Elevation, I3S
// ===============================
// - Base maps: Esri World Imagery / Streets / Topographic in the base map list
//   (no ion, so guests get them too).
// - Layers: an ArcGIS REST URL in the OGC service field (".../MapServer")
//   becomes an imagery layer in the same list as WMS/WMTS/WFS.
// - Terrain: ArcGIS World Elevation (Terrain3D) next to Cesium World Terrain.
// - I3S: a ".../SceneServer" URL in the same field loads the scene layer as an
//   asset (card in Loaded: fly to, show/hide, opacity, remove). Building
//   Scene Layers get a discipline/category filter and a level filter; a click
//   shows the element's fields in the InfoBox.
// Optional key: GEOBIM_CONFIG.arcgis.apiKey (config.js) is sent as token to
// ArcGIS services; the public services used here also work without it.
'use strict';

window.BimArcGIS = (function() {

  var SERVICES = 'https://services.arcgisonline.com/ArcGIS/rest/services/';
  var ELEVATION_URL = 'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer';
  // Geoid for I3S layers with orthometric heights (as in Cesium's I3S examples)
  var GEOID_URL = 'https://tiles.arcgis.com/tiles/z2tnIkrLQ2BRzr6P/arcgis/rest/services/EGM2008/ImageServer';
  var TERRAIN_ID = 'arcgis-elevation';
  var TERRAIN_NAME = 'ArcGIS World Elevation';
  var BASEMAPS = [
    { id: 'esri-imagery', name: 'Esri World Imagery', service: 'World_Imagery' },
    { id: 'esri-streets', name: 'Esri Streets', service: 'World_Street_Map' },
    { id: 'esri-topo', name: 'Esri Topographic', service: 'World_Topo_Map' }
  ];
  var PRESETS = [
    { group: 'ArcGIS', label: 'Esri World Hillshade (MapServer)', url: SERVICES + 'Elevation/World_Hillshade/MapServer' }
  ];
  // Demo assets in the Assets section (like the Bentley iTwin demo)
  var DEMOS = [
    { key: 'turanga', label: 'Turanga Library', icon: 'library', where: 'Christchurch, NZ',
      name: 'Turanga Library (Esri demo)',
      url: 'https://tiles.arcgis.com/tiles/cFEFS0EWrhfDeVw9/arcgis/rest/services/Turanga_Library/SceneServer' },
    { key: 'sf', label: 'San Francisco 3D', icon: 'building-2', where: 'San Francisco, US',
      name: 'San Francisco 3D buildings (Esri demo)',
      url: 'https://tiles.arcgis.com/tiles/z2tnIkrLQ2BRzr6P/arcgis/rest/services/SanFrancisco_3DObjects_1_7/SceneServer' }
  ];
  var REST_URL = /\/rest\/services\/.+\/(MapServer|SceneServer)(\/layers\/\d+)?\/?$/i;
  var LEVEL_FIELDS = ['BldgLevel', 'Level', 'level'];

  var LERC_URL = 'https://cdn.jsdelivr.net/npm/lerc@4.0.4/LercDecode.es.js';

  var geoidPromise = null;
  var lercPromise = null;

  function apiKey() {
    return (typeof GEOBIM_CONFIG !== 'undefined' && GEOBIM_CONFIG.arcgis && GEOBIM_CONFIG.arcgis.apiKey) || undefined;
  }

  // Token only for Esri's own hosts — never sent to a third-party server
  function isEsriHost(url) {
    try { return /(^|\.)(arcgis\.com|arcgisonline\.com)$/i.test(new URL(url).hostname); } catch (_) { return false; }
  }

  function tokenFor(url) {
    return isEsriHost(url) ? apiKey() : undefined;
  }

  function resourceFor(url) {
    var token = tokenFor(url);
    return new Cesium.Resource({ url: url, queryParameters: token ? { token: token } : undefined });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function hash(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  // ---- Base maps and terrain (LayerManager) ----

  function registerBasemaps(lm) {
    if (!lm.allBasemapLayers) return;
    var at = lm.allBasemapLayers.findIndex(function(b) { return b.id === 'none'; });
    if (at < 0) at = lm.allBasemapLayers.length;
    BASEMAPS.forEach(function(def) {
      if (lm.allBasemapLayers.some(function(b) { return b.id === def.id; })) return;
      var url = SERVICES + def.service + '/MapServer';
      lm.allBasemapLayers.splice(at++, 0, {
        id: def.id,
        name: def.name,
        providerFactory: function() { return Cesium.ArcGisMapServerImageryProvider.fromUrl(url, { token: tokenFor(url) }); },
        layer: null,
        active: false
      });
    });
    lm.applyImageryAccess();
    lm.updateBasemapUI();
  }

  function registerTerrain(lm) {
    if (!lm.terrainLayers || lm.terrainLayers.some(function(t) { return t.id === TERRAIN_ID; })) return;
    var world = lm.terrainLayers.findIndex(function(t) { return t.id === 'world'; });
    var mapterhorn = lm.terrainLayers.findIndex(function(t) { return t.id === 'mapterhorn'; });
    lm.terrainLayers.splice(Math.max(world, mapterhorn) + 1, 0, { id: TERRAIN_ID, name: TERRAIN_NAME, assetId: null, active: false });
    lm.updateTerrainUI();
  }

  function register() {
    if (typeof LayerManager === 'undefined' || !LayerManager.viewer) return;
    registerBasemaps(LayerManager);
    registerTerrain(LayerManager);
    LayerManager.updateWmsPresetUI();
  }

  // World Elevation heights are orthometric (above sea level), Cesium needs
  // ellipsoidal ones: decode each LERC tile here and lift every sample by the
  // geoid of mapterhorn-terrain.js (GCG2016 in Germany, EGM2008 elsewhere) —
  // otherwise models float ~47 m above the ground in Germany
  function lerc() {
    if (!lercPromise) {
      lercPromise = import(LERC_URL).then(function(m) {
        return m.load({ locateFile: function(f) { return LERC_URL.replace(/[^/]+$/, f); } }).then(function() { return m; });
      });
      lercPromise.catch(function() { lercPromise = null; });
    }
    return lercPromise;
  }

  function ellipsoidalProvider(base, decoder) {
    var ts = base.tilingScheme;
    var mercator = ts instanceof Cesium.WebMercatorTilingScheme;
    var wrapped = Object.create(base);
    wrapped.requestTileGeometry = function(x, y, level, request) {
      var promise = base.requestTileGeometry(x, y, level, request);
      if (!promise) return promise;
      return promise.then(function(data) {
        if (!data || data._encoding !== Cesium.HeightmapEncoding.LERC) return data;
        var image = decoder.decode(data._buffer);
        var w = image.width, h = image.height;
        var src = image.pixels[0], mask = image.mask;
        var out = new Float32Array(w * h);
        var rect = ts.tileXYToRectangle(x, y, level);
        var north = mercator ? Cesium.WebMercatorProjection.geodeticLatitudeToMercatorAngle(rect.north) : rect.north;
        var south = mercator ? Cesium.WebMercatorProjection.geodeticLatitudeToMercatorAngle(rect.south) : rect.south;
        for (var row = 0; row < h; row++) {
          var t = north + (south - north) * row / (h - 1);
          var lat = Cesium.Math.toDegrees(mercator ? Cesium.WebMercatorProjection.mercatorAngleToGeodeticLatitude(t) : t);
          for (var col = 0; col < w; col++) {
            var lon = Cesium.Math.toDegrees(rect.west + (rect.east - rect.west) * col / (w - 1));
            var i = row * w + col;
            var ortho = mask && !mask[i] ? 0 : src[i];
            out[i] = ortho + (GEOBIM_MAPTERHORN.geoidHeight(lat, lon) || 0);
          }
        }
        return new Cesium.HeightmapTerrainData({
          buffer: out,
          width: w,
          height: h,
          childTileMask: data._childTileMask,
          waterMask: data._waterMask,
          structure: data._structure
        });
      });
    };
    return wrapped;
  }

  async function createElevationProvider() {
    var results = await Promise.all([
      Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(ELEVATION_URL, { token: tokenFor(ELEVATION_URL) }),
      lerc(),
      window.GEOBIM_MAPTERHORN ? GEOBIM_MAPTERHORN.loadGeoid() : Promise.reject(new Error('geoid not available'))
    ]);
    return ellipsoidalProvider(results[0], results[1]);
  }

  async function switchToElevation(lm) {
    var target = lm.terrainLayers.find(function(t) { return t.id === TERRAIN_ID; });
    if (!lm.viewer || !target) return;
    try {
      BimViewer.updateStatus('Loading ArcGIS World Elevation...', 'loading');
      var provider = await createElevationProvider();
      lm.terrainLayers.forEach(function(t) { t.active = false; });
      lm.viewer.terrainProvider = provider;
      if (BimViewer.terrain) BimViewer.terrain.current = TERRAIN_ID;
      target.active = true;
      lm.activeTerrain = TERRAIN_ID;
      lm.updateTerrainUI();
      BimViewer.updateStatus('Terrain: ' + TERRAIN_NAME, 'success');
    } catch (err) {
      console.error('ArcGIS World Elevation failed:', err);
      BimViewer.updateStatus('ArcGIS World Elevation not available: ' + err.message, 'error');
      lm.updateTerrainUI();
    }
  }

  // ---- ArcGIS REST URLs in the OGC service field ----

  async function discover(lm, url) {
    var picker = document.getElementById('wmsLayerPicker');
    var status = document.getElementById('wmsLayerPickerStatus');
    var list = document.getElementById('wmsLayerPickerList');
    if (picker) picker.style.display = 'block';
    if (status) { status.style.display = 'block'; status.textContent = 'Reading ArcGIS service...'; }
    if (list) list.innerHTML = '';
    BimViewer.updateStatus('Reading ArcGIS service...', 'loading');

    var base = url.replace(/\/+$/, '');
    try {
      var json = await resourceFor(base).getDerivedResource({ queryParameters: { f: 'json' } }).fetchJson();
      if (json.error) throw new Error(json.error.message || 'service error');
      var scene = /SceneServer/i.test(base);
      var serviceName = base.split('/').filter(function(p) { return !/^(MapServer|SceneServer|layers|\d+)$/i.test(p); }).pop();
      var title = scene
        ? (json.layers && json.layers[0] && json.layers[0].name) || json.name || serviceName
        : (json.documentInfo && json.documentInfo.Title) || json.mapName || serviceName;
      var entry = { type: scene ? 'i3s' : 'arcgis', name: base, title: title, url: base };
      lm.wmsDiscovered = [entry];

      if (status) status.style.display = 'none';
      if (list) {
        list.innerHTML =
          '<button type="button" class="arcgis-pick" data-wms-add-layer="0">' +
            '<span class="arcgis-pick-text">' +
              '<span class="arcgis-pick-title">' + escapeHtml(title) + '</span>' +
              '<span class="arcgis-pick-meta">' + (scene ? 'I3S scene layer · loads as asset' : 'ArcGIS MapServer') + '</span>' +
            '</span>' +
            '<i data-lucide="plus"></i>' +
          '</button>';
        if (window.lucide) lucide.createIcons();
      }
      BimViewer.updateStatus('ArcGIS service found: ' + title, 'success');
    } catch (err) {
      console.error('ArcGIS service discovery failed:', err);
      if (status) { status.style.display = 'block'; status.textContent = 'Discovery failed: ' + err.message; }
      BimViewer.updateStatus('Discovery failed: ' + err.message, 'error');
    }
  }

  async function addMapServer(lm, entry) {
    var id = 'arcgis_' + entry.url;
    if (lm.wmsLayers.find(function(w) { return w.id === id; })) {
      BimViewer.updateStatus('Layer already added', 'warning');
      return;
    }
    try {
      BimViewer.updateStatus('Loading ' + entry.title + '...', 'loading');
      var provider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(entry.url, { token: tokenFor(entry.url) });
      var layer = lm.viewer.imageryLayers.addImageryProvider(provider);
      layer.alpha = 0.7;
      lm.wmsLayers.push({
        id: id, name: entry.title, url: entry.url, type: 'arcgis', layerName: 'MapServer',
        layer: layer, dataSource: null, visible: true, alpha: 0.7
      });
      lm.updateWmsUI();
      BimViewer.updateStatus('Layer added: ' + entry.title, 'success');
    } catch (err) {
      console.error('ArcGIS MapServer failed:', err);
      BimViewer.updateStatus('Failed: ' + err.message, 'error');
    }
  }

  // ---- I3S scene layers as assets ----

  function childTilesets(provider) {
    return (provider.layers || []).map(function(l) { return l.tileset; }).filter(Boolean);
  }

  function idFor(url) {
    return 'i3s_' + hash(url.replace(/\/+$/, ''));
  }

  async function loadI3S(url, name, where) {
    var viewer = BimViewer.viewer;
    var base = url.replace(/\/+$/, '');
    var id = idFor(base);
    if (BimViewer.loadedAssets.has(id)) {
      BimViewer.zoomToAsset(id);
      return;
    }
    try {
      BimViewer.updateStatus('Loading ' + (name || 'I3S scene layer') + (where ? ' (' + where + ')' : '') + '...', 'loading');
      if (!geoidPromise) {
        geoidPromise = Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(GEOID_URL);
        geoidPromise.catch(function() { geoidPromise = null; });
      }
      var geoid = await geoidPromise.catch(function() { return undefined; });
      var provider = await Cesium.I3SDataProvider.fromUrl(resourceFor(base), {
        name: name,
        geoidTiledTerrainProvider: geoid,
        cesium3dTilesetOptions: { skipLevelOfDetail: false }
      });
      showFullModel(provider, true);
      viewer.scene.primitives.add(provider);
      childTilesets(provider).forEach(function(t) {
        if (typeof BimViewer.enableTilesetLighting === 'function') BimViewer.enableTilesetLighting(t);
      });
      BimViewer.loadedAssets.set(id, {
        id: id, name: name || 'I3S scene layer', i3s: provider, url: base,
        visible: true, opacity: 1.0, type: 'I3S'
      });
      if (window.BimViewerUI && typeof BimViewerUI.createAssetControls === 'function') BimViewerUI.createAssetControls(id);
      zoomTo(provider);
      BimViewer.updateStatus('I3S loaded: ' + (name || base), 'success');
    } catch (err) {
      console.error('I3S scene layer failed:', err);
      BimViewer.updateStatus('I3S scene layer failed: ' + err.message, 'error');
    } finally {
      renderDemo();
    }
  }

  // ---- Assets section: "Esri ArcGIS" block (demos + own I3S URL) ----

  var loading = {};

  async function loadDemo(key) {
    var demo = DEMOS.find(function(d) { return d.key === key; });
    if (!demo || loading[key]) return;
    loading[key] = true;
    renderDemo();
    try {
      await loadI3S(demo.url, demo.name, demo.where);
    } finally {
      loading[key] = false;
      renderDemo();
    }
  }

  async function loadOwnUrl() {
    var input = document.getElementById('arcgisI3sUrl');
    var url = input ? input.value.trim() : '';
    if (!/\/SceneServer(\/layers\/\d+)?\/?$/i.test(url.split('?')[0])) {
      BimViewer.updateStatus('Please enter an I3S scene layer URL ending in /SceneServer', 'error');
      return;
    }
    var base = url.split('?')[0];
    var name = base.split('/').filter(function(p) { return !/^(SceneServer|layers|\d+)$/i.test(p); }).pop();
    try {
      var json = await resourceFor(base).getDerivedResource({ queryParameters: { f: 'json' } }).fetchJson();
      name = (json.layers && json.layers[0] && json.layers[0].name) || json.name || name;
    } catch (_) { /* the provider reports the real error */ }
    await loadI3S(base, name);
  }

  function renderDemo() {
    var list = document.getElementById('arcgisDemoList');
    if (!list) return;
    Array.prototype.forEach.call(list.querySelectorAll('[data-arcgis-demo]'), function(btn) {
      var key = btn.dataset.arcgisDemo;
      var demo = DEMOS.find(function(d) { return d.key === key; });
      var loaded = BimViewer.loadedAssets && BimViewer.loadedAssets.has(idFor(demo.url));
      btn.classList.toggle('active', !!loaded);
      btn.disabled = !!loading[key];
      btn.title = loading[key] ? 'Loading…' : loaded ? 'Loaded — click to fly there' : 'Load ' + demo.label + ' (' + demo.where + ')';
    });
  }

  function injectDemo() {
    if (document.getElementById('arcgisDemo')) return true;
    var selector = document.getElementById('ionAssetSelector');
    var group = selector && selector.closest('.modern-group');
    if (!group) return false;
    var after = document.getElementById('itwinDemo') || group;
    after.insertAdjacentHTML('afterend',
      '<div class="modern-divider"><span class="modern-divider-text">Esri ArcGIS</span></div>' +
      '<div class="modern-group arcgis-demo" id="arcgisDemo">' +
        '<div class="modern-hint">I3S scene layers streamed from ArcGIS: a Revit building with disciplines and levels, and a city of 3D buildings (Esri sample data).</div>' +
        '<div class="arcgis-demo-list" id="arcgisDemoList">' +
          DEMOS.map(function(d) {
            return '<button type="button" class="modern-btn modern-btn-small arcgis-demo-btn" data-arcgis-demo="' + d.key + '">' +
              '<i data-lucide="' + d.icon + '"></i><span>' + escapeHtml(d.label) + '</span></button>';
          }).join('') +
        '</div>' +
        '<label class="modern-label-small" for="arcgisI3sUrl">Own I3S scene layer</label>' +
        '<div class="arcgis-url-row">' +
          '<input type="url" id="arcgisI3sUrl" class="modern-input" placeholder="https://…/SceneServer">' +
          '<button type="button" class="modern-btn modern-btn-primary arcgis-url-btn" id="arcgisI3sLoadBtn" title="Load scene layer" aria-label="Load scene layer">' +
            '<i data-lucide="plus"></i></button>' +
        '</div>' +
      '</div>');
    document.getElementById('arcgisDemoList').addEventListener('click', function(e) {
      var b = e.target.closest('[data-arcgis-demo]');
      if (b) loadDemo(b.dataset.arcgisDemo);
    });
    document.getElementById('arcgisI3sLoadBtn').addEventListener('click', loadOwnUrl);
    document.getElementById('arcgisI3sUrl').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') loadOwnUrl();
    });
    if (window.lucide) lucide.createIcons();
    renderDemo();
    return true;
  }

  // Oblique view onto all shown layers (the service extent alone gives a
  // top-down view far too close for a single building)
  function zoomTo(provider) {
    var spheres = childTilesets(provider)
      .filter(function(t) { return t.show && t.boundingSphere; })
      .map(function(t) { return t.boundingSphere; });
    if (spheres.length) {
      var sphere = Cesium.BoundingSphere.fromBoundingSpheres(spheres);
      BimViewer.viewer.camera.flyToBoundingSphere(sphere, {
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-35), sphere.radius * 2.5),
        duration: 1.5
      });
    } else if (provider.extent) {
      BimViewer.viewer.camera.flyTo({ destination: provider.extent, duration: 1.5 });
    }
  }

  function setOpacity(asset, opacity) {
    childTilesets(asset.i3s).forEach(function(t) {
      t.style = opacity < 1 ? new Cesium.Cesium3DTileStyle({ color: 'color("white", ' + opacity + ')' }) : undefined;
    });
  }

  // Building Scene Layer: "Overview" is a light shell, "Full Model" holds the
  // elements in discipline groups (invisible by default in the service).
  // geoBIM shows the full model with every discipline, like an IFC model.
  function bslParts(provider) {
    var subs = provider.sublayers || [];
    var find = function(re) { return subs.find(function(s) { return re.test(s.modelName || s.name || ''); }); };
    return { full: find(/^full\s*model$/i), overview: find(/^overview$/i) };
  }

  function showFullModel(provider, on) {
    var parts = bslParts(provider);
    if (!parts.full) return;
    parts.full.visibility = on;
    if (parts.overview) parts.overview.visibility = !on;
    if (on) (parts.full.sublayers || []).forEach(function(g) { g.visibility = true; });
  }

  // Disciplines (Architectural, Structural, ...) and their categories (Walls,
  // Doors, ...) as nested checkboxes, plus the Overview / Full model switch
  function sublayerFilter(provider, assetId) {
    var parts = bslParts(provider);
    var groups = parts.full ? parts.full.sublayers || [] : provider.sublayers || [];
    if (!groups.length) return null;
    var box = document.createElement('details');
    box.className = 'arcgis-i3s-filter';
    var summary = document.createElement('summary');
    summary.textContent = 'Disciplines & categories';
    box.appendChild(summary);
    var boxes = [];
    var n = 0;

    if (parts.full && parts.overview) {
      var mode = document.createElement('select');
      mode.className = 'modern-select arcgis-i3s-mode';
      mode.setAttribute('aria-label', 'Building model');
      mode.innerHTML = '<option value="full">Full model</option><option value="overview">Overview (shell only)</option>';
      mode.value = parts.full.visibility ? 'full' : 'overview';
      mode.addEventListener('change', function() {
        showFullModel(provider, mode.value === 'full');
        boxes.forEach(function(b) { b.cb.checked = b.sub.visibility !== false; b.cb.disabled = mode.value !== 'full'; });
      });
      box.appendChild(mode);
    }

    function addRows(list, depth) {
      list.forEach(function(sub) {
        var row = document.createElement('label');
        row.className = 'arcgis-i3s-row' + (depth ? ' arcgis-i3s-row-sub' : '');
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = sub.visibility !== false;
        cb.disabled = !!(parts.full && !parts.full.visibility);
        cb.id = 'i3sSub_' + assetId + '_' + (n++);
        cb.addEventListener('change', function() { sub.visibility = cb.checked; });
        boxes.push({ cb: cb, sub: sub });
        row.appendChild(cb);
        row.appendChild(document.createTextNode(' ' + (sub.name || sub.modelName || 'Layer')));
        box.appendChild(row);
        if (sub.sublayers && sub.sublayers.length) addRows(sub.sublayers, depth + 1);
      });
    }
    addRows(groups, 0);
    return box;
  }

  async function levelFilter(provider, card) {
    var names;
    try { names = await provider.getAttributeNames(); } catch (_) { return; }
    var field = LEVEL_FIELDS.find(function(f) { return names.indexOf(f) >= 0; });
    if (!field) return;
    var values = (await provider.getAttributeValues(field)) || [];
    if (!values.length) return;
    values = values.slice().sort(function(a, b) { return (+a - +b) || String(a).localeCompare(String(b)); });
    var group = document.createElement('div');
    group.className = 'arcgis-i3s-level';
    var label = document.createElement('label');
    label.className = 'modern-label-small';
    label.textContent = 'Level';
    var select = document.createElement('select');
    select.className = 'modern-select';
    select.id = 'i3sLevel_' + card.id;
    label.htmlFor = select.id;
    select.innerHTML = '<option value="">All levels</option>' +
      values.map(function(v) { return '<option value="' + escapeHtml(v) + '">' + escapeHtml(v) + '</option>'; }).join('');
    select.addEventListener('change', function() {
      var v = select.value;
      provider.filterByAttributes(v === '' ? [] : [{ name: field, values: [isNaN(+v) ? v : +v] }]);
    });
    group.appendChild(label);
    group.appendChild(select);
    var details = card.querySelector('.modern-asset-details') || card;
    details.appendChild(group);
  }

  function decorateCard(assetId) {
    var asset = BimViewer.loadedAssets.get(String(assetId));
    var card = document.getElementById('asset_' + assetId);
    if (!asset || asset.type !== 'I3S' || !card) return;
    var details = card.querySelector('.modern-asset-details') || card;
    var filter = sublayerFilter(asset.i3s, assetId);
    if (filter) details.appendChild(filter);
    levelFilter(asset.i3s, card).catch(function(err) { console.warn('I3S level filter:', err); });
  }

  // I3S element fields for the InfoBox (the tiles carry none themselves)
  async function showFields(feature, position) {
    var node = feature && feature.content && feature.content.tile && feature.content.tile.i3sNode;
    if (!node) return;
    var picked = BimViewer.viewer.scene.pickPosition(position);
    if (!picked) return;
    await node.loadFields();
    var fields = node.getFieldsForPickedPosition(picked) || {};
    var properties = {};
    Object.keys(fields).forEach(function(k) {
      var v = fields[k];
      if (v !== undefined && v !== null && v !== '') properties[k] = v;
    });
    if (Object.keys(properties).length && BimViewer.selectedFeature === feature) BimViewer.displayIFCProperties(properties);
  }

  // ---- Hooks ----

  function hook() {
    if (typeof LayerManager === 'undefined' || typeof BimViewer === 'undefined') return;

    PRESETS.forEach(function(p) {
      if (!LayerManager.wmsPresets.some(function(q) { return q.url === p.url; })) LayerManager.wmsPresets.push(p);
    });

    var origInit = LayerManager.init;
    LayerManager.init = async function() {
      var result = await origInit.apply(this, arguments);
      register();
      return result;
    };
    register();   // init already ran

    var origSwitch = LayerManager.switchTerrain;
    LayerManager.switchTerrain = async function(terrainId) {
      if (terrainId !== TERRAIN_ID) return origSwitch.apply(this, arguments);
      return switchToElevation(this);
    };

    var origDiscover = LayerManager.discoverWmsLayers;
    LayerManager.discoverWmsLayers = async function(url) {
      var bare = String(url || '').trim().split('?')[0];
      if (!this.viewer || !REST_URL.test(bare)) return origDiscover.apply(this, arguments);
      return discover(this, bare);
    };

    var origAdd = LayerManager.addDiscoveredWmsLayer;
    LayerManager.addDiscoveredWmsLayer = async function(index) {
      var entry = this.wmsDiscovered && this.wmsDiscovered[parseInt(index, 10)];
      if (entry && entry.type === 'arcgis') return addMapServer(this, entry);
      if (entry && entry.type === 'i3s') return loadI3S(entry.url, entry.title);
      return origAdd.apply(this, arguments);
    };

    var origUnload = BimViewer.unloadAsset;
    BimViewer.unloadAsset = function(assetId) {
      var asset = this.loadedAssets.get(String(assetId));
      if (!asset || asset.type !== 'I3S') return origUnload.apply(this, arguments);
      this.viewer.scene.primitives.remove(asset.i3s);   // destroys the provider
      this.loadedAssets.delete(String(assetId));
      var card = document.getElementById('asset_' + assetId);
      if (card) card.remove();
      this.updateStatus('Asset unloaded', 'success');
      renderDemo();
    };

    var origZoom = BimViewer.zoomToAsset;
    BimViewer.zoomToAsset = function(assetId) {
      var asset = this.loadedAssets.get(String(assetId));
      if (!asset || asset.type !== 'I3S') return origZoom.apply(this, arguments);
      zoomTo(asset.i3s);
    };

    var origToggle = BimViewer.toggleAssetVisibility;
    BimViewer.toggleAssetVisibility = function(assetId) {
      var asset = this.loadedAssets.get(String(assetId));
      if (!asset || asset.type !== 'I3S') return origToggle.apply(this, arguments);
      asset.visible = !asset.visible;
      asset.i3s.show = asset.visible;
      var btn = document.querySelector('#asset_' + assetId + ' .asset-btn-visibility');
      if (btn) btn.textContent = asset.visible ? '👁️' : '🚫';
    };

    var origOpacity = BimViewer.updateAssetOpacity;
    BimViewer.updateAssetOpacity = function(assetId, opacity) {
      var asset = this.loadedAssets.get(String(assetId));
      if (!asset || asset.type !== 'I3S') return origOpacity.apply(this, arguments);
      asset.opacity = parseFloat(opacity);
      var valueEl = document.getElementById('opacityValue_' + assetId);
      if (valueEl) valueEl.textContent = Math.round(asset.opacity * 100) + '%';
      setOpacity(asset, asset.opacity);
    };

    var origSelect = BimViewer.handleIFCSelection;
    BimViewer.handleIFCSelection = async function(movement) {
      var result = await origSelect.apply(this, arguments);
      try {
        await showFields(this.selectedFeature, movement.position);
      } catch (err) {
        console.warn('I3S fields not available:', err);
      }
      return result;
    };

    // Cards: ui.js defines BimViewerUI after this file — wrap once it exists
    (function wrapCards(tries) {
      if (!window.BimViewerUI || typeof BimViewerUI.createAssetControls !== 'function') {
        if (tries < 100) setTimeout(function() { wrapCards(tries + 1); }, 100);
        return;
      }
      var origCreate = BimViewerUI.createAssetControls;
      BimViewerUI.createAssetControls = function(assetId) {
        var result = origCreate.apply(this, arguments);
        decorateCard(assetId);
        return result;
      };
    })(0);
  }

  hook();

  var tries = 0;
  (function poll() {
    if (injectDemo() || ++tries > 120) return;
    setTimeout(poll, 500);
  })();

  return {
    loadI3S: loadI3S,
    loadDemo: loadDemo,
    TERRAIN_ID: TERRAIN_ID
  };
})();
