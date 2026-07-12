// ============================================================
// Asset Gizmo — Interactive move/rotate/height for placed assets
// GLB models: click to select (always on), drag to move, Z-handle
// for height, ring for heading rotation. Syncs with UI sliders.
// Regular 3D Tiles (IFC/Revit/iTwin/CityGML/local): selectable only
// while Transform mode is ON, moved via BimViewer.updateAssetPlacement
// (modelMatrix), highlighted with a bounding outline (no silhouette
// API on tilesets). Splats stay on the separate splat-gizmo.js.
// LIVE ONLY — no persistence yet.
// ============================================================

(function() {
  'use strict';

  // Axis colours — Cesium Ion Location Editor convention: X=east=red,
  // Y=north=green, Z=up=blue; rotation ring=yellow.
  var HANDLE_COLOR_X = Cesium.Color.fromCssColorString('#ff4d4d');
  var HANDLE_COLOR_Y = Cesium.Color.fromCssColorString('#4dd44d');
  var HANDLE_COLOR_Z = Cesium.Color.fromCssColorString('#4488ff');
  var HANDLE_COLOR_Z_HOVER = Cesium.Color.fromCssColorString('#66bbff');
  var HANDLE_COLOR_ROT = Cesium.Color.fromCssColorString('#ffcc00');
  var HANDLE_COLOR_ROT_HOVER = Cesium.Color.fromCssColorString('#ffee66');
  var SILHOUETTE_COLOR = Cesium.Color.CYAN;
  var SILHOUETTE_SIZE = 2.0;

  // Handle sizing (meters; auto-scaled per-frame by camera distance)
  var AXIS_LENGTH = 25;          // length of each translation arrow
  var ROTATION_RING_RADIUS = 20; // heading ring radius
  var ROTATION_RING_SEGMENTS = 48;

  var gizmo = {
    active: false,
    transformMode: false,   // when ON, regular 3D Tiles become click-selectable
    selectedAssetId: null,
    activeAxis: null,       // 'xy' | 'x' | 'y' | 'z' | 'heading'
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

  // ---- Placement adapter (GLB vs regular tileset) ----
  // GLB stores placement on ad.position / ad.heading; regular tilesets on
  // ad.placement.position / ad.placement.heading (see core.js initAssetPlacement).
  // These helpers let the drag/handle code stay type-agnostic.
  function getPos(ad) {
    if (!ad) return null;
    return ad.isGLB ? ad.position : (ad.placement && ad.placement.position);
  }

  function getHeading(ad) {
    if (!ad) return 0;
    return ad.isGLB ? (ad.heading || 0) : ((ad.placement && ad.placement.heading) || 0);
  }

  function setHeading(ad, deg) {
    if (!ad) return;
    if (ad.isGLB) ad.heading = deg;
    else if (ad.placement) ad.placement.heading = deg;
  }

  function applyPlacement(assetId, ad) {
    if (ad.isGLB) BimViewer.updateGLBPosition(assetId);
    else if (typeof BimViewer.updateAssetPlacement === 'function') BimViewer.updateAssetPlacement(assetId);
  }

  // A regular 3D Tiles asset that the gizmo can move (excludes GLB, and any
  // tileset without a placement baseline; splats live outside loadedAssets).
  function isMovableTileset(ad) {
    return !!(ad && !ad.isGLB && ad.tileset && ad.placement && ad.placement.position);
  }

  // Resolve a scene pick to a movable-tileset assetId (or null).
  function findTilesetAssetId(picked) {
    if (!picked) return null;
    var t = null;
    if (picked.primitive instanceof Cesium.Cesium3DTileset) t = picked.primitive;
    else if (picked.tileset) t = picked.tileset;                        // Cesium3DTileFeature
    else if (picked.content && picked.content.tileset) t = picked.content.tileset;
    if (!t) return null;
    var found = null;
    BimViewer.loadedAssets.forEach(function(ad, id) {
      if (isMovableTileset(ad) && ad.tileset === t) found = id;
    });
    return found;
  }

  function getModelOrigin(assetData) {
    var p = getPos(assetData);
    if (!p) return Cesium.Cartesian3.ZERO;
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
    // Only GLB assets have glb_* slider inputs; tilesets have no panel yet.
    if (!ad.isGLB) return;

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

  // One translation arrow (line + tip point) along a local ENU unit direction.
  // localUnit: (1,0,0)=east/X, (0,1,0)=north/Y, (0,0,1)=up/Z.
  function addAxisArrow(viewer, assetId, axisKey, localUnit, color) {
    function tipWorld() {
      var ad2 = getAssetData(assetId);
      if (!ad2) return null;
      var origin = getModelOrigin(ad2);
      var enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
      var local = Cesium.Cartesian3.multiplyByScalar(localUnit, AXIS_LENGTH, new Cesium.Cartesian3());
      return { origin: origin, tip: Cesium.Matrix4.multiplyByPoint(enu, local, new Cesium.Cartesian3()) };
    }

    // Ion-style arrow: PolylineArrowMaterial draws a tapered arrowhead (cone
    // look) at the tip while keeping disableDepthTest so the handle stays on top
    // of the model — a real cone (cylinder geometry) has no depth-test override
    // and would vanish inside the tileset.
    var line = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(function() {
          var w = tipWorld();
          return w ? [w.origin, w.tip] : [];
        }, false),
        width: 14,
        material: new Cesium.PolylineArrowMaterialProperty(color),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    line._gizmoAxis = axisKey;
    line._gizmoAssetId = assetId;
    gizmo.entities.push(line);

    // Small knob at the tip — clear grab target for the axis.
    var tip = viewer.entities.add({
      position: new Cesium.CallbackProperty(function() {
        var w = tipWorld();
        return w ? w.tip : Cesium.Cartesian3.ZERO;
      }, false),
      point: {
        pixelSize: 11,
        color: color,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    tip._gizmoAxis = axisKey;
    tip._gizmoAssetId = assetId;
    gizmo.entities.push(tip);
  }

  function createHandles(viewer, assetId) {
    removeHandles(viewer);
    var ad = getAssetData(assetId);
    if (!ad) return;

    // Three translation arrows — Ion-style X (east), Y (north), Z (up).
    addAxisArrow(viewer, assetId, 'x', new Cesium.Cartesian3(1, 0, 0), HANDLE_COLOR_X);
    addAxisArrow(viewer, assetId, 'y', new Cesium.Cartesian3(0, 1, 0), HANDLE_COLOR_Y);
    addAxisArrow(viewer, assetId, 'z', new Cesium.Cartesian3(0, 0, 1), HANDLE_COLOR_Z);

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
          var headRad = Cesium.Math.toRadians(getHeading(ad2));
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

  // Tilesets have no silhouette API, so mark selection with a bounding outline.
  // Follows the live world-space boundingSphere so it tracks gizmo moves.
  function createTilesetOutline(viewer, assetId) {
    var outline = viewer.entities.add({
      position: new Cesium.CallbackProperty(function() {
        var ad = getAssetData(assetId);
        if (!ad || !ad.tileset || !ad.tileset.boundingSphere) return Cesium.Cartesian3.ZERO;
        return ad.tileset.boundingSphere.center;
      }, false),
      ellipsoid: {
        radii: new Cesium.CallbackProperty(function() {
          var ad = getAssetData(assetId);
          var r = (ad && ad.tileset && ad.tileset.boundingSphere) ? ad.tileset.boundingSphere.radius : 1;
          return new Cesium.Cartesian3(r, r, r);
        }, false),
        fill: false,
        outline: true,
        outlineColor: SILHOUETTE_COLOR.withAlpha(0.8),
        outlineWidth: 2,
        slicePartitions: 12,
        stackPartitions: 12
      }
    });
    outline._gizmoOutline = true;
    gizmo.entities.push(outline);
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
    if (!ad) return;
    var isGLB = ad.isGLB && ad.model;
    var isTileset = isMovableTileset(ad);
    if (!isGLB && !isTileset) return;

    gizmo.selectedAssetId = assetId;
    gizmo.active = true;

    // Highlight \u2014 GLB uses silhouette, tilesets use a bounding outline
    if (isGLB) {
      gizmo._prevSilhouetteSize = ad.model.silhouetteSize;
      gizmo._prevSilhouetteColor = ad.model.silhouetteColor;
      ad.model.silhouetteColor = SILHOUETTE_COLOR;
      ad.model.silhouetteSize = SILHOUETTE_SIZE;
    }

    createHandles(viewer, assetId);
    if (isTileset) createTilesetOutline(viewer, assetId);
    viewer.canvas.style.cursor = 'pointer';
    console.log('\uD83C\uDFAF Gizmo: selected ' + ad.name + (isTileset ? ' (3D Tiles)' : ''));
  }

  function deselectModel() {
    var viewer = BimViewer.viewer;
    if (!viewer) return;

    if (gizmo.selectedAssetId) {
      var ad = getAssetData(gizmo.selectedAssetId);
      if (ad && ad.isGLB && ad.model) {
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

  async function onLeftDown(movement) {
    if (window.BimViewer && typeof BimViewer.isMeasuring === 'function' && BimViewer.isMeasuring()) return;
    var viewer = BimViewer.viewer;
    var picked = await viewer.scene.pickAsync(movement.position);
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

    // Check regular 3D Tiles asset — only while Transform mode is ON, so normal
    // element inspection (IFC InfoBox, hide, comments) keeps working when OFF.
    if (gizmo.transformMode) {
      var tilesetAssetId = findTilesetAssetId(picked);
      if (tilesetAssetId) {
        if (gizmo.selectedAssetId === tilesetAssetId) {
          startDrag('xy', movement.position);
        } else {
          selectModel(tilesetAssetId);
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

    var startPos = getPos(ad);
    if (!startPos) return;

    gizmo.activeAxis = axis;
    gizmo.dragging = true;
    gizmo.dragStartScreenY = screenPosition.y;
    gizmo.dragStartPosition = {
      lon: startPos.lon,
      lat: startPos.lat,
      height: startPos.height
    };
    gizmo.dragStartHeading = getHeading(ad);
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
      // Hover feedback — skip when measurement tool is active
      if (gizmo.active && !(window.BimViewer && typeof BimViewer.isMeasuring === 'function' && BimViewer.isMeasuring())) {
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
        } else if (gizmo.transformMode && gizmo.selectedAssetId && findTilesetAssetId(hovered) === gizmo.selectedAssetId) {
          viewer.canvas.style.cursor = 'move';
        } else {
          viewer.canvas.style.cursor = gizmo.active ? 'pointer' : '';
        }
      }
      return;
    }

    var ad = getAssetData(gizmo.selectedAssetId);
    if (!ad) return;

    var pos = getPos(ad);
    if (!pos) return;

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
      pos.lon = Cesium.Math.toDegrees(carto.longitude);
      pos.lat = Cesium.Math.toDegrees(carto.latitude);
      // Keep current height (don't snap to terrain)

    } else if (axis === 'x' || axis === 'y') {
      // Axis-constrained horizontal translation (Ion-style single arrow).
      // Project the picked world point onto the east (x) / north (y) axis line
      // through the drag-start origin, then keep the original height.
      var aray = viewer.camera.getPickRay(movement.endPosition);
      if (!aray) return;
      var apick = viewer.scene.globe.pick(aray, viewer.scene) || viewer.scene.pickPosition(movement.endPosition);
      if (!apick) return;

      var start = gizmo.dragStartPosition;
      var originC = Cesium.Cartesian3.fromDegrees(start.lon, start.lat, start.height);
      var enuA = Cesium.Transforms.eastNorthUpToFixedFrame(originC);
      var localUnit = (axis === 'x') ? new Cesium.Cartesian3(1, 0, 0) : new Cesium.Cartesian3(0, 1, 0);
      var axisPointW = Cesium.Matrix4.multiplyByPoint(enuA, localUnit, new Cesium.Cartesian3());
      var axisDir = Cesium.Cartesian3.subtract(axisPointW, originC, new Cesium.Cartesian3());
      Cesium.Cartesian3.normalize(axisDir, axisDir);

      var rel = Cesium.Cartesian3.subtract(apick, originC, new Cesium.Cartesian3());
      var d = Cesium.Cartesian3.dot(rel, axisDir);
      var moved = Cesium.Cartesian3.add(originC,
        Cesium.Cartesian3.multiplyByScalar(axisDir, d, new Cesium.Cartesian3()), new Cesium.Cartesian3());
      var mCarto = Cesium.Cartographic.fromCartesian(moved);
      pos.lon = Cesium.Math.toDegrees(mCarto.longitude);
      pos.lat = Cesium.Math.toDegrees(mCarto.latitude);
      // Keep original height (horizontal move only)
      pos.height = start.height;

    } else if (axis === 'z') {
      // Vertical drag — screen Y delta to height delta
      var deltaY = gizmo.dragStartScreenY - movement.endPosition.y;
      // Scale: pixels to meters. Approximate based on camera distance.
      var origin = getModelOrigin(ad);
      var cameraDist = Cesium.Cartesian3.distance(viewer.camera.positionWC, origin);
      var metersPerPixel = cameraDist * 0.001; // rough approximation
      pos.height = gizmo.dragStartPosition.height + deltaY * metersPerPixel;

    } else if (axis === 'heading') {
      var currentAngle = screenToAngle(viewer, ad, movement.endPosition);
      if (currentAngle !== null && gizmo.dragStartAngle !== null) {
        var deltaAngle = currentAngle - gizmo.dragStartAngle;
        var deltaDeg = Cesium.Math.toDegrees(deltaAngle);
        setHeading(ad, (gizmo.dragStartHeading - deltaDeg + 360) % 360);
      }
    }

    applyPlacement(gizmo.selectedAssetId, ad);
    syncUI(gizmo.selectedAssetId);
  }

  function onLeftUp() {
    if (!gizmo.dragging) return;
    var viewer = BimViewer.viewer;

    gizmo.dragging = false;
    gizmo.activeAxis = null;
    viewer.scene.screenSpaceCameraController.enableInputs = true;
    viewer.canvas.style.cursor = gizmo.active ? 'pointer' : '';

    var ad = getAssetData(gizmo.selectedAssetId);

    // Keep the Loaded-Assets z-offset slider in sync after a gizmo height move.
    // Height is shared with the z-offset system for trusted-placement tilesets
    // (see core.js initAssetPlacement / z-offset.js applyZOffsetToAsset), so the
    // card must reflect the new offset = placement.height − baseHeight.
    if (ad && !ad.isGLB && ad.placement && ad.placement.trusted && ad.placement.position &&
        ad.tileset && BimViewer.zOffset) {
      var base = (ad.placement.baseHeight !== undefined && ad.placement.baseHeight !== null)
        ? ad.placement.baseHeight : ad.placement.position.height;
      var offset = ad.placement.position.height - base;
      BimViewer.zOffset.individualOffsets.set(ad.tileset, offset);
      if (typeof BimViewer.syncZOffsetUI === 'function') {
        BimViewer.syncZOffsetUI(String(gizmo.selectedAssetId), offset);
      }
    }

    // Notify SIB module of position change
    if (gizmo.selectedAssetId && window.BimSIB && typeof BimSIB.onPositionChanged === 'function') {
      if (ad && ad.isSIB) {
        BimSIB.onPositionChanged(gizmo.selectedAssetId, ad);
      }
    }
  }

  // ---- Keyboard ----

  function onKeyDown(e) {
    if (e.key === 'Escape' && gizmo.active) {
      deselectModel();
      return;
    }

    // Toggle Transform mode with 'X' — guard against typing fields, modifiers,
    // and walk mode (per CLAUDE.md keyboard-handler rule).
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (window.BimFirstPerson && typeof BimFirstPerson.isActive === 'function' && BimFirstPerson.isActive()) return;
    if (e.key === 'x' || e.key === 'X') {
      toggleTransformMode();
    }
  }

  // ---- Transform mode (global click-pick gate for regular 3D Tiles) ----

  function setTransformMode(on) {
    gizmo.transformMode = !!on;
    // Leaving transform mode drops a tileset selection (GLB stays selectable always).
    if (!gizmo.transformMode && gizmo.selectedAssetId) {
      var ad = getAssetData(gizmo.selectedAssetId);
      if (ad && !ad.isGLB) deselectModel();
    }
    if (window.BimViewer && typeof BimViewer.updateStatus === 'function') {
      BimViewer.updateStatus(
        'Transform mode ' + (gizmo.transformMode ? 'ON — click an asset to move it (X to exit)' : 'OFF'),
        gizmo.transformMode ? 'success' : 'info');
    }
    var btn = document.getElementById('gizmoTransformBtn');
    if (btn) btn.classList.toggle('active', gizmo.transformMode);
    console.log('🔧 Gizmo transform mode: ' + (gizmo.transformMode ? 'ON' : 'OFF'));
  }

  function toggleTransformMode() {
    setTransformMode(!gizmo.transformMode);
  }

  // ---- Scale handles with camera distance ----

  function updateHandleSizes() {
    if (!gizmo.active || !gizmo.selectedAssetId) return;
    var viewer = BimViewer.viewer;
    var ad = getAssetData(gizmo.selectedAssetId);
    if (!ad) return;

    var origin = getModelOrigin(ad);
    var cameraDist = Cesium.Cartesian3.distance(viewer.camera.positionWC, origin);

    // Scale handles proportional to camera distance (screen-constant feel)
    var scaleFactor = Math.max(0.5, cameraDist * 0.03);
    AXIS_LENGTH = scaleFactor;
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

    console.log('\u2705 Asset Gizmo initialized (click GLB to select; press X for Transform mode to move 3D Tiles; drag to move, Z-handle for height, ring for heading)');
  }

  // Expose
  window.BimGizmo = {
    gizmo: gizmo,
    selectModel: selectModel,
    deselectModel: deselectModel,
    setTransformMode: setTransformMode,
    toggleTransformMode: toggleTransformMode,
    isTransformMode: function() { return gizmo.transformMode; },
    init: init
  };

  // Auto-init after viewer is ready
  if (document.readyState === 'complete') {
    setTimeout(init, 1000);
  } else {
    window.addEventListener('load', function() { setTimeout(init, 1000); });
  }

})();
