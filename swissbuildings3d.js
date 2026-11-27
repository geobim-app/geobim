/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// ===============================
// SWISSBUILDINGS3D — swisstopo buildings as 3D Tiles (Layers → 3D Layers)
// ===============================
// swisstopo streams swissBUILDINGS3D as open 3D Tiles, the tileset
// map.geo.admin.ch shows in 3D: version 3.0 (Beta) where it exists, 2.0
// elsewhere, with EGID and the swisstopo attributes per building. No key,
// CORS open, commercial use allowed with the source "© swisstopo"; fair use
// covers web apps with about 20,000 users a day (geo.admin.ch/terms-of-use).
//
// Heights: the tiles carry LN02 heights (m ü. M.) written as if they were
// ellipsoidal — at Zürich HB the tile top is 433.8 m, the roof's DACH_MAX
// 433.82 m. Cesium terrain is ellipsoidal, so the raw buildings sit about
// 49 m below ground. Mapterhorn delivers the same swissALTI3D heights
// (408.25 m there, GELAENDEPUNKT 408.24 m) and lifts every sample by
// EGM2008 (mapterhorn-terrain.js); the buildings get the same EGM2008 lift
// at the view centre, so both line up. In Switzerland EGM2008 changes by
// centimetres per kilometre, one vertical shift per camera stop is enough.
'use strict';

(function() {

  var ID = 'swissbuildings3d';
  var URL = 'https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/tileset.json';
  var CREDIT = '3D-Gebäude © <a href="https://www.swisstopo.admin.ch" target="_blank" rel="noopener">swisstopo</a>';
  // Switzerland and Liechtenstein with a small margin: the lift is taken
  // inside these bounds, outside them there are no buildings anyway
  var BOUNDS = { west: 5.9, east: 10.55, south: 45.8, north: 47.85 };
  var MIN_SHIFT_CHANGE = 0.01;   // m, below that the model matrix stays

  var entry = {
    id: ID,
    name: 'swissBUILDINGS3D',
    description: 'Gebäude Schweiz und Liechtenstein (swisstopo, Open Data)',
    url: URL,
    tileset: null,
    active: false,
    loading: false
  };
  var credit = null;
  var moveEndRemove = null;
  var loadToken = 0;
  var lastShift = null;          // Cartesian3 translation currently applied

  function status(msg, type) {
    if (typeof BimViewer !== 'undefined' && BimViewer.updateStatus) BimViewer.updateStatus(msg, type);
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // Point on the ground in the middle of the screen, camera position as fallback
  function viewCentre(viewer) {
    var scene = viewer.scene, canvas = scene.canvas;
    var mid = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
    var ray = viewer.camera.getPickRay(mid);
    var p = ray ? scene.globe.pick(ray, scene) : undefined;
    if (!p) p = viewer.camera.pickEllipsoid(mid, scene.globe.ellipsoid);
    return p ? Cesium.Cartographic.fromCartesian(p) : viewer.camera.positionCartographic;
  }

  // Lifts the tileset by EGM2008 at the view centre (see the header)
  function align() {
    var tileset = entry.tileset, viewer = LayerManager.viewer;
    if (!tileset || !viewer) return;
    var c = viewCentre(viewer);
    var lon = clamp(Cesium.Math.toDegrees(c.longitude), BOUNDS.west, BOUNDS.east);
    var lat = clamp(Cesium.Math.toDegrees(c.latitude), BOUNDS.south, BOUNDS.north);
    var n = GEOBIM_MAPTERHORN.egm2008(lat, lon);
    if (n === null) return;
    var lonR = Cesium.Math.toRadians(lon), latR = Cesium.Math.toRadians(lat);
    var shift = Cesium.Cartesian3.subtract(
      Cesium.Cartesian3.fromRadians(lonR, latR, n),
      Cesium.Cartesian3.fromRadians(lonR, latR, 0),
      new Cesium.Cartesian3()
    );
    if (lastShift && Cesium.Cartesian3.distance(shift, lastShift) < MIN_SHIFT_CHANGE) return;
    tileset.modelMatrix = Cesium.Matrix4.fromTranslation(shift);
    lastShift = shift;
    entry.heightOffset = n;
  }

  function inSwitzerland(viewer) {
    var c = viewCentre(viewer);
    var lon = Cesium.Math.toDegrees(c.longitude), lat = Cesium.Math.toDegrees(c.latitude);
    return lon >= BOUNDS.west && lon <= BOUNDS.east && lat >= BOUNDS.south && lat <= BOUNDS.north;
  }

  async function enable() {
    var viewer = LayerManager.viewer;
    if (!viewer || entry.active || entry.loading) return;
    if (viewer.scene.mode !== Cesium.SceneMode.SCENE3D) {
      status('swissBUILDINGS3D nur im 3D-Modus verfügbar', 'warning');
      return;
    }
    var token = ++loadToken;
    entry.loading = true;
    LayerManager.updateTilesetUI();
    status('Loading swissBUILDINGS3D...', 'loading');
    try {
      await GEOBIM_MAPTERHORN.loadGeoid();
      var tileset = await Cesium.Cesium3DTileset.fromUrl(URL, {
        // map.geo.admin.ch uses 10: with the default 16 distant tiles stay out (gaps)
        maximumScreenSpaceError: 10
      });
      if (token !== loadToken) { tileset.destroy(); return; }   // switched off meanwhile
      entry.tileset = tileset;
      lastShift = null;
      align();   // before the first frame, so traversal starts at the right height
      viewer.scene.primitives.add(tileset);
      if (typeof BimViewer.enableTilesetLighting === 'function') BimViewer.enableTilesetLighting(tileset);
      if (typeof BimViewer.configureDynamicEnvMaps === 'function') BimViewer.configureDynamicEnvMaps(tileset);
      moveEndRemove = viewer.camera.moveEnd.addEventListener(align);
      credit = new Cesium.Credit(CREDIT, false);
      viewer.creditDisplay.addStaticCredit(credit);
      entry.active = true;
      entry.loading = false;
      LayerManager.updateTilesetUI();
      status(inSwitzerland(viewer)
        ? 'swissBUILDINGS3D loaded'
        : 'swissBUILDINGS3D loaded — buildings appear in Switzerland and Liechtenstein', 'success');
    } catch (err) {
      if (token !== loadToken) return;
      console.error('swissBUILDINGS3D failed:', err);
      entry.tileset = null;
      entry.loading = false;
      LayerManager.updateTilesetUI();
      status('swissBUILDINGS3D nicht erreichbar', 'error');
    }
  }

  function disable() {
    var viewer = LayerManager.viewer;
    loadToken++;
    if (moveEndRemove) { moveEndRemove(); moveEndRemove = null; }
    if (credit && viewer) { viewer.creditDisplay.removeStaticCredit(credit); credit = null; }
    if (entry.tileset && viewer) viewer.scene.primitives.remove(entry.tileset);
    if (BimViewer.selectedFeature && BimViewer.selectedFeature.tileset === entry.tileset) BimViewer.selectedFeature = undefined;
    entry.tileset = null;
    entry.active = false;
    entry.loading = false;
    entry.heightOffset = null;
    lastShift = null;
    LayerManager.updateTilesetUI();
  }

  // ---- InfoBox: the swisstopo attributes with readable names ----

  function val(f, name) {
    var v = f.getProperty(name);
    if (v === undefined || v === null) return null;
    if (typeof v === 'string') { v = v.trim(); return v === '' || v === 'undefined' ? null : v; }
    return v;
  }

  function metres(v) { return typeof v === 'number' ? v.toFixed(2) + ' m' : v; }

  function monthYear(month, year) {
    if (!year) return null;
    return month ? String(month).padStart(2, '0') + '/' + year : String(year);
  }

  function buildingProperties(f) {
    var props = {};
    function put(label, v) { if (v !== null && v !== undefined && v !== '') props[label] = v; }
    put('Objektart', val(f, 'OBJEKTART'));
    put('EGID', val(f, 'EGID'));
    put('Name', val(f, 'NAME_KOMPLETT'));
    put('Nutzung', val(f, 'GEBAEUDE_NUTZUNG'));
    put('Gebäudehöhe', metres(val(f, 'GESAMTHOEHE')));
    put('Dach max. (m ü. M.)', metres(val(f, 'DACH_MAX')));
    put('Dach min. (m ü. M.)', metres(val(f, 'DACH_MIN')));
    put('Geländehöhe (m ü. M.)', metres(val(f, 'GELAENDEPUNKT')));
    var origin = val(f, 'HERKUNFT'), captured = monthYear(val(f, 'HERKUNFT_MONAT'), val(f, 'HERKUNFT_JAHR'));
    put('Erfassung', [origin, captured].filter(Boolean).join(', ') || null);
    put('Revision', monthYear(val(f, 'REVISION_MONAT'), val(f, 'REVISION_JAHR')));
    put('Änderungsgrund', val(f, 'GRUND_AENDERUNG'));
    put('UUID', val(f, 'UUID'));
    props['Quelle'] = 'swisstopo swissBUILDINGS3D';
    return props;
  }

  // features.js picks every 3D Tiles feature and passes all its raw
  // properties here; for a swisstopo building show the curated set instead
  function hookInfoBox() {
    var orig = BimViewer.displayIFCProperties;
    if (typeof orig !== 'function' || orig._swissBuildings) return;
    var wrapped = function(properties) {
      var f = BimViewer.selectedFeature;
      if (entry.tileset && f instanceof Cesium.Cesium3DTileFeature && f.tileset === entry.tileset) {
        try { properties = buildingProperties(f); } catch (e) { console.warn('swissBUILDINGS3D properties:', e); }
      }
      return orig.call(this, properties);
    };
    wrapped._swissBuildings = true;
    BimViewer.displayIFCProperties = wrapped;
  }

  // ---- Layer Manager integration ----

  function register() {
    if (!LayerManager.tilesetLayers.some(function(t) { return t.id === ID; })) {
      LayerManager.tilesetLayers.push(entry);
    }
    LayerManager.updateTilesetUI();
    hookInfoBox();
  }

  function hook() {
    if (typeof LayerManager === 'undefined' || typeof GEOBIM_MAPTERHORN === 'undefined') return;

    var origInit = LayerManager.init;
    LayerManager.init = async function() {
      var result = await origInit.apply(this, arguments);
      register();
      return result;
    };
    if (LayerManager.viewer) register();   // init already ran

    var origEnable = LayerManager.enableTileset;
    LayerManager.enableTileset = function(id) {
      return id === ID ? enable() : origEnable.apply(this, arguments);
    };
    var origDisable = LayerManager.disableTileset;
    LayerManager.disableTileset = function(id) {
      return id === ID ? disable() : origDisable.apply(this, arguments);
    };
  }

  hook();

  window.GEOBIM_SWISSBUILDINGS3D = {
    ID: ID,
    entry: entry,
    align: align
  };

})();
