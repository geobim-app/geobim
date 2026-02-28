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
// LAYER MANAGER MODULE v1.0
// Basemap, Terrain & Imagery Overlay Management
// ===============================
'use strict';

(function() {

  console.log('Loading Layer Manager module v1.0...');

  window.LayerManager = {

    // State
    viewer: null,
    basemapLayers: [],      // { id, name, providerFactory, layer, active }
    overlayLayers: [],      // { id, name, assetId, layer, visible, alpha }
    terrainLayers: [],      // { id, name, assetId, active }
    activeBasemap: null,
    activeTerrain: 'world',

    // =====================================
    // INITIALIZATION
    // =====================================

    async init(viewer) {
      this.viewer = viewer;

      // Remove any default imagery layers added by Cesium Viewer
      viewer.imageryLayers.removeAll();

      // Register built-in basemaps
      this.basemapLayers = [
        {
          id: 'bing-aerial',
          name: 'Bing Aerial',
          providerFactory: () => Cesium.IonImageryProvider.fromAssetId(2),
          layer: null,
          active: false
        },
        {
          id: 'bing-roads',
          name: 'Bing Roads',
          providerFactory: () => Cesium.IonImageryProvider.fromAssetId(4),
          layer: null,
          active: false
        },
        {
          id: 'osm',
          name: 'OpenStreetMap',
          providerFactory: () => Promise.resolve(new Cesium.OpenStreetMapImageryProvider({
            url: 'https://a.tile.openstreetmap.org/'
          })),
          layer: null,
          active: false
        },
        {
          id: 'google-contour',
          name: 'Google Maps Contour',
          providerFactory: () => Cesium.IonImageryProvider.fromAssetId(3830186),
          layer: null,
          active: false
        },
        {
          id: 'google-sat-labels',
          name: 'Google Maps Sat Labels',
          providerFactory: () => Cesium.IonImageryProvider.fromAssetId(3830183),
          layer: null,
          active: false
        },
        {
          id: 'none',
          name: 'No Basemap',
          providerFactory: null,
          layer: null,
          active: false
        }
      ];

      // Register default terrain
      this.terrainLayers = [
        { id: 'world', name: 'Cesium World Terrain', assetId: null, active: true },
        { id: 'terrain_2426648', name: 'Cesium World Bathymetry', assetId: 2426648, active: false }
      ];

      // Activate default basemap
      await this.switchBasemap('bing-aerial');

      console.log('Layer Manager initialized');
    },

    // =====================================
    // BASEMAP MANAGEMENT (mutually exclusive)
    // =====================================

    async switchBasemap(id) {
      if (!this.viewer) return;

      const target = this.basemapLayers.find(b => b.id === id);
      if (!target) {
        console.error('Unknown basemap:', id);
        return;
      }

      // Remove current basemap layer
      const current = this.basemapLayers.find(b => b.active);
      if (current && current.layer) {
        this.viewer.imageryLayers.remove(current.layer, false);
        current.layer = null;
        current.active = false;
      }

      // Activate "none" — just deactivate, no new layer
      if (id === 'none') {
        target.active = true;
        this.activeBasemap = id;
        this.updateBasemapUI();
        console.log('Basemap removed');
        BimViewer.updateStatus('Basemap removed', 'success');
        return;
      }

      try {
        const provider = await target.providerFactory();
        // Guard: if Google 3D Tiles activated while provider was loading, don't add imagery
        if (BimViewer.googleTiles && BimViewer.googleTiles.enabled) {
          console.log('Basemap load skipped — Google 3D Tiles active');
          return;
        }
        // Add at index 0 (bottom of imagery stack)
        target.layer = this.viewer.imageryLayers.addImageryProvider(provider, 0);
        target.active = true;
        this.activeBasemap = id;
        this.updateBasemapUI();
        console.log('Basemap switched to:', target.name);
        BimViewer.updateStatus('Basemap: ' + target.name, 'success');
      } catch (error) {
        console.error('Failed to load basemap:', target.name, error);
        BimViewer.updateStatus('Failed to load basemap: ' + target.name, 'error');
      }
    },

    // =====================================
    // TERRAIN MANAGEMENT (radio behavior)
    // =====================================

    async setLocalTerrain(assetId, name) {
      if (!this.viewer) return;

      const terrainName = name || 'Local Terrain (ID: ' + assetId + ')';
      const terrainId = 'terrain_' + assetId;

      // Check if already registered
      const existing = this.terrainLayers.find(t => t.id === terrainId);
      if (existing) {
        // Just switch to it
        await this.switchTerrain(terrainId);
        return;
      }

      try {
        BimViewer.updateStatus('Loading terrain...', 'loading');

        // Test that the terrain provider can be created
        await Cesium.CesiumTerrainProvider.fromIonAssetId(assetId);

        // Register the terrain
        this.terrainLayers.push({
          id: terrainId,
          name: terrainName,
          assetId: assetId,
          active: false
        });

        // Switch to it
        await this.switchTerrain(terrainId);

        this.updateTerrainUI();
        this.updateOverlayUI();
        BimViewer.updateStatus('Terrain loaded: ' + terrainName, 'success');

      } catch (error) {
        console.error('Failed to load terrain:', error);
        BimViewer.updateStatus('Failed to load terrain: ' + error.message, 'error');
      }
    },

    async switchTerrain(terrainId) {
      if (!this.viewer) return;

      const target = this.terrainLayers.find(t => t.id === terrainId);
      if (!target) return;

      // Deactivate all
      this.terrainLayers.forEach(t => t.active = false);

      try {
        if (terrainId === 'world') {
          this.viewer.scene.setTerrain(Cesium.Terrain.fromWorldTerrain());
          if (BimViewer.terrain) {
            BimViewer.terrain.current = 'worldTerrain';
          }
        } else {
          const provider = await Cesium.CesiumTerrainProvider.fromIonAssetId(target.assetId);
          this.viewer.terrainProvider = provider;
          if (BimViewer.terrain) {
            BimViewer.terrain.current = 'local_' + target.assetId;
          }
        }

        target.active = true;
        this.activeTerrain = terrainId;
        this.updateTerrainUI();
        console.log('Terrain switched to:', target.name);

      } catch (error) {
        console.error('Failed to switch terrain:', error);
        BimViewer.updateStatus('Failed to switch terrain: ' + error.message, 'error');
      }
    },

    removeTerrain(terrainId) {
      if (terrainId === 'world') return; // Can't remove default

      const index = this.terrainLayers.findIndex(t => t.id === terrainId);
      if (index < 0) return;

      const wasActive = this.terrainLayers[index].active;
      this.terrainLayers.splice(index, 1);

      // If it was active, switch back to world
      if (wasActive) {
        this.switchTerrain('world');
      }

      this.updateTerrainUI();
      this.updateOverlayUI();
    },

    // =====================================
    // IMAGERY OVERLAY MANAGEMENT (stackable)
    // =====================================

    async addIonImageryOverlay(assetId, name) {
      if (!this.viewer) return;

      const overlayName = name || 'Imagery Overlay (ID: ' + assetId + ')';
      const overlayId = 'overlay_' + assetId;

      // Check duplicate
      if (this.overlayLayers.find(o => o.id === overlayId)) {
        BimViewer.updateStatus('Overlay already added', 'warning');
        return;
      }

      try {
        BimViewer.updateStatus('Loading imagery overlay...', 'loading');

        const provider = await Cesium.IonImageryProvider.fromAssetId(assetId);
        const layer = this.viewer.imageryLayers.addImageryProvider(provider);
        layer.alpha = 0.7;

        this.overlayLayers.push({
          id: overlayId,
          name: overlayName,
          assetId: assetId,
          layer: layer,
          visible: true,
          alpha: 0.7
        });

        this.updateOverlayUI();
        console.log('Imagery overlay added:', overlayName);
        BimViewer.updateStatus('Overlay added: ' + overlayName, 'success');

      } catch (error) {
        console.error('Failed to load imagery overlay:', error);
        BimViewer.updateStatus('Failed to load overlay: ' + error.message, 'error');
      }
    },

    toggleOverlay(id) {
      const overlay = this.overlayLayers.find(o => o.id === id);
      if (!overlay) return;

      overlay.visible = !overlay.visible;
      overlay.layer.show = overlay.visible;
      this.updateOverlayUI();
    },

    setOverlayAlpha(id, alpha) {
      const overlay = this.overlayLayers.find(o => o.id === id);
      if (!overlay) return;

      overlay.alpha = alpha;
      overlay.layer.alpha = alpha;
    },

    removeOverlay(id) {
      const index = this.overlayLayers.findIndex(o => o.id === id);
      if (index < 0) return;

      const overlay = this.overlayLayers[index];
      this.viewer.imageryLayers.remove(overlay.layer);
      this.overlayLayers.splice(index, 1);
      this.updateOverlayUI();
      console.log('Overlay removed:', overlay.name);
      BimViewer.updateStatus('Overlay removed: ' + overlay.name, 'success');
    },

    // =====================================
    // UI POPULATION
    // =====================================

    populateUI() {
      this.updateBasemapUI();
      this.updateTerrainUI();
      this.updateOverlayUI();
    },

    updateBasemapUI() {
      const container = document.getElementById('basemapList');
      if (!container) return;

      container.innerHTML = this.basemapLayers.map(b => `
        <label class="layer-radio-item ${b.active ? 'active' : ''}" data-basemap-id="${b.id}">
          <input type="radio" name="basemap" value="${b.id}" ${b.active ? 'checked' : ''}>
          <span class="layer-radio-label">${b.name}</span>
        </label>
      `).join('');
    },

    updateTerrainUI() {
      const container = document.getElementById('terrainList');
      if (!container) return;

      container.innerHTML = this.terrainLayers.map(t => `
        <div class="layer-terrain-item ${t.active ? 'active' : ''}">
          <label class="layer-radio-item ${t.active ? 'active' : ''}" data-terrain-id="${t.id}">
            <input type="radio" name="terrain" value="${t.id}" ${t.active ? 'checked' : ''}>
            <span class="layer-radio-label">${t.name}</span>
          </label>
          ${t.id !== 'world' ? '<button class="layer-remove-btn" data-remove-terrain="' + t.id + '" title="Remove terrain">✕</button>' : ''}
        </div>
      `).join('');
    },

    updateOverlayUI() {
      const container = document.getElementById('overlayLayersList');
      if (!container) return;

      if (this.overlayLayers.length === 0) {
        container.innerHTML = '<div class="modern-empty-state">No imagery overlays</div>';
        return;
      }

      container.innerHTML = this.overlayLayers.map(o => `
        <div class="layer-overlay-item" data-overlay-id="${o.id}">
          <div class="layer-overlay-header">
            <span class="layer-overlay-name">${o.name}</span>
            <div class="layer-overlay-actions">
              <button class="layer-toggle-btn ${o.visible ? 'active' : ''}" data-toggle-overlay="${o.id}" title="Toggle visibility">
                ${o.visible ? '👁' : '👁‍🗨'}
              </button>
              <button class="layer-remove-btn" data-remove-overlay="${o.id}" title="Remove overlay">✕</button>
            </div>
          </div>
          <div class="layer-overlay-meta">Ion Asset: ${o.assetId}</div>
          <div class="layer-overlay-alpha">
            <label>Alpha</label>
            <input type="range" min="0" max="1" step="0.05" value="${o.alpha}"
                   class="modern-slider-small" data-alpha-overlay="${o.id}">
            <span class="layer-alpha-value">${o.alpha.toFixed(2)}</span>
          </div>
        </div>
      `).join('');
    },

    // =====================================
    // STATE (for future scene save/load)
    // =====================================

    getState() {
      return {
        activeBasemap: this.activeBasemap,
        activeTerrain: this.activeTerrain,
        terrainLayers: this.terrainLayers.filter(t => t.id !== 'world').map(t => ({
          assetId: t.assetId,
          name: t.name
        })),
        overlayLayers: this.overlayLayers.map(o => ({
          assetId: o.assetId,
          name: o.name,
          visible: o.visible,
          alpha: o.alpha
        }))
      };
    }
  };

  console.log('Layer Manager module loaded');

})();
