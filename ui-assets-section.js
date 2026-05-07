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
        <div class="modern-label">🌍 Cesium Ion Assets</div>
        <div id="ionAssetsLoading" class="modern-hint" style="text-align: center; padding: 12px;">
          <span>⏳ Loading assets...</span>
        </div>

        <select id="ionAssetSelector" class="modern-select" multiple size="6" style="display: none;">
        </select>

        <button id="importSelectedAsset" class="modern-btn modern-btn-primary" style="display: none;">
          <span class="modern-btn-icon">➕</span>
          <span>Import Selected</span>
        </button>

        <!-- Hidden button for manual reload if needed -->
        <button id="loadIonAssets" style="display: none;"></button>
      </div>

      <div id="glbSection" style="display: none;">
        <div class="modern-divider">
          <span class="modern-divider-text">🧪 Local GLB Models</span>
        </div>
        <div class="modern-group">
          <select id="glbModelSelector" class="modern-select" size="1">
            <option value="" disabled selected>Select a GLB model...</option>
          </select>
          <button id="importGLBModel" class="modern-btn modern-btn-primary" style="margin-top: 6px;">
            <span class="modern-btn-icon">➕</span>
            <span>Load GLB</span>
          </button>
        </div>
      </div>

      <div class="modern-group" style="margin-top: 8px;">
        <button class="modern-btn modern-btn-small" onclick="BimViewer.toggleLoadedAssetsPanel()" title="Show/hide Loaded Assets panel">
          <span class="modern-btn-icon">📦</span>
          <span>Loaded Assets</span>
          <span id="loadedAssetsCount" class="modern-status" style="margin-left: auto;">0</span>
        </button>
      </div>
    `;
  }

  function initHandlers() {
    // Manual reload (hidden button — kept for fallback)
    document.getElementById('loadIonAssets')?.addEventListener('click', async () => {
      const btn = document.getElementById('loadIonAssets');
      const selector = document.getElementById('ionAssetSelector');
      const importBtn = document.getElementById('importSelectedAsset');

      if (!btn || !selector) return;

      try {
        btn.innerHTML = '<span class="modern-btn-icon">⏳</span><span>Loading...</span>';
        btn.disabled = true;

        const allAssets = await BimViewer.fetchAvailableAssets();
        var isOAuth = typeof BimIonAuth !== 'undefined' && BimIonAuth.isOAuthConnected();
        const assets = isOAuth
          ? allAssets.filter(asset => asset.type === '3DTILES' || asset.type === 'GLTF')
          : Array.from(DEMO_ASSETS, function(entry) { return { id: entry[0], name: entry[1] }; });

        selector.innerHTML = '<option value="">-- Select an asset --</option>';

        assets.forEach(asset => {
          const option = document.createElement('option');
          option.value = asset.id;
          option.textContent = `${asset.name} (ID: ${asset.id})`;
          selector.appendChild(option);
        });

        importBtn.disabled = false;
        btn.innerHTML = '<span class="modern-btn-icon">✅</span><span>Assets Loaded</span>';

        setTimeout(() => {
          btn.innerHTML = '<span class="modern-btn-icon">🌍</span><span>Load Ion Assets</span>';
          btn.disabled = false;
        }, 2000);

        BimViewer.updateStatus(`${assets.length} assets loaded`, 'success');
      } catch (error) {
        console.error('Failed to load assets:', error);
        btn.innerHTML = '<span class="modern-btn-icon">❌</span><span>Failed</span>';
        setTimeout(() => {
          btn.innerHTML = '<span class="modern-btn-icon">🌍</span><span>Load Ion Assets</span>';
          btn.disabled = false;
        }, 2000);
        BimViewer.updateStatus('Failed to load assets', 'error');
      }
    });

    document.getElementById('importSelectedAsset')?.addEventListener('click', () => {
      const selector = document.getElementById('ionAssetSelector');
      const selected = Array.from(selector.selectedOptions);
      selected.forEach(opt => {
        if (opt.value) BimViewer.loadSelectedAsset(opt.value, opt.text);
      });
      selector.selectedIndex = -1;
    });

    // GLB model selector (lab users only) — auth may not be resolved at init time
    const glbSection = document.getElementById('glbSection');
    const glbSelector = document.getElementById('glbModelSelector');
    const initGLBSection = async () => {
      if (!BimViewer.isLabUser() || !glbSelector) return;
      if (glbSection) glbSection.style.display = '';
      if (glbSelector.options.length <= 1) {
        if (!BimViewer.glbModels.length && BimViewer.fetchGLBModels) {
          await BimViewer.fetchGLBModels();
        }
        BimViewer.glbModels.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = m.name;
          glbSelector.appendChild(opt);
        });
      }
    };
    initGLBSection();
    setTimeout(initGLBSection, 2000);
    setTimeout(initGLBSection, 5000);

    document.getElementById('importGLBModel')?.addEventListener('click', () => {
      const selector = document.getElementById('glbModelSelector');
      if (!selector || !selector.value) return;
      const modelDef = BimViewer.glbModels.find(m => m.id === selector.value);
      if (modelDef) BimViewer.loadGLBAsset(modelDef);
    });
  }

  window.GEOBIM_ASSETS_UI = {
    getContent: getContent,
    initHandlers: initHandlers
  };
})();
