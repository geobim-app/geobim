/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// ===============================
// CLIPPING PLANES GUARD — workaround for a CesiumJS 1.145 crash
// ===============================
// `tileset.clippingPlanes = undefined` (or another collection) destroys the old
// ClippingPlaneCollection and its texture at once. When a style hides features
// (IFC filter, isolate, sequencing, construction schedule), Cesium still draws
// one frame with a command that samples that texture: "Cannot read properties
// of undefined (reading '_target')" and rendering stops. Reproduced with the
// alignment section and any `show` style. The guard keeps a replaced collection
// alive for two more frames, then destroys it as before.
'use strict';

(function() {
  if (typeof Cesium === 'undefined' || !Cesium.ClippingPlaneCollection) return;

  var proto = Cesium.ClippingPlaneCollection.prototype;
  var destroyNow = proto.destroy;
  var FRAMES = 2;

  proto.destroy = function() {
    var scene = window.BimViewer && BimViewer.viewer && BimViewer.viewer.scene;
    if (!scene || scene.isDestroyed()) return destroyNow.call(this);
    if (this._geobimDestroyPending) return;
    this._geobimDestroyPending = true;
    this.enabled = false;
    var self = this, frames = 0;
    var remove = scene.postRender.addEventListener(function() {
      if (++frames < FRAMES) return;
      remove();
      if (!self.isDestroyed()) destroyNow.call(self);
    });
  };
})();
