/**
 * geoBIM.app — Full App Demo Mode
 *
 * Copyright (c) 2026 geobim.app
 * Licensed under the Business Source License 1.1 (BSL 1.1)
 * Change Date: 2030-03-01 | Change License: MIT
 * See LICENSE file for full terms.
 *
 * Guest access to the FULL geobim.app, without time limit (since 2026-09-27;
 * the start page itself also opens as guest, see auth-gate.js).
 * Activated via URL: /demo
 *
 * - Skips auth gate (no login required)
 * - Shows complete UI (sidebar, bottom toolbar, all tools)
 * - Demo banner with a sign-in link that opens the sign-in dialog
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

  // No time limit since 2026-09-27: guests (demo routes and the start page
  // without sign-in) use the app as long as they like; sign-in adds features.
  console.log('Demo Mode activated — guest access, no time limit');
  sessionStorage.removeItem('geobim_demo_session_start');   // old 30-min trial key

  // Global flags — MUST be set before auth-gate.js loads
  window._demoMode = true;
  window._weaDemoMode = true;   // auth-gate.js checks this flag
  window._splashDismissed = true;
  window._authGatePassed = true;
  sessionStorage.setItem('geoBIM_splashShown', '1');

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
      '<span class="demo-hint">Guest access</span>' +
      '<a href="https://spdx.org/licenses/BSL-1.1.html" target="_blank" rel="noopener" class="demo-license" title="Business Source License 1.1">BSL 1.1</a>' +
      '<a href="/" class="demo-login" id="demoSignIn">Sign in for more features →</a>';

    document.body.appendChild(banner);
    document.body.classList.add('demo-active');
    document.getElementById('demoSignIn').addEventListener('click', function(e) {
      if (typeof window.showAuthGateLogin !== 'function') return;   // fall back to the link
      e.preventDefault();
      window.showAuthGateLogin();
    });
  }

  // ========================================================
  // BOOT
  // ========================================================

  window.addEventListener('DOMContentLoaded', function() {
    createBanner();

    // Auto-open About dialog (About tab — has Tour button) for new demo users
    var aboutCheck = setInterval(function() {
      if (window.BimViewer && typeof BimViewer.showAboutDialog === 'function') {
        clearInterval(aboutCheck);
        setTimeout(function() {
          BimViewer.showAboutDialog();
        }, 2000);
      }
    }, 500);
  });

})();
