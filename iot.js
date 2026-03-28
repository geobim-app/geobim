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
// CESIUM BIM VIEWER - IoT LIVE MODULE v1.0
// Live sensor data from Pegelonline as standalone CesiumJS markers
// ===============================
'use strict';

window.GEOBIM_IOT = (function() {

  // =====================================
  // SENSOR CONFIGURATION
  // =====================================

  var API_BASE = 'https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations/DEGGENDORF';

  var SENSORS = [
    {
      id: 'pegel_deggendorf',
      label: 'Pegel Deggendorf',
      position: { lat: 48.8303, lon: 12.9443, height: 5.0 },
      apis: {
        W:  API_BASE + '/W/currentmeasurement.json',
        WT: API_BASE + '/WT/currentmeasurement.json',
        LT: API_BASE + '/LT/currentmeasurement.json'
      },
      thresholds: { yellow: 200, red: 350 },
      unit: 'cm'
    }
  ];

  var REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  // =====================================
  // STATE
  // =====================================

  var state = {
    active: false,
    viewer: null,
    intervalId: null,
    entities: {},      // sensor id → Cesium.Entity
    lastValues: {},    // sensor id → { W: {...}, WT: {...}, LT: {...} }
    button: null
  };

  // =====================================
  // TREND SYMBOLS
  // =====================================

  var TREND_SYMBOLS = {
    '1': '\u2191',   // ↑ rising
    '-1': '\u2193',  // ↓ falling
    '0': '\u2192'    // → steady
  };

  function trendSymbol(trend) {
    return TREND_SYMBOLS[String(trend)] || '\u2192';
  }

  // =====================================
  // THRESHOLD COLOR
  // =====================================

  function getColor(value, thresholds) {
    if (value >= thresholds.red) return Cesium.Color.RED;
    if (value >= thresholds.yellow) return Cesium.Color.YELLOW;
    return Cesium.Color.LIMEGREEN;
  }

  function getColorHex(value, thresholds) {
    if (value >= thresholds.red) return '#e74c3c';
    if (value >= thresholds.yellow) return '#f1c40f';
    return '#2ecc71';
  }

  // =====================================
  // BILLBOARD SVG
  // =====================================

  function createBillboardSvg(color) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48">' +
      '<circle cx="24" cy="24" r="20" fill="' + color + '" stroke="white" stroke-width="3" opacity="0.9"/>' +
      '<circle cx="24" cy="24" r="6" fill="white"/>' +
      '<circle cx="24" cy="24" r="12" fill="none" stroke="white" stroke-width="2" opacity="0.6"/>' +
      '<line x1="24" y1="24" x2="34" y2="14" stroke="white" stroke-width="2.5" stroke-linecap="round"/>' +
      '</svg>';
    return 'data:image/svg+xml;base64,' + btoa(svg);
  }

  // =====================================
  // LABEL TEXT
  // =====================================

  function buildLabelText(sensor, values, offline) {
    var w = values.W;
    var wt = values.WT;
    var lt = values.LT;

    // Line 1: Water level
    var line1 = sensor.label + ': ';
    if (w) {
      line1 += w.value + ' ' + sensor.unit + ' ' + trendSymbol(w.trend);
    } else {
      line1 += '-- ' + sensor.unit;
    }
    if (offline) {
      line1 += ' \u26A0';
    }

    // Line 2: Temperatures
    var temps = [];
    if (wt) temps.push('Wasser ' + wt.value + '\u00B0C');
    if (lt) temps.push('Luft ' + lt.value + '\u00B0C');
    var line2 = temps.length > 0 ? temps.join(' | ') : '';

    // Line 3: Timestamp (from most recent reading)
    var ts = (w && w.timestamp) || (wt && wt.timestamp) || (lt && lt.timestamp);
    var line3 = '';
    if (ts) {
      var d = new Date(ts);
      line3 = d.toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });
    }

    var lines = [line1];
    if (line2) lines.push(line2);
    if (line3) lines.push(line3);
    return lines.join('\n');
  }

  // =====================================
  // CREATE / UPDATE ENTITY
  // =====================================

  function ensureEntity(sensor) {
    if (state.entities[sensor.id]) return state.entities[sensor.id];

    var pos = Cesium.Cartesian3.fromDegrees(
      sensor.position.lon, sensor.position.lat, sensor.position.height
    );

    var entity = state.viewer.entities.add({
      id: 'iot_' + sensor.id,
      name: sensor.label,
      position: pos,
      billboard: {
        image: createBillboardSvg('#2ecc71'),
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        scale: 1.0,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.NONE
      },
      label: {
        text: sensor.label + ': -- ' + sensor.unit + '\nWasser --\u00B0C | Luft --\u00B0C',
        font: 'bold 14px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -30),
        showBackground: true,
        backgroundColor: new Cesium.Color(0.05, 0.07, 0.09, 0.85),
        backgroundPadding: new Cesium.Cartesian2(10, 6),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      description: sensor.label
    });

    state.entities[sensor.id] = entity;
    return entity;
  }

  function updateEntity(sensor, values, offline) {
    var entity = ensureEntity(sensor);
    var w = values.W;
    var wt = values.WT;
    var lt = values.LT;
    var waterLevel = w ? w.value : null;
    var colorHex = waterLevel !== null ? getColorHex(waterLevel, sensor.thresholds) : '#2ecc71';
    var color = waterLevel !== null ? getColor(waterLevel, sensor.thresholds) : Cesium.Color.LIMEGREEN;

    entity.billboard.image = createBillboardSvg(colorHex);
    entity.label.text = buildLabelText(sensor, values, offline);
    entity.label.fillColor = color;

    // Update description for infobox on click
    var statusText = 'Normal';
    if (waterLevel !== null) {
      if (waterLevel >= sensor.thresholds.red) statusText = 'Hochwasser \u2014 Sonderpr\u00FCfung erforderlich';
      else if (waterLevel >= sensor.thresholds.yellow) statusText = 'Erh\u00F6hter Wasserstand';
    }

    var desc = '<table style="width:100%;font-size:14px;">' +
      '<tr><td><b>Station</b></td><td>' + sensor.label + '</td></tr>' +
      '<tr><td colspan="2" style="padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.1);"><b>Wasserstand</b></td></tr>' +
      '<tr><td>Pegel</td><td>' + (waterLevel !== null ? waterLevel + ' ' + sensor.unit : '--') + '</td></tr>' +
      '<tr><td>Trend</td><td>' + (w ? trendSymbol(w.trend) : '--') + '</td></tr>' +
      '<tr><td>Status</td><td style="color:' + colorHex + ';font-weight:bold;">' + statusText + '</td></tr>' +
      '<tr><td colspan="2" style="padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.1);"><b>Temperatur</b></td></tr>' +
      '<tr><td>Wasser</td><td>' + (wt ? wt.value + ' \u00B0C' : '--') + '</td></tr>' +
      '<tr><td>Luft</td><td>' + (lt ? lt.value + ' \u00B0C' : '--') + '</td></tr>' +
      '<tr><td colspan="2" style="padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.1);"></td></tr>' +
      '<tr><td>Aktualisiert</td><td>' + (w ? new Date(w.timestamp).toLocaleString('de-DE') : '--') + '</td></tr>' +
      '</table>';
    entity.description = desc;
  }

  // =====================================
  // FETCH DATA
  // =====================================

  function fetchParam(url) {
    return fetch(url)
      .then(function(response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function(json) {
        return { value: json.value, timestamp: json.timestamp, trend: json.trend };
      })
      .catch(function() {
        return null;
      });
  }

  function fetchSensor(sensor) {
    var apis = sensor.apis;
    return Promise.all([
      fetchParam(apis.W),
      fetchParam(apis.WT),
      fetchParam(apis.LT)
    ]).then(function(results) {
      var values = {
        W: results[0],
        WT: results[1],
        LT: results[2]
      };

      // Check if at least one succeeded
      var anySuccess = results[0] || results[1] || results[2];
      if (anySuccess) {
        // Merge with last known values for any failed params
        var last = state.lastValues[sensor.id] || {};
        if (!values.W && last.W) values.W = last.W;
        if (!values.WT && last.WT) values.WT = last.WT;
        if (!values.LT && last.LT) values.LT = last.LT;
        state.lastValues[sensor.id] = values;
        updateEntity(sensor, values, false);

        var w = values.W;
        var wt = values.WT;
        var lt = values.LT;
        console.log(
          '\uD83D\uDCE1 IoT [' + sensor.label + ']: ' +
          (w ? w.value + ' cm ' + trendSymbol(w.trend) : '-- cm') +
          (wt ? ' | Wasser ' + wt.value + '\u00B0C' : '') +
          (lt ? ' | Luft ' + lt.value + '\u00B0C' : '')
        );
      } else {
        console.warn('\uD83D\uDCE1 IoT [' + sensor.label + '] all fetches failed');
        var lastAll = state.lastValues[sensor.id] || { W: null, WT: null, LT: null };
        updateEntity(sensor, lastAll, true);
      }
    });
  }

  function fetchAll() {
    SENSORS.forEach(function(sensor) {
      fetchSensor(sensor);
    });
  }

  // =====================================
  // ACTIVATE / DEACTIVATE
  // =====================================

  function activate() {
    if (state.active) return;
    state.active = true;

    // Immediate fetch
    fetchAll();

    // Start interval
    state.intervalId = setInterval(fetchAll, REFRESH_INTERVAL_MS);

    // Show entities
    Object.keys(state.entities).forEach(function(id) {
      state.entities[id].show = true;
    });

    updateButton();
    console.log('\uD83D\uDCE1 IoT Live activated (' + SENSORS.length + ' sensor' + (SENSORS.length > 1 ? 's' : '') + ')');
  }

  function deactivate() {
    if (!state.active) return;
    state.active = false;

    // Stop interval
    if (state.intervalId) {
      clearInterval(state.intervalId);
      state.intervalId = null;
    }

    // Hide entities
    Object.keys(state.entities).forEach(function(id) {
      state.entities[id].show = false;
    });

    updateButton();
    console.log('\uD83D\uDCE1 IoT Live deactivated');
  }

  function toggle() {
    if (state.active) {
      deactivate();
    } else {
      activate();
    }
  }

  // =====================================
  // UI BUTTON
  // =====================================

  function createButton() {
    var btn = document.createElement('button');
    btn.id = 'iotToggleBtn';
    btn.title = 'Toggle IoT Live Sensors';
    btn.onclick = toggle;
    document.body.appendChild(btn);
    state.button = btn;

    var style = document.createElement('style');
    style.textContent =
      '#iotToggleBtn {' +
        'position: fixed;' +
        'bottom: 20px;' +
        'right: 20px;' +
        'z-index: 300;' +
        'width: 48px;' +
        'height: 48px;' +
        'border-radius: 50%;' +
        'border: 2px solid rgba(255,255,255,0.2);' +
        'background: rgba(14,17,23,0.85);' +
        'color: rgba(255,255,255,0.7);' +
        'font-size: 22px;' +
        'cursor: pointer;' +
        'display: flex;' +
        'align-items: center;' +
        'justify-content: center;' +
        'transition: all 0.2s ease;' +
        'box-shadow: 0 2px 8px rgba(0,0,0,0.3);' +
      '}' +
      '#iotToggleBtn:hover {' +
        'background: rgba(14,17,23,0.85);' +
        'border-color: rgba(255,255,255,0.4);' +
        'transform: scale(1.05);' +
      '}' +
      '#iotToggleBtn.active {' +
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
    state.button.textContent = '\uD83D\uDCE1';
    if (state.active) {
      state.button.classList.add('active');
      state.button.title = 'IoT Live \u2014 Active (click to disable)';
    } else {
      state.button.classList.remove('active');
      state.button.title = 'IoT Live \u2014 Inactive (click to enable)';
    }
  }

  // =====================================
  // INIT
  // =====================================

  function init(viewer) {
    if (!viewer) {
      console.error('\uD83D\uDCE1 IoT: No viewer provided');
      return;
    }
    state.viewer = viewer;
    createButton();
    console.log('\uD83D\uDCE1 IoT Live module initialized (' + SENSORS.length + ' sensor' + (SENSORS.length > 1 ? 's' : '') + ')');
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

  return {
    init: init,
    toggle: toggle,
    isActive: function() { return state.active; }
  };

})();
