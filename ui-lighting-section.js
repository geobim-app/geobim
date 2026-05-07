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
// LIGHTING UI SECTION
// Extracted from ui.js — sidebar tab for dynamic lighting (sun/shadows/AO).
// Owns both the HTML content and the listener wiring for the lighting controls.
// initHandlers() is invoked from BimViewerUI.initEventHandlers after the toolbar
// is built, mirroring the inspection.js / GEOBIM_INSPECTION pattern.
// ===============================
'use strict';

(function() {

  function getContent() {
    return `
      <div class="modern-group">
        <button id="toggleLightingBtn" class="modern-toggle-btn" title="Enable dynamic time-of-day lighting">
          <span class="modern-btn-icon">🌅</span>
          <span>Enable Lighting</span>
        </button>
      </div>

      <div id="lightingControlsContainer" style="display: none;">
        <div class="modern-group">
          <div class="modern-label">Time of Day</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 4px;">
            <button class="modern-btn modern-btn-small time-preset-btn" data-time="dawn" title="06:00">🌄</button>
            <button class="modern-btn modern-btn-small time-preset-btn" data-time="morning" title="09:00">🌞</button>
            <button class="modern-btn modern-btn-small time-preset-btn active" data-time="noon" title="12:00">☀️</button>
            <button class="modern-btn modern-btn-small time-preset-btn" data-time="afternoon" title="15:00">🌤️</button>
            <button class="modern-btn modern-btn-small time-preset-btn" data-time="sunset" title="18:00">🌇</button>
            <button class="modern-btn modern-btn-small time-preset-btn" data-time="dusk" title="20:00">🌆</button>
            <button class="modern-btn modern-btn-small time-preset-btn" data-time="night" title="22:00">🌙</button>
            <button class="modern-btn modern-btn-small time-preset-btn" data-time="midnight" title="00:00">🌃</button>
          </div>
        </div>

        <div class="modern-group">
          <div class="modern-label">Shadows</div>
          <button id="toggleShadowsBtn" class="modern-toggle-btn">
            <span class="modern-btn-icon">🌑</span>
            <span>Enable Shadows</span>
          </button>
        </div>

        <div class="modern-group">
          <div class="modern-label">Ambient Occlusion (HBAO)</div>
          <button id="toggleAOBtn" class="modern-toggle-btn" onclick="
            var ao = BimViewer.viewer.scene.postProcessStages.ambientOcclusion;
            ao.enabled = !ao.enabled;
            this.classList.toggle('active');
            this.querySelector('span:last-child').textContent = ao.enabled ? 'AO Enabled' : 'Enable AO';
          ">
            <span class="modern-btn-icon">🔲</span>
            <span>Enable AO</span>
          </button>
        </div>
      </div>

      <div class="modern-hint">
        <strong>💡 Tip:</strong> Enable lighting for realistic sun + shadows. AO adds depth to building interiors.
      </div>
    `;
  }

  function initHandlers() {
    document.getElementById('toggleLightingBtn')?.addEventListener('click', function() {
      if (typeof BimViewer.enableDynamicLighting !== 'function') {
        BimViewer.updateStatus('Lighting module not loaded', 'error');
        return;
      }

      const isEnabled = BimViewer.lighting?.enabled;
      if (isEnabled) {
        BimViewer.enableDynamicLighting(false);
        this.classList.remove('active');
        this.innerHTML = '<span class="modern-btn-icon">🌅</span><span>Enable Lighting</span>';
        document.getElementById('lightingControlsContainer').style.display = 'none';
      } else {
        BimViewer.enableDynamicLighting(true);
        this.classList.add('active');
        this.innerHTML = '<span class="modern-btn-icon">🌅</span><span>Lighting ON</span>';
        document.getElementById('lightingControlsContainer').style.display = 'block';
      }
    });

    document.querySelectorAll('.time-preset-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.time-preset-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        const time = this.dataset.time;
        if (typeof BimViewer.setPresetTime === 'function') {
          BimViewer.setPresetTime(time);
        }
      });
    });

    document.getElementById('toggleShadowsBtn')?.addEventListener('click', function() {
      if (!BimViewer.viewer) return;
      const shadowMap = BimViewer.viewer.scene.shadowMap;
      shadowMap.enabled = !shadowMap.enabled;
      this.classList.toggle('active');
      if (shadowMap.enabled) {
        this.innerHTML = '<span class="modern-btn-icon">🌑</span><span>Shadows ON</span>';
      } else {
        this.innerHTML = '<span class="modern-btn-icon">🌑</span><span>Enable Shadows</span>';
      }
    });
  }

  window.GEOBIM_LIGHTING_UI = {
    getContent: getContent,
    initHandlers: initHandlers
  };

})();
