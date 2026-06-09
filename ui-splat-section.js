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
// GAUSSIAN SPLATTING UI SECTION
// Section content for the "Gaussian Splats" sidebar tab.
// Inline handlers call BimSplat.* (defined in splat-ui.js),
// which drives the logic API in splat.js. The #splatList container
// is (re)populated by BimSplat.refresh().
// ===============================
'use strict';

(function() {

  function getContent() {
    return `
      <div class="modern-group">
        <div class="modern-label">Quelle</div>
        <input id="splatUrlInput" class="modern-input" type="text"
               placeholder="tileset.json-URL oder Ion-Asset-ID"
               onkeydown="if(event.key==='Enter')BimSplat.loadFromInput()" />
        <label class="splat-check">
          <input type="checkbox" id="splatClampChk" checked /> Auf Gelände setzen
        </label>
        <button class="modern-btn modern-btn-primary" onclick="BimSplat.loadFromInput()">
          <span class="modern-btn-icon">➕</span><span>Splat laden</span>
        </button>
        <button class="modern-btn modern-btn-small" onclick="BimSplat.loadDemo()">
          <i data-lucide="sparkles" style="width:12px;height:12px;margin-right:5px;vertical-align:middle;"></i>
          <span>Demo laden (Wilhelmina)</span>
        </button>
        <button class="modern-btn modern-btn-small" onclick="BimSplat.loadCochem()">
          <i data-lucide="castle" style="width:12px;height:12px;margin-right:5px;vertical-align:middle;"></i>
          <span>Demo laden (Cochem)</span>
        </button>
        <div id="splatStatus" class="splat-status"></div>
      </div>

      <div class="modern-divider">
        <span class="modern-divider-text">Geladene Splats</span>
      </div>

      <div class="modern-group">
        <div id="splatList">
          <div class="splat-empty">Noch keine Splats geladen.</div>
        </div>
      </div>

      <div class="modern-hint">
        <strong>✨ Gaussian Splats</strong> werden als native 3D Tiles geladen
        (glTF <em>KHR_gaussian_splatting</em>).<br>
        <strong>Auf Gelände setzen</strong> korrigiert den Ellipsoid-/Terrain-Höhenversatz.
      </div>
    `;
  }

  window.GEOBIM_SPLAT_UI = {
    getContent: getContent
  };

})();
