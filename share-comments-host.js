/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/*
 * Customer comments of share links in the owner's viewer.
 *
 * When the owner loads a saved scene, this module looks up the scene's share
 * links (BimSceneShare.listLinks, api/share-list.php) and follows their
 * comments live (onSnapshot on share_comments/<token>/comments). They appear
 * like the owner's own comments: markers in 3D, entries in the comments list
 * (marked "Customer"), fly-to, edit and delete. Loading another scene, a demo
 * scene or an empty scene removes them again.
 *
 * comments.js stays untouched: its own comments live in a different
 * collection, so this module keeps the customer comments in its own map and
 * merges them into BimViewer.comments.comments. Edit and delete of a customer
 * comment go to its share collection (the Firestore rules allow both for the
 * owner, DEPLOYMENT.md); "delete all" leaves them alone.
 */
(function() {
  'use strict';

  if (window._shareMode) return;

  var shared = new Map();   // comment id -> comment (with _share = token)
  var unsubs = [];
  var gen = 0;              // bumps on every attach/detach, drops late results

  function isOwner() {
    return !!(window.BimViewer && BimViewer.isLabUser && BimViewer.isLabUser());
  }

  function db() {
    return typeof BimAuth !== 'undefined' && BimAuth.getFirebaseDb ? BimAuth.getFirebaseDb() : null;
  }

  function commentsRef(token) {
    var d = db();
    return d ? d.collection('share_comments').doc(token).collection('comments') : null;
  }

  function viewer() {
    return window.BimViewer && BimViewer.viewer;
  }

  // ------------------------------------------------------------------
  // Entities and the merged comment list
  // ------------------------------------------------------------------
  function removeEntity(id) {
    var v = viewer();
    if (v && v.entities.getById(id)) v.entities.removeById(id);
  }

  function addEntity(c) {
    var v = viewer();
    if (!v) return;
    removeEntity(c.id);
    try {
      if (c.type === 'area') BimViewer.addAreaEntity(c);
      else if (c.type === 'circle') BimViewer.addCircleEntity(c);
      else if (c.type === 'polyline') BimViewer.addPolylineEntity(c);
      else BimViewer.addCommentEntity(c);
    } catch (err) {
      console.warn('Share comments: marker not drawn', c.id, err);
      return;
    }
    var e = v.entities.getById(c.id);
    if (e && BimViewer.comments && BimViewer.comments.allVisible === false) e.show = false;
  }

  // Own comments of comments.js + the customer comments of this scene
  function sync() {
    var state = BimViewer.comments;
    if (!state) return;
    state.comments = (state.comments || []).filter(function(c) { return !c._share; })
      .concat(Array.from(shared.values()));
    if (typeof BimViewer.updateCommentsList === 'function') BimViewer.updateCommentsList();
    if (typeof BimViewer.updateCommentsCount === 'function') BimViewer.updateCommentsCount();
  }

  // ------------------------------------------------------------------
  // Follow the links of a scene
  // ------------------------------------------------------------------
  function detach() {
    gen++;
    unsubs.forEach(function(u) { try { u(); } catch (e) { /* already gone */ } });
    unsubs = [];
    if (!shared.size) return;
    shared.forEach(function(c) { removeEntity(c.id); });
    shared.clear();
    sync();
  }

  async function attach(sceneId) {
    detach();
    if (!isOwner() || !window.BimSceneShare || typeof BimSceneShare.listLinks !== 'function') return;
    var my = gen;
    var links;
    try {
      links = await BimSceneShare.listLinks(sceneId);
    } catch (err) {
      console.warn('Share comments: links of the scene not loaded', err);
      return;
    }
    if (my !== gen || !Array.isArray(links)) return;
    links.forEach(function(s) { if (s && s.token) follow(s.token, my); });
  }

  function follow(token, my) {
    var ref = commentsRef(token);
    if (!ref) return;
    var first = true;
    var unsub = ref.onSnapshot(function(snap) {
      if (my !== gen) return;
      var fresh = [];
      snap.docChanges().forEach(function(ch) {
        var id = ch.doc.id;
        if (ch.type === 'removed') {
          shared.delete(id);
          removeEntity(id);
          return;
        }
        var c = Object.assign({}, ch.doc.data(), { id: id, _share: token });
        shared.set(id, c);
        addEntity(c);
        if (!first && ch.type === 'added') fresh.push(c);
      });
      first = false;
      sync();
      if (fresh.length) {
        BimViewer.updateStatus(fresh.length === 1
          ? 'New customer comment: ' + (fresh[0].title || '(no title)')
          : fresh.length + ' new customer comments', 'success');
      }
    }, function(err) {
      console.warn('Share comments: link ' + token.slice(0, 6) + '… not readable', err);
    });
    unsubs.push(unsub);
  }

  // ------------------------------------------------------------------
  // Hooks into scenes.js and comments.js (wrapped, not changed)
  // ------------------------------------------------------------------
  function wrap(name, make) {
    var orig = BimViewer[name];
    if (typeof orig !== 'function' || orig._shareHost) return false;
    var fn = make(orig);
    fn._shareHost = true;
    BimViewer[name] = fn;
    return true;
  }

  function clip(s, n) {
    return String(s == null ? '' : s).trim().slice(0, n);
  }

  function installHooks() {
    if (!window.BimViewer) return;

    // Scene loaded: a scene of the list → its links; anything else → none
    wrap('restoreSceneObject', function(orig) {
      return async function(scene) {
        var result = await orig.apply(this, arguments);
        if (result !== null) {
          var inList = scene && this.scenes && this.scenes.list.indexOf(scene) !== -1;
          if (inList) attach(scene.id); else detach();
        }
        return result;
      };
    });

    wrap('clearCurrentScene', function(orig) {
      return function() {
        detach();
        return orig.apply(this, arguments);
      };
    });

    // comments.js replaces the list when it loads its own collection
    wrap('loadCommentsFromStorage', function(orig) {
      return async function() {
        var result = await orig.apply(this, arguments);
        if (shared.size) sync();
        return result;
      };
    });

    // Edit of a customer comment: update its share document; the snapshot
    // redraws marker and list
    wrap('saveComment', function(orig) {
      return async function(data) {
        var token = data && data._share;
        if (!token || !data.id) return orig.apply(this, arguments);
        try {
          await commentsRef(token).doc(data.id).update({
            title: clip(data.title, 300),
            text: clip(data.text, 5000),
            category: data.category || 'General',
            priority: data.priority || 'Normal',
            timestamp: data.timestamp || new Date().toISOString(),
            isUpdated: true
          });
          return true;
        } catch (err) {
          console.error('Share comments: update failed', err);
          this.updateStatus('Error saving customer comment: ' + err.message, 'error');
          return false;
        }
      };
    });

    wrap('deleteComment', function(orig) {
      return async function(id) {
        var c = shared.get(id);
        if (!c) return orig.apply(this, arguments);
        if (!confirm('Delete this customer comment? The customer will no longer see it either.')) return false;
        try {
          await commentsRef(c._share).doc(id).delete();
          this.updateStatus('Customer comment deleted', 'success');
          return true;
        } catch (err) {
          console.error('Share comments: delete failed', err);
          this.updateStatus('Error deleting customer comment: ' + err.message, 'error');
          return false;
        }
      };
    });

    // "Delete all" means the owner's own comments only
    wrap('deleteAllComments', function(orig) {
      return async function() {
        if (!shared.size) return orig.apply(this, arguments);
        var state = this.comments;
        state.comments = state.comments.filter(function(c) { return !c._share; });
        try {
          return await orig.apply(this, arguments);
        } finally {
          sync();
        }
      };
    });

    // 3D label: who wrote it
    wrap('buildLabelText', function(orig) {
      return function(comment) {
        var text = orig.apply(this, arguments);
        return comment && comment._share ? text + '\nCustomer' + (comment.author ? ': ' + comment.author : '') : text;
      };
    });

    // Comments list: mark customer comments
    wrap('updateCommentsList', function(orig) {
      return function() {
        var result = orig.apply(this, arguments);
        if (shared.size) markList();
        return result;
      };
    });
  }

  function markList() {
    var container = document.getElementById('commentsList');
    if (!container) return;
    container.querySelectorAll('.modern-comment-item').forEach(function(item) {
      var m = /flyToComment\('([^']+)'\)/.exec(item.getAttribute('onclick') || '');
      if (!m || !shared.has(m[1]) || item.classList.contains('is-customer')) return;
      item.classList.add('is-customer');
      var meta = item.querySelector('.modern-comment-meta');
      if (meta) {
        var badge = document.createElement('span');
        badge.className = 'modern-comment-customer';
        badge.textContent = 'Customer';
        meta.insertBefore(badge, meta.firstChild);
      }
    });
  }

  // Modules that define the hooked functions may load later (ui-helpers,
  // panel UI): install now and again once the page has loaded
  installHooks();
  window.addEventListener('load', installHooks);
  var tries = 0;
  (function retry() {
    installHooks();
    if (++tries < 20) setTimeout(retry, 1000);
  })();

  window.BimShareCommentsHost = {
    attach: attach,
    detach: detach,
    count: function() { return shared.size; }
  };
})();
