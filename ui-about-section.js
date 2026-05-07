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
// ABOUT & HELP UI SECTION
// Extracted from ui.js — three buttons that all open the About dialog,
// optionally pre-selecting the Shortcuts or Feedback tab.
// ===============================
'use strict';

(function() {

  function getContent() {
    return `
      <div class="modern-group">
        <button class="modern-btn modern-btn-primary" onclick="BimViewer.showAboutDialog()">
          <span class="modern-btn-icon">ℹ️</span>
          <span>About geobim.app</span>
        </button>
        <button class="modern-btn modern-btn-secondary" onclick="BimViewer.showAboutDialog(); setTimeout(() => { const t = document.querySelector('.about-tab[data-tab=\\'shortcuts\\']'); if(t) t.click(); }, 100);">
          <span class="modern-btn-icon">⌨️</span>
          <span>Keyboard Shortcuts</span>
        </button>
        <button class="modern-btn modern-btn-secondary" onclick="BimViewer.showAboutDialog(); setTimeout(() => { const t = document.querySelector('.about-tab[data-tab=\\'feedback\\']'); if(t) t.click(); }, 100);">
          <span class="modern-btn-icon">💬</span>
          <span>Send Feedback</span>
        </button>
      </div>
    `;
  }

  window.GEOBIM_ABOUT_UI = {
    getContent: getContent
  };

})();
