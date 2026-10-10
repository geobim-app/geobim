/**
 * geobim.app — Panel UI (beta)
 *
 * Alternative layout: icon rail + floating tool panels, loaded only when
 * panels-ui-loader.js picks it (?ui=panels or beta.geobim.app). Moves the
 * existing .modern-section-content nodes into panels instead of rebuilding
 * them, so every section's logic and data stay shared with the classic UI.
 *
 * Step 2 (switch): placeholder only — marks the page and waits for the
 * classic UI. Rail and panels follow in step 3.
 */
(function() {
  'use strict';

  window.BimPanelsUI = {
    active: true,
    ready: false
  };

  // BimViewerUI.init() runs ~100 ms after load; wait until its sections exist
  var tries = 0;
  var wait = setInterval(function() {
    tries++;
    var built = document.querySelector('#toolbar .modern-section');
    if (!built && tries < 300) return;
    clearInterval(wait);
    if (!built) {
      console.warn('Panel UI: classic sections not found, staying on the sidebar');
      return;
    }
    BimPanelsUI.ready = true;
    console.log('✅ Panel UI (beta) loaded — rail and panels follow in step 3');
  }, 100);
})();
