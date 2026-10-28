/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * Guests without Cesium ion (2026-10-28)
 *
 * Without a sign-in (auth-gate.js guest, /demo) nothing comes from Cesium ion:
 *   - terrain:  Mapterhorn open terrain (mapterhorn-terrain.js), no World
 *               Terrain / Bathymetry
 *   - imagery:  TopPlusOpen (LayerManager's guest default) and the WMS presets
 *   - 3D data:  the server models listed in model/guest-models.json
 *               (api/models.php hands only those to guests), the iTwin demo
 *   - search:   OpenStreetMap Nominatim instead of the ion geocoder
 * A guard on IonResource's endpoint lookup (every ion asset — terrain,
 * imagery, tilesets, OSM Buildings, Google 3D Tiles — resolves through it)
 * makes any ion request that is left fail fast instead of loading.
 *
 * Signed-in users and the trimmed demos (_weaDemoMode without _demoMode:
 * WEA shadow, Bridge Inspector, StageTwin) are unchanged.
 */
window.BimGuest = (function() {
  'use strict';

  var OPEN_TERRAIN = ['mapterhorn', 'arcgis-elevation'];

  var NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
  var MIN_SEARCH_INTERVAL = 1100;   // Nominatim usage policy: at most 1 request/s

  function active() {
    return !!(window._guestMode || window._demoMode);
  }

  function blocked(what) {
    return new Error('Cesium ion is not used without sign-in (' + what + ')');
  }

  // ---------------------------------------------------------------------------
  // Guard: no ion endpoint requests for guests
  // ---------------------------------------------------------------------------
  function installGuard() {
    if (typeof Cesium === 'undefined' || !Cesium.IonResource) return;
    var orig = Cesium.IonResource._createEndpointResource;
    if (typeof orig !== 'function' || orig._guestGuard) return;
    var guarded = function(assetId) {
      if (active()) throw blocked('asset ' + assetId);
      return orig.apply(this, arguments);
    };
    guarded._guestGuard = true;
    Cesium.IonResource._createEndpointResource = guarded;
  }

  // ---------------------------------------------------------------------------
  // Geocoder: OpenStreetMap Nominatim (Cesium GeocoderService interface)
  // ---------------------------------------------------------------------------
  function NominatimGeocoderService() {
    this._last = 0;
    this._credit = new Cesium.Credit('Search © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors', false);
  }
  Object.defineProperty(NominatimGeocoderService.prototype, 'credit', {
    get: function() { return this._credit; }
  });
  NominatimGeocoderService.prototype.geocode = async function(query, type) {
    // Cesium calls geocode() per keystroke for autocomplete; Nominatim
    // forbids that, so only an explicit search (Enter / button) asks it.
    if (type === Cesium.GeocodeType.AUTOCOMPLETE) return [];
    var wait = this._last + MIN_SEARCH_INTERVAL - Date.now();
    if (wait > 0) await new Promise(function(r) { setTimeout(r, wait); });
    this._last = Date.now();
    var url = NOMINATIM_URL + '?format=jsonv2&limit=5&q=' + encodeURIComponent(query);
    var resp = await fetch(url, { headers: { 'Accept-Language': navigator.language || 'en' } });
    if (!resp.ok) throw new Error('Nominatim HTTP ' + resp.status);
    var items = await resp.json();
    return (items || []).map(function(it) {
      var b = (it.boundingbox || []).map(Number);   // [south, north, west, east]
      var destination = b.length === 4 && b.every(isFinite)
        ? Cesium.Rectangle.fromDegrees(b[2], b[0], b[3], b[1])
        : Cesium.Cartesian3.fromDegrees(Number(it.lon), Number(it.lat), 1500);
      return { displayName: it.display_name, destination: destination };
    });
  };

  function geocoderServices() {
    return [new NominatimGeocoderService()];
  }

  // ---------------------------------------------------------------------------
  // Terrain: Mapterhorn instead of the ion entries
  // ---------------------------------------------------------------------------
  function hookLayerManager() {
    if (typeof LayerManager === 'undefined' || LayerManager._guestHooked) return;
    LayerManager._guestHooked = true;
    var origInit = LayerManager.init;
    LayerManager.init = async function() {
      var result = await origInit.apply(this, arguments);
      if (active()) {
        // body.no-ion hides the ion-only controls (auth-styles.css); the
        // event lets ui-assets-section.js list the guest server models
        document.body.classList.add('no-ion');
        window.dispatchEvent(new Event('geobim-guest-start'));
        // open terrain only: Mapterhorn, ArcGIS World Elevation (arcgis.js)
        this.terrainLayers = this.terrainLayers.filter(function(t) { return OPEN_TERRAIN.indexOf(t.id) !== -1; });
        await this.switchTerrain('mapterhorn');
        this.updateTerrainUI();
      }
      return result;
    };
  }

  // ---------------------------------------------------------------------------
  // Assets: server models instead of the ion list
  // ---------------------------------------------------------------------------
  function hookViewer() {
    if (typeof BimViewer === 'undefined' || BimViewer._guestHooked) return;
    BimViewer._guestHooked = true;

    // Nothing to list from ion; the server models fill #glbSection
    // (ui-assets-section.js shows it for guests too)
    var origFetch = BimViewer.fetchAvailableAssets;
    BimViewer.fetchAvailableAssets = async function() {
      if (!active()) return origFetch.apply(this, arguments);
      this.availableAssets = [];
      return this.availableAssets;
    };

    var origLoad = BimViewer.loadSelectedAsset;
    BimViewer.loadSelectedAsset = async function(assetId) {
      if (active()) {
        console.warn('[Guest] ion asset ' + assetId + ' skipped: Cesium ion is not used without sign-in');
        this.updateStatus('Sign in to load Cesium ion assets', 'warning');
        return;
      }
      return origLoad.apply(this, arguments);
    };

    ['toggleGoogle3DTiles', 'toggleOSMBuildings'].forEach(function(name) {
      var orig = BimViewer[name];
      if (typeof orig !== 'function') return;
      BimViewer[name] = async function() {
        if (active()) {
          this.updateStatus('Sign in for Google 3D Tiles and OSM Buildings (Cesium ion)', 'warning');
          return;
        }
        return orig.apply(this, arguments);
      };
    });
  }

  installGuard();
  hookLayerManager();
  hookViewer();

  return {
    active: active,
    geocoderServices: geocoderServices
  };
})();
