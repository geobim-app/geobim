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
// CESIUM BIM VIEWER - IBL MODULE v1.4
// Image-Based Lighting via Spherical Harmonics (diffuse IBL)
// Independent from dynamic lighting (lighting.js)
// ===============================
'use strict';

(function(BimViewer) {

  const STORAGE_KEY = 'geoBIM_settings_ibl';

  // === DYNAMIC MODE ===
  // Uses Cesium's environmentMapManager for real-time environment reflections.
  // Spherical harmonics provide diffuse IBL without async texture loading.

  const IBL_SPHERICAL_HARMONICS = [
    new Cesium.Cartesian3(0.356, 0.350, 0.317),
    new Cesium.Cartesian3(0.138, 0.182, 0.235),
    new Cesium.Cartesian3(0.089, 0.089, 0.097),
    new Cesium.Cartesian3(0.057, 0.060, 0.071),
    new Cesium.Cartesian3(0.051, 0.048, 0.046),
    new Cesium.Cartesian3(0.043, 0.044, 0.051),
    new Cesium.Cartesian3(-0.004, -0.005, -0.006),
    new Cesium.Cartesian3(0.027, 0.023, 0.014),
    new Cesium.Cartesian3(-0.013, -0.012, -0.010),
  ];

  // === STATIC KTX2 MODE ===
  // Uses a pre-baked KTX2 cubemap for consistent outdoor lighting.
  // Kiara 6 Afternoon — warm, natural outdoor environment.
  const STATIC_KTX2_URL = 'https://cesium.com/public/SandcastleSampleData/kiara_6_afternoon_2k_ibl.ktx2';
  const STATIC_SPHERICAL_HARMONICS = [
    new Cesium.Cartesian3(1.234, 1.130, 0.994),
    new Cesium.Cartesian3(0.130, 0.212, 0.288),
    new Cesium.Cartesian3(0.260, 0.274, 0.265),
    new Cesium.Cartesian3(0.081, 0.120, 0.156),
    new Cesium.Cartesian3(0.096, 0.085, 0.042),
    new Cesium.Cartesian3(0.054, 0.082, 0.109),
    new Cesium.Cartesian3(-0.008, -0.010, -0.013),
    new Cesium.Cartesian3(0.034, 0.029, 0.017),
    new Cesium.Cartesian3(0.050, 0.044, 0.016),
  ];

  // ===============================
  // STATE
  // ===============================

  BimViewer.ibl = {
    enabled: true,
    mode: 'dynamic',  // 'dynamic' | 'static'
    diffuse: 0.35,
    specular: 0.25
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
        if (parsed.mode === 'dynamic' || parsed.mode === 'static') this.ibl.mode = parsed.mode;
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

  // Fix environmentMapManager position from tileset bounding sphere
  function fixEnvMapPosition(tileset) {
    var emm = tileset.environmentMapManager;
    if (!emm) return;

    // Use tileset bounding sphere center if available and valid (not at Earth center)
    var center = tileset.boundingSphere && tileset.boundingSphere.center;
    var isValid = center &&
      (Math.abs(center.x) > 1 || Math.abs(center.y) > 1 || Math.abs(center.z) > 1);

    if (isValid) {
      emm.position = center;
      console.log('✅ EnvMap position set to: tileset boundingSphere center', center);
    } else {
      // Fallback: use camera position (viewer is where the user is looking)
      var viewer = BimViewer.viewer;
      if (viewer) {
        emm.position = viewer.camera.positionWC.clone();
        console.log('✅ EnvMap position set to: camera position (fallback)', emm.position);
      }
    }

    emm.enabled = true;
    if (BimViewer.viewer) BimViewer.viewer.scene.requestRender();
  }

  // Check if a tileset is a Google Photorealistic 3D Tiles instance
  function isGoogle3DTiles(tileset) {
    return BimViewer.googleTiles &&
      (tileset === BimViewer.googleTiles.tileset || tileset === BimViewer.googleTiles.leftTileset);
  }

  BimViewer.applyIBLToTileset = function(tileset) {
    if (!tileset) return;

    try {
      var ibl = tileset.imageBasedLighting;
      if (!ibl) return;

      // Google 3D Tiles don't support custom specularEnvironmentMaps — only adjust SH + factor
      var isGoogle = isGoogle3DTiles(tileset);

      if (!this.ibl.enabled) {
        // IBL off — let environmentMapManager handle specular, clear SH only
        if (tileset.environmentMapManager) tileset.environmentMapManager.enabled = true;
        ibl.sphericalHarmonicCoefficients = undefined;
        // NOTE: Do NOT set specularEnvironmentMaps = undefined — causes CesiumJS 1.134
        // crash (maximumMipmapLevel read on undefined texture). Leave it for envMapManager.
        ibl.imageBasedLightingFactor = new Cesium.Cartesian2(1.0, 1.0);
        return;
      }

      if (this.ibl.mode === 'static' && !isGoogle) {
        // Static KTX2 cubemap — only for user-loaded tilesets, not Google 3D Tiles
        if (tileset.environmentMapManager) tileset.environmentMapManager.enabled = false;
        ibl.specularEnvironmentMaps = STATIC_KTX2_URL;
        ibl.sphericalHarmonicCoefficients = STATIC_SPHERICAL_HARMONICS;
      } else {
        // Dynamic — use Cesium's real-time environment map + SH diffuse
        // Also used for Google 3D Tiles regardless of mode setting
        fixEnvMapPosition(tileset);
        // NOTE: Do NOT clear specularEnvironmentMaps — envMapManager provides its own.
        // Setting to undefined crashes CesiumJS 1.134 (maximumMipmapLevel on undefined).
        ibl.sphericalHarmonicCoefficients = IBL_SPHERICAL_HARMONICS;
      }

      ibl.imageBasedLightingFactor = new Cesium.Cartesian2(
        this.ibl.diffuse, this.ibl.specular
      );
    } catch (e) {
      // Read-only tileset — ignore silently
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

  BimViewer.setIBLMode = function(mode) {
    if (mode !== 'dynamic' && mode !== 'static') return;
    this.ibl.mode = mode;
    this.saveIBLState();
    this.applyIBLToAll();

    // Update UI toggle button
    var btn = document.getElementById('toggleIBLMode');
    if (btn) {
      var label = btn.querySelector('span:last-child');
      if (label) label.textContent = mode === 'dynamic' ? 'Dynamic' : 'Static KTX2';
      btn.classList.toggle('active', mode === 'static');
    }
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
