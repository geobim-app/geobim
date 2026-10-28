/**
 * geobim.app — Measure and Clip panels in desktop style (panel UI, beta)
 *
 * Loaded by panels-ui-loader.js after panels-tree.js, so only in the panel
 * layout; the classic sidebar and its floating measurement panel stay as
 * they are.
 *
 * MEASURE  TOOLS (Distance, Area, Height/Terrain, Vertical, Coordinates,
 *          Clear all; the active one highlighted) · RESULT (live result with
 *          its Copy buttons; Finish / Cancel while measuring, for touch,
 *          where there is no right-click or Enter) · SAVED · n
 * CLIP     DRAW (Polygon, Rectangle, shortcuts) · OPTIONS (on/off rows) ·
 *          POLYGONS · n (list, Remove last, Clear all) · hint to the
 *          per-asset section planes on the asset cards
 *
 * Pure UI restructuring: the elements of #measurementPanel (measurement.js,
 * measurement-store.js) and of the Clip panel keep their IDs and handlers.
 * #measurementPanel itself stays in the DOM, hidden by CSS: panels-ui.js
 * still sets its inline display when the Measure panel opens/closes, which
 * features.js reads (isMeasurementPanelOpen) to pause element picking.
 */
(function() {
  'use strict';

  var tree = BimPanelsTree.create('geobim_measure_tree');
  var node = tree.node;
  var el = tree.el;
  var add = tree.add;

  function byId(id) { return document.getElementById(id); }

  // measurement.type → the tool button that started it
  var TOOL_BY_TYPE = {
    distance: 'startDistanceMeasurement',
    area: 'startAreaMeasurement',
    height: 'startHeightOverTerrain',
    vertical: 'startVerticalDistance',
    coordinates: 'startCoordinatePick'
  };

  function onclickName(btn) {
    var m = /BimViewer\.(\w+)\(/.exec(btn.getAttribute('onclick') || '');
    return m ? m[1] : '';
  }

  function park(holder, e) { if (e) holder.appendChild(e); }

  // Drop dividers / label-only wrappers, keep anything unknown in "More"
  function sweep(old, content, more) {
    old.forEach(function(e) {
      if (e.parentNode !== content) return;
      var labelOnly = !e.querySelector('input, button, select, textarea, a, [id]') &&
        (e.children.length ? Array.prototype.every.call(e.children, function(c) {
          return c.classList.contains('modern-label') || c.classList.contains('modern-btn-group') && !c.children.length;
        }) : !e.textContent.trim());
      if (e.classList.contains('modern-divider') || labelOnly) { e.remove(); return; }
      more.sub.appendChild(e);
    });
  }

  // ---------------------------------------------------------------------------
  // MEASURE
  // ---------------------------------------------------------------------------
  function buildMeasure(content) {
    // measurement.js builds (and on init rebuilds) #measurementPanel itself;
    // wait for that instead of creating it here
    var body = byId('measurementPanelBody');
    if (!body || !body.querySelector('.ms-tool-btn')) return false;

    var old = Array.prototype.slice.call(content.children);
    var root = el('div', 'pnl-tree');
    var parked = el('div', 'pnl-parked');
    parked.hidden = true;

    // TOOLS
    var tools = node('m:tools', 'Tools', true, { top: true });
    var grid = el('div', 'pnl-tools');
    Array.prototype.forEach.call(body.querySelectorAll('.ms-tool-btn'), function(btn) {
      btn.dataset.tool = onclickName(btn);
      btn.removeAttribute('style'); // inline gradients → panel styles
      grid.appendChild(btn);
    });
    add(tools.sub, grid);

    // RESULT (+ Finish / Cancel while measuring)
    var result = node('m:result', 'Result', true, { top: true });
    var hint = Array.prototype.find.call(body.children, function(c) { return /to place/i.test(c.textContent); });
    if (hint) { hint.removeAttribute('style'); hint.className = 'modern-hint pnl-hint'; }
    var resultBox = byId('measurementResult');
    if (resultBox) resultBox.removeAttribute('style');
    var actions = el('div', 'pnl-actions');
    var finish = el('button', 'modern-btn modern-btn-primary modern-btn-small', 'Finish');
    finish.type = 'button';
    finish.id = 'pnlMeasureFinish';
    var cancel = el('button', 'modern-btn modern-btn-secondary modern-btn-small', 'Cancel');
    cancel.type = 'button';
    cancel.id = 'pnlMeasureCancel';
    add(actions, finish, cancel);
    add(result.sub, resultBox, actions, hint);

    // SAVED · n (measurement-store.js injects its block into #measurementPanelBody)
    var saved = node('m:saved', 'Saved', true, { top: true, meta: true });

    var more = node('m:more', 'More', false, { top: true });
    old.forEach(function(e) {
      if (e.parentNode === content && e.querySelector('#toggleMeasurement')) park(parked, e);
    });
    sweep(old, content, more);
    // the floating body keeps only what another module may still add;
    // the emptied button rows go
    Array.prototype.slice.call(body.children).forEach(function(c) {
      if (c.id !== 'savedMeasurementsContainer' && !c.querySelector('*') && !c.textContent.trim()) c.remove();
    });

    add(root, tools, result, saved);
    if (more.sub.children.length) root.appendChild(more);
    root.appendChild(parked);
    content.innerHTML = '';
    content.appendChild(root);

    var placeSaved = function() {
      var block = byId('savedMeasurementsContainer');
      if (block && block.parentNode !== saved.sub) {
        block.removeAttribute('style');
        saved.sub.appendChild(block);
      }
      var items = byId('savedMeasurementsItems');
      var n = items ? items.querySelectorAll('.ms-saved-item').length : 0;
      saved.meta.textContent = n ? String(n) : '';
      if (items) items.removeAttribute('style');
    };
    new MutationObserver(placeSaved).observe(body, { childList: true });
    var watchItems = function() {
      var items = byId('savedMeasurementsItems');
      if (items && !items.pnlWatched) {
        items.pnlWatched = true;
        new MutationObserver(placeSaved).observe(items, { childList: true });
      }
    };
    new MutationObserver(watchItems).observe(saved.sub, { childList: true });
    placeSaved();
    watchItems();

    // Active tool + Finish/Cancel follow BimViewer.measurement
    var sync = function() {
      var m = BimViewer.measurement || {};
      var activeTool = m.active ? TOOL_BY_TYPE[m.type] : '';
      Array.prototype.forEach.call(grid.children, function(btn) {
        var on = !!activeTool && btn.dataset.tool === activeTool;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      actions.hidden = !m.active;
      finish.hidden = m.type !== 'area';
    };
    grid.addEventListener('click', function() { setTimeout(sync, 0); });
    finish.addEventListener('click', function() {
      if (typeof BimViewer.completeAreaMeasurement === 'function') BimViewer.completeAreaMeasurement();
      setTimeout(sync, 0);
    });
    cancel.addEventListener('click', function() {
      if (typeof BimViewer.cancelMeasurement === 'function') BimViewer.cancelMeasurement();
      setTimeout(sync, 0);
    });
    // every step and the end of a measurement rewrite #measurementResult
    if (resultBox) new MutationObserver(sync).observe(resultBox, { childList: true, subtree: true, characterData: true });
    document.addEventListener('keyup', function(e) { if (e.key === 'Escape' || e.key === 'Enter') setTimeout(sync, 0); });
    sync();
    return true;
  }

  // ---------------------------------------------------------------------------
  // CLIP
  // ---------------------------------------------------------------------------
  var OPTION_LABELS = [
    ['toggleClippingEnabled', 'Clipping'],
    ['toggleInverseClipping', 'Direction'],
    ['toggleClippingVisualization', 'Polygon outline'],
    ['toggleTerrainClipping', 'Terrain']
  ];

  function buildClip(content) {
    var drawBtn = byId('startClippingDraw');
    if (!drawBtn) return false;
    var old = Array.prototype.slice.call(content.children);
    var root = el('div', 'pnl-tree');

    // DRAW
    var draw = node('c:draw', 'Draw', true, { top: true, meta: true });
    var group = drawBtn.closest('.modern-btn-group');
    if (group) group.className = 'pnl-tools';
    var shortcuts = node('c:shortcuts', 'Shortcuts', false);
    var hint = drawBtn.closest('.modern-group') && drawBtn.closest('.modern-group').querySelector('.modern-hint');
    if (hint) hint.removeAttribute('style');
    add(shortcuts.sub, hint);
    add(draw.sub, group, shortcuts);

    // OPTIONS: fixed label | the existing button showing its state text
    var options = node('c:options', 'Options', true, { top: true });
    OPTION_LABELS.forEach(function(o) {
      var btn = byId(o[0]);
      if (!btn) return;
      var row = el('div', 'pnl-toggle-row');
      add(row, el('span', 'pnl-toggle-label', o[1]), btn);
      options.sub.appendChild(row);
    });

    // POLYGONS · n
    var polys = node('c:polygons', 'Polygons', true, { top: true, meta: true });
    var actions = byId('removeLastPolygon') && byId('removeLastPolygon').closest('.modern-btn-group');
    if (actions) actions.className = 'pnl-actions';
    add(polys.sub, byId('clippingPolygonList'), actions);

    // section planes live on the asset cards
    var planes = el('p', 'modern-hint pnl-hint');
    planes.appendChild(document.createTextNode('Section planes per asset: '));
    var link = el('button', 'pnl-link pnl-inline-link', 'Assets panel → card');
    link.type = 'button';
    link.addEventListener('click', function() {
      if (window.BimPanelsUI) BimPanelsUI.open('assets');
    });
    planes.appendChild(link);

    var parked = el('div', 'pnl-parked');
    parked.hidden = true;
    park(parked, byId('clippingPolygonCount'));

    var more = node('c:more', 'More', false, { top: true });
    sweep(old, content, more);

    add(root, draw, options, polys, planes);
    if (more.sub.children.length) root.appendChild(more);
    root.appendChild(parked);
    content.innerHTML = '';
    content.appendChild(root);

    // headers: drawing state and polygon count
    var list = byId('clippingPolygonList');
    var rect = byId('startClippingRect');
    var sync = function() {
      var drawing = drawBtn.classList.contains('active') || (rect && rect.classList.contains('active'));
      draw.meta.textContent = drawing ? 'drawing…' : '';
      var badge = byId('clippingPolygonCount');
      var n = badge ? parseInt(badge.textContent, 10) || 0 : 0;
      polys.meta.textContent = n ? String(n) : '';
    };
    [drawBtn, rect].forEach(function(b) {
      if (b) new MutationObserver(sync).observe(b, { attributes: true, attributeFilter: ['class'] });
    });
    if (list) new MutationObserver(sync).observe(list, { childList: true, subtree: true });
    var badge = byId('clippingPolygonCount');
    if (badge) new MutationObserver(sync).observe(badge, { childList: true, characterData: true, subtree: true });
    sync();
    return true;
  }

  // ---------------------------------------------------------------------------
  var doneMeasure = false;
  var doneClip = false;
  var tries = 0;
  (function wait() {
    if (window.BimPanelsUI && BimPanelsUI.ready && window.BimViewer) {
      if (!doneMeasure) {
        var m = document.querySelector('.panels-panel[data-section="drawing"] .modern-section-content');
        if (m) doneMeasure = buildMeasure(m);
      }
      if (!doneClip) {
        var c = document.querySelector('.panels-panel[data-section="clip"] .panels-clip-content');
        if (c) doneClip = buildClip(c);
      }
      if (doneMeasure && doneClip) {
        if (window.lucide) lucide.createIcons();
        return;
      }
    }
    if (++tries > 200) return;
    setTimeout(wait, 300);
  })();
})();
