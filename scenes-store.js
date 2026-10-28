/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
// ===============================
// SCENES STORE v1.0 — keeps the scenes of scenes.js across reloads
//   Signed in (not anonymous): Firestore collection "scenes", one document
//     per scene, id "<uid>_<scene iD>":
//     { ownerUid, sceneId, name, createdAt, modifiedAt, payload }
//     payload = the scene as JSON text in the Desktop format (SavedScenes.json
//     entry). Firestore allows no nested arrays and the Desktop fields may
//     grow, so the scene is stored as one string, not as a map.
//   Guest / anonymous: localStorage "geobim.scenes.v1" = {"scenes": [...]}.
//   Any Firestore error (e.g. missing security rule) falls back to
//   localStorage for the rest of the session, with a hint in the section —
//   under "geobim.scenes.v1.<uid>", so a shared browser never shows one
//   account's scenes to a guest or another account.
// scenes.js stays the single place for the scene logic; this module wraps its
// save / update / rename / delete / import functions and reloads the list
// when the sign-in changes. Import / export of files stay as they are.
// ===============================
'use strict';

(function() {

  var COLLECTION = 'scenes';
  var LOCAL_KEY = 'geobim.scenes.v1';
  var MAX_PAYLOAD = 900000; // Firestore document limit is 1 MiB

  var store = BimViewer.scenesStore = {
    mode: 'none',      // 'cloud' | 'local' | 'local-fallback' | 'none'
    uid: null,
    ready: false,
    error: null
  };

  // =====================================
  // BACKEND
  // =====================================

  function authUser() {
    try {
      var auth = BimAuth.getFirebaseAuth && BimAuth.getFirebaseAuth();
      return (auth && auth.currentUser) || null;
    } catch (e) { return null; }
  }

  function db() {
    try { return BimAuth.getFirebaseDb && BimAuth.getFirebaseDb(); } catch (e) { return null; }
  }

  function docId(sceneId) { return store.uid + '_' + sceneId; }

  // Documents known to exist (loaded or saved) — only new ones get createdAt
  var known = new Set();

  function localKey() { return store.uid ? LOCAL_KEY + '.' + store.uid : LOCAL_KEY; }

  function readLocal() {
    try {
      var data = JSON.parse(localStorage.getItem(localKey()) || 'null');
      return data && Array.isArray(data.scenes) ? data.scenes : [];
    } catch (e) { return []; }
  }

  function writeLocal() {
    try {
      localStorage.setItem(localKey(), JSON.stringify({ scenes: BimViewer.scenes.list }));
      return true;
    } catch (e) {
      console.warn('Scenes: browser storage not available', e);
      return false;
    }
  }

  // keepStored: called while loading — read the browser copy, don't overwrite it
  function fallBack(err, keepStored) {
    console.warn('Scenes: Firestore unavailable, using browser storage', err);
    store.error = err && (err.code || err.message) || String(err);
    store.mode = 'local-fallback';
    if (!keepStored) writeLocal();
    hint();
  }

  async function cloudLoad() {
    var snap = await db().collection(COLLECTION).where('ownerUid', '==', store.uid).get();
    var scenes = [];
    snap.forEach(function(doc) {
      known.add(doc.id);
      try {
        var s = JSON.parse(doc.data().payload);
        if (s && typeof s === 'object') scenes.push(s);
      } catch (e) {
        console.warn('Scenes: unreadable document ' + doc.id, e);
      }
    });
    return scenes.sort(function(a, b) { return (Number(a.iD) || 0) - (Number(b.iD) || 0); });
  }

  function cloudSave(scene) {
    var payload = JSON.stringify(scene);
    if (payload.length > MAX_PAYLOAD) return Promise.reject(new Error('Scene too large for the account storage'));
    var id = docId(scene.iD);
    var now = new Date().toISOString();
    var data = {
      ownerUid: store.uid,
      sceneId: Number(scene.iD),
      name: String(scene.name || ''),
      modifiedAt: now,
      payload: payload
    };
    // merge keeps createdAt of an existing document
    if (!known.has(id)) data.createdAt = now;
    return db().collection(COLLECTION).doc(id).set(data, { merge: true })
      .then(function() { known.add(id); });
  }

  function cloudDelete(sceneId) {
    var id = docId(sceneId);
    return db().collection(COLLECTION).doc(id).delete().then(function() { known.delete(id); });
  }

  // Persists the given scene ids (missing ones are deleted)
  function persist(ids, deleted) {
    if (store.mode === 'cloud') {
      var jobs = (ids || []).map(function(id) {
        var s = BimViewer.getScene(id);
        return s ? cloudSave(s) : null;
      }).filter(Boolean);
      (deleted || []).forEach(function(id) { jobs.push(cloudDelete(id)); });
      Promise.all(jobs).catch(fallBack);
    } else if (store.mode !== 'none') {
      if (!writeLocal()) BimViewer.updateStatus('Scenes could not be stored in this browser', 'warning');
    }
  }

  // =====================================
  // LOAD LIST (page open and sign-in change)
  // =====================================

  // Scenes created before the stored list arrived are kept (new ids if taken)
  function mergeInto(stored) {
    var pending = BimViewer.scenes.list.filter(function(s) { return !s._fromStore; });
    stored.forEach(function(s) { Object.defineProperty(s, '_fromStore', { value: true, enumerable: false, writable: true }); });
    var list = stored.slice();
    var maxId = list.reduce(function(m, s) { return Math.max(m, Number(s.iD) || 0); }, 0);
    var added = [];
    pending.forEach(function(s) {
      if (list.some(function(x) { return x.iD === s.iD; })) s.iD = ++maxId;
      else maxId = Math.max(maxId, Number(s.iD) || 0);
      list.push(s);
      added.push(s.iD);
    });
    BimViewer.scenes.list = list;
    if (!list.some(function(s) { return s.iD === BimViewer.scenes.activeId; })) BimViewer.scenes.activeId = 0;
    return added;
  }

  async function reload() {
    var user = authUser();
    var signedIn = !!(user && !user.isAnonymous && db());
    var uid = signedIn ? user.uid : null;
    var mode = signedIn ? 'cloud' : 'local';
    if (store.ready && store.uid === uid && (store.mode === mode || store.mode === 'local-fallback')) return;

    // Switching accounts: the old user's list is not shown to the new one
    if (store.ready && store.uid !== uid) {
      BimViewer.scenes.list = [];
      BimViewer.scenes.activeId = 0;
    }
    store.uid = uid;
    store.mode = mode;
    store.error = null;
    known.clear();

    var stored = [];
    if (mode === 'cloud') {
      try {
        stored = await cloudLoad();
      } catch (err) {
        fallBack(err, true);
        stored = readLocal();
      }
    } else {
      stored = readLocal();
    }
    var added = mergeInto(stored);
    store.ready = true;
    if (added.length) persist(added);
    if (window.GEOBIM_SCENES_UI) GEOBIM_SCENES_UI.render();
    hint();
  }

  // =====================================
  // WRAP scenes.js
  // =====================================

  function wrap(name, after) {
    var orig = BimViewer[name];
    if (typeof orig !== 'function') return;
    BimViewer[name] = function() {
      var before = BimViewer.scenes.list.map(function(s) { return s.iD; });
      var result = orig.apply(this, arguments);
      try { after.call(this, result, Array.prototype.slice.call(arguments), before); }
      catch (e) { console.warn('Scenes store: ' + name, e); }
      return result;
    };
  }

  wrap('saveNewScene', function(id) { if (id) persist([id]); });
  wrap('updateScene', function(ok, args) { if (ok) persist([args[0]]); });
  wrap('renameScene', function(r, args) { persist([args[0]]); });
  wrap('deleteScene', function(r, args, before) {
    if (before.indexOf(args[0]) >= 0 && !BimViewer.getScene(args[0])) persist([], [args[0]]);
  });
  wrap('importScenes', function(r, args, before) {
    var added = BimViewer.scenes.list.map(function(s) { return s.iD; })
      .filter(function(id) { return before.indexOf(id) < 0; });
    if (added.length) persist(added);
  });

  // =====================================
  // UI HINT (sidebar section text)
  // =====================================

  function hint() {
    var el = document.getElementById('scenesStorageHint');
    if (!el) return;
    var text = {
      cloud: 'Scenes are saved to your account.',
      local: 'Scenes are saved in this browser. Sign in to keep them in your account.',
      'local-fallback': 'Account storage is not available right now — scenes are saved in this browser.',
      none: 'Scenes are kept until you reload the page — export them to keep them.'
    }[store.mode];
    el.textContent = text || '';
  }
  BimViewer.updateScenesStorageHint = hint;
  store.reload = function() { return reload().catch(fallBack); };

  // =====================================
  // INIT
  // =====================================

  function init() {
    var tries = 0;
    (function wait() {
      var auth = window.BimAuth && BimAuth.getFirebaseAuth && BimAuth.getFirebaseAuth();
      if (!auth) {
        if (++tries < 40) setTimeout(wait, 250);
        else { store.mode = 'local'; reload(); }
        return;
      }
      // Fires once with the current user, then on every sign-in / sign-out
      auth.onAuthStateChanged(function() { reload().catch(fallBack); });
    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  console.log('✅ Scenes store loaded v1.0');

})();
