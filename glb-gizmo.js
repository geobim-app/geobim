// ============================================================
// GLB Gizmo — Interactive move/rotate/height for GLB models
// Click GLB to select, drag to move, Z-handle for height,
// ring for heading rotation. Syncs with UI sliders.
// ============================================================

(function() {
  'use strict';

  var HANDLE_COLOR_Z = Cesium.Color.fromCssColorString('#4488ff');
  var HANDLE_COLOR_Z_HOVER = Cesium.Color.fromCssColorString('#66bbff');
  var HANDLE_COLOR_ROT = Cesium.Color.fromCssColorString('#ffcc00');
  var HANDLE_COLOR_ROT_HOVER = Cesium.Color.fromCssColorString('#ffee66');
  var SILHOUETTE_COLOR = Cesium.Color.CYAN;
  var SILHOUETTE_SIZE = 2.0;

  // Handle sizing
  var Z_HANDLE_LENGTH = 25;     // meters above model
  var ROTATION_RING_RADIUS = 20; // meters
  var ROTATION_RING_SEGMENTS = 48;

  var gizmo = {
    active: false,
    selectedAssetId: null,
    activeAxis: null,       // 'xy' | 'z' | 'heading'
    dragging: false,
    entities: [],
    handler: null,
    dragStartScreenY: null,
    dragStartCartesian: null,
    dragStartPosition: null,
    dragStartHeading: null,
    dragStartAngle: null,
    _prevSilhouetteSize: 0,
    _prevSilhouetteColor: null
  };

  // ---- Helpers ----

  function getAssetData(assetId) {
    return BimViewer.loadedAssets ? BimViewer.loadedAssets.get(assetId) : null;
  }

  function getModelOrigin(assetData) {
    var p = assetData.position;
    return Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.height);
  }

  function screenToAngle(viewer, assetData, screenPos) {
    var origin = getModelOrigin(assetData);
    var originScreen = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, origin);
    if (!originScreen) return null;
    return Math.atan2(screenPos.y - originScreen.y, screenPos.x - originScreen.x);
  }

  // Sync UI inputs from assetData (after gizmo drag)
  function syncUI(assetId) {
    var ad = getAssetData(assetId);
    if (!ad) return;

    var fields = {
      lon:     { val: ad.position.lon.toFixed(6) },
      lat:     { val: ad.position.lat.toFixed(6) },
      height:  { val: ad.position.height.toFixed(2) },
      heading: { val: Math.round(ad.heading || 0), suffix: '\u00B0' },
      scale:   { val: ad.scale }
    };

    for (var key in fields) {
      var el = document.getElementById('glb_' + key + '_' + assetId);
      if (el) el.value = fields[key].val;
      var valEl = document.getElementById('glb_' + key + '_val_' + assetId);
      if (valEl) {
        if (key === 'heading') valEl.textContent = fields[key].val + '\u00B0';
        else if (key === 'scale') valEl.textContent = parseFloat(fields[key].val).toFixed(2) + 'x';
      }
    }
    // Scale slider is logarithmic
    var scaleSlider = document.getElementById('glb_scale_' + assetId);
    if (scaleSlider && ad.scale > 0) scaleSlider.value = Math.log10(ad.scale).toFixed(2);
    var scaleInput = document.getElementById('glb_scale_input_' + assetId);
    if (scaleInput) scaleInput.value = ad.scale;
  }

  // ---- Handle entities ----

  function createHandles(viewer, assetId) {
    removeHandles(viewer);
    var ad = getAssetData(assetId);
    if (!ad) return;

    // Z-handle (vertical arrow)
    var zLine = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(function() {
          var ad2 = getAssetData(assetId);
          if (!ad2) return [];
          var origin = getModelOrigin(ad2);
          var enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
          var top = Cesium.Matrix4.multiplyByPoint(enu, new Cesium.Cartesian3(0, 0, Z_HANDLE_LENGTH), new Cesium.Cartesian3());
          return [origin, top];
        }, false),
        width: 6,
        material: new Cesium.ColorMaterialProperty(HANDLE_COLOR_Z),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    zLine._gizmoAxis = 'z';
    zLine._gizmoAssetId = assetId;
    gizmo.entities.push(zLine);

    // Z-handle tip (point)
    var zTip = viewer.entities.add({
      position: new Cesium.CallbackProperty(function() {
        var ad2 = getAssetData(assetId);
        if (!ad2) return Cesium.Cartesian3.ZERO;
        var origin = getModelOrigin(ad2);
        var enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
        return Cesium.Matrix4.multiplyByPoint(enu, new Cesium.Cartesian3(0, 0, Z_HANDLE_LENGTH), new Cesium.Cartesian3());
      }, false),
      point: {
        pixelSize: 16,
        color: HANDLE_COLOR_Z,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    zTip._gizmoAxis = 'z';
    zTip._gizmoAssetId = assetId;
    gizmo.entities.push(zTip);

    // Rotation ring
    var ringEntity = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(function() {
          var ad2 = getAssetData(assetId);
          if (!ad2) return [];
          var origin = getModelOrigin(ad2);
          var enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
          var points = [];
          for (var i = 0; i <= ROTATION_RING_SEGMENTS; i++) {
            var angle = (2 * Math.PI * i) / ROTATION_RING_SEGMENTS;
            var x = ROTATION_RING_RADIUS * Math.cos(angle);
            var y = ROTATION_RING_RADIUS * Math.sin(angle);
            points.push(Cesium.Matrix4.multiplyByPoint(enu, new Cesium.Cartesian3(x, y, 1), new Cesium.Cartesian3()));
          }
          return points;
        }, false),
        width: 5,
        material: new Cesium.ColorMaterialProperty(HANDLE_COLOR_ROT),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    ringEntity._gizmoAxis = 'heading';
    ringEntity._gizmoAssetId = assetId;
    gizmo.entities.push(ringEntity);

    // Heading direction indicator (line from center outward at current heading)
    var headingLine = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(function() {
          var ad2 = getAssetData(assetId);
          if (!ad2) return [];
          var origin = getModelOrigin(ad2);
          var enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
          var headRad = Cesium.Math.toRadians(ad2.heading || 0);
          // Heading: 0=North, CW. In ENU: North=+Y, East=+X
          var ex = ROTATION_RING_RADIUS * Math.sin(headRad);
          var ey = ROTATION_RING_RADIUS * Math.cos(headRad);
          var tip = Cesium.Matrix4.multiplyByPoint(enu, new Cesium.Cartesian3(ex, ey, 1), new Cesium.Cartesian3());
          return [origin, tip];
        }, false),
        width: 3,
        material: new Cesium.PolylineDashMaterialProperty({
          color: HANDLE_COLOR_ROT,
          dashLength: 8
        }),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    headingLine._gizmoAxis = 'heading';
    headingLine._gizmoAssetId = assetId;
    gizmo.entities.push(headingLine);
  }

  function removeHandles(viewer) {
    for (var i = 0; i < gizmo.entities.length; i++) {
      viewer.entities.remove(gizmo.entities[i]);
    }
    gizmo.entities = [];
  }

  // ---- Selection ----

  function selectModel(assetId) {
    var viewer = BimViewer.viewer;
    if (!viewer) return;

    // Deselect previous
    if (gizmo.selectedAssetId && gizmo.selectedAssetId !== assetId) {
      deselectModel();
    }

    var ad = getAssetData(assetId);
    if (!ad || !ad.isGLB || !ad.model) return;

    gizmo.selectedAssetId = assetId;
    gizmo.active = true;

    // Highlight
    gizmo._prevSilhouetteSize = ad.model.silhouetteSize;
    gizmo._prevSilhouetteColor = ad.model.silhouetteColor;
    ad.model.silhouetteColor = SILHOUETTE_COLOR;
    ad.model.silhouetteSize = SILHOUETTE_SIZE;

    createHandles(viewer, assetId);
    viewer.canvas.style.cursor = 'pointer';
    console.log('\uD83C\uDFAF Gizmo: selected ' + ad.name);
  }

  function deselectModel() {
    var viewer = BimViewer.viewer;
    if (!viewer) return;

    if (gizmo.selectedAssetId) {
      var ad = getAssetData(gizmo.selectedAssetId);
      if (ad && ad.model) {
        ad.model.silhouetteSize = gizmo._prevSilhouetteSize || 0;
        if (gizmo._prevSilhouetteColor) {
          ad.model.silhouetteColor = gizmo._prevSilhouetteColor;
        }
      }
    }

    removeHandles(viewer);
    gizmo.selectedAssetId = null;
    gizmo.active = false;
    gizmo.dragging = false;
    gizmo.activeAxis = null;
    viewer.canvas.style.cursor = '';
  }

  // ---- Drag logic ----

  function onLeftDown(movement) {
    var viewer = BimViewer.viewer;
    var picked = viewer.scene.pick(movement.position);
    if (!picked) {
      deselectModel();
      return;
    }

    // Check gizmo handle entity
    if (picked.id && picked.id._gizmoAxis) {
      startDrag(picked.id._gizmoAxis, movement.position);
      return;
    }

    // Check GLB model
    if (picked.primitive instanceof Cesium.Model) {
      var foundAssetId = null;
      BimViewer.loadedAssets.forEach(function(assetData, assetId) {
        if (assetData.isGLB && assetData.model === picked.primitive) {
          foundAssetId = assetId;
        }
      });
      if (foundAssetId) {
        if (gizmo.selectedAssetId === foundAssetId) {
          // Already selected — start XY drag
          startDrag('xy', movement.position);
        } else {
          selectModel(foundAssetId);
        }
        return;
      }
    }

    // Clicked something else — deselect
    deselectModel();
  }

  function startDrag(axis, screenPosition) {
    var viewer = BimViewer.viewer;
    var ad = getAssetData(gizmo.selectedAssetId);
    if (!ad) return;

    gizmo.activeAxis = axis;
    gizmo.dragging = true;
    gizmo.dragStartScreenY = screenPosition.y;
    gizmo.dragStartPosition = {
      lon: ad.position.lon,
      lat: ad.position.lat,
      height: ad.position.height
    };
    gizmo.dragStartHeading = ad.heading || 0;
    gizmo.dragStartCartesian = viewer.scene.pickPosition(screenPosition) || null;

    if (axis === 'heading') {
      gizmo.dragStartAngle = screenToAngle(viewer, ad, screenPosition);
    }

    viewer.scene.screenSpaceCameraController.enableInputs = false;
    viewer.canvas.style.cursor = 'grabbing';
  }

  function onMouseMove(movement) {
    var viewer = BimViewer.viewer;

    if (!gizmo.dragging || !gizmo.selectedAssetId) {
      // Hover feedback
      if (gizmo.active) {
        var hovered = viewer.scene.pick(movement.endPosition);
        if (hovered && hovered.id && hovered.id._gizmoAxis) {
          viewer.canvas.style.cursor = 'grab';
        } else if (hovered && hovered.primitive instanceof Cesium.Model && gizmo.selectedAssetId) {
          var ad2 = getAssetData(gizmo.selectedAssetId);
          if (ad2 && ad2.model === hovered.primitive) {
            viewer.canvas.style.cursor = 'move';
          } else {
            viewer.canvas.style.cursor = 'pointer';
          }
        } else {
          viewer.canvas.style.cursor = gizmo.active ? 'pointer' : '';
        }
      }
      return;
    }

    var ad = getAssetData(gizmo.selectedAssetId);
    if (!ad) return;

    var axis = gizmo.activeAxis;

    if (axis === 'xy') {
      // Drag on globe — raycast to terrain/ellipsoid
      var ray = viewer.camera.getPickRay(movement.endPosition);
      if (!ray) return;

      var cartesian = viewer.scene.globe.pick(ray, viewer.scene);
      if (!cartesian) {
        // Fallback: pickPosition (uses depth buffer)
        cartesian = viewer.scene.pickPosition(movement.endPosition);
      }
      if (!cartesian) return;

      var carto = Cesium.Cartographic.fromCartesian(cartesian);
      ad.position.lon = Cesium.Math.toDegrees(carto.longitude);
      ad.position.lat = Cesium.Math.toDegrees(carto.latitude);
      // Keep current height (don't snap to terrain)

    } else if (axis === 'z') {
      // Vertical drag — screen Y delta to height delta
      var deltaY = gizmo.dragStartScreenY - movement.endPosition.y;
      // Scale: pixels to meters. Approximate based on camera distance.
      var origin = getModelOrigin(ad);
      var cameraDist = Cesium.Cartesian3.distance(viewer.camera.positionWC, origin);
      var metersPerPixel = cameraDist * 0.001; // rough approximation
      ad.position.height = gizmo.dragStartPosition.height + deltaY * metersPerPixel;

    } else if (axis === 'heading') {
      var currentAngle = screenToAngle(viewer, ad, movement.endPosition);
      if (currentAngle !== null && gizmo.dragStartAngle !== null) {
        var deltaAngle = currentAngle - gizmo.dragStartAngle;
        var deltaDeg = Cesium.Math.toDegrees(deltaAngle);
        ad.heading = (gizmo.dragStartHeading - deltaDeg + 360) % 360;
      }
    }

    BimViewer.updateGLBPosition(gizmo.selectedAssetId);
    syncUI(gizmo.selectedAssetId);
  }

  function onLeftUp() {
    if (!gizmo.dragging) return;
    var viewer = BimViewer.viewer;

    gizmo.dragging = false;
    gizmo.activeAxis = null;
    viewer.scene.screenSpaceCameraController.enableInputs = true;
    viewer.canvas.style.cursor = gizmo.active ? 'pointer' : '';
  }

  // ---- Keyboard ----

  function onKeyDown(e) {
    if (e.key === 'Escape' && gizmo.active) {
      deselectModel();
    }
  }

  // ---- Scale handles with camera distance ----

  function updateHandleSizes() {
    if (!gizmo.active || !gizmo.selectedAssetId) return;
    var viewer = BimViewer.viewer;
    var ad = getAssetData(gizmo.selectedAssetId);
    if (!ad) return;

    var origin = getModelOrigin(ad);
    var cameraDist = Cesium.Cartesian3.distance(viewer.camera.positionWC, origin);

    // Scale handles proportional to camera distance
    var scaleFactor = Math.max(0.5, cameraDist * 0.03);
    Z_HANDLE_LENGTH = scaleFactor;
    ROTATION_RING_RADIUS = scaleFactor * 0.8;
  }

  // ---- Init ----

  function init() {
    if (!BimViewer || !BimViewer.viewer) {
      setTimeout(init, 500);
      return;
    }

    var viewer = BimViewer.viewer;

    gizmo.handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    gizmo.handler.setInputAction(onLeftDown, Cesium.ScreenSpaceEventType.LEFT_DOWN);
    gizmo.handler.setInputAction(onMouseMove, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    gizmo.handler.setInputAction(onLeftUp, Cesium.ScreenSpaceEventType.LEFT_UP);

    document.addEventListener('keydown', onKeyDown);

    // Update handle sizes on each frame
    viewer.scene.preRender.addEventListener(updateHandleSizes);

    console.log('\u2705 GLB Gizmo initialized (click GLB to select, drag to move, Z-handle for height, ring for heading)');
  }

  // Expose
  window.BimGizmo = {
    gizmo: gizmo,
    selectModel: selectModel,
    deselectModel: deselectModel,
    init: init
  };

  // Auto-init after viewer is ready
  if (document.readyState === 'complete') {
    setTimeout(init, 1000);
  } else {
    window.addEventListener('load', function() { setTimeout(init, 1000); });
  }

})();
