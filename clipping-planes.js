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

  // The clippable Cesium object behind an asset: Cesium3DTileset for 3D Tiles,
  // Cesium.Model for GLB. Both expose the same clippingPlanes property, so the
  // rest of the module only needs this one branch.
  // GLB models are only usable once loaded — Model.boundingSphere throws before
  // ready (Cesium 1.141 Model.js:1128) and clipping would have nothing to bind to.
  function getClipTarget(assetData) {
    if (!assetData) return null;
    if (assetData.isGLB) {
      return (assetData.model && assetData.model.ready) ? assetData.model : null;
    }
    return assetData.tileset || null;
  }

  // Plane distances are expressed in the target's own frame. For a tileset that
  // frame is metric, but a GLB's reference is its modelMatrix (Model.js:2421,
  // `referenceMatrix ?? modelMatrix`), which carries the asset scale — so a
  // distance set there comes out multiplied by ad.scale on screen. Sliders stay
  // in world metres for both types and are divided by this on the way in;
  // otherwise crane1.glb (scale 0.01) would be off by a factor of 100.
  function getUnitScale(assetData) {
    if (!assetData || !assetData.isGLB) return 1;
    var s = assetData.scale;
    return (typeof s === 'number' && s > 0) ? s : 1;
  }

  // The world matrix the clipping planes are measured against — different per
  // type: Model uses its own modelMatrix (Model.js:2421 `referenceMatrix ??
  // modelMatrix`), a tileset uses clippingPlanesOriginMatrix (Cesium3DTileset.js
  // :1734 = root.computedTransform × initial origin matrix).
  function getClipReferenceMatrix(assetData, target) {
    if (assetData && assetData.isGLB) {
      return target.referenceMatrix || target.modelMatrix || Cesium.Matrix4.IDENTITY;
    }
    return target.clippingPlanesOriginMatrix || Cesium.Matrix4.IDENTITY;
  }

  // Signed distance from that frame's origin to the geometry's centre, per axis,
  // in world metres. Because it is measured against the very matrix Cesium
  // clips with, it is 0 for assets whose origin already sits at their centre.
  function computeCenterOffsets(target, refMatrix) {
    var out = { x: 0, y: 0, z: 0 };
    var center = target.boundingSphere && target.boundingSphere.center;
    if (!center) return out;
    var originW = Cesium.Matrix4.getTranslation(refMatrix, new Cesium.Cartesian3());
    var d = Cesium.Cartesian3.subtract(center, originW, new Cesium.Cartesian3());

    // clippingPlanesOriginMatrix falls back to IDENTITY while a tileset isn't
    // ready (Cesium3DTileset.js:1736), which would make this the full ECEF vector
    // and blow the ranges up. Nothing sitting on the planet is legitimately that
    // far from its own reference frame, so treat it as "frame not established".
    if (Cesium.Cartesian3.magnitude(d) > 1.0e6) return out;

    ['x', 'y', 'z'].forEach(function(axis, i) {
      var col = Cesium.Matrix4.getColumn(refMatrix, i, new Cesium.Cartesian4());
      var dir = new Cesium.Cartesian3(col.x, col.y, col.z);
      var len = Cesium.Cartesian3.magnitude(dir);
      if (len < 1e-9) return;                              // degenerate frame
      Cesium.Cartesian3.divideByScalar(dir, len, dir);     // columns carry the scale
      out[axis] = Cesium.Cartesian3.dot(d, dir);
    });
    return out;
  }

  // Slider range per axis, centred on the geometry rather than on the frame
  // origin. A GLB's origin normally sits at the model's base, so the old
  // symmetric ±radius range could only travel 1.1·radius upward — on anything
  // taller than it is wide (radius ≈ H/2) that stops around half height, while
  // wide flat models were unaffected because their radius comes from the width.
  //
  // Sign: a slider value t places the plane t metres from the origin on the
  // NEGATIVE side of the axis — getPlaneParams builds normal +axis with distance
  // +t, and Cesium's plane equation n·p + d = 0 puts that at −t. (Flipping only
  // swaps which side is removed, not where the plane sits.) So geometry centred
  // at +c is covered by t ∈ [−c−r, −c+r].
  function computeClipRanges(target, offsets) {
    var radius = target.boundingSphere.radius;
    if (!radius || radius <= 0) radius = 50;
    var pad = radius * 0.1;
    var r = radius + pad;
    function axisRange(c) {
      return { min: -c - r, max: -c + r, center: -c };
    }
    return {
      x: axisRange(offsets.x),
      y: axisRange(offsets.y),
      z: axisRange(offsets.z),
      step: radius / 500
    };
  }

  // Very large distance — effectively disables a plane without removing it
  var DISABLED_DIST = 999999;

  // Axis index mapping: X=0, Y=1, Z=2
  var AXIS_INDEX = { x: 0, y: 1, z: 2 };

  // unitScale: world metres → target-frame units (see getUnitScale).
  function getPlaneParams(ax, axis, unitScale) {
    if (!ax.enabled) {
      // Push plane far away so it clips nothing. Left unscaled on purpose — this
      // only has to exceed the model's extent, not be metrically meaningful.
      return {
        normal: new Cesium.Cartesian3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0),
        distance: -DISABLED_DIST
      };
    }
    var sign = ax.flipped ? -1 : 1;
    return {
      normal: new Cesium.Cartesian3(axis === 'x' ? sign : 0, axis === 'y' ? sign : 0, axis === 'z' ? sign : 0),
      distance: (ax.distance / (unitScale || 1)) * sign
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
    if (!assetData) return;

    var target = getClipTarget(assetData);
    if (!target) {
      // Was a silent no-op before: the clip button is injected on every asset
      // card including GLB ones, so a dead click needs to say why.
      this.updateStatus(assetData.isGLB ? 'Model still loading — try again in a moment'
                                        : 'Section planes not available for this asset', 'warning');
      return;
    }

    var refMatrix = getClipReferenceMatrix(assetData, target);
    var ranges = computeClipRanges(target, computeCenterOffsets(target, refMatrix));

    // Each plane starts at the geometry's centre, not at the frame origin — with
    // an off-centre origin a value of 0 could fall outside the slider range, and
    // the browser would silently clamp it out of sync with the stored config.
    var config = {
      ranges: ranges,
      unitScale: getUnitScale(assetData),
      axes: {
        x: { enabled: false, flipped: false, distance: ranges.x.center },
        y: { enabled: false, flipped: false, distance: ranges.y.center },
        z: { enabled: false, flipped: false, distance: ranges.z.center }
      },
      collection: null
    };

    // Create ClippingPlaneCollection with all 3 axis planes.
    // Disabled axes use a huge distance so they clip nothing.
    // Planes are updated in-place — never recreated.
    var initPlanes = [];
    ['x', 'y', 'z'].forEach(function(axis) {
      var p = getPlaneParams(config.axes[axis], axis, config.unitScale);
      initPlanes.push(new Cesium.ClippingPlane(p.normal, p.distance));
    });
    config.collection = new Cesium.ClippingPlaneCollection({
      planes: initPlanes,
      unionClippingRegions: false,
      edgeColor: Cesium.Color.WHITE,
      edgeWidth: 1.0,
      enabled: true
    });
    target.clippingPlanes = config.collection;

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
    // Not via getClipTarget — a GLB that stopped being ready still has to have
    // its clipping released, so this branch must not depend on load state.
    var assetData = this.loadedAssets.get(assetId);
    var target = assetData && (assetData.isGLB ? assetData.model : assetData.tileset);
    if (target) {
      target.clippingPlanes = undefined;
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
    var center = (config.ranges && config.ranges[axis]) ? config.ranges[axis].center : 0;
    if (valEl) valEl.textContent = (distance - center).toFixed(1) + 'm';
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

    var p = getPlaneParams(config.axes[axis], axis, config.unitScale);
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

    // A GLB's planes live in its modelMatrix frame, so they turn with the gizmo
    // heading — X/Y then mean "along/across the model", not east/north as they do
    // for a tileset. Worth saying, since both share this panel.
    var ad = this.loadedAssets.get(assetId);
    var frameHint = (ad && ad.isGLB) ? ' <span class="clip-frame-hint">(model axes)</span>' : '';

    var html =
      '<div class="clip-planes-controls" id="clipControls_' + assetId + '">' +
        '<div class="clip-planes-header">' +
          '<label class="modern-label-small">Section Planes' + frameHint + '</label>' +
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
            'step="' + ranges.step.toFixed(4) + '" value="' + ax.distance.toFixed(4) + '" ' +
            'oninput="BimViewer.updateClipAxis(\'' + assetId + '\',\'' + axis + '\',parseFloat(this.value))">' +
          '<button class="clip-flip-btn" id="clipFlip_' + axis + '_' + assetId + '" ' +
            'onclick="BimViewer.flipClipAxis(\'' + assetId + '\',\'' + axis + '\')" ' +
            'title="Flip direction">\u21C4</button>' +
          // Shown relative to the centre, so 0.0m reads as "cut through the middle"
          '<span class="clip-axis-value" id="clipVal_' + axis + '_' + assetId + '">' +
            (ax.distance - r.center).toFixed(1) + 'm</span>' +
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
