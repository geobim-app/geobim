/**
 * geobim.app — Assets panel as a tree (panel UI, beta)
 *
 * Loaded by panels-ui-loader.js after panels-tree.js, so only in the panel
 * layout; the classic sidebar keeps its Assets section and the floating
 * "Loaded Assets" panel.
 *
 *   CESIUM ION     the asset list as rows with check marks (multi-select,
 *                  search from 8 entries), "Import Selected"
 *   BENTLEY ITWIN  the iTwin demo block (itwin-demo.js)
 *   ESRI ARCGIS    I3S demo scene layers + own I3S URL (arcgis.js)
 *   SERVER MODELS  owner only, as before: Models · Upload IFC / point cloud…
 *   LOADED · n     the loaded asset cards, moved here from the floating panel
 *
 * Pure UI restructuring: the existing elements keep their IDs and handlers.
 * #ionAssetSelector stays the source of truth (hidden): ui.js fills it, the
 * import button reads its selectedOptions; the rows only mirror and set
 * option.selected. Type chips come from the demo naming convention, e.g.
 * "Bridge (Pointcloud)" → "Bridge" + chip "Point cloud"; no chip otherwise.
 */
(function() {
  'use strict';

  var SEARCH_FROM = 8;
  var tree = BimPanelsTree.create('geobim_assets_tree');
  var node = tree.node;
  var el = tree.el;
  var add = tree.add;

  function byId(id) { return document.getElementById(id); }

  // ---------------------------------------------------------------------------
  // Type chip from the name suffix ("… (IFC 4x3)", "…(Reality Mesh)")
  // ---------------------------------------------------------------------------
  function splitType(name) {
    var m = /\s*\(([^()]+)\)\s*$/.exec(name || '');
    if (!m) return { name: name, type: null };
    var raw = m[1].trim();
    var key = raw.toLowerCase().replace(/\s+/g, ' ');
    var type = null;
    if (/^ifc\b/.test(key)) type = 'IFC' + raw.slice(3);
    else if (key === 'pointcloud' || key === 'point cloud') type = 'Point cloud';
    else if (key === 'reality mesh') type = 'Reality mesh';
    else if (/^(gaussian )?splats?$/.test(key)) type = 'Splat';
    else if (key === 'revit') type = 'Revit';
    else if (key === 'glb' || key === 'gltf') type = 'glTF';
    if (!type) return { name: name, type: null };
    return { name: name.slice(0, m.index).trim() || name, type: type };
  }

  function chip(type) {
    return el('span', 'pnl-chip', type);
  }

  // ---------------------------------------------------------------------------
  // Cesium ion: rows mirroring #ionAssetSelector
  // ---------------------------------------------------------------------------
  function buildIonList(select, list, search) {
    list.innerHTML = '';
    var rows = 0;
    Array.prototype.forEach.call(select.children, function(child) {
      var options = child.tagName === 'OPTGROUP' ? child.children : [child];
      if (child.tagName === 'OPTGROUP') list.appendChild(el('div', 'pnl-label', child.label));
      Array.prototype.forEach.call(options, function(opt) {
        if (!opt.value) return; // placeholder
        var parts = splitType(opt.textContent);
        var row = el('button', 'pnl-item' + (opt.selected ? ' sel' : ''));
        row.type = 'button';
        row.dataset.value = opt.value;
        row.setAttribute('aria-pressed', opt.selected ? 'true' : 'false');
        row.title = opt.textContent;
        add(row, el('span', 'pnl-check'), el('span', 'pnl-item-name', parts.name), parts.type && chip(parts.type));
        row.dataset.search = (opt.textContent + ' ' + (parts.type || '')).toLowerCase();
        list.appendChild(row);
        rows++;
      });
    });
    search.hidden = rows < SEARCH_FROM;
    if (search.hidden) search.value = '';
    filterIon(list, search.value);
    return rows;
  }

  function filterIon(list, query) {
    var q = String(query || '').trim().toLowerCase();
    var label = null;
    var labelHasRows = false;
    Array.prototype.forEach.call(list.children, function(child) {
      if (child.classList.contains('pnl-label')) {
        if (label) label.hidden = !labelHasRows;
        label = child;
        labelHasRows = false;
        return;
      }
      child.hidden = !!q && child.dataset.search.indexOf(q) === -1;
      if (!child.hidden) labelHasRows = true;
    });
    if (label) label.hidden = !labelHasRows;
  }

  function syncIonSelection(select, list) {
    Array.prototype.forEach.call(list.querySelectorAll('.pnl-item'), function(row) {
      var opt = Array.prototype.find.call(select.options, function(o) { return o.value === row.dataset.value; });
      var on = !!(opt && opt.selected);
      row.classList.toggle('sel', on);
      row.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // ---------------------------------------------------------------------------
  // Loaded asset cards: type chip, eye state, mask icons (CSS)
  // ---------------------------------------------------------------------------
  function decorateCard(card) {
    var id = card.id.replace(/^asset_/, '');
    var data = window.BimViewer && BimViewer.loadedAssets && BimViewer.loadedAssets.get(id);
    card.classList.toggle('pnl-asset-hidden', !!(data && data.visible === false));
    var nameEl = card.querySelector('.modern-asset-name');
    if (nameEl && !nameEl.dataset.pnlDone) {
      nameEl.dataset.pnlDone = '1';
      var parts = splitType(nameEl.textContent);
      if (parts.type) {
        nameEl.textContent = parts.name;
        nameEl.insertAdjacentElement('afterend', chip(parts.type));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------
  function build(content) {
    var old = Array.prototype.slice.call(content.children);
    var root = el('div', 'pnl-tree');
    var select = byId('ionAssetSelector');

    // CESIUM ION
    var ion = node('ion', 'Cesium ion', true, { top: true, meta: true });
    // keeps .modern-group around the selector: itwin-demo.js inserts its block after it
    var ionGroup = el('div', 'modern-group pnl-ion-group');
    var search = el('input', 'modern-input pnl-search');
    search.type = 'search';
    search.placeholder = 'Filter assets…';
    search.setAttribute('aria-label', 'Filter Cesium ion assets');
    search.hidden = true;
    var list = el('div', 'pnl-list pnl-ion-list');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Cesium ion assets');
    add(ionGroup, byId('ionAssetsLoading'), search, list, select, byId('importSelectedAsset'), byId('loadIonAssets'));
    add(ion.sub, ionGroup);

    // BENTLEY ITWIN (itwin-demo.js may add its block later)
    var itwin = node('itwin', 'Bentley iTwin', false, { top: true });
    itwin.hidden = true;

    // ESRI ARCGIS (arcgis.js may add its block later)
    var arcgis = node('arcgis', 'Esri ArcGIS', false, { top: true });
    arcgis.hidden = true;

    // SERVER MODELS (owner only: ui-assets-section.js un-hides #glbSection)
    var server = node('server', 'Server models', false, { top: true });
    var glbSection = byId('glbSection');
    if (glbSection) {
      var models = node('server:models', 'Models', true);
      var upload = node('server:upload', 'Upload IFC / point cloud…', false);
      add(models.sub, glbSection.querySelector('.local-models-row'));
      add(upload.sub, glbSection.querySelector('.local-models-upload'));
      Array.prototype.forEach.call(glbSection.querySelectorAll('.modern-divider'), function(d) { d.remove(); });
      add(server.sub, glbSection, models, upload);
      server.hidden = glbSection.hidden;
      new MutationObserver(function() { server.hidden = glbSection.hidden; })
        .observe(glbSection, { attributes: true, attributeFilter: ['hidden'] });
    } else {
      server.hidden = true;
    }

    // LOADED · n (moved out of the floating panel, which stays hidden here)
    var loaded = node('loaded', 'Loaded', true, { top: true, meta: true });
    if (typeof BimViewer.createLoadedAssetsPanel === 'function') BimViewer.createLoadedAssetsPanel();
    var floating = byId('floatingAssetsPanel');
    add(loaded.sub, floating && floating.querySelector('.assets-panel-actions'), byId('loadedAssetsList'));

    add(root, ion, itwin, arcgis, server, loaded);

    // Leftovers: the classic "Loaded Assets" button (keeps #loadedAssetsCount),
    // dividers, emptied wrappers; anything unknown goes to "More"
    var more = node('more', 'More', false, { top: true });
    var parked = el('div', 'pnl-parked');
    parked.hidden = true;
    old.forEach(function(e) {
      if (e.parentNode !== content) return;
      if (e.querySelector('#loadedAssetsCount')) { parked.appendChild(e); return; }
      if (e.id === 'itwinDemo') { itwin.sub.appendChild(e); itwin.hidden = false; return; }
      if (e.id === 'arcgisDemo') { arcgis.sub.appendChild(e); arcgis.hidden = false; return; }
      var labelOnly = !e.querySelector('input, button, select, textarea, a, [id]') &&
        (e.children.length ? Array.prototype.every.call(e.children, function(c) { return c.classList.contains('modern-label'); }) : !e.textContent.trim());
      if (e.classList.contains('modern-divider') || labelOnly) {
        e.remove();
        return;
      }
      more.sub.appendChild(e);
    });
    if (more.sub.children.length) root.appendChild(more);
    root.appendChild(parked);

    content.innerHTML = '';
    content.appendChild(root);

    // iTwin block injected after the build lands next to the ion group
    var placeItwin = function() {
      var block = byId('itwinDemo');
      if (!block || block.parentNode === itwin.sub) return;
      var divider = block.previousElementSibling;
      if (divider && divider.classList.contains('modern-divider')) divider.remove();
      itwin.sub.appendChild(block);
      itwin.hidden = false;
    };
    // same for the ArcGIS block (after the ion group or the iTwin block)
    var placeArcgis = function() {
      var block = byId('arcgisDemo');
      if (!block || block.parentNode === arcgis.sub) return;
      var divider = block.previousElementSibling;
      if (divider && divider.classList.contains('modern-divider')) divider.remove();
      arcgis.sub.appendChild(block);
      arcgis.hidden = false;
    };
    new MutationObserver(function() { placeItwin(); placeArcgis(); }).observe(ion.sub, { childList: true });
    new MutationObserver(placeArcgis).observe(itwin.sub, { childList: true });
    placeItwin();
    placeArcgis();

    // Ion list mirrors the select (ui.js refills it on token change)
    var ionMeta = function() {
      var oauth = typeof BimIonAuth !== 'undefined' && BimIonAuth.isOAuthConnected();
      var status = byId('ionAuthStatus');
      ion.meta.textContent = oauth ? ((status && status.textContent.trim()) || 'your account') : 'demo';
    };
    var rebuild = function() {
      if (select) buildIonList(select, list, search);
      ionMeta();
    };
    if (select) {
      new MutationObserver(rebuild).observe(select, { childList: true, subtree: true });
      list.addEventListener('click', function(e) {
        var row = e.target.closest('.pnl-item');
        if (!row) return;
        var opt = Array.prototype.find.call(select.options, function(o) { return o.value === row.dataset.value; });
        if (opt) opt.selected = !opt.selected;
        syncIonSelection(select, list);
      });
      list.addEventListener('dblclick', function(e) { e.preventDefault(); });
      // the import handler (ui-assets-section.js) clears the selection afterwards
      var importBtn = byId('importSelectedAsset');
      if (importBtn) importBtn.addEventListener('click', function() {
        setTimeout(function() { syncIonSelection(select, list); }, 0);
      });
    }
    search.addEventListener('input', function() { filterIon(list, search.value); });
    window.addEventListener('ion-token-changed', ionMeta);
    rebuild();

    // Loaded cards: count, chips, eye state; a new card opens the node
    var loadedList = byId('loadedAssetsList');
    var syncLoaded = function(records) {
      if (!loadedList) return;
      var cards = loadedList.querySelectorAll(':scope > .modern-asset-item');
      Array.prototype.forEach.call(cards, decorateCard);
      loaded.meta.textContent = String(cards.length);
      var added = Array.isArray(records) && records.some(function(r) {
        return Array.prototype.some.call(r.addedNodes, function(n) { return n.classList && n.classList.contains('modern-asset-item'); });
      });
      if (added) loaded.expand();
    };
    if (loadedList) new MutationObserver(syncLoaded).observe(loadedList, { childList: true });
    syncLoaded();

    // toggleAssetVisibility() updates no button on the card; mirror its state
    if (typeof BimViewer.toggleAssetVisibility === 'function' && !BimViewer.toggleAssetVisibility.pnlWrapped) {
      var original = BimViewer.toggleAssetVisibility;
      BimViewer.toggleAssetVisibility = function(assetId) {
        var result = original.apply(this, arguments);
        var card = byId('asset_' + assetId);
        if (card) decorateCard(card);
        return result;
      };
      BimViewer.toggleAssetVisibility.pnlWrapped = true;
    }

    if (window.lucide) lucide.createIcons();
  }

  var tries = 0;
  (function wait() {
    var content = document.querySelector('.panels-panel[data-section="assets"] .modern-section-content');
    if (window.BimPanelsUI && BimPanelsUI.ready && content && byId('ionAssetSelector') && window.BimViewer) {
      build(content);
      return;
    }
    if (++tries > 200) return;
    setTimeout(wait, 300);
  })();
})();
