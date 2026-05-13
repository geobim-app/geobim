/**
 * geoBIM.app — Bridge Inspector Demo Mode
 *
 * Copyright (c) 2026 geobim.app
 * Licensed under the Business Source License 1.1 (BSL 1.1)
 * Change Date: 2030-03-01 | Change License: MIT
 * See LICENSE file for full terms.
 *
 * Anonymous 30-minute access to a curated Bridge Inspection workflow.
 * Activated via URL: /bridge-inspector
 *
 * - Skips auth gate (no login required)
 * - Auto-loads predefined bridge models from Cesium Ion
 * - Whitelists sidebar (Assets, Layers, Annotations, Inspection, Saved Views)
 *   and bottom toolbar (Measure, Visibility, Help)
 * - Hides Filter / Point Cloud / Split / Settings / Lighting / Walk Mode
 * - 30-minute countdown, then redirects to login
 */
'use strict';

(function() {

  // ========================================================
  // DETECT BRIDGE INSPECTOR MODE
  // ========================================================

  var params = new URLSearchParams(window.location.search);
  var isBridgePath = window.location.pathname.replace(/\/+$/, '') === '/bridge-inspector';
  if (params.get('mode') !== 'bridge' && !isBridgePath) return;

  console.log('Bridge Inspector Mode activated — 30 min session');

  var SESSION_MINUTES = 30;
  var SESSION_KEY = 'geobim_bridge_session_start';

  // Cesium Ion asset IDs to auto-load. Names come from DEMO_ASSETS at runtime
  // (same source geobim.app uses for non-OAuth display).
  var BRIDGE_ASSET_IDS = [4495857, 4533896, 4452138, 4427396, 4446751];

  // Restrict the asset selector to these IDs (ui.js honors this filter).
  window._bridgeInspectorAssetFilter = new Set(BRIDGE_ASSET_IDS.map(String));

  // Sidebar section IDs (data-section attribute) that stay visible
  var KEEP_SECTIONS = ['layers', 'comments', 'inspection', 'views', 'drawing', 'visibility', 'about'];

  // Track session start (survives page refresh within tab)
  var sessionStart = parseInt(sessionStorage.getItem(SESSION_KEY), 10);
  if (!sessionStart) {
    sessionStart = Date.now();
    sessionStorage.setItem(SESSION_KEY, sessionStart.toString());
  }

  // Global flags — MUST be set before auth-gate.js loads
  window._bridgeInspectorMode = true;
  window._weaDemoMode = true; // auth-gate checks this flag to bypass login
  window._splashDismissed = true;
  window._authGatePassed = true;
  sessionStorage.setItem('geoBIM_splashShown', '1');

  // ========================================================
  // HIDE NON-WHITELISTED UI
  // ========================================================

  var hideUI = setInterval(function() {
    var toolbar = document.getElementById('toolbar');

    if (toolbar) {
      toolbar.querySelectorAll('.modern-section').forEach(function(section) {
        var header = section.querySelector('.modern-section-header[data-section]');
        var id = header ? header.getAttribute('data-section') : null;
        if (id && KEEP_SECTIONS.indexOf(id) === -1) {
          section.style.display = 'none';
        }
      });
    }

    // Hide Ion asset importer (selector + import button) — assets are auto-loaded
    var ionSelector = document.getElementById('ionAssetSelector');
    if (ionSelector) {
      var importerGroup = ionSelector.closest('.modern-group');
      if (importerGroup) importerGroup.style.display = 'none';
    }

    // Bottom toolbar, STA/IoT widgets and FROST sensor panel are hidden
    // declaratively via body.bridge-demo-active CSS (handles late-created elements).
    if (toolbar) clearInterval(hideUI);
  }, 200);

  // ========================================================
  // AUTO-LOAD BRIDGE ASSETS
  // ========================================================

  var loadAssets = setInterval(function() {
    if (!window.BimViewer || !BimViewer.viewer || typeof BimViewer.loadSelectedAsset !== 'function') return;
    clearInterval(loadAssets);

    // Load all assets in parallel — sequential awaits added ~3s per asset (~15s total).
    // Each loadSelectedAsset creates its own tileset and adds independently.
    // Prefer live Ion names from availableAssets, fall back to DEMO_ASSETS
    var liveAssets = (BimViewer.availableAssets && BimViewer.availableAssets.length)
      ? new Map(BimViewer.availableAssets.map(function(a) { return [Number(a.id), a.name]; }))
      : null;
    var demoMap = (typeof DEMO_ASSETS !== 'undefined') ? DEMO_ASSETS : null;
    var toLoad = BRIDGE_ASSET_IDS.filter(function(id) { return !BimViewer.loadedAssets.has(String(id)); });
    if (toLoad.length === 0) return;

    var total = toLoad.length;
    var done = 0;
    showLoadingPill(total);

    var BELGIUM_ASSET_ID = 4452138;
    var POINTCLOUD_ASSET_ID = 4446751;

    Promise.all(toLoad.map(function(id) {
      var name = (liveAssets && liveAssets.get(id)) || (demoMap && demoMap.get(id)) || ('Asset ' + id);
      // Stay at default globe camera; createAssetControls must run so the
      // Loaded Assets panel populates (silent:true would skip that).
      return BimViewer.loadSelectedAsset(id, name, { noFlyTo: true })
        .then(function() {
          console.log('Bridge Inspector: loaded asset', id, '—', name);
          if (id === POINTCLOUD_ASSET_ID) {
            applyBridgePointcloudPreset();
          }
          // Enable FROST sensor panel only when Bridge Belgium is present
          if (id === BELGIUM_ASSET_ID) {
            document.body.classList.add('bridge-sta-active');
            console.log('Bridge Inspector: STA panel enabled (Bridge Belgium loaded)');
            injectStaLiveButton(id);
            // Prefetch FROST data immediately so IOT button feels instant
            if (window.GEOBIM_SENSORTHINGS && typeof GEOBIM_SENSORTHINGS.prefetch === 'function') {
              GEOBIM_SENSORTHINGS.prefetch();
            }
          }
        })
        .catch(function(e) { console.warn('Bridge Inspector: failed to load asset', id, e.message); })
        .then(function() { done++; updateLoadingPill(done, total); });
    })).then(hideLoadingPill);
  }, 500);

  // ========================================================
  // LOADING PILL (top-center spinner + counter)
  // ========================================================

  function showLoadingPill(total) {
    if (document.getElementById('bridgeLoadingPill')) return;
    var pill = document.createElement('div');
    pill.id = 'bridgeLoadingPill';
    pill.innerHTML =
      '<div class="bridge-loading-spinner"></div>' +
      '<span id="bridgeLoadingText">Loading assets… 0/' + total + '</span>';
    document.body.appendChild(pill);
    // Trigger fade-in after layout
    requestAnimationFrame(function() { pill.classList.add('visible'); });
  }

  function updateLoadingPill(done, total) {
    var txt = document.getElementById('bridgeLoadingText');
    if (txt) txt.textContent = 'Loading assets… ' + done + '/' + total;
  }

  function hideLoadingPill() {
    var pill = document.getElementById('bridgeLoadingPill');
    if (!pill) return;
    pill.classList.remove('visible');
    setTimeout(function() { if (pill.parentNode) pill.parentNode.removeChild(pill); }, 300);
  }

  // ========================================================
  // POINTCLOUD PRESET — applied when Bridge (Pointcloud) loads
  // ========================================================

  function applyBridgePointcloudPreset() {
    if (typeof BimViewer.applyPointCloudPreset !== 'function') return;

    // Set quality preset values in global settings object
    BimViewer.applyPointCloudPreset('quality');

    // Detection via hasTileContent fails for point clouds (featuresLength === 0)
    // and noFlyTo means the camera never streams the tiles during the poll window.
    // We know this asset is a point cloud, so force-mark and apply directly.
    var assetData = BimViewer.loadedAssets && BimViewer.loadedAssets.get('4446751');
    if (assetData && assetData.tileset) {
      assetData.isPointCloud = true;
      if (typeof BimViewer.applyPointCloudSettings === 'function') {
        BimViewer.applyPointCloudSettings(assetData.tileset);
      }
    }
    console.log('Bridge Inspector: pointcloud quality preset applied');
  }

  // ========================================================
  // STA LIVE BUTTON — injected into Belgium asset card
  // ========================================================

  function injectStaLiveButton(assetId) {
    // createAssetControls runs synchronously before our .then() fires,
    // but the card may not be in DOM yet if panel wasn't open — use rAF.
    requestAnimationFrame(function() {
      var card = document.getElementById('asset_' + assetId);
      if (!card) return;
      var controls = card.querySelector('.modern-asset-controls');
      if (!controls || controls.querySelector('.sta-asset-live-btn')) return;

      var btn = document.createElement('button');
      btn.className = 'sta-asset-live-btn';
      btn.title = 'Live Sensor Data — Bridge Belgium';
      btn.innerHTML = '<span class="sta-live-dot"></span>IOT';
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var staBtn = document.getElementById('staToggleBtn');
        if (staBtn) staBtn.click();
        // Sync active style with STA panel state
        setTimeout(function() {
          var panel = document.getElementById('sta-panel');
          btn.classList.toggle('active', !!(panel && panel.classList.contains('visible')));
        }, 50);
      });

      // Insert as leftmost button (before fly-to 📍)
      var firstBtn = controls.querySelector('.modern-icon-btn');
      controls.insertBefore(btn, firstBtn || null);
    });
  }

  // ========================================================
  // DEMO BANNER + COUNTDOWN
  // ========================================================

  function createBanner() {
    var banner = document.createElement('div');
    banner.id = 'bridgeDemoBanner';

    var style = document.createElement('style');
    style.textContent =
      '#bridgeDemoBanner{' +
        'position:fixed;top:0;left:0;right:0;z-index:99998;' +
        'display:flex;align-items:center;justify-content:center;gap:16px;' +
        'padding:8px 16px;' +
        'background:linear-gradient(135deg,#0E1117 0%,#1a202c 100%);' +
        'border-bottom:1px solid rgba(46,207,176,0.3);' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
        'font-size:13px;color:rgba(255,255,255,0.8);' +
        'backdrop-filter:blur(8px);' +
      '}' +
      '#bridgeDemoBanner .bridge-demo-label{' +
        'background:rgba(46,207,176,0.15);color:#2ECFB0;' +
        'padding:3px 10px;border-radius:12px;font-weight:600;font-size:11px;' +
        'text-transform:uppercase;letter-spacing:0.05em;' +
        'border:1px solid rgba(46,207,176,0.25);' +
      '}' +
      '#bridgeDemoBanner .bridge-demo-timer{' +
        'font-family:"SF Mono","Fira Code",monospace;font-size:13px;' +
        'color:#2ECFB0;font-weight:600;min-width:52px;text-align:center;' +
      '}' +
      '#bridgeDemoBanner .bridge-demo-timer.warning{color:#f59e0b;}' +
      '#bridgeDemoBanner .bridge-demo-timer.critical{color:#f87171;animation:bridge-blink 1s ease-in-out infinite;}' +
      '@keyframes bridge-blink{0%,100%{opacity:1;}50%{opacity:0.5;}}' +
      '#bridgeDemoBanner .bridge-demo-login{' +
        'color:#2ECFB0;text-decoration:none;font-size:12px;font-weight:500;' +
        'padding:4px 12px;border:1px solid rgba(46,207,176,0.3);border-radius:6px;' +
        'transition:all 0.2s;' +
      '}' +
      '#bridgeDemoBanner .bridge-demo-login:hover{' +
        'background:rgba(46,207,176,0.1);border-color:rgba(46,207,176,0.5);' +
      '}' +
      '#bridgeDemoBanner .bridge-demo-hint{' +
        'color:rgba(255,255,255,0.4);font-size:11px;' +
      '}' +
      '#bridgeDemoBanner .bridge-demo-license{' +
        'color:rgba(255,255,255,0.3);font-size:10px;font-family:"SF Mono","Fira Code",monospace;' +
        'text-decoration:none;border-bottom:1px dotted rgba(255,255,255,0.2);' +
      '}' +
      '#bridgeDemoBanner .bridge-demo-license:hover{color:rgba(255,255,255,0.6);border-color:rgba(255,255,255,0.4);}' +
      /* Live sensor badge on asset card */
      '.sta-asset-live-btn{' +
        'display:inline-flex;align-items:center;gap:4px;' +
        'padding:3px 8px;border-radius:10px;' +
        'border:1px solid rgba(46,207,176,0.4);' +
        'background:rgba(46,207,176,0.08);' +
        'color:#2ECFB0;font-size:10px;font-weight:700;font-family:inherit;' +
        'cursor:pointer;letter-spacing:0.05em;' +
        'transition:background 0.2s,border-color 0.2s;' +
      '}' +
      '.sta-asset-live-btn:hover{background:rgba(46,207,176,0.18);border-color:rgba(46,207,176,0.65);}' +
      '.sta-asset-live-btn.active{background:rgba(46,207,176,0.22);border-color:#2ECFB0;}' +
      '.sta-live-dot{width:6px;height:6px;border-radius:50%;background:#2ECFB0;flex-shrink:0;' +
        'animation:sta-dot-pulse 1.5s ease-in-out infinite;}' +
      '@keyframes sta-dot-pulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:0.35;transform:scale(0.65);}}' +
      'body.bridge-demo-active #cesiumContainer{top:37px !important;}' +
      'body.bridge-demo-active #toolbar{top:47px !important;}' +
      'body.bridge-demo-active .sidebar-toggle{top:47px !important;}' +
      'body.bridge-demo-active .status-indicator{display:none !important;}' +
      /* Hide bottom toolbar (Measure / Visibility / Help live in the sidebar) */
      'body.bridge-demo-active #bottomToolbar{display:none !important;}' +
      /* sta-panel hidden until Bridge Belgium loaded; buttons replaced by IOT card button */
      'body.bridge-demo-active:not(.bridge-sta-active) #sta-panel{display:none !important;}' +
      'body.bridge-demo-active #staToggleBtn,' +
      'body.bridge-demo-active #iotToggleBtn{display:none !important;}' +
      /* Damage simulation button hidden by default */
      'body.bridge-demo-active .sta-trigger-btn{display:none !important;}' +
      /* Loading card — viewport-centered, dual-ring spinner */
      '#bridgeLoadingPill{' +
        'position:fixed;top:50%;left:50%;' +
        'transform:translate(-50%,-50%) scale(0.92);' +
        'z-index:99997;display:flex;flex-direction:column;align-items:center;gap:16px;' +
        'padding:28px 36px;' +
        'background:rgba(14,17,23,0.88);' +
        'border:1px solid rgba(46,207,176,0.35);' +
        'border-radius:16px;' +
        'backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);' +
        'box-shadow:0 10px 40px rgba(0,0,0,0.55),0 0 0 1px rgba(46,207,176,0.08);' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
        'font-size:13px;font-weight:500;color:rgba(255,255,255,0.92);' +
        'letter-spacing:0.02em;' +
        'opacity:0;transition:opacity 0.25s ease,transform 0.25s ease;' +
        'pointer-events:none;' +
      '}' +
      '#bridgeLoadingPill.visible{opacity:1;transform:translate(-50%,-50%) scale(1);}' +
      '#bridgeLoadingPill .bridge-loading-spinner{' +
        'position:relative;width:52px;height:52px;' +
      '}' +
      '#bridgeLoadingPill .bridge-loading-spinner::before,' +
      '#bridgeLoadingPill .bridge-loading-spinner::after{' +
        'content:"";position:absolute;border-radius:50%;border:3px solid transparent;' +
      '}' +
      '#bridgeLoadingPill .bridge-loading-spinner::before{' +
        'inset:0;' +
        'border-top-color:#2ECFB0;border-right-color:rgba(46,207,176,0.55);' +
        'animation:bridge-spin 0.85s cubic-bezier(0.45,0.05,0.55,0.95) infinite;' +
      '}' +
      '#bridgeLoadingPill .bridge-loading-spinner::after{' +
        'inset:9px;' +
        'border-top-color:rgba(46,207,176,0.7);border-left-color:rgba(46,207,176,0.15);' +
        'animation:bridge-spin-rev 1.4s linear infinite;' +
      '}' +
      '@keyframes bridge-spin{to{transform:rotate(360deg);}}' +
      '@keyframes bridge-spin-rev{to{transform:rotate(-360deg);}}';

    document.head.appendChild(style);

    banner.innerHTML =
      '<span class="bridge-demo-label">Bridge Inspector</span>' +
      '<span class="bridge-demo-timer" id="bridgeDemoTimer">30:00</span>' +
      '<a href="https://spdx.org/licenses/BSL-1.1.html" target="_blank" rel="noopener" class="bridge-demo-license" title="Business Source License 1.1">BSL 1.1</a>' +
      '<a href="/" class="bridge-demo-login">Sign in for full access →</a>';

    document.body.appendChild(banner);
    document.body.classList.add('bridge-demo-active');
  }

  // ========================================================
  // TIMER LOGIC
  // ========================================================

  function startTimer() {
    var timerEl = document.getElementById('bridgeDemoTimer');
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

      if (remaining < 2 * 60 * 1000) {
        timerEl.className = 'bridge-demo-timer critical';
      } else if (remaining < 5 * 60 * 1000) {
        timerEl.className = 'bridge-demo-timer warning';
      }
    }, 1000);
  }

  // ========================================================
  // SESSION EXPIRED OVERLAY
  // ========================================================

  function showExpiredOverlay() {
    var overlay = document.createElement('div');
    overlay.id = 'bridgeDemoExpired';

    var style = document.createElement('style');
    style.textContent =
      '#bridgeDemoExpired{' +
        'position:fixed;inset:0;z-index:99999;' +
        'display:flex;align-items:center;justify-content:center;' +
        'background:rgba(10,22,40,0.92);backdrop-filter:blur(12px);' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
      '}' +
      '#bridgeDemoExpired .expired-card{' +
        'background:#0E1117;border-radius:16px;padding:48px 40px;' +
        'max-width:420px;width:90%;text-align:center;' +
        'box-shadow:0 16px 48px rgba(0,0,0,0.5);' +
        'border:1px solid rgba(46,207,176,0.15);' +
      '}' +
      '#bridgeDemoExpired .expired-logo{width:160px;margin:0 auto 24px;opacity:0.6;}' +
      '#bridgeDemoExpired .expired-title{' +
        'color:#fff;font-size:20px;font-weight:700;margin-bottom:8px;' +
      '}' +
      '#bridgeDemoExpired .expired-text{' +
        'color:rgba(255,255,255,0.6);font-size:14px;line-height:1.6;margin-bottom:24px;' +
      '}' +
      '#bridgeDemoExpired .expired-btn{' +
        'display:inline-block;padding:12px 32px;border:none;border-radius:8px;' +
        'background:linear-gradient(135deg,#2ECFB0 0%,#25A98F 100%);' +
        'color:#0E1117;font-size:15px;font-weight:700;cursor:pointer;' +
        'text-decoration:none;transition:box-shadow 0.2s,transform 0.2s;' +
      '}' +
      '#bridgeDemoExpired .expired-btn:hover{' +
        'box-shadow:0 6px 16px rgba(46,207,176,0.35);transform:translateY(-1px);' +
      '}' +
      '#bridgeDemoExpired .expired-restart{' +
        'display:block;margin-top:16px;color:rgba(255,255,255,0.4);' +
        'font-size:12px;text-decoration:none;' +
      '}' +
      '#bridgeDemoExpired .expired-restart:hover{color:rgba(255,255,255,0.7);}';

    document.head.appendChild(style);

    overlay.innerHTML =
      '<div class="expired-card">' +
        '<img src="logo/logo_teal_transparent.svg" class="expired-logo" alt="geobim.app">' +
        '<div class="expired-title">Bridge Inspector session expired</div>' +
        '<div class="expired-text">' +
          'Your 30-minute Bridge Inspector demo session has ended.<br>' +
          'Sign in to access the full geobim.app platform.' +
        '</div>' +
        '<a href="/" class="expired-btn">Sign In</a>' +
        '<a href="/bridge-inspector" class="expired-restart" ' +
          'onclick="sessionStorage.removeItem(\'' + SESSION_KEY + '\')">Start new demo session</a>' +
      '</div>';

    document.body.appendChild(overlay);
  }

  // ========================================================
  // BOOT
  // ========================================================

  // Check if session already expired on load
  var elapsedOnLoad = Date.now() - sessionStart;
  if (elapsedOnLoad >= SESSION_MINUTES * 60 * 1000) {
    window.addEventListener('DOMContentLoaded', function() {
      sessionStorage.removeItem(SESSION_KEY);
      showExpiredOverlay();
    });
    return;
  }

  window.addEventListener('DOMContentLoaded', function() {
    createBanner();
    startTimer();
  });

})();
