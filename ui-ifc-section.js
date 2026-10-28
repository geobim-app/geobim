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
        <button id="selectAllIFC" class="modern-btn modern-btn-secondary">
          <span class="modern-btn-icon">✅</span>
          <span>Select All</span>
        </button>
        <button id="deselectAllIFC" class="modern-btn modern-btn-secondary">
          <span class="modern-btn-icon">❌</span>
          <span>Deselect All</span>
        </button>
      </div>

      <div id="ifcFiltersList" class="modern-ifc-filters">
        <!-- Will be populated dynamically -->
      </div>
    `;
  }

  function initHandlers() {
    document.getElementById('selectAllIFC')?.addEventListener('click', () => {
      BimViewer.selectAllIFCTypes();
    });

    document.getElementById('deselectAllIFC')?.addEventListener('click', () => {
      BimViewer.deselectAllIFCTypes();
    });
  }

  window.GEOBIM_IFC_UI = {
    getContent: getContent,
    initHandlers: initHandlers
  };
})();
