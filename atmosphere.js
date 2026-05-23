/**
 * geoBIM.app — Atmosphere & Sky Presets
 *
 * Copyright (c) 2026 geobim.app
 * Licensed under the Business Source License 1.1 (BSL 1.1)
 * Change Date: 2030-03-01 | Change License: MIT
 * See LICENSE file for full terms.
 *
 * Orchestrates scene.skyAtmosphere + scene.globe atmosphere + GEOBIM_POSTFX
 * into named presets tuned for the WEA public digital twin.
 *
 * Public API: window.BimAtmosphere
 *   .applyPreset(name)  — 'standard' | 'clearDay' | 'goldenHour' | 'overcast'
 *   .getActive()        — returns current preset name
 *   .PRESETS            — preset definitions
 */

'use strict';

window.BimAtmosphere = (function () {

  var _active = null;

  // ----------------------------------------------------------------
  // PRESETS
  // sky:          scene.skyAtmosphere parameters
  // globe:        scene.globe atmosphere parameters
  // bloom:        GEOBIM_POSTFX.setBloom() options — null = off
  // colorGrading: GEOBIM_POSTFX.setColorGrading() options — null = off
  // fog:          scene.fog settings
  // ----------------------------------------------------------------
  var PRESETS = {

    standard: {
      label: 'Standard',
      icon: 'rotate-ccw',
      sky: {
        hueShift: 0.0,
        saturationShift: 0.0,
        brightnessShift: 0.0,
        atmosphereLightIntensity: 10.0,
        atmosphereMieAnisotropy: 0.9
      },
      globe: {
        atmosphereLightIntensity: 10.0,
        atmosphereMieAnisotropy: 0.9
      },
      bloom: null,
      colorGrading: null,
      fog: { enabled: true, density: 0.0002 }
    },

    clearDay: {
      label: 'Klarer Tag',
      icon: 'sun',
      sky: {
        hueShift: 0.0,
        saturationShift: 0.12,
        brightnessShift: 0.05,
        atmosphereLightIntensity: 16.0,
        atmosphereMieAnisotropy: 0.95
      },
      globe: {
        atmosphereLightIntensity: 16.0,
        atmosphereMieAnisotropy: 0.95
      },
      bloom: { contrast: 128, brightness: -0.4, sigma: 2.5, stepSize: 3.5 },
      colorGrading: {
        saturation: 1.10, contrast: 1.03, warmth: 0.05,
        brightness: 0.02, vignetteStrength: 0.15, vignetteRadius: 0.78, vignetteSoftness: 0.38
      },
      fog: { enabled: true, density: 0.0001 }
    },

    goldenHour: {
      label: 'Goldene Stunde',
      icon: 'sun-dim',
      sky: {
        hueShift: -0.05,
        saturationShift: 0.22,
        brightnessShift: -0.05,
        atmosphereLightIntensity: 13.0,
        atmosphereMieAnisotropy: 0.98
      },
      globe: {
        atmosphereLightIntensity: 13.0,
        atmosphereMieAnisotropy: 0.98
      },
      bloom: { contrast: 128, brightness: -0.22, sigma: 3.5, stepSize: 5.0 },
      colorGrading: {
        saturation: 1.15, contrast: 1.05, warmth: 0.50,
        brightness: 0.0, vignetteStrength: 0.28, vignetteRadius: 0.75, vignetteSoftness: 0.40
      },
      fog: { enabled: true, density: 0.00025 }
    },

    overcast: {
      label: 'Bewölkt',
      icon: 'cloud',
      sky: {
        hueShift: 0.0,
        saturationShift: -0.30,
        brightnessShift: -0.15,
        atmosphereLightIntensity: 5.0,
        atmosphereMieAnisotropy: 0.70
      },
      globe: {
        atmosphereLightIntensity: 5.0,
        atmosphereMieAnisotropy: 0.70
      },
      bloom: null,
      colorGrading: {
        saturation: 0.70, contrast: 0.97, warmth: -0.15,
        brightness: -0.05, vignetteStrength: 0.0
      },
      fog: { enabled: true, density: 0.0005 }
    }
  };

  // ----------------------------------------------------------------
  // APPLY
  // ----------------------------------------------------------------
  function applyPreset(name) {
    var viewer = window.BimViewer && BimViewer.viewer;
    if (!viewer || !PRESETS[name]) return;

    var p     = PRESETS[name];
    var scene = viewer.scene;
    var sky   = scene.skyAtmosphere;
    var globe = scene.globe;

    // Sky atmosphere
    sky.hueShift                 = p.sky.hueShift;
    sky.saturationShift          = p.sky.saturationShift;
    sky.brightnessShift          = p.sky.brightnessShift;
    sky.atmosphereLightIntensity = p.sky.atmosphereLightIntensity;
    sky.atmosphereMieAnisotropy  = p.sky.atmosphereMieAnisotropy;

    // Globe atmosphere (ground-level scattering)
    globe.atmosphereLightIntensity = p.globe.atmosphereLightIntensity;
    globe.atmosphereMieAnisotropy  = p.globe.atmosphereMieAnisotropy;

    // Fog
    scene.fog.enabled = p.fog.enabled;
    scene.fog.density = p.fog.density;

    // PostFX (GEOBIM_POSTFX may not be loaded yet — fail silently)
    if (window.GEOBIM_POSTFX) {
      GEOBIM_POSTFX.setBloom(!!p.bloom, p.bloom || {});
      GEOBIM_POSTFX.setColorGrading(p.colorGrading ? Object.assign({ enabled: true }, p.colorGrading) : null);
    }

    _active = name;
    _updateButtons();
    console.log('BimAtmosphere: preset →', name);
  }

  function _updateButtons() {
    Object.keys(PRESETS).forEach(function (name) {
      var btn = document.getElementById('weaAtmPreset_' + name);
      if (!btn) return;
      btn.classList.toggle('modern-btn-primary', name === _active);
    });
  }

  // ----------------------------------------------------------------
  // AUTO-INIT: wait for viewer + postfx, then apply clearDay default
  // ----------------------------------------------------------------
  var _waitInterval = setInterval(function () {
    if (window.BimViewer && BimViewer.viewer && window.GEOBIM_POSTFX) {
      clearInterval(_waitInterval);
      applyPreset('clearDay');
      console.log('✅ BimAtmosphere ready — default: clearDay');
    }
  }, 500);

  // ----------------------------------------------------------------
  // PUBLIC API
  // ----------------------------------------------------------------
  return {
    applyPreset: applyPreset,
    getActive:   function () { return _active; },
    PRESETS:     PRESETS
  };

})();
