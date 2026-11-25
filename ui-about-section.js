/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// ===============================
// ABOUT & HELP UI SECTION
// Extracted from ui.js — buttons that open the About dialog (optionally on
// the Shortcuts or Feedback tab) and one that restarts the guided tour.
// ===============================
'use strict';

(function() {

  function getContent() {
    return `
      <div class="modern-group">
        <button class="modern-btn modern-btn-primary" onclick="BimViewer.showAboutDialog()">
          <span class="modern-btn-icon"><i data-lucide="info"></i></span>
          <span>About geoBIM.app Viewer</span>
        </button>
        <button class="modern-btn modern-btn-secondary" onclick="GEOBIM_ABOUT_UI.startTour(this)">
          <span class="modern-btn-icon"><i data-lucide="map"></i></span>
          <span>Guided Tour</span>
        </button>
        <button class="modern-btn modern-btn-secondary" onclick="BimViewer.showAboutDialog(); setTimeout(() => { const t = document.querySelector('.about-tab[data-tab=\\'shortcuts\\']'); if(t) t.click(); }, 100);">
          <span class="modern-btn-icon"><i data-lucide="keyboard"></i></span>
          <span>Keyboard Shortcuts</span>
        </button>
        <button class="modern-btn modern-btn-secondary" onclick="BimViewer.showAboutDialog(); setTimeout(() => { const t = document.querySelector('.about-tab[data-tab=\\'feedback\\']'); if(t) t.click(); }, 100);">
          <span class="modern-btn-icon"><i data-lucide="message-square"></i></span>
          <span>Send Feedback</span>
        </button>
      </div>
    `;
  }

  // Panel UI: close this panel first, it would sit under the tour's spotlight
  function startTour(btn) {
    if (btn) btn.blur();
    if (window.BimPanelsUI && BimPanelsUI.active && typeof BimPanelsUI.close === 'function') {
      BimPanelsUI.close('about');
    }
    if (window.BimTour) BimTour.start();
  }

  window.GEOBIM_ABOUT_UI = {
    getContent: getContent,
    startTour: startTour
  };

})();
