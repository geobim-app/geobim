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
// GIS FILES — local vector files on the map (drag & drop or file picker)
// ===============================
// GeoJSON, Shapefile (.zip or .shp + .dbf + .prj [+ .cpg]), KML/KMZ, GPX and
// FlatGeobuf are read in the browser and shown as Cesium data sources: draped
// on the terrain, or with the file's Z heights (above sea level, lifted by the
// geoid like the coordinate tool). Projected coordinates are converted with
// proj4: the CRS comes from the file (GeoJSON "crs", .prj, FlatGeobuf header),
// otherwise the user picks it. Nothing is uploaded; the layers last until the
// page is reloaded. Clicking a feature shows its attributes in the InfoBox
// (features.js handles data source entities).
'use strict';

window.GEOBIM_GIS_FILES = (function() {

  var SHPJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/shpjs/6.2.0/shp.min.js';
  var FGB_URL = 'https://cdn.jsdelivr.net/npm/flatgeobuf@4.6.0/dist/esm/geojson.js/+esm';
  var PROJ4_URL = 'https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.22.0/proj4.js';

  var EXT = /\.(geojson|json|zip|shp|dbf|prj|cpg|shx|kml|kmz|gpx|fgb)$/i;
  var COLORS = ['#2ECFB0', '#F5A623', '#E85D75', '#4A90E2', '#B57EDC', '#7ED321', '#F8E71C', '#50E3C2'];
  var MANY_FEATURES = 20000;

  // ETRS89 is treated as WGS 84 like everywhere in geobim.app (and the tiler)
  var CRS = {
    4326: { name: 'WGS 84 (lon/lat)', def: '+proj=longlat +datum=WGS84 +no_defs' },
    4258: { name: 'ETRS89 (lon/lat)', def: '+proj=longlat +datum=WGS84 +no_defs' },
    3857: { name: 'Web Mercator', def: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs' },
    25831: { name: 'ETRS89 / UTM 31N', def: '+proj=utm +zone=31 +datum=WGS84 +units=m +no_defs' },
    25832: { name: 'ETRS89 / UTM 32N', def: '+proj=utm +zone=32 +datum=WGS84 +units=m +no_defs' },
    25833: { name: 'ETRS89 / UTM 33N', def: '+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs' },
    32631: { name: 'WGS 84 / UTM 31N', def: '+proj=utm +zone=31 +datum=WGS84 +units=m +no_defs' },
    32632: { name: 'WGS 84 / UTM 32N', def: '+proj=utm +zone=32 +datum=WGS84 +units=m +no_defs' },
    32633: { name: 'WGS 84 / UTM 33N', def: '+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs' },
    // DHDN Gauss-Krüger with the 7-parameter shift (about 1 m)
    31466: { name: 'DHDN / Gauss-Krüger 2 (±1 m)', def: '+proj=tmerc +lat_0=0 +lon_0=6 +k=1 +x_0=2500000 +y_0=0 +ellps=bessel +towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7 +units=m +no_defs' },
    31467: { name: 'DHDN / Gauss-Krüger 3 (±1 m)', def: '+proj=tmerc +lat_0=0 +lon_0=9 +k=1 +x_0=3500000 +y_0=0 +ellps=bessel +towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7 +units=m +no_defs' },
    31468: { name: 'DHDN / Gauss-Krüger 4 (±1 m)', def: '+proj=tmerc +lat_0=0 +lon_0=12 +k=1 +x_0=4500000 +y_0=0 +ellps=bessel +towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7 +units=m +no_defs' },
    31469: { name: 'DHDN / Gauss-Krüger 5 (±1 m)', def: '+proj=tmerc +lat_0=0 +lon_0=15 +k=1 +x_0=5500000 +y_0=0 +ellps=bessel +towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7 +units=m +no_defs' },
    2056: { name: 'CH1903+ / LV95', def: '+proj=somerc +lat_0=46.9524055555556 +lon_0=7.43958333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs' },
    31287: { name: 'MGI / Austria Lambert', def: '+proj=lcc +lat_0=47.5 +lon_0=13.3333333333333 +lat_1=49 +lat_2=46 +x_0=400000 +y_0=400000 +ellps=bessel +towgs84=577.326,90.129,463.919,5.137,1.474,5.297,2.4232 +units=m +no_defs' },
    3035: { name: 'ETRS89 / LAEA Europe', def: '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +datum=WGS84 +units=m +no_defs' }
  };

  var layers = [];
  var nextId = 1;
  var scripts = {};

  // ---- Helpers ----

  function status(msg, type) {
    if (typeof BimViewer !== 'undefined' && BimViewer.updateStatus) BimViewer.updateStatus(msg, type);
  }

  function loadScript(url) {
    if (!scripts[url]) {
      scripts[url] = new Promise(function(resolve, reject) {
        var s = document.createElement('script');
        s.src = url;
        s.onload = resolve;
        s.onerror = function() { delete scripts[url]; reject(new Error('Failed to load ' + url)); };
        document.head.appendChild(s);
      });
    }
    return scripts[url];
  }

  function loadProj4() {
    return typeof proj4 !== 'undefined' ? Promise.resolve() : loadScript(PROJ4_URL);
  }

  function escapeHtml(v) {
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function baseName(name) { return name.replace(/\.[^.]+$/, ''); }

  function readText(file) { return file.text(); }
  function readBuffer(file) { return file.arrayBuffer(); }

  // Calls fn(position) for every coordinate array of a GeoJSON geometry
  function eachPosition(geometry, fn) {
    if (!geometry) return;
    if (geometry.type === 'GeometryCollection') {
      (geometry.geometries || []).forEach(function(g) { eachPosition(g, fn); });
      return;
    }
    (function walk(c) {
      if (!Array.isArray(c)) return;
      if (typeof c[0] === 'number') { fn(c); return; }
      c.forEach(walk);
    })(geometry.coordinates);
  }

  function features(geojson) {
    if (!geojson) return [];
    if (geojson.type === 'FeatureCollection') return geojson.features || [];
    if (geojson.type === 'Feature') return [geojson];
    if (geojson.type) return [{ type: 'Feature', properties: {}, geometry: geojson }];
    return [];
  }

  function toCollection(geojson) {
    return { type: 'FeatureCollection', features: features(geojson) };
  }

  function sampleRange(geojson) {
    var r = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, hasZ: false, n: 0 };
    features(geojson).forEach(function(f) {
      eachPosition(f.geometry, function(p) {
        r.n++;
        if (p[0] < r.minX) r.minX = p[0];
        if (p[0] > r.maxX) r.maxX = p[0];
        if (p[1] < r.minY) r.minY = p[1];
        if (p[1] > r.maxY) r.maxY = p[1];
        if (p.length > 2 && typeof p[2] === 'number' && p[2] !== 0) r.hasZ = true;
      });
    });
    return r;
  }

  function looksGeographic(r) {
    return r.n > 0 && r.minX >= -180 && r.maxX <= 180 && r.minY >= -90 && r.maxY <= 90;
  }

  // Best guess for projected coordinates without CRS information
  function guessCrs(r) {
    var x = (r.minX + r.maxX) / 2, y = (r.minY + r.maxY) / 2;
    if (x > 2.4e6 && x < 5.9e6 && y > 5.2e6 && y < 6.2e6) return 31464 + Math.floor(x / 1e6);
    if (x > 2.4e6 && x < 2.9e6 && y > 1.0e6 && y < 1.4e6) return 2056;
    return 25832;
  }

  function epsgFromName(name) {
    if (!name) return null;
    if (/CRS84/i.test(name)) return 4326;
    var m = String(name).match(/EPSG(?::|::|\/|\D+)(\d{4,5})\s*$/i) || String(name).match(/EPSG\D*(\d{4,5})/i);
    return m ? parseInt(m[1], 10) : null;
  }

  // ---- CRS dialog ----

  function askCrs(fileName, reason, guess) {
    return new Promise(function(resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'gis-crs-overlay';
      var box = document.createElement('div');
      box.className = 'gis-crs-dialog';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      var title = document.createElement('div');
      title.className = 'gis-crs-title';
      title.textContent = 'Coordinate system of ' + fileName;
      var text = document.createElement('div');
      text.className = 'modern-hint';
      text.textContent = reason;
      var select = document.createElement('select');
      select.className = 'modern-select';
      Object.keys(CRS).forEach(function(code) {
        var o = document.createElement('option');
        o.value = code;
        o.textContent = 'EPSG:' + code + ' — ' + CRS[code].name;
        if (+code === guess) o.selected = true;
        select.appendChild(o);
      });
      var row = document.createElement('div');
      row.className = 'gis-crs-actions';
      var cancel = document.createElement('button');
      cancel.className = 'modern-btn modern-btn-secondary';
      cancel.textContent = 'Cancel';
      var apply = document.createElement('button');
      apply.className = 'modern-btn modern-btn-primary';
      apply.textContent = 'Apply';
      row.appendChild(cancel);
      row.appendChild(apply);
      box.appendChild(title);
      box.appendChild(text);
      box.appendChild(select);
      box.appendChild(row);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      select.focus();
      function done(v) {
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        resolve(v);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); done(null); }
      }
      document.addEventListener('keydown', onKey, true);
      cancel.addEventListener('click', function() { done(null); });
      apply.addEventListener('click', function() { done(parseInt(select.value, 10)); });
      overlay.addEventListener('click', function(e) { if (e.target === overlay) done(null); });
    });
  }

  // Reprojects a GeoJSON object in place to lon/lat; null if the user cancelled
  async function toWgs84(geojson, fileName, epsg) {
    var r = sampleRange(geojson);
    if (r.n === 0) throw new Error('No features with coordinates');
    if (epsg === 4326 || epsg === 4258) return { geojson: geojson, epsg: 4326, range: r };
    if (!epsg && looksGeographic(r)) return { geojson: geojson, epsg: 4326, range: r };
    if (!epsg || !CRS[epsg]) {
      var reason = epsg
        ? 'EPSG:' + epsg + ' is not built in. Choose the matching coordinate system:'
        : 'The file does not say which coordinate system it uses. Choose it:';
      epsg = await askCrs(fileName, reason, guessCrs(r));
      if (!epsg) return null;
      if (epsg === 4326 || epsg === 4258) return { geojson: geojson, epsg: epsg, range: r };
    }
    await loadProj4();
    var def = CRS[epsg].def;
    features(geojson).forEach(function(f) {
      eachPosition(f.geometry, function(p) {
        var ll = proj4(def, 'WGS84', [p[0], p[1]]);
        p[0] = ll[0];
        p[1] = ll[1];
      });
    });
    return { geojson: geojson, epsg: epsg, range: sampleRange(geojson) };
  }

  // ---- Readers (all return { kind, name, geojson?, crsHint?, dataSourcePromise? }) ----

  async function readGeoJson(file) {
    var json;
    try { json = JSON.parse(await readText(file)); } catch (e) { throw new Error('Not valid JSON'); }
    if (!json || !/^(FeatureCollection|Feature|Point|MultiPoint|LineString|MultiLineString|Polygon|MultiPolygon|GeometryCollection)$/.test(json.type)) {
      throw new Error('Not a GeoJSON file');
    }
    var crsName = json.crs && json.crs.properties && json.crs.properties.name;
    return { kind: 'geojson', format: 'GeoJSON', name: baseName(file.name), geojson: toCollection(json), epsg: epsgFromName(crsName) };
  }

  async function readShapefileZip(file) {
    await loadScript(SHPJS_URL);
    var result = await shp(await readBuffer(file));
    var list = Array.isArray(result) ? result : [result];
    return list.map(function(fc, i) {
      var name = fc.fileName ? fc.fileName.split('/').pop() : baseName(file.name) + (list.length > 1 ? ' ' + (i + 1) : '');
      // shpjs reprojects with the .prj; without one the coordinates stay as they are
      return { kind: 'geojson', format: 'Shapefile', name: name, geojson: toCollection(fc), epsg: null };
    });
  }

  async function readShapefileParts(group) {
    await loadScript(SHPJS_URL);
    var prj = group.prj ? await readText(group.prj) : undefined;
    var cpg = group.cpg ? await readText(group.cpg) : undefined;
    var geoms = shp.parseShp(await readBuffer(group.shp), prj);
    var props = group.dbf ? shp.parseDbf(await readBuffer(group.dbf), cpg) : geoms.map(function() { return {}; });
    var fc = shp.combine([geoms, props]);
    return { kind: 'geojson', format: 'Shapefile', name: baseName(group.shp.name), geojson: toCollection(fc), epsg: null };
  }

  async function readFlatGeobuf(file) {
    var fgb = await import(FGB_URL);
    var header = null;
    var list = [];
    var iter = fgb.deserialize(new Uint8Array(await readBuffer(file)), { headerMetaFn: function(h) { header = h; } });
    for await (var f of iter) list.push(f);
    var epsg = header && header.crs && header.crs.org && /epsg/i.test(header.crs.org) ? header.crs.code : null;
    return { kind: 'geojson', format: 'FlatGeobuf', name: baseName(file.name), geojson: { type: 'FeatureCollection', features: list }, epsg: epsg };
  }

  // Cesium ignores KML SchemaData (written by GDAL / QGIS): turn SimpleData into Data
  async function readKml(file) {
    var text = await readText(file);
    if (/<SimpleData\b/.test(text)) {
      text = text
        .replace(/<SchemaData\b[^>]*>/g, '').replace(/<\/SchemaData>/g, '')
        .replace(/<SimpleData\s+name="([^"]*)"\s*>([\s\S]*?)<\/SimpleData>/g, '<Data name="$1"><value>$2</value></Data>')
        .replace(/<SimpleData\s+name="([^"]*)"\s*\/>/g, '<Data name="$1"><value></value></Data>');
    }
    var blob = new Blob([text], { type: 'application/vnd.google-earth.kml+xml' });
    return { kind: 'cesium', format: 'KML', name: baseName(file.name), file: blob };
  }

  function readCesium(file, format) {
    return { kind: 'cesium', format: format, name: baseName(file.name), file: file };
  }

  // Groups dropped files: shapefile parts by base name, everything else alone
  function plan(files) {
    var groups = {};
    var jobs = [];
    var skipped = [];
    files.forEach(function(f) {
      var m = f.name.match(EXT);
      if (!m) { skipped.push(f.name); return; }
      var ext = m[1].toLowerCase();
      if (/^(shp|dbf|prj|cpg|shx)$/.test(ext)) {
        var key = baseName(f.name).toLowerCase();
        (groups[key] = groups[key] || {})[ext] = f;
      } else {
        jobs.push({ ext: ext, file: f });
      }
    });
    Object.keys(groups).forEach(function(k) {
      if (groups[k].shp) jobs.push({ ext: 'shp', group: groups[k] });
      else skipped.push(k + '.dbf/.prj (no .shp)');
    });
    return { jobs: jobs, skipped: skipped };
  }

  async function read(job) {
    switch (job.ext) {
      case 'geojson': case 'json': return [await readGeoJson(job.file)];
      case 'zip': return readShapefileZip(job.file);
      case 'shp': return [await readShapefileParts(job.group)];
      case 'fgb': return [await readFlatGeobuf(job.file)];
      case 'kml': return [await readKml(job.file)];
      case 'kmz': return [readCesium(job.file, 'KMZ')];
      case 'gpx': return [readCesium(job.file, 'GPX')];
    }
    return [];
  }

  // ---- Display ----

  // Copy with Z turned into ellipsoidal heights (file Z = above sea level)
  function liftZ(geojson) {
    var copy = JSON.parse(JSON.stringify(geojson));
    features(copy).forEach(function(f) {
      eachPosition(f.geometry, function(p) {
        var z = p.length > 2 && typeof p[2] === 'number' ? p[2] : 0;
        var g = typeof GEOBIM_GEOID !== 'undefined' ? GEOBIM_GEOID.toOrthometric(0, p[1], p[0]) : null;
        p[2] = z + (g ? g.undulation : 0);
      });
    });
    return copy;
  }

  // InfoBox shows values as HTML: escape everything that came from the file
  function safeProperties(entity) {
    var bag = {};
    var props = entity.properties;
    if (props && props.propertyNames) {
      props.propertyNames.forEach(function(k) {
        var v = props[k] && props[k].getValue ? props[k].getValue() : props[k];
        if (v !== null && typeof v === 'object') v = JSON.stringify(v);
        bag[escapeHtml(k)] = v === null || v === undefined ? v : escapeHtml(v);
      });
    }
    // KML / GPX: name, plain-text description, extended data
    if (entity.kml && entity.kml.extendedData) {
      Object.keys(entity.kml.extendedData).forEach(function(k) {
        var d = entity.kml.extendedData[k];
        bag[escapeHtml(d.displayName || k)] = escapeHtml(d.value);
      });
    }
    if (entity.description && !Object.keys(bag).length) {
      var desc = entity.description.getValue ? entity.description.getValue(Cesium.JulianDate.now()) : entity.description;
      var tmp = document.createElement('div');
      tmp.innerHTML = String(desc || '');
      var text = tmp.textContent.trim();
      if (text) bag.Description = escapeHtml(text.slice(0, 500));
    }
    if (entity.name) {
      entity.name = escapeHtml(entity.name);
      if (!('name' in bag) && !('Name' in bag)) bag.Name = entity.name;
    }
    entity.properties = new Cesium.PropertyBag(bag);
  }

  function styleEntities(ds, color, clamp) {
    var c = Cesium.Color.fromCssColorString(color);
    ds.entities.values.forEach(function(e) {
      safeProperties(e);
      if (e.billboard) {
        e.billboard.disableDepthTestDistance = Number.POSITIVE_INFINITY;
        if (clamp) e.billboard.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
      }
      if (e.polyline) {
        e.polyline.material = c;
        e.polyline.width = 3;
      }
      if (e.polygon) {
        e.polygon.material = c.withAlpha(0.35);
        e.polygon.outlineColor = c;
        // Z in the file makes GeoJsonDataSource use per-position heights even
        // when clamping: the polygon would sit at its (sea level) Z under the terrain
        if (clamp) {
          e.polygon.perPositionHeight = false;
          e.polygon.outline = false;
        }
      }
      if (e.point) e.point.color = c;
    });
  }

  async function buildDataSource(layer) {
    var color = layer.color;
    var clamp = layer.mode !== 'z';
    var ds;
    if (layer.kind === 'cesium') {
      var opts = { clampToGround: true, camera: BimViewer.viewer.scene.camera, canvas: BimViewer.viewer.scene.canvas };
      ds = layer.format === 'GPX'
        ? await Cesium.GpxDataSource.load(layer.file, { clampToGround: true })
        : await Cesium.KmlDataSource.load(layer.file, opts);
    } else {
      var data = clamp ? layer.geojson : liftZ(layer.geojson);
      ds = await Cesium.GeoJsonDataSource.load(data, {
        clampToGround: clamp,
        stroke: Cesium.Color.fromCssColorString(color),
        fill: Cesium.Color.fromCssColorString(color).withAlpha(0.35),
        strokeWidth: 3,
        markerColor: Cesium.Color.fromCssColorString(color),
        markerSize: 32
      });
    }
    try { ds.name = 'GIS file: ' + layer.name; } catch (e) { /* GpxDataSource: name is read-only */ }
    styleEntities(ds, color, clamp);
    return ds;
  }

  // Cesium hands the scene clock to the first data source with time data (GPX
  // tracks, timed KML): the sun would jump to the track's date. Keep the clock.
  async function addToViewer(ds) {
    var viewer = BimViewer.viewer;
    var c = viewer.clock;
    var saved = {
      startTime: c.startTime.clone(), stopTime: c.stopTime.clone(), currentTime: c.currentTime.clone(),
      multiplier: c.multiplier, clockRange: c.clockRange, clockStep: c.clockStep, shouldAnimate: c.shouldAnimate
    };
    await viewer.dataSources.add(ds);
    if (viewer.clockTrackedDataSource === ds) {
      viewer.clockTrackedDataSource = undefined;
      Object.keys(saved).forEach(function(k) { c[k] = saved[k]; });
      if (viewer.timeline) viewer.timeline.zoomTo(saved.startTime, saved.stopTime);
    }
  }

  async function addLayer(item) {
    var viewer = BimViewer.viewer;
    var layer = {
      id: 'gis_' + (nextId++),
      name: item.name,
      format: item.format,
      kind: item.kind,
      file: item.file,
      color: COLORS[(nextId - 2) % COLORS.length],
      mode: 'clamp',
      visible: true
    };
    if (item.kind === 'geojson') {
      var res = await toWgs84(item.geojson, item.name, item.epsg);
      if (!res) { status('Not added: ' + item.name, 'warning'); return null; }
      if (!looksGeographic(res.range)) throw new Error('Coordinates are outside lon/lat after conversion — wrong coordinate system?');
      layer.geojson = res.geojson;
      layer.epsg = res.epsg;
      layer.hasZ = res.range.hasZ;
      layer.bbox = [res.range.minX, res.range.minY, res.range.maxX, res.range.maxY];
      layer.count = features(res.geojson).length;
      if (layer.count > MANY_FEATURES) status(item.name + ': ' + layer.count + ' features — the map may get slow', 'warning');
    }
    layer.dataSource = await buildDataSource(layer);
    if (item.kind === 'cesium') layer.count = layer.dataSource.entities.values.length;
    // GPX track with timestamps: playable (gis-track-player.js)
    if (layer.format === 'GPX') {
      var moving = layer.dataSource.entities.values.find(function(e) { return e.position instanceof Cesium.SampledPositionProperty; });
      if (moving) {
        layer.track = { entity: moving };
        // The track line sits on the same entity, which is only "available"
        // during the track's time: without this it is invisible at today's
        // scene time. The moving pin has no position outside that time anyway.
        moving.availability = undefined;
      }
    }
    await addToViewer(layer.dataSource);
    layers.push(layer);
    render();
    return layer;
  }

  async function addFiles(fileList) {
    if (typeof BimViewer === 'undefined' || !BimViewer.viewer) return [];
    var files = Array.prototype.slice.call(fileList || []);
    var p = plan(files);
    if (p.skipped.length && !p.jobs.length) {
      status('Not a supported GIS file: ' + p.skipped.join(', '), 'error');
      return [];
    }
    var added = [];
    for (var i = 0; i < p.jobs.length; i++) {
      var job = p.jobs[i];
      var label = job.file ? job.file.name : job.group.shp.name;
      try {
        status('Reading ' + label + '...', 'loading');
        var items = await read(job);
        for (var j = 0; j < items.length; j++) {
          var layer = await addLayer(items[j]);
          if (layer) added.push(layer);
        }
      } catch (err) {
        console.error('GIS file failed:', label, err);
        status(label + ': ' + err.message, 'error');
      }
    }
    if (added.length) {
      var last = added[added.length - 1];
      zoomTo(last.id);
      status(added.length === 1
        ? 'Added ' + last.name + ' (' + last.count + ' features)'
        : 'Added ' + added.length + ' GIS files', 'success');
    }
    return added;
  }

  function find(id) { return layers.find(function(l) { return l.id === id; }); }

  // Draped points have no usable bounding sphere: GeoJSON-based layers fly to
  // a sphere around their own extent on the terrain, KML / GPX use Cesium's
  async function zoomTo(id) {
    var l = find(id);
    if (!l) return;
    var viewer = BimViewer.viewer;
    if (!l.bbox) {
      viewer.flyTo(l.dataSource, { duration: 1.5 });
      return;
    }
    var lon = (l.bbox[0] + l.bbox[2]) / 2, lat = (l.bbox[1] + l.bbox[3]) / 2;
    var sw = Cesium.Cartesian3.fromDegrees(l.bbox[0], l.bbox[1]);
    var ne = Cesium.Cartesian3.fromDegrees(l.bbox[2], l.bbox[3]);
    var radius = Math.max(Cesium.Cartesian3.distance(sw, ne) / 2, 75);
    var height = 0;
    try {
      var c = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [Cesium.Cartographic.fromDegrees(lon, lat)]);
      height = c[0].height || 0;
    } catch (e) { /* ellipsoid or no availability */ }
    viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lon, lat, height), radius),
      { offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-50), radius * 3), duration: 1.5 }
    );
  }

  function toggle(id) {
    var l = find(id);
    if (!l) return;
    l.visible = !l.visible;
    l.dataSource.show = l.visible;
    render();
  }

  async function setMode(id, mode) {
    var l = find(id);
    if (!l || l.kind !== 'geojson' || l.mode === mode) return;
    l.mode = mode;
    var old = l.dataSource;
    l.dataSource = await buildDataSource(l);
    l.dataSource.show = l.visible;
    await addToViewer(l.dataSource);
    BimViewer.viewer.dataSources.remove(old, true);
    render();
  }

  function remove(id) {
    var l = find(id);
    if (!l) return;
    if (typeof GEOBIM_TRACK_PLAYER !== 'undefined' && GEOBIM_TRACK_PLAYER.isPlaying(id)) GEOBIM_TRACK_PLAYER.stop();
    BimViewer.viewer.dataSources.remove(l.dataSource, true);
    layers.splice(layers.indexOf(l), 1);
    render();
  }

  // ---- UI ----

  function iconButton(icon, title, action, active) {
    var b = document.createElement('button');
    b.className = 'layer-toggle-btn gis-file-btn' + (active ? ' active' : '');
    b.title = title;
    b.setAttribute('aria-label', title);
    b.dataset.action = action;
    var i = document.createElement('i');
    i.setAttribute('data-lucide', icon);
    b.appendChild(i);
    return b;
  }

  function render() {
    var list = document.getElementById('gisFilesList');
    if (!list) return;
    list.innerHTML = '';
    if (!layers.length) {
      var empty = document.createElement('div');
      empty.className = 'modern-empty-state';
      empty.textContent = 'No GIS files';
      list.appendChild(empty);
      return;
    }
    layers.forEach(function(l) {
      var row = document.createElement('div');
      row.className = 'layer-overlay-item gis-file-row' + (l.visible ? '' : ' is-hidden');
      row.dataset.id = l.id;
      var head = document.createElement('div');
      head.className = 'layer-overlay-header';
      var sw = document.createElement('span');
      sw.className = 'gis-file-swatch';
      sw.style.setProperty('--gis-color', l.color);
      var name = document.createElement('span');
      name.className = 'layer-overlay-name';
      name.textContent = l.name;
      name.title = l.name;
      var actions = document.createElement('div');
      actions.className = 'layer-overlay-actions';
      if (l.track && typeof GEOBIM_TRACK_PLAYER !== 'undefined') {
        var playing = GEOBIM_TRACK_PLAYER.isPlaying(l.id);
        actions.appendChild(iconButton(playing ? 'square' : 'play', playing ? 'Stop playback' : 'Play track as a camera flight', 'play', playing));
      }
      if (l.hasZ) actions.appendChild(iconButton('mountain', l.mode === 'z' ? 'Using Z heights (above sea level) — click to drape on terrain' : 'Draped on terrain — click to use the Z heights (above sea level)', 'mode', l.mode === 'z'));
      actions.appendChild(iconButton('crosshair', 'Zoom to', 'zoom'));
      actions.appendChild(iconButton(l.visible ? 'eye' : 'eye-off', l.visible ? 'Hide' : 'Show', 'toggle', l.visible));
      var rm = iconButton('x', 'Remove', 'remove');
      rm.className = 'layer-remove-btn gis-file-btn';
      actions.appendChild(rm);
      head.appendChild(sw);
      head.appendChild(name);
      head.appendChild(actions);
      var meta = document.createElement('div');
      meta.className = 'layer-overlay-meta';
      var parts = [l.format, l.count + (l.count === 1 ? ' feature' : ' features')];
      if (l.epsg && l.epsg !== 4326) parts.push('EPSG:' + l.epsg);
      parts.push(l.mode === 'z' ? 'Z heights' : 'on terrain');
      meta.textContent = parts.join(' · ');
      row.appendChild(head);
      row.appendChild(meta);
      list.appendChild(row);
    });
    if (window.lucide) lucide.createIcons();
  }

  function wireUi() {
    var list = document.getElementById('gisFilesList');
    var btn = document.getElementById('gisFilesAddBtn');
    var input = document.getElementById('gisFilesInput');
    if (!list || list.dataset.wired) return !!list;
    list.dataset.wired = '1';
    if (btn && input) {
      btn.addEventListener('click', function() { input.click(); });
      input.addEventListener('change', function() {
        addFiles(input.files).finally(function() { input.value = ''; });
      });
    }
    list.addEventListener('click', function(e) {
      var b = e.target.closest('[data-action]');
      var row = e.target.closest('.gis-file-row');
      if (!b || !row) return;
      var id = row.dataset.id;
      var l = find(id);
      if (b.dataset.action === 'zoom') zoomTo(id);
      else if (b.dataset.action === 'toggle') toggle(id);
      else if (b.dataset.action === 'remove') remove(id);
      else if (b.dataset.action === 'mode' && l) setMode(id, l.mode === 'z' ? 'clamp' : 'z');
      else if (b.dataset.action === 'play' && l) {
        if (GEOBIM_TRACK_PLAYER.isPlaying(id)) GEOBIM_TRACK_PLAYER.stop();
        else GEOBIM_TRACK_PLAYER.start(l).finally(render);
        render();
      }
    });
    render();
    return true;
  }

  // ---- Drag & drop onto the page ----

  var dropHint = null;
  var dragDepth = 0;

  function hasFiles(e) {
    var t = e.dataTransfer && e.dataTransfer.types;
    return !!t && Array.prototype.indexOf.call(t, 'Files') !== -1;
  }

  function showDropHint(show) {
    if (show && !dropHint) {
      dropHint = document.createElement('div');
      dropHint.className = 'gis-drop-hint';
      var inner = document.createElement('div');
      inner.className = 'gis-drop-hint-box';
      var icon = document.createElement('i');
      icon.setAttribute('data-lucide', 'map-pinned');
      var text = document.createElement('span');
      text.textContent = 'Drop GIS files to add them to the map';
      inner.appendChild(icon);
      inner.appendChild(text);
      dropHint.appendChild(inner);
      document.body.appendChild(dropHint);
      if (window.lucide) lucide.createIcons();
    }
    if (dropHint) dropHint.classList.toggle('visible', !!show);
  }

  function wireDrop() {
    document.addEventListener('dragenter', function(e) {
      if (!hasFiles(e)) return;
      dragDepth++;
      showDropHint(true);
    });
    document.addEventListener('dragleave', function(e) {
      if (!hasFiles(e)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) showDropHint(false);
    });
    document.addEventListener('dragover', function(e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    document.addEventListener('drop', function(e) {
      if (!hasFiles(e)) return;
      dragDepth = 0;
      showDropHint(false);
      // Leave drops on file inputs and other drop zones alone
      if (e.target && e.target.closest && e.target.closest('input[type="file"], [data-own-drop]')) return;
      e.preventDefault();
      var files = Array.prototype.slice.call(e.dataTransfer.files || []);
      if (!files.some(function(f) { return EXT.test(f.name); })) {
        status('Not a supported GIS file: ' + files.map(function(f) { return f.name; }).join(', '), 'error');
        return;
      }
      addFiles(files);
    });
  }

  function init() {
    wireDrop();
    // The Layers section is rendered by ui-layer-section.js; wire it once it exists
    if (!wireUi()) {
      var obs = new MutationObserver(function() { if (wireUi()) obs.disconnect(); });
      obs.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return {
    render: render,
    addFiles: addFiles,
    layers: function() { return layers.slice(); },
    remove: remove,
    zoomTo: zoomTo,
    setMode: setMode,
    CRS: CRS
  };

})();
