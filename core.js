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
        dynamicScreenSpaceError: false,
        shadowMaxDistance: 150.0,
        shadowBias: 0.005
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
        dynamicScreenSpaceError: true,
        shadowMaxDistance: 300.0,
        shadowBias: 0.003
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
        dynamicScreenSpaceError: true,
        ssaoIntensity: 8.8,
        ssaoBias: 0.26,
        ssaoLengthCap: 0.07,
        ssaoDirections: 16,
        ssaoStepSize: 2.0,
        ssaoFrustumLength: 1000.0,
        ssaoBlurStepSize: 0.86,
        shadowMaxDistance: 500.0,
        shadowBias: 0.002
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
        dynamicScreenSpaceErrorHeightFalloff: 0.25,
        ssaoIntensity: 8.8,
        ssaoBias: 0.24,
        ssaoLengthCap: 0.07,
        ssaoDirections: 16,
        ssaoStepSize: 2.0,
        ssaoFrustumLength: 1000.0,
        ssaoBlurStepSize: 0.72,
        shadowMaxDistance: 400.0,
        shadowBias: 0.001
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
// REVIT CATEGORY DEFINITIONS (English)
// ===============================
const REVIT_CATEGORIES = [
  // Structure
  { category: 'Walls', displayName: 'Walls', color: '#B0B0B0', group: 'structure' },
  { category: 'Structural Walls', displayName: 'Structural Walls', color: '#A0A0A0', group: 'structure' },
  { category: 'Structural Columns', displayName: 'Structural Columns', color: '#808080', group: 'structure' },
  { category: 'Structural Framing', displayName: 'Structural Framing', color: '#696969', group: 'structure' },
  { category: 'Structural Foundations', displayName: 'Foundations', color: '#654321', group: 'structure' },
  { category: 'Floors', displayName: 'Floors', color: '#C0C0C0', group: 'structure' },
  { category: 'Roofs', displayName: 'Roofs', color: '#8B4513', group: 'structure' },
  { category: 'Columns', displayName: 'Columns', color: '#707070', group: 'structure' },
  // Interior
  { category: 'Doors', displayName: 'Doors', color: '#DEB887', group: 'interior' },
  { category: 'Windows', displayName: 'Windows', color: '#87CEEB', group: 'interior' },
  { category: 'Stairs', displayName: 'Stairs', color: '#D2691E', group: 'interior' },
  { category: 'Railings', displayName: 'Railings', color: '#A9A9A9', group: 'interior' },
  { category: 'Ramps', displayName: 'Ramps', color: '#CD853F', group: 'interior' },
  { category: 'Curtain Walls', displayName: 'Curtain Walls', color: '#B0E0E6', group: 'interior' },
  { category: 'Curtain Panels', displayName: 'Curtain Panels', color: '#ADD8E6', group: 'interior' },
  { category: 'Ceilings', displayName: 'Ceilings', color: '#F5F5DC', group: 'interior' },
  { category: 'Floors', displayName: 'Floors', color: '#D2B48C', group: 'interior' },
  // MEP
  { category: 'Pipes', displayName: 'Pipes', color: '#4169E1', group: 'mep' },
  { category: 'Pipe Fittings', displayName: 'Pipe Fittings', color: '#1E90FF', group: 'mep' },
  { category: 'Ducts', displayName: 'Ducts', color: '#87CEFA', group: 'mep' },
  { category: 'Duct Fittings', displayName: 'Duct Fittings', color: '#00BFFF', group: 'mep' },
  { category: 'Cable Trays', displayName: 'Cable Trays', color: '#FFD700', group: 'mep' },
  { category: 'Conduits', displayName: 'Conduits', color: '#FFA500', group: 'mep' },
  { category: 'Lighting Fixtures', displayName: 'Lighting Fixtures', color: '#FFFF00', group: 'mep' },
  { category: 'Mechanical Equipment', displayName: 'Mechanical Equipment', color: '#20B2AA', group: 'mep' },
  { category: 'Plumbing Fixtures', displayName: 'Plumbing Fixtures', color: '#5F9EA0', group: 'mep' },
  { category: 'Sprinklers', displayName: 'Sprinklers', color: '#FF6347', group: 'mep' },
  { category: 'Electrical Equipment', displayName: 'Electrical Equipment', color: '#FFD700', group: 'mep' },
  // Other
  { category: 'Furniture', displayName: 'Furniture', color: '#8B4513', group: 'other' },
  { category: 'Casework', displayName: 'Casework', color: '#A0522D', group: 'other' },
  { category: 'Generic Models', displayName: 'Generic Models', color: '#A9A9A9', group: 'other' },
  { category: 'Specialty Equipment', displayName: 'Specialty Equipment', color: '#778899', group: 'other' },
  { category: 'Rooms', displayName: 'Rooms', color: '#E0E0E0', group: 'other' },
  { category: 'Topography', displayName: 'Topography', color: '#90EE90', group: 'other' },
  { category: 'Parking', displayName: 'Parking', color: '#808080', group: 'other' },
  { category: 'Planting', displayName: 'Planting', color: '#228B22', group: 'other' }
];

// German to English category mapping
const CATEGORY_DE_TO_EN = {
  // Structure
  'Wände': 'Walls',
  'Tragende Wände': 'Structural Walls',
  'Tragwerksstützen': 'Structural Columns',
  'Skelettbau': 'Structural Framing',
  'Tragwerksfundamente': 'Structural Foundations',
  'Geschossdecken': 'Floors',
  'Dächer': 'Roofs',
  'Stützen': 'Columns',
  // Interior
  'Türen': 'Doors',
  'Fenster': 'Windows',
  'Treppen': 'Stairs',
  'Geländer': 'Railings',
  'Rampen': 'Ramps',
  'Vorhangfassaden': 'Curtain Walls',
  'Vorhangfassadenpaneele': 'Curtain Panels',
  'Decken': 'Ceilings',
  'Böden': 'Floors',
  // MEP
  'Rohre': 'Pipes',
  'Rohrformteile': 'Pipe Fittings',
  'Luftkanäle': 'Ducts',
  'Luftkanalformteile': 'Duct Fittings',
  'Kabeltrassen': 'Cable Trays',
  'Kabelkanäle': 'Conduits',
  'Beleuchtungskörper': 'Lighting Fixtures',
  'HLS-Bauteile': 'Mechanical Equipment',
  'Sanitärinstallationen': 'Plumbing Fixtures',
  'Sprinkler': 'Sprinklers',
  'Elektroinstallationen': 'Electrical Equipment',
  // Other
  'Möbel': 'Furniture',
  'Einbauteile': 'Casework',
  'Allgemeine Modelle': 'Generic Models',
  'Spezialausstattung': 'Specialty Equipment',
  'Räume': 'Rooms',
  'Topografie': 'Topography',
  'Parkplätze': 'Parking',
  'Bepflanzung': 'Planting'
};

// Helper function to map German category to English
function mapCategoryToEnglish(category) {
  return CATEGORY_DE_TO_EN[category] || category;
}

console.log('✅ REVIT_CATEGORIES (English) loaded with German mapping');

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
    isLoading: false,
    savedBasemapId: null,       // stores basemap ID before Google Tiles removes imagery
    savedTerrainProvider: null, // stores terrain provider before swap to ellipsoid
    activePreset: 'performance' // current quality preset: performance | balanced | quality
  },

  // Google 3D Tiles quality presets
  // Each setting is tuned to balance loading speed vs. tile seam artifacts
  googleTilesPresets: {
    performance: {
      name: 'Performance',
      maximumScreenSpaceError: 16,
      skipLevelOfDetail: true,
      maximumMemoryUsage: 4096,
      backFaceCulling: true,
      preferLeaves: false,
      cullRequestsWhileMovingMultiplier: 60,
      foveatedConeSize: 0.1
    },
    balanced: {
      name: 'Balanced',
      maximumScreenSpaceError: 12,
      skipLevelOfDetail: true,
      maximumMemoryUsage: 4096,
      backFaceCulling: false,
      preferLeaves: false,
      cullRequestsWhileMovingMultiplier: 30,
      foveatedConeSize: 0.2
    },
    quality: {
      name: 'Quality',
      maximumScreenSpaceError: 8,
      skipLevelOfDetail: false,
      maximumMemoryUsage: 2048,
      backFaceCulling: false,
      preferLeaves: true,
      cullRequestsWhileMovingMultiplier: 10,
      foveatedConeSize: 0.3
    }
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

  revitFilter: {
    enabledCategories: new Set(),
    allCategories: new Set()
  },

  performance: {
    fps: 0,
    lastFrameTime: 0
  },
  
  selectedFeature: undefined,
  selectedOriginalColor: new Cesium.Color(),

  // Silhouette
  silhouette: {
    enabled: false,
    stage: null,
    color: Cesium.Color.YELLOW,
    strength: 0.025
  },
  
  globeTransparency: {
    enabled: false,
    currentAlpha: 1.0
  },
  
  undergroundMode: {
    enabled: false
  },

  splitMode: false,

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
        baseLayer: false,   // LayerManager handles basemap
        baseLayerPicker: false,
        geocoder: true,
        homeButton: true,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: true,  // Keep for shadow simulation
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
      
      // Initialize Layer Manager (handles basemap, terrain & overlay management)
      if (typeof LayerManager !== 'undefined') {
        await LayerManager.init(this.viewer);
        console.log('✅ Layer Manager initialized (default basemap: Bing Aerial)');
      } else {
        // Fallback if LayerManager not loaded
        console.warn('⚠️ LayerManager not found, loading Bing Aerial directly');
        try {
          const bingImagery = await Cesium.IonImageryProvider.fromAssetId(2);
          this.viewer.imageryLayers.addImageryProvider(bingImagery);
        } catch (error) {
          console.warn('⚠️ Using OSM imagery as fallback');
          this.viewer.imageryLayers.addImageryProvider(
            new Cesium.OpenStreetMapImageryProvider({
              url: 'https://a.tile.openstreetmap.org/'
            })
          );
        }
      }

      const scene = this.viewer.scene;

      scene.postProcessStages.tonemapper = Cesium.Tonemapper.PBR_NEUTRAL;

      // Pre-load SSAO with optimized BIM defaults (Quality preset values)
      const ao = scene.postProcessStages.ambientOcclusion;
      if (ao) {
        ao.uniforms.intensity = 8.8;
        ao.uniforms.bias = 0.26;
        ao.uniforms.lengthCap = 0.07;
        ao.uniforms.directions = 16;
        ao.uniforms.stepSize = 2.0;
        ao.uniforms.frustumLength = 1000.0;
        ao.uniforms.blurStepSize = 0.86;
      }

      // Reduce sun intensity to prevent overexposed white BIM surfaces
      scene.light = new Cesium.SunLight({
        intensity: 0.75
      });
      console.log('✅ Sun intensity set to 0.75 (reduced from default 1.0)');

      // Shadow quality defaults
      scene.shadowMap.normalOffset = true;
      scene.shadowMap.softShadows = true;
      scene.shadowMap.maximumDistance = 200.0;
      console.log('✅ Shadow quality configured (normalOffset, softShadows, maxDist: 200m)');

      // Helper to adjust sun intensity (called by lighting.js)
      this.setSunIntensity = function(intensity) {
        if (scene.light instanceof Cesium.SunLight) {
          scene.light.intensity = intensity;
        } else {
          scene.light = new Cesium.SunLight({ intensity: intensity });
        }
        console.log('☀️ Sun intensity set to', intensity);
      };

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
      this.initRevitFilter();
      this.initCamera();
      this.initZOffset();
      if (typeof this.initIBL === 'function') {
        this.initIBL();
      }

      // Set initial performance settings reference (PERFORMANCE preset is default)
      this._currentPerformanceSettings = CONFIG.performance.presets.PERFORMANCE;

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
        
        const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(CONFIG.cesium.GOOGLE_3D_TILES_ASSET_ID, {
          maximumScreenSpaceError: 16,
          skipLevelOfDetail: true,
          baseScreenSpaceError: 1024,
          skipScreenSpaceErrorFactor: 16,
          skipLevels: 1,
          immediatelyLoadDesiredLevelOfDetail: false,
          loadSiblings: true,
          cullWithChildrenBounds: true,
          cullRequestsWhileMoving: true,
          cullRequestsWhileMovingMultiplier: 60,
          preloadWhenHidden: true,
          preloadFlightDestinations: true,
          preferLeaves: false,
          backFaceCulling: true,
          maximumMemoryUsage: 4096,
          dynamicScreenSpaceError: true,
          dynamicScreenSpaceErrorDensity: 0.00028,
          dynamicScreenSpaceErrorFactor: 4.0,
          dynamicScreenSpaceErrorHeightFalloff: 0.25,
          foveatedScreenSpaceError: true,
          foveatedConeSize: 0.1,
          foveatedMinimumScreenSpaceErrorRelaxation: 0,
          foveatedInterpolationCallback: Cesium.Math.lerp,
          foveatedTimeDelay: 0.2,
          cacheBytes: 2147483648,
          maximumCacheOverflowBytes: 536870912
        });
        this.viewer.scene.primitives.add(tileset);
        this.enableTilesetLighting(tileset);

        // Disable shadows on Google tiles for performance
        tileset.shadows = Cesium.ShadowMode.DISABLED;

        // Scene-level seam-fix settings
        const scene = this.viewer.scene;
        scene.globe.tileCacheSize = 1000;
        // Seam-fix: fog accentuates tile boundary visibility
        scene.fog.enabled = false;
        // Seam-fix: preload surrounding tiles to fill gaps at edges
        scene.globe.preloadAncestors = true;
        scene.globe.preloadSiblings = true;
        // Seam-fix: disable render throttling so tiles refine without delay
        scene.maximumRenderTimeChange = Infinity;

        // Fix environmentMapManager position — must be set to a real world coordinate
        const self = this;
        const emm = tileset.environmentMapManager;
        if (emm) {
          // Use camera position as the env map sampling point
          emm.position = this.viewer.camera.positionWC.clone();
          emm.enabled = true;
          console.log('✅ [EnvMap] position set to camera:', emm.position);

          // Keep envMap position synced with camera on each render
          this.viewer.scene.postRender.addEventListener(() => {
            if (self.googleTiles.enabled && self.googleTiles.tileset) {
              const em = self.googleTiles.tileset.environmentMapManager;
              if (em && em.enabled) {
                em.position = self.viewer.camera.positionWC;
              }
            }
          });
          this.viewer.scene.requestRender();
        }

        this.googleTiles.tileset = tileset;
        this.googleTiles.enabled = true;
        this.googleTiles.isLoading = false;

        // Apply IBL settings to Google Tiles
        if (this.ibl && typeof this.applyIBLToTileset === 'function') {
          this.applyIBLToTileset(tileset);
        }

        // Hide globe completely — Google 3D Tiles replace terrain
        this.viewer.scene.globe.show = false;
        // Save current terrain provider, then replace with flat ellipsoid so no terrain bleeds through
        this.googleTiles.savedTerrainProvider = this.viewer.terrainProvider;
        this.viewer.terrainProvider = this.terrain.ellipsoid;
        // Dark background behind clipped areas (instead of terrain bleed-through)
        this.viewer.scene.backgroundColor = Cesium.Color.BLACK;

        // Remove base imagery layers — they compete for bandwidth and are invisible under Google tiles
        if (typeof LayerManager !== 'undefined' && LayerManager.activeBasemap) {
          this.googleTiles.savedBasemapId = LayerManager.activeBasemap;
          LayerManager.switchBasemap('none');
          this.viewer.imageryLayers.removeAll(); // hard remove, LayerManager alone doesn't clear viewer.imageryLayers
        } else {
          // Fallback: remove all imagery directly
          this.googleTiles.savedBasemapId = null;
          this.viewer.imageryLayers.removeAll();
        }

        if (this.osmBuildings.tileset) {
          this.osmBuildings.tileset.show = false;
          this.osmBuildings.enabled = false;
        }
        
        // If split mode is active, set RIGHT and create left copy
        if (this.splitMode) {
          tileset.splitDirection = Cesium.SplitDirection.RIGHT;
          if (window.BimViewerUI && typeof BimViewerUI.createGoogleTilesLeftCopy === 'function') {
            BimViewerUI.createGoogleTilesLeftCopy();
          }
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
        // Save current terrain provider, then replace with flat ellipsoid
        this.googleTiles.savedTerrainProvider = this.viewer.terrainProvider;
        this.viewer.terrainProvider = this.terrain.ellipsoid;
        this.viewer.scene.backgroundColor = Cesium.Color.BLACK;
        // Remove base imagery layers — they compete for bandwidth under Google tiles
        if (typeof LayerManager !== 'undefined' && LayerManager.activeBasemap) {
          this.googleTiles.savedBasemapId = LayerManager.activeBasemap;
          LayerManager.switchBasemap('none');
          this.viewer.imageryLayers.removeAll(); // hard remove, LayerManager alone doesn't clear viewer.imageryLayers
        } else if (this.viewer.imageryLayers.length > 0) {
          this.googleTiles.savedBasemapId = null;
          this.viewer.imageryLayers.removeAll();
        }
        if (this.osmBuildings.tileset) {
          this.osmBuildings.tileset.show = false;
          this.osmBuildings.enabled = false;
        }
        // If split mode is active, set RIGHT and create left copy
        if (this.splitMode) {
          this.googleTiles.tileset.splitDirection = Cesium.SplitDirection.RIGHT;
          if (window.BimViewerUI && typeof BimViewerUI.createGoogleTilesLeftCopy === 'function') {
            BimViewerUI.createGoogleTilesLeftCopy();
          }
        }
      } else {
        this.viewer.scene.globe.show = true;
        // Restore saved terrain provider (World Terrain)
        if (this.googleTiles.savedTerrainProvider) {
          this.viewer.terrainProvider = this.googleTiles.savedTerrainProvider;
          this.googleTiles.savedTerrainProvider = null;
        }
        // Restore default sky background when Google tiles disabled
        this.viewer.scene.backgroundColor = Cesium.Color.clone(Cesium.Color.BLACK);
        this.viewer.scene.backgroundColor.alpha = 0;
        // Restore fog to default when Google tiles disabled
        this.viewer.scene.fog.enabled = false;
        // Restore base imagery layers
        if (typeof LayerManager !== 'undefined' && this.googleTiles.savedBasemapId) {
          LayerManager.switchBasemap(this.googleTiles.savedBasemapId);
          this.googleTiles.savedBasemapId = null;
        } else if (this.viewer.imageryLayers.length === 0) {
          // Fallback: re-add OSM imagery
          this.viewer.imageryLayers.addImageryProvider(
            new Cesium.OpenStreetMapImageryProvider({ url: 'https://a.tile.openstreetmap.org/' })
          );
        }
        if (this.osmBuildings.tileset) {
          this.osmBuildings.tileset.show = true;
          this.osmBuildings.enabled = true;
        }
        // Remove left copy when disabling
        if (window.BimViewerUI && typeof BimViewerUI.removeGoogleTilesLeftCopy === 'function') {
          BimViewerUI.removeGoogleTilesLeftCopy();
        }
      }

      this.updateStatus(`Google 3D Tiles ${this.googleTiles.enabled ? 'enabled' : 'disabled'}`, 'success');
    }
  },

  // Switch Google 3D Tiles quality preset at runtime
  setGoogleTilesQuality(preset) {
    const config = this.googleTilesPresets[preset];
    if (!config) {
      console.error('Unknown Google Tiles preset:', preset);
      return;
    }

    this.googleTiles.activePreset = preset;

    // Apply to main tileset
    const tileset = this.googleTiles.tileset;
    if (tileset) {
      tileset.maximumScreenSpaceError = config.maximumScreenSpaceError;
      tileset.skipLevelOfDetail = config.skipLevelOfDetail;
      tileset.maximumMemoryUsage = config.maximumMemoryUsage;
      tileset.backFaceCulling = config.backFaceCulling;
      tileset.preferLeaves = config.preferLeaves;
      tileset.cullRequestsWhileMovingMultiplier = config.cullRequestsWhileMovingMultiplier;
      tileset.foveatedConeSize = config.foveatedConeSize;
    }

    // Apply to left split copy if it exists
    const leftTileset = this.googleTiles.leftTileset;
    if (leftTileset) {
      leftTileset.maximumScreenSpaceError = config.maximumScreenSpaceError;
      leftTileset.skipLevelOfDetail = config.skipLevelOfDetail;
      leftTileset.maximumMemoryUsage = config.maximumMemoryUsage;
      leftTileset.backFaceCulling = config.backFaceCulling;
      leftTileset.preferLeaves = config.preferLeaves;
      leftTileset.cullRequestsWhileMovingMultiplier = config.cullRequestsWhileMovingMultiplier;
      leftTileset.foveatedConeSize = config.foveatedConeSize;
    }

    // Scene-level settings that reduce seam visibility
    const scene = this.viewer.scene;
    scene.fog.enabled = false;
    scene.globe.preloadAncestors = true;
    scene.globe.preloadSiblings = true;
    scene.maximumRenderTimeChange = Infinity;

    // Update UI button state
    document.querySelectorAll('.google-tiles-preset-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === preset);
    });

    console.log(`🌍 Google 3D Tiles quality: ${config.name}`);
    this.updateStatus(`Google 3D Tiles: ${config.name}`, 'success');
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
      const ionToken = BimAuth.getIonToken();
      const response = await fetch('https://api.cesium.com/v1/assets', {
        headers: {
          'Authorization': `Bearer ${ionToken}`
        }
      });
      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }
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

      // Apply current performance preset to newly loaded tileset
      if (this._currentPerformanceSettings) {
        this.applySettingsToTileset(tileset, this._currentPerformanceSettings);
      }

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

      // If split mode is active, show asset only on right side
      if (this.splitMode) {
        tileset.splitDirection = Cesium.SplitDirection.RIGHT;
      }

      // Apply IBL to newly loaded tileset
      if (this.ibl && typeof this.applyIBLToTileset === 'function') {
        this.applyIBLToTileset(tileset);
      }

      // flyTo FIRST so Cesium starts streaming tiles (tiles won't load until camera sees them)
      if (!this.firstAssetLoaded) {
        this.firstAssetLoaded = true;
        await this.viewer.flyTo(tileset, { duration: 1.0 });
      }

      // Re-apply IBL after flyTo — bounding sphere is now populated with correct position
      if (this.ibl && typeof this.applyIBLToTileset === 'function') {
        this.applyIBLToTileset(tileset);
      }

      // Poll for tile content (readyPromise is deprecated in CesiumJS 1.134)
      const hasTileContent = (tile) => {
        if (tile.content && tile.content.featuresLength > 0) return true;
        if (tile.children) {
          for (const child of tile.children) {
            if (hasTileContent(child)) return true;
          }
        }
        return false;
      };

      const pollStart = Date.now();
      const pollMax = 6000;
      const pollInterval = 100;
      while (Date.now() - pollStart < pollMax) {
        if (tileset.root && hasTileContent(tileset.root)) break;
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      const elapsed = Date.now() - pollStart;
      if (tileset.root && hasTileContent(tileset.root)) {
        console.log(`✅ Asset ${assetId}: Tile content loaded (${elapsed}ms) — applying IFC filter`);
      } else {
        console.warn(`⚠️ Asset ${assetId}: Tile content timeout after 6s — proceeding anyway`);
      }

      // Check if this is a point cloud AFTER tile content is available (detection needs content)
      if (typeof this.isPointCloudTileset === 'function') {
        if (this.isPointCloudTileset(tileset)) {
          assetData.isPointCloud = true;
          console.log(`☁️ Asset ${assetId} detected as point cloud`);

          if (typeof this.applyPointCloudSettings === 'function') {
            this.applyPointCloudSettings(tileset);
          }
        }
      }

      if (typeof this.applyIFCFilter === 'function') {
        await this.applyIFCFilter();
      }

      if (typeof BimViewer.updateZOffsetAssetsList === 'function') {
        setTimeout(() => BimViewer.updateZOffsetAssetsList(), 100);
      }

      if (window.BimViewerUI && typeof BimViewerUI.createAssetControls === 'function') {
        BimViewerUI.createAssetControls(assetId);
      }

      this.updateStatus(`Asset loaded: ${assetData.name}`, 'success');

      // Track asset load with Plausible
      if (typeof plausible !== 'undefined') {
        plausible('Asset Loaded', { props: { assetName: assetData.name, assetId: assetId.toString() } });
      }

      // Restore globe only if Google 3D Tiles are NOT active (they replace the globe)
      if (!this.googleTiles.enabled) {
        this.viewer.scene.globe.show = true;
      }
      this.viewer.scene.skyBox.show = true;
      this.viewer.scene.skyAtmosphere.show = true;

      // Safety retry: only if initial detection failed (no redundant poll — tiles should be loaded by now)
      if (!assetData.ifcPropertyName) {
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
        }, 1500);
      }
      
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

      // Apply current performance preset to newly loaded tileset
      if (this._currentPerformanceSettings) {
        this.applySettingsToTileset(tileset, this._currentPerformanceSettings);
      }

      // Note: tileset from ITwinData.createTilesetFromIModelId() is already ready - no readyPromise needed

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

      // Restore globe only if Google 3D Tiles are NOT active (they replace the globe)
      if (!this.googleTiles.enabled) {
        this.viewer.scene.globe.show = true;
      }
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

    if (typeof this.updateLoadedAssetsCount === 'function') {
      this.updateLoadedAssetsCount();
    }

    // Show empty state if no assets left
    if (this.loadedAssets.size === 0) {
      const container = document.getElementById('loadedAssetsList');
      if (container) container.innerHTML = '<div class="modern-empty-state">No assets loaded yet</div>';
    }

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

    // For point clouds, preserve RGB colors - opacity handled differently
    if (assetData.isPointCloud && assetData.tileset) {
      // Keep original RGB colors for point clouds
      // Opacity changes are not fully supported for point clouds to preserve colors
      assetData.tileset.style = undefined;
      console.log(`☁️ Point cloud ${assetId}: RGB colors preserved (opacity slider limited for point clouds)`);
      return;
    }

    // For non-point-clouds, use IFC filter
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

  initRevitFilter() {
    REVIT_CATEGORIES.forEach(cat => {
      this.revitFilter.allCategories.add(cat.category);
      this.revitFilter.enabledCategories.add(cat.category);
    });
  },

  applySettingsToTileset(tileset, settings) {
    if (!tileset || tileset.isDestroyed()) return;

    // Detect Google 3D Tiles — skipLevelOfDetail must stay false to avoid
    // visual artifacts (black cracks/lines between tile boundaries)
    const isGoogle = this.googleTiles &&
      (tileset === this.googleTiles.tileset || tileset === this.googleTiles.leftTileset);

    try {
      if (settings.screenSpaceError !== undefined)
        tileset.maximumScreenSpaceError = settings.screenSpaceError;
      if (settings.memoryUsage !== undefined)
        tileset.maximumCacheSize = settings.memoryUsage;
      if (settings.cullRequestsWhileMoving !== undefined)
        tileset.cullRequestsWhileMoving = settings.cullRequestsWhileMoving;
      if (settings.preloadWhenHidden !== undefined)
        tileset.preloadWhenHidden = settings.preloadWhenHidden;
      if (settings.preloadFlightDestinations !== undefined)
        tileset.preloadFlightDestinations = settings.preloadFlightDestinations;
      if (settings.dynamicScreenSpaceError !== undefined)
        tileset.dynamicScreenSpaceError = settings.dynamicScreenSpaceError;

      // skipLevelOfDetail: NEVER set to true for Google 3D Tiles
      // (causes black cracks/lines between tile boundaries — known CesiumJS artifact)
      if (settings.skipLevelOfDetail !== undefined && !isGoogle) {
        tileset.skipLevelOfDetail = settings.skipLevelOfDetail;
      }

      if (isGoogle) {
        console.log('ℹ️ Google 3D Tiles: skipLevelOfDetail protected (stays false)');
      }
    } catch (e) {
      // Read-only tileset — skip silently
    }
  },

  applyPerformanceSettings(settings) {
    const scene = this.viewer.scene;
    scene.postProcessStages.fxaa.enabled = settings.enableFXAA;
    scene.msaaSamples = settings.enableMSAA ? 4 : 1;
    scene.highDynamicRange = settings.enableHDR;
    scene.globe.enableLighting = settings.enableLighting;
    scene.skyAtmosphere.show = settings.enableAtmosphere;
    scene.shadowMap.enabled = settings.enableShadows;
    if (settings.shadowMaxDistance) {
      scene.shadowMap.maximumDistance = settings.shadowMaxDistance;
    }
    if (settings.enableShadows) {
      scene.shadowMap.normalOffset = true;
      scene.shadowMap.softShadows = true;
      scene.shadowMap.bias = settings.shadowBias || 0.001;
    }

    // Re-apply IBL after performance settings change
    if (typeof BimViewer.applyIBLToAll === 'function') {
      setTimeout(() => BimViewer.applyIBLToAll(), 100);
    }

    // Ambient Occlusion
    const ao = scene.postProcessStages.ambientOcclusion;
    if (ao) {
      ao.enabled = !!settings.enableSSAO;
      if (ao.enabled && settings.ssaoIntensity !== undefined) {
        ao.uniforms.intensity = settings.ssaoIntensity;
        ao.uniforms.bias = settings.ssaoBias;
        ao.uniforms.lengthCap = settings.ssaoLengthCap;
        ao.uniforms.directions = settings.ssaoDirections;
        ao.uniforms.stepSize = settings.ssaoStepSize;
        ao.uniforms.frustumLength = settings.ssaoFrustumLength;
        ao.uniforms.blurStepSize = settings.ssaoBlurStepSize;
      }
      // Update UI toggle state
      const aoBtn = document.getElementById('toggleAO');
      const aoControls = document.getElementById('aoControls');
      if (aoBtn) {
        aoBtn.classList.toggle('active', ao.enabled);
        aoBtn.innerHTML = ao.enabled
          ? '<span class="modern-btn-icon">🌑</span><span>SSAO ON</span>'
          : '<span class="modern-btn-icon">🌑</span><span>Enable SSAO</span>';
      }
      if (aoControls) {
        aoControls.style.display = ao.enabled ? 'block' : 'none';
      }
    }

    // Apply tileset-level settings to all currently loaded tilesets
    if (this.loadedAssets) {
      this.loadedAssets.forEach((asset) => {
        if (asset.tileset) this.applySettingsToTileset(asset.tileset, settings);
      });
    }

    // Apply to all scene primitives (Google 3D Tiles, OSM Buildings, etc.)
    const primitives = scene.primitives;
    for (let i = 0; i < primitives.length; i++) {
      const prim = primitives.get(i);
      if (prim instanceof Cesium.Cesium3DTileset) {
        this.applySettingsToTileset(prim, settings);
      }
    }

    // Store current settings so newly loaded tilesets can be configured on load
    this._currentPerformanceSettings = settings;

    console.log('✅ Tileset-level settings applied to all primitives:', {
      screenSpaceError: settings.screenSpaceError,
      skipLevelOfDetail: settings.skipLevelOfDetail,
      dynamicScreenSpaceError: settings.dynamicScreenSpaceError,
      memoryUsage: settings.memoryUsage
    });
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
      // IBL is now handled by ibl.js via imageBasedLightingFactor
      // (.enabled and .luminanceAtZenith were removed in CesiumJS 1.123)
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

    // Don't restore globe if Google 3D Tiles are active (they replace the globe)
    if (this.googleTiles.enabled) return;

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
window.REVIT_CATEGORIES = REVIT_CATEGORIES;
window.CATEGORY_DE_TO_EN = CATEGORY_DE_TO_EN;
window.mapCategoryToEnglish = mapCategoryToEnglish;

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
