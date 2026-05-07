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
// Tested with CesiumJS 1.141
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
  var lastCollisionCheck = 0;
  var lastCollisionResult = { forward: true, right: true };
  var COLLISION_INTERVAL = 150; // ms — check collision ~7x/sec (balance: fluidity vs GPU cost)

  var keys = {
    forward: false, backward: false, left: false, right: false,
    up: false, down: false, sprint: false
  };

  var look = { heading: 0, pitch: 0 };

  var velocity = { forward: 0, right: 0, up: 0 };

  var gamepad = { index: -1, lastA: false };

  // ========================================================
  // CONFIG
  // ========================================================

  var config = {
    moveSpeed: 4.0,              // direct speed (like original repo: 8.0)
    sprintMultiplier: 3.0,
    mouseSensitivity: 0.003,
    eyeHeight: 1.7,
    terrainClamp: true,
    tileClampInterval: 300,      // ms — pickFromRay for 3D tiles (~3x/sec)
    gamepadMoveSpeed: 6.0,       // direct gamepad speed
    gamepadSensitivity: 0.025,
    gamepadDeadzone: 0.15,
    collision: false,            // off by default — causes stutter
    collisionRadius: 0.35
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

    // Focus canvas and request pointer lock (desktop only)
    try { viewer.scene.canvas.focus(); } catch (_) {}
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

    // Restore default orbit controls (always re-enable everything)
    var ctrl = viewer.scene.screenSpaceCameraController;
    ctrl.enableRotate = true;
    ctrl.enableTranslate = true;
    ctrl.enableZoom = true;
    ctrl.enableTilt = true;
    ctrl.enableLook = true;
    savedController = null;

    // Exit pointer lock
    if (document.pointerLockElement === viewer.scene.canvas) {
      try { document.exitPointerLock(); } catch (_) {}
    }

    // Remove per-frame update
    if (preRenderListener) {
      preRenderListener();
      preRenderListener = null;
    }

    // Reset keys & velocity
    keys.forward = keys.backward = keys.left = keys.right = keys.up = keys.down = keys.sprint = false;
    velocity.forward = velocity.right = velocity.up = 0;

    // UI
    hideCrosshair();
    hideBanner();
    updatePanelState();

    // Update bottom toolbar walk button
    var walkBtn = document.getElementById('bottomWalkBtn');
    if (walkBtn) walkBtn.classList.remove('active');

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
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON') return;

    var k = e.key.toLowerCase();

    // Toggle shortcut (always active)
    if (k === 'g' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      toggle();
      return;
    }

    if (!active) return;

    // ESC to exit — deactivate third-person first if active
    if (k === 'escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (window.BimThirdPerson && BimThirdPerson.isActive()) {
        BimThirdPerson.deactivate();
      }
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
    // In third-person, thirdperson.js handles mouse orbit
    if (window.BimThirdPerson && BimThirdPerson.isActive()) return;
    if (document.pointerLockElement !== viewer.scene.canvas) return;

    look.heading += e.movementX * config.mouseSensitivity;
    look.pitch -= e.movementY * config.mouseSensitivity;
    look.pitch = clamp(look.pitch, -Math.PI * 0.49, Math.PI * 0.49);

    viewer.camera.setView({
      orientation: { heading: look.heading, pitch: look.pitch, roll: 0 }
    });
  });

  // Re-acquire pointer lock on click while active (1st person only)
  document.addEventListener('click', function() {
    var viewer = getViewer();
    if (!active || !viewer || isMobile()) return;
    if (window.BimThirdPerson && BimThirdPerson.isActive()) return;
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

  // Gamepad input targets (analog, -1 to +1)
  var gpInput = { forward: 0, right: 0, up: 0, lookX: 0, lookY: 0, sprint: false };

  function processGamepad() {
    if (gamepad.index < 0) return;
    var gps = navigator.getGamepads ? navigator.getGamepads() : [];
    var gp = gps[gamepad.index];
    if (!gp || !gp.connected) return;

    // A button = toggle first person
    var aPressed = gp.buttons[0] && gp.buttons[0].pressed;
    if (aPressed && !gamepad.lastA) toggle();
    gamepad.lastA = aPressed;

    if (!active) return;

    // Read all axes and buttons into input state
    gpInput.forward = -deadzone(gp.axes[1] || 0);   // stick forward = negative Y
    gpInput.right   = deadzone(gp.axes[0] || 0);
    gpInput.lookX   = deadzone(gp.axes[2] || 0);
    gpInput.lookY   = deadzone(gp.axes[3] || 0);

    var leftTrig  = gp.buttons[6] ? gp.buttons[6].value : 0;
    var rightTrig = gp.buttons[7] ? gp.buttons[7].value : 0;
    gpInput.up = rightTrig - leftTrig;

    gpInput.sprint = !!(gp.buttons[10] && gp.buttons[10].pressed);
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
  // COLLISION DETECTION
  // ========================================================
  //
  // Approach:
  //   - Fan of rays in movement direction (center + spread) for narrow openings
  //   - Adaptive collision radius based on velocity (anti-tunneling)
  //   - Downward ray ahead of movement to detect floor edges
  //

  var _ray = new Cesium.Ray();
  var _dir = new Cesium.Cartesian3();
  var _tmpV = new Cesium.Cartesian3();
  var _edgeCheckDropThreshold = 2.0; // meters — drop larger than this blocks movement

  // Local "up" at camera position (normalized position on ellipsoid)
  function localUp(viewer) {
    return Cesium.Cartesian3.normalize(viewer.camera.position, new Cesium.Cartesian3());
  }

  // Project a direction onto the horizontal plane (remove vertical component)
  function horizontalize(dir, up, out) {
    var d = Cesium.Cartesian3.dot(dir, up);
    var vert = Cesium.Cartesian3.multiplyByScalar(up, d, new Cesium.Cartesian3());
    Cesium.Cartesian3.subtract(dir, vert, out);
    if (Cesium.Cartesian3.magnitudeSquared(out) < 0.0001) return false;
    Cesium.Cartesian3.normalize(out, out);
    return true;
  }

  // Rotate a horizontal direction around `up` by `angle` radians
  function rotateAroundUp(dir, up, angle, out) {
    var cosA = Math.cos(angle);
    var sinA = Math.sin(angle);
    // Rodrigues' rotation: v*cos + (up×v)*sin + up*(up·v)*(1-cos)
    var cross = Cesium.Cartesian3.cross(up, dir, new Cesium.Cartesian3());
    Cesium.Cartesian3.multiplyByScalar(dir, cosA, out);
    Cesium.Cartesian3.multiplyByScalar(cross, sinA, _tmpV);
    Cesium.Cartesian3.add(out, _tmpV, out);
  }

  // Single ray check — returns distance to hit, or Infinity
  // Ignores hits closer than 0.15m (self-intersection with floor/ceiling/terrain)
  function rayDist(viewer, origin, direction) {
    Cesium.Cartesian3.clone(origin, _ray.origin);
    Cesium.Cartesian3.clone(direction, _ray.direction);
    var result = viewer.scene.pickFromRay(_ray);
    if (!result || !result.position) return Infinity;
    var dist = Cesium.Cartesian3.distance(origin, result.position);
    return dist < 0.15 ? Infinity : dist;
  }

  // Check collision before moving; returns false if blocked
  // Forward and right are checked independently with separate throttle timestamps.
  var _lastCollisionFwd = 0;
  var _lastCollisionRight = 0;

  function canMove(viewer, moveFunc, amount, currentSpeed) {
    if (!config.collision || amount === 0) return true;
    if (moveFunc === 'moveUp') return true;

    // Per-axis throttle: each direction has its own timer
    var now = Date.now();
    var isFwd = moveFunc === 'moveForward';
    var lastCheck = isFwd ? _lastCollisionFwd : _lastCollisionRight;
    if (now - lastCheck < COLLISION_INTERVAL) {
      return isFwd ? lastCollisionResult.forward : lastCollisionResult.right;
    }
    if (isFwd) _lastCollisionFwd = now; else _lastCollisionRight = now;

    var cam = viewer.camera;
    var up = localUp(viewer);

    // Build base direction from move type
    if (isFwd) {
      Cesium.Cartesian3.clone(cam.direction, _dir);
      if (amount < 0) Cesium.Cartesian3.negate(_dir, _dir);
    } else if (moveFunc === 'moveRight') {
      Cesium.Cartesian3.clone(cam.right, _dir);
      if (amount < 0) Cesium.Cartesian3.negate(_dir, _dir);
    } else {
      return true;
    }

    // Project onto horizontal plane
    if (!horizontalize(_dir, up, _dir)) return true;

    // Collision radius
    var radius = config.collisionRadius;

    // --- Single horizontal ray at chest height (eye - 0.4m) ---
    // Minimal GPU cost: 1 ray per axis per check (~7x/sec)
    var eyePos = cam.position;
    var chestDrop = 0.4;
    var chestOffset = Cesium.Cartesian3.multiplyByScalar(up, -chestDrop, new Cesium.Cartesian3());
    var chestPos = Cesium.Cartesian3.add(eyePos, chestOffset, new Cesium.Cartesian3());

    var blocked = false;
    var d = rayDist(viewer, chestPos, _dir);
    if (d < radius) blocked = true;

    if (blocked) {
      if (isFwd) lastCollisionResult.forward = false;
      else lastCollisionResult.right = false;
      return false;
    }

    // --- Edge detection: downward ray 0.8m ahead of movement direction ---
    if (config.terrainClamp) {
      var ahead = new Cesium.Cartesian3();
      Cesium.Cartesian3.multiplyByScalar(_dir, 0.8, ahead);
      Cesium.Cartesian3.add(eyePos, ahead, ahead);

      var negUp = Cesium.Cartesian3.negate(up, new Cesium.Cartesian3());
      var floorDist = rayDist(viewer, ahead, negUp);

      if (isFinite(floorDist) && floorDist > config.eyeHeight + _edgeCheckDropThreshold) {
        if (isFwd) lastCollisionResult.forward = false;
        else lastCollisionResult.right = false;
        return false;
      }
    }

    if (isFwd) lastCollisionResult.forward = true;
    else lastCollisionResult.right = true;
    return true;
  }

  // ========================================================
  // PER-FRAME UPDATE
  // ========================================================

  function update() {
    processGamepad();
    if (!active) return;

    var viewer = getViewer();
    if (!viewer) return;

    // --- Merge keyboard + gamepad into one target per axis ---
    // Keyboard: digital (-1, 0, +1). Gamepad: analog (-1..+1).
    // Take whichever has larger magnitude.
    var kbFwd = 0, kbRight = 0, kbUp = 0;
    if (keys.forward)  kbFwd += 1;
    if (keys.backward) kbFwd -= 1;
    if (keys.left)     kbRight -= 1;
    if (keys.right)    kbRight += 1;
    if (keys.up)       kbUp += 1;
    if (keys.down)     kbUp -= 1;

    var targetFwd   = Math.abs(gpInput.forward) > Math.abs(kbFwd)   ? gpInput.forward : kbFwd;
    var targetRight = Math.abs(gpInput.right)   > Math.abs(kbRight) ? gpInput.right   : kbRight;
    var targetUp    = Math.abs(gpInput.up)       > Math.abs(kbUp)    ? gpInput.up      : kbUp;

    var isSprint = keys.sprint || gpInput.sprint;
    var speed = config.moveSpeed * (isSprint ? config.sprintMultiplier : 1.0);

    // Direct input — no velocity lerp (like original cesiumfirstperson repo)
    velocity.forward = targetFwd;
    velocity.right   = targetRight;
    velocity.up      = targetUp;

    // --- Gamepad right stick → look (1st person only) ---
    var isTP = window.BimThirdPerson && BimThirdPerson.isActive();
    if (!isTP && (gpInput.lookX !== 0 || gpInput.lookY !== 0)) {
      look.heading += gpInput.lookX * config.gamepadSensitivity;
      look.pitch += gpInput.lookY * config.gamepadSensitivity;
      look.pitch = clamp(look.pitch, -Math.PI * 0.49, Math.PI * 0.49);
      viewer.camera.setView({
        orientation: { heading: look.heading, pitch: look.pitch, roll: 0 }
      });
    }

    // In third-person: only calculate velocity, don't move camera
    if (isTP) return;

    // --- Apply movement to camera (1st person only) ---
    // Direct movement like original cesiumfirstperson repo — no collision gate
    if (velocity.forward !== 0) viewer.camera.moveForward(velocity.forward * speed);
    if (velocity.right !== 0)   viewer.camera.moveRight(velocity.right * speed);
    if (velocity.up !== 0)      viewer.camera.moveUp(velocity.up * speed);

    // Terrain clamping (cheap globe.getHeight + throttled pickFromRay for 3D tiles)
    if (config.terrainClamp) {
      clampToTerrain(viewer);
    }
  }

  // ========================================================
  // TERRAIN CLAMPING
  // ========================================================
  //
  // Two-tier approach:
  //   1. globe.getHeight() every frame — FREE, already computed for rendering
  //   2. pickFromRay() for 3D tiles — EXPENSIVE, throttled to ~3x/sec
  //

  var _clampRay = new Cesium.Ray();
  var _lastTileClamp = 0;
  var _tileFloorHeight = null;

  function clampToTerrain(viewer) {
    var carto = Cesium.Cartographic.fromCartesian(viewer.camera.position);

    // --- Tier 1: globe.getHeight() — free, every frame ---
    var globeH = viewer.scene.globe.getHeight(carto);
    var bestFloor = (globeH !== undefined && isFinite(globeH)) ? globeH : terrainHeight;

    // --- Tier 2: pickFromRay for 3D tiles — throttled ---
    var now = Date.now();
    if (now - _lastTileClamp > config.tileClampInterval) {
      _lastTileClamp = now;
      var up = localUp(viewer);
      var down = Cesium.Cartesian3.negate(up, new Cesium.Cartesian3());
      Cesium.Cartesian3.clone(viewer.camera.position, _clampRay.origin);
      Cesium.Cartesian3.clone(down, _clampRay.direction);
      var result = viewer.scene.pickFromRay(_clampRay);
      if (result && result.position) {
        var hitCarto = Cesium.Cartographic.fromCartesian(result.position);
        if (isFinite(hitCarto.height)) {
          _tileFloorHeight = hitCarto.height;
        }
      }
    }
    if (_tileFloorHeight !== null && _tileFloorHeight > bestFloor) {
      bestFloor = _tileFloorHeight;
    }

    terrainHeight = bestFloor;

    // Enforce minimum height — smooth lerp to ground
    var targetH = terrainHeight + config.eyeHeight;
    var diff = targetH - carto.height;
    if (diff > 0) {
      var newH = (diff < 0.05) ? targetH : carto.height + diff * 0.5;
      viewer.camera.position = Cesium.Cartesian3.fromRadians(
        carto.longitude, carto.latitude, newH
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
        '<div class="fp-row"><label>Speed</label><input type="range" id="fpSpeed" min="1" max="20" step="0.5" value="' + config.moveSpeed + '" oninput="BimFirstPerson.setMoveSpeed(+this.value)"><span class="fp-val" id="fpSpeedVal">' + config.moveSpeed + '</span></div>' +
        '<div class="fp-row"><label>Sensitivity</label><input type="range" id="fpSens" min="1" max="100" value="30" oninput="BimFirstPerson.setSensitivity(+this.value)"><span class="fp-val" id="fpSensVal">30</span></div>' +
        '<div class="fp-row"><label>Eye Height</label><input type="number" id="fpEyeH" min="0.5" max="10" step="0.1" value="' + config.eyeHeight + '" onchange="BimFirstPerson.setEyeHeight(+this.value)"><span style="font-size:10px;color:rgba(255,255,255,0.3);">m</span></div>' +
        '<div class="fp-row"><label>Terrain Clamp</label><input type="checkbox" id="fpClamp" ' + (config.terrainClamp ? 'checked' : '') + ' onchange="BimFirstPerson.setTerrainClamp(this.checked)"></div>' +
        '<div class="fp-row"><label>Wall Collision</label><input type="checkbox" id="fpCollision" ' + (config.collision ? 'checked' : '') + ' onchange="BimFirstPerson.setCollision(this.checked)"></div>' +
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

  function setCollision(v) {
    config.collision = !!v;
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
    setCollision: setCollision,
    config: config,
    velocity: velocity,
    gpInput: gpInput,
    isSprinting: function() { return keys.sprint || gpInput.sprint; },
    canMove: canMove,
    clampToTerrain: clampToTerrain
  };

})();
