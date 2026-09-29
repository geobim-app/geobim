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
// ITWIN DEMO
// Bentley iTwin sample in the Assets section: a train station iModel, its
// surrounding-area iModel and a reality mesh, streamed from the iTwin platform
// via CesiumJS ITwinData (experimental API), plus the example's camera views.
//
// Data, share key and views come from the CesiumJS Sandcastle example
// "iModel Mesh Export Service"
// (CesiumGS/cesium packages/sandcastle/gallery/imodel-mesh-export-service,
// Apache-2.0). The share key grants read access to that demo iTwin only and
// expires (JWT `exp`); Cesium rotates it — take the new one from that file.
// ===============================
'use strict';

(function() {

  var SHARE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpVHdpbklkIjoiNTM1YTI0YTMtOWIyOS00ZTIzLWJiNWQtOWNlZGI1MjRjNzQzIiwiaWQiOiJmODg3YjM4Ny04MzQyLTQ1N2EtYjRjOC1iZWJkMDJmZWJkMWIiLCJleHAiOjE3OTM1MDk5Nzh9.fGbT2jlD9j5a579QE8Kp5J4NYq6mUzEnP8_VMDNGrOQ';
  var ITWIN_ID = '535a24a3-9b29-4e23-bb5d-9cedb524c743';
  var IMODELS = [
    { id: 'f856f57d-3d28-4265-9c4f-5e60c0662c15', name: 'iTwin Demo – Surrounding Area', surrounding: true },
    { id: '669dde67-eb69-4e0b-bcf2-f722eee94746', name: 'iTwin Demo – Station' }
  ];
  var REALITY_DATA_ID = '85897090-3bcc-470b-bec7-20bb639cc1b9';
  var REALITY_ASSET_ID = 'itwin_reality_' + REALITY_DATA_ID;
  var SURROUNDING_ASSET_ID = 'itwin_' + IMODELS[0].id;

  // Camera views of the Sandcastle example (ECEF position + heading/pitch/roll).
  // Interior views hide the surrounding area, as there.
  var VIEWS = [
    { key: 'birdseye', label: 'Birdseye', icon: 'map', surrounding: true,
      position: [1255923.367096007, -4734564.543879414, 4072623.4624344883],
      hpr: [6.283185307179586, -0.5002442676148875, 6.283185307179586] },
    { key: 'station', label: 'Station', icon: 'building-2', surrounding: true,
      position: [1255783.605894154, -4732864.394472763, 4073433.975291202],
      hpr: [5.646321670432638, -0.4736439399770642, 0.00001691713303575426] },
    { key: 'platform', label: 'Platform', icon: 'train-front', surrounding: false,
      position: [1255658.5108288145, -4732744.54716761, 4073467.5995740294],
      hpr: [0.08605615778136055, -0.08195800893456417, 3.644617292408725e-7] },
    { key: 'atrium', label: 'Atrium', icon: 'door-open', surrounding: false,
      position: [1255653.7753397836, -4732735.669421007, 4073492.4182837387],
      hpr: [0.27348916684631064, -0.1626949521764165, 6.2831852466344875] },
    { key: 'roof', label: 'Roof', icon: 'house', surrounding: false,
      position: [1255656.4324382306, -4732754.952130925, 4073483.76683067],
      hpr: [0.16147447018420547, -0.015285346878300077, 6.28297051403236] }
  ];

  var loading = false;

  function demoAssetIds() {
    return IMODELS.map(function(m) { return 'itwin_' + m.id; }).concat(REALITY_ASSET_ID);
  }

  function anyLoaded() {
    return demoAssetIds().some(function(id) { return BimViewer.loadedAssets.has(id); });
  }

  function allLoaded() {
    return demoAssetIds().every(function(id) { return BimViewer.loadedAssets.has(id); });
  }

  // Expiry (ms) from the share key's JWT payload, or null if unreadable.
  function shareKeyExpiry() {
    try {
      var part = SHARE_KEY.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      var payload = JSON.parse(atob(part + '==='.slice((part.length + 3) % 4)));
      return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
    } catch (e) {
      return null;
    }
  }

  function isExpired() {
    var exp = shareKeyExpiry();
    return exp !== null && Date.now() > exp;
  }

  async function loadRealityMesh() {
    if (BimViewer.loadedAssets.has(REALITY_ASSET_ID)) return;
    Cesium.ITwinPlatform.defaultShareKey = SHARE_KEY;
    var tileset = await Cesium.ITwinData.createTilesetForRealityDataId({
      iTwinId: ITWIN_ID,
      realityDataId: REALITY_DATA_ID
    });
    BimViewer.viewer.scene.primitives.add(tileset);
    if (typeof BimViewer.enableTilesetLighting === 'function') {
      BimViewer.enableTilesetLighting(tileset);
    }
    if (BimViewer._currentPerformanceSettings) {
      BimViewer.applySettingsToTileset(tileset, BimViewer._currentPerformanceSettings);
    }
    BimViewer.loadedAssets.set(REALITY_ASSET_ID, {
      id: REALITY_ASSET_ID,
      name: 'iTwin Demo – Reality Mesh',
      tileset: tileset,
      visible: true,
      opacity: 1.0,
      type: 'ITWIN_REALITY'
    });
    if (typeof BimViewer.updateZOffsetAssetsList === 'function') {
      setTimeout(function() { BimViewer.updateZOffsetAssetsList(); }, 100);
    }
    if (window.BimViewerUI && typeof BimViewerUI.createAssetControls === 'function') {
      BimViewerUI.createAssetControls(REALITY_ASSET_ID);
    }
  }

  function setSurroundingVisible(visible) {
    var ad = BimViewer.loadedAssets.get(SURROUNDING_ASSET_ID);
    if (ad && ad.visible !== visible) BimViewer.toggleAssetVisibility(SURROUNDING_ASSET_ID);
  }

  BimViewer.flyToITwinDemoView = function(key) {
    var view = VIEWS.find(function(v) { return v.key === key; }) || VIEWS[0];
    setSurroundingVisible(view.surrounding);
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.viewer.camera.flyTo({
      destination: new Cesium.Cartesian3(view.position[0], view.position[1], view.position[2]),
      orientation: new Cesium.HeadingPitchRoll(view.hpr[0], view.hpr[1], view.hpr[2]),
      duration: reduceMotion ? 0 : 1.5
    });
  };

  BimViewer.loadITwinDemo = async function() {
    if (loading) return;
    if (isExpired()) {
      this.updateStatus('iTwin demo access has expired', 'error');
      render();
      return;
    }
    if (allLoaded()) {
      this.flyToITwinDemoView('birdseye');
      return;
    }

    loading = true;
    render();
    try {
      for (var i = 0; i < IMODELS.length; i++) {
        var m = IMODELS[i];
        if (this.loadedAssets.has('itwin_' + m.id)) continue;
        var ad = await this.loadITwinModel(SHARE_KEY, m.id, m.name, { noFlyTo: true });
        if (!ad) {
          // createTilesetFromIModelId returns nothing until the iModel's mesh
          // export has finished — the API docs suggest retrying after 10–20 s.
          throw new Error(m.name + ' is not available yet — try again in 20 s');
        }
      }
      await loadRealityMesh();
      this.flyToITwinDemoView('birdseye');
      this.updateStatus('iTwin demo loaded', 'success');
      if (typeof plausible !== 'undefined') {
        plausible('Feature Used', { props: { feature: 'iTwin Demo' } });
      }
    } catch (error) {
      console.error('❌ iTwin demo failed:', error);
      this.updateStatus('iTwin demo failed: ' + error.message, 'error');
    } finally {
      loading = false;
      render();
    }
  };

  // ===============================
  // UI (Assets section, below the Cesium Ion list)
  // ===============================

  function viewButtons() {
    return VIEWS.map(function(v) {
      return '<button type="button" class="modern-btn modern-btn-small itwin-demo-view-btn" data-itwin-view="' + v.key + '">' +
        '<i data-lucide="' + v.icon + '"></i><span>' + v.label + '</span></button>';
    }).join('');
  }

  function render() {
    var btn = document.getElementById('itwinDemoLoadBtn');
    if (!btn) return;
    var label = btn.querySelector('span');
    var views = document.getElementById('itwinDemoViews');
    var status = document.getElementById('itwinDemoStatus');
    var expired = isExpired();

    btn.disabled = loading || expired;
    label.textContent = loading ? 'Loading iTwin demo…'
      : allLoaded() ? 'Fly to iTwin demo'
      : 'Load iTwin demo';
    views.hidden = loading || !anyLoaded();
    status.textContent = expired
      ? 'Demo access expired — the sample share key needs an update.'
      : '';
    status.hidden = !status.textContent;
  }

  function inject() {
    if (document.getElementById('itwinDemo')) return true;
    var selector = document.getElementById('ionAssetSelector');
    var group = selector && selector.closest('.modern-group');
    if (!group) return false;

    group.insertAdjacentHTML('afterend',
      '<div class="modern-divider"><span class="modern-divider-text">Bentley iTwin Demo</span></div>' +
      '<div class="modern-group itwin-demo" id="itwinDemo">' +
        '<div class="modern-hint">Train station iModel, surroundings and reality mesh streamed from the Bentley iTwin platform (Cesium sample data).</div>' +
        '<button type="button" class="modern-btn modern-btn-primary itwin-demo-load-btn" id="itwinDemoLoadBtn">' +
          '<i data-lucide="train-front"></i><span>Load iTwin demo</span></button>' +
        '<div class="itwin-demo-views" id="itwinDemoViews" hidden>' + viewButtons() + '</div>' +
        '<div class="modern-hint" id="itwinDemoStatus" hidden></div>' +
      '</div>');

    document.getElementById('itwinDemoLoadBtn').addEventListener('click', function() {
      BimViewer.loadITwinDemo();
    });
    document.getElementById('itwinDemoViews').addEventListener('click', function(e) {
      var b = e.target.closest('[data-itwin-view]');
      if (b) BimViewer.flyToITwinDemoView(b.dataset.itwinView);
    });
    if (window.lucide) lucide.createIcons();
    render();
    return true;
  }

  // Keep the button label and view list in sync when demo assets are removed.
  if (typeof BimViewer.unloadAsset === 'function') {
    var origUnload = BimViewer.unloadAsset;
    BimViewer.unloadAsset = function(assetId) {
      var result = origUnload.apply(this, arguments);
      if (demoAssetIds().indexOf(String(assetId)) !== -1) render();
      return result;
    };
  }

  function start() {
    // Bridge Inspector restricts the asset list to its own bridges.
    if (window._bridgeInspectorAssetFilter instanceof Set) return;
    if (inject()) return;
    var tries = 0;
    var timer = setInterval(function() {
      if (inject() || ++tries > 120) clearInterval(timer);
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  console.log('iTwin demo module loaded');
})();
