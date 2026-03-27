// ============================================================
// Third-Person Navigation Module for geobim.app
//
// Copyright (c) 2026 geobim.app
// Licensed under the Business Source License 1.1 (BSL 1.1)
// Change Date: 2030-03-01 | Change License: MIT
// See LICENSE file for full terms.
//
// Shortcut: V to toggle between 1st and 3rd person
// Requires firstperson.js (provides velocity + input).
// Uses camera.lookAtTransform() as spring-arm equivalent.
//
// Tuned to match Unreal Engine third-person defaults:
//   Spring Arm: 300cm, Camera Lag off
//   Max Walk Speed: 600 cm/s, Braking Deceleration: 2048 cm/s²
//   Rotation Rate: 540°/s, Orient Rotation to Movement: true
// ============================================================

(function() {
  'use strict';

  // ========================================================
  // CONFIG — Unreal Engine defaults converted to meters
  // ========================================================

  var MODEL_URL = 'model/Cesium_Man.glb';

  // Camera offset (Unreal: TargetArmLength=300, CapsuleHalfHeight=96cm)
  var CAM_BEHIND = 3.0;           // meters behind character (300cm)
  var CAM_ABOVE = 1.7;            // pivot at head height (170cm)
  var MIN_DISTANCE = 1.5;
  var MAX_DISTANCE = 15.0;

  // Character Movement — tuned to match Cesium_Man walk animation
  var WALK_SPEED = 0.023;         // meters/frame at 60fps ≈ 1.4 m/s (5 km/h walking pace)
  var SPRINT_MULTIPLIER = 2.5;    // sprint ≈ 3.5 m/s (12 km/h jog)
  var BRAKING = 0.18;             // deceleration factor (higher = snappier stop, Unreal: 2048cm/s²)

  // Rotation (Unreal: RotationRate=(0,540,0), OrientRotationToMovement=true)
  var ROTATION_RATE = 0.35;       // lerp factor per frame — snappy turn toward movement
  var MODEL_HEADING_OFFSET = -Math.PI / 2; // GLB model faces +X, Cesium heading 0 = North (+Y)

  // ========================================================
  // STATE
  // ========================================================

  var active = false;
  var modelPrimitive = null;
  var charLon = 0;
  var charLat = 0;
  var charHeight = 0;
  var characterHeading = 0;
  var orbitHeading = 0;
  var orbitDistance = CAM_BEHIND;
  var charVelFwd = 0;
  var charVelRight = 0;
  var preRenderListener = null;
  var lastTileClampTime = 0;
  var lastTileHeight = null;

  // Player Start (spawn point)
  var spawnSet = false;
  var spawnLon = 0;
  var spawnLat = 0;
  var spawnHeight = 0;
  var spawnHeading = 0;
  var spawnPickerActive = false;
  var spawnMarker = null;

  // ========================================================
  // HELPERS
  // ========================================================

  function getViewer() { return window.BimViewer && BimViewer.viewer; }
  function getFP() { return window.BimFirstPerson; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ========================================================
  // MODEL
  // ========================================================

  var characterEntity = null;

  function createModel(viewer) {
    removeModel(viewer);

    var pos = Cesium.Cartesian3.fromRadians(charLon, charLat, charHeight);
    console.log('🏃 Loading character at', Cesium.Math.toDegrees(charLon).toFixed(5), Cesium.Math.toDegrees(charLat).toFixed(5), 'h=' + charHeight.toFixed(1));

    characterEntity = viewer.entities.add({
      position: pos,
      orientation: Cesium.Transforms.headingPitchRollQuaternion(
        pos, new Cesium.HeadingPitchRoll(characterHeading + MODEL_HEADING_OFFSET, 0, 0)
      ),
      model: {
        uri: MODEL_URL,
        scale: 1.3,
        minimumPixelSize: 64,
        imageBasedLightingFactor: new Cesium.Cartesian2(1.0, 1.0)
      }
    });
    console.log('🏃 Character entity created');
  }

  function removeModel(viewer) {
    if (characterEntity) {
      viewer.entities.remove(characterEntity);
      characterEntity = null;
    }
  }

  function updateModelMatrix() {
    if (!characterEntity) return;
    var pos = Cesium.Cartesian3.fromRadians(charLon, charLat, charHeight);
    characterEntity.position = pos;
    characterEntity.orientation = Cesium.Transforms.headingPitchRollQuaternion(
      pos, new Cesium.HeadingPitchRoll(characterHeading + MODEL_HEADING_OFFSET, 0, 0)
    );
  }

  // ========================================================
  // PLAYER START (spawn point picker)
  // ========================================================

  function startSpawnPicker() {
    var viewer = getViewer();
    if (!viewer) return;

    spawnPickerActive = true;
    document.body.style.cursor = 'crosshair';
    console.log('🎯 Click any surface to set Player Start (ESC to cancel)');

    // Show banner
    var banner = document.getElementById('fpBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'fpBanner';
      banner.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:500;' +
        'display:flex;align-items:center;gap:10px;padding:6px 16px;border-radius:8px;' +
        'background:rgba(14,17,23,0.85);border:1px solid rgba(46,207,176,0.4);' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
        'font-size:12px;color:#2ECFB0;backdrop-filter:blur(8px);';
      document.body.appendChild(banner);
    }
    banner.style.display = 'flex';
    banner.innerHTML = '🎯 Player Start — Click any surface to place spawn point. <span class="fp-key">ESC</span> cancel';

    var handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction(function(click) {
      var ray = viewer.camera.getPickRay(click.position);
      var hit = viewer.scene.pickFromRay(ray);

      if (hit && hit.position) {
        var carto = Cesium.Cartographic.fromCartesian(hit.position);
        spawnLon = carto.longitude;
        spawnLat = carto.latitude;
        spawnHeight = carto.height;
        spawnHeading = viewer.camera.heading;
        spawnSet = true;

        // Place marker
        placeSpawnMarker(viewer);

        console.log('🎯 Player Start set at',
          Cesium.Math.toDegrees(spawnLon).toFixed(5),
          Cesium.Math.toDegrees(spawnLat).toFixed(5),
          'h=' + spawnHeight.toFixed(1));
      }

      // Clean up
      handler.destroy();
      spawnPickerActive = false;
      document.body.style.cursor = '';
      banner.style.display = 'none';
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction(function() {
      handler.destroy();
      spawnPickerActive = false;
      document.body.style.cursor = '';
      banner.style.display = 'none';
      console.log('🎯 Player Start cancelled');
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  }

  function placeSpawnMarker(viewer) {
    if (spawnMarker) {
      viewer.entities.remove(spawnMarker);
    }
    var pos = Cesium.Cartesian3.fromRadians(spawnLon, spawnLat, spawnHeight);
    spawnMarker = viewer.entities.add({
      position: pos,
      point: { pixelSize: 12, color: Cesium.Color.LIME, outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
               disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: { text: 'Player Start', font: '11px sans-serif', fillColor: Cesium.Color.LIME,
               style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineWidth: 2, outlineColor: Cesium.Color.BLACK,
               verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -12),
               disableDepthTestDistance: Number.POSITIVE_INFINITY }
    });
  }

  // ========================================================
  // ACTIVATE / DEACTIVATE
  // ========================================================

  function activate() {
    var viewer = getViewer();
    var fp = getFP();
    if (!viewer || !fp || active) return;

    if (!fp.isActive()) fp.activate();
    active = true;

    // Spawn at Player Start if set, otherwise at camera position
    if (spawnSet) {
      charLon = spawnLon;
      charLat = spawnLat;
      charHeight = spawnHeight;
      characterHeading = spawnHeading;
      console.log('🎯 Spawning at Player Start:', Cesium.Math.toDegrees(spawnLon).toFixed(5), Cesium.Math.toDegrees(spawnLat).toFixed(5), 'h=' + spawnHeight.toFixed(1));
    } else {
      var carto = Cesium.Cartographic.fromCartesian(viewer.camera.position);
      charLon = carto.longitude;
      charLat = carto.latitude;
      charHeight = carto.height - fp.config.eyeHeight;
      characterHeading = viewer.camera.heading;
    }
    orbitHeading = characterHeading;
    orbitDistance = CAM_BEHIND;
    charVelFwd = 0;
    charVelRight = 0;

    createModel(viewer);

    // Re-enable orbit controls for third-person (FP disables them)
    var ctrl = viewer.scene.screenSpaceCameraController;
    ctrl.enableRotate = true;
    ctrl.enableZoom = true;
    ctrl.enableTilt = true;

    var ch = document.getElementById('fpCrosshair');
    if (ch) ch.style.display = 'none';

    if (document.pointerLockElement) {
      try { document.exitPointerLock(); } catch (_) {}
    }

    // Position camera behind & above character, then start update loop
    // Camera: 2m behind, 1m above → pitch = atan2(1, 2) ≈ 0.46 rad, range = sqrt(4+1) ≈ 2.24m
    var camRange = Math.sqrt(CAM_BEHIND * CAM_BEHIND + CAM_ABOVE * CAM_ABOVE);
    var camPitch = -Math.atan2(CAM_ABOVE, CAM_BEHIND);

    viewer.zoomTo(characterEntity, new Cesium.HeadingPitchRange(
      characterHeading,
      camPitch,
      camRange
    )).then(function() {
      if (!active) return;
      preRenderListener = viewer.scene.preRender.addEventListener(update);
      console.log('🏃 Camera locked to character, update loop started');
    });
    updateBanner(true);
    console.log('🏃 Third-Person activated (V = 1st person, G/ESC = exit)');
  }

  function deactivate() {
    var viewer = getViewer();
    if (!viewer || !active) return;

    active = false;

    // Stop tracking and restore FP camera controls
    viewer.trackedEntity = undefined;
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    var ctrl = viewer.scene.screenSpaceCameraController;
    ctrl.enableRotate = false;
    ctrl.enableZoom = false;
    ctrl.enableTilt = false;
    var fp = getFP();
    var eyeH = fp ? fp.config.eyeHeight : 1.7;
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromRadians(charLon, charLat, charHeight + eyeH),
      orientation: { heading: characterHeading, pitch: 0, roll: 0 }
    });

    removeModel(viewer);

    if (preRenderListener) {
      preRenderListener();
      preRenderListener = null;
    }

    var ch = document.getElementById('fpCrosshair');
    if (ch) ch.style.display = 'block';

    if (fp && fp.isActive()) {
      try { viewer.scene.canvas.requestPointerLock(); } catch (_) {}
    }

    updateBanner(false);
    console.log('🏃 Third-Person deactivated');
  }

  function toggle() { if (active) deactivate(); else activate(); }

  // ========================================================
  // PER-FRAME UPDATE
  // ========================================================

  var _frameCount = 0;

  function update() {
    var viewer = getViewer();
    var fp = getFP();
    if (!viewer || !fp || !active || !characterEntity) return;

    var vel = fp.velocity;
    var speed = WALK_SPEED;
    if (fp.config && vel) {
      var isSprint = Math.abs(vel.forward) > 0.7 || Math.abs(vel.right) > 0.7;
      if (isSprint) speed = WALK_SPEED * SPRINT_MULTIPLIER;
    }

    // --- 1. Camera forward heading ---
    var camHeading = viewer.camera.heading;

    // --- 2. Move character based on input ---
    var fwd = vel.forward;
    var right = vel.right;
    var moving = Math.abs(fwd) > 0.01 || Math.abs(right) > 0.01;

    if (moving) {
      // Movement direction relative to camera view
      var moveAngle = Math.atan2(right, fwd);
      var worldHeading = camHeading + moveAngle;

      // Character ALWAYS faces movement direction (Unreal: OrientRotationToMovement)
      // No walking backward — stick back = turn 180° and walk forward
      var diff = worldHeading - characterHeading;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      characterHeading += diff * ROTATION_RATE;

      // Move in character's facing direction (not raw input direction)
      var moveMag = Math.min(Math.sqrt(fwd * fwd + right * right), 1.0);
      var dist = moveMag * speed;

      // Collision check: raycast from character position in movement direction
      var blocked = false;
      if (fp.config.collision) {
        var charCartesian = Cesium.Cartesian3.fromRadians(charLon, charLat, charHeight + 1.0);
        var moveDir3D = new Cesium.Cartesian3();
        var enuMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(charCartesian);
        // Convert heading to ENU direction vector (east, north, up)
        var localMoveDir = new Cesium.Cartesian3(
          Math.sin(characterHeading),
          Math.cos(characterHeading),
          0
        );
        moveDir3D = Cesium.Matrix4.multiplyByPointAsVector(enuMatrix, localMoveDir, moveDir3D);
        Cesium.Cartesian3.normalize(moveDir3D, moveDir3D);

        var ray = new Cesium.Ray(charCartesian, moveDir3D);
        var hit = viewer.scene.pickFromRay(ray);
        if (hit && hit.position) {
          var hitDist = Cesium.Cartesian3.distance(charCartesian, hit.position);
          if (hitDist < 0.5 + dist) {
            blocked = true;
          }
        }
      }

      if (!blocked) {
        var R = 6378137.0;
        charLat += (dist * Math.cos(characterHeading)) / R;
        charLon += (dist * Math.sin(characterHeading)) / (R * Math.cos(charLat));
      }
    }

    // Camera follows via trackedEntity — no manual camera repositioning needed.
    // Right stick rotates camera → camHeading changes → movement direction follows.

    // --- 3. Floor clamping (terrain + throttled 3D tile raycast) ---
    // Terrain height (cheap, every frame)
    var carto = Cesium.Cartographic.fromRadians(charLon, charLat);
    var terrainH = viewer.scene.globe.getHeight(carto);
    var bestFloor = (terrainH !== undefined && isFinite(terrainH)) ? terrainH : charHeight;

    // Terrain slightly ahead in movement direction (prevents sinking on slopes)
    if (moving) {
      var aheadDist = 0.5;
      var aheadLat = charLat + (aheadDist * Math.cos(characterHeading)) / 6378137.0;
      var aheadLon = charLon + (aheadDist * Math.sin(characterHeading)) / (6378137.0 * Math.cos(charLat));
      var aheadH = viewer.scene.globe.getHeight(Cesium.Cartographic.fromRadians(aheadLon, aheadLat));
      if (aheadH !== undefined && isFinite(aheadH) && aheadH > bestFloor) {
        bestFloor = aheadH;
      }
    }

    // 3D tile raycast (expensive — throttle to ~5x/sec)
    var now = Date.now();
    if (now - lastTileClampTime > 200) {
      lastTileClampTime = now;
      var feetProbe = Cesium.Cartesian3.fromRadians(charLon, charLat, charHeight + 1.0);
      var feetUp = Cesium.Cartesian3.normalize(feetProbe, new Cesium.Cartesian3());
      var feetDown = Cesium.Cartesian3.negate(feetUp, new Cesium.Cartesian3());
      var floorRay = new Cesium.Ray(feetProbe, feetDown);
      var floorHit = viewer.scene.pickFromRay(floorRay);
      if (floorHit && floorHit.position) {
        var tileH = Cesium.Cartographic.fromCartesian(floorHit.position).height;
        if (isFinite(tileH)) {
          lastTileHeight = tileH;
        }
      }
    }
    if (lastTileHeight !== null && lastTileHeight > bestFloor) {
      bestFloor = lastTileHeight;
    }

    // Smooth height transition to avoid flickering
    var heightDiff = bestFloor - charHeight;
    if (Math.abs(heightDiff) < 0.01) {
      charHeight = bestFloor;
    } else {
      charHeight += heightDiff * 0.3;
    }

    // --- 4. Update entity ---
    updateModelMatrix();

    // --- 4. Ensure tracked ---
    if (viewer.trackedEntity !== characterEntity) {
      viewer.trackedEntity = characterEntity;
    }

    // --- 5. Gamepad right stick → orbit camera around character ---
    var gpIn = fp.gpInput;
    if (gpIn) {
      if (gpIn.lookX !== 0) {
        viewer.camera.rotateRight(gpIn.lookX * 0.02);
      }
      if (gpIn.lookY !== 0) {
        viewer.camera.rotateUp(gpIn.lookY * 0.02);
      }
    }

    // --- 6. Animation ---
    if (characterEntity.model) {
      characterEntity.model.runAnimations = moving;
    }
  }

  // ========================================================
  // MOUSE ORBIT
  // ========================================================

  document.addEventListener('mousemove', function(e) {
    if (!active) return;
    var viewer = getViewer();
    if (!viewer) return;

    var doOrbit = false;
    if (document.pointerLockElement === viewer.scene.canvas) doOrbit = true;
    else if (e.buttons & 2) doOrbit = true;

    if (doOrbit) {
      var sens = 0.005;
      viewer.camera.rotateRight(e.movementX * sens);
      viewer.camera.rotateUp(-e.movementY * sens);
    }
  });

  // Scroll = zoom spring arm
  document.addEventListener('wheel', function(e) {
    if (!active) return;
    orbitDistance = clamp(orbitDistance + e.deltaY * 0.01, MIN_DISTANCE, MAX_DISTANCE);
  }, { passive: true });

  // Click = pointer lock for smooth orbit
  document.addEventListener('click', function() {
    if (!active) return;
    var viewer = getViewer();
    if (viewer && document.pointerLockElement !== viewer.scene.canvas) {
      try { viewer.scene.canvas.requestPointerLock(); } catch (_) {}
    }
  });

  document.addEventListener('contextmenu', function(e) {
    if (active) e.preventDefault();
  });

  // ========================================================
  // KEYBOARD
  // ========================================================

  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON') return;
    var k = e.key.toLowerCase();

    // V = toggle 3rd person (while in first-person)
    if (k === 'v' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      var fp = getFP();
      if (fp && fp.isActive()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        toggle();
      }
    }

    // T = set Player Start (spawn point picker)
    if (k === 't' && !e.ctrlKey && !e.altKey && !e.metaKey && !active && !spawnPickerActive) {
      e.preventDefault();
      e.stopImmediatePropagation();
      startSpawnPicker();
    }

    // ESC = cancel spawn picker
    if (k === 'escape' && spawnPickerActive) {
      // ESC is handled by the right-click handler in startSpawnPicker
    }
  }, true);

  // ========================================================
  // BANNER
  // ========================================================

  function updateBanner(show3P) {
    var b = document.getElementById('fpBanner');
    if (!b) return;
    b.innerHTML = show3P
      ? '🏃 Third-Person Mode — ' +
        '<span class="fp-key">WASD</span> move ' +
        '<span class="fp-key">Shift</span> sprint ' +
        '<span class="fp-key">Mouse</span> orbit ' +
        '<span class="fp-key">Scroll</span> zoom ' +
        '<span class="fp-key">V</span> 1st person ' +
        '<span class="fp-key">G</span>/<span class="fp-key">ESC</span> exit'
      : '🚶 First-Person Mode — ' +
        '<span class="fp-key">WASD</span> move ' +
        '<span class="fp-key">Q</span><span class="fp-key">E</span> up/down ' +
        '<span class="fp-key">Shift</span> sprint ' +
        '<span class="fp-key">G</span> or <span class="fp-key">ESC</span> exit';
  }

  // ========================================================
  // INIT
  // ========================================================

  function init() {
    if (!getViewer() || !getFP()) { setTimeout(init, 500); return; }
    console.log('✅ Third-Person module ready (press V while in first-person)');
  }

  if (document.readyState === 'complete') init();
  else window.addEventListener('load', function() { setTimeout(init, 1500); });

  // ========================================================
  // PUBLIC API
  // ========================================================

  window.BimThirdPerson = {
    toggle: toggle,
    activate: activate,
    deactivate: deactivate,
    isActive: function() { return active; },
    setSpawn: startSpawnPicker,
    hasSpawn: function() { return spawnSet; },
    clearSpawn: function() {
      spawnSet = false;
      if (spawnMarker) {
        var viewer = getViewer();
        if (viewer) viewer.entities.remove(spawnMarker);
        spawnMarker = null;
      }
    }
  };

})();
