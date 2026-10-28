/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
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
        <div class="modern-label">Source</div>
        <input id="splatUrlInput" class="modern-input" type="text"
               placeholder="tileset.json URL or Ion asset ID"
               onkeydown="if(event.key==='Enter')BimSplat.loadFromInput()" />
        <label class="splat-check">
          <input type="checkbox" id="splatClampChk" checked /> Clamp to terrain
        </label>
        <button class="modern-btn modern-btn-primary" onclick="BimSplat.loadFromInput()">
          <span class="modern-btn-icon">➕</span><span>Load splat</span>
        </button>
        <button class="modern-btn modern-btn-small" onclick="BimSplat.loadDemo()">
          <i data-lucide="sparkles" style="width:12px;height:12px;margin-right:5px;vertical-align:middle;"></i>
          <span>Load demo (Wilhelmina)</span>
        </button>
        <button class="modern-btn modern-btn-small" onclick="BimSplat.loadCochem()">
          <i data-lucide="castle" style="width:12px;height:12px;margin-right:5px;vertical-align:middle;"></i>
          <span>Load demo (Cochem)</span>
        </button>
        <div id="splatStatus" class="splat-status"></div>
      </div>

      <div class="modern-divider">
        <span class="modern-divider-text">Loaded splats</span>
      </div>

      <div class="modern-group">
        <div id="splatList">
          <div class="splat-empty">No splats loaded yet.</div>
        </div>
      </div>

      <div class="modern-hint">
        <strong>✨ Gaussian Splats</strong> are loaded as native 3D Tiles
        (glTF <em>KHR_gaussian_splatting</em>).<br>
        <strong>Clamp to terrain</strong> corrects the ellipsoid/terrain height offset.
      </div>
    `;
  }

  window.GEOBIM_SPLAT_UI = {
    getContent: getContent
  };

})();
