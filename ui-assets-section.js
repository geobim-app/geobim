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
          <span class="modern-divider-text">🧪 Local Models (GLB / 3D Tiles)</span>
        </div>
        <div class="modern-group">
          <select id="glbModelSelector" class="modern-select" size="1">
            <option value="" disabled selected>Select a model...</option>
          </select>
          <button id="importGLBModel" class="modern-btn modern-btn-primary" style="margin-top: 6px;">
            <span class="modern-btn-icon">➕</span>
            <span>Load from Server</span>
          </button>
        </div>

        <div class="modern-divider">
          <span class="modern-divider-text">☁️ Upload Point Cloud (LAS/LAZ)</span>
        </div>
        <div class="modern-group">
          <input type="file" id="pointcloudFileInput" accept=".las,.laz" style="display:none;">
          <button type="button" id="pointcloudFilePickBtn" class="modern-btn modern-btn-small" style="width:100%;">
            <span class="modern-btn-icon">📁</span>
            <span id="pointcloudFileLabel">Choose LAS/LAZ file...</span>
          </button>
          <input type="text" id="pointcloudNameInput" class="zoffset-input-box" placeholder="Name" style="width:100%; margin-top:6px; box-sizing:border-box;">
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:4px; margin-top:6px;">
            <input type="number" id="pointcloudLonInput" class="zoffset-input-box" placeholder="Long (optional)" step="0.0001">
            <input type="number" id="pointcloudLatInput" class="zoffset-input-box" placeholder="Lat (optional)" step="0.0001">
          </div>
          <div class="modern-hint" style="margin-top:2px;">Leave Long/Lat empty to place it wherever the main view is currently looking</div>
          <button id="uploadPointCloudBtn" class="modern-btn modern-btn-primary" style="margin-top: 6px; width:100%;">
            <span class="modern-btn-icon">☁️</span>
            <span>Convert &amp; Upload</span>
          </button>
          <div id="pointcloudUploadStatus" class="modern-hint" style="margin-top:4px;"></div>
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

    document.getElementById('pointcloudFilePickBtn')?.addEventListener('click', () => {
      document.getElementById('pointcloudFileInput')?.click();
    });

    document.getElementById('pointcloudFileInput')?.addEventListener('change', (e) => {
      const label = document.getElementById('pointcloudFileLabel');
      const nameInput = document.getElementById('pointcloudNameInput');
      const file = e.target.files?.[0];
      if (label) label.textContent = file ? file.name : 'Choose LAS/LAZ file...';
      // Pre-fill the name field from the filename, but don't clobber a name
      // the user already typed by hand.
      if (file && nameInput && !nameInput.value) {
        nameInput.value = file.name.replace(/\.(las|laz)$/i, '');
      }
    });

    document.getElementById('uploadPointCloudBtn')?.addEventListener('click', async () => {
      const fileInput = document.getElementById('pointcloudFileInput');
      const nameInput = document.getElementById('pointcloudNameInput');
      const lonInput = document.getElementById('pointcloudLonInput');
      const latInput = document.getElementById('pointcloudLatInput');
      const statusEl = document.getElementById('pointcloudUploadStatus');
      const btn = document.getElementById('uploadPointCloudBtn');

      const file = fileInput?.files?.[0];
      if (!file) {
        if (statusEl) statusEl.textContent = 'Select a .las/.laz file first';
        return;
      }

      let lon = lonInput?.value !== '' ? parseFloat(lonInput.value) : NaN;
      let lat = latInput?.value !== '' ? parseFloat(latInput.value) : NaN;
      let height = 0;

      // No explicit coordinates typed — fall back to wherever the main view is
      // currently looking (same pick-ray-onto-globe logic loadGLBAsset() itself
      // uses as its own default). Better than leaving the tileset unpositioned,
      // which — uncorrected — renders at the raw local origin near the planet's
      // core; see project memory on the GLB point cloud work for why that matters.
      if (isNaN(lon) || isNaN(lat)) {
        const viewer = BimViewer.viewer;
        const cam = viewer.camera;
        const ray = cam.getPickRay(new Cesium.Cartesian2(
          viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2
        ));
        const hit = viewer.scene.globe.pick(ray, viewer.scene);
        if (hit) {
          const carto = Cesium.Cartographic.fromCartesian(hit);
          lon = Cesium.Math.toDegrees(carto.longitude);
          lat = Cesium.Math.toDegrees(carto.latitude);
          height = carto.height || 0;
        }
      }

      btn.disabled = true;
      if (statusEl) statusEl.textContent = 'Uploading...';

      try {
        await BimViewer.uploadPointCloud(file, {
          name: nameInput?.value || undefined,
          lon: isNaN(lon) ? null : lon,
          lat: isNaN(lat) ? null : lat,
          height: height,
          heading: 0
        });
      } catch (err) {
        if (statusEl) statusEl.textContent = `Failed: ${err.message}`;
      } finally {
        btn.disabled = false;
      }
    });
  }

  window.GEOBIM_ASSETS_UI = {
    getContent: getContent,
    initHandlers: initHandlers
  };
})();
