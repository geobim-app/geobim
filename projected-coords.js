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
// PROJECTED COORDINATES (UTM + Gauss-Krüger)
// UTM: WGS84 lon/lat -> UTM, zone from the longitude (Norway/Svalbard
// exceptions included); in Europe labelled ETRS89 (EPSG:258zz), elsewhere
// WGS 84 (EPSG:326zz/327zz). ETRS89 is treated as WGS84, like everywhere in
// geobim.app and the tiler, so values match the files' IfcMapConversion.
// Gauss-Krüger: WGS84/ETRS89 lon/lat -> DHDN, 3° zones 2–5 (EPSG:31466–31469).
// The datum shift uses the official AdV BeTA2007 grid (geodesy/de_adv_BETA2007.tif,
// from PROJ-data — "Derived from work by AdV. Free redistribution is allowed"),
// the same transformation PROJ picks; results match PROJ to the millimetre.
// proj4js is loaded on first use, geotiff.js and the grid only for
// Gauss-Krüger. Outside the grid (i.e. outside Germany) there is no
// Gauss-Krüger result.
// ===============================
'use strict';

var GEOBIM_PROJ = (function() {

  var PROJ4_URL = 'https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.22.0/proj4.js';
  var GEOTIFF_URL = 'https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js';
  var GRID_URL = 'geodesy/de_adv_BETA2007.tif';
  var GRID_KEY = 'beta2007';

  var proj4Promise = null;
  var gridPromise = null;

  function loadScript(url) {
    return new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = function() { reject(new Error('Failed to load ' + url)); };
      document.head.appendChild(s);
    });
  }

  // Both loaders allow a retry after a failed load (e.g. offline CDN).
  function loadProj4() {
    if (!proj4Promise) {
      proj4Promise = typeof proj4 !== 'undefined' ? Promise.resolve() : loadScript(PROJ4_URL);
      proj4Promise.catch(function() { proj4Promise = null; });
    }
    return proj4Promise;
  }

  function loadGrid() {
    if (!gridPromise) {
      gridPromise = (async function() {
        await loadProj4();
        if (typeof GeoTIFF === 'undefined') await loadScript(GEOTIFF_URL);
        var tiff = await GeoTIFF.fromUrl(GRID_URL);
        await proj4.nadgrid(GRID_KEY, tiff).ready;
      })();
      gridPromise.catch(function() { gridPromise = null; });
    }
    return gridPromise;
  }

  function utmZone(lat, lon) {
    var zone = Math.floor((lon + 180) / 6) + 1;
    if (zone > 60) zone = 60;
    // Southwest Norway uses zone 32 wider than the 6° rule
    if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;
    // Svalbard: zones 31, 33, 35, 37 only
    if (lat >= 72 && lat < 84) {
      if (lon >= 0 && lon < 9) zone = 31;
      else if (lon >= 9 && lon < 21) zone = 33;
      else if (lon >= 21 && lon < 33) zone = 35;
      else if (lon >= 33 && lon < 42) zone = 37;
    }
    return zone;
  }

  /**
   * UTM coordinates of a WGS84 point.
   * Resolves to { zone, south, epsg, datum, easting, northing } or null
   * beyond UTM's latitude range (polar regions).
   */
  async function utmFromWGS84(lat, lon) {
    if (lat < -80 || lat > 84) return null;
    await loadProj4();
    var zone = utmZone(lat, lon);
    var south = lat < 0;
    // ETRS89 / UTM covers Europe (zones 28–38); elsewhere WGS 84 / UTM
    var etrs = !south && lat >= 34 && zone >= 28 && zone <= 38;
    var epsg = etrs ? 25800 + zone : (south ? 32700 : 32600) + zone;
    var def = '+proj=utm +zone=' + zone + (south ? ' +south' : '') + ' +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
    var en = proj4('WGS84', def, [lon, lat]);
    if (!en || !Number.isFinite(en[0]) || !Number.isFinite(en[1])) return null;
    return { zone: zone, south: south, epsg: epsg, datum: etrs ? 'ETRS89' : 'WGS 84', easting: en[0], northing: en[1] };
  }

  /**
   * Gauss-Krüger coordinates of a WGS84 point.
   * Resolves to { zone, epsg, easting, northing } or null outside Germany.
   */
  async function fromWGS84(lat, lon) {
    var zone = Math.round(lon / 3);
    if (zone < 2 || zone > 5) return null;
    await loadGrid();
    var def = '+proj=tmerc +lat_0=0 +lon_0=' + (zone * 3) + ' +k=1 +x_0=' + (zone * 1000000 + 500000) +
      ' +y_0=0 +ellps=bessel +nadgrids=@' + GRID_KEY + ' +units=m +no_defs';
    var en = proj4('WGS84', def, [lon, lat]);
    if (!en || !Number.isFinite(en[0]) || !Number.isFinite(en[1])) return null;  // outside the grid
    return { zone: zone, epsg: 31464 + zone, easting: en[0], northing: en[1] };
  }

  return { utmFromWGS84: utmFromWGS84, gaussKruegerFromWGS84: fromWGS84 };
})();

window.GEOBIM_PROJ = GEOBIM_PROJ;
