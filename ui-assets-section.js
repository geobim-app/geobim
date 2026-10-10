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

      <div id="glbSection" class="local-models" hidden>
        <div class="modern-divider">
          <span class="modern-divider-text">Local Models</span>
        </div>
        <div class="modern-group local-models-row">
          <select id="glbModelSelector" class="modern-select" size="1" aria-label="Model on the server">
            <option value="" disabled selected>Select a model…</option>
          </select>
          <button type="button" id="importGLBModel" class="modern-btn modern-btn-primary local-models-icon-btn" title="Load model" aria-label="Load model">
            <i data-lucide="plus"></i>
          </button>
        </div>

        <div class="modern-group local-models-upload">
          <input type="file" id="pointcloudFileInput" accept=".ifc,.las,.laz,.e57,.ply" hidden>
          <button type="button" id="pointcloudFilePickBtn" class="modern-btn modern-btn-small local-models-file-btn">
            <i data-lucide="upload"></i>
            <span id="pointcloudFileLabel">Upload IFC or point cloud…</span>
          </button>
          <div id="pointcloudUploadForm" class="local-models-form" hidden>
            <input type="text" id="pointcloudNameInput" class="zoffset-input-box" placeholder="Name" aria-label="Name">
            <details class="local-models-georef">
              <summary>Georeferencing (optional)</summary>
              <div class="modern-hint">Georeferenced files place themselves. Otherwise the model lands at Lon/Lat, or at the centre of the view.</div>
              <div class="upload-georef-grid">
                <input type="number" id="pointcloudLonInput" class="zoffset-input-box" placeholder="Lon" step="0.0001" aria-label="Longitude">
                <input type="number" id="pointcloudLatInput" class="zoffset-input-box" placeholder="Lat" step="0.0001" aria-label="Latitude">
                <input type="text" id="pointcloudEpsgInput" class="zoffset-input-box" placeholder="EPSG" inputmode="numeric" aria-label="EPSG code"
                       title="CRS of the coordinates, e.g. 25832 — for IFC optionally with vertical datum: 25832+7837 (UTM 32N + DHHN2016)">
                <input type="text" id="pointcloudRefHeightInput" class="zoffset-input-box" placeholder="±0.00 m a.s.l." inputmode="decimal" aria-label="Height of ±0.00 above sea level"
                       title="Height of ±0.00 (IFC z = 0) above sea level, e.g. 112.35 — only for IFC files without absolute heights">
              </div>
            </details>
            <button type="button" id="uploadPointCloudBtn" class="modern-btn modern-btn-primary">
              <i data-lucide="cloud-upload"></i>
              <span>Convert &amp; upload</span>
            </button>
          </div>
          <div id="pointcloudUploadStatus" class="modern-hint local-models-status" role="status" hidden></div>
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

  // Fill the Ion asset <select>, grouped by the assets' Cesium ion labels:
  // one <optgroup> per label, alphabetical, unlabelled assets last. An asset
  // with several labels is listed under its first one. With fewer than two
  // groups the list stays flat — e.g. the guest list, where every asset
  // carries the "demo" label.
  function fillIonAssetSelector(selector, assets, placeholder) {
    selector.innerHTML = '';
    const first = document.createElement('option');
    first.value = '';
    first.textContent = placeholder;
    selector.appendChild(first);

    const toOption = asset => {
      const option = document.createElement('option');
      option.value = asset.id;
      option.textContent = asset.name;
      return option;
    };

    const groups = new Map();
    assets.forEach(asset => {
      const label = Array.isArray(asset.labels) && asset.labels[0] ? asset.labels[0].name : '';
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(asset);
    });

    if (groups.size < 2) {
      assets.forEach(asset => selector.appendChild(toOption(asset)));
      return;
    }

    const names = [...groups.keys()].filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    if (groups.has('')) names.push('');
    names.forEach(name => {
      const group = document.createElement('optgroup');
      group.label = name || 'Unlabelled';
      groups.get(name).forEach(asset => group.appendChild(toOption(asset)));
      selector.appendChild(group);
    });
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
          : BimViewer.demoIonAssets(allAssets);

        fillIonAssetSelector(selector, assets, '-- Select an asset --');

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

    // Local models (owner only) — auth may not be resolved at init time
    const glbSection = document.getElementById('glbSection');
    const glbSelector = document.getElementById('glbModelSelector');
    const initGLBSection = async () => {
      if (!BimViewer.isLabUser() || !glbSelector) return;
      if (glbSection) glbSection.hidden = false;
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
      if (!glbSelector || !glbSelector.value) return;
      const modelDef = BimViewer.glbModels.find(m => m.id === glbSelector.value);
      if (modelDef) BimViewer.loadGLBAsset(modelDef);
    });

    // --- Upload & convert ---
    const fileInput = document.getElementById('pointcloudFileInput');
    const fileLabel = document.getElementById('pointcloudFileLabel');
    const form = document.getElementById('pointcloudUploadForm');
    const nameInput = document.getElementById('pointcloudNameInput');
    const lonInput = document.getElementById('pointcloudLonInput');
    const latInput = document.getElementById('pointcloudLatInput');
    const epsgInput = document.getElementById('pointcloudEpsgInput');
    const refHeightInput = document.getElementById('pointcloudRefHeightInput');
    const statusEl = document.getElementById('pointcloudUploadStatus');
    const FILE_LABEL = 'Upload IFC or point cloud…';

    // 'ifc' | 'las' (LAS/LAZ, may carry a CRS) | 'scan' (E57/PLY, local scans)
    const fileKind = name => {
      const ext = (name.split('.').pop() || '').toLowerCase();
      return ext === 'ifc' ? 'ifc' : (ext === 'las' || ext === 'laz') ? 'las' : 'scan';
    };
    const showStatus = text => {
      if (!statusEl) return;
      statusEl.textContent = text || '';
      statusEl.hidden = !text;
    };
    const resetUploadForm = () => {
      if (fileInput) fileInput.value = '';
      if (fileLabel) fileLabel.textContent = FILE_LABEL;
      [nameInput, lonInput, latInput, epsgInput, refHeightInput].forEach(el => { if (el) el.value = ''; });
      if (form) form.hidden = true;
    };

    document.getElementById('pointcloudFilePickBtn')?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) { resetUploadForm(); return; }
      const kind = fileKind(file.name);
      const mb = file.size / 1024 ** 2;
      if (fileLabel) fileLabel.textContent = `${file.name} (${mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb.toFixed(1) + ' MB'})`;
      // Name from the filename; a new file replaces the previous file's name
      if (nameInput) nameInput.value = file.name.replace(/\.(las|laz|e57|ply|ifc)$/i, '');
      // EPSG applies to IFC and LAS/LAZ, ±0.00 to IFC only
      if (epsgInput) epsgInput.hidden = kind === 'scan';
      if (refHeightInput) refHeightInput.hidden = kind !== 'ifc';
      if (form) form.hidden = false;
      showStatus('');
    });

    document.getElementById('uploadPointCloudBtn')?.addEventListener('click', async () => {
      const btn = document.getElementById('uploadPointCloudBtn');
      const file = fileInput?.files?.[0];
      if (!file) { showStatus('Choose a file first'); return; }
      const kind = fileKind(file.name);

      const lonText = (lonInput?.value || '').trim();
      const latText = (latInput?.value || '').trim();
      if (!!lonText !== !!latText) { showStatus('Enter both Lon and Lat, or neither'); return; }
      let lon = lonText ? parseFloat(lonText) : NaN;
      let lat = latText ? parseFloat(latText) : NaN;
      if (lonText && (!(lon >= -180 && lon <= 180) || !(lat >= -90 && lat <= 90))) {
        showStatus('Lon must be within ±180°, Lat within ±90°');
        return;
      }
      let height = 0;
      let positionSource = 'manual';

      // No coordinates typed: fall back to the centre of the view (same
      // pick-ray-onto-globe logic loadGLBAsset() uses). The server only uses
      // it for files without georeferencing; an unloaded globe can return
      // nonsense heights, so those are dropped here.
      if (!lonText) {
        positionSource = 'view';
        const viewer = BimViewer.viewer;
        const ray = viewer.camera.getPickRay(new Cesium.Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2));
        const hit = ray && viewer.scene.globe.pick(ray, viewer.scene);
        if (hit) {
          const carto = Cesium.Cartographic.fromCartesian(hit);
          lon = Cesium.Math.toDegrees(carto.longitude);
          lat = Cesium.Math.toDegrees(carto.latitude);
          height = carto.height >= -500 && carto.height <= 9000 ? carto.height : 0;
        }
      }

      btn.disabled = true;
      showStatus('');
      try {
        await BimViewer.uploadPointCloud(file, {
          kind: kind,
          name: nameInput?.value.trim() || undefined,
          lon: isNaN(lon) ? null : lon,
          lat: isNaN(lat) ? null : lat,
          height: height,
          heading: 0,
          positionSource: positionSource,
          epsg: kind !== 'scan' ? (epsgInput?.value || '').trim() || undefined : undefined,
          refHeight: kind === 'ifc' ? (refHeightInput?.value || '').trim().replace(',', '.') || undefined : undefined
        });
        // The conversion runs on; its progress shows in the status line
        resetUploadForm();
      } catch (err) {
        showStatus(`Upload failed: ${err.message}`);
      } finally {
        btn.disabled = false;
      }
    });
  }

  window.GEOBIM_ASSETS_UI = {
    getContent: getContent,
    initHandlers: initHandlers,
    fillIonAssetSelector: fillIonAssetSelector
  };
})();
