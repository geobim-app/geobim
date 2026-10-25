/**
 * geobim.app — VR mode (WebXR, immersive-vr)
 *
 * docs/WEBXR_PLAN.md, phase 1 ("way B"): own XR session on Cesium's WebGL2
 * context, own render loop, single-pass stereo through Cesium's side-by-side
 * stereo path, one blit into the XR framebuffer. Measured with the spike
 * (dev/webxr-spike.html) on Quest 3 + Link with a laptop RTX 2060: single-pass
 * + VR profile at framebuffer scale 0.6 holds 72 fps at ~3 ms CPU.
 *
 *   window.BimXR = { isSupported, enter, exit, isActive, getScale, setScale }
 *
 * - Button "VR" in the bottom toolbar (and the panel rail), shown only when
 *   navigator.xr reports immersive-vr (checked again on devicechange).
 * - Enter: ends walk mode, camera flights, gizmo and measuring; switches to
 *   the VR profile (no HDR, MSAA, post-processing, shadows, atmosphere, sky,
 *   sun, moon, eye dome lighting); stands on the ground below the camera.
 * - Exit: Y (left controller) held 1 s, the system menu, or the button on the
 *   monitor; restores camera, render loop and every changed setting.
 * - Right trigger: fps label in front of the eyes on/off.
 *
 * Uses private Cesium parts (scene.context._gl, frustum offsets, the stereo
 * path of scene.useWebVR) — check after every Cesium update.
 * ?xr=emulate (localhost only): Meta's IWER emulates a Quest 3 without headset.
 */
(function() {
  'use strict';

  var EYE_HEIGHT = 1.6;   // m above the ground for local-floor
  var NEAR = 0.2;         // m
  var SCALE_KEY = 'geobim.xr.scale';
  var DEFAULT_SCALE = 0.6;
  var EXIT_HOLD_MS = 1000;

  var viewer, scene, gl;
  var xr = null;          // active session state
  var supported = false;
  var btn = null, overlay = null;

  function status(text, type) {
    if (window.BimViewer && typeof BimViewer.updateStatus === 'function') BimViewer.updateStatus(text, type || 'info');
    console.log('[webxr] ' + text);
  }

  function getScale() {
    var v;
    try { v = parseFloat(localStorage.getItem(SCALE_KEY)); } catch (e) {}
    return v >= 0.3 && v <= 1 ? v : DEFAULT_SCALE;
  }

  function setScale(v) {
    v = Math.min(1, Math.max(0.3, +v || DEFAULT_SCALE));
    try { localStorage.setItem(SCALE_KEY, String(v)); } catch (e) {}
    return v;
  }

  // ---------------------------------------------------------------------------
  // Reference frame: ENU at the start position, rotated by the camera heading.
  // XR local-floor: x right, y up, -z forward.
  // ---------------------------------------------------------------------------
  function groundHeight(carto) {
    var h;
    try { h = scene.sampleHeightSupported ? scene.sampleHeight(carto) : undefined; } catch (e) {}
    if (h === undefined) h = scene.globe.getHeight(carto);
    return h;
  }

  function makeFrame() {
    var cam = viewer.camera;
    var carto = Cesium.Cartographic.clone(cam.positionCartographic);
    var ground = groundHeight(carto);
    var height = ground !== undefined && ground < carto.height ? ground : carto.height - EYE_HEIGHT;
    var origin = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, height);
    var enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
    var east = Cesium.Matrix4.getColumn(enu, 0, new Cesium.Cartesian4());
    var north = Cesium.Matrix4.getColumn(enu, 1, new Cesium.Cartesian4());
    var up = Cesium.Matrix4.getColumn(enu, 2, new Cesium.Cartesian4());
    var h = cam.heading; // compass: 0 = north, clockwise
    var c = Math.cos(h), s = Math.sin(h);
    return {
      origin: origin,
      right: new Cesium.Cartesian3(east.x * c - north.x * s, east.y * c - north.y * s, east.z * c - north.z * s),
      up: new Cesium.Cartesian3(up.x, up.y, up.z),
      fwd: new Cesium.Cartesian3(north.x * c + east.x * s, north.y * c + east.y * s, north.z * c + east.z * s)
    };
  }

  // XR reference-space vector → world vector
  function toWorldVec(f, x, y, z, out) {
    out.x = f.right.x * x + f.up.x * y - f.fwd.x * z;
    out.y = f.right.y * x + f.up.y * y - f.fwd.y * z;
    out.z = f.right.z * x + f.up.z * y - f.fwd.z * z;
    return out;
  }

  // ---------------------------------------------------------------------------
  // Asymmetric eye frusta. Cesium's PerspectiveFrustum.clone does not copy
  // xOffset/yOffset, and Scene moves `near` per frustum: the offsets are kept
  // as ratios of near via accessor properties on the frustum and every clone
  // (else double vision in the headset). Undone on exit.
  // ---------------------------------------------------------------------------
  var asymFrusta = [];

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

  // Projection of one XRView as tangents of its frustum edges
  function viewTans(view) {
    var p = view.projectionMatrix;
    return {
      right: (1 + p[8]) / p[0], left: (p[8] - 1) / p[0],
      top: (1 + p[9]) / p[5], bottom: (p[9] - 1) / p[5]
    };
  }

  var tmpV = new Cesium.Cartesian3(), tmpD = new Cesium.Cartesian3(), tmpU = new Cesium.Cartesian3();
  var tmpL = new Cesium.Cartesian3(), tmpR = new Cesium.Cartesian3();

  function orientCamera(f, m) {
    var cam = viewer.camera;
    toWorldVec(f, -m[8], -m[9], -m[10], tmpD);           // view -z
    Cesium.Cartesian3.normalize(tmpD, cam.direction);
    toWorldVec(f, m[4], m[5], m[6], tmpU);               // view +y
    Cesium.Cartesian3.normalize(tmpU, cam.up);
    Cesium.Cartesian3.cross(cam.direction, cam.up, cam.right);
    Cesium.Cartesian3.normalize(cam.right, cam.right);
  }

  function setFov(t) {
    var fr = viewer.camera.frustum;
    var hw = (t.right - t.left) / 2, hh = (t.top - t.bottom) / 2;
    fr.aspectRatio = hw / hh;
    fr.fov = 2 * Math.atan(fr.aspectRatio >= 1 ? hw : hh);
    fr.near = NEAR;
    return fr;
  }

  // One eye (fallback when the session does not give exactly two views)
  function setEyeCamera(f, view) {
    var m = view.transform.matrix;
    toWorldVec(f, m[12], m[13], m[14], tmpV);
    Cesium.Cartesian3.add(f.origin, tmpV, viewer.camera.position);
    orientCamera(f, m);
    var t = viewTans(view);
    makeAsymmetric(setFov(t), (t.right + t.left) / 2, (t.top + t.bottom) / 2);
  }

  // Single pass: camera at the midpoint of both eyes, oriented like the left
  // eye. Cesium's stereo path renders the left half at
  // position + right·eyeSeparation/2 with xOffset = 0.5·eyeSeparation·near/fo
  // (fo = near·focalLength), the right half mirrored. eyeSeparation = −IPD
  // puts the left eye left; focalLength makes the offset match the left
  // eye's frustum asymmetry (the right one is its mirror image on headsets).
  function setStereoCamera(f, left, right) {
    var mL = left.transform.matrix, mR = right.transform.matrix;
    toWorldVec(f, mL[12], mL[13], mL[14], tmpL);
    toWorldVec(f, mR[12], mR[13], mR[14], tmpR);
    var ipd = Cesium.Cartesian3.distance(tmpL, tmpR);
    Cesium.Cartesian3.add(f.origin, Cesium.Cartesian3.midpoint(tmpL, tmpR, tmpV), viewer.camera.position);
    orientCamera(f, mL);
    var t = viewTans(left);
    var xRatioL = (t.right + t.left) / 2;
    // culling of the shared pass uses the symmetric centre frustum
    makeAsymmetric(setFov(t), 0, (t.top + t.bottom) / 2);
    scene.eyeSeparation = -ipd;
    scene.focalLength = Math.abs(xRatioL) > 1e-6 ? -ipd / (2 * NEAR * xRatioL) : 1e9;
  }

  function sizeCanvas(w, h) {
    var c = scene.canvas;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  // ---------------------------------------------------------------------------
  // VR profile: everything that costs extra full-screen passes goes off and
  // comes back on exit
  // ---------------------------------------------------------------------------
  function eachTileset(fn) {
    var p = scene.primitives;
    for (var i = 0; i < p.length; i++) {
      var prim = p.get(i);
      if (prim instanceof Cesium.Cesium3DTileset) fn(prim);
    }
  }

  function applyProfile() {
    var saved = {
      highDynamicRange: scene.highDynamicRange, msaaSamples: scene.msaaSamples,
      requestRenderMode: scene.requestRenderMode, shadows: scene.shadowMap.enabled,
      skyAtmosphere: scene.skyAtmosphere && scene.skyAtmosphere.show,
      groundAtmosphere: scene.globe.showGroundAtmosphere,
      skyBox: scene.skyBox && scene.skyBox.show, sun: scene.sun && scene.sun.show, moon: scene.moon && scene.moon.show,
      backgroundColor: Cesium.Color.clone(scene.backgroundColor),
      fxaa: scene.postProcessStages.fxaa.enabled,
      ao: scene.postProcessStages.ambientOcclusion.enabled, bloom: scene.postProcessStages.bloom.enabled,
      stages: [], edl: []
    };
    scene.highDynamicRange = false;
    scene.msaaSamples = 1;
    scene.requestRenderMode = false;
    scene.shadowMap.enabled = false;
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
    scene.globe.showGroundAtmosphere = false;
    if (scene.skyBox) scene.skyBox.show = false;
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
    scene.backgroundColor = Cesium.Color.fromCssColorString('#9ec3dc'); // plain sky
    scene.postProcessStages.fxaa.enabled = false;
    scene.postProcessStages.ambientOcclusion.enabled = false;
    scene.postProcessStages.bloom.enabled = false;
    var stages = scene.postProcessStages;
    for (var i = 0; i < stages.length; i++) {
      var st = stages.get(i);
      saved.stages.push([st, st.enabled]);
      st.enabled = false;
    }
    eachTileset(function(ts) {
      if (ts.pointCloudShading && ts.pointCloudShading.eyeDomeLighting) {
        saved.edl.push(ts);
        ts.pointCloudShading.eyeDomeLighting = false;
      }
    });
    return saved;
  }

  function restoreProfile(s) {
    scene.highDynamicRange = s.highDynamicRange;
    scene.msaaSamples = s.msaaSamples;
    scene.requestRenderMode = s.requestRenderMode;
    scene.shadowMap.enabled = s.shadows;
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = s.skyAtmosphere;
    scene.globe.showGroundAtmosphere = s.groundAtmosphere;
    if (scene.skyBox) scene.skyBox.show = s.skyBox;
    if (scene.sun) scene.sun.show = s.sun;
    if (scene.moon) scene.moon.show = s.moon;
    scene.backgroundColor = s.backgroundColor;
    scene.postProcessStages.fxaa.enabled = s.fxaa;
    scene.postProcessStages.ambientOcclusion.enabled = s.ao;
    scene.postProcessStages.bloom.enabled = s.bloom;
    s.stages.forEach(function(e) { if (!e[0].isDestroyed()) e[0].enabled = e[1]; });
    s.edl.forEach(function(ts) { if (!ts.isDestroyed()) ts.pointCloudShading.eyeDomeLighting = true; });
  }

  // ---------------------------------------------------------------------------
  // Session
  // ---------------------------------------------------------------------------
  async function enter() {
    if (xr) return;
    if (!supported) { status('VR is not available here', 'error'); return; }
    viewer = BimViewer.viewer;
    scene = viewer.scene;
    gl = scene.context._gl; // private: the WebGL context the XR layer must share
    if (!(gl instanceof WebGL2RenderingContext)) { status('VR needs WebGL2', 'error'); return; }

    if (typeof BimViewer.deactivateAllTools === 'function') { try { BimViewer.deactivateAllTools(); } catch (e) {} }
    if (BimViewer.isCameraFlightActive && BimViewer.isCameraFlightActive()) BimViewer.stopCameraFlight();

    var scale = getScale();
    var session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    var refSpace, step = 'makeXRCompatible';
    // Any failure from here on must end the session, or it stays open in the
    // headset ("loading") and blocks every further requestSession
    try {
      if (gl.makeXRCompatible) await gl.makeXRCompatible();
      step = 'XRWebGLLayer';
      var layer = new XRWebGLLayer(session, gl, { antialias: false, framebufferScaleFactor: scale });
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
      session: session, refSpace: refSpace, frame: makeFrame(), scale: scale,
      saved: {
        position: Cesium.Cartesian3.clone(cam.position), direction: Cesium.Cartesian3.clone(cam.direction),
        up: Cesium.Cartesian3.clone(cam.up), right: Cesium.Cartesian3.clone(cam.right), frustum: cam.frustum.clone(),
        profile: applyProfile(), inputs: scene.screenSpaceCameraController.enableInputs
      },
      frames: 0, renderMs: 0, lastReport: performance.now(), fps: 0, exitHeld: 0, showFps: false
    };
    scene.screenSpaceCameraController.enableInputs = false;
    viewer.useDefaultRenderLoop = false;
    scene.useWebVR = true; // private-ish: Cesium's side-by-side stereo path
    xr.labels = scene.primitives.add(new Cesium.LabelCollection());
    xr.fpsLabel = xr.labels.add({
      text: '', show: false, font: '28px sans-serif', fillColor: Cesium.Color.fromCssColorString('#2ECFB0'),
      outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY, scale: 0.5
    });

    session.addEventListener('end', onEnd);
    session.addEventListener('selectstart', function(ev) {
      if (ev.inputSource.handedness === 'right' && xr) { xr.showFps = !xr.showFps; xr.fpsLabel.show = xr.showFps; }
    });
    setActiveUI(true);
    status('VR active — hold Y on the left controller to exit', 'success');
    if (typeof plausible !== 'undefined') plausible('Feature Used', { props: { feature: 'VR' } });
    session.requestAnimationFrame(onFrame);
  }

  function exit() {
    if (xr) return xr.session.end().catch(function() { onEnd(); });
  }

  // A render error repeats every frame: report the first one and end the
  // session instead of leaving the headset on "loading"
  function onFrame(t, frame) {
    if (!xr) return;
    try {
      renderFrame(frame);
    } catch (e) {
      console.error('[webxr] frame failed', e);
      var msg = 'VR stopped: ' + e.message;
      xr.session.end().catch(function() {});
      setTimeout(function() { status(msg, 'error'); }, 0);
    }
  }

  function pollInput(session) {
    var held = false;
    session.inputSources.forEach(function(src) {
      // xr-standard: buttons[5] = B / Y
      if (src.handedness === 'left' && src.gamepad && src.gamepad.buttons[5] && src.gamepad.buttons[5].pressed) held = true;
    });
    var now = performance.now();
    if (!held) { xr.exitHeld = 0; return; }
    if (!xr.exitHeld) xr.exitHeld = now;
    else if (now - xr.exitHeld > EXIT_HOLD_MS) { xr.exitHeld = 0; session.end(); }
  }

  function renderFrame(frame) {
    var session = frame.session;
    session.requestAnimationFrame(onFrame);
    pollInput(session);
    var layer = session.renderState.baseLayer;
    var target = layer.framebuffer; // null in emulators: draw straight into the canvas
    var pose = frame.getViewerPose(xr.refSpace);
    if (!pose) {
      // tracking not ready: still hand the compositor a frame
      if (target) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target);
        gl.clearColor(0.1, 0.1, 0.12, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      return;
    }
    var t0 = performance.now();
    viewer.clock.tick();
    scene.initializeFrame();
    var time = viewer.clock.currentTime;
    placeFpsLabel(pose);

    var views = pose.views;
    scene.useWebVR = views.length === 2;
    if (views.length === 2) {
      var iL = views[0].eye === 'right' ? 1 : 0, vL = views[iL], vR = views[1 - iL];
      var vpL, vpR;
      if (target) {
        vpL = layer.getViewport(vL); vpR = layer.getViewport(vR);
      } else {
        // The emulated layer derives its viewport from the canvas size, which
        // this module doubles: keep the first one
        if (!xr.emuVp) { var v0 = layer.getViewport(vL); xr.emuVp = { width: v0.width, height: v0.height }; }
        vpL = { x: 0, y: 0, width: xr.emuVp.width, height: xr.emuVp.height };
        vpR = { x: vpL.width, y: 0, width: vpL.width, height: vpL.height };
      }
      var w2 = vpL.width + vpR.width, h = vpL.height;
      sizeCanvas(w2, h);
      setStereoCamera(xr.frame, vL, vR);
      scene.render(time); // both eyes, side by side
      if (target) blitStereo(target, vpL, vpR, w2, h);
    } else {
      // not a stereo headset: one full render per view
      views.forEach(function(view) {
        var vp = layer.getViewport(view);
        sizeCanvas(vp.width, vp.height);
        setEyeCamera(xr.frame, view);
        scene.render(time);
        if (target) blit(null, target, 0, 0, vp.width, vp.height, vp.x, vp.y);
      });
    }
    xr.renderMs += performance.now() - t0;
    xr.frames++;
    report();
  }

  function blit(read, draw, sx, sy, w, h, dx, dy) {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
    gl.blitFramebuffer(sx, sy, sx + w, sy + h, dx, dy, dx + w, dy + h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); // Cesium expects the default framebuffer bound
  }

  // Canvas (both eyes side by side) → XR framebuffer. The app's canvas may be
  // multisampled (context antialias); a blit out of a multisampled buffer must
  // keep its rectangle, so other layouts resolve into an own buffer first.
  function blitStereo(target, vpL, vpR, w2, h) {
    var sideBySide = vpL.x === 0 && vpL.y === 0 && vpR.x === vpL.width && vpR.y === 0 && vpR.height === h;
    if (sideBySide) { blit(null, target, 0, 0, w2, h, 0, 0); return; }
    var src = null;
    if (gl.getContextAttributes().antialias) {
      src = resolveBuffer(w2, h);
      blit(null, src, 0, 0, w2, h, 0, 0);
    }
    blit(src, target, 0, 0, vpL.width, h, vpL.x, vpL.y);
    blit(src, target, vpL.width, 0, vpR.width, h, vpR.x, vpR.y);
  }

  function resolveBuffer(w, h) {
    var r = xr.resolve;
    if (r && r.w === w && r.h === h) return r.fb;
    if (r) { gl.deleteFramebuffer(r.fb); gl.deleteRenderbuffer(r.rb); }
    var fb = gl.createFramebuffer(), rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    xr.resolve = { fb: fb, rb: rb, w: w, h: h };
    return fb;
  }

  function placeFpsLabel(pose) {
    if (!xr.showFps) return;
    var m = pose.transform.matrix;
    // 2 m in front of the head, a bit below eye level
    var x = m[12] - m[8] * 2, y = m[13] - m[9] * 2 - 0.3, z = m[14] - m[10] * 2;
    xr.fpsLabel.position = Cesium.Cartesian3.add(xr.frame.origin, toWorldVec(xr.frame, x, y, z, new Cesium.Cartesian3()), new Cesium.Cartesian3());
  }

  function report() {
    var now = performance.now();
    if (now - xr.lastReport < 1000) return;
    xr.fps = xr.frames / ((now - xr.lastReport) / 1000);
    var ms = xr.renderMs / Math.max(1, xr.frames);
    xr.fpsLabel.text = xr.fps.toFixed(0) + ' fps · ' + ms.toFixed(0) + ' ms';
    if (overlay) overlay.querySelector('.xr-overlay-stats').textContent = xr.fps.toFixed(0) + ' fps · ' + ms.toFixed(1) + ' ms CPU · scale ' + xr.scale;
    xr.frames = 0; xr.renderMs = 0; xr.lastReport = now;
  }

  function onEnd() {
    if (!xr) return;
    var s = xr.saved, cam = viewer.camera;
    scene.useWebVR = false;
    scene.eyeSeparation = undefined;
    scene.focalLength = undefined;
    undoAsymmetric();
    cam.frustum = s.frustum;
    Cesium.Cartesian3.clone(s.position, cam.position);
    Cesium.Cartesian3.clone(s.direction, cam.direction);
    Cesium.Cartesian3.clone(s.up, cam.up);
    Cesium.Cartesian3.clone(s.right, cam.right);
    restoreProfile(s.profile);
    if (xr.resolve) { gl.deleteFramebuffer(xr.resolve.fb); gl.deleteRenderbuffer(xr.resolve.rb); }
    if (!xr.labels.isDestroyed()) scene.primitives.remove(xr.labels);
    scene.screenSpaceCameraController.enableInputs = s.inputs;
    xr = null;
    viewer.useDefaultRenderLoop = true;
    viewer.resize();
    setActiveUI(false);
    status('VR ended', 'success');
  }

  // ---------------------------------------------------------------------------
  // UI: toolbar button, monitor overlay while in VR
  // ---------------------------------------------------------------------------
  function setActiveUI(on) {
    if (btn) {
      btn.classList.toggle('active', on);
      btn.title = on ? 'Exit VR' : 'Enter VR (WebXR headset)';
    }
    if (on && !overlay) {
      overlay = document.createElement('div');
      overlay.className = 'xr-overlay';
      overlay.innerHTML =
        '<div class="xr-overlay-card">' +
          '<i data-lucide="glasses"></i>' +
          '<div class="xr-overlay-title">VR active in the headset</div>' +
          '<div class="xr-overlay-hint">Exit: hold Y on the left controller · Right trigger: fps</div>' +
          '<div class="xr-overlay-stats"></div>' +
          '<button type="button" class="xr-overlay-btn">Exit VR</button>' +
        '</div>';
      overlay.querySelector('.xr-overlay-btn').addEventListener('click', exit);
      document.body.appendChild(overlay);
      if (window.lucide) lucide.createIcons();
    }
    if (overlay) overlay.classList.toggle('visible', on);
  }

  function showButton() {
    if (btn) btn.style.display = supported ? '' : 'none';
  }

  // Next to Walk; the toolbar is built by ui.js. Runs from a MutationObserver
  // so the button exists before the panel UI copies the toolbar actions.
  function addButton() {
    var bar = document.getElementById('bottomToolbar');
    var walk = document.getElementById('bottomWalkBtn');
    if (!bar || !walk) return false;
    if (document.getElementById('bottomVrBtn')) return true;
    btn = document.createElement('button');
    btn.className = 'bottom-toolbar-btn';
    btn.id = 'bottomVrBtn';
    btn.title = 'Enter VR (WebXR headset)';
    btn.innerHTML = '<i data-lucide="glasses"></i><span class="bottom-toolbar-label">VR</span>';
    btn.addEventListener('click', function() {
      btn.blur();
      if (xr) exit();
      else enter().catch(function(e) { console.error(e); status('VR failed: ' + e.message, 'error'); });
    });
    showButton();
    bar.insertBefore(btn, walk.nextSibling);
    if (window.lucide) lucide.createIcons();
    return true;
  }

  async function checkSupport() {
    try { supported = !!navigator.xr && await navigator.xr.isSessionSupported('immersive-vr'); }
    catch (e) { supported = false; }
    showButton();
  }

  async function installEmulator() {
    // Meta's Immersive Web Emulation Runtime, Quest 3 with Touch controllers
    var iwer = await import('https://cdn.jsdelivr.net/npm/iwer@2.5.0/+esm');
    var device = new iwer.XRDevice(iwer.metaQuest3);
    device.installRuntime({ forceInstall: true }); // Chrome has its own navigator.xr
    device.position.set(0, EYE_HEIGHT, 0);
    window.BimXREmulator = device;
  }

  async function init() {
    var bar = document.getElementById('bottomToolbar');
    if (bar && !addButton()) {
      var obs = new MutationObserver(function() { if (addButton()) obs.disconnect(); });
      obs.observe(bar, { childList: true });
    }
    var local = ['localhost', '127.0.0.1'].indexOf(location.hostname) !== -1;
    if (local && new URLSearchParams(location.search).get('xr') === 'emulate') {
      try { await installEmulator(); } catch (e) { console.warn('[webxr] emulator not loaded', e); }
    }
    if (!navigator.xr) return;
    await checkSupport();
    // A headset connected later (Quest Link started after loading)
    navigator.xr.addEventListener('devicechange', checkSupport);
  }

  window.BimXR = {
    isSupported: function() { return supported; },
    isActive: function() { return !!xr; },
    enter: enter,
    exit: exit,
    getScale: getScale,
    setScale: setScale
  };

  init();
})();
