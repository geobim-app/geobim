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
// CESIUM BIM VIEWER - SPLASH SCREEN v2.0
// Shows once per session before auth gate
// ===============================
'use strict';

(function() {

  var STORAGE_KEY = 'geoBIM_splashShown';

  // Skip if already shown this session — auth gate will show directly
  if (sessionStorage.getItem(STORAGE_KEY) === '1') {
    console.log('Splash: skipped (already shown this session)');
    window._splashDismissed = true;
    return;
  }

  // Build splash DOM
  var splash = document.createElement('div');
  splash.id = 'splashScreen';
  splash.className = 'splash-screen';
  splash.innerHTML =
    '<div class="splash-content">' +
      '<div class="splash-hero">' +
        '<img src="logo/logo_teal_transparent.svg" alt="geobim.app" class="splash-logo-img">' +
        '<div class="splash-right">' +
          '<div class="splash-divider"></div>' +
          '<p class="splash-tagline">BIM x GIS = Geospatial Intelligence</p>' +
          '<p class="splash-description">Stream massive 3D BIM and geospatial data directly in the browser. Place your IFC &amp; Revit models in their real geographic context.</p>' +
          '<div class="splash-features">' +
            '<div class="splash-feature"><div class="splash-feature-icon">🏗️</div><span class="splash-feature-label">3D Tiles</span></div>' +
            '<div class="splash-feature"><div class="splash-feature-icon">📐</div><span class="splash-feature-label">Measure</span></div>' +
            '<div class="splash-feature"><div class="splash-feature-icon">✂️</div><span class="splash-feature-label">Clipping</span></div>' +
            '<div class="splash-feature"><div class="splash-feature-icon">💬</div><span class="splash-feature-label">Comments</span></div>' +
          '</div>' +
          '<p class="splash-copyright">&copy; 2026 Christof Lorenz</p>' +
          '<p class="splash-license">Personal &amp; non-commercial use only.</p>' +
          '<p class="splash-contact">Contact: info@geobim.app</p>' +
          '<button id="enterDemoBtn" class="splash-button">Enter Demo</button>' +
          '<div class="splash-cta-section">' +
            '<p class="splash-cta">Want to use your own IFC/Revit models? ' +
              '<a href="mailto:info@geobim.app" class="splash-cta-link" onclick="if(typeof plausible!==\'undefined\')plausible(\'Contact Click\')">Contact me</a></p>' +
            '<p class="splash-privacy">Privacy-friendly analytics (no cookies)</p>' +
          '</div>' +
          '<p class="splash-bsl">' +
            '&copy; 2026 Christof Lorenz &mdash; Licensed under BSL 1.1 &mdash; Non-commercial use, research &amp; education permitted.<br>' +
            'Commercial use requires written permission. <a href="mailto:info@geobim.app">info@geobim.app</a>' +
          '</p>' +
        '</div>' +
      '</div>' +
    '</div>';

  // Insert as first child of body
  document.body.insertBefore(splash, document.body.firstChild);

  // Set global flag
  window._splashDismissed = false;

  // Handle dismiss
  var btn = document.getElementById('enterDemoBtn');
  if (btn) {
    btn.addEventListener('click', function() {
      // Track with Plausible
      if (typeof plausible !== 'undefined') {
        plausible('Enter Demo');
      }

      // Fade out
      splash.classList.add('hidden');

      // Mark as shown for this session
      sessionStorage.setItem(STORAGE_KEY, '1');

      // Set global flag — auth gate will show next
      window._splashDismissed = true;

      // Remove from DOM after transition
      setTimeout(function() {
        if (splash.parentNode) {
          splash.parentNode.removeChild(splash);
        }
      }, 700);
    });
  }

  console.log('Splash screen loaded v2.0');

})();
