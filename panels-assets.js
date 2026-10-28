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
 *   SERVER MODELS  owner only, as before: Models · Upload IFC / point cloud…
 *
 * The loaded asset cards get their own widget at the bottom left (next to the
 * rail, above the tab bar on phones): shown while assets are loaded,
 * collapsible (click the header), floating: drag the header to move it
 * (desktop; position and open state in localStorage, the default spot again
 * on phones), hidden with the rest of the panel UI (M, signed out). It
 * replaces the classic floating "Loaded Assets" panel.
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
  // Loaded widget (bottom left)
  // ---------------------------------------------------------------------------
  var LOADED_OPEN_KEY = 'geobim_loaded_widget_open';
  var LOADED_POS_KEY = 'geobim_loaded_widget_pos';
  var DRAG_THRESHOLD = 4;   // px before a press on the header becomes a drag
  var phone = window.matchMedia('(max-width: 720px)');

  // Inline left/top only on desktop; phones keep the docked spot from the CSS
  function placeWidget(widget, pos) {
    if (phone.matches || !pos) {
      widget.style.left = widget.style.top = widget.style.bottom = widget.style.maxHeight = '';
      return;
    }
    var w = widget.offsetWidth || 340;
    var headH = 36;   // the header stays reachable
    var x = Math.max(8, Math.min(pos[0], window.innerWidth - w - 8));
    var y = Math.max(8, Math.min(pos[1], window.innerHeight - headH - 8));
    widget.style.left = Math.round(x) + 'px';
    widget.style.top = Math.round(y) + 'px';
    widget.style.bottom = 'auto';
    // the list scrolls instead of the widget running off the bottom edge
    widget.style.maxHeight = Math.min(420, Math.max(headH, Math.round(window.innerHeight - y - 16))) + 'px';
  }

  function loadWidgetPos() {
    try {
      var p = JSON.parse(localStorage.getItem(LOADED_POS_KEY) || 'null');
      return Array.isArray(p) && p.length === 2 && p.every(isFinite) ? p : null;
    } catch (_) { return null; }
  }

  function makeWidgetDraggable(widget, head) {
    var pos = loadWidgetPos();
    var dragged = false;
    head.addEventListener('pointerdown', function(e) {
      if (e.button !== 0 || phone.matches) return;
      var sx = e.clientX, sy = e.clientY, ox = widget.offsetLeft, oy = widget.offsetTop;
      var moving = false;
      dragged = false;
      // capture right away: move/up must reach the header even when the
      // pointer leaves it before the drag threshold
      head.setPointerCapture(e.pointerId);
      function move(ev) {
        if (!moving && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < DRAG_THRESHOLD) return;
        if (!moving) {
          moving = true;
          widget.classList.add('dragging');
        }
        placeWidget(widget, [ox + ev.clientX - sx, oy + ev.clientY - sy]);
      }
      function up() {
        head.removeEventListener('pointermove', move);
        head.removeEventListener('pointerup', up);
        head.removeEventListener('pointercancel', up);
        if (!moving) return;
        widget.classList.remove('dragging');
        dragged = true;   // the click that follows must not collapse
        pos = [widget.offsetLeft, widget.offsetTop];
        try { localStorage.setItem(LOADED_POS_KEY, JSON.stringify(pos)); } catch (_) {}
      }
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
      head.addEventListener('pointercancel', up);
    });
    var replace = function() { placeWidget(widget, pos); };
    window.addEventListener('resize', replace);
    if (phone.addEventListener) phone.addEventListener('change', replace);
    // the widget has no size while hidden: place it when it first shows
    new MutationObserver(replace).observe(widget, { attributes: true, attributeFilter: ['hidden'] });
    return function wasDragged() { var d = dragged; dragged = false; return d; };
  }

  function buildLoadedWidget(actions, list) {
    var widget = el('section', 'pnl-loaded-widget pnl-top');
    widget.id = 'pnlLoadedWidget';
    widget.setAttribute('aria-label', 'Loaded assets');
    widget.hidden = true;
    var head = el('button', 'pnl-node pnl-loaded-head');
    head.type = 'button';
    head.appendChild(el('span', 'pnl-node-title', 'Loaded'));
    var meta = el('span', 'pnl-node-meta');
    head.appendChild(meta);
    var body = el('div', 'pnl-tree pnl-loaded-body');
    add(body, actions, list);
    var open = true;
    try { open = localStorage.getItem(LOADED_OPEN_KEY) !== '0'; } catch (_) {}
    var setOpen = function(now) {
      open = now;
      head.setAttribute('aria-expanded', now ? 'true' : 'false');
      body.hidden = !now;
      try { localStorage.setItem(LOADED_OPEN_KEY, now ? '1' : '0'); } catch (_) {}
    };
    add(widget, head, body);
    // inside .panels-ui: follows its visibility (M, signed out)
    (document.querySelector('.panels-ui') || document.body).appendChild(widget);
    var wasDragged = makeWidgetDraggable(widget, head);
    head.addEventListener('click', function() {
      if (wasDragged()) return;
      setOpen(!open);
      head.blur();
    });
    setOpen(open);
    widget.meta = meta;
    return widget;
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

    // LOADED · n: own widget (moved out of the floating panel, which stays hidden here)
    if (typeof BimViewer.createLoadedAssetsPanel === 'function') BimViewer.createLoadedAssetsPanel();
    var floating = byId('floatingAssetsPanel');
    var loaded = buildLoadedWidget(floating && floating.querySelector('.assets-panel-actions'), byId('loadedAssetsList'));

    add(root, ion, itwin, server);

    // Leftovers: the classic "Loaded Assets" button (keeps #loadedAssetsCount),
    // dividers, emptied wrappers; anything unknown goes to "More"
    var more = node('more', 'More', false, { top: true });
    var parked = el('div', 'pnl-parked');
    parked.hidden = true;
    old.forEach(function(e) {
      if (e.parentNode !== content) return;
      if (e.querySelector('#loadedAssetsCount')) { parked.appendChild(e); return; }
      if (e.id === 'itwinDemo') { itwin.sub.appendChild(e); itwin.hidden = false; return; }
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
    new MutationObserver(placeItwin).observe(ion.sub, { childList: true });
    placeItwin();

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

    // Loaded cards: count, chips, eye state; the widget shows while any is loaded
    var loadedList = byId('loadedAssetsList');
    var syncLoaded = function() {
      if (!loadedList) return;
      var cards = loadedList.querySelectorAll(':scope > .modern-asset-item');
      Array.prototype.forEach.call(cards, decorateCard);
      loaded.meta.textContent = String(cards.length);
      loaded.hidden = cards.length === 0;
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
