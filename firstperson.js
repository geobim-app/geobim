// ============================================================
// First-Person Navigation Module for geobim.app
//
// Copyright (c) 2026 geobim.app
// Licensed under the Business Source License 1.1 (BSL 1.1)
// Change Date: 2030-03-01 | Change License: MIT
// See LICENSE file for full terms.
//
// Shortcut: G to toggle first-person mode
// WASD movement, Q/E up/down, Shift=sprint, Mouse look, Gamepad
// Terrain clamping with configurable eye height
//
// Based on prototype: github.com/christof2304/firstperson
// Tested with CesiumJS 1.139.1
// ============================================================

(function() {
  'use strict';

  // ========================================================
  // CONSTANTS
  // ========================================================

  var CROSSHAIR_ID = 'fpCrosshair';
  var BANNER_ID = 'fpBanner';
  var PANEL_ID = 'fpSettingsPanel';

  // ========================================================
  // STATE
  // ========================================================

  var active = false;
  var panelVisible = false;
  var panelCreated = false;
  var savedController = null;
  var preRenderListener = null;
  var lastTerrainSample = 0;
  var terrainHeight = 0;

  var keys = {
    forward: false, backward: false, left: false, right: false,
    up: false, down: false, sprint: false
  };

  var look = { heading: 0, pitch: 0 };

  var gamepad = { index: -1, lastA: false };

  // ========================================================
  // CONFIG
  // ========================================================

  var config = {
    moveSpeed: 8.0,
    sprintMultiplier: 4.0,
    mouseSensitivity: 0.005,
    eyeHeight: 1.7,
    terrainClamp: true,
    terrainSampleInterval: 400,
    gamepadMoveSpeed: 12.0,
    gamepadSensitivity: 0.05,
    gamepadDeadzone: 0.15
  };

  // ========================================================
  // HELPERS
  // ========================================================

  function isMobile() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function getViewer() {
    return window.BimViewer && BimViewer.viewer;
  }

  // ========================================================
  // ACTIVATE / DEACTIVATE
  // ========================================================

  function activate() {
    var viewer = getViewer();
    if (!viewer || active) return;

    active = true;

    // Save controller state
    var ctrl = viewer.scene.screenSpaceCameraController;
    savedController = {
      enableRotate: ctrl.enableRotate,
      enableTranslate: ctrl.enableTranslate,
      enableZoom: ctrl.enableZoom,
      enableTilt: ctrl.enableTilt,
      enableLook: ctrl.enableLook
    };

    // Disable default controls
    ctrl.enableRotate = false;
    ctrl.enableTranslate = false;
    ctrl.enableZoom = false;
    ctrl.enableTilt = false;
    ctrl.enableLook = false;

    // Capture current orientation
    look.heading = viewer.camera.heading;
    look.pitch = viewer.camera.pitch;

    // Pointer lock (desktop only)
    if (!isMobile()) {
      try { viewer.scene.canvas.requestPointerLock(); } catch (_) {}
    }

    // Per-frame update
    preRenderListener = viewer.scene.preRender.addEventListener(update);

    // UI
    showCrosshair();
    showBanner();
    updatePanelState();

    console.log('🚶 First-Person mode activated (G to exit)');
  }

  function deactivate() {
    var viewer = getViewer();
    if (!viewer || !active) return;

    active = false;

    // Restore controller
    if (savedController) {
      var ctrl = viewer.scene.screenSpaceCameraController;
      ctrl.enableRotate = savedController.enableRotate;
      ctrl.enableTranslate = savedController.enableTranslate;
      ctrl.enableZoom = savedController.enableZoom;
      ctrl.enableTilt = savedController.enableTilt;
      ctrl.enableLook = savedController.enableLook;
      savedController = null;
    }

    // Exit pointer lock
    if (document.pointerLockElement === viewer.scene.canvas) {
      try { document.exitPointerLock(); } catch (_) {}
    }

    // Remove per-frame update
    if (preRenderListener) {
      preRenderListener();
      preRenderListener = null;
    }

    // Reset keys
    keys.forward = keys.backward = keys.left = keys.right = keys.up = keys.down = keys.sprint = false;

    // UI
    hideCrosshair();
    hideBanner();
    updatePanelState();

    console.log('🚶 First-Person mode deactivated');
  }

  function toggle() {
    if (active) deactivate(); else activate();
  }

  // ========================================================
  // KEYBOARD (capture phase — intercepts WASD before WEA/comments)
  // ========================================================

  document.addEventListener('keydown', function(e) {
    // Skip inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    var k = e.key.toLowerCase();

    // Toggle shortcut (always active)
    if (k === 'g' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      toggle();
      return;
    }

    if (!active) return;

    // ESC to exit
    if (k === 'escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      deactivate();
      return;
    }

    // Movement keys — intercept before other handlers
    var handled = true;
    switch (k) {
      case 'w': case 'arrowup':    keys.forward = true; break;
      case 's': case 'arrowdown':  keys.backward = true; break;
      case 'a': case 'arrowleft':  keys.left = true; break;
      case 'd': case 'arrowright': keys.right = true; break;
      case 'q': keys.up = true; break;
      case 'e': case ' ': keys.down = true; break;
      default: handled = false;
    }

    if (e.shiftKey) keys.sprint = true;

    if (handled) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true); // capture phase

  document.addEventListener('keyup', function(e) {
    if (!active) return;

    var k = e.key.toLowerCase();
    switch (k) {
      case 'w': case 'arrowup':    keys.forward = false; break;
      case 's': case 'arrowdown':  keys.backward = false; break;
      case 'a': case 'arrowleft':  keys.left = false; break;
      case 'd': case 'arrowright': keys.right = false; break;
      case 'q': keys.up = false; break;
      case 'e': case ' ': keys.down = false; break;
    }

    if (!e.shiftKey) keys.sprint = false;
  }, true);

  // ========================================================
  // MOUSE LOOK
  // ========================================================

  document.addEventListener('mousemove', function(e) {
    var viewer = getViewer();
    if (!active || !viewer) return;
    if (document.pointerLockElement !== viewer.scene.canvas) return;

    look.heading += e.movementX * config.mouseSensitivity;
    look.pitch -= e.movementY * config.mouseSensitivity;
    look.pitch = clamp(look.pitch, -Math.PI * 0.49, Math.PI * 0.49);

    viewer.camera.setView({
      orientation: { heading: look.heading, pitch: look.pitch, roll: 0 }
    });
  });

  // Re-acquire pointer lock on click while active
  document.addEventListener('click', function() {
    var viewer = getViewer();
    if (!active || !viewer || isMobile()) return;
    if (document.pointerLockElement !== viewer.scene.canvas) {
      try { viewer.scene.canvas.requestPointerLock(); } catch (_) {}
    }
  });

  // ========================================================
  // TOUCH LOOK (mobile)
  // ========================================================

  var touchState = { active: false, lastX: 0, lastY: 0 };

  function initTouch() {
    var viewer = getViewer();
    if (!viewer || !isMobile()) return;

    var canvas = viewer.scene.canvas;

    canvas.addEventListener('touchstart', function(e) {
      if (!active || e.touches.length !== 1) return;
      touchState.active = true;
      touchState.lastX = e.touches[0].clientX;
      touchState.lastY = e.touches[0].clientY;
    }, { passive: true });

    canvas.addEventListener('touchmove', function(e) {
      if (!active || !touchState.active || e.touches.length !== 1) return;
      var t = e.touches[0];
      var dx = t.clientX - touchState.lastX;
      var dy = t.clientY - touchState.lastY;

      look.heading += dx * config.mouseSensitivity * 0.5;
      look.pitch -= dy * config.mouseSensitivity * 0.5;
      look.pitch = clamp(look.pitch, -Math.PI * 0.49, Math.PI * 0.49);

      viewer.camera.setView({
        orientation: { heading: look.heading, pitch: look.pitch, roll: 0 }
      });

      touchState.lastX = t.clientX;
      touchState.lastY = t.clientY;
    }, { passive: true });

    canvas.addEventListener('touchend', function() {
      touchState.active = false;
    }, { passive: true });
  }

  // ========================================================
  // GAMEPAD
  // ========================================================

  function setupGamepad() {
    window.addEventListener('gamepadconnected', function(e) {
      gamepad.index = e.gamepad.index;
      console.log('🎮 Gamepad connected:', e.gamepad.id);
      updateGamepadUI();
    });
    window.addEventListener('gamepaddisconnected', function() {
      gamepad.index = -1;
      console.log('🎮 Gamepad disconnected');
      updateGamepadUI();
    });
    // Scan periodically
    setInterval(scanGamepads, 1000);
  }

  function scanGamepads() {
    var gps = navigator.getGamepads ? navigator.getGamepads() : [];
    for (var i = 0; i < gps.length; i++) {
      if (gps[i] && gps[i].connected) {
        if (gamepad.index !== i) {
          gamepad.index = i;
          updateGamepadUI();
        }
        return;
      }
    }
  }

  function deadzone(v) {
    return Math.abs(v) < config.gamepadDeadzone ? 0 : v;
  }

  function processGamepad() {
    if (gamepad.index < 0) return;
    var gps = navigator.getGamepads ? navigator.getGamepads() : [];
    var gp = gps[gamepad.index];
    if (!gp || !gp.connected) return;

    var viewer = getViewer();
    if (!viewer) return;

    // A button = toggle first person
    var aPressed = gp.buttons[0] && gp.buttons[0].pressed;
    if (aPressed && !gamepad.lastA) toggle();
    gamepad.lastA = aPressed;

    if (!active) return;

    // Left stick = move
    var leftX = deadzone(gp.axes[0] || 0);
    var leftY = deadzone(gp.axes[1] || 0);
    // Right stick = look
    var rightX = deadzone(gp.axes[2] || 0);
    var rightY = deadzone(gp.axes[3] || 0);
    // Triggers = up/down
    var leftTrig = gp.buttons[6] ? gp.buttons[6].value : 0;
    var rightTrig = gp.buttons[7] ? gp.buttons[7].value : 0;
    // Boost
    var boost = (gp.buttons[10] && gp.buttons[10].pressed) ? config.sprintMultiplier : 1.0;

    // Look
    if (rightX !== 0 || rightY !== 0) {
      look.heading -= rightX * config.gamepadSensitivity;
      look.pitch += rightY * config.gamepadSensitivity;
      look.pitch = clamp(look.pitch, -Math.PI * 0.49, Math.PI * 0.49);
      viewer.camera.setView({
        orientation: { heading: look.heading, pitch: look.pitch, roll: 0 }
      });
    }

    // Move
    var speed = config.gamepadMoveSpeed * boost;
    if (leftY !== 0) viewer.camera.moveForward(-leftY * speed);
    if (leftX !== 0) viewer.camera.moveRight(leftX * speed);
    if (rightTrig > 0.05) viewer.camera.moveUp(rightTrig * speed);
    if (leftTrig > 0.05) viewer.camera.moveDown(leftTrig * speed);
  }

  function updateGamepadUI() {
    var el = document.getElementById('fpGamepadStatus');
    if (!el) return;
    if (gamepad.index >= 0) {
      var gps = navigator.getGamepads ? navigator.getGamepads() : [];
      var name = gps[gamepad.index] ? gps[gamepad.index].id.substring(0, 30) : 'Controller';
      el.innerHTML = '<span style="color:#2ECFB0;">🎮 ' + name + '</span>';
    } else {
      el.innerHTML = '<span style="color:rgba(255,255,255,0.3);">🎮 No controller</span>';
    }
  }

  // ========================================================
  // PER-FRAME UPDATE
  // ========================================================

  function update() {
    processGamepad();
    if (!active) return;

    var viewer = getViewer();
    if (!viewer) return;

    var speed = config.moveSpeed * (keys.sprint ? config.sprintMultiplier : 1.0);

    if (keys.forward)  viewer.camera.moveForward(speed);
    if (keys.backward) viewer.camera.moveBackward(speed);
    if (keys.left)     viewer.camera.moveLeft(speed);
    if (keys.right)    viewer.camera.moveRight(speed);
    if (keys.up)       viewer.camera.moveUp(speed);
    if (keys.down)     viewer.camera.moveDown(speed);

    // Terrain clamping
    if (config.terrainClamp) {
      clampToTerrain(viewer);
    }
  }

  // ========================================================
  // TERRAIN CLAMPING
  // ========================================================

  function clampToTerrain(viewer) {
    var now = Date.now();
    if (now - lastTerrainSample < config.terrainSampleInterval) {
      // Between samples, enforce last known height
      enforceMinHeight(viewer);
      return;
    }
    lastTerrainSample = now;

    var carto = Cesium.Cartographic.fromCartesian(viewer.camera.position);

    // Try scene.sampleHeight first (synchronous, works with 3D tiles + terrain)
    try {
      var h = viewer.scene.sampleHeight(carto);
      if (h !== undefined && isFinite(h)) {
        terrainHeight = h;
        enforceMinHeight(viewer);
        return;
      }
    } catch (_) {}

    // Fallback: async terrain sampling
    var tp = viewer.scene.terrainProvider;
    if (tp && tp.ready !== false) {
      Cesium.sampleTerrainMostDetailed(tp, [Cesium.Cartographic.clone(carto)])
        .then(function(results) {
          if (results[0] && isFinite(results[0].height)) {
            terrainHeight = results[0].height;
          }
        })
        .catch(function() {});
    }
  }

  function enforceMinHeight(viewer) {
    var carto = Cesium.Cartographic.fromCartesian(viewer.camera.position);
    var minH = terrainHeight + config.eyeHeight;
    if (carto.height < minH) {
      viewer.camera.position = Cesium.Cartesian3.fromRadians(
        carto.longitude, carto.latitude, minH
      );
    }
  }

  // ========================================================
  // UI — CROSSHAIR
  // ========================================================

  function showCrosshair() {
    if (document.getElementById(CROSSHAIR_ID)) {
      document.getElementById(CROSSHAIR_ID).style.display = 'block';
      return;
    }

    var el = document.createElement('div');
    el.id = CROSSHAIR_ID;

    var style = document.createElement('style');
    style.textContent =
      '#' + CROSSHAIR_ID + '{' +
        'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
        'z-index:500;pointer-events:none;' +
        'width:24px;height:24px;' +
      '}' +
      '#' + CROSSHAIR_ID + '::before,#' + CROSSHAIR_ID + '::after{' +
        'content:"";position:absolute;background:rgba(255,255,255,0.6);border-radius:1px;' +
      '}' +
      '#' + CROSSHAIR_ID + '::before{' +
        'width:2px;height:24px;left:11px;top:0;' +
      '}' +
      '#' + CROSSHAIR_ID + '::after{' +
        'width:24px;height:2px;top:11px;left:0;' +
      '}';

    document.head.appendChild(style);
    document.body.appendChild(el);
  }

  function hideCrosshair() {
    var el = document.getElementById(CROSSHAIR_ID);
    if (el) el.style.display = 'none';
  }

  // ========================================================
  // UI — MODE BANNER
  // ========================================================

  function showBanner() {
    if (document.getElementById(BANNER_ID)) {
      document.getElementById(BANNER_ID).style.display = 'flex';
      return;
    }

    var el = document.createElement('div');
    el.id = BANNER_ID;

    var style = document.createElement('style');
    style.textContent =
      '#' + BANNER_ID + '{' +
        'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:500;' +
        'display:flex;align-items:center;gap:10px;' +
        'padding:6px 16px;border-radius:8px;' +
        'background:rgba(14,17,23,0.85);border:1px solid rgba(46,207,176,0.4);' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
        'font-size:12px;color:#2ECFB0;backdrop-filter:blur(8px);' +
      '}' +
      '#' + BANNER_ID + ' .fp-key{' +
        'background:rgba(255,255,255,0.1);padding:1px 6px;border-radius:3px;' +
        'font-family:monospace;font-size:11px;color:rgba(255,255,255,0.6);' +
        'border:1px solid rgba(255,255,255,0.15);' +
      '}';

    document.head.appendChild(style);
    el.innerHTML =
      '🚶 First-Person Mode — ' +
      '<span class="fp-key">WASD</span> move ' +
      '<span class="fp-key">Q</span><span class="fp-key">E</span> up/down ' +
      '<span class="fp-key">Shift</span> sprint ' +
      '<span class="fp-key">G</span> or <span class="fp-key">ESC</span> exit';

    document.body.appendChild(el);
  }

  function hideBanner() {
    var el = document.getElementById(BANNER_ID);
    if (el) el.style.display = 'none';
  }

  // ========================================================
  // UI — SETTINGS PANEL (floating, like WEA)
  // ========================================================

  function createPanel() {
    if (panelCreated) return;
    panelCreated = true;

    var panel = document.createElement('div');
    panel.id = PANEL_ID;

    var style = document.createElement('style');
    style.textContent =
      '#' + PANEL_ID + '{' +
        'position:fixed;bottom:60px;right:12px;z-index:400;' +
        'width:260px;background:rgba(21,25,33,0.92);backdrop-filter:blur(8px);' +
        'border:1px solid rgba(255,255,255,0.08);border-radius:10px;' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
        'display:none;overflow:hidden;' +
      '}' +
      '#' + PANEL_ID + '.visible{display:block;}' +
      '#' + PANEL_ID + ' .fp-header{' +
        'display:flex;align-items:center;justify-content:space-between;' +
        'padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.06);' +
        'cursor:move;' +
      '}' +
      '#' + PANEL_ID + ' .fp-title{font-size:12px;font-weight:600;color:rgba(255,255,255,0.8);}' +
      '#' + PANEL_ID + ' .fp-body{padding:10px 12px;}' +
      '#' + PANEL_ID + ' .fp-row{' +
        'display:flex;align-items:center;justify-content:space-between;' +
        'margin:6px 0;font-size:11px;color:rgba(255,255,255,0.5);' +
      '}' +
      '#' + PANEL_ID + ' .fp-row input[type="range"]{width:100px;accent-color:#2ECFB0;}' +
      '#' + PANEL_ID + ' .fp-row input[type="checkbox"]{accent-color:#2ECFB0;}' +
      '#' + PANEL_ID + ' .fp-row input[type="number"]{' +
        'width:50px;padding:2px 4px;background:rgba(255,255,255,0.05);' +
        'border:1px solid rgba(255,255,255,0.1);border-radius:4px;' +
        'color:rgba(255,255,255,0.8);font-size:11px;text-align:right;' +
      '}' +
      '#' + PANEL_ID + ' .fp-val{' +
        'min-width:28px;text-align:right;font-family:monospace;font-size:10px;color:rgba(255,255,255,0.4);' +
      '}' +
      '#fpGamepadStatus{font-size:10px;padding:4px 0;}';

    document.head.appendChild(style);

    panel.innerHTML =
      '<div class="fp-header">' +
        '<span class="fp-title">🚶 First-Person Settings</span>' +
        '<div>' +
          '<button style="background:none;border:none;color:rgba(255,255,255,0.5);cursor:pointer;font-size:14px;padding:0 4px;" onclick="BimFirstPerson.togglePanel()" title="Close">✕</button>' +
        '</div>' +
      '</div>' +
      '<div class="fp-body">' +
        '<div class="fp-row"><label>Speed</label><input type="range" id="fpSpeed" min="1" max="50" value="' + config.moveSpeed + '" oninput="BimFirstPerson.setMoveSpeed(+this.value)"><span class="fp-val" id="fpSpeedVal">' + config.moveSpeed + '</span></div>' +
        '<div class="fp-row"><label>Sensitivity</label><input type="range" id="fpSens" min="1" max="100" value="50" oninput="BimFirstPerson.setSensitivity(+this.value)"><span class="fp-val" id="fpSensVal">50</span></div>' +
        '<div class="fp-row"><label>Eye Height</label><input type="number" id="fpEyeH" min="0.5" max="10" step="0.1" value="' + config.eyeHeight + '" onchange="BimFirstPerson.setEyeHeight(+this.value)"><span style="font-size:10px;color:rgba(255,255,255,0.3);">m</span></div>' +
        '<div class="fp-row"><label>Terrain Clamp</label><input type="checkbox" id="fpClamp" ' + (config.terrainClamp ? 'checked' : '') + ' onchange="BimFirstPerson.setTerrainClamp(this.checked)"></div>' +
        '<div id="fpGamepadStatus"></div>' +
      '</div>';

    document.body.appendChild(panel);

    // Make draggable
    if (BimViewer && typeof BimViewer.makeFloatingPanelDraggable === 'function') {
      BimViewer.makeFloatingPanelDraggable(panel, panel.querySelector('.fp-header'));
    }
  }

  function togglePanel() {
    createPanel();
    var p = document.getElementById(PANEL_ID);
    if (p) p.classList.toggle('visible');
    panelVisible = p && p.classList.contains('visible');
  }

  function updatePanelState() {
    // Update toggle button if in panel
    var el = document.getElementById('fpActiveIndicator');
    if (el) el.textContent = active ? '● Active' : '○ Inactive';
  }

  // ========================================================
  // PUBLIC API SETTERS
  // ========================================================

  function setMoveSpeed(v) {
    config.moveSpeed = v;
    var el = document.getElementById('fpSpeedVal');
    if (el) el.textContent = v;
  }

  function setSensitivity(v) {
    config.mouseSensitivity = v / 10000;
    var el = document.getElementById('fpSensVal');
    if (el) el.textContent = v;
  }

  function setEyeHeight(v) {
    config.eyeHeight = clamp(v, 0.5, 10);
  }

  function setTerrainClamp(v) {
    config.terrainClamp = !!v;
  }

  // ========================================================
  // INIT
  // ========================================================

  function init() {
    if (!getViewer()) { setTimeout(init, 500); return; }
    setupGamepad();
    initTouch();
    console.log('✅ First-Person module ready (press G to activate)');
  }

  if (document.readyState === 'complete') init();
  else window.addEventListener('load', function() { setTimeout(init, 1000); });

  // ========================================================
  // PUBLIC API
  // ========================================================

  window.BimFirstPerson = {
    toggle: toggle,
    activate: activate,
    deactivate: deactivate,
    togglePanel: togglePanel,
    isActive: function() { return active; },
    setMoveSpeed: setMoveSpeed,
    setSensitivity: setSensitivity,
    setEyeHeight: setEyeHeight,
    setTerrainClamp: setTerrainClamp,
    config: config
  };

})();
