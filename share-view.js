/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/*
 * Share link view: /s/<token> (redirects to /?share=<token>).
 *
 * A customer opens a scene the owner shared (scenes-share.js) without an
 * account: no login, no Cesium ion (open terrain and basemaps only), the
 * scene's frozen snapshot from api/share-get.php, which also sets the cookie
 * that lets api/model-file.php serve the link's models. The customer can
 * navigate, measure, toggle, compare and comment; comments go to
 * share_comments/<token>/comments (Firestore) for the owner. Nothing else is
 * saved and nothing outside the scene can be loaded.
 *
 * Loaded early (before auth-gate.js and comments.js): the flags below must be
 * set before those modules read them.
 */
(function() {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var token = params.get('share');
  if (!token || !/^[A-Za-z0-9_-]{22}$/.test(token)) return;

  console.log('Share link view');

  // ------------------------------------------------------------------
  // Flags (read by auth-gate.js, guest-no-ion.js, comments.js, scenes.js)
  // ------------------------------------------------------------------
  window._shareMode = true;
  window._shareToken = token;
  window._shareCommentsPath = 'share_comments/' + token + '/comments';
  window._demoMode = true;      // guest UI, no Cesium ion (guest-no-ion.js)
  window._weaDemoMode = true;   // auth-gate.js: no login
  window._splashDismissed = true;
  window._authGatePassed = true;
  try { sessionStorage.setItem('geoBIM_splashShown', '1'); } catch (e) {}

  // Ask for the snapshot right away; the answer also sets the model cookie
  var shareRequest = fetch('api/share-get.php?token=' + encodeURIComponent(token), { cache: 'no-store', credentials: 'same-origin' })
    .then(function(res) {
      return res.json().catch(function() { return {}; }).then(function(body) {
        return { status: res.status, body: body };
      });
    })
    .catch(function(err) { return { status: 0, body: { error: err.message } }; });

  // Sidebar sections (data-section) a customer gets: measuring and comments.
  // Everything else is hidden (the bottom toolbar keeps only Measure, see
  // share-view-styles.css).
  var KEEP_SECTIONS = ['drawing', 'comments'];
  var AUTHOR_KEY = 'geobim.share.author';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function icons() {
    if (window.lucide) lucide.createIcons();
  }

  // ------------------------------------------------------------------
  // Hide owner and persistence UI (classes, no inline styles)
  // ------------------------------------------------------------------
  function hideUI() {
    var toolbar = document.getElementById('toolbar');
    if (!toolbar) return false;
    toolbar.querySelectorAll('.modern-section').forEach(function(section) {
      var header = section.querySelector('.modern-section-header[data-section]');
      var id = header ? header.getAttribute('data-section') : null;
      if (id && KEEP_SECTIONS.indexOf(id) === -1) section.classList.add('share-hidden');
    });
    return true;
  }

  // ------------------------------------------------------------------
  // Wrappers (installed once all modules are loaded)
  // ------------------------------------------------------------------
  function installWrappers() {
    document.body.classList.add('share-view');

    // Measuring works, saving measurements does not (public demo collection)
    if (typeof BimViewer.initMeasurementStore === 'function') {
      BimViewer.initMeasurementStore = function() {};
    }

    // Comments need no sign-in (anonymous Firebase auth is off for this
    // project, as for the demo comments): the Firestore rules check that the
    // link exists, is not revoked and not expired (share_comments/<token>)

    // Comments carry the customer's name (asked once, kept in this browser)
    var saveComment = BimViewer.saveComment;
    if (typeof saveComment === 'function') {
      BimViewer.saveComment = function(data) {
        var author = '';
        try { author = localStorage.getItem(AUTHOR_KEY) || ''; } catch (e) {}
        if (!author) {
          author = (window.prompt('Your name (shown with your comments):', '') || '').trim().slice(0, 80);
          if (author) { try { localStorage.setItem(AUTHOR_KEY, author); } catch (e) {} }
        }
        data = Object.assign({}, data, { author: author || 'Guest', authorEmail: '' });
        return saveComment.call(this, data);
      };
    }

    // No files from outside the scene (GIS, splats, point clouds)
    ['dragenter', 'dragover', 'drop'].forEach(function(type) {
      window.addEventListener(type, function(e) {
        if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') === -1) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (type === 'drop' && window.BimViewer && BimViewer.updateStatus) {
          BimViewer.updateStatus('Files cannot be added to a shared view', 'warning');
        }
      }, true);
    });

    // Shortcuts of tools a customer does not get: walk (G, V, T), transform
    // (X), hide elements (H), saved views (1-9). Typing in fields is untouched.
    window.addEventListener('keydown', function(e) {
      var tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || (e.target && e.target.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[gvtxh1-9]$/i.test(e.key)) e.stopImmediatePropagation();
    }, true);

    var tries = 0;
    (function waitHide() {
      hideUI();   // several passes for ~15 s: some UI is built late
      if (++tries < 50) setTimeout(waitHide, 300);
    })();
  }

  // ------------------------------------------------------------------
  // Banner and error card
  // ------------------------------------------------------------------
  function showBanner(info, problems) {
    var banner = document.createElement('div');
    banner.id = 'shareViewBanner';
    banner.className = 'share-banner';
    banner.setAttribute('role', 'status');
    var until = info.expiresAt ? new Date(info.expiresAt) : null;
    var meta = 'Shared view' + (until && !isNaN(until) ? ' · valid until ' + until.toLocaleDateString() : '');
    banner.innerHTML =
      '<i data-lucide="share-2" aria-hidden="true"></i>' +
      '<div class="share-banner-text">' +
        '<strong>' + esc(info.sceneName || 'Scene') + '</strong>' +
        (info.label ? '<span class="share-banner-label">' + esc(info.label) + '</span>' : '') +
        '<span class="share-banner-meta">' + esc(meta) + '</span>' +
        (problems && problems.length
          ? '<span class="share-banner-warn" title="' + esc(problems.join('\n')) + '">' +
            esc(problems.length === 1 ? '1 item could not be shown' : problems.length + ' items could not be shown') + '</span>'
          : '') +
      '</div>';
    document.body.appendChild(banner);
    icons();
  }

  function showError(status, body) {
    var reason = body && body.error;
    var title = 'This link does not exist';
    var text = 'Please check the address, or ask the sender for a new link.';
    if (status === 410 && reason === 'expired') {
      title = 'This link has expired';
      text = 'Ask the sender for a new link.';
    } else if (status === 410) {
      title = 'This link is no longer available';
      text = 'The sender has withdrawn it. Ask them for a new link.';
    } else if (status !== 404) {
      title = 'The shared view could not be loaded';
      text = 'Please try again in a moment.';
    }
    var card = document.createElement('div');
    card.id = 'shareViewError';
    card.className = 'share-error';
    card.setAttribute('role', 'alert');
    card.innerHTML =
      '<div class="share-error-card">' +
        '<i data-lucide="link-2-off" aria-hidden="true"></i>' +
        '<h1>' + esc(title) + '</h1>' +
        '<p>' + esc(text) + '</p>' +
      '</div>';
    document.body.appendChild(card);
    icons();
  }

  // ------------------------------------------------------------------
  // Restore the snapshot
  // ------------------------------------------------------------------
  function ready() {
    var lm = window.LayerManager;
    return !!(window.BimViewer && BimViewer.viewer && typeof BimViewer.restoreSceneObject === 'function' &&
      typeof BimViewer.fetchGLBModels === 'function' && lm && lm.viewer && lm.basemapLayers && lm.basemapLayers.length);
  }

  function waitReady(timeoutMs) {
    var start = Date.now();
    return new Promise(function(resolve) {
      (function poll() {
        if (ready() || Date.now() - start > timeoutMs) return resolve(ready());
        setTimeout(poll, 250);
      })();
    });
  }

  async function restore() {
    var res = await shareRequest;
    if (res.status !== 200 || !res.body || !res.body.snapshot) {
      showError(res.status, res.body);
      return;
    }
    if (!(await waitReady(30000))) {
      showError(0, null);
      return;
    }
    // The model list again, now with the link's models (cookie is set)
    BimViewer.glbModels = [];
    try { await BimViewer.fetchGLBModels(); } catch (e) {}
    var problems = await BimViewer.restoreSceneObject(res.body.snapshot) || [];
    showBanner(res.body, problems);
  }

  function start() {
    installWrappers();
    restore();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
