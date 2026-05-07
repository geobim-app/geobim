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
