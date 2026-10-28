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
        <button id="selectAllRevit" class="modern-btn modern-btn-secondary">
          <span class="modern-btn-icon">✅</span>
          <span>Select All</span>
        </button>
        <button id="deselectAllRevit" class="modern-btn modern-btn-secondary">
          <span class="modern-btn-icon">❌</span>
          <span>Deselect All</span>
        </button>
      </div>

      <div id="revitFiltersList" class="modern-ifc-filters">
        <!-- Will be populated dynamically -->
      </div>
    `;
  }

  function initHandlers() {
    document.getElementById('selectAllRevit')?.addEventListener('click', () => {
      BimViewer.selectAllRevitCategories();
    });

    document.getElementById('deselectAllRevit')?.addEventListener('click', () => {
      BimViewer.deselectAllRevitCategories();
    });
  }

  window.GEOBIM_REVIT_UI = {
    getContent: getContent,
    initHandlers: initHandlers
  };
})();
