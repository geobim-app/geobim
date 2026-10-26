/**
 * geobim.app — VR settings form (webxr.js stores and applies them)
 *
 * A block "VR (headset)" in the Settings section, shown once the browser
 * reports immersive-vr, and the same form on the monitor card while VR runs
 * (resolution, smoothing and detail apply at once, the rest with the next
 * stick movement). Saved per browser (localStorage geobim.xr.settings).
 *
 *   window.BimXRSettings = { render(container) }
 */
(function() {
  'use strict';

  if (!window.BimXR) return;

  var FIELDS = [
    { key: 'scale', label: 'Resolution', type: 'range', min: 0.5, max: 1, step: 0.1,
      hint: 'Sharper vs. more fps; the right stick press switches to 0.2 lower in the headset' },
    { key: 'smoothing', label: 'Edge smoothing', type: 'select',
      options: [['off', 'Off'], ['fxaa', 'FXAA'], ['msaa2', 'MSAA 2×'], ['msaa4', 'MSAA 4×']] },
    { key: 'detail', label: 'Model detail', type: 'select', number: true,
      options: [[1, 'Normal'], [2, 'Coarser (×2)'], [4, 'Coarse (×4)']] },
    { key: 'turn', label: 'Turning', type: 'select',
      options: [['snap30', 'Snap 30°'], ['snap45', 'Snap 45°'], ['smooth', 'Smooth']] },
    { key: 'speed', label: 'Flying speed', type: 'select', number: true,
      options: [[0.25, '0.25×'], [0.5, '0.5×'], [1, '1×'], [2, '2×'], [4, '4×']] },
    { key: 'pitch', label: 'Flying pitch', type: 'select',
      options: [['level', 'Always level'], ['deadzone', 'Level within ±15°'], ['free', 'Free (controller direction)']] },
    { key: 'teleport', label: 'Teleport', type: 'select', options: [['arc', 'Arc'], ['beam', 'Straight beam']] },
    { key: 'vignette', label: 'Vignette while moving', type: 'toggle' }
  ];

  var forms = []; // every rendered form, kept in sync

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function render(container) {
    var form = el('div', 'xr-settings');
    var inputs = {};
    FIELDS.forEach(function(f) {
      var group = el('div', 'modern-group xr-settings-row');
      var id = 'xrSet_' + f.key + '_' + forms.length;
      var label = el('label', 'modern-label', f.label);
      label.htmlFor = id;
      group.appendChild(label);
      var input;
      if (f.type === 'range') {
        var wrap = el('div', 'modern-slider-group');
        input = el('input', 'modern-slider-small');
        input.type = 'range';
        input.min = f.min; input.max = f.max; input.step = f.step;
        var value = el('span', 'modern-value-small');
        input.addEventListener('input', function() { value.textContent = (+input.value).toFixed(1); });
        input.addEventListener('change', function() { BimXR.setSettings(patch(f.key, +input.value)); });
        input._value = value;
        wrap.appendChild(input);
        wrap.appendChild(value);
        group.appendChild(wrap);
      } else if (f.type === 'select') {
        input = el('select', 'modern-select');
        f.options.forEach(function(o) {
          var opt = el('option', null, o[1]);
          opt.value = String(o[0]);
          input.appendChild(opt);
        });
        input.addEventListener('change', function() {
          BimXR.setSettings(patch(f.key, f.number ? +input.value : input.value));
        });
        group.appendChild(input);
      } else {
        input = el('button', 'modern-toggle-btn xr-settings-toggle');
        input.type = 'button';
        input.addEventListener('click', function() {
          input.blur();
          BimXR.setSettings(patch(f.key, !BimXR.getSettings()[f.key]));
        });
        group.appendChild(input);
      }
      input.id = id;
      if (f.hint) group.appendChild(el('div', 'xr-settings-hint', f.hint));
      inputs[f.key] = input;
      form.appendChild(group);
    });

    var reset = el('button', 'modern-toggle-btn xr-settings-reset', 'Reset VR settings');
    reset.type = 'button';
    reset.addEventListener('click', function() { reset.blur(); BimXR.setSettings(BimXR.defaults()); });
    form.appendChild(reset);

    container.appendChild(form);
    forms.push(inputs);
    fill(inputs, BimXR.getSettings());
    return form;
  }

  function patch(key, value) {
    var p = {};
    p[key] = value;
    return p;
  }

  function fill(inputs, s) {
    FIELDS.forEach(function(f) {
      var input = inputs[f.key];
      if (f.type === 'range') {
        input.value = s[f.key];
        input._value.textContent = (+s[f.key]).toFixed(1);
      } else if (f.type === 'select') {
        input.value = String(s[f.key]);
      } else {
        input.classList.toggle('active', !!s[f.key]);
        input.textContent = s[f.key] ? 'On' : 'Off';
        input.setAttribute('aria-pressed', s[f.key] ? 'true' : 'false');
      }
    });
  }

  BimXR.onSettings(function(s) { forms.forEach(function(inputs) { fill(inputs, s); }); });

  // ---------------------------------------------------------------------------
  // Block in the Settings section, above "Performance Preset" — found by that
  // element, because the panel UI moves the section content into its panel
  // ---------------------------------------------------------------------------
  var block = null;

  function addBlock() {
    var preset = document.getElementById('performancePreset');
    var first = preset && preset.closest('.modern-group');
    var content = first && first.parentElement;
    if (!content) return false;
    block = el('div', 'modern-group xr-settings-block');
    var title = el('div', 'modern-label xr-settings-title');
    title.innerHTML = '<i data-lucide="glasses"></i><span>VR (headset)</span>';
    block.appendChild(title);
    render(block);
    content.insertBefore(block, first);
    showBlock();
    if (window.lucide) lucide.createIcons();
    return true;
  }

  function showBlock() {
    if (block) block.hidden = !BimXR.isSupported();
  }

  document.addEventListener('geobim:xr-support', showBlock);

  window.BimXRSettings = { render: render };

  var tries = 0;
  (function poll() {
    if (addBlock() || ++tries > 120) return;
    setTimeout(poll, 500);
  })();
})();
