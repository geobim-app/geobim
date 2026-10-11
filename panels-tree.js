/**
 * geobim.app — shared tree building blocks for the panel UI (beta)
 *
 * Loaded by panels-ui-loader.js before panels-layers.js / panels-assets.js.
 * BimPanelsTree.create(storageKey) returns helpers whose collapsible nodes
 * remember their expanded state in localStorage under that key (a per-browser
 * convenience, every access wrapped in try/catch).
 *
 * Markup: <div.pnl-branch[data-node]><button.pnl-node/><div.pnl-sub/></div>
 * Styles: panels-ui.css (.pnl-node / .pnl-sub / .pnl-item / .pnl-field …)
 */
(function() {
  'use strict';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function add(parent) {
    for (var i = 1; i < arguments.length; i++) {
      if (arguments[i]) parent.appendChild(arguments[i]);
    }
    return parent;
  }

  function create(storageKey) {
    var open;
    try { open = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch (_) { open = {}; }

    function save() {
      try { localStorage.setItem(storageKey, JSON.stringify(open)); } catch (_) {}
    }

    // opts: top (uppercase section header), meta (right-aligned info), cls
    function node(key, title, defaultOpen, opts) {
      opts = opts || {};
      var wrap = el('div', 'pnl-branch' + (opts.top ? ' pnl-top' : '') + (opts.cls ? ' ' + opts.cls : ''));
      wrap.dataset.node = key;
      var btn = el('button', 'pnl-node');
      btn.type = 'button';
      btn.appendChild(el('span', 'pnl-node-title', title));
      if (opts.meta) btn.appendChild(el('span', 'pnl-node-meta'));
      var sub = el('div', 'pnl-sub');
      var isOpen = key in open ? !!open[key] : !!defaultOpen;
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      sub.hidden = !isOpen;
      btn.addEventListener('click', function() {
        var now = btn.getAttribute('aria-expanded') !== 'true';
        btn.setAttribute('aria-expanded', now ? 'true' : 'false');
        sub.hidden = !now;
        open[key] = now;
        save();
        btn.blur();
      });
      add(wrap, btn, sub);
      wrap.sub = sub;
      wrap.meta = btn.querySelector('.pnl-node-meta');
      wrap.title = btn.querySelector('.pnl-node-title');
      // opens without remembering it (e.g. a new loaded asset)
      wrap.expand = function() {
        if (btn.getAttribute('aria-expanded') === 'true') return;
        btn.setAttribute('aria-expanded', 'true');
        sub.hidden = false;
      };
      return wrap;
    }

    return { node: node, el: el, add: add };
  }

  window.BimPanelsTree = { create: create, el: el, add: add };
})();
