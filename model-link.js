/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// ===============================
// MODEL LINK — ?model=<folder>
// Opens a server model directly: the Rhino plugin (geobim-rhino) opens
// https://viewer.geobim.app/?model=<slug> once its upload is converted.
// Waits for the viewer (rebuilt after splash / sign-in) and the owner
// session, refreshes the model list (api/models.php), loads the model —
// self-hosted tilesets fly there themselves — and keeps the parameter, so
// the link can be bookmarked. Server models are owner only (models.php).
// ===============================
'use strict';

(function() {

  var slug = new URLSearchParams(window.location.search).get('model');
  if (!slug || !/^[a-z0-9_]+$/.test(slug)) return;

  function viewerReady(timeoutMs) {
    var start = Date.now();
    return new Promise(function(resolve) {
      (function poll() {
        var ok = window.BimViewer && BimViewer.viewer && window.LayerManager && LayerManager.viewer === BimViewer.viewer &&
          BimViewer.ownerSessionReady && typeof BimViewer.fetchGLBModels === 'function';
        if (ok || Date.now() - start > timeoutMs) return resolve(!!ok);
        setTimeout(poll, 250);
      })();
    });
  }

  async function open() {
    if (!(await viewerReady(60000))) return;
    var owner = await BimViewer.ownerSessionReady;
    if (!owner) {
      BimViewer.updateStatus('Sign in with the owner account to open model "' + slug + '"', 'warning');
      return;
    }
    var models = await BimViewer.fetchGLBModels();
    if (typeof window.syncLocalModelSelector === 'function') window.syncLocalModelSelector();
    var def = (models || []).find(function(m) { return m.id === slug; });
    if (!def) {
      BimViewer.updateStatus('Model "' + slug + '" not found on this server', 'error');
      return;
    }
    BimViewer.loadGLBAsset(def);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', open);
  else open();

})();
