/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/*
 * Share a saved scene with a link (owner only).
 *
 * Adds a share button to each scene in the Scenes list (ui-scenes-section.js,
 * also used by the panel UI). The dialog creates links (api/share-create.php:
 * the server freezes and cleans the scene), lists this site's links for the
 * scene with their state, copies / opens / revokes them and shows the
 * customers' comments.
 *
 * Comments (share-view.js) live in Firestore under
 * share_comments/<token>/comments. Their rules need the link's state, so this
 * module mirrors it to share_comments/<token> {sceneName, revoked, expiresAt,
 * createdAt} when a link is created or revoked.
 */
(function() {
  'use strict';

  if (window._shareMode) return;

  var dialog = null;
  var current = null;   // scene being shared

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function isOwner() {
    return !!(window.BimViewer && BimViewer.isLabUser && BimViewer.isLabUser());
  }

  function icons(node) {
    if (window.lucide) lucide.createIcons(node ? { nameAttr: 'data-lucide', node: node } : undefined);
  }

  function shareUrl(token) {
    return location.origin + '/s/' + token;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString();
  }

  // ------------------------------------------------------------------
  // API (owner: Firebase ID token, like placement-save.js)
  // ------------------------------------------------------------------
  async function idToken() {
    var auth = window.BimAuth;
    var user = auth && (auth.authenticatedUser || (typeof auth.getFirebaseUser === 'function' && auth.getFirebaseUser()));
    if (!user || typeof user.getIdToken !== 'function') throw new Error('Not signed in');
    return user.getIdToken();
  }

  async function api(path, body) {
    var opts = { headers: { 'Authorization': 'Bearer ' + (await idToken()) }, cache: 'no-store' };
    if (body) {
      opts.method = 'POST';
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    var res = await fetch(path, opts);
    var data = await res.json().catch(function() { return {}; });
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  // ------------------------------------------------------------------
  // Firestore: link state for the comment rules, and the comments
  // ------------------------------------------------------------------
  function db() {
    return typeof BimAuth !== 'undefined' && BimAuth.getFirebaseDb ? BimAuth.getFirebaseDb() : null;
  }

  async function mirrorState(share) {
    var d = db();
    if (!d) throw new Error('Firestore not available');
    var ts = window.firebase && firebase.firestore && firebase.firestore.Timestamp;
    await d.collection('share_comments').doc(share.token).set({
      sceneName: share.sceneName || '',
      revoked: share.state === 'revoked',
      expiresAt: share.expiresAt && ts ? ts.fromDate(new Date(share.expiresAt)) : null,
      createdAt: share.createdAt || new Date().toISOString()
    });
  }

  function commentsRef(token) {
    var d = db();
    return d ? d.collection('share_comments').doc(token).collection('comments') : null;
  }

  // ------------------------------------------------------------------
  // Scene list: a share button per scene
  // ------------------------------------------------------------------
  function decorate(list) {
    if (!isOwner()) return;
    var added = false;
    list.querySelectorAll('.scenes-item .modern-view-controls').forEach(function(controls) {
      if (controls.querySelector('[data-action="share"]')) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'modern-icon-btn';
      btn.setAttribute('data-action', 'share');
      btn.title = 'Share with a link';
      btn.setAttribute('aria-label', 'Share with a link');
      btn.innerHTML = '<i data-lucide="share-2"></i>';
      var del = controls.querySelector('[data-action="delete"]');
      controls.insertBefore(btn, del);
      added = true;
    });
    if (added) icons(list);
  }

  function hookList() {
    var list = document.getElementById('scenesList');
    if (!list) return false;
    if (list._shareHooked) return true;
    list._shareHooked = true;
    new MutationObserver(function() { decorate(list); }).observe(list, { childList: true, subtree: true });
    list.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-action="share"]');
      var item = btn && btn.closest('.scenes-item');
      if (!item) return;
      var scene = BimViewer.getScene(Number(item.getAttribute('data-id')));
      if (scene) open(scene);
    });
    decorate(list);
    return true;
  }

  // ------------------------------------------------------------------
  // Dialog
  // ------------------------------------------------------------------
  function build() {
    dialog = document.createElement('dialog');
    dialog.className = 'scene-share-dialog';
    dialog.setAttribute('aria-labelledby', 'sceneShareTitle');
    dialog.innerHTML =
      '<div class="scene-share-head">' +
        '<h2 id="sceneShareTitle"><i data-lucide="share-2"></i><span></span></h2>' +
        '<button type="button" class="modern-icon-btn" data-share-close aria-label="Close"><i data-lucide="x"></i></button>' +
      '</div>' +
      '<p class="scene-share-hint">The link shows the scene as it is now: camera, models, visibility, terrain and sun. ' +
        'Later changes to the scene do not change existing links. Only models hosted on this server can be shared; ' +
        'the customer needs no account and can measure and comment.</p>' +
      '<form class="scene-share-form" data-share-form>' +
        '<label class="scene-share-field"><span>Label (for you)</span>' +
          '<input type="text" class="modern-input" name="label" maxlength="120" placeholder="e.g. Client X, design review"></label>' +
        '<label class="scene-share-field"><span>Valid until (optional)</span>' +
          '<input type="date" class="modern-input" name="until"></label>' +
        '<button type="submit" class="modern-btn modern-btn-primary"><i data-lucide="link"></i><span>Create link</span></button>' +
      '</form>' +
      '<div class="scene-share-result" data-share-result hidden></div>' +
      '<h3 class="scene-share-subhead">Links on ' + esc(location.host) + '</h3>' +
      '<div class="scene-share-list" data-share-list></div>';
    document.body.appendChild(dialog);

    dialog.querySelector('[data-share-close]').addEventListener('click', function() { dialog.close(); });
    dialog.addEventListener('click', function(e) { if (e.target === dialog) dialog.close(); });
    dialog.querySelector('[data-share-form]').addEventListener('submit', onCreate);
    dialog.querySelector('[data-share-list]').addEventListener('click', onListAction);
    dialog.querySelector('[data-share-result]').addEventListener('click', onListAction);
    var until = dialog.querySelector('input[name="until"]');
    var tomorrow = new Date(Date.now() + 86400000);
    until.min = tomorrow.toISOString().slice(0, 10);
  }

  function open(scene) {
    if (!isOwner()) return;
    if (!dialog) build();
    current = scene;
    dialog.querySelector('#sceneShareTitle span').textContent = 'Share "' + scene.name + '"';
    dialog.querySelector('[data-share-form]').reset();
    var result = dialog.querySelector('[data-share-result]');
    result.hidden = true;
    result.innerHTML = '';
    icons(dialog);
    if (!dialog.open) dialog.showModal();
    loadList();
  }

  function linkRow(s) {
    var badge = { active: 'Active', expired: 'Expired', revoked: 'Revoked' }[s.state] || s.state;
    var meta = ['Created ' + fmtDate(s.createdAt)];
    if (s.expiresAt) meta.push((s.state === 'expired' ? 'expired ' : 'until ') + fmtDate(s.expiresAt));
    if (s.revokedAt) meta.push('revoked ' + fmtDate(s.revokedAt));
    meta.push(s.models.length + (s.models.length === 1 ? ' model' : ' models'));
    var active = s.state === 'active';
    return '<div class="scene-share-item" data-token="' + esc(s.token) + '">' +
      '<div class="scene-share-item-head">' +
        '<span class="scene-share-badge is-' + esc(s.state) + '">' + esc(badge) + '</span>' +
        '<span class="scene-share-item-label">' + esc(s.label || 'Link') + '</span>' +
      '</div>' +
      '<div class="scene-share-item-meta">' + esc(meta.join(' · ')) + '</div>' +
      '<div class="scene-share-item-actions">' +
        (active
          ? '<button type="button" class="modern-icon-btn" data-share-act="copy" title="Copy link" aria-label="Copy link"><i data-lucide="copy"></i></button>' +
            '<button type="button" class="modern-icon-btn" data-share-act="open" title="Open link (use a private window to see it as a customer)" aria-label="Open link"><i data-lucide="external-link"></i></button>'
          : '') +
        '<button type="button" class="modern-icon-btn scene-share-comments-btn" data-share-act="comments" title="Customer comments" aria-label="Customer comments"><i data-lucide="message-square"></i><span data-count></span></button>' +
        (s.state !== 'revoked'
          ? '<button type="button" class="modern-icon-btn" data-share-act="mirror" title="Enable comments again (sync link state)" aria-label="Sync link state" hidden><i data-lucide="refresh-cw"></i></button>' +
            '<button type="button" class="modern-icon-btn modern-icon-btn-danger" data-share-act="revoke" title="Revoke link" aria-label="Revoke link"><i data-lucide="link-2-off"></i></button>'
          : '') +
      '</div>' +
      '<div class="scene-share-comments" data-comments hidden></div>' +
    '</div>';
  }

  var lastList = [];

  async function loadList() {
    var box = dialog.querySelector('[data-share-list]');
    box.innerHTML = '<div class="modern-empty-state">Loading…</div>';
    try {
      lastList = await api('api/share-list.php?sceneId=' + encodeURIComponent(current.id));
      box.innerHTML = lastList.length
        ? lastList.map(linkRow).join('')
        : '<div class="modern-empty-state">No links for this scene yet</div>';
      icons(box);
      lastList.forEach(function(s) { countComments(s.token); });
    } catch (err) {
      box.innerHTML = '<div class="scene-share-error">Links could not be loaded: ' + esc(err.message) + '</div>';
    }
  }

  // Comment count, and a retry button when the link state for the comment
  // rules is missing (mirroring failed when the link was created)
  async function countComments(token) {
    var ref = commentsRef(token);
    var item = dialog.querySelector('[data-share-list] .scene-share-item[data-token="' + token + '"]');
    if (!ref || !item) return;
    try {
      var state = await ref.parent.get();
      var retry = item.querySelector('[data-share-act="mirror"]');
      if (retry) retry.hidden = state.exists;
      var snap = await ref.get();
      var el = item.querySelector('[data-count]');
      if (el) el.textContent = snap.size ? String(snap.size) : '';
    } catch (e) { /* Firestore rules not set up yet */ }
  }

  async function onCreate(e) {
    e.preventDefault();
    var form = e.currentTarget;
    var btn = form.querySelector('button[type="submit"]');
    var result = dialog.querySelector('[data-share-result]');
    var until = form.until.value;
    var expiresAt = null;
    if (until) {
      var p = until.split('-').map(Number);
      expiresAt = new Date(p[0], p[1] - 1, p[2], 23, 59, 59).toISOString();   // end of that day, local time
    }
    btn.disabled = true;
    try {
      // The scene as saved (not the current view): what the list shows
      var data = await api('api/share-create.php', {
        sceneId: current.id, scene: current, label: form.label.value.trim(), expiresAt: expiresAt
      });
      var mirrorFailed = false;
      try { await mirrorState(data.share); } catch (err) { mirrorFailed = true; console.warn('Share: link state for comments not saved', err); }
      var url = shareUrl(data.token);
      result.hidden = false;
      result.innerHTML =
        '<div class="scene-share-item" data-token="' + esc(data.token) + '">' +
          '<label class="scene-share-field"><span>New link</span>' +
            '<input type="text" class="modern-input scene-share-url" readonly value="' + esc(url) + '"></label>' +
          '<div class="scene-share-item-actions">' +
            '<button type="button" class="modern-btn modern-btn-primary" data-share-act="copy"><i data-lucide="copy"></i><span>Copy link</span></button>' +
            (mirrorFailed ? '<button type="button" class="modern-btn" data-share-act="mirror"><i data-lucide="refresh-cw"></i><span>Enable comments (retry)</span></button>' : '') +
          '</div>' +
          (data.warnings && data.warnings.length
            ? '<ul class="scene-share-warnings">' + data.warnings.map(function(w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>'
            : '') +
        '</div>';
      icons(result);
      lastList.unshift(data.share);
      form.reset();
      loadList();
      BimViewer.updateStatus('Share link created', 'success');
    } catch (err) {
      result.hidden = false;
      result.innerHTML = '<div class="scene-share-error">' + esc(err.message) + '</div>';
    } finally {
      btn.disabled = false;
    }
  }

  async function copy(token, btn) {
    var url = shareUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      BimViewer.updateStatus('Link copied', 'success');
    } catch (e) {
      var input = btn.closest('.scene-share-item').querySelector('.scene-share-url');
      if (input) { input.select(); }
      BimViewer.updateStatus('Copy the link: ' + url, 'warning');
    }
  }

  async function showComments(item, token) {
    var box = item.querySelector('[data-comments]');
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = 'Loading…';
    var ref = commentsRef(token);
    if (!ref) { box.textContent = 'Firestore not available'; return; }
    try {
      var snap = await ref.orderBy('timestamp', 'desc').get();
      if (snap.empty) { box.innerHTML = '<div class="modern-empty-state">No comments yet</div>'; return; }
      var html = '';
      snap.forEach(function(doc) {
        var c = doc.data();
        html += '<div class="scene-share-comment" data-comment="' + esc(doc.id) + '">' +
          '<div class="scene-share-comment-head"><strong>' + esc(c.title || '(no title)') + '</strong>' +
            '<button type="button" class="modern-icon-btn modern-icon-btn-danger" data-share-act="delete-comment" title="Delete comment" aria-label="Delete comment"><i data-lucide="trash-2"></i></button></div>' +
          (c.text ? '<div class="scene-share-comment-text">' + esc(c.text) + '</div>' : '') +
          '<div class="scene-share-item-meta">' + esc([c.author, fmtDate(c.timestamp)].filter(Boolean).join(' · ')) + '</div>' +
        '</div>';
      });
      box.innerHTML = html;
      icons(box);
    } catch (err) {
      box.innerHTML = '<div class="scene-share-error">Comments could not be loaded: ' + esc(err.message) + '</div>';
    }
  }

  async function onListAction(e) {
    var btn = e.target.closest('[data-share-act]');
    var item = btn && btn.closest('.scene-share-item');
    if (!item) return;
    var token = item.getAttribute('data-token');
    var share = lastList.find(function(s) { return s.token === token; });
    switch (btn.getAttribute('data-share-act')) {
      case 'copy':
        copy(token, btn);
        break;
      case 'open':
        window.open(shareUrl(token), '_blank', 'noopener');
        break;
      case 'comments':
        showComments(item, token);
        break;
      case 'mirror':
        if (!share) return;
        try {
          await mirrorState(share);
          btn.hidden = true;
          BimViewer.updateStatus('Comments enabled for this link', 'success');
        } catch (err) {
          BimViewer.updateStatus('Could not enable comments: ' + err.message, 'error');
        }
        break;
      case 'revoke':
        if (!confirm('Revoke this link? The customer can no longer open it; this cannot be undone.')) return;
        try {
          var r = await api('api/share-revoke.php', { token: token });
          if (share) {
            share.state = 'revoked';
            share.revokedAt = r.revokedAt;
            try { await mirrorState(share); } catch (err) { console.warn('Share: revoked state not mirrored', err); }
          }
          BimViewer.updateStatus('Link revoked', 'success');
          loadList();
        } catch (err) {
          BimViewer.updateStatus('Revoke failed: ' + err.message, 'error');
        }
        break;
      case 'delete-comment':
        var row = btn.closest('[data-comment]');
        if (!row || !confirm('Delete this comment?')) return;
        try {
          await commentsRef(token).doc(row.getAttribute('data-comment')).delete();
          row.remove();
          countComments(token);
        } catch (err) {
          BimViewer.updateStatus('Delete failed: ' + err.message, 'error');
        }
        break;
    }
  }

  var tries = 0;
  (function wait() {
    if (hookList() || ++tries > 120) return;
    setTimeout(wait, 500);
  })();

  window.BimSceneShare = {
    open: open,
    // Links of a scene on this site (share-comments-host.js); owner only
    listLinks: function(sceneId) {
      if (!isOwner()) return Promise.resolve([]);
      return api('api/share-list.php?sceneId=' + encodeURIComponent(sceneId));
    }
  };
})();
