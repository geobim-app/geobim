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
// CESIUM BIM VIEWER - POINT CLOUD MODULE v1.0
// Advanced Point Cloud Rendering Controls
// Eye Dome Lighting, Point Size (Attenuated or Fixed), Color Modes
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
    // 'attenuated': size shrinks with distance (Geometric Error Scale + Maximum
    // Attenuation control the falloff) — pointSize itself has no effect here, see
    // applyColorMode(). 'fixed': constant on-screen pixel size regardless of
    // distance, driven directly by pointSize via Cesium3DTileStyle.pointSize.
    // Mutually exclusive at the Cesium shader level (HAS_POINT_CLOUD_POINT_SIZE_STYLE
    // vs HAS_POINT_CLOUD_ATTENUATION, see PointCloudStylingStageVS in cesium_sdk) —
    // there's no blended in-between state to represent.
    sizeMode: 'attenuated',
    maximumAttenuation: undefined, // Scale between 1 and 10
    
    // Color & Shading
    shadingEnabled: true,
    colorMode: 'rgb', // 'rgb', 'height', 'intensity', 'classification'

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

  // Apply settings to all loaded point clouds — both 3D Tiles tilesets and
  // native GLB point clouds (mesh primitive mode POINTS, see core.js loadGLBAsset)
  BimViewer.applyPointCloudSettingsToAllTilesets = function() {
    if (!this.loadedAssets) return;

    let pointCloudCount = 0;

    this.loadedAssets.forEach((assetData, assetId) => {
      const tileset = assetData.tileset;
      if (tileset && this.isPointCloudTileset(tileset)) {
        this.applyPointCloudSettings(tileset);
        pointCloudCount++;
      } else if (assetData.isGLB && assetData.isPointCloud && assetData.model) {
        this.applyPointCloudSettingsToModel(assetData.model);
        pointCloudCount++;
      }
    });

    if (pointCloudCount > 0) {
      console.log(`☁️ Applied point cloud settings to ${pointCloudCount} point cloud asset(s)`);
    }

    return pointCloudCount;
  };

  // Check if a tileset is a point cloud
  BimViewer.isPointCloudTileset = function(tileset) {
    if (!tileset) return false;

    // Check if already marked as point cloud in asset data
    if (this.loadedAssets) {
      for (const [assetId, assetData] of this.loadedAssets) {
        if (assetData.tileset === tileset && assetData.isPointCloud) {
          return true;
        }
      }
    }

    // Check tileset extras or asset metadata
    try {
      if (tileset.asset && tileset.asset.extras) {
        const extras = tileset.asset.extras;
        if (extras.ion && extras.ion.assetType === 'POINTCLOUD') {
          return true;
        }
      }
    } catch (e) {
      // Ignore errors
    }

    // Check root tile content for .pnts URI (point cloud format)
    const checkTileForPointCloud = (tile) => {
      if (!tile) return false;
      if (tile.content) {
        const contentUri = tile.content.url || tile.content.uri || '';
        if (contentUri.includes('.pnts') || contentUri.includes('pointcloud')) {
          return true;
        }
        // If tile has features with IFC-like properties, it's NOT a point cloud
        if (tile.content.featuresLength > 0) {
          try {
            const feature = tile.content.getFeature(0);
            const props = feature.getPropertyIds();
            const ifcIndicators = ['className', 'IfcEntity', 'IfcType', 'IFC_Type', 'element_type', 'categoryName'];
            if (ifcIndicators.some(p => props.includes(p))) {
              return false;
            }
          } catch (e) {
            // Ignore
          }
        }
      }
      if (tile.children) {
        for (const child of tile.children) {
          const result = checkTileForPointCloud(child);
          if (result === true || result === false) return result;
        }
      }
      return null; // indeterminate
    };

    if (tileset.root) {
      const result = checkTileForPointCloud(tileset.root);
      if (result === true) return true;
      if (result === false) return false;
    }

    // NOTE: tileset.pointCloudShading exists on ALL tilesets in CesiumJS 1.134
    // so we do NOT use it as an indicator

    return false;
  };

  // Mark a tileset as point cloud in asset data
  BimViewer.markAsPointCloud = function(assetId) {
    const assetData = this.loadedAssets?.get(assetId.toString());
    if (assetData) {
      assetData.isPointCloud = true;
      console.log(`☁️ Asset ${assetId} marked as point cloud`);

      // Apply point cloud settings immediately
      if (assetData.tileset && typeof this.applyPointCloudSettings === 'function') {
        this.applyPointCloudSettings(assetData.tileset);
      }
    }
  };

  // Apply point cloud settings to a specific tileset
  BimViewer.applyPointCloudSettings = function(tileset) {
    if (!tileset) {
      console.warn('⚠️ No tileset provided');
      return;
    }
    
    try {
      const settings = this.pointCloudSettings;

      // NOTE: tileset.style (color + point size) is set exclusively at the bottom
      // via applyColorMode() — it used to also be pre-emptively cleared to undefined
      // right here whenever useOriginalColors was true, which raced with (and could
      // wipe out) whatever applyColorMode set a few lines later. One writer only.

      // Initialize point cloud shading if it doesn't exist
      if (!tileset.pointCloudShading) {
        tileset.pointCloudShading = new Cesium.PointCloudShading({});
      }

      // Eye Dome Lighting (EDL)
      if (tileset.pointCloudShading) {
        tileset.pointCloudShading.eyeDomeLighting = settings.edlEnabled;
        tileset.pointCloudShading.eyeDomeLightingStrength = settings.edlStrength;
        tileset.pointCloudShading.eyeDomeLightingRadius = settings.edlRadius;

        // baseResolution deliberately NOT set from settings.pointSize here: Cesium's
        // getGeometricError2() (PointCloudStylingPipelineStage, verified in cesium_sdk)
        // always prefers content.tile.geometricError when it's > 0, which every real
        // 3D Tiles tile has — baseResolution only ever gets read as a fallback for
        // tilesets that supply no geometricError at all. So it had no visible effect on
        // any tileset in this app and just added a second, contradicting notion of
        // "point size" alongside the Cesium3DTileStyle.pointSize path below. Fixed-size
        // mode (settings.sizeMode === 'fixed') is the actual, working way to control
        // point size directly — see applyColorMode() below.

        // Attenuation — only meaningful in 'attenuated' mode. In 'fixed' mode this is
        // set to false for internal consistency, but it wouldn't matter either way:
        // Cesium3DTileStyle.pointSize (applied below) compiles to
        // HAS_POINT_CLOUD_POINT_SIZE_STYLE, which the shader's #ifdef/#elif chain
        // checks before HAS_POINT_CLOUD_ATTENUATION — a style pointSize always wins.
        tileset.pointCloudShading.attenuation = settings.sizeMode === 'attenuated';
        // Always assign, even when undefined ("None" on the slider, or Reset/a preset
        // that clears it) — pointCloudShading is mutated in place here (same object
        // reused across calls, not replaced), so a guarded `if (!== undefined)` leaves
        // a previously set cap permanently stuck on the tileset: the UI shows "None"
        // but the old numeric maximumAttenuation keeps being applied every frame.
        // Explicit undefined restores Cesium's own tileset.memoryAdjustedScreenSpaceError
        // (~16px) fallback, same as never having set it.
        tileset.pointCloudShading.maximumAttenuation = settings.maximumAttenuation;

        // Geometric Error Scale
        tileset.pointCloudShading.geometricErrorScale = settings.geometricErrorScale;

        // Back Face Culling — must be set on pointCloudShading, not the tileset itself.
        // tileset.backFaceCulling is an unrelated general mesh/triangle-culling flag
        // (propagated to each tile's internal Model, gated by glTF `doubleSided`) with
        // no effect on point rendering; the point-specific HAS_POINT_CLOUD_BACK_FACE_CULLING
        // shader path reads pointCloudShading.backFaceCulling instead — verified against
        // decompiled Cesium 1.141 (cesium_sdk/cesium/Build/Cesium/Cesium.js). The toggle
        // was silently a no-op for every real (Ion/self-hosted) point cloud tileset.
        tileset.pointCloudShading.backFaceCulling = settings.backFaceCulling;
      }

      // Apply color mode (and, in fixed-size mode, point size — both folded into one
      // Cesium3DTileStyle inside applyColorMode, see its comments below)
      this.applyColorMode(tileset, settings.colorMode);

      console.log('☁️ Point cloud settings applied to tileset (RGB colors preserved)');

    } catch (error) {
      console.error('❌ Error applying point cloud settings:', error);
    }
  };

  // Apply point cloud settings to a GLB point cloud (Cesium.Model, not a 3D Tiles
  // tileset — see core.js loadGLBAsset). Two things never carry over regardless of how
  // this is called: (1) Eye Dome Lighting — Cesium only implements that post-process
  // (`_pointCloudEyeDomeLighting`) on Cesium3DTileset/TimeDynamicPointCloud, Model has no
  // equivalent in 1.141; (2) `Cesium3DTileStyle` color modes (height/intensity/
  // classification) — those read 3D Tiles batch-table properties that a plain glTF point
  // cloud (POSITION + COLOR_0 only) doesn't have, so GLB point clouds always render their
  // original per-vertex RGB.
  BimViewer.applyPointCloudSettingsToModel = function(model) {
    if (!model) {
      console.warn('⚠️ No GLB model provided');
      return;
    }

    try {
      const settings = this.pointCloudSettings;

      // IMPORTANT: always assign a *new* PointCloudShading instance, never mutate the
      // fields of the existing one in place. Model.pointCloudShading is defined with a
      // setter — `set(e) { e !== this._pointCloudShading && this.resetDrawCommands(); … }`
      // — that only rebuilds the render pipeline (and with it the HAS_POINT_CLOUD_ATTENUATION
      // / HAS_POINT_CLOUD_BACK_FACE_CULLING shader defines) when the object *reference*
      // changes. Unlike Cesium3DTileset — which diffs attenuation/backFaceCulling against
      // the previous frame internally and resets on its own — Model has no such per-frame
      // check, so `model.pointCloudShading.baseResolution = x` (mutating the existing
      // object) is silently invisible to it after the very first assignment. Every setting
      // below (Point Size, Attenuation, Max Attenuation, Geometric Error Scale, Back Face
      // Culling) previously stopped working after that first call for exactly this reason.
      // Fixed-size mode (settings.sizeMode === 'fixed') has no exact equivalent here —
      // Model has no Cesium3DTileStyle/.style API, only pointCloudShading, so there's no
      // HAS_POINT_CLOUD_POINT_SIZE_STYLE path to hook into for a plain Model (unlike the
      // tileset path in applyColorMode above, which has full, exact fixed-size support).
      // Approximated instead by *keeping* attenuation on but deliberately overdriving its
      // geometricError term (via an absurdly large baseResolution) so the attenuation
      // formula's min(geometricError/depth * depthMultiplier, maximumAttenuation) — see
      // getPointSizeFromAttenuation in cesium_sdk — saturates at the maximumAttenuation
      // cap across effectively every practical viewing distance, i.e. the size stays
      // visually constant even though attenuation is technically still active. Turning
      // attenuation off outright is not an option: with neither style define present,
      // Cesium falls back to a hardcoded gl_PointSize = 1.0 (verified in
      // PointCloudStylingStageVS) — the smallest possible point, not a fixed one.
      // In practice this rarely matters: every GLB point cloud upload goes through
      // core.js's _loadGLBPointCloudAsTileset() instead, which wraps it as a real
      // Cesium3DTileset (full fixed-size support via applyColorMode above) — this
      // function only runs as a fallback if that wrapping itself throws.
      const isFixed = settings.sizeMode === 'fixed';
      model.pointCloudShading = new Cesium.PointCloudShading({
        attenuation: true,
        geometricErrorScale: settings.geometricErrorScale,
        // Cesium's own "undefined -> use tileset.memoryAdjustedScreenSpaceError (~16px)"
        // fallback only exists for Cesium3DTileset. A standalone Model has no tileset behind
        // it, so its internal fallback there is a hardcoded 1px instead — the vertex shader
        // computes `min(attenuatedSize, maximumAttenuation)`, so every point would be capped
        // at ~1px no matter what Point Size / Geometric Error Scale are set to. Mirror the
        // tileset default explicitly so those controls have a visible effect. In fixed mode,
        // pointSize itself becomes the cap — that's the whole approximation above.
        maximumAttenuation: isFixed
          ? settings.pointSize
          : (settings.maximumAttenuation !== undefined ? settings.maximumAttenuation : 16),
        baseResolution: isFixed ? 1.0e6 : settings.pointSize,
        backFaceCulling: settings.backFaceCulling,
        // No-op on Model (see file-level comment above) — set anyway so pointCloudShading
        // stays consistent with tileset state, and for if/when Cesium adds Model support.
        eyeDomeLighting: settings.edlEnabled,
        eyeDomeLightingStrength: settings.edlStrength,
        eyeDomeLightingRadius: settings.edlRadius
      });

      console.log('☁️ Point cloud settings applied to GLB model (RGB colors preserved)');

    } catch (error) {
      console.error('❌ Error applying point cloud settings to GLB model:', error);
    }
  };

  // Apply color mode to tileset. Also folds in the current point-size mode: a
  // tileset only has one .style at a time, and Cesium3DTileStyle.pointSize is how
  // fixed-size mode is implemented (see settings.sizeMode above and
  // applyPointCloudSettings) — so color and fixed size can't be two independent
  // "set and overwrite tileset.style" calls without one silently erasing the other.
  // This used to be exactly that: applyPointCloudSettings() pre-emptively set
  // tileset.style = undefined for RGB mode, then this function unconditionally
  // reassigned tileset.style again a few lines later — same bug shape, different field.
  BimViewer.applyColorMode = function(tileset, mode) {
    if (!tileset) return;

    try {
      const settings = this.pointCloudSettings;
      const styleJson = {};

      switch(mode) {
        case 'rgb':
          // Original RGB colors — simply omit the "color" key below rather than
          // assigning tileset.style = undefined outright, which would also discard
          // a fixed-size pointSize set in the same style object.
          console.log('☁️ Color Mode: Original RGB');
          break;

        case 'height':
          // Color by height. "${Height}" is neither a Cesium built-in point-cloud
          // semantic nor a batch-table property that ever exists on any tileset here
          // (self-hosted or Ion) — the only built-ins are POSITION, POSITION_ABSOLUTE,
          // COLOR, NORMAL (verified against cesium_sdk/cesium/Build/Cesium/Cesium.js).
          // So every condition below used to be unmatched for every point, meaning
          // every point fell through to the "true" catch-all and rendered solid blue
          // — "height mode" was a no-op recolor, not broken-looking by accident.
          // ${POSITION} is the point's model-space (tile-content-local, Z-up same as
          // the source LAS/LAZ/PLY) coordinate, so .z is an actual usable height value.
          // Caveat: py3dtiles recenters each octree node independently, so for a
          // deeply-subdivided cloud (many LOD tiles) this is a per-tile-local height,
          // not one global gradient — expect visible banding at tile boundaries on
          // large scans. Still far better than the previous always-blue result, and
          // matches what Cesium's own point-cloud-styling Sandcastle example does.
          styleJson.color = {
            conditions: [
              ["${POSITION}.z >= 100", "color('#ff0000')"],
              ["${POSITION}.z >= 50", "color('#ffff00')"],
              ["${POSITION}.z >= 25", "color('#00ff00')"],
              ["${POSITION}.z >= 10", "color('#00ffff')"],
              ["true", "color('#0000ff')"]
            ]
          };
          console.log('☁️ Color Mode: Height-based');
          break;

        case 'intensity':
          // Color by intensity. Two bugs fixed here together — neither could work
          // alone: (1) the batch-table property is only present at all when
          // convert_pointcloud.py asks py3dtiles for it via --extra-fields, using
          // the exact lowercase laspy dimension name "intensity" (batch table keys
          // are written verbatim from that name — see py3dtiles' add_property_as_binary
          // — so the old "${Intensity}" capital-I reference would never have matched
          // even once that field existed). (2) LAS intensity is a raw 0-65535 (16-bit)
          // value per the ASPRS spec; multiplying color() by it directly (old code)
          // saturates every point with any nontrivial intensity straight to white —
          // normalize into 0..1 first.
          styleJson.color = "color() * (${intensity} / 65535.0)";
          console.log('☁️ Color Mode: Intensity-based');
          break;

        case 'classification':
          // Color by ASPRS classification. Same casing bug as intensity — batch
          // table key is the lowercase "classification" convert_pointcloud.py now
          // requests, not "${Classification}". Note: only LAS 1.4 point formats 6-10
          // expose "classification" as its own field; point formats 0-5 (still common,
          // and what this app's own E57→LAS conversion in convert_pointcloud.py
          // produces) pack it into a bit-field ("bit_fields") instead, so those files
          // simply won't have this property — py3dtiles omits it gracefully (a logged
          // warning in convert.log, not a conversion failure) and this mode falls
          // through to the "true" catch-all, same as before, rather than breaking.
          styleJson.color = {
            conditions: [
              ["${classification} === 0", "color('#808080')"], // Never classified
              ["${classification} === 1", "color('#808080')"], // Unclassified
              ["${classification} === 2", "color('#8B4513')"], // Ground
              ["${classification} === 3", "color('#00FF00')"], // Low Vegetation
              ["${classification} === 4", "color('#228B22')"], // Medium Vegetation
              ["${classification} === 5", "color('#006400')"], // High Vegetation
              ["${classification} === 6", "color('#FF0000')"], // Building
              ["${classification} === 9", "color('#0000FF')"], // Water
              ["true", "color('#FFFFFF')"]
            ]
          };
          console.log('☁️ Color Mode: Classification-based');
          break;

        default:
          // unknown mode — fall through to plain RGB, no color key
          break;
      }

      // Fixed-size mode: constant on-screen pixel size, independent of distance —
      // see the sizeMode comment on BimViewer.pointCloudSettings and the
      // pointCloudShading.attenuation note in applyPointCloudSettings for why this
      // and attenuation can't both apply at once (Cesium picks whichever style/
      // shading define is present; a style pointSize always wins).
      if (settings.sizeMode === 'fixed') {
        styleJson.pointSize = settings.pointSize;
      }

      // Only construct a style at all if there's something to override — an empty
      // Cesium3DTileStyle({}) is harmless but pointless; undefined is the documented
      // "use the tile's own defaults" value and slightly cheaper to evaluate per-frame.
      tileset.style = Object.keys(styleJson).length > 0
        ? new Cesium.Cesium3DTileStyle(styleJson)
        : undefined;
    } catch (error) {
      console.error('❌ Error applying color mode:', error);
      tileset.style = undefined; // Fallback to RGB, no fixed size either
    }
  };

  // Set color mode for all point clouds
  BimViewer.setColorMode = function(mode) {
    this.pointCloudSettings.colorMode = mode;

    // Apply to all point cloud tilesets
    if (this.loadedAssets) {
      this.loadedAssets.forEach((assetData, assetId) => {
        const tileset = assetData.tileset;
        if (tileset && this.isPointCloudTileset(tileset)) {
          this.applyColorMode(tileset, mode);
        }
      });
    }
    
    if (mode !== 'rgb') {
      console.log('☁️ Color mode (height/intensity/classification) needs 3D Tiles batch-table properties — GLB point clouds keep their per-vertex RGB');
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

    // Track point cloud usage with Plausible (only once per session)
    if (typeof plausible !== 'undefined' && !this._pointCloudTracked) {
      plausible('Feature Used', { props: { feature: 'Point Cloud' } });
      this._pointCloudTracked = true;
    }
  };

  // Coalesces rapid-fire slider "input" events (EDL Strength/Radius, Point Size,
  // Maximum Attenuation, Geometric Error Scale can each fire many times per
  // second while dragging) into at most one applyPointCloudSettingsToAllTilesets()
  // per animation frame. Matters most in Fixed-size mode: every call there
  // reconstructs a brand-new Cesium3DTileStyle and reassigns tileset.style, which
  // Cesium3DTileStyleEngine always treats as dirty on a changed object reference
  // — not a deep-equality check — forcing a full re-style of every currently
  // selected tile on the next render. Without this, a fast drag could queue many
  // redundant per-tile restyles for a single displayed frame. Discrete clicks
  // (toggles, presets, reset) stay synchronous — nothing to coalesce there.
  BimViewer._scheduleApplyPointCloudSettings = function() {
    if (this._pointCloudApplyRafPending) return;
    this._pointCloudApplyRafPending = true;
    requestAnimationFrame(() => {
      this._pointCloudApplyRafPending = false;
      this.applyPointCloudSettingsToAllTilesets();
    });
  };

  // Update EDL Strength
  BimViewer.setEDLStrength = function(strength) {
    this.pointCloudSettings.edlStrength = parseFloat(strength);
    this._scheduleApplyPointCloudSettings();
    console.log(`☁️ EDL Strength: ${strength}`);
  };

  // Update EDL Radius
  BimViewer.setEDLRadius = function(radius) {
    this.pointCloudSettings.edlRadius = parseFloat(radius);
    this._scheduleApplyPointCloudSettings();
    console.log(`☁️ EDL Radius: ${radius}`);
  };

  // Update Point Size
  BimViewer.setPointSize = function(size) {
    this.pointCloudSettings.pointSize = parseFloat(size);
    this._scheduleApplyPointCloudSettings();
    console.log(`☁️ Point Size: ${size}`);
  };

  // Switch between distance-attenuated and fixed on-screen point size — see the
  // sizeMode comment on pointCloudSettings above for why these are mutually
  // exclusive rather than two independent toggles.
  BimViewer.setSizeMode = function(mode) {
    this.pointCloudSettings.sizeMode = mode === 'fixed' ? 'fixed' : 'attenuated';
    this.applyPointCloudSettingsToAllTilesets();
    this.updatePointCloudUI();
    this.updateStatus(
      this.pointCloudSettings.sizeMode === 'fixed'
        ? 'Point size: fixed (constant on screen)'
        : 'Point size: attenuated (shrinks with distance)',
      'success'
    );
    console.log(`☁️ Point Size Mode: ${this.pointCloudSettings.sizeMode}`);
  };

  // Update Maximum Attenuation
  BimViewer.setMaximumAttenuation = function(value) {
    // Value between 1 (no attenuation) and 10 (strong attenuation)
    const attenuation = value === 1 ? undefined : parseFloat(value);
    this.pointCloudSettings.maximumAttenuation = attenuation;
    this._scheduleApplyPointCloudSettings();
    console.log(`☁️ Maximum Attenuation: ${value}`);
  };

  // Update Geometric Error Scale
  BimViewer.setGeometricErrorScale = function(scale) {
    this.pointCloudSettings.geometricErrorScale = parseFloat(scale);
    this._scheduleApplyPointCloudSettings();
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
      sizeMode: 'attenuated',
      maximumAttenuation: undefined,
      shadingEnabled: true,
      colorMode: 'rgb',
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
    
    // Size Mode buttons (Attenuated / Fixed)
    const sizeModeAttenuated = document.getElementById('sizeModeAttenuated');
    const sizeModeFixed = document.getElementById('sizeModeFixed');
    if (sizeModeAttenuated && sizeModeFixed) {
      sizeModeAttenuated.classList.toggle('active', settings.sizeMode !== 'fixed');
      sizeModeFixed.classList.toggle('active', settings.sizeMode === 'fixed');
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
        } else if (assetData.isGLB && assetData.isPointCloud && assetData.model) {
          pointCloudCount++;
          info.push({
            id: assetId,
            name: assetData.name,
            hasEDL: assetData.model.pointCloudShading?.eyeDomeLighting || false
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
        sizeMode: 'attenuated',
        // Was 3.0 — that's the hard cap in gl_PointSize = min(attenuatedSize, maximumAttenuation),
        // so points could never exceed 3px no matter the distance, geometricErrorScale, or Point
        // Size — near and far points ended up looking almost the same size, undermining the whole
        // point of attenuation as a depth cue (the Performance preset's cap of 5.0 was even looser).
        // undefined lets Cesium's own tileset.memoryAdjustedScreenSpaceError fallback (~16px) apply
        // instead, so nearby points can actually grow while distant ones still shrink normally.
        maximumAttenuation: undefined,
        geometricErrorScale: 1.0,
        backFaceCulling: false,
        colorMode: 'rgb'
      },
      
      // Performance - Faster rendering
      performance: {
        edlEnabled: false,
        edlStrength: 0.5,
        edlRadius: 1.0,
        pointSize: 1.5,
        sizeMode: 'attenuated',
        maximumAttenuation: 5.0,
        geometricErrorScale: 2.0,
        backFaceCulling: true,
        colorMode: 'rgb'
      },
      
      // Detailed - For close-up inspection
      detailed: {
        edlEnabled: true,
        edlStrength: 2.0,
        edlRadius: 1.5,
        pointSize: 4.0,
        // Fixed mode is what makes this preset's whole point ("big points for
        // close-up inspection") actually work — under the old attenuationEnabled:
        // false, gl_PointSize fell back to Cesium's hardcoded 1.0px with no styling
        // at all (see the shader notes in applyColorMode), so this preset silently
        // rendered the *smallest* possible points, the opposite of "Detailed".
        sizeMode: 'fixed',
        maximumAttenuation: undefined,
        geometricErrorScale: 0.5,
        backFaceCulling: false,
        colorMode: 'rgb'
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
