/**
 * geoBIM.app
 * © 2026 Christof Lorenz. All rights reserved.
 *
 * Licensed under the Business Source License 1.1 (BSL 1.1)
 * Non-commercial use, evaluation, research, and education permitted.
 * Commercial use requires written permission.
 * Contact: info@geobim.app
 *
 * Change Date: 2030-03-01 — converts to MIT License
 */

// ===============================
// ITWIN MODELS (Preview)
// "Your iModels" under the iTwin demo in the Assets section: sign in with a
// Bentley account (itwin-auth.js), enter an iModel ID, load it as a normal
// asset via BimViewer.loadITwinModel() with the access token.
//
// CesiumJS only loads a *completed* mesh export (ITwinData returns nothing
// otherwise), so a new iModel gets one started here (Mesh Export API,
// exportType 3DTILES like CesiumJS reads) and polled until it is complete.
// ===============================
'use strict';

(function() {

  var auth = window.GEOBIM_ITWIN_AUTH;
  var API = 'https://api.bentley.com/mesh-export/';
  var ACCEPT = 'application/vnd.bentley.itwin-platform.v1+json';
  var DEFAULT_IMODEL = 'aab829fe-327e-42e7-8212-a7575bdf51a0';
  var LAST_KEY = 'geobim_itwin_last_imodel';
  var GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var POLL_MS = 10000;
  var EXPORT_TIMEOUT_MS = 30 * 60 * 1000;

  var loading = false;
  var signedInBefore = false;

  function byId(id) { return document.getElementById(id); }

  function recallLast() {
    try { return localStorage.getItem(LAST_KEY) || DEFAULT_IMODEL; } catch (e) { return DEFAULT_IMODEL; }
  }
  function storeLast(id) {
    try { localStorage.setItem(LAST_KEY, id); } catch (e) {}
  }

  function showStatus(text, isError) {
    var el = byId('itwinModelStatus');
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
    el.classList.toggle('is-error', !!isError);
  }

  // Errors carry .kind: 'auth' (401), 'forbidden', 'notfound' or none
  function apiError(kind, message) {
    var err = new Error(message);
    err.kind = kind;
    return err;
  }

  // CesiumJS ITwinPlatform throws RuntimeErrors with these texts
  function classify(err) {
    if (err && err.kind) return err;
    var msg = (err && err.message) || String(err);
    if (/^Unauthorized/i.test(msg)) return apiError('auth', msg);
    if (/forbidden/i.test(msg)) return apiError('forbidden', msg);
    if (/failure 404|not found/i.test(msg)) return apiError('notfound', msg);
    return err instanceof Error ? err : new Error(msg);
  }

  async function listExports(iModelId) {
    if (!auth.apply()) throw apiError('auth', 'No valid Bentley session');
    try {
      var result = await Cesium.ITwinPlatform.getExports(iModelId);
      return (result && result.exports) || [];
    } catch (err) {
      throw classify(err);
    }
  }

  async function startExport(iModelId) {
    var token = auth.getToken();
    if (!token) throw apiError('auth', 'No valid Bentley session');
    var send = function(body) {
      return fetch(API, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, Accept: ACCEPT, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    };
    var body = { iModelId: iModelId, exportType: '3DTILES' };
    var res = await send(body);
    // the API documents changesetId as required, "omitted = latest"
    if (res.status === 422) res = await send(Object.assign({ changesetId: '' }, body));
    if (res.status === 401) throw apiError('auth', 'Unauthorized');
    if (res.status === 403) throw apiError('forbidden', 'Forbidden');
    if (res.status === 404) throw apiError('notfound', 'Not found');
    if (!res.ok) throw new Error('Mesh export could not be started (' + res.status + ')');
    var data = await res.json().catch(function() { return {}; });
    return data.export || null;
  }

  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  // Resolves to the completed export (its displayName names the asset)
  async function ensureExport(iModelId) {
    showStatus('Checking mesh export…');
    var exports = await listExports(iModelId);
    var done = exports.find(function(e) { return e.status === 'Complete'; });
    if (done) return done;
    var running = exports.some(function(e) { return e.status === 'NotStarted' || e.status === 'InProgress'; });
    if (!running) await startExport(iModelId);

    var started = Date.now();
    while (Date.now() - started < EXPORT_TIMEOUT_MS) {
      var min = Math.floor((Date.now() - started) / 60000);
      showStatus('Mesh export running' + (min ? ' (' + min + ' min)' : '') + '… the first export of an iModel can take several minutes.');
      await sleep(POLL_MS);
      exports = await listExports(iModelId);
      done = exports.find(function(e) { return e.status === 'Complete'; });
      if (done) return done;
      if (exports.length && exports.every(function(e) { return e.status === 'Invalid'; })) {
        throw new Error('Mesh export failed for this iModel');
      }
    }
    throw new Error('Mesh export is still running — try loading again later');
  }

  async function loadModel() {
    var input = byId('itwinModelIdInput');
    var id = (input && input.value || '').trim();
    if (!GUID.test(id)) {
      showStatus('Enter an iModel ID (a GUID like ' + DEFAULT_IMODEL + ').', true);
      return;
    }
    if (BimViewer.loadedAssets.has('itwin_' + id)) {
      showStatus('This iModel is already loaded.');
      return;
    }
    if (!auth.getToken()) { render(); return; }

    loading = true;
    render();
    try {
      var exp = await ensureExport(id);
      showStatus('Loading iModel…');
      var name = (exp && exp.displayName ? exp.displayName : 'iModel ' + id.slice(0, 8)) + ' (iTwin)';
      var ad = await BimViewer.loadITwinModel(null, id, name, { accessToken: auth.getToken(), throwErrors: true });
      if (!ad) throw new Error('The iModel could not be loaded');
      storeLast(id);
      showStatus('');
    } catch (raw) {
      var err = classify(raw);
      if (err.kind === 'auth') {
        auth.logout(false);
        showStatus('Bentley session expired — please sign in again.', true);
      } else if (err.kind === 'forbidden') {
        showStatus('No access to this iModel with your Bentley account.', true);
      } else if (err.kind === 'notfound') {
        showStatus('iModel not found — check the ID.', true);
      } else {
        showStatus(err.message, true);
      }
    } finally {
      loading = false;
      render();
    }
  }

  function render() {
    var block = byId('itwinAccount');
    if (!block) return;
    var token = auth.getToken();
    var signIn = byId('itwinSignInBtn');
    var signed = byId('itwinAccountSigned');
    var hint = byId('itwinAccountHint');
    var available = auth.isAvailable();

    if (!token && signedInBefore && !loading) {
      showStatus('Bentley session expired — please sign in again.', true);
    }
    signedInBefore = !!token;

    signIn.hidden = !!token;
    signIn.disabled = !available;
    signed.hidden = !token;
    hint.textContent = token ? ''
      : available ? 'Sign in with your Bentley account to load your own iModels.'
      : 'Bentley sign-in works on geobim.app, beta.geobim.app and viewer.geobim.app.';
    hint.hidden = !hint.textContent;

    if (token) {
      var min = Math.max(1, Math.round((auth.expiresAt() - Date.now()) / 60000));
      byId('itwinAccountState').textContent = 'Signed in to Bentley · ' + min + ' min left';
    }
    var loadBtn = byId('itwinModelLoadBtn');
    if (loadBtn) loadBtn.disabled = loading;
    var idInput = byId('itwinModelIdInput');
    if (idInput) idInput.disabled = loading;
  }

  function inject() {
    if (byId('itwinAccount')) return true;
    var demo = byId('itwinDemo');
    if (!demo) return false;

    demo.insertAdjacentHTML('beforeend',
      '<div class="itwin-account" id="itwinAccount">' +
        '<div class="modern-label itwin-account-title">Your iModels (Preview)</div>' +
        '<div class="modern-hint" id="itwinAccountHint" hidden></div>' +
        '<button type="button" class="modern-btn modern-btn-primary itwin-signin-btn" id="itwinSignInBtn">' +
          '<i data-lucide="log-in"></i><span>Sign in with Bentley</span></button>' +
        '<div class="itwin-account-signed" id="itwinAccountSigned" hidden>' +
          '<div class="itwin-account-state">' +
            '<span id="itwinAccountState"></span>' +
            '<button type="button" class="itwin-signout-btn" id="itwinSignOutBtn">Sign out</button>' +
          '</div>' +
          '<div class="itwin-load-row">' +
            '<input type="text" id="itwinModelIdInput" class="zoffset-input-box" placeholder="iModel ID" ' +
              'aria-label="iModel ID" spellcheck="false" autocomplete="off">' +
            '<button type="button" class="modern-btn modern-btn-primary itwin-load-btn" id="itwinModelLoadBtn" ' +
              'title="Load iModel" aria-label="Load iModel"><i data-lucide="plus"></i></button>' +
          '</div>' +
        '</div>' +
        '<div class="modern-hint itwin-model-status" id="itwinModelStatus" role="status" hidden></div>' +
      '</div>');

    byId('itwinModelIdInput').value = recallLast();
    byId('itwinSignInBtn').addEventListener('click', function() {
      auth.login(window.location.href).catch(function(err) { showStatus(err.message, true); });
    });
    byId('itwinSignOutBtn').addEventListener('click', function() {
      signedInBefore = false;
      auth.logout(false);
      showStatus('');
      render();
    });
    byId('itwinModelLoadBtn').addEventListener('click', loadModel);
    byId('itwinModelIdInput').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') loadModel();
    });
    if (window.lucide) lucide.createIcons();
    render();
    setInterval(render, 30000);
    return true;
  }

  function start() {
    if (!auth) return;
    if (inject()) return;
    var tries = 0;
    var timer = setInterval(function() {
      if (inject() || ++tries > 120) clearInterval(timer);
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  console.log('iTwin models module loaded');
})();
