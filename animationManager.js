/**
 * GEOBIM.APP - Geospatial BIM Viewer
 * © 2026 Christof Lorenz. All rights reserved.
 *
 * License: Personal and non-commercial use only.
 * Commercial use requires written permission.
 * Contact: info@geobim.app
 */

// ===============================
// ANIMATION MANAGER MODULE v1.0
// CZML Animation Playback
// ===============================
'use strict';

(function() {

  console.log('Loading Animation Manager module v1.0...');

  // Available sample animations
  const SAMPLE_ANIMATIONS = [
    { name: 'London City Airport - Taxi', file: 'assets/animations/london-city-taxi.czml' }
  ];

  window.AnimationManager = {

    // State
    viewer: null,
    dataSources: [],    // { id, name, dataSource, file }
    isPlaying: false,
    trackedEntity: null,
    trackingEnabled: false,
    savedClockState: null,
    idCounter: 0,
    defaultModelAssetId: 4456366,  // Ion asset ID for animated models
    modelResource: null,           // Cached IonResource for the model (glTF)
    modelIsTileset: false,         // Whether the Ion asset is 3D Tiles
    entityTilesets: [],            // { entity, tileset } pairs for 3D Tile models
    tickListener: null,            // Scene preUpdate listener for tileset sync

    // =====================================
    // INITIALIZATION
    // =====================================

    async init(viewer) {
      this.viewer = viewer;

      // Pre-resolve Ion model resource — detect if glTF or 3D Tiles
      if (this.defaultModelAssetId) {
        try {
          const resource = await Cesium.IonResource.fromAssetId(this.defaultModelAssetId);
          const url = resource.url || resource.toString();

          if (url.indexOf('tileset.json') !== -1) {
            // 3D Tiles asset — load as tileset template
            this.modelIsTileset = true;
            this.modelResource = this.defaultModelAssetId;
            console.log('Animation model is 3D Tiles (Ion Asset:', this.defaultModelAssetId + ')');
          } else {
            // glTF/glb asset — use directly with ModelGraphics
            this.modelIsTileset = false;
            this.modelResource = resource;
            console.log('Animation model is glTF (Ion Asset:', this.defaultModelAssetId + ')');
          }
        } catch (error) {
          console.warn('Could not resolve animation model asset:', error.message);
        }
      }

      console.log('Animation Manager initialized');
    },

    // =====================================
    // CZML LOADING
    // =====================================

    async loadCZML(fileOrUrl, name) {
      if (!this.viewer) {
        console.error('Animation Manager not initialized');
        BimViewer.updateStatus('Animation Manager not initialized', 'error');
        return null;
      }

      try {
        BimViewer.updateStatus('Loading CZML...', 'loading');

        // Save clock state before first animation load
        if (this.dataSources.length === 0) {
          this.saveClockState();
        }

        const dataSource = await Cesium.CzmlDataSource.load(fileOrUrl);
        this.viewer.dataSources.add(dataSource);

        const id = 'czml_' + (++this.idCounter);
        const czmlName = name || dataSource.name || fileOrUrl.split('/').pop();

        this.dataSources.push({
          id: id,
          name: czmlName,
          dataSource: dataSource,
          file: fileOrUrl
        });

        // Attach Ion model to entities and clamp to terrain
        this.attachModelsToDataSource(dataSource);

        // Apply clock settings from CZML
        this.syncClockFromDataSources();

        this.updateCzmlListUI();
        console.log('CZML loaded:', czmlName);
        BimViewer.updateStatus('Animation loaded: ' + czmlName, 'success');

        return id;

      } catch (error) {
        console.error('Failed to load CZML:', error);
        BimViewer.updateStatus('Failed to load CZML: ' + error.message, 'error');
        return null;
      }
    },

    async loadFromFile(file) {
      if (!file) return;

      try {
        const text = await file.text();
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const id = await this.loadCZML(url, file.name);
        URL.revokeObjectURL(url);
        return id;
      } catch (error) {
        console.error('Failed to read CZML file:', error);
        BimViewer.updateStatus('Failed to read file: ' + error.message, 'error');
        return null;
      }
    },

    async attachModelsToDataSource(dataSource) {
      if (!this.modelResource) {
        console.warn('No model resource available, skipping model attachment');
        return;
      }

      const entities = dataSource.entities.values;
      const animatedEntities = entities.filter(e => e.position);

      if (animatedEntities.length === 0) return;

      if (this.modelIsTileset) {
        // 3D Tiles: load a tileset per entity and sync position each frame
        for (const entity of animatedEntities) {
          try {
            const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(this.modelResource, {
              maximumScreenSpaceError: 4
            });
            this.viewer.scene.primitives.add(tileset);

            this.entityTilesets.push({ entity: entity, tileset: tileset, dataSource: dataSource });
            console.log('3D Tiles model attached to entity:', entity.name || entity.id);
          } catch (error) {
            console.error('Failed to load tileset for entity:', entity.name || entity.id, error);
          }
        }

        // Start position sync listener if not already active
        if (!this.tickListener && this.entityTilesets.length > 0) {
          this.tickListener = this.viewer.scene.preUpdate.addEventListener(() => {
            this.syncTilesetPositions();
          });
        }

      } else {
        // glTF: attach as ModelGraphics
        for (const entity of animatedEntities) {
          entity.model = new Cesium.ModelGraphics({
            uri: this.modelResource,
            scale: 1.0,
            minimumPixelSize: 48,
            maximumScale: 20,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
          });
          console.log('glTF model attached to entity:', entity.name || entity.id);
        }
      }
    },

    syncTilesetPositions() {
      const time = this.viewer.clock.currentTime;

      for (const pair of this.entityTilesets) {
        const entity = pair.entity;
        const tileset = pair.tileset;

        if (!entity.isAvailable(time)) {
          tileset.show = false;
          continue;
        }
        tileset.show = true;

        const position = entity.position.getValue(time);
        if (!position) continue;

        // Get heading from velocity/orientation
        let heading = 0;
        if (entity.orientation) {
          const orientation = entity.orientation.getValue(time);
          if (orientation) {
            const hpr = Cesium.HeadingPitchRoll.fromQuaternion(orientation);
            heading = hpr.heading;
          }
        }

        // Clamp to terrain: get terrain height at this position
        const cartographic = Cesium.Cartographic.fromCartesian(position);
        const terrainHeight = this.viewer.scene.globe.getHeight(cartographic);
        if (terrainHeight !== undefined) {
          cartographic.height = terrainHeight;
        }
        const clampedPosition = Cesium.Cartesian3.fromRadians(
          cartographic.longitude, cartographic.latitude, cartographic.height
        );

        // Build model matrix: position + heading
        const hpr = new Cesium.HeadingPitchRoll(heading, 0, 0);
        const transform = Cesium.Transforms.headingPitchRollToFixedFrame(
          clampedPosition, hpr
        );

        // Apply the root transform offset so the tileset origin aligns correctly
        const rootInverse = Cesium.Matrix4.inverse(tileset.root.transform, new Cesium.Matrix4());
        tileset.modelMatrix = Cesium.Matrix4.multiply(transform, rootInverse, new Cesium.Matrix4());
      }
    },

    removeCZML(id) {
      const index = this.dataSources.findIndex(d => d.id === id);
      if (index < 0) return;

      const entry = this.dataSources[index];

      // Stop tracking if we were tracking an entity from this source
      if (this.trackedEntity) {
        const trackedSource = this.dataSources.find(d =>
          d.dataSource.entities.getById(this.trackedEntity.id)
        );
        if (trackedSource && trackedSource.id === id) {
          this.viewer.trackedEntity = undefined;
          this.trackedEntity = null;
        }
      }

      // Remove associated tilesets
      this.entityTilesets = this.entityTilesets.filter(pair => {
        if (pair.dataSource === entry.dataSource) {
          this.viewer.scene.primitives.remove(pair.tileset);
          return false;
        }
        return true;
      });

      this.viewer.dataSources.remove(entry.dataSource);
      this.dataSources.splice(index, 1);

      // If no more data sources, restore clock and cleanup
      if (this.dataSources.length === 0) {
        this.cleanupTickListener();
        this.restoreClockState();
        this.isPlaying = false;
      }

      this.updateCzmlListUI();
      this.updatePlaybackUI();
      console.log('CZML removed:', entry.name);
      BimViewer.updateStatus('Animation removed: ' + entry.name, 'success');
    },

    // =====================================
    // PLAYBACK CONTROLS
    // =====================================

    play() {
      if (!this.viewer || this.dataSources.length === 0) return;

      this.viewer.clock.shouldAnimate = true;
      this.isPlaying = true;
      this.updatePlaybackUI();
      console.log('Animation playing');
    },

    pause() {
      if (!this.viewer) return;

      this.viewer.clock.shouldAnimate = false;
      this.isPlaying = false;
      this.updatePlaybackUI();
      console.log('Animation paused');
    },

    togglePlayPause() {
      if (this.isPlaying) {
        this.pause();
      } else {
        this.play();
      }
    },

    stop() {
      if (!this.viewer) return;

      this.viewer.clock.shouldAnimate = false;
      this.isPlaying = false;

      // Reset to start time
      if (this.viewer.clock.startTime) {
        this.viewer.clock.currentTime = this.viewer.clock.startTime.clone();
      }

      this.updatePlaybackUI();
      console.log('Animation stopped (reset to start)');
    },

    setSpeed(multiplier) {
      if (!this.viewer) return;
      this.viewer.clock.multiplier = multiplier;
      console.log('Animation speed:', multiplier + 'x');
    },

    // =====================================
    // ENTITY TRACKING
    // =====================================

    toggleTracking() {
      this.trackingEnabled = !this.trackingEnabled;

      if (this.trackingEnabled) {
        // Find first entity with a position (animated entity)
        for (const entry of this.dataSources) {
          const entities = entry.dataSource.entities.values;
          for (const entity of entities) {
            if (entity.position) {
              this.viewer.trackedEntity = entity;
              this.trackedEntity = entity;
              console.log('Tracking entity:', entity.name || entity.id);
              BimViewer.updateStatus('Tracking: ' + (entity.name || entity.id), 'success');
              this.updatePlaybackUI();
              return;
            }
          }
        }
        // No trackable entity found
        this.trackingEnabled = false;
        BimViewer.updateStatus('No trackable entity found', 'warning');
      } else {
        this.viewer.trackedEntity = undefined;
        this.trackedEntity = null;
        this.updatePlaybackUI();
      }
    },

    // =====================================
    // CLOCK MANAGEMENT
    // =====================================

    saveClockState() {
      const clock = this.viewer.clock;
      this.savedClockState = {
        startTime: clock.startTime.clone(),
        stopTime: clock.stopTime.clone(),
        currentTime: clock.currentTime.clone(),
        multiplier: clock.multiplier,
        shouldAnimate: clock.shouldAnimate,
        clockRange: clock.clockRange
      };
    },

    restoreClockState() {
      if (!this.savedClockState || !this.viewer) return;

      const clock = this.viewer.clock;
      const s = this.savedClockState;
      clock.startTime = s.startTime;
      clock.stopTime = s.stopTime;
      clock.currentTime = s.currentTime;
      clock.multiplier = s.multiplier;
      clock.shouldAnimate = s.shouldAnimate;
      clock.clockRange = s.clockRange;
      this.savedClockState = null;
    },

    syncClockFromDataSources() {
      if (this.dataSources.length === 0) return;

      // Use the clock from the most recently loaded CZML
      const latest = this.dataSources[this.dataSources.length - 1];
      const dsClock = latest.dataSource.clock;

      if (dsClock) {
        this.viewer.clock.startTime = dsClock.startTime.clone();
        this.viewer.clock.stopTime = dsClock.stopTime.clone();
        this.viewer.clock.currentTime = dsClock.currentTime.clone();
        this.viewer.clock.multiplier = dsClock.multiplier || 1;
        this.viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;

        // Update timeline widget if present
        if (this.viewer.timeline) {
          this.viewer.timeline.zoomTo(dsClock.startTime, dsClock.stopTime);
        }
      }
    },

    // =====================================
    // CLEAR ALL
    // =====================================

    cleanupTickListener() {
      if (this.tickListener) {
        this.tickListener();
        this.tickListener = null;
      }
    },

    clearAll() {
      if (!this.viewer) return;

      // Remove all tilesets
      this.entityTilesets.forEach(pair => {
        this.viewer.scene.primitives.remove(pair.tileset);
      });
      this.entityTilesets = [];
      this.cleanupTickListener();

      // Remove all data sources
      this.dataSources.forEach(entry => {
        this.viewer.dataSources.remove(entry.dataSource);
      });
      this.dataSources = [];

      // Stop tracking
      this.viewer.trackedEntity = undefined;
      this.trackedEntity = null;
      this.trackingEnabled = false;

      // Restore clock
      this.restoreClockState();
      this.isPlaying = false;

      this.updateCzmlListUI();
      this.updatePlaybackUI();
      console.log('All animations cleared');
      BimViewer.updateStatus('All animations cleared', 'success');
    },

    // =====================================
    // SAMPLE ANIMATIONS
    // =====================================

    getSampleAnimations() {
      return SAMPLE_ANIMATIONS;
    },

    // =====================================
    // UI UPDATES
    // =====================================

    updatePlaybackUI() {
      const playBtn = document.getElementById('animPlayPauseBtn');
      if (playBtn) {
        if (this.dataSources.length === 0) {
          playBtn.innerHTML = '&#9654; Play';
          playBtn.disabled = true;
        } else {
          playBtn.disabled = false;
          playBtn.innerHTML = this.isPlaying ? '&#10074;&#10074; Pause' : '&#9654; Play';
        }
      }

      const stopBtn = document.getElementById('animStopBtn');
      if (stopBtn) {
        stopBtn.disabled = this.dataSources.length === 0;
      }

      const trackBtn = document.getElementById('animTrackBtn');
      if (trackBtn) {
        trackBtn.disabled = this.dataSources.length === 0;
        if (this.trackingEnabled) {
          trackBtn.classList.add('active');
          trackBtn.innerHTML = '🎯 Tracking ON';
        } else {
          trackBtn.classList.remove('active');
          trackBtn.innerHTML = '🎯 Track Entity';
        }
      }

      const statusEl = document.getElementById('animStatus');
      if (statusEl) {
        if (this.dataSources.length === 0) {
          statusEl.textContent = 'No animation loaded';
          statusEl.className = 'anim-status';
        } else if (this.isPlaying) {
          statusEl.textContent = 'Playing (' + this.dataSources.length + ' source' + (this.dataSources.length > 1 ? 's' : '') + ')';
          statusEl.className = 'anim-status playing';
        } else {
          statusEl.textContent = 'Paused';
          statusEl.className = 'anim-status paused';
        }
      }
    },

    updateCzmlListUI() {
      const container = document.getElementById('animCzmlList');
      if (!container) return;

      if (this.dataSources.length === 0) {
        container.innerHTML = '<div class="modern-empty-state">No animations loaded</div>';
        return;
      }

      container.innerHTML = this.dataSources.map(d => `
        <div class="anim-czml-item">
          <span class="anim-czml-item-name" title="${d.name}">${d.name}</span>
          <div class="anim-czml-item-actions">
            <button data-remove-czml="${d.id}" title="Remove">✕</button>
          </div>
        </div>
      `).join('');
    }
  };

  console.log('Animation Manager module loaded');

})();
