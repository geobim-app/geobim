// ============================================================
// Splat UI — BimSplat controller for the Gaussian Splatting module
//
// Copyright (c) 2026 geobim.app
// Licensed under the Business Source License 1.1 (BSL 1.1)
// Change Date: 2030-03-01 | Change License: MIT
//
// Drives the splat.js logic API from the "Gaussian Splats" sidebar
// section (markup in ui-splat-section.js → GEOBIM_SPLAT_UI). Renders
// the loaded-splat list into #splatList. Logic lives in splat.js;
// this file is presentation + wiring only.
//
// Tested with CesiumJS 1.141
// ============================================================

(function() {
  'use strict';

  function el(id) { return document.getElementById(id); }
  function instances() {
    return (window.BimViewer && BimViewer.splat && BimViewer.splat.instances) || new Map();
  }
  function refreshIcons() { if (window.lucide) lucide.createIcons(); }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Transient status line in the section (loading / error / ok).
  function status(msg, kind) {
    var s = el('splatStatus');
    if (!s) return;
    s.textContent = msg || '';
    s.className = 'splat-status' + (kind ? ' splat-status-' + kind : '');
  }
  function lastError() {
    return (window.BimViewer && BimViewer.splat && BimViewer.splat.lastError) || 'Laden fehlgeschlagen';
  }

  // ---- Loaded-splat list rendering ------------------------------

  function render() {
    var list = el('splatList');
    if (!list) return;

    var map = instances();
    if (!map || map.size === 0) {
      list.innerHTML = '<div class="splat-empty">Noch keine Splats geladen.</div>';
      return;
    }

    var html = '';
    map.forEach(function(inst) {
      var id = inst.id;
      var hidden = inst.tileset && inst.tileset.show === false;
      var sse = inst.sse != null ? inst.sse : 16;
      var h = inst.heightM || 0;
      var rot = inst.orientation ? (inst.orientation.z || 0) : 0;
      var sc = inst.scale || 1;
      var gizOn = window.BimGizmoSplat && BimGizmoSplat.isSelected(id);

      html +=
        '<div class="splat-row' + (hidden ? ' splat-row-hidden' : '') + '">' +
          '<div class="splat-row-head">' +
            '<span class="splat-row-name" title="' + esc(inst.source || '') + '">' + esc(inst.name || id) + '</span>' +
            '<div class="splat-row-actions">' +
              '<button class="modern-icon-btn' + (gizOn ? ' active' : '') + '" id="splat_giz_' + id + '" ' +
                'onclick="BimSplat.toggleGizmo(\'' + id + '\')" title="Gizmo: verschieben/drehen/höhe">' +
                '<i data-lucide="move-3d" style="width:13px;height:13px;"></i></button>' +
              '<button class="modern-icon-btn" onclick="BimSplat.flyTo(\'' + id + '\')" title="Hinfliegen">' +
                '<i data-lucide="crosshair" style="width:13px;height:13px;"></i></button>' +
              '<button class="modern-icon-btn" onclick="BimSplat.toggleVis(\'' + id + '\')" title="Ein-/Ausblenden">' +
                '<i data-lucide="' + (hidden ? 'eye-off' : 'eye') + '" style="width:13px;height:13px;"></i></button>' +
              '<button class="modern-icon-btn modern-icon-btn-danger" onclick="BimSplat.remove(\'' + id + '\')" title="Entfernen">' +
                '<i data-lucide="trash-2" style="width:13px;height:13px;"></i></button>' +
            '</div>' +
          '</div>' +

          '<div class="splat-ctrl">' +
            '<label>Detail</label>' +
            '<input type="range" min="2" max="32" step="1" value="' + sse + '" class="modern-slider-small" ' +
              'oninput="BimSplat.onSSE(\'' + id + '\', this.value)" />' +
            '<span class="splat-ctrl-val" id="splat_sse_v_' + id + '">' + sse + '</span>' +
          '</div>' +

          '<div class="splat-ctrl">' +
            '<label>Höhe</label>' +
            '<input type="range" id="splat_h_' + id + '" min="-50" max="50" step="0.5" value="' + h + '" class="modern-slider-small" ' +
              'oninput="BimSplat.onHeight(\'' + id + '\', this.value)" />' +
            '<span class="splat-ctrl-val" id="splat_h_v_' + id + '">' + h.toFixed(1) + 'm</span>' +
            '<button class="modern-icon-btn" onclick="BimSplat.clamp(\'' + id + '\')" title="Auf Gelände setzen">' +
              '<i data-lucide="mountain" style="width:13px;height:13px;"></i></button>' +
          '</div>' +

          '<div class="splat-ctrl">' +
            '<label>Drehung</label>' +
            '<input type="range" id="splat_r_' + id + '" min="0" max="360" step="1" value="' + rot + '" class="modern-slider-small" ' +
              'oninput="BimSplat.onRot(\'' + id + '\', this.value)" />' +
            '<span class="splat-ctrl-val" id="splat_r_v_' + id + '">' + Math.round(rot) + '°</span>' +
          '</div>' +

          '<div class="splat-ctrl">' +
            '<label>Größe</label>' +
            '<input type="range" id="splat_sc_' + id + '" min="-1" max="2" step="0.02" value="' + Math.log10(sc) + '" class="modern-slider-small" ' +
              'oninput="BimSplat.onScale(\'' + id + '\', this.value)" />' +
            '<span class="splat-ctrl-val" id="splat_sc_v_' + id + '">' + sc.toFixed(2) + 'x</span>' +
          '</div>' +
        '</div>';
    });

    list.innerHTML = html;
    refreshIcons();
  }

  // ---- Public API (called from sidebar section inline handlers) --

  window.BimSplat = {
    refresh: render,

    loadFromInput: async function() {
      var input = el('splatUrlInput');
      var val = input ? input.value.trim() : '';
      if (!val) { status('Bitte URL oder Ion-ID eingeben.', 'error'); return; }
      var clamp = el('splatClampChk') ? el('splatClampChk').checked : true;
      var opts = { clampToTerrain: clamp, sse: 16 };
      if (/^\d+$/.test(val)) opts.ionAssetId = Number(val);
      else opts.url = val;
      status('Lädt…');
      var inst = await BimViewer.loadSplat(opts);
      if (inst) {
        if (input) input.value = '';
        status('Geladen.', 'ok');
      } else {
        status('Fehler: ' + lastError(), 'error');
      }
      render();
    },

    loadDemo: async function() {
      status('Lädt Demo…');
      var inst = await BimViewer.loadSplatDemo();
      status(inst ? 'Geladen.' : ('Fehler: ' + lastError()), inst ? 'ok' : 'error');
      render();
    },

    loadCochem: async function() {
      status('Lädt Cochem…');
      var inst = await BimViewer.loadSplatCochem();
      status(inst ? 'Geladen.' : ('Fehler: ' + lastError()), inst ? 'ok' : 'error');
      render();
    },

    flyTo: function(id) { BimViewer.flyToSplat(id); },

    toggleVis: function(id) {
      var inst = instances().get(id);
      if (!inst) return;
      BimViewer.setSplatVisible(id, !(inst.tileset && inst.tileset.show !== false));
      render();
    },

    remove: function(id) {
      if (window.BimGizmoSplat) BimGizmoSplat.notifyRemoved(id);
      BimViewer.removeSplat(id);
      render();
    },

    // Toggle the interactive 3D gizmo (splat-gizmo.js) for this splat.
    toggleGizmo: function(id) {
      if (!window.BimGizmoSplat) return;
      BimGizmoSplat.toggle(id);
    },

    // Reflect gizmo select/deselect on the row button (called by the gizmo).
    onGizmoChange: function(id, active) {
      var btn = el('splat_giz_' + id);
      if (btn) btn.classList.toggle('active', !!active);
    },

    // Logarithmic scale slider: value is log10(factor).
    onScale: function(id, val) {
      var factor = Math.pow(10, Number(val));
      BimViewer.setSplatScale(id, factor);
      var v = el('splat_sc_v_' + id);
      if (v) v.textContent = factor.toFixed(2) + 'x';
    },

    // Push live state back into this row's sliders (called during gizmo drag).
    syncRow: function(id) {
      var st = (window.BimViewer && BimViewer.getSplatState) ? BimViewer.getSplatState(id) : null;
      if (!st) return;
      var hr = el('splat_h_' + id), hv = el('splat_h_v_' + id);
      if (hr) hr.value = st.heightM;
      if (hv) hv.textContent = st.heightM.toFixed(1) + 'm';
      var rr = el('splat_r_' + id), rv = el('splat_r_v_' + id);
      if (rr) rr.value = st.heading;
      if (rv) rv.textContent = Math.round(st.heading) + '°';
      var scr = el('splat_sc_' + id), scv = el('splat_sc_v_' + id);
      if (scr && st.scale > 0) scr.value = Math.log10(st.scale);
      if (scv) scv.textContent = st.scale.toFixed(2) + 'x';
    },

    onSSE: function(id, val) {
      BimViewer.setSplatSSE(id, Number(val));
      var v = el('splat_sse_v_' + id);
      if (v) v.textContent = val;
    },

    onHeight: function(id, val) {
      BimViewer.setSplatHeight(id, Number(val));
      var v = el('splat_h_v_' + id);
      if (v) v.textContent = Number(val).toFixed(1) + 'm';
    },

    onRot: function(id, val) {
      BimViewer.setSplatOrientation(id, { z: Number(val) });
      var v = el('splat_r_v_' + id);
      if (v) v.textContent = val + '°';
    },

    clamp: async function(id) {
      await BimViewer.clampSplatToTerrain(id);
      render();
    }
  };

})();
