/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// ===============================
// GEOID MODULE — EGM96 undulation lookup, GCG2016 (BKG) inside Germany
// (grid from mapterhorn-terrain.js) so "above sea level" there is NHN (DHHN2016)
// ===============================
'use strict';

var GEOBIM_GEOID = (function() {

  var gridData = null;
  var loading = false;
  var loadPromise = null;

  /**
   * Load the EGM96 1° grid data.
   * Returns a promise that resolves when data is ready.
   */
  function load() {
    if (gridData) return Promise.resolve();
    if (loadPromise) return loadPromise;

    loading = true;
    if (typeof GEOBIM_MAPTERHORN !== 'undefined') {
      GEOBIM_MAPTERHORN.loadGCG().catch(function(err) { console.warn('GCG2016 grid not loaded, using EGM96:', err); });
    }
    loadPromise = fetch('data/egm96-1deg.json')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        gridData = data;
        loading = false;
        console.log('EGM96 geoid grid loaded (' + data.rows + '×' + data.cols + ')');
      })
      .catch(function(err) {
        loading = false;
        loadPromise = null;
        console.warn('Failed to load EGM96 grid:', err);
      });

    return loadPromise;
  }

  /**
   * Get geoid undulation (N) at a given lat/lon using bilinear interpolation.
   * @param {number} lat — Latitude in degrees (-90 to 90)
   * @param {number} lon — Longitude in degrees (-180 to 180)
   * @returns {number|null} — Undulation in meters, or null if grid not loaded
   */
  function getUndulation(lat, lon) {
    if (!gridData) return null;

    // Clamp latitude
    lat = Math.max(-90, Math.min(90, lat));

    // Normalize longitude to -180..179
    while (lon < -180) lon += 360;
    while (lon >= 180) lon -= 360;

    // Convert to grid coordinates (row = lat, col = lon)
    // Row 0 = lat 90, row 180 = lat -90
    var rowF = (90 - lat) / gridData.resolution;
    var colF = (lon - gridData.lon_start) / gridData.resolution;

    var row0 = Math.floor(rowF);
    var col0 = Math.floor(colF);
    var row1 = Math.min(row0 + 1, gridData.rows - 1);
    var col1 = (col0 + 1) % gridData.cols;

    var dRow = rowF - row0;
    var dCol = colF - col0;

    // Bilinear interpolation
    var v00 = gridData.grid[row0][col0];
    var v01 = gridData.grid[row0][col1];
    var v10 = gridData.grid[row1][col0];
    var v11 = gridData.grid[row1][col1];

    var v0 = v00 + (v01 - v00) * dCol;
    var v1 = v10 + (v11 - v10) * dCol;

    return v0 + (v1 - v0) * dRow;
  }

  /**
   * Convert ellipsoidal height to orthometric (above sea level).
   * @param {number} ellipsoidalHeight — Height above WGS84 ellipsoid in meters
   * @param {number} lat — Latitude in degrees
   * @param {number} lon — Longitude in degrees
   * @returns {{orthometric: number, undulation: number}|null}
   */
  function toOrthometric(ellipsoidalHeight, lat, lon) {
    var model = 'GCG2016';
    var N = (typeof GEOBIM_MAPTERHORN !== 'undefined') ? GEOBIM_MAPTERHORN.gcg2016(lat, lon) : null;
    if (N === null) {
      model = 'EGM96';
      N = getUndulation(lat, lon);
    }
    if (N === null) return null;
    return {
      orthometric: ellipsoidalHeight - N,
      undulation: N,
      model: model
    };
  }

  return {
    load: load,
    getUndulation: getUndulation,
    toOrthometric: toOrthometric
  };

})();
