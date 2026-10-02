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
// GAUSS-KRÜGER (DHDN) COORDINATES
// WGS84/ETRS89 lon/lat -> DHDN Gauss-Krüger, 3° zones 2–5 (EPSG:31466–31469).
// The datum shift uses the official AdV BeTA2007 grid (geodesy/de_adv_BETA2007.tif,
// from PROJ-data — "Derived from work by AdV. Free redistribution is allowed"),
// the same transformation PROJ picks; results match PROJ to the millimetre.
// proj4js and geotiff.js are loaded on first use only. Outside the grid
// (i.e. outside Germany) there is no Gauss-Krüger result.
// ===============================
'use strict';

var GEOBIM_GK = (function() {

  var PROJ4_URL = 'https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.22.0/proj4.js';
  var GEOTIFF_URL = 'https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js';
  var GRID_URL = 'geodesy/de_adv_BETA2007.tif';
  var GRID_KEY = 'beta2007';

  var readyPromise = null;

  function loadScript(url) {
    return new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = function() { reject(new Error('Failed to load ' + url)); };
      document.head.appendChild(s);
    });
  }

  function ready() {
    if (!readyPromise) {
      readyPromise = (async function() {
        if (typeof proj4 === 'undefined') await loadScript(PROJ4_URL);
        if (typeof GeoTIFF === 'undefined') await loadScript(GEOTIFF_URL);
        var tiff = await GeoTIFF.fromUrl(GRID_URL);
        await proj4.nadgrid(GRID_KEY, tiff).ready;
      })();
      // Allow a retry after a failed load (e.g. offline CDN)
      readyPromise.catch(function() { readyPromise = null; });
    }
    return readyPromise;
  }

  /**
   * Gauss-Krüger coordinates of a WGS84 point.
   * Resolves to { zone, epsg, easting, northing } or null outside Germany.
   */
  async function fromWGS84(lat, lon) {
    var zone = Math.round(lon / 3);
    if (zone < 2 || zone > 5) return null;
    await ready();
    var def = '+proj=tmerc +lat_0=0 +lon_0=' + (zone * 3) + ' +k=1 +x_0=' + (zone * 1000000 + 500000) +
      ' +y_0=0 +ellps=bessel +nadgrids=@' + GRID_KEY + ' +units=m +no_defs';
    var en = proj4('WGS84', def, [lon, lat]);
    if (!en || !Number.isFinite(en[0]) || !Number.isFinite(en[1])) return null;  // outside the grid
    return { zone: zone, epsg: 31464 + zone, easting: en[0], northing: en[1] };
  }

  return { fromWGS84: fromWGS84 };
})();

window.GEOBIM_GK = GEOBIM_GK;
