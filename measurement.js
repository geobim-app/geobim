// ===============================
// CESIUM BIM VIEWER - ION SDK MEASUREMENT MODULE (FIXED v2.1)
// Original Ion SDK Widget with Auto-Init
// FIX: Prevents double initialization error
// ===============================
'use strict';

(function() {
  
  // Measurement state management
  const measurementState = {
    isInitialized: false,
    isInitializing: false,
    widgetContainer: null,
    measure: null,
    activeMeasurement: null
  };

  // Initialize Ion SDK Measurements
  BimViewer.initIonMeasurements = function() {
    // ✅ GUARD: Prevent double initialization
    if (measurementState.isInitialized || measurementState.isInitializing) {
      console.log('📏 Measurements already initialized - skipping');
      return;
    }
    
    if (!this.viewer || !this.viewer.scene) {
      console.log('⏳ Waiting for viewer to be ready...');
      setTimeout(() => this.initIonMeasurements(), 100);
      return;
    }
    
    if (window.IonSdkMeasurements) {
      this.setupIonSDKWidget();
      return;
    }
    
    const script = document.createElement('script');
    script.src = 'https://christoflorenz.de/cesium_sdk/packages/ion-sdk-measurements/Build/IonSdkMeasurements/IonSdkMeasurements.js';
    script.onload = () => {
      console.log('✅ Ion SDK Measurements script loaded successfully');
      
      const basePath = 'https://christoflorenz.de/cesium_sdk/packages/ion-sdk-measurements/Build/IonSdkMeasurements/IonSdkMeasurements';
      
      const cssFiles = [
        'widgets.css',
        'lighter.css',
        'Measure/Measure.css',
        'Measure/lighter.css',
        'Viewer/Viewer.css',
        'TransformEditor/TransformEditor.css'
      ];
      
      cssFiles.forEach(file => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `${basePath}/${file}`;
        link.onload = () => console.log(`✅ CSS loaded: ${file}`);
        link.onerror = () => console.warn(`⚠️ CSS not loaded: ${file}`);
        document.head.appendChild(link);
      });
      
      setTimeout(() => this.setupIonSDKWidget(), 100);
    };
    script.onerror = () => {
      console.error('❌ Failed to load IonSdkMeasurements.js');
      this.createFallbackMeasurementUI();
    };
    document.head.appendChild(script);
    
    this.injectArtefaktFixes();
  };

  // Setup Ion SDK Widget
  BimViewer.setupIonSDKWidget = function() {
    // ✅ CRITICAL: Check if already initialized to prevent double binding
    if (measurementState.isInitialized || measurementState.isInitializing || measurementState.measure) {
      console.log('📏 Ion SDK Widget already initialized - skipping setup');
      return;
    }
    
    const SDK = window.IonSdkMeasurements || window.CesiumIonSdkMeasurements;
    
    if (!SDK) {
      console.error('❌ Ion SDK Measurements not available');
      this.createFallbackMeasurementUI();
      return;
    }
    
    try {
      const container = this.getOrCreateMeasurementContainer();
      
      if (SDK.Measure) {
        // Mark as initializing to prevent concurrent calls
        measurementState.isInitializing = true;
        
        measurementState.measure = new SDK.Measure({
          container: container,
          scene: this.viewer.scene,
          terria: this.viewer,
          units: new SDK.MeasureUnits({
            distanceUnits: SDK.DistanceUnits.METERS,
            areaUnits: SDK.AreaUnits.SQUARE_METERS,
            volumeUnits: SDK.VolumeUnits.CUBIC_METERS,
            angleUnits: SDK.AngleUnits.DEGREES
          })
        });
        
        measurementState.isInitialized = true;
        measurementState.isInitializing = false;
        console.log('✅ Ion SDK Measurement Widget initialized (Original UI)');
      } else {
        measurementState.isInitializing = false;
        console.error('SDK.Measure not available');
        this.createFallbackMeasurementUI();
        return;
      }
      
      
      setTimeout(() => {
        if (measurementState.widgetContainer) {
          measurementState.widgetContainer.style.display = 'block';
          console.log('📏 Ion SDK Widget automatically displayed');
        }
      }, 500);
      
    } catch (error) {
      measurementState.isInitializing = false;
      console.error('❌ Error setting up Ion SDK Widget:', error);
      this.createFallbackMeasurementUI();
    }
  };

  // Get or create measurement container
  BimViewer.getOrCreateMeasurementContainer = function() {
    if (!measurementState.widgetContainer) {
      const container = document.createElement('div');
      container.id = 'ionSdkMeasurementWidget';
      container.className = 'ion-sdk-measurements';
      container.style.cssText = `
        position: absolute;
        top: 70px;
        right: 20px;
        z-index: 100;
        display: none;
      `;
      document.body.appendChild(container);
      measurementState.widgetContainer = container;
    }
    return measurementState.widgetContainer;
  };

  // Inject CSS fixes
  BimViewer.injectArtefaktFixes = function() {
    const style = document.createElement('style');
    style.innerHTML = `
      #ionSdkMeasurementWidget .cesium-selection-wrapper,
      #ionSdkMeasurementWidget .cesium-selection-wrapper-visible {
        display: none !important;
      }
      
      #ionSdkMeasurementWidget *::before,
      #ionSdkMeasurementWidget *::after {
        background: transparent !important;
        border: none !important;
      }
      
      #ionSdkMeasurementWidget button:hover::before,
      #ionSdkMeasurementWidget button:hover::after,
      #ionSdkMeasurementWidget .measure-button:hover::before,
      #ionSdkMeasurementWidget .measure-button:hover::after {
        display: none !important;
      }
      
      #ionSdkMeasurementWidget svg rect[fill*="blue"],
      #ionSdkMeasurementWidget svg path[fill*="blue"],
      #ionSdkMeasurementWidget .cesium-svgPath-svg {
        display: none !important;
      }
      
      #ionSdkMeasurementWidget *:hover {
        background-color: transparent !important;
      }
      
      #ionSdkMeasurementWidget button:hover {
        opacity: 0.8;
      }
    `;
    document.head.appendChild(style);
    console.log('💉 Injected artefakt fixes for Ion SDK Widget');
  };

  // Fallback measurement UI
  BimViewer.createFallbackMeasurementUI = function() {
    console.log('⚠️ Creating fallback measurement UI');
    
    const container = this.getOrCreateMeasurementContainer();
    container.innerHTML = `
      <div style="color: white; padding: 10px; background: rgba(42, 42, 42, 0.95); border-radius: 10px;">
        <h3 style="margin: 0 0 10px 0; color: #8a2be2;">📏 Measurement Tools</h3>
        <p style="color: #ffa500; font-size: 0.85em;">
          ⚠️ Ion SDK not available - Using fallback mode
        </p>
        <div style="margin-top: 15px;">
          <button onclick="BimViewer.startSimpleDistance()" class="btn btn-primary" style="width: 100%; margin-bottom: 12px;">
            📏 Distance
          </button>
          <button onclick="BimViewer.startSimpleArea()" class="btn btn-primary" style="width: 100%; margin-bottom: 12px;">
            ◼️ Area
          </button>
          <button onclick="BimViewer.clearAllMeasurements()" class="btn btn-danger" style="width: 100%;">
            🗑️ Clear All
          </button>
        </div>
        <div id="measurementResults" style="margin-top: 15px; padding: 10px; background: rgba(0,0,0,0.3); border-radius: 5px; min-height: 50px;">
          <small style="color: #888;">Results will appear here</small>
        </div>
      </div>
    `;
    
    container.style.display = 'block';
  };

  // Simple distance measurement
  BimViewer.startSimpleDistance = function() {
    this.updateStatus('Click two points to measure distance', 'loading');
    
    const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    const positions = [];
    
    handler.setInputAction((click) => {
      const cartesian = this.viewer.scene.pickPosition(click.position);
      if (!cartesian) return;
      
      positions.push(cartesian);
      
      this.viewer.entities.add({
        position: cartesian,
        point: {
          pixelSize: 10,
          color: Cesium.Color.YELLOW,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
        }
      });
      
      if (positions.length === 2) {
        const distance = Cesium.Cartesian3.distance(positions[0], positions[1]);
        
        this.viewer.entities.add({
          polyline: {
            positions: positions,
            width: 3,
            material: Cesium.Color.YELLOW,
            clampToGround: true
          }
        });
        
        const midpoint = Cesium.Cartesian3.midpoint(positions[0], positions[1], new Cesium.Cartesian3());
        this.viewer.entities.add({
          position: midpoint,
          label: {
            text: `${distance.toFixed(2)} m`,
            font: '16px sans-serif',
            fillColor: Cesium.Color.YELLOW,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -20)
          }
        });
        
        const resultsDiv = document.getElementById('measurementResults');
        if (resultsDiv) {
          resultsDiv.innerHTML = `<strong>Distance:</strong> ${distance.toFixed(2)} meters`;
        }
        
        this.updateStatus(`Distance: ${distance.toFixed(2)} meters`, 'success');
        handler.destroy();
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    
    handler.setInputAction(() => {
      handler.destroy();
      this.updateStatus('Distance measurement cancelled', 'warning');
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  };

  // Simple area measurement
  BimViewer.startSimpleArea = function() {
    this.updateStatus('Click points to define area, right-click to finish', 'loading');
    
    const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    const positions = [];
    let polygonEntity = null;
    
    handler.setInputAction((click) => {
      const cartesian = this.viewer.scene.pickPosition(click.position);
      if (!cartesian) return;
      
      positions.push(cartesian);
      
      this.viewer.entities.add({
        position: cartesian,
        point: {
          pixelSize: 8,
          color: Cesium.Color.CYAN,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2
        }
      });
      
      if (positions.length >= 3) {
        if (polygonEntity) {
          this.viewer.entities.remove(polygonEntity);
        }
        
        polygonEntity = this.viewer.entities.add({
          polygon: {
            hierarchy: positions,
            material: Cesium.Color.CYAN.withAlpha(0.5),
            outline: true,
            outlineColor: Cesium.Color.CYAN
          }
        });
      }
      
      this.updateStatus(`${positions.length} points added`, 'loading');
      
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    
    handler.setInputAction(() => {
      if (positions.length >= 3) {
        const area = this.calculatePolygonArea(positions);
        
        const resultsDiv = document.getElementById('measurementResults');
        if (resultsDiv) {
          resultsDiv.innerHTML = `<strong>Area:</strong> ${area.toFixed(2)} m²`;
        }
        
        this.updateStatus(`Area: ${area.toFixed(2)} m²`, 'success');
      }
      handler.destroy();
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  };

  // Calculate polygon area
  BimViewer.calculatePolygonArea = function(positions) {
    if (positions.length < 3) return 0;
    
    let area = 0;
    for (let i = 0; i < positions.length; i++) {
      const j = (i + 1) % positions.length;
      const p1 = Cesium.Cartographic.fromCartesian(positions[i]);
      const p2 = Cesium.Cartographic.fromCartesian(positions[j]);
      area += p1.longitude * p2.latitude;
      area -= p2.longitude * p1.latitude;
    }
    area = Math.abs(area) / 2;
    
    const earthRadius = 6371000;
    area = area * earthRadius * earthRadius;
    
    return area;
  };

  // Clear all measurements
  BimViewer.clearAllMeasurements = function() {
    const entitiesToRemove = [];
    this.viewer.entities.values.forEach(entity => {
      if (entity.polyline || (entity.point && entity.point.color?.equals(Cesium.Color.YELLOW)) ||
          (entity.point && entity.point.color?.equals(Cesium.Color.CYAN)) ||
          entity.label || entity.polygon?.material?.color?.equals(Cesium.Color.CYAN.withAlpha(0.5))) {
        entitiesToRemove.push(entity);
      }
    });
    
    entitiesToRemove.forEach(entity => {
      this.viewer.entities.remove(entity);
    });
    
    const resultsDiv = document.getElementById('measurementResults');
    if (resultsDiv) {
      resultsDiv.innerHTML = '<small style="color: #888;">Results will appear here</small>';
    }
    
    if (measurementState.measure?.clearMeasurements) {
      measurementState.measure.clearMeasurements();
    }
    
    this.updateStatus('All measurements cleared', 'success');
  };

  // Check if measuring
  BimViewer.isMeasuring = function() {
    return measurementState.activeMeasurement !== null;
  };

  // Store measurement state globally
  BimViewer.measurementState = measurementState;

})();

// ===============================
// AUTO-INITIALIZE MEASUREMENTS
// ===============================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (BimViewer?.viewer && !BimViewer.measurementState?.isInitialized && !BimViewer.measurementState?.isInitializing) {
      console.log('📏 Auto-initializing Ion Measurements on DOMContentLoaded');
      setTimeout(() => BimViewer.initIonMeasurements(), 500);
    }
  });
} else {
  if (BimViewer?.viewer && !BimViewer.measurementState?.isInitialized && !BimViewer.measurementState?.isInitializing) {
    console.log('📏 Auto-initializing Ion Measurements immediately');
    setTimeout(() => BimViewer.initIonMeasurements(), 500);
  }
}

console.log('✅ Measurement module with auto-init loaded (v2.1 - Fixed double initialization)');
