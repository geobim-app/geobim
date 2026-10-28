/**
 * geobim.app — Layers panel as a tree (panel UI, beta)
 *
 * Loaded by panels-ui-loader.js next to panels-ui.js, so only in the panel
 * layout; the classic sidebar keeps its flat Layer Manager.
 *
 * Like geoBIM Desktop's imagery widget the panel becomes collapsible nodes:
 *   TERRAIN    Cesium ion · Open terrain · My terrain · Geoid / heights
 *   IMAGERY    Base map · My imagery
 *   WMS / WMTS Active services (grouped per service) · Presets · Add service…
 *   GIS FILES  Add GIS file… · list of dropped / picked files (gis-files.js)
 *   3D LAYERS
 * Pure UI restructuring: the existing elements (IDs, handlers, LayerManager
 * re-renders) are moved into the nodes, never rebuilt. Two lists are
 * post-processed after each LayerManager re-render:
 *   - #terrainList: open (non-ion) terrain like Mapterhorn moves to "Open
 *     terrain", rows of terrain the user added to "My terrain"
 *   - #wmsLayersList: layer rows are grouped per service, with "Remove service"
 * Anything in the section this module doesn't know lands in "More", so no
 * control gets lost when another module adds one.
 *
 * Expanded state per node in localStorage via panels-tree.js (the default
 * opens the node with the active base map).
 */
(function() {
  'use strict';

  var ION_TERRAIN = ['world', 'terrain_2426648'];
  var OPEN_TERRAIN = ['mapterhorn']; // no Cesium ion involved (mapterhorn-terrain.js)
  var tree = BimPanelsTree.create('geobim_layers_tree');
  var node = tree.node;
  var el = tree.el;
  var add = tree.add;

  function byId(id) { return document.getElementById(id); }
  var take = byId; // reads as "move this existing element into the tree"

  // ---------------------------------------------------------------------------
  // Terrain: open terrain and own rows out of #terrainList
  // ---------------------------------------------------------------------------
  // rerendered: LayerManager rebuilt #terrainList (moved rows are stale)
  function splitTerrain(open, own, rerendered) {
    var list = byId('terrainList');
    if (!list) return;
    if (rerendered) { open.innerHTML = ''; own.innerHTML = ''; }
    Array.prototype.forEach.call(list.querySelectorAll(':scope > .layer-terrain-item'), function(row) {
      var radio = row.querySelector('input[name="terrain"]');
      if (!radio || ION_TERRAIN.indexOf(radio.value) !== -1) return;
      (OPEN_TERRAIN.indexOf(radio.value) !== -1 ? open : own).appendChild(row);
    });
  }

  // #terrainList delegates change/click to LayerManager; the moved rows need the same
  function wireOwnTerrain(own) {
    own.addEventListener('change', function(e) {
      if (e.target.name === 'terrain' && typeof LayerManager !== 'undefined') LayerManager.switchTerrain(e.target.value);
    });
    own.addEventListener('click', function(e) {
      var removeBtn = e.target.closest('[data-remove-terrain]');
      if (removeBtn && typeof LayerManager !== 'undefined') LayerManager.removeTerrain(removeBtn.dataset.removeTerrain);
    });
  }

  // ---------------------------------------------------------------------------
  // WMS: group #wmsLayersList rows per service
  // ---------------------------------------------------------------------------
  function serviceKey(url) {
    try {
      var u = new URL(url, window.location.href);
      return u.host + u.pathname.replace(/\/+$/, '');
    } catch (_) { return String(url || 'service'); }
  }

  function serviceLabel(url) {
    var key = serviceKey(url);
    var presets = (typeof LayerManager !== 'undefined' && LayerManager.wmsPresets) || [];
    for (var i = 0; i < presets.length; i++) {
      var pk = serviceKey(presets[i].url);
      if (pk === key || key.indexOf(pk) === 0 || pk.indexOf(key) === 0) return presets[i].label;
    }
    try { return new URL(url, window.location.href).host; } catch (_) { return key; }
  }

  function groupWms() {
    var list = byId('wmsLayersList');
    if (!list || typeof LayerManager === 'undefined') return;
    var rows = Array.prototype.slice.call(list.querySelectorAll(':scope > .layer-overlay-item[data-wms-id]'));
    if (!rows.length) return;
    var groups = {};
    var order = [];
    rows.forEach(function(row) {
      var layer = LayerManager.wmsLayers.find(function(w) { return w.id === row.dataset.wmsId; });
      var key = serviceKey(layer ? layer.url : '');
      if (!groups[key]) {
        groups[key] = { label: serviceLabel(layer ? layer.url : ''), rows: [] };
        order.push(key);
      }
      groups[key].rows.push(row);
    });
    order.forEach(function(key) {
      var g = groups[key];
      var branch = node('svc:' + key, g.label, true, { meta: true, cls: 'pnl-service' });
      branch.meta.textContent = g.rows.length + (g.rows.length === 1 ? ' layer' : ' layers');
      g.rows.forEach(function(row) { branch.sub.appendChild(row); });
      var remove = el('button', 'pnl-link pnl-danger', 'Remove service');
      remove.type = 'button';
      remove.addEventListener('click', function() {
        var ids = g.rows.map(function(r) { return r.dataset.wmsId; });
        if (ids.length > 1 && !window.confirm('Remove all ' + ids.length + ' layers of "' + g.label + '"?')) return;
        ids.forEach(function(id) { LayerManager.removeWmsLayer(id); });
      });
      branch.sub.appendChild(remove);
      list.appendChild(branch);
    });
  }

  // ---------------------------------------------------------------------------
  // Presets: one node per group, click = discover (same as the preset select)
  // ---------------------------------------------------------------------------
  function buildPresets(target) {
    var presets = (typeof LayerManager !== 'undefined' && LayerManager.wmsPresets) || [];
    var groups = {};
    var order = [];
    var hidden = (typeof LayerManager !== 'undefined' && LayerManager.hiddenPresetGroups) || [];
    presets.forEach(function(p, index) {
      if (hidden.indexOf(p.group) !== -1) return;
      if (!groups[p.group]) { groups[p.group] = []; order.push(p.group); }
      groups[p.group].push({ preset: p, index: index });
    });
    order.forEach(function(group) {
      var branch = node('preset:' + group, group, false, { meta: true });
      branch.meta.textContent = String(groups[group].length);
      groups[group].forEach(function(entry) {
        var item = el('button', 'pnl-item');
        item.type = 'button';
        item.dataset.presetIndex = entry.index;
        item.appendChild(el('span', 'pnl-item-name', entry.preset.label));
        item.title = entry.preset.url;
        branch.sub.appendChild(item);
      });
      target.appendChild(branch);
    });
    target.addEventListener('click', function(e) {
      var item = e.target.closest('[data-preset-index]');
      if (!item || typeof LayerManager === 'undefined') return;
      var preset = LayerManager.wmsPresets[parseInt(item.dataset.presetIndex, 10)];
      if (!preset) return;
      var urlInput = byId('wmsUrl');
      if (urlInput) urlInput.value = preset.url;
      var select = byId('wmsPresetSelect');
      if (select) select.value = item.dataset.presetIndex;
      LayerManager.discoverWmsLayers(preset.url);
      var picker = byId('wmsLayerPicker');
      if (picker) setTimeout(function() { picker.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 50);
    });
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------
  function activeBasemapName() {
    var b = typeof LayerManager !== 'undefined' && (LayerManager.basemapLayers || []).find(function(x) { return x.active; });
    return b ? b.name : '';
  }

  function activeTerrainName() {
    var t = typeof LayerManager !== 'undefined' && (LayerManager.terrainLayers || []).find(function(x) { return x.active; });
    return t ? t.name : '';
  }

  function build(content) {
    var old = Array.prototype.slice.call(content.children);
    var root = el('div', 'pnl-tree');

    // TERRAIN
    var terrain = node('terrain', 'Terrain', false, { top: true, meta: true });
    var ion = node('terrain:ion', 'Cesium ion', false);
    add(ion.sub, take('terrainList'));
    // Open terrain is for guests too, so not under the signed-in "My terrain"
    var openTerrain = node('terrain:open', 'Open terrain', false);
    var openList = el('div', 'layer-terrain-list');
    wireOwnTerrain(openList);
    add(openTerrain.sub, openList);
    var mine = node('terrain:mine', 'My terrain', false, { cls: 'pnl-signed-in' });
    var ownList = el('div', 'layer-terrain-list pnl-own-terrain');
    wireOwnTerrain(ownList);
    var addTerrain = node('terrain:add', 'Add by Cesium ion ID…', false);
    var terrainForm = take('terrainAssetId');
    add(addTerrain.sub, terrainForm && terrainForm.closest('.layer-add-overlay'));
    var terrainHint = old.find(function(e) { return e.classList.contains('modern-hint') && /terrain/i.test(e.textContent); });
    add(mine.sub, ownList, take('terrainAssetIdPicker'), addTerrain, terrainHint);
    var geoid = node('terrain:geoid', 'Geoid / heights', false, { cls: 'pnl-signed-in' });
    add(geoid.sub, take('toggleGeoidTerrain'), take('toggleBathymetry'));
    add(terrain.sub, ion, openTerrain, mine, geoid);

    // IMAGERY
    var imagery = node('imagery', 'Imagery', true, { top: true, meta: true });
    var base = node('imagery:base', 'Base map', true);
    add(base.sub, take('basemapList'));
    var myImagery = node('imagery:mine', 'My imagery', false, { cls: 'pnl-signed-in' });
    var addImagery = node('imagery:add', 'Add by Cesium ion ID…', false);
    var imageryForm = take('overlayAssetId');
    add(addImagery.sub, imageryForm && imageryForm.closest('.layer-add-overlay'));
    var imageryHint = old.find(function(e) { return e.classList.contains('modern-hint') && /imagery overlays/i.test(e.textContent); });
    add(myImagery.sub, take('overlayAssetIdPicker'), take('overlayLayersList'), addImagery, imageryHint);
    add(imagery.sub, base, myImagery);

    // WMS / WMTS / WFS
    var wms = node('wms', 'WMS / WMTS / WFS', false, { top: true, meta: true });
    var active = node('wms:active', 'Active services', true);
    add(active.sub, take('wmsLayersList'));
    var presets = node('wms:presets', 'Presets', false);
    buildPresets(presets.sub);
    var addService = node('wms:add', 'Add service…', false);
    var urlRow = take('wmsUrl');
    var select = take('wmsPresetSelect');
    if (select) select.hidden = true; // kept for its ID; the Presets node replaces it
    var wmsHint = old.find(function(e) { return e.classList.contains('modern-hint') && /GetCapabilities/i.test(e.textContent); });
    add(addService.sub, select, urlRow && urlRow.closest('.layer-add-overlay'), wmsHint);
    add(wms.sub, take('wmsLayerPicker'), active, presets, addService);

    // GIS FILES (gis-files.js)
    var gis = node('gis', 'GIS files', false, { top: true, meta: true });
    add(gis.sub, take('gisFilesBlock'));

    // 3D LAYERS
    var layers3d = node('3d', '3D layers', false, { top: true, meta: true });
    add(layers3d.sub, take('toggleOSMBuildings'), take('toggleGoogle3DTiles'), take('googleTilesQualityRow'), take('tilesetLayersList'));

    add(root, terrain, imagery, wms, gis, layers3d);

    // Leftovers: drop dividers and emptied wrappers, keep anything unknown
    var more = node('more', 'More', false, { top: true });
    old.forEach(function(e) {
      if (!e.parentNode || e.parentNode !== content) return;
      if (e.classList.contains('modern-divider') || !e.querySelector('*') && !e.textContent.trim() ||
          (e.classList.contains('modern-group') && !e.querySelector('input, button, select, [id]') && !e.textContent.replace(/basemap/i, '').trim())) {
        e.remove();
        return;
      }
      more.sub.appendChild(e);
    });
    if (more.sub.children.length) root.appendChild(more);

    content.innerHTML = '';
    content.appendChild(root);

    // Keep post-processing after every LayerManager re-render
    var terrainList = byId('terrainList');
    var wmsList = byId('wmsLayersList');
    var sync = function(records) {
      var rerendered = Array.isArray(records) && records.some(function(r) { return r.target === terrainList && r.addedNodes.length; });
      splitTerrain(openList, ownList, rerendered);
      ownList.hidden = !ownList.children.length;
      openTerrain.hidden = !openList.children.length;
      terrain.meta.textContent = activeTerrainName();
      imagery.meta.textContent = activeBasemapName();
      var n = typeof LayerManager !== 'undefined' ? (LayerManager.wmsLayers || []).length : 0;
      wms.meta.textContent = n ? n + ' active' : '';
      var nGis = typeof GEOBIM_GIS_FILES !== 'undefined' ? GEOBIM_GIS_FILES.layers().length : 0;
      gis.meta.textContent = nGis ? nGis + (nGis === 1 ? ' file' : ' files') : '';
      var on3d = layers3d.sub.querySelectorAll('.modern-toggle-btn.active, .layer-toggle-btn.active').length;
      layers3d.meta.textContent = on3d ? on3d + ' on' : '';
    };
    if (terrainList) new MutationObserver(sync).observe(terrainList, { childList: true });
    if (wmsList) new MutationObserver(function() { groupWms(); sync(); }).observe(wmsList, { childList: true });
    var gisList = byId('gisFilesList');
    if (gisList) new MutationObserver(sync).observe(gisList, { childList: true });
    splitTerrain(openList, ownList, false);
    var basemapList = byId('basemapList');
    if (basemapList) new MutationObserver(sync).observe(basemapList, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    new MutationObserver(sync).observe(layers3d.sub, { subtree: true, attributes: true, attributeFilter: ['class'] });
    // ion-layer-assets.js may add its pickers (into the "Add by ID" forms) after
    // the tree is built; move them up next to the lists they feed
    var placePickers = function() {
      var tp = byId('terrainAssetIdPicker');
      if (tp && tp.parentNode !== mine.sub) mine.sub.insertBefore(tp, ownList.nextSibling);
      var ip = byId('overlayAssetIdPicker');
      if (ip && ip.parentNode !== myImagery.sub) myImagery.sub.insertBefore(ip, myImagery.sub.firstChild);
    };
    [addTerrain.sub, addImagery.sub].forEach(function(sub) {
      new MutationObserver(placePickers).observe(sub, { childList: true, subtree: true });
    });
    placePickers();
    groupWms();
    sync();

    if (window.lucide) lucide.createIcons();
  }

  var tries = 0;
  (function wait() {
    var content = document.querySelector('.panels-panel[data-section="layers"] .modern-section-content');
    if (window.BimPanelsUI && BimPanelsUI.ready && content && byId('basemapList') &&
        typeof LayerManager !== 'undefined' && (LayerManager.basemapLayers || []).length) {
      build(content);
      return;
    }
    if (++tries > 200) return;
    setTimeout(wait, 300);
  })();
})();
