/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

(function() {
  'use strict';

  function getContent() {
    return `
      <div class="modern-group">
        <button id="toggleHideMode" class="modern-btn modern-btn-primary">
          <span class="modern-btn-icon">🙈</span>
          <span>Hide Elements</span>
          <span id="hiddenFeaturesCount" class="modern-badge" style="display: none;">0</span>
        </button>

        <button id="showAllHidden" class="modern-btn modern-btn-secondary">
          <span class="modern-btn-icon">👁️</span>
          <span>Show All Hidden</span>
        </button>
      </div>

      <div class="modern-hint">
        <strong>H</strong> to toggle hide mode • <strong>Shift+H</strong> to show all
      </div>

      <div class="modern-label" style="margin-top: 12px;">Hidden Elements</div>
      <div id="hiddenFeaturesList" class="modern-hidden-list">
        <div class="modern-empty-state">No hidden elements</div>
      </div>
    `;
  }

  function initHandlers() {
    document.getElementById('toggleHideMode')?.addEventListener('click', () => {
      BimViewer.toggleHideMode();
    });

    document.getElementById('showAllHidden')?.addEventListener('click', () => {
      BimViewer.showAllHiddenFeatures();
    });
  }

  window.GEOBIM_VISIBILITY_UI = {
    getContent: getContent,
    initHandlers: initHandlers
  };
})();
