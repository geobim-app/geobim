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
// ABOUT & FEEDBACK MODULE v1.0
// About dialog, keyboard shortcuts, feature list, feedback form (Firestore)
// ===============================
'use strict';

(function() {

  console.log('Loading About & Feedback Module v1.0...');

  const FEEDBACK_COLLECTION = 'feedback';
  const APP_VERSION = '1.10.0';

  // =====================================
  // ABOUT DIALOG
  // =====================================

  BimViewer.showAboutDialog = function() {
    // Remove existing dialog if open
    const existing = document.getElementById('aboutDialog');
    if (existing) { existing.remove(); }

    const dialog = document.createElement('div');
    dialog.id = 'aboutDialog';
    dialog.className = 'about-overlay';
    dialog.innerHTML = `
      <div class="about-modal">
        <div class="about-modal-header">
          <div class="about-modal-tabs">
            <button class="about-tab active" data-tab="about">About</button>
            <button class="about-tab" data-tab="features">Features</button>
            <button class="about-tab" data-tab="shortcuts">Shortcuts</button>
            <button class="about-tab" data-tab="feedback">Feedback</button>
          </div>
          <button class="about-close-btn" onclick="BimViewer.closeAboutDialog()">✕</button>
        </div>

        <div class="about-modal-body">

          <!-- ABOUT TAB -->
          <div class="about-tab-content active" data-tab="about">
            <div class="about-logo-row">
              <img src="logo/logo_teal_transparent.svg" alt="geobim.app" class="about-logo">
              <div>
                <div class="about-app-name">geobim.app</div>
                <div class="about-version">Version ${APP_VERSION}</div>
              </div>
            </div>
            <p class="about-tagline">BIM x GIS = Geospatial Intelligence</p>
            <p class="about-desc">Stream massive 3D BIM and geospatial data directly in the browser. Place your IFC & Revit models in their real geographic context.</p>

            <div class="about-info-grid">
              <div class="about-info-item">
                <span class="about-info-label">License</span>
                <span class="about-info-value">BSL 1.1 (Non-commercial)</span>
              </div>
              <div class="about-info-item">
                <span class="about-info-label">Change Date</span>
                <span class="about-info-value">2030-03-01 → MIT</span>
              </div>
              <div class="about-info-item">
                <span class="about-info-label">Contact</span>
                <span class="about-info-value">info@geobim.app</span>
              </div>
              <div class="about-info-item">
                <span class="about-info-label">Powered by</span>
                <span class="about-info-value">CesiumJS · Firebase · 3D Tiles</span>
              </div>
            </div>
            <p class="about-copyright">© 2026 Christof Lorenz. All rights reserved.</p>
            <button class="about-tour-btn" onclick="BimViewer.closeAboutDialog();setTimeout(function(){BimTour.start()},300);">
              Take a guided tour
            </button>
          </div>

          <!-- FEATURES TAB -->
          <div class="about-tab-content" data-tab="features">
            <div class="about-feature-list">
              <div class="about-feature-item">
                <span class="about-feature-icon">🏗️</span>
                <div>
                  <strong>IFC & Revit Models</strong>
                  <span>Load BIM models as 3D Tiles via Cesium Ion</span>
                </div>
              </div>
              <div class="about-feature-item">
                <span class="about-feature-icon">☁️</span>
                <div>
                  <strong>Point Clouds</strong>
                  <span>LAS/LAZ point clouds with EDL and color modes</span>
                </div>
              </div>
              <div class="about-feature-item">
                <span class="about-feature-icon">✨</span>
                <div>
                  <strong>3D Gaussian Splatting</strong>
                  <span>Photorealistic splat captures as native 3D Tiles, with move/scale/rotate gizmo</span>
                </div>
              </div>
              <div class="about-feature-item">
                <span class="about-feature-icon">🔍</span>
                <div>
                  <strong>IFC / Revit Filter</strong>
                  <span>Filter 30+ entity types by category (walls, columns, MEP...)</span>
                </div>
              </div>
              <div class="about-feature-item">
                <span class="about-feature-icon">📏</span>
                <div>
                  <strong>Measurement Tools</strong>
                  <span>Distance, area and height measurements</span>
                </div>
              </div>
              <div class="about-feature-item">
                <span class="about-feature-icon">✂️</span>
                <div>
                  <strong>Clipping Planes</strong>
                  <span>Draw polygons to clip buildings and terrain</span>
                </div>
              </div>
              <div class="about-feature-item">
                <span class="about-feature-icon">💬</span>
                <div>
                  <strong>3D Annotations</strong>
                  <span>Place comments with categories, priorities and inspection data</span>
                </div>
              </div>
              <div class="about-feature-item">
                <span class="about-feature-icon">🗺️</span>
                <div>
                  <strong>Layer Manager</strong>
                  <span>Basemaps, terrain, imagery overlays, WMS/WMTS/WFS services</span>
                </div>
              </div>
              <div class="about-feature-item">
                <span class="about-feature-icon">📡</span>
                <div>
                  <strong>IoT / SensorThings</strong>
                  <span>Live sensor data via OGC SensorThings API + MQTT</span>
                </div>
              </div>
              <div class="about-feature-item">
                <span class="about-feature-icon">☀️</span>
                <div>
                  <strong>Advanced Lighting</strong>
                  <span>Sun simulation, shadows, IBL, tone mapping, HBAO</span>
                </div>
              </div>
              <div class="about-feature-item">
                <span class="about-feature-icon">📷</span>
                <div>
                  <strong>Saved Views</strong>
                  <span>Save and restore camera positions, with optional smooth fly-to transition</span>
                </div>
              </div>
              <div class="about-feature-item">
                <span class="about-feature-icon">📍</span>
                <div>
                  <strong>Asset Placement</strong>
                  <span>Move &amp; rotate 3D Tiles and GLB models in place (Transform mode, X)</span>
                </div>
              </div>
              <div class="about-feature-item">
                <span class="about-feature-icon">🚶</span>
                <div>
                  <strong>Walk Mode</strong>
                  <span>First-person navigation with WASD, mouse or Xbox controller</span>
                </div>
              </div>
              <div class="about-feature-item">
                <span class="about-feature-icon">🎮</span>
                <div>
                  <strong>Third-Person Mode</strong>
                  <span>Animated character with Unreal Engine-style controls</span>
                </div>
              </div>
              <div class="about-feature-item">
                <span class="about-feature-icon">🌬️</span>
                <div>
                  <strong>WEA Shadow Analysis</strong>
                  <span>Wind turbine shadow flicker simulation</span>
                </div>
              </div>
              <div class="about-feature-item">
                <span class="about-feature-icon">↔️</span>
                <div>
                  <strong>Split View</strong>
                  <span>Side-by-side comparison of two tilesets</span>
                </div>
              </div>
              <div class="about-feature-item">
                <span class="about-feature-icon">🌐</span>
                <div>
                  <strong>Geoid / Coordinate Tools</strong>
                  <span>EGM2008 geoid lookup, coordinate display</span>
                </div>
              </div>
              <div class="about-feature-item">
                <span class="about-feature-icon">🔑</span>
                <div>
                  <strong>Cesium Ion Connect</strong>
                  <span>Link your own Ion account to load private assets</span>
                </div>
              </div>
              <div class="about-feature-item">
                <span class="about-feature-icon">🎬</span>
                <div>
                  <strong>Post-Processing Effects</strong>
                  <span>Bloom, lens flare, vignette, color grading, Cinematic preset</span>
                </div>
              </div>
            </div>
          </div>

          <!-- SHORTCUTS TAB -->
          <div class="about-tab-content" data-tab="shortcuts">
            <div class="about-shortcut-list">
              <div class="about-shortcut-group-title">Navigation</div>
              <div class="about-shortcut"><kbd>Left-click + drag</kbd><span>Rotate</span></div>
              <div class="about-shortcut"><kbd>Right-click + drag</kbd><span>Zoom</span></div>
              <div class="about-shortcut"><kbd>Middle-click + drag</kbd><span>Pan</span></div>
              <div class="about-shortcut"><kbd>Scroll</kbd><span>Zoom in/out</span></div>

              <div class="about-shortcut-group-title">Walk Mode</div>
              <div class="about-shortcut"><kbd>G</kbd><span>Toggle first-person mode</span></div>
              <div class="about-shortcut"><kbd>V</kbd><span>Switch to third-person view</span></div>
              <div class="about-shortcut"><kbd>T</kbd><span>Set Player Start (spawn point)</span></div>
              <div class="about-shortcut"><kbd>WASD</kbd><span>Move (walk mode)</span></div>
              <div class="about-shortcut"><kbd>Shift</kbd><span>Sprint</span></div>
              <div class="about-shortcut"><kbd>ESC</kbd><span>Exit walk mode</span></div>

              <div class="about-shortcut-group-title">Tools</div>
              <div class="about-shortcut"><kbd>M</kbd><span>Toggle sidebar</span></div>
              <div class="about-shortcut"><kbd>H</kbd><span>Toggle hide mode (click to hide elements)</span></div>
              <div class="about-shortcut"><kbd>Shift + H</kbd><span>Restore all hidden elements</span></div>
              <div class="about-shortcut"><kbd>C</kbd><span>Toggle comment mode</span></div>
              <div class="about-shortcut"><kbd>X</kbd><span>Transform mode (move/rotate assets)</span></div>
              <div class="about-shortcut"><kbd>ESC</kbd><span>Exit current mode / close dialog</span></div>

              <div class="about-shortcut-group-title">Selection</div>
              <div class="about-shortcut"><kbd>Left-click</kbd><span>Select element (show properties)</span></div>
              <div class="about-shortcut"><kbd>Right-click</kbd><span>Place comment (in comment mode)</span></div>
            </div>
          </div>

          <!-- FEEDBACK TAB -->
          <div class="about-tab-content" data-tab="feedback">
            <p class="about-feedback-intro">We appreciate your feedback! Let us know about bugs, feature requests, or general impressions.</p>

            <div class="about-form-group">
              <label class="about-form-label">Type</label>
              <select id="feedbackType" class="about-form-select">
                <option value="bug">🐛 Bug Report</option>
                <option value="feature">💡 Feature Request</option>
                <option value="general" selected>💬 General Feedback</option>
                <option value="question">❓ Question</option>
              </select>
            </div>

            <div class="about-form-group">
              <label class="about-form-label">Subject</label>
              <input type="text" id="feedbackSubject" class="about-form-input" placeholder="Brief summary...">
            </div>

            <div class="about-form-group">
              <label class="about-form-label">Message</label>
              <textarea id="feedbackMessage" class="about-form-textarea" placeholder="Describe your feedback in detail..." rows="5"></textarea>
            </div>

            <div class="about-form-group">
              <label class="about-form-label">Your Email (optional)</label>
              <input type="email" id="feedbackEmail" class="about-form-input" placeholder="For follow-up questions...">
            </div>

            <div id="feedbackStatus" class="about-feedback-status" style="display: none;"></div>

            <button id="feedbackSubmitBtn" class="about-submit-btn" onclick="BimViewer.submitFeedback()">
              Send Feedback
            </button>
          </div>

        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    // Tab switching
    dialog.querySelectorAll('.about-tab').forEach(tab => {
      tab.addEventListener('click', function() {
        const tabName = this.dataset.tab;
        dialog.querySelectorAll('.about-tab').forEach(t => t.classList.remove('active'));
        dialog.querySelectorAll('.about-tab-content').forEach(c => c.classList.remove('active'));
        this.classList.add('active');
        dialog.querySelector(`.about-tab-content[data-tab="${tabName}"]`).classList.add('active');
      });
    });

    // Close on overlay click
    dialog.addEventListener('click', function(e) {
      if (e.target === dialog) { BimViewer.closeAboutDialog(); }
    });

    // Close on ESC
    dialog._escHandler = function(e) {
      if (e.key === 'Escape') { BimViewer.closeAboutDialog(); }
    };
    document.addEventListener('keydown', dialog._escHandler);

    // Animate in
    requestAnimationFrame(() => { dialog.classList.add('visible'); });
  };

  BimViewer.closeAboutDialog = function() {
    const dialog = document.getElementById('aboutDialog');
    if (!dialog) return;
    if (dialog._escHandler) { document.removeEventListener('keydown', dialog._escHandler); }
    dialog.classList.remove('visible');
    setTimeout(() => { dialog.remove(); }, 200);
  };

  // =====================================
  // FEEDBACK SUBMISSION (Firestore)
  // =====================================

  BimViewer.submitFeedback = async function() {
    const type = document.getElementById('feedbackType')?.value || 'general';
    const subject = document.getElementById('feedbackSubject')?.value?.trim();
    const message = document.getElementById('feedbackMessage')?.value?.trim();
    const email = document.getElementById('feedbackEmail')?.value?.trim();
    const statusEl = document.getElementById('feedbackStatus');
    const submitBtn = document.getElementById('feedbackSubmitBtn');

    // Validation
    if (!message) {
      showFeedbackStatus('Please enter a message.', 'error');
      return;
    }

    // Disable button
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending...';
    }

    try {
      const db = BimAuth.getFirebaseDb();
      if (!db) {
        throw new Error('Firebase not available');
      }

      const feedbackData = {
        type: type,
        subject: subject || '(no subject)',
        message: message,
        email: email || null,
        userAgent: navigator.userAgent,
        screenSize: window.innerWidth + 'x' + window.innerHeight,
        appVersion: APP_VERSION,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        status: 'new'
      };

      // Add authenticated user info if available
      const user = BimAuth.getCurrentUser();
      if (user && user.email) {
        feedbackData.userEmail = user.email;
      }

      await db.collection(FEEDBACK_COLLECTION).add(feedbackData);

      showFeedbackStatus('Thank you! Your feedback has been submitted.', 'success');

      // Reset form
      if (document.getElementById('feedbackSubject')) document.getElementById('feedbackSubject').value = '';
      if (document.getElementById('feedbackMessage')) document.getElementById('feedbackMessage').value = '';
      if (document.getElementById('feedbackEmail')) document.getElementById('feedbackEmail').value = '';

      console.log('Feedback submitted to Firestore');

    } catch (error) {
      console.error('Failed to submit feedback:', error);
      showFeedbackStatus('Failed to send feedback. Please try again or email info@geobim.app.', 'error');
    }

    // Re-enable button
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send Feedback';
    }
  };

  function showFeedbackStatus(msg, type) {
    const el = document.getElementById('feedbackStatus');
    if (!el) return;
    el.textContent = msg;
    el.className = 'about-feedback-status ' + type;
    el.style.display = 'block';
    if (type === 'success') {
      setTimeout(() => { el.style.display = 'none'; }, 5000);
    }
  }

  console.log('About & Feedback Module loaded');

})();
