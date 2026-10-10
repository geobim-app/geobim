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
 *
 * Phones (≤ 720 px): a bottom tab bar (Assets, Layers, Measure, Lighting,
 * More) replaces the rail; panels open one at a time as bottom sheets
 * (swipe the header down to close). Walk and Transform move from the
 * hidden bottom toolbar into "More".
 *
 * Also replaces two Cesium widgets (hidden by CSS, still constructed so
 * core.js and animationManager.js keep working): the geocoder by a search
 * bar at the top, the timeline by a date & time block in the Lighting panel.
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
  var PHONE_TABS = [
    ['assets', 'Assets'], ['layers', 'Layers'], ['drawing', 'Measure'], ['lighting', 'Lighting']
  ];
  var SWIPE_CLOSE_PX = 80;
  // Walk / Transform live in the classic bottom toolbar; on phones the tab
  // bar covers it, so "More" gets proxies that click the original buttons
  var MORE_ACTIONS = [
    ['bottomWalkBtn', 'Walk', 'person-standing'],
    ['gizmoTransformBtn', 'Transform', 'move-3d']
  ];
  var phone = window.matchMedia('(max-width: 720px)');

  var panels = {};      // section id → { el, title, button }
  var order = [];       // open panels, last = top
  var positions = loadPositions();
  var root, rail, tip, tabs, more;

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

    panels[id] = { el: el, title: title, icon: iconHtml, button: btn, section: sectionEl };
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
    hideMore();
    if (order.indexOf(id) === -1) {
      // Phones: one bottom sheet at a time
      if (phone.matches) order.slice().forEach(closePanel);
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
    if (!tabs) return;
    var top = order[order.length - 1];
    var inMain = PHONE_TABS.some(function(t) { return t[0] === top; });
    Array.prototype.forEach.call(tabs.querySelectorAll('.panels-tab'), function(t) {
      var on = t.dataset.section === 'more'
        ? (!more.hidden || (!!top && !inMain))
        : t.dataset.section === top;
      t.classList.toggle('active', on);
      t.setAttribute('aria-pressed', on ? 'true' : 'false');
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
    if (phone.matches) {
      // bottom sheet: CSS owns the position
      el.style.left = el.style.top = el.style.maxHeight = '';
      return;
    }
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
      if (phone.matches) { swipeToClose(e, el, head, id); return; }
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

  function swipeToClose(e, el, head, id) {
    var sy = e.clientY;
    head.setPointerCapture(e.pointerId);
    el.classList.add('is-swiping');
    function move(ev) {
      el.style.transform = 'translateY(' + Math.max(0, ev.clientY - sy) + 'px)';
    }
    function up(ev) {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      head.removeEventListener('pointercancel', up);
      el.classList.remove('is-swiping');
      el.style.transform = '';
      if (ev.type === 'pointerup' && ev.clientY - sy > SWIPE_CLOSE_PX) closePanel(id);
    }
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  }

  // ---------------------------------------------------------------------------
  // Phone tab bar + "More" sheet
  // ---------------------------------------------------------------------------
  function tabButton(id, label, iconHtml) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'panels-tab';
    b.dataset.section = id;
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = '<span class="panels-tab-icon">' + iconHtml + '</span><span class="panels-tab-label"></span>';
    b.querySelector('.panels-tab-label').textContent = label;
    return b;
  }

  function buildTabs() {
    tabs = document.createElement('nav');
    tabs.className = 'panels-tabs';
    tabs.setAttribute('aria-label', 'Tools');
    more = document.createElement('div');
    more.className = 'panels-more';
    more.setAttribute('role', 'dialog');
    more.setAttribute('aria-label', 'More tools');
    more.hidden = true;

    var main = PHONE_TABS.map(function(t) { return t[0]; });
    PHONE_TABS.forEach(function(t) {
      if (panels[t[0]]) tabs.appendChild(tabButton(t[0], t[1], panels[t[0]].icon));
    });
    tabs.appendChild(tabButton('more', 'More', '<i data-lucide="ellipsis"></i>'));

    // Everything else, in rail order
    Array.prototype.forEach.call(rail.querySelectorAll('.panels-rail-btn'), function(btn) {
      var id = btn.dataset.section;
      if (main.indexOf(id) !== -1) return;
      var item = tabButton(id, panels[id].title, panels[id].icon);
      item.classList.add('panels-more-item');
      more.appendChild(item);
    });

    MORE_ACTIONS.forEach(function(a) {
      var target = document.getElementById(a[0]);
      if (!target) return;
      var item = tabButton(a[0], a[1], '<i data-lucide="' + a[2] + '"></i>');
      delete item.dataset.section;
      item.dataset.action = a[0];
      item.classList.add('panels-more-item', 'panels-more-action');
      more.appendChild(item);
      // mirror the original button's on/off state (also when toggled by G / X)
      var mirror = function() {
        var on = target.classList.contains('active');
        item.classList.toggle('active', on);
        item.setAttribute('aria-pressed', on ? 'true' : 'false');
      };
      mirror();
      new MutationObserver(mirror).observe(target, { attributes: true, attributeFilter: ['class'] });
    });

    tabs.addEventListener('click', function(e) {
      var b = e.target.closest('.panels-tab');
      if (!b) return;
      b.blur();
      if (b.dataset.section === 'more') {
        if (more.hidden) showMore();
        else hideMore();
        return;
      }
      togglePanel(b.dataset.section);
    });
    more.addEventListener('click', function(e) {
      var b = e.target.closest('.panels-tab');
      if (!b) return;
      b.blur();
      if (b.dataset.action) {
        hideMore();
        var target = document.getElementById(b.dataset.action);
        if (target) target.click();
        return;
      }
      openPanel(b.dataset.section);
    });

    root.appendChild(more);
    root.appendChild(tabs);
  }

  function showMore() {
    order.slice().forEach(closePanel);
    more.hidden = false;
    sync();
  }

  function hideMore() {
    if (!more || more.hidden) return;
    more.hidden = true;
    sync();
  }

  // Crossing the breakpoint: phone keeps only the top panel as a sheet,
  // desktop puts the open panels back where they were
  function onBreakpoint() {
    hideMore();
    if (phone.matches) {
      order.slice(0, -1).forEach(closePanel);
    }
    order.forEach(function(id, n) {
      var pos = positions[id] || [CASCADE_X + n * CASCADE_STEP, CASCADE_Y + n * CASCADE_STEP];
      place(panels[id].el, pos[0], pos[1]);
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
      if (tabs) {
        Array.prototype.forEach.call(root.querySelectorAll('.panels-tab[data-section="' + id + '"]'), function(t) { t.hidden = hidden; });
      }
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
      if (more && !more.hidden) { hideMore(); return; }
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
  // Search bar (replaces the Cesium geocoder box, which is hidden by CSS).
  // Uses the geocoder widget's own services, so core.js' binding to the
  // default Ion token (geocode scope) keeps applying.
  // ---------------------------------------------------------------------------
  function buildSearch() {
    var wrap = document.createElement('div');
    wrap.className = 'panels-search';
    wrap.setAttribute('role', 'search');
    wrap.innerHTML =
      '<div class="panels-search-box">' +
        '<i data-lucide="search"></i>' +
        '<input type="search" class="panels-search-input" placeholder="Search address, place or coordinates" ' +
          'autocomplete="off" spellcheck="false" aria-label="Search address, place or coordinates" ' +
          'aria-controls="panelsSearchResults" aria-expanded="false">' +
      '</div>' +
      '<div class="panels-search-results" id="panelsSearchResults" role="listbox" hidden></div>';
    root.appendChild(wrap);

    var input = wrap.querySelector('input');
    var list = wrap.querySelector('.panels-search-results');
    var results = [];
    var active = -1;
    var timer = null;
    var seq = 0;

    function geocoderVM() {
      var v = window.BimViewer && BimViewer.viewer;
      return v && v.geocoder ? v.geocoder.viewModel : null;
    }

    // "48.137, 11.575" or "48.137 11.575" → lat, lon
    function parseCoordinates(q) {
      var m = q.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
      if (!m) return null;
      var lat = parseFloat(m[1]), lon = parseFloat(m[2]);
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
      return {
        displayName: lat.toFixed(5) + '°, ' + lon.toFixed(5) + '°',
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, 1500),
        meta: 'Coordinates'
      };
    }

    async function lookup(q, type) {
      var coords = parseCoordinates(q);
      if (coords) return [coords];
      var vm = geocoderVM();
      var services = vm && vm._geocoderServices;
      if (!services || !services.length) return [];
      for (var i = 0; i < services.length; i++) {
        try {
          var found = await services[i].geocode(q, type);
          if (found && found.length) {
            // the Ion geocoder can return the same name twice
            var seen = {};
            return found.filter(function(f) {
              if (seen[f.displayName]) return false;
              seen[f.displayName] = true;
              return true;
            }).slice(0, 6);
          }
        } catch (err) {
          console.warn('Search: geocoder failed —', err.message || err);
        }
      }
      return [];
    }

    function render(items, emptyText) {
      results = items;
      active = items.length ? 0 : -1;
      list.innerHTML = '';
      if (!items.length) {
        if (emptyText) {
          var empty = document.createElement('div');
          empty.className = 'panels-search-empty';
          empty.textContent = emptyText;
          list.appendChild(empty);
        }
      }
      items.forEach(function(item, i) {
        var opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'panels-search-result';
        opt.setAttribute('role', 'option');
        opt.dataset.index = String(i);
        var name = document.createElement('span');
        name.textContent = item.displayName;
        opt.appendChild(name);
        if (item.meta) {
          var meta = document.createElement('small');
          meta.textContent = item.meta;
          opt.appendChild(meta);
        }
        list.appendChild(opt);
      });
      highlight();
      var show = !!(items.length || emptyText);
      list.hidden = !show;
      input.setAttribute('aria-expanded', show ? 'true' : 'false');
    }

    function highlight() {
      Array.prototype.forEach.call(list.querySelectorAll('.panels-search-result'), function(el, i) {
        el.classList.toggle('active', i === active);
        el.setAttribute('aria-selected', i === active ? 'true' : 'false');
      });
    }

    function hide() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    }

    function go(item) {
      var vm = geocoderVM();
      if (!item || !item.destination) return;
      input.value = item.displayName;
      hide();
      input.blur();
      if (vm && typeof vm.destinationFound === 'function') vm.destinationFound(vm, item.destination);
      else BimViewer.viewer.camera.flyTo({ destination: item.destination });
    }

    async function search(type) {
      var q = input.value.trim();
      var mine = ++seq;
      if (q.length < 3 && !parseCoordinates(q)) { render([]); return; }
      var items = await lookup(q, type);
      if (mine !== seq) return; // a newer query is already on its way
      render(items, type === Cesium.GeocodeType.SEARCH ? 'No place found' : '');
      return items;
    }

    input.addEventListener('input', function() {
      clearTimeout(timer);
      timer = setTimeout(function() { search(Cesium.GeocodeType.AUTOCOMPLETE); }, 300);
    });

    input.addEventListener('keydown', function(e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!results.length) return;
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
        highlight();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(timer);
        if (!list.hidden && results[active]) { go(results[active]); return; }
        search(Cesium.GeocodeType.SEARCH).then(function(items) { if (items && items.length) go(items[0]); });
      } else if (e.key === 'Escape') {
        if (!list.hidden) hide();
        else input.blur();
      }
    });

    list.addEventListener('click', function(e) {
      var opt = e.target.closest('.panels-search-result');
      if (opt) go(results[parseInt(opt.dataset.index, 10)]);
    });

    document.addEventListener('pointerdown', function(e) {
      if (!wrap.contains(e.target)) hide();
    });
  }

  // ---------------------------------------------------------------------------
  // Date & time block in the Lighting panel (replaces the Cesium timeline,
  // hidden by CSS). Time is the civil local time at the camera — time zone
  // from the position (tz-lookup, self-hosted offline table), daylight saving via
  // Intl — so shadow studies match clocks on site. Until tz-lookup has
  // loaded (or if it can't), local mean solar time (UTC + lon / 15) is the
  // fallback. viewer.clock stays UTC; Saved Scenes are unaffected.
  // ---------------------------------------------------------------------------
  var SPEEDS = [1, 60, 600, 3600];
  var TZ_LOOKUP_URL = 'vendor/tz-lookup-6.1.25.js'; // self-hosted, see vendor/README.md
  var tzFormatters = {};

  function loadTzLookup() {
    if (window.tzlookup) return Promise.resolve(true);
    return new Promise(function(resolve) {
      var s = document.createElement('script');
      s.src = TZ_LOOKUP_URL;
      s.onload = function() { resolve(typeof window.tzlookup === 'function'); };
      s.onerror = function() {
        console.warn('Date & time: tz-lookup not available, showing solar time');
        resolve(false);
      };
      document.head.appendChild(s);
    });
  }

  function zoneFormatter(zone) {
    if (!tzFormatters[zone]) {
      tzFormatters[zone] = new Intl.DateTimeFormat('en-US', {
        timeZone: zone, hourCycle: 'h23',
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric'
      });
    }
    return tzFormatters[zone];
  }

  // Offset of zone from UTC at a UTC instant, in ms (DST included)
  function zoneOffsetMs(zone, utcMs) {
    var parts = {};
    zoneFormatter(zone).formatToParts(new Date(utcMs)).forEach(function(x) { parts[x.type] = x.value; });
    var wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
    return wall - Math.floor(utcMs / 1000) * 1000;
  }

  // Short zone name: en-US knows EDT/PST, en-GB knows CEST/BST; else GMT+n
  function zoneAbbr(zone, utcMs) {
    function abbr(locale) {
      var key = zone + '|' + locale;
      if (!tzFormatters[key]) tzFormatters[key] = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' });
      var part = tzFormatters[key]
        .formatToParts(new Date(utcMs)).filter(function(x) { return x.type === 'timeZoneName'; })[0];
      return part ? part.value : '';
    }
    var a = abbr('en-US');
    if (/^(GMT|UTC)/.test(a)) {
      var gb = abbr('en-GB');
      if (gb && !/^(GMT|UTC)[+-]/.test(gb)) a = gb;
    }
    return a;
  }

  function utcOffsetLabel(ms) {
    var min = Math.round(ms / 60000), sign = min < 0 ? '−' : '+';
    min = Math.abs(min);
    return 'UTC' + sign + Math.floor(min / 60) + (min % 60 ? ':' + (min % 60 < 10 ? '0' : '') + (min % 60) : '');
  }

  function buildClock() {
    var p = panels.lighting;
    var viewer = window.BimViewer && BimViewer.viewer;
    if (!p || !viewer) return false;
    var clock = viewer.clock;

    var box = document.createElement('div');
    box.className = 'panels-clock';
    box.innerHTML =
      '<div class="modern-label">Date &amp; time</div>' +
      '<div class="panels-clock-row">' +
        '<input type="date" class="zoffset-input-box panels-clock-date" aria-label="Date">' +
        '<output class="panels-clock-time" aria-live="off">--:--</output>' +
        '<span class="panels-clock-zone"></span>' +
      '</div>' +
      '<input type="range" class="modern-slider panels-clock-slider" min="0" max="1435" step="5" aria-label="Time of day">' +
      '<div class="panels-clock-row">' +
        '<button type="button" class="modern-btn modern-btn-small panels-clock-play" aria-label="Pause time"></button>' +
        '<select class="modern-select panels-clock-speed" aria-label="Time speed">' +
          SPEEDS.map(function(s) { return '<option value="' + s + '">' + (s === 1 ? 'Real time' : s + '×') + '</option>'; }).join('') +
        '</select>' +
        '<button type="button" class="modern-btn modern-btn-small panels-clock-now">Now</button>' +
      '</div>' +
      '<p class="modern-hint panels-clock-hint"></p>';
    p.el.querySelector('.panels-panel-body').appendChild(box);

    var dateIn = box.querySelector('.panels-clock-date');
    var timeOut = box.querySelector('.panels-clock-time');
    var slider = box.querySelector('.panels-clock-slider');
    var playBtn = box.querySelector('.panels-clock-play');
    var speedSel = box.querySelector('.panels-clock-speed');
    var hint = box.querySelector('.panels-clock-hint');
    var zoneOut = box.querySelector('.panels-clock-zone');
    var editing = false;
    var tzReady = false;

    loadTzLookup().then(function(ok) {
      tzReady = ok;
      refresh(true);
    });

    // IANA zone at the camera, or null → solar time
    function zone() {
      var c = viewer.camera.positionCartographic;
      if (!tzReady || !c) return null;
      try {
        return window.tzlookup(Cesium.Math.toDegrees(c.latitude), Cesium.Math.toDegrees(c.longitude));
      } catch (_) {
        return null;
      }
    }

    // Offset from UTC at a UTC instant: civil time zone, else solar time
    function offsetMs(z, utcMs) {
      if (z) {
        try { return zoneOffsetMs(z, utcMs); } catch (_) { /* unknown zone → solar */ }
      }
      var c = viewer.camera.positionCartographic;
      return c ? Cesium.Math.toDegrees(c.longitude) / 15 * 3600e3 : 0;
    }

    function pad(n) { return (n < 10 ? '0' : '') + n; }

    function hhmm(minutes) { return pad(Math.floor(minutes / 60)) + ':' + pad(Math.round(minutes % 60)); }

    // clock (UTC) → local date + minutes at the camera
    function readLocal() {
      var utc = Cesium.JulianDate.toDate(clock.currentTime).getTime();
      var z = zone();
      var off = offsetMs(z, utc);
      var local = new Date(utc + off);
      return {
        date: local.toISOString().slice(0, 10),
        minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
        utc: new Date(utc),
        zone: z,
        offset: off
      };
    }

    // local date + minutes at the camera → clock (UTC). Second pass picks
    // the offset valid at the result (days with a DST switch).
    function writeLocal(dateStr, minutes) {
      var parts = dateStr.split('-').map(Number);
      if (parts.length !== 3 || parts.some(isNaN)) return;
      var wall = Date.UTC(parts[0], parts[1] - 1, parts[2]) + minutes * 60e3;
      var z = zone();
      var utc = wall - offsetMs(z, wall);
      var off2 = offsetMs(z, utc);
      if (wall - off2 !== utc) utc = wall - off2;
      clock.currentTime = Cesium.JulianDate.fromDate(new Date(utc));
      refresh(true);
    }

    function refresh(force) {
      if (editing && !force) return;
      var l = readLocal();
      if (document.activeElement !== dateIn) dateIn.value = l.date;
      if (!editing) slider.value = String(l.minutes - (l.minutes % 5));
      timeOut.textContent = hhmm(l.minutes);
      var utcText = 'UTC ' + pad(l.utc.getUTCHours()) + ':' + pad(l.utc.getUTCMinutes());
      if (l.zone) {
        var abbr = zoneAbbr(l.zone, l.utc.getTime());
        zoneOut.textContent = abbr;
        hint.textContent = l.zone + ' (' + utcOffsetLabel(l.offset) + ') · ' + utcText;
      } else {
        zoneOut.textContent = 'solar';
        hint.textContent = 'Local solar time at the camera · ' + utcText;
      }
      var playing = clock.shouldAnimate;
      if (playBtn.dataset.state !== String(playing)) {
        playBtn.dataset.state = String(playing);
        playBtn.innerHTML = '<i data-lucide="' + (playing ? 'pause' : 'play') + '"></i><span>' + (playing ? 'Pause' : 'Play') + '</span>';
        playBtn.setAttribute('aria-label', playing ? 'Pause time' : 'Play time');
        if (window.lucide) lucide.createIcons();
      }
      var m = String(clock.multiplier);
      if (SPEEDS.indexOf(clock.multiplier) !== -1 && speedSel.value !== m) speedSel.value = m;
    }

    slider.addEventListener('pointerdown', function() { editing = true; });
    slider.addEventListener('input', function() {
      editing = true;
      timeOut.textContent = hhmm(parseInt(slider.value, 10));
      writeLocal(dateIn.value, parseInt(slider.value, 10));
    });
    slider.addEventListener('change', function() { editing = false; refresh(true); });
    dateIn.addEventListener('change', function() {
      writeLocal(dateIn.value, parseInt(slider.value, 10));
    });
    playBtn.addEventListener('click', function() {
      playBtn.blur();
      clock.shouldAnimate = !clock.shouldAnimate;
      refresh(true);
    });
    speedSel.addEventListener('change', function() {
      clock.multiplier = parseFloat(speedSel.value) || 1;
      speedSel.blur();
    });
    box.querySelector('.panels-clock-now').addEventListener('click', function(e) {
      e.currentTarget.blur();
      clock.currentTime = Cesium.JulianDate.now();
      refresh(true);
    });

    // Follow the clock (and camera longitude) while the panel is open
    var last = 0;
    clock.onTick.addEventListener(function() {
      if (p.el.hidden) return;
      var now = performance.now();
      if (now - last < 250) return;
      last = now;
      refresh(false);
    });
    refresh(true);
    return true;
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

    buildTabs();
    if (phone.addEventListener) phone.addEventListener('change', onBreakpoint);
    else if (phone.addListener) phone.addListener(onBreakpoint);

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

    buildSearch();
    // The viewer may still be starting; the clock block needs it
    var clockTries = 0;
    (function waitViewer() {
      if (buildClock() || ++clockTries > 300) return;
      setTimeout(waitViewer, 200);
    })();
    if (window.lucide) lucide.createIcons();

    // Same default as the classic sidebar: Assets open (desktop only — on a
    // phone a sheet at start would cover half the map)
    if (!phone.matches) openPanel('assets');

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
