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
// Tested with CesiumJS 1.139.1
// ============================================================

(function() {
  'use strict';

  var PANEL_ID = 'weaShadowPanel';
  var WEA_NODE_TOWER = 'Main Unit';
  var WEA_NODE_BLADES = 'Blades';
  var DEFAULT_POSITION = { lon: 9.9368, lat: 50.4983, height: 0 };

  // State
  var weaInstances = {};
  var weaModelDefs = [];
  var panelCreated = false;

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
      if (!resp.ok && resp.status !== 206) return null;
      return analyzeWEA(parseGLBJson(await resp.arrayBuffer()));
    } catch (e) { return null; }
  }

  async function discoverWEAModels() {
    try {
      var resp = await fetch('api/wea-models.php');
      if (!resp.ok) return [];
      var models = await resp.json();
      var result = [];
      await Promise.all(models.map(function(m) {
        if (!m.file.toLowerCase().endsWith('.glb')) return Promise.resolve();
        return fetchAndAnalyze(m.file).then(function(wea) {
          if (wea) { m._weaData = wea; result.push(m); }
        });
      }));
      return result;
    } catch (e) { return []; }
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

  function setAnimSpeed(assetId, rpm) {
    var inst = weaInstances[assetId];
    if (!inst) return;
    inst.targetRPM = rpm;
    var mult = rpmToMultiplier(inst, rpm);
    inst.assetData.animSpeed = mult;
    if (inst.assetData.animPlaying) BimViewer.setGLBAnimationSpeed(assetId, mult);
    syncSliders(assetId);
  }

  function toggleAnimation(assetId) {
    var inst = weaInstances[assetId];
    if (inst) inst.assetData.animSpeed = rpmToMultiplier(inst, inst.targetRPM);
    BimViewer.toggleGLBAnimation(assetId);
    if (!inst) return;
    inst.assetData.animPlaying = !inst.assetData.animPlaying;
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
    modelDef.defaultHeading = modelDef.defaultHeading || 248;
    modelDef.isWEA = true;
    await BimViewer.loadGLBAsset(modelDef);

    var assetId = 'glb_' + modelDef.id;
    var ad = BimViewer.loadedAssets.get(assetId);
    if (!ad) return;

    // Ensure animation is off (core.js readyEvent also handles this via isWEA flag)
    ad.animPlaying = false;

    var wea = modelDef._weaData || await fetchAndAnalyze(modelDef.file);
    if (!wea) return;

    var defaultHub = 131;
    var defaultRotor = 138;
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
    if (model._ready || model.ready) requestAnimationFrame(attachNode);
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

        '</div>' +

        // Context: OSM Buildings + Terrain Asset
        '<div style="margin-bottom: 8px;">' +
          '<button id="weaLoadContext" class="modern-btn modern-btn-small" style="width:100%;" onclick="BimWEA.loadContext()">' +
            '\uD83C\uDFD8\uFE0F Load Buildings & Terrain' +
          '</button>' +
        '</div>' +

        '<div id="weaInstanceList"></div>' +
      '</div>';

    document.body.appendChild(panel);

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
      return;
    }
    var html = '';
    for (var i = 0; i < keys.length; i++) html += renderInstanceCard(weaInstances[keys[i]]);
    list.innerHTML = html;
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
    instances: weaInstances
  };

  if (document.readyState === 'complete') setTimeout(init, 1000);
  else window.addEventListener('load', function() { setTimeout(init, 1000); });

})();
