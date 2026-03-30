// ============================================================
// Ion Auth Module — Cesium Ion OAuth2 PKCE for geobim.app
//
// Copyright (c) 2026 geobim.app
// Licensed under the Business Source License 1.1 (BSL 1.1)
// Change Date: 2030-03-01 | Change License: MIT
// See LICENSE file for full terms.
//
// Manages Cesium Ion access tokens:
//   - Default (demo) token from server-side endpoint
//   - OAuth2 PKCE login with user's own Ion account
//   - Token refresh and localStorage persistence
//
// Tested with CesiumJS 1.139.1
// ============================================================

(function() {
  'use strict';

  // ========================================================
  // CONSTANTS
  // ========================================================

  var ION_AUTH_URL = 'https://ion.cesium.com/oauth';
  var ION_TOKEN_URL = 'https://api.cesium.com/oauth/token';
  var ION_API_URL = 'https://api.cesium.com/v1';
  var REDIRECT_URI = window.location.origin + '/';
  var SCOPES = 'assets:list assets:read';
  var STORAGE_KEY = 'cesium_ion_oauth';
  var VERIFIER_KEY = 'cesium_ion_pkce_verifier';

  // ========================================================
  // STATE
  // ========================================================

  var defaultToken = null;
  var defaultTokenName = null;
  var oauthToken = null;       // { access_token, refresh_token, expires_at, user }
  var currentToken = null;     // active token string (default or oauth)
  var refreshTimer = null;
  var indicatorCreated = false;

  // ========================================================
  // PKCE HELPERS
  // ========================================================

  function generateRandomString(length) {
    var array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, function(b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
  }

  function sha256(plain) {
    var encoder = new TextEncoder();
    var data = encoder.encode(plain);
    return crypto.subtle.digest('SHA-256', data);
  }

  function base64urlEncode(buffer) {
    var bytes = new Uint8Array(buffer);
    var str = '';
    for (var i = 0; i < bytes.length; i++) {
      str += String.fromCharCode(bytes[i]);
    }
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function generatePKCE() {
    var verifier = generateRandomString(64);
    var hashed = await sha256(verifier);
    var challenge = base64urlEncode(hashed);
    return { verifier: verifier, challenge: challenge };
  }

  // ========================================================
  // DEFAULT TOKEN (SERVER-SIDE)
  // ========================================================

  async function fetchDefaultToken() {
    try {
      var resp = await fetch('/api/ion-config.php');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var data = await resp.json();
      defaultToken = data.token;
      defaultTokenName = data.name || 'Default';
      console.log('[IonAuth] Default token loaded from server');
      return defaultToken;
    } catch (err) {
      console.error('[IonAuth] Failed to fetch default token:', err);
      return null;
    }
  }

  // ========================================================
  // LOCALSTORAGE PERSISTENCE
  // ========================================================

  function saveOAuthToken(tokenData) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tokenData));
    } catch (e) {
      console.warn('[IonAuth] Failed to save token:', e);
    }
  }

  function loadOAuthToken() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (data.expires_at && Date.now() > data.expires_at) {
        // Token expired — try refresh if available
        if (data.refresh_token) return data;
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return data;
    } catch (e) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }

  function clearOAuthToken() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(VERIFIER_KEY);
    oauthToken = null;
  }

  // ========================================================
  // OAUTH2 PKCE FLOW
  // ========================================================

  async function startLogin() {
    if (isDemoMode()) {
      console.warn('[IonAuth] Ion OAuth login not available in demo mode');
      return;
    }

    var clientId = GEOBIM_CONFIG.cesiumIon && GEOBIM_CONFIG.cesiumIon.clientId;
    if (!clientId) {
      console.error('[IonAuth] No clientId in GEOBIM_CONFIG.cesiumIon');
      return;
    }

    var pkce = await generatePKCE();
    localStorage.setItem(VERIFIER_KEY, pkce.verifier);

    var params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256'
    });

    window.location.href = ION_AUTH_URL + '?' + params.toString();
  }

  async function handleRedirectCode(code) {
    var clientId = GEOBIM_CONFIG.cesiumIon && GEOBIM_CONFIG.cesiumIon.clientId;
    var verifier = localStorage.getItem(VERIFIER_KEY);

    if (!clientId || !verifier) {
      console.error('[IonAuth] Missing clientId or PKCE verifier for token exchange');
      return false;
    }

    try {
      var resp = await fetch(ION_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          code: code,
          redirect_uri: REDIRECT_URI,
          code_verifier: verifier
        })
      });

      if (!resp.ok) {
        var errText = await resp.text();
        throw new Error('Token exchange failed: ' + resp.status + ' ' + errText);
      }

      var data = await resp.json();
      localStorage.removeItem(VERIFIER_KEY);

      // Clean URL FIRST (before any async work that might reload)
      var cleanUrl = new URL(window.location);
      cleanUrl.searchParams.delete('code');
      window.history.replaceState({}, '', cleanUrl.toString());

      oauthToken = {
        access_token: data.access_token,
        refresh_token: data.refresh_token || null,
        expires_at: data.expires_in ? Date.now() + (data.expires_in * 1000) - 60000 : null,
        user: null
      };

      // Fetch user profile
      await fetchUserProfile();

      saveOAuthToken(oauthToken);
      applyOAuthToken();

      // Schedule refresh if we got a refresh_token (valid ~90 days per Cesium docs)
      if (oauthToken.refresh_token) {
        scheduleRefresh();
      }

      console.log('[IonAuth] Token valid for',
        oauthToken.expires_at ? Math.round((oauthToken.expires_at - Date.now()) / 86400000) + ' days' : 'unknown duration',
        oauthToken.refresh_token ? '(refresh token available)' : '(no refresh token)');

      console.log('[IonAuth] OAuth login successful:', oauthToken.user?.username || 'unknown');
      return true;
    } catch (err) {
      console.error('[IonAuth] Token exchange error:', err);
      localStorage.removeItem(VERIFIER_KEY);
      return false;
    }
  }

  async function refreshAccessToken() {
    if (!oauthToken || !oauthToken.refresh_token) return false;

    var clientId = GEOBIM_CONFIG.cesiumIon && GEOBIM_CONFIG.cesiumIon.clientId;
    if (!clientId) return false;

    try {
      var resp = await fetch(ION_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: oauthToken.refresh_token
        })
      });

      if (!resp.ok) throw new Error('Refresh failed: ' + resp.status);

      var data = await resp.json();
      oauthToken.access_token = data.access_token;
      if (data.refresh_token) oauthToken.refresh_token = data.refresh_token;
      oauthToken.expires_at = data.expires_in ? Date.now() + (data.expires_in * 1000) - 60000 : null;

      saveOAuthToken(oauthToken);
      applyOAuthToken();
      scheduleRefresh();

      console.log('[IonAuth] Token refreshed');
      return true;
    } catch (err) {
      console.error('[IonAuth] Token refresh failed:', err);
      // Don't clear OAuth token if access_token is still valid (not yet expired)
      if (oauthToken && oauthToken.expires_at && Date.now() < oauthToken.expires_at) {
        console.log('[IonAuth] Access token still valid, keeping session');
        oauthToken.refresh_token = null;
        saveOAuthToken(oauthToken);
      } else {
        clearOAuthToken();
        applyDefaultToken();
        updateIndicator();
      }
      return false;
    }
  }

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    if (!oauthToken || !oauthToken.expires_at) return;

    var ms = oauthToken.expires_at - Date.now();
    if (ms <= 0) {
      refreshAccessToken();
      return;
    }

    refreshTimer = setTimeout(function() {
      refreshAccessToken();
    }, ms);

    console.log('[IonAuth] Token refresh scheduled in', Math.round(ms / 60000), 'min');
  }

  // ========================================================
  // USER PROFILE
  // ========================================================

  async function fetchUserProfile() {
    if (!oauthToken || !oauthToken.access_token) return;

    try {
      var resp = await fetch(ION_API_URL + '/me', {
        headers: { 'Authorization': 'Bearer ' + oauthToken.access_token }
      });
      if (!resp.ok) throw new Error('Profile fetch failed: ' + resp.status);
      var user = await resp.json();
      // Cesium Ion /v1/me returns {id, scopes} — no username/email without profile scope
      oauthToken.user = {
        id: user.id,
        username: user.username || user.emailAddress || null,
        email: user.emailAddress || null
      };
    } catch (err) {
      console.warn('[IonAuth] Could not fetch user profile:', err);
    }
  }

  // ========================================================
  // TOKEN APPLICATION
  // ========================================================

  function applyOAuthToken() {
    if (!oauthToken || !oauthToken.access_token) return;
    currentToken = oauthToken.access_token;

    if (typeof Cesium !== 'undefined' && Cesium.Ion) {
      Cesium.Ion.defaultAccessToken = currentToken;
    }

    updateIndicator();
    dispatchTokenEvent();
  }

  function applyDefaultToken() {
    currentToken = defaultToken;

    if (typeof Cesium !== 'undefined' && Cesium.Ion) {
      Cesium.Ion.defaultAccessToken = currentToken;
    }

    updateIndicator();
    dispatchTokenEvent();
  }

  function dispatchTokenEvent() {
    window.dispatchEvent(new CustomEvent('ion-token-changed', {
      detail: { token: currentToken, isOAuth: !!oauthToken }
    }));
  }

  // ========================================================
  // STATUS INDICATOR UI
  // ========================================================

  function isDemoMode() {
    return !!(window._demoMode || window._weaDemoMode);
  }

  function createIndicator() {
    if (indicatorCreated) return;
    // No indicator in demo mode — demo users can't connect their own Ion account
    if (isDemoMode()) return;
    indicatorCreated = true;

    var indicator = document.createElement('div');
    indicator.id = 'ionAuthIndicator';
    indicator.className = 'ion-auth-indicator';
    indicator.innerHTML =
      '<div class="ion-auth-indicator-inner" id="ionAuthIndicatorInner">' +
        '<i data-lucide="globe" class="ion-auth-icon"></i>' +
        '<span class="ion-auth-label" id="ionAuthLabel">Cesium Ion</span>' +
        '<span class="ion-auth-status" id="ionAuthStatus"></span>' +
      '</div>' +
      '<div class="ion-auth-dropdown" id="ionAuthDropdown">' +
        '<div class="ion-auth-dropdown-content" id="ionAuthDropdownContent"></div>' +
      '</div>';

    document.body.appendChild(indicator);

    // Toggle dropdown
    var inner = document.getElementById('ionAuthIndicatorInner');
    inner.addEventListener('click', function(e) {
      e.stopPropagation();
      var dropdown = document.getElementById('ionAuthDropdown');
      dropdown.classList.toggle('visible');
    });

    // Close on outside click
    document.addEventListener('click', function() {
      var dropdown = document.getElementById('ionAuthDropdown');
      if (dropdown) dropdown.classList.remove('visible');
    });

    if (window.lucide) lucide.createIcons({ nodes: [indicator] });
    updateIndicator();
  }

  function updateIndicator() {
    var statusEl = document.getElementById('ionAuthStatus');
    var contentEl = document.getElementById('ionAuthDropdownContent');
    if (!statusEl || !contentEl) return;

    if (oauthToken && oauthToken.access_token) {
      var username = (oauthToken.user && oauthToken.user.username) || 'Connected';
      statusEl.textContent = username;
      statusEl.className = 'ion-auth-status ion-auth-connected';

      contentEl.innerHTML =
        '<div class="ion-auth-user-info">' +
          '<i data-lucide="user" style="width:16px;height:16px;"></i>' +
          '<div>' +
            '<div class="ion-auth-username">' + escapeHtml(username) + '</div>' +
            (oauthToken.user && oauthToken.user.email
              ? '<div class="ion-auth-email">' + escapeHtml(oauthToken.user.email) + '</div>'
              : '') +
          '</div>' +
        '</div>' +
        '<div class="ion-auth-info-text">Using your personal Ion assets and tokens.</div>' +
        '<details class="ion-auth-details" open>' +
          '<summary>Required Ion Assets</summary>' +
          '<div class="ion-auth-required-assets">' +
            'Enable these in your <a href="https://ion.cesium.com/assets/" target="_blank" rel="noopener">Ion My Assets</a> ' +
            'for full functionality:' +
            '<ul>' +
              '<li>Cesium World Terrain</li>' +
              '<li>Bing Maps Aerial</li>' +
              '<li>Bing Maps Road</li>' +
              '<li>Google Maps 2D Satellite</li>' +
              '<li>Google Maps 2D Contour</li>' +
            '</ul>' +
          '</div>' +
        '</details>' +
        '<button class="ion-auth-btn ion-auth-btn-logout" id="ionLogoutBtn">' +
          '<i data-lucide="log-out" style="width:14px;height:14px;"></i> Disconnect' +
        '</button>';

      var logoutBtn = document.getElementById('ionLogoutBtn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          BimIonAuth.logout();
        });
      }
    } else {
      statusEl.textContent = 'Connect';
      statusEl.className = 'ion-auth-status ion-auth-default';

      contentEl.innerHTML =
        '<div class="ion-auth-info-text">' +
          'Using shared demo token. Connect your own Cesium Ion account to access your personal assets.' +
        '</div>' +
        '<button class="ion-auth-btn ion-auth-btn-login" id="ionLoginBtn">' +
          '<i data-lucide="log-in" style="width:14px;height:14px;"></i> Connect to Cesium Ion' +
        '</button>';

      var loginBtn = document.getElementById('ionLoginBtn');
      if (loginBtn) {
        loginBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          BimIonAuth.login();
        });
      }
    }

    if (window.lucide) lucide.createIcons({ nodes: [contentEl] });
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ========================================================
  // INITIALIZATION
  // ========================================================

  async function init() {
    console.log('[IonAuth] Initializing...');

    // 1. Check for OAuth redirect code in URL
    var urlParams = new URLSearchParams(window.location.search);
    var code = urlParams.get('code');

    // 2. Load default token from server
    await fetchDefaultToken();

    // 3. Check stored OAuth token
    var stored = loadOAuthToken();

    if (code) {
      // Returning from OAuth redirect — flag prevents premature asset loading
      window._ionOAuthPending = true;
      console.log('[IonAuth] Processing OAuth redirect...');
      var success = await handleRedirectCode(code);
      window._ionOAuthPending = false;
      if (!success) {
        applyDefaultToken();
      }
    } else if (stored) {
      oauthToken = stored;

      // Check if token has expired
      if (stored.expires_at && Date.now() > stored.expires_at) {
        console.log('[IonAuth] Stored token expired');
        if (stored.refresh_token) {
          var refreshed = await refreshAccessToken();
          if (!refreshed) {
            applyDefaultToken();
          }
        } else {
          // No refresh possible — clear and use default
          clearOAuthToken();
          applyDefaultToken();
        }
      } else {
        applyOAuthToken();
        console.log('[IonAuth] Restored OAuth session:', stored.user?.username || 'unknown');
      }
    } else {
      // No OAuth — use default token
      applyDefaultToken();
    }

    // 4. Update UI indicator (already created on DOM ready)
    createIndicator();
    updateIndicator();

    console.log('[IonAuth] Ready');
  }

  // ========================================================
  // PUBLIC API — window.BimIonAuth
  // ========================================================

  window.BimIonAuth = {
    init: init,

    login: function() {
      startLogin();
    },

    logout: function() {
      if (refreshTimer) clearTimeout(refreshTimer);
      clearOAuthToken();
      applyDefaultToken();
      updateIndicator();
      console.log('[IonAuth] Disconnected, using default token');
    },

    getToken: function() {
      return currentToken || defaultToken;
    },

    isOAuthConnected: function() {
      return !!(oauthToken && oauthToken.access_token);
    },

    getUser: function() {
      return oauthToken ? oauthToken.user : null;
    },

    getDefaultToken: function() {
      return defaultToken;
    }
  };

  // Auto-create indicator when DOM is ready (even before init)
  function ensureIndicator() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', createIndicator);
    } else {
      createIndicator();
    }
  }
  ensureIndicator();

  console.log('[IonAuth] Module loaded');

})();
