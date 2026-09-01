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

  // NOTE: the disableDepthTestDistance below on each polyline does nothing —
  // PolylineGraphics has no such property. Handle lines are therefore occluded
  // by geometry they sit inside. See the KNOWN LIMITATION note in glb-gizmo.js
  // addAxisArrow for why depthFailMaterial is no fix and what would be.

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
    dragStartAngle: null,
    // Pivot snapshot for a heading drag (frozen at drag start)
    dragStartPivot: null,
    dragPivotEnu: null,
    dragAnchorLocal: null,
    dragLastAngle: null,
    dragTotalAngle: 0,
    // Grab-offset state for xy / z drags
    dragStartGround: null,
    dragStartAnchorC: null,
    dragAxisOriginC: null,
    dragAxisDir: null,
    dragAxisStartS: null
  };

  // ---- Helpers ----

  function state(id) {
    return (window.BimViewer && BimViewer.getSplatState) ? BimViewer.getSplatState(id) : null;
  }

  function enuAt(origin) {
    return Cesium.Transforms.eastNorthUpToFixedFrame(origin);
  }

  // Where the handles sit, and what heading rotation turns around.
  //
  // st.origin is the root.transform translation — the converter's georef origin.
  // For reconstructions whose origin sits off to one side of the captured area
  // the handles ended up far from the splat, and because applyTransform()
  // post-multiplies the rotation (splat.js), turning swung the splat along a
  // wide arc around that point. Anchor to the visual centre horizontally, at the
  // origin's height, so the ring lies under the splat and the Z handle still
  // starts where heightM points. Mirrors getGizmoPivot() in glb-gizmo.js.
  function pivotOf(id) {
    var st = state(id);
    if (!st || !st.origin) return null;
    var inst = (window.BimViewer && BimViewer.splat && BimViewer.splat.instances)
      ? BimViewer.splat.instances.get(id) : null;
    var bs = inst && inst.tileset && inst.tileset.boundingSphere;
    if (!bs || !bs.center) return st.origin;
    var cc = Cesium.Cartographic.fromCartesian(bs.center);
    var oc = Cesium.Cartographic.fromCartesian(st.origin);
    if (!cc || !oc) return st.origin;
    return Cesium.Cartesian3.fromRadians(cc.longitude, cc.latitude, oc.height);
  }

  function screenToAngle(viewer, origin, screenPos) {
    if (!origin) return null;
    var originScreen = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, origin);
    if (!originScreen) return null;
    return Math.atan2(screenPos.y - originScreen.y, screenPos.x - originScreen.x);
  }

  // Signed distance along `axisDir` (unit, world) from `originC` to the point on
  // that axis line closest to the mouse ray. Null when near-parallel.
  function projectRayOntoAxis(viewer, screenPos, originC, axisDir) {
    var ray = viewer.camera.getPickRay(screenPos);
    if (!ray) return null;
    var v = Cesium.Cartesian3.normalize(ray.direction, new Cesium.Cartesian3());
    var w0 = Cesium.Cartesian3.subtract(originC, ray.origin, new Cesium.Cartesian3());
    var b = Cesium.Cartesian3.dot(axisDir, v);
    var denom = 1.0 - b * b;
    if (Math.abs(denom) < 1e-6) return null;
    return (b * Cesium.Cartesian3.dot(v, w0) - Cesium.Cartesian3.dot(axisDir, w0)) / denom;
  }

  // Ground point under the cursor (terrain first, depth buffer as fallback).
  function pickGround(viewer, screenPos) {
    var ray = viewer.camera.getPickRay(screenPos);
    if (!ray) return null;
    return viewer.scene.globe.pick(ray, viewer.scene) || viewer.scene.pickPosition(screenPos) || null;
  }

  // ---- Handle entities (CallbackProperty → always follow live state) ----

  function createHandles(viewer, id) {
    removeHandles(viewer);

    // Center move handle (xy)
    var center = viewer.entities.add({
      position: new Cesium.CallbackProperty(function() {
        return pivotOf(id) || Cesium.Cartesian3.ZERO;
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
          var p = pivotOf(id);
          if (!p) return [];
          var enu = enuAt(p);
          var top = Cesium.Matrix4.multiplyByPoint(enu, new Cesium.Cartesian3(0, 0, Z_HANDLE_LENGTH), new Cesium.Cartesian3());
          return [p, top];
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
        var p = pivotOf(id);
        if (!p) return Cesium.Cartesian3.ZERO;
        var enu = enuAt(p);
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
          var p = pivotOf(id);
          if (!p) return [];
          var enu = enuAt(p);
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
          var p = pivotOf(id);
          if (!st || !p) return [];
          var enu = enuAt(p);
          var rad = Cesium.Math.toRadians(st.heading || 0);
          var tip = Cesium.Matrix4.multiplyByPoint(enu,
            new Cesium.Cartesian3(RING_RADIUS * Math.sin(rad), RING_RADIUS * Math.cos(rad), 1),
            new Cesium.Cartesian3());
          return [p, tip];
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

    if (axis === 'heading') {
      // Freeze the pivot and express the ground anchor in its ENU frame — the
      // heading drag rotates that one vector to keep the pivot standing still.
      var pivot = pivotOf(gizmo.selectedId);
      gizmo.dragStartPivot = pivot;
      gizmo.dragPivotEnu = pivot ? enuAt(pivot) : null;
      if (gizmo.dragPivotEnu) {
        var anchorC = Cesium.Cartesian3.fromDegrees(st.lon, st.lat, st.anchorHeight);
        var inv = Cesium.Matrix4.inverse(gizmo.dragPivotEnu, new Cesium.Matrix4());
        gizmo.dragAnchorLocal = Cesium.Matrix4.multiplyByPoint(inv, anchorC, new Cesium.Cartesian3());
      }
      gizmo.dragStartAngle = screenToAngle(viewer, pivot, screenPosition);
      gizmo.dragLastAngle = gizmo.dragStartAngle;
      gizmo.dragTotalAngle = 0;

    } else if (axis === 'xy') {
      gizmo.dragStartGround = pickGround(viewer, screenPosition);
      gizmo.dragStartAnchorC = Cesium.Cartesian3.fromDegrees(st.lon, st.lat, st.anchorHeight);

    } else if (axis === 'z') {
      gizmo.dragAxisOriginC = st.origin;
      gizmo.dragAxisDir = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(st.origin, new Cesium.Cartesian3());
      gizmo.dragAxisStartS = gizmo.dragAxisDir
        ? projectRayOntoAxis(viewer, screenPosition, st.origin, gizmo.dragAxisDir) : null;
    }

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
      var cart = pickGround(viewer, movement.endPosition);
      if (!cart) return;
      var carto;
      if (gizmo.dragStartGround && gizmo.dragStartAnchorC) {
        // Move by the cursor's ground delta so the grab offset survives — setting
        // the anchor straight to the cursor jumps the splat by however far its
        // georef origin sits from the reconstruction.
        var gDelta = Cesium.Cartesian3.subtract(cart, gizmo.dragStartGround, new Cesium.Cartesian3());
        carto = Cesium.Cartographic.fromCartesian(
          Cesium.Cartesian3.add(gizmo.dragStartAnchorC, gDelta, new Cesium.Cartesian3()));
      } else {
        carto = Cesium.Cartographic.fromCartesian(cart);
      }
      if (!carto) return;
      BimViewer.setSplatPosition(id, Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude));

    } else if (axis === 'z') {
      // Project the cursor ray onto the up axis — exact metres, and the grabbed
      // point on the handle stays under the cursor. The old screen-Y × camera-
      // distance guess drifted with zoom and view angle.
      if (gizmo.dragAxisDir && gizmo.dragAxisStartS !== null && gizmo.dragAxisOriginC) {
        var s = projectRayOntoAxis(viewer, movement.endPosition, gizmo.dragAxisOriginC, gizmo.dragAxisDir);
        if (s === null) return;   // looking along the axis — keep the last height
        BimViewer.setSplatHeight(id, gizmo.dragStartHeight + (s - gizmo.dragAxisStartS));
      }

    } else if (axis === 'heading') {
      var cur = screenToAngle(viewer, gizmo.dragStartPivot, movement.endPosition);
      if (cur !== null && gizmo.dragLastAngle !== null) {
        // Accumulate unwrapped increments so a drag across atan2's ±180° seam
        // doesn't jump a full turn (which would now fling the splat too).
        var inc = cur - gizmo.dragLastAngle;
        while (inc > Math.PI) inc -= 2 * Math.PI;
        while (inc < -Math.PI) inc += 2 * Math.PI;
        gizmo.dragTotalAngle += inc;
        gizmo.dragLastAngle = cur;

        var deltaDeg = Cesium.Math.toDegrees(gizmo.dragTotalAngle);
        var heading = (gizmo.dragStartHeading + deltaDeg) % 360;
        if (heading < 0) heading += 360;
        BimViewer.setSplatOrientation(id, { z: heading });

        // applyTransform() post-multiplies the rotation, so it turns about the
        // baseline origin. Counter-rotate the ground anchor around the pivot by
        // the same angle and the pivot holds still instead of the splat swinging.
        if (gizmo.dragPivotEnu && gizmo.dragAnchorLocal) {
          var rot = Cesium.Matrix3.fromRotationZ(-Cesium.Math.toRadians(deltaDeg));
          var vRot = Cesium.Matrix3.multiplyByVector(rot, gizmo.dragAnchorLocal, new Cesium.Cartesian3());
          var newAnchor = Cesium.Matrix4.multiplyByPoint(gizmo.dragPivotEnu, vRot, new Cesium.Cartesian3());
          var aCarto = Cesium.Cartographic.fromCartesian(newAnchor);
          if (aCarto) {
            BimViewer.setSplatPosition(id,
              Cesium.Math.toDegrees(aCarto.longitude), Cesium.Math.toDegrees(aCarto.latitude));
          }
        }
      }
    }

    if (window.BimSplat && BimSplat.syncRow) BimSplat.syncRow(id);
  }

  function onLeftUp() {
    if (!gizmo.dragging) return;
    var viewer = BimViewer.viewer;
    gizmo.dragging = false;
    gizmo.activeAxis = null;
    // Drop the per-drag snapshots so a stale pivot can't leak into the next drag.
    gizmo.dragStartPivot = null;
    gizmo.dragPivotEnu = null;
    gizmo.dragAnchorLocal = null;
    gizmo.dragLastAngle = null;
    gizmo.dragTotalAngle = 0;
    gizmo.dragStartGround = null;
    gizmo.dragStartAnchorC = null;
    gizmo.dragAxisOriginC = null;
    gizmo.dragAxisDir = null;
    gizmo.dragAxisStartS = null;
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
    var p = pivotOf(gizmo.selectedId);
    if (!p) return;
    var camDist = Cesium.Cartesian3.distance(viewer.camera.positionWC, p);
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
