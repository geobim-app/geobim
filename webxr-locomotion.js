/**
 * geobim.app — VR movement (WebXR controllers), docs/WEBXR_PLAN.md phase 2
 *
 * Works on the reference frame of webxr.js (BimXR.on hooks): moving, turning
 * and teleporting only shift / rotate that frame, never the head pose.
 *
 *   Left stick        fly in the pointing direction of the left controller
 *                     (sideways = strafe); speed grows with height above ground
 *   Left grip         up      Left trigger   down
 *   Right stick ←/→   smooth turn around the vertical axis (head stays put)
 *   Right stick ↑     aim: beam from the right controller with a marker on
 *                     model or terrain; release = teleport with a short fade
 *                     to black
 *
 * Patterns from the Babylon.js WebXR docs: stick dead zone 0.25, movement
 * follows the controller (not the head), teleport and smooth movement on
 * different hands.
 */
(function() {
  'use strict';

  if (!window.BimXR) return;

  var DEADZONE = 0.25;
  var AIM_THRESHOLD = 0.6;       // right stick forward beyond this = aim
  var TURN_RATE = Math.PI / 2;   // rad/s at full deflection
  var MIN_SPEED = 3;             // m/s near the ground
  var MAX_SPEED = 2000;          // m/s
  var SPEED_PER_HEIGHT = 0.5;    // m/s per m above ground
  var MIN_CLEARANCE = 0.5;       // m between the head and the ground when flying down
  var PICK_INTERVAL = 100;       // ms, teleport target (pick pass) at most 10×/s
  var GROUND_INTERVAL = 300;     // ms, height above ground for the speed
  var FADE_MS = 150;
  var BEAM_LENGTH = 300;         // m when nothing is hit
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

  // ---------------------------------------------------------------------------
  // Fly, up/down, turn
  // ---------------------------------------------------------------------------
  function speed(ctx, now) {
    if (now - st.groundAt > GROUND_INTERVAL) {
      st.groundAt = now;
      var g = groundBelow(headWorld(ctx, tmp1));
      st.aboveGround = g ? Math.max(0, g.carto.height - g.ground) : st.aboveGround;
    }
    return Math.min(MAX_SPEED, Math.max(MIN_SPEED, st.aboveGround * SPEED_PER_HEIGHT));
  }

  function fly(ctx, src, now) {
    var gp = src.gamepad;
    var fwd = -axis(gp.axes[3] || 0), side = axis(gp.axes[2] || 0);
    var vertical = button(src, 1) - button(src, 0); // grip up, trigger down
    if (!fwd && !side && Math.abs(vertical) < 0.05) return;
    var ray = rayOf(ctx, src);
    if (!ray) return;
    var step = speed(ctx, now) * ctx.dt;
    var move = C3.multiplyByScalar(ray.dir, fwd * step, tmp2);
    C3.add(move, C3.multiplyByScalar(ray.right, side * step, tmp3), move);
    C3.add(move, C3.multiplyByScalar(ctx.ref.up, vertical * step, tmp3), move);
    C3.add(ctx.ref.origin, move, ctx.ref.origin);
    rebase(ctx.ref);
    keepAboveGround(ctx, step);
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

  // ---------------------------------------------------------------------------
  // Teleport: beam, marker, fade
  // ---------------------------------------------------------------------------
  function pickTarget(ray) {
    var r = new Cesium.Ray(ray.origin, ray.dir);
    var best = null, bestD = Infinity;
    var g = scene.globe.pick(r, scene);
    if (g) { best = g; bestD = C3.distance(ray.origin, g); }
    try {
      var hit = scene.pickFromRay(r, [st.beams, st.markers]);
      if (hit && hit.position) {
        var d = C3.distance(ray.origin, hit.position);
        if (d < bestD) { best = hit.position; bestD = d; }
      }
    } catch (e) { /* pickFromRay needs depth textures; terrain only then */ }
    return best;
  }

  function aim(ctx, src, now) {
    var ray = rayOf(ctx, src);
    if (!ray) return;
    if (now - st.pickAt > PICK_INTERVAL) {
      st.pickAt = now;
      st.target = pickTarget(ray);
    }
    var end = st.target || C3.add(ray.origin, C3.multiplyByScalar(ray.dir, BEAM_LENGTH, tmp1), new C3());
    st.beam.positions = [ray.origin, end];
    st.beam.show = true;
    st.marker.show = !!st.target;
    if (st.target) st.marker.position = st.target;
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

  function startFade(ctx, target) {
    st.fade = { start: performance.now(), target: C3.clone(target), jumped: false };
    st.stage.enabled = true;
  }

  // 150 ms to black → jump → 150 ms back
  function updateFade(ctx, now) {
    var f = st.fade, t = now - f.start;
    if (t < FADE_MS) { st.fadeValue = t / FADE_MS; return; }
    if (!f.jumped) { teleport(ctx, f.target); f.jumped = true; }
    if (t < 2 * FADE_MS) { st.fadeValue = 1 - (t - FADE_MS) / FADE_MS; return; }
    st.fadeValue = 0;
    st.fade = null;
    st.stage.enabled = false;
  }

  function fadeStage() {
    return new Cesium.PostProcessStage({
      name: 'geobim_xr_fade',
      fragmentShader:
        'uniform sampler2D colorTexture;\n' +
        'uniform float fade;\n' +
        'in vec2 v_textureCoordinates;\n' +
        'void main() {\n' +
        '  out_FragColor = vec4(texture(colorTexture, v_textureCoordinates).rgb * (1.0 - fade), 1.0);\n' +
        '}\n',
      uniforms: { fade: function() { return st ? st.fadeValue : 0; } }
    });
  }

  // ---------------------------------------------------------------------------
  // Hooks
  // ---------------------------------------------------------------------------
  BimXR.on('enter', function(ctx) {
    scene = ctx.scene;
    var teal = Cesium.Color.fromCssColorString(TEAL);
    st = {
      aboveGround: 0, groundAt: 0, pickAt: 0, target: null, aiming: false,
      fade: null, fadeValue: 0,
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
    st.stage = scene.postProcessStages.add(fadeStage());
    st.stage.enabled = false;
  });

  BimXR.on('frame', function(ctx) {
    if (!st) return;
    var now = performance.now();
    if (st.fade) { updateFade(ctx, now); return; } // no other movement while fading
    var left = null, right = null;
    ctx.session.inputSources.forEach(function(src) {
      if (!src.gamepad) return;
      if (src.handedness === 'left') left = src;
      else if (src.handedness === 'right') right = src;
    });
    if (left) fly(ctx, left, now);
    if (!right) return;
    var x = right.gamepad.axes[2] || 0, y = right.gamepad.axes[3] || 0;
    var aiming = y < -AIM_THRESHOLD && Math.abs(y) > Math.abs(x);
    if (aiming) {
      st.aiming = true;
      aim(ctx, right, now);
      return;
    }
    if (st.aiming) {
      // stick released: jump if there is a target
      st.aiming = false;
      stopAim();
      if (st.target) startFade(ctx, st.target);
      st.target = null;
      return;
    }
    var turnAmount = axis(x);
    if (turnAmount && Math.abs(x) > Math.abs(y)) turn(ctx, turnAmount * TURN_RATE * ctx.dt);
  });

  BimXR.on('exit', function() {
    if (!st) return;
    if (!st.beams.isDestroyed()) scene.primitives.remove(st.beams);
    if (!st.markers.isDestroyed()) scene.primitives.remove(st.markers);
    scene.postProcessStages.remove(st.stage);
    st = null;
  });
})();
