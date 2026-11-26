/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// ===============================
// RENDER RESOLUTION — device pixels per performance preset
// ===============================
// Cesium renders at CSS pixel resolution by default: useBrowserRecommendedResolution
// (true) ignores window.devicePixelRatio. On a HiDPI screen (devicePixelRatio 2)
// that is a quarter of the screen's pixels, scaled up. With that default kept,
// viewer.resolutionScale is the number of render pixels per CSS pixel, so every
// preset (core.js) sets it to
//   max(1, min(devicePixelRatio × supersampling, maxPixelRatio))
// Performance stays at 1.0 as before, Balanced goes up to 1.5, Quality and Ultra
// up to 2. Never below 1.0, so no preset renders coarser than before. The ratio
// follows the screen when the window moves to another monitor or the browser
// zoom changes.
'use strict';

(function(BimViewer) {

  var mediaQuery = null;

  function devicePixelRatio() {
    var dpr = window.devicePixelRatio;
    return (typeof dpr === 'number' && dpr > 0) ? dpr : 1;
  }

  // Render pixels per CSS pixel for a preset
  BimViewer.targetPixelRatio = function(settings) {
    var s = settings || {};
    var cap = s.maxPixelRatio > 0 ? s.maxPixelRatio : 1;
    var supersampling = s.supersampling > 0 ? s.supersampling : 1;
    return Math.max(1, Math.min(devicePixelRatio() * supersampling, cap));
  };

  // Render pixels per CSS pixel as set now (Cesium's scene.pixelRatio from the
  // next frame on)
  BimViewer.getRenderPixelRatio = function() {
    var viewer = this.viewer;
    if (!viewer) return 1;
    var scale = viewer.resolutionScale || 1;
    return viewer.useBrowserRecommendedResolution === false ? scale * devicePixelRatio() : scale;
  };

  BimViewer.applyRenderResolution = function(settings) {
    var viewer = this.viewer;
    if (!viewer) return;

    var ratio = this.targetPixelRatio(settings);
    var scale = viewer.useBrowserRecommendedResolution === false ? ratio / devicePixelRatio() : ratio;
    var changed = viewer.resolutionScale !== scale;
    viewer.resolutionScale = scale;

    if (changed) {
      refreshFixedPointSizes();
      console.log('Render resolution: ' + ratio.toFixed(2) + ' px per CSS px (devicePixelRatio ' +
        devicePixelRatio().toFixed(2) + ')');
    }
    watchDevicePixelRatio();
  };

  // Fixed point sizes are render pixels: pointcloud.js multiplies them by the
  // ratio, so its styles are rebuilt when the ratio changes
  function refreshFixedPointSizes() {
    var settings = BimViewer.pointCloudSettings;
    if (!settings || settings.sizeMode !== 'fixed' || !BimViewer.loadedAssets) return;
    if (typeof BimViewer.applyColorMode !== 'function' || typeof BimViewer.isPointCloudTileset !== 'function') return;

    BimViewer.loadedAssets.forEach(function(asset) {
      var tileset = asset.tileset;
      if (tileset && !tileset.isDestroyed() && BimViewer.isPointCloudTileset(tileset)) {
        BimViewer.applyColorMode(tileset, settings.colorMode);
      }
    });
  }

  // The media query matches a narrow band around the current ratio, so it fires
  // once on any change and is registered anew for the next one. A band, not
  // `(resolution: <ratio>dppx)`: devicePixelRatio carries float noise
  // (1.0000000447) that an exact query never matches, and then never fires.
  // Browsers without dppx ranges still get the resize check below (browser zoom
  // and a move to another monitor both resize the viewport in CSS pixels).
  var watchedRatio = null;

  function watchDevicePixelRatio() {
    watchedRatio = devicePixelRatio();
    if (!window.matchMedia) return;
    if (mediaQuery) {
      if (mediaQuery.removeEventListener) mediaQuery.removeEventListener('change', onDevicePixelRatioChange);
      else mediaQuery.removeListener(onDevicePixelRatioChange);
    }
    mediaQuery = window.matchMedia('(min-resolution: ' + (watchedRatio - 0.01).toFixed(4) +
      'dppx) and (max-resolution: ' + (watchedRatio + 0.01).toFixed(4) + 'dppx)');
    if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', onDevicePixelRatioChange);
    else mediaQuery.addListener(onDevicePixelRatioChange);
  }

  function onDevicePixelRatioChange() {
    if (devicePixelRatio() === watchedRatio) return;
    var settings = BimViewer._currentPerformanceSettings;
    if (settings) BimViewer.applyRenderResolution(settings);
    else watchDevicePixelRatio();
  }

  window.addEventListener('resize', function() {
    if (watchedRatio !== null) onDevicePixelRatioChange();
  });

  console.log('Render resolution module loaded');

})(window.BimViewer = window.BimViewer || {});
