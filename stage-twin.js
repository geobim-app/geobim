/**
 * geoBIM.app — StageTwin (Client Progress Viewer)
 *
 * Copyright (c) 2026 geobim.app
 * Licensed under the Business Source License 1.1 (BSL 1.1)
 * Change Date: 2030-03-01 | Change License: MIT
 * See LICENSE file for full terms.
 *
 * Slim, single-purpose client view of construction progress: auto-loads one
 * asset and shows only the 4D construction-sequencing timeline (sequencing.js)
 * — the "Soll" (planned stage) side. Unlike the other /demo-style modes this
 * has no login skip ceremony via time limit: it's meant as a persistent link
 * a Bauherr (owner/client) can revisit, not a marketing trial.
 *
 * Activated via URL: /stage-twin
 *
 * First example: Ion asset 4538820 "Construction Stages (Bridge)" — an IFC
 * model with a "stage" property set, i.e. only the Soll side. Ist (as-built
 * point cloud) overlay is a later addition once a real progress-scan asset
 * exists for a project.
 */
'use strict';

(function() {

  // ========================================================
  // DETECT STAGETWIN MODE
  // ========================================================

  var params = new URLSearchParams(window.location.search);
  var isPath = window.location.pathname.replace(/\/+$/, '') === '/stage-twin';
  if (params.get('mode') !== 'stagetwin' && !isPath) return;

  console.log('StageTwin activated');

  var ASSET_ID = 4538820;
  var PROJECT_LABEL = 'Bauphasen-Vorschau';

  // ========================================================
  // SKIP AUTH GATE
  // ========================================================

  // Reuses the same flag every other no-login mode sets — auth-gate.js
  // checks this name specifically, not a StageTwin-specific one.
  window._weaDemoMode = true;
  window._splashDismissed = true;
  sessionStorage.setItem('geoBIM_splashShown', '1');
  window._authGatePassed = true;

  // ========================================================
  // HIDE SIDEBAR / BOTTOM TOOLBAR — SHOW ONLY THE VIEWER + TIMELINE
  // ========================================================

  var hideUI = setInterval(function() {
    var toolbar = document.getElementById('toolbar');
    var toggle = document.getElementById('sidebarToggle');
    var bottomToolbar = document.getElementById('bottomToolbar');
    var staBtn = document.getElementById('staToggleBtn');
    var iotBtn = document.getElementById('iotToggleBtn');

    if (toolbar) toolbar.style.display = 'none';
    if (toggle) toggle.style.display = 'none';
    if (bottomToolbar) bottomToolbar.style.display = 'none';
    if (staBtn) staBtn.style.display = 'none';
    if (iotBtn) iotBtn.style.display = 'none';

    if (toolbar && bottomToolbar) clearInterval(hideUI);
  }, 200);

  // ========================================================
  // AUTO-LOAD ASSET + ACTIVATE SEQUENCING TIMELINE
  // ========================================================

  var boot = setInterval(function() {
    if (!window.BimViewer || !BimViewer.viewer || typeof BimViewer.loadSelectedAsset !== 'function') return;
    clearInterval(boot);

    var name = (typeof DEMO_ASSETS !== 'undefined' && DEMO_ASSETS.get(ASSET_ID)) || 'Bridge';

    BimViewer.loadSelectedAsset(ASSET_ID, name, {})
      .then(function() {
        if (typeof BimViewer.activateSequencing === 'function') {
          BimViewer.activateSequencing(ASSET_ID.toString());
        }
      })
      .catch(function(e) {
        console.warn('StageTwin: failed to load asset', e.message);
      });
  }, 500);

  // ========================================================
  // BRANDING BANNER (no countdown — persistent client link)
  // ========================================================

  function createBanner() {
    var banner = document.createElement('div');
    banner.id = 'stageTwinBanner';

    var style = document.createElement('style');
    style.textContent =
      '#stageTwinBanner{' +
        'position:fixed;top:0;left:0;right:0;z-index:99998;' +
        'display:flex;align-items:center;justify-content:center;gap:16px;' +
        'padding:8px 16px;' +
        'background:linear-gradient(135deg,#0E1117 0%,#1a202c 100%);' +
        'border-bottom:1px solid rgba(46,207,176,0.3);' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
        'font-size:13px;color:rgba(255,255,255,0.8);' +
        'backdrop-filter:blur(8px);' +
      '}' +
      '#stageTwinBanner .st-label{' +
        'background:rgba(46,207,176,0.15);color:#2ECFB0;' +
        'padding:3px 10px;border-radius:12px;font-weight:600;font-size:11px;' +
        'text-transform:uppercase;letter-spacing:0.05em;' +
        'border:1px solid rgba(46,207,176,0.25);' +
      '}' +
      '#stageTwinBanner .st-hint{' +
        'color:rgba(255,255,255,0.6);font-size:12px;' +
      '}' +
      '#stageTwinBanner .st-license{' +
        'color:rgba(255,255,255,0.3);font-size:10px;font-family:"SF Mono","Fira Code",monospace;' +
        'text-decoration:none;border-bottom:1px dotted rgba(255,255,255,0.2);' +
        'margin-left:auto;' +
      '}' +
      '#stageTwinBanner .st-license:hover{color:rgba(255,255,255,0.6);border-color:rgba(255,255,255,0.4);}' +
      /* Push cesium container down so the banner doesn't overlap */
      'body.stage-twin-active #cesiumContainer{top:37px !important;}' +
      /* Hide status toasts (e.g. "20 assets available") */
      'body.stage-twin-active .status-indicator{display:none !important;}' +
      /* The sequencing timeline is the only UI — don't let it be closed
         with no toolbar left to reopen it from */
      'body.stage-twin-active .seq-close-btn{display:none !important;}';

    document.head.appendChild(style);

    banner.innerHTML =
      '<span class="st-label">StageTwin</span>' +
      '<span class="st-hint">' + PROJECT_LABEL + '</span>' +
      '<a href="https://spdx.org/licenses/BSL-1.1.html" target="_blank" rel="noopener" class="st-license" title="Business Source License 1.1">BSL 1.1</a>';

    document.body.appendChild(banner);
    document.body.classList.add('stage-twin-active');
  }

  window.addEventListener('DOMContentLoaded', createBanner);

})();
