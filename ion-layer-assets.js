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
// ION LAYER ASSETS v1.0
// Ion assets of type TERRAIN / IMAGERY belong in the Layers section, not in
// the asset list (which shows 3D Tiles and glTF only). This module adds a
// picker to "Terrain" and "Imagery Overlays" (ui-layer-section.js), next to
// the manual asset ID inputs:
//   - Cesium ion connected (OAuth): the user's own terrain / imagery
//   - demo token: only assets labelled "demo" (same rule as demoIonAssets)
// Cesium's base layers (World Terrain, Bing, Google, …) carry no creatorId
// and are left out — they already have their own controls.
// Guests don't see either picker: auth-styles.css hides both add groups.
// ===============================
'use strict';

(function() {

  var PICKERS = [
    { type: 'TERRAIN', anchor: 'terrainAssetId', placeholder: 'Add terrain from Cesium ion…' },
    { type: 'IMAGERY', anchor: 'overlayAssetId', placeholder: 'Add imagery from Cesium ion…' }
  ];

  function isDemoLabelled(a) {
    return Array.isArray(a.labels) &&
      a.labels.some(function(l) { return String(l && l.name).trim().toLowerCase() === 'demo'; });
  }

  // Own (uploaded) terrain / imagery of the given type, newest first
  BimViewer.ionLayerAssets = function(allAssets, type) {
    var oauth = typeof BimIonAuth !== 'undefined' && BimIonAuth.isOAuthConnected();
    return (allAssets || [])
      .filter(function(a) {
        return a.type === type && a.status === 'COMPLETE' && a.creatorId != null &&
          (oauth || isDemoLabelled(a));
      })
      .sort(function(a, b) { return String(b.dateAdded || '').localeCompare(String(a.dateAdded || '')); });
  };

  function createPickers() {
    var made = 0;
    PICKERS.forEach(function(p) {
      if (document.getElementById(p.anchor + 'Picker')) { made++; return; }
      var input = document.getElementById(p.anchor);
      var group = input && input.closest('.layer-add-overlay');
      if (!group) return;
      var select = document.createElement('select');
      select.id = p.anchor + 'Picker';
      select.className = 'modern-select ion-layer-picker';
      select.hidden = true;
      select.setAttribute('aria-label', p.placeholder);
      select.addEventListener('change', function() {
        var id = parseInt(select.value, 10);
        var name = select.options[select.selectedIndex].textContent;
        select.value = '';
        select.blur();
        if (!id || typeof LayerManager === 'undefined') return;
        if (p.type === 'TERRAIN') LayerManager.setLocalTerrain(id, name);
        else LayerManager.addIonImageryOverlay(id, name);
      });
      group.insertBefore(select, group.firstChild);
      made++;
    });
    return made === PICKERS.length;
  }

  var loadVersion = 0;

  async function refresh() {
    if (!createPickers() || typeof BimViewer.fetchAvailableAssets !== 'function') return;
    var version = ++loadVersion;
    var all;
    try {
      all = await BimViewer.fetchAvailableAssets();
    } catch (e) {
      console.warn('[IonLayerAssets] Asset list failed:', e.message);
      all = [];
    }
    if (version !== loadVersion) return;
    PICKERS.forEach(function(p) {
      var select = document.getElementById(p.anchor + 'Picker');
      if (!select) return;
      var assets = BimViewer.ionLayerAssets(all, p.type);
      select.innerHTML = '';
      var first = document.createElement('option');
      first.value = '';
      first.textContent = p.placeholder;
      select.appendChild(first);
      assets.forEach(function(a) {
        var option = document.createElement('option');
        option.value = a.id;
        option.textContent = a.name;
        select.appendChild(option);
      });
      select.hidden = assets.length === 0;
    });
  }

  // Connect / disconnect Cesium ion, or the demo token arriving after auth
  window.addEventListener('ion-token-changed', function() { refresh(); });

  // The Layers section is built by ui.js; wait for it and for the auth gate
  var tries = 0;
  (function wait() {
    if (createPickers() && window._authGatePassed) {
      refresh();
      return;
    }
    if (++tries > 200) return;
    setTimeout(wait, 300);
  })();

  console.log('Ion layer assets loaded v1.0');
})();
