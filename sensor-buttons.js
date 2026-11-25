/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// ===============================
// SENSOR BUTTONS — where the live-sensor buttons show
// STA Live (sensorthings.js) monitors the Merendree bridge in Belgium. Its
// button shows only while a Merendree model is loaded: the ion asset
// 4452138 "Bridge Belgium (IoT)" or a model with "Merendree" in its name or
// key (demo scene: Merendree_AsBuilt / Merendree_AsDesigned). This module
// sets body.sta-site-loaded; sensor-buttons-styles.css hides the button
// otherwise. IoT Live (iot.js, Pegel Deggendorf) belongs to no scene: its
// button is hidden by CSS alone, GEOBIM_IOT.toggle() still works.
// The viewer has no load/unload event, so the loaded assets are checked
// once a second (a handful of map entries).
// ===============================
'use strict';

(function() {

  var STA_ASSET_IDS = ['4452138'];
  var STA_NAME = /merendree/i;
  var CHECK_MS = 1000;
  var siteLoaded = false;

  function isStaSite(key, asset) {
    if (STA_ASSET_IDS.indexOf(String(key)) !== -1) return true;
    if (STA_NAME.test(String(key))) return true;
    return !!(asset && asset.name && STA_NAME.test(asset.name));
  }

  function hasStaSite() {
    var assets = window.BimViewer && BimViewer.loadedAssets;
    if (!assets || typeof assets.forEach !== 'function') return false;
    var found = false;
    assets.forEach(function(asset, key) {
      if (!found && isStaSite(key, asset)) found = true;
    });
    return found;
  }

  // STA Live still on while its button goes away: switch it off
  function staIsOn() {
    var btn = document.getElementById('staToggleBtn');
    var panel = document.getElementById('sta-panel');
    return !!((btn && btn.classList.contains('active')) || (panel && panel.classList.contains('visible')));
  }

  function update() {
    if (!document.body) return;
    var now = hasStaSite();
    if (now === siteLoaded) return;
    siteLoaded = now;
    document.body.classList.toggle('sta-site-loaded', now);
    if (!now && staIsOn() && window.GEOBIM_SENSORTHINGS && typeof GEOBIM_SENSORTHINGS.hide === 'function') {
      GEOBIM_SENSORTHINGS.hide();
    }
  }

  setInterval(update, CHECK_MS);

  window.GEOBIM_SENSOR_BUTTONS = {
    update: update,
    isStaSiteLoaded: function() { return siteLoaded; }
  };

})();
