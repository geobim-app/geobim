/**
 * geobim.app — Model filter and Visibility panels in desktop style
 * (panel UI, beta)
 *
 * Loaded by panels-ui-loader.js after panels-tree.js, so only in the panel
 * layout; the classic IFC Filter, Revit Filter and Visibility sections stay
 * as they are.
 *
 * MODEL FILTER  (panels-ui.js merges the Revit section into the IFC panel)
 *   IFC CLASSES · n/m       Structure / Interior / MEP / Building / Other,
 *                           rows with check + colour, All / None
 *   REVIT CATEGORIES · n/m  Structure / Interior / MEP / Other, same rows
 *   Both lists are the fixed class / category lists of core.js, not what a
 *   model contains; the node of the loaded model type opens by itself.
 * VISIBILITY
 *   HIDE      Hide mode (on/off row), shortcuts
 *   HIDDEN · n  rows (element class, time), eye = show again, Show all
 *
 * The rows are rendered here from the same state (ifcFilter.enabledEntities,
 * revitFilter.enabledCategories, hiddenFeatures.features) instead of the
 * emoji HTML of ui-helpers-modern.js / hideFeatures.js; every action goes
 * through the existing BimViewer functions.
 */
(function() {
  'use strict';

  var IFC_GROUPS = [
    ['structure', 'Structure'], ['interior', 'Interior'], ['mep', 'MEP'],
    ['building', 'Building'], ['other', 'Other']
  ];
  var REVIT_GROUPS = [
    ['structure', 'Structure'], ['interior', 'Interior'], ['mep', 'MEP'], ['other', 'Other']
  ];

  var tree = BimPanelsTree.create('geobim_filter_tree');
  var node = tree.node;
  var el = tree.el;
  var add = tree.add;

  function byId(id) { return document.getElementById(id); }

  function link(text, onClick) {
    var b = el('button', 'pnl-link', text);
    b.type = 'button';
    b.addEventListener('click', function() { b.blur(); onClick(); });
    return b;
  }

  // ---------------------------------------------------------------------------
  // MODEL FILTER
  // ---------------------------------------------------------------------------
  // One filter tree: groups of rows, header meta "enabled/total"
  function filterTree(opts) {
    var top = node(opts.key, opts.title, false, { top: true, meta: true });
    var actions = el('div', 'pnl-actions pnl-filter-actions');
    add(actions, link('All', opts.all), link('None', opts.none));
    var groupsBox = el('div', 'pnl-filter-groups');
    add(top.sub, actions, groupsBox);
    var groups = {};

    opts.groups.forEach(function(g) {
      var n = node(opts.key + ':' + g[0], g[1], false, { meta: true });
      groups[g[0]] = n;
      groupsBox.appendChild(n);
    });

    groupsBox.addEventListener('click', function(e) {
      var row = e.target.closest('.pnl-item[data-value]');
      if (!row) return;
      row.blur();
      opts.toggle(row.dataset.value);
      render();
    });

    function render() {
      var items = opts.items();
      var enabled = opts.enabled();
      var on = 0;
      Object.keys(groups).forEach(function(k) { groups[k].sub.innerHTML = ''; groups[k].count = [0, 0]; });
      items.forEach(function(it) {
        var g = groups[it.group] || groups.other;
        var isOn = enabled.has(it.value);
        if (isOn) on++;
        g.count[0] += isOn ? 1 : 0;
        g.count[1]++;
        var row = el('button', 'pnl-item pnl-filter-row' + (isOn ? ' sel' : ''));
        row.type = 'button';
        row.dataset.value = it.value;
        row.setAttribute('aria-pressed', isOn ? 'true' : 'false');
        row.title = it.value;
        var dot = el('span', 'pnl-filter-dot');
        dot.style.setProperty('--pnl-dot', it.color || 'var(--text-muted)');
        add(row, el('span', 'pnl-check'), dot, el('span', 'pnl-item-name', it.name));
        g.sub.appendChild(row);
      });
      Object.keys(groups).forEach(function(k) {
        var g = groups[k];
        g.hidden = !g.count[1];
        g.meta.textContent = g.count[0] + '/' + g.count[1];
      });
      top.meta.textContent = on + '/' + items.length;
    }

    top.render = render;
    return top;
  }

  // Which kind of model is loaded (detected per asset by core.js / features.js)
  function loadedKinds() {
    var kinds = { ifc: false, revit: false };
    if (!BimViewer.loadedAssets) return kinds;
    BimViewer.loadedAssets.forEach(function(ad) {
      if (!ad) return;
      if (ad.categoryPropertyName === 'categoryName' || /\(revit\)\s*$/i.test(ad.name || '')) kinds.revit = true;
      else if (ad.ifcPropertyName || /\(ifc[^()]*\)\s*$/i.test(ad.name || '')) kinds.ifc = true;
    });
    return kinds;
  }

  function buildFilter(body) {
    var ifcContent = body.querySelector('.modern-section-content:not(.panels-merged-content)');
    var revitContent = body.querySelector('.panels-merged-content[data-section="revit"]');
    if (!ifcContent || typeof IFC_ENTITIES === 'undefined' || !BimViewer.ifcFilter) return false;

    var root = el('div', 'pnl-tree');
    var parked = el('div', 'pnl-parked');
    parked.hidden = true;

    var hint = el('p', 'modern-hint pnl-hint',
      'No IFC or Revit model loaded. The filters apply as soon as one is.');

    var ifc = filterTree({
      key: 'f:ifc',
      title: 'IFC classes',
      groups: IFC_GROUPS,
      items: function() {
        return IFC_ENTITIES.map(function(e) {
          return { value: e.entity, name: e.displayName, color: e.color, group: e.category };
        });
      },
      enabled: function() { return BimViewer.ifcFilter.enabledEntities; },
      toggle: function(v) { BimViewer.toggleIFCEntity(v); },
      all: function() { BimViewer.selectAllIFCTypes(); },
      none: function() { BimViewer.deselectAllIFCTypes(); }
    });

    var hasRevit = typeof REVIT_CATEGORIES !== 'undefined' && BimViewer.revitFilter &&
      typeof BimViewer.toggleRevitCategory === 'function';
    var revit = hasRevit ? filterTree({
      key: 'f:revit',
      title: 'Revit categories',
      groups: REVIT_GROUPS,
      items: function() {
        return REVIT_CATEGORIES.map(function(c) {
          return { value: c.category, name: c.displayName, color: c.color, group: c.group };
        });
      },
      enabled: function() { return BimViewer.revitFilter.enabledCategories; },
      toggle: function(v) { BimViewer.toggleRevitCategory(v); },
      all: function() { BimViewer.selectAllRevitCategories(); },
      none: function() { BimViewer.deselectAllRevitCategories(); }
    }) : null;

    [ifcContent, revitContent].forEach(function(c) {
      if (!c) return;
      Array.prototype.slice.call(c.children).forEach(function(ch) { parked.appendChild(ch); });
    });
    if (revitContent) revitContent.remove();
    add(root, hint, ifc, revit, parked);
    ifcContent.appendChild(root);

    // The section renderers (also called by select / deselect all) draw here
    BimViewer.updateIFCFilterUI = function() { lastSizes = ''; syncCounts(); };
    if (revit) BimViewer.updateRevitFilterUI = function() { lastSizes = ''; syncCounts(); };

    // the filter sets are filled after the panel is built (initIFCFilter /
    // initRevitFilter) and may change without a UI call: redraw on change
    var lastSizes = '';
    function syncCounts() {
      var sig = BimViewer.ifcFilter.enabledEntities.size + ',' +
        (revit ? BimViewer.revitFilter.enabledCategories.size : '');
      if (sig === lastSizes) return;
      lastSizes = sig;
      ifc.render();
      if (revit) revit.render();
    }

    var lastKinds = '';
    function syncKinds() {
      var k = loadedKinds();
      var sig = k.ifc + ',' + k.revit;
      if (sig === lastKinds) return;
      lastKinds = sig;
      hint.hidden = k.ifc || k.revit;
      if (k.ifc) ifc.expand();
      if (k.revit && revit) revit.expand();
    }
    syncCounts();
    syncKinds();
    var panel = body.closest('.panels-panel');
    setInterval(function() {
      if (panel && panel.hidden) return;
      syncCounts();
      syncKinds();
    }, 1000);
    return true;
  }

  // ---------------------------------------------------------------------------
  // VISIBILITY
  // ---------------------------------------------------------------------------
  function buildVisibility(content) {
    var modeBtn = byId('toggleHideMode');
    var list = byId('hiddenFeaturesList');
    var showAll = byId('showAllHidden');
    if (!modeBtn || !list || !BimViewer.hiddenFeatures) return false;

    var root = el('div', 'pnl-tree');
    var parked = el('div', 'pnl-parked');
    parked.hidden = true;

    // HIDE
    var hide = node('v:hide', 'Hide', true, { top: true });
    modeBtn.classList.remove('modern-btn-primary');
    var modeIcon = modeBtn.querySelector('.modern-btn-icon');
    if (modeIcon) modeIcon.innerHTML = '<i data-lucide="eye-off"></i>';
    var row = el('div', 'pnl-toggle-row');
    add(row, el('span', 'pnl-toggle-label', 'Hide mode'), modeBtn);
    var keys = node('v:keys', 'Shortcuts', false);
    var keyHint = el('p', 'modern-hint pnl-hint');
    keyHint.innerHTML = '<strong>H</strong> hide mode on/off · <strong>Shift+H</strong> show all · ' +
      'in hide mode, click or tap an element to hide it';
    keys.sub.appendChild(keyHint);
    add(hide.sub, row, keys);

    // HIDDEN · n
    var hidden = node('v:hidden', 'Hidden', true, { top: true, meta: true });
    list.className = 'pnl-hidden-list';
    var actions = el('div', 'pnl-actions');
    if (showAll) {
      var icon = showAll.querySelector('.modern-btn-icon');
      if (icon) icon.remove();
      showAll.className = 'modern-btn modern-btn-secondary modern-btn-small';
      var label = showAll.querySelector('span');
      if (label) label.textContent = 'Show all';
      actions.appendChild(showAll);
    }
    add(hidden.sub, list, actions);

    park();
    function park() {
      Array.prototype.slice.call(content.children).forEach(function(c) {
        if (c !== root) parked.appendChild(c);
      });
    }
    add(root, hide, hidden, parked);
    content.appendChild(root);

    function syncMode() {
      var on = !!BimViewer.hiddenFeatures.isHideMode;
      modeBtn.classList.toggle('active', on);
      modeBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      var text = modeBtn.querySelector('span:not(.modern-btn-icon):not(.modern-badge)');
      if (text && text.textContent !== (on ? 'On' : 'Off')) text.textContent = on ? 'On' : 'Off';
    }

    BimViewer.updateHiddenFeaturesList = function() {
      var features = this.hiddenFeatures.features;
      hidden.meta.textContent = features.size ? String(features.size) : '';
      actions.hidden = !features.size;
      list.innerHTML = '';
      if (!features.size) {
        var empty = el('div', 'pnl-empty');
        add(empty, el('div', 'pnl-empty-title', 'No hidden elements'),
          el('div', 'modern-hint pnl-hint', 'Turn on hide mode, then click or tap elements to hide them.'));
        list.appendChild(empty);
        return;
      }
      features.forEach(function(data, id) {
        var r = el('div', 'pnl-view-row');
        r.dataset.id = id;
        var info = el('div', 'pnl-hidden-info');
        var time = data.timestamp instanceof Date
          ? data.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        add(info, el('span', 'pnl-view-name', data.elementType || 'Element'),
          time && el('span', 'pnl-view-meta', 'Hidden ' + time));
        var controls = el('div', 'pnl-view-controls');
        var show = el('button', 'modern-icon-btn');
        show.type = 'button';
        show.dataset.action = 'show';
        show.title = 'Show again';
        show.setAttribute('aria-label', 'Show again');
        var i = el('i');
        i.setAttribute('data-lucide', 'eye');
        show.appendChild(i);
        controls.appendChild(show);
        add(r, info, controls);
        list.appendChild(r);
      });
      if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide', node: list });
    };

    list.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-action="show"]');
      var r = btn && btn.closest('.pnl-view-row');
      if (!r) return;
      BimViewer.showHiddenFeature(Number(r.dataset.id));
    });

    // toggleHideMode (button, H, Esc) ends with updateHiddenFeaturesCount
    var origCount = BimViewer.updateHiddenFeaturesCount;
    BimViewer.updateHiddenFeaturesCount = function() {
      var r = origCount.apply(this, arguments);
      syncMode();
      return r;
    };

    BimViewer.updateHiddenFeaturesList();
    syncMode();
    return true;
  }

  // ---------------------------------------------------------------------------
  var doneFilter = false;
  var doneVis = false;
  var tries = 0;
  (function wait() {
    if (window.BimPanelsUI && BimPanelsUI.ready && window.BimViewer) {
      if (!doneFilter) {
        var f = document.querySelector('.panels-panel[data-section="ifc"] .panels-panel-body');
        if (f) doneFilter = buildFilter(f);
      }
      if (!doneVis) {
        var v = document.querySelector('.panels-panel[data-section="visibility"] .modern-section-content');
        if (v) doneVis = buildVisibility(v);
      }
      if (doneFilter && doneVis) {
        if (window.lucide) lucide.createIcons();
        return;
      }
    }
    if (++tries > 200) return;
    setTimeout(wait, 300);
  })();
})();
