/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/*
 * Split View: choose the side per asset and per OGC layer, and a separate
 * basemap for the left side (e.g. as-built left vs. design right, or aerial
 * left vs. topographic right).
 *
 * ui-split-section.js still owns the toggle, the slider and the Google 3D
 * Tiles left copy; this module only re-applies the sides after it, and when
 * assets, basemaps or OGC layers change while split view is on.
 *
 * Defaults keep the old behaviour: assets right, OGC layers on both sides,
 * left basemap = the one chosen under Layers.
 */
(function() {
  'use strict';

  var SIDES = ['left', 'both', 'right'];
  var SIDE_LABEL = { left: 'L', both: 'Both', right: 'R' };
  var SIDE_TITLE = { left: 'Left side only', both: 'Both sides', right: 'Right side only' };

  var state = {
    assetSides: {},     // assetId -> 'left' | 'both' | 'right'   (default right)
    wmsSides: {},       // OGC layer id -> side                   (default both)
    leftBasemapId: '',  // '' = same as right
    leftLayer: null,    // ImageryLayer we added for the left basemap
    leftLayerId: '',
    leftSeq: 0
  };

  var refreshQueued = false;

  function direction(side) {
    if (side === 'left') return Cesium.SplitDirection.LEFT;
    if (side === 'right') return Cesium.SplitDirection.RIGHT;
    return Cesium.SplitDirection.NONE;
  }

  function isOn() {
    return !!(window.BimViewer && BimViewer.splitMode);
  }

  function lm() {
    return (typeof LayerManager !== 'undefined' && LayerManager.viewer) ? LayerManager : null;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Everything of an asset that Cesium can split: tilesets, GLB models and
  // the layer tilesets of an I3S provider. Entities (labels, WFS) cannot.
  function splittables(asset) {
    var out = [];
    if (asset.tileset) out.push(asset.tileset);
    if (asset.model && 'splitDirection' in asset.model) out.push(asset.model);
    if (asset.i3s && asset.i3s.layers) {
      asset.i3s.layers.forEach(function(l) { if (l.tileset) out.push(l.tileset); });
    }
    return out;
  }

  function assetSide(id) {
    return state.assetSides[id] || 'right';
  }

  function wmsSide(id) {
    return state.wmsSides[id] || 'both';
  }

  function wmsSplittable(w) {
    return w.type !== 'wfs' && !!w.layer;
  }

  // ---------------------------------------------------------------
  // Apply
  // ---------------------------------------------------------------

  function applyAssets() {
    var on = isOn();
    BimViewer.loadedAssets.forEach(function(asset, id) {
      var dir = on ? direction(assetSide(String(id))) : Cesium.SplitDirection.NONE;
      splittables(asset).forEach(function(p) { p.splitDirection = dir; });
    });
  }

  function applyWms() {
    var m = lm();
    if (!m) return;
    var on = isOn();
    m.wmsLayers.forEach(function(w) {
      if (!wmsSplittable(w)) return;
      w.layer.splitDirection = on ? direction(wmsSide(w.id)) : Cesium.SplitDirection.NONE;
    });
  }

  function mainBasemap(m) {
    return m.basemapLayers.find(function(b) { return b.id === m.activeBasemap; }) || null;
  }

  function removeLeftLayer() {
    state.leftSeq++;
    if (state.leftLayer && BimViewer.viewer) {
      BimViewer.viewer.imageryLayers.remove(state.leftLayer, true);
    }
    state.leftLayer = null;
    state.leftLayerId = '';
  }

  async function applyBasemap() {
    var m = lm();
    if (!m) return;
    var main = mainBasemap(m);
    // Right switched to the left one: both sides show it, the choice is gone
    if (state.leftBasemapId === m.activeBasemap) state.leftBasemapId = '';
    var wanted = isOn() ? state.leftBasemapId : '';

    if (main && main.layer) {
      main.layer.splitDirection = wanted ? Cesium.SplitDirection.RIGHT : Cesium.SplitDirection.NONE;
    }

    // Google 3D Tiles hide all basemaps, so the left one would never show
    var googleOn = !!(BimViewer.googleTiles && BimViewer.googleTiles.enabled);
    if (!wanted || wanted === 'none' || googleOn) {
      removeLeftLayer();
      return;
    }
    if (state.leftLayer && state.leftLayerId === wanted) return;

    removeLeftLayer();
    var target = m.basemapLayers.find(function(b) { return b.id === wanted; });
    if (!target || typeof target.providerFactory !== 'function') {
      state.leftBasemapId = '';
      render();
      return;
    }
    var seq = state.leftSeq;
    try {
      var provider = await target.providerFactory();
      if (seq !== state.leftSeq || !isOn()) return; // changed meanwhile
      var layer = BimViewer.viewer.imageryLayers.addImageryProvider(provider, 0);
      layer.splitDirection = Cesium.SplitDirection.LEFT;
      state.leftLayer = layer;
      state.leftLayerId = wanted;
      BimViewer.updateStatus('Left basemap: ' + target.name, 'success');
    } catch (err) {
      console.error('Split view: left basemap failed:', target.name, err);
      if (seq === state.leftSeq) {
        state.leftBasemapId = '';
        render();
        BimViewer.updateStatus('Left basemap failed: ' + target.name, 'error');
      }
    }
  }

  function apply() {
    if (!window.BimViewer || !BimViewer.viewer) return;
    applyAssets();
    applyWms();
    applyBasemap();
  }

  // ---------------------------------------------------------------
  // UI (injected into the Split View section, below the toggle)
  // ---------------------------------------------------------------

  function segHtml(kind, id, current, disabled) {
    return '<div class="split-seg" role="group" aria-label="Side">' + SIDES.map(function(side) {
      var active = side === current;
      return '<button type="button" class="split-seg-btn' + (active ? ' active' : '') + '"' +
        ' data-split-kind="' + kind + '" data-split-id="' + escapeHtml(id) + '" data-split-side="' + side + '"' +
        ' aria-pressed="' + active + '" title="' + SIDE_TITLE[side] + '"' + (disabled ? ' disabled' : '') + '>' +
        SIDE_LABEL[side] + '</button>';
    }).join('') + '</div>';
  }

  function ensureBox() {
    var box = document.getElementById('splitCompare');
    if (box) return box;
    var toggle = document.getElementById('toggleSplitView');
    var group = toggle && toggle.closest('.modern-group');
    if (!group) return null;
    box = document.createElement('div');
    box.id = 'splitCompare';
    box.className = 'split-compare';
    group.parentNode.insertBefore(box, group.nextSibling);
    box.addEventListener('click', onClick);
    box.addEventListener('change', onChange);
    return box;
  }

  function render() {
    var box = ensureBox();
    if (!box) return;
    box.hidden = !isOn();
    if (box.hidden) { box.innerHTML = ''; return; }

    var m = lm();
    var html = '';

    // Basemaps
    if (m) {
      var main = mainBasemap(m);
      var options = '<option value="">Same as right' + (main ? ' (' + escapeHtml(main.name) + ')' : '') + '</option>' +
        m.basemapLayers.filter(function(b) { return b.id !== m.activeBasemap; }).map(function(b) {
          return '<option value="' + escapeHtml(b.id) + '"' + (b.id === state.leftBasemapId ? ' selected' : '') + '>' +
            escapeHtml(b.name) + '</option>';
        }).join('');
      html += '<div class="split-compare-group">' +
        '<label class="split-compare-label" for="splitLeftBasemap"><i data-lucide="map"></i>Left basemap</label>' +
        '<select id="splitLeftBasemap" class="modern-select">' + options + '</select>' +
        '<div class="split-compare-note">Right: ' + escapeHtml(main ? main.name : 'none') + ' (change under Layers)</div>' +
        (BimViewer.googleTiles && BimViewer.googleTiles.enabled
          ? '<div class="split-compare-note">Google 3D Tiles are on and cover the basemaps.</div>' : '') +
        '</div>';
    }

    // Assets
    var rows = [];
    BimViewer.loadedAssets.forEach(function(asset, id) {
      id = String(id);
      var can = splittables(asset).length > 0;
      rows.push('<div class="split-compare-row">' +
        '<span class="split-compare-name" title="' + escapeHtml(asset.name) + '">' + escapeHtml(asset.name || id) + '</span>' +
        segHtml('asset', id, can ? assetSide(id) : 'both', !can) + '</div>');
    });
    html += '<div class="split-compare-group">' +
      '<div class="split-compare-label"><i data-lucide="box"></i>Assets</div>' +
      (rows.length ? rows.join('') : '<div class="modern-empty-state">No assets loaded</div>') +
      '</div>';

    // OGC layers
    if (m && m.wmsLayers.length) {
      html += '<div class="split-compare-group">' +
        '<div class="split-compare-label"><i data-lucide="layers"></i>OGC layers</div>' +
        m.wmsLayers.map(function(w) {
          var can = wmsSplittable(w);
          return '<div class="split-compare-row">' +
            '<span class="split-compare-name" title="' + escapeHtml(w.name) + '">' + escapeHtml(w.name) + '</span>' +
            segHtml('wms', w.id, can ? wmsSide(w.id) : 'both', !can) + '</div>';
        }).join('') +
        (m.wmsLayers.some(function(w) { return !wmsSplittable(w); })
          ? '<div class="split-compare-note">WFS layers always show on both sides.</div>' : '') +
        '</div>';
    }

    box.innerHTML = html;
    if (window.lucide) lucide.createIcons();
  }

  function onClick(e) {
    var btn = e.target.closest('.split-seg-btn');
    if (!btn || btn.disabled) return;
    var kind = btn.dataset.splitKind;
    var id = btn.dataset.splitId;
    var side = btn.dataset.splitSide;
    if (kind === 'asset') state.assetSides[id] = side;
    else if (kind === 'wms') state.wmsSides[id] = side;
    apply();
    render();
  }

  function onChange(e) {
    if (e.target.id !== 'splitLeftBasemap') return;
    state.leftBasemapId = e.target.value;
    applyBasemap();
  }

  // ---------------------------------------------------------------
  // Hooks
  // ---------------------------------------------------------------

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    // After the caller is done: core.js sets RIGHT right after loadedAssets.set()
    Promise.resolve().then(function() {
      refreshQueued = false;
      if (isOn()) apply();
      render();
    });
  }

  function hookAssets() {
    var map = BimViewer.loadedAssets;
    if (!map || map._splitHooked) return;
    var set = map.set, del = map.delete;
    map.set = function() { var r = set.apply(this, arguments); queueRefresh(); return r; };
    map.delete = function(key) {
      var r = del.apply(this, arguments);
      delete state.assetSides[String(key)];
      queueRefresh();
      return r;
    };
    map._splitHooked = true;
  }

  function hookLayerManager() {
    var m = typeof LayerManager !== 'undefined' ? LayerManager : null;
    if (!m || m._splitHooked) return;
    ['updateBasemapUI', 'updateWmsUI'].forEach(function(name) {
      var orig = m[name];
      if (typeof orig !== 'function') return;
      m[name] = function() { var r = orig.apply(this, arguments); queueRefresh(); return r; };
    });
    m._splitHooked = true;
  }

  function onToggle(e) {
    if (!e.target.closest('#toggleSplitView')) return;
    // ui-split-section.js flips splitMode in its own click handler; run after it
    setTimeout(function() {
      if (!isOn()) removeLeftLayer();
      apply();
      render();
    }, 0);
  }

  function init() {
    if (!window.BimViewer || !BimViewer.loadedAssets) return false;
    hookAssets();
    hookLayerManager();
    if (!ensureBox()) return false;
    render();
    return true;
  }

  document.addEventListener('click', onToggle);

  // The sidebar is built after the viewer starts; wait for the toggle button
  var tries = 0;
  (function wait() {
    if (init() || ++tries > 120) return;
    setTimeout(wait, 500);
  })();

  window.BimSplitCompare = {
    apply: apply,
    render: render,
    setAssetSide: function(id, side) { state.assetSides[String(id)] = side; apply(); render(); },
    setLeftBasemap: function(id) { state.leftBasemapId = id || ''; applyBasemap(); render(); },
    getState: function() {
      return { assetSides: Object.assign({}, state.assetSides), wmsSides: Object.assign({}, state.wmsSides), leftBasemapId: state.leftBasemapId };
    }
  };
})();
