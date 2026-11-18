/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// ===============================
// CLIPPING IMPORT
// Clipping polygons that are not drawn by hand:
//  - from the model: a tileset with asset.extras.clipping (geobim-tile ≥ 1.9,
//    { polygon: [[lon, lat], …], crs, file }) offers its outline after loading.
//    Nothing is applied without the user's OK. The polygon remembers its asset;
//    removing the asset offers to remove the polygon too.
//  - from a file: "From file" in the clip panel takes Polygon / MultiPolygon
//    from GeoJSON, KML/KMZ, shapefile or FlatGeobuf (outer rings; holes and
//    points are ignored). Projected coordinates go through the same CRS
//    handling as a GIS drop (gis-files.js, proj4).
//  - from a GIS layer: "From GIS layer" takes the polygons of a layer that
//    was dropped on the map.
// All three end in BimViewer.addClippingPolygon (clipping.js), so the result
// is a normal clipping polygon: list, Enabled toggle, remove, excavation pit.
// ===============================
'use strict';

(function() {

  if (typeof BimViewer === 'undefined' || typeof BimViewer.addClippingPolygon !== 'function') {
    console.error('clipping-import.js needs clipping.js (BimViewer.addClippingPolygon)');
    return;
  }

  var FILE_ACCEPT = '.geojson,.json,.kml,.kmz,.zip,.shp,.dbf,.prj,.cpg,.shx,.fgb';
  var SAMPLE_TIMEOUT_MS = 8000;

  function status(msg, type) {
    if (typeof BimViewer.updateStatus === 'function') BimViewer.updateStatus(msg, type || 'success');
  }

  function viewer() { return BimViewer.viewer; }

  function baseName(name) { return String(name || '').replace(/\.[^.]+$/, ''); }

  // ---------------------------------------------------------------------------
  // GEOMETRY
  // ---------------------------------------------------------------------------

  // [[lon, lat, (h)], …] → [[lon, lat], …] without the closing point, repeated
  // points and invalid values; null if fewer than 3 corners remain
  function cleanRing(ring) {
    if (!Array.isArray(ring)) return null;
    var out = [];
    ring.forEach(function(p) {
      if (!Array.isArray(p)) return;
      var lon = +p[0], lat = +p[1];
      if (!isFinite(lon) || !isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) return;
      var last = out[out.length - 1];
      if (last && Math.abs(last[0] - lon) < 1e-10 && Math.abs(last[1] - lat) < 1e-10) return;
      out.push([lon, lat]);
    });
    if (out.length > 1) {
      var a = out[0], b = out[out.length - 1];
      if (Math.abs(a[0] - b[0]) < 1e-10 && Math.abs(a[1] - b[1]) < 1e-10) out.pop();
    }
    return out.length >= 3 ? out : null;
  }

  // Outer rings of all Polygon / MultiPolygon geometries: [{ ring, name }]
  function ringsFromGeoJson(geojson) {
    var out = [];
    function geometry(g, name) {
      if (!g) return;
      if (g.type === 'Polygon') {
        var r = cleanRing(g.coordinates && g.coordinates[0]);
        if (r) out.push({ ring: r, name: name });
      } else if (g.type === 'MultiPolygon') {
        (g.coordinates || []).forEach(function(poly) {
          var r = cleanRing(poly && poly[0]);
          if (r) out.push({ ring: r, name: name });
        });
      } else if (g.type === 'GeometryCollection') {
        (g.geometries || []).forEach(function(sub) { geometry(sub, name); });
      }
    }
    var list = !geojson ? [] :
      geojson.type === 'FeatureCollection' ? (geojson.features || []) :
      geojson.type === 'Feature' ? [geojson] :
      [{ type: 'Feature', properties: {}, geometry: geojson }];
    list.forEach(function(f) {
      var p = (f && f.properties) || {};
      geometry(f && f.geometry, p.name || p.Name || p.NAME || null);
    });
    return out;
  }

  // Polygons of a Cesium data source (KML/KMZ): [{ ring, name }]
  function ringsFromDataSource(ds) {
    var out = [];
    var now = Cesium.JulianDate.now();
    ds.entities.values.forEach(function(e) {
      if (!e.polygon || !e.polygon.hierarchy) return;
      var h = e.polygon.hierarchy.getValue(now);
      var positions = h && (h.positions || h);
      if (!Array.isArray(positions)) return;
      var r = cleanRing(positions.map(function(c) {
        var g = Cesium.Cartographic.fromCartesian(c);
        return g ? [Cesium.Math.toDegrees(g.longitude), Cesium.Math.toDegrees(g.latitude)] : null;
      }));
      if (r) out.push({ ring: r, name: e.name || null });
    });
    return out;
  }

  // Lowest corner of the tileset's root bounding volume (ellipsoidal), or null
  function tilesetBottom(tileset) {
    try {
      var bv = tileset && tileset.root && tileset.root.boundingVolume;
      var obb = bv && bv.boundingVolume;
      if (obb instanceof Cesium.OrientedBoundingBox) {
        var min = Infinity;
        Cesium.OrientedBoundingBox.computeCorners(obb).forEach(function(c) {
          var g = Cesium.Cartographic.fromCartesian(c);
          if (g && g.height < min) min = g.height;
        });
        if (isFinite(min)) return min;
      }
      var bs = tileset && tileset.boundingSphere;
      if (bs) {
        var c = Cesium.Cartographic.fromCartesian(bs.center);
        if (c) return c.height - Math.min(bs.radius, 50);
      }
    } catch (e) { /* fall back to the ground */ }
    return null;
  }

  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise(function(resolve) { setTimeout(function() { resolve(null); }, ms); })]);
  }

  // Ground heights (terrain or Google 3D Tiles, loaded models excluded); only
  // for the cyan outline, the clipping itself ignores heights
  async function groundHeights(cartos) {
    var v = viewer();
    var scene = v.scene;
    var heights = cartos.map(function() { return null; });
    try {
      if (scene.sampleHeightSupported) {
        var exclude = [];
        BimViewer.loadedAssets.forEach(function(ad) {
          if (ad.tileset) exclude.push(ad.tileset);
          if (ad.model) exclude.push(ad.model);
        });
        var probe = cartos.map(function(c) { return Cesium.Cartographic.clone(c); });
        var res = await withTimeout(scene.sampleHeightMostDetailed(probe, exclude), SAMPLE_TIMEOUT_MS);
        if (res) res.forEach(function(c, i) { if (c && isFinite(c.height)) heights[i] = c.height; });
      }
    } catch (e) { /* not available for this scene, fall back to the globe */ }
    var globe = scene.globe;
    return heights.map(function(h, i) {
      if (h != null) return h;
      var g = globe && globe.getHeight(cartos[i]);
      return isFinite(g) ? g : 0;
    });
  }

  // [{ ring, name }] → clipping polygons. opts: { source, assetId, height, name }
  async function addRings(rings, opts) {
    var added = [];
    for (var i = 0; i < rings.length; i++) {
      var cartos = rings[i].ring.map(function(p) { return Cesium.Cartographic.fromDegrees(p[0], p[1], 0); });
      var heights = isFinite(opts.height)
        ? cartos.map(function() { return opts.height; })
        : await groundHeights(cartos);
      var points = cartos.map(function(c, j) {
        return Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, heights[j]);
      });
      var name = rings[i].name || opts.name || null;
      if (name && rings.length > 1 && !rings[i].name) name += ' ' + (i + 1);
      var polygon = BimViewer.addClippingPolygon(points, {
        source: opts.source,
        assetId: opts.assetId,
        name: name
      });
      if (polygon) added.push(polygon);
    }
    return added;
  }

  function flyToPolygons(polygons) {
    var pts = [];
    polygons.forEach(function(p) { pts = pts.concat(p.points); });
    if (!pts.length) return;
    var bs = Cesium.BoundingSphere.fromPoints(pts);
    viewer().camera.flyToBoundingSphere(bs, {
      duration: 1.5,
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), Math.max(bs.radius * 2.5, 200))
    });
  }

  // ---------------------------------------------------------------------------
  // READING FILES
  // ---------------------------------------------------------------------------

  async function ringsFromItems(items) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var rings = [];
      if (item.kind === 'geojson') {
        rings = ringsFromGeoJson(item.geojson);
      } else if (item.kind === 'cesium' && (item.format === 'KML' || item.format === 'KMZ')) {
        var v = viewer();
        var ds = await Cesium.KmlDataSource.load(item.file, { camera: v.scene.camera, canvas: v.scene.canvas });
        rings = ringsFromDataSource(ds);
      }
      rings.forEach(function(r) { if (!r.name) r.name = item.name; });
      out = out.concat(rings);
    }
    return out;
  }

  async function readFiles(fileList) {
    var gis = window.GEOBIM_GIS_FILES;
    if (!gis || typeof gis.readForImport !== 'function') throw new Error('GIS file support is not loaded');
    var res = await gis.readForImport(fileList);
    if (!res.items.length && res.skipped.length) throw new Error('Not a supported file: ' + res.skipped.join(', '));
    return ringsFromItems(res.items);
  }

  // GeoJSON object (any CRS named in it) → rings, through the same CRS handling
  function ringsFromGeoJsonAnyCrs(geojson, name) {
    var file = new File([JSON.stringify(geojson)], (name || 'clipping') + '.geojson', { type: 'application/geo+json' });
    return readFiles([file]);
  }

  async function importFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return [];
    var label = files.length === 1 ? files[0].name : files.length + ' files';
    try {
      status('Reading ' + label + '...', 'loading');
      var rings = await readFiles(files);
      if (!rings.length) {
        status('No polygon in ' + label + ' (points and lines are ignored)', 'warning');
        return [];
      }
      var added = await addRings(rings, { source: 'file', name: baseName(files[0].name) });
      flyToPolygons(added);
      status(added.length === 1
        ? 'Clipping polygon from ' + label + ' (' + added[0].points.length + ' points)'
        : added.length + ' clipping polygons from ' + label, 'success');
      return added;
    } catch (err) {
      console.error('Clipping import failed:', label, err);
      status(label + ': ' + err.message, 'error');
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // GIS LAYERS
  // ---------------------------------------------------------------------------

  function layerRings(layer) {
    if (layer.geojson) return ringsFromGeoJson(layer.geojson);
    if (layer.dataSource) return ringsFromDataSource(layer.dataSource);
    return [];
  }

  async function importLayer(layer) {
    var rings = layerRings(layer);
    if (!rings.length) {
      status('No polygon in ' + layer.name, 'warning');
      return [];
    }
    rings.forEach(function(r) { if (!r.name) r.name = layer.name; });
    var added = await addRings(rings, { source: 'layer', name: layer.name });
    status(added.length === 1
      ? 'Clipping polygon from ' + layer.name + ' (' + added[0].points.length + ' points)'
      : added.length + ' clipping polygons from ' + layer.name, 'success');
    return added;
  }

  function chooseLayer() {
    var gis = window.GEOBIM_GIS_FILES;
    var layers = (gis && typeof gis.layers === 'function' ? gis.layers() : []).filter(function(l) {
      return layerRings(l).length > 0;
    });
    if (!layers.length) {
      status('No GIS layer with polygons — drop a GeoJSON, KML or shapefile on the map first', 'warning');
      return;
    }
    if (layers.length === 1) { importLayer(layers[0]); return; }
    showOffer('layer-choice', {
      icon: 'layers',
      title: 'Clipping polygons from which GIS layer?',
      actions: layers.map(function(l) {
        return { label: l.name, run: function() { importLayer(l); } };
      }).concat([{ label: 'Cancel', secondary: true }])
    });
  }

  // ---------------------------------------------------------------------------
  // OFFER CARDS (non-blocking, nothing happens without a click)
  // ---------------------------------------------------------------------------

  var offers = new Map();   // key → card element
  var stack = null;

  function closeOffer(key) {
    var card = offers.get(key);
    if (!card) return;
    offers.delete(key);
    card.remove();
    if (stack && !stack.children.length) { stack.remove(); stack = null; }
  }

  function showOffer(key, o) {
    closeOffer(key);
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'clip-offer-stack';
      document.body.appendChild(stack);
    }
    var card = document.createElement('div');
    card.className = 'clip-offer';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-live', 'polite');
    var title = document.createElement('div');
    title.className = 'clip-offer-title';
    var icon = document.createElement('i');
    icon.setAttribute('data-lucide', o.icon || 'scissors');
    var tt = document.createElement('span');
    tt.textContent = o.title;
    title.appendChild(icon);
    title.appendChild(tt);
    card.appendChild(title);
    if (o.text) {
      var text = document.createElement('div');
      text.className = 'modern-hint';
      text.textContent = o.text;
      card.appendChild(text);
    }
    var row = document.createElement('div');
    row.className = 'clip-offer-actions';
    o.actions.forEach(function(a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'modern-btn ' + (a.secondary ? 'modern-btn-secondary' : 'modern-btn-primary');
      b.textContent = a.label;
      b.addEventListener('click', function() {
        closeOffer(key);
        if (a.run) a.run();
      });
      row.appendChild(b);
    });
    card.appendChild(row);
    stack.appendChild(card);
    offers.set(key, card);
    if (window.lucide) lucide.createIcons();
    requestAnimationFrame(function() { card.classList.add('visible'); });
  }

  // ---------------------------------------------------------------------------
  // FROM THE MODEL (asset.extras.clipping)
  // ---------------------------------------------------------------------------

  function linkedPolygons(assetId) {
    var key = String(assetId);
    return BimViewer.clipping.polygons.filter(function(p) { return p.assetId === key; });
  }

  function besideTileset(file, name) {
    return /tileset\.json(\?.*)?$/.test(file) ? file.replace(/tileset\.json(\?.*)?$/, name) : null;
  }

  // Rings the model brings: the inline polygon, else the file named in extras
  // next to tileset.json (a missing file is not an error)
  async function modelRings(assetData, clip) {
    var crs = String(clip.crs || 'EPSG:4326');
    var wgs84 = /^(EPSG:(4326|4258)|.*CRS84)$/i.test(crs);
    if (Array.isArray(clip.polygon) && clip.polygon.length >= 3) {
      var geom = { type: 'Polygon', coordinates: [clip.polygon] };
      if (wgs84) return ringsFromGeoJson(geom);
      return ringsFromGeoJsonAnyCrs({
        type: 'FeatureCollection',
        crs: { type: 'name', properties: { name: crs } },
        features: [{ type: 'Feature', properties: {}, geometry: geom }]
      }, assetData.name);
    }
    if (typeof clip.file === 'string' && /^[\w.\-]+\.(geo)?json$/i.test(clip.file)) {
      var url = null;
      var tileset = assetData.tileset;
      if (assetData.modelDef && typeof assetData.modelDef.file === 'string') {
        url = besideTileset(assetData.modelDef.file, clip.file);
      } else if (tileset && tileset.resource && typeof tileset.resource.getDerivedResource === 'function') {
        url = tileset.resource.getDerivedResource({ url: clip.file });
      }
      if (!url) return [];
      try {
        var res = typeof url === 'string'
          ? await fetch(url, { cache: 'no-cache' }).then(function(r) { return r.ok ? r.json() : null; })
          : await url.fetchJson();
        if (!res) return [];
        var name = res.crs && res.crs.properties && res.crs.properties.name;
        return (!name || /CRS84|EPSG:+(4326|4258)$/i.test(name))
          ? ringsFromGeoJson(res)
          : ringsFromGeoJsonAnyCrs(res, assetData.name);
      } catch (e) {
        return [];
      }
    }
    return [];
  }

  async function checkAsset(assetId) {
    var key = String(assetId);
    var ad = BimViewer.loadedAssets.get(key);
    if (!ad || !ad.tileset || ad.isGLB) return;
    var asset;
    try { asset = ad.tileset.asset; } catch (e) { return; }
    var clip = asset && asset.extras && asset.extras.clipping;
    if (!clip || typeof clip !== 'object') return;
    if (linkedPolygons(key).length) return;   // already applied (e.g. scene reload)

    var rings;
    try { rings = await modelRings(ad, clip); } catch (e) { rings = []; }
    if (!rings.length) {
      console.warn('Clipping outline in ' + ad.name + ' could not be read', clip);
      return;
    }
    if (BimViewer.loadedAssets.get(key) !== ad) return;   // removed meanwhile

    var corners = rings.length === 1 ? rings[0].ring.length + ' corners' : rings.length + ' polygons';
    showOffer('load:' + key, {
      title: 'This model comes with a clipping outline — apply it?',
      text: ad.name + ' (' + corners + '). Cuts the Google 3D Tiles, OSM buildings or terrain inside the outline so the model stands in their place.',
      actions: [
        { label: 'Not now', secondary: true },
        { label: 'Apply', run: function() { applyFromModel(key, rings); } }
      ]
    });
  }

  async function applyFromModel(key, rings) {
    var ad = BimViewer.loadedAssets.get(key);
    if (!ad) { status('The model is no longer loaded', 'warning'); return; }
    if (linkedPolygons(key).length) return;
    var bottom = tilesetBottom(ad.tileset);
    var added = await addRings(rings, {
      source: 'model',
      assetId: key,
      name: ad.name,
      height: bottom != null ? bottom : NaN
    });
    if (added.length) {
      status('Clipping outline of ' + ad.name + ' applied (' + added[0].points.length + ' points)', 'success');
      if (typeof plausible !== 'undefined') plausible('Feature Used', { props: { feature: 'Clipping from model' } });
    }
  }

  // Every load path (Ion, self-hosted, server models, scenes) ends in
  // loadedAssets.set(); the tileset JSON (asset.extras) is loaded by then
  function hookLoads() {
    var map = BimViewer.loadedAssets;
    if (!map || map._clipImportHooked) return;
    var origSet = map.set;
    map.set = function(k, v) {
      var r = origSet.call(this, k, v);
      setTimeout(function() { checkAsset(k).catch(function() {}); }, 0);
      return r;
    };
    map._clipImportHooked = true;
  }

  function hookUnload() {
    var origUnload = BimViewer.unloadAsset;
    if (typeof origUnload !== 'function') return;
    BimViewer.unloadAsset = function(assetId) {
      var key = String(assetId);
      var ad = this.loadedAssets.get(key);
      var name = ad ? ad.name : 'the model';
      var result = origUnload.apply(this, arguments);
      closeOffer('load:' + key);
      var linked = linkedPolygons(key);
      if (linked.length) {
        showOffer('unload:' + key, {
          title: 'Also remove the clipping outline of ' + name + '?',
          text: linked.length === 1 ? 'The clipping polygon came with the model.' : linked.length + ' clipping polygons came with the model.',
          actions: [
            { label: 'Keep', secondary: true },
            { label: 'Remove', run: function() {
              linkedPolygons(key).forEach(function(p) { BimViewer.removeClippingPolygon(p.id); });
            } }
          ]
        });
      }
      return result;
    };
  }

  // ---------------------------------------------------------------------------
  // CLIP PANEL BUTTONS (classic sidebar and panel UI share the same DOM)
  // ---------------------------------------------------------------------------

  function makeButton(id, icon, label, title) {
    var b = document.createElement('button');
    b.id = id;
    b.type = 'button';
    b.className = 'modern-btn modern-btn-small modern-btn-secondary clip-import-btn';
    b.title = title;
    var i = document.createElement('span');
    i.className = 'modern-btn-icon';
    var li = document.createElement('i');
    li.setAttribute('data-lucide', icon);
    i.appendChild(li);
    var t = document.createElement('span');
    t.textContent = label;
    b.appendChild(i);
    b.appendChild(t);
    return b;
  }

  function addButtons() {
    var rect = document.getElementById('startClippingRect') || document.getElementById('startClippingDraw');
    if (!rect || document.getElementById('clipImportFile')) return !!rect;
    var group = rect.parentElement;

    var input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = FILE_ACCEPT;
    input.className = 'clip-import-input';
    input.id = 'clipImportFileInput';
    input.setAttribute('aria-hidden', 'true');
    input.tabIndex = -1;
    input.addEventListener('change', function() {
      var files = input.files;
      importFiles(files).then(function() { input.value = ''; });
    });

    var fileBtn = makeButton('clipImportFile', 'file-up', 'From file', 'Clipping polygon from a GeoJSON, KML or shapefile (polygons only)');
    fileBtn.addEventListener('click', function() { input.click(); });
    var layerBtn = makeButton('clipImportLayer', 'layers', 'From GIS layer', 'Clipping polygon from a GIS layer dropped on the map');
    layerBtn.addEventListener('click', chooseLayer);

    group.appendChild(fileBtn);
    group.appendChild(layerBtn);
    group.appendChild(input);
    if (window.lucide) lucide.createIcons();
    return true;
  }

  function watchPanel() {
    addButtons();
    // The clip section is (re)rendered by ui.js / panels-measure.js
    var obs = new MutationObserver(function() {
      if (document.getElementById('startClippingDraw') && !document.getElementById('clipImportFile')) addButtons();
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  hookLoads();
  hookUnload();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchPanel);
  else watchPanel();

  window.BimClippingImport = {
    importFiles: importFiles,
    importLayer: importLayer,
    chooseLayer: chooseLayer,
    checkAsset: checkAsset,
    ringsFromGeoJson: ringsFromGeoJson
  };

})();
