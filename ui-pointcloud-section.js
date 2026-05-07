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
// POINT CLOUD UI SECTION
// Extracted from ui.js — section content for the "Point Cloud Settings" sidebar tab.
// All handlers remain inline and call BimViewer.* globals (defined in pointcloud.js).
// ===============================
'use strict';

(function() {

  function getContent() {
    return `
      <div class="modern-group">
        <div class="modern-label">Presets</div>
        <div class="modern-btn-group-3">
          <button class="modern-btn modern-btn-small" onclick="BimViewer.applyPointCloudPreset('quality')">
            <span class="modern-btn-icon">💎</span>
            <span>Quality</span>
          </button>
          <button class="modern-btn modern-btn-small" onclick="BimViewer.applyPointCloudPreset('performance')">
            <span class="modern-btn-icon">⚡</span>
            <span>Speed</span>
          </button>
          <button class="modern-btn modern-btn-small" onclick="BimViewer.applyPointCloudPreset('detailed')">
            <span class="modern-btn-icon">🔍</span>
            <span>Detail</span>
          </button>
        </div>
      </div>

      <div class="modern-divider">
        <span class="modern-divider-text">Color Mode</span>
      </div>

      <div class="modern-group">
        <div class="modern-label">Point Colors</div>
        <select id="colorModeSelect" class="modern-select" onchange="BimViewer.setColorMode(this.value)">
          <option value="rgb" selected>🎨 Original RGB Colors</option>
          <option value="height">📏 Height-based</option>
          <option value="intensity">💡 Intensity-based</option>
          <option value="classification">🏷️ Classification</option>
        </select>
      </div>

      <div class="modern-divider">
        <span class="modern-divider-text">Eye Dome Lighting (EDL)</span>
      </div>

      <div class="modern-group">
        <button id="toggleEDL" class="modern-toggle-btn active" onclick="BimViewer.setEyeDomeLighting(!BimViewer.pointCloudSettings.edlEnabled)" title="Eye Dome Lighting - enhances depth perception">
          <span class="modern-btn-icon">💡</span>
          <span>Enable EDL</span>
        </button>

        <div class="modern-slider-group">
          <label class="modern-label-small">EDL Strength</label>
          <input type="range" id="edlStrengthSlider" min="0" max="3" step="0.1" value="1"
                 oninput="BimViewer.setEDLStrength(this.value); document.getElementById('edlStrengthValue').textContent = parseFloat(this.value).toFixed(1)"
                 class="modern-slider-small">
          <span id="edlStrengthValue" class="modern-value-small">1.0</span>
        </div>

        <div class="modern-slider-group">
          <label class="modern-label-small">EDL Radius</label>
          <input type="range" id="edlRadiusSlider" min="0.5" max="3" step="0.1" value="1"
                 oninput="BimViewer.setEDLRadius(this.value); document.getElementById('edlRadiusValue').textContent = parseFloat(this.value).toFixed(1)"
                 class="modern-slider-small">
          <span id="edlRadiusValue" class="modern-value-small">1.0</span>
        </div>
      </div>

      <div class="modern-divider">
        <span class="modern-divider-text">Point Appearance</span>
      </div>

      <div class="modern-group">
        <div class="modern-slider-group">
          <label class="modern-label-small">Point Size</label>
          <input type="range" id="pointSizeSlider" min="0.5" max="10" step="0.5" value="2"
                 oninput="BimViewer.setPointSize(this.value); document.getElementById('pointSizeValue').textContent = parseFloat(this.value).toFixed(1)"
                 class="modern-slider-small"
                 title="Adjust point size">
          <span id="pointSizeValue" class="modern-value-small">2.0</span>
        </div>
      </div>

      <div class="modern-divider">
        <span class="modern-divider-text">Distance Attenuation</span>
      </div>

      <div class="modern-group">
        <button id="toggleAttenuation" class="modern-toggle-btn active" onclick="BimViewer.setAttenuation(!BimViewer.pointCloudSettings.attenuationEnabled)" title="Scale points by distance">
          <span class="modern-btn-icon">📐</span>
          <span>Enable Attenuation</span>
        </button>

        <div class="modern-slider-group">
          <label class="modern-label-small">Maximum Attenuation</label>
          <input type="range" id="maxAttenuationSlider" min="1" max="10" step="0.5" value="1"
                 oninput="BimViewer.setMaximumAttenuation(this.value); document.getElementById('maxAttenuationValue').textContent = this.value == 1 ? 'None' : parseFloat(this.value).toFixed(1)"
                 class="modern-slider-small">
          <span id="maxAttenuationValue" class="modern-value-small">None</span>
        </div>
      </div>

      <div class="modern-divider">
        <span class="modern-divider-text">Advanced</span>
      </div>

      <div class="modern-group">
        <div class="modern-slider-group">
          <label class="modern-label-small">Geometric Error Scale</label>
          <input type="range" id="geometricErrorSlider" min="0.5" max="3" step="0.1" value="1"
                 oninput="BimViewer.setGeometricErrorScale(this.value); document.getElementById('geometricErrorValue').textContent = parseFloat(this.value).toFixed(1)"
                 class="modern-slider-small">
          <span id="geometricErrorValue" class="modern-value-small">1.0</span>
        </div>

        <button id="toggleBackFaceCulling" class="modern-toggle-btn" onclick="BimViewer.setBackFaceCulling(!BimViewer.pointCloudSettings.backFaceCulling)">
          <span class="modern-btn-icon">🔄</span>
          <span>Back Face Culling</span>
        </button>

        <button class="modern-btn modern-btn-secondary" onclick="BimViewer.resetPointCloudSettings()">
          <span class="modern-btn-icon">🔄</span>
          <span>Reset to Defaults</span>
        </button>
      </div>

      <div class="modern-hint">
        <strong>🎨 RGB Colors</strong> are preserved by default<br>
        <strong>💡 EDL</strong> improves depth perception<br>
        <strong>📐 Attenuation</strong> adjusts point size by distance<br>
        <strong>⚙️ Geometric Error</strong> controls detail level
      </div>
    `;
  }

  window.GEOBIM_POINTCLOUD_UI = {
    getContent: getContent
  };

})();
