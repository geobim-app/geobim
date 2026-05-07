// ============================================================
// SIB Module — Parametric Bridge Generator for geobim.app
//
// Copyright (c) 2026 geobim.app
// Licensed under the Business Source License 1.1 (BSL 1.1)
// Change Date: 2030-03-01 | Change License: MIT
// See LICENSE file for full terms.
//
// Generates parametric GLB bridge models from SIB data,
// places them georeferenced in the Cesium viewer.
// Backend: FastAPI on Hetzner (/api/sib/generate)
//
// Tested with CesiumJS 1.141
// ============================================================

(function() {
  'use strict';

  var PANEL_ID = 'sibPanel';

  // ========================================================
  // BRIDGE TYPE DEFINITIONS
  // ========================================================

  var BAUWERKSARTEN = [
    { code: 'PLATTE',    label: 'Plattenbrücke' },
    { code: 'TRAEGER',   label: 'Trägerrostbrücke' },
    { code: 'GEWOELBE',  label: 'Gewölbe-/Bogenbrücke' },
    { code: 'RAHMEN_O',  label: 'Brücke als offener Rahmen' },
    { code: 'RAHMEN_G',  label: 'Brücke als geschlossener Rahmen' },
    { code: 'ROHR',      label: 'Rohr als Brücke' }
  ];

  // ========================================================
  // EXAMPLE DATA (SIB Aachen, Open Data)
  // ========================================================

  var BEISPIEL_BAUWERKE = [
    {
      bauwerksnr: 'A008', bauwerksname: 'Wolfsbendenstraße', ort: 'Eilendorf, Aachen',
      bauwerksart_code: 'PLATTE', bauwerksart_label: 'Plattenbrücke',
      baujahr: 1965, stuetzweite: 14.5, breite: 8.0, hoehe: 1.1, heading: 164,
      utm_east: 299263, utm_north: 5629812, elevation: 239.3
    },
    {
      bauwerksnr: 'A004', bauwerksname: 'Entenpfuhler Weg III', ort: 'Preuswald, Aachen',
      bauwerksart_code: 'RAHMEN_G', bauwerksart_label: 'Brücke als geschlossener Rahmen',
      baujahr: 2007, stuetzweite: 18.0, breite: 7.5, hoehe: 2.2, heading: 90,
      utm_east: 292586, utm_north: 5626370, elevation: 195
    },
    {
      bauwerksnr: 'B110', bauwerksname: 'Rollefbach-Viadukt', ort: 'Brand, Aachen',
      bauwerksart_code: 'GEWOELBE', bauwerksart_label: 'Gewölbe-/Bogenbrücke',
      baujahr: 1884, stuetzweite: 12.0, breite: 6.5, hoehe: 25.0, felder: 6, heading: 340,
      utm_east: 300220, utm_north: 5624785, elevation: 210
    }
  ];

  // ========================================================
  // STATE
  // ========================================================

  var FIRESTORE_COLLECTION = 'sib_models';
  var panelCreated = false;
  var loadedModels = [];
  var currentExample = null;
  var firestoreSynced = false;

  // ========================================================
  // PANEL UI
  // ========================================================

  function createPanel() {
    if (panelCreated) return;
    panelCreated = true;

    var panel = document.createElement('div');
    panel.id = PANEL_ID;

    // Build example dropdown options
    var exampleHtml = '<option value="">– Beispielbauwerk wählen –</option>';
    BEISPIEL_BAUWERKE.forEach(function(b) {
      exampleHtml += '<option value="' + b.bauwerksnr + '">' + b.bauwerksnr + ' – ' + b.bauwerksname + ' (' + b.bauwerksart_label + ')</option>';
    });

    // Build type dropdown options
    var optionsHtml = '<option value="" disabled selected>Bauwerksart wählen...</option>';
    BAUWERKSARTEN.forEach(function(b) {
      optionsHtml += '<option value="' + b.code + '">' + b.label + '</option>';
    });

    panel.innerHTML =
      '<div class="floating-panel-header" id="sibPanelHeader">' +
        '<span class="floating-panel-title">🌉 SIB Brückengenerator</span>' +
        '<div class="floating-panel-controls">' +
          '<button class="floating-panel-btn" onclick="BimSIB.toggleCollapse()" title="Minimize">−</button>' +
          '<button class="floating-panel-btn" onclick="BimSIB.toggle()" title="Close">✕</button>' +
        '</div>' +
      '</div>' +
      '<div id="sibPanelBody" class="floating-panel-body">' +

        // Example selector
        '<div style="margin-bottom:8px;">' +
          '<select id="sibExample" class="modern-select" style="width:100%;" onchange="BimSIB.loadExample(this.value)">' +
            exampleHtml +
          '</select>' +
          '<div style="font-size:9px;color:rgba(255,255,255,0.25);margin-top:3px;line-height:1.3;">' +
            'Beispieldaten aus SIB Aachen (Open Data) – Geometrie aus Fläche abgeleitet, Koordinaten via OSM' +
          '</div>' +
        '</div>' +

        // Bauwerksart
        '<div style="margin-bottom:8px;">' +
          '<label class="sib-label">Bauwerksart *</label>' +
          '<select id="sibBauwerksart" class="modern-select" style="width:100%;">' +
            optionsHtml +
          '</select>' +
        '</div>' +

        // Geometry section
        '<div class="sib-section">Geometrie</div>' +
        sibField('sibStuetzweite', 'Stützweite', 'm', '15') +
        sibField('sibBreite', 'Fahrbahnbreite', 'm', '8') +
        sibField('sibHoehe', 'Konstruktionshöhe', 'm', '1.2') +
        sibField('sibFelder', 'Anzahl Felder', '', '1') +
        sibField('sibHeading', 'Achsrichtung', '°', '0') +

        // Position section
        '<div class="sib-section">Lage (UTM32N)</div>' +
        sibField('sibUtmEast', 'Rechtswert', 'm', '') +
        sibField('sibUtmNorth', 'Hochwert', 'm', '') +
        sibField('sibElevation', 'Geländehöhe', 'm üNN', '0') +

        // Optional
        '<div class="sib-section">Optional</div>' +
        sibField('sibBauwerksnr', 'Bauwerksnr.', '', '') +

        // Generate button
        '<button id="sibGenerateBtn" class="modern-btn modern-btn-primary" style="width:100%;margin-top:10px;" onclick="BimSIB.generate()">' +
          '<span class="modern-btn-icon">🌉</span>' +
          '<span>GLB erzeugen & platzieren</span>' +
        '</button>' +

        // Status
        '<div id="sibStatus" style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:6px;min-height:16px;"></div>' +

        // Loaded models list
        '<div id="sibModelList" style="margin-top:8px;"></div>' +

      '</div>';

    // Styles
    var style = document.createElement('style');
    style.textContent =
      '#' + PANEL_ID + '{' +
        'position:fixed;top:80px;right:12px;z-index:400;' +
        'width:280px;background:rgba(21,25,33,0.92);backdrop-filter:blur(8px);' +
        'border:1px solid rgba(255,255,255,0.08);border-radius:10px;' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
        'display:none;overflow:hidden;' +
      '}' +
      '#' + PANEL_ID + '.visible{display:block;}' +
      '.sib-label{font-size:10px;color:rgba(255,255,255,0.4);display:block;margin-bottom:2px;}' +
      '.sib-section{font-size:10px;font-weight:600;color:rgba(46,207,176,0.7);text-transform:uppercase;' +
        'letter-spacing:0.05em;margin:10px 0 4px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.06);}' +
      '.sib-row{display:flex;align-items:center;gap:6px;margin:4px 0;}' +
      '.sib-row label{font-size:10px;color:rgba(255,255,255,0.4);min-width:90px;flex-shrink:0;}' +
      '.sib-row input{flex:1;padding:4px 6px;background:rgba(255,255,255,0.05);' +
        'border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:#fff;font-size:12px;' +
        'font-family:monospace;min-width:0;}' +
      '.sib-row input:focus{outline:none;border-color:rgba(46,207,176,0.4);}' +
      '.sib-row .sib-unit{font-size:9px;color:rgba(255,255,255,0.25);min-width:28px;text-align:right;}' +
      '.sib-model-card{padding:6px 8px;margin:4px 0;background:rgba(255,255,255,0.03);' +
        'border:1px solid rgba(255,255,255,0.06);border-radius:6px;font-size:10px;' +
        'display:flex;align-items:center;justify-content:space-between;}' +
      '.sib-model-card .sib-card-name{color:rgba(255,255,255,0.7);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      '.sib-model-card button{background:none;border:none;color:rgba(255,255,255,0.3);cursor:pointer;font-size:12px;padding:0 4px;}' +
      '.sib-model-card button:hover{color:#ff6b6b;}' +
      '#sibStatus.loading{color:rgba(46,207,176,0.7);}' +
      '#sibStatus.error{color:#ff6b6b;}' +
      '#sibStatus.success{color:rgba(46,207,176,0.9);}' +
      '#sibPanelBody.collapsed{display:none;}';

    document.head.appendChild(style);
    document.body.appendChild(panel);

    // Make draggable
    if (BimViewer && typeof BimViewer.makeFloatingPanelDraggable === 'function') {
      BimViewer.makeFloatingPanelDraggable(panel, document.getElementById('sibPanelHeader'));
    }
  }

  function sibField(id, label, unit, defaultVal) {
    return '<div class="sib-row">' +
      '<label>' + label + '</label>' +
      '<input type="text" id="' + id + '" value="' + (defaultVal || '') + '" placeholder="' + (defaultVal || '') + '">' +
      '<span class="sib-unit">' + unit + '</span>' +
    '</div>';
  }

  // ========================================================
  // EXAMPLE LOADER
  // ========================================================

  function loadExample(bauwerksnr) {
    if (!bauwerksnr) return;
    var b = BEISPIEL_BAUWERKE.find(function(x) { return x.bauwerksnr === bauwerksnr; });
    if (!b) return;

    document.getElementById('sibBauwerksart').value = b.bauwerksart_code;
    document.getElementById('sibStuetzweite').value = b.stuetzweite;
    document.getElementById('sibBreite').value = b.breite;
    document.getElementById('sibHoehe').value = b.hoehe;
    document.getElementById('sibFelder').value = b.felder || 1;
    document.getElementById('sibHeading').value = b.heading;
    document.getElementById('sibElevation').value = b.elevation;
    document.getElementById('sibBauwerksnr').value = b.bauwerksnr;

    // Use Firestore lon/lat if available (synced position), otherwise UTM
    if (b.firestoreId && b.lon != null) {
      // Store lon/lat directly — generate will use them
      document.getElementById('sibUtmEast').value = b.utm_east || '';
      document.getElementById('sibUtmNorth').value = b.utm_north || '';
      b._useDirectCoords = true;
    } else {
      document.getElementById('sibUtmEast').value = b.utm_east;
      document.getElementById('sibUtmNorth').value = b.utm_north;
      b._useDirectCoords = false;
    }

    currentExample = b;
    setStatus(b.bauwerksname + ' (' + b.ort + ', ' + b.baujahr + ')', '');
  }

  // ========================================================
  // PANEL VISIBILITY
  // ========================================================

  function showPanel() {
    createPanel();
    document.getElementById(PANEL_ID).classList.add('visible');
  }

  function hidePanel() {
    var p = document.getElementById(PANEL_ID);
    if (p) p.classList.remove('visible');
  }

  function togglePanel() {
    createPanel();
    var p = document.getElementById(PANEL_ID);
    p.classList.toggle('visible');
  }

  function toggleCollapse() {
    var body = document.getElementById('sibPanelBody');
    var btn = document.querySelector('#' + PANEL_ID + ' .floating-panel-btn');
    if (!body) return;
    body.classList.toggle('collapsed');
    if (btn) btn.textContent = body.classList.contains('collapsed') ? '+' : '−';
  }

  // ========================================================
  // STATUS
  // ========================================================

  function setStatus(msg, type) {
    var el = document.getElementById('sibStatus');
    if (!el) return;
    el.textContent = msg;
    el.className = type || '';
  }

  // ========================================================
  // GENERATE & PLACE
  // ========================================================

  async function generate() {
    // Wait for Firestore sync if not done yet
    if (!firestoreSynced) {
      setStatus('Warte auf Sync...', 'loading');
      for (var wait = 0; wait < 10 && !firestoreSynced; wait++) {
        await new Promise(function(r) { setTimeout(r, 500); });
      }
    }

    var bauwerksart = document.getElementById('sibBauwerksart').value;
    if (!bauwerksart) {
      setStatus('Bauwerksart wählen', 'error');
      return;
    }

    var utmEast = parseFloat(document.getElementById('sibUtmEast').value);
    var utmNorth = parseFloat(document.getElementById('sibUtmNorth').value);
    if (isNaN(utmEast) || isNaN(utmNorth)) {
      setStatus('Rechtswert und Hochwert eingeben', 'error');
      return;
    }

    var payload = {
      bauwerksart_code: bauwerksart,
      stuetzweite: parseFloat(document.getElementById('sibStuetzweite').value) || 15,
      breite: parseFloat(document.getElementById('sibBreite').value) || 8,
      hoehe: parseFloat(document.getElementById('sibHoehe').value) || 1.2,
      felder: parseInt(document.getElementById('sibFelder').value) || 1,
      heading: parseFloat(document.getElementById('sibHeading').value) || 0,
      utm_east: utmEast,
      utm_north: utmNorth,
      elevation: parseFloat(document.getElementById('sibElevation').value) || 0,
      bauwerksnr: document.getElementById('sibBauwerksnr').value || ''
    };

    // Find label + enrich with example metadata
    var artDef = BAUWERKSARTEN.find(function(b) { return b.code === bauwerksart; });
    payload.bauwerksart_label = artDef ? artDef.label : bauwerksart;
    if (currentExample) {
      payload.bauwerksname = currentExample.bauwerksname || '';
      payload.ort = currentExample.ort || '';
      payload.baujahr = currentExample.baujahr || null;
    }

    // Remove existing model with same bauwerksnr (replace, not duplicate)
    if (payload.bauwerksnr) {
      var existing = loadedModels.find(function(e) {
        return e.meta && e.meta.bauwerksnr === payload.bauwerksnr;
      });
      if (existing) {
        removeModel(existing.id);
      }
    }

    setStatus('Generiere Modell...', 'loading');
    var btn = document.getElementById('sibGenerateBtn');
    if (btn) btn.disabled = true;

    try {
      // Send heading=0 to API — rotation is applied in Cesium only, not baked into GLB mesh.
      // This prevents double-rotation when Firestore heading differs from original.
      var apiPayload = Object.assign({}, payload, { heading: 0 });
      var resp = await fetch('/api/sib/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiPayload)
      });

      if (!resp.ok) {
        var errData = await resp.json().catch(function() { return {}; });
        throw new Error(errData.error || 'Server error ' + resp.status);
      }

      var data = await resp.json();
      setStatus('Platziere Modell...', 'loading');

      // Check Firestore directly for saved position (editor-corrected)
      if (payload.bauwerksnr) {
        try {
          var db = getDb();
          if (db) {
            var snapshot = await db.collection(FIRESTORE_COLLECTION)
              .where('bauwerksnr', '==', payload.bauwerksnr)
              .limit(1)
              .get();
            if (!snapshot.empty) {
              var fsDoc = snapshot.docs[0];
              var fsData = fsDoc.data();
              console.log('🌉 Using Firestore position for', payload.bauwerksnr, '→', fsData.lat.toFixed(5) + '°N,', fsData.lon.toFixed(5) + '°E, h=' + fsData.elevation);
              data.lon = fsData.lon;
              data.lat = fsData.lat;
              data.elevation = fsData.elevation;
              payload.heading = fsData.heading;
              payload.firestoreId = fsDoc.id;
            }
          }
        } catch (e) {
          console.warn('🌉 Firestore position lookup failed:', e);
        }
      }

      // Place in Cesium
      await placeModel(data, payload);

      setStatus('✅ ' + payload.bauwerksart_label + ' platziert', 'success');
    } catch (err) {
      console.error('SIB generation failed:', err);
      setStatus('Fehler: ' + err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ========================================================
  // CESIUM PLACEMENT
  // ========================================================

  async function placeModel(data, payload) {
    var viewer = BimViewer.viewer;
    if (!viewer) throw new Error('Viewer nicht bereit');

    var lon = data.lon;
    var lat = data.lat;
    var heading = payload.heading || 0;
    var stuetzweite = payload.stuetzweite || 15;
    var breite = payload.breite || 8;

    // Use Firestore elevation if available (editor-corrected), otherwise sample terrain
    var placementHeight = 0;
    if (payload.firestoreId && data.elevation != null && data.elevation > 0) {
      // Firestore has editor-corrected ellipsoidal height — use directly
      placementHeight = data.elevation;
      console.log('🌉 Using Firestore elevation:', placementHeight.toFixed(1), 'm (editor-corrected)');
    } else {
      // No Firestore position — sample terrain
      try {
        var carto = [Cesium.Cartographic.fromDegrees(lon, lat)];
        var tp = viewer.scene.terrainProvider;
        if (tp && tp.ready !== false) {
          var sampled = await Cesium.sampleTerrainMostDetailed(tp, carto);
          if (sampled[0] && isFinite(sampled[0].height)) {
            placementHeight = sampled[0].height;
          }
        }
      } catch (_) {}
      console.log('🌉 Terrain height at position:', placementHeight.toFixed(1), 'm (sampled)');
    }

    var position = Cesium.Cartesian3.fromDegrees(lon, lat, placementHeight);
    var hpr = new Cesium.HeadingPitchRoll(
      Cesium.Math.toRadians(heading), 0, 0
    );
    var modelMatrix = Cesium.Transforms.headingPitchRollToFixedFrame(position, hpr);

    var model = await Cesium.Model.fromGltfAsync({
      url: data.glbUrl,
      modelMatrix: modelMatrix,
      scale: 1.0,
      silhouetteColor: Cesium.Color.fromCssColorString('rgba(40,40,40,0.6)'),
      silhouetteSize: 1.0
    });

    viewer.scene.primitives.add(model);

    // Add label above the bridge — same info as list control
    var labelLine1 = (payload.bauwerksnr || 'SIB') + ' — ' + (payload.bauwerksart_label || payload.bauwerksart_code);
    var labelLine2 = payload.bauwerksname || '';
    if (payload.ort) labelLine2 += (labelLine2 ? ', ' : '') + payload.ort;
    var labelLine3 = stuetzweite.toFixed(1) + '×' + breite.toFixed(1) + 'm';
    if (payload.baujahr) labelLine3 += '  Bj. ' + payload.baujahr;
    var labelText = labelLine1 + '\n' + labelLine2 + '\n' + labelLine3;

    var labelHeight = placementHeight + (payload.hoehe || 1.2) + 5;
    var labelEntity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, labelHeight),
      label: {
        text: labelText,
        font: 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: new Cesium.Color(0.06, 0.07, 0.09, 0.85),
        outlineWidth: 4,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        pixelOffset: new Cesium.Cartesian2(0, -12),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(15, 1.2, 400, 0.35),
        showBackground: true,
        backgroundColor: new Cesium.Color(0.08, 0.09, 0.13, 0.82),
        backgroundPadding: new Cesium.Cartesian2(10, 7)
      }
    });

    // Register in BimViewer.loadedAssets (same pattern as GLB models in core.js)
    var assetId = 'sib_' + Date.now();
    var assetName = '🌉 ' + (payload.bauwerksart_label || payload.bauwerksart_code);
    if (payload.bauwerksnr) assetName += ' — ' + payload.bauwerksnr;

    var assetData = {
      id: assetId,
      name: assetName,
      model: model,
      tileset: null,
      visible: true,
      opacity: 1.0,
      type: 'GLB',
      isGLB: true,
      isSIB: true,
      animated: false,
      position: { lon: lon, lat: lat, height: placementHeight },
      heading: heading,
      scale: 1.0,
      labelEntity: labelEntity
    };

    BimViewer.loadedAssets.set(assetId, assetData);

    // Create asset controls in Loaded Assets panel
    if (window.BimViewerUI && typeof BimViewerUI.createAssetControls === 'function') {
      BimViewerUI.createAssetControls(assetId);
    }

    // Store in local list too
    var entry = {
      id: assetId,
      model: model,
      labelEntity: labelEntity,
      lon: lon,
      lat: lat,
      elevation: placementHeight,
      heading: heading,
      glbUrl: data.glbUrl,
      firestoreId: payload.firestoreId || null,
      meta: payload
    };
    loadedModels.push(entry);

    // Save to Firestore (update if firestoreId exists, create if new)
    saveToFirestore(entry);

    // Fly to — offset camera to the side for a good overview angle
    var diagonal = Math.sqrt(stuetzweite * stuetzweite + breite * breite);
    var camDist = Math.max(20, diagonal * 1.2);
    var camOffsetAngle = heading + 30; // slightly off-axis for perspective
    var camOffsetRad = Cesium.Math.toRadians(camOffsetAngle);
    var camLon = lon + Math.sin(camOffsetRad) * camDist * 0.000009;
    var camLat = lat + Math.cos(camOffsetRad) * camDist * 0.000009;

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(camLon, camLat, placementHeight + camDist * 0.6),
      orientation: {
        heading: Cesium.Math.toRadians(camOffsetAngle + 180),
        pitch: Cesium.Math.toRadians(-30),
        roll: 0
      },
      duration: 2.0
    });

    renderModelList();
    console.log('🌉 SIB model placed:', assetName, 'at', lat.toFixed(5), lon.toFixed(5), 'h=' + placementHeight.toFixed(1));
  }

  // ========================================================
  // POSITION CHANGED (called by glb-gizmo on drag end)
  // ========================================================

  function onPositionChanged(assetId, assetData) {
    var entry = loadedModels.find(function(e) { return e.id === assetId; });
    if (!entry) return;

    // Update local state
    entry.lon = assetData.position.lon;
    entry.lat = assetData.position.lat;
    entry.elevation = assetData.position.height;
    entry.heading = assetData.heading || 0;

    // Update label position
    if (entry.labelEntity) {
      var labelHeight = assetData.position.height + (entry.meta.hoehe || 1.2) + 5;
      entry.labelEntity.position = Cesium.Cartesian3.fromDegrees(
        assetData.position.lon, assetData.position.lat, labelHeight
      );
    }

    // Convert WGS84 back to UTM32N for display
    // Use pyproj on server would be cleaner, but for UI feedback we approximate:
    // or just show WGS84 in the panel
    var el = document.getElementById('sibUtmEast');
    if (el) el.value = assetData.position.lon.toFixed(6);
    var el2 = document.getElementById('sibUtmNorth');
    if (el2) el2.value = assetData.position.lat.toFixed(6);
    var el3 = document.getElementById('sibElevation');
    if (el3) el3.value = assetData.position.height.toFixed(1);
    var el4 = document.getElementById('sibHeading');
    if (el4) el4.value = (assetData.heading || 0).toFixed(1);

    // Persist updated position to Firestore
    saveToFirestore(entry);

    setStatus('Position aktualisiert: ' + assetData.position.lat.toFixed(5) + '°N, ' + assetData.position.lon.toFixed(5) + '°E', 'success');
    console.log('🌉 SIB position updated:', assetId, assetData.position.lon.toFixed(5), assetData.position.lat.toFixed(5), 'h=' + assetData.position.height.toFixed(1));
  }

  // ========================================================
  // MODEL LIST
  // ========================================================

  function renderModelList() {
    var list = document.getElementById('sibModelList');
    if (!list) return;

    if (loadedModels.length === 0) {
      list.innerHTML = '';
      return;
    }

    var html = '<div class="sib-section">Geladene Bauwerke (' + loadedModels.length + ')</div>';
    loadedModels.forEach(function(entry) {
      var label = entry.meta.bauwerksart_label || entry.meta.bauwerksart_code;
      var nr = entry.meta.bauwerksnr ? ' — ' + entry.meta.bauwerksnr : '';
      html += '<div class="sib-model-card">' +
        '<span class="sib-card-name">🌉 ' + label + nr + '</span>' +
        '<button onclick="BimSIB.flyTo(\'' + entry.id + '\')" title="Zoom to">📍</button>' +
        '<button onclick="BimSIB.remove(\'' + entry.id + '\')" title="Remove">✕</button>' +
      '</div>';
    });
    list.innerHTML = html;
  }

  function flyToModel(id) {
    var entry = loadedModels.find(function(e) { return e.id === id; });
    if (!entry || !BimViewer.viewer) return;
    var camDist = Math.max(30, (entry.meta.stuetzweite || 15) * 2.5);
    BimViewer.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(entry.lon, entry.lat, entry.elevation + camDist),
      orientation: {
        heading: Cesium.Math.toRadians(entry.heading),
        pitch: Cesium.Math.toRadians(-40),
        roll: 0
      },
      duration: 1.5
    });
  }

  function removeModel(id) {
    var idx = loadedModels.findIndex(function(e) { return e.id === id; });
    if (idx === -1) return;
    var entry = loadedModels[idx];
    if (entry.model && BimViewer.viewer) {
      BimViewer.viewer.scene.primitives.remove(entry.model);
    }
    // Remove label entity
    if (entry.labelEntity && BimViewer.viewer) {
      BimViewer.viewer.entities.remove(entry.labelEntity);
    }
    // Also remove from BimViewer.loadedAssets
    BimViewer.loadedAssets.delete(id);
    var assetEl = document.getElementById('asset_' + id);
    if (assetEl) assetEl.remove();

    // Delete from Firestore
    if (entry.firestoreId) {
      deleteFromFirestore(entry.firestoreId);
    }

    loadedModels.splice(idx, 1);
    renderModelList();
    setStatus('Bauwerk entfernt', '');
  }

  // ========================================================
  // FIRESTORE PERSISTENCE
  // ========================================================

  function getDb() {
    if (typeof BimAuth !== 'undefined' && BimAuth.getFirebaseDb) {
      return BimAuth.getFirebaseDb();
    }
    return null;
  }

  function saveToFirestore(entry) {
    var db = getDb();
    if (!db) return;

    var doc = {
      bauwerksnr: entry.meta.bauwerksnr || '',
      bauwerksart_code: entry.meta.bauwerksart_code,
      bauwerksart_label: entry.meta.bauwerksart_label || '',
      bauwerksname: entry.meta.bauwerksname || '',
      ort: entry.meta.ort || '',
      baujahr: entry.meta.baujahr || null,
      stuetzweite: entry.meta.stuetzweite,
      breite: entry.meta.breite,
      hoehe: entry.meta.hoehe,
      felder: entry.meta.felder || 1,
      heading: entry.heading,
      lon: entry.lon,
      lat: entry.lat,
      elevation: entry.elevation,
      glbUrl: entry.glbUrl,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (entry.firestoreId) {
      // Update existing
      db.collection(FIRESTORE_COLLECTION).doc(entry.firestoreId).update({
        heading: doc.heading,
        lon: doc.lon,
        lat: doc.lat,
        elevation: doc.elevation
      }).then(function() {
        console.log('🌉 Firestore updated:', entry.firestoreId);
      }).catch(function(e) {
        console.warn('Firestore update failed:', e);
      });
    } else {
      // Create new
      db.collection(FIRESTORE_COLLECTION).add(doc).then(function(ref) {
        entry.firestoreId = ref.id;
        console.log('🌉 Saved to Firestore:', ref.id);
      }).catch(function(e) {
        console.warn('Firestore save failed:', e);
      });
    }
  }

  function deleteFromFirestore(firestoreId) {
    var db = getDb();
    if (!db || !firestoreId) return;
    db.collection(FIRESTORE_COLLECTION).doc(firestoreId).delete().then(function() {
      console.log('🌉 Deleted from Firestore:', firestoreId);
    }).catch(function(e) {
      console.warn('Firestore delete failed:', e);
    });
  }

  function syncExamplesFromFirestore() {
    var db = getDb();
    if (!db) {
      setTimeout(syncExamplesFromFirestore, 2000);
      return;
    }

    db.collection(FIRESTORE_COLLECTION).get().then(function(snapshot) {
      if (snapshot.empty) return;
      console.log('🌉 Syncing ' + snapshot.size + ' SIB position(s) from Firestore');

      snapshot.forEach(function(doc) {
        var d = doc.data();
        // Update existing example with Firestore position
        var existing = BEISPIEL_BAUWERKE.find(function(b) {
          return b.bauwerksnr === d.bauwerksnr;
        });
        if (existing) {
          existing.lon = d.lon;
          existing.lat = d.lat;
          existing.elevation = d.elevation;
          existing.heading = d.heading;
          existing.firestoreId = doc.id;
          existing.glbUrl = d.glbUrl;
          // Also update numeric params if they were changed
          if (d.stuetzweite) existing.stuetzweite = d.stuetzweite;
          if (d.breite) existing.breite = d.breite;
          if (d.hoehe) existing.hoehe = d.hoehe;
          if (d.felder) existing.felder = d.felder;
          console.log('🌉 Updated position for', d.bauwerksnr, '→', d.lat.toFixed(5), d.lon.toFixed(5));
        } else {
          // New building from Firestore — add to examples
          BEISPIEL_BAUWERKE.push({
            bauwerksnr: d.bauwerksnr || doc.id,
            bauwerksname: d.bauwerksname || '',
            ort: d.ort || '',
            bauwerksart_code: d.bauwerksart_code,
            bauwerksart_label: d.bauwerksart_label || '',
            baujahr: d.baujahr || null,
            stuetzweite: d.stuetzweite,
            breite: d.breite,
            hoehe: d.hoehe,
            felder: d.felder || 1,
            heading: d.heading,
            utm_east: 0, utm_north: 0, // not needed, we have lon/lat
            lon: d.lon, lat: d.lat,
            elevation: d.elevation,
            firestoreId: doc.id,
            glbUrl: d.glbUrl
          });
          console.log('🌉 Added from Firestore:', d.bauwerksnr || doc.id);
        }
      });

      firestoreSynced = true;
      // Rebuild dropdown if panel is already created
      rebuildExampleDropdown();
    }).catch(function(e) {
      console.warn('Firestore sync failed:', e);
      firestoreSynced = true; // proceed even if sync fails
    });
  }

  function rebuildExampleDropdown() {
    var select = document.getElementById('sibExample');
    if (!select) return;
    var html = '<option value="">– Beispielbauwerk wählen –</option>';
    BEISPIEL_BAUWERKE.forEach(function(b) {
      var synced = b.firestoreId ? ' ✓' : '';
      html += '<option value="' + b.bauwerksnr + '">' + b.bauwerksnr + ' – ' + b.bauwerksname + ' (' + b.bauwerksart_label + ')' + synced + '</option>';
    });
    select.innerHTML = html;
  }

  async function restoreModel(firestoreId, d) {
    var viewer = BimViewer.viewer;
    if (!viewer) return;

    try {
      var position = Cesium.Cartesian3.fromDegrees(d.lon, d.lat, d.elevation || 0);
      var hpr = new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(d.heading || 0), 0, 0);
      var modelMatrix = Cesium.Transforms.headingPitchRollToFixedFrame(position, hpr);

      var model = await Cesium.Model.fromGltfAsync({
        url: d.glbUrl,
        modelMatrix: modelMatrix,
        scale: 1.0,
        silhouetteColor: Cesium.Color.fromCssColorString('rgba(40,40,40,0.6)'),
        silhouetteSize: 1.0
      });

      viewer.scene.primitives.add(model);

      // Label
      var labelLine1 = (d.bauwerksnr || 'SIB') + ' — ' + (d.bauwerksart_label || d.bauwerksart_code);
      var labelLine2 = d.bauwerksname || '';
      if (d.ort) labelLine2 += (labelLine2 ? ', ' : '') + d.ort;
      var labelLine3 = (d.stuetzweite || 0).toFixed(1) + '×' + (d.breite || 0).toFixed(1) + 'm';
      if (d.baujahr) labelLine3 += '  Bj. ' + d.baujahr;

      var labelHeight = (d.elevation || 0) + (d.hoehe || 1.2) + 5;
      var labelEntity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(d.lon, d.lat, labelHeight),
        label: {
          text: labelLine1 + '\n' + labelLine2 + '\n' + labelLine3,
          font: 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: new Cesium.Color(0.06, 0.07, 0.09, 0.85),
          outlineWidth: 4,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          pixelOffset: new Cesium.Cartesian2(0, -12),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(15, 1.2, 400, 0.35),
          showBackground: true,
          backgroundColor: new Cesium.Color(0.08, 0.09, 0.13, 0.82),
          backgroundPadding: new Cesium.Cartesian2(10, 7)
        }
      });

      // Register
      var assetId = 'sib_' + firestoreId;
      var assetName = '🌉 ' + (d.bauwerksart_label || d.bauwerksart_code);
      if (d.bauwerksnr) assetName += ' — ' + d.bauwerksnr;

      BimViewer.loadedAssets.set(assetId, {
        id: assetId, name: assetName, model: model, tileset: null,
        visible: true, opacity: 1.0, type: 'GLB', isGLB: true, isSIB: true,
        animated: false, position: { lon: d.lon, lat: d.lat, height: d.elevation || 0 },
        heading: d.heading || 0, scale: 1.0, labelEntity: labelEntity
      });

      if (window.BimViewerUI && typeof BimViewerUI.createAssetControls === 'function') {
        BimViewerUI.createAssetControls(assetId);
      }

      loadedModels.push({
        id: assetId, firestoreId: firestoreId, model: model, labelEntity: labelEntity,
        lon: d.lon, lat: d.lat, elevation: d.elevation || 0, heading: d.heading || 0,
        glbUrl: d.glbUrl, meta: d
      });

      renderModelList();
      console.log('🌉 Restored:', assetName);
    } catch (e) {
      console.warn('🌉 Restore failed for', firestoreId, e);
    }
  }

  // ========================================================
  // KEYBOARD SHORTCUT
  // ========================================================

  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key.toLowerCase() === 'b') {
      e.preventDefault();
      togglePanel();
    }
  });

  // ========================================================
  // PUBLIC API
  // ========================================================

  window.BimSIB = {
    toggle: togglePanel,
    show: showPanel,
    hide: hidePanel,
    toggleCollapse: toggleCollapse,
    generate: generate,
    loadExample: loadExample,
    flyTo: flyToModel,
    remove: removeModel,
    onPositionChanged: onPositionChanged,
    models: loadedModels
  };

  // Load saved positions from Firestore into example dropdown (no auto-placement)
  function initFirestoreSync() {
    if (!BimViewer || !BimViewer.viewer) { setTimeout(initFirestoreSync, 1000); return; }
    setTimeout(syncExamplesFromFirestore, 2000);
  }
  initFirestoreSync();

  console.log('🌉 SIB Brückengenerator ready (press B to open)');

})();
