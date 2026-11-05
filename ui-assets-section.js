/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

(function() {
  'use strict';

  function getContent() {
    return `
      <div class="modern-group">
        <div class="modern-label"><span class="modern-label-with-icon"><i data-lucide="globe"></i>Cesium Ion Assets</span></div>
        <div id="ionAssetsLoading" class="modern-hint" style="text-align: center; padding: 12px;">
          <span class="modern-hint-with-icon"><i data-lucide="loader"></i>Loading assets...</span>
        </div>

        <select id="ionAssetSelector" class="modern-select" multiple size="6" style="display: none;">
        </select>

        <button id="importSelectedAsset" class="modern-btn modern-btn-primary" style="display: none;">
          <span class="modern-btn-icon"><i data-lucide="plus"></i></span>
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

        <div class="modern-group local-models-upload" data-own-drop>
          <input type="file" id="pointcloudFileInput" accept=".ifc,.las,.laz,.e57,.ply" hidden>
          <button type="button" id="pointcloudDropZone" class="upload-dropzone" aria-describedby="pointcloudDropFormats">
            <span class="upload-dropzone-icon"><i data-lucide="cloud-upload"></i></span>
            <span class="upload-dropzone-title">Drop IFC or point cloud here</span>
            <span class="upload-dropzone-sub">or <span class="upload-dropzone-link">browse files</span> · converted to 3D Tiles</span>
            <span id="pointcloudDropFormats" class="upload-dropzone-formats" aria-label="Supported formats: IFC, LAS, LAZ, E57, PLY">
              <span class="upload-chip upload-chip-ifc">IFC</span>
              <span class="upload-chip">LAS</span>
              <span class="upload-chip">LAZ</span>
              <span class="upload-chip">E57</span>
              <span class="upload-chip">PLY</span>
            </span>
          </button>

          <div id="pointcloudUploadForm" class="local-models-form" hidden>
            <div class="upload-file-card">
              <span id="pointcloudFileIcon" class="upload-file-icon"><i data-lucide="file"></i></span>
              <span class="upload-file-meta">
                <span id="pointcloudFileLabel" class="upload-file-name"></span>
                <span id="pointcloudFileInfo" class="upload-file-info"></span>
              </span>
              <button type="button" id="pointcloudFileClearBtn" class="upload-file-clear" title="Remove file" aria-label="Remove file">
                <i data-lucide="x"></i>
              </button>
            </div>

            <label class="upload-field">
              <span class="upload-field-label">Name</span>
              <input type="text" id="pointcloudNameInput" class="zoffset-input-box" placeholder="Model name">
            </label>

            <details class="local-models-georef">
              <summary><i data-lucide="map-pin"></i><span>Georeferencing</span><span class="upload-optional">optional</span></summary>
              <div class="modern-hint">Georeferenced files place themselves. Otherwise the model lands at Lon/Lat, or at the centre of the view.</div>
              <div class="upload-georef-grid">
                <label class="upload-field">
                  <span class="upload-field-label">Longitude</span>
                  <input type="number" id="pointcloudLonInput" class="zoffset-input-box" placeholder="7.0982" step="0.0001">
                </label>
                <label class="upload-field">
                  <span class="upload-field-label">Latitude</span>
                  <input type="number" id="pointcloudLatInput" class="zoffset-input-box" placeholder="50.7374" step="0.0001">
                </label>
                <label class="upload-field" title="CRS of the coordinates, e.g. 25832 — for IFC optionally with vertical datum: 25832+7837 (UTM 32N + DHHN2016)">
                  <span class="upload-field-label">EPSG</span>
                  <input type="text" id="pointcloudEpsgInput" class="zoffset-input-box" placeholder="25832" inputmode="numeric">
                </label>
                <label class="upload-field" title="Height of ±0.00 (IFC z = 0) above sea level, e.g. 112.35 — only for IFC files without absolute heights">
                  <span class="upload-field-label">±0.00 (m a.s.l.)</span>
                  <input type="text" id="pointcloudRefHeightInput" class="zoffset-input-box" placeholder="112.35" inputmode="decimal">
                </label>
                <label class="upload-field upload-height-datum" title="Heights in the file: above sea level (NHN, EVRS, …) are converted to the ellipsoid; choose ellipsoidal when the file already has GPS heights">
                  <span class="upload-field-label">Heights in the file</span>
                  <select id="pointcloudHeightDatumSelect" class="modern-select">
                    <option value="auto">Above sea level</option>
                    <option value="ellipsoid">Ellipsoidal (GPS)</option>
                  </select>
                </label>
              </div>
            </details>

            <button type="button" id="uploadPointCloudBtn" class="modern-btn modern-btn-primary upload-submit">
              <i data-lucide="cloud-upload"></i>
              <span>Convert &amp; upload</span>
            </button>
          </div>
          <div id="pointcloudUploadStatus" class="local-models-status" role="status" hidden></div>
        </div>
      </div>

      <div class="modern-group" style="margin-top: 8px;">
        <button class="modern-btn modern-btn-small" onclick="BimViewer.toggleLoadedAssetsPanel()" title="Show/hide Loaded Assets panel">
          <span class="modern-btn-icon"><i data-lucide="package"></i></span>
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
        btn.innerHTML = '<span class="modern-btn-icon"><i data-lucide="loader"></i></span><span>Loading...</span>';
        if (window.lucide) lucide.createIcons();
        btn.disabled = true;

        const allAssets = await BimViewer.fetchAvailableAssets();
        var isOAuth = typeof BimIonAuth !== 'undefined' && BimIonAuth.isOAuthConnected();
        const assets = isOAuth
          ? allAssets.filter(asset => asset.type === '3DTILES' || asset.type === 'GLTF')
          : BimViewer.demoIonAssets(allAssets);

        fillIonAssetSelector(selector, assets, '-- Select an asset --');

        importBtn.disabled = false;
        btn.innerHTML = '<span class="modern-btn-icon"><i data-lucide="check"></i></span><span>Assets Loaded</span>';
        if (window.lucide) lucide.createIcons();

        setTimeout(() => {
          btn.innerHTML = '<span class="modern-btn-icon"><i data-lucide="globe"></i></span><span>Load Ion Assets</span>';
          if (window.lucide) lucide.createIcons();
          btn.disabled = false;
        }, 2000);

        BimViewer.updateStatus(`${assets.length} assets loaded`, 'success');
      } catch (error) {
        console.error('Failed to load assets:', error);
        btn.innerHTML = '<span class="modern-btn-icon"><i data-lucide="x-circle"></i></span><span>Failed</span>';
        if (window.lucide) lucide.createIcons();
        setTimeout(() => {
          btn.innerHTML = '<span class="modern-btn-icon"><i data-lucide="globe"></i></span><span>Load Ion Assets</span>';
          if (window.lucide) lucide.createIcons();
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

    // Local models (owner: all, guests: model/guest-models.json, see
    // api/models.php) — auth may not be resolved at init time
    const glbSection = document.getElementById('glbSection');
    const glbSelector = document.getElementById('glbModelSelector');
    const isGuest = () => typeof BimGuest !== 'undefined' && BimGuest.active();
    const initGLBSection = async () => {
      if (!(BimViewer.isLabUser() || isGuest()) || !glbSelector) return;
      if (glbSection) glbSection.hidden = false;
      if (glbSelector.options.length <= 1) {
        if (!BimViewer.glbModels.length && BimViewer.fetchGLBModels) {
          await BimViewer.fetchGLBModels();
        }
        // several calls may await at once (timers, geobim-guest-start): fill once
        if (glbSelector.options.length > 1) return;
        BimViewer.glbModels.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = m.name;
          glbSelector.appendChild(opt);
        });
      }
    };
    initGLBSection();
    window.addEventListener('geobim-guest-start', initGLBSection);
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
    const heightDatumSelect = document.getElementById('pointcloudHeightDatumSelect');
    const statusEl = document.getElementById('pointcloudUploadStatus');
    const uploadBox = document.querySelector('.local-models-upload');
    const dropZone = document.getElementById('pointcloudDropZone');
    const fileInfo = document.getElementById('pointcloudFileInfo');
    const fileIcon = document.getElementById('pointcloudFileIcon');
    const UPLOAD_EXT = /\.(ifc|las|laz|e57|ply)$/i;
    const KIND_INFO = {
      ifc:  { icon: 'building-2', label: 'IFC model' },
      las:  { icon: 'scan-line',  label: 'Point cloud (LAS/LAZ)' },
      scan: { icon: 'scan-line',  label: 'Point cloud (E57/PLY)' }
    };
    // The file to upload: picked via the input or dropped (a drop can't be
    // put into fileInput.files on every browser, so it's kept here)
    let selectedFile = null;

    // 'ifc' | 'las' (LAS/LAZ, may carry a CRS) | 'scan' (E57/PLY, local scans)
    const fileKind = name => {
      const ext = (name.split('.').pop() || '').toLowerCase();
      return ext === 'ifc' ? 'ifc' : (ext === 'las' || ext === 'laz') ? 'las' : 'scan';
    };
    const formatSize = bytes => {
      const mb = bytes / 1024 ** 2;
      return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
    };
    const showStatus = (text, state) => {
      if (!statusEl) return;
      statusEl.textContent = text || '';
      statusEl.dataset.state = state || 'info';
      statusEl.hidden = !text;
    };
    // Toggle a field together with its label (the label wraps the input)
    const showField = (el, show) => {
      const field = el?.closest('.upload-field') || el;
      if (field) field.hidden = !show;
    };
    const resetUploadForm = () => {
      selectedFile = null;
      if (fileInput) fileInput.value = '';
      if (fileLabel) fileLabel.textContent = '';
      if (fileInfo) fileInfo.textContent = '';
      [nameInput, lonInput, latInput, epsgInput, refHeightInput].forEach(el => { if (el) el.value = ''; });
      if (heightDatumSelect) heightDatumSelect.value = 'auto';
      if (form) form.hidden = true;
      if (dropZone) dropZone.hidden = false;
    };

    const selectFile = file => {
      if (!file) { resetUploadForm(); return; }
      if (!UPLOAD_EXT.test(file.name)) {
        showStatus(`${file.name}: not supported — use IFC, LAS, LAZ, E57 or PLY`, 'error');
        return;
      }
      selectedFile = file;
      const kind = fileKind(file.name);
      if (fileLabel) { fileLabel.textContent = file.name; fileLabel.title = file.name; }
      if (fileInfo) fileInfo.textContent = `${KIND_INFO[kind].label} · ${formatSize(file.size)}`;
      if (fileIcon) {
        fileIcon.dataset.kind = kind;
        fileIcon.innerHTML = `<i data-lucide="${KIND_INFO[kind].icon}"></i>`;
        if (window.lucide) lucide.createIcons();
      }
      // Name from the filename; a new file replaces the previous file's name
      if (nameInput) nameInput.value = file.name.replace(UPLOAD_EXT, '');
      // EPSG applies to IFC and LAS/LAZ, ±0.00 and height datum to IFC only
      showField(epsgInput, kind !== 'scan');
      showField(refHeightInput, kind === 'ifc');
      showField(heightDatumSelect, kind === 'ifc');
      if (form) form.hidden = false;
      if (dropZone) dropZone.hidden = true;
      showStatus('');
    };

    dropZone?.addEventListener('click', () => fileInput?.click());
    document.getElementById('pointcloudFileClearBtn')?.addEventListener('click', () => {
      resetUploadForm();
      dropZone?.focus();
    });
    fileInput?.addEventListener('change', () => selectFile(fileInput.files?.[0]));

    // --- Drag & drop onto the upload box ---
    // data-own-drop on the box makes gis-files.js leave these drops alone
    const filesOf = e => Array.from(e.dataTransfer?.files || []);
    const hasFiles = e => Array.from(e.dataTransfer?.types || []).includes('Files');
    const busy = () => !!document.getElementById('uploadPointCloudBtn')?.disabled;
    let boxDepth = 0;
    if (uploadBox) {
      uploadBox.addEventListener('dragenter', e => {
        if (!hasFiles(e)) return;
        boxDepth++;
        uploadBox.classList.add('is-dragover');
      });
      uploadBox.addEventListener('dragleave', e => {
        if (!hasFiles(e)) return;
        boxDepth = Math.max(0, boxDepth - 1);
        if (!boxDepth) uploadBox.classList.remove('is-dragover');
      });
      uploadBox.addEventListener('dragover', e => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = busy() ? 'none' : 'copy';
      });
      uploadBox.addEventListener('drop', e => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        boxDepth = 0;
        uploadBox.classList.remove('is-dragover');
        if (busy()) { showStatus('An upload is running — wait until it has been sent', 'error'); return; }
        const files = filesOf(e);
        selectFile(files.find(f => UPLOAD_EXT.test(f.name)) || files[0]);
      });
    }

    // Upload available for this user? (owner section shown, Cesium ion on)
    const uploadAvailable = () => !!uploadBox && !!glbSection && !glbSection.hidden &&
      !document.body.classList.contains('no-ion');
    BimViewer.uploadDropAvailable = uploadAvailable;

    // --- Drag & drop anywhere on the page (e.g. onto the map) ---
    // Runs in the capture phase before gis-files.js; it skips drops that
    // were already handled (defaultPrevented). GIS files still go there.
    window.addEventListener('drop', e => {
      if (!hasFiles(e) || !uploadAvailable()) return;
      if (e.target?.closest?.('input[type="file"], [data-own-drop]')) return;
      const file = filesOf(e).find(f => UPLOAD_EXT.test(f.name));
      if (!file) return;
      e.preventDefault();
      if (busy()) { showStatus('An upload is running — wait until it has been sent', 'error'); return; }
      // Bring the form into view: sidebar open, Assets section expanded
      const toolbar = document.getElementById('toolbar');
      if (toolbar?.classList.contains('collapsed')) document.getElementById('sidebarToggle')?.click();
      if (typeof BimViewerUI !== 'undefined' && BimViewerUI.toggleSection) BimViewerUI.toggleSection('assets', true);
      // Panel layout: open the tree nodes around the box (panels-tree.js expand())
      for (let b = uploadBox.closest('.pnl-branch'); b; b = b.parentElement?.closest('.pnl-branch')) {
        if (typeof b.expand === 'function') b.expand();
      }
      selectFile(file);
      setTimeout(() => {
        uploadBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        nameInput?.focus({ preventScroll: true });
      }, 50);
    }, true);

    document.getElementById('uploadPointCloudBtn')?.addEventListener('click', async () => {
      const btn = document.getElementById('uploadPointCloudBtn');
      const file = selectedFile;
      if (!file) { showStatus('Choose a file first', 'error'); return; }
      const kind = fileKind(file.name);

      const lonText = (lonInput?.value || '').trim();
      const latText = (latInput?.value || '').trim();
      if (!!lonText !== !!latText) { showStatus('Enter both Lon and Lat, or neither', 'error'); return; }
      let lon = lonText ? parseFloat(lonText) : NaN;
      let lat = latText ? parseFloat(latText) : NaN;
      if (lonText && (!(lon >= -180 && lon <= 180) || !(lat >= -90 && lat <= 90))) {
        showStatus('Lon must be within ±180°, Lat within ±90°', 'error');
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
      form?.classList.add('is-busy');
      form?.querySelectorAll('input, select, .upload-file-clear').forEach(el => { el.disabled = true; });
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
          refHeight: kind === 'ifc' ? (refHeightInput?.value || '').trim().replace(',', '.') || undefined : undefined,
          heightDatum: kind === 'ifc' && heightDatumSelect?.value === 'ellipsoid' ? 'ellipsoid' : undefined
        });
        // The conversion runs on; its progress shows in the status line
        resetUploadForm();
      } catch (err) {
        showStatus(`Upload failed: ${err.message}`, 'error');
      } finally {
        btn.disabled = false;
        form?.classList.remove('is-busy');
        form?.querySelectorAll('input, select, .upload-file-clear').forEach(el => { el.disabled = false; });
      }
    });
  }

  window.GEOBIM_ASSETS_UI = {
    getContent: getContent,
    initHandlers: initHandlers,
    fillIonAssetSelector: fillIonAssetSelector
  };
})();
