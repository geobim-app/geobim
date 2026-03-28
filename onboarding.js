// ============================================================
// Onboarding Tour for geobim.app
//
// Copyright (c) 2026 geobim.app
// Lightweight guided tour — no external dependencies.
// Triggered on first visit or from About dialog.
// ============================================================

(function() {
  'use strict';

  var STORAGE_KEY = 'geobim_tour_v1';
  var overlay = null;
  var tooltip = null;
  var currentStep = 0;

  var steps = [
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
        (index > 0 ? '<button class="tour-btn tour-btn-secondary" onclick="BimTour.prev()">Back</button>' : '') +
        '<button class="tour-btn tour-btn-primary" onclick="BimTour.next()">' +
          (index < steps.length - 1 ? 'Next' : 'Got it!') +
        '</button>' +
        (index < steps.length - 1 ? '<button class="tour-skip" onclick="BimTour.end()">Skip</button>' : '') +
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

    // Make sure sidebar is visible for tour
    var toolbar = document.getElementById('toolbar');
    var toggle = document.getElementById('sidebarToggle');
    if (toolbar && toolbar.classList.contains('collapsed')) {
      toolbar.classList.remove('collapsed');
      if (toggle) toggle.classList.remove('at-edge');
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
    // Wait for app to be fully loaded
    var check = setInterval(function() {
      var toolbar = document.getElementById('toolbar');
      var bottomBar = document.getElementById('bottomToolbar');
      if (toolbar && bottomBar && toolbar.style.display !== 'none') {
        clearInterval(check);
        setTimeout(startTour, 1500);
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
