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
// PLACEMENT MODULE v1.0
// Position self-hosted models like GLBs and save the result (owner only).
//
// - Self-hosted IFC tilesets get Lon / Lat / Height fields next to the heading
//   slider, kept in sync with the gizmo (it drives updateAssetPlacement).
// - A tileset whose file has no georeferencing (tiler placement source
//   "upload position" / "none") and no saved placement lands in the centre of
//   the view on load, like a GLB. Tiler 1.5 anchors such models at the centre
//   of their footprint, bottom, so that point sits on the chosen spot.
// - "Save position" (owner only, checked server-side with the Firebase ID
//   token in api/placement-save.php): tilesets get a new root.transform in
//   tileset.json, GLBs an entry in model/placements.json that api/models.php
//   hands out as default position / heading / scale. "Reset" restores the
//   original.
// ===============================
'use strict';

(function() {

  var FALLBACK_SOURCES = /^(upload position|none)/;

  function isOwner() {
    return typeof BimViewer.isLabUser === 'function' && BimViewer.isLabUser();
  }

  function tilesetFolder(modelDef) {
    var m = modelDef && modelDef.file && modelDef.file.match(/^model\/([^/]+)\/tileset\.json/);
    return m ? m[1] : null;
  }

  function glbFile(modelDef) {
    var m = modelDef && modelDef.file && modelDef.file.match(/^model\/([^/?]+\.(glb|gltf))$/i);
    return m ? m[1] : null;
  }

  function isSelfHostedTileset(ad) {
    return ad && !ad.isGLB && ad.tileset && ad.placement && ad.modelDef && ad.modelDef.type === 'TILESET';
  }

  function isServerGLB(ad) {
    return ad && ad.isGLB && ad.position && glbFile(ad.modelDef);
  }

  function placementSource(tileset) {
    var extras = tileset && tileset.asset && tileset.asset.extras;
    return (extras && extras.placement && extras.placement.source) || '';
  }

  // =====================================
  // LOAD: non-georeferenced tilesets go to the view centre
  // =====================================

  function viewCentre() {
    var viewer = BimViewer.viewer;
    var ray = viewer.camera.getPickRay(new Cesium.Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2));
    var hit = ray && viewer.scene.globe.pick(ray, viewer.scene);
    if (!hit) return null;
    var c = Cesium.Cartographic.fromCartesian(hit);
    return { lon: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude), height: c.height || 0 };
  }

  if (typeof BimViewer.initAssetPlacement === 'function') {
    var origInit = BimViewer.initAssetPlacement;
    BimViewer.initAssetPlacement = function(assetData) {
      var p = origInit.apply(this, arguments);
      if (p && isSelfHostedTileset(assetData) && FALLBACK_SOURCES.test(placementSource(assetData.tileset))) {
        var c = viewCentre();
        if (c) {
          p.position = c;
          p.baseHeight = c.height;
          p.heading = 0;
          this.updateAssetPlacement(String(assetData.id));
          this.updateStatus(assetData.name + ' has no georeferencing — placed in the centre of the view', 'warning');
        }
      }
      return p;
    };
  }

  // Saved GLB placements win over the hard-coded glbModelOverrides.
  if (typeof BimViewer.fetchGLBModels === 'function') {
    var origFetch = BimViewer.fetchGLBModels;
    BimViewer.fetchGLBModels = async function() {
      var list = await origFetch.apply(this, arguments);
      (list || []).forEach(function(m) {
        var s = m.savedPlacement;
        if (!s) return;
        m.defaultPosition = { lon: s.lon, lat: s.lat, height: s.height };
        m.defaultHeading = s.heading;
        m.defaultScale = s.scale;
      });
      return list;
    };
  }

  // =====================================
  // TILESET POSITION FIELDS
  // =====================================

  function fieldId(key, assetId) { return 'ts_' + key + '_' + assetId; }

  function syncTilesetFields(assetId) {
    var ad = BimViewer.loadedAssets.get(assetId);
    if (!isSelfHostedTileset(ad)) return;
    var p = ad.placement.position;
    [['lon', p.lon.toFixed(7)], ['lat', p.lat.toFixed(7)], ['height', p.height.toFixed(2)]].forEach(function(kv) {
      var el = document.getElementById(fieldId(kv[0], assetId));
      if (el && document.activeElement !== el) el.value = kv[1];
    });
    var hs = document.getElementById('tileset_heading_' + assetId);
    if (hs && document.activeElement !== hs) hs.value = ad.placement.heading || 0;
    var hv = document.getElementById('tileset_heading_val_' + assetId);
    if (hv) hv.textContent = Math.round(ad.placement.heading || 0) + '°';
  }

  if (typeof BimViewer.updateAssetPlacement === 'function') {
    var origUpdate = BimViewer.updateAssetPlacement;
    BimViewer.updateAssetPlacement = function(assetId) {
      var r = origUpdate.apply(this, arguments);
      syncTilesetFields(String(assetId));
      return r;
    };
  }

  BimViewer.setTilesetPlacementField = function(assetId, key, value) {
    var ad = this.loadedAssets.get(assetId);
    var v = parseFloat(String(value).replace(',', '.'));
    if (!isSelfHostedTileset(ad) || !isFinite(v)) { syncTilesetFields(assetId); return; }
    if (key === 'lon' && (v < -180 || v > 180)) { syncTilesetFields(assetId); return; }
    if (key === 'lat' && (v < -90 || v > 90)) { syncTilesetFields(assetId); return; }
    ad.placement.position[key] = v;
    this.updateAssetPlacement(assetId);
  };

  function injectTilesetFields(assetId, ad) {
    if (document.getElementById(fieldId('lon', assetId))) return;
    var headingSlider = document.getElementById('tileset_heading_' + assetId);
    var anchor = headingSlider && headingSlider.closest('.modern-group');
    if (!anchor) return;
    var p = ad.placement.position;
    var input = function(key, label, step, value) {
      return '<label class="placement-field">' +
        '<span class="placement-field-label">' + label + '</span>' +
        '<input type="number" step="' + step + '" value="' + value + '" id="' + fieldId(key, assetId) + '" ' +
          'class="zoffset-input-box placement-input" ' +
          'onchange="BimViewer.setTilesetPlacementField(\'' + assetId + '\',\'' + key + '\',this.value)">' +
      '</label>';
    };
    var html =
      '<div class="modern-group placement-fields" id="placementFields_' + assetId + '">' +
        '<label class="modern-label-small">Position</label>' +
        '<div class="placement-grid">' +
          input('lon', 'Lon', '0.00001', p.lon.toFixed(7)) +
          input('lat', 'Lat', '0.00001', p.lat.toFixed(7)) +
        '</div>' +
        input('height', 'Height (m)', '0.1', p.height.toFixed(2)) +
      '</div>';
    anchor.insertAdjacentHTML('beforebegin', html);
  }

  // =====================================
  // SAVE / RESET (owner only)
  // =====================================

  async function idToken() {
    var auth = window.BimAuth;
    var user = auth && (auth.authenticatedUser || (typeof auth.getFirebaseUser === 'function' && auth.getFirebaseUser()));
    if (!user || typeof user.getIdToken !== 'function') throw new Error('Not signed in');
    return user.getIdToken();
  }

  async function post(body) {
    var token = await idToken();
    var resp = await fetch('api/placement-save.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(body)
    });
    var data = await resp.json().catch(function() { return {}; });
    if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
    return data;
  }

  BimViewer.savePlacement = async function(assetId) {
    var ad = this.loadedAssets.get(assetId);
    try {
      if (isSelfHostedTileset(ad)) {
        var p = ad.placement;
        var origin = Cesium.Cartesian3.fromDegrees(p.position.lon, p.position.lat, p.position.height);
        var enu = Cesium.Transforms.headingPitchRollToFixedFrame(
          origin, new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(p.heading || 0), 0, 0));
        await post({
          kind: 'tileset',
          folder: tilesetFolder(ad.modelDef),
          transform: Cesium.Matrix4.toArray(enu),
          placement: { lon: p.position.lon, lat: p.position.lat, height: p.position.height, heading: p.heading || 0 }
        });
      } else if (isServerGLB(ad)) {
        await post({
          kind: 'glb',
          file: glbFile(ad.modelDef),
          placement: { lon: ad.position.lon, lat: ad.position.lat, height: ad.position.height,
                       heading: ad.heading || 0, scale: ad.scale || 1 }
        });
      } else {
        return;
      }
      this.updateStatus('Position saved: ' + ad.name, 'success');
    } catch (err) {
      console.error('Save placement failed:', err);
      this.updateStatus('Saving position failed: ' + err.message, 'error');
    }
  };

  BimViewer.resetPlacement = async function(assetId) {
    var ad = this.loadedAssets.get(assetId);
    if (!ad || !confirm('Reset "' + ad.name + '" to its original position?')) return;
    try {
      var modelId = ad.modelDef && ad.modelDef.id;
      if (isSelfHostedTileset(ad)) {
        await post({ kind: 'tileset', folder: tilesetFolder(ad.modelDef), reset: true });
      } else if (isServerGLB(ad)) {
        await post({ kind: 'glb', file: glbFile(ad.modelDef), reset: true });
      } else {
        return;
      }
      // reload from the server so the original position applies
      this.unloadAsset(assetId);
      var models = await this.fetchGLBModels();
      var def = (models || []).find(function(m) { return m.id === modelId; });
      if (def) await this.loadGLBAsset(def);
      this.updateStatus('Position reset: ' + ad.name, 'success');
    } catch (err) {
      console.error('Reset placement failed:', err);
      this.updateStatus('Reset failed: ' + err.message, 'error');
    }
  };

  function injectSaveButtons(assetId, anchor) {
    if (!isOwner() || !anchor || document.getElementById('placementSave_' + assetId)) return;
    var html =
      '<div class="placement-actions">' +
        '<button class="modern-btn modern-btn-small placement-btn" id="placementSave_' + assetId + '" ' +
          'onclick="BimViewer.savePlacement(\'' + assetId + '\')" title="Save this position on the server (owner only)">' +
          '<i data-lucide="save"></i><span>Save position</span></button>' +
        '<button class="modern-btn modern-btn-small placement-btn" ' +
          'onclick="BimViewer.resetPlacement(\'' + assetId + '\')" title="Back to the original position">' +
          '<i data-lucide="rotate-ccw"></i><span>Reset</span></button>' +
      '</div>';
    anchor.insertAdjacentHTML('beforeend', html);
    if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide', node: anchor });
  }

  // =====================================
  // HOOK — asset cards
  // =====================================

  if (window.BimViewerUI && typeof BimViewerUI.createAssetControls === 'function') {
    var origCreate = BimViewerUI.createAssetControls.bind(BimViewerUI);
    BimViewerUI.createAssetControls = function(assetId) {
      origCreate(assetId);
      var id = String(assetId);
      var ad = BimViewer.loadedAssets.get(id);
      if (isSelfHostedTileset(ad)) {
        injectTilesetFields(id, ad);
        injectSaveButtons(id, document.getElementById('placementFields_' + id));
      } else if (isServerGLB(ad)) {
        var card = document.getElementById('asset_' + id);
        injectSaveButtons(id, card && card.querySelector('.modern-asset-glb-position'));
      }
    };
  }

  console.log('Placement module loaded v1.0');

})();
