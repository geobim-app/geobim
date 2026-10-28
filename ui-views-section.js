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
        <button id="saveCurrentView" class="modern-btn modern-btn-primary">
          <span class="modern-btn-icon">💾</span>
          <span>Save Current View</span>
        </button>
        <label class="modern-check" title="Fly smoothly to a view (≈3s) instead of jumping">
          <input type="checkbox" id="smoothViewChk" /> Smooth transition
        </label>
      </div>

      <div class="modern-hint">
        <strong>1-9</strong> load the view in that slot
      </div>

      <div id="savedViewsList" class="modern-views-list"></div>

      <div class="modern-label view-flight-label">Camera flight</div>
      <div class="modern-group view-flight">
        <select id="flightModeSelect" class="modern-select" aria-label="Flight">
          <option value="orbit">Orbit</option>
          <option value="flyover">Fly over</option>
          <option value="tour">Tour through saved views</option>
        </select>
        <div id="flightTargetRow" class="view-flight-row">
          <span class="view-flight-key">Around</span>
          <select id="flightTargetSelect" class="modern-select" aria-label="Flight centre">
            <option value="view">View centre</option>
          </select>
        </div>
        <div class="view-flight-row">
          <span class="view-flight-key">Duration</span>
          <select id="flightDurationSelect" class="modern-select" aria-label="Flight duration">
            <option value="10">10 s</option>
            <option value="20">20 s</option>
            <option value="30" selected>30 s</option>
            <option value="60">1 min</option>
            <option value="120">2 min</option>
          </select>
        </div>
        <button type="button" id="flightStartBtn" class="modern-btn modern-btn-primary">
          <i data-lucide="play"></i><span>Start flight</span>
        </button>
        <div class="modern-hint">Esc, a click in the view or unloading a model stops the flight.</div>
      </div>
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
