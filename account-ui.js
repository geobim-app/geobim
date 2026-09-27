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
// ACCOUNT UI v1.0
// The sidebar header's #userBadge (ui.js) was never shown. Now: guests see
// "Guest" + "Sign in" (opens the auth-gate dialog, see auth-gate.js guest
// access); signed-in users see their email + "Sign out". Also sets
// body.guest-mode, which hides the Layers tools guests don't get (Ion terrain
// / imagery by asset ID, geoid terrain, bathymetry — see auth-styles.css).
// ===============================
'use strict';

(function() {

  function isGuest() {
    var u = window.BimAuth && BimAuth.authenticatedUser;
    return !u || u.isAnonymous || !!window._guestMode || !!window._demoMode || !!window._weaDemoMode;
  }

  function render() {
    var badge = document.getElementById('userBadge');
    var email = document.getElementById('userEmail');
    var btn = document.getElementById('logoutBtn');
    if (!badge || !email || !btn || !window._authGatePassed) return false;
    var guest = isGuest();
    email.textContent = guest ? 'Guest' : ((BimAuth.currentUser && BimAuth.currentUser.email) || '');
    btn.textContent = guest ? 'Sign in' : 'Sign out';
    btn.title = guest ? 'Sign in for more features' : 'Sign out';
    btn.classList.toggle('account-signin', guest);
    btn.onclick = guest
      ? function() { if (window.showAuthGateLogin) window.showAuthGateLogin(); }
      : function() { if (window.authGateLogout) window.authGateLogout(); else BimAuth.logout(); };
    badge.classList.add('account-visible');
    // guest-only CSS rules (auth-styles.css): hide tools guests don't get
    document.body.classList.toggle('guest-mode', guest);
    // /bridge-inspector is the inspection demo: it keeps its Inspection section
    document.body.classList.toggle('bridge-mode', !!window._bridgeInspectorMode);
    return true;
  }

  var tries = 0;
  (function wait() {
    if (render() || ++tries > 200) return;
    setTimeout(wait, 300);
  })();

  console.log('Account UI loaded v1.0');
})();
