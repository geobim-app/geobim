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

  var splitSliderHandler = null;

  function getContent() {
    return `
      <div class="modern-group">
        <button id="toggleSplitView" class="modern-toggle-btn" title="Toggle split-screen comparison">
          <span class="modern-btn-icon">↔️</span>
          <span>Enable Split View</span>
        </button>
      </div>
      <div class="modern-hint">
        <strong>Left:</strong> Terrain / basemap only<br>
        <strong>Right:</strong> All loaded assets + terrain<br>
        Drag the slider to adjust split position.
      </div>
    `;
  }

  function toggleSplitView() {
    const viewer = BimViewer.viewer;
    if (!viewer) return;

    BimViewer.splitMode = !BimViewer.splitMode;
    const slider = document.getElementById('splitSlider');
    const btn = document.getElementById('toggleSplitView');

    if (BimViewer.splitMode) {
      viewer.scene.splitPosition = 0.5;

      BimViewer.loadedAssets.forEach(assetData => {
        if (assetData.tileset) {
          assetData.tileset.splitDirection = Cesium.SplitDirection.RIGHT;
        }
      });

      if (BimViewer.osmBuildings.tileset) {
        BimViewer.osmBuildings.tileset.splitDirection = Cesium.SplitDirection.RIGHT;
      }

      if (BimViewer.googleTiles.tileset && BimViewer.googleTiles.enabled) {
        BimViewer.googleTiles.tileset.splitDirection = Cesium.SplitDirection.RIGHT;
        createGoogleTilesLeftCopy();
      }

      if (slider) {
        slider.classList.add('visible');
        slider.style.left = '50%';
      }

      initSplitSliderDrag();

      if (btn) {
        btn.classList.add('active');
        btn.innerHTML = '<span class="modern-btn-icon">↔️</span><span>Split View ON</span>';
      }

      if (typeof BimViewer.applyClipping === 'function' && BimViewer.clipping?.polygons?.length > 0) {
        BimViewer.applyClipping();
      }

      BimViewer.updateStatus('Split view enabled', 'success');
    } else {
      viewer.scene.splitPosition = 1.0;

      BimViewer.loadedAssets.forEach(assetData => {
        if (assetData.tileset) {
          assetData.tileset.splitDirection = Cesium.SplitDirection.NONE;
        }
      });

      if (BimViewer.osmBuildings.tileset) {
        BimViewer.osmBuildings.tileset.splitDirection = Cesium.SplitDirection.NONE;
      }

      if (BimViewer.googleTiles.tileset) {
        BimViewer.googleTiles.tileset.splitDirection = Cesium.SplitDirection.NONE;
      }
      removeGoogleTilesLeftCopy();

      if (slider) {
        slider.classList.remove('visible');
      }

      destroySplitSliderDrag();

      if (btn) {
        btn.classList.remove('active');
        btn.innerHTML = '<span class="modern-btn-icon">↔️</span><span>Enable Split View</span>';
      }

      if (typeof BimViewer.applyClipping === 'function' && BimViewer.clipping?.polygons?.length > 0) {
        BimViewer.applyClipping();
      }

      BimViewer.updateStatus('Split view disabled', 'success');
    }
  }

  function initSplitSliderDrag() {
    const slider = document.getElementById('splitSlider');
    if (!slider) return;

    splitSliderHandler = {
      onPointerDown: (e) => {
        slider.classList.add('active');
        slider.setPointerCapture(e.pointerId);
      },
      onPointerMove: (e) => {
        if (!slider.hasPointerCapture(e.pointerId)) return;
        const container = document.getElementById('cesiumContainer');
        if (!container) return;
        const width = container.clientWidth;
        const x = e.clientX;
        const splitPos = Math.max(0.01, Math.min(0.99, x / width));
        slider.style.left = (splitPos * 100) + '%';
        BimViewer.viewer.scene.splitPosition = splitPos;
      },
      onPointerUp: (e) => {
        slider.classList.remove('active');
      }
    };

    slider.addEventListener('pointerdown', splitSliderHandler.onPointerDown);
    slider.addEventListener('pointermove', splitSliderHandler.onPointerMove);
    slider.addEventListener('pointerup', splitSliderHandler.onPointerUp);
  }

  function destroySplitSliderDrag() {
    const slider = document.getElementById('splitSlider');
    if (!slider || !splitSliderHandler) return;

    slider.removeEventListener('pointerdown', splitSliderHandler.onPointerDown);
    slider.removeEventListener('pointermove', splitSliderHandler.onPointerMove);
    slider.removeEventListener('pointerup', splitSliderHandler.onPointerUp);
    splitSliderHandler = null;
  }

  async function createGoogleTilesLeftCopy() {
    if (BimViewer.googleTiles.leftTileset) return;

    try {
      const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(CONFIG.cesium.GOOGLE_3D_TILES_ASSET_ID, {
        maximumScreenSpaceError: 16,
        skipLevelOfDetail: true,
        baseScreenSpaceError: 1024,
        skipScreenSpaceErrorFactor: 16,
        skipLevels: 1,
        immediatelyLoadDesiredLevelOfDetail: false,
        loadSiblings: true,
        cullWithChildrenBounds: true,
        cullRequestsWhileMoving: true,
        cullRequestsWhileMovingMultiplier: 60,
        preloadWhenHidden: true,
        preloadFlightDestinations: true,
        preferLeaves: false,
        backFaceCulling: true,
        maximumMemoryUsage: 4096,
        dynamicScreenSpaceError: true,
        dynamicScreenSpaceErrorDensity: 0.00028,
        dynamicScreenSpaceErrorFactor: 4.0,
        dynamicScreenSpaceErrorHeightFalloff: 0.25,
        foveatedScreenSpaceError: true,
        foveatedConeSize: 0.1,
        foveatedMinimumScreenSpaceErrorRelaxation: 0,
        foveatedInterpolationCallback: Cesium.Math.lerp,
        foveatedTimeDelay: 0.2,
        cacheBytes: 2147483648,
        maximumCacheOverflowBytes: 536870912
      });

      tileset.splitDirection = Cesium.SplitDirection.LEFT;
      BimViewer.viewer.scene.primitives.add(tileset);
      BimViewer.enableTilesetLighting(tileset);

      const preset = BimViewer.googleTilesPresets[BimViewer.googleTiles.activePreset];
      if (preset) {
        tileset.maximumScreenSpaceError = preset.maximumScreenSpaceError;
        tileset.skipLevelOfDetail = preset.skipLevelOfDetail;
        tileset.maximumMemoryUsage = preset.maximumMemoryUsage;
        tileset.backFaceCulling = preset.backFaceCulling;
        tileset.preferLeaves = preset.preferLeaves;
        tileset.cullRequestsWhileMovingMultiplier = preset.cullRequestsWhileMovingMultiplier;
        tileset.foveatedConeSize = preset.foveatedConeSize;
      }

      BimViewer.googleTiles.leftTileset = tileset;
      console.log('✅ Google 3D Tiles LEFT copy created (unclipped)');
    } catch (error) {
      console.error('❌ Failed to create Google 3D Tiles left copy:', error);
    }
  }

  function removeGoogleTilesLeftCopy() {
    if (!BimViewer.googleTiles.leftTileset) return;

    BimViewer.viewer.scene.primitives.remove(BimViewer.googleTiles.leftTileset);
    BimViewer.googleTiles.leftTileset = null;
    console.log('✅ Google 3D Tiles LEFT copy removed');
  }

  function initHandlers() {
    document.getElementById('toggleSplitView')?.addEventListener('click', () => {
      toggleSplitView();
    });
  }

  window.GEOBIM_SPLIT_UI = {
    getContent: getContent,
    initHandlers: initHandlers,
    toggleSplitView: toggleSplitView,
    createGoogleTilesLeftCopy: createGoogleTilesLeftCopy,
    removeGoogleTilesLeftCopy: removeGoogleTilesLeftCopy
  };
})();
