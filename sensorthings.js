/**
 * geoBIM.app
 * (c) 2026 Christof Lorenz. All rights reserved.
 *
 * Licensed under the Business Source License 1.1 (BSL 1.1)
 * Non-commercial use, evaluation, research, and education permitted.
 * Commercial use requires written permission.
 * Contact: info@geobim.app
 *
 * Change Date: 2030-03-01 — converts to MIT License
 */

// ===============================
// CESIUM BIM VIEWER - OGC SensorThings API MODULE v2.0 (MQTT + Floating Billboards)
// Live bridge monitoring data from FROST server
// ===============================
'use strict';

window.GEOBIM_SENSORTHINGS = (function() {

  // =====================================
  // CONFIGURATION
  // =====================================

  var API_BASE = 'https://frost.christoflorenz.de/v1.1';
  var THINGS_URL = API_BASE + '/Things?$expand=Locations,Datastreams($expand=ObservedProperty,Observations($orderby=phenomenonTime%20desc;$top=1))&$top=10';
  var _prefetchedStations = null;
  var POLL_INTERVAL_MS = 60 * 1000; // 60 seconds (fallback only)
  var MQTT_URL = 'wss://frost.christoflorenz.de/mqtt';
  var MQTT_RECONNECT_DELAY = 5000;
  var STATION_HEIGHT = 57.86; // meters WGS84
  var ANCHOR_ASSET_ID = '4452138'; // Cesium Ion asset to anchor STA points to
  var DAMAGE_TRIGGER_URL = '/api/damage-trigger.php';
  var DAMAGE_SPARKLINE_COLOR = '#FF4444'; // red during damage events

  // Color mapping by dominant observed property keyword (German + English)
  var PROPERTY_COLORS = {
    'Beschleunigung': { css: '#FF8C00', cesium: Cesium.Color.fromCssColorString('#FF8C00') },
    'Acceleration':   { css: '#FF8C00', cesium: Cesium.Color.fromCssColorString('#FF8C00') },
    'Neigung':        { css: '#FF4444', cesium: Cesium.Color.fromCssColorString('#FF4444') },
    'Inclination':    { css: '#FF4444', cesium: Cesium.Color.fromCssColorString('#FF4444') },
    'Temperatur':     { css: '#2ECFB0', cesium: Cesium.Color.fromCssColorString('#2ECFB0') },
    'Temperature':    { css: '#2ECFB0', cesium: Cesium.Color.fromCssColorString('#2ECFB0') },
    'Dehnung':        { css: '#9B59B6', cesium: Cesium.Color.fromCssColorString('#9B59B6') },
    'Strain':         { css: '#9B59B6', cesium: Cesium.Color.fromCssColorString('#9B59B6') }
  };
  var DEFAULT_COLOR = { css: '#2ECFB0', cesium: Cesium.Color.fromCssColorString('#2ECFB0') };

  // Property priority for dominant color (first match wins, German + English)
  var PRIORITY_ORDER = ['Beschleunigung', 'Acceleration', 'Neigung', 'Inclination', 'Temperatur', 'Temperature', 'Dehnung', 'Strain'];

  // German → English translation for display names
  var NAME_TRANSLATIONS = {
    'Vertikalbeschleunigung': 'Vertical Acceleration',
    'Neigungswinkel': 'Inclination',
    'Temperatur': 'Temperature',
    'Dehnung': 'Strain',
    'Beschleunigung S7 – vertikal': 'Acceleration S7 – vertical',
    'Beschleunigung S12 – vertikal': 'Acceleration S12 – vertical',
    'Neigung N2 – Pfeiler West': 'Inclination N2 – West Pier',
    'Neigung N3 – Pfeiler Ost': 'Inclination N3 – East Pier',
    'Temperatur Untergurt': 'Temperature Bottom Flange',
    'Dehnung Hauptträger Mitte': 'Strain Main Girder Midspan'
  };

  // =====================================
  // STATE
  // =====================================

  // Damage thresholds by ObservedProperty keyword (matched against both German and English names)
  var DAMAGE_THRESHOLDS = {
    'Beschleunigung': { check: function(v) { return Math.abs(v) > 0.08; }, label: 'Acceleration' },
    'Acceleration':   { check: function(v) { return Math.abs(v) > 0.08; }, label: 'Acceleration' },
    'Neigung':        { check: function(v) { return Math.abs(v) > 0.25; }, label: 'Inclination' },
    'Inclination':    { check: function(v) { return Math.abs(v) > 0.25; }, label: 'Inclination' },
    'Dehnung':        { check: function(v) { return v < -65; },           label: 'Strain' },
    'Strain':         { check: function(v) { return v < -65; },           label: 'Strain' }
  };

  var DAMAGE_EXPLANATIONS = {
    'Beschleunigung': 'Vertical acceleration exceeded safe threshold (|a| > 0.08 g). Possible resonance or impact event detected.',
    'Acceleration':   'Vertical acceleration exceeded safe threshold (|a| > 0.08 g). Possible resonance or impact event detected.',
    'Neigung': 'Inclination angle exceeded safe threshold (|angle| > 0.25 deg). Possible structural tilt or foundation movement.',
    'Inclination': 'Inclination angle exceeded safe threshold (|angle| > 0.25 deg). Possible structural tilt or foundation movement.',
    'Dehnung': 'Strain dropped below critical threshold (< -65 microstrain). Possible excessive compression in main girder.',
    'Strain': 'Strain dropped below critical threshold (< -65 microstrain). Possible excessive compression in main girder.'
  };

  var DAMAGE_AUTO_DISMISS_MS = 180000; // 180 seconds

  var state = {
    viewer: null,
    initialized: false,
    visible: true,
    intervalId: null,
    entities: {},         // entityId → Cesium.Entity (point entity)

    stationData: {},      // entityId → parsed station object
    dsToThing: {},        // datastreamId → { entityId, dsIndex }
    mqttClient: null,
    mqttConnected: false,
    mqttReconnectAttempted: false,
    button: null,
    panel: null,
    _history: {},
    _damageActive: false,
    _damageTimerId: null,
    _damageFlyout: null
  };

  // =====================================
  // HELPERS
  // =====================================

  function getDominantColor(datastreams) {
    for (var i = 0; i < PRIORITY_ORDER.length; i++) {
      var key = PRIORITY_ORDER[i];
      for (var j = 0; j < datastreams.length; j++) {
        var propName = datastreams[j].propertyName || '';
        if (propName.indexOf(key) !== -1) {
          return PROPERTY_COLORS[key];
        }
      }
    }
    return DEFAULT_COLOR;
  }

  function getAnchorCartographic() {
    if (window.BimViewer && BimViewer.loadedAssets) {
      var asset = BimViewer.loadedAssets.get(ANCHOR_ASSET_ID);
      if (asset && asset.tileset && asset.tileset.boundingSphere) {
        return Cesium.Cartographic.fromCartesian(asset.tileset.boundingSphere.center);
      }
    }
    return null;
  }

  function formatTime(isoStr) {
    if (!isoStr) return '--';
    // Handle interval format "start/end"
    var ts = isoStr.indexOf('/') !== -1 ? isoStr.split('/')[0] : isoStr;
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '--';
    return d.toLocaleString('en-GB', {
      day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function getHistoryDepth(dsName) {
    if (dsName.indexOf('Beschleunigung') !== -1 || dsName.indexOf('Acceleration') !== -1) return 30;
    if (dsName.indexOf('Neigung') !== -1 || dsName.indexOf('Inclination') !== -1) return 60;
    if (dsName.indexOf('Temperatur') !== -1 || dsName.indexOf('Temperature') !== -1) return 120;
    if (dsName.indexOf('Dehnung') !== -1 || dsName.indexOf('Strain') !== -1) return 60;
    return 30;
  }

  function getSparklineColor(dsName) {
    if (state._damageActive) return DAMAGE_SPARKLINE_COLOR;
    for (var i = 0; i < PRIORITY_ORDER.length; i++) {
      if (dsName.indexOf(PRIORITY_ORDER[i]) !== -1) {
        return PROPERTY_COLORS[PRIORITY_ORDER[i]].css;
      }
    }
    return DEFAULT_COLOR.css;
  }

  function renderSparklineSvg(dsId, values, color) {
    var w = 160, h = 44, pad = 10;
    if (!values || values.length < 2) {
      return '<svg data-dsid="' + dsId + '" width="100%" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"></svg>';
    }
    var min = values[0], max = values[0];
    for (var i = 1; i < values.length; i++) {
      if (values[i] < min) min = values[i];
      if (values[i] > max) max = values[i];
    }
    var range = max - min || 1;
    var points = '';
    for (var j = 0; j < values.length; j++) {
      var x = (j / (values.length - 1)) * w;
      var y = pad + (1 - (values[j] - min) / range) * (h - 2 * pad);
      points += x.toFixed(1) + ',' + y.toFixed(1) + ' ';
    }
    var svg = '<svg data-dsid="' + dsId + '" width="100%" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">';
    if (min < 0 && max > 0) {
      var baseY = pad + (1 - (0 - min) / range) * (h - 2 * pad);
      baseY = Math.max(pad, Math.min(h - pad, baseY));
      svg += '<line x1="0" y1="' + baseY.toFixed(1) + '" x2="' + w + '" y2="' + baseY.toFixed(1) + '" stroke="#555" stroke-dasharray="2 3" stroke-width="0.5"/>';
    }
    svg += '<polyline points="' + points.trim() + '" fill="none" stroke="' + color + '" stroke-width="1.5" vector-effect="non-scaling-stroke"/>';
    svg += '<text x="2" y="' + (h - 1) + '" font-size="9" fill="#aaa" font-family="sans-serif">' + min.toFixed(2) + '</text>';
    svg += '<text x="' + (w - 2) + '" y="' + (h - 1) + '" font-size="9" fill="#aaa" font-family="sans-serif" text-anchor="end">' + max.toFixed(2) + '</text>';
    svg += '</svg>';
    return svg;
  }

  // =====================================
  // DATA PARSING
  // =====================================

  function parseThings(json) {
    var things = json.value || [];
    var stations = [];

    for (var i = 0; i < things.length; i++) {
      var thing = things[i];

      // Extract coordinates
      var locs = thing.Locations;
      if (!locs || locs.length === 0) continue;
      var loc = locs[0].location;
      if (!loc || !loc.coordinates || loc.coordinates.length < 2) continue;
      var lon = loc.coordinates[0];
      var lat = loc.coordinates[1];
      if (isNaN(lon) || isNaN(lat)) continue;

      // Parse datastreams
      var datastreams = [];
      var dsList = thing.Datastreams || [];
      for (var j = 0; j < dsList.length; j++) {
        var ds = dsList[j];
        var prop = ds.ObservedProperty || {};
        var unit = ds.unitOfMeasurement || {};
        var obs = ds.Observations && ds.Observations.length > 0 ? ds.Observations[0] : null;

        datastreams.push({
          dsId: ds['@iot.id'],
          propertyName: NAME_TRANSLATIONS[prop.name] || NAME_TRANSLATIONS[ds.name] || prop.name || ds.name || 'Unknown',
          datastreamName: NAME_TRANSLATIONS[ds.name] || ds.name || 'Unknown',
          unitSymbol: unit.symbol || '',
          value: obs ? obs.result : null,
          time: obs ? obs.phenomenonTime : null
        });
      }

      var thingName = 'Bridge Sensor Data';

      stations.push({
        id: thing['@iot.id'],
        name: thingName,
        description: thing.description || '',
        lon: lon,
        lat: lat,
        datastreams: datastreams
      });
    }

    return stations;
  }

  // =====================================
  // DESCRIPTION HTML
  // =====================================

  function buildDescription(station) {
    var html = '<div style="font-family:sans-serif;font-size:13px;max-width:360px;">';
    html += '<div style="font-weight:bold;font-size:14px;margin-bottom:8px;">' + station.name + '</div>';

    if (station.description) {
      html += '<div style="color:#999;margin-bottom:8px;font-size:12px;">' + station.description + '</div>';
    }

    html += '<table style="width:100%;border-collapse:collapse;">';
    html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.15);">' +
      '<th style="text-align:left;padding:4px 8px 4px 0;font-size:12px;">Parameter</th>' +
      '<th style="text-align:right;padding:4px 8px;font-size:12px;">Value</th>' +
      '<th style="text-align:right;padding:4px 0 4px 8px;font-size:12px;">Time</th></tr>';

    for (var i = 0; i < station.datastreams.length; i++) {
      var ds = station.datastreams[i];
      var valStr = ds.value !== null ? ds.value + ' ' + ds.unitSymbol : '\u2013';
      var timeStr = formatTime(ds.time);

      // Color the property name by type
      var propColor = DEFAULT_COLOR.css;
      for (var k = 0; k < PRIORITY_ORDER.length; k++) {
        if (ds.propertyName.indexOf(PRIORITY_ORDER[k]) !== -1) {
          propColor = PROPERTY_COLORS[PRIORITY_ORDER[k]].css;
          break;
        }
      }

      html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.08);">' +
        '<td style="padding:3px 8px 3px 0;color:' + propColor + ';">' + ds.propertyName + '</td>' +
        '<td style="text-align:right;padding:3px 8px;">' + valStr + '</td>' +
        '<td style="text-align:right;padding:3px 0 3px 8px;font-size:11px;color:#999;">' + timeStr + '</td></tr>';
    }

    html += '</table></div>';
    return html;
  }

  function buildPanelHtml(station) {
    var html = '<table style="width:100%;border-collapse:collapse;">';
    html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.15);">' +
      '<th style="text-align:left;padding:4px 6px;font-size:11px;color:#888;">Parameter</th>' +
      '<th style="text-align:right;padding:4px 6px;font-size:11px;color:#888;">Value</th>' +
      '<th style="text-align:right;padding:4px 6px;font-size:11px;color:#888;">Unit</th>' +
      '<th style="text-align:left;padding:4px 6px;font-size:11px;color:#888;min-width:160px;">Trend</th></tr>';

    for (var i = 0; i < station.datastreams.length; i++) {
      var ds = station.datastreams[i];
      var valStr = ds.value !== null ? Number(ds.value).toFixed(2) : '\u2013';
      var propColor = getSparklineColor(ds.propertyName);
      var sparkSvg = renderSparklineSvg(ds.dsId, state._history[ds.dsId], propColor);

      html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.08);">' +
        '<td style="padding:3px 6px;color:' + propColor + ';font-size:12px;white-space:nowrap;">' + ds.datastreamName + '</td>' +
        '<td data-val-dsid="' + ds.dsId + '" style="text-align:right;padding:3px 6px;font-size:12px;">' + valStr + '</td>' +
        '<td style="text-align:right;padding:3px 6px;font-size:11px;color:#999;">' + ds.unitSymbol + '</td>' +
        '<td style="padding:3px 6px;">' + sparkSvg + '</td></tr>';
    }

    html += '</table>';
    return html;
  }

  // =====================================
  // DAMAGE EVENT FLY-OUT
  // =====================================

  function checkDamageThreshold(dsPropertyName, value, datastreamName, unitSymbol) {
    if (state._damageActive) return;
    var keys = Object.keys(DAMAGE_THRESHOLDS);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (dsPropertyName.indexOf(key) !== -1 && DAMAGE_THRESHOLDS[key].check(value)) {
        showDamageFlyout({
          category: key,
          label: DAMAGE_THRESHOLDS[key].label,
          datastreamName: datastreamName,
          value: value,
          unitSymbol: unitSymbol,
          explanation: DAMAGE_EXPLANATIONS[key]
        });
        return;
      }
    }
  }

  function ensureDamageFlyoutStyles() {
    if (document.getElementById('sta-damage-styles')) return;
    var style = document.createElement('style');
    style.id = 'sta-damage-styles';
    style.textContent =
      '@keyframes staFlyoutSlideIn { from { transform: translateX(-50%) translateY(100%); opacity: 0; } to { transform: translateX(-50%) translateY(0); opacity: 1; } }' +
      '@keyframes staFlyoutSlideOut { from { transform: translateX(-50%) translateY(0); opacity: 1; } to { transform: translateX(-50%) translateY(100%); opacity: 0; } }' +
      '#sta-damage-flyout {' +
        'position: fixed;' +
        'bottom: 24px;' +
        'left: 50%;' +
        'transform: translateX(-50%);' +
        'z-index: 400;' +
        'width: 480px;' +
        'max-width: 90vw;' +
        'background: rgba(14,17,23,0.85);' +
        'border: 1px solid rgba(46,207,176,0.35);' +
        'border-left: 4px solid #2ECFB0;' +
        'border-radius: 12px;' +
        'box-shadow: 0 8px 40px rgba(0,0,0,0.5), 0 0 20px rgba(46,207,176,0.15);' +
        'backdrop-filter: blur(14px);' +
        'color: #e2e8f0;' +
        'font-family: sans-serif;' +
        'animation: staFlyoutSlideIn 0.4s ease-out forwards;' +
        'pointer-events: auto;' +
      '}' +
      '#sta-damage-flyout.dismissing {' +
        'animation: staFlyoutSlideOut 0.35s ease-in forwards;' +
      '}' +
      '#sta-damage-flyout .damage-header {' +
        'display: flex; align-items: center; justify-content: space-between;' +
        'padding: 12px 16px 8px; border-bottom: 1px solid rgba(255,255,255,0.08);' +
      '}' +
      '#sta-damage-flyout .damage-title {' +
        'font-size: 14px; font-weight: 700; color: #FF4444;' +
        'display: flex; align-items: center; gap: 8px;' +
      '}' +
      '#sta-damage-flyout .damage-close {' +
        'background: none; border: none; color: #888; font-size: 18px; cursor: pointer; padding: 0 4px; line-height: 1;' +
      '}' +
      '#sta-damage-flyout .damage-close:hover { color: #fff; }' +
      '#sta-damage-flyout .damage-body { padding: 12px 16px; }' +
      '#sta-damage-flyout .damage-sensor {' +
        'font-size: 13px; color: #2ECFB0; font-weight: 600; margin-bottom: 6px;' +
      '}' +
      '#sta-damage-flyout .damage-value {' +
        'font-size: 24px; font-weight: 700; color: #FF4444; margin-bottom: 8px;' +
      '}' +
      '#sta-damage-flyout .damage-explanation {' +
        'font-size: 12px; color: #aaa; line-height: 1.5;' +
      '}';
    document.head.appendChild(style);
  }

  function showDamageFlyout(info) {
    state._damageActive = true;
    ensureDamageFlyoutStyles();

    // Remove existing flyout if any
    var existing = document.getElementById('sta-damage-flyout');
    if (existing) existing.parentNode.removeChild(existing);

    var flyout = document.createElement('div');
    flyout.id = 'sta-damage-flyout';
    flyout.innerHTML =
      '<div class="damage-header">' +
        '<div class="damage-title">' +
          '<span>\u26A0</span> Anomaly Detected' +
        '</div>' +
        '<button class="damage-close" onclick="GEOBIM_SENSORTHINGS.dismissDamage()" title="Dismiss">\u2715</button>' +
      '</div>' +
      '<div class="damage-body">' +
        '<div class="damage-sensor">' + info.datastreamName + '</div>' +
        '<div class="damage-value">' + Number(info.value).toFixed(4) + ' ' + info.unitSymbol + '</div>' +
        '<div class="damage-explanation">' + info.explanation + '</div>' +
      '</div>';
    document.body.appendChild(flyout);
    state._damageFlyout = flyout;

    // Auto-dismiss after timeout
    state._damageTimerId = setTimeout(function() {
      dismissDamageFlyout();
    }, DAMAGE_AUTO_DISMISS_MS);
  }

  function triggerDamage() {
    fetch(DAMAGE_TRIGGER_URL, { method: 'POST' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        console.log('STA: Damage trigger sent', data);
      })
      .catch(function(err) {
        console.warn('STA: Damage trigger failed:', err.message);
      });
  }

  function dismissDamageFlyout() {
    if (state._damageTimerId) {
      clearTimeout(state._damageTimerId);
      state._damageTimerId = null;
    }
    var flyout = state._damageFlyout || document.getElementById('sta-damage-flyout');
    if (flyout) {
      flyout.classList.add('dismissing');
      setTimeout(function() {
        if (flyout.parentNode) flyout.parentNode.removeChild(flyout);
        state._damageFlyout = null;
        state._damageActive = false;
        repaintSparklines();
      }, 350);
    } else {
      state._damageActive = false;
      repaintSparklines();
    }
  }

  function repaintSparklines() {
    var dsIds = Object.keys(state._history);
    for (var i = 0; i < dsIds.length; i++) {
      var dsId = dsIds[i];
      var mapping = state.dsToThing[dsId];
      if (!mapping) continue;
      var station = state.stationData[mapping.entityId];
      if (!station) continue;
      var ds = station.datastreams[mapping.dsIndex];
      if (!ds) continue;
      var color = getSparklineColor(ds.propertyName);
      var svgEl = document.querySelector('svg[data-dsid="' + dsId + '"]');
      if (svgEl) svgEl.outerHTML = renderSparklineSvg(dsId, state._history[dsId], color);
    }
  }

  // =====================================
  // SIDEBAR PANEL
  // =====================================

  function ensurePanel() {
    if (state.panel) return state.panel;

    var panel = document.createElement('div');
    panel.id = 'sta-panel';
    panel.innerHTML =
      '<div id="staPanelHeader" class="floating-panel-header">' +
        '<span class="floating-panel-title">Bridge Monitoring Live</span>' +
        '<div class="floating-panel-controls">' +
          '<button class="floating-panel-btn sta-info-btn" onclick="GEOBIM_SENSORTHINGS.toggleInfoFlyout()" title="What is this?">\u24D8</button>' +
          '<button class="floating-panel-btn sta-trigger-btn" onclick="GEOBIM_SENSORTHINGS.triggerDamage()" title="Simulate Damage Event">\u26A0 Damage</button>' +
          '<button class="floating-panel-btn" onclick="GEOBIM_SENSORTHINGS.closePanel()" title="Close">\u2715</button>' +
        '</div>' +
      '</div>' +
      '<div id="staInfoFlyout" class="sta-info-flyout" style="display:none;">' +
        '<div class="sta-info-intro">Real-time sensor data from physical monitoring devices installed on this bridge. Values update every 5 seconds via MQTT.</div>' +
        '<div class="sta-info-sensors">' +
          '<div class="sta-info-sensor">' +
            '<span class="sta-info-dot" style="background:#FF8C00;"></span>' +
            '<div><strong>Acceleration</strong> \u00B7 m/s\u00B2 \u00B7 Vertical vibration at two mid-span points. Elevated values indicate dynamic overloading, resonance, or impact events. Alarm threshold: |a| &gt; 0.08 g.</div>' +
          '</div>' +
          '<div class="sta-info-sensor">' +
            '<span class="sta-info-dot" style="background:#FF4444;"></span>' +
            '<div><strong>Inclination</strong> \u00B7 \u00B0 \u00B7 Tilt angle at west and east piers. Monitors long-term settlement, scour, or foundation movement. Alarm threshold: |angle| &gt; 0.25\u00B0.</div>' +
          '</div>' +
          '<div class="sta-info-sensor">' +
            '<span class="sta-info-dot" style="background:#2ECFB0;"></span>' +
            '<div><strong>Temperature</strong> \u00B7 \u00B0C \u00B7 Bottom flange temperature. Thermal gradients cause expansion and stress \u2014 critical for interpreting strain readings.</div>' +
          '</div>' +
          '<div class="sta-info-sensor">' +
            '<span class="sta-info-dot" style="background:#9B59B6;"></span>' +
            '<div><strong>Strain</strong> \u00B7 \u03BCs \u00B7 Microstrain in the main girder at midspan. Direct measure of structural stress. Alarm threshold: &lt; \u221265 \u03BCs (excessive compression).</div>' +
          '</div>' +
        '</div>' +
        '<button class="sta-info-close" onclick="GEOBIM_SENSORTHINGS.toggleInfoFlyout()">Got it</button>' +
      '</div>' +
      '<div id="staPanelBody" class="floating-panel-body" style="max-height:400px;overflow-y:auto;"></div>';
    document.body.appendChild(panel);

    // Add styles
    var style = document.createElement('style');
    style.textContent =
      '#sta-panel {' +
        'position: fixed;' +
        'bottom: 80px;' +
        'right: 20px;' +
        'width: 540px;' +
        'z-index: 250;' +
        'background: rgba(14,17,23,0.85);' +
        'border: 1px solid rgba(255,255,255,0.12);' +
        'border-radius: 12px;' +
        'box-shadow: 0 8px 32px rgba(0,0,0,0.4);' +
        'display: none;' +
        'flex-direction: column;' +
        'backdrop-filter: blur(12px);' +
        'color: #e2e8f0;' +
      '}' +
      '#sta-panel.visible { display: flex; }' +
      '#staPanelBody { padding: 12px; }' +
      '#staPanelBody table { width: 100%; }' +
      '#staPanelBody th, #staPanelBody td { padding: 4px 6px; font-size: 12px; }' +
      '#staPanelHeader { cursor: move; user-select: none; }' +
      '.sta-info-btn {' +
        'font-size: 14px !important;' +
        'padding: 3px 8px !important;' +
        'border-radius: 4px !important;' +
        'opacity: 0.6;' +
        'transition: opacity 0.2s;' +
      '}' +
      '.sta-info-btn:hover, .sta-info-btn.active { opacity: 1; }' +
      '.sta-info-flyout {' +
        'border-top: 1px solid rgba(255,255,255,0.08);' +
        'padding: 14px 14px 10px;' +
        'background: rgba(0,0,0,0.2);' +
      '}' +
      '.sta-info-intro {' +
        'font-size: 11px;' +
        'color: rgba(255,255,255,0.55);' +
        'line-height: 1.5;' +
        'margin-bottom: 12px;' +
      '}' +
      '.sta-info-sensors { display: flex; flex-direction: column; gap: 8px; }' +
      '.sta-info-sensor {' +
        'display: flex;' +
        'gap: 10px;' +
        'align-items: flex-start;' +
        'font-size: 11px;' +
        'color: rgba(255,255,255,0.7);' +
        'line-height: 1.45;' +
      '}' +
      '.sta-info-sensor strong { color: rgba(255,255,255,0.92); }' +
      '.sta-info-dot {' +
        'width: 8px; height: 8px;' +
        'border-radius: 50%;' +
        'margin-top: 3px;' +
        'flex-shrink: 0;' +
      '}' +
      '.sta-info-close {' +
        'margin-top: 12px;' +
        'padding: 5px 16px;' +
        'border-radius: 6px;' +
        'border: 1px solid rgba(46,207,176,0.35);' +
        'background: rgba(46,207,176,0.1);' +
        'color: #2ECFB0;' +
        'font-size: 11px;' +
        'font-weight: 600;' +
        'cursor: pointer;' +
        'font-family: inherit;' +
        'transition: background 0.2s;' +
        'display: block;' +
        'width: 100%;' +
      '}' +
      '.sta-info-close:hover { background: rgba(46,207,176,0.2); }' +
      '.sta-trigger-btn {' +
        'font-size: 11px !important;' +
        'padding: 3px 10px !important;' +
        'border-radius: 4px !important;' +
        'background: rgba(255,68,68,0.15) !important;' +
        'border: 1px solid rgba(255,68,68,0.4) !important;' +
        'color: #FF4444 !important;' +
        'cursor: pointer !important;' +
        'transition: all 0.2s ease;' +
        'margin-right: 6px;' +
      '}' +
      '.sta-trigger-btn:hover {' +
        'background: rgba(255,68,68,0.3) !important;' +
        'border-color: #FF4444 !important;' +
      '}';
    document.head.appendChild(style);

    // Drag support
    var dragX = 0, dragY = 0, startX = 0, startY = 0;
    var header = panel.querySelector('#staPanelHeader');
    header.addEventListener('mousedown', function(e) {
      if (e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      startX = e.clientX;
      startY = e.clientY;
      function onMove(ev) {
        dragX = ev.clientX - startX;
        dragY = ev.clientY - startY;
        startX = ev.clientX;
        startY = ev.clientY;
        var rect = panel.getBoundingClientRect();
        panel.style.left = rect.left + dragX + 'px';
        panel.style.top = rect.top + dragY + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    state.panel = panel;
    return panel;
  }

  function showPanel(station) {
    var panel = ensurePanel();
    var title = panel.querySelector('.floating-panel-title');
    var body = document.getElementById('staPanelBody');
    if (title) title.textContent = station.name;
    state._history = {};
    if (body) body.innerHTML = buildPanelHtml(station);
    panel.classList.add('visible');

    for (var i = 0; i < station.datastreams.length; i++) {
      (function(ds) {
        var depth = getHistoryDepth(ds.propertyName);
        var url = API_BASE + '/Datastreams(' + ds.dsId + ')/Observations?$orderby=phenomenonTime%20desc&$top=' + depth;
        fetch(url)
          .then(function(r) { return r.json(); })
          .then(function(json) {
            var obs = json.value || [];
            var values = [];
            for (var k = obs.length - 1; k >= 0; k--) {
              values.push(obs[k].result);
            }
            state._history[ds.dsId] = values;
            var color = getSparklineColor(ds.propertyName);
            var svgEl = panel.querySelector('svg[data-dsid="' + ds.dsId + '"]');
            if (svgEl) svgEl.outerHTML = renderSparklineSvg(ds.dsId, values, color);
          })
          .catch(function() {});
      })(station.datastreams[i]);
    }
  }

  function closePanel() {
    if (state.panel) state.panel.classList.remove('visible');
    state._history = {};
  }

  // =====================================
  // ENTITY MANAGEMENT
  // =====================================

  function createOrUpdateEntity(station) {
    var entityId = 'sta_' + station.id;
    var existing = state.entities[entityId];
    var color = getDominantColor(station.datastreams);

    // Build datastream-to-thing mapping
    for (var d = 0; d < station.datastreams.length; d++) {
      var dsId = station.datastreams[d].dsId;
      if (dsId) {
        state.dsToThing[dsId] = { entityId: entityId, dsIndex: d };
      }
    }

    if (existing) {
      // Update in place
      existing.description = buildDescription(station);
      if (existing.label) {
        existing.label.text = station.name;
      }
      state.stationData[entityId] = station;
      return;
    }

    // Resolve position: anchor asset if loaded, else fixed coordinates
    var anchor = getAnchorCartographic();
    var lon = anchor ? Cesium.Math.toDegrees(anchor.longitude) : 3.5695911;
    var lat = anchor ? Cesium.Math.toDegrees(anchor.latitude) : 51.0734112;

    // Floating point entity (raised above ground)
    var entity = state.viewer.entities.add({
      id: entityId,
      name: station.name,
      position: Cesium.Cartesian3.fromDegrees(lon, lat, STATION_HEIGHT),
      point: {
        pixelSize: 12,
        color: color.cesium,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.NONE
      },
      label: {
        text: station.name,
        font: 'bold 12px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -12),
        showBackground: true,
        backgroundColor: new Cesium.Color(0.05, 0.07, 0.09, 0.8),
        backgroundPadding: new Cesium.Cartesian2(6, 4),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 500000),
        heightReference: Cesium.HeightReference.NONE
      },
      description: buildDescription(station),
      show: state.visible
    });

    state.entities[entityId] = entity;
    state.stationData[entityId] = station;
  }

  // =====================================
  // SELECTED ENTITY HANDLER
  // =====================================

  function onSelectedEntityChanged() {
    var selected = state.viewer.selectedEntity;
    if (!selected || !selected.id || typeof selected.id !== 'string') return;
    if (selected.id.indexOf('sta_') !== 0) return;

    var station = state.stationData[selected.id];
    if (station) {
      showPanel(station);
    }
  }

  // =====================================
  // FETCH
  // =====================================

  function fetchData() {
    fetch(THINGS_URL)
      .then(function(response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function(json) {
        var stations = parseThings(json);
        for (var i = 0; i < stations.length; i++) {
          createOrUpdateEntity(stations[i]);
          // Check damage thresholds on polled data
          var dsList = stations[i].datastreams;
          for (var j = 0; j < dsList.length; j++) {
            var ds = dsList[j];
            if (ds.value !== null) {
              checkDamageThreshold(ds.propertyName, ds.value, ds.datastreamName, ds.unitSymbol);
            }
          }
        }
        console.log('STA: Updated ' + stations.length + ' stations');
      })
      .catch(function(err) {
        console.warn('STA: Fetch failed:', err.message);
      });
  }

  // =====================================
  // MQTT REALTIME
  // =====================================

  function startMqtt() {
    if (typeof mqtt === 'undefined') {
      console.warn('STA: mqtt.js not loaded, using polling fallback');
      startPollingFallback();
      return;
    }

    try {
      state.mqttClient = mqtt.connect(MQTT_URL, {
        protocolVersion: 5,
        clean: true,
        connectTimeout: 10000,
        keepalive: 30
      });
    } catch (err) {
      console.warn('STA: MQTT connect error:', err.message);
      startPollingFallback();
      return;
    }

    state.mqttClient.on('connect', function() {
      state.mqttConnected = true;
      state.mqttReconnectAttempted = false;
      console.log('[GEOBIM_SENSORTHINGS] MQTT connected');

      // Stop polling if running — MQTT takes over
      if (state.intervalId) {
        clearInterval(state.intervalId);
        state.intervalId = null;
      }

      // Subscribe to all known datastreams
      var dsIds = Object.keys(state.dsToThing);
      for (var i = 0; i < dsIds.length; i++) {
        var topic = 'v1.1/Datastreams(' + dsIds[i] + ')/Observations';
        state.mqttClient.subscribe(topic);
      }
      if (dsIds.length > 0) {
        console.log('STA: Subscribed to ' + dsIds.length + ' datastream topics');
      }
    });

    state.mqttClient.on('message', function(topic, message) {
      try {
        var payload = JSON.parse(message.toString());
        // Extract datastream ID from topic: v1.1/Datastreams(123)/Observations
        var match = topic.match(/Datastreams\((\d+)\)/);
        if (!match) return;
        var dsId = parseInt(match[1], 10);
        var mapping = state.dsToThing[dsId];
        if (!mapping) return;

        var station = state.stationData[mapping.entityId];
        if (!station) return;

        // Update the datastream value in place
        var ds = station.datastreams[mapping.dsIndex];
        if (ds) {
          ds.value = payload.result;
          ds.time = payload.phenomenonTime;

          // Check damage thresholds
          checkDamageThreshold(ds.propertyName, payload.result, ds.datastreamName, ds.unitSymbol);
        }

        // Update entity description
        var entity = state.entities[mapping.entityId];
        if (entity) {
          entity.description = buildDescription(station);
        }

        // Update panel value cell if visible
        if (state.panel && state.panel.classList.contains('visible')) {
          var valCell = state.panel.querySelector('td[data-val-dsid="' + dsId + '"]');
          if (valCell) {
            valCell.textContent = ds.value !== null ? Number(ds.value).toFixed(2) : '\u2013';
          }
        }

        // Update sparkline if history exists for this datastream
        if (state._history[dsId] !== undefined) {
          state._history[dsId].push(payload.result);
          var maxDepth = getHistoryDepth(ds.propertyName);
          if (state._history[dsId].length > maxDepth) {
            state._history[dsId] = state._history[dsId].slice(-maxDepth);
          }
          var sparkColor = getSparklineColor(ds.propertyName);
          var svgEl = document.querySelector('svg[data-dsid="' + dsId + '"]');
          if (svgEl) svgEl.outerHTML = renderSparklineSvg(dsId, state._history[dsId], sparkColor);
        }
      } catch (err) {
        // Silently ignore parse errors
      }
    });

    state.mqttClient.on('error', function(err) {
      console.warn('STA: MQTT error:', err.message);
      disconnectMqtt();
      startPollingFallback();
    });

    state.mqttClient.on('close', function() {
      if (!state.mqttConnected) return;
      state.mqttConnected = false;
      console.warn('STA: MQTT disconnected');

      if (!state.mqttReconnectAttempted) {
        // Try one reconnect after delay
        state.mqttReconnectAttempted = true;
        console.log('STA: Attempting MQTT reconnect in 5s...');
        setTimeout(function() {
          if (state.visible && !state.mqttConnected) {
            disconnectMqtt();
            startMqtt();
          }
        }, MQTT_RECONNECT_DELAY);
      } else {
        // Already tried once, fall back to polling
        disconnectMqtt();
        startPollingFallback();
      }
    });
  }

  function disconnectMqtt() {
    if (state.mqttClient) {
      try { state.mqttClient.end(true); } catch (e) { /* ignore */ }
      state.mqttClient = null;
      state.mqttConnected = false;
    }
  }

  function startPollingFallback() {
    if (state.intervalId) return; // already polling
    if (!state.visible) return;
    console.log('STA: Falling back to ' + (POLL_INTERVAL_MS / 1000) + 's polling');
    state.intervalId = setInterval(fetchData, POLL_INTERVAL_MS);
  }

  // =====================================
  // SHOW / HIDE
  // =====================================

  function show() {
    state.visible = true;
    var ids = Object.keys(state.entities);
    for (var i = 0; i < ids.length; i++) {
      state.entities[ids[i]].show = true;
    }
    // Initial REST fetch (or use prefetched cache), then start MQTT
    if (!state.mqttConnected && !state.intervalId) {
      state.mqttReconnectAttempted = false;

      var applyStations = function(stations) {
        for (var i = 0; i < stations.length; i++) {
          createOrUpdateEntity(stations[i]);
        }
        console.log('STA: ' + stations.length + ' stations ready');
        startMqtt();
      };

      if (_prefetchedStations) {
        applyStations(_prefetchedStations);
      } else {
        fetch(THINGS_URL)
          .then(function(response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
          })
          .then(function(json) { applyStations(parseThings(json)); })
          .catch(function(err) {
            console.warn('STA: Initial fetch failed:', err.message);
            startPollingFallback();
          });
      }
    }
    updateButton();
  }

  function hide() {
    state.visible = false;
    var ids = Object.keys(state.entities);
    for (var i = 0; i < ids.length; i++) {
      state.entities[ids[i]].show = false;
    }
    closePanel();
    // Stop MQTT
    disconnectMqtt();
    // Stop polling
    if (state.intervalId) {
      clearInterval(state.intervalId);
      state.intervalId = null;
    }
    updateButton();
  }

  function toggle() {
    if (state.visible && (state.intervalId || state.mqttConnected || Object.keys(state.entities).length > 0)) {
      hide();
    } else {
      show();
    }
  }

  // =====================================
  // DESTROY
  // =====================================

  function destroy() {
    // Stop MQTT
    disconnectMqtt();
    // Stop polling
    if (state.intervalId) {
      clearInterval(state.intervalId);
      state.intervalId = null;
    }
    // Dismiss damage flyout
    if (state._damageTimerId) {
      clearTimeout(state._damageTimerId);
      state._damageTimerId = null;
    }
    if (state._damageFlyout && state._damageFlyout.parentNode) {
      state._damageFlyout.parentNode.removeChild(state._damageFlyout);
    }
    state._damageFlyout = null;
    state._damageActive = false;
    // Remove point entities
    var ids = Object.keys(state.entities);
    for (var i = 0; i < ids.length; i++) {
      state.viewer.entities.removeById(ids[i]);
    }
    state.entities = {};
    state.stationData = {};
    state.dsToThing = {};
    // Remove panel
    if (state.panel && state.panel.parentNode) {
      state.panel.parentNode.removeChild(state.panel);
      state.panel = null;
    }
    // Remove button
    if (state.button && state.button.parentNode) {
      state.button.parentNode.removeChild(state.button);
      state.button = null;
    }
    state.initialized = false;
    console.log('STA: Destroyed');
  }

  // =====================================
  // UI BUTTON
  // =====================================

  function createButton() {
    var btn = document.createElement('button');
    btn.id = 'staToggleBtn';
    btn.title = 'STA Live — Bridge Monitoring';
    btn.onclick = toggle;
    document.body.appendChild(btn);
    state.button = btn;

    var style = document.createElement('style');
    style.textContent =
      '#staToggleBtn {' +
        'position: fixed;' +
        'bottom: 80px;' +
        'right: 20px;' +
        'z-index: 300;' +
        'height: 36px;' +
        'padding: 0 14px;' +
        'border-radius: 18px;' +
        'border: 2px solid rgba(255,255,255,0.2);' +
        'background: rgba(14,17,23,0.85);' +
        'color: rgba(255,255,255,0.7);' +
        'font-size: 13px;' +
        'font-weight: 600;' +
        'font-family: sans-serif;' +
        'cursor: pointer;' +
        'display: flex;' +
        'align-items: center;' +
        'gap: 6px;' +
        'transition: all 0.2s ease;' +
        'box-shadow: 0 2px 8px rgba(0,0,0,0.3);' +
        'white-space: nowrap;' +
      '}' +
      '#staToggleBtn:hover {' +
        'background: rgba(14,17,23,0.85);' +
        'border-color: rgba(255,255,255,0.4);' +
      '}' +
      '#staToggleBtn.active {' +
        'background: linear-gradient(135deg, #2ECFB0 0%, #3DB8A0 100%);' +
        'color: #0E1117;' +
        'border-color: #2ECFB0;' +
        'box-shadow: 0 4px 12px rgba(46,207,176,0.4);' +
      '}';
    document.head.appendChild(style);

    updateButton();
  }

  function updateButton() {
    if (!state.button) return;
    state.button.innerHTML = '<span style="font-size:16px;">&#x1F30D;</span> STA Live';
    if (state.visible && (state.intervalId || state.mqttConnected || Object.keys(state.entities).length > 0)) {
      state.button.classList.add('active');
    } else {
      state.button.classList.remove('active');
    }
  }

  // =====================================
  // INIT
  // =====================================

  function init(viewer) {
    if (state.initialized) return;
    if (!viewer) {
      console.error('STA: No viewer provided');
      return;
    }

    state.viewer = viewer;
    state.initialized = true;

    // Listen for entity selection
    viewer.selectedEntityChanged.addEventListener(onSelectedEntityChanged);

    createButton();

    // Do NOT auto-fetch — wait for user to click the button
    // Start in hidden state
    state.visible = false;
    updateButton();

    console.log('STA: SensorThings module initialized');
  }

  // =====================================
  // AUTO-INIT: Wait for viewer
  // =====================================

  function waitForViewer() {
    if (window.BimViewer && window.BimViewer.viewer) {
      init(window.BimViewer.viewer);
    } else {
      setTimeout(waitForViewer, 500);
    }
  }

  waitForViewer();

  // =====================================
  // PUBLIC API
  // =====================================

  function prefetch() {
    if (_prefetchedStations) return;
    fetch(THINGS_URL)
      .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function(json) {
        _prefetchedStations = parseThings(json);
        console.log('STA: Prefetched ' + _prefetchedStations.length + ' stations');
      })
      .catch(function(err) { console.warn('STA: Prefetch failed:', err); });
  }

  function toggleInfoFlyout() {
    var flyout = document.getElementById('staInfoFlyout');
    var btn = document.querySelector('.sta-info-btn');
    if (!flyout) return;
    var isOpen = flyout.style.display !== 'none';
    flyout.style.display = isOpen ? 'none' : 'block';
    if (btn) btn.classList.toggle('active', !isOpen);
  }

  return {
    init: init,
    show: show,
    hide: hide,
    toggle: toggle,
    destroy: destroy,
    closePanel: closePanel,
    dismissDamage: dismissDamageFlyout,
    triggerDamage: triggerDamage,
    toggleInfoFlyout: toggleInfoFlyout,
    prefetch: prefetch
  };

})();
