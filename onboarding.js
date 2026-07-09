// ============================================================
// Onboarding Tour for geobim.app
//
// Copyright (c) 2026 geobim.app
// Lightweight guided tour — no external dependencies.
// Triggered on first visit or from About dialog.
// ============================================================

(function() {
  'use strict';

  var IS_BRIDGE_INSPECTOR = !!window._bridgeInspectorMode;
  var IS_WEA = !!window._weaDemoMode;
  var STORAGE_KEY = IS_BRIDGE_INSPECTOR ? 'geobim_bridge_tour_v1'
                  : IS_WEA ? 'geobim_wea_tour_v1'
                  : 'geobim_tour_v1';

  // Tour language (text only — the GUI stays in its native language).
  // Trigger via ?lang=ja; falls back to the browser locale.
  var LANG = (function() {
    try {
      var p = new URLSearchParams(window.location.search).get('lang');
      if (p) return p.toLowerCase().indexOf('ja') === 0 ? 'ja' : 'en';
      return (navigator.language || '').toLowerCase().indexOf('ja') === 0 ? 'ja' : 'en';
    } catch (e) { return 'en'; }
  })();

  // Tour navigation button labels per language.
  var LABELS = {
    en: { back: 'Back', next: 'Next', done: 'Got it!', skip: 'Skip' },
    ja: { back: '戻る', next: '次へ', done: '完了', skip: 'スキップ' }
  };
  var overlay = null;
  var tooltip = null;
  var currentStep = 0;

  var defaultSteps = [
    {
      target: '#cesiumContainer',
      title: 'Welcome to geobim.app',
      text: 'This is your 3D BIM viewer. Left-click + drag to rotate, scroll to zoom, middle-click to pan.',
      position: 'center'
    },
    {
      target: '#toolbar',
      title: 'Sidebar — Data & Filters',
      text: 'Browse your assets, manage layers, filter IFC/Revit categories, and add annotations. Click sections to expand.',
      position: 'right'
    },
    {
      target: '.bottom-toolbar',
      title: 'Action Toolbar',
      text: 'Quick access to measurement tools, visibility toggles, lighting controls, walk mode, and help.',
      position: 'top'
    },
    {
      target: '.bottom-toolbar-btn[data-section="drawing"]',
      title: 'Measure & Clip',
      text: 'Measure distances, areas, and heights. Draw clipping polygons to section through buildings.',
      position: 'top'
    },
    {
      target: '#bottomWalkBtn',
      title: 'Walk Mode (G)',
      text: 'Explore at ground level with WASD + mouse. Press V for third-person view with animated character.',
      position: 'top'
    },
    {
      target: null,
      title: 'You\'re ready!',
      text: 'Press M to toggle the sidebar, H to hide elements, or check Help for all keyboard shortcuts. Enjoy exploring!',
      position: 'center'
    }
  ];

  var bridgeSteps = [
    {
      target: '#cesiumContainer',
      title: 'Welcome to Bridge Inspector',
      text: 'Four bridge models are pre-loaded. Use the next 30 minutes to inspect components, place condition annotations, measure dimensions, and save viewpoints — just like a real inspection workflow.',
      position: 'center'
    },
    {
      target: '#floatingAssetsPanel',
      title: 'Loaded Bridges',
      text: 'All bridge models live in this floating panel. Click 📍 on a card to fly to that bridge, 👁️ to toggle visibility, or expand the card to adjust opacity and vertical offset.',
      position: 'left'
    },
    {
      target: '.modern-section-header[data-section="comments"]',
      title: 'Annotations',
      text: 'Right-click anywhere on a bridge to drop a marker. Switch between Point, Circle, Polyline, or Area to highlight cracks, spalling, or zones that need attention.',
      position: 'right'
    },
    {
      target: '.modern-section-header[data-section="inspection"]',
      title: 'Inspection Workflow',
      text: 'When adding an annotation, enable the Inspection checkbox to attach a condition rating, the affected component (deck, bearings, piers...) and damage type. Markers are color-coded by severity.',
      position: 'right'
    },
    {
      target: '.modern-section-header[data-section="drawing"]',
      title: 'Measure',
      text: 'Capture distances, areas, and heights — useful for documenting gap widths, deflections, and structural dimensions on real geometry.',
      position: 'right'
    },
    {
      target: '.modern-section-header[data-section="visibility"]',
      title: 'Visibility',
      text: 'Hide obstructing elements (e.g. the deck slab) to inspect bearings or main girders beneath. Press H to enter Hide mode, then click elements you want to remove from view.',
      position: 'right'
    },
    {
      target: '.modern-section-header[data-section="views"]',
      title: 'Saved Views',
      text: 'Store key inspection viewpoints (e.g. "Bearing axis 10", "South pier head") so you can return to a specific perspective in one click.',
      position: 'right'
    },
    {
      target: null,
      title: 'You\'re ready',
      text: 'Your 30-minute Bridge Inspector demo starts now. Sign in for unlimited access and to inspect your own models on the full geobim.app platform.',
      position: 'center'
    }
  ];

  var weaSteps = [
    {
      target: '#cesiumContainer',
      title: 'Welcome to Wind Shadow Analysis',
      text: 'Simulate the shadow flicker of wind turbines on real terrain. The next 30 minutes are yours — place turbines, cast their shadows, and run a compliance-style daily analysis. Left-click + drag to rotate, scroll to zoom.',
      position: 'center'
    },
    {
      target: '#weaShadowPanel',
      title: 'WEA Shadow Panel',
      text: 'Everything happens in this floating panel. It is draggable — move it anywhere you like. Each control below is one step of the workflow.',
      position: 'left'
    },
    {
      target: '#weaLoadBtn',
      title: 'Load a Turbine',
      text: 'Adds a wind turbine (default: Enercon E-138 EP3) at the current location. You can adjust hub height, rotor diameter and RPM per turbine, and place several at once.',
      position: 'left'
    },
    {
      target: '#weaShadowToggle',
      title: 'Cast Shadows',
      text: 'Toggle the sun-driven shadows on. The rotor blades cast a moving shadow onto the ground and surrounding buildings — exactly what causes shadow flicker.',
      position: 'left'
    },
    {
      target: '#weaTimeSlider',
      title: 'Date & Time',
      text: 'Pick a date and drag the time slider to move the sun across the sky. Watch how the shadow length and direction change through the day and the seasons.',
      position: 'left'
    },
    {
      target: '#weaPlayDayBtn',
      title: 'Play the Day',
      text: 'Animate the full daylight cycle to see where and how long the shadow sweeps across each location — the basis for shadow-flicker duration.',
      position: 'left'
    },
    {
      target: '#weaImmissionBtn',
      title: 'Immission Analysis',
      text: 'Compute the shadow impact at receptor points — the kind of assessment used for BImSchG shadow-flicker compliance in Germany.',
      position: 'left'
    },
    {
      target: '#weaLoadContext',
      title: 'Building Context',
      text: 'Load surrounding buildings so shadows fall onto real structures, not just flat ground — more realistic immission results.',
      position: 'left'
    },
    {
      target: null,
      title: 'You\'re ready',
      text: 'Your 30-minute demo starts now. Sign in for unlimited access and to run wind shadow analyses on your own sites within the full geobim.app platform.',
      position: 'center'
    }
  ];

  // Japanese WEA tour — same targets/positions as weaSteps, translated text only.
  var weaStepsJA = [
    {
      target: '#cesiumContainer',
      title: '風影解析へようこそ',
      text: '実際の地形上で風力タービンの影のちらつき（シャドーフリッカー）をシミュレートします。これからの30分間は自由にお使いいただけます。タービンを配置し、影を投影し、コンプライアンス相当の1日解析を実行できます。左クリック＋ドラッグで回転、スクロールでズームします。',
      position: 'center'
    },
    {
      target: '#weaShadowPanel',
      title: 'WEA 影パネル',
      text: 'すべての操作はこのフローティングパネルで行います。ドラッグして好きな場所へ移動できます。以下の各コントロールがワークフローの各ステップに対応しています。',
      position: 'left'
    },
    {
      target: '#weaLoadBtn',
      title: 'タービンを読み込む',
      text: '現在の位置に風力タービン（既定：Enercon E-138 EP3）を追加します。タービンごとにハブ高さ・ローター直径・回転数（RPM）を調整でき、複数台を配置できます。',
      position: 'left'
    },
    {
      target: '#weaShadowToggle',
      title: '影を投影する',
      text: '太陽に基づく影をオンにします。ローターブレードが地面や周囲の建物に動く影を落とします——これがシャドーフリッカーの原因です。',
      position: 'left'
    },
    {
      target: '#weaTimeSlider',
      title: '日付と時刻',
      text: '日付を選び、時刻スライダーをドラッグして太陽を空に沿って動かします。影の長さと向きが1日や季節を通じてどのように変化するかを確認できます。',
      position: 'left'
    },
    {
      target: '#weaPlayDayBtn',
      title: '1日を再生',
      text: '日中サイクル全体をアニメーション再生し、影が各地点をどこへ・どれだけの時間スイープするかを確認します——シャドーフリッカー継続時間の基礎となります。',
      position: 'left'
    },
    {
      target: '#weaImmissionBtn',
      title: 'イミッシオン解析',
      text: '受影点における影の影響を計算します——ドイツの BImSchG（連邦イミッシオン防止法）のシャドーフリッカー適合性評価で用いられる種類の評価です。',
      position: 'left'
    },
    {
      target: '#weaLoadContext',
      title: '建物コンテキスト',
      text: '周囲の建物を読み込み、影が平らな地面だけでなく実際の構造物に落ちるようにします——より現実的なイミッシオン結果が得られます。',
      position: 'left'
    },
    {
      target: null,
      title: '準備完了',
      text: '30分間のデモが始まります。サインインすると、完全な geobim.app プラットフォーム上で、ご自身のサイトについて無制限に風影解析を実行できます。',
      position: 'center'
    }
  ];

  var steps = IS_BRIDGE_INSPECTOR ? bridgeSteps
            : IS_WEA ? (LANG === 'ja' ? weaStepsJA : weaSteps)
            : defaultSteps;

  // ========================================================
  // OVERLAY + SPOTLIGHT
  // ========================================================

  function createOverlay() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.id = 'tourOverlay';
    overlay.innerHTML = '<svg width="100%" height="100%" style="position:absolute;top:0;left:0;">' +
      '<defs><mask id="tourMask">' +
      '<rect width="100%" height="100%" fill="white"/>' +
      '<rect id="tourSpotlight" rx="12" ry="12" fill="black"/>' +
      '</mask></defs>' +
      '<rect width="100%" height="100%" fill="rgba(0,0,0,0.7)" mask="url(#tourMask)"/>' +
      '</svg>';

    var style = document.createElement('style');
    style.textContent =
      '#tourOverlay{position:fixed;top:0;left:0;width:100%;height:100%;z-index:450;pointer-events:auto;}' +
      '#tourTooltip{position:fixed;z-index:451;max-width:340px;background:rgba(14,17,23,0.95);' +
        'backdrop-filter:blur(12px);border:1px solid rgba(46,207,176,0.4);border-radius:12px;' +
        'padding:20px;color:#E2E8F0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
        'box-shadow:0 8px 32px rgba(0,0,0,0.5);pointer-events:auto;}' +
      '#tourTooltip h3{margin:0 0 8px;color:#2ECFB0;font-size:16px;font-weight:700;}' +
      '#tourTooltip p{margin:0 0 16px;font-size:13px;line-height:1.5;color:rgba(255,255,255,0.8);}' +
      '.tour-btns{display:flex;gap:8px;align-items:center;}' +
      '.tour-btn{padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;' +
        'border:none;transition:all 0.2s ease;}' +
      '.tour-btn-primary{background:linear-gradient(135deg,#2ECFB0,#25A98F);color:#0E1117;}' +
      '.tour-btn-primary:hover{box-shadow:0 4px 12px rgba(46,207,176,0.4);}' +
      '.tour-btn-secondary{background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.7);' +
        'border:1px solid rgba(255,255,255,0.2);}' +
      '.tour-btn-secondary:hover{background:rgba(255,255,255,0.15);color:white;}' +
      '.tour-skip{margin-left:auto;background:none;border:none;color:rgba(255,255,255,0.4);' +
        'font-size:12px;cursor:pointer;padding:4px 8px;}' +
      '.tour-skip:hover{color:rgba(255,255,255,0.7);}' +
      '.tour-dots{display:flex;gap:6px;margin-right:12px;}' +
      '.tour-dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,0.2);}' +
      '.tour-dot.active{background:#2ECFB0;}';

    document.head.appendChild(style);
    document.body.appendChild(overlay);

    tooltip = document.createElement('div');
    tooltip.id = 'tourTooltip';
    document.body.appendChild(tooltip);

    // Click overlay to advance
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay || e.target.tagName === 'svg' || e.target.tagName === 'rect') {
        nextStep();
      }
    });
  }

  // ========================================================
  // STEP RENDERING
  // ========================================================

  function showStep(index) {
    if (index >= steps.length) { endTour(); return; }
    if (index < 0) index = 0;
    currentStep = index;

    var step = steps[index];
    var el = step.target ? document.querySelector(step.target) : null;
    var spotlight = document.getElementById('tourSpotlight');

    // Position spotlight
    if (el && spotlight) {
      var rect = el.getBoundingClientRect();
      var pad = 8;
      spotlight.setAttribute('x', rect.left - pad);
      spotlight.setAttribute('y', rect.top - pad);
      spotlight.setAttribute('width', rect.width + pad * 2);
      spotlight.setAttribute('height', rect.height + pad * 2);
    } else if (spotlight) {
      // No target — hide spotlight (full overlay)
      spotlight.setAttribute('width', 0);
      spotlight.setAttribute('height', 0);
    }

    // Build tooltip content
    var dots = '';
    for (var i = 0; i < steps.length; i++) {
      dots += '<div class="tour-dot' + (i === index ? ' active' : '') + '"></div>';
    }

    tooltip.innerHTML =
      '<h3>' + step.title + '</h3>' +
      '<p>' + step.text + '</p>' +
      '<div class="tour-btns">' +
        '<div class="tour-dots">' + dots + '</div>' +
        (index > 0 ? '<button class="tour-btn tour-btn-secondary" onclick="BimTour.prev()">' + LABELS[LANG].back + '</button>' : '') +
        '<button class="tour-btn tour-btn-primary" onclick="BimTour.next()">' +
          (index < steps.length - 1 ? LABELS[LANG].next : LABELS[LANG].done) +
        '</button>' +
        (index < steps.length - 1 ? '<button class="tour-skip" onclick="BimTour.end()">' + LABELS[LANG].skip + '</button>' : '') +
      '</div>';

    // Position tooltip
    positionTooltip(el, step.position);
  }

  function positionTooltip(el, pos) {
    if (!tooltip) return;

    if (!el || pos === 'center') {
      tooltip.style.left = '50%';
      tooltip.style.top = '50%';
      tooltip.style.transform = 'translate(-50%, -50%)';
      return;
    }

    var rect = el.getBoundingClientRect();
    tooltip.style.transform = 'none';

    switch (pos) {
      case 'right':
        tooltip.style.left = (rect.right + 16) + 'px';
        tooltip.style.top = (rect.top + rect.height / 2 - 80) + 'px';
        break;
      case 'left':
        tooltip.style.left = (rect.left - 356) + 'px';
        tooltip.style.top = (rect.top + rect.height / 2 - 80) + 'px';
        break;
      case 'top':
        tooltip.style.left = (rect.left + rect.width / 2 - 170) + 'px';
        tooltip.style.top = (rect.top - 160) + 'px';
        break;
      case 'bottom':
        tooltip.style.left = (rect.left + rect.width / 2 - 170) + 'px';
        tooltip.style.top = (rect.bottom + 16) + 'px';
        break;
      default:
        tooltip.style.left = '50%';
        tooltip.style.top = '50%';
        tooltip.style.transform = 'translate(-50%, -50%)';
    }

    // Clamp to viewport
    var tt = tooltip.getBoundingClientRect();
    if (tt.right > window.innerWidth - 10) {
      tooltip.style.left = (window.innerWidth - tt.width - 10) + 'px';
    }
    if (tt.left < 10) tooltip.style.left = '10px';
    if (tt.top < 10) tooltip.style.top = '10px';
    if (tt.bottom > window.innerHeight - 10) {
      tooltip.style.top = (window.innerHeight - tt.height - 10) + 'px';
    }
  }

  // ========================================================
  // NAVIGATION
  // ========================================================

  function nextStep() { showStep(currentStep + 1); }
  function prevStep() { showStep(currentStep - 1); }

  function startTour() {
    createOverlay();
    overlay.style.display = 'block';
    tooltip.style.display = 'block';

    // Make sure sidebar is visible for tour (the WEA demo has no sidebar)
    if (!IS_WEA) {
      var toolbar = document.getElementById('toolbar');
      var toggle = document.getElementById('sidebarToggle');
      if (toolbar && toolbar.classList.contains('collapsed')) {
        toolbar.classList.remove('collapsed');
        if (toggle) toggle.classList.remove('at-edge');
      }
    }

    showStep(0);
  }

  function endTour() {
    if (overlay) overlay.style.display = 'none';
    if (tooltip) tooltip.style.display = 'none';
    localStorage.setItem(STORAGE_KEY, Date.now().toString());
  }

  // ESC to skip
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && overlay && overlay.style.display === 'block') {
      endTour();
    }
  });

  // ========================================================
  // AUTO-START ON FIRST VISIT
  // ========================================================

  function checkFirstVisit() {
    if (localStorage.getItem(STORAGE_KEY)) return;
    // Wait for app to be fully loaded — and in bridge mode also wait for the
    // asset-loading pill to disappear, otherwise the tour overlaps it visually.
    var check = setInterval(function() {
      var ready;
      if (IS_WEA) {
        // WEA demo hides the sidebar, so wait for the WEA panel to be open instead.
        var panel = document.getElementById('weaShadowPanel');
        ready = panel && panel.classList.contains('visible');
      } else {
        var toolbar = document.getElementById('toolbar');
        var bottomBar = document.getElementById('bottomToolbar');
        var loadingActive = IS_BRIDGE_INSPECTOR && document.getElementById('bridgeLoadingPill');
        ready = toolbar && bottomBar && toolbar.style.display !== 'none' && !loadingActive;
      }
      if (ready) {
        clearInterval(check);
        setTimeout(startTour, IS_BRIDGE_INSPECTOR || IS_WEA ? 600 : 1500);
      }
    }, 500);
  }

  if (document.readyState === 'complete') checkFirstVisit();
  else window.addEventListener('load', function() { setTimeout(checkFirstVisit, 2000); });

  // ========================================================
  // PUBLIC API
  // ========================================================

  window.BimTour = {
    start: startTour,
    end: endTour,
    next: nextStep,
    prev: prevStep,
    reset: function() { localStorage.removeItem(STORAGE_KEY); }
  };

})();
