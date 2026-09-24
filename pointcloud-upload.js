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
// POINT CLOUD UPLOAD MODULE
// Browser upload of raw LAS/LAZ/E57/PLY point clouds -> server-side py3dtiles
// conversion (api/pointcloud-upload.php + scripts/convert_pointcloud.py,
// queued one-at-a-time on the server) -> auto-discovered as a TILESET asset
// (api/models.php) once done, loadable exactly like any self-hosted tileset.
// UI wiring lives in ui-assets-section.js (labUsers-gated, same section as
// the local GLB model list).
// ===============================
'use strict';

(function() {

  let pollTimer = null;

  // fetch() can't report upload progress; XHR's upload.onprogress can. Resolves
  // with { ok, status, body } where body is the parsed JSON reply (or {}).
  function postWithProgress(url, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded, e.total); };
      xhr.upload.onload = () => onProgress(null, null);  // all bytes sent, server still busy
      xhr.onload = () => {
        let body = {};
        try { body = JSON.parse(xhr.responseText); } catch (_) { /* non-JSON error page */ }
        resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, body });
      };
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.onabort = () => reject(new Error('Upload aborted'));
      xhr.send(formData);
    });
  }

  function formatBytes(bytes) {
    return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
  }

  function formatDuration(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '';
    if (seconds < 90) return `${Math.round(seconds)} s`;
    const m = Math.round(seconds / 60);
    return m < 90 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
  }

  // Progress bar under #pointcloudUploadStatus: bytes, percent, rate and time
  // left (rate smoothed over the last ~10 s so the estimate doesn't jump).
  function createUploadProgress() {
    const statusEl = document.getElementById('pointcloudUploadStatus');
    const wrap = document.createElement('div');
    wrap.className = 'pc-upload-progress';
    wrap.innerHTML =
      '<div class="pc-upload-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
      '<div class="pc-upload-progress-fill"></div></div>' +
      '<div class="pc-upload-progress-text">Starting upload…</div>';
    statusEl?.after(wrap);
    const track = wrap.querySelector('.pc-upload-progress-track');
    const fill = wrap.querySelector('.pc-upload-progress-fill');
    const text = wrap.querySelector('.pc-upload-progress-text');
    const samples = [];

    return {
      update(loaded, total) {
        if (loaded === null) {
          fill.style.width = '100%';
          track.setAttribute('aria-valuenow', '100');
          text.textContent = 'Upload complete — server is storing the file…';
          return;
        }
        const now = performance.now();
        samples.push([now, loaded]);
        while (samples.length > 2 && now - samples[0][0] > 10000) samples.shift();
        const [t0, b0] = samples[0];
        const rate = now > t0 ? (loaded - b0) / ((now - t0) / 1000) : 0;
        const pct = total ? (loaded / total) * 100 : 0;
        fill.style.width = `${pct.toFixed(1)}%`;
        track.setAttribute('aria-valuenow', pct.toFixed(0));
        const eta = rate > 0 ? formatDuration((total - loaded) / rate) : '';
        text.textContent = `${formatBytes(loaded)} / ${formatBytes(total)} (${pct.toFixed(0)} %)` +
          (rate > 0 ? ` · ${(rate / 1024 ** 2).toFixed(1)} MB/s` : '') +
          (eta ? ` · ~${eta} left` : '');
      },
      remove() { wrap.remove(); },
    };
  }

  // opts: { name, lon, lat, height, heading } — lon/lat/height/heading are
  // optional; when provided (non-null), the server bakes them into the
  // resulting tileset's root.transform (see scripts/convert_pointcloud.py).
  BimViewer.uploadPointCloud = async function(file, opts) {
    opts = opts || {};
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', opts.name || file.name.replace(/\.(las|laz|e57|ply|ifc)$/i, ''));
    if (opts.lon !== undefined && opts.lon !== null && !isNaN(opts.lon)) {
      formData.append('lon', opts.lon);
      formData.append('lat', opts.lat);
      formData.append('height', opts.height ?? 0);
      formData.append('heading', opts.heading ?? 0);
    }

    this.updateStatus('Uploading point cloud...', 'loading');

    const progress = createUploadProgress();
    let resp;
    try {
      resp = await postWithProgress('api/pointcloud-upload.php', formData, progress.update);
    } catch (err) {
      progress.remove();
      this.updateStatus(`Upload failed: ${err.message}`, 'error');
      throw err;
    }
    progress.remove();
    if (!resp.ok) {
      const msg = resp.body.error || `HTTP ${resp.status}`;
      this.updateStatus(`Upload failed: ${msg}`, 'error');
      throw new Error(msg);
    }

    const { jobId, slug } = resp.body;
    this.updateStatus('Converting point cloud — this can take a while for large files...', 'loading');
    this._pollPointCloudJob(jobId, slug);
    return jobId;
  };

  // The "Local Models" dropdown (ui-assets-section.js) is filled once at page
  // load; add any model discovered since then so a fresh conversion is
  // selectable without reloading.
  function syncLocalModelSelector() {
    const selector = document.getElementById('glbModelSelector');
    if (!selector) return;
    const present = new Set(Array.from(selector.options, o => o.value));
    BimViewer.glbModels.forEach(m => {
      if (present.has(m.id)) return;
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      selector.appendChild(opt);
    });
  }

  BimViewer._pollPointCloudJob = function(jobId, slug) {
    if (pollTimer) clearInterval(pollTimer);

    pollTimer = setInterval(async () => {
      let status;
      try {
        const resp = await fetch(`api/pointcloud-status.php?job=${encodeURIComponent(jobId)}`);
        if (!resp.ok) return; // transient — try again next tick
        status = await resp.json();
      } catch (err) {
        return; // network hiccup — try again next tick
      }

      const statusEl = document.getElementById('pointcloudUploadStatus');

      if (status.status === 'queued') {
        if (statusEl) statusEl.textContent = 'Queued (waiting for another conversion to finish)...';
      } else if (status.status === 'converting') {
        if (statusEl) statusEl.textContent = (status.progress ? `Converting: ${status.progress}` : 'Converting...') + (status.warning ? ` (${status.warning})` : '');
      } else if (status.status === 'done') {
        clearInterval(pollTimer);
        pollTimer = null;
        if (statusEl) statusEl.textContent = '';
        BimViewer.updateStatus(`Point cloud ready: ${slug}`, 'success');
        console.log(`✅ Point cloud conversion done: ${slug}`);
        // Refresh the local model catalog so the new tileset shows up, then load it.
        if (typeof BimViewer.fetchGLBModels === 'function') {
          BimViewer.fetchGLBModels().then(() => {
            syncLocalModelSelector();
            const modelDef = BimViewer.glbModels.find(m => m.id === slug);
            if (modelDef && typeof BimViewer.loadGLBAsset === 'function') {
              BimViewer.loadGLBAsset(modelDef);
            }
          });
        }
      } else if (status.status === 'error') {
        clearInterval(pollTimer);
        pollTimer = null;
        if (statusEl) statusEl.textContent = '';
        BimViewer.updateStatus(`Point cloud conversion failed: ${status.message || 'unknown error'}`, 'error');
        console.error(`❌ Point cloud conversion failed (${jobId}):`, status.message);
      }
    }, 3000);
  };

  console.log('✅ Point Cloud Upload module loaded');

})();
