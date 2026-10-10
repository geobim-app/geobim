/**
 * geobim.app — Panel UI (beta)
 *
 * Alternative layout: icon rail on the left + floating tool panels (several
 * open at once, draggable, Esc closes the top one). Loaded only when
 * panels-ui-loader.js picks it (?ui=panels or beta.geobim.app).
 *
 * The classic sidebar is still built by ui.js; this module then MOVES each
 * section's .modern-section-content node into its own panel (never clones),
 * so every section's handlers, element IDs and data stay shared with the
 * classic UI. The sidebar header (logo, account badge, Cesium ion indicator)
 * moves into an "Account" panel at the bottom of the rail.
 *
 * Compatibility hooks:
 *   - BimViewerUI.toggleSection(id, expand) opens/closes panels instead
 *   - the rail mirrors sections hidden by CSS (e.g. body.guest-mode)
 *   - rail + panels follow #toolbar's visibility (auth.js shows/hides it)
 *   - M hides/shows rail + panels (classic: sidebar)
 */
(function() {
  'use strict';

  var POS_KEY = 'geobim_panels_pos';
  var RAIL_GROUPS = [
    ['assets', 'layers', 'pointcloud', 'splat'],
    ['ifc', 'revit', 'visibility', 'comments', 'inspection'],
    ['drawing', 'split', 'lighting'],
    ['views', 'scenes'],
    ['settings', 'about']
  ];
  var ACCOUNT_ID = 'account';
  var CASCADE_X = 84;   // right of the rail (16 + 52 + 16)
  var CASCADE_Y = 70;   // leaves room for the search bar (step 4)
  var CASCADE_STEP = 26;

  var panels = {};      // section id → { el, title, button }
  var order = [];       // open panels, last = top
  var positions = loadPositions();
  var root, rail, tip;

  window.BimPanelsUI = {
    active: true,
    ready: false,
    open: openPanel,
    close: closePanel,
    toggle: togglePanel,
    isOpen: function(id) { return order.indexOf(id) !== -1; }
  };

  // ---------------------------------------------------------------------------
  // Storage (positions are a per-browser convenience; never required)
  // ---------------------------------------------------------------------------
  function loadPositions() {
    try { return JSON.parse(localStorage.getItem(POS_KEY) || '{}') || {}; } catch (_) { return {}; }
  }

  function savePositions() {
    try { localStorage.setItem(POS_KEY, JSON.stringify(positions)); } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------
  function build(toolbar) {
    root = document.createElement('div');
    root.id = 'panelsUI';
    root.className = 'panels-ui';

    rail = document.createElement('nav');
    rail.className = 'panels-rail';
    rail.setAttribute('aria-label', 'Tools');
    root.appendChild(rail);

    tip = document.createElement('div');
    tip.className = 'panels-tip';
    tip.hidden = true;
    root.appendChild(tip);

    document.body.appendChild(root);

    // Sections in rail order; anything ui.js adds later but RAIL_GROUPS
    // doesn't know lands in an extra group, so nothing gets lost.
    var known = [].concat.apply([], RAIL_GROUPS);
    var headers = Array.prototype.slice.call(toolbar.querySelectorAll('.modern-section-header[data-section]'));
    var byId = {};
    headers.forEach(function(h) { byId[h.dataset.section] = h; });
    var extra = headers.map(function(h) { return h.dataset.section; })
      .filter(function(id) { return known.indexOf(id) === -1; });
    var groups = RAIL_GROUPS.concat(extra.length ? [extra] : []);

    groups.forEach(function(group, gi) {
      var added = false;
      group.forEach(function(id) {
        var header = byId[id];
        if (!header) return;
        if (gi > 0 && !added) addSeparator();
        added = true;
        var titleEl = header.querySelector('.modern-section-title > span:last-child');
        var iconEl = header.querySelector('.modern-section-icon');
        var content = header.nextElementSibling;
        if (!content || !content.classList.contains('modern-section-content')) return;
        createPanel(id, titleEl ? titleEl.textContent.trim() : id, iconEl ? iconEl.innerHTML : '', content, header.parentElement);
      });
    });

    // Account panel: the sidebar header (logo, badge, ion indicator) + layout switch
    var spacer = document.createElement('div');
    spacer.className = 'panels-rail-spacer';
    rail.appendChild(spacer);
    var account = document.createElement('div');
    account.className = 'panels-account';
    var header = toolbar.querySelector('.modern-header');
    if (header) account.appendChild(header);
    var classic = document.createElement('button');
    classic.type = 'button';
    classic.className = 'modern-btn modern-btn-small panels-classic-btn';
    classic.innerHTML = '<i data-lucide="panel-left"></i><span>Switch to classic sidebar</span>';
    classic.title = 'Back to the panel layout with ?ui=panels';
    classic.addEventListener('click', function() {
      var url = new URL(window.location.href);
      url.searchParams.set('ui', 'classic');
      window.location.href = url.toString();
    });
    account.appendChild(classic);
    createPanel(ACCOUNT_ID, 'Account & layout', '<i data-lucide="user-round"></i>', account, null);

    if (window.lucide) lucide.createIcons();
  }

  function addSeparator() {
    var sep = document.createElement('div');
    sep.className = 'panels-rail-sep';
    rail.appendChild(sep);
  }

  function createPanel(id, title, iconHtml, content, sectionEl) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'panels-rail-btn';
    btn.dataset.section = id;
    btn.setAttribute('aria-label', title);
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = iconHtml;
    btn.addEventListener('click', function() {
      btn.blur(); // keep keyboard shortcuts working right away
      togglePanel(id);
    });
    btn.addEventListener('mouseenter', function() { showTip(btn, title); });
    btn.addEventListener('mouseleave', hideTip);
    btn.addEventListener('focus', function() { showTip(btn, title); });
    btn.addEventListener('blur', hideTip);
    rail.appendChild(btn);

    var el = document.createElement('section');
    el.className = 'panels-panel';
    el.dataset.section = id;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', title);
    el.hidden = true;
    el.innerHTML =
      '<div class="panels-panel-head">' +
        '<span class="panels-panel-icon">' + iconHtml + '</span>' +
        '<h3 class="panels-panel-title"></h3>' +
        '<span class="panels-panel-grip" aria-hidden="true"><i data-lucide="grip-horizontal"></i></span>' +
        '<button type="button" class="panels-panel-close" aria-label="Close ' + title.replace(/"/g, '&quot;') + '">' +
          '<i data-lucide="x"></i></button>' +
      '</div>' +
      '<div class="panels-panel-body"></div>';
    el.querySelector('.panels-panel-title').textContent = title;
    var body = el.querySelector('.panels-panel-body');

    // Move the live section content (keeps all bindings) and pin it open
    content.classList.remove('collapsed');
    content.classList.add('expanded');
    body.appendChild(content);

    el.querySelector('.panels-panel-close').addEventListener('click', function(e) {
      e.currentTarget.blur();
      closePanel(id);
    });
    el.addEventListener('pointerdown', function() { raise(id); });
    makeDraggable(el, id);
    root.appendChild(el);

    panels[id] = { el: el, title: title, button: btn, section: sectionEl };
  }

  // ---------------------------------------------------------------------------
  // Open / close / z-order
  // ---------------------------------------------------------------------------
  function togglePanel(id) {
    if (order.indexOf(id) !== -1) closePanel(id);
    else openPanel(id);
  }

  function openPanel(id) {
    var p = panels[id];
    if (!p) return;
    if (order.indexOf(id) === -1) {
      p.el.hidden = false;
      var pos = positions[id] || [CASCADE_X + order.length * CASCADE_STEP, CASCADE_Y + order.length * CASCADE_STEP];
      place(p.el, pos[0], pos[1]);
      order.push(id);
      setExpanded(id, true);
      onOpened(id);
    }
    raise(id);
  }

  function closePanel(id) {
    var p = panels[id];
    var i = order.indexOf(id);
    if (!p || i === -1) return;
    p.el.hidden = true;
    order.splice(i, 1);
    setExpanded(id, false);
    onClosed(id);
    if (order.length) raise(order[order.length - 1]);
    else sync();
  }

  function raise(id) {
    var i = order.indexOf(id);
    if (i === -1) return;
    order.splice(i, 1);
    order.push(id);
    order.forEach(function(o, n) {
      panels[o].el.style.zIndex = String(210 + n); // between floating panels (200) and dialogs (300)
      panels[o].el.classList.toggle('is-top', n === order.length - 1);
    });
    sync();
  }

  function sync() {
    Object.keys(panels).forEach(function(id) {
      var on = order.indexOf(id) !== -1;
      panels[id].button.classList.toggle('active', on);
      panels[id].button.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // Keep ui.js' expandedSections in step so code reading it sees open panels
  function setExpanded(id, on) {
    if (!window.BimViewerUI || !BimViewerUI.expandedSections || id === ACCOUNT_ID) return;
    if (on) BimViewerUI.expandedSections.add(id);
    else BimViewerUI.expandedSections.delete(id);
  }

  // Same side effects as the classic bottom toolbar's Measure button
  function onOpened(id) {
    if (id !== 'drawing' || !window.BimViewer || typeof BimViewer.toggleMeasurementPanel !== 'function') return;
    var mp = document.getElementById('measurementPanel');
    if (!mp || mp.style.display === 'none') BimViewer.toggleMeasurementPanel();
  }

  function onClosed(id) {
    if (id !== 'drawing') return;
    var mp = document.getElementById('measurementPanel');
    if (mp) mp.style.display = 'none';
  }

  // ---------------------------------------------------------------------------
  // Position + drag
  // ---------------------------------------------------------------------------
  function place(el, x, y) {
    var w = el.offsetWidth || 340;
    var minVisible = 120; // header always reachable
    x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    y = Math.max(8, Math.min(y, window.innerHeight - minVisible));
    el.style.left = Math.round(x) + 'px';
    el.style.top = Math.round(y) + 'px';
    // Body scrolls instead of the panel running off the bottom edge
    el.style.maxHeight = Math.max(minVisible, Math.round(window.innerHeight - y - 16)) + 'px';
  }

  function makeDraggable(el, id) {
    var head = el.querySelector('.panels-panel-head');
    head.addEventListener('pointerdown', function(e) {
      if (e.button !== 0 || e.target.closest('button')) return;
      var sx = e.clientX, sy = e.clientY, ox = el.offsetLeft, oy = el.offsetTop;
      head.setPointerCapture(e.pointerId);
      head.classList.add('dragging');
      function move(ev) { place(el, ox + ev.clientX - sx, oy + ev.clientY - sy); }
      function up() {
        head.removeEventListener('pointermove', move);
        head.removeEventListener('pointerup', up);
        head.removeEventListener('pointercancel', up);
        head.classList.remove('dragging');
        positions[id] = [el.offsetLeft, el.offsetTop];
        savePositions();
      }
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
      head.addEventListener('pointercancel', up);
    });
  }

  // ---------------------------------------------------------------------------
  // Tooltip
  // ---------------------------------------------------------------------------
  function showTip(btn, text) {
    var r = btn.getBoundingClientRect();
    tip.textContent = text;
    tip.hidden = false;
    tip.style.left = Math.round(r.right + 10) + 'px';
    tip.style.top = Math.round(r.top + r.height / 2 - tip.offsetHeight / 2) + 'px';
  }

  function hideTip() { tip.hidden = true; }

  // ---------------------------------------------------------------------------
  // Mirrors of classic state
  // ---------------------------------------------------------------------------

  // Sections hidden by CSS (guest mode hides Splats/Inspection) lose their rail button
  function syncHiddenSections() {
    Object.keys(panels).forEach(function(id) {
      var section = panels[id].section;
      if (!section) return;
      var hidden = getComputedStyle(section).display === 'none';
      panels[id].button.hidden = hidden;
      if (hidden) closePanel(id);
    });
    // drop separators left without buttons before them
    Array.prototype.forEach.call(rail.querySelectorAll('.panels-rail-sep'), function(sep) {
      var prev = sep.previousElementSibling;
      while (prev && prev.hidden) prev = prev.previousElementSibling;
      sep.hidden = !prev || prev.classList.contains('panels-rail-sep');
    });
  }

  // auth.js shows/hides #toolbar inline; the panel UI follows it
  function syncAppVisible(toolbar) {
    root.hidden = toolbar.style.display === 'none';
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  // Other tools also use Esc (measuring, gizmo, walk mode, dialogs, tour).
  // Capture phase: decide before their handlers change state.
  function escBelongsToSomethingElse() {
    var bv = window.BimViewer;
    if (bv && bv.measurement && bv.measurement.active) return true;
    if (window.BimGizmo && BimGizmo.gizmo && (BimGizmo.gizmo.active || BimGizmo.gizmo.transformMode || BimGizmo.gizmo.dragging)) return true;
    if (window.BimFirstPerson && BimFirstPerson.isActive()) return true;
    if (document.pointerLockElement) return true;
    var dialogs = ['aboutDialog', 'tourOverlay', 'authGateOverlay'];
    return dialogs.some(function(d) {
      var el = document.getElementById(d);
      return el && el.offsetParent !== null;
    });
  }

  function onKeyDown(e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || (e.target && e.target.isContentEditable)) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if (e.key === 'Escape') {
      if (!order.length || root.hidden || escBelongsToSomethingElse()) return;
      closePanel(order[order.length - 1]);
      return;
    }
    // M: classic toggles the sidebar (ui.js, still bound); here it hides the panel UI
    if (e.key === 'm' || e.key === 'M') {
      document.documentElement.classList.toggle('panels-collapsed');
    }
  }

  // ---------------------------------------------------------------------------
  // Init — BimViewerUI.init() runs ~100 ms after load; wait for its sections
  // ---------------------------------------------------------------------------
  function init(toolbar) {
    build(toolbar);

    if (window.BimViewerUI) {
      BimViewerUI.toggleSection = function(sectionId, expand) {
        if (expand) openPanel(sectionId);
        else closePanel(sectionId);
      };
    }

    syncAppVisible(toolbar);
    new MutationObserver(function() { syncAppVisible(toolbar); })
      .observe(toolbar, { attributes: true, attributeFilter: ['style'] });

    syncHiddenSections();
    new MutationObserver(syncHiddenSections)
      .observe(document.body, { attributes: true, attributeFilter: ['class'] });

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', function() {
      order.forEach(function(id) { place(panels[id].el, panels[id].el.offsetLeft, panels[id].el.offsetTop); });
    });

    // Same default as the classic sidebar: Assets open
    openPanel('assets');

    BimPanelsUI.ready = true;
    console.log('✅ Panel UI (beta) ready — ' + Object.keys(panels).length + ' panels');
  }

  var tries = 0;
  var wait = setInterval(function() {
    tries++;
    var toolbar = document.getElementById('toolbar');
    var built = toolbar && toolbar.querySelector('.modern-section');
    if (!built && tries < 300) return;
    clearInterval(wait);
    if (!built) {
      console.warn('Panel UI: classic sections not found, staying on the sidebar');
      document.documentElement.classList.remove('ui-panels');
      return;
    }
    try {
      init(toolbar);
    } catch (err) {
      console.error('Panel UI failed, falling back to the sidebar:', err);
      document.documentElement.classList.remove('ui-panels');
    }
  }, 100);
})();
