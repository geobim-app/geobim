// ============================================================
// Splat Gizmo — Interactive move/height/rotate for Gaussian Splats
//
// Copyright (c) 2026 geobim.app
// Licensed under the Business Source License 1.1 (BSL 1.1)
// Change Date: 2030-03-01 | Change License: MIT
// See LICENSE file for full terms.
//
// Sibling of glb-gizmo.js, but targets SPLAT instances
// (BimViewer.splat.instances — Cesium3DTileset, NOT Cesium.Model),
// so it cannot reuse that module: splats live in their own registry
// and are positioned via root.transform, not model.modelMatrix.
//
// Splats are fuzzy and unreliable to click-pick, so selection is
// driven from the sidebar list (BimGizmoSplat.select(id)) rather than
// by clicking the splat body. Once selected, three drag handles appear:
//   • center point  → move on the globe   (BimViewer.setSplatPosition)
//   • vertical line  → height              (BimViewer.setSplatHeight)
//   • ring           → heading rotation    (BimViewer.setSplatOrientation)
// Scale stays on the sidebar slider (like the GLB gizmo).
//
// Tested with CesiumJS 1.141
// ============================================================

(function() {
  'use strict';

  var COLOR_XY       = Cesium.Color.fromCssColorString('#2ECFB0'); // brand teal — move
  var COLOR_Z        = Cesium.Color.fromCssColorString('#4488ff'); // blue — height
  var COLOR_ROT      = Cesium.Color.fromCssColorString('#ffcc00'); // yellow — heading

  // Handle sizing (recomputed per-frame from camera distance)
  var Z_HANDLE_LENGTH = 25;
  var RING_RADIUS = 20;
  var RING_SEGMENTS = 48;

  var gizmo = {
    active: false,
    selectedId: null,
    activeAxis: null,        // 'xy' | 'z' | 'heading'
    dragging: false,
    entities: [],
    handler: null,
    dragStartScreenY: null,
    dragStartHeight: null,
    dragStartHeading: null,
    dragStartAngle: null
  };

  // ---- Helpers ----

  function state(id) {
    return (window.BimViewer && BimViewer.getSplatState) ? BimViewer.getSplatState(id) : null;
  }

  function enuAt(origin) {
    return Cesium.Transforms.eastNorthUpToFixedFrame(origin);
  }

  function screenToAngle(viewer, origin, screenPos) {
    var originScreen = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, origin);
    if (!originScreen) return null;
    return Math.atan2(screenPos.y - originScreen.y, screenPos.x - originScreen.x);
  }

  // ---- Handle entities (CallbackProperty → always follow live state) ----

  function createHandles(viewer, id) {
    removeHandles(viewer);

    // Center move handle (xy)
    var center = viewer.entities.add({
      position: new Cesium.CallbackProperty(function() {
        var st = state(id);
        return st ? st.origin : Cesium.Cartesian3.ZERO;
      }, false),
      point: {
        pixelSize: 14,
        color: COLOR_XY,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    center._splatGizmoAxis = 'xy';
    gizmo.entities.push(center);

    // Vertical handle (z) — line + tip
    var zLine = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(function() {
          var st = state(id);
          if (!st) return [];
          var enu = enuAt(st.origin);
          var top = Cesium.Matrix4.multiplyByPoint(enu, new Cesium.Cartesian3(0, 0, Z_HANDLE_LENGTH), new Cesium.Cartesian3());
          return [st.origin, top];
        }, false),
        width: 6,
        material: new Cesium.ColorMaterialProperty(COLOR_Z),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    zLine._splatGizmoAxis = 'z';
    gizmo.entities.push(zLine);

    var zTip = viewer.entities.add({
      position: new Cesium.CallbackProperty(function() {
        var st = state(id);
        if (!st) return Cesium.Cartesian3.ZERO;
        var enu = enuAt(st.origin);
        return Cesium.Matrix4.multiplyByPoint(enu, new Cesium.Cartesian3(0, 0, Z_HANDLE_LENGTH), new Cesium.Cartesian3());
      }, false),
      point: {
        pixelSize: 16,
        color: COLOR_Z,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    zTip._splatGizmoAxis = 'z';
    gizmo.entities.push(zTip);

    // Rotation ring (heading)
    var ring = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(function() {
          var st = state(id);
          if (!st) return [];
          var enu = enuAt(st.origin);
          var pts = [];
          for (var i = 0; i <= RING_SEGMENTS; i++) {
            var a = (2 * Math.PI * i) / RING_SEGMENTS;
            pts.push(Cesium.Matrix4.multiplyByPoint(enu,
              new Cesium.Cartesian3(RING_RADIUS * Math.cos(a), RING_RADIUS * Math.sin(a), 1),
              new Cesium.Cartesian3()));
          }
          return pts;
        }, false),
        width: 5,
        material: new Cesium.ColorMaterialProperty(COLOR_ROT),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    ring._splatGizmoAxis = 'heading';
    gizmo.entities.push(ring);

    // Heading indicator (dashed line from center outward at current heading)
    var headLine = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(function() {
          var st = state(id);
          if (!st) return [];
          var enu = enuAt(st.origin);
          var rad = Cesium.Math.toRadians(st.heading || 0);
          var tip = Cesium.Matrix4.multiplyByPoint(enu,
            new Cesium.Cartesian3(RING_RADIUS * Math.sin(rad), RING_RADIUS * Math.cos(rad), 1),
            new Cesium.Cartesian3());
          return [st.origin, tip];
        }, false),
        width: 3,
        material: new Cesium.PolylineDashMaterialProperty({ color: COLOR_ROT, dashLength: 8 }),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    headLine._splatGizmoAxis = 'heading';
    gizmo.entities.push(headLine);
  }

  function removeHandles(viewer) {
    for (var i = 0; i < gizmo.entities.length; i++) viewer.entities.remove(gizmo.entities[i]);
    gizmo.entities = [];
  }

  // ---- Selection (driven by the sidebar list, not click-pick) ----

  function select(id) {
    var viewer = BimViewer && BimViewer.viewer;
    if (!viewer || !state(id)) return;
    if (gizmo.selectedId && gizmo.selectedId !== id) deselect();
    gizmo.selectedId = id;
    gizmo.active = true;
    createHandles(viewer, id);
    if (window.BimSplat && BimSplat.onGizmoChange) BimSplat.onGizmoChange(id, true);
    console.log('🎯 Splat-Gizmo: ' + id);
  }

  function deselect() {
    var viewer = BimViewer && BimViewer.viewer;
    if (!viewer) return;
    var prev = gizmo.selectedId;
    removeHandles(viewer);
    gizmo.selectedId = null;
    gizmo.active = false;
    gizmo.dragging = false;
    gizmo.activeAxis = null;
    viewer.canvas.style.cursor = '';
    if (prev && window.BimSplat && BimSplat.onGizmoChange) BimSplat.onGizmoChange(prev, false);
  }

  function toggle(id) {
    if (gizmo.selectedId === id) deselect();
    else select(id);
  }

  // Called by splat-ui when a splat is removed — drop the gizmo if it was on it.
  function notifyRemoved(id) {
    if (gizmo.selectedId === id) deselect();
  }

  // ---- Drag logic ----

  async function onLeftDown(movement) {
    if (!gizmo.active) return;
    if (window.BimViewer && typeof BimViewer.isMeasuring === 'function' && BimViewer.isMeasuring()) return;
    var viewer = BimViewer.viewer;
    var picked = await viewer.scene.pickAsync(movement.position);
    // Only react to our own handles; non-handle clicks fall through to the
    // camera (so the user can still orbit without losing the selection).
    if (picked && picked.id && picked.id._splatGizmoAxis) {
      startDrag(picked.id._splatGizmoAxis, movement.position);
    }
  }

  function startDrag(axis, screenPosition) {
    var viewer = BimViewer.viewer;
    var st = state(gizmo.selectedId);
    if (!st) return;
    gizmo.activeAxis = axis;
    gizmo.dragging = true;
    gizmo.dragStartScreenY = screenPosition.y;
    gizmo.dragStartHeight = st.heightM;
    gizmo.dragStartHeading = st.heading;
    if (axis === 'heading') gizmo.dragStartAngle = screenToAngle(viewer, st.origin, screenPosition);
    viewer.scene.screenSpaceCameraController.enableInputs = false;
    viewer.canvas.style.cursor = 'grabbing';
  }

  function onMouseMove(movement) {
    var viewer = BimViewer.viewer;

    if (!gizmo.dragging || !gizmo.selectedId) {
      if (gizmo.active) {
        var hovered = viewer.scene.pick(movement.endPosition);
        viewer.canvas.style.cursor = (hovered && hovered.id && hovered.id._splatGizmoAxis) ? 'grab' : '';
      }
      return;
    }

    var id = gizmo.selectedId;
    var st = state(id);
    if (!st) return;
    var axis = gizmo.activeAxis;

    if (axis === 'xy') {
      var ray = viewer.camera.getPickRay(movement.endPosition);
      if (!ray) return;
      var cart = viewer.scene.globe.pick(ray, viewer.scene) || viewer.scene.pickPosition(movement.endPosition);
      if (!cart) return;
      var carto = Cesium.Cartographic.fromCartesian(cart);
      BimViewer.setSplatPosition(id, Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude));

    } else if (axis === 'z') {
      var deltaY = gizmo.dragStartScreenY - movement.endPosition.y;
      var camDist = Cesium.Cartesian3.distance(viewer.camera.positionWC, st.origin);
      var metersPerPixel = camDist * 0.001;
      BimViewer.setSplatHeight(id, gizmo.dragStartHeight + deltaY * metersPerPixel);

    } else if (axis === 'heading') {
      var cur = screenToAngle(viewer, st.origin, movement.endPosition);
      if (cur !== null && gizmo.dragStartAngle !== null) {
        var deltaDeg = Cesium.Math.toDegrees(cur - gizmo.dragStartAngle);
        // If the drag feels inverted, flip the sign of deltaDeg here.
        var heading = (gizmo.dragStartHeading + deltaDeg) % 360;
        if (heading < 0) heading += 360;
        BimViewer.setSplatOrientation(id, { z: heading });
      }
    }

    if (window.BimSplat && BimSplat.syncRow) BimSplat.syncRow(id);
  }

  function onLeftUp() {
    if (!gizmo.dragging) return;
    var viewer = BimViewer.viewer;
    gizmo.dragging = false;
    gizmo.activeAxis = null;
    viewer.scene.screenSpaceCameraController.enableInputs = true;
    viewer.canvas.style.cursor = gizmo.active ? '' : '';
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && gizmo.active) deselect();
  }

  // Keep handles a constant on-screen size regardless of zoom.
  function updateHandleSizes() {
    if (!gizmo.active || !gizmo.selectedId) return;
    var viewer = BimViewer.viewer;
    var st = state(gizmo.selectedId);
    if (!st) return;
    var camDist = Cesium.Cartesian3.distance(viewer.camera.positionWC, st.origin);
    var f = Math.max(0.5, camDist * 0.03);
    Z_HANDLE_LENGTH = f;
    RING_RADIUS = f * 0.8;
  }

  // ---- Init ----

  function init() {
    if (!window.BimViewer || !BimViewer.viewer) { setTimeout(init, 500); return; }
    var viewer = BimViewer.viewer;
    gizmo.handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    gizmo.handler.setInputAction(onLeftDown, Cesium.ScreenSpaceEventType.LEFT_DOWN);
    gizmo.handler.setInputAction(onMouseMove, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    gizmo.handler.setInputAction(onLeftUp, Cesium.ScreenSpaceEventType.LEFT_UP);
    document.addEventListener('keydown', onKeyDown);
    viewer.scene.preRender.addEventListener(updateHandleSizes);
    console.log('✅ Splat Gizmo initialized (select via sidebar list; drag center=move, line=height, ring=rotate)');
  }

  window.BimGizmoSplat = {
    select: select,
    deselect: deselect,
    toggle: toggle,
    notifyRemoved: notifyRemoved,
    isSelected: function(id) { return gizmo.selectedId === id; },
    init: init
  };

  if (document.readyState === 'complete') setTimeout(init, 1000);
  else window.addEventListener('load', function() { setTimeout(init, 1000); });

})();
