// ===============================
// CESIUM BIM VIEWER - FIREBASE AUTH MODULE v1.2
// With Cesium Ion Token Support
// ===============================
'use strict';

(function() {
  
  console.log('🔐 Loading Firebase Auth module v1.2 (with Ion Token)...');

  // =====================================
  // FIREBASE AUTH CONFIG
  // =====================================
  
  const FIREBASE_AUTH_CONFIG = {
    apiKey: "AIzaSyAL409coGn10I8afll2aae5vuvog_qVWZA",
    authDomain: "publictwin-ad6c7.firebaseapp.com",
    projectId: "publictwin-ad6c7",
    storageBucket: "publictwin-ad6c7.firebasestorage.app",
    messagingSenderId: "151464184627",
    appId: "1:151464184627:web:4de03973466ef510eecc46"
  };

  // =====================================
  // CREATE TOKEN DIALOG HTML
  // =====================================
  
  function createTokenDialog() {
    // Check if dialog already exists
    if (document.getElementById('tokenDialog')) return;
    
    const dialogHTML = `
      <div id="tokenDialog" style="
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.9);
        z-index: 10000;
        justify-content: center;
        align-items: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      ">
        <div style="
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          padding: 40px;
          border-radius: 16px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          max-width: 500px;
          width: 90%;
          text-align: center;
        ">
          <div style="font-size: 48px; margin-bottom: 20px;">🛰️</div>
          <h2 style="color: #5ac; margin: 0 0 10px 0; font-size: 24px;">Cesium Ion Token</h2>
          <p style="color: rgba(255,255,255,0.7); margin: 0 0 25px 0; font-size: 14px; line-height: 1.6;">
            Bitte gib deinen Cesium Ion Access Token ein.<br>
            Du findest ihn unter <a href="https://ion.cesium.com/tokens" target="_blank" style="color: #5ac;">ion.cesium.com/tokens</a>
          </p>
          
          <div id="tokenError" style="
            display: none;
            background: rgba(231, 76, 60, 0.2);
            border: 1px solid #e74c3c;
            color: #e74c3c;
            padding: 10px;
            border-radius: 8px;
            margin-bottom: 15px;
            font-size: 14px;
          "></div>
          
          <input type="text" id="ionTokenInput" placeholder="Dein Cesium Ion Access Token" style="
            width: 100%;
            padding: 15px;
            border: 2px solid rgba(90, 170, 204, 0.3);
            border-radius: 8px;
            background: rgba(0, 0, 0, 0.3);
            color: white;
            font-size: 14px;
            box-sizing: border-box;
            margin-bottom: 20px;
            outline: none;
            transition: border-color 0.3s;
          " onfocus="this.style.borderColor='#5ac'" onblur="this.style.borderColor='rgba(90, 170, 204, 0.3)'">
          
          <div style="display: flex; gap: 10px;">
            <button id="tokenSubmitBtn" style="
              flex: 1;
              padding: 15px 30px;
              background: linear-gradient(135deg, #5ac 0%, #4a9 100%);
              color: white;
              border: none;
              border-radius: 8px;
              font-size: 16px;
              font-weight: 600;
              cursor: pointer;
              transition: transform 0.2s, box-shadow 0.2s;
            " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 5px 20px rgba(90,170,204,0.4)'" 
               onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'">
              ✓ Token speichern
            </button>
          </div>
          
          <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
            <label style="display: flex; align-items: center; justify-content: center; gap: 10px; color: rgba(255,255,255,0.6); font-size: 13px; cursor: pointer;">
              <input type="checkbox" id="rememberToken" checked style="width: 18px; height: 18px; cursor: pointer;">
              Token für zukünftige Besuche speichern
            </label>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', dialogHTML);
    
    // Event Listeners
    document.getElementById('tokenSubmitBtn').addEventListener('click', () => {
      BimAuth.submitToken();
    });
    
    document.getElementById('ionTokenInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        BimAuth.submitToken();
      }
    });
  }

  // =====================================
  // AUTH STATE
  // =====================================
  
  window.BimAuth = {
    currentUser: null,
    initialized: false,
    app: null,
    ionToken: null,
    
    // Initialize Firebase Auth
    init: function() {
      if (this.initialized) {
        console.log('🔐 Auth already initialized');
        return;
      }
      
      if (typeof firebase === 'undefined') {
        console.error('❌ Firebase SDK not loaded!');
        this.showError('Firebase SDK not loaded');
        return;
      }
      
      // Create token dialog
      createTokenDialog();
      
      try {
        if (firebase.apps.length === 0) {
          this.app = firebase.initializeApp(FIREBASE_AUTH_CONFIG);
        } else {
          this.app = firebase.apps[0];
        }
        
        this.initialized = true;
        console.log('✅ Firebase Auth initialized');
        
        firebase.auth().onAuthStateChanged((user) => {
          this.currentUser = user;
          
          if (user) {
            console.log('✅ User logged in:', user.email);
            this.hideLoginScreen();
            this.checkIonToken();
          } else {
            console.log('❌ No user logged in');
            this.showLoginScreen();
            this.hideApp();
          }
        });
        
      } catch (error) {
        console.error('❌ Firebase Auth init error:', error);
        this.showError('Firebase initialization failed: ' + error.message);
      }
    },
    
    // Check for Ion Token
    checkIonToken: function() {
      const savedToken = localStorage.getItem('cesiumIonToken');
      
      if (savedToken) {
        console.log('✅ Ion Token found in localStorage');
        this.ionToken = savedToken;
        this.applyToken(savedToken);
        this.showApp();
        this.updateUserBadge(this.currentUser);
      } else {
        console.log('❓ No Ion Token found, showing dialog...');
        this.showTokenDialog();
      }
    },
    
    // Show Token Dialog
    showTokenDialog: function() {
      const dialog = document.getElementById('tokenDialog');
      if (dialog) {
        dialog.style.display = 'flex';
        document.getElementById('ionTokenInput').focus();
      }
    },
    
    // Hide Token Dialog
    hideTokenDialog: function() {
      const dialog = document.getElementById('tokenDialog');
      if (dialog) {
        dialog.style.display = 'none';
      }
    },
    
    // Submit Token
    submitToken: function() {
      const tokenInput = document.getElementById('ionTokenInput');
      const rememberCheckbox = document.getElementById('rememberToken');
      const token = tokenInput.value.trim();
      
      if (!token) {
        this.showTokenError('Bitte gib einen Token ein');
        return;
      }
      
      if (token.length < 10) {
        this.showTokenError('Token scheint ungültig zu sein');
        return;
      }
      
      // Save token
      this.ionToken = token;
      
      if (rememberCheckbox.checked) {
        localStorage.setItem('cesiumIonToken', token);
        console.log('✅ Ion Token saved to localStorage');
      }
      
      // Apply token and continue
      this.applyToken(token);
      this.hideTokenDialog();
      this.showApp();
      this.updateUserBadge(this.currentUser);
      
      console.log('✅ Ion Token applied successfully');
    },
    
    // Apply Token to Cesium
    applyToken: function(token) {
      if (typeof Cesium !== 'undefined') {
        Cesium.Ion.defaultAccessToken = token;
        console.log('✅ Cesium Ion token set');
      } else {
        // Cesium not loaded yet, set it globally
        window.CESIUM_ION_TOKEN = token;
        console.log('✅ Cesium Ion token stored for later use');
      }
    },
    
    // Show Token Error
    showTokenError: function(message) {
      const errorEl = document.getElementById('tokenError');
      if (errorEl) {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
      }
    },
    
    // Get Ion Token
    getIonToken: function() {
      return this.ionToken || localStorage.getItem('cesiumIonToken');
    },
    
    // Clear Ion Token
    clearIonToken: function() {
      this.ionToken = null;
      localStorage.removeItem('cesiumIonToken');
      console.log('✅ Ion Token cleared');
    },
    
    // Change Ion Token (for settings)
    changeIonToken: function() {
      this.clearIonToken();
      this.showTokenDialog();
    },
    
    // Login with email/password
    login: async function(email, password) {
      if (!this.initialized) {
        this.showError('Auth not initialized');
        return false;
      }
      
      this.showLoginLoading(true);
      this.hideError();
      
      try {
        const userCredential = await firebase.auth().signInWithEmailAndPassword(email, password);
        console.log('✅ Login successful:', userCredential.user.email);
        return true;
        
      } catch (error) {
        console.error('❌ Login error:', error);
        
        let message = 'Login fehlgeschlagen';
        switch(error.code) {
          case 'auth/user-not-found':
            message = 'Benutzer nicht gefunden';
            break;
          case 'auth/wrong-password':
            message = 'Falsches Passwort';
            break;
          case 'auth/invalid-email':
            message = 'Ungültige E-Mail-Adresse';
            break;
          case 'auth/too-many-requests':
            message = 'Zu viele Versuche. Bitte später erneut versuchen.';
            break;
          case 'auth/invalid-credential':
            message = 'Ungültige Anmeldedaten';
            break;
          case 'auth/network-request-failed':
            message = 'Netzwerkfehler. Bitte Verbindung prüfen.';
            break;
        }
        
        this.showError(message);
        return false;
        
      } finally {
        this.showLoginLoading(false);
      }
    },
    
    // Logout
    logout: async function() {
      try {
        await firebase.auth().signOut();
        console.log('✅ Logout successful');
        return true;
      } catch (error) {
        console.error('❌ Logout error:', error);
        return false;
      }
    },
    
    // UI Functions
    showLoginScreen: function() {
      const loginScreen = document.getElementById('loginScreen');
      if (loginScreen) {
        loginScreen.style.display = 'flex';
      }
    },
    
    hideLoginScreen: function() {
      const loginScreen = document.getElementById('loginScreen');
      if (loginScreen) {
        loginScreen.style.display = 'none';
      }
    },
    
    showApp: function() {
      const cesiumContainer = document.getElementById('cesiumContainer');
      const toolbar = document.getElementById('toolbar');
      
      if (cesiumContainer) cesiumContainer.style.display = 'block';
      if (toolbar) toolbar.style.display = 'block';
      
      // Initialize Comments module after login
      setTimeout(() => {
        if (typeof BimViewer !== 'undefined' && typeof BimViewer.initFirebase === 'function') {
          console.log('🔐 Initializing Comments module after login...');
          BimViewer.initFirebase();
        } else {
          setTimeout(() => {
            if (typeof BimViewer !== 'undefined' && typeof BimViewer.initFirebase === 'function') {
              BimViewer.initFirebase();
            }
          }, 500);
        }
      }, 100);
    },
    
    hideApp: function() {
      const cesiumContainer = document.getElementById('cesiumContainer');
      const toolbar = document.getElementById('toolbar');
      
      if (cesiumContainer) cesiumContainer.style.display = 'none';
      if (toolbar) toolbar.style.display = 'none';
      
      document.querySelectorAll('.mode-indicator, .status-indicator, #commentDialog, #infoBoxCustom').forEach(el => {
        if (el.classList.contains('active')) {
          el.classList.remove('active');
        }
      });
    },
    
    showError: function(message) {
      const errorEl = document.getElementById('loginError');
      if (errorEl) {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
      }
    },
    
    hideError: function() {
      const errorEl = document.getElementById('loginError');
      if (errorEl) {
        errorEl.style.display = 'none';
      }
    },
    
    showLoginLoading: function(show) {
      const btn = document.getElementById('loginBtn');
      const spinner = document.getElementById('loginSpinner');
      const btnText = document.getElementById('loginBtnText');
      
      if (btn) btn.disabled = show;
      if (spinner) spinner.style.display = show ? 'inline-block' : 'none';
      if (btnText) btnText.textContent = show ? 'Anmelden...' : 'Anmelden';
    },
    
    updateUserBadge: function(user) {
      const badge = document.getElementById('userBadge');
      const emailSpan = document.getElementById('userEmail');
      
      if (badge && user) {
        badge.style.display = 'flex';
        if (emailSpan) {
          emailSpan.textContent = user.email;
        }
      } else if (badge) {
        badge.style.display = 'none';
      }
    },
    
    getCurrentUser: function() {
      return this.currentUser;
    },
    
    isLoggedIn: function() {
      return this.currentUser !== null;
    },
    
    resetPassword: async function(email) {
      if (!email) {
        this.showError('Bitte E-Mail-Adresse eingeben');
        return false;
      }
      
      try {
        await firebase.auth().sendPasswordResetEmail(email);
        alert('Passwort-Reset E-Mail wurde gesendet!');
        return true;
      } catch (error) {
        console.error('❌ Password reset error:', error);
        
        let message = 'Fehler beim Zurücksetzen';
        switch(error.code) {
          case 'auth/user-not-found':
            message = 'E-Mail-Adresse nicht gefunden';
            break;
          case 'auth/invalid-email':
            message = 'Ungültige E-Mail-Adresse';
            break;
        }
        
        this.showError(message);
        return false;
      }
    }
  };

  // =====================================
  // SETUP LOGIN FORM
  // =====================================
  
  document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;
        
        if (!email || !password) {
          BimAuth.showError('Bitte E-Mail und Passwort eingeben');
          return;
        }
        
        await BimAuth.login(email, password);
      });
    }
    
    setTimeout(() => {
      BimAuth.init();
    }, 100);
  });

  console.log('✅ Firebase Auth module loaded (v1.2 with Ion Token)');
  console.log('💡 Usage:');
  console.log('   - BimAuth.login(email, password)');
  console.log('   - BimAuth.logout()');
  console.log('   - BimAuth.getIonToken()');
  console.log('   - BimAuth.changeIonToken()');
  console.log('   - BimAuth.clearIonToken()');

})();
