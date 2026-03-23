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
// CESIUM BIM VIEWER - LIGHTING MODULE v4.2 (SIMPLIFIED)
// Terrain, Assets and Google 3D Tiles lighting support
// Re-Enable fix, imageBasedLighting control
// Shadows enabled for dramatic effects
// Realistic mode only (ambient mode options removed)
// ===============================
'use strict';

(function(BimViewer) {
  
  // Initialize Lighting system
  BimViewer.initLighting = function() {
    if (this.lighting) {
      console.log('⚠️ Lighting already initialized');
      return;
    }
    
    this.lighting = {
      enabled: false,
      currentTime: null,
      animateTime: false,
      timeSpeed: 1.0,
      monitoredTilesets: new WeakSet(),
      terrainReloaded: false,
      originalTerrainProvider: null
    };
    
    // Store original terrain provider
    this.lighting.originalTerrainProvider = this.viewer.terrainProvider;
    
    // Setup tileset monitor
    this.setupTilesetMonitor();
    
    console.log('✅ Lighting system v4.0 initialized');
  };
  
  // Monitor for new tilesets
  BimViewer.setupTilesetMonitor = function() {
    if (!this.viewer || !this.viewer.scene) return;
    
    setInterval(() => {
      if (this.lighting && this.lighting.enabled) {
        this.updateAllTilesets();
      }
    }, 2000);
    
    console.log('🔍 Tileset monitor active');
  };
  
  // 🔥 IMPROVED: Enable dynamic lighting with proper cleanup
  BimViewer.enableDynamicLighting = function(enable = true) {
    if (!this.viewer) {
      console.error('❌ Viewer not initialized');
      return false;
    }

    if (!this.lighting) {
      console.log('⚠️ Lighting not initialized - initializing now...');
      this.initLighting();
    }

    // Track lighting usage with Plausible (only when enabling)
    if (enable && typeof plausible !== 'undefined' && !this._lightingTracked) {
      plausible('Feature Used', { props: { feature: 'Lighting' } });
      this._lightingTracked = true;
    }

    console.log(`${enable ? '🌅 ENABLING' : '🌑 DISABLING'} Dynamic Lighting...`);
    
    if (enable) {
      // ====== ENABLE LIGHTING ======
      
      this.lighting.enabled = true;
      
      // STEP 1: Globe lighting
      this.viewer.scene.globe.enableLighting = true;
      console.log('  ✅ Globe lighting enabled');
      
      // STEP 2: Dynamic atmosphere
      this.viewer.scene.globe.dynamicAtmosphereLighting = true;
      this.viewer.scene.globe.dynamicAtmosphereLightingFromSun = true;
      console.log('  ✅ Atmosphere lighting enabled');
      
      // STEP 2.5: 🔥 NEW - Enable shadows for dramatic effect
      this.viewer.scene.shadowMap.enabled = true;
      this.viewer.scene.shadowMap.darkness = 0.4;
      this.viewer.scene.shadowMap.softShadows = true;
      this.viewer.scene.shadowMap.size = 2048;
      this.viewer.scene.shadowMap.normalOffset = true;
      this.viewer.scene.shadowMap.maximumDistance = 1000.0;
      this.viewer.scene.globe.shadows = Cesium.ShadowMode.RECEIVE_ONLY;
      console.log('  ✅ Shadow system enabled (size: 2048, maxDist: 200m, normalOffset: true)');
      
      // STEP 3: 🔥 CRITICAL - Reload terrain with vertex normals
      this.reloadTerrainWithLighting();
      
      // STEP 4: Set initial time if not set
      if (!this.lighting.currentTime) {
        this.setTime('2024-10-15T13:30:00');
      }

      // STEP 5: Increase sun intensity for dynamic lighting
      if (typeof this.setSunIntensity === 'function') {
        this.setSunIntensity(0.85);
      }

      // STEP 6: Update all tilesets
      setTimeout(() => {
        this.updateAssetLighting();
        this.updateAllTilesets();
        console.log('  ✅ All tilesets updated');
      }, 1000);

      // STEP 7: Re-apply IBL after lighting settles (ibl.js owns imageBasedLightingFactor)
      setTimeout(() => {
        if (typeof BimViewer.applyIBLToAll === 'function') {
          BimViewer.applyIBLToAll();
          console.log('  ✅ IBL re-applied after lighting enable');
        }
      }, 1500);

      console.log('🌅 Dynamic lighting ENABLED');
      console.log(`   🌑 Shadows: ENABLED`);

      this.updateStatus('Dynamic lighting enabled with shadows', 'success');
      
      return true;
      
    } else {
      // ====== DISABLE LIGHTING ======
      
      this.lighting.enabled = false;
      
      // Disable globe lighting
      this.viewer.scene.globe.enableLighting = false;
      this.viewer.scene.globe.dynamicAtmosphereLighting = false;
      this.viewer.scene.globe.dynamicAtmosphereLightingFromSun = false;
      
      // Disable shadows
      this.viewer.scene.shadowMap.enabled = false;
      this.viewer.scene.globe.shadows = Cesium.ShadowMode.DISABLED;
      console.log('  ✅ Shadows disabled');

      // Restore default sun intensity
      if (typeof this.setSunIntensity === 'function') {
        this.setSunIntensity(0.75);
      }

      // Reset tilesets to bright mode
      this.loadedAssets?.forEach((asset) => {
        if (asset.tileset) {
          this.applyLightingToTileset(asset.tileset, 'bright');
        }
      });
      
      const primitives = this.viewer.scene.primitives;
      for (let i = 0; i < primitives.length; i++) {
        const primitive = primitives.get(i);
        if (primitive instanceof Cesium.Cesium3DTileset) {
          this.applyLightingToTileset(primitive, 'bright');
        }
      }
      
      // Re-apply IBL so ibl.js restores its imageBasedLightingFactor values
      setTimeout(() => {
        if (typeof BimViewer.applyIBLToAll === 'function') {
          BimViewer.applyIBLToAll();
          console.log('  ✅ IBL re-applied after lighting disable');
        }
      }, 500);

      console.log('🌑 Dynamic lighting DISABLED');
      this.updateStatus('Dynamic lighting disabled', 'success');
      
      return false;
    }
  };
  
  // 🔥 NEW: Reload terrain with vertex normals
  BimViewer.reloadTerrainWithLighting = function() {
    console.log('  🌍 Reloading terrain with vertex normals...');
    
    try {
      // Create new terrain with vertex normals
      const newTerrain = Cesium.Terrain.fromWorldTerrain({
        requestVertexNormals: true,
        requestWaterMask: true
      });
      
      // Apply to scene
      this.viewer.scene.setTerrain(newTerrain);
      
      this.lighting.terrainReloaded = true;
      console.log('  ✅ Terrain reloaded with vertex normals');
      
      // Wait for terrain to be ready (check if readyPromise exists)
      if (newTerrain.readyPromise && typeof newTerrain.readyPromise.then === 'function') {
        newTerrain.readyPromise.then(() => {
          console.log('  ✅ Terrain is ready');
          this.updateStatus('Terrain lighting ready', 'success');
        }).catch((error) => {
          console.error('  ❌ Terrain loading error:', error);
          this.lighting.terrainReloaded = false;
        });
      } else {
        console.log('  ℹ️ Terrain applied (no readyPromise available)');
        this.updateStatus('Terrain lighting applied', 'success');
      }
      
    } catch (error) {
      console.error('  ❌ Failed to reload terrain:', error);
      this.lighting.terrainReloaded = false;
    }
  };
  
  // Set specific time
  BimViewer.setTime = function(isoTimeString) {
    if (!this.viewer) {
      console.error('❌ Viewer not initialized');
      return;
    }
    
    if (!this.lighting) {
      this.initLighting();
    }
    
    try {
      const julianDate = Cesium.JulianDate.fromIso8601(isoTimeString);
      this.viewer.clock.currentTime = julianDate;
      this.lighting.currentTime = isoTimeString;
      
      console.log(`⏰ Time set to: ${isoTimeString}`);
      
      return julianDate;
    } catch (error) {
      console.error('❌ Error setting time:', error);
    }
  };
  
  // Preset times
  BimViewer.setPresetTime = function(preset) {
    const presets = {
      'dawn': '2024-06-21T06:00:00',
      'morning': '2024-06-21T09:00:00',
      'noon': '2024-06-21T12:00:00',
      'afternoon': '2024-06-21T13:00:00',
      'sunset': '2024-06-21T18:00:00',
      'dusk': '2024-06-21T19:30:00',
      'night': '2024-06-21T23:00:00',
      'midnight': '2024-06-21T00:00:00'
    };
    
    if (presets[preset]) {
      this.setTime(presets[preset]);
      this.updateStatus(`Time set to ${preset}`, 'success');
    }
  };
  
  // Animate time
  BimViewer.animateTime = function(enable = true, speed = 100) {
    if (!this.lighting) {
      this.initLighting();
    }
    
    this.lighting.animateTime = enable;
    this.lighting.timeSpeed = speed;
    
    if (enable) {
      this.viewer.clock.shouldAnimate = true;
      this.viewer.clock.multiplier = speed;
      console.log(`⏩ Time animation enabled (${speed}x speed)`);
      this.updateStatus(`Time animation: ${speed}x speed`, 'success');
    } else {
      this.viewer.clock.shouldAnimate = false;
      console.log('⏸️ Time animation paused');
      this.updateStatus('Time animation paused', 'success');
    }
  };
  
  // 🔥 ENHANCED: Apply lighting to tileset with dramatic effects
  BimViewer.applyLightingToTileset = function(tileset, mode) {
    if (!tileset) return;
    
    try {
      // Check if tileset has imageBasedLighting
      if (!tileset.imageBasedLighting) {
        console.log('ℹ️ Tileset has no imageBasedLighting');
        return;
      }
      
      // Try to apply settings
      try {
        // NOTE: imageBasedLightingFactor is owned by ibl.js — lighting.js only manages shadows
        switch(mode) {
          case 'realistic':
          case 'soft':
          case 'balanced':
            if (tileset.shadows !== undefined) {
              tileset.shadows = Cesium.ShadowMode.ENABLED;
            }
            console.log(`  🌙 Applied ${mode} mode (Shadows ON)`);
            break;

          case 'bright':
            if (tileset.shadows !== undefined) {
              tileset.shadows = Cesium.ShadowMode.DISABLED;
            }
            console.log(`  💡 Applied BRIGHT mode (Shadows OFF)`);
            break;
        }
        
        // 🔥 NEW: Force tileset to update style for immediate effect
        if (tileset.style) {
          const currentStyle = tileset.style;
          tileset.style = undefined;
          setTimeout(() => {
            tileset.style = currentStyle;
          }, 10);
        }
        
      } catch (error) {
        // Read-only property (Google 3D Tiles)
        console.log('  ℹ️ Read-only lighting (Google 3D Tiles - automatic sun lighting)');
      }
      
    } catch (error) {
      console.log('  ℹ️ Could not apply lighting:', error.message);
    }
  };
  
  // Update all tilesets
  BimViewer.updateAllTilesets = function() {
    if (!this.viewer || !this.lighting) return;
    
    const primitives = this.viewer.scene.primitives;
    let updatedCount = 0;
    
    for (let i = 0; i < primitives.length; i++) {
      const primitive = primitives.get(i);

      if (primitive instanceof Cesium.Cesium3DTileset) {
        if (this.lighting.monitoredTilesets.has(primitive)) {
          continue;
        }

        this.applyLightingToTileset(primitive, 'realistic');
        this.lighting.monitoredTilesets.add(primitive);
        updatedCount++;
      } else if (primitive instanceof Cesium.Model) {
        primitive.shadows = Cesium.ShadowMode.ENABLED;
        updatedCount++;
      }
    }
    
    if (updatedCount > 0) {
      console.log(`🌍 Updated ${updatedCount} new tilesets`);
    }
    
    return updatedCount;
  };
  
  // Update asset lighting
  BimViewer.updateAssetLighting = function() {
    if (!this.loadedAssets || !this.lighting) return;
    
    const mode = this.lighting.enabled ? 'realistic' : 'bright';
    let updatedCount = 0;
    
    this.loadedAssets.forEach((asset) => {
      if (asset.tileset) {
        this.applyLightingToTileset(asset.tileset, mode);

        if (this.lighting.enabled && this.lighting.monitoredTilesets) {
          this.lighting.monitoredTilesets.add(asset.tileset);
        }

        updatedCount++;
      } else if (asset.isGLB && asset.model) {
        // Apply shadow mode to GLB models
        asset.model.shadows = (mode === 'bright') ? Cesium.ShadowMode.DISABLED : Cesium.ShadowMode.ENABLED;
        updatedCount++;
      }
    });
    
    if (updatedCount > 0) {
      console.log(`🔄 Updated ${updatedCount} assets (${mode} mode)`);
    }
  };
  
  // Get sun position info
  BimViewer.getSunPosition = function() {
    if (!this.viewer) return null;
    
    const julianDate = this.viewer.clock.currentTime;
    const cameraPosition = this.viewer.camera.positionWC;
    const cameraCartographic = Cesium.Cartographic.fromCartesian(cameraPosition);
    
    return {
      julianDate: julianDate,
      isoString: Cesium.JulianDate.toIso8601(julianDate),
      cameraLongitude: Cesium.Math.toDegrees(cameraCartographic.longitude),
      cameraLatitude: Cesium.Math.toDegrees(cameraCartographic.latitude)
    };
  };
  
  // 🔥 DEBUG: Get lighting status
  BimViewer.getLightingStatus = function() {
    if (!this.lighting) {
      return { error: 'Lighting not initialized' };
    }
    
    return {
      enabled: this.lighting.enabled,
      terrainReloaded: this.lighting.terrainReloaded,
      currentTime: this.lighting.currentTime,
      globeLighting: this.viewer.scene.globe.enableLighting,
      dynamicAtmosphere: this.viewer.scene.globe.dynamicAtmosphereLighting,
      shadowsEnabled: this.viewer.scene.shadowMap.enabled,
      shadowDarkness: this.viewer.scene.shadowMap.darkness,
      monitoredTilesets: this.lighting.monitoredTilesets ? 'Active' : 'Inactive'
    };
  };
  
  // 🔥 NEW: Control shadow intensity
  BimViewer.setShadowIntensity = function(darkness = 0.4) {
    if (!this.viewer) return;
    
    // Clamp value between 0 and 1
    darkness = Math.max(0, Math.min(1, darkness));
    
    if (this.viewer.scene.shadowMap.enabled) {
      this.viewer.scene.shadowMap.darkness = darkness;
      console.log(`🌑 Shadow darkness set to: ${darkness}`);
      this.updateStatus(`Shadow intensity: ${Math.round(darkness * 100)}%`, 'success');
    } else {
      console.log('⚠️ Shadows not enabled. Enable lighting first.');
    }
  };
  
  // 🔥 NEW: Test lighting on all visible tilesets
  BimViewer.testLightingEffects = function() {
    console.log('🧪 TESTING LIGHTING EFFECTS ON ALL TILESETS...');
    console.log('');
    
    const primitives = this.viewer.scene.primitives;
    let tilesetCount = 0;
    
    for (let i = 0; i < primitives.length; i++) {
      const primitive = primitives.get(i);
      
      if (primitive instanceof Cesium.Cesium3DTileset) {
        tilesetCount++;
        console.log(`📦 Tileset ${tilesetCount}:`);
        console.log(`   - Has IBL: ${!!primitive.imageBasedLighting}`);
        
        if (primitive.imageBasedLighting) {
          console.log(`   - IBL Enabled: ${primitive.imageBasedLighting.enabled}`);
          console.log(`   - Luminance: ${primitive.imageBasedLighting.luminanceAtZenith}`);
        }
        
        console.log(`   - Shadow Mode: ${primitive.shadows || 'Not set'}`);
        console.log('');
      }
    }
    
    console.log(`📊 Total tilesets found: ${tilesetCount}`);
    console.log('');
    console.log('🌅 Scene Settings:');
    console.log(`   - Globe Lighting: ${this.viewer.scene.globe.enableLighting}`);
    console.log(`   - Dynamic Atmosphere: ${this.viewer.scene.globe.dynamicAtmosphereLighting}`);
    console.log(`   - Shadows: ${this.viewer.scene.shadowMap.enabled}`);
    console.log(`   - Shadow Darkness: ${this.viewer.scene.shadowMap.darkness}`);
    
    return {
      tilesetCount,
      globeLighting: this.viewer.scene.globe.enableLighting,
      shadowsEnabled: this.viewer.scene.shadowMap.enabled
    };
  };
  
  // Hook into asset loading
  const originalAddAsset = BimViewer.addAsset;
  if (originalAddAsset) {
    BimViewer.addAsset = function(...args) {
      const result = originalAddAsset.apply(this, args);
      
      if (this.lighting && this.lighting.enabled) {
        setTimeout(() => {
          this.updateAssetLighting();
        }, 1000);
      }
      
      return result;
    };
  }
  
  console.log('✅ Lighting module v4.2 loaded (ENHANCED - MORE DRAMATIC)');
  console.log('');
  console.log('🚀 USAGE:');
  console.log('   BimViewer.enableDynamicLighting(true)');
  console.log('   BimViewer.setPresetTime("night")');
  console.log('   BimViewer.setShadowIntensity(0.6) - Adjust shadow darkness (0-1)');
  console.log('');
  console.log('🔍 DEBUG:');
  console.log('   BimViewer.getLightingStatus() - Check current status');
  console.log('   BimViewer.testLightingEffects() - Test all tilesets');
  console.log('');
  console.log('✨ NEW IN v4.1:');
  console.log('   - Shadows enabled for dramatic effects');
  console.log('   - More dramatic luminance values (0.02 - 0.8)');
  console.log('   - Shadow intensity control');
  console.log('   - Enhanced testing tools');
  
})(window.BimViewer = window.BimViewer || {});
