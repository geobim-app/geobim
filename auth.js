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
// CESIUM BIM VIEWER - AUTH MODULE (DEMO MODE)
// No login required - auto-applies demo token
// ===============================
'use strict';

(function() {

  console.log('Loading Auth module (Demo Mode)...');

  // =====================================
  // FIREBASE INITIALIZATION
  // =====================================
  const firebaseConfig = GEOBIM_CONFIG.firebase;
  const firebaseApp = firebase.initializeApp(firebaseConfig);
  const firebaseAuth = firebase.auth();
  const firebaseDb = firebase.firestore();

  // =====================================
  // ION TOKEN — delegated to BimIonAuth
  // =====================================

  // =====================================
  // AUTH STATE
  // =====================================

  window.BimAuth = {
    currentUser: null,
    initialized: false,
    ionToken: null,
    currentAccountId: null,

    // Initialize - Demo mode (no login required)
    init: function() {
      if (this.initialized) {
        console.log('Auth already initialized');
        return;
      }

      this.initialized = true;
      console.log('Demo mode initialized - no login required');

      // Anonymous auth for Firestore access
      firebaseAuth.signInAnonymously()
        .then((userCredential) => {
          console.log('Anonymous auth successful:', userCredential.user.uid);
          this.firebaseUser = userCredential.user;
        })
        .catch((error) => {
          console.error('Anonymous auth failed:', error);
        });

      // Set demo user only if not already set by auth-gate
      if (!this.currentUser) {
        this.currentUser = { email: 'demo@geobim.app', displayName: 'Demo User' };
      }

      // Auto-apply demo token and show app
      this.checkIonToken();
    },

    // Check for Ion Token — delegates to BimIonAuth
    checkIonToken: async function() {
      if (typeof BimIonAuth !== 'undefined') {
        await BimIonAuth.init();
        var token = BimIonAuth.getToken();
        if (token) {
          this.ionToken = token;
          this.currentAccountId = BimIonAuth.isOAuthConnected() ? 'oauth' : 'demo';
          this.applyToken(token);
        }
      }
      this.showApp();
      console.log('Ion token applied via BimIonAuth');

      // Listen for token changes (OAuth login/logout)
      window.addEventListener('ion-token-changed', function(e) {
        var newToken = e.detail.token;
        if (newToken) {
          BimAuth.ionToken = newToken;
          BimAuth.currentAccountId = e.detail.isOAuth ? 'oauth' : 'demo';
          BimAuth.applyToken(newToken);
          console.log('Ion token updated:', e.detail.isOAuth ? 'OAuth' : 'Default');
        }
      });
    },

    // Apply Token to Cesium
    applyToken: function(token) {
      if (typeof Cesium !== 'undefined') {
        Cesium.Ion.defaultAccessToken = token;
        console.log('Cesium Ion token set');
      } else {
        window.CESIUM_ION_TOKEN = token;
        console.log('Cesium Ion token stored for later use');
      }
    },

    // Firebase getters
    getFirebaseDb: function() { return firebaseDb; },
    getFirebaseAuth: function() { return firebaseAuth; },
    getFirebaseUser: function() { return this.firebaseUser || firebaseAuth.currentUser; },

    // Get Ion Token
    getIonToken: function() {
      if (typeof BimIonAuth !== 'undefined') {
        return BimIonAuth.getToken();
      }
      return this.ionToken;
    },

    // Clear Ion Token (resets to demo via BimIonAuth)
    clearIonToken: function() {
      if (typeof BimIonAuth !== 'undefined') {
        BimIonAuth.logout();
      }
      this.ionToken = typeof BimIonAuth !== 'undefined' ? BimIonAuth.getDefaultToken() : null;
      this.currentAccountId = 'demo';
      console.log('Ion Token reset to demo');
    },

    // Show App
    showApp: function() {
      const cesiumContainer = document.getElementById('cesiumContainer');
      const toolbar = document.getElementById('toolbar');
      const sidebarToggle = document.getElementById('sidebarToggle');

      if (cesiumContainer) cesiumContainer.style.display = 'block';
      if (toolbar) toolbar.style.display = 'block';
      if (sidebarToggle) sidebarToggle.style.display = 'block';
      var bottomToolbar = document.getElementById('bottomToolbar');
      if (bottomToolbar) bottomToolbar.style.display = 'flex';

      // Comments module is initialized later by index.html after viewer is ready
    },

    // Hide App
    hideApp: function() {
      const cesiumContainer = document.getElementById('cesiumContainer');
      const toolbar = document.getElementById('toolbar');

      if (cesiumContainer) cesiumContainer.style.display = 'none';
      if (toolbar) toolbar.style.display = 'none';
    },

    // Get current user (demo user)
    getCurrentUser: function() {
      return this.currentUser;
    },

    // Check if logged in (always true in demo mode)
    isLoggedIn: function() {
      return this.initialized;
    },

    // Logout (just resets to initial state in demo mode)
    logout: function() {
      firebaseAuth.signOut();
      this.clearIonToken();
      this.hideApp();
      // Clear splash session flag so it shows again on reload
      sessionStorage.removeItem('geoBIM_splashShown');
      this.initialized = false;
      this.currentUser = null;
      window._splashDismissed = false;
      console.log('Logged out - reloading to show splash screen');
      location.reload();
    }
  };

  console.log('Auth module loaded (Demo Mode)');
  console.log('Usage:');
  console.log('   - BimAuth.init() - Initialize demo mode');
  console.log('   - BimAuth.getIonToken() - Get Cesium Ion token');
  console.log('   - BimAuth.logout() - Return to splash screen');

})();
