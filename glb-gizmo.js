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
    // Pivot snapshot for a heading drag — frozen at drag start so the
    // counter-translation can't chase its own moving target.
    dragStartPivot: null,
    dragPivotEnu: null,       // ENU frame at the pivot
    dragOriginLocal: null,    // transform origin expressed in that frame
    dragLastAngle: null,      // for unwrapping the atan2 branch cut
    dragTotalAngle: 0,
    // Grab-offset state for xy / z drags
    dragStartGround: null,
    dragStartOriginC: null,
    dragAxisDir: null,
    dragAxisStartS: null,
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

  // The transform origin — the point the modelMatrix is built around.
  function getModelOrigin(assetData) {
    var p = getPos(assetData);
    if (!p) return Cesium.Cartesian3.ZERO;
    return Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.height);
  }

  // World-space centre of the rendered geometry, or null while the bounding
  // volume isn't available yet.
  function getVisualCenter(assetData) {
    if (!assetData) return null;
    try {
      if (assetData.isGLB) {
        if (!assetData.model || !assetData.model.ready) return null;
        var mbs = assetData.model.boundingSphere;
        return (mbs && mbs.center) ? mbs.center : null;
      }
      var tbs = assetData.tileset && assetData.tileset.boundingSphere;
      return (tbs && tbs.center) ? tbs.center : null;
    } catch (e) {
      return null;   // bounding volume not ready yet
    }
  }

  // Where the handles sit, and what heading rotation turns around.
  //
  // The transform origin is the georef origin of the source model — for IFC and
  // Revit exports that is the project base / survey point, routinely hundreds of
  // metres from the geometry. Anchoring there put the arrows and the ring far
  // off the asset and made rotation swing it along a wide arc.
  //
  // Pivot = the visual centre horizontally, at the transform origin's height, so
  // the ring lies on the ground under the model and the Z arrow still starts
  // exactly where placement.height points (keeps the z-offset slider coherent).
  function getGizmoPivot(assetData) {
    var origin = getModelOrigin(assetData);
    var center = getVisualCenter(assetData);
    if (!center) return origin;
    var cc = Cesium.Cartographic.fromCartesian(center);
    var oc = Cesium.Cartographic.fromCartesian(origin);
    if (!cc || !oc) return origin;
    return Cesium.Cartesian3.fromRadians(cc.longitude, cc.latitude, oc.height);
  }

  function screenToAngle(viewer, originWorld, screenPos) {
    if (!originWorld) return null;
    var originScreen = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, originWorld);
    if (!originScreen) return null;
    return Math.atan2(screenPos.y - originScreen.y, screenPos.x - originScreen.x);
  }

  // Signed distance along `axisDir` (unit, world) from `originC` to the point on
  // that axis line closest to the mouse ray — the standard closest-approach of
  // two skew lines. Returns null when the ray runs near-parallel to the axis,
  // where the projection is ill-conditioned.
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
      var origin = getGizmoPivot(ad2);
      var enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
      var local = Cesium.Cartesian3.multiplyByScalar(localUnit, AXIS_LENGTH, new Cesium.Cartesian3());
      return { origin: origin, tip: Cesium.Matrix4.multiplyByPoint(enu, local, new Cesium.Cartesian3()) };
    }

    // Ion-style arrow: PolylineArrowMaterial draws a tapered arrowhead (cone
    // look) at the tip — a real cone (cylinder geometry) would be occluded
    // inside the tileset with no way to override it.
    //
    // KNOWN LIMITATION — the shafts are occluded by geometry they sit inside.
    // disableDepthTestDistance below does nothing: PolylineGraphics has no such
    // property (point/billboard/label only). depthFailMaterial doesn't help
    // either — CallbackProperty positions force PolylineGeometryUpdater onto its
    // dynamic path, which renders via PolylineCollection (no depth-fail support
    // at all) and never forwards the property. Fixing it means rebuilding the
    // handles as a Primitive with depthFailAppearance: static local geometry,
    // per-frame modelMatrix = ENU(pivot) × rotZ × scale.
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
          var origin = getGizmoPivot(ad2);
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
          var origin = getGizmoPivot(ad2);
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

    var originC = Cesium.Cartesian3.fromDegrees(startPos.lon, startPos.lat, startPos.height);
    gizmo.dragStartOriginC = originC;

    if (axis === 'heading') {
      // Freeze the pivot for the whole drag and express the transform origin in
      // its ENU frame — everything below rotates that one vector.
      var pivot = getGizmoPivot(ad);
      gizmo.dragStartPivot = pivot;
      gizmo.dragPivotEnu = Cesium.Transforms.eastNorthUpToFixedFrame(pivot);
      var pivotEnuInv = Cesium.Matrix4.inverse(gizmo.dragPivotEnu, new Cesium.Matrix4());
      gizmo.dragOriginLocal = Cesium.Matrix4.multiplyByPoint(pivotEnuInv, originC, new Cesium.Cartesian3());
      gizmo.dragStartAngle = screenToAngle(viewer, pivot, screenPosition);
      gizmo.dragLastAngle = gizmo.dragStartAngle;
      gizmo.dragTotalAngle = 0;

    } else if (axis === 'xy') {
      // Remember where on the ground the grab started, so the model keeps its
      // offset to the cursor instead of teleporting its origin under it.
      gizmo.dragStartGround = pickGround(viewer, screenPosition);

    } else if (axis === 'x' || axis === 'y' || axis === 'z') {
      // All three arrows drag the same way: project the cursor ray onto the axis
      // line and track the delta from the grab point, so the spot grabbed on the
      // arrow stays under the cursor.
      var aDir;
      if (axis === 'z') {
        aDir = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(originC, new Cesium.Cartesian3());
      } else {
        var enuA = Cesium.Transforms.eastNorthUpToFixedFrame(originC);
        var lu = (axis === 'x') ? new Cesium.Cartesian3(1, 0, 0) : new Cesium.Cartesian3(0, 1, 0);
        var axisPtW = Cesium.Matrix4.multiplyByPoint(enuA, lu, new Cesium.Cartesian3());
        aDir = Cesium.Cartesian3.subtract(axisPtW, originC, new Cesium.Cartesian3());
        Cesium.Cartesian3.normalize(aDir, aDir);
      }
      gizmo.dragAxisDir = aDir || null;
      gizmo.dragAxisStartS = aDir ? projectRayOntoAxis(viewer, screenPosition, originC, aDir) : null;
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
      var cartesian = pickGround(viewer, movement.endPosition);
      if (!cartesian) return;

      var carto;
      if (gizmo.dragStartGround && gizmo.dragStartOriginC) {
        // Move by the cursor's ground delta, preserving the grab offset. Setting
        // the origin straight to the cursor would jump the asset by however far
        // its georef origin sits from the geometry.
        var gDelta = Cesium.Cartesian3.subtract(cartesian, gizmo.dragStartGround, new Cesium.Cartesian3());
        var movedO = Cesium.Cartesian3.add(gizmo.dragStartOriginC, gDelta, new Cesium.Cartesian3());
        carto = Cesium.Cartographic.fromCartesian(movedO);
      } else {
        carto = Cesium.Cartographic.fromCartesian(cartesian);
      }
      if (!carto) return;
      pos.lon = Cesium.Math.toDegrees(carto.longitude);
      pos.lat = Cesium.Math.toDegrees(carto.latitude);
      // Keep current height (don't snap to terrain)
      pos.height = gizmo.dragStartPosition.height;

    } else if (axis === 'x' || axis === 'y' || axis === 'z') {
      // Axis-constrained translation (Ion-style single arrow). The cursor ray is
      // projected onto the axis line through the drag-start origin and only the
      // delta since the grab is applied — exact metres, terrain-independent, and
      // no jump when the arrow is grabbed away from its base. The Z handle used
      // to guess metres from screen-Y × camera distance, which drifted with zoom
      // and view angle; X/Y used a terrain pick that needed loaded terrain.
      if (!gizmo.dragAxisDir || gizmo.dragAxisStartS === null || !gizmo.dragStartOriginC) return;
      var s = projectRayOntoAxis(viewer, movement.endPosition, gizmo.dragStartOriginC, gizmo.dragAxisDir);
      if (s === null) return;   // ray near-parallel to the axis — keep the last value
      var along = s - gizmo.dragAxisStartS;

      if (axis === 'z') {
        pos.height = gizmo.dragStartPosition.height + along;
      } else {
        var movedC = Cesium.Cartesian3.add(gizmo.dragStartOriginC,
          Cesium.Cartesian3.multiplyByScalar(gizmo.dragAxisDir, along, new Cesium.Cartesian3()),
          new Cesium.Cartesian3());
        var mCarto = Cesium.Cartographic.fromCartesian(movedC);
        if (!mCarto) return;
        pos.lon = Cesium.Math.toDegrees(mCarto.longitude);
        pos.lat = Cesium.Math.toDegrees(mCarto.latitude);
        pos.height = gizmo.dragStartPosition.height;   // horizontal move only
      }

    } else if (axis === 'heading') {
      var currentAngle = screenToAngle(viewer, gizmo.dragStartPivot, movement.endPosition);
      if (currentAngle !== null && gizmo.dragLastAngle !== null) {
        // Accumulate unwrapped per-frame increments: a raw difference against the
        // start angle jumps by a full turn when the drag crosses atan2's ±180°
        // seam, which would now fling the asset around the pivot.
        var inc = currentAngle - gizmo.dragLastAngle;
        while (inc > Math.PI) inc -= 2 * Math.PI;
        while (inc < -Math.PI) inc += 2 * Math.PI;
        gizmo.dragTotalAngle += inc;
        gizmo.dragLastAngle = currentAngle;

        // Screen angles grow clockwise (window Y points down) and heading grows
        // clockwise from north, so the two run in the same direction. The old
        // minus here turned the asset against the cursor; splat-gizmo.js always
        // used a plus, and the heading indicator confirms the plus is right.
        var dh = Cesium.Math.toDegrees(gizmo.dragTotalAngle);
        setHeading(ad, ((gizmo.dragStartHeading + dh) % 360 + 360) % 360);

        // The modelMatrix rotates about the transform origin, so counter-rotate
        // that origin around the pivot by the same angle. Net effect: the pivot
        // holds still and the asset spins in place.
        if (gizmo.dragPivotEnu && gizmo.dragOriginLocal) {
          var rot = Cesium.Matrix3.fromRotationZ(-Cesium.Math.toRadians(dh));
          var vRot = Cesium.Matrix3.multiplyByVector(rot, gizmo.dragOriginLocal, new Cesium.Cartesian3());
          var newOriginC = Cesium.Matrix4.multiplyByPoint(gizmo.dragPivotEnu, vRot, new Cesium.Cartesian3());
          var nCarto = Cesium.Cartographic.fromCartesian(newOriginC);
          if (nCarto) {
            pos.lon = Cesium.Math.toDegrees(nCarto.longitude);
            pos.lat = Cesium.Math.toDegrees(nCarto.latitude);
            // Turning about the local up axis must not change height — pin it so
            // the shared z-offset value can't drift across repeated drags.
            pos.height = gizmo.dragStartPosition.height;
          }
        }
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
    // Drop the per-drag snapshots so a stale pivot can't leak into the next drag.
    gizmo.dragStartPivot = null;
    gizmo.dragPivotEnu = null;
    gizmo.dragOriginLocal = null;
    gizmo.dragLastAngle = null;
    gizmo.dragTotalAngle = 0;
    gizmo.dragStartGround = null;
    gizmo.dragStartOriginC = null;
    gizmo.dragAxisDir = null;
    gizmo.dragAxisStartS = null;
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

    var origin = getGizmoPivot(ad);
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
