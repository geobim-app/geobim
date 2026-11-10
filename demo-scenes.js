/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/*
 * Demo scenes — the scenes geoBIM Desktop (Unreal) ships in Demo/, for
 * everyone, guests included.
 *
 * demo-scenes.json holds them in the Desktop scene format (scenes.js reads it);
 * their models are folders in model/ that guest-models.json lists, terrain and
 * base map need no Cesium ion. A "Demo scenes" block in the Scenes panel loads
 * one with a click (read-only: never in scenes.list, so never saved).
 *
 * Per scene, "web" adds what the Desktop does in its own way:
 *   credits          model credits (CC BY 4.0) → "Data attribution" + a line here
 *   split            {left: [folder], right: [folder]} → Split View, sides per model
 *   schedule         folder → construction schedule (4D) bar opens
 *   alignmentSection folder → section along the IfcAlignment axis
 */
(function() {
  'use strict';

  if (window._shareMode) return;

  var scenes = [];
  var activeId = null;
  var busy = false;
  var credit = null;
  var box = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function title(scene) {
    return String(scene.name || 'Demo').replace(/^Demo:\s*/, '');
  }

  // Folder of a model path, as scenes.js localKey() does
  function folderOf(path) {
    var parts = String(path || '').split('?')[0].replace(/\\/g, '/').split('/').filter(Boolean);
    var last = parts[parts.length - 1] || '';
    var key = /^tileset\.json$/i.test(last) ? (parts[parts.length - 2] || '') : last;
    try { return decodeURIComponent(key); } catch (e) { return key; }
  }

  // Loaded-asset key of a model folder ("glb_<id>"), or null
  function keyFor(folder) {
    var want = String(folder).toLowerCase();
    var def = (BimViewer.glbModels || []).find(function(m) { return folderOf(m.file).toLowerCase() === want; });
    var key = def ? 'glb_' + def.id : null;
    return key && BimViewer.loadedAssets.has(key) ? key : null;
  }

  // ------------------------------------------------------------------
  // Extras
  // ------------------------------------------------------------------

  function closeExtras() {
    try {
      if (BimViewer.splitMode && window.GEOBIM_SPLIT_UI) GEOBIM_SPLIT_UI.toggleSplitView();
      if (BimViewer.constructionSchedule && BimViewer.constructionSchedule.state) BimViewer.deactivateConstructionSchedule();
      var as = BimViewer.alignmentSection;
      if (as && (as.activeAssetId || as.draw)) {
        if (typeof BimViewer.cancelSectionLine === 'function') BimViewer.cancelSectionLine();
        if (typeof BimViewer.deactivateAlignmentSection === 'function') BimViewer.deactivateAlignmentSection();
      }
    } catch (e) { console.warn('Demo scenes: closing extras failed', e); }
  }

  function applyExtras(web, problems) {
    if (web.split && window.GEOBIM_SPLIT_UI && window.BimSplitCompare) {
      if (!BimViewer.splitMode) GEOBIM_SPLIT_UI.toggleSplitView();
      ['left', 'right'].forEach(function(side) {
        (web.split[side] || []).forEach(function(folder) {
          var key = keyFor(folder);
          if (key) BimSplitCompare.setAssetSide(key, side);
          else problems.push('Split view: model "' + folder + '" is not loaded');
        });
      });
    }
    if (web.schedule && typeof BimViewer.activateConstructionSchedule === 'function') {
      var sKey = keyFor(web.schedule);
      if (sKey) BimViewer.activateConstructionSchedule(sKey);
    }
    if (web.alignmentSection && typeof BimViewer.activateAlignmentSection === 'function') {
      var aKey = keyFor(web.alignmentSection);
      if (aKey) BimViewer.activateAlignmentSection(aKey);
    }
  }

  function setCredits(lines) {
    var display = BimViewer.viewer && BimViewer.viewer.creditDisplay;
    if (credit && display) display.removeStaticCredit(credit);
    credit = null;
    if (lines && lines.length && display) {
      credit = new Cesium.Credit('Demo models: ' + lines.map(esc).join(' · '), false);
      display.addStaticCredit(credit);
    }
  }

  // ------------------------------------------------------------------
  // Load
  // ------------------------------------------------------------------

  async function loadDemo(id) {
    var scene = scenes.find(function(s) { return s.id === id; });
    if (!scene || busy || !BimViewer.restoreSceneObject) return;
    busy = true;
    activeId = id;
    render();
    closeExtras();
    setCredits(null);
    var web = scene.web || {};
    var copy = JSON.parse(JSON.stringify(scene));
    delete copy.web;
    var problems = [];
    BimViewer.scenes.restoringDemo = true;
    try {
      problems = (await BimViewer.restoreSceneObject(copy)) || [];
    } catch (err) {
      console.error('Demo scene failed:', err);
      problems.push(err.message);
    } finally {
      BimViewer.scenes.restoringDemo = false;
    }
    applyExtras(web, problems);
    setCredits(web.credits);
    busy = false;
    render();
    BimViewer.updateStatus(problems.length
      ? 'Demo "' + title(scene) + '" loaded — ' + problems.length + ' item(s) not available'
      : 'Demo loaded: ' + title(scene), problems.length ? 'warning' : 'success');
    if (problems.length) console.warn('Demo scene problems:', problems);
  }

  // ------------------------------------------------------------------
  // UI: "Demo scenes" block in the Scenes panel
  // ------------------------------------------------------------------

  function render() {
    if (!box) return;
    var list = box.querySelector('.demo-scenes-list');
    if (!list) return;
    if (!scenes.length) {
      list.innerHTML = '<div class="modern-empty-state">No demo scenes</div>';
      return;
    }
    list.innerHTML = scenes.map(function(s) {
      var active = s.id === activeId;
      var loading = active && busy;
      return '<button type="button" class="demo-scene' + (active ? ' active' : '') + '" data-demo-id="' + s.id + '"' +
        (busy ? ' disabled' : '') + ' title="Load this demo scene">' +
        '<i data-lucide="' + (loading ? 'loader' : 'play') + '"></i>' +
        '<span class="demo-scene-name">' + esc(title(s)) + '</span>' +
        '</button>';
    }).join('');
    var active = scenes.find(function(s) { return s.id === activeId; });
    var note = box.querySelector('.demo-scenes-credits');
    var lines = active && active.web && active.web.credits;
    note.hidden = !(lines && lines.length && !busy);
    note.textContent = lines && lines.length ? 'Models: ' + lines.join(' · ') : '';
    if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide', node: list });
  }

  function buildBox() {
    var el = document.createElement('div');
    el.id = 'demoScenes';
    el.className = 'demo-scenes';
    el.innerHTML =
      '<div class="demo-scenes-list" role="group" aria-label="Demo scenes"></div>' +
      '<p class="demo-scenes-credits" hidden></p>';
    el.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-demo-id]');
      if (!btn || btn.disabled) return;
      btn.blur();
      loadDemo(Number(btn.getAttribute('data-demo-id')));
    });
    return el;
  }

  function insert() {
    if (document.getElementById('demoScenes')) return true;
    var panelList = document.querySelector('[data-node="s:list"]');
    var panels = document.documentElement.classList.contains('ui-panels');
    if (panels) {
      if (!panelList || !window.BimPanelsTree) return false;
      var node = BimPanelsTree.create('geobim_demo_scenes_tree').node('s:demo', 'Demo scenes', true, { top: true, meta: true });
      box = buildBox();
      node.sub.appendChild(box);
      if (node.meta) node.meta.textContent = scenes.length ? String(scenes.length) : '';
      panelList.parentNode.insertBefore(node, panelList.nextSibling);
    } else {
      var anchor = document.getElementById('sceneProblems') || document.getElementById('scenesList');
      if (!anchor) return false;
      box = buildBox();
      box.classList.add('demo-scenes-classic');
      var label = document.createElement('div');
      label.className = 'modern-label demo-scenes-label';
      label.textContent = 'Demo scenes';
      box.insertBefore(label, box.firstChild);
      anchor.parentNode.insertBefore(box, anchor.nextSibling);
    }
    render();
    return true;
  }

  // ------------------------------------------------------------------
  // Start
  // ------------------------------------------------------------------

  fetch('demo-scenes.json', { cache: 'no-cache' })
    .then(function(r) { return r.ok ? r.json() : { scenes: [] }; })
    .then(function(d) {
      scenes = (d && Array.isArray(d.scenes) ? d.scenes : []).filter(function(s) { return s && s.cameraLongitudeLatitudeHeight; });
      var tries = 0;
      (function wait() {
        if (insert() || ++tries > 120) return;
        setTimeout(wait, 500);
      })();
    })
    .catch(function(err) { console.warn('Demo scenes not available:', err); });

  window.BimDemoScenes = {
    load: loadDemo,
    list: function() { return scenes.map(function(s) { return { id: s.id, name: title(s) }; }); }
  };
})();
