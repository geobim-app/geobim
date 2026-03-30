// ============================================================
// Post-Processing Effects Module for geobim.app
//
// Copyright (c) 2026 geobim.app
// Licensed under the Business Source License 1.1 (BSL 1.1)
// Change Date: 2030-03-01 | Change License: MIT
// See LICENSE file for full terms.
//
// Provides: Bloom, Lens Flare, Vignette + Color Grading
// All effects toggleable, integrated into performance presets.
// ============================================================

(function() {
  'use strict';

  // ========================================================
  // STATE
  // ========================================================

  var bloomStage = null;
  var lensFlareStage = null;
  var colorGradingStage = null;
  var initialized = false;

  // ========================================================
  // HELPERS
  // ========================================================

  function getViewer() {
    return window.BimViewer && BimViewer.viewer;
  }

  // ========================================================
  // BLOOM (Cesium built-in)
  // ========================================================

  function initBloom(viewer) {
    try {
      bloomStage = viewer.scene.postProcessStages.bloom;
      if (bloomStage) {
        bloomStage.enabled = false;
        bloomStage.uniforms.contrast = 128;
        bloomStage.uniforms.brightness = -0.3;
        bloomStage.uniforms.glowOnly = false;
        bloomStage.uniforms.delta = 1.0;
        bloomStage.uniforms.sigma = 3.78;
        bloomStage.uniforms.stepSize = 5.0;
      }
    } catch (e) {
      console.warn('PostFX: Bloom not available:', e.message);
      bloomStage = null;
    }
  }

  function setBloom(enabled, options) {
    if (!bloomStage) return;
    try {
      bloomStage.enabled = !!enabled;
      if (options) {
        if (options.contrast !== undefined)   bloomStage.uniforms.contrast = options.contrast;
        if (options.brightness !== undefined) bloomStage.uniforms.brightness = options.brightness;
        if (options.glowOnly !== undefined)   bloomStage.uniforms.glowOnly = options.glowOnly;
        if (options.delta !== undefined)      bloomStage.uniforms.delta = options.delta;
        if (options.sigma !== undefined)      bloomStage.uniforms.sigma = options.sigma;
        if (options.stepSize !== undefined)   bloomStage.uniforms.stepSize = options.stepSize;
      }
    } catch (e) {
      console.warn('PostFX: Bloom set failed:', e.message);
    }
  }

  // ========================================================
  // LENS FLARE (Cesium built-in via PostProcessStageLibrary)
  // ========================================================

  function initLensFlare(viewer) {
    try {
      lensFlareStage = Cesium.PostProcessStageLibrary.createLensFlareStage();
      lensFlareStage.enabled = false;
      lensFlareStage.uniforms.intensity = 2.0;
      lensFlareStage.uniforms.distortion = 5.0;
      lensFlareStage.uniforms.ghostDispersal = 0.4;
      lensFlareStage.uniforms.haloWidth = 0.4;
      viewer.scene.postProcessStages.add(lensFlareStage);
    } catch (e) {
      console.warn('PostFX: Lens Flare not available:', e.message);
      lensFlareStage = null;
    }
  }

  function setLensFlare(enabled, options) {
    if (!lensFlareStage) return;
    try {
      lensFlareStage.enabled = !!enabled;
      if (options) {
        if (options.intensity !== undefined)      lensFlareStage.uniforms.intensity = options.intensity;
        if (options.distortion !== undefined)     lensFlareStage.uniforms.distortion = options.distortion;
        if (options.ghostDispersal !== undefined) lensFlareStage.uniforms.ghostDispersal = options.ghostDispersal;
        if (options.haloWidth !== undefined)      lensFlareStage.uniforms.haloWidth = options.haloWidth;
      }
    } catch (e) {
      console.warn('PostFX: Lens Flare set failed:', e.message);
    }
  }

  // ========================================================
  // VIGNETTE + COLOR GRADING (custom GLSL post-process)
  // ========================================================

  var COLOR_GRADING_SHADER = [
    'uniform sampler2D colorTexture;',
    'in vec2 v_textureCoordinates;',
    '',
    '// Vignette',
    'uniform float u_vignetteStrength;  // 0.0 = off, 1.0 = strong',
    'uniform float u_vignetteRadius;    // inner radius (0.0-1.0)',
    'uniform float u_vignetteSoftness;  // falloff softness',
    '',
    '// Color Grading',
    'uniform float u_contrast;     // 1.0 = neutral',
    'uniform float u_saturation;   // 1.0 = neutral',
    'uniform float u_warmth;       // 0.0 = neutral, >0 = warm, <0 = cool',
    'uniform float u_brightness;   // 0.0 = neutral',
    '',
    'void main() {',
    '  vec4 color = texture(colorTexture, v_textureCoordinates);',
    '  vec3 c = color.rgb;',
    '',
    '  // --- Color Grading ---',
    '  // Brightness',
    '  c += u_brightness;',
    '',
    '  // Contrast (around midpoint 0.5)',
    '  c = (c - 0.5) * u_contrast + 0.5;',
    '',
    '  // Saturation (luminance-preserving)',
    '  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));',
    '  c = mix(vec3(lum), c, u_saturation);',
    '',
    '  // Warmth (temperature shift: warm = +R -B, cool = -R +B)',
    '  c.r += u_warmth * 0.1;',
    '  c.b -= u_warmth * 0.1;',
    '',
    '  // --- Vignette ---',
    '  float dist = distance(v_textureCoordinates, vec2(0.5));',
    '  float vignette = smoothstep(u_vignetteRadius, u_vignetteRadius - u_vignetteSoftness, dist);',
    '  c *= mix(1.0 - u_vignetteStrength, 1.0, vignette);',
    '',
    '  out_FragColor = vec4(clamp(c, 0.0, 1.0), color.a);',
    '}'
  ].join('\n');

  function initColorGrading(viewer) {
    try {
      colorGradingStage = new Cesium.PostProcessStage({
        name: 'geobim_colorGrading',
        fragmentShader: COLOR_GRADING_SHADER,
        uniforms: {
          u_vignetteStrength: 0.0,
          u_vignetteRadius: 0.8,
          u_vignetteSoftness: 0.4,
          u_contrast: 1.0,
          u_saturation: 1.0,
          u_warmth: 0.0,
          u_brightness: 0.0
        }
      });
      colorGradingStage.enabled = false;
      viewer.scene.postProcessStages.add(colorGradingStage);
    } catch (e) {
      console.warn('PostFX: Color Grading not available:', e.message);
      colorGradingStage = null;
    }
  }

  function setColorGrading(options) {
    if (!colorGradingStage) return;
    if (!options) {
      colorGradingStage.enabled = false;
      return;
    }

    // Enable if any value is non-default
    var hasVignette = options.vignetteStrength !== undefined && options.vignetteStrength > 0;
    var hasGrading = (options.contrast !== undefined && options.contrast !== 1.0) ||
                     (options.saturation !== undefined && options.saturation !== 1.0) ||
                     (options.warmth !== undefined && options.warmth !== 0) ||
                     (options.brightness !== undefined && options.brightness !== 0);

    colorGradingStage.enabled = hasVignette || hasGrading || !!options.enabled;

    var u = colorGradingStage.uniforms;
    if (options.vignetteStrength !== undefined) u.u_vignetteStrength = options.vignetteStrength;
    if (options.vignetteRadius !== undefined)   u.u_vignetteRadius = options.vignetteRadius;
    if (options.vignetteSoftness !== undefined) u.u_vignetteSoftness = options.vignetteSoftness;
    if (options.contrast !== undefined)         u.u_contrast = options.contrast;
    if (options.saturation !== undefined)       u.u_saturation = options.saturation;
    if (options.warmth !== undefined)           u.u_warmth = options.warmth;
    if (options.brightness !== undefined)       u.u_brightness = options.brightness;
  }

  // ========================================================
  // CINEMATIC PRESET — activate/deactivate all effects
  // ========================================================

  function activateCinematic() {
    setBloom(true, {
      contrast: 128,
      brightness: -0.3,
      delta: 1.0,
      sigma: 3.78,
      stepSize: 5.0
    });
    setLensFlare(true, {
      intensity: 2.0,
      distortion: 5.0,
      ghostDispersal: 0.4,
      haloWidth: 0.4
    });
    setColorGrading({
      enabled: true,
      vignetteStrength: 0.35,
      vignetteRadius: 0.8,
      vignetteSoftness: 0.4,
      contrast: 1.05,
      saturation: 1.1,
      warmth: 0.15,
      brightness: 0.0
    });
  }

  function deactivateCinematic() {
    setBloom(false);
    setLensFlare(false);
    setColorGrading(null);
  }

  // ========================================================
  // INIT
  // ========================================================

  function init() {
    var viewer = getViewer();
    if (!viewer) { setTimeout(init, 500); return; }
    if (initialized) return;
    initialized = true;

    initBloom(viewer);
    initLensFlare(viewer);
    initColorGrading(viewer);

    console.log('✅ PostFX module ready (Bloom, Lens Flare, Color Grading)');
  }

  if (document.readyState === 'complete') init();
  else window.addEventListener('load', function() { setTimeout(init, 1000); });

  // ========================================================
  // PUBLIC API
  // ========================================================

  window.GEOBIM_POSTFX = {
    setBloom: setBloom,
    setLensFlare: setLensFlare,
    setColorGrading: setColorGrading,
    activateCinematic: activateCinematic,
    deactivateCinematic: deactivateCinematic,
    isBloomEnabled: function() { return bloomStage ? bloomStage.enabled : false; },
    isLensFlareEnabled: function() { return lensFlareStage ? lensFlareStage.enabled : false; },
    isColorGradingEnabled: function() { return colorGradingStage ? colorGradingStage.enabled : false; }
  };

})();
