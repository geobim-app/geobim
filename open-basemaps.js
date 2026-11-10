/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/*
 * More open basemaps from the BKG (Bundesamt für Kartographie und Geodäsie),
 * open data under dl-de/by-2-0 — no Cesium ion, so also for guests and share
 * links (api/share-create.php keeps them):
 *   - TopPlusOpen Grey      (worldwide, grey variant of TopPlusOpen)
 *   - basemap.de Color/Grey (the official AdV base map, Germany only)
 * Registered after "TopPlusOpen" in LayerManager's basemap list (same pattern
 * as arcgis.js).
 */
(function() {
  'use strict';

  var YEAR = new Date().getFullYear();
  var DL_DE = '<a href="https://www.govdata.de/dl-de/by-2-0" target="_blank" rel="noopener">dl-de/by-2-0</a>';
  var BKG = '<a href="https://www.bkg.bund.de" target="_blank" rel="noopener">Bundesamt für Kartographie und Geodäsie</a>';
  // basemap.de covers Germany only; no requests outside it
  var GERMANY = [5.5, 47.0, 15.5, 55.2];

  function topPlusGrey() {
    return new Cesium.UrlTemplateImageryProvider({
      url: 'https://sgx.geodatenzentrum.de/wmts_topplus_open/tile/1.0.0/web_grau/default/WEBMERCATOR/{z}/{y}/{x}.png',
      maximumLevel: 18,
      credit: new Cesium.Credit('TopPlusOpen © ' + BKG + ' (' + YEAR + '), ' + DL_DE + ', sources: ' +
        '<a href="https://sg.geodatenzentrum.de/web_public/Datenquellen_TopPlus_Open.pdf" target="_blank" rel="noopener">sg.geodatenzentrum.de/web_public/Datenquellen_TopPlus_Open.pdf</a>', true)
    });
  }

  // basemap.de WMTS: GLOBAL_WEBMERCATOR with two-digit zoom ids ("06")
  function basemapDe(variant) {
    return new Cesium.UrlTemplateImageryProvider({
      url: 'https://sgx.geodatenzentrum.de/wmts_basemapde/tile/1.0.0/de_basemapde_web_raster_' + variant +
        '/default/GLOBAL_WEBMERCATOR/{z2}/{y}/{x}.png',
      customTags: { z2: function(provider, x, y, level) { return (level < 10 ? '0' : '') + level; } },
      maximumLevel: 19,
      rectangle: Cesium.Rectangle.fromDegrees(GERMANY[0], GERMANY[1], GERMANY[2], GERMANY[3]),
      credit: new Cesium.Credit('basemap.de © <a href="https://basemap.de" target="_blank" rel="noopener">AdV</a> / ' + BKG +
        ' (' + YEAR + '), ' + DL_DE, true)
    });
  }

  var BASEMAPS = [
    { id: 'topplus-grey', name: 'TopPlusOpen Grey', factory: topPlusGrey },
    { id: 'basemapde-color', name: 'basemap.de (Germany)', factory: function() { return basemapDe('farbe'); } },
    { id: 'basemapde-grey', name: 'basemap.de Grey (Germany)', factory: function() { return basemapDe('grau'); } }
  ];

  function register(lm) {
    if (!lm || !lm.allBasemapLayers) return;
    var at = lm.allBasemapLayers.findIndex(function(b) { return b.id === 'topplus'; });
    at = at < 0 ? lm.allBasemapLayers.length : at + 1;
    BASEMAPS.forEach(function(def) {
      if (lm.allBasemapLayers.some(function(b) { return b.id === def.id; })) return;
      lm.allBasemapLayers.splice(at++, 0, {
        id: def.id,
        name: def.name,
        providerFactory: function() { return Promise.resolve(def.factory()); },
        layer: null,
        active: false
      });
    });
    lm.applyImageryAccess();
    lm.updateBasemapUI();
  }

  if (typeof LayerManager === 'undefined') return;
  var origInit = LayerManager.init;
  LayerManager.init = async function() {
    var result = await origInit.apply(this, arguments);
    register(this);
    return result;
  };
  if (LayerManager.viewer) register(LayerManager);   // init already ran
})();
