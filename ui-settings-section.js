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
// SETTINGS UI SECTION
// Extracted from ui.js — sidebar tab for performance, post-processing,
// silhouette, ambient occlusion, IBL, and underground view.
// Owns both the HTML content and the listener wiring including IBL state restore.
// ===============================
'use strict';

(function() {

  function getContent() {
    return `
      <div class="modern-group">
        <div class="modern-label">Performance Preset</div>
        <select id="performancePreset" class="modern-select">
          <option value="PERFORMANCE" selected>⚡ Performance</option>
          <option value="BALANCED">⚖️ Balanced</option>
          <option value="QUALITY">💎 Quality</option>
          <option value="ULTRA">🌟 Ultra</option>
        </select>
      </div>

      <div class="modern-group">
        <div class="modern-label">Globe Transparency</div>
        <button id="toggleGlobeTransparency" class="modern-toggle-btn">
          <span class="modern-btn-icon">🌐</span>
          <span>Enable Transparency</span>
        </button>

        <div id="globeTransparencyControls" style="display: none;">
          <div class="modern-slider-group">
            <label class="modern-label-small">Alpha</label>
            <input type="range" id="globeAlphaSlider" min="0" max="1" step="0.1" value="0.5" class="modern-slider-small">
            <span id="globeAlphaValue" class="modern-value-small">50%</span>
          </div>
        </div>
      </div>

      <div class="modern-group">
        <div class="modern-label">Anti-Aliasing</div>
        <button id="toggleFXAA" class="modern-toggle-btn">
          <span class="modern-btn-icon">✨</span>
          <span>FXAA</span>
        </button>
      </div>

      <div class="modern-group">
        <div class="modern-label">Tone Mapping</div>
        <button id="toggleToneMapper" class="modern-toggle-btn active">
          <span class="modern-btn-icon">🎨</span>
          <span>PBR Neutral</span>
        </button>
      </div>

      <div class="modern-group">
        <div class="modern-label">Silhouette Selection</div>
        <button id="toggleSilhouette" class="modern-toggle-btn">
          <span class="modern-btn-icon">🔲</span>
          <span>Enable Silhouette</span>
        </button>

        <div id="silhouetteControls" style="display: none; margin-top: 8px;">
          <div class="modern-slider-group">
            <label class="modern-label-small">Strength</label>
            <input type="range" id="silhouetteStrengthSlider" min="0.01" max="0.05" step="0.005" value="0.025" class="modern-slider-small">
            <span id="silhouetteStrengthValue" class="modern-value-small">0.025</span>
          </div>

          <div class="modern-label-small" style="margin-top: 8px;">Color</div>
          <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px;">
            <button class="modern-icon-btn silhouette-color-btn active" data-color="#FFFF00" style="background: #FFFF00; width: 28px; height: 28px; border-radius: 50%;" title="Yellow"></button>
            <button class="modern-icon-btn silhouette-color-btn" data-color="#00FF00" style="background: #00FF00; width: 28px; height: 28px; border-radius: 50%;" title="Green"></button>
            <button class="modern-icon-btn silhouette-color-btn" data-color="#00FFFF" style="background: #00FFFF; width: 28px; height: 28px; border-radius: 50%;" title="Cyan"></button>
            <button class="modern-icon-btn silhouette-color-btn" data-color="#FF6600" style="background: #FF6600; width: 28px; height: 28px; border-radius: 50%;" title="Orange"></button>
            <button class="modern-icon-btn silhouette-color-btn" data-color="#FF0000" style="background: #FF0000; width: 28px; height: 28px; border-radius: 50%;" title="Red"></button>
            <button class="modern-icon-btn silhouette-color-btn" data-color="#FF00FF" style="background: #FF00FF; width: 28px; height: 28px; border-radius: 50%;" title="Magenta"></button>
          </div>
        </div>
      </div>

      <div class="modern-group">
        <div class="modern-label">Ambient Occlusion</div>
        <button id="toggleAO" class="modern-toggle-btn">
          <span class="modern-btn-icon">🌑</span>
          <span>Enable SSAO</span>
        </button>

        <div id="aoControls" style="display: none; margin-top: 8px;">
          <button id="toggleAOOnly" class="modern-toggle-btn" style="margin-bottom: 8px;">
            <span class="modern-btn-icon">👁️</span>
            <span>AO Only (Debug)</span>
          </button>

          <div class="modern-slider-group">
            <label class="modern-label-small">Intensity</label>
            <input type="range" id="aoIntensitySlider" min="0.5" max="10" step="0.1" value="3.0" class="modern-slider-small">
            <span id="aoIntensityValue" class="modern-value-small">3.0</span>
          </div>
          <div class="modern-slider-group">
            <label class="modern-label-small">Bias</label>
            <input type="range" id="aoBiasSlider" min="0" max="1" step="0.01" value="0.1" class="modern-slider-small">
            <span id="aoBiasValue" class="modern-value-small">0.10</span>
          </div>
          <div class="modern-slider-group">
            <label class="modern-label-small">Length Cap</label>
            <input type="range" id="aoLengthCapSlider" min="0.01" max="1" step="0.01" value="0.26" class="modern-slider-small">
            <span id="aoLengthCapValue" class="modern-value-small">0.26</span>
          </div>
          <div class="modern-slider-group">
            <label class="modern-label-small">Directions</label>
            <input type="range" id="aoDirectionSlider" min="1" max="32" step="1" value="8" class="modern-slider-small">
            <span id="aoDirectionValue" class="modern-value-small">8</span>
          </div>
          <div class="modern-slider-group">
            <label class="modern-label-small">Steps</label>
            <input type="range" id="aoStepSlider" min="1" max="64" step="1" value="32" class="modern-slider-small">
            <span id="aoStepValue" class="modern-value-small">32</span>
          </div>
        </div>
      </div>

      <div class="modern-group">
        <div class="modern-label">Image-Based Lighting (IBL)</div>
        <button id="toggleIBL" class="modern-toggle-btn active">
          <span class="modern-btn-icon">🌅</span>
          <span>IBL Enabled</span>
        </button>
        <button id="toggleIBLMode" class="modern-toggle-btn" onclick="BimViewer.setIBLMode(BimViewer.ibl.mode === 'dynamic' ? 'static' : 'dynamic')">
          <span class="modern-btn-icon">🔄</span>
          <span>Dynamic</span>
        </button>

        <div id="iblControls" style="margin-top: 8px;">
          <div class="modern-slider-group">
            <label class="modern-label-small">Diffus</label>
            <input type="range" id="iblDiffuseSlider" min="0" max="1" step="0.05" value="1.0" class="modern-slider-small">
            <span id="iblDiffuseValue" class="modern-value-small">1.00</span>
          </div>
          <div class="modern-slider-group">
            <label class="modern-label-small">Spiegelung</label>
            <input type="range" id="iblSpecularSlider" min="0" max="1" step="0.05" value="1.0" class="modern-slider-small">
            <span id="iblSpecularValue" class="modern-value-small">1.00</span>
          </div>
        </div>
      </div>

      <div class="modern-group">
        <div class="modern-label">Advanced</div>
        <button id="toggleUndergroundView" class="modern-toggle-btn">
          <span class="modern-btn-icon">🕳️</span>
          <span>Underground Mode</span>
        </button>
      </div>
    `;
  }

  function initHandlers() {
    document.getElementById('performancePreset')?.addEventListener('change', (e) => {
      const preset = CONFIG.performance.presets[e.target.value];
      if (preset) {
        BimViewer.applyPerformanceSettings(preset);
        BimViewer.updateStatus(`Performance: ${preset.name}`, 'success');
      }
    });

    document.getElementById('toggleGlobeTransparency')?.addEventListener('click', (e) => {
      BimViewer.toggleGlobeTransparency();
      e.target.classList.toggle('active');
      const controls = document.getElementById('globeTransparencyControls');
      controls.style.display = BimViewer.globeTransparency.enabled ? 'block' : 'none';
    });

    document.getElementById('toggleUndergroundView')?.addEventListener('click', (e) => {
      BimViewer.toggleUndergroundView();
      e.target.classList.toggle('active');
    });

    document.getElementById('toggleAO')?.addEventListener('click', function() {
      const ao = BimViewer.viewer?.scene?.postProcessStages?.ambientOcclusion;
      if (!ao) {
        BimViewer.updateStatus('Ambient Occlusion not supported', 'error');
        return;
      }
      ao.enabled = !ao.enabled;
      this.classList.toggle('active');
      const controls = document.getElementById('aoControls');
      if (controls) controls.style.display = ao.enabled ? 'block' : 'none';

      if (ao.enabled) {
        this.innerHTML = '<span class="modern-btn-icon">🌑</span><span>SSAO ON</span>';
      } else {
        this.innerHTML = '<span class="modern-btn-icon">🌑</span><span>Enable SSAO</span>';
        ao.uniforms.ambientOcclusionOnly = false;
        document.getElementById('toggleAOOnly')?.classList.remove('active');
      }
    });

    document.getElementById('toggleAOOnly')?.addEventListener('click', function() {
      const ao = BimViewer.viewer?.scene?.postProcessStages?.ambientOcclusion;
      if (!ao) return;
      ao.uniforms.ambientOcclusionOnly = !ao.uniforms.ambientOcclusionOnly;
      this.classList.toggle('active');
    });

    document.getElementById('aoIntensitySlider')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      const ao = BimViewer.viewer?.scene?.postProcessStages?.ambientOcclusion;
      if (ao) ao.uniforms.intensity = val;
      document.getElementById('aoIntensityValue').textContent = val.toFixed(1);
    });

    document.getElementById('aoBiasSlider')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      const ao = BimViewer.viewer?.scene?.postProcessStages?.ambientOcclusion;
      if (ao) ao.uniforms.bias = val;
      document.getElementById('aoBiasValue').textContent = val.toFixed(2);
    });

    document.getElementById('aoLengthCapSlider')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      const ao = BimViewer.viewer?.scene?.postProcessStages?.ambientOcclusion;
      if (ao) ao.uniforms.lengthCap = val;
      document.getElementById('aoLengthCapValue').textContent = val.toFixed(2);
    });

    document.getElementById('aoDirectionSlider')?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      const ao = BimViewer.viewer?.scene?.postProcessStages?.ambientOcclusion;
      if (ao) ao.uniforms.directionCount = val;
      document.getElementById('aoDirectionValue').textContent = val;
    });

    document.getElementById('aoStepSlider')?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      const ao = BimViewer.viewer?.scene?.postProcessStages?.ambientOcclusion;
      if (ao) ao.uniforms.stepCount = val;
      document.getElementById('aoStepValue').textContent = val;
    });

    document.getElementById('globeAlphaSlider')?.addEventListener('input', (e) => {
      const alpha = parseFloat(e.target.value);
      BimViewer.setGlobeTransparency(alpha);
      document.getElementById('globeAlphaValue').textContent = Math.round(alpha * 100) + '%';
    });

    document.getElementById('toggleFXAA')?.addEventListener('click', function() {
      const fxaa = BimViewer.viewer?.scene?.postProcessStages?.fxaa;
      if (!fxaa) {
        BimViewer.updateStatus('FXAA not available', 'error');
        return;
      }
      fxaa.enabled = !fxaa.enabled;
      this.classList.toggle('active');
      if (fxaa.enabled) {
        this.innerHTML = '<span class="modern-btn-icon">✨</span><span>FXAA ON</span>';
        BimViewer.updateStatus('FXAA enabled', 'success');
      } else {
        this.innerHTML = '<span class="modern-btn-icon">✨</span><span>FXAA</span>';
        BimViewer.updateStatus('FXAA disabled', 'success');
      }
    });

    document.getElementById('toggleToneMapper')?.addEventListener('click', function() {
      const isPBR = this.classList.toggle('active');
      BimViewer.viewer.scene.postProcessStages.tonemapper = isPBR
        ? Cesium.Tonemapper.PBR_NEUTRAL
        : Cesium.Tonemapper.ACES;
      this.querySelector('span:last-child').textContent = isPBR ? 'PBR Neutral' : 'ACES';
    });

    document.getElementById('toggleSilhouette')?.addEventListener('click', function() {
      if (!BimViewer.silhouette.supported) {
        BimViewer.updateStatus('Silhouette not supported on this device', 'error');
        return;
      }
      const enabled = !BimViewer.silhouette.enabled;
      BimViewer.enableSilhouette(enabled);
      this.classList.toggle('active');
      const controls = document.getElementById('silhouetteControls');
      if (controls) controls.style.display = enabled ? 'block' : 'none';
      if (enabled) {
        this.innerHTML = '<span class="modern-btn-icon">🔲</span><span>Silhouette ON</span>';
        BimViewer.updateStatus('Silhouette enabled', 'success');
      } else {
        this.innerHTML = '<span class="modern-btn-icon">🔲</span><span>Enable Silhouette</span>';
        BimViewer.updateStatus('Silhouette disabled', 'success');
      }
    });

    document.getElementById('silhouetteStrengthSlider')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      BimViewer.setSilhouetteStrength(val);
      document.getElementById('silhouetteStrengthValue').textContent = val.toFixed(3);
    });

    document.querySelectorAll('.silhouette-color-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.silhouette-color-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        const hex = this.dataset.color;
        const cesiumColor = Cesium.Color.fromCssColorString(hex);
        BimViewer.setSilhouetteColor(cesiumColor);
        BimViewer.updateStatus('Silhouette color updated', 'success');
      });
    });

    // --- IBL Controls ---
    document.getElementById('toggleIBL')?.addEventListener('click', function() {
      const enabled = !BimViewer.ibl.enabled;
      BimViewer.setIBLEnabled(enabled);
      this.classList.toggle('active', enabled);
      this.querySelector('span:last-child').textContent = enabled ? 'IBL Enabled' : 'IBL Disabled';
      document.getElementById('iblControls').style.display = enabled ? 'block' : 'none';
    });

    document.getElementById('iblDiffuseSlider')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      BimViewer.setIBLDiffuse(val);
      document.getElementById('iblDiffuseValue').textContent = val.toFixed(2);
    });

    document.getElementById('iblSpecularSlider')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      BimViewer.setIBLSpecular(val);
      document.getElementById('iblSpecularValue').textContent = val.toFixed(2);
    });

    // Restore IBL UI state from persisted settings
    if (BimViewer.ibl) {
      const iblToggle = document.getElementById('toggleIBL');
      const iblControls = document.getElementById('iblControls');
      if (iblToggle) {
        iblToggle.classList.toggle('active', BimViewer.ibl.enabled);
        iblToggle.querySelector('span:last-child').textContent = BimViewer.ibl.enabled ? 'IBL Enabled' : 'IBL Disabled';
      }
      if (iblControls) {
        iblControls.style.display = BimViewer.ibl.enabled ? 'block' : 'none';
      }
      const modeBtn = document.getElementById('toggleIBLMode');
      if (modeBtn) {
        const modeLabel = modeBtn.querySelector('span:last-child');
        if (modeLabel) modeLabel.textContent = BimViewer.ibl.mode === 'static' ? 'Static KTX2' : 'Dynamic';
        modeBtn.classList.toggle('active', BimViewer.ibl.mode === 'static');
      }
      const diffSlider = document.getElementById('iblDiffuseSlider');
      const specSlider = document.getElementById('iblSpecularSlider');
      if (diffSlider) {
        diffSlider.value = BimViewer.ibl.diffuse;
        document.getElementById('iblDiffuseValue').textContent = BimViewer.ibl.diffuse.toFixed(2);
      }
      if (specSlider) {
        specSlider.value = BimViewer.ibl.specular;
        document.getElementById('iblSpecularValue').textContent = BimViewer.ibl.specular.toFixed(2);
      }
    }
  }

  window.GEOBIM_SETTINGS_UI = {
    getContent: getContent,
    initHandlers: initHandlers
  };

})();
