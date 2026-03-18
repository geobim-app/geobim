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
// CESIUM BIM VIEWER - MEASUREMENT MODULE v3.1
// Extended measurement tools
// Distance, Area, Height, Coordinates
// ===============================
'use strict';

(function(BimViewer) {

  // Measurement state
  BimViewer.measurement = {
    active: false,
    type: null,
    handler: null,
    positions: [],
    entities: [],
    polygonEntity: null
  };

  // Toggle measurement panel
  BimViewer.toggleMeasurementPanel = function() {
    let panel = document.getElementById('measurementPanel');

    if (!panel) {
      this.createMeasurementPanel();
      panel = document.getElementById('measurementPanel');
    }

    if (panel) {
      const isVisible = panel.style.display !== 'none';
      panel.style.display = isVisible ? 'none' : 'flex';

      if (!isVisible && typeof plausible !== 'undefined') {
        plausible('Feature Used', { props: { feature: 'Measurement' } });
      }
    }
  };

  // Collapse / expand measurement panel body
  BimViewer.toggleMeasurementCollapse = function() {
    const body = document.getElementById('measurementPanelBody');
    const btn = document.getElementById('measurementCollapseBtn');
    if (!body) return;
    body.classList.toggle('collapsed');
    if (btn) btn.textContent = body.classList.contains('collapsed') ? '+' : '\u2212';
  };

  // Create measurement panel (floating, draggable, minimizable)
  BimViewer.createMeasurementPanel = function() {
    const existing = document.getElementById('measurementPanel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'measurementPanel';
    panel.style.cssText =
      'position: fixed; bottom: 60px; right: 20px; z-index: 200; display: none;' +
      'width: 320px; max-height: 80vh;' +
      'background: rgba(14, 17, 23, 0.92); backdrop-filter: blur(12px);' +
      'border-radius: 12px;' +
      'box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08);' +
      'color: white; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;' +
      'flex-direction: column; overflow: hidden;';

    panel.innerHTML =
      // Header (draggable)
      '<div id="measurementPanelHeader" class="floating-panel-header">' +
        '<span class="floating-panel-title">📏 Measurements</span>' +
        '<div class="floating-panel-controls">' +
          '<button id="measurementCollapseBtn" class="floating-panel-btn" onclick="BimViewer.toggleMeasurementCollapse()" title="Minimize">\u2212</button>' +
          '<button class="floating-panel-btn" onclick="BimViewer.toggleMeasurementPanel()" title="Close">\u2715</button>' +
        '</div>' +
      '</div>' +

      // Body (collapsible)
      '<div id="measurementPanelBody" class="floating-panel-body" style="max-height: none; padding: 10px;">' +

        // Tool buttons
        '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px;">' +
          '<button onclick="BimViewer.startDistanceMeasurement()" class="ms-tool-btn" style="background: linear-gradient(135deg, #6EECD8, #3DB8A0);">' +
            '<span>📏</span><span>Distance</span></button>' +
          '<button onclick="BimViewer.startAreaMeasurement()" class="ms-tool-btn" style="background: linear-gradient(135deg, #11998e, #38ef7d);">' +
            '<span>⬛</span><span>Area</span></button>' +
        '</div>' +
        '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px;">' +
          '<button onclick="BimViewer.startHeightOverTerrain()" class="ms-tool-btn" style="background: linear-gradient(135deg, #f093fb, #f5576c);">' +
            '<span>⛰️</span><span>Height/Terrain</span></button>' +
          '<button onclick="BimViewer.startVerticalDistance()" class="ms-tool-btn" style="background: linear-gradient(135deg, #4facfe, #00f2fe);">' +
            '<span>↕️</span><span>Vertical</span></button>' +
        '</div>' +
        '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px;">' +
          '<button onclick="BimViewer.startCoordinatePick()" class="ms-tool-btn" style="background: linear-gradient(135deg, #fa709a, #fee140);">' +
            '<span>🌍</span><span>Coordinates</span></button>' +
          '<button onclick="BimViewer.clearMeasurements()" class="ms-tool-btn" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);">' +
            '<span>🗑️</span><span>Clear All</span></button>' +
        '</div>' +

        // Instructions
        '<div style="background: rgba(0,0,0,0.2); border-radius: 6px; padding: 6px 8px; margin-bottom: 10px;">' +
          '<p style="color: rgba(255,255,255,0.45); font-size: 10px; margin: 0; line-height: 1.4;">' +
          'Left-click to place \u2022 Right-click/Enter to finish \u2022 ESC to cancel</p>' +
        '</div>' +

        // Results
        '<div id="measurementResult" style="padding: 10px; background: rgba(0,0,0,0.3); border-radius: 8px; text-align: center; min-height: 40px;">' +
          '<span style="color: rgba(255,255,255,0.4); font-size: 12px;">Select a measurement tool</span>' +
        '</div>' +

      '</div>'; // end body

    document.body.appendChild(panel);

    // Make draggable using shared helper
    if (typeof this.makeFloatingPanelDraggable === 'function') {
      this.makeFloatingPanelDraggable(panel, document.getElementById('measurementPanelHeader'));
    }

    console.log('📏 Measurement panel created');
  };

  // =====================
  // DISTANCE MEASUREMENT
  // =====================
  BimViewer.startDistanceMeasurement = function() {
    if (!this.viewer) return;
    if (this.comments && this.comments.isAddingComment) {
      this.updateStatus('Exit comment mode first', 'warning');
      return;
    }

    this.cancelMeasurement();
    this.measurement.active = true;
    this.measurement.type = 'distance';
    this.measurement.positions = [];

    this.updateStatus('LEFT-CLICK first point', 'loading');
    this.updateMeasurementResult('<span style="color: #6EECD8;">📏 Click first point...</span>');

    const self = this;
    const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    this.measurement.handler = handler;

    const keyHandler = function(e) {
      if (e.key === 'Escape') self.cancelMeasurement();
    };
    document.addEventListener('keydown', keyHandler);
    this.measurement.keyHandler = keyHandler;

    handler.setInputAction((click) => {
      const cartesian = this.viewer.scene.pickPosition(click.position);
      if (!cartesian) return;

      this.measurement.positions.push(cartesian);
      this.addPointMarker(cartesian, Cesium.Color.YELLOW);

      if (this.measurement.positions.length === 1) {
        this.updateMeasurementResult('<span style="color: #6EECD8;">📏 Click second point...</span>');
      } else if (this.measurement.positions.length === 2) {
        this.completeDistanceMeasurement();
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction(() => this.cancelMeasurement(), Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  };

  BimViewer.completeDistanceMeasurement = function() {
    const positions = this.measurement.positions;
    if (positions.length < 2) return;

    const distance = Cesium.Cartesian3.distance(positions[0], positions[1]);

    // Calculate vertical component
    const carto1 = Cesium.Cartographic.fromCartesian(positions[0]);
    const carto2 = Cesium.Cartographic.fromCartesian(positions[1]);
    const verticalDist = Math.abs(carto2.height - carto1.height);
    const horizontalDist = Math.sqrt(distance * distance - verticalDist * verticalDist);

    // Add line
    this.addMeasurementLine(positions, Cesium.Color.YELLOW);

    // Add label
    const midpoint = Cesium.Cartesian3.midpoint(positions[0], positions[1], new Cesium.Cartesian3());
    this.addMeasurementLabel(midpoint, this.formatDistance(distance));

    const resultHtml = `
      <div style="text-align: left; font-size: 12px; line-height: 1.6;">
        <div style="color: #FFD700; font-size: 16px; font-weight: 600; margin-bottom: 6px;">
          📏 ${this.formatDistance(distance)}
        </div>
        <div style="color: rgba(255,255,255,0.7);">
          ↔️ Horizontal: ${this.formatDistance(horizontalDist)}<br>
          ↕️ Vertical: ${this.formatDistance(verticalDist)}
        </div>
      </div>
    `;
    this.updateMeasurementResult(resultHtml);
    this.updateStatus(`Distance: ${this.formatDistance(distance)}`, 'success');
    this.cleanupMeasurementHandlers();
  };

  // =====================
  // AREA MEASUREMENT
  // =====================
  BimViewer.startAreaMeasurement = function() {
    if (!this.viewer) return;
    if (this.comments && this.comments.isAddingComment) {
      this.updateStatus('Exit comment mode first', 'warning');
      return;
    }

    this.cancelMeasurement();
    this.measurement.active = true;
    this.measurement.type = 'area';
    this.measurement.positions = [];

    this.updateStatus('LEFT-CLICK to add points, RIGHT-CLICK or ENTER to finish', 'loading');
    this.updateMeasurementResult('<span style="color: #11998e;">⬛ Click to add polygon points...</span>');

    const self = this;
    const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    this.measurement.handler = handler;

    const keyHandler = function(e) {
      if (e.key === 'Enter') self.completeAreaMeasurement();
      else if (e.key === 'Escape') self.cancelMeasurement();
    };
    document.addEventListener('keydown', keyHandler);
    this.measurement.keyHandler = keyHandler;

    handler.setInputAction((click) => {
      const cartesian = this.viewer.scene.pickPosition(click.position);
      if (!cartesian) return;

      this.measurement.positions.push(cartesian);
      this.addPointMarker(cartesian, Cesium.Color.CYAN);

      if (this.measurement.positions.length >= 3) {
        this.updatePolygonPreview();
      }

      const count = this.measurement.positions.length;
      this.updateMeasurementResult(`<span style="color: #11998e;">⬛ ${count} points - ${count < 3 ? `need ${3-count} more` : 'RIGHT-CLICK or ENTER to finish'}</span>`);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction(() => this.completeAreaMeasurement(), Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  };

  BimViewer.updatePolygonPreview = function() {
    if (this.measurement.polygonEntity) {
      this.viewer.entities.remove(this.measurement.polygonEntity);
    }
    if (this.measurement.positions.length >= 3) {
      this.measurement.polygonEntity = this.viewer.entities.add({
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(this.measurement.positions),
          material: Cesium.Color.CYAN.withAlpha(0.4),
          outline: true,
          outlineColor: Cesium.Color.CYAN,
          outlineWidth: 2
        }
      });
    }
  };

  BimViewer.completeAreaMeasurement = function() {
    const positions = this.measurement.positions;
    if (positions.length < 3) {
      this.updateMeasurementResult('<span style="color: #f5576c;">Need at least 3 points</span>');
      return;
    }

    if (this.measurement.polygonEntity) {
      this.measurement.entities.push(this.measurement.polygonEntity);
      this.measurement.polygonEntity = null;
    }

    const area = this.calculateArea(positions);
    const centroid = this.calculateCentroid(positions);
    this.addMeasurementLabel(centroid, this.formatArea(area));

    this.updateMeasurementResult(`
      <div style="color: #00CED1; font-size: 16px; font-weight: 600;">
        ⬛ ${this.formatArea(area)}
      </div>
    `);
    this.updateStatus(`Area: ${this.formatArea(area)}`, 'success');
    this.cleanupMeasurementHandlers();
  };

  // =====================
  // HEIGHT OVER TERRAIN
  // =====================
  BimViewer.startHeightOverTerrain = function() {
    if (!this.viewer) return;
    if (this.comments && this.comments.isAddingComment) {
      this.updateStatus('Exit comment mode first', 'warning');
      return;
    }

    this.cancelMeasurement();
    this.measurement.active = true;
    this.measurement.type = 'height';

    this.updateStatus('LEFT-CLICK on a point to measure height over terrain', 'loading');
    this.updateMeasurementResult('<span style="color: #f093fb;">⛰️ Click on a point...</span>');

    const self = this;
    const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    this.measurement.handler = handler;

    const keyHandler = function(e) {
      if (e.key === 'Escape') self.cancelMeasurement();
    };
    document.addEventListener('keydown', keyHandler);
    this.measurement.keyHandler = keyHandler;

    handler.setInputAction(async (click) => {
      const cartesian = this.viewer.scene.pickPosition(click.position);
      if (!cartesian) return;

      const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      const clickedHeight = cartographic.height;

      // Get terrain height at this location
      try {
        const terrainProvider = this.viewer.terrainProvider;
        const positions = [cartographic];
        const updatedPositions = await Cesium.sampleTerrainMostDetailed(terrainProvider, positions);
        const terrainHeight = updatedPositions[0].height || 0;
        const heightOverTerrain = clickedHeight - terrainHeight;

        this.addPointMarker(cartesian, Cesium.Color.MAGENTA);

        // Add vertical line to terrain
        const terrainCartesian = Cesium.Cartesian3.fromRadians(
          cartographic.longitude,
          cartographic.latitude,
          terrainHeight
        );
        this.addMeasurementLine([cartesian, terrainCartesian], Cesium.Color.MAGENTA);
        this.addMeasurementLabel(cartesian, `${heightOverTerrain.toFixed(2)} m above terrain`);

        const resultHtml = `
          <div style="text-align: left; font-size: 12px; line-height: 1.6;">
            <div style="color: #f093fb; font-size: 16px; font-weight: 600; margin-bottom: 6px;">
              ⛰️ ${heightOverTerrain.toFixed(2)} m above terrain
            </div>
            <div style="color: rgba(255,255,255,0.7);">
              📍 Point height: ${clickedHeight.toFixed(2)} m<br>
              🏔️ Terrain height: ${terrainHeight.toFixed(2)} m
            </div>
          </div>
        `;
        this.updateMeasurementResult(resultHtml);
        this.updateStatus(`Height over terrain: ${heightOverTerrain.toFixed(2)} m`, 'success');
      } catch (error) {
        this.updateMeasurementResult(`<span style="color: #f5576c;">Could not sample terrain</span>`);
      }

      this.cleanupMeasurementHandlers();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction(() => this.cancelMeasurement(), Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  };

  // =====================
  // VERTICAL DISTANCE
  // =====================
  BimViewer.startVerticalDistance = function() {
    if (!this.viewer) return;
    if (this.comments && this.comments.isAddingComment) {
      this.updateStatus('Exit comment mode first', 'warning');
      return;
    }

    this.cancelMeasurement();
    this.measurement.active = true;
    this.measurement.type = 'vertical';
    this.measurement.positions = [];

    this.updateStatus('LEFT-CLICK two points to measure vertical distance', 'loading');
    this.updateMeasurementResult('<span style="color: #4facfe;">↕️ Click first point...</span>');

    const self = this;
    const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    this.measurement.handler = handler;

    const keyHandler = function(e) {
      if (e.key === 'Escape') self.cancelMeasurement();
    };
    document.addEventListener('keydown', keyHandler);
    this.measurement.keyHandler = keyHandler;

    handler.setInputAction((click) => {
      const cartesian = this.viewer.scene.pickPosition(click.position);
      if (!cartesian) return;

      this.measurement.positions.push(cartesian);
      this.addPointMarker(cartesian, Cesium.Color.DEEPSKYBLUE);

      if (this.measurement.positions.length === 1) {
        this.updateMeasurementResult('<span style="color: #4facfe;">↕️ Click second point...</span>');
      } else if (this.measurement.positions.length === 2) {
        this.completeVerticalMeasurement();
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction(() => this.cancelMeasurement(), Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  };

  BimViewer.completeVerticalMeasurement = function() {
    const positions = this.measurement.positions;
    if (positions.length < 2) return;

    const carto1 = Cesium.Cartographic.fromCartesian(positions[0]);
    const carto2 = Cesium.Cartographic.fromCartesian(positions[1]);

    const height1 = carto1.height;
    const height2 = carto2.height;
    const verticalDist = height2 - height1;
    const absVerticalDist = Math.abs(verticalDist);

    // Create vertical line (project second point directly above/below first)
    const verticalPoint = Cesium.Cartesian3.fromRadians(
      carto1.longitude,
      carto1.latitude,
      height2
    );

    this.addMeasurementLine([positions[0], verticalPoint], Cesium.Color.DEEPSKYBLUE);

    const midHeight = (height1 + height2) / 2;
    const midPoint = Cesium.Cartesian3.fromRadians(carto1.longitude, carto1.latitude, midHeight);
    this.addMeasurementLabel(midPoint, `${verticalDist >= 0 ? '+' : ''}${verticalDist.toFixed(2)} m`);

    const direction = verticalDist >= 0 ? '⬆️ Up' : '⬇️ Down';
    const resultHtml = `
      <div style="text-align: left; font-size: 12px; line-height: 1.6;">
        <div style="color: #4facfe; font-size: 16px; font-weight: 600; margin-bottom: 6px;">
          ↕️ ${this.formatDistance(absVerticalDist)} ${direction}
        </div>
        <div style="color: rgba(255,255,255,0.7);">
          📍 Point 1: ${height1.toFixed(2)} m<br>
          📍 Point 2: ${height2.toFixed(2)} m<br>
          Δ Difference: ${verticalDist >= 0 ? '+' : ''}${verticalDist.toFixed(2)} m
        </div>
      </div>
    `;
    this.updateMeasurementResult(resultHtml);
    this.updateStatus(`Vertical: ${this.formatDistance(absVerticalDist)}`, 'success');
    this.cleanupMeasurementHandlers();
  };

  // =====================
  // COORDINATE PICK
  // =====================
  BimViewer.startCoordinatePick = function() {
    if (!this.viewer) return;
    if (this.comments && this.comments.isAddingComment) {
      this.updateStatus('Exit comment mode first', 'warning');
      return;
    }

    this.cancelMeasurement();
    this.measurement.active = true;
    this.measurement.type = 'coordinates';

    this.updateStatus('LEFT-CLICK to get coordinates', 'loading');
    this.updateMeasurementResult('<span style="color: #fa709a;">🌍 Click on a point...</span>');

    const self = this;
    const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    this.measurement.handler = handler;

    const keyHandler = function(e) {
      if (e.key === 'Escape') self.cancelMeasurement();
    };
    document.addEventListener('keydown', keyHandler);
    this.measurement.keyHandler = keyHandler;

    handler.setInputAction(async (click) => {
      const cartesian = this.viewer.scene.pickPosition(click.position);
      if (!cartesian) return;

      const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      const lon = Cesium.Math.toDegrees(cartographic.longitude);
      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      const height = cartographic.height;

      // Get terrain height for comparison
      let terrainHeight = 0;
      try {
        const terrainProvider = this.viewer.terrainProvider;
        const positions = [Cesium.Cartographic.clone(cartographic)];
        const updatedPositions = await Cesium.sampleTerrainMostDetailed(terrainProvider, positions);
        terrainHeight = updatedPositions[0].height || 0;
      } catch (e) {}

      this.addPointMarker(cartesian, Cesium.Color.ORANGE);

      // Geoid undulation lookup
      var geoidInfo = (typeof GEOBIM_GEOID !== 'undefined') ? GEOBIM_GEOID.toOrthometric(height, lat, lon) : null;
      var undulationHtml = '';
      if (geoidInfo) {
        undulationHtml =
          '<div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.1);">' +
            '📐 Geoid undulation (N): <strong>' + geoidInfo.undulation.toFixed(2) + ' m</strong><br>' +
            '🏛️ Height above sea level: <strong>' + geoidInfo.orthometric.toFixed(2) + ' m</strong>' +
          '</div>';
      }

      const resultHtml = `
        <div style="text-align: left; font-size: 11px; line-height: 1.7;">
          <div style="color: #fa709a; font-size: 14px; font-weight: 600; margin-bottom: 8px;">
            🌍 Global Coordinates
          </div>
          <div style="color: rgba(255,255,255,0.9); font-family: monospace; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 4px;">
            <div>Lat: <strong>${lat.toFixed(7)}°</strong></div>
            <div>Lon: <strong>${lon.toFixed(7)}°</strong></div>
            <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.1);">
              🌊 Height (WGS84): <strong>${height.toFixed(2)} m</strong><br>
              🏔️ Terrain height: <strong>${terrainHeight.toFixed(2)} m</strong><br>
              ⛰️ Above terrain: <strong>${(height - terrainHeight).toFixed(2)} m</strong>
            </div>
            ${undulationHtml}
          </div>
          <button onclick="navigator.clipboard.writeText('${lat.toFixed(7)}, ${lon.toFixed(7)}')" style="
            margin-top: 8px; padding: 6px 12px; width: 100%;
            background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
            border-radius: 4px; color: white; font-size: 11px; cursor: pointer;
          ">📋 Copy Lat/Lon</button>
        </div>
      `;
      this.updateMeasurementResult(resultHtml);
      this.updateStatus(`Coordinates captured`, 'success');
      this.cleanupMeasurementHandlers();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction(() => this.cancelMeasurement(), Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  };

  // =====================
  // HELPER FUNCTIONS
  // =====================
  BimViewer.addPointMarker = function(position, color) {
    const entity = this.viewer.entities.add({
      position: position,
      point: {
        pixelSize: 12,
        color: color,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    this.measurement.entities.push(entity);
    return entity;
  };

  BimViewer.addMeasurementLine = function(positions, color) {
    const entity = this.viewer.entities.add({
      polyline: {
        positions: positions,
        width: 3,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.2,
          color: color
        }),
        depthFailMaterial: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.2,
          color: color.withAlpha(0.5)
        })
      }
    });
    this.measurement.entities.push(entity);
    return entity;
  };

  BimViewer.addMeasurementLabel = function(position, text) {
    const entity = this.viewer.entities.add({
      position: position,
      label: {
        text: text,
        font: 'bold 14px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -20),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        backgroundColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.7)'),
        showBackground: true,
        backgroundPadding: new Cesium.Cartesian2(8, 5)
      }
    });
    this.measurement.entities.push(entity);
    return entity;
  };

  BimViewer.calculateArea = function(positions) {
    if (positions.length < 3) return 0;
    const cartographics = positions.map(p => Cesium.Cartographic.fromCartesian(p));
    let area = 0;
    for (let i = 0; i < cartographics.length; i++) {
      const j = (i + 1) % cartographics.length;
      area += cartographics[i].longitude * cartographics[j].latitude;
      area -= cartographics[j].longitude * cartographics[i].latitude;
    }
    area = Math.abs(area) / 2;
    const earthRadius = 6371000;
    const avgLat = cartographics.reduce((sum, c) => sum + c.latitude, 0) / cartographics.length;
    return area * earthRadius * earthRadius * Math.cos(avgLat);
  };

  BimViewer.calculateCentroid = function(positions) {
    let x = 0, y = 0, z = 0;
    positions.forEach(p => { x += p.x; y += p.y; z += p.z; });
    return new Cesium.Cartesian3(x / positions.length, y / positions.length, z / positions.length);
  };

  BimViewer.formatDistance = function(meters) {
    if (meters >= 1000) return (meters / 1000).toFixed(2) + ' km';
    return meters.toFixed(2) + ' m';
  };

  BimViewer.formatArea = function(sqMeters) {
    if (sqMeters >= 10000) return (sqMeters / 10000).toFixed(2) + ' ha';
    return sqMeters.toFixed(2) + ' m²';
  };

  BimViewer.updateMeasurementResult = function(html) {
    const resultDiv = document.getElementById('measurementResult');
    if (resultDiv) resultDiv.innerHTML = html;
  };

  BimViewer.cancelMeasurement = function() {
    if (this.measurement.polygonEntity) {
      this.viewer.entities.remove(this.measurement.polygonEntity);
      this.measurement.polygonEntity = null;
    }
    this.cleanupMeasurementHandlers();
    this.updateMeasurementResult('<span style="color: rgba(255,255,255,0.5);">Measurement cancelled</span>');
  };

  BimViewer.cleanupMeasurementHandlers = function() {
    if (this.measurement.handler) {
      this.measurement.handler.destroy();
      this.measurement.handler = null;
    }
    if (this.measurement.keyHandler) {
      document.removeEventListener('keydown', this.measurement.keyHandler);
      this.measurement.keyHandler = null;
    }
    this.measurement.active = false;
    this.measurement.type = null;
    this.measurement.positions = [];
  };

  BimViewer.clearMeasurements = function() {
    this.cancelMeasurement();
    this.measurement.entities.forEach(entity => {
      try { this.viewer.entities.remove(entity); } catch (e) {}
    });
    this.measurement.entities = [];
    this.updateMeasurementResult('<span style="color: rgba(255,255,255,0.5);">All measurements cleared</span>');
    this.updateStatus('Measurements cleared', 'success');
  };

  BimViewer.isMeasuring = function() {
    return this.measurement.active;
  };

  // Check if measurement panel is open
  BimViewer.isMeasurementPanelOpen = function() {
    const panel = document.getElementById('measurementPanel');
    return panel && panel.style.display !== 'none';
  };

  BimViewer.initMeasurement = function() {
    this.createMeasurementPanel();
    console.log('📏 Measurement system v3.1 initialized');
  };

  BimViewer.initIonMeasurements = BimViewer.initMeasurement;

})(window.BimViewer = window.BimViewer || {});

console.log('✅ Measurement module v3.1 loaded (Distance, Area, Height, Vertical, Coordinates)');
