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
// CESIUM BIM VIEWER - SPLASH SCREEN v3.0
// Full-screen welcome with About / Features / Shortcuts tabs
// Shows once per session before auth gate
// ===============================
'use strict';

(function() {

  var STORAGE_KEY = 'geoBIM_splashShown';
  var APP_VERSION = '1.7.0';

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

      // ── Left: logo ──
      '<div class="splash-left">' +
        '<img src="logo/logo_teal_transparent.svg" alt="geobim.app" class="splash-logo-img">' +
      '</div>' +

      // ── Right: tabbed content ──
      '<div class="splash-right">' +
        '<div class="splash-divider"></div>' +

        // Tab bar
        '<div class="splash-tabs">' +
          '<button class="splash-tab active" data-tab="about">About</button>' +
          '<button class="splash-tab" data-tab="features">Features</button>' +
          '<button class="splash-tab" data-tab="shortcuts">Shortcuts</button>' +
        '</div>' +

        // ── About tab ──
        '<div class="splash-tab-content active" data-tab="about">' +
          '<div class="splash-about-header">' +
            '<div class="splash-app-name">geobim.app</div>' +
            '<div class="splash-version">Version ' + APP_VERSION + '</div>' +
          '</div>' +
          '<p class="splash-tagline">BIM x GIS = Geospatial Intelligence</p>' +
          '<p class="splash-description">Stream massive 3D BIM and geospatial data directly in the browser. Place your IFC &amp; Revit models in their real geographic context.</p>' +

          '<div class="splash-info-grid">' +
            '<div class="splash-info-item">' +
              '<span class="splash-info-label">License</span>' +
              '<span class="splash-info-value">BSL 1.1 (Non-commercial)</span>' +
            '</div>' +
            '<div class="splash-info-item">' +
              '<span class="splash-info-label">Change Date</span>' +
              '<span class="splash-info-value">2030-03-01 &rarr; MIT</span>' +
            '</div>' +
            '<div class="splash-info-item">' +
              '<span class="splash-info-label">Contact</span>' +
              '<span class="splash-info-value">info@geobim.app</span>' +
            '</div>' +
            '<div class="splash-info-item">' +
              '<span class="splash-info-label">Powered by</span>' +
              '<span class="splash-info-value">CesiumJS &middot; Firebase &middot; 3D Tiles</span>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // ── Features tab ──
        '<div class="splash-tab-content" data-tab="features">' +
          '<div class="splash-feature-list">' +
            '<div class="splash-feature-item"><span class="splash-feature-icon">&#x1F3D7;&#xFE0F;</span><div><strong>IFC &amp; Revit Models</strong><span>Load BIM models as 3D Tiles via Cesium Ion</span></div></div>' +
            '<div class="splash-feature-item"><span class="splash-feature-icon">&#x2601;&#xFE0F;</span><div><strong>Point Clouds</strong><span>LAS/LAZ point clouds with EDL and color modes</span></div></div>' +
            '<div class="splash-feature-item"><span class="splash-feature-icon">&#x1F50D;</span><div><strong>IFC / Revit Filter</strong><span>Filter 30+ entity types by category</span></div></div>' +
            '<div class="splash-feature-item"><span class="splash-feature-icon">&#x1F4CF;</span><div><strong>Measurement Tools</strong><span>Distance, area and height measurements</span></div></div>' +
            '<div class="splash-feature-item"><span class="splash-feature-icon">&#x2702;&#xFE0F;</span><div><strong>Clipping Planes</strong><span>Draw polygons to clip buildings and terrain</span></div></div>' +
            '<div class="splash-feature-item"><span class="splash-feature-icon">&#x1F4AC;</span><div><strong>3D Annotations</strong><span>Place comments with categories, priorities and inspection data</span></div></div>' +
            '<div class="splash-feature-item"><span class="splash-feature-icon">&#x1F5FA;&#xFE0F;</span><div><strong>Layer Manager</strong><span>Basemaps, terrain, imagery overlays, WMS/WMTS/WFS</span></div></div>' +
            '<div class="splash-feature-item"><span class="splash-feature-icon">&#x1F4E1;</span><div><strong>IoT / SensorThings</strong><span>Live sensor data via OGC SensorThings API + MQTT</span></div></div>' +
            '<div class="splash-feature-item"><span class="splash-feature-icon">&#x2600;&#xFE0F;</span><div><strong>Advanced Lighting</strong><span>Sun simulation, shadows, IBL, tone mapping</span></div></div>' +
            '<div class="splash-feature-item"><span class="splash-feature-icon">&#x1F4F7;</span><div><strong>Saved Views</strong><span>Save and restore camera positions</span></div></div>' +
            '<div class="splash-feature-item"><span class="splash-feature-icon">&#x1F6B6;</span><div><strong>Walk Mode</strong><span>First-person navigation with WASD, mouse or Xbox controller</span></div></div>' +
            '<div class="splash-feature-item"><span class="splash-feature-icon">&#x1F3AE;</span><div><strong>Third-Person Mode</strong><span>Animated character with Unreal Engine-style controls</span></div></div>' +
            '<div class="splash-feature-item"><span class="splash-feature-icon">&#x1F32C;&#xFE0F;</span><div><strong>WEA Shadow Analysis</strong><span>Wind turbine shadow flicker simulation</span></div></div>' +
            '<div class="splash-feature-item"><span class="splash-feature-icon">&#x2194;&#xFE0F;</span><div><strong>Split View</strong><span>Side-by-side comparison of two tilesets</span></div></div>' +
            '<div class="splash-feature-item"><span class="splash-feature-icon">&#x1F310;</span><div><strong>Geoid / Coordinate Tools</strong><span>EGM2008 geoid lookup, coordinate display</span></div></div>' +
            '<div class="splash-feature-item"><span class="splash-feature-icon">&#x1F511;</span><div><strong>Cesium Ion Connect</strong><span>Link your own Ion account to load private assets</span></div></div>' +
            '<div class="splash-feature-item"><span class="splash-feature-icon">&#x1F3AC;</span><div><strong>Post-Processing Effects</strong><span>Bloom, lens flare, vignette, color grading, Cinematic preset</span></div></div>' +
          '</div>' +
        '</div>' +

        // ── Shortcuts tab ──
        '<div class="splash-tab-content" data-tab="shortcuts">' +
          '<div class="splash-shortcut-list">' +
            '<div class="splash-shortcut-group">Navigation</div>' +
            '<div class="splash-shortcut"><kbd>Left-click + drag</kbd><span>Rotate</span></div>' +
            '<div class="splash-shortcut"><kbd>Right-click + drag</kbd><span>Zoom</span></div>' +
            '<div class="splash-shortcut"><kbd>Middle-click + drag</kbd><span>Pan</span></div>' +
            '<div class="splash-shortcut"><kbd>Scroll</kbd><span>Zoom in/out</span></div>' +

            '<div class="splash-shortcut-group">Walk Mode</div>' +
            '<div class="splash-shortcut"><kbd>G</kbd><span>Toggle first-person mode</span></div>' +
            '<div class="splash-shortcut"><kbd>V</kbd><span>Switch to third-person view</span></div>' +
            '<div class="splash-shortcut"><kbd>T</kbd><span>Set Player Start (spawn point)</span></div>' +
            '<div class="splash-shortcut"><kbd>WASD</kbd><span>Move (walk mode)</span></div>' +
            '<div class="splash-shortcut"><kbd>Shift</kbd><span>Sprint</span></div>' +

            '<div class="splash-shortcut-group">Tools</div>' +
            '<div class="splash-shortcut"><kbd>M</kbd><span>Toggle sidebar</span></div>' +
            '<div class="splash-shortcut"><kbd>H</kbd><span>Toggle hide mode (click to hide elements)</span></div>' +
            '<div class="splash-shortcut"><kbd>Shift + H</kbd><span>Restore all hidden elements</span></div>' +
            '<div class="splash-shortcut"><kbd>C</kbd><span>Toggle comment mode</span></div>' +
            '<div class="splash-shortcut"><kbd>ESC</kbd><span>Exit current mode / close dialog</span></div>' +

            '<div class="splash-shortcut-group">Selection</div>' +
            '<div class="splash-shortcut"><kbd>Left-click</kbd><span>Select element (show properties)</span></div>' +
            '<div class="splash-shortcut"><kbd>Right-click</kbd><span>Place comment (in comment mode)</span></div>' +
          '</div>' +
        '</div>' +

        // ── Footer: CTA + Enter button ──
        '<div class="splash-footer">' +
          '<button id="enterDemoBtn" class="splash-button">Enter Viewer</button>' +
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

      '</div>' + // splash-right
    '</div>'; // splash-content

  // Insert as first child of body
  document.body.insertBefore(splash, document.body.firstChild);

  // Set global flag
  window._splashDismissed = false;

  // ── Tab switching ──
  splash.querySelectorAll('.splash-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      var tabName = this.dataset.tab;
      splash.querySelectorAll('.splash-tab').forEach(function(t) { t.classList.remove('active'); });
      splash.querySelectorAll('.splash-tab-content').forEach(function(c) { c.classList.remove('active'); });
      this.classList.add('active');
      splash.querySelector('.splash-tab-content[data-tab="' + tabName + '"]').classList.add('active');
    });
  });

  // ── Handle dismiss ──
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

  console.log('Splash screen loaded v3.0 (tabbed welcome)');

})();
