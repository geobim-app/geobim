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
        shadowMaxDistance: 500.0,
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
        shadowMaxDistance: 1000.0,
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
        shadowMaxDistance: 2000.0,
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
        shadowMaxDistance: 2000.0,
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
  // skipLevelOfDetail MUST be false — causes holes/seams/stretched textures
  // dynamicScreenSpaceErrorFactor 24.0 = new CesiumJS default (was 4.0)
  // backFaceCulling false — Google tiles have inconsistent face winding
  googleTilesPresets: {
    performance: {
      name: 'Performance',
      maximumScreenSpaceError: 16,
      skipLevelOfDetail: false,
      backFaceCulling: false,
      preferLeaves: false,
      cullRequestsWhileMovingMultiplier: 60,
      foveatedConeSize: 0.2,
      dynamicScreenSpaceErrorFactor: 24.0,
      dynamicScreenSpaceErrorDensity: 0.0002,
      cacheBytes: 536870912,
      maximumCacheOverflowBytes: 536870912
    },
    balanced: {
      name: 'Balanced',
      maximumScreenSpaceError: 12,
      skipLevelOfDetail: false,
      backFaceCulling: false,
      preferLeaves: false,
      cullRequestsWhileMovingMultiplier: 30,
      foveatedConeSize: 0.25,
      dynamicScreenSpaceErrorFactor: 24.0,
      dynamicScreenSpaceErrorDensity: 0.0002,
      cacheBytes: 1073741824,
      maximumCacheOverflowBytes: 1073741824
    },
    quality: {
      name: 'Quality',
      maximumScreenSpaceError: 8,
      skipLevelOfDetail: false,
      backFaceCulling: false,
      preferLeaves: false,
      cullRequestsWhileMovingMultiplier: 10,
      foveatedConeSize: 0.3,
      dynamicScreenSpaceErrorFactor: 12.0,
      dynamicScreenSpaceErrorDensity: 0.0002,
      cacheBytes: 1572864000,
      maximumCacheOverflowBytes: 1073741824
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

        // String literal shader error — likely a style applied to a point cloud tileset
        if (error.message && error.message.includes('String literals are not supported')) {
          console.warn('⚠️ String literal shader error — clearing styles from point cloud tilesets...');
          if (this.loadedAssets) {
            for (const [assetId, assetData] of this.loadedAssets) {
              if (assetData.tileset && !assetData.ifcPropertyName && assetData.tileset.style) {
                assetData.tileset.style = undefined;
                console.log(`☁️ Cleared style from asset ${assetId} (likely point cloud)`);
                // Re-check if this is a point cloud
                if (typeof this.isPointCloudTileset === 'function' && this.isPointCloudTileset(assetData.tileset)) {
                  assetData.isPointCloud = true;
                  if (typeof this.applyPointCloudSettings === 'function') {
                    this.applyPointCloudSettings(assetData.tileset);
                  }
                }
              }
            }
          }
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

      // HBAO — Horizon-Based Ambient Occlusion (CesiumJS 1.124+)
      // Replaces legacy SSAO with physically-based AO that scales with camera distance.
      const ao = scene.postProcessStages.ambientOcclusion;
      if (ao) {
        ao.uniforms.intensity = 3.0;
        ao.uniforms.bias = 0.1;
        ao.uniforms.lengthCap = 0.26;
        ao.uniforms.stepSize = 1.95;
        // Legacy SSAO params (kept as fallback, HBAO ignores them)
        ao.uniforms.directions = 16;
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
      scene.shadowMap.maximumDistance = 1000.0;
      console.log('✅ Shadow quality configured (normalOffset, softShadows, maxDist: 1000m)');

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

      // Dynamic Environment Maps — tune for BIM (CesiumJS 1.125+)
      // Improves specular reflections on steel, glass, and polished surfaces.
      this.configureDynamicEnvMaps = function(tileset) {
        if (tileset && tileset.environmentMapManager) {
          var em = tileset.environmentMapManager;
          em.enabled = true;
          em.atmosphereScatteringIntensity = 2.5;  // slightly brighter than default
          em.brightness = 1.0;
          em.saturation = 1.0;
        }
      };

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
          skipLevelOfDetail: false,
          baseScreenSpaceError: 1024,
          skipScreenSpaceErrorFactor: 16,
          skipLevels: 1,
          immediatelyLoadDesiredLevelOfDetail: false,
          loadSiblings: false,
          cullWithChildrenBounds: true,
          cullRequestsWhileMoving: true,
          cullRequestsWhileMovingMultiplier: 60,
          preloadWhenHidden: true,
          preloadFlightDestinations: true,
          preferLeaves: false,
          backFaceCulling: false,
          dynamicScreenSpaceError: true,
          dynamicScreenSpaceErrorDensity: 0.0002,
          dynamicScreenSpaceErrorFactor: 24.0,
          dynamicScreenSpaceErrorHeightFalloff: 0.25,
          foveatedScreenSpaceError: true,
          foveatedConeSize: 0.2,
          foveatedMinimumScreenSpaceErrorRelaxation: 0,
          foveatedInterpolationCallback: Cesium.Math.lerp,
          foveatedTimeDelay: 0.2,
          cacheBytes: 1572864000,
          maximumCacheOverflowBytes: 1073741824,
          enableCollision: true
        });
        this.viewer.scene.primitives.add(tileset);
        this.enableTilesetLighting(tileset);

        // Google tiles use KHR_materials_unlit — shadows have no visual effect
        // but waste GPU rendering into shadow map. Disable.
        tileset.shadows = Cesium.ShadowMode.DISABLED;

        // Scene-level settings for Google tiles
        const scene = this.viewer.scene;
        scene.globe.tileCacheSize = 1000;
        // Fog helps mask LOD transitions at horizon (seams were from skipLOD, not fog)
        scene.fog.enabled = true;
        scene.fog.density = 0.0002;
        scene.globe.preloadAncestors = true;
        scene.globe.preloadSiblings = true;

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
      tileset.backFaceCulling = config.backFaceCulling;
      tileset.preferLeaves = config.preferLeaves;
      tileset.cullRequestsWhileMovingMultiplier = config.cullRequestsWhileMovingMultiplier;
      tileset.foveatedConeSize = config.foveatedConeSize;
      tileset.dynamicScreenSpaceErrorFactor = config.dynamicScreenSpaceErrorFactor;
      tileset.dynamicScreenSpaceErrorDensity = config.dynamicScreenSpaceErrorDensity;
      tileset.cacheBytes = config.cacheBytes;
      tileset.maximumCacheOverflowBytes = config.maximumCacheOverflowBytes;
    }

    // Apply to left split copy if it exists
    const leftTileset = this.googleTiles.leftTileset;
    if (leftTileset) {
      leftTileset.maximumScreenSpaceError = config.maximumScreenSpaceError;
      leftTileset.skipLevelOfDetail = config.skipLevelOfDetail;
      leftTileset.backFaceCulling = config.backFaceCulling;
      leftTileset.preferLeaves = config.preferLeaves;
      leftTileset.cullRequestsWhileMovingMultiplier = config.cullRequestsWhileMovingMultiplier;
      leftTileset.foveatedConeSize = config.foveatedConeSize;
      leftTileset.dynamicScreenSpaceErrorFactor = config.dynamicScreenSpaceErrorFactor;
      leftTileset.dynamicScreenSpaceErrorDensity = config.dynamicScreenSpaceErrorDensity;
      leftTileset.cacheBytes = config.cacheBytes;
      leftTileset.maximumCacheOverflowBytes = config.maximumCacheOverflowBytes;
    }

    // Scene-level settings
    const scene = this.viewer.scene;
    scene.fog.enabled = true;
    scene.fog.density = 0.0002;
    scene.globe.preloadAncestors = true;
    scene.globe.preloadSiblings = true;

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
      var isOAuth = typeof BimIonAuth !== 'undefined' && BimIonAuth.isOAuthConnected();

      if (!isOAuth) {
        // Demo token — can't query REST API, return curated asset stubs
        // The VALID_ASSET_IDS filter in ui.js handles the selection
        this.availableAssets = Array.from(typeof VALID_ASSET_IDS !== 'undefined' ? VALID_ASSET_IDS : []).map(function(id) {
          return { id: id, name: 'Asset ' + id, type: '3DTILES' };
        });
        return this.availableAssets;
      }

      // OAuth token — fetch real asset list from Ion API
      const ionToken = BimAuth.getIonToken();
      const response = await fetch('https://api.cesium.com/v1/assets', {
        headers: {
          'Authorization': `Bearer ${ionToken}`
        }
      });
      if (!response.ok) {
        console.warn('Ion API /v1/assets returned ' + response.status + ' — falling back to demo assets');
        // Fallback: return demo stubs so the app still works
        this.availableAssets = Array.from(typeof VALID_ASSET_IDS !== 'undefined' ? VALID_ASSET_IDS : []).map(function(id) {
          return { id: id, name: 'Asset ' + id, type: '3DTILES' };
        });
        return this.availableAssets;
      }
      const data = await response.json();
      this.availableAssets = data.items || [];
      return this.availableAssets;
    } catch (error) {
      console.warn('Failed to fetch Ion assets, using demo fallback:', error.message);
      this.availableAssets = Array.from(typeof VALID_ASSET_IDS !== 'undefined' ? VALID_ASSET_IDS : []).map(function(id) {
        return { id: id, name: 'Asset ' + id, type: '3DTILES' };
      });
      return this.availableAssets;
    }
  },

  async loadSelectedAsset(assetId, assetName = null, opts = {}) {
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
      if (typeof this.configureDynamicEnvMaps === 'function') {
        this.configureDynamicEnvMaps(tileset);
      }

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
      if (!opts.noFlyTo && !this.firstAssetLoaded) {
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

      if (!opts.silent && window.BimViewerUI && typeof BimViewerUI.createAssetControls === 'function') {
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
            // Re-check point cloud detection (may have failed due to timeout)
            if (!assetData.isPointCloud && typeof this.isPointCloudTileset === 'function') {
              if (this.isPointCloudTileset(assetData.tileset)) {
                assetData.isPointCloud = true;
                console.log(`☁️ Asset ${assetId} detected as point cloud (delayed check)`);
                if (typeof this.applyPointCloudSettings === 'function') {
                  this.applyPointCloudSettings(assetData.tileset);
                }
                return; // Point cloud — no IFC filter needed
              }
            }

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
      var isOAuth = typeof BimIonAuth !== 'undefined' && BimIonAuth.isOAuthConnected();
      var msg = error.message || '';
      if (isOAuth && (msg.indexOf('404') !== -1 || msg.indexOf('403') !== -1 || msg.indexOf('unauthorized') !== -1 || msg.indexOf('not found') !== -1)) {
        this.updateStatus('Asset ' + assetId + ' not available — activate it in your Cesium Ion My Assets', 'error');
      } else {
        this.updateStatus('Failed to load asset ' + assetId, 'error');
      }
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

  // =====================================
  // GLB MODEL LOADING
  // =====================================

  // Concrete PBR CustomShader for GLB models (triplanar noise, no textures needed)
  _glbConcreteShader: null,
  _getConcreteShader() {
    if (this._glbConcreteShader) return this._glbConcreteShader;
    this._glbConcreteShader = new Cesium.CustomShader({
      uniforms: {
        u_noiseScale: { type: Cesium.UniformType.FLOAT, value: 0.1 }
      },
      varyings: {
        v_worldPos: Cesium.VaryingType.VEC3
      },
      vertexShaderText: /* glsl */ `
        void vertexMain(VertexInput vsInput, inout czm_modelVertexOutput vsOutput) {
          v_worldPos = (czm_model * vec4(vsInput.attributes.positionMC, 1.0)).xyz;
        }
      `,
      fragmentShaderText: /* glsl */ `
        float cHash(vec3 p) {
          p = fract(p * vec3(443.897, 441.423, 437.195));
          p += dot(p, p.yzx + 19.19);
          return fract((p.x + p.y) * p.z);
        }
        float cNoise3D(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float n000 = cHash(i); float n100 = cHash(i+vec3(1,0,0));
          float n010 = cHash(i+vec3(0,1,0)); float n110 = cHash(i+vec3(1,1,0));
          float n001 = cHash(i+vec3(0,0,1)); float n101 = cHash(i+vec3(1,0,1));
          float n011 = cHash(i+vec3(0,1,1)); float n111 = cHash(i+vec3(1,1,1));
          return mix(mix(mix(n000,n100,f.x),mix(n010,n110,f.x),f.y),
                     mix(mix(n001,n101,f.x),mix(n011,n111,f.x),f.y),f.z);
        }
        float cTriplanar(vec3 wp, vec3 n, float s) {
          vec3 b = abs(n); b /= (b.x+b.y+b.z+0.001);
          float nx = 0.5*cNoise3D(vec3(wp.yz*s,0.0))+0.25*cNoise3D(vec3(wp.yz*s*2.0,0.0))
                    +0.125*cNoise3D(vec3(wp.yz*s*4.0,0.0));
          float ny = 0.5*cNoise3D(vec3(wp.xz*s,1.0))+0.25*cNoise3D(vec3(wp.xz*s*2.0,1.0))
                    +0.125*cNoise3D(vec3(wp.xz*s*4.0,1.0));
          float nz = 0.5*cNoise3D(vec3(wp.xy*s,2.0))+0.25*cNoise3D(vec3(wp.xy*s*2.0,2.0))
                    +0.125*cNoise3D(vec3(wp.xy*s*4.0,2.0));
          return nx*b.x + ny*b.y + nz*b.z;
        }
        void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
          vec3 wp = v_worldPos;
          vec3 norm = material.normalEC;
          // Concrete base color
          vec3 base = vec3(0.478, 0.463, 0.439);
          // Two-scale noise: fine pores + coarse surface variation
          float fine = cTriplanar(wp, norm, u_noiseScale * 8.0);
          float coarse = cTriplanar(wp, norm, u_noiseScale * 2.0);
          vec3 tint = base + (fine - 0.5) * 0.12 + (coarse - 0.5) * 0.06;
          material.diffuse = clamp(tint, 0.0, 1.0);
          material.specular = vec3(0.04);
          material.roughness = 0.85;
          material.alpha = 1.0;
        }
      `,
      mode: Cesium.CustomShaderMode.MODIFY_MATERIAL,
      lightingModel: Cesium.LightingModel.PBR
    });
    return this._glbConcreteShader;
  },

  toggleGLBPbr(assetId) {
    const assetData = this.loadedAssets.get(assetId);
    if (!assetData || !assetData.isGLB || !assetData.model) return;

    if (assetData.pbrEnabled) {
      assetData.model.customShader = undefined;
      assetData.pbrEnabled = false;
    } else {
      assetData.model.customShader = this._getConcreteShader();
      assetData.pbrEnabled = true;
    }

    const btn = document.getElementById(`glb_pbr_${assetId}`);
    if (btn) {
      btn.textContent = assetData.pbrEnabled ? '🪨 PBR On' : '🪨 PBR Off';
      btn.classList.toggle('active', assetData.pbrEnabled);
    }
  },

  // Lab feature access — only these users see GLB models section
  labUsers: new Set([
    'christof2304@gmail.com'
  ]),

  isLabUser() {
    if (!window.BimAuth || !BimAuth.currentUser) return false;
    return this.labUsers.has(BimAuth.currentUser.email);
  },

  // Metadata overrides for known models (defaultPosition, custom names, etc.)
  // Models are auto-discovered from the server via api/models.php
  glbModelOverrides: {
    'infrafem_sofistik_csm': { name: 'infraFEM Sofistik CSM',
      defaultPosition: { lon: -79.8864, lat: 40.023979, height: 204.0863013479 }, defaultHeading: 130, defaultScale: 1.0 },
    'brooklyn_blender': { name: 'Brooklyn Bridge (Blender)' },
    'cube_10meter': { name: 'Cube 10m' },
    'freecad': { name: 'FreeCAD' },
    'gordie_howe_bridge_geopogo': { name: 'Gordie Howe Bridge' },
    'manhattan_blender': { name: 'Manhattan (Blender)' },
    'noise_barrier_full_1': { name: 'Noise Barrier 1' },
    'noise_barrier_full_2': { name: 'Noise Barrier 2' },
    'sbp_benin': { name: 'SBP Benin' },
    'sbp_heidelberg_blender_gltf': { name: 'SBP Heidelberg' },
  },

  // Auto-discovered model list (populated by fetchGLBModels)
  glbModels: [],

  // Fetch GLB models from server and merge with overrides
  async fetchGLBModels() {
    try {
      const resp = await fetch('api/models.php');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const serverModels = await resp.json();
      this.glbModels = serverModels.map(m => {
        const overrides = this.glbModelOverrides[m.id] || {};
        return { ...m, ...overrides };
      });
      console.log(`📦 Auto-discovered ${this.glbModels.length} GLB/glTF models`);
    } catch (err) {
      console.warn('⚠️ Could not fetch model list, using empty list:', err.message);
      this.glbModels = [];
    }
    return this.glbModels;
  },

  async loadGLBAsset(modelDef, position) {
    const assetId = 'glb_' + modelDef.id;
    if (this.loadedAssets.has(assetId)) {
      this.updateStatus('Model already loaded', 'warning');
      return;
    }

    this.updateStatus(`Loading ${modelDef.name}...`, 'loading');

    try {
      // Use model default position, then override, then camera fallback
      if (!position && modelDef.defaultPosition) {
        position = { ...modelDef.defaultPosition };
      }
      if (!position) {
        const cam = this.viewer.camera;
        const ray = cam.getPickRay(new Cesium.Cartesian2(
          this.viewer.canvas.clientWidth / 2,
          this.viewer.canvas.clientHeight / 2
        ));
        const hit = this.viewer.scene.globe.pick(ray, this.viewer.scene);
        if (hit) {
          const carto = Cesium.Cartographic.fromCartesian(hit);
          position = {
            lon: Cesium.Math.toDegrees(carto.longitude),
            lat: Cesium.Math.toDegrees(carto.latitude),
            height: carto.height || 0
          };
        } else {
          position = { lon: 10.0, lat: 50.0, height: 0 };
        }
      }

      const initialHeading = modelDef.defaultHeading || 0;
      const initialScale = modelDef.defaultScale || 1.0;
      const url = modelDef.file;
      const modelMatrix = Cesium.Transforms.headingPitchRollToFixedFrame(
        Cesium.Cartesian3.fromDegrees(position.lon, position.lat, position.height),
        new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(initialHeading), 0, 0)
      );

      const model = await Cesium.Model.fromGltfAsync({
        url: url,
        modelMatrix: modelMatrix,
        scale: initialScale,
        minimumPixelSize: 0,
        maximumScale: 20000,
        shadows: Cesium.ShadowMode.ENABLED,
        silhouetteColor: Cesium.Color.LIME,
        silhouetteSize: 0.0
      });

      this.viewer.scene.primitives.add(model);

      const defaultAnimSpeed = 5.0;
      let hasAnimations = !!modelDef.animated;

      // Auto-detect animations: try to add all, check if any were found
      // Uses wall-clock time so animations play even when scene clock is paused (shadow timeline)
      model.readyEvent.addEventListener(() => {
        try {
          const startRealTime = performance.now() / 1000.0;
          const wallClockAnimTime = function(duration, seconds) {
            const elapsed = performance.now() / 1000.0 - startRealTime;
            return (elapsed * defaultAnimSpeed) % duration;
          };
          const anims = model.activeAnimations.addAll({
            loop: Cesium.ModelAnimationLoop.REPEAT,
            multiplier: 1.0,
            animationTime: wallClockAnimTime
          });
          if (anims.length > 0) {
            hasAnimations = true;
            model._glbAnimCount = anims.length;
            const assetData = this.loadedAssets.get(assetId);

            // WEA models: detect animations but don't play — user starts manually
            if (assetData && assetData.isWEA) {
              model.activeAnimations.removeAll();
              assetData.animated = true;
              assetData.animPlaying = false;
            } else if (assetData) {
              assetData.animated = true;
              assetData.animPlaying = true;
            }
            console.log(`🎬 GLB ${anims.length} animations auto-detected for ${modelDef.name} (speed: ${defaultAnimSpeed}x)`);
            // Re-render asset card to show animation controls
            const cardEl = document.getElementById(`asset_${assetId}`);
            if (cardEl && window.BimViewerUI) {
              cardEl.remove();
              BimViewerUI.createAssetControls(assetId);
            }
          } else {
            // No animations found — clean up
            model.activeAnimations.removeAll();
            console.log(`ℹ️ GLB ${modelDef.name}: no embedded animations`);
          }
        } catch (err) {
          console.warn(`⚠️ GLB animation init failed:`, err.message);
        }
      });

      const assetData = {
        id: assetId,
        name: modelDef.name,
        model: model,       // Cesium.Model (not tileset)
        tileset: null,       // null — this is a GLB, not 3D Tiles
        visible: true,
        opacity: 1.0,
        type: 'GLB',
        isGLB: true,
        animated: hasAnimations,
        animSpeed: defaultAnimSpeed,
        animPlaying: hasAnimations,
        position: { ...position },
        heading: initialHeading,
        scale: initialScale,
        pbrEnabled: true,
        modelDef: modelDef,
        isWEA: !!modelDef.isWEA
      };

      // Apply PBR concrete shader by default
      model.customShader = this._getConcreteShader();

      this.loadedAssets.set(assetId, assetData);

      // Fly to model (WEA models fly after terrain clamping)
      if (!modelDef.isWEA) {
        const boundingSphere = new Cesium.BoundingSphere(
          Cesium.Cartesian3.fromDegrees(position.lon, position.lat, position.height),
          200
        );
        this.viewer.camera.flyToBoundingSphere(boundingSphere, { duration: 1.5 });
      }

      if (window.BimViewerUI && typeof BimViewerUI.createAssetControls === 'function') {
        BimViewerUI.createAssetControls(assetId);
      }

      this.updateStatus(`Loaded: ${modelDef.name}`, 'success');
      console.log(`✅ GLB loaded: ${modelDef.name} at ${position.lon.toFixed(5)}, ${position.lat.toFixed(5)}`);

    } catch (error) {
      console.error('❌ GLB load failed:', error);
      this.updateStatus(`GLB load failed: ${error.message}`, 'error');
    }
  },

  updateGLBPosition(assetId) {
    const assetData = this.loadedAssets.get(assetId);
    if (!assetData || !assetData.isGLB || !assetData.model) return;

    const pos = assetData.position;
    const heading = Cesium.Math.toRadians(assetData.heading || 0);
    const hpr = new Cesium.HeadingPitchRoll(heading, 0, 0);
    const origin = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.height);

    const modelMatrix = Cesium.Transforms.headingPitchRollToFixedFrame(origin, hpr);
    Cesium.Matrix4.multiplyByUniformScale(modelMatrix, assetData.scale || 1.0, modelMatrix);
    assetData.model.modelMatrix = modelMatrix;
  },

  // Restart all GLB animations with a new multiplier (multiplier is read-only,
  // so we must removeAll + re-add). Optional animationTime callback for freeze.
  // Safely restart GLB animations — defers addAll to next frame to avoid
  // CesiumJS crash when evaluating new animations mid-render at t=0.
  // Uses animationTime callback so animations run on wall-clock time,
  // independent of the Cesium scene clock (shadow timeline).
  _restartGLBAnimations(assetData, multiplier, opts) {
    const model = assetData.model;
    if (!model) return;
    model.activeAnimations.removeAll();

    // Wall-clock based animation time — immune to scene clock changes
    const startRealTime = performance.now() / 1000.0;
    const wallClockAnimTime = function(duration, seconds) {
      const elapsed = performance.now() / 1000.0 - startRealTime;
      return (elapsed * multiplier) % duration;
    };

    requestAnimationFrame(() => {
      try {
        const addOpts = {
          loop: (opts && opts.loop !== undefined) ? opts.loop : Cesium.ModelAnimationLoop.REPEAT,
          multiplier: 1.0,  // multiplier handled by wallClockAnimTime
          animationTime: (opts && opts.animationTime) ? opts.animationTime : wallClockAnimTime
        };
        model.activeAnimations.addAll(addOpts);
      } catch (e) {
        console.warn('⚠️ _restartGLBAnimations failed:', e.message);
      }
    });
  },

  setGLBAnimationSpeed(assetId, speed) {
    const assetData = this.loadedAssets.get(assetId);
    if (!assetData || !assetData.isGLB) return;
    assetData.animSpeed = speed;
    if (assetData.animPlaying) {
      this._restartGLBAnimations(assetData, speed);
    }
  },

  toggleGLBAnimation(assetId) {
    const assetData = this.loadedAssets.get(assetId);
    if (!assetData || !assetData.isGLB || !assetData.model) return;

    if (assetData.animPlaying) {
      // Pause — just remove all animations, model keeps rest pose (all visible)
      assetData.model.activeAnimations.removeAll();
      assetData.animPlaying = false;
    } else {
      // Play — restart with current speed
      this._restartGLBAnimations(assetData, assetData.animSpeed || 5.0);
      assetData.animPlaying = true;
    }

    const btn = document.getElementById(`glb_playpause_${assetId}`);
    if (btn) btn.textContent = assetData.animPlaying ? '⏸ Pause' : '▶ Play';
  },

  showFullGLBModel(assetId) {
    const assetData = this.loadedAssets.get(assetId);
    if (!assetData || !assetData.isGLB || !assetData.model) return;

    const model = assetData.model;
    model.activeAnimations.removeAll();

    // Add all animations with a startTime far in the past so they've already
    // completed — CLAMP_AND_STOP keeps the last frame (all elements at scale 1)
    requestAnimationFrame(() => {
      try {
        const now = BimViewer.viewer.clock.currentTime;
        const pastStart = Cesium.JulianDate.addSeconds(now, -3600, new Cesium.JulianDate());
        model.activeAnimations.addAll({
          loop: Cesium.ModelAnimationLoop.NONE,
          multiplier: 1.0,
          startTime: pastStart
        });
      } catch (e) {
        console.warn('⚠️ showFullGLBModel failed:', e.message);
      }
    });

    assetData.animPlaying = false;
    const btn = document.getElementById(`glb_playpause_${assetId}`);
    if (btn) btn.textContent = '▶ Play';

    this.updateStatus('Showing full model (all elements)', 'success');
    console.log(`🏗️ GLB ${assetId}: All elements visible (end frame)`);
  },

  unloadAsset(assetId) {
    const assetData = this.loadedAssets.get(assetId.toString());
    if (!assetData) return;

    if (assetData.isGLB && assetData.model) {
      this.viewer.scene.primitives.remove(assetData.model);
    } else if (assetData.tileset) {
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
    if (!assetData) return;

    if (assetData.isGLB && assetData.position) {
      const pos = assetData.position;
      const target = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.height);
      this.viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 200), { duration: 1.5 });
    } else if (assetData.tileset) {
      this.viewer.flyTo(assetData.tileset);
    }
  },

  toggleAssetVisibility(assetId) {
    const assetData = this.loadedAssets.get(assetId.toString());
    if (!assetData) return;

    assetData.visible = !assetData.visible;

    if (assetData.isGLB && assetData.model) {
      assetData.model.show = assetData.visible;
    } else if (assetData.tileset) {
      assetData.tileset.show = assetData.visible;
    }

    const btn = document.querySelector(`#asset_${assetId} .asset-btn-visibility`);
    if (btn) btn.textContent = assetData.visible ? '👁️' : '🚫';
  },

  updateAssetOpacity(assetId, opacity) {
    const assetData = this.loadedAssets.get(assetId.toString());
    if (!assetData) return;

    assetData.opacity = parseFloat(opacity);

    const valueEl = document.getElementById(`opacityValue_${assetId}`);
    if (valueEl) valueEl.textContent = Math.round(opacity * 100) + '%';

    // GLB models — adjust color alpha
    if (assetData.isGLB && assetData.model) {
      assetData.model.color = Cesium.Color.WHITE.withAlpha(assetData.opacity);
      if (assetData.opacity < 1.0) {
        assetData.model.colorBlendMode = Cesium.ColorBlendMode.MIX;
        assetData.model.colorBlendAmount = 1.0 - assetData.opacity;
      } else {
        assetData.model.colorBlendMode = Cesium.ColorBlendMode.HIGHLIGHT;
        assetData.model.colorBlendAmount = 0.0;
      }
      return;
    }

    // For point clouds, preserve RGB colors - opacity handled differently
    if (assetData.isPointCloud && assetData.tileset) {
      // Keep original RGB colors for point clouds
      // Opacity changes are not fully supported for point clouds to preserve colors
      assetData.tileset.style = undefined;
      console.log(`☁️ Point cloud ${assetId}: RGB colors preserved (opacity slider limited for point clouds)`);
      return;
    }

    // Re-apply the active filter/style so the new opacity takes effect
    if (assetData.ifcPropertyName && typeof this.applyIFCFilter === 'function') {
      this.applyIFCFilter();
    } else if (assetData.categoryPropertyName && typeof this.applyRevitFilter === 'function') {
      this.applyRevitFilter();
    } else if (assetData.tileset) {
      // No IFC/Revit filter — apply opacity directly
      assetData.tileset.style = new Cesium.Cesium3DTileStyle({
        color: `color('white', ${assetData.opacity})`,
        show: true
      });
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
