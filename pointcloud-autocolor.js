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
// POINT CLOUD AUTO COLOUR v1.0
// A self-hosted point cloud without colours (LAS point formats 0/1/6, many
// airborne scans) comes out of py3dtiles with RGB = (0, 0, 0) for every
// point — in the default RGB mode the cloud is black. After loading such a
// cloud this module switches the colour mode to Classification when the
// tiles carry classes, else to Intensity.
// Decided from the root tile (.pnts): its feature table says whether there
// is RGB at all, a sample of the colours whether it is all black, its batch
// table which properties exist (classification / Classification, intensity).
// The colour mode is global (pointcloud.js), so it is only changed while it
// is still the default 'rgb' — a mode the user picked stays.
// ===============================
'use strict';

(function() {

  var SAMPLE = 4096; // points checked for "all black"

  function u32(view, o) { return view.getUint32(o, true); }

  // { hasColour, props: [...] } of a .pnts file, or null
  function readPnts(buf) {
    var view = new DataView(buf);
    if (buf.byteLength < 28 || String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)) !== 'pnts') return null;
    var ftJsonLen = u32(view, 12), ftBinLen = u32(view, 16), btJsonLen = u32(view, 20);
    var dec = new TextDecoder();
    var ft = JSON.parse(dec.decode(new Uint8Array(buf, 28, ftJsonLen)) || '{}');
    var ftBin = 28 + ftJsonLen;
    var bt = btJsonLen ? JSON.parse(dec.decode(new Uint8Array(buf, ftBin + ftBinLen, btJsonLen)) || '{}') : {};
    var n = Number(ft.POINTS_LENGTH) || 0;
    var hasColour = false;
    var rgb = ft.RGB || ft.RGBA;
    if (rgb && typeof rgb.byteOffset === 'number' && n) {
      var stride = ft.RGBA ? 4 : 3;
      var bytes = new Uint8Array(buf, ftBin + rgb.byteOffset, Math.min(n, SAMPLE) * stride);
      for (var i = 0; i < bytes.length; i++) {
        if (stride === 4 && i % 4 === 3) continue; // alpha
        if (bytes[i] !== 0) { hasColour = true; break; }
      }
    } else if (ft.RGB565) {
      hasColour = true; // compressed colours: not checked, assume real
    }
    return { hasColour: hasColour, props: Object.keys(bt) };
  }

  async function rootTile(url) {
    var tsUrl = new URL(url, location.href);
    var ts = await (await fetch(tsUrl)).json();
    var content = ts.root && (ts.root.content || (ts.root.contents && ts.root.contents[0]));
    var uri = content && (content.uri || content.url);
    if (!uri || !/\.pnts(\?|$)/i.test(uri)) return null;
    var resp = await fetch(new URL(uri, tsUrl));
    if (!resp.ok) return null;
    return readPnts(await resp.arrayBuffer());
  }

  BimViewer.autoColourPointCloud = async function(assetData) {
    var url = assetData && assetData.modelDef && assetData.modelDef.file;
    if (!url || this.pointCloudSettings.colorMode !== 'rgb') return null;
    var info;
    try { info = await rootTile(url); } catch (e) { console.warn('Point cloud colour check failed:', e); return null; }
    if (!info || info.hasColour) return null;
    var lower = info.props.map(function(p) { return p.toLowerCase(); });
    var mode = lower.indexOf('classification') >= 0 ? 'classification'
             : lower.indexOf('intensity') >= 0 ? 'intensity' : null;
    if (!mode || this.pointCloudSettings.colorMode !== 'rgb') return null;
    this.setColorMode(mode);
    if (typeof this.updatePointCloudUI === 'function') this.updatePointCloudUI();
    this.updateStatus(assetData.name + ' has no colours — showing ' +
      (mode === 'classification' ? 'classes' : 'intensity'), 'info');
    return mode;
  };

  // Self-hosted tilesets (core.js loadTilesetAsset): check once the cloud is
  // recognised as a point cloud (that detection runs up to 4 s after loading)
  var origLoad = BimViewer.loadTilesetAsset;
  if (typeof origLoad === 'function') {
    BimViewer.loadTilesetAsset = async function(modelDef) {
      var r = await origLoad.apply(this, arguments);
      var ad = this.loadedAssets.get('glb_' + modelDef.id);
      if (ad && ad.modelDef === modelDef) {
        var self = this, tries = 0;
        (function wait() {
          if (!self.loadedAssets.has(ad.id) || ad._autoColourChecked) return;
          if (ad.isPointCloud) { ad._autoColourChecked = true; self.autoColourPointCloud(ad); return; }
          if (++tries < 12) setTimeout(wait, 500);
        })();
      }
      return r;
    };
  }

})();
