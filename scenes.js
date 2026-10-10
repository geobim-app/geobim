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
// SCENES MODULE v1.0 (phase 1)
// A scene is a named, complete and georeferenced state that is saved and
// restored with one click ("scenes instead of screenshots"). Same JSON format
// as geoBIM Desktop's SavedScenes.json (GeoBIMSavedScenesSubsystem), so files
// can be exchanged:
//   {"scenes": [{version, iD, name, modified, cameraLongitudeLatitudeHeight,
//                cameraYaw, cameraPitch, assets, hiddenElements, cuts, ...}]}
// Format details taken from a real Desktop file (Unreal's FJsonObjectConverter):
// the id field is "iD", booleans keep the "b" prefix, enums are strings,
// vectors are {x: lon, y: lat, z: height}, dates "YYYY.MM.DD-HH.MM.SS" (UTC).
//
// Phase 1 captures and restores camera, assets (+ visibility), basemap /
// Google 3D Tiles, terrain and sun time. Hidden elements, cuts, measurements,
// annotations and placements are kept untouched in the file and reported as
// "not restored yet"; lights, weather and exposure are Desktop-only.
//
// Loading REPLACES the current state, in the Desktop's order: stop tools →
// assets → content → environment → camera last. Whatever could not be
// restored is collected and shown afterwards, it never aborts the load.
//
// Scenes live in memory for now (export to keep them); per-user storage in
// Firestore follows later. Unknown fields of imported scenes are kept on save.
// ===============================
'use strict';

(function() {

  var FORMAT_VERSION = 1;

  // Web basemap id <-> Cesium ion imagery asset (Desktop: imageryAssetId)
  var BASEMAP_ION = {
    'bing-aerial': 2,
    'bing-aerial-labels': 3,
    'bing-roads': 4,
    'google-sat-labels': 3830183,
    'google-contour': 3830186
  };

  BimViewer.scenes = {
    list: [],          // scene objects in Desktop format (unknown fields kept)
    activeId: 0,       // scene loaded or saved last
    flyTo: true,       // fly to the camera (else jump)
    loading: false
  };

  // =====================================
  // FORMAT HELPERS
  // =====================================

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // Unreal FDateTime text: 2026.10.01-18.25.30 (UTC)
  function unrealDate(d) {
    return d.getUTCFullYear() + '.' + pad(d.getUTCMonth() + 1) + '.' + pad(d.getUTCDate()) + '-' +
      pad(d.getUTCHours()) + '.' + pad(d.getUTCMinutes()) + '.' + pad(d.getUTCSeconds());
  }

  // Reads the Unreal format and ISO 8601
  function parseDate(s) {
    if (typeof s !== 'string') return null;
    var m = s.match(/^(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})/);
    var d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function normDeg(deg) {
    deg = ((deg % 360) + 360) % 360;
    return deg > 180 ? deg - 360 : deg;
  }

  // Stable negative id for a self-hosted model (Desktop uses negative ids for
  // local tilesets); FNV-1a over the folder / file name.
  function localId(name) {
    var h = 0x811c9dc5;
    for (var i = 0; i < name.length; i++) {
      h ^= name.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return -((h >>> 1) || 1);
  }

  // Folder (tileset) or file name (GLB) of a local path — works for
  // "model/Klagenfurt (IFC)/tileset.json?v=…" and Desktop's
  // "C:/Users/…/Klagenfurt (IFC)/tileset.json" alike
  function localKey(path) {
    if (!path) return '';
    var parts = String(path).split('?')[0].replace(/\\/g, '/').split('/').filter(Boolean);
    var last = parts[parts.length - 1] || '';
    var key = /^tileset\.json$/i.test(last) ? (parts[parts.length - 2] || '') : last;
    try { return decodeURIComponent(key); } catch (e) { return key; }
  }

  function count(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function len(a) { return Array.isArray(a) ? a.length : 0; }

  // "3 assets · 2 hidden · 1 cut · 13:00", like the Desktop's Summarize()
  BimViewer.summarizeScene = function(scene) {
    var parts = [];
    [['assets', 'asset', 'assets'], ['hiddenElements', 'hidden', 'hidden'], ['cuts', 'cut', 'cuts'],
     ['measurements', 'measurement', 'measurements'], ['annotations', 'annotation', 'annotations'],
     ['lights', 'light', 'lights']].forEach(function(f) {
      if (len(scene[f[0]])) parts.push(count(len(scene[f[0]]), f[1], f[2]));
    });
    if (typeof scene.solarTime === 'number' && isFinite(scene.solarTime)) {
      var t = ((scene.solarTime % 24) + 24) % 24;
      parts.push(pad(Math.floor(t)) + ':' + pad(Math.floor((t % 1) * 60)));
    }
    return parts.join(' · ');
  };

  BimViewer.sceneModifiedText = function(scene) {
    var d = parseDate(scene.modified);
    return d ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
  };

  // =====================================
  // CAPTURE
  // =====================================

  function captureCamera() {
    var cam = BimViewer.viewer.camera;
    var c = cam.positionCartographic;
    return {
      cameraLongitudeLatitudeHeight: {
        x: Cesium.Math.toDegrees(c.longitude),
        y: Cesium.Math.toDegrees(c.latitude),
        z: c.height
      },
      // Desktop yaw is east-south-up (0 = east, 90 = south), Cesium heading a
      // compass bearing (0 = north, 90 = east): yaw = heading − 90
      cameraYaw: normDeg(Cesium.Math.toDegrees(cam.heading) - 90),
      cameraPitch: Cesium.Math.toDegrees(cam.pitch)
    };
  }

  function captureAssets() {
    var assets = [];
    BimViewer.loadedAssets.forEach(function(ad, key) {
      if (/^itwin_/.test(key)) return; // iTwin demo: not part of the scene format
      var visible = ad.visible !== false;
      if (ad.modelDef && ad.modelDef.file) {
        var file = String(ad.modelDef.file).split('?')[0];
        assets.push({
          ionAssetId: localId(localKey(file)),
          name: ad.name || localKey(file),
          type: ad.modelDef.type === 'TILESET' ? '3DTILES' : 'GLTF',
          bVisible: visible,
          localPath: file
        });
      } else if (/^\d+$/.test(key)) {
        assets.push({
          ionAssetId: Number(key),
          name: ad.name || ('Asset ' + key),
          type: ad.type || '3DTILES',
          bVisible: visible,
          localPath: ''
        });
      }
    });
    return assets;
  }

  function captureEnvironment(lon) {
    var lm = window.LayerManager;
    var google = !!(BimViewer.googleTiles && BimViewer.googleTiles.enabled);
    // While Google 3D Tiles are on, the imagery basemap is parked here
    var basemap = (google && BimViewer.googleTiles.savedBasemapId) || (lm && lm.activeBasemap) || '';
    var terrain = (lm && lm.activeTerrain) || 'world';
    var tm = String(terrain).match(/^terrain_(\d+)$/);

    // Sun: local mean solar time at the camera's longitude (UTC + lon / 15 h),
    // month / day of that local date
    var now = Cesium.JulianDate.toDate(BimViewer.viewer.clock.currentTime);
    var local = new Date(now.getTime() + lon / 15 * 3600000);
    return {
      basemap: google ? 'GooglePhotorealistic' : 'WorldTerrain',
      imageryAssetId: BASEMAP_ION[basemap] || 0,
      terrainAssetId: tm ? Number(tm[1]) : 1,
      solarTime: local.getUTCHours() + local.getUTCMinutes() / 60 + local.getUTCSeconds() / 3600,
      month: local.getUTCMonth() + 1,
      day: local.getUTCDate(),
      // Web-only extra: the exact basemap (OSM, "none", …); Desktop ignores it
      webBasemap: basemap || 'none'
    };
  }

  // Fields phase 1 captures; everything else in a scene is left as it is
  function capture() {
    var cam = captureCamera();
    return Object.assign(
      { version: FORMAT_VERSION, modified: unrealDate(new Date()) },
      cam,
      { assets: captureAssets() },
      captureEnvironment(cam.cameraLongitudeLatitudeHeight.x)
    );
  }

  function nextId() {
    return BimViewer.scenes.list.reduce(function(m, s) { return Math.max(m, Number(s.iD) || 0); }, 0) + 1;
  }

  // =====================================
  // SAVE / UPDATE / RENAME / DELETE
  // =====================================

  function changed() {
    if (window.GEOBIM_SCENES_UI) GEOBIM_SCENES_UI.render();
  }

  BimViewer.saveNewScene = function(name) {
    name = String(name || '').trim() || ('Scene ' + nextId());
    var scene = Object.assign({ iD: nextId(), name: name }, capture(), {
      hiddenElements: [], cuts: [], bClippingEnabled: true, bClippingInverted: false,
      measurements: [], annotations: [], lights: [], placements: [], exposureEv: 0
    });
    // Keep the Desktop's key order: version, iD, name, modified, ...
    scene = Object.assign({ version: scene.version, iD: scene.iD, name: scene.name, modified: scene.modified }, scene);
    this.scenes.list.push(scene);
    this.scenes.activeId = scene.iD;
    changed();
    this.updateStatus('Scene saved: ' + name, 'success');
    return scene.iD;
  };

  // Overwrites the captured fields, keeps name, id and everything phase 1
  // doesn't capture yet (hidden elements, cuts, ... from Desktop files)
  BimViewer.updateScene = function(id) {
    var scene = this.getScene(id);
    if (!scene) return false;
    Object.assign(scene, capture());
    this.scenes.activeId = scene.iD;
    changed();
    this.updateStatus('Scene updated: ' + scene.name, 'success');
    return true;
  };

  BimViewer.renameScene = function(id, name) {
    var scene = this.getScene(id);
    name = String(name || '').trim();
    if (!scene || !name) return;
    scene.name = name;
    scene.modified = unrealDate(new Date());
    changed();
  };

  BimViewer.deleteScene = function(id) {
    var i = this.scenes.list.findIndex(function(s) { return s.iD === id; });
    if (i < 0) return;
    this.scenes.list.splice(i, 1);
    if (this.scenes.activeId === id) this.scenes.activeId = 0;
    changed();
  };

  BimViewer.getScene = function(id) {
    return this.scenes.list.find(function(s) { return s.iD === id; }) || null;
  };

  // =====================================
  // LOAD (replace, never mix)
  // =====================================

  // Ends every interactive tool so a click mode doesn't survive the switch
  BimViewer.deactivateAllTools = function() {
    try { if (this.isMeasuring && this.isMeasuring()) this.cancelMeasurement(); } catch (e) {}
    try {
      if (this.comments && this.comments.isAddingComment && this.toggleCommentMode) this.toggleCommentMode();
      ['clearAreaPreview', 'clearCirclePreview', 'removePreviewMarker', 'hideAreaFinishButton'].forEach(function(fn) {
        if (typeof BimViewer[fn] === 'function') BimViewer[fn]();
      });
    } catch (e) {}
    try { if (this.stopClippingDraw) this.stopClippingDraw(); } catch (e) {}
    try {
      if (window.BimGizmo) {
        BimGizmo.deselectModel();
        if (BimGizmo.isTransformMode()) BimGizmo.setTransformMode(false);
      }
    } catch (e) {}
    try {
      if (window.BimThirdPerson && BimThirdPerson.isActive()) BimThirdPerson.deactivate();
      if (window.BimFirstPerson && BimFirstPerson.isActive()) BimFirstPerson.deactivate();
    } catch (e) {}
    if (this.hiddenFeatures && this.hiddenFeatures.isHideMode && this.toggleHideMode) this.toggleHideMode();
  };

  async function ensureLocalModels() {
    if (!BimViewer.isLabUser || !BimViewer.isLabUser() || typeof BimViewer.fetchGLBModels !== 'function') return [];
    if (!BimViewer.glbModels || !BimViewer.glbModels.length) {
      try { await BimViewer.fetchGLBModels(); } catch (e) {}
    }
    return BimViewer.glbModels || [];
  }

  // Loaded-asset key a scene asset corresponds to (null = not loadable here)
  function findLocalDef(models, sceneAsset) {
    var key = localKey(sceneAsset.localPath);
    return models.find(function(m) { return localKey(m.file) === key; }) || null;
  }

  async function restoreAssets(scene, problems) {
    var wanted = Array.isArray(scene.assets) ? scene.assets : [];
    var models = wanted.some(function(a) { return a.localPath; }) ? await ensureLocalModels() : [];

    // Which loaded-asset key each scene asset maps to
    var plan = wanted.map(function(a) {
      if (a.localPath) {
        var def = findLocalDef(models, a);
        return { asset: a, def: def, key: def ? 'glb_' + def.id : null };
      }
      return { asset: a, key: a.ionAssetId > 0 ? String(a.ionAssetId) : null };
    });
    var keep = new Set(plan.map(function(p) { return p.key; }).filter(Boolean));

    // 1. Unload what the scene doesn't contain
    Array.from(BimViewer.loadedAssets.keys()).forEach(function(key) {
      if (!keep.has(key)) BimViewer.unloadAsset(key);
    });

    // With a connected ion account the asset list is the real one and tells
    // what this user can open; otherwise it may be a fallback list (demo /
    // static token), so just try to load.
    var oauth = typeof BimIonAuth !== 'undefined' && BimIonAuth.isOAuthConnected && BimIonAuth.isOAuthConnected();
    var available = oauth && Array.isArray(BimViewer.availableAssets) ? BimViewer.availableAssets : [];

    // 2. Load what is missing, set visibility
    for (var i = 0; i < plan.length; i++) {
      var p = plan[i], a = p.asset, label = a.name || a.ionAssetId;
      if (!p.key) {
        problems.push(a.localPath
          ? 'Local model "' + label + '" not found on the server (' + localKey(a.localPath) + ')'
          : 'Asset "' + label + '" has no valid id');
        continue;
      }
      if (!BimViewer.loadedAssets.has(p.key)) {
        if (p.def) {
          await BimViewer.loadGLBAsset(p.def);
        } else {
          if (available.length && !available.some(function(x) { return Number(x.id) === a.ionAssetId; })) {
            problems.push('No access to "' + label + '" (' + a.ionAssetId + ')');
            continue;
          }
          await BimViewer.loadSelectedAsset(a.ionAssetId, a.name || null, { noFlyTo: true, silent: true });
        }
        if (!BimViewer.loadedAssets.has(p.key)) {
          problems.push((p.def ? 'Could not load "' : 'No access to or could not load "') + label + '"' + (p.def ? '' : ' (' + a.ionAssetId + ')'));
          continue;
        }
      }
      var ad = BimViewer.loadedAssets.get(p.key);
      var want = a.bVisible !== false;
      if (ad && (ad.visible !== false) !== want) BimViewer.toggleAssetVisibility(p.key);
    }
  }

  // Content phase 1 doesn't restore yet: report it, don't drop it
  function reportPending(scene, problems) {
    var pending = [];
    [['hiddenElements', 'hidden element', 'hidden elements'], ['cuts', 'cut', 'cuts'],
     ['measurements', 'measurement', 'measurements'], ['annotations', 'annotation', 'annotations'],
     ['placements', 'placement', 'placements']].forEach(function(f) {
      if (len(scene[f[0]])) pending.push(count(len(scene[f[0]]), f[1], f[2]));
    });
    if (pending.length) problems.push('Not restored yet (coming in a later update): ' + pending.join(', '));
  }

  async function restoreEnvironment(scene, problems) {
    var lm = window.LayerManager;

    // Terrain (1 = Cesium World Terrain)
    if (lm && typeof scene.terrainAssetId === 'number') {
      var tid = scene.terrainAssetId > 1 ? 'terrain_' + scene.terrainAssetId : 'world';
      if (lm.activeTerrain !== tid) {
        if (tid === 'world' || lm.terrainLayers.some(function(t) { return t.id === tid; })) await lm.switchTerrain(tid);
        else await lm.setLocalTerrain(scene.terrainAssetId);
        if (lm.activeTerrain !== tid) problems.push('Terrain ' + scene.terrainAssetId + ' could not be loaded');
      }
    }

    // Google Photorealistic 3D Tiles on / off
    var wantGoogle = scene.basemap === 'GooglePhotorealistic';
    if (BimViewer.googleTiles && !!BimViewer.googleTiles.enabled !== wantGoogle && BimViewer.toggleGoogle3DTiles) {
      await BimViewer.toggleGoogle3DTiles();
    }

    // Imagery basemap: the web's exact choice, else the Desktop's ion imagery id
    if (lm) {
      var basemap = scene.webBasemap;
      if (!basemap || !lm.basemapLayers.some(function(b) { return b.id === basemap; })) {
        basemap = Object.keys(BASEMAP_ION).find(function(k) { return BASEMAP_ION[k] === scene.imageryAssetId; }) || null;
        if (!basemap && scene.imageryAssetId > 0) problems.push('Imagery ' + scene.imageryAssetId + ' is not a basemap here — kept the current one');
      }
      if (basemap) {
        if (wantGoogle) BimViewer.googleTiles.savedBasemapId = basemap; // applied when Google 3D Tiles go off
        else if (lm.activeBasemap !== basemap) await lm.switchBasemap(basemap);
      }
    }

    // Sun: local mean solar time at the scene camera → UTC on that date
    if (typeof scene.solarTime === 'number' && isFinite(scene.solarTime) && BimViewer.setTime) {
      var lon = scene.cameraLongitudeLatitudeHeight ? Number(scene.cameraLongitudeLatitudeHeight.x) || 0 : 0;
      var year = Cesium.JulianDate.toDate(BimViewer.viewer.clock.currentTime).getUTCFullYear();
      var month = Number(scene.month) || 6, day = Number(scene.day) || 21;
      var ms = Math.round((Date.UTC(year, month - 1, day) + (scene.solarTime - lon / 15) * 3600000) / 1000) * 1000;
      BimViewer.setTime(new Date(ms).toISOString());
    }
  }

  function restoreCamera(scene) {
    var c = scene.cameraLongitudeLatitudeHeight;
    if (!c || !isFinite(c.x) || !isFinite(c.y) || !isFinite(c.z)) return false;
    var options = {
      destination: Cesium.Cartesian3.fromDegrees(Number(c.x), Number(c.y), Number(c.z)),
      orientation: {
        heading: Cesium.Math.toRadians((Number(scene.cameraYaw) || 0) + 90),
        pitch: Cesium.Math.toRadians(Number(scene.cameraPitch) || 0),
        roll: 0
      }
    };
    var camera = BimViewer.viewer.camera;
    camera.cancelFlight();
    if (BimViewer.scenes.flyTo) camera.flyTo(Object.assign({ duration: 2 }, options));
    else camera.setView(options);
    return true;
  }

  BimViewer.loadScene = async function(id) {
    var scene = this.getScene(id);
    if (!scene || this.scenes.loading) return null;
    this.scenes.loading = true;
    changed();
    var problems = [];
    this.updateStatus('Loading scene "' + scene.name + '"...', 'loading');
    try {
      this.deactivateAllTools();
      await restoreAssets(scene, problems);
      reportPending(scene, problems);
      await restoreEnvironment(scene, problems);
      // Camera last: loaders of self-hosted models fly to the model themselves
      if (!restoreCamera(scene)) problems.push('The scene has no valid camera position');
      this.scenes.activeId = scene.iD;
    } catch (err) {
      console.error('Loading scene failed:', err);
      problems.push('Error: ' + err.message);
    } finally {
      this.scenes.loading = false;
    }
    this.scenes.lastProblems = problems;
    changed();
    this.updateStatus(problems.length
      ? 'Scene "' + scene.name + '" loaded — ' + count(problems.length, 'item', 'items') + ' could not be restored'
      : 'Scene loaded: ' + scene.name, problems.length ? 'warning' : 'success');
    return problems;
  };

  // Empty scene: unload all models, drop hidden elements and local
  // measurements. Camera, basemap and sun stay (like the Desktop's ClearCurrent).
  BimViewer.clearCurrentScene = function() {
    this.deactivateAllTools();
    Array.from(this.loadedAssets.keys()).forEach(function(key) { BimViewer.unloadAsset(key); });
    if (this.hiddenFeatures && this.hiddenFeatures.features.size && this.showAllHiddenFeatures) this.showAllHiddenFeatures();
    if (this.measurement && this.measurement.entities.length && this.clearMeasurements) this.clearMeasurements();
    this.scenes.activeId = 0;
    this.scenes.lastProblems = [];
    changed();
    this.updateStatus('New empty scene', 'success');
  };

  // =====================================
  // FILE EXPORT / IMPORT (SavedScenes.json)
  // =====================================

  BimViewer.exportScenes = function() {
    if (!this.scenes.list.length) {
      this.updateStatus('No scenes to export', 'warning');
      return;
    }
    // Tabs and the {"scenes": [...]} container, like the Desktop file
    var blob = new Blob([JSON.stringify({ scenes: this.scenes.list }, null, '\t')], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'SavedScenes.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function() { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  };

  function validScene(s) {
    var c = s && s.cameraLongitudeLatitudeHeight;
    return s && typeof s === 'object' && c && isFinite(c.x) && isFinite(c.y) && isFinite(c.z);
  }

  // Adds the scenes of a file (Desktop SavedScenes.json, an exported web file,
  // a single scene or an array). Ids that already exist get a new one.
  BimViewer.importScenes = function(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('Not a JSON file'); }
    var incoming = Array.isArray(data) ? data : (data && Array.isArray(data.scenes) ? data.scenes : [data]);
    var added = 0, skipped = 0;
    incoming.forEach(function(s) {
      if (!validScene(s)) { skipped++; return; }
      var scene = JSON.parse(JSON.stringify(s));
      // Plain "id" from other tools → the Desktop's "iD"
      if (scene.iD === undefined && scene.id !== undefined) { scene.iD = scene.id; delete scene.id; }
      if (!Number.isInteger(scene.iD) || BimViewer.getScene(scene.iD)) scene.iD = nextId();
      if (typeof scene.name !== 'string' || !scene.name.trim()) scene.name = 'Scene ' + scene.iD;
      BimViewer.scenes.list.push(scene);
      added++;
    });
    changed();
    return { added: added, skipped: skipped };
  };

  console.log('✅ Scenes module loaded v1.0 (phase 1)');

})();
