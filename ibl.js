/**
 * GEOBIM.APP - Geospatial BIM Viewer
 * © 2026 Christof Lorenz. All rights reserved.
 *
 * License: Personal and non-commercial use only.
 * Commercial use requires written permission.
 * Contact: info@geobim.app
 */

// ===============================
// CESIUM BIM VIEWER - IBL MODULE v1.4
// Image-Based Lighting via Spherical Harmonics (diffuse IBL)
// Independent from dynamic lighting (lighting.js)
// ===============================
'use strict';

(function(BimViewer) {

  const STORAGE_KEY = 'geoBIM_settings_ibl';

  // KTX2 specularEnvironmentMaps crashes in CesiumJS 1.134 —
  // shader reads texture before async load completes (maximumMipmapLevel undefined).
  // Use spherical harmonics only (immediate data, no async).

  const IBL_SPHERICAL_HARMONICS = [
    new Cesium.Cartesian3(1.234897375106812, 1.221635103225708, 1.273374080657959),
    new Cesium.Cartesian3(1.136140108108521, 1.171419978141785, 1.287894368171692),
    new Cesium.Cartesian3(1.245410919189453, 1.245791077613831, 1.283067107200623),
    new Cesium.Cartesian3(1.107124328613281, 1.112697005271912, 1.153419137001038),
    new Cesium.Cartesian3(1.08641505241394,  1.079904079437256, 1.10212504863739),
    new Cesium.Cartesian3(1.190043210983276, 1.186099290847778, 1.214627981185913),
    new Cesium.Cartesian3(0.017783647403121, 0.020140396431088, 0.025317270308733),
    new Cesium.Cartesian3(1.087014317512512, 1.084779262542725, 1.111417651176453),
    new Cesium.Cartesian3(-0.052426788955927,-0.048315055668354,-0.041973855346441),
  ];

  // ===============================
  // STATE
  // ===============================

  BimViewer.ibl = {
    enabled: true,
    diffuse: 1.0,
    specular: 1.0
  };

  // ===============================
  // INIT
  // ===============================

  BimViewer.initIBL = function() {
    // Load persisted state
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        var parsed = JSON.parse(saved);
        if (typeof parsed.enabled === 'boolean') this.ibl.enabled = parsed.enabled;
        if (typeof parsed.diffuse === 'number') this.ibl.diffuse = parsed.diffuse;
        if (typeof parsed.specular === 'number') this.ibl.specular = parsed.specular;
      }
    } catch (e) {
      console.warn('⚠️ IBL: Could not load saved state:', e.message);
    }

    // Apply to all currently loaded tilesets
    this.applyIBLToAll();

    console.log('✅ IBL module initialized (enabled:', this.ibl.enabled,
      ', diffuse:', this.ibl.diffuse, ', specular:', this.ibl.specular, ')');
  };

  // ===============================
  // APPLY TO INDIVIDUAL TILESET
  // ===============================

  BimViewer.applyIBLToTileset = function(tileset) {
    if (!tileset) return;

    try {
      var ibl = tileset.imageBasedLighting;
      if (!ibl) return;

      if (this.ibl.enabled) {
        ibl.sphericalHarmonicCoefficients = IBL_SPHERICAL_HARMONICS;
        ibl.imageBasedLightingFactor = new Cesium.Cartesian2(
          this.ibl.diffuse, this.ibl.specular
        );
      } else {
        ibl.sphericalHarmonicCoefficients = undefined;
        ibl.imageBasedLightingFactor = new Cesium.Cartesian2(1.0, 1.0);
      }
    } catch (e) {
      // Google 3D Tiles read-only — ignore silently
    }
  };

  // ===============================
  // APPLY TO ALL TILESETS
  // ===============================

  BimViewer.applyIBLToAll = function() {
    // loadedAssets (Map)
    if (this.loadedAssets) {
      this.loadedAssets.forEach(function(asset) {
        if (asset.tileset) {
          BimViewer.applyIBLToTileset(asset.tileset);
        }
      });
    }

    // Scene primitives (OSM Buildings, Google 3D Tiles, etc.)
    if (this.viewer && this.viewer.scene) {
      var primitives = this.viewer.scene.primitives;
      for (var i = 0; i < primitives.length; i++) {
        var prim = primitives.get(i);
        if (prim instanceof Cesium.Cesium3DTileset) {
          this.applyIBLToTileset(prim);
        }
      }
    }
  };

  // ===============================
  // SETTERS (with persist + apply)
  // ===============================

  BimViewer.saveIBLState = function() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.ibl));
    } catch (e) {
      // Storage full or unavailable
    }
  };

  BimViewer.setIBLEnabled = function(enabled) {
    this.ibl.enabled = enabled;
    this.saveIBLState();
    this.applyIBLToAll();
  };

  BimViewer.setIBLDiffuse = function(val) {
    this.ibl.diffuse = val;
    this.saveIBLState();
    this.applyIBLToAll();
  };

  BimViewer.setIBLSpecular = function(val) {
    this.ibl.specular = val;
    this.saveIBLState();
    this.applyIBLToAll();
  };

  console.log('✅ IBL module loaded v1.4 (Spherical Harmonics)');

})(window.BimViewer = window.BimViewer || {});
