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
// OWNER SESSION v1.0
// model/ (uploaded IFC tilesets, GLBs, raw IFCs) is owner-only on the server:
// api/model-file.php checks an HttpOnly session cookie. Cesium fetches tiles
// with plain GETs, so after Firebase sign-in the owner trades the ID token for
// that cookie (api/owner-session.php). Everyone else — demo, other accounts,
// no login — gets no cookie; any stale one is cleared. The app works for them,
// just without server models (api/models.php returns an empty list).
// BimViewer.ownerSessionReady resolves once this is settled, so the model list
// is not fetched before the cookie exists.
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
      if (BimViewer.isLabUser() && user && typeof user.getIdToken === 'function') {
        var token = await user.getIdToken();
        var r = await fetch('api/owner-session.php', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
        BimViewer.ownerSession = r.ok;
        if (!r.ok) console.warn('Owner session refused: HTTP ' + r.status);
      } else {
        await fetch('api/owner-session.php', { method: 'DELETE' });
        BimViewer.ownerSession = false;
      }
    } catch (err) {
      console.warn('Owner session failed:', err.message);
      BimViewer.ownerSession = false;
    }
    settle(BimViewer.ownerSession);
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
      fetch('api/owner-session.php', { method: 'DELETE' }).finally(function() { origLogout.apply(self, args); });
    };
  }

  console.log('Owner session module loaded v1.0');
})();
