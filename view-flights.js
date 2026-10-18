/**
 * geoBIM.app
 * © 2026 Christof Lorenz. All rights reserved.
 *
 * Licensed under the Business Source License 1.1 (BSL 1.1)
 * Non-commercial use, evaluation, research, and education permitted.
 * Commercial use requires written permission.
 * Contact: info@geobim.app
 *
 * Change Date: 2030-03-01 — converts to MIT License
 */
// ===============================
// VIEW FLIGHTS v1.0 — keys 1-9 for saved views and camera flights
//   Keys 1-9 load the saved view in that slot (features.js loadView), not
//   while walking, measuring, placing a comment or typing. A new view without
//   a slot takes the lowest free slot 1-9, so the keys keep reaching it;
//   only when all nine are used it continues at nextViewSlot (10, 11 … are
//   loaded from the list only).
//   Camera flights ("Camera flight" block in Saved Views):
//     Orbit    — one full turn around the view centre or an asset
//     Fly over — a straight pass over the view centre or an asset
//     Tour     — flies through the saved views in slot order
//   The duration is selectable. Esc, Stop, a click / drag / wheel in the
//   view, walk mode and unloading an asset end a flight. Orbit uses
//   camera.lookAt, so every end releases it with lookAtTransform(IDENTITY)
//   (as in gis-track-player.js) — otherwise the mouse keeps orbiting the
//   old point.
// ===============================
'use strict';

(function() {

  var flight = null;   // { mode, tick, stop, assetCount, timer }

  function viewer() { return BimViewer.viewer; }

  function walking() {
    return (window.BimFirstPerson && BimFirstPerson.isActive()) ||
           (window.BimThirdPerson && BimThirdPerson.isActive());
  }

  function busy() {
    try { if (BimViewer.isMeasuring && BimViewer.isMeasuring()) return true; } catch (e) {}
    return !!(BimViewer.comments && BimViewer.comments.isAddingComment);
  }

  function typing(t) {
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' ||
                 t.tagName === 'BUTTON' || t.isContentEditable);
  }

  // =====================================
  // KEYS 1-9
  // =====================================

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && flight) {
      stopFlight('Camera flight stopped');
      return;
    }
    if (!/^[1-9]$/.test(e.key) || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    if (typing(e.target) || walking() || busy()) return;
    if (!BimViewer.viewer || !BimViewer.savedViews) return;
    var slot = Number(e.key);
    e.preventDefault();
    if (!BimViewer.savedViews.has(slot)) {
      BimViewer.updateStatus('No view saved in slot ' + slot, 'warning');
      return;
    }
    if (flight) stopFlight();
    BimViewer.loadView(slot);
  });

  // Lowest free slot 1-9 for a new view (features.js counts up forever)
  var origSaveView = BimViewer.saveView;
  if (typeof origSaveView === 'function') {
    BimViewer.saveView = function(slot) {
      if (slot === null || slot === undefined) {
        for (var i = 1; i <= 9; i++) {
          if (!this.savedViews.has(i)) return origSaveView.call(this, i);
        }
        // All nine used: continue after the highest slot, never overwrite one
        var max = Math.max.apply(null, Array.from(this.savedViews.keys()));
        this.nextViewSlot = Math.max(this.nextViewSlot, max + 1);
      }
      return origSaveView.call(this, slot === undefined ? null : slot);
    };
  }

  // =====================================
  // FLIGHT CENTRE
  // =====================================

  // Point under the screen centre: 3D content / terrain, else the ellipsoid,
  // else 500 m ahead
  function viewCentre() {
    var v = viewer(), scene = v.scene, canvas = scene.canvas;
    var c = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
    var p;
    try { if (scene.pickPositionSupported) p = scene.pickPosition(c); } catch (e) { p = null; }
    if (!p || !isFinite(p.x)) {
      var ray = v.camera.getPickRay(c);
      p = ray && scene.globe && scene.globe.show ? scene.globe.pick(ray, scene) : null;
    }
    if (!p) p = v.camera.pickEllipsoid(c);
    if (!p) {
      p = Cesium.Cartesian3.add(v.camera.position,
        Cesium.Cartesian3.multiplyByScalar(v.camera.direction, 500, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    }
    return { center: p, radius: 0 };
  }

  function assetSphere(a) {
    var s = null;
    try {
      if (a.tileset && a.tileset.boundingSphere) s = a.tileset.boundingSphere;
      else if (a.model && a.model.boundingSphere) s = a.model.boundingSphere;
    } catch (e) { s = null; }
    return s && isFinite(s.center.x) && s.radius > 0 ? s : null;
  }

  function flightCentre(target) {
    if (target && target !== 'view') {
      var a = BimViewer.loadedAssets.get(target);
      var s = a && assetSphere(a);
      if (s) return { center: s.center, radius: s.radius };
    }
    return viewCentre();
  }

  // Camera position in the east-north-up frame of the centre
  function localFrame(center) {
    var toWorld = Cesium.Transforms.eastNorthUpToFixedFrame(center);
    var toLocal = Cesium.Matrix4.inverseTransformation(toWorld, new Cesium.Matrix4());
    return { toWorld: toWorld, toLocal: toLocal };
  }

  // =====================================
  // FLIGHTS
  // =====================================

  function smooth(t) { return t * t * (3 - 2 * t); }

  function startOrbit(target, seconds) {
    var v = viewer(), cam = v.camera;
    var c = flightCentre(target);
    var f = localFrame(c.center);
    var off = Cesium.Matrix4.multiplyByPoint(f.toLocal, cam.position, new Cesium.Cartesian3());
    var range = Cesium.Cartesian3.magnitude(off);
    // An asset fills the view: not closer than 1.5 and not farther than 4 radii
    if (c.radius > 0) range = Math.min(Math.max(range, c.radius * 1.5), c.radius * 4);
    range = Math.max(range, 20);
    // Look down on the centre at 10°-80°
    var horiz = Math.hypot(off.x, off.y) || 1;
    var pitch = Math.atan2(off.z, horiz);
    pitch = Math.min(Math.max(pitch, Cesium.Math.toRadians(10)), Cesium.Math.toRadians(80));
    var heading0 = Math.atan2(off.x, off.y);
    var start = null;
    return {
      tick: function(now) {
        if (start === null) start = now;
        var t = (now - start) / 1000 / seconds;
        if (t >= 1) return false;
        var hd = heading0 + t * Cesium.Math.TWO_PI;
        var o = new Cesium.Cartesian3(
          Math.sin(hd) * Math.cos(pitch) * range,
          Math.cos(hd) * Math.cos(pitch) * range,
          Math.sin(pitch) * range);
        cam.lookAt(c.center, o);
        return true;
      }
    };
  }

  function startFlyover(target, seconds) {
    var v = viewer(), cam = v.camera;
    var c = flightCentre(target);
    var f = localFrame(c.center);
    var off = Cesium.Matrix4.multiplyByPoint(f.toLocal, cam.position, new Cesium.Cartesian3());
    var heading = cam.heading;
    var half = c.radius > 0 ? Math.max(c.radius * 2, 100) : Math.min(Math.max(Math.hypot(off.x, off.y), 150), 5000);
    var alt = c.radius > 0 ? Math.max(c.radius * 1.2, 60) : Math.max(Math.min(off.z, half), half * 0.35, 60);
    var dx = Math.sin(heading), dy = Math.cos(heading);
    var pitch = -Math.atan2(alt, half) * 0.8;
    var start = null;
    return {
      tick: function(now) {
        if (start === null) start = now;
        var t = (now - start) / 1000 / seconds;
        if (t >= 1) return false;
        var s = -half + 2 * half * smooth(t);
        var local = new Cesium.Cartesian3(dx * s, dy * s, alt);
        cam.setView({
          destination: Cesium.Matrix4.multiplyByPoint(f.toWorld, local, new Cesium.Cartesian3()),
          orientation: { heading: heading, pitch: pitch, roll: 0 }
        });
        return true;
      }
    };
  }

  function startTour(seconds) {
    var cam = viewer().camera;
    var slots = Array.from(BimViewer.savedViews.keys()).sort(function(a, b) { return a - b; });
    if (slots.length < 2) {
      BimViewer.updateStatus('A tour needs at least two saved views', 'warning');
      return null;
    }
    var leg = Math.max(2, seconds / slots.length);
    var i = 0, waiting = true, timer = null, done = false;
    function next() {
      if (done) return;
      if (i >= slots.length) { done = true; return; }
      var vs = BimViewer.savedViews.get(slots[i++]);
      if (!vs) { next(); return; }
      waiting = true;
      BimViewer.updateStatus('Tour: view ' + slots[i - 1] + ' (' + i + '/' + slots.length + ')', 'info');
      cam.flyTo({
        destination: vs.position,
        orientation: { direction: vs.direction, up: vs.up },
        duration: leg * 0.75,
        complete: function() { timer = setTimeout(next, leg * 250); },
        cancel: function() { done = true; }
      });
    }
    next();
    return {
      tick: function() { return !done; },
      cleanup: function() {
        done = true;
        if (timer) clearTimeout(timer);
        if (waiting) cam.cancelFlight();
      }
    };
  }

  function onPreRender() {
    if (!flight) return;
    if (walking() || BimViewer.loadedAssets.size < flight.assetCount) {
      stopFlight(walking() ? null : 'Camera flight stopped (asset unloaded)');
      return;
    }
    flight.assetCount = BimViewer.loadedAssets.size;
    var go;
    try { go = flight.tick(performance.now()); } catch (e) { console.warn('Camera flight:', e); go = false; }
    if (!go) stopFlight('Camera flight finished');
    else viewer().scene.requestRender();
  }

  // A click, drag or wheel in the view takes the camera back
  function onUserInput() { if (flight) stopFlight('Camera flight stopped'); }

  BimViewer.startCameraFlight = function(mode, target, seconds) {
    if (!this.viewer) return false;
    if (walking()) {
      this.updateStatus('Leave walk mode first', 'warning');
      return false;
    }
    if (flight) stopFlight();
    seconds = Math.max(3, Number(seconds) || 30);
    var f = mode === 'orbit' ? startOrbit(target, seconds)
          : mode === 'flyover' ? startFlyover(target, seconds)
          : mode === 'tour' ? startTour(seconds) : null;
    if (!f) return false;
    f.mode = mode;
    f.assetCount = this.loadedAssets.size;
    flight = f;
    var v = this.viewer;
    v.scene.preRender.addEventListener(onPreRender);
    v.canvas.addEventListener('pointerdown', onUserInput);
    v.canvas.addEventListener('wheel', onUserInput, { passive: true });
    updateButton();
    if (mode !== 'tour') this.updateStatus('Camera flight — Esc to stop', 'info');
    return true;
  };

  function stopFlight(message) {
    var f = flight;
    if (!f) return;
    flight = null;
    var v = viewer();
    v.scene.preRender.removeEventListener(onPreRender);
    v.canvas.removeEventListener('pointerdown', onUserInput);
    v.canvas.removeEventListener('wheel', onUserInput);
    try { if (f.cleanup) f.cleanup(); } catch (e) {}
    // Release camera.lookAt — always, whatever the mode
    v.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    updateButton();
    if (message) BimViewer.updateStatus(message, 'info');
  }

  BimViewer.stopCameraFlight = function() { stopFlight('Camera flight stopped'); };
  BimViewer.isCameraFlightActive = function() { return !!flight; };

  // =====================================
  // UI (block in the Saved Views section, ui-views-section.js)
  // =====================================

  function fillTargets() {
    var sel = document.getElementById('flightTargetSelect');
    if (!sel) return;
    var current = sel.value;
    var opts = ['<option value="view">View centre</option>'];
    BimViewer.loadedAssets.forEach(function(a, id) {
      if (!assetSphere(a)) return;
      var name = String(a.name || id).replace(/[&<>"']/g, function(ch) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
      });
      opts.push('<option value="' + String(id).replace(/"/g, '&quot;') + '">' + name + '</option>');
    });
    sel.innerHTML = opts.join('');
    sel.value = Array.prototype.some.call(sel.options, function(o) { return o.value === current; }) ? current : 'view';
  }

  function updateMode() {
    var mode = document.getElementById('flightModeSelect');
    var row = document.getElementById('flightTargetRow');
    if (mode && row) row.hidden = mode.value === 'tour';
  }

  function updateButton() {
    var btn = document.getElementById('flightStartBtn');
    if (!btn) return;
    btn.classList.toggle('active', !!flight);
    btn.innerHTML = flight
      ? '<i data-lucide="square"></i><span>Stop flight</span>'
      : '<i data-lucide="play"></i><span>Start flight</span>';
    if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide', node: btn });
  }

  function bindUI() {
    var btn = document.getElementById('flightStartBtn');
    if (!btn) return false;
    if (btn.dataset.bound) return true;
    btn.dataset.bound = '1';
    var mode = document.getElementById('flightModeSelect');
    var target = document.getElementById('flightTargetSelect');
    var dur = document.getElementById('flightDurationSelect');
    mode && mode.addEventListener('change', updateMode);
    target && target.addEventListener('focus', fillTargets);
    target && target.addEventListener('mousedown', fillTargets);
    btn.addEventListener('click', function() {
      btn.blur();
      if (flight) { stopFlight('Camera flight stopped'); return; }
      fillTargets();
      BimViewer.startCameraFlight(mode ? mode.value : 'orbit', target ? target.value : 'view', dur ? Number(dur.value) : 30);
    });
    fillTargets();
    updateMode();
    updateButton();
    return true;
  }

  function init() {
    var tries = 0;
    (function poll() {
      if (bindUI() || ++tries > 120) return;
      setTimeout(poll, 500);
    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  console.log('✅ View flights loaded v1.0');

})();
