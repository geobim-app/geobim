/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// ===============================
// RHINO PLUGIN TOKENS (owner only)
// Block "Rhino plugin" in the sidebar header (classic) / Account panel
// (panel UI — the header moves there): create a token for the geoBIM.app
// Rhino plugin (geobim-rhino), shown once to copy, list with "last used",
// revoke. Server: api/plugin-tokens.php (owner session cookie); tokens can
// only upload models and poll their conversion (api/_plugin_tokens.php).
// ===============================
'use strict';

(function() {

  var root = null;

  function byId(id) { return document.getElementById(id); }
  function icons() { if (window.lucide) lucide.createIcons(); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function when(iso) {
    if (!iso) return 'never used';
    var d = new Date(iso);
    return isNaN(d) ? '' : 'used ' + d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  async function api(method, body) {
    var resp = await fetch('api/plugin-tokens.php', {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    });
    var data = await resp.json().catch(function() { return {}; });
    if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
    return data;
  }

  function setStatus(msg, kind) {
    var s = byId('pluginTokenStatus');
    if (!s) return;
    s.textContent = msg || '';
    s.className = 'plugin-tokens-status' + (kind ? ' plugin-tokens-status-' + kind : '');
  }

  async function refresh() {
    var list = byId('pluginTokenList');
    if (!list) return;
    try {
      var data = await api('GET');
      var tokens = data.tokens || [];
      list.innerHTML = tokens.length ? tokens.map(function(t) {
        return '<li class="plugin-tokens-item">' +
          '<span class="plugin-tokens-name">' + esc(t.label) + '</span>' +
          '<span class="plugin-tokens-meta">' + esc(t.prefix) + '… · ' + esc(when(t.lastUsed)) + '</span>' +
          '<button type="button" class="modern-icon-btn modern-icon-btn-danger plugin-tokens-revoke" data-token-id="' + esc(t.id) +
            '" title="Revoke ' + esc(t.label) + '" aria-label="Revoke ' + esc(t.label) + '"><i data-lucide="trash-2"></i></button>' +
          '</li>';
      }).join('') : '<li class="plugin-tokens-empty">No tokens yet.</li>';
      icons();
    } catch (err) {
      setStatus(err.message, 'error');
    }
  }

  async function create() {
    var input = byId('pluginTokenLabel');
    try {
      var data = await api('POST', { label: input ? input.value : '' });
      byId('pluginTokenValue').textContent = data.token;
      byId('pluginTokenShow').classList.remove('hidden');
      if (input) input.value = '';
      setStatus('Copy the token now — it is not shown again.', 'ok');
      refresh();
    } catch (err) {
      setStatus(err.message, 'error');
    }
  }

  async function revoke(id, label) {
    if (!confirm('Revoke the token "' + label + '"? The plugin using it can no longer upload.')) return;
    try {
      await api('POST', { action: 'revoke', id: id });
      setStatus('Token revoked', 'ok');
      refresh();
    } catch (err) {
      setStatus(err.message, 'error');
    }
  }

  function copy() {
    var v = byId('pluginTokenValue').textContent;
    var done = function() { setStatus('Token copied — paste it into GeoBIMSettings in Rhino.', 'ok'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(done, function() { setStatus('Select the token and copy it', 'error'); });
  }

  function build() {
    root = document.createElement('div');
    root.className = 'plugin-tokens';
    root.id = 'pluginTokens';
    root.innerHTML =
      '<button type="button" class="plugin-tokens-toggle" aria-expanded="false" aria-controls="pluginTokensBody" title="Tokens for the geoBIM.app Rhino plugin">' +
        '<i data-lucide="plug"></i><span>Rhino plugin</span><i data-lucide="chevron-down" class="plugin-tokens-chevron"></i></button>' +
      '<div class="plugin-tokens-body hidden" id="pluginTokensBody">' +
        '<p class="plugin-tokens-hint">The Rhino plugin uploads models with a token. A token can only upload and convert models — it cannot delete, move or share them.</p>' +
        '<div class="plugin-tokens-new">' +
          '<label class="plugin-tokens-sr" for="pluginTokenLabel">Token label</label>' +
          '<input id="pluginTokenLabel" class="modern-input" type="text" maxlength="60" placeholder="Label, e.g. Office PC">' +
          '<button type="button" class="modern-btn modern-btn-primary plugin-tokens-create" title="Create a new token"><i data-lucide="key-round"></i><span>Create</span></button>' +
        '</div>' +
        '<div id="pluginTokenShow" class="plugin-tokens-show hidden">' +
          '<code id="pluginTokenValue" class="plugin-tokens-value"></code>' +
          '<button type="button" class="modern-icon-btn plugin-tokens-copy" title="Copy token" aria-label="Copy token"><i data-lucide="copy"></i></button>' +
        '</div>' +
        '<div id="pluginTokenStatus" class="plugin-tokens-status" role="status" aria-live="polite"></div>' +
        '<ul id="pluginTokenList" class="plugin-tokens-list"></ul>' +
      '</div>';
    root.addEventListener('click', function(e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.classList.contains('plugin-tokens-toggle')) {
        var body = byId('pluginTokensBody'), open = body.classList.toggle('hidden') === false;
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
        root.classList.toggle('open', open);
        if (open) refresh();
      } else if (b.classList.contains('plugin-tokens-create')) create();
      else if (b.classList.contains('plugin-tokens-copy')) copy();
      else if (b.classList.contains('plugin-tokens-revoke')) {
        var item = b.closest('.plugin-tokens-item');
        revoke(b.dataset.tokenId, item ? item.querySelector('.plugin-tokens-name').textContent : '');
      }
    });
    root.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && e.target.id === 'pluginTokenLabel') { e.preventDefault(); create(); }
    });
    return root;
  }

  // Under the account badge (and the docked Cesium ion indicator)
  function place() {
    var badge = byId('userBadge');
    if (!badge) return false;
    if (!root) build();
    var ion = byId('ionAuthIndicator');
    var anchor = ion && ion.classList.contains('in-sidebar') && ion.parentNode === badge.parentNode ? ion : badge;
    if (root.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', root);
    icons();
    return true;
  }

  async function init() {
    var tries = 0;
    while (!(window.BimViewer && BimViewer.ownerSessionReady) && tries++ < 240) {
      await new Promise(function(r) { setTimeout(r, 250); });
    }
    if (!window.BimViewer || !BimViewer.ownerSessionReady) return;
    if (!(await BimViewer.ownerSessionReady)) return;
    // ui.js builds the header after DOMContentLoaded; the ion indicator docks later
    for (var i = 0; i < 40; i++) {
      place();
      await new Promise(function(r) { setTimeout(r, 500); });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
