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
//
// Animation approach from Cesium Sandcastle "3D Models — Animation":
//   Model as Primitive, activeAnimations with animationTime callback,
//   modelMatrix updated via rotationMatrixFromPositionVelocity.
//   Clock multiplier is NEVER touched — animation is distance-driven.
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
  var CAM_BEHIND = 1.8;           // meters behind character
  var CAM_ABOVE = 1.0;            // pivot at head height
  var MIN_DISTANCE = 1.5;
  var MAX_DISTANCE = 15.0;

  // Character Movement
  var WALK_SPEED = 0.10;          // meters/frame at 60fps ≈ 6 m/s
  var SPRINT_MULTIPLIER = 2.5;
  var ANIM_STRIDE_LENGTH = 4.0;   // meters per walk cycle — higher = slower step frequency

  // Rotation (Unreal: RotationRate=(0,540,0), OrientRotationToMovement=true)
  var ROTATION_RATE = 0.50;       // lerp factor per frame — snappy turn toward movement

  // ========================================================
  // STATE
  // ========================================================

  var active = false;
  var modelPrimitive = null;       // Cesium.Model (Primitive API)
  var trackingEntity = null;       // lightweight Entity for trackedEntity camera follow
  var charLon = 0;
  var charLat = 0;
  var charHeight = 0;
  var characterHeading = 0;
  var orbitHeading = 0;
  var orbitDistance = CAM_BEHIND;
  var preRenderListener = null;
  var lastTileClampTime = 0;
  var lastTileHeight = null;
  var totalDistance = 0;            // cumulative distance traveled (drives animation)

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
  // MODEL — Primitive API with distance-driven animation
  // ========================================================

  var _rotation = new Cesium.Matrix3();

  function createModel(viewer) {
    removeModel(viewer);
    totalDistance = 0;

    var pos = Cesium.Cartesian3.fromRadians(charLon, charLat, charHeight);
    console.log('🏃 Loading character at', Cesium.Math.toDegrees(charLon).toFixed(5), Cesium.Math.toDegrees(charLat).toFixed(5), 'h=' + charHeight.toFixed(1));

    // Load as Primitive (not Entity) — gives us activeAnimations + animationTime
    Cesium.Model.fromGltfAsync({
      url: MODEL_URL,
      scale: 1.3,
      minimumPixelSize: 64
    }).then(function(model) {
      if (!active) { return; } // deactivated while loading
      modelPrimitive = model;
      viewer.scene.primitives.add(model);

      model.readyEvent.addEventListener(function() {
        // Start all animations with distance-driven timing
        model.activeAnimations.addAll({
          loop: Cesium.ModelAnimationLoop.REPEAT,
          animationTime: function(duration) {
            // Map cumulative distance to animation time
            // duration = total animation length in seconds
            // ANIM_STRIDE_LENGTH = meters per full cycle
            return (totalDistance / ANIM_STRIDE_LENGTH) * duration;
          },
          multiplier: 1.0
        });
        console.log('🏃 Character model ready, distance-driven animation active');
      });

      // Set initial modelMatrix
      updateModelMatrix();

      // Create lightweight tracking entity for camera follow
      trackingEntity = viewer.entities.add({
        position: pos,
        point: { pixelSize: 1, color: Cesium.Color.TRANSPARENT }
      });

      // Position camera and start update loop
      var camRange = Math.sqrt(CAM_BEHIND * CAM_BEHIND + CAM_ABOVE * CAM_ABOVE);
      var camPitch = -Math.atan2(CAM_ABOVE, CAM_BEHIND);

      viewer.zoomTo(trackingEntity, new Cesium.HeadingPitchRange(
        characterHeading, camPitch, camRange
      )).then(function() {
        if (!active) return;
        viewer.trackedEntity = trackingEntity;
        preRenderListener = viewer.scene.preRender.addEventListener(update);
        console.log('🏃 Camera locked to character, update loop started');
      });
    }).catch(function(err) {
      console.error('Failed to load character model:', err);
    });

    updateBanner(true);
    console.log('🏃 Third-Person activated (V = 1st person, G/ESC = exit)');
  }

  function removeModel(viewer) {
    if (modelPrimitive) {
      viewer.scene.primitives.remove(modelPrimitive);
      modelPrimitive = null;
    }
    if (trackingEntity) {
      viewer.entities.remove(trackingEntity);
      trackingEntity = null;
    }
  }

  function updateModelMatrix() {
    if (!modelPrimitive) return;
    var pos = Cesium.Cartesian3.fromRadians(charLon, charLat, charHeight);

    // Build rotation from heading (like Sandcastle: rotationMatrixFromPositionVelocity)
    // We have heading, not velocity vector, so build ENU rotation manually
    var hpr = new Cesium.HeadingPitchRoll(characterHeading - Math.PI / 2, 0, 0);
    var modelMatrix = Cesium.Transforms.headingPitchRollToFixedFrame(
      pos, hpr, Cesium.Ellipsoid.WGS84,
      Cesium.Transforms.localFrameToFixedFrameGenerator('east', 'north')
    );
    // Apply scale
    var scale = Cesium.Matrix4.fromUniformScale(1.3);
    Cesium.Matrix4.multiply(modelMatrix, scale, modelMatrix);
    modelPrimitive.modelMatrix = modelMatrix;

    // Update tracking entity position for camera follow
    if (trackingEntity) {
      trackingEntity.position = pos;
    }
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
    totalDistance = 0;

    var ch = document.getElementById('fpCrosshair');
    if (ch) ch.style.display = 'none';

    // Exit pointer lock first, then enable orbit controls after lock is fully released
    if (document.pointerLockElement) {
      try { document.exitPointerLock(); } catch (_) {}
    }

    // Delay enabling SSCC to avoid setPointerCapture conflict with pointer lock release
    setTimeout(function() {
      var ctrl = viewer.scene.screenSpaceCameraController;
      ctrl.enableRotate = true;
      ctrl.enableZoom = true;
      ctrl.enableTilt = true;
    }, 100);

    createModel(viewer);
  }

  function deactivate() {
    var viewer = getViewer();
    if (!viewer || !active) return;

    active = false;

    // No clock multiplier manipulation needed — we never touch it

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

  function update() {
    var viewer = getViewer();
    var fp = getFP();
    if (!viewer || !fp || !active || !modelPrimitive) return;

    var vel = fp.velocity;
    var isSprint = fp.isSprinting && fp.isSprinting();
    var speed = WALK_SPEED * (isSprint ? SPRINT_MULTIPLIER : 1.0);

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
      var diff = worldHeading - characterHeading;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      characterHeading += diff * ROTATION_RATE;

      // Move in character's facing direction
      var moveMag = Math.min(Math.sqrt(fwd * fwd + right * right), 1.0);
      var dist = moveMag * speed;

      // Collision check: single chest-height ray + edge detection
      var blocked = false;
      if (fp.config.collision) {
        var charCartesian = Cesium.Cartesian3.fromRadians(charLon, charLat, charHeight + 1.0);
        var enuMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(charCartesian);
        var localMoveDir = new Cesium.Cartesian3(
          Math.sin(characterHeading),
          Math.cos(characterHeading),
          0
        );
        var moveDir3D = Cesium.Matrix4.multiplyByPointAsVector(enuMatrix, localMoveDir, new Cesium.Cartesian3());
        Cesium.Cartesian3.normalize(moveDir3D, moveDir3D);

        var ray = new Cesium.Ray(charCartesian, moveDir3D);
        var hit = viewer.scene.pickFromRay(ray);
        if (hit && hit.position) {
          var hitDist = Cesium.Cartesian3.distance(charCartesian, hit.position);
          if (hitDist > 0.15 && hitDist < 0.35 + dist) {
            blocked = true;
          }
        }

        // Edge detection: downward ray 0.8m ahead
        if (!blocked) {
          var localUp = Cesium.Cartesian3.normalize(charCartesian, new Cesium.Cartesian3());
          var aheadOffset = Cesium.Cartesian3.multiplyByScalar(moveDir3D, 0.8, new Cesium.Cartesian3());
          var aheadPos = Cesium.Cartesian3.add(charCartesian, aheadOffset, new Cesium.Cartesian3());
          var downDir = Cesium.Cartesian3.negate(localUp, new Cesium.Cartesian3());
          var edgeRay = new Cesium.Ray(aheadPos, downDir);
          var edgeHit = viewer.scene.pickFromRay(edgeRay);
          if (edgeHit && edgeHit.position) {
            var floorDist = Cesium.Cartesian3.distance(aheadPos, edgeHit.position);
            if (floorDist > 3.0) blocked = true;
          }
        }
      }

      if (!blocked) {
        var R = 6378137.0;
        charLat += (dist * Math.cos(characterHeading)) / R;
        charLon += (dist * Math.sin(characterHeading)) / (R * Math.cos(charLat));
        // Accumulate distance for animation
        totalDistance += dist;
      }
    }

    // --- 3. Floor clamping (terrain + throttled 3D tile raycast) ---
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

    // 3D tile raycast (throttled ~8x/sec)
    var now = Date.now();
    if (now - lastTileClampTime > 120) {
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

    // Smooth height transition
    var heightDiff = bestFloor - charHeight;
    if (Math.abs(heightDiff) < 0.02) {
      charHeight = bestFloor;
    } else {
      charHeight += heightDiff * 0.5;
    }

    // --- 4. Update model + tracking entity ---
    updateModelMatrix();

    // --- 5. Ensure tracked ---
    if (trackingEntity && viewer.trackedEntity !== trackingEntity) {
      viewer.trackedEntity = trackingEntity;
    }

    // --- 6. Gamepad right stick → orbit camera around character ---
    var gpIn = fp.gpInput;
    if (gpIn) {
      if (gpIn.lookX !== 0) {
        viewer.camera.rotateRight(gpIn.lookX * 0.02);
      }
      if (gpIn.lookY !== 0) {
        viewer.camera.rotateUp(gpIn.lookY * 0.02);
      }
    }

    // Animation is driven by totalDistance via animationTime callback — no clock manipulation needed
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

    // T = set Player Start (spawn point picker) — works in FP, 3P, and normal orbit
    if (k === 't' && !e.ctrlKey && !e.altKey && !e.metaKey && !spawnPickerActive) {
      e.preventDefault();
      e.stopImmediatePropagation();
      // If in third-person, deactivate first so user can click surfaces
      if (active) deactivate();
      // Exit pointer lock if in first-person so user can click
      if (document.pointerLockElement) {
        try { document.exitPointerLock(); } catch (_) {}
      }
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
