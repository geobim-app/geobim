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
'use strict';

(function() {

  var firebaseAuth = firebase.auth();

  // =====================================
  // BUILD LOGIN OVERLAY
  // =====================================
  var overlay = document.createElement('div');
  overlay.id = 'authGateOverlay';
  overlay.innerHTML =
    '<div class="ag-card">' +
      '<img src="logo/logo_teal_transparent.svg" alt="geobim.app" class="ag-logo">' +
      '<div class="ag-title">Sign In</div>' +
      '<input id="agEmail" class="ag-input" type="email" placeholder="Email" autocomplete="email" />' +
      '<input id="agPassword" class="ag-input" type="password" placeholder="Password" autocomplete="current-password" />' +
      '<div id="agError" class="ag-error"></div>' +
      '<button id="agSubmit" class="ag-btn">Sign In</button>' +
    '</div>';

  // =====================================
  // STYLES (scoped to #authGateOverlay)
  // =====================================
  var style = document.createElement('style');
  style.textContent =
    '#authGateOverlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;' +
    'justify-content:center;background:#0a1628;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
    '#authGateOverlay.ag-hidden{display:none}' +
    '.ag-card{background:#132034;border-radius:16px;padding:40px 36px;width:100%;max-width:380px;' +
    'box-shadow:0 16px 48px rgba(0,0,0,.5);text-align:center}' +
    '.ag-logo{height:48px;margin-bottom:24px}' +
    '.ag-title{color:#fff;font-size:20px;font-weight:700;margin-bottom:24px}' +
    '.ag-input{display:block;width:100%;padding:12px 14px;margin-bottom:14px;border:1px solid rgba(255,255,255,.15);' +
    'border-radius:8px;background:rgba(255,255,255,.05);color:#fff;font-size:14px;box-sizing:border-box;' +
    'transition:border-color .2s,box-shadow .2s}' +
    '.ag-input:focus{outline:none;border-color:#6EECD8;box-shadow:0 0 0 3px rgba(110,236,216,.15)}' +
    '.ag-input::placeholder{color:rgba(255,255,255,.4)}' +
    '.ag-error{color:#ff6b6b;font-size:13px;min-height:20px;margin-bottom:10px}' +
    '.ag-btn{width:100%;padding:12px;border:none;border-radius:8px;' +
    'background:linear-gradient(135deg,#6EECD8 0%,#3DB8A0 100%);color:#0E1117;font-size:15px;' +
    'font-weight:700;cursor:pointer;transition:box-shadow .2s,transform .2s}' +
    '.ag-btn:hover{box-shadow:0 6px 16px rgba(110,236,216,.35);transform:translateY(-1px)}' +
    '.ag-btn:active{transform:translateY(0)}' +
    '.ag-btn:disabled{opacity:.6;cursor:not-allowed;transform:none;box-shadow:none}';

  document.head.appendChild(style);

  // Start hidden — splash screen shows first, auth gate appears after splash is dismissed
  overlay.classList.add('ag-hidden');
  document.body.prepend(overlay);

  // =====================================
  // LOGIN LOGIC
  // =====================================
  var emailInput = document.getElementById('agEmail');
  var passInput = document.getElementById('agPassword');
  var errorEl = document.getElementById('agError');
  var submitBtn = document.getElementById('agSubmit');

  function doLogin() {
    var email = emailInput.value.trim();
    var pass = passInput.value;
    if (!email || !pass) return;

    errorEl.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in\u2026';

    firebaseAuth.signInWithEmailAndPassword(email, pass)
      .catch(function(err) {
        errorEl.textContent = 'Invalid credentials.';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
      });
    // On success, onAuthStateChanged below handles the rest.
  }

  submitBtn.addEventListener('click', doLogin);
  emailInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') passInput.focus(); });
  passInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') doLogin(); });

  // =====================================
  // SESSION PERSISTENCE & GATE CONTROL
  // =====================================

  /**
   * Called when a user is authenticated (login or persisted session).
   * Hides the overlay and starts the app.
   */
  function onAuthenticated(user) {
    overlay.classList.add('ag-hidden');

    // Expose the authenticated user on BimAuth if it exists
    if (window.BimAuth) {
      window.BimAuth.authenticatedUser = user;
    }

    // Mark auth gate as passed
    window._authGatePassed = true;

    // Initialize demo auth (sets Ion token, shows app)
    if (typeof BimAuth !== 'undefined' && !BimAuth.initialized) {
      BimAuth.init();
    }
  }

  /**
   * Called when there is no authenticated user.
   * Only show login overlay after splash has been dismissed.
   */
  function onUnauthenticated() {
    // Wait for splash to be dismissed before showing login
    if (!window._splashDismissed) {
      // Poll until splash is dismissed
      var waitForSplash = setInterval(function() {
        if (window._splashDismissed) {
          clearInterval(waitForSplash);
          overlay.classList.remove('ag-hidden');
        }
      }, 200);
    } else {
      overlay.classList.remove('ag-hidden');
    }
    window._authGateAppStarted = false;
    // Reset form
    if (emailInput) emailInput.value = '';
    if (passInput) passInput.value = '';
    if (errorEl) errorEl.textContent = '';
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Sign In'; }
  }

  // Listen for auth state changes (handles both fresh login and persisted sessions)
  firebaseAuth.onAuthStateChanged(function(user) {
    if (user && !user.isAnonymous) {
      onAuthenticated(user);
    } else if (!user) {
      onUnauthenticated();
    }
    // Ignore anonymous users – they don't pass the gate
  });

  // =====================================
  // LOGOUT
  // =====================================
  window.authGateLogout = function() {
    firebaseAuth.signOut().then(function() {
      window.location.reload();
    });
  };

  console.log('Auth gate loaded – email/password login required.');

})();
