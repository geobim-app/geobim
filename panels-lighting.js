/**
 * geobim.app — Lighting panel in desktop style (panel UI, beta)
 *
 * Loaded by panels-ui-loader.js after panels-tree.js, so only in the panel
 * layout; the classic Lighting section stays as it is.
 *
 * SUN               Dynamic lighting (on/off row) · the Date & time block of
 *                   panels-ui.js (civil local time) · time chips 06 … 00
 * SHADOWS & SHADING Shadows (on/off row, needs dynamic lighting) · Shadow
 *                   strength · Ambient occlusion (on/off row)
 * EXPOSURE          slider in EV on postProcessStages.exposure, Reset
 * SKY               Standard / Clear day / Golden hour / Overcast
 *                   (BimAtmosphere presets of atmosphere.js)
 *
 * The on/off buttons are the existing ones (#toggleLightingBtn,
 * #toggleShadowsBtn, #toggleAOBtn) with their handlers; their labels and
 * active state follow the real scene state here, which the classic buttons
 * did not (lighting switches shadows on; AO can also change in Settings).
 * The time chips set the panel clock's slider, so they mean civil local time
 * at the camera on the chosen date. lighting.js's setPresetTime would jump
 * to a fixed 2024 date in browser time; the old emoji presets are parked.
 * Exposure only works with HDR, which the lowest performance preset turns
 * off: then the slider is disabled with a hint instead of switching HDR on.
 */
(function() {
  'use strict';

  var TIMES = [6, 9, 12, 15, 18, 20, 22, 0];
  var SKY = [
    ['standard', 'Standard'],
    ['clearDay', 'Clear day'],
    ['goldenHour', 'Golden hour'],
    ['overcast', 'Overcast']
  ];
  var EV_MIN = -2;
  var EV_MAX = 2;

  var tree = BimPanelsTree.create('geobim_lighting_tree');
  var node = tree.node;
  var el = tree.el;
  var add = tree.add;

  function byId(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function toggleRow(label, btn) {
    var row = el('div', 'pnl-toggle-row');
    add(row, el('span', 'pnl-toggle-label', label), btn);
    return row;
  }

  function sliderRow(label, min, max, step) {
    var row = el('label', 'pnl-field');
    var input = el('input', 'modern-slider');
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.step = step;
    input.setAttribute('aria-label', label);
    var out = el('output', 'pnl-field-value');
    add(row, el('span', 'pnl-toggle-label', label), input, out);
    row.input = input;
    row.out = out;
    return row;
  }

  function choice(text, title) {
    var b = el('button', 'pnl-choice', text);
    b.type = 'button';
    if (title) b.title = title;
    return b;
  }

  // On/off state text in the button's last span (the handlers rewrite the
  // buttons as icon span + text span, #toggleAOBtn's inline handler writes
  // into span:last-child); the emoji icon span is hidden by CSS
  function setState(btn, on) {
    if (!btn) return;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    var label = btn.querySelector('span:last-child');
    if (!label) {
      label = el('span');
      btn.appendChild(label);
    }
    if (label.textContent !== (on ? 'On' : 'Off')) label.textContent = on ? 'On' : 'Off';
  }

  function build(body) {
    var content = body.querySelector('.modern-section-content');
    var clockBox = body.querySelector('.panels-clock');
    var lightBtn = byId('toggleLightingBtn');
    var viewer = BimViewer.viewer;
    if (!content || !clockBox || !lightBtn || !viewer) return false;
    var scene = viewer.scene;

    var root = el('div', 'pnl-tree');
    var parked = el('div', 'pnl-parked');
    parked.hidden = true;

    // SUN
    var sun = node('l:sun', 'Sun', true, { top: true, meta: true });
    var timeOut = clockBox.querySelector('.panels-clock-time');
    var slider = clockBox.querySelector('.panels-clock-slider');
    var clockLabel = clockBox.querySelector('.modern-label');
    if (clockLabel) clockLabel.remove();
    var chips = el('div', 'pnl-choices pnl-time-choices');
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', 'Time of day');
    TIMES.forEach(function(h) {
      var b = choice(pad(h), pad(h) + ':00 local time');
      b.dataset.minutes = String(h * 60);
      chips.appendChild(b);
    });
    chips.addEventListener('click', function(e) {
      var b = e.target.closest('.pnl-choice');
      if (!b || !slider) return;
      b.blur();
      slider.value = b.dataset.minutes;
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
    });
    var dateTime = node('l:datetime', 'Date & time', true);
    add(dateTime.sub, clockBox, chips);
    add(sun.sub, toggleRow('Dynamic lighting', lightBtn), dateTime);

    // SHADOWS & SHADING
    var shading = node('l:shading', 'Shadows & shading', true, { top: true });
    var shadowBtn = byId('toggleShadowsBtn');
    var aoBtn = byId('toggleAOBtn');
    var strength = sliderRow('Shadow strength', 0, 100, 5);
    strength.input.addEventListener('input', function() {
      // Cesium darkness: 0 = black shadows, 1 = none
      scene.shadowMap.darkness = 1 - parseInt(strength.input.value, 10) / 100;
      strength.out.textContent = strength.input.value + '%';
    });
    var shadowHint = el('p', 'modern-hint pnl-hint', 'Shadows need dynamic lighting.');
    add(shading.sub, shadowBtn && toggleRow('Shadows', shadowBtn), strength, shadowHint,
      aoBtn && toggleRow('Ambient occlusion', aoBtn));

    // EXPOSURE
    var exposure = node('l:exposure', 'Exposure', true, { top: true, meta: true });
    var ev = sliderRow('Exposure', EV_MIN, EV_MAX, 0.1);
    ev.input.addEventListener('input', function() {
      scene.postProcessStages.exposure = Math.pow(2, parseFloat(ev.input.value));
      sync();
    });
    var reset = el('button', 'pnl-link', 'Reset');
    reset.type = 'button';
    reset.addEventListener('click', function() {
      reset.blur();
      scene.postProcessStages.exposure = 1;
      sync();
    });
    var evHint = el('p', 'modern-hint pnl-hint',
      'Exposure needs HDR, which the current performance preset turns off. Choose a higher preset in Settings.');
    add(exposure.sub, ev, reset, evHint);

    // SKY
    var sky = node('l:sky', 'Sky', true, { top: true, meta: true });
    var skyChoices = el('div', 'pnl-choices');
    skyChoices.setAttribute('role', 'group');
    skyChoices.setAttribute('aria-label', 'Sky preset');
    SKY.forEach(function(s) {
      var b = choice(s[1]);
      b.dataset.preset = s[0];
      skyChoices.appendChild(b);
    });
    skyChoices.addEventListener('click', function(e) {
      var b = e.target.closest('.pnl-choice');
      if (!b || !window.BimAtmosphere) return;
      b.blur();
      BimAtmosphere.applyPreset(b.dataset.preset);
      sync();
    });
    sky.sub.appendChild(skyChoices);

    // the old emoji presets, the tip and whatever is left of the section
    Array.prototype.slice.call(content.children).forEach(function(c) { parked.appendChild(c); });
    add(root, sun, shading, exposure);
    if (window.BimAtmosphere) root.appendChild(sky);
    root.appendChild(parked);
    content.appendChild(root);

    // State → rows (also changes made elsewhere: Settings, scenes, presets)
    function sync() {
      var lit = !!(BimViewer.lighting && BimViewer.lighting.enabled);
      setState(lightBtn, lit);
      sun.meta.textContent = timeOut ? timeOut.textContent : '';
      var minutes = slider ? parseInt(slider.value, 10) : -1;
      Array.prototype.forEach.call(chips.children, function(b) {
        b.classList.toggle('active', parseInt(b.dataset.minutes, 10) === minutes);
      });

      var shadows = !!scene.shadowMap.enabled;
      setState(shadowBtn, shadows);
      if (shadowBtn) shadowBtn.disabled = !lit;
      shadowHint.hidden = lit;
      strength.input.disabled = !shadows;
      if (document.activeElement !== strength.input) {
        var s = Math.round((1 - scene.shadowMap.darkness) * 100);
        strength.input.value = s;
        strength.out.textContent = s + '%';
      }
      var ao = scene.postProcessStages.ambientOcclusion;
      setState(aoBtn, !!(ao && ao.enabled));
      // Settings' own SSAO button shows the same state
      var setAO = byId('toggleAO');
      if (setAO && ao) setAO.classList.toggle('active', ao.enabled);

      var hdr = !!scene.highDynamicRange;
      var value = Math.log2(scene.postProcessStages.exposure || 1);
      if (document.activeElement !== ev.input) ev.input.value = value.toFixed(1);
      var text = (value >= 0 ? '+' : '') + value.toFixed(1) + ' EV';
      ev.out.textContent = text;
      exposure.meta.textContent = hdr && Math.abs(value) >= 0.05 ? text : '';
      ev.input.disabled = !hdr;
      reset.disabled = !hdr || Math.abs(value) < 0.05;
      evHint.hidden = hdr;

      if (window.BimAtmosphere) {
        var active = BimAtmosphere.getActive();
        Array.prototype.forEach.call(skyChoices.children, function(b) {
          b.classList.toggle('active', b.dataset.preset === active);
        });
        var label = SKY.filter(function(x) { return x[0] === active; })[0];
        sky.meta.textContent = label ? label[1] : '';
      }
    }

    // Switching lighting on the first time jumps to 2024-10-15 13:30 unless a
    // time was set (lighting.js); here the Date & time block is the source,
    // so its current time counts as set (capture: before the handler)
    lightBtn.addEventListener('click', function() {
      if (!BimViewer.lighting && typeof BimViewer.initLighting === 'function') BimViewer.initLighting();
      if (BimViewer.lighting && !BimViewer.lighting.currentTime) {
        BimViewer.lighting.currentTime = Cesium.JulianDate.toIso8601(viewer.clock.currentTime);
      }
    }, true);

    // the original handlers rewrite the buttons first
    [lightBtn, shadowBtn, aoBtn].forEach(function(b) {
      if (b) b.addEventListener('click', function() { setTimeout(sync, 0); });
    });
    if (timeOut) new MutationObserver(sync).observe(timeOut, { childList: true, characterData: true, subtree: true });
    var panel = body.closest('.panels-panel');
    setInterval(function() { if (!panel || !panel.hidden) sync(); }, 1000);
    sync();
    return true;
  }

  var tries = 0;
  (function wait() {
    if (window.BimPanelsUI && BimPanelsUI.ready && window.BimViewer && BimViewer.viewer) {
      var body = document.querySelector('.panels-panel[data-section="lighting"] .panels-panel-body');
      if (body && build(body)) return;
    }
    if (++tries > 200) return;
    setTimeout(wait, 300);
  })();
})();
