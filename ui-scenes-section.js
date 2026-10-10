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

// Sidebar section "Scenes" (scenes.js): save the current state as a scene,
// load / update / rename / delete, new empty scene, import / export as
// SavedScenes.json (same file as geoBIM Desktop).

(function() {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function getContent() {
    return `
      <div class="modern-group scenes-save">
        <input type="text" id="sceneNameInput" class="modern-input" maxlength="80"
               placeholder="Scene name" aria-label="Scene name">
        <button type="button" id="sceneSaveBtn" class="modern-btn modern-btn-primary">
          <i data-lucide="clapperboard"></i><span>Save as new scene</span>
        </button>
        <label class="modern-check" title="Fly to the scene's camera (≈2 s) instead of jumping">
          <input type="checkbox" id="sceneFlyChk" checked> Fly to scene
        </label>
      </div>

      <div id="sceneProblems" class="scenes-problems" role="status" hidden></div>

      <div id="scenesList" class="modern-views-list scenes-list"></div>

      <div class="modern-group scenes-actions">
        <button type="button" id="sceneClearBtn" class="modern-btn modern-btn-small" title="Unload all models, keep camera, basemap and sun">
          <i data-lucide="file-plus"></i><span>New empty scene</span>
        </button>
        <button type="button" id="sceneImportBtn" class="modern-btn modern-btn-small" title="Add scenes from a SavedScenes.json (geoBIM Desktop or exported here)">
          <i data-lucide="upload"></i><span>Import</span>
        </button>
        <button type="button" id="sceneExportBtn" class="modern-btn modern-btn-small" title="Download all scenes as SavedScenes.json">
          <i data-lucide="download"></i><span>Export</span>
        </button>
        <input type="file" id="sceneImportInput" accept=".json,application/json" hidden>
      </div>

      <div class="modern-hint">Scenes are kept until you reload the page — export them to keep them.</div>
    `;
  }

  function render() {
    var list = document.getElementById('scenesList');
    if (!list || !BimViewer.scenes) return;
    var s = BimViewer.scenes;

    if (!s.list.length) {
      list.innerHTML = '<div class="modern-empty-state"><div class="modern-empty-state-icon"><i data-lucide="clapperboard" class="scenes-empty-icon"></i></div>' +
        '<div class="modern-empty-state-title">No scenes yet</div>' +
        '<div class="modern-empty-state-hint">Save the current view, models and sun as a scene, or import a SavedScenes.json</div></div>';
    } else {
      list.innerHTML = s.list.map(function(scene) {
        var id = Number(scene.iD);
        var active = id === s.activeId;
        var meta = [BimViewer.summarizeScene(scene), BimViewer.sceneModifiedText(scene)].filter(Boolean).join(' — ');
        return '<div class="modern-view-item scenes-item' + (active ? ' active' : '') + '" data-id="' + id + '">' +
          '<div class="modern-view-header">' +
            '<button type="button" class="scenes-name" data-action="load" title="Load this scene"' + (s.loading ? ' disabled' : '') + '>' + esc(scene.name) + '</button>' +
            '<div class="modern-view-controls">' +
              '<button type="button" class="modern-icon-btn" data-action="load" title="Load"' + (s.loading ? ' disabled' : '') + '><i data-lucide="play"></i></button>' +
              '<button type="button" class="modern-icon-btn" data-action="update" title="Overwrite with the current state (name stays)"><i data-lucide="refresh-cw"></i></button>' +
              '<button type="button" class="modern-icon-btn" data-action="rename" title="Rename"><i data-lucide="pencil"></i></button>' +
              '<button type="button" class="modern-icon-btn modern-icon-btn-danger" data-action="delete" title="Delete"><i data-lucide="trash-2"></i></button>' +
            '</div>' +
          '</div>' +
          (meta ? '<div class="modern-view-details">' + esc(meta) + '</div>' : '') +
        '</div>';
      }).join('');
    }

    var box = document.getElementById('sceneProblems');
    if (box) {
      var problems = s.lastProblems || [];
      box.hidden = !problems.length;
      box.innerHTML = problems.length
        ? '<strong>Not restored:</strong><ul>' + problems.map(function(p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>'
        : '';
    }

    if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide', node: list });
  }

  function onListClick(e) {
    var btn = e.target.closest('[data-action]');
    var item = btn && btn.closest('.scenes-item');
    if (!item) return;
    var id = Number(item.getAttribute('data-id'));
    var scene = BimViewer.getScene(id);
    if (!scene) return;

    switch (btn.getAttribute('data-action')) {
      case 'load':
        BimViewer.loadScene(id);
        break;
      case 'update':
        if (confirm('Overwrite "' + scene.name + '" with the current state?')) BimViewer.updateScene(id);
        break;
      case 'rename':
        var name = prompt('New name for the scene:', scene.name);
        if (name !== null) BimViewer.renameScene(id, name);
        break;
      case 'delete':
        if (confirm('Delete the scene "' + scene.name + '"?')) BimViewer.deleteScene(id);
        break;
    }
  }

  function initHandlers() {
    var nameInput = document.getElementById('sceneNameInput');
    var save = function() {
      BimViewer.saveNewScene(nameInput ? nameInput.value : '');
      if (nameInput) nameInput.value = '';
    };
    document.getElementById('sceneSaveBtn')?.addEventListener('click', save);
    nameInput?.addEventListener('keydown', function(e) { if (e.key === 'Enter') save(); });

    document.getElementById('sceneFlyChk')?.addEventListener('change', function(e) {
      BimViewer.scenes.flyTo = e.target.checked;
    });

    document.getElementById('scenesList')?.addEventListener('click', onListClick);

    document.getElementById('sceneClearBtn')?.addEventListener('click', function() {
      if (confirm('Start an empty scene? All models are unloaded (camera, basemap and sun stay).')) BimViewer.clearCurrentScene();
    });

    document.getElementById('sceneExportBtn')?.addEventListener('click', function() { BimViewer.exportScenes(); });

    var fileInput = document.getElementById('sceneImportInput');
    document.getElementById('sceneImportBtn')?.addEventListener('click', function() { fileInput?.click(); });
    fileInput?.addEventListener('change', function() {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      file.text().then(function(text) {
        var r = BimViewer.importScenes(text);
        BimViewer.updateStatus(r.added + ' scene' + (r.added === 1 ? '' : 's') + ' imported' +
          (r.skipped ? ', ' + r.skipped + ' skipped (no camera)' : ''), r.added ? 'success' : 'warning');
      }).catch(function(err) {
        BimViewer.updateStatus('Import failed: ' + err.message, 'error');
      }).finally(function() { fileInput.value = ''; });
    });

    render();
  }

  window.GEOBIM_SCENES_UI = {
    getContent: getContent,
    initHandlers: initHandlers,
    render: render
  };
})();
