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
// MEASUREMENT STORE MODULE v1.0
// Persist measurements in Firebase Firestore
// ===============================
'use strict';

(function() {

  const FIRESTORE_COLLECTION = 'demo_measurements';

  // Colors per measurement type (matching measurement.js)
  const TYPE_COLORS = {
    distance:    Cesium.Color.YELLOW,
    area:        Cesium.Color.CYAN,
    height:      Cesium.Color.MAGENTA,
    vertical:    Cesium.Color.DEEPSKYBLUE,
    coordinates: Cesium.Color.ORANGE
  };

  const TYPE_ICONS = {
    distance:    '📏',
    area:        '⬛',
    height:      '⛰️',
    vertical:    '↕️',
    coordinates: '🌍'
  };

  const TYPE_LABELS = {
    distance:    'Distance',
    area:        'Area',
    height:      'Height/Terrain',
    vertical:    'Vertical',
    coordinates: 'Coordinates'
  };

  // =====================================
  // STATE
  // =====================================

  BimViewer.measurementStore = {
    db: null,
    collection: null,
    initialized: false,
    measurements: [],
    entities: {} // { docId: [entity, entity, ...] }
  };

  // =====================================
  // HELPERS
  // =====================================

  function cartesianToStorable(cartesian) {
    const carto = Cesium.Cartographic.fromCartesian(cartesian);
    return {
      lon: Cesium.Math.toDegrees(carto.longitude),
      lat: Cesium.Math.toDegrees(carto.latitude),
      height: carto.height
    };
  }

  function storableToCartesian(pos) {
    return Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.height);
  }

  // =====================================
  // INIT
  // =====================================

  BimViewer.initMeasurementStore = function() {
    if (this.measurementStore.initialized) return;

    try {
      const db = BimAuth.getFirebaseDb();
      if (!db) {
        console.warn('⚠️ MeasurementStore: Firebase not available, retrying in 2s...');
        setTimeout(() => this.initMeasurementStore(), 2000);
        return;
      }

      this.measurementStore.db = db;
      this.measurementStore.collection = db.collection(FIRESTORE_COLLECTION);
      this.measurementStore.initialized = true;

      // Inject saved list container into measurement panel
      this.injectSavedMeasurementsUI();

      // Load saved measurements
      this.loadSavedMeasurements();

      // Install hooks on completion methods
      this.installMeasurementStoreHooks();

      console.log('💾 Measurement Store initialized (Collection: ' + FIRESTORE_COLLECTION + ')');

    } catch (error) {
      console.error('❌ MeasurementStore init failed:', error);
    }
  };

  // =====================================
  // HOOKS — monkey-patch completion methods
  // =====================================

  BimViewer.installMeasurementStoreHooks = function() {

    // --- Distance ---
    const origDistance = this.completeDistanceMeasurement;
    this.completeDistanceMeasurement = function() {
      const positions = this.measurement.positions.map(cartesianToStorable);
      origDistance.call(this);
      if (positions.length >= 2) {
        const p0 = positions[0], p1 = positions[1];
        const c0 = storableToCartesian(p0), c1 = storableToCartesian(p1);
        const total = Cesium.Cartesian3.distance(c0, c1);
        const vDist = Math.abs(p1.height - p0.height);
        const hDist = Math.sqrt(total * total - vDist * vDist);
        this.measurementStore.pending = {
          type: 'distance',
          positions: positions,
          results: { total: total, horizontal: hDist, vertical: vDist },
          label: this.formatDistance(total)
        };
        injectSaveButton();
      }
    };

    // --- Area ---
    const origArea = this.completeAreaMeasurement;
    this.completeAreaMeasurement = function() {
      const positions = this.measurement.positions.map(cartesianToStorable);
      const cartesians = this.measurement.positions.slice();
      origArea.call(this);
      if (positions.length >= 3) {
        const area = this.calculateArea(cartesians);
        this.measurementStore.pending = {
          type: 'area',
          positions: positions,
          results: { area: area },
          label: this.formatArea(area)
        };
        injectSaveButton();
      }
    };

    // --- Vertical ---
    const origVertical = this.completeVerticalMeasurement;
    this.completeVerticalMeasurement = function() {
      const positions = this.measurement.positions.map(cartesianToStorable);
      origVertical.call(this);
      if (positions.length >= 2) {
        const h1 = positions[0].height, h2 = positions[1].height;
        this.measurementStore.pending = {
          type: 'vertical',
          positions: positions,
          results: { height1: h1, height2: h2, verticalDiff: h2 - h1 },
          label: this.formatDistance(Math.abs(h2 - h1))
        };
        injectSaveButton();
      }
    };

    // --- Height over terrain (inline handler — wrap startHeightOverTerrain) ---
    const origStartHeight = this.startHeightOverTerrain;
    this.startHeightOverTerrain = function() {
      origStartHeight.call(this);
      // Replace the LEFT_CLICK handler to also capture results
      const handler = this.measurement.handler;
      if (!handler) return;
      const self = this;
      handler.setInputAction(async (click) => {
        const cartesian = self.viewer.scene.pickPosition(click.position);
        if (!cartesian) return;

        const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
        const clickedHeight = cartographic.height;

        try {
          const terrainProvider = self.viewer.terrainProvider;
          const positions = [cartographic];
          const updated = await Cesium.sampleTerrainMostDetailed(terrainProvider, positions);
          const terrainHeight = updated[0].height || 0;
          const hot = clickedHeight - terrainHeight;

          self.addPointMarker(cartesian, Cesium.Color.MAGENTA);
          const terrainCartesian = Cesium.Cartesian3.fromRadians(
            cartographic.longitude, cartographic.latitude, terrainHeight
          );
          self.addMeasurementLine([cartesian, terrainCartesian], Cesium.Color.MAGENTA);
          self.addMeasurementLabel(cartesian, hot.toFixed(2) + ' m above terrain');

          const resultHtml = '<div style="text-align: left; font-size: 12px; line-height: 1.6;">' +
            '<div style="color: #f093fb; font-size: 16px; font-weight: 600; margin-bottom: 6px;">' +
            '⛰️ ' + hot.toFixed(2) + ' m above terrain</div>' +
            '<div style="color: rgba(255,255,255,0.7);">' +
            '📍 Point height: ' + clickedHeight.toFixed(2) + ' m<br>' +
            '🏔️ Terrain height: ' + terrainHeight.toFixed(2) + ' m</div></div>';
          self.updateMeasurementResult(resultHtml);
          self.updateStatus('Height over terrain: ' + hot.toFixed(2) + ' m', 'success');

          // Capture for save
          self.measurementStore.pending = {
            type: 'height',
            positions: [cartesianToStorable(cartesian)],
            results: { clickHeight: clickedHeight, terrainHeight: terrainHeight, heightOverTerrain: hot },
            label: hot.toFixed(2) + ' m above terrain'
          };
          injectSaveButton();

        } catch (error) {
          self.updateMeasurementResult('<span style="color: #f5576c;">Could not sample terrain</span>');
        }
        self.cleanupMeasurementHandlers();
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    };

    // --- Coordinate pick (inline handler — wrap startCoordinatePick) ---
    const origStartCoord = this.startCoordinatePick;
    this.startCoordinatePick = function() {
      origStartCoord.call(this);
      const handler = this.measurement.handler;
      if (!handler) return;
      const self = this;
      handler.setInputAction(async (click) => {
        const cartesian = self.viewer.scene.pickPosition(click.position);
        if (!cartesian) return;

        const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
        const lon = Cesium.Math.toDegrees(cartographic.longitude);
        const lat = Cesium.Math.toDegrees(cartographic.latitude);
        const height = cartographic.height;

        let terrainHeight = 0;
        try {
          const terrainProvider = self.viewer.terrainProvider;
          const positions = [Cesium.Cartographic.clone(cartographic)];
          const updated = await Cesium.sampleTerrainMostDetailed(terrainProvider, positions);
          terrainHeight = updated[0].height || 0;
        } catch (e) {}

        self.addPointMarker(cartesian, Cesium.Color.ORANGE);

        var geoidInfo = (typeof GEOBIM_GEOID !== 'undefined') ? GEOBIM_GEOID.toOrthometric(height, lat, lon) : null;
        var undulationHtml = '';
        if (geoidInfo) {
          undulationHtml =
            '<div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.1);">' +
            '📐 Geoid undulation (N): <strong>' + geoidInfo.undulation.toFixed(2) + ' m</strong><br>' +
            '🏛️ Height above sea level: <strong>' + geoidInfo.orthometric.toFixed(2) + ' m</strong></div>';
        }

        const resultHtml =
          '<div style="text-align: left; font-size: 11px; line-height: 1.7;">' +
          '<div style="color: #fa709a; font-size: 14px; font-weight: 600; margin-bottom: 8px;">🌍 Global Coordinates</div>' +
          '<div style="color: rgba(255,255,255,0.9); font-family: monospace; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 4px;">' +
          '<div>Lat: <strong>' + lat.toFixed(7) + '°</strong></div>' +
          '<div>Lon: <strong>' + lon.toFixed(7) + '°</strong></div>' +
          '<div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.1);">' +
          '🌊 Height (WGS84): <strong>' + height.toFixed(2) + ' m</strong><br>' +
          '🏔️ Terrain height: <strong>' + terrainHeight.toFixed(2) + ' m</strong><br>' +
          '⛰️ Above terrain: <strong>' + (height - terrainHeight).toFixed(2) + ' m</strong></div>' +
          undulationHtml + '</div>' +
          '<button onclick="navigator.clipboard.writeText(\'' + lat.toFixed(7) + ', ' + lon.toFixed(7) + '\')" style="' +
          'margin-top: 8px; padding: 6px 12px; width: 100%;' +
          'background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);' +
          'border-radius: 4px; color: white; font-size: 11px; cursor: pointer;">📋 Copy Lat/Lon</button></div>';

        self.updateMeasurementResult(resultHtml);
        self.updateStatus('Coordinates captured', 'success');

        // Capture for save
        var results = { lon: lon, lat: lat, height: height, terrainHeight: terrainHeight };
        if (geoidInfo) {
          results.undulation = geoidInfo.undulation;
          results.orthometric = geoidInfo.orthometric;
        }
        self.measurementStore.pending = {
          type: 'coordinates',
          positions: [{ lon: lon, lat: lat, height: height }],
          results: results,
          label: lat.toFixed(5) + '°, ' + lon.toFixed(5) + '°'
        };
        injectSaveButton();

        self.cleanupMeasurementHandlers();
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    };

    console.log('💾 Measurement store hooks installed');
  };

  // =====================================
  // SAVE BUTTON INJECTION
  // =====================================

  function injectSaveButton() {
    const resultDiv = document.getElementById('measurementResult');
    if (!resultDiv) return;

    // Don't add duplicate
    if (resultDiv.querySelector('.ms-save-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'ms-save-btn';
    btn.innerHTML = '💾 Save Measurement';
    btn.style.cssText =
      'display: block; width: 100%; margin-top: 10px; padding: 8px 12px;' +
      'background: linear-gradient(135deg, #6EECD8 0%, #3DB8A0 100%);' +
      'border: none; border-radius: 6px; color: #0E1117; font-size: 12px;' +
      'font-weight: 600; cursor: pointer; transition: transform 0.15s;';
    btn.onmouseenter = function() { this.style.transform = 'translateY(-1px)'; };
    btn.onmouseleave = function() { this.style.transform = ''; };
    btn.addEventListener('click', function() {
      BimViewer.savePendingMeasurement();
    });

    resultDiv.appendChild(btn);
  }

  // =====================================
  // CRUD
  // =====================================

  BimViewer.savePendingMeasurement = async function() {
    const pending = this.measurementStore.pending;
    if (!pending) {
      this.updateStatus('No measurement to save', 'warning');
      return;
    }
    if (!this.measurementStore.initialized || !this.measurementStore.collection) {
      this.updateStatus('Measurement store not initialized', 'error');
      return;
    }

    try {
      const user = (typeof BimAuth !== 'undefined' && BimAuth.currentUser) || {};

      const doc = {
        type: pending.type,
        label: pending.label,
        positions: pending.positions,
        results: pending.results,
        timestamp: new Date().toISOString(),
        author: user.displayName || user.email || 'Unknown',
        authorEmail: user.email || ''
      };

      const docRef = await this.measurementStore.collection.add(doc);
      const saved = { id: docRef.id, ...doc };
      this.measurementStore.measurements.push(saved);

      // Remove save button, show confirmation
      const resultDiv = document.getElementById('measurementResult');
      const saveBtn = resultDiv ? resultDiv.querySelector('.ms-save-btn') : null;
      if (saveBtn) {
        saveBtn.textContent = '✅ Saved';
        saveBtn.disabled = true;
        saveBtn.style.opacity = '0.6';
      }

      this.measurementStore.pending = null;
      this.renderSavedMeasurementsList();
      this.updateStatus('Measurement saved', 'success');

      if (typeof plausible !== 'undefined' && !this._measurementStoreTracked) {
        plausible('Feature Used', { props: { feature: 'Measurement Save' } });
        this._measurementStoreTracked = true;
      }

      console.log('💾 Measurement saved:', docRef.id);

    } catch (error) {
      console.error('❌ Error saving measurement:', error);
      this.updateStatus('Error saving measurement', 'error');
    }
  };

  BimViewer.loadSavedMeasurements = async function() {
    if (!this.measurementStore.collection) return;

    try {
      const snapshot = await this.measurementStore.collection
        .orderBy('timestamp', 'desc')
        .get();

      this.measurementStore.measurements = [];

      snapshot.forEach((doc) => {
        const m = { id: doc.id, ...doc.data() };
        this.measurementStore.measurements.push(m);
        this.recreateMeasurementEntities(m);
      });

      this.renderSavedMeasurementsList();

      if (this.measurementStore.measurements.length > 0) {
        console.log('💾 Loaded ' + this.measurementStore.measurements.length + ' saved measurement(s)');
      }

    } catch (error) {
      console.error('❌ Error loading measurements:', error);
    }
  };

  BimViewer.deleteSavedMeasurement = async function(id) {
    if (!this.measurementStore.collection) return;

    try {
      await this.measurementStore.collection.doc(id).delete();

      // Remove entities from viewer
      const entities = this.measurementStore.entities[id];
      if (entities) {
        entities.forEach(e => {
          try { this.viewer.entities.remove(e); } catch (err) {}
        });
        delete this.measurementStore.entities[id];
      }

      // Remove from local array
      this.measurementStore.measurements = this.measurementStore.measurements.filter(m => m.id !== id);
      this.renderSavedMeasurementsList();
      this.updateStatus('Measurement deleted', 'success');

    } catch (error) {
      console.error('❌ Error deleting measurement:', error);
      this.updateStatus('Error deleting measurement', 'error');
    }
  };

  BimViewer.clearSavedMeasurements = async function() {
    if (!confirm('Delete all saved measurements?')) return;
    if (!this.measurementStore.collection) return;

    try {
      const snapshot = await this.measurementStore.collection.get();
      const batch = this.measurementStore.db.batch();
      snapshot.forEach(doc => batch.delete(doc.ref));
      await batch.commit();

      // Remove all entities
      for (const id in this.measurementStore.entities) {
        this.measurementStore.entities[id].forEach(e => {
          try { this.viewer.entities.remove(e); } catch (err) {}
        });
      }
      this.measurementStore.entities = {};
      this.measurementStore.measurements = [];
      this.renderSavedMeasurementsList();
      this.updateStatus('All saved measurements cleared', 'success');

    } catch (error) {
      console.error('❌ Error clearing measurements:', error);
    }
  };

  // =====================================
  // ENTITY RECREATION
  // =====================================

  BimViewer.recreateMeasurementEntities = function(m) {
    if (!this.viewer) return;

    const entities = [];
    const color = TYPE_COLORS[m.type] || Cesium.Color.WHITE;

    switch (m.type) {

      case 'distance': {
        if (m.positions.length < 2) break;
        const c0 = storableToCartesian(m.positions[0]);
        const c1 = storableToCartesian(m.positions[1]);
        entities.push(this.viewer.entities.add({
          position: c0, point: { pixelSize: 10, color: color, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY }
        }));
        entities.push(this.viewer.entities.add({
          position: c1, point: { pixelSize: 10, color: color, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY }
        }));
        entities.push(this.viewer.entities.add({
          polyline: {
            positions: [c0, c1], width: 3,
            material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.2, color: color }),
            depthFailMaterial: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.2, color: color.withAlpha(0.5) })
          }
        }));
        const mid = Cesium.Cartesian3.midpoint(c0, c1, new Cesium.Cartesian3());
        entities.push(this.viewer.entities.add({
          position: mid, label: {
            text: m.label, font: 'bold 14px sans-serif', fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -20), disableDepthTestDistance: Number.POSITIVE_INFINITY,
            backgroundColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.7)'), showBackground: true,
            backgroundPadding: new Cesium.Cartesian2(8, 5)
          }
        }));
        break;
      }

      case 'area': {
        if (m.positions.length < 3) break;
        const cartesians = m.positions.map(storableToCartesian);
        cartesians.forEach(c => {
          entities.push(this.viewer.entities.add({
            position: c, point: { pixelSize: 10, color: color, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY }
          }));
        });
        entities.push(this.viewer.entities.add({
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(cartesians),
            material: Cesium.Color.CYAN.withAlpha(0.4),
            outline: true, outlineColor: Cesium.Color.CYAN, outlineWidth: 2
          }
        }));
        const centroid = this.calculateCentroid(cartesians);
        entities.push(this.viewer.entities.add({
          position: centroid, label: {
            text: m.label, font: 'bold 14px sans-serif', fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -20), disableDepthTestDistance: Number.POSITIVE_INFINITY,
            backgroundColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.7)'), showBackground: true,
            backgroundPadding: new Cesium.Cartesian2(8, 5)
          }
        }));
        break;
      }

      case 'height': {
        if (m.positions.length < 1) break;
        const c = storableToCartesian(m.positions[0]);
        const carto = Cesium.Cartographic.fromCartesian(c);
        const terrainC = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, m.results.terrainHeight);
        entities.push(this.viewer.entities.add({
          position: c, point: { pixelSize: 10, color: color, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY }
        }));
        entities.push(this.viewer.entities.add({
          polyline: {
            positions: [c, terrainC], width: 3,
            material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.2, color: color }),
            depthFailMaterial: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.2, color: color.withAlpha(0.5) })
          }
        }));
        entities.push(this.viewer.entities.add({
          position: c, label: {
            text: m.label, font: 'bold 14px sans-serif', fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -20), disableDepthTestDistance: Number.POSITIVE_INFINITY,
            backgroundColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.7)'), showBackground: true,
            backgroundPadding: new Cesium.Cartesian2(8, 5)
          }
        }));
        break;
      }

      case 'vertical': {
        if (m.positions.length < 2) break;
        const c0v = storableToCartesian(m.positions[0]);
        const carto0 = Cesium.Cartographic.fromCartesian(c0v);
        const vertPoint = Cesium.Cartesian3.fromRadians(carto0.longitude, carto0.latitude, m.positions[1].height);
        entities.push(this.viewer.entities.add({
          position: c0v, point: { pixelSize: 10, color: color, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY }
        }));
        entities.push(this.viewer.entities.add({
          position: storableToCartesian(m.positions[1]), point: { pixelSize: 10, color: color, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY }
        }));
        entities.push(this.viewer.entities.add({
          polyline: {
            positions: [c0v, vertPoint], width: 3,
            material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.2, color: color }),
            depthFailMaterial: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.2, color: color.withAlpha(0.5) })
          }
        }));
        const midH = (m.positions[0].height + m.positions[1].height) / 2;
        const midV = Cesium.Cartesian3.fromRadians(carto0.longitude, carto0.latitude, midH);
        const diff = m.results.verticalDiff;
        entities.push(this.viewer.entities.add({
          position: midV, label: {
            text: (diff >= 0 ? '+' : '') + diff.toFixed(2) + ' m',
            font: 'bold 14px sans-serif', fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -20), disableDepthTestDistance: Number.POSITIVE_INFINITY,
            backgroundColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.7)'), showBackground: true,
            backgroundPadding: new Cesium.Cartesian2(8, 5)
          }
        }));
        break;
      }

      case 'coordinates': {
        if (m.positions.length < 1) break;
        const cc = storableToCartesian(m.positions[0]);
        entities.push(this.viewer.entities.add({
          position: cc, point: { pixelSize: 10, color: color, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY }
        }));
        entities.push(this.viewer.entities.add({
          position: cc, label: {
            text: m.label, font: 'bold 12px sans-serif', fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -20), disableDepthTestDistance: Number.POSITIVE_INFINITY,
            backgroundColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.7)'), showBackground: true,
            backgroundPadding: new Cesium.Cartesian2(8, 5)
          }
        }));
        break;
      }
    }

    if (entities.length > 0) {
      this.measurementStore.entities[m.id] = entities;
    }
  };

  // =====================================
  // FLY TO
  // =====================================

  BimViewer.flyToMeasurement = function(id) {
    const m = this.measurementStore.measurements.find(x => x.id === id);
    if (!m || !m.positions || m.positions.length === 0) return;

    const cartesians = m.positions.map(storableToCartesian);

    if (cartesians.length === 1) {
      // Single point: fly to with offset
      const carto = Cesium.Cartographic.fromCartesian(cartesians[0]);
      this.viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromRadians(
          carto.longitude, carto.latitude, carto.height + 50
        ),
        orientation: {
          heading: 0,
          pitch: Cesium.Math.toRadians(-60),
          roll: 0
        },
        duration: 1.0
      });
    } else {
      // Multiple points: compute bounding sphere and fly to it
      const sphere = Cesium.BoundingSphere.fromPoints(cartesians);
      // Ensure minimum radius so camera doesn't clip close measurements
      sphere.radius = Math.max(sphere.radius, 5) * 2.5;
      this.viewer.camera.flyToBoundingSphere(sphere, {
        duration: 1.0,
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-50), sphere.radius * 1.5)
      });
    }
  };

  // =====================================
  // UI
  // =====================================

  BimViewer.injectSavedMeasurementsUI = function() {
    const body = document.getElementById('measurementPanelBody');
    if (!body) return;

    // Only inject once
    if (document.getElementById('savedMeasurementsContainer')) return;

    const container = document.createElement('div');
    container.id = 'savedMeasurementsContainer';
    container.style.cssText = 'margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 10px;';
    container.innerHTML =
      '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">' +
        '<span id="savedMeasurementsHeader" style="font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.7);">💾 Saved</span>' +
        '<button onclick="BimViewer.clearSavedMeasurements()" style="background: none; border: none; color: rgba(255,255,255,0.35); font-size: 10px; cursor: pointer; padding: 2px 6px; transition: color 0.15s;" onmouseenter="this.style.color=\'rgba(255,255,255,0.7)\'" onmouseleave="this.style.color=\'rgba(255,255,255,0.35)\'">Clear All</button>' +
      '</div>' +
      '<div id="savedMeasurementsItems" style="max-height: 220px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.15) transparent;"></div>';

    body.appendChild(container);
  };

  BimViewer.renderSavedMeasurementsList = function() {
    const container = document.getElementById('savedMeasurementsItems');
    if (!container) return;

    const measurements = this.measurementStore.measurements;

    // Update header count
    const header = document.getElementById('savedMeasurementsHeader');
    if (header) {
      header.textContent = measurements.length > 0
        ? '💾 Saved (' + measurements.length + ')'
        : '💾 Saved';
    }

    if (measurements.length === 0) {
      container.innerHTML = '<div style="text-align: center; color: rgba(255,255,255,0.25); font-size: 11px; padding: 12px 0;">No saved measurements</div>';
      return;
    }

    // Type-specific accent colors for the icon badge
    var TYPE_ACCENT = {
      distance: '#FFD700', area: '#00CED1', height: '#f093fb',
      vertical: '#4facfe', coordinates: '#fa709a'
    };

    let html = '';
    measurements.forEach(m => {
      const icon = TYPE_ICONS[m.type] || '📐';
      const typeLabel = TYPE_LABELS[m.type] || m.type;
      const accent = TYPE_ACCENT[m.type] || '#6EECD8';
      const date = m.timestamp ? new Date(m.timestamp).toLocaleDateString() : '';

      html +=
        '<div class="ms-saved-item" onclick="BimViewer.flyToMeasurement(\'' + m.id + '\')">' +
          '<div class="ms-saved-icon" style="color: ' + accent + ';">' + icon + '</div>' +
          '<div class="ms-saved-info">' +
            '<div class="ms-saved-label">' + (m.label || typeLabel) + '</div>' +
            '<div class="ms-saved-meta">' + typeLabel + ' \u00B7 ' + date + '</div>' +
          '</div>' +
          '<button class="ms-saved-zoom" onclick="event.stopPropagation(); BimViewer.flyToMeasurement(\'' + m.id + '\')" title="Zoom to">🔍</button>' +
          '<button class="ms-saved-delete" onclick="event.stopPropagation(); BimViewer.deleteSavedMeasurement(\'' + m.id + '\')" title="Delete">\u2715</button>' +
        '</div>';
    });

    container.innerHTML = html;
  };

  // =====================================
  // HOOK INTO INIT
  // =====================================

  // Wrap initIonMeasurements (the alias that core.js actually calls)
  const origInitIonMeasurements = BimViewer.initIonMeasurements || BimViewer.initMeasurement;
  BimViewer.initIonMeasurements = function() {
    origInitIonMeasurements.call(this);
    this.initMeasurementStore();
  };
  // Keep initMeasurement in sync
  BimViewer.initMeasurement = BimViewer.initIonMeasurements;

  console.log('✅ Measurement Store module loaded v1.0');

})();
