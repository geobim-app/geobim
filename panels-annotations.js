/*
 * geobim.app — Panel UI: Annotations panel + "Recent Annotations" widget (beta)
 * comments.js and ui-helpers-modern.js write emoji glyphs into buttons, hints
 * and list titles (CLAUDE.md: no emojis as UI icons). In the panel layout the
 * type buttons and the list buttons get Lucide icons, every other glyph is
 * removed — also when comments.js rewrites a label later. Styles in
 * panels-annotations.css. The modules themselves stay unchanged.
 */
(function() {
  'use strict';

  // Emoji / dingbat glyphs (+ variation selector), with the space after them
  var GLYPH = /(?:[☀-➿⬀-⯿〰]|[\uD83C-\uD83E][\uDC00-\uDFFF])[️‍]*\s?/g;
  var TYPE_ICONS = {
    annotationTypePoint: 'map-pin',
    annotationTypeCircle: 'circle',
    annotationTypePolyline: 'spline',
    annotationTypeArea: 'hexagon'
  };
  var LIST_ICONS = { 'bcf-btn': 'package', 'edit-btn': 'pencil', 'delete-btn': 'trash-2' };

  function icon(name) {
    return '<i data-lucide="' + name + '"></i>';
  }

  function scrub(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var node, changed = false;
    while ((node = walker.nextNode())) {
      GLYPH.lastIndex = 0;
      if (!GLYPH.test(node.nodeValue)) continue;
      node.nodeValue = node.nodeValue.replace(GLYPH, '');
      changed = true;
    }
    // emoji-only icon spans are empty now
    Array.prototype.forEach.call(root.querySelectorAll('.modern-btn-icon'), function(s) {
      if (!s.textContent.trim() && !s.querySelector('svg, i')) s.hidden = true;
    });
    return changed;
  }

  function setIcon(btn, name) {
    if (btn.dataset.pnlIcon === name && btn.querySelector('svg')) return false;
    btn.dataset.pnlIcon = name;
    btn.innerHTML = icon(name);
    return true;
  }

  function fixList(list) {
    var changed = scrub(list);
    Array.prototype.forEach.call(list.querySelectorAll('.modern-comment-btn'), function(btn) {
      Object.keys(LIST_ICONS).forEach(function(cls) {
        if (btn.classList.contains(cls) && setIcon(btn, LIST_ICONS[cls])) changed = true;
      });
    });
    if (changed && window.lucide) lucide.createIcons();
  }

  function watch(el, fn) {
    var busy = false;
    fn();
    new MutationObserver(function() {
      if (busy) return;
      busy = true;
      try { fn(); } finally { busy = false; }
    }).observe(el, { childList: true, subtree: true, characterData: true });
  }

  function wireSection(panel) {
    Object.keys(TYPE_ICONS).forEach(function(id) {
      var btn = document.getElementById(id);
      if (btn) setIcon(btn, TYPE_ICONS[id]);
    });
    watch(panel, function() { scrub(panel); });
    if (window.lucide) lucide.createIcons();
  }

  function wireWidget() {
    var widget = document.getElementById('floatingCommentsPanel');
    if (!widget || widget.dataset.pnlWired) return;
    widget.dataset.pnlWired = '1';
    widget.classList.add('pnl-annot-widget');
    scrub(widget.querySelector('.floating-panel-header'));
    var close = widget.querySelector('.floating-panel-btn[title="Close"]');
    if (close) {
      close.innerHTML = icon('x');
      close.setAttribute('aria-label', 'Close');
    }
    var grip = document.createElement('span');
    grip.className = 'pnl-annot-grip';
    grip.setAttribute('aria-hidden', 'true');
    grip.innerHTML = icon('grip-horizontal');
    widget.querySelector('.floating-panel-header').prepend(grip);
    var list = document.getElementById('commentsList');
    if (list) watch(list, function() { fixList(list); });
    if (window.lucide) lucide.createIcons();
  }

  function init() {
    var panel = document.querySelector('.panels-panel[data-section="comments"]');
    if (panel) wireSection(panel);
    // The widget is created lazily (first open / first list update)
    var create = BimViewer.createCommentsPanel;
    if (typeof create === 'function') {
      BimViewer.createCommentsPanel = function() {
        var r = create.apply(this, arguments);
        wireWidget();
        return r;
      };
    }
    wireWidget();
  }

  (function wait() {
    if (window.BimPanelsUI && BimPanelsUI.ready && window.BimViewer) init();
    else setTimeout(wait, 200);
  })();
})();
