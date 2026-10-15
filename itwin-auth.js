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
// ITWIN AUTH
// Sign-in with a Bentley account (OAuth2 authorization code + PKCE, Bentley
// IMS) so CesiumJS ITwinData can stream the user's own iModels with
// ITwinPlatform.defaultAccessToken instead of a share key.
//
// window.GEOBIM_ITWIN_AUTH: login(), handleCallback(), getToken(), apply(),
// logout(), isAvailable(), expiresAt(). Used by itwin-models.js and
// itwin-callback.html.
//
// The token lives in sessionStorage only (this tab, gone when it closes) and
// is never logged. The client id is public (SPA client, no secret).
// ===============================
'use strict';

(function() {

  var CLIENT_ID = 'spa-K1Bw2oHFKzK2iZxJkL3GpHtQ0';
  var SCOPE = 'itwin-platform';
  var AUTHORIZE_URL = 'https://ims.bentley.com/connect/authorize';
  // IMS answers the token request without CORS headers, so the browser
  // exchanges the code through our relay (api/itwin-token.php, same origin)
  var TOKEN_RELAY = '/api/itwin-token.php';
  var END_SESSION_URL = 'https://ims.bentley.com/connect/endsession';

  // Redirect URIs registered for the client; the callback is only offered on
  // these origins (never built blindly from location.origin)
  var ORIGINS = ['https://geobim.app', 'https://beta.geobim.app', 'https://viewer.geobim.app'];
  var CALLBACK_PATH = '/itwin-callback.html';

  var TOKEN_KEY = 'geobim_itwin_token';     // { token, expiresAt }
  var PKCE_KEY = 'geobim_itwin_pkce';       // { verifier, state, redirectUri, returnTo }
  var MIN_VALIDITY_MS = 60 * 1000;

  // Storage may throw (blocked site data, some private modes)
  function recall(key) {
    try { return JSON.parse(window.sessionStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function store(key, value) {
    try { window.sessionStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function forget(key) {
    try { window.sessionStorage.removeItem(key); } catch (e) {}
  }

  function base64url(bytes) {
    var str = '';
    for (var i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function randomString(byteCount) {
    var bytes = new Uint8Array(byteCount);
    crypto.getRandomValues(bytes);
    return base64url(bytes);
  }

  async function challengeFor(verifier) {
    var hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return base64url(new Uint8Array(hash));
  }

  function redirectUri() {
    return ORIGINS.indexOf(window.location.origin) !== -1 ? window.location.origin + CALLBACK_PATH : null;
  }

  // Only return to a page of this origin (no open redirect via sessionStorage)
  function safeReturn(url) {
    try {
      var u = new URL(url, window.location.origin);
      if (u.origin === window.location.origin) return u.pathname + u.search + u.hash;
    } catch (e) {}
    return '/';
  }

  var auth = {
    // Sign-in is offered only where a redirect URI is registered
    isAvailable: function() {
      return !!redirectUri() && !!(window.crypto && crypto.subtle);
    },

    login: async function(returnTo) {
      var uri = redirectUri();
      if (!uri) throw new Error('Bentley sign-in is not available on this address');
      var verifier = randomString(48);
      var state = randomString(24);
      if (!store(PKCE_KEY, { verifier: verifier, state: state, redirectUri: uri, returnTo: safeReturn(returnTo || window.location.href) })) {
        throw new Error('Bentley sign-in needs browser storage, which is blocked');
      }
      var params = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: 'code',
        redirect_uri: uri,
        scope: SCOPE,
        state: state,
        code_challenge: await challengeFor(verifier),
        code_challenge_method: 'S256'
      });
      window.location.assign(AUTHORIZE_URL + '?' + params.toString());
    },

    // On itwin-callback.html: check state, exchange the code, keep the token.
    // Resolves to the page to return to; rejects with a readable message.
    handleCallback: async function() {
      var query = new URLSearchParams(window.location.search);
      var pkce = recall(PKCE_KEY);
      forget(PKCE_KEY);
      // the code must not stay in the address bar or history
      try { window.history.replaceState(null, '', window.location.pathname); } catch (e) {}

      if (query.get('error')) {
        throw new Error('Sign-in was cancelled or refused (' + query.get('error') + ')');
      }
      var code = query.get('code');
      if (!code) throw new Error('No authorization code in the response');
      if (!pkce || !pkce.verifier || query.get('state') !== pkce.state) {
        throw new Error('Sign-in could not be verified (state mismatch) — please try again');
      }

      var response;
      try {
        response = await fetch(TOKEN_RELAY, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code: code,
            redirect_uri: pkce.redirectUri,
            code_verifier: pkce.verifier
          })
        });
      } catch (e) {
        throw new Error('geoBIM.app sign-in service not reachable');
      }
      var data = await response.json().catch(function() { return {}; });
      if (!response.ok || !data.access_token) {
        throw new Error('Token exchange failed (' + (data.error || response.status) + ')');
      }
      store(TOKEN_KEY, {
        token: data.access_token,
        expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000
      });
      return safeReturn(pkce.returnTo);
    },

    // The access token, only while it is valid for more than a minute
    getToken: function() {
      var t = recall(TOKEN_KEY);
      if (!t || !t.token || !(t.expiresAt - Date.now() > MIN_VALIDITY_MS)) return null;
      return t.token;
    },

    expiresAt: function() {
      var t = recall(TOKEN_KEY);
      return t && t.token ? t.expiresAt : null;
    },

    // Hand the token to CesiumJS. A share key (iTwin demo) wins over the token
    // in ITwinPlatform, so it is cleared here.
    apply: function() {
      var token = this.getToken();
      if (!token || typeof Cesium === 'undefined' || !Cesium.ITwinPlatform) return false;
      Cesium.ITwinPlatform.defaultShareKey = undefined;
      Cesium.ITwinPlatform.defaultAccessToken = token;
      return true;
    },

    // Forget the token; with endSession also end the Bentley session
    // (navigates to Bentley and back to this origin's start page)
    logout: function(endSession) {
      forget(TOKEN_KEY);
      if (typeof Cesium !== 'undefined' && Cesium.ITwinPlatform) {
        Cesium.ITwinPlatform.defaultAccessToken = undefined;
      }
      if (endSession && redirectUri()) {
        window.location.assign(END_SESSION_URL + '?' + new URLSearchParams({
          client_id: CLIENT_ID,
          post_logout_redirect_uri: window.location.origin + '/'
        }).toString());
      }
    }
  };

  window.GEOBIM_ITWIN_AUTH = auth;
})();
