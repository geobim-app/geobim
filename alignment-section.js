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
// ALIGNMENT SECTION MODULE v1.0
// Section plane perpendicular to an IfcAlignment axis, moved by station.
// The axes come from alignments.json, written by the geobim tiler next to
// tileset.json (points, tangents and distances in the tileset's local frame,
// Z-up metres, plus IfcReferent markers). Only self-hosted tilesets have it.
// The cut applies to the asset the axis belongs to, nothing else.
// ===============================
'use strict';

(function() {

  // =====================================
  // STATE
  // =====================================

  BimViewer.alignmentSection = {
    activeAssetId: null,
    axesByAsset: new Map(),   // assetId → Promise<alignments.json | null>
    state: null               // { assetId, axisIndex, distance, flipped, collection, entities }
  };

  var STEP_BUTTONS = [-10, -1, 1, 10];
  var CAMERA_BACKOFF_M = 60;
  var CAMERA_RISE_M = 8;

  // =====================================
  // DATA
  // =====================================

  // alignments.json lives next to tileset.json. A missing file is the normal
  // case (models without IfcAlignment, uploads from before tiler 1.3), so a 404
  // resolves to null quietly.
  function loadAxes(assetId) {
    var cache = BimViewer.alignmentSection.axesByAsset;
    if (cache.has(assetId)) return cache.get(assetId);
    var ad = BimViewer.loadedAssets.get(assetId);
    var file = ad && ad.modelDef && ad.modelDef.type === 'TILESET' ? ad.modelDef.file : null;
    var p = !file ? Promise.resolve(null) :
      fetch(file.replace(/tileset\.json$/, 'alignments.json'), { cache: 'no-cache' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(d) {
          return (d && d.frame === 'tileset-local' && Array.isArray(d.alignments) && d.alignments.length) ? d : null;
        })
        .catch(function() { return null; });
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

  // Tileset-local → world (ECEF). root.computedTransform already includes the
  // tileset's modelMatrix, so gizmo moves and saved placements carry the axis.
  function toWorld(tileset, local) {
    return Cesium.Matrix4.multiplyByPoint(tileset.root.computedTransform, local, new Cesium.Cartesian3());
  }

  function dirToWorld(tileset, local) {
    var v = Cesium.Matrix4.multiplyByPointAsVector(tileset.root.computedTransform, local, new Cesium.Cartesian3());
    return Cesium.Cartesian3.normalize(v, v);
  }

  // =====================================
  // PLANE
  // =====================================

  // A tileset's clipping planes are measured in clippingPlanesOriginMatrix
  // (Cesium3DTileset.js: root.computedTransform × an ENU frame at the original
  // bounding-sphere centre), not in the root frame. Going through world space
  // keeps this independent of which of those Cesium picked.
  function planeFor(tileset, sample, flipped) {
    var inv = Cesium.Matrix4.inverse(tileset.clippingPlanesOriginMatrix, new Cesium.Matrix4());
    var pw = toWorld(tileset, sample.point);
    var nw = dirToWorld(tileset, sample.tangent);
    if (flipped) Cesium.Cartesian3.negate(nw, nw);
    var pc = Cesium.Matrix4.multiplyByPoint(inv, pw, new Cesium.Cartesian3());
    var nc = Cesium.Matrix4.multiplyByPointAsVector(inv, nw, new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(nc, nc);
    return { normal: nc, distance: -Cesium.Cartesian3.dot(nc, pc) };
  }

  function currentAxis(st) {
    return st.data.alignments[st.axisIndex];
  }

  function syncPlane() {
    var st = BimViewer.alignmentSection.state;
    if (!st) return;
    var p = planeFor(st.tileset, sampleAxis(currentAxis(st), st.distance), st.flipped);
    var plane = st.collection.get(0);
    Cesium.Cartesian3.clone(p.normal, plane.normal);
    plane.distance = p.distance;
  }

  // =====================================
  // AXIS OVERLAY
  // =====================================

  // Positions follow the tileset: recomputed only when root.computedTransform
  // changes (gizmo, heading slider, z-offset), not every frame.
  function axisPositionsProperty(st) {
    var lastMatrix = null, lastIndex = -1, cached = [];
    return new Cesium.CallbackProperty(function() {
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
    }, false);
  }

  function addOverlay(st) {
    var entities = BimViewer.viewer.entities;
    var teal = Cesium.Color.fromCssColorString('#2ECFB0');
    st.entities.push(entities.add({
      polyline: {
        positions: axisPositionsProperty(st),
        width: 3,
        material: teal,
        depthFailMaterial: teal.withAlpha(0.35),
        clampToGround: false
      }
    }));
    st.entities.push(entities.add({
      position: new Cesium.CallbackProperty(function() {
        return toWorld(st.tileset, sampleAxis(currentAxis(st), st.distance).point);
      }, false),
      point: {
        pixelSize: 10,
        color: teal,
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

  BimViewer.toggleAlignmentSection = function(assetId) {
    assetId = assetId.toString();
    if (this.alignmentSection.activeAssetId === assetId) {
      this.deactivateAlignmentSection();
    } else {
      this.activateAlignmentSection(assetId);
    }
  };

  BimViewer.activateAlignmentSection = async function(assetId) {
    assetId = assetId.toString();
    var ad = this.loadedAssets.get(assetId);
    if (!ad || !ad.tileset) return;
    var data = await loadAxes(assetId);
    if (!data) {
      this.updateStatus('No alignment axis in this model', 'warning');
      return;
    }

    this.deactivateAlignmentSection();
    // One ClippingPlaneCollection per tileset: the X/Y/Z planes step aside.
    if (this.clipPlanes && this.clipPlanes.activeAssetId === assetId) {
      this.deactivateAssetClipping(assetId);
    }

    var st = {
      assetId: assetId,
      tileset: ad.tileset,
      data: data,
      axisIndex: 0,
      distance: data.alignments[0].length / 2,
      flipped: false,
      collection: null,
      entities: [],
      markerEntities: []
    };
    var p = planeFor(st.tileset, sampleAxis(currentAxis(st), st.distance), false);
    st.collection = new Cesium.ClippingPlaneCollection({
      planes: [new Cesium.ClippingPlane(p.normal, p.distance)],
      edgeColor: Cesium.Color.WHITE,
      edgeWidth: 1.0,
      enabled: true
    });
    st.tileset.clippingPlanes = st.collection;

    this.alignmentSection.state = st;
    this.alignmentSection.activeAssetId = assetId;
    addOverlay(st);
    this.injectAlignmentControls(assetId);

    var btn = document.getElementById('axisBtn_' + assetId);
    if (btn) btn.classList.add('axis-active');
    this.updateStatus('Alignment section active', 'success');
  };

  BimViewer.deactivateAlignmentSection = function() {
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
    if (btn) btn.classList.remove('axis-active');

    this.alignmentSection.state = null;
    this.alignmentSection.activeAssetId = null;
  };

  // =====================================
  // CONTROLS
  // =====================================

  BimViewer.setAlignmentDistance = function(distance) {
    var st = this.alignmentSection.state;
    if (!st) return;
    var axis = currentAxis(st);
    st.distance = Math.min(Math.max(distance, 0), axis.length);
    syncPlane();
    this.viewer.scene.requestRender();

    var slider = document.getElementById('axisSlider_' + st.assetId);
    if (slider && parseFloat(slider.value) !== st.distance) slider.value = st.distance;
    var input = document.getElementById('axisStation_' + st.assetId);
    if (input && document.activeElement !== input) input.value = formatStation(axis.startStation + st.distance);
  };

  BimViewer.stepAlignmentSection = function(delta) {
    var st = this.alignmentSection.state;
    if (st) this.setAlignmentDistance(st.distance + delta);
  };

  // Accepts "0+192.4", "192.4" or "1+005,50" (decimal comma), as a chainage.
  BimViewer.enterAlignmentStation = function(text) {
    var st = this.alignmentSection.state;
    if (!st) return;
    var s = String(text).trim().replace(',', '.');
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
    var btn = document.getElementById('axisFlip_' + st.assetId);
    if (btn) btn.classList.toggle('flipped', st.flipped);
  };

  BimViewer.selectAlignmentAxis = function(index) {
    var st = this.alignmentSection.state;
    if (!st) return;
    st.axisIndex = Math.min(Math.max(parseInt(index, 10) || 0, 0), st.data.alignments.length - 1);
    var axis = currentAxis(st);
    var slider = document.getElementById('axisSlider_' + st.assetId);
    if (slider) slider.max = axis.length;
    addMarkers(st);
    this.setAlignmentDistance(Math.min(st.distance, axis.length));
  };

  // Look along the axis at the cut: from behind the plane on the kept side,
  // a little above the axis, horizon level.
  BimViewer.alignCameraToSection = function() {
    var st = this.alignmentSection.state;
    if (!st) return;
    var s = sampleAxis(currentAxis(st), st.distance);
    var p = toWorld(st.tileset, s.point);
    var dir = dirToWorld(st.tileset, s.tangent);
    if (st.flipped) Cesium.Cartesian3.negate(dir, dir);
    var up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(p, new Cesium.Cartesian3());
    // level the view direction
    var vertical = Cesium.Cartesian3.multiplyByScalar(up, Cesium.Cartesian3.dot(dir, up), new Cesium.Cartesian3());
    Cesium.Cartesian3.subtract(dir, vertical, dir);
    if (Cesium.Cartesian3.magnitude(dir) < 1e-6) return;
    Cesium.Cartesian3.normalize(dir, dir);
    var back = Cesium.Cartesian3.multiplyByScalar(dir, -CAMERA_BACKOFF_M, new Cesium.Cartesian3());
    var rise = Cesium.Cartesian3.multiplyByScalar(up, CAMERA_RISE_M, new Cesium.Cartesian3());
    var dest = Cesium.Cartesian3.add(Cesium.Cartesian3.add(p, back, back), rise, back);
    this.viewer.camera.flyTo({
      destination: dest,
      orientation: { direction: dir, up: up },
      duration: 1.0
    });
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  BimViewer.injectAlignmentControls = function(assetId) {
    var st = this.alignmentSection.state;
    if (!st || st.assetId !== assetId) return;
    var existing = document.getElementById('axisControls_' + assetId);
    if (existing) existing.remove();
    var assetDiv = document.getElementById('asset_' + assetId);
    if (!assetDiv) return;

    var axis = currentAxis(st);
    var id = assetId;
    var html =
      '<div class="axis-section-controls" id="axisControls_' + id + '">' +
        '<div class="axis-section-header">' +
          '<label class="modern-label-small">Alignment Section</label>' +
          '<button class="axis-icon-btn" onclick="BimViewer.deactivateAlignmentSection()" title="Remove alignment section">' +
            '<i data-lucide="x"></i></button>' +
        '</div>';

    if (st.data.alignments.length > 1) {
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
          '<input type="range" class="axis-slider" id="axisSlider_' + id + '" min="0" max="' + axis.length + '" ' +
            'step="0.1" value="' + st.distance + '" title="Station" ' +
            'oninput="BimViewer.setAlignmentDistance(parseFloat(this.value))">' +
        '</div>' +
        '<div class="axis-row">' +
          '<label class="axis-station-label" for="axisStation_' + id + '">Station</label>' +
          '<input type="text" class="axis-station-input" id="axisStation_' + id + '" inputmode="decimal" ' +
            'value="' + formatStation(axis.startStation + st.distance) + '" title="Station (km+m), Enter to apply" ' +
            'onkeydown="if(event.key===\'Enter\'){this.blur();}" ' +
            'onchange="BimViewer.enterAlignmentStation(this.value)">' +
        '</div>' +
        '<div class="axis-row axis-buttons">';
    STEP_BUTTONS.forEach(function(d) {
      html += '<button class="axis-step-btn" onclick="BimViewer.stepAlignmentSection(' + d + ')" ' +
        'title="Move ' + (d > 0 ? '+' : '') + d + ' m">' + (d > 0 ? '+' : '') + d + '</button>';
    });
    html +=
          '<button class="axis-icon-btn" id="axisFlip_' + id + '" onclick="BimViewer.flipAlignmentSection()" ' +
            'title="Flip cut direction"><i data-lucide="arrow-left-right"></i></button>' +
          '<button class="axis-icon-btn" onclick="BimViewer.alignCameraToSection()" ' +
            'title="Look along the axis at the cut"><i data-lucide="scan-eye"></i></button>' +
        '</div>' +
      '</div>';

    assetDiv.insertAdjacentHTML('beforeend', html);
    if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide', node: document.getElementById('axisControls_' + id) });
  };

  // =====================================
  // ASSET CARD BUTTON
  // =====================================

  // Only once alignments.json is known to exist — most models have no axis.
  BimViewer.injectAlignmentButton = function(assetId) {
    assetId = assetId.toString();
    loadAxes(assetId).then(function(data) {
      if (!data) return;
      var assetDiv = document.getElementById('asset_' + assetId);
      var controlsDiv = assetDiv && assetDiv.querySelector('.modern-asset-controls');
      if (!controlsDiv || document.getElementById('axisBtn_' + assetId)) return;
      var btn = document.createElement('button');
      btn.id = 'axisBtn_' + assetId;
      btn.className = 'modern-icon-btn axis-card-btn';
      btn.title = 'Section along alignment axis';
      btn.innerHTML = '<i data-lucide="route"></i>';
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

  // X/Y/Z planes and the axis section share the tileset's single collection.
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
    if (BimViewer.alignmentSection.activeAssetId === id) {
      BimViewer.deactivateAlignmentSection();
    }
    BimViewer.alignmentSection.axesByAsset.delete(id);
    return origUnloadAsset.apply(this, arguments);
  };

  console.log('Alignment section module loaded v1.0');

})();
