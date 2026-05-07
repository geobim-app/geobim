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
        <div class="modern-label">Basemap</div>
        <div id="basemapList" class="layer-basemap-list">
        </div>
      </div>

      <div class="modern-divider">
        <span class="modern-divider-text">3D Layers</span>
      </div>

      <div class="modern-group">
        <button id="toggleOSMBuildings" class="modern-toggle-btn active">
          <span class="modern-btn-icon">🏙️</span>
          <span>OSM Buildings</span>
        </button>
        <button id="toggleGoogle3DTiles" class="modern-toggle-btn">
          <span class="modern-btn-icon">🌍</span>
          <span>Google 3D Tiles</span>
        </button>
        <div id="googleTilesQualityRow" class="modern-btn-group-3" style="margin-top: 6px; display: none;">
          <button class="modern-btn modern-btn-small google-tiles-preset-btn active" data-preset="performance" onclick="BimViewer.setGoogleTilesQuality('performance')">
            <span>Speed</span>
          </button>
          <button class="modern-btn modern-btn-small google-tiles-preset-btn" data-preset="balanced" onclick="BimViewer.setGoogleTilesQuality('balanced')">
            <span>Balanced</span>
          </button>
          <button class="modern-btn modern-btn-small google-tiles-preset-btn" data-preset="quality" onclick="BimViewer.setGoogleTilesQuality('quality')">
            <span>Quality</span>
          </button>
        </div>
        <div id="tilesetLayersList" class="layer-overlay-list" style="margin-top: 6px;">
        </div>
      </div>

      <div class="modern-divider">
        <span class="modern-divider-text">Terrain</span>
      </div>

      <div class="modern-group">
        <div id="terrainList" class="layer-terrain-list">
        </div>
        <div class="layer-add-overlay" style="margin-top: 8px;">
          <div style="display: flex; gap: 6px;">
            <input id="terrainAssetId" type="number" class="modern-input" placeholder="Ion Terrain Asset ID">
            <button id="addTerrainBtn" class="modern-btn modern-btn-primary" style="white-space: nowrap;">
              <span class="modern-btn-icon">➕</span>
            </button>
          </div>
          <input id="terrainName" type="text" class="modern-input" placeholder="Name (optional)" style="margin-top: 6px;">
        </div>
      </div>

      <div class="modern-hint">
        Local terrain (DGM) merges with World Terrain — local data has priority in its coverage area.
      </div>

      <div class="modern-divider">
        <span class="modern-divider-text">Imagery Overlays</span>
      </div>

      <div class="modern-group">
        <div class="layer-add-overlay">
          <div style="display: flex; gap: 6px;">
            <input id="overlayAssetId" type="number" class="modern-input" placeholder="Ion Imagery Asset ID">
            <button id="addOverlayBtn" class="modern-btn modern-btn-primary" style="white-space: nowrap;">
              <span class="modern-btn-icon">➕</span>
            </button>
          </div>
          <input id="overlayName" type="text" class="modern-input" placeholder="Name (optional)" style="margin-top: 6px;">
        </div>
      </div>

      <div id="overlayLayersList" class="layer-overlay-list">
        <div class="modern-empty-state">No imagery overlays</div>
      </div>

      <div class="modern-hint">
        Imagery overlays render on top of the basemap. Use alpha slider to blend.
      </div>

      <div class="modern-divider">
        <span class="modern-divider-text">OGC Services (WMS / WMTS / WFS)</span>
      </div>

      <div class="modern-group">
        <div class="layer-add-overlay">
          <div style="display: flex; gap: 6px;">
            <input id="wmsUrl" type="text" class="modern-input" placeholder="WMS / WMTS / WFS Service URL">
            <button id="wmsDiscoverBtn" class="modern-btn modern-btn-primary" style="white-space: nowrap;" title="Discover layers">
              <span class="modern-btn-icon">🔍</span>
            </button>
          </div>
        </div>
        <div id="wmsLayerPicker" style="display: none; margin-top: 8px;">
          <div id="wmsLayerPickerStatus" class="modern-empty-state">Discovering layers...</div>
          <div id="wmsLayerPickerList" style="max-height: 200px; overflow-y: auto;"></div>
        </div>
      </div>

      <div id="wmsLayersList" class="layer-overlay-list">
        <div class="modern-empty-state">No OGC service layers</div>
      </div>

      <div class="modern-hint">
        Paste a GetCapabilities URL or base service URL. WMS/WMTS (imagery) and WFS (vector features) are auto-discovered.
      </div>

      <div class="modern-divider">
        <span class="modern-divider-text">Geoid</span>
      </div>

      <div class="modern-group">
        <button id="toggleGeoidTerrain" class="modern-toggle-btn" onclick="if(typeof GEOBIM_GEOID_TERRAIN!=='undefined' && typeof BimViewer!=='undefined'){GEOBIM_GEOID_TERRAIN.toggle(BimViewer.viewer)}">
          <span class="modern-btn-icon">🌐</span>
          <span>Geoid Terrain</span>
        </button>
      </div>

      <div class="modern-divider">
        <span class="modern-divider-text">Bathymetry</span>
      </div>

      <div class="modern-group">
        <button id="toggleBathymetry" class="modern-toggle-btn" onclick="if(typeof GEOBIM_BATHYMETRY!=='undefined' && typeof BimViewer!=='undefined'){GEOBIM_BATHYMETRY.toggle(BimViewer.viewer)}">
          <span class="modern-btn-icon">🌊</span>
          <span>Bathymetry</span>
        </button>
      </div>
    `;
  }

  function initHandlers() {
    document.getElementById('toggleOSMBuildings')?.addEventListener('click', (e) => {
      BimViewer.toggleOSMBuildings();
      e.target.classList.toggle('active');
    });

    document.getElementById('toggleGoogle3DTiles')?.addEventListener('click', (e) => {
      BimViewer.toggleGoogle3DTiles();
      e.target.classList.toggle('active');

      const qualityRow = document.getElementById('googleTilesQualityRow');
      if (qualityRow) {
        qualityRow.style.display = BimViewer.googleTiles.enabled ? 'grid' : 'none';
      }

      if (typeof plausible !== 'undefined' && e.target.classList.contains('active')) {
        plausible('Feature Used', { props: { feature: 'Google 3D Tiles' } });
      }
    });

    // Basemap radio buttons (delegated)
    document.getElementById('basemapList')?.addEventListener('change', (e) => {
      if (e.target.name === 'basemap' && typeof LayerManager !== 'undefined') {
        LayerManager.switchBasemap(e.target.value);
      }
    });

    // Terrain radio buttons (delegated) + remove buttons
    document.getElementById('terrainList')?.addEventListener('change', (e) => {
      if (e.target.name === 'terrain' && typeof LayerManager !== 'undefined') {
        LayerManager.switchTerrain(e.target.value);
      }
    });
    document.getElementById('terrainList')?.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('[data-remove-terrain]');
      if (removeBtn && typeof LayerManager !== 'undefined') {
        LayerManager.removeTerrain(removeBtn.dataset.removeTerrain);
      }
    });

    document.getElementById('addTerrainBtn')?.addEventListener('click', () => {
      const assetIdInput = document.getElementById('terrainAssetId');
      const nameInput = document.getElementById('terrainName');
      const assetId = parseInt(assetIdInput.value);
      if (!assetId) {
        BimViewer.updateStatus('Please enter a valid Ion Asset ID', 'error');
        return;
      }
      const name = nameInput.value.trim() || null;
      if (typeof LayerManager !== 'undefined') {
        LayerManager.setLocalTerrain(assetId, name);
      }
      assetIdInput.value = '';
      nameInput.value = '';
    });

    document.getElementById('addOverlayBtn')?.addEventListener('click', () => {
      const assetIdInput = document.getElementById('overlayAssetId');
      const nameInput = document.getElementById('overlayName');
      const assetId = parseInt(assetIdInput.value);
      if (!assetId) {
        BimViewer.updateStatus('Please enter a valid Ion Asset ID', 'error');
        return;
      }
      const name = nameInput.value.trim() || null;
      if (typeof LayerManager !== 'undefined') {
        LayerManager.addIonImageryOverlay(assetId, name);
      }
      assetIdInput.value = '';
      nameInput.value = '';
    });

    document.getElementById('overlayLayersList')?.addEventListener('click', (e) => {
      if (typeof LayerManager === 'undefined') return;

      const toggleBtn = e.target.closest('[data-toggle-overlay]');
      if (toggleBtn) {
        LayerManager.toggleOverlay(toggleBtn.dataset.toggleOverlay);
        return;
      }

      const removeBtn = e.target.closest('[data-remove-overlay]');
      if (removeBtn) {
        LayerManager.removeOverlay(removeBtn.dataset.removeOverlay);
        return;
      }
    });

    document.getElementById('overlayLayersList')?.addEventListener('input', (e) => {
      const slider = e.target.closest('[data-alpha-overlay]');
      if (slider && typeof LayerManager !== 'undefined') {
        const alpha = parseFloat(slider.value);
        LayerManager.setOverlayAlpha(slider.dataset.alphaOverlay, alpha);
        const valueEl = slider.closest('.layer-overlay-alpha')?.querySelector('.layer-alpha-value');
        if (valueEl) valueEl.textContent = alpha.toFixed(2);
      }
    });

    document.getElementById('wmsDiscoverBtn')?.addEventListener('click', () => {
      const urlInput = document.getElementById('wmsUrl');
      const url = urlInput?.value.trim();
      if (!url) {
        BimViewer.updateStatus('Please enter a WMS/WMTS/WFS service URL', 'error');
        return;
      }
      if (typeof LayerManager !== 'undefined') {
        LayerManager.discoverWmsLayers(url);
      }
    });

    document.getElementById('wmsLayerPickerList')?.addEventListener('click', (e) => {
      const item = e.target.closest('[data-wms-add-layer]');
      if (item && typeof LayerManager !== 'undefined') {
        LayerManager.addDiscoveredWmsLayer(item.dataset.wmsAddLayer);
      }
    });

    document.getElementById('wmsLayersList')?.addEventListener('click', (e) => {
      if (typeof LayerManager === 'undefined') return;

      const toggleBtn = e.target.closest('[data-toggle-wms]');
      if (toggleBtn) {
        LayerManager.toggleWmsLayer(toggleBtn.dataset.toggleWms);
        return;
      }

      const removeBtn = e.target.closest('[data-remove-wms]');
      if (removeBtn) {
        LayerManager.removeWmsLayer(removeBtn.dataset.removeWms);
        return;
      }
    });

    document.getElementById('wmsLayersList')?.addEventListener('input', (e) => {
      const slider = e.target.closest('[data-alpha-wms]');
      if (slider && typeof LayerManager !== 'undefined') {
        const alpha = parseFloat(slider.value);
        LayerManager.setWmsLayerAlpha(slider.dataset.alphaWms, alpha);
        const valueEl = slider.closest('.layer-overlay-alpha')?.querySelector('.layer-alpha-value');
        if (valueEl) valueEl.textContent = alpha.toFixed(2);
      }
    });

    document.getElementById('tilesetLayersList')?.addEventListener('click', (e) => {
      const toggleBtn = e.target.closest('[data-toggle-tileset]');
      if (toggleBtn && typeof LayerManager !== 'undefined') {
        const id = toggleBtn.dataset.toggleTileset;
        const entry = LayerManager.tilesetLayers.find(t => t.id === id);
        if (entry && entry.active) {
          LayerManager.disableTileset(id);
        } else {
          LayerManager.enableTileset(id);
        }
      }
    });

    if (typeof LayerManager !== 'undefined') {
      LayerManager.populateUI();
    }
  }

  window.GEOBIM_LAYER_UI = {
    getContent: getContent,
    initHandlers: initHandlers
  };
})();
