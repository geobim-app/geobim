// ============================================================
// Onboarding Tour for geoBIM.app Viewer
//
// Copyright (c) 2026 geobim.app
// Lightweight guided tour — no external dependencies.
// Triggered on first visit or from About dialog.
// ============================================================

(function() {
  'use strict';

  // Modes detected from the URL like wea-demo.js / stage-twin.js do it:
  // _weaDemoMode is the shared "skip login" flag of every no-login mode
  // (/demo, /bridge-inspector, /stage-twin too), not a WEA marker.
  var MODE_PARAM = new URLSearchParams(window.location.search).get('mode');
  var MODE_PATH = window.location.pathname.replace(/\/+$/, '');
  var IS_BRIDGE_INSPECTOR = !!window._bridgeInspectorMode;
  var IS_WEA = MODE_PARAM === 'wea' || MODE_PATH === '/wea-shadow';
  var IS_STAGETWIN = MODE_PARAM === 'stagetwin' || MODE_PATH === '/stage-twin';
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
    en: { back: 'Back', next: 'Next', done: 'Got it!', skip: 'Skip', step: 'Step {n} of {total}' },
    ja: { back: '戻る', next: '次へ', done: '完了', skip: 'スキップ', step: 'ステップ {n} / {total}' }
  };
  var overlay = null;
  var tooltip = null;
  var currentStep = 0;

  var defaultSteps = [
    {
      target: '#cesiumContainer',
      title: 'Welcome to geoBIM.app Viewer',
      text: 'Your BIM models in their real location. Left-drag pans, scroll zooms, middle-drag or Ctrl + left-drag rotates and tilts.',
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
      text: 'Bridge models are pre-loaded. Inspect components, place condition annotations, measure dimensions, and save viewpoints — just like a real inspection workflow.',
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
      text: 'Explore the bridges as long as you like. Sign in to inspect your own models on the full geoBIM.app Viewer.',
      position: 'center'
    }
  ];

  var weaSteps = [
    {
      target: '#cesiumContainer',
      title: 'Welcome to Wind Shadow Analysis',
      text: 'Simulate the shadow flicker of wind turbines on real terrain. Place turbines, cast their shadows, and run a compliance-style daily analysis. Left-click + drag to rotate, scroll to zoom.',
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
      text: 'Explore as long as you like. Sign in to run wind shadow analyses on your own sites within the full geoBIM.app Viewer.',
      position: 'center'
    }
  ];

  // Japanese WEA tour — same targets/positions as weaSteps, translated text only.
  var weaStepsJA = [
    {
      target: '#cesiumContainer',
      title: '風影解析へようこそ',
      text: '実際の地形上で風力タービンの影のちらつき（シャドーフリッカー）をシミュレートします。タービンを配置し、影を投影し、コンプライアンス相当の1日解析を実行できます。左クリック＋ドラッグで回転、スクロールでズームします。',
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
      text: 'サインインすると、完全な geoBIM.app Viewer 上で、ご自身のサイトについて無制限に風影解析を実行できます。',
      position: 'center'
    }
  ];

  var steps = IS_BRIDGE_INSPECTOR ? bridgeSteps
            : IS_WEA ? (LANG === 'ja' ? weaStepsJA : weaSteps)
            : defaultSteps;

  // ========================================================
  // OVERLAY + SPOTLIGHT (styles: onboarding-styles.css)
  // ========================================================

  var PAD = 8;      // spotlight around the target
  var GAP = 8;      // between spotlight and tooltip
  var MARGIN = 10;  // tooltip to viewport edge

  function createOverlay() {
    if (overlay) return;

    // Modal: the overlay takes every click; only the tooltip buttons act
    overlay = document.createElement('div');
    overlay.id = 'tourOverlay';
    overlay.innerHTML = '<svg class="tour-svg"width="100%" height="100%" aria-hidden="true">' +
      '<defs><mask id="tourMask">' +
      '<rect width="100%" height="100%" fill="white"/>' +
      '<rect id="tourSpotlight" rx="12" ry="12" fill="black"/>' +
      '</mask></defs>' +
      '<rect class="tour-dim" width="100%" height="100%" mask="url(#tourMask)"/>' +
      '</svg>';
    document.body.appendChild(overlay);

    tooltip = document.createElement('div');
    tooltip.id = 'tourTooltip';
    tooltip.setAttribute('role', 'dialog');
    tooltip.setAttribute('aria-modal', 'true');
    tooltip.setAttribute('aria-labelledby', 'tourTitle');
    tooltip.setAttribute('aria-describedby', 'tourText');
    document.body.appendChild(tooltip);

    tooltip.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-tour]');
      if (!btn) return;
      var action = btn.getAttribute('data-tour');
      if (action === 'next') nextStep();
      else if (action === 'prev') prevStep();
      else endTour();
    });
  }

  function isOpen() {
    return !!overlay && overlay.style.display === 'block';
  }

  // Target of a step, or null when it is missing or not rendered
  // (display:none, panels hidden) — the step then shows centred without spotlight
  function targetOf(step) {
    if (!step.target) return null;
    var el = document.querySelector(step.target);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? el : null;
  }

  // ========================================================
  // STEP RENDERING
  // ========================================================

  function showStep(index) {
    if (index >= steps.length) { endTour(); return; }
    currentStep = Math.max(0, index);

    var step = steps[currentStep];
    var last = currentStep === steps.length - 1;
    var L = LABELS[LANG];

    var dots = '';
    for (var i = 0; i < steps.length; i++) {
      dots += '<span class="tour-dot' + (i === currentStep ? ' active' : '') + '"></span>';
    }
    var counter = L.step.replace('{n}', currentStep + 1).replace('{total}', steps.length);

    tooltip.innerHTML =
      '<h3 id="tourTitle">' + step.title + '</h3>' +
      '<p id="tourText">' + step.text + '</p>' +
      '<div class="tour-btns">' +
        '<div class="tour-dots" role="img" aria-label="' + counter + '">' + dots + '</div>' +
        (currentStep > 0 ? '<button type="button" class="tour-btn tour-btn-secondary" data-tour="prev">' + L.back + '</button>' : '') +
        '<button type="button" class="tour-btn tour-btn-primary" data-tour="next">' + (last ? L.done : L.next) + '</button>' +
        (last ? '' : '<button type="button" class="tour-skip" data-tour="end">' + L.skip + '</button>') +
      '</div>';

    layout();

    var primary = tooltip.querySelector('[data-tour="next"]');
    if (primary) primary.focus({ preventScroll: true });
  }

  // Spotlight and tooltip for the current step; runs again on resize
  function layout() {
    if (!isOpen()) return;
    var step = steps[currentStep];
    var el = targetOf(step);
    var spotlight = document.getElementById('tourSpotlight');
    var spot = null;

    if (el) {
      var r = el.getBoundingClientRect();
      spot = { left: r.left - PAD, top: r.top - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
      spot.right = spot.left + spot.width;
      spot.bottom = spot.top + spot.height;
      spotlight.setAttribute('x', spot.left);
      spotlight.setAttribute('y', spot.top);
      spotlight.setAttribute('width', spot.width);
      spotlight.setAttribute('height', spot.height);
    } else {
      // No target — no cut-out, full overlay
      spotlight.setAttribute('width', 0);
      spotlight.setAttribute('height', 0);
    }

    placeTooltip(spot, spot ? step.position : 'center');
  }

  var OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

  function besideSpot(spot, pos, w, h) {
    switch (pos) {
      case 'right': return { x: spot.right + GAP, y: spot.top + spot.height / 2 - h / 2 };
      case 'left': return { x: spot.left - GAP - w, y: spot.top + spot.height / 2 - h / 2 };
      case 'top': return { x: spot.left + spot.width / 2 - w / 2, y: spot.top - GAP - h };
      default: return { x: spot.left + spot.width / 2 - w / 2, y: spot.bottom + GAP };
    }
  }

  // Only the axis that points away from the target has to fit;
  // the other one is clamped to the viewport afterwards
  function fitsBeside(p, pos, w, h) {
    if (pos === 'left' || pos === 'right') return p.x >= MARGIN && p.x + w <= window.innerWidth - MARGIN;
    return p.y >= MARGIN && p.y + h <= window.innerHeight - MARGIN;
  }

  // Measures the rendered tooltip, so long texts never cover their target
  function placeTooltip(spot, pos) {
    var w = tooltip.offsetWidth;
    var h = tooltip.offsetHeight;
    var p;

    if (!spot || !OPPOSITE[pos]) {
      p = { x: (window.innerWidth - w) / 2, y: (window.innerHeight - h) / 2 };
    } else {
      p = besideSpot(spot, pos, w, h);
      if (!fitsBeside(p, pos, w, h)) {
        var flipped = besideSpot(spot, OPPOSITE[pos], w, h);
        if (fitsBeside(flipped, OPPOSITE[pos], w, h)) p = flipped;
      }
    }

    var maxX = Math.max(MARGIN, window.innerWidth - w - MARGIN);
    var maxY = Math.max(MARGIN, window.innerHeight - h - MARGIN);
    tooltip.style.left = Math.round(Math.min(Math.max(p.x, MARGIN), maxX)) + 'px';
    tooltip.style.top = Math.round(Math.min(Math.max(p.y, MARGIN), maxY)) + 'px';
  }

  // Resize and phone rotation move the targets
  var layoutFrame = 0;
  window.addEventListener('resize', function() {
    if (!isOpen() || layoutFrame) return;
    layoutFrame = requestAnimationFrame(function() {
      layoutFrame = 0;
      layout();
    });
  });

  // ========================================================
  // NAVIGATION
  // ========================================================

  function nextStep() { showStep(currentStep + 1); }
  function prevStep() { showStep(currentStep - 1); }

  // The tour points at the sidebar / rail: bring them back if M hid them
  // (the WEA demo has no sidebar)
  function revealUI() {
    if (IS_WEA) return;
    var toolbar = document.getElementById('toolbar');
    var toggle = document.getElementById('sidebarToggle');
    if (toolbar && toolbar.classList.contains('collapsed')) {
      toolbar.classList.remove('collapsed');
      if (toggle) toggle.classList.remove('at-edge');
    }
    document.documentElement.classList.remove('panels-collapsed');
  }

  function startTour() {
    createOverlay();
    revealUI();
    overlay.style.display = 'block';
    tooltip.style.display = 'block';
    showStep(0);
  }

  function endTour() {
    if (overlay) overlay.style.display = 'none';
    if (tooltip) {
      // focus back to the page, not to a button: shortcuts ignore focused buttons
      if (tooltip.contains(document.activeElement)) document.activeElement.blur();
      tooltip.style.display = 'none';
    }
    localStorage.setItem(STORAGE_KEY, Date.now().toString());
  }

  // Keep Tab inside the tooltip
  function trapFocus(e) {
    var buttons = tooltip.querySelectorAll('button');
    if (!buttons.length) return;
    var first = buttons[0];
    var last = buttons[buttons.length - 1];
    var inside = tooltip.contains(document.activeElement);
    if (e.shiftKey && (!inside || document.activeElement === first)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
      e.preventDefault();
      first.focus();
    }
  }

  // The tour is modal: while it is open no app shortcut (M, G, H …) may act
  // on the UI under the overlay. Window capture runs before every other
  // keydown handler; Enter / Space still click the focused tour button.
  window.addEventListener('keydown', function(e) {
    if (!isOpen()) return;
    e.stopImmediatePropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      endTour();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      nextStep();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      prevStep();
    } else if (e.key === 'Tab') {
      trapFocus(e);
    }
  }, true);

  // ========================================================
  // AUTO-START ON FIRST VISIT
  // ========================================================

  function checkFirstVisit() {
    // /demo opens the About dialog with its "Take a guided tour" button instead
    // (demo.js); StageTwin has no sidebar or toolbar to show
    // Guests on / also carry _demoMode (auth-gate.js startAsGuest) but get the tour
    if (IS_STAGETWIN || (window._demoMode && !window._guestMode) || localStorage.getItem(STORAGE_KEY)) return;
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
        // a tour started from the menu meanwhile keeps its place
        setTimeout(function() { if (!isOpen()) startTour(); }, IS_BRIDGE_INSPECTOR || IS_WEA ? 600 : 1500);
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
    isOpen: isOpen,
    next: nextStep,
    prev: prevStep,
    reset: function() { localStorage.removeItem(STORAGE_KEY); },
    // Another layout (panels-ui.js) replaces the default tour's steps;
    // the WEA and Bridge Inspector tours stay as they are. Crossing the
    // phone breakpoint mid-tour swaps the steps in place.
    setDefaultSteps: function(newSteps) {
      if (IS_BRIDGE_INSPECTOR || IS_WEA || !Array.isArray(newSteps) || !newSteps.length) return;
      if (steps === newSteps) return;
      steps = newSteps;
      if (isOpen()) showStep(Math.min(currentStep, steps.length - 1));
    }
  };

})();
