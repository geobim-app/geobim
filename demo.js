/**
 * geoBIM.app — Full App Demo Mode
 *
 * Copyright (c) 2026 geobim.app
 * Licensed under the Business Source License 1.1 (BSL 1.1)
 * Change Date: 2030-03-01 | Change License: MIT
 * See LICENSE file for full terms.
 *
 * Allows anonymous 30-minute access to the FULL geobim.app.
 * Activated via URL: /demo
 *
 * - Skips auth gate (no login required)
 * - Shows complete UI (sidebar, bottom toolbar, all tools)
 * - 30-minute countdown, then redirects to login
 * - Demo banner with timer + login link
 * - Uses demo Firestore collections (demo_comments, demo_measurements)
 */
'use strict';

(function() {

  // ========================================================
  // DETECT DEMO MODE
  // ========================================================

  var params = new URLSearchParams(window.location.search);
  var isDemoPath = window.location.pathname.replace(/\/+$/, '') === '/demo';
  if (params.get('mode') !== 'demo' && !isDemoPath) return;

  console.log('Demo Mode activated — 30 min full access session');

  var SESSION_MINUTES = 30;
  var SESSION_KEY = 'geobim_demo_session_start';

  // Track session start in sessionStorage (survives page refresh within tab)
  var sessionStart = parseInt(sessionStorage.getItem(SESSION_KEY), 10);
  if (!sessionStart) {
    sessionStart = Date.now();
    sessionStorage.setItem(SESSION_KEY, sessionStart.toString());
  }

  // Global flag for other modules to check
  window._demoMode = true;

  // ========================================================
  // SKIP AUTH GATE
  // ========================================================

  window._splashDismissed = true;
  sessionStorage.setItem('geoBIM_splashShown', '1');
  window._authGatePassed = true;

  // ========================================================
  // DEMO BANNER + COUNTDOWN
  // ========================================================

  function createBanner() {
    var banner = document.createElement('div');
    banner.id = 'demoBanner';

    var style = document.createElement('style');
    style.textContent =
      '#demoBanner{' +
        'position:fixed;top:0;left:0;right:0;z-index:99998;' +
        'display:flex;align-items:center;justify-content:center;gap:16px;' +
        'padding:8px 16px;' +
        'background:linear-gradient(135deg,#0E1117 0%,#1a202c 100%);' +
        'border-bottom:1px solid rgba(46,207,176,0.3);' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
        'font-size:13px;color:rgba(255,255,255,0.8);' +
        'backdrop-filter:blur(8px);' +
      '}' +
      '#demoBanner .demo-label{' +
        'background:rgba(46,207,176,0.15);color:#2ECFB0;' +
        'padding:3px 10px;border-radius:12px;font-weight:600;font-size:11px;' +
        'text-transform:uppercase;letter-spacing:0.05em;' +
        'border:1px solid rgba(46,207,176,0.25);' +
      '}' +
      '#demoBanner .demo-timer{' +
        'font-family:"SF Mono","Fira Code",monospace;font-size:13px;' +
        'color:#2ECFB0;font-weight:600;min-width:52px;text-align:center;' +
      '}' +
      '#demoBanner .demo-timer.warning{color:#f59e0b;}' +
      '#demoBanner .demo-timer.critical{color:#f87171;animation:demo-blink 1s ease-in-out infinite;}' +
      '@keyframes demo-blink{0%,100%{opacity:1;}50%{opacity:0.5;}}' +
      '#demoBanner .demo-login{' +
        'color:#2ECFB0;text-decoration:none;font-size:12px;font-weight:500;' +
        'padding:4px 12px;border:1px solid rgba(46,207,176,0.3);border-radius:6px;' +
        'transition:all 0.2s;' +
      '}' +
      '#demoBanner .demo-login:hover{' +
        'background:rgba(46,207,176,0.1);border-color:rgba(46,207,176,0.5);' +
      '}' +
      '#demoBanner .demo-hint{' +
        'color:rgba(255,255,255,0.4);font-size:11px;' +
      '}' +
      '#demoBanner .demo-license{' +
        'color:rgba(255,255,255,0.3);font-size:10px;font-family:"SF Mono","Fira Code",monospace;' +
        'text-decoration:none;border-bottom:1px dotted rgba(255,255,255,0.2);' +
      '}' +
      '#demoBanner .demo-license:hover{color:rgba(255,255,255,0.6);border-color:rgba(255,255,255,0.4);}' +
      /* Push cesium container down so banner doesn't overlap */
      'body.demo-active #cesiumContainer{top:37px !important;}' +
      'body.demo-active #toolbar{top:47px !important;}' +
      'body.demo-active .sidebar-toggle{top:47px !important;}';

    document.head.appendChild(style);

    banner.innerHTML =
      '<span class="demo-label">Demo</span>' +
      '<span class="demo-hint">Full Access — 30 min trial</span>' +
      '<span class="demo-timer" id="demoTimer">30:00</span>' +
      '<a href="https://spdx.org/licenses/BSL-1.1.html" target="_blank" rel="noopener" class="demo-license" title="Business Source License 1.1">BSL 1.1</a>' +
      '<a href="/" class="demo-login">Sign in for unlimited access →</a>';

    document.body.appendChild(banner);
    document.body.classList.add('demo-active');
  }

  // ========================================================
  // TIMER LOGIC
  // ========================================================

  function startTimer() {
    var timerEl = document.getElementById('demoTimer');
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
        timerEl.className = 'demo-timer critical';
      } else if (remaining < 5 * 60 * 1000) {
        timerEl.className = 'demo-timer warning';
      }
    }, 1000);
  }

  // ========================================================
  // SESSION EXPIRED OVERLAY
  // ========================================================

  function showExpiredOverlay() {
    var overlay = document.createElement('div');
    overlay.id = 'demoExpired';

    var style = document.createElement('style');
    style.textContent =
      '#demoExpired{' +
        'position:fixed;inset:0;z-index:99999;' +
        'display:flex;align-items:center;justify-content:center;' +
        'background:rgba(10,22,40,0.92);backdrop-filter:blur(12px);' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
      '}' +
      '#demoExpired .expired-card{' +
        'background:#0E1117;border-radius:16px;padding:48px 40px;' +
        'max-width:420px;width:90%;text-align:center;' +
        'box-shadow:0 16px 48px rgba(0,0,0,0.5);' +
        'border:1px solid rgba(46,207,176,0.15);' +
      '}' +
      '#demoExpired .expired-logo{width:160px;margin:0 auto 24px;opacity:0.6;}' +
      '#demoExpired .expired-title{' +
        'color:#fff;font-size:20px;font-weight:700;margin-bottom:8px;' +
      '}' +
      '#demoExpired .expired-text{' +
        'color:rgba(255,255,255,0.6);font-size:14px;line-height:1.6;margin-bottom:24px;' +
      '}' +
      '#demoExpired .expired-btn{' +
        'display:inline-block;padding:12px 32px;border:none;border-radius:8px;' +
        'background:linear-gradient(135deg,#2ECFB0 0%,#25A98F 100%);' +
        'color:#0E1117;font-size:15px;font-weight:700;cursor:pointer;' +
        'text-decoration:none;transition:box-shadow 0.2s,transform 0.2s;' +
      '}' +
      '#demoExpired .expired-btn:hover{' +
        'box-shadow:0 6px 16px rgba(46,207,176,0.35);transform:translateY(-1px);' +
      '}' +
      '#demoExpired .expired-restart{' +
        'display:block;margin-top:16px;color:rgba(255,255,255,0.4);' +
        'font-size:12px;text-decoration:none;' +
      '}' +
      '#demoExpired .expired-restart:hover{color:rgba(255,255,255,0.7);}';

    document.head.appendChild(style);

    overlay.innerHTML =
      '<div class="expired-card">' +
        '<img src="logo/logo_teal_transparent.svg" class="expired-logo" alt="geobim.app">' +
        '<div class="expired-title">Demo session expired</div>' +
        '<div class="expired-text">' +
          'Your 30-minute demo session has ended.<br>' +
          'Sign in to access geobim.app without time limits.' +
        '</div>' +
        '<a href="/" class="expired-btn">Sign In</a>' +
        '<a href="/demo" class="expired-restart" ' +
          'onclick="sessionStorage.removeItem(\'' + SESSION_KEY + '\')">Start new demo session</a>' +
      '</div>';

    document.body.appendChild(overlay);
  }

  // ========================================================
  // HOOK INTO AUTH-GATE
  // ========================================================

  // Tell auth-gate to treat this as a demo user (like WEA demo)
  var origOnAuthState = null;
  var hookAuth = setInterval(function() {
    if (window.firebase && firebase.auth) {
      clearInterval(hookAuth);
      // The auth-gate checks _weaDemoMode — we set a similar flag
      // that auth-gate.js can recognize
      window._weaDemoMode = true;
    }
  }, 100);

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
    return;
  }

  window.addEventListener('DOMContentLoaded', function() {
    createBanner();
    startTimer();

    // Auto-open About dialog (Features tab) for new demo users
    var aboutCheck = setInterval(function() {
      if (window.BimViewer && typeof BimViewer.showAboutDialog === 'function') {
        clearInterval(aboutCheck);
        setTimeout(function() {
          BimViewer.showAboutDialog();
          setTimeout(function() {
            var tab = document.querySelector('.about-tab[data-tab="features"]');
            if (tab) tab.click();
          }, 100);
        }, 2000);
      }
    }, 500);
  });

})();
