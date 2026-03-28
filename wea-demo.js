/**
 * geoBIM.app — WEA Demo Mode
 *
 * Copyright (c) 2026 geobim.app
 * Licensed under the Business Source License 1.1 (BSL 1.1)
 * Change Date: 2030-03-01 | Change License: MIT
 * See LICENSE file for full terms.
 *
 * Allows anonymous 30-minute access to ONLY the WEA Shadow module.
 * Activated via URL: /wea-shadow
 *
 * - Skips auth gate (no login required)
 * - Hides all toolbar sections (Assets, Layers, IFC Filter, etc.)
 * - Shows only Cesium viewer + WEA floating widget
 * - 30-minute countdown, then redirects to login
 * - Banner with timer + login link
 */
'use strict';

(function() {

  // ========================================================
  // DETECT WEA DEMO MODE
  // ========================================================

  var params = new URLSearchParams(window.location.search);
  var isWeaPath = window.location.pathname.replace(/\/+$/, '') === '/wea-shadow';
  if (params.get('mode') !== 'wea' && !isWeaPath) return;

  console.log('WEA Demo Mode activated — 30 min session');

  var SESSION_MINUTES = 30;
  var SESSION_KEY = 'geobim_wea_session_start';

  // Track session start in sessionStorage (survives page refresh within tab)
  var sessionStart = parseInt(sessionStorage.getItem(SESSION_KEY), 10);
  if (!sessionStart) {
    sessionStart = Date.now();
    sessionStorage.setItem(SESSION_KEY, sessionStart.toString());
  }

  // Global flag for other modules to check
  window._weaDemoMode = true;

  // ========================================================
  // SKIP AUTH GATE
  // ========================================================

  // Mark splash as dismissed so auth-gate doesn't wait for it
  // (splash-screen.js checks sessionStorage, but we also set the flag)
  window._splashDismissed = true;
  sessionStorage.setItem('geoBIM_splashShown', '1');

  // Mark auth gate as passed so init script proceeds
  window._authGatePassed = true;

  // ========================================================
  // HIDE TOOLBAR — SHOW ONLY WEA
  // ========================================================

  // Wait for toolbar and other UI to be built, then hide non-WEA elements
  var hideUI = setInterval(function() {
    var toolbar = document.getElementById('toolbar');
    var toggle = document.getElementById('sidebarToggle');
    var staPanel = document.getElementById('sta-panel');
    var staBtn = document.getElementById('staToggleBtn');
    var iotBtn = document.getElementById('iotToggleBtn');

    if (toolbar) toolbar.style.display = 'none';
    if (toggle) toggle.style.display = 'none';
    if (staPanel) staPanel.style.display = 'none';
    if (staBtn) staBtn.style.display = 'none';
    if (iotBtn) iotBtn.style.display = 'none';

    // Stop only once ALL elements have been found and hidden
    if (toolbar && staBtn && iotBtn) clearInterval(hideUI);
  }, 200);

  // Auto-open WEA panel once module is ready
  var openWea = setInterval(function() {
    if (window.BimWEA && window.BimViewer && BimViewer.viewer) {
      BimWEA.toggle();
      clearInterval(openWea);
      // Inject logo above panel header
      var header = document.getElementById('weaPanelHeader');
      if (header && !document.getElementById('weaPanelLogo')) {
        var logo = document.createElement('a');
        logo.id = 'weaPanelLogo';
        logo.href = '/';
        logo.title = 'geobim.app';
        logo.innerHTML = '<img src="logo/logo_mono_light.svg" alt="geobim.app">';
        header.parentNode.insertBefore(logo, header);
      }
      console.log('WEA Demo: panel auto-opened');
    }
  }, 500);

  // ========================================================
  // DEMO BANNER + COUNTDOWN
  // ========================================================

  function createBanner() {
    var banner = document.createElement('div');
    banner.id = 'weaDemoBanner';

    var style = document.createElement('style');
    style.textContent =
      '#weaDemoBanner{' +
        'position:fixed;top:0;left:0;right:0;z-index:99998;' +
        'display:flex;align-items:center;justify-content:center;gap:16px;' +
        'padding:8px 16px;' +
        'background:linear-gradient(135deg,#1a1d27 0%,#232733 100%);' +
        'border-bottom:1px solid rgba(79,143,247,0.3);' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
        'font-size:13px;color:rgba(255,255,255,0.8);' +
        'backdrop-filter:blur(8px);' +
      '}' +
      '#weaDemoBanner .wea-demo-label{' +
        'background:rgba(79,143,247,0.15);color:#4f8ff7;' +
        'padding:3px 10px;border-radius:12px;font-weight:600;font-size:11px;' +
        'text-transform:uppercase;letter-spacing:0.05em;' +
        'border:1px solid rgba(79,143,247,0.25);' +
      '}' +
      '#weaDemoBanner .wea-demo-timer{' +
        'font-family:"SF Mono","Fira Code",monospace;font-size:13px;' +
        'color:#2ECFB0;font-weight:600;min-width:52px;text-align:center;' +
      '}' +
      '#weaDemoBanner .wea-demo-timer.warning{color:#f59e0b;}' +
      '#weaDemoBanner .wea-demo-timer.critical{color:#f87171;animation:wea-blink 1s ease-in-out infinite;}' +
      '@keyframes wea-blink{0%,100%{opacity:1;}50%{opacity:0.5;}}' +
      '#weaDemoBanner .wea-demo-login{' +
        'color:#2ECFB0;text-decoration:none;font-size:12px;font-weight:500;' +
        'padding:4px 12px;border:1px solid rgba(46,207,176,0.3);border-radius:6px;' +
        'transition:all 0.2s;' +
      '}' +
      '#weaDemoBanner .wea-demo-login:hover{' +
        'background:rgba(46,207,176,0.1);border-color:rgba(46,207,176,0.5);' +
      '}' +
      '#weaDemoBanner .wea-demo-hint{' +
        'color:rgba(255,255,255,0.4);font-size:11px;' +
      '}' +
      '#weaDemoBanner .wea-demo-license{' +
        'color:rgba(255,255,255,0.3);font-size:10px;font-family:"SF Mono","Fira Code",monospace;' +
        'text-decoration:none;border-bottom:1px dotted rgba(255,255,255,0.2);' +
      '}' +
      '#weaDemoBanner .wea-demo-license:hover{color:rgba(255,255,255,0.6);border-color:rgba(255,255,255,0.4);}' +
      /* Push cesium container down so banner doesn't overlap */
      'body.wea-demo-active #cesiumContainer{top:37px !important;}' +
      /* Hide status toasts (e.g. "20 assets available") */
      'body.wea-demo-active .status-indicator{display:none !important;}' +
      /* Logo above WEA panel header */
      '#weaPanelLogo{' +
        'display:block;padding:10px 12px 6px;text-align:center;' +
        'border-bottom:1px solid rgba(255,255,255,0.06);' +
      '}' +
      '#weaPanelLogo img{width:100%;height:auto;opacity:0.5;transition:opacity 0.3s;}' +
      '#weaPanelLogo:hover img{opacity:0.8;}';

    document.head.appendChild(style);

    banner.innerHTML =
      '<span class="wea-demo-label">WEA Demo</span>' +
      '<span class="wea-demo-hint">Wind Energy Shadow Analysis</span>' +
      '<span class="wea-demo-timer" id="weaDemoTimer">30:00</span>' +
      '<a href="https://spdx.org/licenses/BSL-1.1.html" target="_blank" rel="noopener" class="wea-demo-license" title="Business Source License 1.1">BSL 1.1</a>' +
      '<a href="/" class="wea-demo-login">Sign in for full access →</a>';

    document.body.appendChild(banner);
    document.body.classList.add('wea-demo-active');

  }

  // ========================================================
  // TIMER LOGIC
  // ========================================================

  function startTimer() {
    var timerEl = document.getElementById('weaDemoTimer');
    if (!timerEl) return;

    var tick = setInterval(function() {
      var elapsed = Date.now() - sessionStart;
      var remaining = (SESSION_MINUTES * 60 * 1000) - elapsed;

      if (remaining <= 0) {
        clearInterval(tick);
        sessionStorage.removeItem(SESSION_KEY);
        showExpiredOverlay();
        return;
      }

      var mins = Math.floor(remaining / 60000);
      var secs = Math.floor((remaining % 60000) / 1000);
      timerEl.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;

      // Visual warnings
      if (remaining < 2 * 60 * 1000) {
        timerEl.className = 'wea-demo-timer critical';
      } else if (remaining < 5 * 60 * 1000) {
        timerEl.className = 'wea-demo-timer warning';
      }
    }, 1000);
  }

  // ========================================================
  // SESSION EXPIRED OVERLAY
  // ========================================================

  function showExpiredOverlay() {
    var overlay = document.createElement('div');
    overlay.id = 'weaDemoExpired';

    var style = document.createElement('style');
    style.textContent =
      '#weaDemoExpired{' +
        'position:fixed;inset:0;z-index:99999;' +
        'display:flex;align-items:center;justify-content:center;' +
        'background:rgba(10,22,40,0.92);backdrop-filter:blur(12px);' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
      '}' +
      '#weaDemoExpired .expired-card{' +
        'background:#132034;border-radius:16px;padding:48px 40px;' +
        'max-width:400px;width:90%;text-align:center;' +
        'box-shadow:0 16px 48px rgba(0,0,0,0.5);' +
        'border:1px solid rgba(79,143,247,0.15);' +
      '}' +
      '#weaDemoExpired .expired-icon{font-size:48px;margin-bottom:16px;}' +
      '#weaDemoExpired .expired-title{' +
        'color:#fff;font-size:20px;font-weight:700;margin-bottom:8px;' +
      '}' +
      '#weaDemoExpired .expired-text{' +
        'color:rgba(255,255,255,0.6);font-size:14px;line-height:1.6;margin-bottom:24px;' +
      '}' +
      '#weaDemoExpired .expired-btn{' +
        'display:inline-block;padding:12px 32px;border:none;border-radius:8px;' +
        'background:linear-gradient(135deg,#2ECFB0 0%,#3DB8A0 100%);' +
        'color:#0E1117;font-size:15px;font-weight:700;cursor:pointer;' +
        'text-decoration:none;transition:box-shadow 0.2s,transform 0.2s;' +
      '}' +
      '#weaDemoExpired .expired-btn:hover{' +
        'box-shadow:0 6px 16px rgba(46,207,176,0.35);transform:translateY(-1px);' +
      '}' +
      '#weaDemoExpired .expired-restart{' +
        'display:block;margin-top:16px;color:rgba(255,255,255,0.4);' +
        'font-size:12px;text-decoration:none;' +
      '}' +
      '#weaDemoExpired .expired-restart:hover{color:rgba(255,255,255,0.7);}';

    document.head.appendChild(style);

    overlay.innerHTML =
      '<div class="expired-card">' +
        '<div class="expired-icon">⏱️</div>' +
        '<div class="expired-title">Demo session expired</div>' +
        '<div class="expired-text">' +
          'Your 30-minute WEA demo session has ended.<br>' +
          'Sign in to access the full geobim.app platform.' +
        '</div>' +
        '<a href="/" class="expired-btn">Sign In</a>' +
        '<a href="/wea-shadow" class="expired-restart" ' +
          'onclick="sessionStorage.removeItem(\'' + SESSION_KEY + '\')">Start new demo session</a>' +
      '</div>';

    document.body.appendChild(overlay);
  }

  // ========================================================
  // BOOT
  // ========================================================

  // Check if session already expired on load
  var elapsed = Date.now() - sessionStart;
  if (elapsed >= SESSION_MINUTES * 60 * 1000) {
    window.addEventListener('DOMContentLoaded', function() {
      sessionStorage.removeItem(SESSION_KEY);
      showExpiredOverlay();
    });
    return; // Don't init anything else
  }

  window.addEventListener('DOMContentLoaded', function() {
    createBanner();
    startTimer();
  });

})();
