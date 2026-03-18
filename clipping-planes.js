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
// PER-ASSET CLIPPING PLANES MODULE v1.0
// Axis-aligned section planes (X, Y, Z) per loaded tileset
// Only one asset can be clipped at a time
// ===============================
'use strict';

(function() {

  // =====================================
  // STATE
  // =====================================

  BimViewer.clipPlanes = {
    activeAssetId: null,
    configs: new Map()  // assetId → { axes: { x: {enabled,flipped,distance}, ... }, collection }
  };

  // =====================================
  // HELPERS
  // =====================================

  function computeClipRanges(tileset) {
    var radius = tileset.boundingSphere.radius;
    if (!radius || radius <= 0) radius = 50;
    var pad = radius * 0.1;
    var r = radius + pad;
    return {
      x: { min: -r, max: r },
      y: { min: -r, max: r },
      z: { min: -r, max: r },
      step: radius / 500
    };
  }

  // Very large distance — effectively disables a plane without removing it
  var DISABLED_DIST = 999999;

  // Axis index mapping: X=0, Y=1, Z=2
  var AXIS_INDEX = { x: 0, y: 1, z: 2 };

  function getPlaneParams(ax, axis) {
    if (!ax.enabled) {
      // Push plane far away so it clips nothing
      return {
        normal: new Cesium.Cartesian3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0),
        distance: -DISABLED_DIST
      };
    }
    var sign = ax.flipped ? -1 : 1;
    return {
      normal: new Cesium.Cartesian3(axis === 'x' ? sign : 0, axis === 'y' ? sign : 0, axis === 'z' ? sign : 0),
      distance: ax.distance * sign
    };
  }

  // =====================================
  // CORE — ACTIVATE / DEACTIVATE / TOGGLE
  // =====================================

  BimViewer.toggleAssetClipping = function(assetId) {
    assetId = assetId.toString();
    if (this.clipPlanes.activeAssetId === assetId) {
      this.deactivateAssetClipping(assetId);
    } else {
      // Deactivate previous
      if (this.clipPlanes.activeAssetId) {
        this.deactivateAssetClipping(this.clipPlanes.activeAssetId);
      }
      this.activateAssetClipping(assetId);
    }
  };

  BimViewer.activateAssetClipping = function(assetId) {
    assetId = assetId.toString();
    var assetData = this.loadedAssets.get(assetId);
    if (!assetData || !assetData.tileset) return;

    var ranges = computeClipRanges(assetData.tileset);

    var config = {
      ranges: ranges,
      axes: {
        x: { enabled: false, flipped: false, distance: 0 },
        y: { enabled: false, flipped: false, distance: 0 },
        z: { enabled: false, flipped: false, distance: 0 }
      },
      collection: null
    };

    // Create ClippingPlaneCollection with all 3 axis planes.
    // Disabled axes use a huge distance so they clip nothing.
    // Planes are updated in-place — never recreated.
    var initPlanes = [];
    ['x', 'y', 'z'].forEach(function(axis) {
      var p = getPlaneParams(config.axes[axis], axis);
      initPlanes.push(new Cesium.ClippingPlane(p.normal, p.distance));
    });
    config.collection = new Cesium.ClippingPlaneCollection({
      planes: initPlanes,
      unionClippingRegions: false,
      edgeColor: Cesium.Color.WHITE,
      edgeWidth: 1.0,
      enabled: true
    });
    assetData.tileset.clippingPlanes = config.collection;

    this.clipPlanes.configs.set(assetId, config);
    this.clipPlanes.activeAssetId = assetId;

    // Inject UI
    this.injectClipControls(assetId);

    // Highlight clip button
    var btn = document.getElementById('clipBtn_' + assetId);
    if (btn) btn.classList.add('clip-active');

    this.updateStatus('Section planes active', 'success');
  };

  BimViewer.deactivateAssetClipping = function(assetId) {
    assetId = assetId.toString();
    var assetData = this.loadedAssets.get(assetId);
    if (assetData && assetData.tileset) {
      assetData.tileset.clippingPlanes = undefined;
    }

    this.clipPlanes.configs.delete(assetId);
    if (this.clipPlanes.activeAssetId === assetId) {
      this.clipPlanes.activeAssetId = null;
    }

    // Remove UI
    var controls = document.getElementById('clipControls_' + assetId);
    if (controls) controls.remove();

    // Un-highlight clip button
    var btn = document.getElementById('clipBtn_' + assetId);
    if (btn) btn.classList.remove('clip-active');
  };

  // =====================================
  // PLANE UPDATES
  // =====================================

  BimViewer.updateClipAxis = function(assetId, axis, distance) {
    assetId = assetId.toString();
    var config = this.clipPlanes.configs.get(assetId);
    if (!config) return;

    config.axes[axis].distance = distance;
    this.syncClipPlane(assetId, axis);

    var valEl = document.getElementById('clipVal_' + axis + '_' + assetId);
    if (valEl) valEl.textContent = distance.toFixed(1) + 'm';
  };

  BimViewer.toggleClipAxis = function(assetId, axis, enabled) {
    assetId = assetId.toString();
    var config = this.clipPlanes.configs.get(assetId);
    if (!config) return;

    config.axes[axis].enabled = enabled;
    this.syncClipPlane(assetId, axis);
  };

  BimViewer.flipClipAxis = function(assetId, axis) {
    assetId = assetId.toString();
    var config = this.clipPlanes.configs.get(assetId);
    if (!config) return;

    config.axes[axis].flipped = !config.axes[axis].flipped;
    this.syncClipPlane(assetId, axis);

    var btn = document.getElementById('clipFlip_' + axis + '_' + assetId);
    if (btn) btn.classList.toggle('flipped', config.axes[axis].flipped);
  };

  BimViewer.syncClipPlane = function(assetId, axis) {
    assetId = assetId.toString();
    var config = this.clipPlanes.configs.get(assetId);
    if (!config || !config.collection) return;

    var idx = AXIS_INDEX[axis];
    var plane = config.collection.get(idx);
    if (!plane) return;

    var p = getPlaneParams(config.axes[axis], axis);
    Cesium.Cartesian3.clone(p.normal, plane.normal);
    plane.distance = p.distance;
  };

  // =====================================
  // UI — INJECT CONTROLS INTO ASSET CARD
  // =====================================

  BimViewer.injectClipControls = function(assetId) {
    assetId = assetId.toString();
    var config = this.clipPlanes.configs.get(assetId);
    if (!config) return;

    // Remove existing
    var existing = document.getElementById('clipControls_' + assetId);
    if (existing) existing.remove();

    var assetDiv = document.getElementById('asset_' + assetId);
    if (!assetDiv) return;

    var ranges = config.ranges;

    var html =
      '<div class="clip-planes-controls" id="clipControls_' + assetId + '">' +
        '<div class="clip-planes-header">' +
          '<label class="modern-label-small">Section Planes</label>' +
          '<button class="clip-reset-btn" onclick="BimViewer.deactivateAssetClipping(\'' + assetId + '\')" title="Remove clipping">\u2715</button>' +
        '</div>';

    ['x', 'y', 'z'].forEach(function(axis) {
      var ax = config.axes[axis];
      var r = ranges[axis];
      var labelClass = 'clip-axis-label clip-axis-label-' + axis;

      html +=
        '<div class="clip-axis-row">' +
          '<input type="checkbox" class="clip-axis-cb" id="clipCb_' + axis + '_' + assetId + '" ' +
            (ax.enabled ? 'checked' : '') +
            ' onchange="BimViewer.toggleClipAxis(\'' + assetId + '\',\'' + axis + '\',this.checked)">' +
          '<span class="' + labelClass + '">' + axis.toUpperCase() + '</span>' +
          '<input type="range" class="clip-slider" id="clipSlider_' + axis + '_' + assetId + '" ' +
            'min="' + r.min.toFixed(2) + '" max="' + r.max.toFixed(2) + '" ' +
            'step="' + ranges.step.toFixed(4) + '" value="0" ' +
            'oninput="BimViewer.updateClipAxis(\'' + assetId + '\',\'' + axis + '\',parseFloat(this.value))">' +
          '<button class="clip-flip-btn" id="clipFlip_' + axis + '_' + assetId + '" ' +
            'onclick="BimViewer.flipClipAxis(\'' + assetId + '\',\'' + axis + '\')" ' +
            'title="Flip direction">\u21C4</button>' +
          '<span class="clip-axis-value" id="clipVal_' + axis + '_' + assetId + '">0.0m</span>' +
        '</div>';
    });

    html += '</div>';

    assetDiv.insertAdjacentHTML('beforeend', html);
  };

  // =====================================
  // INJECT CLIP BUTTON INTO ASSET CARDS
  // =====================================

  BimViewer.injectClipButton = function(assetId) {
    assetId = assetId.toString();
    var assetDiv = document.getElementById('asset_' + assetId);
    if (!assetDiv) return;

    var controlsDiv = assetDiv.querySelector('.modern-asset-controls');
    if (!controlsDiv) return;

    // Don't add duplicate
    if (document.getElementById('clipBtn_' + assetId)) return;

    var btn = document.createElement('button');
    btn.id = 'clipBtn_' + assetId;
    btn.className = 'modern-icon-btn';
    btn.title = 'Section planes';
    btn.textContent = '\u2702\uFE0F';
    btn.onclick = function() { BimViewer.toggleAssetClipping(assetId); };

    // Insert before the delete button (last child)
    controlsDiv.insertBefore(btn, controlsDiv.lastElementChild);
  };

  // =====================================
  // HOOKS — MONKEY-PATCH ASSET LIFECYCLE
  // =====================================

  // Inject clip button when asset card is created
  if (window.BimViewerUI && typeof BimViewerUI.createAssetControls === 'function') {
    var origCreateAssetControls = BimViewerUI.createAssetControls.bind(BimViewerUI);
    BimViewerUI.createAssetControls = function(assetId) {
      origCreateAssetControls(assetId);
      BimViewer.injectClipButton(assetId);
    };
  }

  // Clean up clipping when asset is unloaded
  var origUnloadAsset = BimViewer.unloadAsset.bind(BimViewer);
  BimViewer.unloadAsset = function(assetId) {
    var id = assetId.toString();
    if (BimViewer.clipPlanes.activeAssetId === id) {
      BimViewer.deactivateAssetClipping(id);
    }
    BimViewer.clipPlanes.configs.delete(id);
    origUnloadAsset(assetId);
  };

  console.log('\u2702\uFE0F Clipping Planes module loaded v1.0');
  console.log('\uD83D\uDCA1 Per-asset section planes (X, Y, Z) with flip and toggle');

})();
