/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// ===============================
// OWNER SESSION v1.1
// model/ (uploaded IFC tilesets, GLBs, raw IFCs) is owner-only on the server:
// api/model-file.php checks an HttpOnly session cookie. Cesium fetches tiles
// with plain GETs, so after Firebase sign-in the ID token is traded for that
// cookie (api/owner-session.php). The server decides who gets one: the owner,
// and members with a model area of their own (model/users/<area>/, listed in
// /etc/geobim/members.json, see api/_members.php) — BimViewer.serverRole then
// says which. Everyone else — demo, other accounts, no login — gets no
// cookie; any stale one is cleared. The app works for them, just without
// server models (api/models.php returns an empty list).
// BimViewer.ownerSessionReady resolves once this is settled, so the model list
// is not fetched before the cookie exists; the event 'geobim-session' tells
// the UI (members are known only from here, not from BimViewer.labUsers).
// ===============================
'use strict';

(function() {

  var REFRESH_MS = 6 * 3600 * 1000;   // cookie lives 12 h
  var settle;
  BimViewer.ownerSession = false;
  BimViewer.ownerSessionReady = new Promise(function(resolve) { settle = resolve; });

  function firebaseUser() {
    var auth = window.BimAuth;
    return auth && (auth.authenticatedUser || (typeof auth.getFirebaseUser === 'function' && auth.getFirebaseUser()));
  }

  async function establish() {
    try {
      var user = firebaseUser();
      if (user && typeof user.getIdToken === 'function') {
        var token = await user.getIdToken();
        var r = await fetch('api/owner-session.php', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
        var body = await r.json().catch(function() { return {}; });
        BimViewer.ownerSession = r.ok && body.session === true;
        BimViewer.serverRole = BimViewer.ownerSession ? (body.role || 'owner') : null;
        if (!r.ok) console.warn('Owner session refused: HTTP ' + r.status);
      } else {
        await fetch('api/owner-session.php', { method: 'DELETE' });
        BimViewer.ownerSession = false;
        BimViewer.serverRole = null;
      }
    } catch (err) {
      console.warn('Owner session failed:', err.message);
      BimViewer.ownerSession = false;
      BimViewer.serverRole = null;
    }
    settle(BimViewer.ownerSession);
    window.dispatchEvent(new CustomEvent('geobim-session', { detail: { role: BimViewer.serverRole } }));
  }

  // Wait until auth-gate / demo mode has decided who this is.
  var tries = 0;
  (function wait() {
    var decided = window._authGatePassed || (window.BimAuth && BimAuth.currentUser);
    if (decided) {
      establish();
      setInterval(function() { if (BimViewer.ownerSession) establish(); }, REFRESH_MS);
      return;
    }
    if (++tries > 600) { settle(false); return; }   // ~3 min: no sign-in happened
    setTimeout(wait, 300);
  })();

  // Signing out drops the cookie first.
  if (window.BimAuth && typeof BimAuth.logout === 'function') {
    var origLogout = BimAuth.logout;
    BimAuth.logout = function() {
      var self = this, args = arguments;
      BimViewer.ownerSession = false;
      BimViewer.serverRole = null;
      fetch('api/owner-session.php', { method: 'DELETE' }).finally(function() { origLogout.apply(self, args); });
    };
  }

  console.log('Owner session module loaded v1.1');
})();
