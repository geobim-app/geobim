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
// GEOID TERRAIN MODULE — EGM2008 3D visualization
// ===============================
'use strict';

window.GEOBIM_GEOID_TERRAIN = (function() {

  // ---- i18n ----
  var TRANSLATIONS = {
    de: {
      legendTitle: 'Geoid-Undulation EGM2008',
      toggleBtn: '🌐 Geoid Terrain',
      exaggeration: '×10.000',
      loading: 'Lade EGM2008-Geoiddaten...',
      activated: 'Geoid Terrain aktiviert',
      deactivated: 'Geoid Terrain deaktiviert',
      loadError: 'EGM2008-Daten konnten nicht geladen werden',
      geoid_exaggeration: 'Vertikalüberhöhung',
      geoid_coastlines: 'Küstenlinien',
      bathymetry: 'Bathymetrie',
      bathymetry_title: 'Bathymetrie (GEBCO)',
      bathymetry_info: 'Ozeanboden-Topographie · GEBCO 2022',
      bathymetry_loading: 'Lade Bathymetriedaten...',
      bathymetry_activated: 'Bathymetrie aktiviert',
      bathymetry_deactivated: 'Bathymetrie deaktiviert'
    },
    en: {
      legendTitle: 'Geoid Undulation EGM2008',
      toggleBtn: '🌐 Geoid Terrain',
      exaggeration: '×10,000',
      loading: 'Loading EGM2008 geoid data...',
      activated: 'Geoid Terrain activated',
      deactivated: 'Geoid Terrain deactivated',
      loadError: 'Failed to load EGM2008 data',
      geoid_exaggeration: 'Vertical Exaggeration',
      geoid_coastlines: 'Coastlines',
      bathymetry: 'Bathymetry',
      bathymetry_title: 'Bathymetry (GEBCO)',
      bathymetry_info: 'Ocean floor topography · GEBCO 2022',
      bathymetry_loading: 'Loading bathymetry data...',
      bathymetry_activated: 'Bathymetry activated',
      bathymetry_deactivated: 'Bathymetry deactivated'
    }
  };

  function t(key) {
    var lang = (typeof BimViewer !== 'undefined' && BimViewer.language) || 'en';
    var dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
    return dict[key] || key;
  }

  // ---- State ----
  var active = false;
  var gridData = null;       // Float32Array (181×361)
  var loadPromise = null;
  var terrainLayer = null;   // saved reference to custom terrain provider
  var imageryLayer = null;   // saved reference to custom imagery layer
  var reliefLayer = null;    // Natural Earth II shaded relief base layer
  var legendEl = null;
  var originalTerrainProvider = null;
  var originalVerticalExaggeration = 1;
  var originalBasemapId = null;
  var originalLight = null;
  var coastlineDataSource = null;
  var coastlineLoaded = false;
  var coastlineVisible = true;
  var currentExaggeration = 10000;
  var currentViewer = null;

  // Grid dimensions
  var ROWS = 181;  // lat 90° to -90°, 1° step
  var COLS = 361;  // lon 0° to 360°, 1° step

  // Polar artifact threshold
  var POLAR_CUTOFF = 75;     // flat zero for tiles beyond ±75°
  var POLAR_FADE_RANGE = 10; // degrees over which to fade to zero

  // Color ramp stops — ICGEM/GFZ spectral ramp from reference image
  // Sampled from Geoid EIGEN-6C4 legend (icgem@gfz-potsdam.de)
  var COLOR_STOPS = [
    { value: -106, r: 200, g:   0, b: 255 },   // magenta/pink
    { value:  -80, r:   0, g:   0, b: 255 },   // blue
    { value:  -55, r:   0, g: 200, b: 255 },   // cyan
    { value:  -30, r:   0, g: 230, b:   0 },   // green
    { value:   -5, r: 160, g: 240, b:   0 },   // green-yellow
    { value:   15, r: 255, g: 255, b:   0 },   // yellow
    { value:   35, r: 255, g: 165, b:   0 },   // orange
    { value:   58, r: 255, g:   0, b:   0 },   // red
    { value:   85, r: 255, g:   0, b: 200 }    // hot pink
  ];

  // ---- Data Loading ----

  function loadGrid() {
    if (gridData) return Promise.resolve();
    if (loadPromise) return loadPromise;

    loadPromise = fetch('/data/egm2008_1deg.bin')
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.arrayBuffer();
      })
      .then(function(buf) {
        gridData = new Float32Array(buf);
        if (gridData.length !== ROWS * COLS) {
          console.warn('EGM2008 grid size mismatch: expected ' + (ROWS * COLS) + ', got ' + gridData.length);
        }
        console.log('EGM2008 geoid grid loaded (' + ROWS + '×' + COLS + ')');
      })
      .catch(function(err) {
        loadPromise = null;
        console.error('Failed to load EGM2008 grid:', err);
        throw err;
      });

    return loadPromise;
  }

  // ---- Polar Smoothstep ----

  function smoothstep(edge0, edge1, x) {
    var t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  function polarWeight(lat) {
    // smoothstep(0, 5°, 90° - |lat|)
    var distFromPole = 90 - Math.abs(lat);
    return smoothstep(0, POLAR_FADE_RANGE, distFromPole);
  }

  // ---- Bilinear Interpolation ----

  function sampleGrid(lat, lon) {
    if (!gridData) return 0;

    // Clamp latitude to avoid polar artifacts
    lat = Math.max(-75, Math.min(75, lat));

    // Polar fade: multiply by smoothstep weight
    var weight = polarWeight(lat);
    if (weight <= 0) return 0;

    // Normalize longitude to 0..360
    while (lon < 0) lon += 360;
    while (lon >= 360) lon -= 360;

    // Grid indices: row 0 = lat 90°, col 0 = lon 0°
    var rowF = (90 - lat);  // 1° step → direct index
    var colF = lon;

    var row0 = Math.floor(rowF);
    var col0 = Math.floor(colF);
    var row1 = Math.min(row0 + 1, ROWS - 1);
    var col1 = (col0 + 1) % COLS;

    var dRow = rowF - row0;
    var dCol = colF - col0;

    var v00 = gridData[row0 * COLS + col0];
    var v01 = gridData[row0 * COLS + col1];
    var v10 = gridData[row1 * COLS + col0];
    var v11 = gridData[row1 * COLS + col1];

    var v0 = v00 + (v01 - v00) * dCol;
    var v1 = v10 + (v11 - v10) * dCol;

    var raw = v0 + (v1 - v0) * dRow;
    return raw * weight;
  }

  // ---- Color Ramp ----

  function undulationToColor(value) {
    // Clamp to ramp range
    var first = COLOR_STOPS[0];
    var last = COLOR_STOPS[COLOR_STOPS.length - 1];
    if (value <= first.value) {
      return [first.r, first.g, first.b];
    }
    if (value >= last.value) {
      return [last.r, last.g, last.b];
    }

    // Find segment and linearly interpolate RGB
    for (var i = 0; i < COLOR_STOPS.length - 1; i++) {
      var a = COLOR_STOPS[i];
      var b = COLOR_STOPS[i + 1];
      if (value >= a.value && value <= b.value) {
        var f = (value - a.value) / (b.value - a.value);
        return [
          Math.round(a.r + (b.r - a.r) * f),
          Math.round(a.g + (b.g - a.g) * f),
          Math.round(a.b + (b.b - a.b) * f)
        ];
      }
    }
    return [80, 200, 50]; // fallback green
  }

  // ---- Custom Terrain Provider ----

  function createTerrainProvider() {
    var tileWidth = 64;
    var tileHeight = 64;

    return new Cesium.CustomHeightmapTerrainProvider({
      width: tileWidth,
      height: tileHeight,
      tilingScheme: new Cesium.GeographicTilingScheme(),
      requestVertexNormals: true,
      callback: function(x, y, level) {
        var heights = new Float32Array(tileWidth * tileHeight);
        var rect = this.tilingScheme.tileXYToRectangle(x, y, level);

        var west = Cesium.Math.toDegrees(rect.west);
        var south = Cesium.Math.toDegrees(rect.south);
        var east = Cesium.Math.toDegrees(rect.east);
        var north = Cesium.Math.toDegrees(rect.north);

        // Defensive layer 3: flat zero for polar tiles beyond ±85°
        if (Math.abs(north) > POLAR_CUTOFF || Math.abs(south) > POLAR_CUTOFF) {
          return heights; // all zeros
        }

        var lonStep = (east - west) / (tileWidth - 1);
        var latStep = (north - south) / (tileHeight - 1);

        for (var row = 0; row < tileHeight; row++) {
          var lat = north - row * latStep;
          for (var col = 0; col < tileWidth; col++) {
            var lon = west + col * lonStep;
            heights[row * tileWidth + col] = sampleGrid(lat, lon);
          }
        }
        return heights;
      }
    });
  }

  // ---- Custom Imagery Provider (pseudocolor) ----

  function createImageryProvider() {
    var tileSize = 256;

    return new Cesium.UrlTemplateImageryProvider({
      url: 'data:image/png;base64,',  // dummy, overridden by customTags
      tilingScheme: new Cesium.GeographicTilingScheme(),
      tileWidth: tileSize,
      tileHeight: tileSize,
      hasAlphaChannel: true,
      minimumLevel: 0,
      maximumLevel: 5
    });
  }

  // Build a canvas-based imagery provider using a SingleTileImageryProvider approach
  function createCanvasImageryProvider() {
    var tileSize = 512;

    // Create a full-world image
    var useOffscreen = typeof OffscreenCanvas !== 'undefined';
    var canvas;
    if (useOffscreen) {
      canvas = new OffscreenCanvas(720, 360);
    } else {
      canvas = document.createElement('canvas');
      canvas.width = 720;
      canvas.height = 360;
    }

    var ctx = canvas.getContext('2d');
    var imgData = ctx.createImageData(720, 360);
    var pixels = imgData.data;

    // 0.5° per pixel: 720 pixels = 360° lon, 360 pixels = 180° lat
    for (var py = 0; py < 360; py++) {
      var lat = 90 - py * 0.5;
      for (var px = 0; px < 720; px++) {
        var lon = -180 + px * 0.5;
        var val = sampleGrid(lat, lon);
        var rgb = undulationToColor(val);
        var idx = (py * 720 + px) * 4;
        pixels[idx]     = rgb[0];
        pixels[idx + 1] = rgb[1];
        pixels[idx + 2] = rgb[2];
        pixels[idx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // Convert to blob URL
    if (useOffscreen) {
      // For OffscreenCanvas, use convertToBlob
      return canvas.convertToBlob({ type: 'image/png' }).then(function(blob) {
        var url = URL.createObjectURL(blob);
        return Cesium.SingleTileImageryProvider.fromUrl(url, {
          rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90)
        });
      });
    } else {
      return new Promise(function(resolve) {
        canvas.toBlob(function(blob) {
          var url = URL.createObjectURL(blob);
          Cesium.SingleTileImageryProvider.fromUrl(url, {
            rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90)
          }).then(resolve);
        }, 'image/png');
      });
    }
  }

  // ---- Coastline Data Source ----

  function loadCoastlines(viewer) {
    if (coastlineLoaded) {
      return Promise.resolve(coastlineDataSource);
    }

    var url50m = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_coastline.geojson';
    var url110m = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_coastline.geojson';

    var loadOpts = {
      stroke: new Cesium.Color(0.15, 0.15, 0.15, 0.8),
      strokeWidth: 1.0,
      clampToGround: false
    };

    return Cesium.GeoJsonDataSource.load(url50m, loadOpts)
      .catch(function() {
        console.warn('50m coastlines failed, falling back to 110m');
        return Cesium.GeoJsonDataSource.load(url110m, loadOpts);
      })
      .then(function(ds) {
        coastlineDataSource = ds;
        coastlineLoaded = true;

        // Store original cartographic positions and set polyline style
        var entities = ds.entities.values;
        for (var i = 0; i < entities.length; i++) {
          var entity = entities[i];
          if (entity.polyline) {
            entity.polyline.width = 1.0;
            entity.polyline.material = new Cesium.Color(0.15, 0.15, 0.15, 0.8);
            entity.polyline.clampToGround = false;

            // Cache original cartographic coords for height recalculation
            var positions = entity.polyline.positions.getValue(Cesium.JulianDate.now());
            if (positions) {
              var cartos = [];
              for (var j = 0; j < positions.length; j++) {
                cartos.push(Cesium.Cartographic.fromCartesian(positions[j]));
              }
              entity._geoidCartos = cartos;
            }
          }
        }

        return ds;
      });
  }

  function updateCoastlinePositions(exaggeration) {
    if (!coastlineDataSource) return;

    var offset = Math.max(500, exaggeration * 0.05);
    var entities = coastlineDataSource.entities.values;
    for (var i = 0; i < entities.length; i++) {
      var entity = entities[i];
      if (!entity.polyline || !entity._geoidCartos) continue;

      var cartos = entity._geoidCartos;
      var newPositions = new Array(cartos.length);
      for (var j = 0; j < cartos.length; j++) {
        var lat = Cesium.Math.toDegrees(cartos[j].latitude);
        var lon = Cesium.Math.toDegrees(cartos[j].longitude);
        var undulation = sampleGrid(lat, lon);
        newPositions[j] = Cesium.Cartesian3.fromRadians(
          cartos[j].longitude,
          cartos[j].latitude,
          (undulation * exaggeration) + offset
        );
      }
      entity.polyline.positions = new Cesium.ConstantProperty(newPositions);
    }
  }

  // ---- Legend Panel ----

  function createLegend() {
    if (legendEl) return;

    legendEl = document.createElement('div');
    legendEl.id = 'geoidTerrainLegend';
    legendEl.style.cssText = [
      'position: fixed',
      'top: 80px',
      'left: 16px',
      'width: 210px',
      'background: var(--bg-overlay, rgba(14, 17, 23, 0.82))',
      'backdrop-filter: blur(12px)',
      'border-radius: 12px',
      'box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)',
      'z-index: 200',
      'font-size: 13px',
      'color: var(--text-primary, #e2e8f0)',
      'display: flex',
      'flex-direction: column',
      'overflow: hidden',
      'pointer-events: auto'
    ].join(';');

    // Build gradient CSS from color stops (top = max, bottom = min)
    var gradientStops = COLOR_STOPS.slice().reverse().map(function(s, i) {
      var pct = (i / (COLOR_STOPS.length - 1)) * 100;
      return 'rgb(' + s.r + ',' + s.g + ',' + s.b + ') ' + pct + '%';
    }).join(', ');

    var defaultLog = Math.log10(10000).toFixed(2); // 4.00

    legendEl.innerHTML = [
      // Draggable header
      '<div id="geoidPanelHeader" class="floating-panel-header">',
        '<span class="floating-panel-title">🌐 ' + t('legendTitle') + '</span>',
        '<div class="floating-panel-controls">',
          '<button class="floating-panel-btn" id="geoidPanelCollapseBtn" title="Minimize">−</button>',
        '</div>',
      '</div>',

      // Collapsible body
      '<div id="geoidPanelBody" class="floating-panel-body" style="max-height: 500px; padding: 10px 14px;">',

        // Color ramp legend
        '<div style="display: flex; align-items: stretch; gap: 6px; margin-bottom: 10px;">',
          '<div style="width: 18px; height: 120px; border-radius: 3px; background: linear-gradient(' + gradientStops + ');"></div>',
          '<div style="display: flex; flex-direction: column; justify-content: space-between; font-size: 11px; color: rgba(255,255,255,0.8);">',
            '<span>+88 m</span>',
            '<span>+44 m</span>',
            '<span>0 m</span>',
            '<span>-44 m</span>',
            '<span>-88 m</span>',
          '</div>',
        '</div>',

        // Vertical exaggeration slider
        '<div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px;">',
          '<div style="font-size: 10px; color: rgba(255,255,255,0.6); margin-bottom: 4px;">' + t('geoid_exaggeration') + '</div>',
          '<input id="geoidExaggerationSlider" type="range" min="0" max="4.7" step="0.01" value="' + defaultLog + '" ',
            'style="width: 100%; height: 4px; cursor: pointer; accent-color: #2ECFB0;">',
          '<div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">',
            '<span id="geoidExaggerationReadout" style="font-size: 11px; color: rgba(255,255,255,0.8); font-variant-numeric: tabular-nums;">&times;10,000</span>',
          '</div>',
          '<div style="display: flex; gap: 4px; margin-top: 6px;">',
            '<button class="geoid-preset-btn" data-geoid-exag="100" style="flex:1; padding: 2px 0; font-size: 10px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; color: rgba(255,255,255,0.7); cursor: pointer;">100&times;</button>',
            '<button class="geoid-preset-btn" data-geoid-exag="1000" style="flex:1; padding: 2px 0; font-size: 10px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; color: rgba(255,255,255,0.7); cursor: pointer;">1,000&times;</button>',
            '<button class="geoid-preset-btn" data-geoid-exag="10000" style="flex:1; padding: 2px 0; font-size: 10px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; color: rgba(255,255,255,0.7); cursor: pointer;">10,000&times;</button>',
          '</div>',
        '</div>',

        // Coastline toggle
        '<div style="margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px;">',
          '<label style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: rgba(255,255,255,0.8); cursor: pointer;">',
            '<input id="geoidCoastlineToggle" type="checkbox" checked style="cursor: pointer; accent-color: #2ECFB0;">',
            '<span>' + t('geoid_coastlines') + '</span>',
          '</label>',
        '</div>',

      '</div>'
    ].join('');

    document.body.appendChild(legendEl);

    // Make draggable via header
    if (typeof BimViewer !== 'undefined' && BimViewer.makeFloatingPanelDraggable) {
      BimViewer.makeFloatingPanelDraggable(legendEl, document.getElementById('geoidPanelHeader'));
    } else {
      // Fallback inline drag
      initDrag(legendEl, document.getElementById('geoidPanelHeader'));
    }

    // Wire collapse/minimize button
    var collapseBtn = document.getElementById('geoidPanelCollapseBtn');
    var panelBody = document.getElementById('geoidPanelBody');
    if (collapseBtn && panelBody) {
      collapseBtn.addEventListener('click', function() {
        panelBody.classList.toggle('collapsed');
        collapseBtn.textContent = panelBody.classList.contains('collapsed') ? '+' : '−';
      });
    }

    // Wire exaggeration slider
    var slider = document.getElementById('geoidExaggerationSlider');
    var readout = document.getElementById('geoidExaggerationReadout');
    if (slider) {
      slider.addEventListener('input', function() {
        var val = Math.round(Math.pow(10, parseFloat(slider.value)));
        currentExaggeration = val;
        if (currentViewer) {
          currentViewer.scene.verticalExaggeration = val;
        }
        readout.textContent = '\u00d7' + val.toLocaleString();
        updateCoastlinePositions(val);
      });
    }

    // Wire preset buttons
    var presetBtns = legendEl.querySelectorAll('.geoid-preset-btn');
    for (var i = 0; i < presetBtns.length; i++) {
      presetBtns[i].addEventListener('click', function() {
        var val = parseInt(this.getAttribute('data-geoid-exag'), 10);
        currentExaggeration = val;
        if (currentViewer) {
          currentViewer.scene.verticalExaggeration = val;
        }
        if (slider) {
          slider.value = Math.log10(val).toFixed(2);
        }
        if (readout) {
          readout.textContent = '\u00d7' + val.toLocaleString();
        }
        updateCoastlinePositions(val);
      });
    }

    // Wire coastline toggle
    var coastToggle = document.getElementById('geoidCoastlineToggle');
    if (coastToggle) {
      coastToggle.addEventListener('change', function() {
        coastlineVisible = coastToggle.checked;
        if (currentViewer && coastlineDataSource) {
          if (coastlineVisible) {
            if (!currentViewer.dataSources.contains(coastlineDataSource)) {
              currentViewer.dataSources.add(coastlineDataSource);
            }
          } else {
            currentViewer.dataSources.remove(coastlineDataSource, false);
          }
        }
      });
    }
  }

  // Fallback drag handler if BimViewer.makeFloatingPanelDraggable not available
  function initDrag(panel, handle) {
    var isDragging = false, startX, startY, startLeft, startTop;
    handle.addEventListener('mousedown', function(e) {
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      var rect = panel.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      panel.style.transition = 'none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', function(e) {
      if (!isDragging) return;
      panel.style.left = (startLeft + e.clientX - startX) + 'px';
      panel.style.top = (startTop + e.clientY - startY) + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', function() {
      if (isDragging) {
        isDragging = false;
        panel.style.transition = '';
      }
    });
  }

  function showLegend() {
    if (!legendEl) createLegend();
    legendEl.style.display = 'block';
  }

  function hideLegend() {
    if (legendEl) legendEl.style.display = 'none';
  }

  // ---- Toggle Button UI ----

  function updateToggleButton() {
    var btn = document.getElementById('toggleGeoidTerrain');
    if (!btn) return;
    if (active) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  }

  // ---- Public API ----

  function activate(viewer) {
    if (active || !viewer) return;

    // Mutual exclusivity: deactivate bathymetry first
    if (typeof window.GEOBIM_BATHYMETRY !== 'undefined' && window.GEOBIM_BATHYMETRY.isActive()) {
      window.GEOBIM_BATHYMETRY.deactivate(viewer);
    }

    currentViewer = viewer;

    if (typeof BimViewer !== 'undefined') {
      BimViewer.updateStatus(t('loading'), 'loading');
    }

    loadGrid().then(function() {
      // Store originals
      originalTerrainProvider = viewer.terrainProvider;
      originalVerticalExaggeration = viewer.scene.verticalExaggeration || 1;

      // Deactivate basemap
      if (typeof LayerManager !== 'undefined' && LayerManager.activeBasemap) {
        originalBasemapId = LayerManager.activeBasemap;
        LayerManager.switchBasemap('none');
      }

      // Set custom terrain
      var tp = createTerrainProvider();
      viewer.terrainProvider = tp;
      terrainLayer = tp;

      // Set vertical exaggeration and globe lighting
      viewer.scene.verticalExaggeration = currentExaggeration;
      viewer.scene.globe.enableLighting = true;
      viewer.scene.globe.terrainExaggerationRelativeHeight = 0.0;

      // Directional light matching reference: light=(11°,23°,3,0)
      // Azimuth 11° from north, elevation 23°
      originalLight = viewer.scene.light;
      var azRad = Cesium.Math.toRadians(11);
      var elRad = Cesium.Math.toRadians(23);
      var cosEl = Math.cos(elRad);
      viewer.scene.light = new Cesium.DirectionalLight({
        direction: new Cesium.Cartesian3(
          Math.sin(azRad) * cosEl,
          Math.cos(azRad) * cosEl,
          -Math.sin(elRad)
        ),
        intensity: 5.0
      });

      // Add Natural Earth II shaded relief as base (Ion asset 3813)
      var reliefProvider = Cesium.IonImageryProvider.fromAssetId(3813);

      // Add pseudocolor imagery on top
      return Promise.all([reliefProvider, createCanvasImageryProvider()]).then(function(results) {
        reliefLayer = viewer.imageryLayers.addImageryProvider(results[0], 0);
        reliefLayer.alpha = 1.0;

        imageryLayer = viewer.imageryLayers.addImageryProvider(results[1]);
        imageryLayer.alpha = 0.72;

        active = true;
        showLegend();
        updateToggleButton();

        // Load and add coastlines
        if (coastlineVisible) {
          loadCoastlines(viewer).then(function(ds) {
            if (active && !viewer.dataSources.contains(ds)) {
              updateCoastlinePositions(currentExaggeration);
              viewer.dataSources.add(ds);
            }
          }).catch(function(err) {
            console.warn('Coastline load failed:', err);
          });
        }

        if (typeof BimViewer !== 'undefined') {
          BimViewer.updateStatus(t('activated'), 'success');
        }
        console.log('Geoid Terrain activated');
      });
    }).catch(function(err) {
      console.error('Geoid Terrain activation failed:', err);
      if (typeof BimViewer !== 'undefined') {
        BimViewer.updateStatus(t('loadError'), 'error');
      }
    });
  }

  function deactivate(viewer) {
    if (!active || !viewer) return;

    // Restore terrain
    if (originalTerrainProvider) {
      viewer.terrainProvider = originalTerrainProvider;
      originalTerrainProvider = null;
    }

    // Restore vertical exaggeration and globe lighting
    viewer.scene.verticalExaggeration = originalVerticalExaggeration;
    originalVerticalExaggeration = 1;
    viewer.scene.globe.enableLighting = false;

    // Restore original light
    if (originalLight !== null) {
      viewer.scene.light = originalLight;
      originalLight = null;
    }

    // Remove imagery layers
    if (imageryLayer) {
      viewer.imageryLayers.remove(imageryLayer);
      imageryLayer = null;
    }
    if (reliefLayer) {
      viewer.imageryLayers.remove(reliefLayer);
      reliefLayer = null;
    }

    // Remove coastlines
    if (coastlineDataSource && viewer.dataSources.contains(coastlineDataSource)) {
      viewer.dataSources.remove(coastlineDataSource, false);
    }

    // Restore basemap
    if (originalBasemapId && typeof LayerManager !== 'undefined') {
      LayerManager.switchBasemap(originalBasemapId);
      originalBasemapId = null;
    }

    terrainLayer = null;
    active = false;
    currentViewer = null;
    hideLegend();
    updateToggleButton();

    if (typeof BimViewer !== 'undefined') {
      BimViewer.updateStatus(t('deactivated'), 'success');
    }
    console.log('Geoid Terrain deactivated');
  }

  function toggle(viewer) {
    if (active) {
      deactivate(viewer);
    } else {
      activate(viewer);
    }
  }

  function isActive() {
    return active;
  }

  // ---- Module API ----

  return {
    activate: activate,
    deactivate: deactivate,
    toggle: toggle,
    isActive: isActive
  };

})();


// ===============================
// BATHYMETRY MODULE — GEBCO ocean floor visualization
// ===============================

window.GEOBIM_BATHYMETRY = (function() {

  // Reuse i18n from geoid module
  function t(key) {
    var lang = (typeof BimViewer !== 'undefined' && BimViewer.language) || 'en';
    var TRANSLATIONS = {
      de: {
        bathymetry_title: 'Bathymetrie (GEBCO)',
        bathymetry_info: 'Ozeanboden-Topographie · GEBCO 2022',
        bathymetry_loading: 'Lade Bathymetriedaten...',
        bathymetry_activated: 'Bathymetrie aktiviert',
        bathymetry_deactivated: 'Bathymetrie deaktiviert',
        bathymetry_exaggeration: 'Vertikalüberhöhung'
      },
      en: {
        bathymetry_title: 'Bathymetry (GEBCO)',
        bathymetry_info: 'Ocean floor topography · GEBCO 2022',
        bathymetry_loading: 'Loading bathymetry data...',
        bathymetry_activated: 'Bathymetry activated',
        bathymetry_deactivated: 'Bathymetry deactivated',
        bathymetry_exaggeration: 'Vertical Exaggeration'
      }
    };
    var dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
    return dict[key] || key;
  }

  // ---- State ----
  var active = false;
  var panelEl = null;
  var currentViewer = null;
  var currentExaggeration = 20;

  // Saved originals
  var origTerrain = null;
  var origExaggeration = 1;
  var origBasemapId = null;
  var origFog = true;
  var origAtmosphere = true;
  var origLighting = false;
  var origLight = null;

  // ---- Panel ----

  function createPanel() {
    if (panelEl) return;

    panelEl = document.createElement('div');
    panelEl.id = 'bathymetryPanel';
    panelEl.style.cssText = [
      'position: fixed',
      'top: 80px',
      'left: 16px',
      'width: 210px',
      'background: var(--bg-overlay, rgba(14, 17, 23, 0.82))',
      'backdrop-filter: blur(12px)',
      'border-radius: 12px',
      'box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)',
      'z-index: 200',
      'font-size: 13px',
      'color: var(--text-primary, #e2e8f0)',
      'display: flex',
      'flex-direction: column',
      'overflow: hidden',
      'pointer-events: auto'
    ].join(';');

    var defaultLog = Math.log10(20).toFixed(2);

    panelEl.innerHTML = [
      // Draggable header
      '<div id="bathyPanelHeader" class="floating-panel-header">',
        '<span class="floating-panel-title">\uD83C\uDF0A ' + t('bathymetry_title') + '</span>',
        '<div class="floating-panel-controls">',
          '<button class="floating-panel-btn" id="bathyPanelCollapseBtn" title="Minimize">\u2212</button>',
        '</div>',
      '</div>',

      // Collapsible body
      '<div id="bathyPanelBody" class="floating-panel-body" style="max-height: 500px; padding: 10px 14px;">',

        // Vertical exaggeration slider
        '<div style="margin-bottom: 8px;">',
          '<div style="font-size: 10px; color: rgba(255,255,255,0.6); margin-bottom: 4px;">' + t('bathymetry_exaggeration') + '</div>',
          '<input id="bathyExaggerationSlider" type="range" min="0" max="2.0" step="0.01" value="' + defaultLog + '" ',
            'style="width: 100%; height: 4px; cursor: pointer; accent-color: #2ECFB0;">',
          '<div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">',
            '<span id="bathyExaggerationReadout" style="font-size: 11px; color: rgba(255,255,255,0.8); font-variant-numeric: tabular-nums;">\u00d720</span>',
          '</div>',
          '<div style="display: flex; gap: 4px; margin-top: 6px;">',
            '<button class="bathy-preset-btn" data-bathy-exag="5" style="flex:1; padding: 2px 0; font-size: 10px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; color: rgba(255,255,255,0.7); cursor: pointer;">5\u00d7</button>',
            '<button class="bathy-preset-btn" data-bathy-exag="20" style="flex:1; padding: 2px 0; font-size: 10px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; color: rgba(255,255,255,0.7); cursor: pointer;">20\u00d7</button>',
            '<button class="bathy-preset-btn" data-bathy-exag="50" style="flex:1; padding: 2px 0; font-size: 10px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; color: rgba(255,255,255,0.7); cursor: pointer;">50\u00d7</button>',
          '</div>',
        '</div>',

        // Info line
        '<div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px; font-size: 10px; color: rgba(255,255,255,0.4);">',
          t('bathymetry_info') + '<br>Ion Asset 2426648',
        '</div>',

      '</div>'
    ].join('');

    document.body.appendChild(panelEl);

    // Make draggable
    if (typeof BimViewer !== 'undefined' && BimViewer.makeFloatingPanelDraggable) {
      BimViewer.makeFloatingPanelDraggable(panelEl, document.getElementById('bathyPanelHeader'));
    } else {
      bathyInitDrag(panelEl, document.getElementById('bathyPanelHeader'));
    }

    // Collapse button
    var collapseBtn = document.getElementById('bathyPanelCollapseBtn');
    var body = document.getElementById('bathyPanelBody');
    if (collapseBtn && body) {
      collapseBtn.addEventListener('click', function() {
        body.classList.toggle('collapsed');
        collapseBtn.textContent = body.classList.contains('collapsed') ? '+' : '\u2212';
      });
    }

    // Slider
    var slider = document.getElementById('bathyExaggerationSlider');
    var readout = document.getElementById('bathyExaggerationReadout');
    if (slider) {
      slider.addEventListener('input', function() {
        var val = Math.round(Math.pow(10, parseFloat(slider.value)));
        if (val < 1) val = 1;
        currentExaggeration = val;
        if (currentViewer) {
          currentViewer.scene.verticalExaggeration = val;
        }
        readout.textContent = '\u00d7' + val.toLocaleString();
      });
    }

    // Preset buttons
    var presetBtns = panelEl.querySelectorAll('.bathy-preset-btn');
    for (var i = 0; i < presetBtns.length; i++) {
      presetBtns[i].addEventListener('click', function() {
        var val = parseInt(this.getAttribute('data-bathy-exag'), 10);
        currentExaggeration = val;
        if (currentViewer) {
          currentViewer.scene.verticalExaggeration = val;
        }
        if (slider) {
          slider.value = Math.log10(val).toFixed(2);
        }
        if (readout) {
          readout.textContent = '\u00d7' + val.toLocaleString();
        }
      });
    }
  }

  // Fallback drag
  function bathyInitDrag(panel, handle) {
    var isDragging = false, startX, startY, startLeft, startTop;
    handle.addEventListener('mousedown', function(e) {
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      var rect = panel.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      panel.style.transition = 'none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', function(e) {
      if (!isDragging) return;
      panel.style.left = (startLeft + e.clientX - startX) + 'px';
      panel.style.top = (startTop + e.clientY - startY) + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', function() {
      if (isDragging) {
        isDragging = false;
        panel.style.transition = '';
      }
    });
  }

  function showPanel() {
    if (!panelEl) createPanel();
    panelEl.style.display = 'flex';
  }

  function hidePanel() {
    if (panelEl) panelEl.style.display = 'none';
  }

  function updateToggleButton() {
    var btn = document.getElementById('toggleBathymetry');
    if (!btn) return;
    if (active) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  }

  // ---- Public API ----

  function activate(viewer) {
    if (active || !viewer) return;

    // Mutual exclusivity: deactivate geoid first
    if (typeof window.GEOBIM_GEOID_TERRAIN !== 'undefined' && window.GEOBIM_GEOID_TERRAIN.isActive()) {
      window.GEOBIM_GEOID_TERRAIN.deactivate(viewer);
    }

    currentViewer = viewer;

    if (typeof BimViewer !== 'undefined') {
      BimViewer.updateStatus(t('bathymetry_loading'), 'loading');
    }

    // Store originals
    origTerrain = viewer.terrainProvider;
    origExaggeration = viewer.scene.verticalExaggeration || 1;
    origFog = viewer.scene.fog.enabled;
    origAtmosphere = viewer.scene.globe.showGroundAtmosphere;
    origLighting = viewer.scene.globe.enableLighting;
    origLight = viewer.scene.light;

    if (typeof LayerManager !== 'undefined' && LayerManager.activeBasemap) {
      origBasemapId = LayerManager.activeBasemap;
      LayerManager.switchBasemap('none');
    }

    // Load bathymetry terrain + Sentinel-2 imagery
    Promise.all([
      Cesium.createWorldBathymetryAsync({ requestVertexNormals: true }),
      Cesium.IonImageryProvider.fromAssetId(3954)
    ]).then(function(results) {
      var bathyTerrain = results[0];
      var sentinel2 = results[1];

      viewer.terrainProvider = bathyTerrain;
      viewer.scene.verticalExaggeration = currentExaggeration;
      viewer.scene.globe.enableLighting = true;
      viewer.scene.light = new Cesium.DirectionalLight({
        direction: Cesium.Cartesian3.fromElements(-0.3, -0.5, -0.8)
      });
      viewer.scene.fog.enabled = false;
      viewer.scene.globe.showGroundAtmosphere = false;

      // Replace imagery with Sentinel-2
      viewer.imageryLayers.removeAll();
      viewer.imageryLayers.addImageryProvider(sentinel2);

      active = true;
      showPanel();
      updateToggleButton();

      if (typeof BimViewer !== 'undefined') {
        BimViewer.updateStatus(t('bathymetry_activated'), 'success');
      }
      console.log('Bathymetry activated');
    }).catch(function(err) {
      console.error('Bathymetry activation failed:', err);
      if (typeof BimViewer !== 'undefined') {
        BimViewer.updateStatus('Bathymetry failed: ' + err.message, 'error');
      }
    });
  }

  function deactivate(viewer) {
    if (!active || !viewer) return;

    // Restore terrain
    if (origTerrain) {
      viewer.terrainProvider = origTerrain;
      origTerrain = null;
    }

    // Restore exaggeration
    viewer.scene.verticalExaggeration = origExaggeration;
    origExaggeration = 1;

    // Restore lighting
    viewer.scene.globe.enableLighting = origLighting;
    origLighting = false;

    // Restore light
    if (origLight !== null) {
      viewer.scene.light = origLight;
      origLight = null;
    } else {
      viewer.scene.light = new Cesium.SunLight();
    }

    // Restore fog + atmosphere
    viewer.scene.fog.enabled = origFog;
    origFog = true;
    viewer.scene.globe.showGroundAtmosphere = origAtmosphere;
    origAtmosphere = true;

    // Restore basemap (removes Sentinel-2, LayerManager re-adds basemap)
    viewer.imageryLayers.removeAll();
    if (origBasemapId && typeof LayerManager !== 'undefined') {
      LayerManager.switchBasemap(origBasemapId);
      origBasemapId = null;
    }

    active = false;
    currentViewer = null;
    hidePanel();
    updateToggleButton();

    if (typeof BimViewer !== 'undefined') {
      BimViewer.updateStatus(t('bathymetry_deactivated'), 'success');
    }
    console.log('Bathymetry deactivated');
  }

  function toggle(viewer) {
    if (active) {
      deactivate(viewer);
    } else {
      activate(viewer);
    }
  }

  function isActive() {
    return active;
  }

  return {
    activate: activate,
    deactivate: deactivate,
    toggle: toggle,
    isActive: isActive
  };

})();
