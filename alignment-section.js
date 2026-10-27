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
// ALIGNMENT SECTION MODULE v2.0
// Section planes of a self-hosted tileset, as in geoBIM Desktop, in three modes:
//   Axis  perpendicular to an IfcAlignment axis, moved by station. The axes
//         come from alignments.json, written by the geobim tiler next to
//         tileset.json (points, tangents and distances in the tileset's local
//         frame, Z-up metres, plus IfcReferent markers).
//   Line  section A–A through two clicked points, moved across the line.
//   Plan  horizontal cut, moved in height; Storey −/+ jumps to floor + 1.00 m
//         (storeys from levels.json next to tileset.json, else read from the
//         tiles by section-profile.js).
// One plane in the tileset's ClippingPlaneCollection, kept side = the side the
// plane normal points to (the viewing direction of the 2D drawing). The cut
// applies to that asset, nothing else. Cut faces are not filled in 3D.
// ===============================
'use strict';

(function() {

  // =====================================
  // STATE
  // =====================================

  BimViewer.alignmentSection = {
    activeAssetId: null,
    axesByAsset: new Map(),   // assetId → Promise<alignments.json | null>
    levelsByAsset: new Map(), // assetId → Promise<[{ name, z }]>
    state: null,              // { mode, assetId, tileset, data, axisIndex, distance, flipped, rangeMin, rangeMax, box, line, levels, collection, entities }
    draw: null                // section line being drawn: { assetId, tileset, points, cursor, handler, entities }
  };

  var STEP_BUTTONS = { axis: [-10, -1, 1, 10], line: [-1, -0.1, 0.1, 1], plan: [-1, -0.1, 0.1, 1] };
  var MODE_LABELS = { axis: 'Axis', line: 'Line', plan: 'Plan' };
  var CAMERA_BACKOFF_M = 60;
  var CAMERA_RISE_M = 8;
  var PLAN_CUT_ABOVE_FLOOR_M = 1.0;
  var lineCount = 0;

  // =====================================
  // DATA
  // =====================================

  function tilesetFile(assetId) {
    var ad = BimViewer.loadedAssets.get(assetId);
    return ad && ad.tileset && ad.modelDef && ad.modelDef.type === 'TILESET' ? ad.modelDef.file : null;
  }

  function besideTileset(file, name) {
    return file.replace(/tileset\.json(\?.*)?$/, name);
  }

  // JSON from older tilers is Windows-1252: no valid UTF-8 means Latin-1.
  var utf8 = new TextDecoder('utf-8', { fatal: true });
  var latin1 = new TextDecoder('windows-1252');
  function readJson(r) {
    return !r.ok ? null : r.arrayBuffer().then(function(buf) {
      var s;
      try { s = utf8.decode(buf); } catch (e) { s = latin1.decode(buf); }
      return JSON.parse(s);
    });
  }

  // alignments.json lives next to tileset.json. A missing file is the normal
  // case (models without IfcAlignment, uploads from before tiler 1.3), so a 404
  // resolves to null quietly.
  function loadAxes(assetId) {
    var cache = BimViewer.alignmentSection.axesByAsset;
    if (cache.has(assetId)) return cache.get(assetId);
    var file = tilesetFile(assetId);
    var p = !file ? Promise.resolve(null) :
      fetch(besideTileset(file, 'alignments.json'), { cache: 'no-cache' })
        .then(readJson)
        .then(function(d) {
          return (d && d.frame === 'tileset-local' && Array.isArray(d.alignments) && d.alignments.length) ? d : null;
        })
        .catch(function() { return null; });
    cache.set(assetId, p);
    return p;
  }

  // Storeys, lowest first: levels.json from the tiler
  // ({ frame: 'tileset-local', levels: [{ name, elevation }] }, elevation = floor
  // height in the local frame), else read from all tiles once (section-profile.js).
  function loadLevels(assetId) {
    var cache = BimViewer.alignmentSection.levelsByAsset;
    if (cache.has(assetId)) return cache.get(assetId);
    var file = tilesetFile(assetId);
    var p = !file ? Promise.resolve([]) :
      fetch(besideTileset(file, 'levels.json'), { cache: 'no-cache' })
        .then(readJson)
        .catch(function() { return null; })
        .then(function(d) {
          if (d && d.frame === 'tileset-local' && Array.isArray(d.levels)) {
            return d.levels
              .filter(function(l) { return l && isFinite(l.elevation); })
              .map(function(l) { return { name: String(l.name || ''), z: +l.elevation }; })
              .sort(function(a, b) { return a.z - b.z; });
          }
          return typeof BimViewer.computeSectionLevels === 'function'
            ? BimViewer.computeSectionLevels(assetId, file) : [];
        })
        .catch(function(err) {
          console.warn('Storeys failed:', err);
          cache.delete(assetId);
          return [];
        });
    cache.set(assetId, p);
    return p;
  }

  // Point and unit tangent at a distance along the axis, tileset-local frame.
  function sampleAxis(axis, distance) {
    var d = axis.distances;
    var n = d.length;
    var s = Math.min(Math.max(distance, d[0]), d[n - 1]);
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (d[mid] <= s) lo = mid; else hi = mid;
    }
    var span = d[hi] - d[lo];
    var t = span > 1e-9 ? (s - d[lo]) / span : 0;
    function lerp(arr, k) { return arr[lo * 3 + k] + (arr[hi * 3 + k] - arr[lo * 3 + k]) * t; }
    var p = new Cesium.Cartesian3(lerp(axis.points, 0), lerp(axis.points, 1), lerp(axis.points, 2));
    var tg = new Cesium.Cartesian3(lerp(axis.tangents, 0), lerp(axis.tangents, 1), lerp(axis.tangents, 2));
    if (Cesium.Cartesian3.magnitude(tg) < 1e-9) tg = new Cesium.Cartesian3(1, 0, 0);
    return { point: p, tangent: Cesium.Cartesian3.normalize(tg, tg) };
  }

  // Chainage as "0+192.40", "1+005.00", "-0+012.50".
  function formatStation(s) {
    var sign = s < 0 ? '-' : '';
    var a = Math.abs(s);
    var km = Math.floor(a / 1000);
    var m = a - km * 1000;
    if (m >= 999.995) { km += 1; m = 0; }
    var ms = m.toFixed(2);
    while (ms.length < 6) ms = '0' + ms;
    return sign + km + '+' + ms;
  }

  function formatSigned(v) {
    return (v < 0 ? '−' : '+') + Math.abs(v).toFixed(2);
  }

  // Tileset-local → world (ECEF). root.computedTransform already includes the
  // tileset's modelMatrix, so gizmo moves and saved placements carry the axis.
  function toWorld(tileset, local) {
    return Cesium.Matrix4.multiplyByPoint(tileset.root.computedTransform, local, new Cesium.Cartesian3());
  }

  function dirToWorld(tileset, local) {
    var v = Cesium.Matrix4.multiplyByPointAsVector(tileset.root.computedTransform, local, new Cesium.Cartesian3());
    return Cesium.Cartesian3.normalize(v, v);
  }

  function toLocal(tileset, world) {
    var inv = Cesium.Matrix4.inverse(tileset.root.computedTransform, new Cesium.Matrix4());
    return Cesium.Matrix4.multiplyByPoint(inv, world, new Cesium.Cartesian3());
  }

  // The root tile's bounding volume as an axis-aligned box in the local frame
  // (geobim tilesets: X east, Y north, Z up).
  function localBox(tileset) {
    var bv = tileset.root.boundingVolume && tileset.root.boundingVolume.boundingVolume;
    var corners;
    if (bv && bv.halfAxes) {
      corners = Cesium.OrientedBoundingBox.computeCorners(bv);
    } else {
      var sphere = tileset.boundingSphere;
      corners = [];
      for (var c = 0; c < 8; c++) {
        corners.push(new Cesium.Cartesian3(
          sphere.center.x + ((c & 1) ? 1 : -1) * sphere.radius,
          sphere.center.y + ((c & 2) ? 1 : -1) * sphere.radius,
          sphere.center.z + ((c & 4) ? 1 : -1) * sphere.radius));
      }
    }
    var min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
    corners.forEach(function(w) {
      var l = toLocal(tileset, w);
      ['x', 'y', 'z'].forEach(function(k) {
        if (l[k] < min[k]) min[k] = l[k];
        if (l[k] > max[k]) max[k] = l[k];
      });
    });
    return { min: min, max: max, corners: corners.map(function(w) { return toLocal(tileset, w); }) };
  }

  // =====================================
  // PLANE
  // =====================================

  function currentAxis(st) {
    return st.data.alignments[st.axisIndex];
  }

  // The cut in the local frame: a point on the plane and the viewing direction
  // (= plane normal, pointing into the part that is kept).
  function localCut(st) {
    if (st.mode === 'plan') {
      return {
        point: new Cesium.Cartesian3((st.box.min.x + st.box.max.x) / 2, (st.box.min.y + st.box.max.y) / 2, st.distance),
        direction: new Cesium.Cartesian3(0, 0, st.flipped ? 1 : -1)   // from above: the part below is kept
      };
    }
    if (st.mode === 'line') {
      var n = st.line.normal;
      // Height 0 of the local frame: the drawing's heights are the model's own.
      return {
        point: new Cesium.Cartesian3(st.line.a.x + n.x * st.distance, st.line.a.y + n.y * st.distance, 0),
        direction: new Cesium.Cartesian3(st.flipped ? -n.x : n.x, st.flipped ? -n.y : n.y, 0)
      };
    }
    var s = sampleAxis(currentAxis(st), st.distance);
    var dir = Cesium.Cartesian3.clone(s.tangent);
    if (st.flipped) Cesium.Cartesian3.negate(dir, dir);
    return { point: s.point, direction: dir, tangent: s.tangent };
  }

  // A tileset's clipping planes are measured in clippingPlanesOriginMatrix
  // (Cesium3DTileset.js: root.computedTransform × an ENU frame at the original
  // bounding-sphere centre), not in the root frame. Going through world space
  // keeps this independent of which of those Cesium picked.
  function planeFor(tileset, cut) {
    var inv = Cesium.Matrix4.inverse(tileset.clippingPlanesOriginMatrix, new Cesium.Matrix4());
    var pw = toWorld(tileset, cut.point);
    var nw = dirToWorld(tileset, cut.direction);
    var pc = Cesium.Matrix4.multiplyByPoint(inv, pw, new Cesium.Cartesian3());
    var nc = Cesium.Matrix4.multiplyByPointAsVector(inv, nw, new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(nc, nc);
    return { normal: nc, distance: -Cesium.Cartesian3.dot(nc, pc) };
  }

  // Consumers (section-profile.js) follow the section through this event and
  // BimViewer.getAlignmentSection(), instead of hooking the setters.
  function notifyChange() {
    window.dispatchEvent(new CustomEvent('geobim:alignment-section'));
  }

  function syncPlane() {
    var st = BimViewer.alignmentSection.state;
    if (!st) return;
    var p = planeFor(st.tileset, localCut(st));
    var plane = st.collection.get(0);
    Cesium.Cartesian3.clone(p.normal, plane.normal);
    plane.distance = p.distance;
    notifyChange();
  }

  // =====================================
  // OVERLAY
  // =====================================

  var TEAL = Cesium.Color.fromCssColorString('#2ECFB0');

  function overlayLine(positions, width) {
    return BimViewer.viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(positions, false),
        width: width,
        material: TEAL,
        depthFailMaterial: TEAL.withAlpha(0.45),
        clampToGround: false
      }
    });
  }

  // Positions follow the tileset: recomputed only when root.computedTransform
  // changes (gizmo, heading slider, z-offset), not every frame.
  function axisPositions(st) {
    var lastMatrix = null, lastIndex = -1, cached = [];
    return function() {
      var m = st.tileset.root.computedTransform;
      if (lastIndex === st.axisIndex && lastMatrix && Cesium.Matrix4.equals(m, lastMatrix)) return cached;
      var pts = currentAxis(st).points;
      cached = [];
      for (var i = 0; i < pts.length; i += 3) {
        cached.push(toWorld(st.tileset, new Cesium.Cartesian3(pts[i], pts[i + 1], pts[i + 2])));
      }
      lastMatrix = Cesium.Matrix4.clone(m);
      lastIndex = st.axisIndex;
      return cached;
    };
  }

  // Line: the plane as a frame over the model's height, arrows in the viewing
  // direction at its foot and the letters at the top (section A–A).
  function lineFrame(st) {
    var n = st.line.normal, a = st.line.a, b = st.line.b;
    var z0 = st.box.min.z, z1 = st.box.max.z;
    function at(p, z) { return new Cesium.Cartesian3(p.x + n.x * st.distance, p.y + n.y * st.distance, z); }
    return {
      a0: at(a, z0), b0: at(b, z0), a1: at(a, z1), b1: at(b, z1),
      along: Cesium.Cartesian3.normalize(new Cesium.Cartesian3(b.x - a.x, b.y - a.y, 0), new Cesium.Cartesian3()),
      length: Math.hypot(b.x - a.x, b.y - a.y)
    };
  }

  function arrowPositions(st, end) {
    return function() {
      var f = lineFrame(st), cut = localCut(st);
      var p = f[end], d = cut.direction, s = f.along;
      var len = Math.min(Math.max(f.length * 0.08, 1), 8);
      var tip = new Cesium.Cartesian3(p.x + d.x * len, p.y + d.y * len, p.z);
      function wing(sign) {
        return new Cesium.Cartesian3(tip.x - d.x * len * 0.4 + sign * s.x * len * 0.3,
          tip.y - d.y * len * 0.4 + sign * s.y * len * 0.3, tip.z);
      }
      return [p, tip, wing(1), tip, wing(-1)].map(function(l) { return toWorld(st.tileset, l); });
    };
  }

  function letterEntity(st, end) {
    var letter = String.fromCharCode(65 + (st.line.number - 1) % 26);
    return BimViewer.viewer.entities.add({
      position: new Cesium.CallbackProperty(function() { return toWorld(st.tileset, lineFrame(st)[end]); }, false),
      label: {
        text: letter,
        font: 'bold 14px sans-serif',
        fillColor: TEAL,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
  }

  function addOverlay(st) {
    if (st.mode === 'line') {
      st.entities.push(overlayLine(function() {
        var f = lineFrame(st);
        return [f.a0, f.b0, f.b1, f.a1, f.a0].map(function(l) { return toWorld(st.tileset, l); });
      }, 3));
      st.entities.push(overlayLine(arrowPositions(st, 'a0'), 3));
      st.entities.push(overlayLine(arrowPositions(st, 'b0'), 3));
      st.entities.push(letterEntity(st, 'a1'), letterEntity(st, 'b1'));
      return;
    }
    if (st.mode === 'plan') {
      // The plane as the model's outline at the cut height.
      st.entities.push(overlayLine(function() {
        var b = st.box, z = st.distance;
        return [[b.min.x, b.min.y], [b.max.x, b.min.y], [b.max.x, b.max.y], [b.min.x, b.max.y], [b.min.x, b.min.y]]
          .map(function(c) { return toWorld(st.tileset, new Cesium.Cartesian3(c[0], c[1], z)); });
      }, 3));
      return;
    }
    st.entities.push(overlayLine(axisPositions(st), 3));
    st.entities.push(BimViewer.viewer.entities.add({
      position: new Cesium.CallbackProperty(function() {
        return toWorld(st.tileset, sampleAxis(currentAxis(st), st.distance).point);
      }, false),
      point: {
        pixelSize: 10,
        color: TEAL,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    }));
    addMarkers(st);
  }

  // IfcReferent markers of the selected axis. Only chainage marks
  // (REFERENCEMARKER / STATION) get a label, and only close up: Viadotto Acerno
  // alone has 89 referents, half of them bearing positions right next to a
  // chainage mark, which would otherwise print on top of each other.
  var LABELLED_MARKERS = { REFERENCEMARKER: true, STATION: true, KILOPOINT: true, MILEPOINT: true };
  var MARKER_RANGE = new Cesium.DistanceDisplayCondition(0, 1500);

  function addMarkers(st) {
    var entities = BimViewer.viewer.entities;
    removeMarkers(st);
    var axis = currentAxis(st);
    (axis.markers || []).forEach(function(mk) {
      var local = sampleAxis(axis, mk.distance).point;
      var entity = {
        // Callback, like the axis line, so markers move with the gizmo
        position: new Cesium.CallbackProperty(function() { return toWorld(st.tileset, local); }, false),
        point: { pixelSize: 5, color: Cesium.Color.WHITE.withAlpha(0.85), distanceDisplayCondition: MARKER_RANGE }
      };
      if (LABELLED_MARKERS[mk.type]) entity.label = {
          text: mk.name || formatStation(axis.startStation + mk.distance),
          font: '11px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -12),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 150)
        };
      st.markerEntities.push(entities.add(entity));
    });
  }

  function removeMarkers(st) {
    (st.markerEntities || []).forEach(function(e) { BimViewer.viewer.entities.remove(e); });
    st.markerEntities = [];
  }

  // =====================================
  // ACTIVATE / DEACTIVATE
  // =====================================

  // Card button: off if this asset is cut or being drawn on, else the axis
  // section if the model has one, else a section line (as in geoBIM Desktop).
  BimViewer.toggleAlignmentSection = async function(assetId) {
    assetId = assetId.toString();
    var as = this.alignmentSection;
    if (as.activeAssetId === assetId || (as.draw && as.draw.assetId === assetId)) {
      this.cancelSectionLine();
      this.deactivateAlignmentSection();
      return;
    }
    var axes = await loadAxes(assetId);
    if (axes) return this.activateAlignmentSection(assetId);
    this.startSectionLine(assetId);
  };

  BimViewer.setSectionMode = function(assetId, mode) {
    assetId = assetId.toString();
    if (mode === 'axis') this.activateAlignmentSection(assetId);
    else if (mode === 'line') this.startSectionLine(assetId);
    else this.activatePlanSection(assetId);
  };

  // Common start of all modes: the previous section goes, the X/Y/Z planes
  // step aside (one ClippingPlaneCollection per tileset).
  function begin(assetId, mode, data) {
    var ad = BimViewer.loadedAssets.get(assetId);
    BimViewer.cancelSectionLine();
    BimViewer.deactivateAlignmentSection(true);
    if (BimViewer.clipPlanes && BimViewer.clipPlanes.activeAssetId === assetId) {
      BimViewer.deactivateAssetClipping(assetId);
    }
    return {
      mode: mode,
      assetId: assetId,
      tileset: ad.tileset,
      data: data,
      axisIndex: 0,
      distance: 0,
      flipped: false,
      rangeMin: 0,
      rangeMax: 0,
      box: localBox(ad.tileset),
      line: null,
      levels: null,
      collection: null,
      entities: [],
      markerEntities: []
    };
  }

  function start(st) {
    var p = planeFor(st.tileset, localCut(st));
    st.collection = new Cesium.ClippingPlaneCollection({
      planes: [new Cesium.ClippingPlane(p.normal, p.distance)],
      edgeColor: Cesium.Color.WHITE,
      edgeWidth: 1.0,
      enabled: true
    });
    st.tileset.clippingPlanes = st.collection;
    BimViewer.alignmentSection.state = st;
    BimViewer.alignmentSection.activeAssetId = st.assetId;
    addOverlay(st);
    BimViewer.injectAlignmentControls(st.assetId);
    var btn = document.getElementById('axisBtn_' + st.assetId);
    if (btn) btn.classList.add('axis-active');
    BimViewer.viewer.scene.requestRender();
    notifyChange();
  }

  BimViewer.activateAlignmentSection = async function(assetId) {
    assetId = assetId.toString();
    var ad = this.loadedAssets.get(assetId);
    if (!ad || !ad.tileset) return;
    var data = await loadAxes(assetId);
    if (!data) {
      this.updateStatus('No alignment axis in this model', 'warning');
      return;
    }
    var st = begin(assetId, 'axis', data);
    st.distance = data.alignments[0].length / 2;
    st.rangeMax = data.alignments[0].length;
    start(st);
    this.updateStatus('Alignment section active', 'success');
  };

  BimViewer.activatePlanSection = function(assetId) {
    assetId = assetId.toString();
    if (!tilesetFile(assetId)) {
      this.updateStatus('Sections need a self-hosted tileset', 'warning');
      return;
    }
    var st = begin(assetId, 'plan', null);
    st.rangeMin = st.box.min.z;
    st.rangeMax = st.box.max.z;
    st.distance = Math.min(st.box.min.z + 1.5, (st.box.min.z + st.box.max.z) / 2);
    loadAxes(assetId).then(function(d) { st.data = d; });
    start(st);
    this.updateStatus('Plan section active', 'success');
    // Storeys: then go to the lowest one and offer Storey −/+.
    loadLevels(assetId).then(function(levels) {
      if (BimViewer.alignmentSection.state !== st) return;
      st.levels = levels;
      if (levels.length) BimViewer.setAlignmentDistance(levels[0].z + PLAN_CUT_ABOVE_FLOOR_M);
      BimViewer.injectAlignmentControls(assetId);
    });
  };

  // keepButton: a new section of the same asset follows right away.
  BimViewer.deactivateAlignmentSection = function(keepButton) {
    var st = this.alignmentSection.state;
    if (!st) return;
    if (st.tileset && !st.tileset.isDestroyed() && st.tileset.clippingPlanes === st.collection) {
      st.tileset.clippingPlanes = undefined;
    }
    st.entities.forEach(function(e) { BimViewer.viewer.entities.remove(e); });
    removeMarkers(st);

    var controls = document.getElementById('axisControls_' + st.assetId);
    if (controls) controls.remove();
    var btn = document.getElementById('axisBtn_' + st.assetId);
    if (btn && keepButton !== true) btn.classList.remove('axis-active');

    this.alignmentSection.state = null;
    this.alignmentSection.activeAssetId = null;
    this.viewer.scene.requestRender();
    notifyChange();
  };

  // The active section in the tileset's local frame (Z-up metres), or null.
  // point/direction: the cut (direction = viewing direction into the kept part).
  BimViewer.getAlignmentSection = function() {
    var st = this.alignmentSection.state;
    if (!st) return null;
    var cut = localCut(st);
    var ad = this.loadedAssets.get(st.assetId);
    var out = {
      assetId: st.assetId,
      assetName: ad ? (ad.name || (ad.modelDef && ad.modelDef.name) || '') : '',
      tileset: st.tileset,
      tilesetUrl: ad && ad.modelDef ? ad.modelDef.file : null,
      mode: st.mode,
      flipped: st.flipped,
      distance: st.distance,
      point: cut.point,
      direction: cut.direction,
      fitKey: [st.assetId, st.mode, st.axisIndex, st.line ? st.line.number : 0, st.flipped].join('|')
    };
    if (st.mode === 'axis') {
      var axis = currentAxis(st);
      out.axisIndex = st.axisIndex;
      out.axisName = axis.name || axis.globalId || ('Alignment ' + (st.axisIndex + 1));
      out.station = axis.startStation + st.distance;
      out.stationText = formatStation(out.station);
      out.tangent = cut.tangent;
      out.title = 'SECTION ' + out.stationText;
      out.subtitle = out.axisName;
      out.viewText = st.flipped ? 'View against station direction' : 'View in station direction';
    } else if (st.mode === 'line') {
      var letter = String.fromCharCode(65 + (st.line.number - 1) % 26);
      // geobim tilesets: local X east, Y north.
      var bearing = (Cesium.Math.toDegrees(Math.atan2(cut.direction.x, cut.direction.y)) + 360) % 360;
      out.title = 'SECTION ' + letter + '–' + letter;
      out.subtitle = 'Offset ' + formatSigned(st.distance) + ' m';
      out.viewText = 'View direction ' + ('00' + Math.round(bearing) % 360).slice(-3) + '°';
    } else {
      var storey = storeyName(st);
      out.title = 'PLAN ' + formatSigned(st.distance);
      out.subtitle = storey ? 'Storey ' + storey : 'Height above the model origin';
      out.viewText = st.flipped ? 'View from below' : 'View from above';
      out.storey = storey;
    }
    return out;
  };

  function storeyName(st) {
    var name = '';
    (st.levels || []).forEach(function(l) { if (l.z <= st.distance + 1e-3) name = l.name; });
    return name;
  }

  // =====================================
  // SECTION LINE (two clicks, like measuring)
  // =====================================

  BimViewer.startSectionLine = function(assetId) {
    assetId = assetId.toString();
    var ad = this.loadedAssets.get(assetId);
    if (!ad || !ad.tileset) return;
    if (!tilesetFile(assetId)) {
      this.updateStatus('Sections need a self-hosted tileset', 'warning');
      return;
    }
    this.cancelSectionLine();
    var active = this.alignmentSection.state;
    if (active && active.assetId !== assetId) this.deactivateAlignmentSection();
    var scene = this.viewer.scene;
    var draw = {
      assetId: assetId,
      tileset: ad.tileset,
      points: [],
      cursor: null,
      handler: new Cesium.ScreenSpaceEventHandler(scene.canvas),
      entities: []
    };
    this.alignmentSection.draw = draw;

    function pickLocal(position) {
      var world = scene.pickPosition(position);
      if (!world) {
        var ray = BimViewer.viewer.camera.getPickRay(position);
        world = ray && scene.globe.pick(ray, scene);
      }
      return world ? toLocal(draw.tileset, world) : null;
    }

    draw.handler.setInputAction(function(click) {
      var p = pickLocal(click.position);
      if (!p) return;
      draw.points.push(p);
      if (draw.points.length === 2) {
        BimViewer.finishSectionLine(draw.points[0], draw.points[1]);
      } else {
        BimViewer.updateStatus('Section line: click point B · Esc cancels', 'loading');
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    draw.handler.setInputAction(function(move) {
      if (draw.points.length) draw.cursor = pickLocal(move.endPosition) || draw.cursor;
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    draw.handler.setInputAction(function() { BimViewer.cancelSectionLine(); }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    // The first point and a rubber band to the cursor.
    draw.entities.push(this.viewer.entities.add({
      position: new Cesium.CallbackProperty(function() {
        return draw.points.length ? toWorld(draw.tileset, draw.points[0]) : undefined;
      }, false),
      point: { pixelSize: 10, color: TEAL, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY }
    }));
    draw.entities.push(overlayLine(function() {
      return draw.points.length && draw.cursor
        ? [toWorld(draw.tileset, draw.points[0]), toWorld(draw.tileset, draw.cursor)] : [];
    }, 3));

    var btn = document.getElementById('axisBtn_' + assetId);
    if (btn) btn.classList.add('axis-active');
    this.injectAlignmentControls(assetId);
    this.updateStatus('Section line: click point A · Esc cancels', 'loading');
  };

  BimViewer.cancelSectionLine = function() {
    var draw = this.alignmentSection.draw;
    if (!draw) return;
    this.alignmentSection.draw = null;
    if (!draw.handler.isDestroyed()) draw.handler.destroy();
    draw.entities.forEach(function(e) { BimViewer.viewer.entities.remove(e); });
    if (this.alignmentSection.activeAssetId === draw.assetId) {
      this.injectAlignmentControls(draw.assetId);
    } else {
      var controls = document.getElementById('axisControls_' + draw.assetId);
      if (controls) controls.remove();
      var btn = document.getElementById('axisBtn_' + draw.assetId);
      if (btn) btn.classList.remove('axis-active');
    }
    notifyChange();
  };

  // Normal = Z × (A→B): looking along it, A→B runs to the right (section
  // A–A, A on the left). The slider spans the model across the line.
  BimViewer.finishSectionLine = function(a, b) {
    var draw = this.alignmentSection.draw;
    var assetId = draw && draw.assetId;
    var along = new Cesium.Cartesian3(b.x - a.x, b.y - a.y, 0);
    if (!assetId || Cesium.Cartesian3.magnitude(along) < 0.05) {
      this.updateStatus('Section line too short, click two points apart', 'warning');
      if (draw) draw.points = [];
      return;
    }
    Cesium.Cartesian3.normalize(along, along);
    var st = begin(assetId, 'line', null);
    loadAxes(assetId).then(function(d) { st.data = d; });
    st.line = { a: a, b: b, normal: new Cesium.Cartesian3(-along.y, along.x, 0), number: ++lineCount };
    st.box.corners.forEach(function(c) {
      var d = (c.x - a.x) * st.line.normal.x + (c.y - a.y) * st.line.normal.y;
      st.rangeMin = Math.min(st.rangeMin, d);
      st.rangeMax = Math.max(st.rangeMax, d);
    });
    if (st.rangeMax - st.rangeMin < 1) { st.rangeMin = -50; st.rangeMax = 50; }
    start(st);
    var letter = String.fromCharCode(65 + (st.line.number - 1) % 26);
    this.updateStatus('Section ' + letter + '–' + letter + ' active', 'success');
  };

  // Clicks on the model while drawing set points, they don't select elements.
  if (typeof BimViewer.handleIFCSelection === 'function') {
    var origHandleIFCSelection = BimViewer.handleIFCSelection;
    BimViewer.handleIFCSelection = function() {
      if (BimViewer.alignmentSection.draw) return;
      return origHandleIFCSelection.apply(this, arguments);
    };
  }

  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' ||
        e.target.tagName === 'BUTTON' || e.target.isContentEditable) return;
    if (e.key === 'Escape' && BimViewer.alignmentSection.draw) {
      BimViewer.cancelSectionLine();
      BimViewer.updateStatus('Section line cancelled', 'info');
    }
  });

  // =====================================
  // CONTROLS
  // =====================================

  BimViewer.setAlignmentDistance = function(distance) {
    var st = this.alignmentSection.state;
    if (!st) return;
    var max = st.mode === 'axis' ? currentAxis(st).length : st.rangeMax;
    var min = st.mode === 'axis' ? 0 : st.rangeMin;
    st.distance = Math.min(Math.max(distance, min), max);
    syncPlane();
    this.viewer.scene.requestRender();

    var slider = document.getElementById('axisSlider_' + st.assetId);
    if (slider && parseFloat(slider.value) !== st.distance) slider.value = st.distance;
    var input = document.getElementById('axisStation_' + st.assetId);
    if (input && document.activeElement !== input) input.value = valueText(st);
    var storey = document.getElementById('axisStorey_' + st.assetId);
    if (storey) storey.textContent = storeyName(st) || '—';
  };

  function valueText(st) {
    return st.mode === 'axis' ? formatStation(currentAxis(st).startStation + st.distance) : formatSigned(st.distance).replace('−', '-');
  }

  BimViewer.stepAlignmentSection = function(delta) {
    var st = this.alignmentSection.state;
    if (st) this.setAlignmentDistance(st.distance + delta);
  };

  // Axis: "0+192.4", "192.4" or "1+005,50" (decimal comma), as a chainage.
  // Line / plan: an offset or height in metres ("+1.25", "3,5 m").
  BimViewer.enterAlignmentStation = function(text) {
    var st = this.alignmentSection.state;
    if (!st) return;
    var s = String(text).trim().replace(',', '.').replace(/\s*m$/, '').replace('−', '-');
    if (st.mode !== 'axis') {
      var v = parseFloat(s);
      this.setAlignmentDistance(isFinite(v) ? v : st.distance);
      return;
    }
    var m = s.match(/^(-?)(\d+)\+(\d+(?:\.\d*)?)$/);
    var station = m ? (m[1] ? -1 : 1) * (parseInt(m[2], 10) * 1000 + parseFloat(m[3])) : parseFloat(s);
    if (!isFinite(station)) {
      this.setAlignmentDistance(st.distance);
      return;
    }
    this.setAlignmentDistance(station - currentAxis(st).startStation);
  };

  BimViewer.flipAlignmentSection = function() {
    var st = this.alignmentSection.state;
    if (!st) return;
    st.flipped = !st.flipped;
    syncPlane();
    this.viewer.scene.requestRender();
    var btn = document.getElementById('axisFlip_' + st.assetId);
    if (btn) btn.classList.toggle('flipped', st.flipped);
  };

  BimViewer.selectAlignmentAxis = function(index) {
    var st = this.alignmentSection.state;
    if (!st || st.mode !== 'axis') return;
    st.axisIndex = Math.min(Math.max(parseInt(index, 10) || 0, 0), st.data.alignments.length - 1);
    var axis = currentAxis(st);
    var slider = document.getElementById('axisSlider_' + st.assetId);
    if (slider) slider.max = axis.length;
    addMarkers(st);
    this.setAlignmentDistance(Math.min(st.distance, axis.length));
  };

  // Plans are cut 1.00 m above the floor.
  BimViewer.stepSectionStorey = function(direction) {
    var st = this.alignmentSection.state;
    if (!st || st.mode !== 'plan' || !st.levels) return;
    var target = null;
    st.levels.forEach(function(l) {
      var z = l.z + PLAN_CUT_ABOVE_FLOOR_M;
      if (direction > 0 && z > st.distance + 0.01 && target === null) target = z;
      if (direction < 0 && z < st.distance - 0.01) target = z;
    });
    if (target !== null) this.setAlignmentDistance(target);
  };

  // Look at the cut from the side that is cut away: along the axis or across
  // the section line at horizon level, straight down (or up) onto a plan.
  BimViewer.alignCameraToSection = function() {
    var st = this.alignmentSection.state;
    if (!st) return;
    var cut = localCut(st);
    var dir = dirToWorld(st.tileset, cut.direction);
    var target, back, rise;
    if (st.mode === 'plan') {
      var size = Math.max(st.box.max.x - st.box.min.x, st.box.max.y - st.box.min.y, 10);
      target = toWorld(st.tileset, cut.point);
      var dest = Cesium.Cartesian3.add(target, Cesium.Cartesian3.multiplyByScalar(dir, -size * 1.4, new Cesium.Cartesian3()), new Cesium.Cartesian3());
      this.viewer.camera.flyTo({
        destination: dest,
        orientation: { direction: dir, up: dirToWorld(st.tileset, new Cesium.Cartesian3(0, st.flipped ? -1 : 1, 0)) },
        duration: 1.0
      });
      return;
    }
    if (st.mode === 'line') {
      var f = lineFrame(st);
      var mid = new Cesium.Cartesian3((f.a0.x + f.b0.x) / 2, (f.a0.y + f.b0.y) / 2, (st.box.min.z + st.box.max.z) / 2);
      target = toWorld(st.tileset, mid);
      back = Math.max(f.length, st.box.max.z - st.box.min.z, 20) * 1.1;
      rise = 0;
    } else {
      target = toWorld(st.tileset, cut.point);
      back = CAMERA_BACKOFF_M;
      rise = CAMERA_RISE_M;
    }
    var up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(target, new Cesium.Cartesian3());
    // level the view direction
    var vertical = Cesium.Cartesian3.multiplyByScalar(up, Cesium.Cartesian3.dot(dir, up), new Cesium.Cartesian3());
    Cesium.Cartesian3.subtract(dir, vertical, dir);
    if (Cesium.Cartesian3.magnitude(dir) < 1e-6) return;
    Cesium.Cartesian3.normalize(dir, dir);
    var off = Cesium.Cartesian3.multiplyByScalar(dir, -back, new Cesium.Cartesian3());
    Cesium.Cartesian3.add(off, Cesium.Cartesian3.multiplyByScalar(up, rise, new Cesium.Cartesian3()), off);
    this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.add(target, off, off),
      orientation: { direction: dir, up: up },
      duration: 1.0
    });
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function modeTabs(assetId, current, hasAxes) {
    var html = '<div class="axis-mode-tabs" role="group" aria-label="Section mode">';
    ['axis', 'line', 'plan'].forEach(function(m) {
      if (m === 'axis' && !hasAxes) return;
      html += '<button class="axis-mode-btn' + (m === current ? ' active' : '') + '" ' +
        'aria-pressed="' + (m === current) + '" ' +
        'onclick="BimViewer.setSectionMode(\'' + assetId + '\', \'' + m + '\')" ' +
        'title="' + { axis: 'Section across the alignment axis', line: 'Section A–A: click two points in the view', plan: 'Horizontal cut (plan)' }[m] + '">' +
        MODE_LABELS[m] + '</button>';
    });
    return html + '</div>';
  }

  // Built once alignments.json is known (mode tabs); only the latest call
  // builds, from the state at that time.
  var controlsToken = 0;
  BimViewer.injectAlignmentControls = function(assetId) {
    var token = ++controlsToken;
    var id = assetId;
    loadAxes(assetId).then(function(axes) {
      if (token !== controlsToken) return;
      var as = BimViewer.alignmentSection;
      var st = as.state && as.state.assetId === id ? as.state : null;
      var draw = as.draw && as.draw.assetId === id ? as.draw : null;
      var existing = document.getElementById('axisControls_' + id);
      if (existing) existing.remove();
      var assetDiv = document.getElementById('asset_' + id);
      if (!assetDiv || (!st && !draw)) return;
      var mode = draw ? 'line' : st.mode;
      var html =
        '<div class="axis-section-controls" id="axisControls_' + id + '">' +
          '<div class="axis-section-header">' +
            '<label class="modern-label-small">Section</label>' +
            '<button class="axis-icon-btn" onclick="BimViewer.cancelSectionLine(); BimViewer.deactivateAlignmentSection()" title="Remove section">' +
              '<i data-lucide="x"></i></button>' +
          '</div>' +
          modeTabs(id, mode, !!axes);

      if (draw) {
        html += '<p class="axis-hint">Click point A, then point B in the view. Looking across the line, A is on the left. Esc or right click cancels.</p>';
      } else {
        html += sectionRows(st, id);
      }
      html += '</div>';
      assetDiv.insertAdjacentHTML('beforeend', html);
      if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide', node: document.getElementById('axisControls_' + id) });
    });
  };

  function sectionRows(st, id) {
    var html = '';
    var min = st.mode === 'axis' ? 0 : st.rangeMin;
    var max = st.mode === 'axis' ? currentAxis(st).length : st.rangeMax;
    var label = { axis: 'Station', line: 'Offset', plan: 'Height' }[st.mode];
    if (st.mode === 'axis' && st.data.alignments.length > 1) {
      html += '<select class="axis-select" id="axisSelect_' + id + '" title="Alignment" ' +
        'onchange="BimViewer.selectAlignmentAxis(this.value)">';
      st.data.alignments.forEach(function(a, i) {
        html += '<option value="' + i + '"' + (i === st.axisIndex ? ' selected' : '') + '>' +
          escapeHtml(a.name || a.globalId || ('Alignment ' + (i + 1))) + '</option>';
      });
      html += '</select>';
    }
    html +=
      '<div class="axis-row">' +
        '<input type="range" class="axis-slider" id="axisSlider_' + id + '" min="' + min + '" max="' + max + '" ' +
          'step="0.01" value="' + st.distance + '" title="' + label + '" ' +
          'oninput="BimViewer.setAlignmentDistance(parseFloat(this.value))">' +
      '</div>' +
      '<div class="axis-row">' +
        '<label class="axis-station-label" for="axisStation_' + id + '">' + label + '</label>' +
        '<input type="text" class="axis-station-input" id="axisStation_' + id + '" inputmode="decimal" ' +
          'value="' + valueText(st) + '" title="' + (st.mode === 'axis' ? 'Station (km+m)' : label + ' in m') + ', Enter to apply" ' +
          'onkeydown="if(event.key===\'Enter\'){this.blur();}" ' +
          'onchange="BimViewer.enterAlignmentStation(this.value)">' +
      '</div>';
    if (st.mode === 'plan' && st.levels && st.levels.length) {
      html +=
        '<div class="axis-row">' +
          '<label class="axis-station-label">Storey</label>' +
          '<span class="axis-storey-name" id="axisStorey_' + id + '">' + escapeHtml(storeyName(st) || '—') + '</span>' +
          '<button class="axis-step-btn" onclick="BimViewer.stepSectionStorey(-1)" title="Storey below (floor + 1.00 m)">' +
            '<i data-lucide="chevron-down"></i></button>' +
          '<button class="axis-step-btn" onclick="BimViewer.stepSectionStorey(1)" title="Storey above (floor + 1.00 m)">' +
            '<i data-lucide="chevron-up"></i></button>' +
        '</div>';
    } else if (st.mode === 'plan' && !st.levels) {
      html += '<p class="axis-hint">Reading the storeys…</p>';
    }
    html += '<div class="axis-row axis-buttons">';
    STEP_BUTTONS[st.mode].forEach(function(d) {
      html += '<button class="axis-step-btn" onclick="BimViewer.stepAlignmentSection(' + d + ')" ' +
        'title="Move ' + (d > 0 ? '+' : '') + d + ' m">' + (d > 0 ? '+' : '') + d + '</button>';
    });
    var flipTitle = { axis: 'Flip cut direction', line: 'Flip viewing direction', plan: 'View from below' }[st.mode];
    var cameraTitle = { axis: 'Look along the axis at the cut', line: 'Look at the section', plan: 'Look onto the plan' }[st.mode];
    html +=
        '<button class="axis-icon-btn' + (st.flipped ? ' flipped' : '') + '" id="axisFlip_' + id + '" onclick="BimViewer.flipAlignmentSection()" ' +
          'title="' + flipTitle + '"><i data-lucide="arrow-left-right"></i></button>' +
        '<button class="axis-icon-btn" onclick="BimViewer.alignCameraToSection()" ' +
          'title="' + cameraTitle + '"><i data-lucide="scan-eye"></i></button>' +
        (typeof BimViewer.toggleSectionProfile === 'function'
          ? '<button class="axis-icon-btn' + (BimViewer.sectionProfile && BimViewer.sectionProfile.open ? ' flipped' : '') + '" ' +
            'id="axisProfile_' + id + '" onclick="BimViewer.toggleSectionProfile()" ' +
            'title="2D drawing of the section"><i data-lucide="scan-line"></i></button>'
          : '') +
        (st.mode === 'line'
          ? '<button class="axis-icon-btn" onclick="BimViewer.startSectionLine(\'' + id + '\')" ' +
            'title="Draw a new section line"><i data-lucide="pencil-line"></i></button>'
          : '') +
      '</div>';
    return html;
  }

  // =====================================
  // ASSET CARD BUTTON
  // =====================================

  // Every self-hosted tileset can be cut (line, plan); models with
  // alignments.json get the axis section as their default.
  BimViewer.injectAlignmentButton = function(assetId) {
    assetId = assetId.toString();
    if (!tilesetFile(assetId)) return;
    loadAxes(assetId).then(function(data) {
      var assetDiv = document.getElementById('asset_' + assetId);
      var controlsDiv = assetDiv && assetDiv.querySelector('.modern-asset-controls');
      if (!controlsDiv || document.getElementById('axisBtn_' + assetId)) return;
      var btn = document.createElement('button');
      btn.id = 'axisBtn_' + assetId;
      btn.className = 'modern-icon-btn axis-card-btn';
      btn.title = data ? 'Section (alignment axis, line, plan)' : 'Section (line, plan)';
      btn.innerHTML = '<i data-lucide="' + (data ? 'route' : 'scissors') + '"></i>';
      btn.onclick = function(e) { e.stopPropagation(); BimViewer.toggleAlignmentSection(assetId); };
      controlsDiv.insertBefore(btn, controlsDiv.lastElementChild);
      if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide', node: btn });
    });
  };

  // =====================================
  // HOOKS
  // =====================================

  if (window.BimViewerUI && typeof BimViewerUI.createAssetControls === 'function') {
    var origCreateAssetControls = BimViewerUI.createAssetControls.bind(BimViewerUI);
    BimViewerUI.createAssetControls = function(assetId) {
      origCreateAssetControls(assetId);
      BimViewer.injectAlignmentButton(assetId);
    };
  }

  // X/Y/Z planes and the section share the tileset's single collection.
  if (typeof BimViewer.activateAssetClipping === 'function') {
    var origActivateClipping = BimViewer.activateAssetClipping;
    BimViewer.activateAssetClipping = function(assetId) {
      if (BimViewer.alignmentSection.activeAssetId === String(assetId)) {
        BimViewer.deactivateAlignmentSection();
      }
      return origActivateClipping.apply(this, arguments);
    };
  }

  var origUnloadAsset = BimViewer.unloadAsset;
  BimViewer.unloadAsset = function(assetId) {
    var id = assetId.toString();
    var as = BimViewer.alignmentSection;
    if (as.draw && as.draw.assetId === id) BimViewer.cancelSectionLine();
    if (as.activeAssetId === id) BimViewer.deactivateAlignmentSection();
    as.axesByAsset.delete(id);
    as.levelsByAsset.delete(id);
    return origUnloadAsset.apply(this, arguments);
  };

  console.log('Alignment section module loaded v2.0');

})();
