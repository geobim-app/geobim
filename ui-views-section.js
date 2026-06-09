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

(function() {
  'use strict';

  function getContent() {
    return `
      <div class="modern-group">
        <button id="saveCurrentView" class="modern-btn modern-btn-primary">
          <span class="modern-btn-icon">💾</span>
          <span>Save Current View</span>
        </button>
        <label class="modern-check" title="Fly smoothly to a view (≈3s) instead of jumping">
          <input type="checkbox" id="smoothViewChk" /> Smooth transition
        </label>
      </div>

      <div class="modern-hint">
        <strong>Ctrl+1-9</strong> to save • <strong>1-9</strong> to load
      </div>

      <div id="savedViewsList" class="modern-views-list"></div>
    `;
  }

  function initHandlers() {
    document.getElementById('saveCurrentView')?.addEventListener('click', () => {
      BimViewer.saveView();
    });
    // Optional smooth camera flight between saved views (off by default —
    // snap stays the default). Read by BimViewer.loadView (features.js).
    document.getElementById('smoothViewChk')?.addEventListener('change', (e) => {
      BimViewer.smoothViewTransition = e.target.checked;
    });
  }

  window.GEOBIM_VIEWS_UI = {
    getContent: getContent,
    initHandlers: initHandlers
  };
})();
