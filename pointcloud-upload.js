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
// Browser upload of raw LAS/LAZ point clouds -> server-side py3dtiles
// conversion (api/pointcloud-upload.php + scripts/convert_pointcloud.py,
// queued one-at-a-time on the server) -> auto-discovered as a TILESET asset
// (api/models.php) once done, loadable exactly like any self-hosted tileset.
// UI wiring lives in ui-assets-section.js (labUsers-gated, same section as
// the local GLB model list).
// ===============================
'use strict';

(function() {

  let pollTimer = null;

  // opts: { name, lon, lat, height, heading } — lon/lat/height/heading are
  // optional; when provided (non-null), the server bakes them into the
  // resulting tileset's root.transform (see scripts/convert_pointcloud.py).
  BimViewer.uploadPointCloud = async function(file, opts) {
    opts = opts || {};
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', opts.name || file.name.replace(/\.(las|laz)$/i, ''));
    if (opts.lon !== undefined && opts.lon !== null && !isNaN(opts.lon)) {
      formData.append('lon', opts.lon);
      formData.append('lat', opts.lat);
      formData.append('height', opts.height ?? 0);
      formData.append('heading', opts.heading ?? 0);
    }

    this.updateStatus('Uploading point cloud...', 'loading');

    let resp;
    try {
      resp = await fetch('api/pointcloud-upload.php', { method: 'POST', body: formData });
    } catch (err) {
      this.updateStatus(`Upload failed: ${err.message}`, 'error');
      throw err;
    }
    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      const msg = errBody.error || `HTTP ${resp.status}`;
      this.updateStatus(`Upload failed: ${msg}`, 'error');
      throw new Error(msg);
    }

    const { jobId, slug } = await resp.json();
    this.updateStatus('Converting point cloud — this can take a while for large files...', 'loading');
    this._pollPointCloudJob(jobId, slug);
    return jobId;
  };

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
        if (statusEl) statusEl.textContent = 'Converting...' + (status.warning ? ` (${status.warning})` : '');
      } else if (status.status === 'done') {
        clearInterval(pollTimer);
        pollTimer = null;
        if (statusEl) statusEl.textContent = '';
        BimViewer.updateStatus(`Point cloud ready: ${slug}`, 'success');
        console.log(`✅ Point cloud conversion done: ${slug}`);
        // Refresh the local model catalog so the new tileset shows up, then load it.
        if (typeof BimViewer.fetchGLBModels === 'function') {
          BimViewer.fetchGLBModels().then(() => {
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
