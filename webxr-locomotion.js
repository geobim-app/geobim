/**
 * geobim.app — VR movement (WebXR controllers), docs/WEBXR_PLAN.md phase 2
 *
 * Works on the reference frame of webxr.js (BimXR.on hooks): moving, turning
 * and teleporting only shift / rotate that frame, never the head pose.
 * Settings (BimXR.getSettings, form in webxr-settings.js): turn, speed,
 * pitch, vignette, teleport.
 *
 *   Left stick        fly where the left controller points (sideways = strafe);
 *                     speed grows with height above ground. Pitch: level
 *                     (always horizontal), deadzone (horizontal within ±15°,
 *                     beyond that climbs / sinks) or free
 *   Left grip         up      Left trigger   down (pressure = speed)
 *   Right stick ←/→   snap turn 30° / 45° or smooth, around the head
 *   Right stick ↑     aim: arc (or straight beam) from the right controller
 *                     with a marker on model or terrain; release = teleport
 *                     with a short fade to black
 *
 * Comfort patterns (Meta guidelines, Babylon.js WebXR, Google Earth VR):
 * stick dead zone 0.25, snap turn by default, movement follows the
 * controller, teleport and smooth movement on different hands, vignette
 * while moving.
 */
(function() {
  'use strict';

  if (!window.BimXR) return;

  var DEADZONE = 0.25;
  var AIM_THRESHOLD = 0.6;       // right stick forward beyond this = aim
  var SNAP_ON = 0.7, SNAP_OFF = 0.3; // snap turn fires above, re-arms below
  var TURN_RATE = Math.PI / 2;   // rad/s at full deflection (smooth turn)
  var PITCH_DEADZONE = 15 * Math.PI / 180;
  var MIN_SPEED = 3;             // m/s near the ground
  var MAX_SPEED = 2000;          // m/s
  var SPEED_PER_HEIGHT = 0.5;    // m/s per m above ground
  var MIN_CLEARANCE = 0.5;       // m between the head and the ground when flying down
  var PICK_INTERVAL = 100;       // ms, teleport target at most 10×/s
  var GROUND_INTERVAL = 300;     // ms, height above ground for the speed
  var FADE_MS = 150;
  var BEAM_LENGTH = 300;         // m when nothing is hit
  var GRAVITY = 9.81;
  var ARC_STEPS = 48;
  var VIGNETTE = 0.7;            // strength while moving
  var VIGNETTE_RATE = 5;         // per second towards the target
  var TEAL = '#2ECFB0';

  var scene = null, st = null;
  var C3 = Cesium.Cartesian3;
  var tmp1 = new C3(), tmp2 = new C3(), tmp3 = new C3();

  function axis(v) {
    var a = Math.abs(v);
    return a < DEADZONE ? 0 : Math.sign(v) * (a - DEADZONE) / (1 - DEADZONE);
  }

  function button(src, i) {
    var b = src.gamepad && src.gamepad.buttons[i];
    return b ? b.value || (b.pressed ? 1 : 0) : 0;
  }

  // The reference frame keeps "up" = the ellipsoid normal at its origin, also
  // after flying far
  function rebase(ref) {
    Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(ref.origin, ref.up);
    C3.multiplyByScalar(ref.up, C3.dot(ref.fwd, ref.up), tmp1);
    C3.normalize(C3.subtract(ref.fwd, tmp1, ref.fwd), ref.fwd);
    C3.normalize(C3.cross(ref.fwd, ref.up, ref.right), ref.right);
  }

  // XR reference-space point → world
  function toWorld(ref, x, y, z, out) {
    BimXR.toWorldVec(ref, x, y, z, out);
    return C3.add(ref.origin, out, out);
  }

  function headWorld(ctx, out) {
    var p = ctx.pose.transform.position;
    return toWorld(ctx.ref, p.x, p.y, p.z, out);
  }

  // Pose of a controller's pointing ray: origin and direction in the world
  function rayOf(ctx, src) {
    var p = src.targetRaySpace && ctx.frame.getPose(src.targetRaySpace, ctx.refSpace);
    if (!p) return null;
    var m = p.transform.matrix;
    var origin = toWorld(ctx.ref, m[12], m[13], m[14], new C3());
    var dir = C3.normalize(BimXR.toWorldVec(ctx.ref, -m[8], -m[9], -m[10], new C3()), new C3());
    var right = C3.normalize(BimXR.toWorldVec(ctx.ref, m[0], m[1], m[2], new C3()), new C3());
    return { origin: origin, dir: dir, right: right };
  }

  function groundBelow(pos) {
    var carto = Cesium.Cartographic.fromCartesian(pos);
    if (!carto) return null;
    var h = scene.globe.getHeight(carto);
    // coarse terrain tiles (far away) give nonsense like −18 km
    return h === undefined || h < -500 ? null : { carto: carto, ground: h };
  }

  function aboveGround(ctx, now) {
    if (now - st.groundAt > GROUND_INTERVAL) {
      st.groundAt = now;
      var g = groundBelow(headWorld(ctx, tmp1));
      st.aboveGround = g ? Math.max(0, g.carto.height - g.ground) : st.aboveGround;
    }
    return st.aboveGround;
  }

  // ---------------------------------------------------------------------------
  // Fly, up/down, turn
  // ---------------------------------------------------------------------------
  // Flying direction from the controller direction and the pitch setting
  function flyDirection(dir, up, mode, out) {
    if (mode === 'free') return C3.clone(dir, out);
    var vertical = C3.dot(dir, up);
    var horizontal = C3.subtract(dir, C3.multiplyByScalar(up, vertical, tmp3), out);
    if (C3.magnitude(horizontal) < 1e-6) return C3.clone(C3.ZERO, out); // pointing straight up/down
    C3.normalize(horizontal, horizontal);
    if (mode === 'level') return horizontal;
    // deadzone: ±15° count as level, beyond that the pitch is scaled to 0-90°
    var pitch = Math.asin(Math.max(-1, Math.min(1, vertical)));
    var a = Math.abs(pitch);
    if (a < PITCH_DEADZONE) return horizontal;
    var p = Math.sign(pitch) * (a - PITCH_DEADZONE) / (Math.PI / 2 - PITCH_DEADZONE) * (Math.PI / 2);
    C3.multiplyByScalar(horizontal, Math.cos(p), horizontal);
    return C3.add(horizontal, C3.multiplyByScalar(up, Math.sin(p), tmp3), out);
  }

  function fly(ctx, src, settings, now) {
    var gp = src.gamepad;
    var fwd = -axis(gp.axes[3] || 0), side = axis(gp.axes[2] || 0);
    var vertical = button(src, 1) - button(src, 0); // grip up, trigger down
    if (Math.abs(vertical) < 0.05) vertical = 0;
    if (!fwd && !side && !vertical) return false;
    var ray = rayOf(ctx, src);
    if (!ray) return false;
    var speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, aboveGround(ctx, now) * SPEED_PER_HEIGHT)) * settings.speed;
    var step = speed * ctx.dt;
    var dir = flyDirection(ray.dir, ctx.ref.up, settings.pitch, new C3());
    var side3 = flyDirection(ray.right, ctx.ref.up, 'level', new C3());
    var move = C3.multiplyByScalar(dir, fwd * step, tmp2);
    C3.add(move, C3.multiplyByScalar(side3, side * step, tmp3), move);
    C3.add(move, C3.multiplyByScalar(ctx.ref.up, vertical * step, tmp3), move);
    C3.add(ctx.ref.origin, move, ctx.ref.origin);
    rebase(ctx.ref);
    keepAboveGround(ctx, step);
    return true;
  }

  // Flying down or forward into a slope stops just above the terrain. At
  // most one step per frame: right after a jump the terrain tiles below can
  // still be coarse and report the ground hundreds of metres too high.
  function keepAboveGround(ctx, step) {
    var g = groundBelow(headWorld(ctx, tmp1));
    if (!g) return;
    var below = Math.min(g.ground + MIN_CLEARANCE - g.carto.height, step);
    if (below > 0) C3.add(ctx.ref.origin, C3.multiplyByScalar(ctx.ref.up, below, tmp2), ctx.ref.origin);
  }

  // Rotate the frame around the vertical through the head, so the head stays
  function turn(ctx, angle) {
    var ref = ctx.ref, p = ctx.pose.transform.position;
    var before = BimXR.toWorldVec(ref, p.x, 0, p.z, new C3());
    var c = Math.cos(angle), s = Math.sin(angle);
    var fwd = C3.clone(ref.fwd), right = C3.clone(ref.right);
    // positive angle = turn right: forward swings towards right
    C3.add(C3.multiplyByScalar(fwd, c, tmp1), C3.multiplyByScalar(right, s, tmp2), ref.fwd);
    C3.subtract(C3.multiplyByScalar(right, c, tmp1), C3.multiplyByScalar(fwd, s, tmp2), ref.right);
    var after = BimXR.toWorldVec(ref, p.x, 0, p.z, new C3());
    C3.add(ref.origin, C3.subtract(before, after, tmp1), ref.origin);
  }

  // Returns true while turning smoothly (counts as movement for the vignette)
  function handleTurn(ctx, x, settings) {
    if (settings.turn === 'smooth') {
      var amount = axis(x);
      if (amount) turn(ctx, amount * TURN_RATE * ctx.dt);
      return !!amount;
    }
    var step = (settings.turn === 'snap45' ? 45 : 30) * Math.PI / 180;
    if (st.snapArmed && Math.abs(x) > SNAP_ON) {
      turn(ctx, Math.sign(x) * step);
      st.snapArmed = false;
    } else if (Math.abs(x) < SNAP_OFF) {
      st.snapArmed = true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Teleport: arc or beam, marker, fade
  // ---------------------------------------------------------------------------
  function pickModel(origin, dir) {
    try {
      var hit = scene.pickFromRay(new Cesium.Ray(origin, dir), [st.beams, st.markers]);
      return hit && hit.position ? hit.position : null;
    } catch (e) { return null; } // pickFromRay needs depth textures; terrain only then
  }

  // Straight beam: nearest of terrain and model along the controller ray
  function beamTarget(ray) {
    var best = null, bestD = Infinity;
    var g = scene.globe.pick(new Cesium.Ray(ray.origin, ray.dir), scene);
    if (g) { best = g; bestD = C3.distance(ray.origin, g); }
    var m = pickModel(ray.origin, ray.dir);
    if (m && C3.distance(ray.origin, m) < bestD) best = m;
    var end = best || C3.add(ray.origin, C3.multiplyByScalar(ray.dir, BEAM_LENGTH, tmp1), new C3());
    return { target: best, points: [ray.origin, end] };
  }

  // Arc: a throw parabola whose reach grows with the height above ground.
  // Lands where it first goes below the terrain; a model on the straight
  // line to that point (pick along the chord) wins.
  function arcTarget(ctx, ray, now) {
    var up = ctx.ref.up;
    var reach = Math.min(3000, Math.max(30, 4 * aboveGround(ctx, now)));
    var v0 = Math.sqrt(GRAVITY * reach);
    var total = 3 * v0 / GRAVITY, dt = total / ARC_STEPS;
    var points = [ray.origin], prev = ray.origin, prevAbove = Infinity, hit = null;
    for (var k = 1; k <= ARC_STEPS; k++) {
      var t = k * dt;
      var p = C3.add(ray.origin, C3.multiplyByScalar(ray.dir, v0 * t, tmp1), new C3());
      C3.add(p, C3.multiplyByScalar(up, -0.5 * GRAVITY * t * t, tmp1), p);
      var g = groundBelow(p);
      var above = g ? g.carto.height - g.ground : Infinity;
      if (above <= 0) {
        var f = prevAbove === Infinity ? 1 : prevAbove / (prevAbove - above);
        hit = C3.lerp(prev, p, f, new C3());
        points.push(hit);
        break;
      }
      points.push(p);
      prev = p; prevAbove = above;
    }
    if (hit) {
      var chord = C3.subtract(hit, ray.origin, new C3()), len = C3.magnitude(chord);
      var m = len > 0.5 && pickModel(ray.origin, C3.normalize(chord, chord));
      if (m && C3.distance(ray.origin, m) < len - 0.5) {
        hit = m;
        points = bezier(ray.origin, ray.dir, m);
      }
    }
    return { target: hit, points: points };
  }

  // Curve from the hand to a model hit, leaving the hand in its direction
  function bezier(a, dir, b) {
    var ctrl = C3.add(a, C3.multiplyByScalar(dir, C3.distance(a, b) * 0.5, tmp1), new C3());
    var pts = [];
    for (var i = 0; i <= 16; i++) {
      var t = i / 16, u = 1 - t;
      pts.push(new C3(
        u * u * a.x + 2 * u * t * ctrl.x + t * t * b.x,
        u * u * a.y + 2 * u * t * ctrl.y + t * t * b.y,
        u * u * a.z + 2 * u * t * ctrl.z + t * t * b.z));
    }
    return pts;
  }

  function aim(ctx, src, settings, now) {
    var ray = rayOf(ctx, src);
    if (!ray) return;
    if (now - st.pickAt > PICK_INTERVAL || !st.aimResult) {
      st.pickAt = now;
      st.aimResult = settings.teleport === 'beam' ? beamTarget(ray) : arcTarget(ctx, ray, now);
    }
    var r = st.aimResult;
    var pts = r.points.slice();
    pts[0] = ray.origin; // follows the hand every frame
    if (pts.length < 2) pts.push(C3.add(ray.origin, ray.dir, new C3()));
    st.beam.positions = pts;
    st.beam.show = true;
    st.marker.show = !!r.target;
    if (r.target) st.marker.position = r.target;
  }

  function stopAim() {
    st.beam.show = false;
    st.marker.show = false;
  }

  // Feet on the target, the head's offset inside the play area kept
  function teleport(ctx, target) {
    var ref = ctx.ref, p = ctx.pose.transform.position;
    C3.clone(target, ref.origin);
    rebase(ref);
    C3.subtract(ref.origin, BimXR.toWorldVec(ref, p.x, 0, p.z, tmp1), ref.origin);
  }

  function startFade(target) {
    st.fade = { start: performance.now(), target: C3.clone(target), jumped: false };
  }

  // 150 ms to black → jump → 150 ms back
  function updateFade(ctx, now) {
    var f = st.fade, t = now - f.start;
    if (t < FADE_MS) { st.fadeValue = t / FADE_MS; return; }
    if (!f.jumped) { teleport(ctx, f.target); f.jumped = true; }
    if (t < 2 * FADE_MS) { st.fadeValue = 1 - (t - FADE_MS) / FADE_MS; return; }
    st.fadeValue = 0;
    st.fade = null;
  }

  // Fade to black and the vignette in one full-screen pass, only enabled
  // while one of them is visible. The canvas holds both eyes side by side:
  // the vignette is centred per half.
  function overlayStage() {
    return new Cesium.PostProcessStage({
      name: 'geobim_xr_fade',
      fragmentShader:
        'uniform sampler2D colorTexture;\n' +
        'uniform float fade;\n' +
        'uniform float vignette;\n' +
        'uniform float stereo;\n' +
        'in vec2 v_textureCoordinates;\n' +
        'void main() {\n' +
        '  vec3 c = texture(colorTexture, v_textureCoordinates).rgb;\n' +
        '  vec2 uv = v_textureCoordinates;\n' +
        '  if (stereo > 0.5) uv.x = fract(uv.x * 2.0);\n' +
        '  float r = length((uv - 0.5) * vec2(1.6, 1.4));\n' +
        '  float v = 1.0 - vignette * smoothstep(0.35, 0.8, r);\n' +
        '  out_FragColor = vec4(c * v * (1.0 - fade), 1.0);\n' +
        '}\n',
      uniforms: {
        fade: function() { return st ? st.fadeValue : 0; },
        vignette: function() { return st ? st.vignetteValue : 0; },
        stereo: function() { return scene && scene.useWebVR ? 1 : 0; }
      }
    });
  }

  function updateOverlay(moving, settings, dt) {
    var target = moving && settings.vignette ? VIGNETTE : 0;
    var d = target - st.vignetteValue, maxStep = VIGNETTE_RATE * dt;
    st.vignetteValue += Math.max(-maxStep, Math.min(maxStep, d));
    if (st.vignetteValue < 0.01 && !target) st.vignetteValue = 0;
    st.stage.enabled = st.fadeValue > 0 || st.vignetteValue > 0;
  }

  // ---------------------------------------------------------------------------
  // Hooks
  // ---------------------------------------------------------------------------
  BimXR.on('enter', function(ctx) {
    scene = ctx.scene;
    var teal = Cesium.Color.fromCssColorString(TEAL);
    st = {
      aboveGround: 0, groundAt: 0, pickAt: 0, aimResult: null, aiming: false, snapArmed: true,
      fade: null, fadeValue: 0, vignetteValue: 0,
      beams: scene.primitives.add(new Cesium.PolylineCollection()),
      markers: scene.primitives.add(new Cesium.PointPrimitiveCollection())
    };
    st.beam = st.beams.add({
      show: false, width: 3, positions: [C3.ZERO, C3.UNIT_X],
      material: Cesium.Material.fromType('Color', { color: teal.withAlpha(0.8) })
    });
    st.marker = st.markers.add({
      show: false, pixelSize: 16, color: teal, outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    });
    st.stage = scene.postProcessStages.add(overlayStage());
    st.stage.enabled = false;
  });

  BimXR.on('frame', function(ctx) {
    if (!st) return;
    var now = performance.now(), settings = BimXR.getSettings(), moving = false;
    if (st.fade) {
      updateFade(ctx, now); // no other movement while fading
      updateOverlay(false, settings, ctx.dt);
      return;
    }
    var left = null, right = null;
    ctx.session.inputSources.forEach(function(src) {
      if (!src.gamepad) return;
      if (src.handedness === 'left') left = src;
      else if (src.handedness === 'right') right = src;
    });
    if (left) moving = fly(ctx, left, settings, now);
    if (right) {
      var x = right.gamepad.axes[2] || 0, y = right.gamepad.axes[3] || 0;
      if (y < -AIM_THRESHOLD && Math.abs(y) > Math.abs(x)) {
        st.aiming = true;
        aim(ctx, right, settings, now);
      } else if (st.aiming) {
        // stick released: jump if there is a target
        st.aiming = false;
        stopAim();
        if (st.aimResult && st.aimResult.target) startFade(st.aimResult.target);
        st.aimResult = null;
      } else if (Math.abs(x) > Math.abs(y)) {
        moving = handleTurn(ctx, x, settings) || moving;
      } else {
        st.snapArmed = true;
      }
    }
    updateOverlay(moving, settings, ctx.dt);
  });

  BimXR.on('exit', function() {
    if (!st) return;
    if (!st.beams.isDestroyed()) scene.primitives.remove(st.beams);
    if (!st.markers.isDestroyed()) scene.primitives.remove(st.markers);
    scene.postProcessStages.remove(st.stage);
    st = null;
  });
})();
