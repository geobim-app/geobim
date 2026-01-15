// ===============================
// CESIUM BIM VIEWER - CORE MODULE (v3.3.2 - Dynamic Ion Token)
// Main viewer initialization and asset management
// Version: 3.3.2 - Ion Token now comes from auth.js (user input)
// ===============================
'use strict';

console.log('🔧 Loading core.js v3.3.2 - Dynamic Ion Token');

// ===============================
// CONFIGURATION
// ===============================
const CONFIG = {
  cesium: {
    // ✅ REMOVED: Hardcoded ION_TOKEN - now comes from auth.js via user input
    // Token is set dynamically in init() via BimAuth.getIonToken()
    IMAGERY_ASSET_ID: 3830182,
    GOOGLE_3D_TILES_ASSET_ID: 2275207,
    OSM_BUILDINGS_ASSET_ID: 96188
  },
  
  camera: {
    DEFAULT_POSITION: {
      longitude: 10.9544,
      latitude: 50.7323,
      height: 10000000,
      heading: 0,
      pitch: -89
    }
  },
  
  performance: {
    presets: {
      PERFORMANCE: {
        name: 'Performance',
        screenSpaceError: 8,
        memoryUsage: 1024,
        shadowSize: 1024,
        lodQuality: 1.0,
        enableSSAO: false,
        enableShadows: false,
        enableFXAA: true,
        enableMSAA: false,
        enableHDR: false,
        enableAtmosphere: true,
        enableLighting: true,
        skipLevelOfDetail: true,
        cullRequestsWhileMoving: true,
        preloadWhenHidden: false,
        preloadFlightDestinations: false,
        dynamicScreenSpaceError: false
      },
      
      BALANCED: {
        name: 'Balanced',
        screenSpaceError: 3,
        memoryUsage: 2048,
        shadowSize: 2048,
        lodQuality: 2.0,
        enableSSAO: false,
        enableShadows: true,
        enableFXAA: true,
        enableMSAA: false,
        enableHDR: true,
        enableAtmosphere: true,
        enableLighting: true,
        skipLevelOfDetail: true,
        cullRequestsWhileMoving: false,
        preloadWhenHidden: true,
        preloadFlightDestinations: false,
        dynamicScreenSpaceError: true
      },
      
      QUALITY: {
        name: 'Quality',
        screenSpaceError: 1.5,
        memoryUsage: 4096,
        shadowSize: 4096,
        lodQuality: 3.0,
        enableSSAO: true,
        enableShadows: true,
        enableFXAA: true,
        enableMSAA: false,
        enableHDR: true,
        enableAtmosphere: true,
        enableLighting: true,
        skipLevelOfDetail: false,
        cullRequestsWhileMoving: false,
        preloadWhenHidden: true,
        preloadFlightDestinations: true,
        dynamicScreenSpaceError: true
      },
      
      ULTRA: {
        name: 'Ultra',
        screenSpaceError: 1.0,
        memoryUsage: 8192,
        shadowSize: 4096,
        lodQuality: 4.0,
        enableSSAO: true,
        enableShadows: true,
        enableFXAA: false,
        enableMSAA: true,
        enableHDR: true,
        enableAtmosphere: true,
        enableLighting: true,
        skipLevelOfDetail: false,
        cullRequestsWhileMoving: false,
        preloadWhenHidden: true,
        preloadFlightDestinations: true,
        dynamicScreenSpaceError: true,
        dynamicScreenSpaceErrorDensity: 0.00278,
        dynamicScreenSpaceErrorFactor: 4.0,
        dynamicScreenSpaceErrorHeightFalloff: 0.25
      }
    }
  }
};

// ===============================
// IFC ENTITY DEFINITIONS
// ===============================
const IFC_ENTITIES = [
  { entity: 'IfcWall', displayName: 'Wall', color: '#B0B0B0', category: 'structure' },
  { entity: 'IfcWallStandardCase', displayName: 'Standard Wall', color: '#A0A0A0', category: 'structure' },
  { entity: 'IfcColumn', displayName: 'Column', color: '#808080', category: 'structure' },
  { entity: 'IfcBeam', displayName: 'Beam', color: '#696969', category: 'structure' },
  { entity: 'IfcSlab', displayName: 'Slab', color: '#C0C0C0', category: 'structure' },
  { entity: 'IfcRoof', displayName: 'Roof', color: '#8B4513', category: 'structure' },
  { entity: 'IfcFooting', displayName: 'Footing', color: '#654321', category: 'structure' },
  { entity: 'IfcPile', displayName: 'Pile', color: '#5C4033', category: 'structure' },
  { entity: 'IfcDoor', displayName: 'Door', color: '#DEB887', category: 'interior' },
  { entity: 'IfcWindow', displayName: 'Window', color: '#87CEEB', category: 'interior' },
  { entity: 'IfcStair', displayName: 'Stair', color: '#D2691E', category: 'interior' },
  { entity: 'IfcRailing', displayName: 'Railing', color: '#A9A9A9', category: 'interior' },
  { entity: 'IfcRamp', displayName: 'Ramp', color: '#CD853F', category: 'interior' },
  { entity: 'IfcCurtainWall', displayName: 'Curtain Wall', color: '#B0E0E6', category: 'interior' },
  { entity: 'IfcPlate', displayName: 'Plate', color: '#D3D3D3', category: 'interior' },
  { entity: 'IfcCovering', displayName: 'Covering', color: '#F5DEB3', category: 'interior' },
  { entity: 'IfcPipeSegment', displayName: 'Pipe Segment', color: '#4169E1', category: 'mep' },
  { entity: 'IfcPipeFitting', displayName: 'Pipe Fitting', color: '#1E90FF', category: 'mep' },
  { entity: 'IfcDuctSegment', displayName: 'Duct Segment', color: '#87CEFA', category: 'mep' },
  { entity: 'IfcDuctFitting', displayName: 'Duct Fitting', color: '#00BFFF', category: 'mep' },
  { entity: 'IfcFlowTerminal', displayName: 'Flow Terminal', color: '#ADD8E6', category: 'mep' },
  { entity: 'IfcCableSegment', displayName: 'Cable Segment', color: '#FFD700', category: 'mep' },
  { entity: 'IfcCableCarrierSegment', displayName: 'Cable Carrier', color: '#FFA500', category: 'mep' },
  { entity: 'IfcLightFixture', displayName: 'Light Fixture', color: '#FFFF00', category: 'mep' },
  { entity: 'IfcSpace', displayName: 'Space', color: '#E0E0E0', category: 'building' },
  { entity: 'IfcBuildingStorey', displayName: 'Building Storey', color: '#D3D3D3', category: 'building' },
  { entity: 'IfcBuilding', displayName: 'Building', color: '#C0C0C0', category: 'building' },
  { entity: 'IfcSite', displayName: 'Site', color: '#90EE90', category: 'building' },
  { entity: 'IfcFurnishingElement', displayName: 'Furniture', color: '#8B4513', category: 'other' },
  { entity: 'IfcBuildingElementProxy', displayName: 'Proxy Element', color: '#A9A9A9', category: 'other' },
  { entity: 'IfcMember', displayName: 'Member', color: '#778899', category: 'other' },
  { entity: 'IfcOpeningElement', displayName: 'Opening', color: '#FFFFFF', category: 'other' }
];

console.log('✅ Config and IFC_ENTITIES loaded');

// ===============================
// MAIN BIM VIEWER OBJECT
// ===============================
const BimViewer = {
  viewer: null,
  availableAssets: [],
  loadedAssets: new Map(),
  nextAssetId: 1,
  firstAssetLoaded: false,
  
  terrain: {
    worldTerrain: null,
    ellipsoid: null,
    current: 'worldTerrain'
  },
  
  googleTiles: {
    tileset: null,
    enabled: false,
    isLoading: false
  },
  
  osmBuildings: {
    tileset: null,
    enabled: true,
    isLoading: false
  },
  
  drawing: {
    active: false,
    positions: [],
    polygon: null,
    visible: true,
    clipBoth: false
  },
  
  savedViews: new Map(),
  nextViewSlot: 1,
  
  ifcFilter: {
    enabledEntities: new Set(),
    allEntities: new Set()
  },
  
  performance: {
    fps: 0,
    lastFrameTime: 0
  },
  
  selectedFeature: undefined,
  selectedOriginalColor: new Cesium.Color(),
  
  globeTransparency: {
    enabled: false,
    currentAlpha: 1.0
  },
  
  undergroundMode: {
    enabled: false
  },

  async init() {
    console.log('🚀 Initializing BIM Viewer v3.3.2 (Dynamic Ion Token)...');
    
    try {
      // ✅ NEW: Get Ion Token from auth.js (user input)
      const ionToken = BimAuth.getIonToken();
      
      if (!ionToken) {
        console.error('❌ No Cesium Ion Token available!');
        this.updateStatus('No Ion Token - please login and enter token', 'error');
        return;
      }
      
      Cesium.Ion.defaultAccessToken = ionToken;
      console.log('✅ Ion Token applied from user input');
      
      console.log('🌍 Loading Cesium World Terrain...');
      
      this.viewer = new Cesium.Viewer('cesiumContainer', {
        terrain: Cesium.Terrain.fromWorldTerrain(),
        baseLayerPicker: true,
        geocoder: true,
        homeButton: true,
        sceneModePicker: true,
        navigationHelpButton: true,
        animation: false,
        timeline: true,
        fullscreenButton: true,
        vrButton: false,
        infoBox: false,
        selectionIndicator: false,
        shadows: true,
        shouldAnimate: true,
        sceneMode: Cesium.SceneMode.SCENE3D,
        mapProjection: new Cesium.WebMercatorProjection(),
        skyBox: new Cesium.SkyBox({
          sources: {
            positiveX: 'https://cesium.com/downloads/cesiumjs/releases/1.134/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_px.jpg',
            negativeX: 'https://cesium.com/downloads/cesiumjs/releases/1.134/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_mx.jpg',
            positiveY: 'https://cesium.com/downloads/cesiumjs/releases/1.134/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_py.jpg',
            negativeY: 'https://cesium.com/downloads/cesiumjs/releases/1.134/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_my.jpg',
            positiveZ: 'https://cesium.com/downloads/cesiumjs/releases/1.134/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_pz.jpg',
            negativeZ: 'https://cesium.com/downloads/cesiumjs/releases/1.134/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_mz.jpg'
          }
        }),
        msaaSamples: 4,
        requestRenderMode: false,
        maximumRenderTimeChange: Infinity
      });
      
      console.log('✅ Viewer created with World Terrain');
      
      this.viewer.scene.renderError.addEventListener((scene, error) => {
        console.error('🔴 Cesium Rendering Error:', error);
        
        if (error.message && error.message.includes('propertiesBySemantic')) {
          console.warn('⚠️ Property/Semantic error detected - attempting to continue rendering...');
        }
        
        try {
          scene.requestRender();
          this.updateStatus('Rendering error occurred - attempting recovery', 'error');
        } catch (restartError) {
          console.error('❌ Failed to restart rendering:', restartError);
        }
      });
      
      this.terrain.worldTerrain = this.viewer.scene.terrain;
      this.terrain.current = 'worldTerrain';
      this.terrain.ellipsoid = new Cesium.EllipsoidTerrainProvider();
      
      try {
        console.log('📷 Loading Bing Aerial Maps...');
        const bingImagery = await Cesium.IonImageryProvider.fromAssetId(2);
        this.viewer.imageryLayers.addImageryProvider(bingImagery);
        console.log('✅ Bing Aerial Maps added successfully');
      } catch (error) {
        console.warn('⚠️ Could not load Bing Maps:', error.message);
        try {
          const imageryProvider = await Cesium.IonImageryProvider.fromAssetId(CONFIG.cesium.IMAGERY_ASSET_ID);
          this.viewer.imageryLayers.addImageryProvider(imageryProvider);
        } catch (fallbackError) {
          console.warn('⚠️ Using OSM imagery as fallback');
          this.viewer.imageryLayers.addImageryProvider(
            new Cesium.OpenStreetMapImageryProvider({
              url: 'https://a.tile.openstreetmap.org/'
            })
          );
        }
      }

      const scene = this.viewer.scene;
      
      scene.globe.show = true;
      scene.globe.enableLighting = true;
      scene.globe.depthTestAgainstTerrain = true;
      scene.skyBox.show = true;
      scene.skyAtmosphere.show = true;
      scene.sun.show = true;
      scene.moon.show = true;
      
      console.log('✅ Globe, sky, and atmosphere configured');
      
      setTimeout(() => {
        const layerCount = this.viewer.imageryLayers.length;
        if (layerCount === 0) {
          console.error('❌ No imagery layers!');
          this.fixGlobeVisibility();
        } else {
          console.log(`✅ Globe working correctly (${layerCount} layer(s))`);
        }
      }, 1000);
      
      this.initIFCFilter();
      this.initCamera();
      this.initZOffset();

      console.log('✅ BIM Viewer initialized successfully');
      this.updateStatus('BIM Viewer ready', 'success');
      
      if (typeof this.initIonMeasurements === 'function') {
        this.initIonMeasurements();
      }
      
    } catch (error) {
      console.error('❌ Failed to initialize viewer:', error);
      this.updateStatus(`Initialization failed: ${error.message}`, 'error');
      throw error;
    }
  },

  initCamera() {
    const {longitude, latitude, height, heading, pitch} = CONFIG.camera.DEFAULT_POSITION;
    this.viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
      orientation: {
        heading: Cesium.Math.toRadians(heading),
        pitch: Cesium.Math.toRadians(pitch),
        roll: 0
      }
    });
  },

  async toggleGoogle3DTiles() {
    if (this.googleTiles.isLoading) return;

    if (!this.googleTiles.tileset) {
      try {
        this.googleTiles.isLoading = true;
        this.updateStatus('Loading Google 3D Tiles...', 'loading');
        
        const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(CONFIG.cesium.GOOGLE_3D_TILES_ASSET_ID);
        this.viewer.scene.primitives.add(tileset);
        this.enableTilesetLighting(tileset);
        
        this.googleTiles.tileset = tileset;
        this.googleTiles.enabled = true;
        this.googleTiles.isLoading = false;
        
        this.viewer.scene.globe.show = false;
        
        if (this.osmBuildings.tileset) {
          this.osmBuildings.tileset.show = false;
          this.osmBuildings.enabled = false;
        }
        
        console.log('✅ Google 3D Tiles loaded');
        this.updateStatus('Google 3D Tiles enabled', 'success');
        
      } catch (error) {
        console.error('❌ Failed to load Google 3D Tiles:', error);
        this.googleTiles.isLoading = false;
        this.updateStatus('Failed to load Google 3D Tiles', 'error');
      }
    } else {
      this.googleTiles.enabled = !this.googleTiles.enabled;
      this.googleTiles.tileset.show = this.googleTiles.enabled;
      
      if (this.googleTiles.enabled) {
        this.viewer.scene.globe.show = false;
        if (this.osmBuildings.tileset) {
          this.osmBuildings.tileset.show = false;
          this.osmBuildings.enabled = false;
        }
      } else {
        this.viewer.scene.globe.show = true;
        if (this.osmBuildings.tileset) {
          this.osmBuildings.tileset.show = true;
          this.osmBuildings.enabled = true;
        }
      }
      
      this.updateStatus(`Google 3D Tiles ${this.googleTiles.enabled ? 'enabled' : 'disabled'}`, 'success');
    }
  },

  async toggleOSMBuildings() {
    if (this.osmBuildings.isLoading) return;

    if (this.googleTiles.enabled && this.googleTiles.tileset && this.googleTiles.tileset.show) {
      this.updateStatus('Disable Google 3D Tiles first', 'warning');
      return;
    }

    if (!this.osmBuildings.tileset) {
      try {
        this.osmBuildings.isLoading = true;
        this.updateStatus('Loading OSM Buildings...', 'loading');
        
        const tileset = await Cesium.createOsmBuildingsAsync();
        this.viewer.scene.primitives.add(tileset);
        this.enableTilesetLighting(tileset);
        
        this.osmBuildings.tileset = tileset;
        this.osmBuildings.enabled = true;
        this.osmBuildings.isLoading = false;
        
        console.log('✅ OSM Buildings loaded');
        this.updateStatus('OSM Buildings enabled', 'success');
        
      } catch (error) {
        console.error('❌ Failed to load OSM Buildings:', error);
        this.osmBuildings.isLoading = false;
        this.updateStatus('Failed to load OSM Buildings', 'error');
      }
    } else {
      this.osmBuildings.enabled = !this.osmBuildings.enabled;
      this.osmBuildings.tileset.show = this.osmBuildings.enabled;
      this.updateStatus(`OSM Buildings ${this.osmBuildings.enabled ? 'enabled' : 'disabled'}`, 'success');
    }
  },

  async fetchAvailableAssets() {
    try {
      // ✅ Use token from auth.js
      const ionToken = BimAuth.getIonToken();
      const response = await fetch(`https://api.cesium.com/v1/assets?access_token=${ionToken}`);
      const data = await response.json();
      this.availableAssets = data.items || [];
      return this.availableAssets;
    } catch (error) {
      console.error('Failed to fetch assets:', error);
      throw error;
    }
  },

  async loadSelectedAsset(assetId, assetName = null) {
    if (!assetId || this.loadedAssets.has(assetId.toString())) return;

    try {
      this.updateStatus(`Loading asset ${assetId}...`, 'loading');
      
      const resource = await Cesium.IonResource.fromAssetId(assetId);
      const tileset = await Cesium.Cesium3DTileset.fromUrl(resource, {
        maximumScreenSpaceError: 3,
        maximumMemoryUsage: 2048,
        skipLevelOfDetail: false,
        baseScreenSpaceError: 1024,
        skipScreenSpaceErrorFactor: 16,
        skipLevels: 1,
        immediatelyLoadDesiredLevelOfDetail: false,
        loadSiblings: false,
        cullWithChildrenBounds: true
      });

      if (tileset && tileset.tileLoadProgressEvent) {
        tileset.tileLoadProgressEvent.addEventListener((length) => {
          if (length === 0) {
            console.log(`✅ All tiles loaded for asset ${assetId}`);
          }
        });
      }

      if (tileset && tileset.tileFailed) {
        tileset.tileFailed.addEventListener((error) => {
          console.warn(`⚠️ Tile loading failed for asset ${assetId}:`, error);
        });
      }

      this.viewer.scene.primitives.add(tileset);
      this.enableTilesetLighting(tileset);
      
      const assetData = {
        id: assetId,
        name: assetName || `Asset ${assetId}`,
        tileset: tileset,
        visible: true,
        opacity: 1.0,
        type: '3DTILES',
        ifcPropertyName: undefined
      };
      
      this.loadedAssets.set(assetId.toString(), assetData);
      await tileset.readyPromise;

      if (typeof this.applyIFCFilter === 'function') {
        await this.applyIFCFilter();
      }
      
      if (typeof this.isPointCloudTileset === 'function' && typeof this.applyPointCloudSettings === 'function') {
        if (this.isPointCloudTileset(tileset)) {
          this.applyPointCloudSettings(tileset);
        }
      }
      
      if (typeof BimViewer.updateZOffsetAssetsList === 'function') {
        setTimeout(() => BimViewer.updateZOffsetAssetsList(), 100);
      }

      if (window.BimViewerUI && typeof BimViewerUI.createAssetControls === 'function') {
        BimViewerUI.createAssetControls(assetId);
      }
      
      if (!this.firstAssetLoaded) {
        this.firstAssetLoaded = true;
        await this.viewer.flyTo(tileset);
      }
      
      this.updateStatus(`Asset loaded: ${assetData.name}`, 'success');
      
      this.viewer.scene.globe.show = true;
      this.viewer.scene.skyBox.show = true;
      this.viewer.scene.skyAtmosphere.show = true;
      
      setTimeout(async () => {
        try {
          if (typeof this.detectIFCProperties === 'function') {
            const detectedProp = await this.detectIFCProperties(assetData.tileset);
            if (detectedProp) {
              assetData.ifcPropertyName = detectedProp;
              if (typeof this.applyIFCFilter === 'function') {
                await this.applyIFCFilter();
              }
            }
          }
        } catch (detectError) {
          console.error(`❌ Detection failed for asset ${assetId}:`, detectError);
        }
      }, 3000);
      
    } catch (error) {
      console.error('Failed to load asset:', error);
      this.updateStatus('Failed to load asset', 'error');
    }
  },

  async loadITwinModel(shareKey, iModelId, modelName = null) {
    if (!shareKey || !iModelId) {
      this.updateStatus('❌ Share Key and iModel ID required', 'error');
      return;
    }

    const assetKey = `itwin_${iModelId}`;
    if (this.loadedAssets.has(assetKey)) {
      this.updateStatus('⚠️ Model already loaded', 'warning');
      return;
    }

    try {
      this.updateStatus(`Loading iTwin Model...`, 'loading');
      
      Cesium.ITwinPlatform.defaultShareKey = shareKey;
      
      const tileset = await Cesium.ITwinData.createTilesetFromIModelId({
        iModelId: iModelId
      });
      
      if (!tileset) {
        throw new Error('Tileset could not be created');
      }
      
      tileset.colorBlendMode = Cesium.Cesium3DTileColorBlendMode.REPLACE;
      this.viewer.scene.primitives.add(tileset);
      this.enableTilesetLighting(tileset);
      
      await tileset.readyPromise;
      
      const assetData = {
        id: assetKey,
        name: modelName || `🏗️ iTwin Model`,
        tileset: tileset,
        visible: true,
        opacity: 1.0,
        type: 'ITWIN',
        iModelId: iModelId,
        shareKey: shareKey,
        ifcPropertyName: undefined
      };
      
      this.loadedAssets.set(assetKey, assetData);
      
      if (typeof BimViewer.updateZOffsetAssetsList === 'function') {
        setTimeout(() => BimViewer.updateZOffsetAssetsList(), 100);
      }
      
      this.viewer.flyTo(tileset, {
        duration: 2.0,
        offset: new Cesium.HeadingPitchRange(0, -0.5, 500)
      });
      
      if (typeof this.applyIFCFilter === 'function') {
        setTimeout(() => this.applyIFCFilter(), 1000);
      }
      
      if (window.BimViewerUI && typeof BimViewerUI.createAssetControls === 'function') {
        BimViewerUI.createAssetControls(assetKey);
      }
      
      if (!this.firstAssetLoaded) {
        this.firstAssetLoaded = true;
      }
      
      this.updateStatus(`✅ iTwin Model loaded`, 'success');
      
      this.viewer.scene.globe.show = true;
      this.viewer.scene.skyBox.show = true;
      this.viewer.scene.skyAtmosphere.show = true;
      
      setTimeout(async () => {
        try {
          if (typeof this.detectIFCProperties === 'function') {
            const detectedProp = await this.detectIFCProperties(tileset);
            if (detectedProp) {
              assetData.ifcPropertyName = detectedProp;
              if (typeof this.applyIFCFilter === 'function') {
                await this.applyIFCFilter();
              }
            }
          }
        } catch (error) {
          console.error(`❌ iTwin detection failed:`, error);
        }
      }, 3000);
      
    } catch (error) {
      console.error('❌ iTwin Model import error:', error);
      this.updateStatus(`iTwin import failed: ${error.message}`, 'error');
    }
  },

  unloadAsset(assetId) {
    const assetData = this.loadedAssets.get(assetId.toString());
    if (!assetData) return;

    if (assetData.tileset) {
      this.viewer.scene.primitives.remove(assetData.tileset);
    }
    
    this.loadedAssets.delete(assetId.toString());
    
    if (typeof BimViewer.updateZOffsetAssetsList === 'function') {
      setTimeout(() => BimViewer.updateZOffsetAssetsList(), 100);
    }
    
    const assetDiv = document.getElementById(`asset_${assetId}`);
    if (assetDiv) assetDiv.remove();
    
    this.updateStatus(`Asset unloaded`, 'success');
  },

  zoomToAsset(assetId) {
    const assetData = this.loadedAssets.get(assetId.toString());
    if (assetData && assetData.tileset) {
      this.viewer.flyTo(assetData.tileset);
    }
  },

  toggleAssetVisibility(assetId) {
    const assetData = this.loadedAssets.get(assetId.toString());
    if (!assetData) return;

    assetData.visible = !assetData.visible;
    assetData.tileset.show = assetData.visible;
    
    const btn = document.querySelector(`#asset_${assetId} .asset-btn-visibility`);
    if (btn) btn.textContent = assetData.visible ? '👁️' : '🚫';
  },

  updateAssetOpacity(assetId, opacity) {
    const assetData = this.loadedAssets.get(assetId.toString());
    if (!assetData) return;

    assetData.opacity = parseFloat(opacity);
    
    const valueEl = document.getElementById(`opacityValue_${assetId}`);
    if (valueEl) valueEl.textContent = Math.round(opacity * 100) + '%';
    
    if (typeof this.applyIFCFilter === 'function') {
      this.applyIFCFilter();
    }
  },

  initIFCFilter() {
    IFC_ENTITIES.forEach(entity => {
      this.ifcFilter.allEntities.add(entity.entity);
      this.ifcFilter.enabledEntities.add(entity.entity);
    });
  },

  applyPerformanceSettings(settings) {
    const scene = this.viewer.scene;
    scene.postProcessStages.fxaa.enabled = settings.enableFXAA;
    scene.msaaSamples = settings.enableMSAA ? 4 : 1;
    scene.highDynamicRange = settings.enableHDR;
    scene.globe.enableLighting = settings.enableLighting;
    scene.skyAtmosphere.show = settings.enableAtmosphere;
    scene.shadowMap.enabled = settings.enableShadows;
  },

  toggleGlobeTransparency() {
    this.globeTransparency.enabled = !this.globeTransparency.enabled;
    this.viewer.scene.globe.translucency.enabled = this.globeTransparency.enabled;
    
    if (this.globeTransparency.enabled) {
      this.setGlobeTransparency(this.globeTransparency.currentAlpha);
    }
  },

  setGlobeTransparency(alpha) {
    this.globeTransparency.currentAlpha = alpha;
    const globe = this.viewer.scene.globe;
    globe.translucency.enabled = true;
    globe.translucency.frontFaceAlpha = alpha;
    globe.translucency.backFaceAlpha = alpha;
  },

  setGlobeFadeByDistance(nearDistance, nearAlpha, farDistance, farAlpha) {
    const globe = this.viewer.scene.globe;
    
    if (nearDistance === null) {
      globe.translucency.frontFaceAlphaByDistance = undefined;
      globe.translucency.backFaceAlphaByDistance = undefined;
      return;
    }
    
    globe.translucency.frontFaceAlphaByDistance = new Cesium.NearFarScalar(nearDistance, nearAlpha, farDistance, farAlpha);
    globe.translucency.backFaceAlphaByDistance = new Cesium.NearFarScalar(nearDistance, nearAlpha, farDistance, farAlpha);
  },

  toggleUndergroundView() {
    this.undergroundMode.enabled = !this.undergroundMode.enabled;
    const scene = this.viewer.scene;
    
    scene.screenSpaceCameraController.enableCollisionDetection = !this.undergroundMode.enabled;
    scene.globe.depthTestAgainstTerrain = !this.undergroundMode.enabled;
    this.viewer.scene.screenSpaceCameraController.minimumZoomDistance = this.undergroundMode.enabled ? 0.1 : 1.0;
  },

  flyToUnderground(longitude, latitude, height, heading = 0, pitch = -45) {
    this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
      orientation: {
        heading: Cesium.Math.toRadians(heading),
        pitch: Cesium.Math.toRadians(pitch),
        roll: 0.0
      },
      duration: 3.0
    });
  },

  updateStatus(message, type = 'success') {
    const statusIndicator = document.querySelector('.status-indicator');
    if (!statusIndicator) return;
    
    statusIndicator.textContent = message;
    statusIndicator.className = `status-indicator ${type}`;
    statusIndicator.style.display = 'block';
    
    setTimeout(() => {
      statusIndicator.style.display = 'none';
    }, 3000);
  },

  enableTilesetLighting(tileset) {
    if (!tileset) return;
    
    try {
      if (tileset.imageBasedLighting) {
        tileset.imageBasedLighting.enabled = true;
        tileset.imageBasedLighting.luminanceAtZenith = 0.5;
      }
      
      if (this.lighting?.enabled) {
        tileset.shadows = Cesium.ShadowMode.ENABLED;
      }
    } catch (error) {
      console.warn('Could not enable lighting for tileset:', error.message);
    }
  },

  updateModeIndicator() {
    const indicator = document.getElementById('modeIndicator');
    if (indicator && this.drawing.active) {
      indicator.classList.add('active');
      indicator.innerHTML = `✏️ DRAWING MODE - Points: ${this.drawing.positions.length}`;
    } else if (indicator) {
      indicator.classList.remove('active');
    }
  },

  updateClippingModeUI() {
    const btn = document.getElementById('toggleClipMode');
    if (btn) {
      btn.textContent = this.drawing.clipBoth ? '🌍 Buildings + Terrain' : '🏙️ Buildings Only';
      btn.classList.toggle('active', this.drawing.clipBoth);
    }
  },

  fixGlobeVisibility() {
    console.log('🔧 Fixing globe visibility...');
    const scene = this.viewer.scene;
    
    scene.globe.show = true;
    scene.skyBox.show = true;
    scene.skyAtmosphere.show = true;
    scene.sun.show = true;
    scene.moon.show = true;
    
    if (this.viewer.imageryLayers.length === 0) {
      try {
        const osmProvider = new Cesium.OpenStreetMapImageryProvider({
          url: 'https://a.tile.openstreetmap.org/'
        });
        this.viewer.imageryLayers.addImageryProvider(osmProvider);
      } catch (error) {
        console.error('❌ Failed to add OSM imagery:', error.message);
      }
    }
    
    scene.requestRender();
    this.updateStatus('Globe visibility restored', 'success');
  }
};

// Expose globally
window.BimViewer = BimViewer;
window.CONFIG = CONFIG;
window.IFC_ENTITIES = IFC_ENTITIES;

console.log('✅ BimViewer object created (v3.3.2 - Dynamic Ion Token)');

// Global Error Handler
window.addEventListener('error', function(event) {
  if (event.error && event.error.message && event.error.message.includes('propertiesBySemantic')) {
    console.warn('⚠️ Property/Semantic error caught globally');
    event.preventDefault();
    event.stopPropagation();
    
    if (window.BimViewer && window.BimViewer.viewer) {
      try {
        window.BimViewer.viewer.scene.requestRender();
      } catch (restartError) {
        console.error('Failed to restart rendering:', restartError);
      }
    }
    return false;
  }
}, true);

// ✅ CHANGED: Don't auto-init - wait for auth and token
// BimViewer.init() will be called from index.html after login + token entry
console.log('✅ Core module v3.3.2 loaded - Waiting for auth and Ion Token...');
