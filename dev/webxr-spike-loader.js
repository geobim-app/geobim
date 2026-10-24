/**
 * Loads CesiumJS for the WebXR spike: a local copy of the 1.145 release in
 * cesium/Build/Cesium/ (not in git, see .gitignore) if present, else the CDN —
 * then webxr-spike.js. ?cdn=1 forces the CDN.
 */
'use strict';

(function() {
  var VERSION = '1.145';
  var LOCAL = '../cesium/Build/Cesium/';
  var CDN = 'https://cesium.com/downloads/cesiumjs/releases/' + VERSION + '/Build/Cesium/';
  var forceCdn = new URLSearchParams(location.search).get('cdn') === '1';

  function css(href) {
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
  }

  function script(src, onload, onerror) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = onload;
    s.onerror = onerror;
    document.head.appendChild(s);
  }

  function start(base, source) {
    window.CESIUM_BASE_URL = base;
    css(base + 'Widgets/widgets.css');
    script(base + 'Cesium.js', function() {
      var ok = window.Cesium && String(Cesium.VERSION).indexOf(VERSION) === 0;
      console.log('[webxr-spike] CesiumJS ' + (window.Cesium && Cesium.VERSION) + ' from ' + source + (ok ? '' : ' (expected ' + VERSION + ')'));
      window.WEBXR_SPIKE_CESIUM_SOURCE = source;
      // Never a cached copy: an old webxr-spike.js left half-started sessions open
      script('webxr-spike.js?v=' + Date.now());
    }, function() {
      if (source === 'local') start(CDN, 'CDN');
      else document.getElementById('spikeStatus').textContent = 'CesiumJS could not be loaded';
    });
  }

  if (forceCdn) { start(CDN, 'CDN'); return; }
  // Probe the local copy first (a missing file is a cheap 404 from dev/serve.ps1)
  fetch(LOCAL + 'Cesium.js', { method: 'HEAD' })
    .then(function(r) { start(r.ok ? LOCAL : CDN, r.ok ? 'local' : 'CDN'); })
    .catch(function() { start(CDN, 'CDN'); });
})();
