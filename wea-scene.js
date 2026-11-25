/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/*
 * WEA scene — the wind turbine shadow study (wea-shadow.js) inside a demo
 * scene, the same analysis /wea-shadow offers on its own.
 *
 * demo-scenes.json, per scene:
 *   "web": { "wea": { "model": "<id from api/wea-models.php>",
 *                     "replace": ["<model folder>", ...] } }
 * demo-scenes.js leaves the "replace" models (the static turbine tilesets)
 * out of the scene and calls open(): the WEA turbine loads at its default
 * position (the demo turbine's position), the camera stays where the scene
 * put it, the rotor turns, shadows go on and the WEA panel opens (on
 * phones collapsed to its title bar).
 *
 * close() (next demo scene) removes the turbine, stops the rotor, closes the
 * panel and switches shadows off again if open() switched them on. Another
 * scene can also unload the turbine (scenes.js unloadAsset): a check once a
 * second notices that and cleans up the rest.
 *
 * Uses only the public BimWEA API.
 */
window.BimWEAScene = (function() {
  'use strict';

  var CHECK_MS = 1000;
  var NODE_WAIT_MS = 15000;   // rotor node is found once the model is ready
  var PHONE = window.matchMedia('(max-width: 720px)');
  var active = null;          // { assetId, shadowsByUs, timer }

  function wea() { return window.BimWEA; }

  function panelVisible() {
    var p = document.getElementById('weaShadowPanel');
    return !!(p && p.classList.contains('visible'));
  }

  function shadowsOn() {
    var v = BimViewer.viewer;
    return !!(BimViewer.lighting && BimViewer.lighting.enabled && v && v.scene.shadowMap.enabled);
  }

  async function findModel(id) {
    var resp = await fetch('api/wea-models.php', { cache: 'no-cache' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var models = await resp.json();
    return (Array.isArray(models) ? models : []).find(function(m) { return m && m.id === id; }) || null;
  }

  // The rotor can only turn once wea-shadow.js has found the blades node
  function whenRotorReady(assetId) {
    var start = Date.now();
    return new Promise(function(resolve) {
      (function poll() {
        var inst = wea() && wea().instances[assetId];
        if (!inst) return resolve(false);
        if (inst.bladesRuntimeNode) return resolve(true);
        if (Date.now() - start > NODE_WAIT_MS) return resolve(false);
        setTimeout(poll, 200);
      })();
    });
  }

  // Resolves to true when the turbine is loaded
  async function open(cfg) {
    close();
    var W = wea();
    if (!cfg || !cfg.model || !W || typeof W.load !== 'function') return false;
    var def;
    try {
      def = await findModel(cfg.model);
    } catch (e) {
      console.warn('WEA scene: model list not available', e);
      return false;
    }
    if (!def) return false;
    def.noFlyTo = true;
    var assetId = 'glb_' + def.id;
    await W.load(def);
    if (!W.instances[assetId]) return false;

    active = { assetId: assetId, shadowsByUs: false, timer: null };
    if (!shadowsOn()) {
      W.toggleShadows();
      active.shadowsByUs = true;
    }
    if (!panelVisible()) W.toggle();
    // Phones: the open panel would cover most of the view, start with its
    // title bar; elsewhere open (also if a phone visit left it collapsed)
    var body = document.getElementById('weaPanelBody');
    if (body && body.classList.contains('collapsed') !== PHONE.matches) W.toggleCollapse();
    active.timer = setInterval(function() {
      if (active && !BimViewer.loadedAssets.has(active.assetId)) close();
    }, CHECK_MS);

    if (await whenRotorReady(assetId)) {
      var ad = BimViewer.loadedAssets.get(assetId);
      if (active && active.assetId === assetId && ad && !ad.animPlaying) W.toggleAnim(assetId);
    }
    return true;
  }

  function close() {
    if (!active) return;
    var a = active;
    active = null;
    clearInterval(a.timer);
    var W = wea();
    var inst = W && W.instances[a.assetId];
    // Rotor first, also when a scene already unloaded the model:
    // BimWEA.remove() leaves its postUpdate listener running
    if (inst && inst.assetData && inst.assetData.animPlaying) W.toggleAnim(a.assetId);
    // unloadAsset also removes the asset card, BimWEA.remove() the WEA instance
    if (BimViewer.loadedAssets.has(a.assetId)) BimViewer.unloadAsset(a.assetId);
    if (inst) W.remove(a.assetId);
    if (W && panelVisible()) W.toggle();
    if (W && a.shadowsByUs && shadowsOn()) W.toggleShadows();
  }

  return {
    open: open,
    close: close,
    isActive: function() { return !!active; }
  };
})();
