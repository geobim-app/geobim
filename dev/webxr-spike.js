/**
 * geoBIM.app — WebXR spike (docs/WEBXR_PLAN.md, phase 0). Local development only.
 *
 * Way B: CesiumJS 1.145 has no WebXR support, so this page drives the session
 * itself:
 *   - XRWebGLLayer on Cesium's own WebGL2 context (xrCompatible, no antialias)
 *   - Cesium's render loop off; session.requestAnimationFrame instead
 *   - per eye: camera from XRView (pose + projection) → scene.render() into the
 *     canvas → gl.blitFramebuffer into that eye's viewport of the XR framebuffer
 *   - reference frame: ENU at the start camera (eye height), heading of the
 *     start camera; the head pose from local-floor goes on top
 * Measures frames per second and the CPU time of both renders.
 *
 * Uses private Cesium internals (scene.context._gl) — that is part of what the
 * spike checks.
 */
'use strict';

(function() {

  var params = new URLSearchParams(location.search);
  var SCALE = clamp(parseFloat(params.get('scale')) || 0.8, 0.3, 1.0);
  var SSE = clamp(parseFloat(params.get('sse')) || 16, 1, 64);
  var EXTRA_ASSET = parseInt(params.get('asset'), 10) || 0;
  var EMULATE = params.get('emulate') === '1';
  var MONO = params.get('mono') === '1';
  // Edge smoothing (the WebGL context itself must stay without antialias for
  // the blit): Cesium's own MSAA resolves into the default framebuffer, FXAA
  // is a post-process
  var MSAA = clamp(parseInt(params.get('msaa'), 10) || 1, 1, 8);
  // Single-pass stereo through Cesium's own (old WebVR) path: the scene is
  // updated once per frame (primitives, tile selection, visible set, shadows),
  // only the draw commands run twice — into the left and right half of a
  // double-wide canvas, copied with one blit. Two-pass = two full renders.
  var SINGLE = params.get('single') === '1';
  var FXAA = params.get('fxaa') === '1';
  // Without a real XR framebuffer (emulator): blit both eyes side by side into
  // an own framebuffer, to check the stereo + blit path for GL errors
  var BLITTEST = params.get('blittest') === '1';
  var EYE_HEIGHT = 1.6; // m, local-floor puts the head about this high
  var NEAR = 0.2;
  // KVA Linth, Niederurnen: OSM buildings and terrain around the plant.
  // Height above the ellipsoid: the ground there is ~475 m (426 m a.s.l. + geoid)
  var START = { lon: 9.0395, lat: 47.1345, height: 520, heading: 20, pitch: -12 };

  var statusEl = document.getElementById('spikeStatus');
  var statsEl = document.getElementById('spikeStats');
  var btn = document.getElementById('enterVrBtn');

  var viewer, scene, gl;
  var xr = null; // active session state

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function status(text) { statusEl.textContent = text; console.log('[webxr-spike] ' + text); }

  // ---------------------------------------------------------------------------
  // Cesium viewer
  // ---------------------------------------------------------------------------
  async function initViewer() {
    var cfg = await fetch('../api/ion-config.php').then(function(r) { return r.json(); });
    if (!cfg.token) throw new Error('No ion token (dev/serve.ps1 + ~/.geobim/ion-dev-token.txt)');
    Cesium.Ion.defaultAccessToken = cfg.token;

    viewer = new Cesium.Viewer('cesiumContainer', {
      terrain: Cesium.Terrain.fromWorldTerrain(),
      baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
      navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false,
      infoBox: false, selectionIndicator: false, vrButton: false,
      msaaSamples: MSAA,
      contextOptions: {
        requestWebgl1: false,
        webgl: { alpha: false, antialias: false, preserveDrawingBuffer: false, xrCompatible: true }
      }
    });
    scene = viewer.scene;
    gl = scene.context._gl; // private: the WebGL context the XR layer must share
    scene.globe.maximumScreenSpaceError = 4;
    scene.fog.enabled = true;
    scene.shadowMap.enabled = false;
    scene.postProcessStages.fxaa.enabled = FXAA;

    var osm = await Cesium.createOsmBuildingsAsync();
    osm.maximumScreenSpaceError = SSE;
    scene.primitives.add(osm);
    if (EXTRA_ASSET) {
      try {
        var extra = await Cesium.Cesium3DTileset.fromIonAssetId(EXTRA_ASSET, { maximumScreenSpaceError: SSE });
        scene.primitives.add(extra);
      } catch (e) {
        status('Ion asset ' + EXTRA_ASSET + ' not loaded: ' + e.message);
      }
    }

    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(START.lon, START.lat, START.height),
      orientation: { heading: Cesium.Math.toRadians(START.heading), pitch: Cesium.Math.toRadians(START.pitch), roll: 0 }
    });

    labels = scene.primitives.add(new Cesium.LabelCollection());
    fpsLabel = labels.add({
      text: '', show: false, font: '28px sans-serif', fillColor: Cesium.Color.fromCssColorString('#2ECFB0'),
      outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY, scale: 0.5
    });
  }

  var labels, fpsLabel, showFps = true;

  // ---------------------------------------------------------------------------
  // Reference frame: ENU at the start position, rotated by the start heading.
  // XR local-floor: x right, y up, -z forward.
  // ---------------------------------------------------------------------------
  function makeFrame() {
    var cam = viewer.camera;
    var carto = cam.positionCartographic;
    var origin = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height - EYE_HEIGHT);
    var enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
    var east = Cesium.Matrix4.getColumn(enu, 0, new Cesium.Cartesian4());
    var north = Cesium.Matrix4.getColumn(enu, 1, new Cesium.Cartesian4());
    var up = Cesium.Matrix4.getColumn(enu, 2, new Cesium.Cartesian4());
    var h = cam.heading; // compass: 0 = north, clockwise
    var fwd = new Cesium.Cartesian3(
      north.x * Math.cos(h) + east.x * Math.sin(h),
      north.y * Math.cos(h) + east.y * Math.sin(h),
      north.z * Math.cos(h) + east.z * Math.sin(h));
    var right = new Cesium.Cartesian3(
      east.x * Math.cos(h) - north.x * Math.sin(h),
      east.y * Math.cos(h) - north.y * Math.sin(h),
      east.z * Math.cos(h) - north.z * Math.sin(h));
    return { origin: origin, right: right, up: new Cesium.Cartesian3(up.x, up.y, up.z), fwd: fwd };
  }

  // XR reference-space vector → world vector
  function toWorldVec(f, x, y, z, out) {
    out.x = f.right.x * x + f.up.x * y - f.fwd.x * z;
    out.y = f.right.y * x + f.up.y * y - f.fwd.y * z;
    out.z = f.right.z * x + f.up.z * y - f.fwd.z * z;
    return out;
  }

  var tmpV = new Cesium.Cartesian3();
  var tmpD = new Cesium.Cartesian3();
  var tmpU = new Cesium.Cartesian3();

  // Headset eye frusta are asymmetric (wider to the outside). A PerspectiveFrustum
  // takes that as xOffset/yOffset, but in metres at the near plane — and Cesium
  // renders with a clone whose `near` it moves (often to metres or tens of
  // metres). A fixed offset then all but vanishes, both eye images shift and
  // the user sees double. So the offsets are kept as ratios of `near`: accessor
  // properties on the frustum and on every clone Cesium makes of it.
  var asymFrusta = []; // every frustum patched, to undo on exit

  function makeAsymmetric(fr, xRatio, yRatio) {
    if (!fr._xrAsym) {
      asymFrusta.push(fr);
      var proto = Object.getPrototypeOf(fr);
      Object.defineProperty(fr, 'xOffset', {
        configurable: true,
        get: function() { return this.near * this._xRatio; },
        set: function(v) { this._xRatio = this.near ? v / this.near : 0; }
      });
      Object.defineProperty(fr, 'yOffset', {
        configurable: true,
        get: function() { return this.near * this._yRatio; },
        set: function(v) { this._yRatio = this.near ? v / this.near : 0; }
      });
      fr.clone = function(result) {
        var c = proto.clone.call(this, result);
        makeAsymmetric(c, this._xRatio, this._yRatio);
        return c;
      };
      fr._xrAsym = true;
    }
    fr._xRatio = xRatio;
    fr._yRatio = yRatio;
  }

  // Cesium reuses its scratch frusta for normal rendering: back to plain
  // properties with offset 0, and force a matrix update
  function undoAsymmetric() {
    asymFrusta.forEach(function(fr) {
      delete fr.xOffset;
      delete fr.yOffset;
      delete fr.clone;
      delete fr._xrAsym;
      fr.xOffset = 0;
      fr.yOffset = 0;
      fr._xOffset = undefined; // PerspectiveFrustum recomputes when these differ
      fr._yOffset = undefined;
    });
    asymFrusta = [];
  }

  // Camera for one XRView: pose (column-major view → reference space) and the
  // asymmetric projection as fov + near-relative x/y offsets.
  function setEyeCamera(f, view) {
    var m = view.transform.matrix;
    lastView = { m: m, p: view.projectionMatrix };
    var cam = viewer.camera;
    toWorldVec(f, m[12], m[13], m[14], tmpV);
    Cesium.Cartesian3.add(f.origin, tmpV, cam.position);
    toWorldVec(f, -m[8], -m[9], -m[10], tmpD);           // view -z
    Cesium.Cartesian3.normalize(tmpD, cam.direction);
    toWorldVec(f, m[4], m[5], m[6], tmpU);               // view +y
    Cesium.Cartesian3.normalize(tmpU, cam.up);
    Cesium.Cartesian3.cross(cam.direction, cam.up, cam.right);
    Cesium.Cartesian3.normalize(cam.right, cam.right);

    var p = view.projectionMatrix;
    var rightTan = (1 + p[8]) / p[0], leftTan = (p[8] - 1) / p[0];
    var topTan = (1 + p[9]) / p[5], bottomTan = (p[9] - 1) / p[5];
    var hw = (rightTan - leftTan) / 2, hh = (topTan - bottomTan) / 2;
    var fr = cam.frustum;
    fr.aspectRatio = hw / hh;
    fr.fov = 2 * Math.atan(fr.aspectRatio >= 1 ? hw : hh);
    fr.near = NEAR;
    makeAsymmetric(fr, (rightTan + leftTan) / 2, (topTan + bottomTan) / 2);
  }

  // Projection of one XRView as tangents of its frustum edges
  function viewTans(view) {
    var p = view.projectionMatrix;
    return {
      right: (1 + p[8]) / p[0], left: (p[8] - 1) / p[0],
      top: (1 + p[9]) / p[5], bottom: (p[9] - 1) / p[5]
    };
  }

  var tmpL = new Cesium.Cartesian3();
  var tmpR = new Cesium.Cartesian3();

  // Single pass: camera at the midpoint of both eyes, oriented like the left
  // eye. Cesium's executeWebVRCommands then renders the left half with
  // position + right·eyeSeparation/2 and xOffset = 0.5·eyeSeparation·near/fo
  // (fo = near·focalLength), the right half mirrored. With eyeSeparation =
  // −IPD the left half shows the left eye; focalLength is chosen so that the
  // offset equals the left eye's frustum asymmetry (the right eye's is the
  // mirror image on headsets — checked in debug()).
  function setStereoCamera(f, left, right) {
    var mL = left.transform.matrix, mR = right.transform.matrix;
    toWorldVec(f, mL[12], mL[13], mL[14], tmpL);
    toWorldVec(f, mR[12], mR[13], mR[14], tmpR);
    var ipd = Cesium.Cartesian3.distance(tmpL, tmpR);
    var cam = viewer.camera;
    Cesium.Cartesian3.add(f.origin, Cesium.Cartesian3.midpoint(tmpL, tmpR, tmpV), cam.position);
    toWorldVec(f, -mL[8], -mL[9], -mL[10], tmpD);
    Cesium.Cartesian3.normalize(tmpD, cam.direction);
    toWorldVec(f, mL[4], mL[5], mL[6], tmpU);
    Cesium.Cartesian3.normalize(tmpU, cam.up);
    Cesium.Cartesian3.cross(cam.direction, cam.up, cam.right);
    Cesium.Cartesian3.normalize(cam.right, cam.right);

    var tL = viewTans(left), tR = viewTans(right);
    var hw = (tL.right - tL.left) / 2, hh = (tL.top - tL.bottom) / 2;
    var fr = cam.frustum;
    fr.aspectRatio = hw / hh;
    fr.fov = 2 * Math.atan(fr.aspectRatio >= 1 ? hw : hh);
    fr.near = NEAR;
    var xRatioL = (tL.right + tL.left) / 2;
    // culling of the shared pass uses the symmetric centre frustum
    makeAsymmetric(fr, 0, (tL.top + tL.bottom) / 2);
    scene.eyeSeparation = -ipd;
    scene.focalLength = Math.abs(xRatioL) > 1e-6 ? -ipd / (2 * NEAR * xRatioL) : 1e9;
    lastStereo = { ipd: ipd, xRatioL: xRatioL, xRatioR: (tR.right + tR.left) / 2, focalLength: scene.focalLength };
  }
  var lastStereo = null;

  function sizeCanvas(w, h) {
    var c = scene.canvas;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  // ---------------------------------------------------------------------------
  // Session
  // ---------------------------------------------------------------------------
  async function enterVR() {
    if (xr) return;
    if (!(gl instanceof WebGL2RenderingContext)) { status('WebGL2 required for blitFramebuffer'); return; }
    var session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    var refSpace, step = 'makeXRCompatible';
    // Any failure from here on must end the session, or it stays open in the
    // headset ("loading") and blocks every further requestSession
    try {
      if (gl.makeXRCompatible) await gl.makeXRCompatible();
      step = 'XRWebGLLayer';
      var layer = new XRWebGLLayer(session, gl, { antialias: false, framebufferScaleFactor: SCALE });
      try { layer.fixedFoveation = 0.5; } catch (e) {}
      step = 'updateRenderState';
      session.updateRenderState({ baseLayer: layer, depthNear: NEAR, depthFar: 1e7 });
      step = 'requestReferenceSpace';
      try { refSpace = await session.requestReferenceSpace('local-floor'); }
      catch (e) { refSpace = await session.requestReferenceSpace('local'); }
    } catch (e) {
      try { await session.end(); } catch (_) {}
      throw new Error(step + ': ' + e.message);
    }

    var cam = viewer.camera;
    xr = {
      session: session, refSpace: refSpace, frame: makeFrame(),
      saved: {
        position: Cesium.Cartesian3.clone(cam.position), direction: Cesium.Cartesian3.clone(cam.direction),
        up: Cesium.Cartesian3.clone(cam.up), right: Cesium.Cartesian3.clone(cam.right), frustum: cam.frustum.clone()
      },
      frames: 0, renderMs: 0, lastReport: performance.now(), fps: 0, eye: '', rafs: 0, noPose: 0
    };
    scene.screenSpaceCameraController.enableInputs = false;
    viewer.useDefaultRenderLoop = false;
    if (SINGLE) scene.useWebVR = true; // private-ish: Cesium's side-by-side stereo path
    fpsLabel.show = showFps;

    session.addEventListener('end', onEnd);
    session.addEventListener('squeezestart', function(ev) {
      if (ev.inputSource.handedness === 'left') session.end();
    });
    session.addEventListener('selectstart', function(ev) {
      if (ev.inputSource.handedness === 'right') { showFps = !showFps; fpsLabel.show = showFps; }
    });
    btn.textContent = 'Exit VR';
    status('In VR (scale ' + SCALE + ', SSE ' + SSE + (MONO ? ', mono' : '') + ', MSAA ' + MSAA + (FXAA ? ', FXAA' : '') + (SINGLE ? ', single-pass stereo' : ', two-pass') + ')');
    session.requestAnimationFrame(onFrame);
    // If the browser never calls the XR frame loop, nothing else would report it
    var started = performance.now(), sawFrame = false;
    xr.watchdog = setInterval(function() {
      if (!xr) return;
      if (xr.rafs || xr.frames) sawFrame = true;
      if (!sawFrame && performance.now() - started > 3000) {
        status('No XR frames from the browser after 3 s (session ' + session.visibilityState + ') — check that the headset shows this page, not another app');
      }
    }, 1000);
  }

  // A render error repeats every frame: report the first one and end the
  // session instead of leaving the headset on "loading"
  function onFrame(t, frame) {
    if (!xr) return;
    try {
      renderFrame(frame);
    } catch (e) {
      console.error('[webxr-spike] frame failed', e);
      var msg = 'Frame failed: ' + e.message;
      xr.session.end().catch(function() {});
      setTimeout(function() { status(msg + ' — session ended'); }, 0);
    }
  }

  function renderFrame(frame) {
    var session = frame.session;
    session.requestAnimationFrame(onFrame);
    xr.rafs++;
    var layer = session.renderState.baseLayer;
    var target = layer.framebuffer; // null in some emulators / inline: no blit possible
    var pose = frame.getViewerPose(xr.refSpace);
    if (!pose) {
      // No head pose (tracking not ready / lost): still hand the compositor a
      // frame — dark grey — so the headset does not hang on "loading"
      xr.noPose++;
      if (target) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target);
        gl.clearColor(0.1, 0.1, 0.12, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      report(0);
      return;
    }
    var getViewport = function(view, i) { return layer.getViewport(view); };
    if (!target && BLITTEST) {
      // The emulated layer derives its viewport from the canvas size, which
      // this page changes (double width in single-pass): freeze the first one
      if (!xr.testVp) { var v0 = layer.getViewport(pose.views[0]); xr.testVp = { width: v0.width, height: v0.height }; }
      var vp0 = xr.testVp;
      target = testTarget(vp0.width, vp0.height);
      getViewport = function(view, i) { return { x: i * vp0.width, y: 0, width: vp0.width, height: vp0.height }; };
    }
    var t0 = performance.now();
    viewer.clock.tick();
    scene.initializeFrame();
    var time = viewer.clock.currentTime;

    placeFpsLabel(pose);
    var views = pose.views;

    if (SINGLE && target && views.length === 2 && !MONO) {
      var iL = views[0].eye === 'right' ? 1 : 0, vL = views[iL], vR = views[1 - iL];
      var vpL = getViewport(vL, 0), vpR = getViewport(vR, 1);
      var w2 = vpL.width + vpR.width, h2 = vpL.height;
      sizeCanvas(w2, h2);
      setStereoCamera(xr.frame, vL, vR);
      scene.render(time); // both eyes, side by side
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target);
      if (vpR.x === vpL.x + vpL.width && vpR.y === vpL.y && vpR.height === vpL.height) {
        gl.blitFramebuffer(0, 0, w2, h2, vpL.x, vpL.y, vpL.x + w2, vpL.y + h2, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      } else { // other layout: one blit per eye
        gl.blitFramebuffer(0, 0, vpL.width, h2, vpL.x, vpL.y, vpL.x + vpL.width, vpL.y + vpL.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.blitFramebuffer(vpL.width, 0, w2, h2, vpR.x, vpR.y, vpR.x + vpR.width, vpR.y + vpR.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      xr.eye = vpL.width + '×' + vpL.height + ' single-pass';
      xr.renderMs += performance.now() - t0;
      xr.frames++;
      if (BLITTEST) xr.glError = gl.getError();
      report(2);
      return;
    }

    var n = MONO || !target ? 1 : views.length;
    for (var i = 0; i < n; i++) {
      var vp = getViewport(views[i], i);
      if (target) sizeCanvas(vp.width, vp.height);
      setEyeCamera(xr.frame, views[i]);
      scene.render(time);
      if (target) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target);
        gl.blitFramebuffer(0, 0, vp.width, vp.height, vp.x, vp.y, vp.x + vp.width, vp.y + vp.height,
          gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); // Cesium expects the default framebuffer bound
      }
      xr.eye = vp.width + '×' + vp.height;
    }
    xr.renderMs += performance.now() - t0;
    xr.frames++;
    if (BLITTEST) xr.glError = gl.getError();
    report(target ? n : 0);
  }

  // Side-by-side RGBA8 renderbuffer standing in for the XR framebuffer
  var testFbo = null;
  function testTarget(w, h) {
    if (testFbo && testFbo.w === w && testFbo.h === h) return testFbo.fb;
    var fb = gl.createFramebuffer(), rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, 2 * w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
    var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    testFbo = { fb: fb, w: w, h: h, complete: ok };
    return fb;
  }

  // Mean colour of each half of the test framebuffer (both eyes drawn?)
  function readTestTarget() {
    if (!testFbo) return null;
    var w = testFbo.w, h = testFbo.h, px = new Uint8Array(4 * 64 * 64), out = [];
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, testFbo.fb);
    for (var e = 0; e < 2; e++) {
      gl.readPixels(e * w + (w >> 1) - 32, (h >> 1) - 32, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
      var s = [0, 0, 0];
      for (var i = 0; i < px.length; i += 4) { s[0] += px[i]; s[1] += px[i + 1]; s[2] += px[i + 2]; }
      out.push(s.map(function(v) { return Math.round(v / (64 * 64)); }));
    }
    // 5 × 3 grid: the same spot in both eyes should differ only by parallax
    var diffs = [], one = new Uint8Array(4);
    for (var gy = 1; gy <= 3; gy++) for (var gx = 1; gx <= 5; gx++) {
      var x = Math.round(gx * w / 6), y = Math.round(gy * h / 4), a = [], b = [];
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); a = Array.from(one.slice(0, 3));
      gl.readPixels(w + x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); b = Array.from(one.slice(0, 3));
      diffs.push(Math.round((Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3));
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    return { complete: testFbo.complete, size: (2 * w) + '×' + h, leftEyeRGB: out[0], rightEyeRGB: out[1],
      gridDiff: diffs, gridDiffMean: Math.round(diffs.reduce(function(s, v) { return s + v; }, 0) / diffs.length) };
  }

  function placeFpsLabel(pose) {
    if (!fpsLabel.show) return;
    var m = pose.transform.matrix;
    // 2 m in front of the head, a bit below eye level
    var x = m[12] - m[8] * 2, y = m[13] - m[9] * 2 - 0.3, z = m[14] - m[10] * 2;
    fpsLabel.position = Cesium.Cartesian3.add(xr.frame.origin, toWorldVec(xr.frame, x, y, z, new Cesium.Cartesian3()), new Cesium.Cartesian3());
  }

  function report(eyesBlitted) {
    var now = performance.now();
    if (now - xr.lastReport < 1000) return;
    var secs = (now - xr.lastReport) / 1000;
    xr.fps = xr.frames / secs;
    var ms = xr.renderMs / Math.max(1, xr.frames);
    var line = 'fps ' + xr.fps.toFixed(1) + ' · CPU ' + ms.toFixed(1) + ' ms/frame · eye ' + xr.eye +
      ' · eyes blitted ' + eyesBlitted + ' · scale ' + SCALE + ' · SSE ' + SSE + ' · MSAA ' + MSAA + (FXAA ? ' · FXAA' : '') +
      ' · XR frames ' + xr.rafs + ' (no pose ' + xr.noPose + ')';
    statsEl.textContent = line;
    fpsLabel.text = xr.fps.toFixed(0) + ' fps · ' + ms.toFixed(0) + ' ms';
    console.log('[webxr-spike] ' + line);
    xr.frames = 0; xr.renderMs = 0; xr.rafs = 0; xr.noPose = 0; xr.lastReport = now;
  }

  function onEnd() {
    if (!xr) return;
    clearInterval(xr.watchdog);
    if (scene.useWebVR) {
      scene.useWebVR = false;
      scene.eyeSeparation = undefined;
      scene.focalLength = undefined;
    }
    undoAsymmetric();
    var s = xr.saved, cam = viewer.camera;
    cam.frustum = s.frustum;
    Cesium.Cartesian3.clone(s.position, cam.position);
    Cesium.Cartesian3.clone(s.direction, cam.direction);
    Cesium.Cartesian3.clone(s.up, cam.up);
    Cesium.Cartesian3.clone(s.right, cam.right);
    xr = null;
    fpsLabel.show = false;
    scene.screenSpaceCameraController.enableInputs = true;
    viewer.useDefaultRenderLoop = true;
    viewer.resize();
    btn.textContent = 'Enter VR';
    status('VR ended — camera and render loop restored');
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------
  async function installEmulator() {
    // Meta's Immersive Web Emulation Runtime (the engine of the Immersive Web
    // Emulator extension), Quest 3 with Touch controllers
    var iwer = await import('https://cdn.jsdelivr.net/npm/iwer@2.5.0/+esm');
    var device = new iwer.XRDevice(iwer.metaQuest3);
    // Chrome has its own navigator.xr even without a headset: replace it
    device.installRuntime({ forceInstall: true });
    device.position.set(0, EYE_HEIGHT, 0);
    window.spikeXRDevice = device; // for scripted tests (poses, buttons)
  }

  async function checkSupport() {
    if (xr) return;
    var supported = await navigator.xr.isSessionSupported('immersive-vr');
    btn.disabled = !supported;
    status(supported ? 'Ready — press Enter VR' + (EMULATE ? ' (IWER Quest 3 emulation)' : '')
      : 'immersive-vr not supported here — start Quest Link (Meta as OpenXR runtime); this page checks again when a headset appears');
  }

  async function start() {
    try {
      if (EMULATE) await installEmulator();
      await initViewer();
      if (!navigator.xr) {
        status('No WebXR in this browser (needs Chrome/Edge or Quest Browser, on localhost or https)');
        return;
      }
      await checkSupport();
      // A headset connected later (Quest Link started after loading): check again
      navigator.xr.addEventListener('devicechange', checkSupport);
    } catch (e) {
      console.error(e);
      status('Error: ' + e.message);
    }
  }

  btn.addEventListener('click', function() {
    if (xr) xr.session.end();
    else enterVR().catch(function(e) { console.error(e); status('Enter VR failed: ' + e.message); });
  });

  window.webxrSpike = {
    enter: function() { return enterVR(); },
    exit: function() { if (xr) return xr.session.end(); },
    // Cesium's plain WebVR side-by-side mode on the normal view (no XR), to
    // tell Cesium's own behaviour from this page's
    webvr: function(on, sep, fov) {
      scene.useWebVR = !!on;
      if (fov) viewer.camera.frustum.fov = fov;
      scene.eyeSeparation = on ? (sep === undefined ? undefined : sep) : undefined;
      return { useWebVR: scene.useWebVR, eyeSeparation: scene.eyeSeparation, focalLength: scene.focalLength };
    },
    // Check that the near-relative offsets survive Cesium's clone + near change
    testAsymmetry: function() {
      var fr = new Cesium.PerspectiveFrustum({ fov: 1.5, aspectRatio: 0.95, near: 0.2, far: 1e7 });
      makeAsymmetric(fr, 0.12, -0.05);
      var m8Original = fr.projectionMatrix[8];
      // what Scene does: clone into a scratch frustum, then move near
      var c = fr.clone(new Cesium.PerspectiveFrustum());
      c.near = 10;
      var m8AtNear10 = c.projectionMatrix[8];
      var xOffsetAtNear10 = c.xOffset;
      // after VR: patched frusta undone, a normal clone into the same scratch has offset 0
      undoAsymmetric();
      new Cesium.PerspectiveFrustum({ fov: 1, aspectRatio: 1, near: 1, far: 10 }).clone(c);
      return {
        m8Original: +m8Original.toFixed(5), m8AtNear10: +m8AtNear10.toFixed(5),
        xOffsetAtNear10: +xOffsetAtNear10.toFixed(4), expectedXOffset: 1.2,
        plainCloneXOffset: c.xOffset, plainCloneM8: +c.projectionMatrix[8].toFixed(5)
      };
    },
    // Test framebuffer as a data URL (both eyes side by side), to look at it
    snapshot: function() {
      if (!testFbo) return null;
      var w = 2 * testFbo.w, h = testFbo.h, px = new Uint8Array(4 * w * h);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, testFbo.fb);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var c2 = c.getContext('2d'), img = c2.createImageData(w, h);
      for (var y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      c2.putImageData(img, 0, 0);
      return c.toDataURL('image/png');
    },
    state: function() { return xr ? { fps: xr.fps, eye: xr.eye, glError: xr.glError, blitTest: readTestTarget() } : null; },
    // camera vs. local up, and the last XRView, for checking the pose math
    debug: function() {
      var cam = viewer.camera;
      var n = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(cam.position, new Cesium.Cartesian3());
      var r3 = function(v) { return [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)]; };
      return {
        upDotNormal: +Cesium.Cartesian3.dot(cam.up, n).toFixed(3),
        dirDotNormal: +Cesium.Cartesian3.dot(cam.direction, n).toFixed(3),
        pitchDeg: +Cesium.Math.toDegrees(cam.pitch).toFixed(1),
        headingDeg: +Cesium.Math.toDegrees(cam.heading).toFixed(1),
        heightM: +cam.positionCartographic.height.toFixed(1),
        frustum: { fov: cam.frustum.fov, aspect: cam.frustum.aspectRatio, xOffset: cam.frustum.xOffset, yOffset: cam.frustum.yOffset },
        stereo: lastStereo,
        lastView: lastView && { matrix: Array.from(lastView.m).map(function(x) { return +x.toFixed(3); }), proj: Array.from(lastView.p).map(function(x) { return +x.toFixed(3); }) },
        frameUp: xr && r3(xr.frame.up), frameFwd: xr && r3(xr.frame.fwd)
      };
    }
  };
  var lastView = null;

  start();
})();
