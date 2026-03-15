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
    wmsLayers: [],          // { id, name, url, type, layerName, layer, visible, alpha }
    wmsDiscovered: [],      // cached discovered layers from GetCapabilities
    wmsDiscoveredUrl: null, // URL of last discovery
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
      this.updateWmsUI();
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
    // WMS / WMTS / WFS MANAGEMENT
    // =====================================

    async discoverWmsLayers(url) {
      if (!this.viewer) return;

      const picker = document.getElementById('wmsLayerPicker');
      const status = document.getElementById('wmsLayerPickerStatus');
      const list = document.getElementById('wmsLayerPickerList');
      if (picker) picker.style.display = 'block';
      if (status) { status.style.display = 'block'; status.textContent = 'Discovering layers...'; }
      if (list) list.innerHTML = '';

      BimViewer.updateStatus('Discovering OGC service layers...', 'loading');

      // Normalize URL — append GetCapabilities if not present
      let capsUrl = url.trim();
      const isWmts = /wmts/i.test(capsUrl);
      const isWfs = /wfs/i.test(capsUrl);

      // Don't append if already a capabilities request or a capabilities XML file
      if (!/request=getcapabilities/i.test(capsUrl) && !/capabilities\.xml$/i.test(capsUrl)) {
        const sep = capsUrl.includes('?') ? '&' : '?';
        if (isWmts) {
          capsUrl += sep + 'SERVICE=WMTS&REQUEST=GetCapabilities';
        } else if (isWfs) {
          capsUrl += sep + 'SERVICE=WFS&REQUEST=GetCapabilities';
        } else {
          capsUrl += sep + 'SERVICE=WMS&REQUEST=GetCapabilities';
        }
      }

      try {
        const response = await fetch(capsUrl);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const text = await response.text();
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, 'text/xml');

        const parseError = xml.querySelector('parsererror');
        if (parseError) throw new Error('Invalid XML response');

        // Detect service type from response
        const rootTag = xml.documentElement.tagName.replace(/^.*:/, ''); // strip namespace prefix
        const isWmtsResponse = rootTag === 'Capabilities' ||
                               xml.querySelector('Capabilities') !== null;
        const isWfsResponse = rootTag === 'WFS_Capabilities' ||
                              xml.documentElement.tagName.indexOf('WFS_Capabilities') >= 0;

        let layers = [];

        if (isWfsResponse) {
          // Parse WFS Capabilities
          var featureTypes = xml.querySelectorAll('FeatureType');
          featureTypes.forEach(function(el) {
            var nameEl = el.querySelector('Name');
            var titleEl = el.querySelector('Title');
            var abstractEl = el.querySelector('Abstract');
            // Extract default CRS
            var crsEl = el.querySelector('DefaultCRS, DefaultSRS');
            var crs = crsEl ? crsEl.textContent : '';
            // Extract output formats from parent (OperationsMetadata) or layer level
            var formats = [];
            var fmtEls = xml.querySelectorAll('OperationsMetadata Operation[name="GetFeature"] Parameter[name="outputFormat"] Value, ' +
                                              'OperationsMetadata Operation[name="GetFeature"] Parameter[name="outputFormat"] AllowedValues Value');
            fmtEls.forEach(function(f) { formats.push(f.textContent); });

            // Check for GeoJSON support
            var supportsGeoJson = formats.some(function(f) {
              return /geojson|json/i.test(f);
            });

            if (nameEl) {
              layers.push({
                name: nameEl.textContent,
                title: (titleEl ? titleEl.textContent : nameEl.textContent),
                abstract: abstractEl ? abstractEl.textContent : '',
                type: 'wfs',
                crs: crs,
                outputFormats: formats,
                supportsGeoJson: supportsGeoJson,
                url: url.trim()
              });
            }
          });
        } else if (isWmtsResponse) {
          // Parse WMTS Capabilities
          const layerEls = xml.querySelectorAll('Layer');
          layerEls.forEach(function(el) {
            const id = el.querySelector('Identifier');
            const title = el.querySelector('Title');

            // Collect all TileMatrixSetLinks
            var tmsLinks = el.querySelectorAll('TileMatrixSetLink > TileMatrixSet');
            var allTms = [];
            tmsLinks.forEach(function(t) { allTms.push(t.textContent); });

            // Prefer Web Mercator compatible TileMatrixSet for CesiumJS
            var preferredTms = null;
            var mercatorNames = ['googlemapscompatible', 'smerc', 'epsg:3857', 'epsg3857', 'webmercatorquad'];
            for (var t = 0; t < allTms.length; t++) {
              if (mercatorNames.indexOf(allTms[t].toLowerCase()) >= 0) {
                preferredTms = allTms[t]; break;
              }
            }
            if (!preferredTms && allTms.length > 0) preferredTms = allTms[0];

            // Extract ResourceURL template (RESTful WMTS)
            var resourceUrl = null;
            var resEls = el.querySelectorAll('ResourceURL');
            resEls.forEach(function(r) {
              var fmt = r.getAttribute('format') || '';
              var tmpl = r.getAttribute('template') || '';
              // Prefer image formats
              if (tmpl && (!resourceUrl || /image\/(png|jpeg)/.test(fmt))) {
                resourceUrl = tmpl;
              }
            });

            if (id) {
              layers.push({
                name: id.textContent,
                title: (title ? title.textContent : id.textContent),
                type: 'wmts',
                tileMatrixSet: preferredTms,
                allTileMatrixSets: allTms,
                resourceUrl: resourceUrl,
                url: url.trim()
              });
            }
          });
        } else {
          // Parse WMS Capabilities
          const layerEls = xml.querySelectorAll('Layer > Layer, Layer[queryable]');
          // Deduplicate by Name
          const seen = new Set();
          layerEls.forEach(function(el) {
            const nameEl = el.querySelector(':scope > Name');
            const titleEl = el.querySelector(':scope > Title');
            if (nameEl && !seen.has(nameEl.textContent)) {
              seen.add(nameEl.textContent);
              layers.push({
                name: nameEl.textContent,
                title: (titleEl ? titleEl.textContent : nameEl.textContent),
                type: 'wms',
                url: url.trim()
              });
            }
          });
        }

        this.wmsDiscovered = layers;
        this.wmsDiscoveredUrl = url.trim();

        if (layers.length === 0) {
          if (status) { status.textContent = 'No layers found in this service.'; }
          BimViewer.updateStatus('No layers found', 'warning');
          return;
        }

        if (status) status.style.display = 'none';

        list.innerHTML = layers.map(function(l, i) {
          var typeLabel = l.type.toUpperCase();
          var metaInfo = typeLabel + ' · ' + l.name;
          if (l.tileMatrixSet) metaInfo += ' · ' + l.tileMatrixSet;
          if (l.type === 'wfs') metaInfo += l.supportsGeoJson ? ' · GeoJSON' : ' · GML';
          return '<div data-wms-add-layer="' + i + '" style="' +
            'padding: 6px 8px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.06); ' +
            'font-size: 11px; display: flex; justify-content: space-between; align-items: center;' +
            '" onmouseover="this.style.background=\'rgba(255,255,255,0.08)\'" onmouseout="this.style.background=\'none\'">' +
            '<div style="flex: 1; min-width: 0;">' +
              '<div style="color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="' + l.title + '">' + l.title + '</div>' +
              '<div style="color: rgba(255,255,255,0.4); font-size: 10px;">' + metaInfo + '</div>' +
            '</div>' +
            '<span style="color: #6EECD8; font-size: 16px; margin-left: 8px; flex-shrink: 0;">+</span>' +
          '</div>';
        }).join('');

        BimViewer.updateStatus(layers.length + ' layer(s) found', 'success');

      } catch (error) {
        console.error('OGC service discovery failed:', error);
        if (status) { status.style.display = 'block'; status.textContent = 'Discovery failed: ' + error.message; }
        BimViewer.updateStatus('Discovery failed: ' + error.message, 'error');
      }
    },

    async addDiscoveredWmsLayer(index) {
      const layer = this.wmsDiscovered[parseInt(index, 10)];
      if (!layer || !this.viewer) return;

      // Check duplicate
      const dupeId = layer.type + '_' + layer.name;
      if (this.wmsLayers.find(w => w.id === dupeId)) {
        BimViewer.updateStatus('Layer already added', 'warning');
        return;
      }

      try {
        BimViewer.updateStatus('Loading ' + layer.title + '...', 'loading');

        if (layer.type === 'wfs') {
          // WFS — fetch features as GeoJSON and load as DataSource
          await this._addWfsLayer(layer, dupeId);
        } else {
          // WMS / WMTS — add as imagery layer
          let provider;
          if (layer.type === 'wmts') {
            var wmtsUrl = layer.url;
            var wmtsOpts = { layer: layer.name, style: 'default' };

            if (layer.resourceUrl) {
              // RESTful WMTS — use the template URL
              wmtsUrl = layer.resourceUrl.replace(/\{(\d+)-(\d+)\}/g, function(m, a) { return a; });
              wmtsOpts.url = wmtsUrl;
            } else {
              wmtsOpts.url = wmtsUrl;
            }

            if (layer.tileMatrixSet) wmtsOpts.tileMatrixSetID = layer.tileMatrixSet;
            provider = new Cesium.WebMapTileServiceImageryProvider(wmtsOpts);
          } else {
            provider = new Cesium.WebMapServiceImageryProvider({
              url: layer.url,
              layers: layer.name,
              parameters: { transparent: true, format: 'image/png' }
            });
          }

          const cesiumLayer = this.viewer.imageryLayers.addImageryProvider(provider);
          cesiumLayer.alpha = 0.7;

          this.wmsLayers.push({
            id: dupeId,
            name: layer.title,
            url: layer.url,
            type: layer.type,
            layerName: layer.name,
            layer: cesiumLayer,
            dataSource: null,
            visible: true,
            alpha: 0.7
          });
        }

        this.updateWmsUI();
        BimViewer.updateStatus('Layer added: ' + layer.title, 'success');
        console.log('OGC layer added:', layer.type.toUpperCase(), layer.title);

      } catch (error) {
        console.error('Failed to add OGC layer:', error);
        BimViewer.updateStatus('Failed: ' + error.message, 'error');
      }
    },

    /**
     * Load a WFS feature type as GeoJSON DataSource.
     * Requests up to 5000 features in EPSG:4326 GeoJSON format.
     */
    /**
     * Parse GML geometry elements into GeoJSON coordinates.
     */
    /**
     * Namespace-safe element finder — tries both prefixed and unprefixed tag names.
     */
    _gmlFind(parent, localName) {
      // Try with gml: prefix first, then without
      var els = parent.getElementsByTagName('gml:' + localName);
      if (els.length > 0) return els[0];
      els = parent.getElementsByTagName(localName);
      if (els.length > 0) return els[0];
      return null;
    },

    _gmlFindAll(parent, localName) {
      var result = [];
      var els = parent.getElementsByTagName('gml:' + localName);
      for (var i = 0; i < els.length; i++) result.push(els[i]);
      if (result.length === 0) {
        els = parent.getElementsByTagName(localName);
        for (var i = 0; i < els.length; i++) result.push(els[i]);
      }
      return result;
    },

    _parseGmlGeometry(geomEl) {
      if (!geomEl) return null;

      var localName = geomEl.localName || geomEl.tagName.replace(/^.*:/, '');

      // Handle gml:Point
      if (localName === 'Point') {
        var posEl = this._gmlFind(geomEl, 'pos') || this._gmlFind(geomEl, 'coordinates');
        if (!posEl) return null;
        var posLocal = posEl.localName || posEl.tagName.replace(/^.*:/, '');
        if (posLocal === 'coordinates') {
          var coords = this._parseGmlCoords(posEl.textContent.trim());
          return coords.length > 0 ? { type: 'Point', coordinates: coords[0] } : null;
        }
        var parts = posEl.textContent.trim().split(/\s+/).map(Number);
        if (parts.length < 2) return null;
        return { type: 'Point', coordinates: [parts[1], parts[0]] }; // lat,lon → lon,lat
      }

      // Handle gml:LineString
      if (localName === 'LineString') {
        var coords = this._parseGmlPosList(geomEl);
        if (coords.length === 0) return null;
        return { type: 'LineString', coordinates: coords };
      }

      // Handle gml:Polygon
      if (localName === 'Polygon') {
        var rings = [];
        var exterior = this._gmlFind(geomEl, 'exterior') || this._gmlFind(geomEl, 'outerBoundaryIs');
        if (exterior) {
          var ring = this._gmlFind(exterior, 'LinearRing');
          if (ring) rings.push(this._parseGmlPosList(ring));
        }
        var interiors = this._gmlFindAll(geomEl, 'interior');
        if (interiors.length === 0) interiors = this._gmlFindAll(geomEl, 'innerBoundaryIs');
        var self = this;
        interiors.forEach(function(inner) {
          var ring = self._gmlFind(inner, 'LinearRing');
          if (ring) rings.push(self._parseGmlPosList(ring));
        });
        if (rings.length === 0) return null;
        return { type: 'Polygon', coordinates: rings };
      }

      // Handle gml:MultiPoint
      if (localName === 'MultiPoint') {
        var points = [];
        var self = this;
        this._gmlFindAll(geomEl, 'Point').forEach(function(pt) {
          var g = self._parseGmlGeometry(pt);
          if (g) points.push(g.coordinates);
        });
        if (points.length === 0) return null;
        return { type: 'MultiPoint', coordinates: points };
      }

      // Handle gml:MultiLineString / gml:MultiCurve
      if (localName === 'MultiLineString' || localName === 'MultiCurve') {
        var lines = [];
        var self = this;
        this._gmlFindAll(geomEl, 'LineString').forEach(function(ls) {
          var g = self._parseGmlGeometry(ls);
          if (g) lines.push(g.coordinates);
        });
        if (lines.length === 0) return null;
        return { type: 'MultiLineString', coordinates: lines };
      }

      // Handle gml:MultiPolygon / gml:MultiSurface
      if (localName === 'MultiPolygon' || localName === 'MultiSurface') {
        var polys = [];
        var self = this;
        this._gmlFindAll(geomEl, 'Polygon').forEach(function(pg) {
          var g = self._parseGmlGeometry(pg);
          if (g) polys.push(g.coordinates);
        });
        if (polys.length === 0) return null;
        return { type: 'MultiPolygon', coordinates: polys };
      }

      // Recurse into child elements for wrapper elements
      var geomNames = ['Point', 'LineString', 'Polygon', 'MultiPoint', 'MultiLineString',
                       'MultiCurve', 'MultiPolygon', 'MultiSurface'];
      for (var i = 0; i < geomEl.children.length; i++) {
        var child = geomEl.children[i];
        var childLocal = child.localName || child.tagName.replace(/^.*:/, '');
        if (geomNames.indexOf(childLocal) >= 0) {
          return this._parseGmlGeometry(child);
        }
      }

      return null;
    },

    /**
     * Parse gml:posList or gml:coordinates into array of [lon, lat] pairs.
     */
    _parseGmlPosList(el) {
      var posListEl = this._gmlFind(el, 'posList');
      if (posListEl) {
        var nums = posListEl.textContent.trim().split(/\s+/).map(Number);
        var dimStr = posListEl.getAttribute('srsDimension') || el.getAttribute('srsDimension');
        if (!dimStr && el.parentElement) dimStr = el.parentElement.getAttribute('srsDimension');
        if (!dimStr && el.parentElement && el.parentElement.parentElement) dimStr = el.parentElement.parentElement.getAttribute('srsDimension');
        var dim = parseInt(dimStr || '2', 10);
        var coords = [];
        for (var i = 0; i + dim - 1 < nums.length; i += dim) {
          // GML default axis order for EPSG:4326 is lat,lon — swap to lon,lat for GeoJSON
          coords.push([nums[i + 1], nums[i]]);
        }
        return coords;
      }

      // Fallback: multiple gml:pos elements
      var posEls = this._gmlFindAll(el, 'pos');
      if (posEls.length > 0) {
        var coords = [];
        posEls.forEach(function(p) {
          var parts = p.textContent.trim().split(/\s+/).map(Number);
          if (parts.length >= 2) coords.push([parts[1], parts[0]]); // lat,lon → lon,lat
        });
        return coords;
      }

      // Fallback: gml:coordinates (comma-separated tuples)
      var coordsEl = this._gmlFind(el, 'coordinates');
      if (coordsEl) {
        return this._parseGmlCoords(coordsEl.textContent.trim());
      }

      return [];
    },

    /**
     * Parse gml:coordinates text (comma-separated, space-delimited tuples).
     * Format: "lon,lat lon,lat ..." or "lat,lon lat,lon ..."
     */
    _parseGmlCoords(text) {
      var tuples = text.split(/\s+/);
      return tuples.map(function(t) {
        var parts = t.split(',').map(Number);
        // gml:coordinates uses lon,lat order
        return parts.length >= 2 ? [parts[0], parts[1]] : null;
      }).filter(function(c) { return c !== null; });
    },

    /**
     * Convert GML XML response to GeoJSON FeatureCollection.
     */
    _gmlToGeoJson(xmlText) {
      var parser = new DOMParser();
      var xml = parser.parseFromString(xmlText, 'text/xml');

      // Check for WFS exception
      var exception = xml.querySelector('ExceptionReport, ServiceException');
      if (exception) {
        var msg = exception.textContent.trim().substring(0, 200);
        throw new Error('WFS error: ' + msg);
      }

      var features = [];

      // Find all member elements — use getElementsByTagName which is namespace-aware
      // and also try querySelectorAll as fallback
      var memberEls = [];

      // Collect from various possible element names (with and without namespace prefixes)
      var tagNames = ['wfs:member', 'member', 'gml:featureMember', 'featureMember'];
      tagNames.forEach(function(tag) {
        var els = xml.getElementsByTagName(tag);
        for (var i = 0; i < els.length; i++) {
          memberEls.push(els[i]);
        }
      });

      // Also check featureMembers (plural) which wraps all features
      var membersContainers = xml.getElementsByTagName('gml:featureMembers');
      if (membersContainers.length === 0) membersContainers = xml.getElementsByTagName('featureMembers');
      for (var mc = 0; mc < membersContainers.length; mc++) {
        var container = membersContainers[mc];
        for (var i = 0; i < container.children.length; i++) {
          // Wrap child in a pseudo-member
          memberEls.push({ children: [container.children[i]] });
        }
      }

      // Deduplicate (in case both 'wfs:member' and 'member' matched the same elements)
      var seen = new Set();
      memberEls = memberEls.filter(function(el) {
        if (el instanceof Element) {
          if (seen.has(el)) return false;
          seen.add(el);
        }
        return true;
      });

      var self = this;
      var processedCount = 0;
      var geomNames = ['Point', 'LineString', 'Polygon', 'MultiPoint', 'MultiLineString',
                       'MultiCurve', 'MultiPolygon', 'MultiSurface'];

      memberEls.forEach(function(member) {
        // The feature element is the first child of the member
        var featureEl = member.children ? member.children[0] : null;
        if (!featureEl) return;

        var properties = {};
        var geometry = null;

        // Iterate child elements of the feature
        for (var j = 0; j < featureEl.children.length; j++) {
          var child = featureEl.children[j];
          var propName = child.localName || child.tagName.replace(/^.*:/, '');

          // Check if this element contains a geometry — search recursively
          var geomChild = self._findGeometryElement(child, geomNames);

          if (geomChild) {
            geometry = self._parseGmlGeometry(geomChild);
          } else if (child.children.length === 0) {
            // Simple leaf property
            var val = child.textContent.trim();
            if (val) properties[propName] = val;
          } else {
            // Nested property — extract leaf values recursively
            self._flattenGmlProperties(child, propName, properties);
          }
        }

        if (geometry) {
          features.push({
            type: 'Feature',
            properties: properties,
            geometry: geometry
          });
          processedCount++;
        }
      });

      console.log('GML parsed: ' + processedCount + ' features with geometry out of ' +
                  (Array.isArray(memberEls) ? memberEls.length : memberEls.length) + ' members');

      return {
        type: 'FeatureCollection',
        features: features
      };
    },

    /**
     * Flatten nested GML properties into a flat key-value object.
     * E.g. <modellart><AA_Modellart><advStandardModell>Basis-DLM → "modellart": "Basis-DLM"
     */
    _flattenGmlProperties(el, prefix, properties) {
      for (var i = 0; i < el.children.length; i++) {
        var child = el.children[i];
        var localName = child.localName || child.tagName.replace(/^.*:/, '');
        if (child.children.length === 0) {
          var val = child.textContent.trim();
          if (val) {
            // Use parent prefix for cleaner property names
            var key = prefix;
            // If there are multiple leaf siblings, qualify with child name
            if (el.children.length > 1) {
              key = prefix + '.' + localName;
            }
            // Handle duplicate keys by appending
            if (properties[key] && properties[key] !== val) {
              properties[key] += ', ' + val;
            } else {
              properties[key] = val;
            }
          }
        } else {
          this._flattenGmlProperties(child, prefix + '.' + localName, properties);
        }
      }
    },

    /**
     * Recursively search for a GML geometry element within an element tree.
     */
    _findGeometryElement(el, geomNames) {
      for (var i = 0; i < el.children.length; i++) {
        var child = el.children[i];
        var localName = child.localName || child.tagName.replace(/^.*:/, '');
        if (geomNames.indexOf(localName) >= 0) {
          return child;
        }
        // Recurse (max 3 levels deep to avoid performance issues)
        var found = this._findGeometryElement(child, geomNames);
        if (found) return found;
      }
      return null;
    },

    async _addWfsLayer(layer, dupeId) {
      // Build WFS GetFeature URL
      var baseUrl = layer.url.split('?')[0];
      var params = [
        'SERVICE=WFS',
        'REQUEST=GetFeature',
        'TYPENAMES=' + encodeURIComponent(layer.name),
        'COUNT=5000',
        'SRSNAME=EPSG:4326'
      ];

      // Prefer GeoJSON output if available
      var useGeoJson = false;
      if (layer.supportsGeoJson) {
        var geoJsonFormat = layer.outputFormats.find(function(f) {
          return /application\/json|application\/geo\+json|geojson/i.test(f);
        });
        if (geoJsonFormat) {
          params.push('OUTPUTFORMAT=' + encodeURIComponent(geoJsonFormat));
          useGeoJson = true;
        }
      }

      // If no GeoJSON, request GML 3.2 (most compatible)
      if (!useGeoJson) {
        // Check for preferred GML format
        var gmlFormat = null;
        if (layer.outputFormats && layer.outputFormats.length > 0) {
          gmlFormat = layer.outputFormats.find(function(f) { return /gml.*3\.2/i.test(f); });
          if (!gmlFormat) gmlFormat = layer.outputFormats[0];
        }
        if (gmlFormat) {
          params.push('OUTPUTFORMAT=' + encodeURIComponent(gmlFormat));
        }
      }

      var getFeatureUrl = baseUrl + '?' + params.join('&');
      console.log('WFS GetFeature URL:', getFeatureUrl);

      var response = await fetch(getFeatureUrl);
      if (!response.ok) throw new Error('WFS GetFeature failed: HTTP ' + response.status);

      var data = await response.text();
      var geojson;

      // Try parsing as JSON first
      if (data.charAt(0) === '{' || data.charAt(0) === '[') {
        try {
          geojson = JSON.parse(data);
          if (!geojson.type || (geojson.type !== 'FeatureCollection' && geojson.type !== 'Feature')) {
            if (geojson.exceptions) {
              throw new Error('WFS error: ' + (geojson.exceptions[0]?.text || 'Unknown'));
            }
            throw new Error('WFS response is not valid GeoJSON');
          }
        } catch (e) {
          if (e.message.indexOf('WFS') === 0) throw e;
          throw new Error('Failed to parse WFS JSON response');
        }
      } else {
        // Parse GML/XML response
        console.log('WFS returned GML, converting to GeoJSON...');
        geojson = this._gmlToGeoJson(data);
      }

      var featureCount = geojson.features ? geojson.features.length : 1;
      if (featureCount === 0) {
        throw new Error('No features with geometry found in WFS response');
      }
      console.log('WFS loaded ' + featureCount + ' features for ' + layer.name);

      // Load into CesiumJS as GeoJsonDataSource
      var dataSource = await Cesium.GeoJsonDataSource.load(geojson, {
        clampToGround: true,
        stroke: Cesium.Color.fromCssColorString('#6EECD8'),
        strokeWidth: 2,
        fill: Cesium.Color.fromCssColorString('#6EECD8').withAlpha(0.25),
        markerColor: Cesium.Color.fromCssColorString('#6EECD8'),
        markerSize: 24
      });

      dataSource.name = layer.title;
      this.viewer.dataSources.add(dataSource);

      this.wmsLayers.push({
        id: dupeId,
        name: layer.title + ' (' + featureCount + ')',
        url: layer.url,
        type: 'wfs',
        layerName: layer.name,
        layer: null,
        dataSource: dataSource,
        visible: true,
        alpha: 1.0
      });
    },

    /**
     * Query WMS GetFeatureInfo for all visible WMS layers at click position.
     * Returns true if a query was initiated.
     */
    queryWmsFeatureInfo(windowPosition) {
      if (!this.viewer) return false;

      // Find visible WMS layers (not WMTS or WFS — only WMS supports GetFeatureInfo reliably)
      var wmsLayers = this.wmsLayers.filter(function(w) {
        return w.type === 'wms' && w.visible && w.layer;
      });
      if (wmsLayers.length === 0) return false;

      var viewer = this.viewer;
      var ray = viewer.camera.getPickRay(windowPosition);
      if (!ray) return false;

      var cartesian = viewer.scene.globe.pick(ray, viewer.scene);
      if (!cartesian) return false;

      var carto = Cesium.Cartographic.fromCartesian(cartesian);
      var lon = Cesium.Math.toDegrees(carto.longitude);
      var lat = Cesium.Math.toDegrees(carto.latitude);

      console.log('WMS GetFeatureInfo at', lat.toFixed(6), lon.toFixed(6));
      BimViewer.updateStatus('Querying WMS feature info...', 'loading');

      // Query each visible WMS layer
      var self = this;
      wmsLayers.forEach(function(wmsEntry) {
        // Build GetFeatureInfo URL
        var baseUrl = wmsEntry.url.split('?')[0];

        // Calculate a bounding box around the click point
        var delta = 0.001; // ~100m
        var bbox = [lon - delta, lat - delta, lon + delta, lat + delta].join(',');

        var params = [
          'SERVICE=WMS',
          'VERSION=1.1.1',
          'REQUEST=GetFeatureInfo',
          'LAYERS=' + encodeURIComponent(wmsEntry.layerName),
          'QUERY_LAYERS=' + encodeURIComponent(wmsEntry.layerName),
          'INFO_FORMAT=text/html',
          'SRS=EPSG:4326',
          'STYLES=',
          'BBOX=' + bbox,
          'WIDTH=256',
          'HEIGHT=256',
          'X=128',
          'Y=128',
          'FEATURE_COUNT=5'
        ];

        var infoUrl = baseUrl + '?' + params.join('&');
        console.log('WMS GetFeatureInfo URL:', infoUrl);

        fetch(infoUrl)
          .then(function(resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.text();
          })
          .then(function(text) {
            // Parse the GML/XML response
            var properties = self._parseGetFeatureInfoResponse(text, wmsEntry.name);
            if (properties && Object.keys(properties).length > 0) {
              BimViewer.displayIFCProperties(properties);
              BimViewer.updateStatus('WMS feature info: ' + wmsEntry.name, 'success');
            } else {
              console.log('No features at this location for', wmsEntry.name);
              BimViewer.updateStatus('No feature info at this location', 'info');
            }
          })
          .catch(function(err) {
            console.warn('GetFeatureInfo failed for', wmsEntry.name, err);
            BimViewer.updateStatus('GetFeatureInfo failed: ' + err.message, 'error');
          });
      });

      return true;
    },

    /**
     * Parse a WMS GetFeatureInfo response (GML/XML or plain text).
     */
    _parseGetFeatureInfoResponse(text, layerName) {
      var properties = {};
      var trimmed = text.trim();

      if (trimmed.charAt(0) !== '<') {
        // Plain text response
        if (trimmed && trimmed !== 'no features were found' && trimmed.length > 2) {
          properties['Info'] = trimmed;
          properties['_Layer'] = layerName;
        }
        return properties;
      }

      try {
        // Detect if response is HTML or XML
        var isHtml = /<!DOCTYPE|<html/i.test(trimmed.substring(0, 200));

        if (isHtml) {
          // Parse HTML response — extract key-value pairs from tables
          var parser = new DOMParser();
          var doc = parser.parseFromString(trimmed, 'text/html');

          // Strategy 1: Two-column table rows (key in first TD, value in second TD)
          var rows = doc.querySelectorAll('table tr, TABLE TR');
          var featureIndex = 0;
          rows.forEach(function(row) {
            var cells = row.querySelectorAll('td, TD');
            if (cells.length >= 2) {
              var key = cells[0].textContent.trim();
              var val = cells[1].textContent.trim();
              if (key && val && key !== val) {
                // Skip if key looks like a header spanning columns
                if (key.length > 100) return;
                properties[key] = val;
              }
            } else if (cells.length === 1) {
              // Could be a section header or layer name
              var headerText = cells[0].textContent.trim();
              if (headerText.indexOf('Layer:') >= 0) {
                var layerMatch = headerText.replace('Layer:', '').trim();
                if (layerMatch) properties['_FeatureType'] = layerMatch;
              }
            }
          });

          // Strategy 2: Definition lists (dt/dd pairs)
          var dts = doc.querySelectorAll('dt');
          dts.forEach(function(dt) {
            var dd = dt.nextElementSibling;
            if (dd && dd.tagName.toLowerCase() === 'dd') {
              var key = dt.textContent.trim();
              var val = dd.textContent.trim();
              if (key && val) properties[key] = val;
            }
          });

          if (Object.keys(properties).length > 0) {
            properties['_Layer'] = layerName;
          }

        } else {
          // Parse XML/GML response
          var parser = new DOMParser();
          var xml = parser.parseFromString(trimmed, 'text/xml');

          // Pattern 1: FIELDS element with attributes (MapServer/QGIS style)
          var fields = xml.querySelector('FIELDS');
          if (fields) {
            var attrs = fields.attributes;
            for (var i = 0; i < attrs.length; i++) {
              if (attrs[i].value) properties[attrs[i].name] = attrs[i].value;
            }
            if (Object.keys(properties).length > 0) properties['_Layer'] = layerName;
            return properties;
          }

          // Pattern 2: Feature elements with child properties
          var allEls = xml.querySelectorAll('*');
          for (var i = 0; i < allEls.length; i++) {
            var el = allEls[i];
            var localName = el.localName || el.tagName.replace(/^.*:/, '');
            if (['FeatureCollection', 'featureMember', 'member', 'boundedBy',
                 'Envelope', 'lowerCorner', 'upperCorner', 'msGMLOutput', 'Box',
                 'ServiceExceptionReport', 'ServiceException', 'coordinates',
                 'GetFeatureInfoResponse'].indexOf(localName) >= 0) continue;

            if (el.children.length === 0 && el.textContent.trim()) {
              var key = localName;
              var val = el.textContent.trim();
              if (key === 'posList' || key === 'pos' || key === 'coordinates') continue;
              if (val.length > 500) continue;
              if (properties[key] && properties[key] !== val) {
                properties[key] += ', ' + val;
              } else {
                properties[key] = val;
              }
            }
          }

          if (Object.keys(properties).length > 0) properties['_Layer'] = layerName;
        }
      } catch (e) {
        console.warn('Failed to parse GetFeatureInfo response:', e);
      }

      return properties;
    },

    toggleWmsLayer(id) {
      const wms = this.wmsLayers.find(w => w.id === id);
      if (!wms) return;
      wms.visible = !wms.visible;
      if (wms.type === 'wfs' && wms.dataSource) {
        wms.dataSource.show = wms.visible;
      } else if (wms.layer) {
        wms.layer.show = wms.visible;
      }
      this.updateWmsUI();
    },

    setWmsLayerAlpha(id, alpha) {
      const wms = this.wmsLayers.find(w => w.id === id);
      if (!wms) return;
      wms.alpha = alpha;
      if (wms.type === 'wfs' && wms.dataSource) {
        // For WFS DataSource, adjust entity alpha
        var entities = wms.dataSource.entities.values;
        for (var i = 0; i < entities.length; i++) {
          var ent = entities[i];
          if (ent.polygon) {
            ent.polygon.material = Cesium.Color.fromCssColorString('#6EECD8').withAlpha(alpha * 0.25);
            ent.polygon.outlineColor = Cesium.Color.fromCssColorString('#6EECD8').withAlpha(alpha);
          }
          if (ent.polyline) {
            ent.polyline.material = Cesium.Color.fromCssColorString('#6EECD8').withAlpha(alpha);
          }
          if (ent.billboard) {
            ent.billboard.color = new Cesium.Color(1, 1, 1, alpha);
          }
          if (ent.point) {
            ent.point.color = Cesium.Color.fromCssColorString('#6EECD8').withAlpha(alpha);
          }
        }
      } else if (wms.layer) {
        wms.layer.alpha = alpha;
      }
    },

    removeWmsLayer(id) {
      const index = this.wmsLayers.findIndex(w => w.id === id);
      if (index < 0) return;
      const wms = this.wmsLayers[index];
      if (wms.type === 'wfs' && wms.dataSource) {
        this.viewer.dataSources.remove(wms.dataSource);
      } else if (wms.layer) {
        this.viewer.imageryLayers.remove(wms.layer);
      }
      this.wmsLayers.splice(index, 1);
      this.updateWmsUI();
      console.log('OGC layer removed:', wms.name);
      BimViewer.updateStatus('Layer removed: ' + wms.name, 'success');
    },

    updateWmsUI() {
      const container = document.getElementById('wmsLayersList');
      if (!container) return;

      if (this.wmsLayers.length === 0) {
        container.innerHTML = '<div class="modern-empty-state">No OGC service layers</div>';
        return;
      }

      container.innerHTML = this.wmsLayers.map(w => `
        <div class="layer-overlay-item" data-wms-id="${w.id}">
          <div class="layer-overlay-header">
            <span class="layer-overlay-name">${w.name}</span>
            <div class="layer-overlay-actions">
              <button class="layer-toggle-btn ${w.visible ? 'active' : ''}" data-toggle-wms="${w.id}" title="Toggle visibility">
                ${w.visible ? '👁' : '👁‍🗨'}
              </button>
              <button class="layer-remove-btn" data-remove-wms="${w.id}" title="Remove layer">✕</button>
            </div>
          </div>
          <div class="layer-overlay-meta">${w.type.toUpperCase()} · ${w.layerName}</div>
          <div class="layer-overlay-alpha">
            <label>Alpha</label>
            <input type="range" min="0" max="1" step="0.05" value="${w.alpha}"
                   class="modern-slider-small" data-alpha-wms="${w.id}">
            <span class="layer-alpha-value">${w.alpha.toFixed(2)}</span>
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
