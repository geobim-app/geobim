/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// ===============================
// SITE ANALYSIS UI SECTION
// Markup of the "Site Analysis" section (ui.js → createSection('site', …)).
// Buttons carry data-sa actions, inputs data-sa-input; site-analysis.js
// handles them by event delegation and renders #saSiteList.
// ===============================
'use strict';

(function() {

  function getContent() {
    return `
      <div class="modern-group">
        <div class="modern-label">Site</div>
        <div class="sa-btn-row">
          <button type="button" class="modern-btn modern-btn-primary" data-sa="draw-polygon" data-mode="polygon" aria-pressed="false"
                  title="Draw a site polygon: right-click or tap adds points, double right-click or Enter finishes, Esc cancels">
            <i data-lucide="pentagon"></i><span>Polygon</span>
          </button>
          <button type="button" class="modern-btn modern-btn-secondary" data-sa="draw-rectangle" data-mode="rectangle" aria-pressed="false"
                  title="Draw a site rectangle: two corners (right-click or tap)">
            <i data-lucide="square-dashed"></i><span>Rectangle</span>
          </button>
        </div>
        <label class="sa-sr-only" for="saClipSelect">Use a clipping polygon as site</label>
        <select id="saClipSelect" class="modern-select sa-select" title="Use a clipping polygon (Clip panel) as site">
          <option value="">From clipping polygon…</option>
        </select>
      </div>

      <div class="modern-group">
        <label class="modern-label" for="saSource">Height source</label>
        <select id="saSource" class="modern-select sa-select">
          <option value="mapterhorn" selected>Mapterhorn DGM (bare earth)</option>
          <option value="active">Active terrain / Google 3D Tiles</option>
        </select>
        <label class="modern-label" for="saCell">Grid resolution</label>
        <select id="saCell" class="modern-select sa-select">
          <option value="0.5">0.5 m</option>
          <option value="1" selected>1 m</option>
          <option value="2">2 m</option>
          <option value="5">5 m</option>
          <option value="10">10 m</option>
        </select>
      </div>

      <div id="saProgress" class="sa-progress hidden" role="status" aria-live="polite">
        <div class="sa-progress-bar"><span id="saProgressFill" class="sa-progress-fill"></span></div>
        <div class="sa-progress-row">
          <span id="saProgressText" class="sa-progress-text"></span>
          <button type="button" class="modern-btn modern-btn-small" data-sa="cancel" title="Cancel the computation">
            <i data-lucide="x"></i><span>Cancel</span>
          </button>
        </div>
      </div>
      <div id="saStatus" class="sa-status" role="status" aria-live="polite"></div>

      <div class="modern-divider">
        <span class="modern-divider-text">Sites</span>
      </div>
      <div id="saSiteList" class="sa-site-list"></div>

      <div class="modern-divider">
        <span class="modern-divider-text">Profile</span>
      </div>
      <div class="modern-group">
        <button type="button" class="modern-btn modern-btn-secondary" data-sa="draw-line" data-mode="line" aria-pressed="false"
                title="Draw a line for an elevation profile: right-click or tap adds points, double right-click or Enter finishes">
          <i data-lucide="route"></i><span>Elevation profile</span>
        </button>
      </div>

      <div class="modern-hint">
        <strong>Mapterhorn DGM</strong> reads open terrain models directly (bare earth, about 1 m in most of Germany,
        30 m elsewhere), whatever terrain is shown. Heights are orthometric. Sites and layers are saved with a scene (Scenes) and recomputed when it is loaded.
      </div>
    `;
  }

  window.GEOBIM_SITE_UI = {
    getContent: getContent
  };

})();
