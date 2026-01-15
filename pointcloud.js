// ===============================
// CESIUM BIM VIEWER - POINT CLOUD MODULE v1.0
// Advanced Point Cloud Rendering Controls
// Eye Dome Lighting, Point Size, Distance Attenuation
// ===============================
'use strict';

(function() {
  
  // Point cloud state management
  BimViewer.pointCloudSettings = {
    // Eye Dome Lighting (EDL)
    edlEnabled: true,
    edlStrength: 1.0,
    edlRadius: 1.0,
    
    // Point Appearance
    pointSize: 2.0,
    attenuationEnabled: true,
    maximumAttenuation: undefined, // Scale between 1 and 10
    
    // Color & Shading
    shadingEnabled: true,
    colorMode: 'rgb', // 'rgb', 'height', 'intensity', 'classification'
    useOriginalColors: true,
    
    // Performance
    geometricErrorScale: 1.0,
    backFaceCulling: false,
    
    // Tracking
    appliedTilesets: new Map() // Track which tilesets have settings applied
  };

  // Initialize Point Cloud settings
  BimViewer.initPointCloudSettings = function() {
    console.log('☁️ Initializing Point Cloud Settings...');
    
    // Apply default settings to any existing tilesets
    this.applyPointCloudSettingsToAllTilesets();
    
    console.log('✅ Point Cloud Settings initialized');
  };

  // Apply settings to all loaded tilesets
  BimViewer.applyPointCloudSettingsToAllTilesets = function() {
    if (!this.loadedAssets) return;
    
    let tilesetCount = 0;
    
    this.loadedAssets.forEach((assetData, assetId) => {
      const tileset = assetData.tileset;
      if (tileset && this.isPointCloudTileset(tileset)) {
        this.applyPointCloudSettings(tileset);
        tilesetCount++;
      }
    });
    
    if (tilesetCount > 0) {
      console.log(`☁️ Applied point cloud settings to ${tilesetCount} tileset(s)`);
    }
    
    return tilesetCount;
  };

  // Check if a tileset is a point cloud
  BimViewer.isPointCloudTileset = function(tileset) {
    if (!tileset) return false;
    
    // Check if tileset has point cloud style properties
    if (tileset.pointCloudShading) return true;
    
    // Check root tile content type
    if (tileset.root && tileset.root.content) {
      const contentUri = tileset.root.content.uri || '';
      if (contentUri.includes('.pnts') || contentUri.includes('pointcloud')) {
        return true;
      }
    }
    
    return false;
  };

  // Apply point cloud settings to a specific tileset
  BimViewer.applyPointCloudSettings = function(tileset) {
    if (!tileset) {
      console.warn('⚠️ No tileset provided');
      return;
    }
    
    try {
      const settings = this.pointCloudSettings;
      
      // ✅ CRITICAL: Remove any style that might override colors
      if (settings.useOriginalColors) {
        tileset.style = undefined;
        console.log('☁️ Tileset style removed to show original RGB colors');
      }
      
      // Initialize point cloud shading if it doesn't exist
      if (!tileset.pointCloudShading) {
        tileset.pointCloudShading = new Cesium.PointCloudShading({});
      }
      
      // Eye Dome Lighting (EDL)
      if (tileset.pointCloudShading) {
        tileset.pointCloudShading.eyeDomeLighting = settings.edlEnabled;
        tileset.pointCloudShading.eyeDomeLightingStrength = settings.edlStrength;
        tileset.pointCloudShading.eyeDomeLightingRadius = settings.edlRadius;
        
        // Point Size
        tileset.pointCloudShading.baseResolution = settings.pointSize;
        
        // Attenuation
        tileset.pointCloudShading.attenuation = settings.attenuationEnabled;
        if (settings.maximumAttenuation !== undefined) {
          tileset.pointCloudShading.maximumAttenuation = settings.maximumAttenuation;
        }
        
        // Geometric Error Scale
        tileset.pointCloudShading.geometricErrorScale = settings.geometricErrorScale;
      }
      
      // Back Face Culling
      tileset.backFaceCulling = settings.backFaceCulling;
      
      // Apply color mode
      this.applyColorMode(tileset, settings.colorMode);
      
      console.log('☁️ Point cloud settings applied to tileset (RGB colors preserved)');
      
    } catch (error) {
      console.error('❌ Error applying point cloud settings:', error);
    }
  };

  // Apply color mode to tileset
  BimViewer.applyColorMode = function(tileset, mode) {
    if (!tileset) return;
    
    try {
      switch(mode) {
        case 'rgb':
          // Original RGB colors - remove any style
          tileset.style = undefined;
          console.log('☁️ Color Mode: Original RGB');
          break;
          
        case 'height':
          // Color by height
          tileset.style = new Cesium.Cesium3DTileStyle({
            color: {
              conditions: [
                ["${Height} >= 100", "color('#ff0000')"],
                ["${Height} >= 50", "color('#ffff00')"],
                ["${Height} >= 25", "color('#00ff00')"],
                ["${Height} >= 10", "color('#00ffff')"],
                ["true", "color('#0000ff')"]
              ]
            }
          });
          console.log('☁️ Color Mode: Height-based');
          break;
          
        case 'intensity':
          // Color by intensity (if available)
          tileset.style = new Cesium.Cesium3DTileStyle({
            color: "color() * ${Intensity}"
          });
          console.log('☁️ Color Mode: Intensity-based');
          break;
          
        case 'classification':
          // Color by classification (if available)
          tileset.style = new Cesium.Cesium3DTileStyle({
            color: {
              conditions: [
                ["${Classification} === 0", "color('#808080')"], // Never classified
                ["${Classification} === 1", "color('#808080')"], // Unclassified
                ["${Classification} === 2", "color('#8B4513')"], // Ground
                ["${Classification} === 3", "color('#00FF00')"], // Low Vegetation
                ["${Classification} === 4", "color('#228B22')"], // Medium Vegetation
                ["${Classification} === 5", "color('#006400')"], // High Vegetation
                ["${Classification} === 6", "color('#FF0000')"], // Building
                ["${Classification} === 9", "color('#0000FF')"], // Water
                ["true", "color('#FFFFFF')"]
              ]
            }
          });
          console.log('☁️ Color Mode: Classification-based');
          break;
          
        default:
          tileset.style = undefined;
      }
    } catch (error) {
      console.error('❌ Error applying color mode:', error);
      tileset.style = undefined; // Fallback to RGB
    }
  };

  // Set color mode for all point clouds
  BimViewer.setColorMode = function(mode) {
    this.pointCloudSettings.colorMode = mode;
    
    if (mode === 'rgb') {
      this.pointCloudSettings.useOriginalColors = true;
    } else {
      this.pointCloudSettings.useOriginalColors = false;
    }
    
    // Apply to all point cloud tilesets
    if (this.loadedAssets) {
      this.loadedAssets.forEach((assetData, assetId) => {
        const tileset = assetData.tileset;
        if (tileset && this.isPointCloudTileset(tileset)) {
          this.applyColorMode(tileset, mode);
        }
      });
    }
    
    const modeLabels = {
      rgb: 'Original RGB Colors',
      height: 'Height-based Colors',
      intensity: 'Intensity-based Colors',
      classification: 'Classification Colors'
    };
    
    this.updateStatus(`Color mode: ${modeLabels[mode]}`, 'success');
    console.log(`☁️ Color Mode changed to: ${mode}`);
  };

  // Update Eye Dome Lighting
  BimViewer.setEyeDomeLighting = function(enabled) {
    this.pointCloudSettings.edlEnabled = enabled;
    this.applyPointCloudSettingsToAllTilesets();
    this.updateStatus(`EDL ${enabled ? 'enabled' : 'disabled'}`, 'success');
    console.log(`☁️ Eye Dome Lighting: ${enabled}`);
  };

  // Update EDL Strength
  BimViewer.setEDLStrength = function(strength) {
    this.pointCloudSettings.edlStrength = parseFloat(strength);
    this.applyPointCloudSettingsToAllTilesets();
    console.log(`☁️ EDL Strength: ${strength}`);
  };

  // Update EDL Radius
  BimViewer.setEDLRadius = function(radius) {
    this.pointCloudSettings.edlRadius = parseFloat(radius);
    this.applyPointCloudSettingsToAllTilesets();
    console.log(`☁️ EDL Radius: ${radius}`);
  };

  // Update Point Size
  BimViewer.setPointSize = function(size) {
    this.pointCloudSettings.pointSize = parseFloat(size);
    this.applyPointCloudSettingsToAllTilesets();
    console.log(`☁️ Point Size: ${size}`);
  };

  // Update Attenuation
  BimViewer.setAttenuation = function(enabled) {
    this.pointCloudSettings.attenuationEnabled = enabled;
    this.applyPointCloudSettingsToAllTilesets();
    this.updateStatus(`Point attenuation ${enabled ? 'enabled' : 'disabled'}`, 'success');
    console.log(`☁️ Point Attenuation: ${enabled}`);
  };

  // Update Maximum Attenuation
  BimViewer.setMaximumAttenuation = function(value) {
    // Value between 1 (no attenuation) and 10 (strong attenuation)
    const attenuation = value === 1 ? undefined : parseFloat(value);
    this.pointCloudSettings.maximumAttenuation = attenuation;
    this.applyPointCloudSettingsToAllTilesets();
    console.log(`☁️ Maximum Attenuation: ${value}`);
  };

  // Update Geometric Error Scale
  BimViewer.setGeometricErrorScale = function(scale) {
    this.pointCloudSettings.geometricErrorScale = parseFloat(scale);
    this.applyPointCloudSettingsToAllTilesets();
    console.log(`☁️ Geometric Error Scale: ${scale}`);
  };

  // Toggle Back Face Culling
  BimViewer.setBackFaceCulling = function(enabled) {
    this.pointCloudSettings.backFaceCulling = enabled;
    this.applyPointCloudSettingsToAllTilesets();
    this.updateStatus(`Back face culling ${enabled ? 'enabled' : 'disabled'}`, 'success');
    console.log(`☁️ Back Face Culling: ${enabled}`);
  };

  // Reset to default settings
  BimViewer.resetPointCloudSettings = function() {
    this.pointCloudSettings = {
      edlEnabled: true,
      edlStrength: 1.0,
      edlRadius: 1.0,
      pointSize: 2.0,
      attenuationEnabled: true,
      maximumAttenuation: undefined,
      shadingEnabled: true,
      colorMode: 'rgb',
      useOriginalColors: true,
      geometricErrorScale: 1.0,
      backFaceCulling: false,
      appliedTilesets: new Map()
    };
    
    this.applyPointCloudSettingsToAllTilesets();
    this.updatePointCloudUI();
    this.updateStatus('Point cloud settings reset to defaults (RGB colors)', 'success');
    console.log('✅ Point cloud settings reset');
  };

  // Update UI to reflect current settings
  BimViewer.updatePointCloudUI = function() {
    const settings = this.pointCloudSettings;
    
    // Color Mode Select
    const colorModeSelect = document.getElementById('colorModeSelect');
    if (colorModeSelect) {
      colorModeSelect.value = settings.colorMode || 'rgb';
    }
    
    // EDL Toggle
    const edlToggle = document.getElementById('toggleEDL');
    if (edlToggle) {
      if (settings.edlEnabled) {
        edlToggle.classList.add('active');
      } else {
        edlToggle.classList.remove('active');
      }
    }
    
    // EDL Strength
    const edlStrengthSlider = document.getElementById('edlStrengthSlider');
    const edlStrengthValue = document.getElementById('edlStrengthValue');
    if (edlStrengthSlider && edlStrengthValue) {
      edlStrengthSlider.value = settings.edlStrength;
      edlStrengthValue.textContent = settings.edlStrength.toFixed(1);
    }
    
    // EDL Radius
    const edlRadiusSlider = document.getElementById('edlRadiusSlider');
    const edlRadiusValue = document.getElementById('edlRadiusValue');
    if (edlRadiusSlider && edlRadiusValue) {
      edlRadiusSlider.value = settings.edlRadius;
      edlRadiusValue.textContent = settings.edlRadius.toFixed(1);
    }
    
    // Point Size
    const pointSizeSlider = document.getElementById('pointSizeSlider');
    const pointSizeValue = document.getElementById('pointSizeValue');
    if (pointSizeSlider && pointSizeValue) {
      pointSizeSlider.value = settings.pointSize;
      pointSizeValue.textContent = settings.pointSize.toFixed(1);
    }
    
    // Attenuation Toggle
    const attenuationToggle = document.getElementById('toggleAttenuation');
    if (attenuationToggle) {
      if (settings.attenuationEnabled) {
        attenuationToggle.classList.add('active');
      } else {
        attenuationToggle.classList.remove('active');
      }
    }
    
    // Maximum Attenuation
    const maxAttenuationSlider = document.getElementById('maxAttenuationSlider');
    const maxAttenuationValue = document.getElementById('maxAttenuationValue');
    if (maxAttenuationSlider && maxAttenuationValue) {
      const displayValue = settings.maximumAttenuation || 1;
      maxAttenuationSlider.value = displayValue;
      maxAttenuationValue.textContent = displayValue === 1 ? 'None' : displayValue.toFixed(1);
    }
    
    // Geometric Error Scale
    const geometricErrorSlider = document.getElementById('geometricErrorSlider');
    const geometricErrorValue = document.getElementById('geometricErrorValue');
    if (geometricErrorSlider && geometricErrorValue) {
      geometricErrorSlider.value = settings.geometricErrorScale;
      geometricErrorValue.textContent = settings.geometricErrorScale.toFixed(1);
    }
    
    // Back Face Culling Toggle
    const backFaceToggle = document.getElementById('toggleBackFaceCulling');
    if (backFaceToggle) {
      if (settings.backFaceCulling) {
        backFaceToggle.classList.add('active');
      } else {
        backFaceToggle.classList.remove('active');
      }
    }
  };

  // Get current point cloud info
  BimViewer.getPointCloudInfo = function() {
    let pointCloudCount = 0;
    const info = [];
    
    if (this.loadedAssets) {
      this.loadedAssets.forEach((assetData, assetId) => {
        const tileset = assetData.tileset;
        if (tileset && this.isPointCloudTileset(tileset)) {
          pointCloudCount++;
          info.push({
            id: assetId,
            name: assetData.name,
            hasEDL: tileset.pointCloudShading?.eyeDomeLighting || false
          });
        }
      });
    }
    
    return {
      count: pointCloudCount,
      tilesets: info
    };
  };

  // Preset configurations
  BimViewer.applyPointCloudPreset = function(presetName) {
    const presets = {
      // High Quality - Best visual appearance
      quality: {
        edlEnabled: true,
        edlStrength: 1.5,
        edlRadius: 2.0,
        pointSize: 3.0,
        attenuationEnabled: true,
        maximumAttenuation: 3.0,
        geometricErrorScale: 1.0,
        backFaceCulling: false,
        colorMode: 'rgb',
        useOriginalColors: true
      },
      
      // Performance - Faster rendering
      performance: {
        edlEnabled: false,
        edlStrength: 0.5,
        edlRadius: 1.0,
        pointSize: 1.5,
        attenuationEnabled: true,
        maximumAttenuation: 5.0,
        geometricErrorScale: 2.0,
        backFaceCulling: true,
        colorMode: 'rgb',
        useOriginalColors: true
      },
      
      // Detailed - For close-up inspection
      detailed: {
        edlEnabled: true,
        edlStrength: 2.0,
        edlRadius: 1.5,
        pointSize: 4.0,
        attenuationEnabled: false,
        maximumAttenuation: undefined,
        geometricErrorScale: 0.5,
        backFaceCulling: false,
        colorMode: 'rgb',
        useOriginalColors: true
      }
    };
    
    const preset = presets[presetName];
    if (!preset) {
      console.warn(`⚠️ Unknown preset: ${presetName}`);
      return;
    }
    
    // Apply preset
    Object.assign(this.pointCloudSettings, preset);
    this.applyPointCloudSettingsToAllTilesets();
    this.updatePointCloudUI();
    
    const presetLabels = {
      quality: 'High Quality',
      performance: 'Performance',
      detailed: 'Detailed Inspection'
    };
    
    this.updateStatus(`Preset applied: ${presetLabels[presetName]} (RGB colors preserved)`, 'success');
    console.log(`✅ Point cloud preset applied: ${presetName} (RGB colors on)`);
  };

  console.log('✅ Point Cloud module loaded v1.0');
  console.log('💡 Usage:');
  console.log('   - Eye Dome Lighting (EDL) for depth perception');
  console.log('   - Point Size and Attenuation controls');
  console.log('   - Performance optimization options');

})();
