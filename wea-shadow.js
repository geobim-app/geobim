// ============================================================
// WEA Shadow — Wind turbine shadow study module for geobim.app
//
// Copyright (c) 2026 geobim.app
// Licensed under the Business Source License 1.1 (BSL 1.1)
// Change Date: 2030-03-01 | Change License: MIT
// See LICENSE file for full terms.
//
// Shortcut: W to toggle widget
// Self-contained floating panel with model selector, parametrics,
// and loaded instance management.
//
// Hub Height  → overall model scale
// Rotor Ø     → Blades node scale (CesiumJS internal API)
// Clamp to terrain, origin = tower base
//
// Tested with CesiumJS 1.141
// ============================================================

(function() {
  'use strict';

  var PANEL_ID = 'weaShadowPanel';
  var WEA_NODE_TOWER = 'Main Unit';
  var WEA_NODE_BLADES = 'Blades';
  var DEFAULT_POSITION = { lon: 11.508, lat: 49.262, height: 0 };

  // State
  var weaInstances = {};
  var weaModelDefs = [];
  var panelCreated = false;

  // Day animation
  var dayPlayActive = false;
  var dayPlayRAF = null;
  var dayPlayLastTime = null;

  // Immission points
  var immissionMode = false;
  var immissionHandler = null;
  var immissionPoints = [];
  var immissionCounter = 0;

  // ========================================================
  // GLB ANALYSIS
  // ========================================================

  function parseGLBJson(buffer) {
    var view = new DataView(buffer);
    var jsonLength = view.getUint32(12, true);
    var jsonBytes = new Uint8Array(buffer, 20, jsonLength);
    return JSON.parse(new TextDecoder().decode(jsonBytes));
  }

  function analyzeWEA(gltf) {
    if (!gltf.nodes) return null;
    var mainUnit = null, blades = null, bladesIdx = -1;
    for (var i = 0; i < gltf.nodes.length; i++) {
      var n = gltf.nodes[i];
      if (n.name === WEA_NODE_TOWER)  mainUnit = n;
      if (n.name === WEA_NODE_BLADES) { blades = n; bladesIdx = i; }
    }
    if (!mainUnit || !blades) return null;
    var hubHeight = blades.translation ? blades.translation[1] : 0;
    if (hubHeight <= 0) return null;
    var bladesScale = (blades.scale && blades.scale[0]) || 1;
    var rotorDiameter = 0;
    if (blades.children && blades.children.length > 0) {
      var meshNode = gltf.nodes[blades.children[0]];
      if (meshNode && meshNode.mesh !== undefined && gltf.meshes[meshNode.mesh]) {
        var mesh = gltf.meshes[meshNode.mesh];
        if (mesh.primitives && mesh.primitives[0]) {
          var acc = gltf.accessors[mesh.primitives[0].attributes.POSITION];
          if (acc && acc.min && acc.max) {
            rotorDiameter = Math.max(acc.max[0] - acc.min[0], acc.max[2] - acc.min[2]) * bladesScale;
          }
        }
      }
    }
    if (rotorDiameter <= 0) return null;

    // Derive native RPM from blade rotation animation duration
    var nativeRPM = 16.2; // fallback
    if (gltf.animations) {
      for (var ai = 0; ai < gltf.animations.length; ai++) {
        var anim = gltf.animations[ai];
        for (var ci = 0; ci < anim.channels.length; ci++) {
          if (anim.channels[ci].target.node === bladesIdx && anim.channels[ci].target.path === 'rotation') {
            var sampler = anim.samplers[anim.channels[ci].sampler];
            var inputAcc = gltf.accessors[sampler.input];
            if (inputAcc && inputAcc.max) {
              var durationSec = inputAcc.max[0];
              if (durationSec > 0) nativeRPM = 60.0 / durationSec;
            }
          }
        }
      }
    }

    return {
      hubHeight: hubHeight,
      rotorDiameter: rotorDiameter,
      bladesBaseScale: bladesScale,
      bladesTranslation: blades.translation ? blades.translation.slice() : [0, 0, 0],
      bladesRotation: blades.rotation ? blades.rotation.slice() : [0, 0, 0, 1],
      towerBaseOffsetY: mainUnit.translation ? mainUnit.translation[1] : 0,
      nativeRPM: nativeRPM
    };
  }

  async function fetchAndAnalyze(url) {
    try {
      var resp = await fetch(url, { headers: { 'Range': 'bytes=0-65535' } });
      if (!resp.ok && resp.status !== 206) {
        console.warn('WEA: fetch failed for', url, '— HTTP', resp.status);
        return null;
      }
      return analyzeWEA(parseGLBJson(await resp.arrayBuffer()));
    } catch (e) {
      console.warn('WEA: analyze failed for', url, e);
      return null;
    }
  }

  async function discoverWEAModels() {
    try {
      var resp = await fetch('api/wea-models.php');
      if (!resp.ok) {
        console.warn('WEA: model discovery failed — HTTP', resp.status);
        return [];
      }
      var models = await resp.json();
      var result = [];
      await Promise.all(models.map(function(m) {
        if (!m.file.toLowerCase().endsWith('.glb')) return Promise.resolve();
        return fetchAndAnalyze(m.file).then(function(wea) {
          if (wea) { m._weaData = wea; result.push(m); }
        });
      }));
      return result;
    } catch (e) {
      console.warn('WEA: model discovery error:', e);
      return [];
    }
  }

  // ========================================================
  // RUNTIME NODE ACCESS (CesiumJS 1.139)
  // ========================================================

  function findBladesRuntimeNode(model) {
    try {
      var sg = model._sceneGraph;
      if (!sg) return null;
      var nodes = sg._runtimeNodes;
      if (nodes) {
        for (var i = 0; i < nodes.length; i++) {
          if ((nodes[i]._name || nodes[i].name || '') === WEA_NODE_BLADES) return nodes[i];
        }
      }
    } catch (e) { }
    return null;
  }

  function setBladesNodeScale(inst, newScale) {
    var node = inst.bladesRuntimeNode;
    if (!node) return;
    try {
      var t = new Cesium.Cartesian3(inst.wea.bladesTranslation[0], inst.wea.bladesTranslation[1], inst.wea.bladesTranslation[2]);
      var r = new Cesium.Quaternion(inst.wea.bladesRotation[0], inst.wea.bladesRotation[1], inst.wea.bladesRotation[2], inst.wea.bladesRotation[3]);
      var s = new Cesium.Cartesian3(newScale, newScale, newScale);
      var m = Cesium.Matrix4.fromTranslationQuaternionRotationScale(t, r, s, new Cesium.Matrix4());
      if (node._transform !== undefined) {
        Cesium.Matrix4.clone(m, node._transform);
        if (node._transformDirty !== undefined) node._transformDirty = true;
      } else if (typeof node.transform !== 'undefined') {
        node.transform = m;
      }
    } catch (e) { }
  }

  // ========================================================
  // TERRAIN CLAMPING
  // ========================================================

  function clampToTerrain(inst, flyTo) {
    var ad = inst.assetData;
    var viewer = BimViewer.viewer;
    var carto = Cesium.Cartographic.fromDegrees(ad.position.lon, ad.position.lat);

    function afterClamp() {
      BimViewer.updateGLBPosition(inst.assetId);
      refreshPanel();
      if (flyTo) BimViewer.zoomToAsset(inst.assetId);
    }

    Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [carto]).then(function(results) {
      inst.terrainHeight = results[0].height || 0;
      ad.position.height = inst.terrainHeight + inst.baseHeightCorrection;
      afterClamp();
    }).catch(function() {
      try {
        var h = viewer.scene.sampleHeight(carto);
        if (h !== undefined) {
          inst.terrainHeight = h;
          ad.position.height = h + inst.baseHeightCorrection;
          afterClamp();
        }
      } catch (e) { }
    });
  }

  // ========================================================
  // PARAMETRIC FUNCTIONS
  // ========================================================

  function setHubHeight(assetId, value) {
    var inst = weaInstances[assetId];
    if (!inst) return;
    value = Math.max(20, Math.min(300, value));
    inst.targetHubHeight = value;
    inst.assetData.scale = value / inst.wea.hubHeight;
    inst.baseHeightCorrection = -inst.wea.towerBaseOffsetY * inst.assetData.scale;
    if (inst.terrainHeight !== undefined) {
      inst.assetData.position.height = inst.terrainHeight + inst.baseHeightCorrection;
    }
    BimViewer.updateGLBPosition(assetId);
    setRotorDiameter(assetId, inst.targetRotorDiameter);
    syncSliders(assetId);
  }

  function setRotorDiameter(assetId, value) {
    var inst = weaInstances[assetId];
    if (!inst) return;
    value = Math.max(10, Math.min(300, value));
    inst.targetRotorDiameter = value;
    if (inst.bladesRuntimeNode) {
      var meshExtent = inst.wea.rotorDiameter / inst.wea.bladesBaseScale;
      setBladesNodeScale(inst, value / (meshExtent * (inst.assetData.scale || 1)));
    }
    syncSliders(assetId);
  }

  function rpmToMultiplier(inst, rpm) {
    return rpm / (inst.wea.nativeRPM || 16.2);
  }

  // ---- WEA rotor animation via scene.postUpdate (bypasses model.activeAnimations) ----
  // Multiple turbines loaded from the same GLB URL share Cesium's ResourceCache.
  // Any activeAnimations.addAll/removeAll call on one model instance affects all others.
  // Using postUpdate + direct node._transform is reliable and per-instance.
  // Spin axis: local Z of the blades node (GLTF Y-up convention for horizontal-axis turbines).

  function _startWeaRotation(inst) {
    _stopWeaRotation(inst); // clean up previous listener if any

    var node = inst.bladesRuntimeNode;
    if (!node) return;

    var wea       = inst.wea;
    var startTime = performance.now() / 1000.0;
    var t  = new Cesium.Cartesian3(wea.bladesTranslation[0], wea.bladesTranslation[1], wea.bladesTranslation[2]);
    var q0 = new Cesium.Quaternion(wea.bladesRotation[0],    wea.bladesRotation[1],    wea.bladesRotation[2],    wea.bladesRotation[3]);

    inst._weaAnimListener = function() {
      var node = inst.bladesRuntimeNode;
      if (!node) return;
      var ad        = inst.assetData;
      var elapsed   = performance.now() / 1000.0 - startTime;
      var radPerSec = ad.animSpeed * (wea.nativeRPM || 16.2) * Math.PI / 30.0;
      var angle     = elapsed * radPerSec;

      var qSpin  = Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_Z, angle, new Cesium.Quaternion());
      var qTotal = Cesium.Quaternion.multiply(q0, qSpin, new Cesium.Quaternion());

      var meshExtent = wea.rotorDiameter / wea.bladesBaseScale;
      var sc  = inst.targetRotorDiameter / (meshExtent * (ad.scale || 1));
      var s   = new Cesium.Cartesian3(sc, sc, sc);
      var m   = Cesium.Matrix4.fromTranslationQuaternionRotationScale(t, qTotal, s, new Cesium.Matrix4());
      try {
        if (node._transform !== undefined) {
          Cesium.Matrix4.clone(m, node._transform);
          if (node._transformDirty !== undefined) node._transformDirty = true;
        } else if (typeof node.transform !== 'undefined') {
          node.transform = m;
        }
      } catch (e) {}
    };

    BimViewer.viewer.scene.postUpdate.addEventListener(inst._weaAnimListener);
    console.log('WEA rotor started:', inst.assetId, 'speed:', inst.assetData.animSpeed);
  }

  function _stopWeaRotation(inst) {
    if (inst._weaAnimListener) {
      try { BimViewer.viewer.scene.postUpdate.removeEventListener(inst._weaAnimListener); } catch (e) {}
      inst._weaAnimListener = null;
    }
  }

  function setAnimSpeed(assetId, rpm) {
    var inst = weaInstances[assetId];
    if (!inst) return;
    inst.targetRPM = rpm;
    inst.assetData.animSpeed = rpmToMultiplier(inst, rpm);
    // Listener reads animSpeed live \u2014 no restart needed
    syncSliders(assetId);
  }

  function toggleAnimation(assetId) {
    var inst = weaInstances[assetId];
    if (!inst) return;
    inst.assetData.animSpeed = rpmToMultiplier(inst, inst.targetRPM);

    if (inst.assetData.animPlaying) {
      _stopWeaRotation(inst);
      inst.assetData.animPlaying = false;
    } else {
      _startWeaRotation(inst);
      inst.assetData.animPlaying = true;
    }
    var btn = document.getElementById('wea_pp_' + assetId);
    if (btn) btn.textContent = inst.assetData.animPlaying ? '\u23F8 Stop Rotor' : '\u25B6 Start Rotor';
  }

  function setPosition(assetId, field, value) {
    var inst = weaInstances[assetId];
    if (!inst) return;
    var v = parseFloat(value);
    if (field === 'lon') inst.assetData.position.lon = v;
    else if (field === 'lat') inst.assetData.position.lat = v;
    else if (field === 'height') { inst.assetData.position.height = v; inst.terrainHeight = v - inst.baseHeightCorrection; }
    else if (field === 'heading') inst.assetData.heading = v;
    BimViewer.updateGLBPosition(assetId);
    if (field === 'lon' || field === 'lat') clampToTerrain(inst);
  }

  async function loadContext() {
    var btn = document.getElementById('weaLoadContext');
    if (btn) { btn.textContent = '\u23F3 Loading...'; btn.disabled = true; }

    // Load OSM Buildings
    try {
      if (!BimViewer.osmBuildings || !BimViewer.osmBuildings.tileset) {
        await BimViewer.toggleOSMBuildings();
      } else if (!BimViewer.osmBuildings.enabled) {
        await BimViewer.toggleOSMBuildings();
      }
    } catch (e) { console.warn('WEA: OSM Buildings failed:', e.message); }

    // Load Ion asset 4548750
    try {
      if (!BimViewer.loadedAssets.has('4548750')) {
        await BimViewer.loadSelectedAsset(4548750, 'Terrain', { noFlyTo: true, silent: true });
      }
    } catch (e) { console.warn('WEA: Terrain asset failed:', e.message); }

    // Enable shadows on OSM buildings
    if (BimViewer.osmBuildings && BimViewer.osmBuildings.tileset) {
      BimViewer.osmBuildings.tileset.shadows = Cesium.ShadowMode.ENABLED;
    }

    if (btn) { btn.textContent = '\u2705 Buildings & Terrain loaded'; }
  }

  function removeWEA(assetId) {
    var inst = weaInstances[assetId];
    if (!inst) return;
    if (inst.assetData.model) BimViewer.viewer.scene.primitives.remove(inst.assetData.model);
    BimViewer.loadedAssets.delete(assetId);
    delete weaInstances[assetId];
    refreshPanel();
  }

  // Sync slider/input values without full re-render (avoids losing focus)
  function syncSliders(assetId) {
    var inst = weaInstances[assetId];
    if (!inst) return;
    var el = function(id) { return document.getElementById(id); };
    var h = inst.targetHubHeight, d = inst.targetRotorDiameter, sp = inst.targetRPM || 8;

    var hs = el('wea_hs_' + assetId), hi = el('wea_hi_' + assetId), hv = el('wea_hv_' + assetId);
    if (hs) hs.value = h; if (hi) hi.value = h; if (hv) hv.textContent = h + ' m';

    var rs = el('wea_rs_' + assetId), ri = el('wea_ri_' + assetId), rv = el('wea_rv_' + assetId);
    if (rs) rs.value = d; if (ri) ri.value = d; if (rv) rv.textContent = d + ' m';

    var ss = el('wea_ss_' + assetId), sv = el('wea_sv_' + assetId);
    if (ss) ss.value = sp; if (sv) sv.textContent = sp.toFixed(1) + ' RPM';
  }

  // ========================================================
  // LOAD WEA
  // ========================================================

  async function loadWEA(modelDef) {
    if (!modelDef.defaultPosition) modelDef.defaultPosition = { ...DEFAULT_POSITION };
    modelDef.defaultHeading = modelDef.defaultHeading || 180;
    modelDef.isWEA = true;
    await BimViewer.loadGLBAsset(modelDef);

    var assetId = 'glb_' + modelDef.id;
    var ad = BimViewer.loadedAssets.get(assetId);
    if (!ad) return;

    // Ensure animation is off (core.js readyEvent also handles this via isWEA flag)
    ad.animPlaying = false;

    var wea = modelDef._weaData || await fetchAndAnalyze(modelDef.file);
    if (!wea) return;

    var defaultHub = 199;
    var defaultRotor = 172;
    var modelScale = defaultHub / wea.hubHeight;

    var inst = {
      assetId: assetId,
      assetData: ad,
      wea: wea,
      targetHubHeight: defaultHub,
      targetRotorDiameter: defaultRotor,
      targetRPM: 8,
      terrainHeight: undefined,
      baseHeightCorrection: -wea.towerBaseOffsetY * modelScale,
      bladesRuntimeNode: null
    };

    ad.wea = wea;
    ad.scale = modelScale;
    ad.animSpeed = 8 / (wea.nativeRPM || 16.2);
    BimViewer.updateGLBPosition(assetId);
    weaInstances[assetId] = inst;
    clampToTerrain(inst, true);

    var model = ad.model;
    var attachNode = function() {
      inst.bladesRuntimeNode = findBladesRuntimeNode(model);
      if (inst.bladesRuntimeNode) setRotorDiameter(assetId, inst.targetRotorDiameter);
      refreshPanel();
    };
    if (model.ready) requestAnimationFrame(attachNode);
    else model.readyEvent.addEventListener(function() { requestAnimationFrame(attachNode); });

    refreshPanel();
    showPanel();
  }

  // ========================================================
  // SHADOW & TIME CONTROLS
  // ========================================================

  function applyWEAShadowQuality(viewer) {
    var sm = viewer.scene.shadowMap;
    sm.maximumDistance = 5000.0;
    sm.size = 4096;
    sm.softShadows = true;
    sm.normalOffset = true;
    sm.darkness = 0.4;
    viewer.scene.globe.shadows = Cesium.ShadowMode.RECEIVE_ONLY;
  }

  function syncShadowButton(on) {
    var btn = document.getElementById('weaShadowToggle');
    if (btn) {
      btn.textContent = on ? 'On' : 'Off';
      btn.style.color = on ? '#4fc3f7' : '';
    }
  }

  function toggleShadows() {
    var viewer = BimViewer.viewer;
    if (!viewer) return;

    // First activation: enable dynamic lighting (sun, atmosphere, shadows)
    if (!BimViewer.lighting || !BimViewer.lighting.enabled) {
      if (typeof BimViewer.enableDynamicLighting === 'function') {
        BimViewer.enableDynamicLighting(true);
      }
      applyWEAShadowQuality(viewer);
      syncShadowButton(true);
      syncDateTimeFromClock();
      return;
    }

    // Already initialized — toggle shadows
    var enabled = viewer.scene.shadowMap.enabled;
    viewer.scene.shadowMap.enabled = !enabled;

    if (!enabled) {
      applyWEAShadowQuality(viewer);
    }

    syncShadowButton(!enabled);
    syncDateTimeFromClock();
  }

  function syncDateTimeFromClock() {
    var viewer = BimViewer.viewer;
    if (!viewer) return;
    var jd = viewer.clock.currentTime;
    var iso = Cesium.JulianDate.toIso8601(jd);
    // iso = "2024-06-21T10:00:00.000Z" or similar
    var parts = iso.split('T');
    var dateEl = document.getElementById('weaDate');
    var timeInput = document.getElementById('weaTimeInput');
    var timeSlider = document.getElementById('weaTimeSlider');

    if (dateEl && parts[0]) dateEl.value = parts[0];
    if (parts[1]) {
      var hm = parts[1].substring(0, 5); // "10:00"
      if (timeInput) timeInput.value = hm;
      var hmParts = hm.split(':');
      var minutes = parseInt(hmParts[0]) * 60 + parseInt(hmParts[1]);
      if (timeSlider) timeSlider.value = minutes;
    }
  }

  function updateDateTime() {
    var dateEl = document.getElementById('weaDate');
    var timeInput = document.getElementById('weaTimeInput');
    if (!dateEl || !dateEl.value || !timeInput || !timeInput.value) return;
    var iso = dateEl.value + 'T' + timeInput.value + ':00';
    BimViewer.setTime(iso);
  }

  function onTimeSlider(minutes) {
    minutes = parseInt(minutes);
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    var hh = (h < 10 ? '0' : '') + h;
    var mm = (m < 10 ? '0' : '') + m;
    var timeInput = document.getElementById('weaTimeInput');
    if (timeInput) timeInput.value = hh + ':' + mm;
    updateDateTime();
  }

  function onTimeInput(value) {
    var parts = value.split(':');
    var minutes = parseInt(parts[0]) * 60 + parseInt(parts[1] || 0);
    var slider = document.getElementById('weaTimeSlider');
    if (slider) slider.value = minutes;
    updateDateTime();
  }

  // ========================================================
  // DAY ANIMATION
  // ========================================================

  function startDayPlay() {
    dayPlayActive = true;
    dayPlayLastTime = null;
    var btn = document.getElementById('weaPlayDayBtn');
    if (btn) btn.textContent = '⏸ Pause';

    function frame(ts) {
      if (!dayPlayActive) return;
      if (dayPlayLastTime !== null) {
        var dtSec = (ts - dayPlayLastTime) / 1000;
        var speedEl = document.getElementById('weaPlaySpeed');
        var speed = parseInt((speedEl && speedEl.value) || 60);
        var slider = document.getElementById('weaTimeSlider');
        if (slider) {
          var next = (parseInt(slider.value) + dtSec * speed) % 1440;
          slider.value = Math.round(next);
          onTimeSlider(slider.value);
        }
      }
      dayPlayLastTime = ts;
      dayPlayRAF = requestAnimationFrame(frame);
    }
    dayPlayRAF = requestAnimationFrame(frame);
  }

  function stopDayPlay() {
    dayPlayActive = false;
    if (dayPlayRAF) { cancelAnimationFrame(dayPlayRAF); dayPlayRAF = null; }
    dayPlayLastTime = null;
    var btn = document.getElementById('weaPlayDayBtn');
    if (btn) btn.textContent = '▶ Play Day';
  }

  function toggleDayPlay() {
    if (dayPlayActive) stopDayPlay();
    else startDayPlay();
  }

  // ========================================================
  // ADD SECOND WEA
  // ========================================================

  function addSecondWEA() {
    var sel = document.getElementById('weaModelSelector');
    if (!sel || !sel.value) return;
    var def = weaModelDefs.find(function(m) { return m.id === sel.value; });
    if (!def) return;
    var defCopy = Object.assign({}, def);
    var keys = Object.keys(weaInstances);
    var baseLon = DEFAULT_POSITION.lon;
    var baseLat = DEFAULT_POSITION.lat;
    if (keys.length > 0) {
      var last = weaInstances[keys[keys.length - 1]];
      baseLon = last.assetData.position.lon;
      baseLat = last.assetData.position.lat;
    }
    defCopy.id = def.id + '_' + Date.now();
    defCopy.name = def.name + ' 2';
    defCopy.defaultPosition = { lon: baseLon + 0.005, lat: baseLat, height: 0 };
    defCopy.defaultHeading = def.defaultHeading || 180;
    loadWEA(defCopy);
  }

  // ========================================================
  // IMMISSION POINTS
  // ========================================================

  function enableImmissionMode() {
    immissionMode = true;
    var canvas = BimViewer.viewer.scene.canvas;
    canvas.style.cursor = 'crosshair';
    immissionHandler = new Cesium.ScreenSpaceEventHandler(canvas);
    immissionHandler.setInputAction(function(event) {
      if (!immissionMode) return;
      var ray = BimViewer.viewer.camera.getPickRay(event.position);
      var cartesian = BimViewer.viewer.scene.globe.pick(ray, BimViewer.viewer.scene);
      if (!cartesian) cartesian = BimViewer.viewer.camera.pickEllipsoid(event.position);
      if (!cartesian) return;
      var carto = Cesium.Cartographic.fromCartesian(cartesian);
      placeImmissionPoint(
        Cesium.Math.toDegrees(carto.longitude),
        Cesium.Math.toDegrees(carto.latitude),
        carto.height || 0
      );
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    var btn = document.getElementById('weaImmissionBtn');
    if (btn) { btn.textContent = '✖ Click on map…'; btn.style.color = '#FF8C00'; }
  }

  function disableImmissionMode() {
    immissionMode = false;
    if (immissionHandler) { immissionHandler.destroy(); immissionHandler = null; }
    var canvas = BimViewer.viewer && BimViewer.viewer.scene && BimViewer.viewer.scene.canvas;
    if (canvas) canvas.style.cursor = '';
    var btn = document.getElementById('weaImmissionBtn');
    if (btn) {
      btn.innerHTML = '<i data-lucide="map-pin" style="width:13px;height:13px;margin-right:5px;vertical-align:middle;"></i>Set Receptor';
      btn.style.color = '';
    }
    if (window.lucide) lucide.createIcons();
  }

  function toggleImmission() {
    if (!BimViewer.viewer) return;
    if (immissionMode) disableImmissionMode();
    else enableImmissionMode();
  }

  function placeImmissionPoint(lon, lat, terrainH) {
    immissionCounter++;
    var label = 'Receptor ' + immissionCounter;
    var id = 'immission_' + immissionCounter;
    var entity = BimViewer.viewer.entities.add({
      id: id,
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
      point: {
        pixelSize: 14,
        color: Cesium.Color.fromCssColorString('#FF8C00'),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      label: {
        text: label,
        font: '13px sans-serif',
        fillColor: Cesium.Color.fromCssColorString('#FF8C00'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -18),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    immissionPoints.push({ id: id, entity: entity, lon: lon, lat: lat, label: label, terrainH: terrainH || 0 });
    disableImmissionMode();
    refreshPanel();
  }

  function removeImmissionPoint(id) {
    for (var i = 0; i < immissionPoints.length; i++) {
      if (immissionPoints[i].id === id) {
        BimViewer.viewer.entities.remove(immissionPoints[i].entity);
        immissionPoints.splice(i, 1);
        break;
      }
    }
    refreshPanel();
  }

  function viewFromReceptor(id) {
    var pt = immissionPoints.find(function(p) { return p.id === id; });
    if (!pt) return;
    var keys = Object.keys(weaInstances);
    if (keys.length === 0) return;

    // Find nearest WEA
    var targetInst = weaInstances[keys[0]];
    var nearestDist = Infinity;
    for (var k = 0; k < keys.length; k++) {
      var inst = weaInstances[keys[k]];
      var dLon = inst.assetData.position.lon - pt.lon;
      var dLat = inst.assetData.position.lat - pt.lat;
      var d = dLon * dLon + dLat * dLat;
      if (d < nearestDist) { nearestDist = d; targetInst = inst; }
    }

    var weaPos = targetInst.assetData.position;
    var R = 6371000;
    var latRad = pt.lat * Math.PI / 180;
    var distM = Math.sqrt(
      Math.pow((weaPos.lat - pt.lat) * Math.PI / 180 * R, 2) +
      Math.pow((weaPos.lon - pt.lon) * Math.PI / 180 * R * Math.cos(latRad), 2)
    );

    // Bearing: clockwise from north
    var dLonM = (weaPos.lon - pt.lon) * Math.PI / 180 * R * Math.cos(latRad);
    var dLatM = (weaPos.lat - pt.lat) * Math.PI / 180 * R;
    var headingRad = Math.atan2(dLonM, dLatM);

    var eyeH = pt.terrainH + 1.7;
    var weaTerrainH = targetInst.terrainHeight || 0;
    var deltaH = (weaTerrainH + targetInst.targetHubHeight) - eyeH;
    var pitchRad = Math.atan2(deltaH, distM);
    BimViewer.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, eyeH),
      orientation: { heading: headingRad, pitch: pitchRad, roll: 0 },
      duration: 2
    });
  }

  function renderImmissionSection() {
    var list = document.getElementById('weaImmissionList');
    if (!list) return;
    if (immissionPoints.length === 0) { list.innerHTML = ''; return; }
    var hasWEA = Object.keys(weaInstances).length > 0;
    var html = '<div style="margin-bottom: 8px; border: 1px solid rgba(255,140,0,0.2); border-radius: 6px; padding: 6px;">' +
      '<div style="font-size: 10px; color: rgba(255,255,255,0.4); margin-bottom: 4px;">Receptors</div>';
    for (var i = 0; i < immissionPoints.length; i++) {
      var pt = immissionPoints[i];
      html += '<div style="display:flex; justify-content:space-between; align-items:center; padding: 2px 0;">' +
        '<span style="font-size:10px; color:#FF8C00;">' + pt.label + '</span>' +
        '<span style="font-size:9px; color:rgba(255,255,255,0.3); margin: 0 4px;">' + pt.lon.toFixed(5) + ', ' + pt.lat.toFixed(5) + '</span>' +
        '<div style="display:flex; gap:2px;">' +
          (hasWEA ? '<button class="modern-icon-btn" onclick="BimWEA.viewFromReceptor(\'' + pt.id + '\')" title="View from receptor"><i data-lucide="eye" style="width:12px;height:12px;"></i></button>' : '') +
          '<button class="modern-icon-btn" onclick="BimWEA.removeImmission(\'' + pt.id + '\')" title="Remove">✕</button>' +
        '</div>' +
        '</div>';
    }
    html += '</div>';
    list.innerHTML = html;
  }

  // ========================================================
  // LAYER PANEL
  // ========================================================

  var LAYER_PANEL_ID = 'weaLayerPanel';
  var layerPanelCreated = false;

  function createLayerPanel() {
    if (layerPanelCreated) return;
    layerPanelCreated = true;

    var panel = document.createElement('div');
    panel.id = LAYER_PANEL_ID;
    panel.innerHTML =
      '<div id="weaLayerPanelHeader" class="floating-panel-header">' +
        '<span class="floating-panel-title">Layer Manager</span>' +
        '<div class="floating-panel-controls">' +
          '<button class="floating-panel-btn" onclick="BimWEA.toggleLayerCollapse()" title="Minimize">−</button>' +
          '<button class="floating-panel-btn" onclick="BimWEA.toggleLayerPanel()" title="Close">✕</button>' +
        '</div>' +
      '</div>' +
      '<div id="weaLayerPanelBody" class="floating-panel-body">' +

        // Basemap
        '<div style="margin-bottom: 10px;">' +
          '<div style="font-size:9px; color:rgba(255,255,255,0.35); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:5px;">Basemap</div>' +
          '<div id="weaLayerBasemapList"></div>' +
        '</div>' +

        // WMS / WMTS / WFS
        '<div style="border-top:1px solid rgba(255,255,255,0.06); padding-top:8px;">' +
          '<div style="font-size:9px; color:rgba(255,255,255,0.35); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:5px;">WMS / WMTS / WFS</div>' +
          '<div style="display:flex; gap:4px; margin-bottom:4px;">' +
            '<input type="url" id="weaLayerWmsUrl" class="zoffset-input-box" style="flex:1; font-size:10px;" placeholder="Service URL...">' +
            '<button class="modern-btn modern-btn-small" onclick="BimWEA.discoverWMS()">Discover</button>' +
          '</div>' +
          '<div id="weaLayerWmsStatus" style="font-size:9px; color:rgba(255,255,255,0.3); margin-bottom:3px;"></div>' +
          '<div id="weaLayerWmsPicker" style="display:none; max-height:110px; overflow-y:auto; margin-bottom:6px; border:1px solid rgba(255,255,255,0.06); border-radius:5px; padding:4px;"></div>' +
          '<div id="weaLayerWmsList"></div>' +
        '</div>' +

      '</div>';

    document.body.appendChild(panel);
    if (window.lucide) lucide.createIcons();

    if (typeof BimViewer.makeFloatingPanelDraggable === 'function') {
      BimViewer.makeFloatingPanelDraggable(panel, document.getElementById('weaLayerPanelHeader'));
    }

    refreshLayerPanel();
  }

  function refreshLayerPanel() {
    renderBasemapList();
    renderWMSList();
  }

  var LAYER_PANEL_BASEMAPS = ['bing-aerial-labels', 'osm', 'google-contour', 'google-sat-labels'];

  function renderBasemapList() {
    var container = document.getElementById('weaLayerBasemapList');
    if (!container || !window.LayerManager) return;
    var html = '';
    LayerManager.basemapLayers
      .filter(function(b) { return LAYER_PANEL_BASEMAPS.indexOf(b.id) !== -1; })
      .forEach(function(b) {
        html +=
          '<label style="display:flex; align-items:center; gap:6px; padding:2px 0; cursor:pointer;">' +
            '<input type="radio" name="weaBasemap" value="' + b.id + '"' + (b.active ? ' checked' : '') +
              ' onchange="BimWEA.switchBasemap(\'' + b.id + '\')" style="accent-color:var(--brand-teal);">' +
            '<span style="font-size:10px;">' + b.name + '</span>' +
          '</label>';
      });
    container.innerHTML = html;
  }

  function renderWMSList() {
    var container = document.getElementById('weaLayerWmsList');
    if (!container || !window.LayerManager) return;
    var layers = LayerManager.wmsLayers;
    if (layers.length === 0) { container.innerHTML = ''; return; }
    var html = '<div style="font-size:9px; color:rgba(255,255,255,0.3); margin-bottom:3px;">Loaded</div>';
    layers.forEach(function(w) {
      html +=
        '<div style="display:flex; align-items:center; gap:4px; padding:2px 0;">' +
          '<button class="modern-icon-btn" onclick="BimWEA.toggleWMS(\'' + w.id + '\')" title="Toggle visibility">' +
            '<i data-lucide="' + (w.visible !== false ? 'eye' : 'eye-off') + '" style="width:12px;height:12px;"></i>' +
          '</button>' +
          '<span style="font-size:10px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="' + w.name + '">' + w.name + '</span>' +
          '<button class="modern-icon-btn" onclick="BimWEA.removeWMS(\'' + w.id + '\')" title="Remove">✕</button>' +
        '</div>';
    });
    container.innerHTML = html;
    if (window.lucide) lucide.createIcons();
  }

  async function discoverWMS() {
    if (!window.LayerManager) return;
    var urlEl = document.getElementById('weaLayerWmsUrl');
    var statusEl = document.getElementById('weaLayerWmsStatus');
    var pickerEl = document.getElementById('weaLayerWmsPicker');
    if (!urlEl || !urlEl.value.trim()) return;

    if (statusEl) statusEl.textContent = 'Discovering…';
    if (pickerEl) { pickerEl.style.display = 'none'; pickerEl.innerHTML = ''; }

    try {
      await LayerManager.discoverWmsLayers(urlEl.value.trim());
      var discovered = LayerManager.wmsDiscovered || [];
      if (discovered.length === 0) {
        if (statusEl) statusEl.textContent = 'No layers found.';
        return;
      }
      if (statusEl) statusEl.textContent = discovered.length + ' layer(s) found — click to add:';
      var html = '';
      discovered.forEach(function(l, i) {
        var typeLabel = (l.type || 'wms').toUpperCase();
        html +=
          '<div style="display:flex; align-items:center; gap:4px; padding:2px 0;">' +
            '<span style="font-size:9px; color:rgba(255,255,255,0.3); min-width:28px;">' + typeLabel + '</span>' +
            '<span style="font-size:10px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="' + (l.title || l.name) + '">' + (l.title || l.name) + '</span>' +
            '<button class="modern-btn modern-btn-small" onclick="BimWEA.addDiscoveredLayer(' + i + ')" style="min-width:24px;">➕</button>' +
          '</div>';
      });
      if (pickerEl) { pickerEl.innerHTML = html; pickerEl.style.display = 'block'; }
    } catch(e) {
      if (statusEl) statusEl.textContent = 'Discovery failed.';
    }
  }

  async function addDiscoveredLayer(index) {
    if (!window.LayerManager) return;
    await LayerManager.addDiscoveredWmsLayer(index);
    await LayerManager.switchBasemap('none');
    refreshLayerPanel();
  }

  function switchBasemap(id) {
    if (!window.LayerManager) return;
    LayerManager.switchBasemap(id).then(function() { renderBasemapList(); });
  }

  function toggleWMSLayer(id) {
    if (!window.LayerManager) return;
    LayerManager.toggleWmsLayer(id);
    renderWMSList();
  }

  function removeWMSLayer(id) {
    if (!window.LayerManager) return;
    LayerManager.removeWmsLayer(id);
    renderWMSList();
  }

  function showLayerPanel() {
    createLayerPanel();
    var p = document.getElementById(LAYER_PANEL_ID);
    if (p) p.classList.add('visible');
    refreshLayerPanel();
  }

  function toggleLayerPanel() {
    createLayerPanel();
    var p = document.getElementById(LAYER_PANEL_ID);
    if (!p) return;
    if (p.classList.contains('visible')) {
      p.classList.remove('visible');
    } else {
      p.classList.add('visible');
      refreshLayerPanel();
    }
  }

  function toggleLayerCollapse() {
    var body = document.getElementById('weaLayerPanelBody');
    if (!body) return;
    body.classList.toggle('collapsed');
    var btn = document.querySelector('#' + LAYER_PANEL_ID + ' .floating-panel-btn');
    if (btn) btn.textContent = body.classList.contains('collapsed') ? '+' : '−';
  }

  // ========================================================
  // FLOATING PANEL
  // ========================================================

  function createPanel() {
    if (panelCreated) return;
    panelCreated = true;

    var panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML =
      '<div id="weaPanelHeader" class="floating-panel-header">' +
        '<span class="floating-panel-title">\uD83C\uDF2C\uFE0F WEA Shadow</span>' +
        '<div class="floating-panel-controls">' +
          '<button class="floating-panel-btn" onclick="BimWEA.toggleCollapse()" title="Minimize">\u2212</button>' +
          '<button class="floating-panel-btn" onclick="BimWEA.toggle()" title="Close">\u2715</button>' +
        '</div>' +
      '</div>' +
      '<div id="weaPanelBody" class="floating-panel-body">' +
        '<div id="weaSelector" style="margin-bottom: 8px;">' +
          '<select id="weaModelSelector" class="modern-select" size="1" style="width:100%;">' +
            '<option value="" disabled selected>Scanning...</option>' +
          '</select>' +
          '<button id="weaLoadBtn" class="modern-btn modern-btn-primary" style="margin-top: 6px; width:100%;">' +
            '<span class="modern-btn-icon">\u2795</span>' +
            '<span>Load Turbine</span>' +
          '</button>' +
          '<button class="modern-btn modern-btn-small" style="margin-top: 4px; width:100%;" onclick="BimWEA.addSecondWEA()">' +
            '<span class="modern-btn-icon">\u2795</span>' +
            '<span>Add 2nd Turbine</span>' +
          '</button>' +
        '</div>' +

        // Shadow & Time controls
        '<div id="weaShadowControls" style="margin-bottom: 8px; border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 8px;">' +

          // Shadows toggle
          '<div style="display: flex; align-items: center; justify-content: space-between;">' +
            '<label style="font-size: 10px; color: rgba(255,255,255,0.4);">Shadows</label>' +
            '<button id="weaShadowToggle" class="modern-btn modern-btn-small" style="min-width: 50px;" onclick="BimWEA.toggleShadows()">Off</button>' +
          '</div>' +

          // Date
          '<div style="margin-top: 6px;">' +
            '<label style="font-size: 10px; color: rgba(255,255,255,0.4);">Date</label>' +
            '<input type="date" id="weaDate" class="zoffset-input-box" style="width:100%; color-scheme: dark;" value="" onchange="BimWEA.updateDateTime()">' +
          '</div>' +

          // Time slider + input
          '<div style="margin-top: 4px;">' +
            '<label style="font-size: 10px; color: rgba(255,255,255,0.4);">Time</label>' +
            '<div style="display: flex; align-items: center; gap: 4px;">' +
              '<input type="range" id="weaTimeSlider" min="0" max="1440" step="5" value="600" class="modern-slider-small" style="flex:1;" oninput="BimWEA.onTimeSlider(this.value)">' +
              '<input type="time" id="weaTimeInput" class="zoffset-input-box" style="width:75px; color-scheme: dark;" value="10:00" onchange="BimWEA.onTimeInput(this.value)">' +
            '</div>' +
          '</div>' +

          // Play Day animation
          '<div style="margin-top: 6px; display: flex; gap: 4px;">' +
            '<button id="weaPlayDayBtn" class="modern-btn modern-btn-small" style="flex:1;" onclick="BimWEA.toggleDayPlay()">▶ Play Day</button>' +
            '<select id="weaPlaySpeed" class="modern-select" style="width:72px; font-size:10px;" title="Playback speed">' +
              '<option value="30">\xD730</option>' +
              '<option value="60" selected>\xD760</option>' +
              '<option value="180">\xD7180</option>' +
              '<option value="360">\xD7360</option>' +
            '</select>' +
          '</div>' +

        '</div>' +

        // Measure button
        '<div style="margin-bottom: 8px;">' +
          '<button class="modern-btn modern-btn-small" style="width:100%;" onclick="BimViewer.toggleMeasurementPanel()">' +
            '<i data-lucide="ruler" style="width:13px;height:13px;margin-right:5px;vertical-align:middle;"></i>' +
            'Measure' +
          '</button>' +
        '</div>' +

        // Receptor / Immission point
        '<div style="margin-bottom: 4px;">' +
          '<button id="weaImmissionBtn" class="modern-btn modern-btn-small" style="width:100%;" onclick="BimWEA.toggleImmission()">' +
            '<i data-lucide="map-pin" style="width:13px;height:13px;margin-right:5px;vertical-align:middle;"></i>' +
            'Set Receptor' +
          '</button>' +
        '</div>' +
        '<div id="weaImmissionList" style="margin-bottom: 4px;"></div>' +

        // Context: OSM Buildings + Terrain Asset
        '<div style="margin-bottom: 8px;">' +
          '<button id="weaLoadContext" class="modern-btn modern-btn-small" style="width:100%;" onclick="BimWEA.loadContext()">' +
            '\uD83C\uDFD8\uFE0F Load Buildings & Terrain' +
          '</button>' +
        '</div>' +

        // Layer Manager
        '<div style="margin-bottom: 8px;">' +
          '<button class="modern-btn modern-btn-small" style="width:100%;" onclick="BimWEA.toggleLayerPanel()">' +
            '<i data-lucide="layers" style="width:13px;height:13px;margin-right:5px;vertical-align:middle;"></i>' +
            'Layer Manager' +
          '</button>' +
        '</div>' +

        // Atmosphere presets
        '<div style="margin-bottom:8px; border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:8px;">' +
          '<div style="font-size:9px; color:rgba(255,255,255,0.3); margin-bottom:6px; text-transform:uppercase; letter-spacing:0.5px;">Atmosphäre</div>' +
          '<div style="display:grid; grid-template-columns:1fr 1fr; gap:4px;">' +
            '<button class="modern-btn modern-btn-small modern-btn-primary" id="weaAtmPreset_clearDay" onclick="BimAtmosphere && BimAtmosphere.applyPreset(\'clearDay\')">' +
              '<i data-lucide="sun" style="width:11px;height:11px;margin-right:3px;vertical-align:middle;"></i>Klarer Tag' +
            '</button>' +
            '<button class="modern-btn modern-btn-small" id="weaAtmPreset_goldenHour" onclick="BimAtmosphere && BimAtmosphere.applyPreset(\'goldenHour\')">' +
              '<i data-lucide="sun-dim" style="width:11px;height:11px;margin-right:3px;vertical-align:middle;"></i>Goldene Std.' +
            '</button>' +
            '<button class="modern-btn modern-btn-small" id="weaAtmPreset_overcast" onclick="BimAtmosphere && BimAtmosphere.applyPreset(\'overcast\')">' +
              '<i data-lucide="cloud" style="width:11px;height:11px;margin-right:3px;vertical-align:middle;"></i>Bewölkt' +
            '</button>' +
            '<button class="modern-btn modern-btn-small" id="weaAtmPreset_standard" onclick="BimAtmosphere && BimAtmosphere.applyPreset(\'standard\')">' +
              '<i data-lucide="rotate-ccw" style="width:11px;height:11px;margin-right:3px;vertical-align:middle;"></i>Standard' +
            '</button>' +
          '</div>' +
        '</div>' +

        '<div id="weaInstanceList"></div>' +
      '</div>';

    document.body.appendChild(panel);
    if (window.lucide) lucide.createIcons();

    // Make draggable
    if (typeof BimViewer.makeFloatingPanelDraggable === 'function') {
      BimViewer.makeFloatingPanelDraggable(panel, document.getElementById('weaPanelHeader'));
    }

    // Wire load button
    document.getElementById('weaLoadBtn').addEventListener('click', function() {
      var sel = document.getElementById('weaModelSelector');
      if (!sel || !sel.value) return;
      var def = weaModelDefs.find(function(m) { return m.id === sel.value; });
      if (def) loadWEA(def);
    });

    // Populate selector
    discoverWEAModels().then(function(models) {
      weaModelDefs = models;
      var sel = document.getElementById('weaModelSelector');
      if (!sel) return;
      if (models.length === 0) {
        sel.innerHTML = '<option value="" disabled selected>No turbine models found</option>';
        return;
      }
      sel.innerHTML = '<option value="" disabled selected>Select turbine...</option>';
      models.forEach(function(m) {
        var opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name;
        sel.appendChild(opt);
      });
    });

    refreshPanel();
  }

  function renderInstanceCard(inst) {
    var id = inst.assetId;
    var h = inst.targetHubHeight;
    var d = inst.targetRotorDiameter;
    var speed = inst.targetRPM || 8;
    var playing = inst.assetData.animPlaying;
    var name = inst.assetData.name;
    var pos = inst.assetData.position;

    return '' +
      '<div id="wea_card_' + id + '" style="margin-bottom: 8px; border: 1px solid rgba(79,195,247,0.15); border-radius: 6px; padding: 8px;">' +

      // Header
      '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">' +
        '<span style="font-size: 11px; font-weight: 600; color: #4fc3f7;">' + name + '</span>' +
        '<div style="display: flex; gap: 4px;">' +
          '<button class="modern-icon-btn" onclick="BimWEA.flyTo(\'' + id + '\')" title="Fly to">\uD83D\uDCCD</button>' +
          '<button class="modern-icon-btn" onclick="BimWEA.remove(\'' + id + '\')" title="Remove">\uD83D\uDDD1\uFE0F</button>' +
        '</div>' +
      '</div>' +

      // Position
      '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">' +
        '<div><label style="font-size: 9px; color: rgba(255,255,255,0.35);">Lon</label>' +
          '<input type="number" step="0.0001" value="' + pos.lon.toFixed(6) + '" class="zoffset-input-box" style="width:100%;" onchange="BimWEA.setPosition(\'' + id + '\',\'lon\',this.value)"></div>' +
        '<div><label style="font-size: 9px; color: rgba(255,255,255,0.35);">Lat</label>' +
          '<input type="number" step="0.0001" value="' + pos.lat.toFixed(6) + '" class="zoffset-input-box" style="width:100%;" onchange="BimWEA.setPosition(\'' + id + '\',\'lat\',this.value)"></div>' +
      '</div>' +
      '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 4px;">' +
        '<div><label style="font-size: 9px; color: rgba(255,255,255,0.35);">Height (m)</label>' +
          '<input type="number" step="0.5" value="' + pos.height.toFixed(1) + '" id="wea_alt_' + id + '" class="zoffset-input-box" style="width:100%;" onchange="BimWEA.setPosition(\'' + id + '\',\'height\',this.value)"></div>' +
        '<div><label style="font-size: 9px; color: rgba(255,255,255,0.35);">Heading (\u00B0)</label>' +
          '<input type="number" min="0" max="360" step="1" value="' + Math.round(inst.assetData.heading || 0) + '" class="zoffset-input-box" style="width:100%;" onchange="BimWEA.setPosition(\'' + id + '\',\'heading\',this.value)"></div>' +
      '</div>' +

      // Hub Height
      '<div style="margin-top: 6px;">' +
        '<label style="font-size: 10px; color: rgba(255,255,255,0.4);">Hub Height</label>' +
        '<div style="display: flex; align-items: center; gap: 4px;">' +
          '<input type="range" min="40" max="200" step="1" value="' + h + '" id="wea_hs_' + id + '" class="modern-slider-small" style="flex:1;" oninput="BimWEA.setHubHeight(\'' + id + '\',parseFloat(this.value))">' +
          '<input type="number" min="20" max="300" step="1" value="' + h + '" id="wea_hi_' + id + '" class="zoffset-input-box" style="width:50px;" onchange="BimWEA.setHubHeight(\'' + id + '\',parseFloat(this.value))">' +
          '<span id="wea_hv_' + id + '" class="modern-value-small" style="min-width:38px;">' + h + ' m</span>' +
        '</div>' +
      '</div>' +

      // Rotor Diameter
      '<div style="margin-top: 4px;">' +
        '<label style="font-size: 10px; color: rgba(255,255,255,0.4);">Rotor Diameter</label>' +
        '<div style="display: flex; align-items: center; gap: 4px;">' +
          '<input type="range" min="20" max="200" step="1" value="' + d + '" id="wea_rs_' + id + '" class="modern-slider-small" style="flex:1;" oninput="BimWEA.setRotorDiameter(\'' + id + '\',parseFloat(this.value))">' +
          '<input type="number" min="10" max="300" step="1" value="' + d + '" id="wea_ri_' + id + '" class="zoffset-input-box" style="width:50px;" onchange="BimWEA.setRotorDiameter(\'' + id + '\',parseFloat(this.value))">' +
          '<span id="wea_rv_' + id + '" class="modern-value-small" style="min-width:38px;">' + d + ' m</span>' +
        '</div>' +
      '</div>' +

      // Rotor Speed (RPM)
      '<div style="margin-top: 4px;">' +
        '<label style="font-size: 10px; color: rgba(255,255,255,0.4);">Rotor Speed (RPM)</label>' +
        '<div style="display: flex; align-items: center; gap: 4px;">' +
          '<input type="range" min="1" max="15" step="0.5" value="' + speed + '" id="wea_ss_' + id + '" class="modern-slider-small" style="flex:1;" oninput="BimWEA.setAnimSpeed(\'' + id + '\',parseFloat(this.value))">' +
          '<span id="wea_sv_' + id + '" class="modern-value-small" style="min-width:45px;">' + speed.toFixed(1) + ' RPM</span>' +
        '</div>' +
        '<button class="modern-btn modern-btn-small" style="width:100%; margin-top: 4px;" onclick="BimWEA.toggleAnim(\'' + id + '\')" id="wea_pp_' + id + '">' +
          (playing ? '\u23F8 Stop Rotor' : '\u25B6 Start Rotor') +
        '</button>' +
      '</div>' +

      // Info
      '<div style="margin-top: 4px; font-size: 9px; color: rgba(255,255,255,0.2);">' +
        'Scale: ' + (inst.assetData.scale || 1).toFixed(5) +
        ' | Terrain: ' + (inst.terrainHeight !== undefined ? inst.terrainHeight.toFixed(1) + 'm' : '...') +
      '</div>' +

      '</div>';
  }

  function refreshPanel() {
    var list = document.getElementById('weaInstanceList');
    if (!list) return;
    var keys = Object.keys(weaInstances);
    if (keys.length === 0) {
      list.innerHTML = '<div style="text-align:center; padding:8px; font-size:10px; color:rgba(255,255,255,0.25);">No turbines loaded</div>';
    } else {
      var html = '';
      for (var i = 0; i < keys.length; i++) html += renderInstanceCard(weaInstances[keys[i]]);
      list.innerHTML = html;
    }
    renderImmissionSection();
    if (window.lucide) lucide.createIcons();
  }

  // ========================================================
  // PANEL VISIBILITY
  // ========================================================

  function showPanel() {
    createPanel();
    var p = document.getElementById(PANEL_ID);
    if (p) p.classList.add('visible');
  }

  function hidePanel() {
    var p = document.getElementById(PANEL_ID);
    if (p) p.classList.remove('visible');
  }

  function togglePanel() {
    createPanel();
    var p = document.getElementById(PANEL_ID);
    if (!p) return;
    p.classList.toggle('visible');
  }

  function toggleCollapse() {
    var body = document.getElementById('weaPanelBody');
    var btn = document.querySelector('#' + PANEL_ID + ' .floating-panel-btn');
    if (!body) return;
    body.classList.toggle('collapsed');
    if (btn) btn.textContent = body.classList.contains('collapsed') ? '+' : '\u2212';
  }

  // ========================================================
  // KEYBOARD SHORTCUT
  // ========================================================

  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key.toLowerCase() === 'w') {
      if (window.BimFirstPerson && BimFirstPerson.isActive()) return;
      e.preventDefault();
      togglePanel();
    }
  });

  // ========================================================
  // INIT
  // ========================================================

  function init() {
    if (!BimViewer || !BimViewer.viewer) { setTimeout(init, 500); return; }
    // Pre-discover models so selector is ready when panel opens
    discoverWEAModels().then(function(models) { weaModelDefs = models; });
    console.log('\u2705 WEA Shadow module ready (press W to open)');
  }

  // ========================================================
  // PUBLIC API
  // ========================================================

  window.BimWEA = {
    toggle: togglePanel,
    toggleCollapse: toggleCollapse,
    toggleShadows: toggleShadows,
    updateDateTime: updateDateTime,
    onTimeSlider: onTimeSlider,
    onTimeInput: onTimeInput,
    setHubHeight: setHubHeight,
    setRotorDiameter: setRotorDiameter,
    setAnimSpeed: setAnimSpeed,
    toggleAnim: toggleAnimation,
    setPosition: setPosition,
    loadContext: loadContext,
    flyTo: function(id) { BimViewer.zoomToAsset(id); },
    remove: removeWEA,
    load: loadWEA,
    instances: weaInstances,
    // Day animation
    toggleDayPlay: toggleDayPlay,
    // Second turbine
    addSecondWEA: addSecondWEA,
    // Immission points
    toggleImmission: toggleImmission,
    removeImmission: removeImmissionPoint,
    viewFromReceptor: viewFromReceptor,
    // Layer panel
    toggleLayerPanel: toggleLayerPanel,
    toggleLayerCollapse: toggleLayerCollapse,
    switchBasemap: switchBasemap,
    discoverWMS: discoverWMS,
    addDiscoveredLayer: addDiscoveredLayer,
    toggleWMS: toggleWMSLayer,
    removeWMS: removeWMSLayer
  };

  if (document.readyState === 'complete') setTimeout(init, 1000);
  else window.addEventListener('load', function() { setTimeout(init, 1000); });

})();
