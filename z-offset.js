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
// CESIUM BIM VIEWER - Z-OFFSET MODULE v6.0 (OPTION A - Relative to Original)
// Simple offset relative to original position (no terrain calculations)
// +10m = 10 meters ABOVE original position
// 0m = Back to ORIGINAL position (reset)
// -5m = 5 meters BELOW original position
// NO X/Y shift - uses fromRadians for perfect vertical direction
// Super simple - no terrain sampling needed
// ===============================
'use strict';

(function(BimViewer) {
  
  // Initialize Z-Offset system
  BimViewer.initZOffset = function() {
    this.zOffset = {
      enabled: false,
      globalOffset: 0,
      originalPositions: new Map(),      // Original modelMatrix
      originalCartographics: new Map(),  // Original Cartographic (lon/lat/height) for direction
      individualOffsets: new Map()       // Current offset for each asset
    };
    
    console.log('✅ Z-Offset system initialized (v6.0 - Option A: Relative to Original)');
  };
  
  // Apply INDIVIDUAL Z-Offset to a specific asset
  // Option A: Offset relative to ORIGINAL position (no terrain)
  // Keep the Loaded-Assets card UI in sync with the current per-asset offset.
  // Slider min/max is [-15, +15] for fine control; the real offset may exceed that
  // (e.g. after Clamp to Terrain). We clamp the slider position but the input box
  // and value display always show the true number.
  BimViewer.syncZOffsetUI = function(assetId, offsetValue) {
    const slider = document.getElementById(`zoffset_slider_${assetId}`);
    const input = document.getElementById(`zoffset_input_${assetId}`);
    const display = document.getElementById(`zoffset_value_${assetId}`);
    if (slider) slider.value = Math.max(-15, Math.min(15, offsetValue));
    if (input) input.value = offsetValue.toFixed(2);
    if (display) {
      display.textContent = `${offsetValue >= 0 ? '+' : ''}${offsetValue.toFixed(2)} m`;
    }
  };

  BimViewer.applyIndividualZOffset = async function(assetId, offsetMeters, isLiveUpdate = false) {
    // loadedAssets is keyed by String(assetId); the UI passes assetId as a string
    // (via inline onclick template literal), while Ion assets store id as a Number.
    // Use the Map lookup to stay consistent with toggleAssetVisibility / updateAssetOpacity.
    const asset = this.loadedAssets.get(String(assetId));

    if (!asset || !asset.tileset) {
      console.error(`Asset ${assetId} not found`);
      return;
    }
    
    // Only log during non-live updates to reduce console spam
    if (!isLiveUpdate) {
      console.log(`🎯 Applying individual Z-offset to ${asset.name}: ${offsetMeters}m (relative to original)`);
    }
    
    try {
      // Store original position if not already stored
      if (!this.zOffset.originalPositions.has(asset.tileset)) {
        // Store original matrix
        this.zOffset.originalPositions.set(
          asset.tileset, 
          Cesium.Matrix4.clone(asset.tileset.modelMatrix)
        );
        
        // Store ORIGINAL cartographic for lon/lat reference
        const originalCenter = Cesium.Cartesian3.clone(asset.tileset.boundingSphere.center);
        const originalCartographic = Cesium.Cartographic.fromCartesian(originalCenter);
        
        if (!this.zOffset.originalCartographics) {
          this.zOffset.originalCartographics = new Map();
        }
        this.zOffset.originalCartographics.set(asset.tileset, originalCartographic);
        
        if (!isLiveUpdate) {
          console.log(`📦 Stored original position for ${asset.name} at height ${originalCartographic.height.toFixed(1)}m`);
        }
      }
      
      // Get original cartographic
      const originalCartographic = this.zOffset.originalCartographics.get(asset.tileset);
      
      // ✅ OPTION A: Simple! offsetMeters is directly the movement we want
      // No terrain sampling needed!
      await this.applyZOffsetToAsset(asset, offsetMeters, originalCartographic, isLiveUpdate);
      
      // Store individual offset
      this.zOffset.individualOffsets.set(asset.tileset, offsetMeters);

      // Sync card UI (skip during live slider drag — the slider IS the source of truth)
      if (!isLiveUpdate) {
        this.syncZOffsetUI(String(assetId), offsetMeters);
      }

      // Only log completion during non-live updates
      if (!isLiveUpdate) {
        console.log(`✅ ${asset.name}: Moved ${offsetMeters >= 0 ? '+' : ''}${offsetMeters}m from original position`);
      }

    } catch (error) {
      console.error(`Error applying Z-offset to ${asset.name}:`, error);
      this.updateStatus(`Z-Offset error: ${error.message}`, 'error');
    }
  };
  
  // Core function - OPTION A: Simple offset relative to original (no terrain)
  BimViewer.applyZOffsetToAsset = function(asset, offsetMeters, originalCartographic, isLiveUpdate = false) {
    // ── Gizmo reconciliation ──────────────────────────────────────────────
    // When the asset carries a *trusted* placement baseline (root.transform-
    // derived, see core.js initAssetPlacement), height is a field shared with
    // the gizmo Z-handle. Route the offset through placement.height +
    // updateAssetPlacement — the single modelMatrix writer — instead of the
    // legacy translation-matrix path, so slider and gizmo never fight over
    // tileset.modelMatrix. offset is measured from placement.baseHeight, which
    // preserves the "relative to original position" semantics.
    if (asset.placement && asset.placement.position && asset.placement.trusted &&
        typeof this.updateAssetPlacement === 'function') {
      return new Promise((resolve) => {
        if (asset.placement.baseHeight === undefined || asset.placement.baseHeight === null) {
          asset.placement.baseHeight = asset.placement.position.height;
        }
        asset.placement.position.height = asset.placement.baseHeight + offsetMeters;
        this.updateAssetPlacement(String(asset.id));
        resolve(asset.name);
      });
    }

    return new Promise((resolve, reject) => {
      try {
        if (!originalCartographic) {
          reject(new Error(`No original cartographic stored for ${asset.name}`));
          return;
        }
        
        // Only log details during non-live updates
        if (!isLiveUpdate) {
          console.log(`🗺️ ${asset.name}: Moving ${offsetMeters >= 0 ? '+' : ''}${offsetMeters}m from original position`);
        }
        
        // ✅ OPTION A - SUPER SIMPLE!
        // offsetMeters is DIRECTLY the movement we want (no terrain calculation)
        // +10m = 10m up from original
        // 0m = back to original
        // -5m = 5m down from original
        
        // Create point at surface (height = 0) - reference point at ORIGINAL lon/lat
        const surface = Cesium.Cartesian3.fromRadians(
          originalCartographic.longitude,
          originalCartographic.latitude,
          0.0
        );
        
        // Create point at offset height - this is our movement vector
        const offsetPoint = Cesium.Cartesian3.fromRadians(
          originalCartographic.longitude,
          originalCartographic.latitude,
          offsetMeters  // ← DIRECT offset from original!
        );
        
        // The translation vector = perfect "up" direction at ORIGINAL location
        const translation = Cesium.Cartesian3.subtract(
          offsetPoint,
          surface,
          new Cesium.Cartesian3()
        );
        
        // Create translation matrix
        const translationMatrix = Cesium.Matrix4.fromTranslation(translation, new Cesium.Matrix4());
        
        // Get original matrix (from when asset was first loaded)
        const originalMatrix = this.zOffset.originalPositions.get(asset.tileset);
        if (!originalMatrix) {
          reject(new Error(`No original position stored for ${asset.name}`));
          return;
        }
        
        // Apply translation to original matrix
        // This moves the asset by exactly offsetMeters from its ORIGINAL position
        const newMatrix = Cesium.Matrix4.multiply(
          translationMatrix, 
          originalMatrix, 
          new Cesium.Matrix4()
        );
        
        // ✅ Set the new matrix - perfect vertical movement!
        asset.tileset.modelMatrix = newMatrix;
        
        resolve(asset.name);
        
      } catch (error) {
        reject(new Error(`Error positioning ${asset.name}: ${error.message}`));
      }
    });
  };
  
  // Apply GLOBAL Z-Offset to all assets (without individual offsets)
  // OPTION A: Simple offset relative to original position
  BimViewer.applyGlobalZOffset = async function(offsetMeters) {
    if (!this.zOffset) {
      console.error('Z-Offset system not initialized');
      return;
    }
    
    this.zOffset.globalOffset = offsetMeters;
    
    console.log(`🌍 Applying global Z-offset: ${offsetMeters >= 0 ? '+' : ''}${offsetMeters}m from original positions`);
    
    // Get assets that don't have individual offsets
    const assetsToProcess = Array.from(this.loadedAssets.values()).filter(asset => 
      asset.tileset && !this.zOffset.individualOffsets.has(asset.tileset)
    );
    
    if (assetsToProcess.length === 0) {
      console.log('No assets to process (all have individual offsets)');
      return;
    }
    
    console.log(`Processing ${assetsToProcess.length} assets...`);
    
    // Store original positions and cartographics
    assetsToProcess.forEach(asset => {
      if (!this.zOffset.originalPositions.has(asset.tileset)) {
        this.zOffset.originalPositions.set(
          asset.tileset,
          Cesium.Matrix4.clone(asset.tileset.modelMatrix)
        );
        
        // Store original cartographic for direction
        const originalCenter = Cesium.Cartesian3.clone(asset.tileset.boundingSphere.center);
        const originalCartographic = Cesium.Cartographic.fromCartesian(originalCenter);
        this.zOffset.originalCartographics.set(asset.tileset, originalCartographic);
      }
    });
    
    // Wait for tilesets to be ready
    await Promise.all(assetsToProcess.map(asset => asset.tileset.readyPromise));
    
    // Apply offset to each asset - NO terrain sampling needed!
    const operations = assetsToProcess.map((asset) => {
      const originalCartographic = this.zOffset.originalCartographics.get(asset.tileset);
      return this.applyZOffsetToAsset(asset, offsetMeters, originalCartographic, false);
    });
    
    const results = await Promise.allSettled(operations);
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected');
    
    if (failed.length > 0) {
      console.warn('Some assets failed:', failed.map(f => f.reason));
    }
    
    console.log(`✅ Global Z-offset applied: ${successful}/${assetsToProcess.length} assets`);
    this.updateStatus(`Z-Offset: ${successful} assets moved ${offsetMeters >= 0 ? '+' : ''}${offsetMeters}m`, 'success');
  };
  
  // Reset asset to original position
  BimViewer.resetAssetZOffset = function(assetId) {
    const asset = this.loadedAssets.get(String(assetId));

    if (!asset || !asset.tileset) {
      console.error(`Asset ${assetId} not found`);
      return;
    }
    
    // Trusted-placement assets reset via the shared placement.height field so
    // the gizmo and the modelMatrix stay consistent (see applyZOffsetToAsset).
    if (asset.placement && asset.placement.position && asset.placement.trusted &&
        typeof this.updateAssetPlacement === 'function') {
      if (asset.placement.baseHeight !== undefined && asset.placement.baseHeight !== null) {
        asset.placement.position.height = asset.placement.baseHeight;
      }
      this.updateAssetPlacement(String(assetId));
      this.zOffset.individualOffsets.delete(asset.tileset);
      this.syncZOffsetUI(String(assetId), 0);
      console.log(`♻️ ${asset.name} reset to original position (placement)`);
      return;
    }

    const originalMatrix = this.zOffset.originalPositions.get(asset.tileset);
    if (originalMatrix) {
      asset.tileset.modelMatrix = originalMatrix;
      this.zOffset.individualOffsets.delete(asset.tileset);
      console.log(`♻️ ${asset.name} reset to original position`);
    }
  };
  
  // ==================================================================
  // CLAMP TO TERRAIN — align asset center to sampled terrain height,
  // expressed as an individual Z-offset relative to original position.
  // Only meaningful when a real terrain provider (e.g. Cesium World
  // Terrain) is active — flat ellipsoid terrain just snaps to height 0.
  // ==================================================================

  BimViewer.clampAssetToTerrain = async function(assetId) {
    const asset = this.loadedAssets.get(String(assetId));
    if (!asset || !asset.tileset || asset.isGLB) {
      console.warn('clampAssetToTerrain: not a 3D Tiles asset —', assetId);
      return false;
    }

    const terrainProvider = this.viewer.terrainProvider;
    if (!terrainProvider || terrainProvider instanceof Cesium.EllipsoidTerrainProvider) {
      this.updateStatus('Activate Cesium World Terrain first', 'warning');
      return false;
    }

    try {
      const carto = Cesium.Cartographic.fromCartesian(asset.tileset.boundingSphere.center);
      const results = await Cesium.sampleTerrainMostDetailed(terrainProvider, [Cesium.Cartographic.clone(carto)]);
      const terrainHeight = results[0].height;
      if (terrainHeight === undefined || terrainHeight === null) {
        console.warn(`clampAssetToTerrain: no terrain sample at ${asset.name}`);
        return false;
      }

      const currentOffset = this.zOffset.individualOffsets.get(asset.tileset) || 0;
      // carto.height = original_center_height + currentOffset
      // new_offset such that new_center_height = terrainHeight
      const newOffset = currentOffset + (terrainHeight - carto.height);

      await this.applyIndividualZOffset(assetId, newOffset);
      console.log(`🏔️ ${asset.name}: clamped to terrain (offset ${newOffset.toFixed(2)}m)`);
      return true;
    } catch (e) {
      console.error(`clampAssetToTerrain failed for ${asset.name}:`, e);
      return false;
    }
  };

  BimViewer.clampAllAssetsToTerrain = async function() {
    const assets = Array.from(this.loadedAssets.values()).filter(a => !a.isGLB && a.tileset);
    if (!assets.length) {
      this.updateStatus('No 3D Tiles assets to clamp', 'warning');
      return;
    }

    const terrainProvider = this.viewer.terrainProvider;
    if (!terrainProvider || terrainProvider instanceof Cesium.EllipsoidTerrainProvider) {
      this.updateStatus('Activate Cesium World Terrain first', 'warning');
      return;
    }

    this.updateStatus(`Clamping ${assets.length} assets to terrain…`, 'loading');

    // Single batched terrain query for all asset centers
    const cartos = assets.map(a => Cesium.Cartographic.fromCartesian(a.tileset.boundingSphere.center));
    let succeeded = 0;
    try {
      const sampled = await Cesium.sampleTerrainMostDetailed(terrainProvider, cartos.map(c => Cesium.Cartographic.clone(c)));
      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        const terrainHeight = sampled[i].height;
        if (terrainHeight === undefined || terrainHeight === null) continue;
        const currentOffset = this.zOffset.individualOffsets.get(asset.tileset) || 0;
        const newOffset = currentOffset + (terrainHeight - cartos[i].height);
        await this.applyIndividualZOffset(asset.id, newOffset);
        succeeded++;
      }
      this.updateStatus(`Clamped ${succeeded}/${assets.length} assets to terrain`, 'success');
    } catch (e) {
      console.error('clampAllAssetsToTerrain failed:', e);
      this.updateStatus('Clamp to terrain failed — see console', 'error');
    }
  };

  console.log('✅ Z-Offset module v6.0 loaded (OPTION A - Relative to Original)');
  console.log('   📐 Uses Cesium.Cartesian3.fromRadians for perfect vertical direction');
  console.log('   ✅ NO terrain calculations - simple and fast');
  console.log('   ✅ +10m = 10m above original | 0m = reset to original | -5m = 5m below original');
  console.log('   🎯 Based on official Cesium 3D Tiles Height example');
  
})(window.BimViewer = window.BimViewer || {});
