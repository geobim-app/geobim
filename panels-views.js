/**
 * geobim.app — Views and Scenes panels in desktop style (panel UI, beta)
 *
 * Loaded by panels-ui-loader.js after panels-tree.js, so only in the panel
 * layout; the classic sidebar sections stay as they are.
 *
 * VIEWS   SAVE (Save current view, Smooth transition) · SAVED · n (rows:
 *         name + time / height, click = go there, rename, delete)
 * SCENES  SAVE (name, Save as new scene, Fly to scene) · SCENES · n (the
 *         scenes.js list + "Not restored" box) · FILE (New empty, Import,
 *         Export)
 *
 * Pure UI restructuring: the elements of ui-views-section.js and
 * ui-scenes-section.js keep their IDs and handlers. Two additions, panel
 * layout only:
 *   - views get a name (BimViewer.renameView) and are kept in this browser
 *     (localStorage); the rows are rendered here instead of the emoji rows
 *     of BimViewer.updateSavedViewsList
 *   - scenes.list is kept in this browser as well, the same JSON as the
 *     SavedScenes.json export; Firestore per user follows later
 * Every storage access is wrapped in try/catch: without storage both panels
 * work as before, only nothing survives a reload.
 */
(function() {
  'use strict';

  var VIEWS_KEY = 'geobim_saved_views';
  var SCENES_KEY = 'geobim_saved_scenes';

  var tree = BimPanelsTree.create('geobim_views_tree');
  var node = tree.node;
  var el = tree.el;
  var add = tree.add;

  function byId(id) { return document.getElementById(id); }

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; }
  }

  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function iconBtn(action, icon, title, danger) {
    var b = el('button', 'modern-icon-btn' + (danger ? ' modern-icon-btn-danger' : ''));
    b.type = 'button';
    b.dataset.action = action;
    b.title = title;
    b.setAttribute('aria-label', title);
    var i = el('i');
    i.setAttribute('data-lucide', icon);
    b.appendChild(i);
    return b;
  }

  function emptyState(title, hint) {
    var box = el('div', 'pnl-empty');
    add(box, el('div', 'pnl-empty-title', title), el('div', 'modern-hint pnl-hint', hint));
    return box;
  }

  // ---------------------------------------------------------------------------
  // VIEWS: storage (Cartesian3 as {x, y, z}, timestamp as ms)
  // ---------------------------------------------------------------------------
  var VEC = ['position', 'direction', 'up', 'right'];

  function persistViews() {
    var views = [];
    BimViewer.savedViews.forEach(function(v, slot) {
      var o = {
        slot: slot,
        name: v.name || '',
        timestamp: v.timestamp instanceof Date ? v.timestamp.getTime() : Date.now(),
        googleTilesEnabled: !!v.googleTilesEnabled,
        clipBoth: !!v.clipBoth
      };
      VEC.forEach(function(k) { o[k] = { x: v[k].x, y: v[k].y, z: v[k].z }; });
      views.push(o);
    });
    writeJSON(VIEWS_KEY, { version: 1, views: views });
  }

  function restoreViews() {
    var data = readJSON(VIEWS_KEY);
    if (!data || !Array.isArray(data.views)) return;
    data.views.forEach(function(o) {
      var slot = Number(o && o.slot);
      if (!Number.isInteger(slot) || slot < 1 || BimViewer.savedViews.has(slot)) return;
      var ok = VEC.every(function(k) { return o[k] && isFinite(o[k].x) && isFinite(o[k].y) && isFinite(o[k].z); });
      if (!ok) return;
      var v = {
        name: typeof o.name === 'string' ? o.name : '',
        timestamp: new Date(Number(o.timestamp) || Date.now()),
        googleTilesEnabled: !!o.googleTilesEnabled,
        clipBoth: !!o.clipBoth,
        hasPolygon: false
      };
      VEC.forEach(function(k) { v[k] = new Cesium.Cartesian3(o[k].x, o[k].y, o[k].z); });
      BimViewer.savedViews.set(slot, v);
    });
    var max = 0;
    BimViewer.savedViews.forEach(function(_, slot) { max = Math.max(max, slot); });
    BimViewer.nextViewSlot = Math.max(BimViewer.nextViewSlot || 1, max + 1);
  }

  function viewName(slot, v) {
    return (v && v.name) || ('View ' + slot);
  }

  // ---------------------------------------------------------------------------
  // VIEWS panel
  // ---------------------------------------------------------------------------
  function buildViews(content) {
    var saveBtn = byId('saveCurrentView');
    var list = byId('savedViewsList');
    if (!saveBtn || !list || !BimViewer.savedViews || !window.Cesium) return false;

    restoreViews();

    var root = el('div', 'pnl-tree');

    // SAVE
    var save = node('v:save', 'Save', true, { top: true });
    var icon = saveBtn.querySelector('.modern-btn-icon');
    if (icon) icon.remove();
    var smooth = byId('smoothViewChk');
    var smoothLabel = smooth && smooth.closest('label');
    add(save.sub, saveBtn, smoothLabel);

    // SAVED · n
    var saved = node('v:saved', 'Saved', true, { top: true, meta: true });
    list.className = 'pnl-views-list';
    saved.sub.appendChild(list);

    add(root, save, saved);
    content.innerHTML = ''; // the old hint ("Ctrl+1-9 …") had no handler behind it
    content.appendChild(root);

    // Name for new views, rename, storage after every change
    var origSave = BimViewer.saveView;
    BimViewer.saveView = function(slot) {
      var r = origSave.apply(this, arguments);
      var key = slot == null ? this.nextViewSlot - 1 : slot;
      var v = this.savedViews.get(key);
      if (v && !v.name) v.name = 'View ' + key;
      persistViews();
      this.updateSavedViewsList();
      return r;
    };
    var origDelete = BimViewer.deleteView;
    BimViewer.deleteView = function() {
      var r = origDelete.apply(this, arguments);
      persistViews();
      return r;
    };
    BimViewer.renameView = function(slot, name) {
      var v = this.savedViews.get(slot);
      name = String(name || '').trim();
      if (!v || !name) return;
      v.name = name;
      persistViews();
      this.updateSavedViewsList();
    };

    BimViewer.updateSavedViewsList = function() {
      var views = Array.from(this.savedViews.entries()).sort(function(a, b) { return a[0] - b[0]; });
      saved.meta.textContent = views.length ? String(views.length) : '';
      list.innerHTML = '';
      if (!views.length) {
        list.appendChild(emptyState('No saved views', 'Save the current camera position to come back to it with one click.'));
        return;
      }
      views.forEach(function(entry) {
        var slot = entry[0];
        var v = entry[1];
        var row = el('div', 'pnl-view-row');
        row.dataset.slot = slot;
        var go = el('button', 'pnl-view-go');
        go.type = 'button';
        go.dataset.action = 'load';
        go.title = 'Go to this view';
        var height = Math.round(Cesium.Cartographic.fromCartesian(v.position).height);
        var time = v.timestamp instanceof Date
          ? v.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        add(go, el('span', 'pnl-view-name', viewName(slot, v)),
          el('span', 'pnl-view-meta', [time, height + ' m'].filter(Boolean).join(' · ')));
        var controls = el('div', 'pnl-view-controls');
        add(controls, iconBtn('rename', 'pencil', 'Rename'), iconBtn('delete', 'trash-2', 'Delete', true));
        add(row, go, controls);
        list.appendChild(row);
      });
      if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide', node: list });
    };

    list.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-action]');
      var row = btn && btn.closest('.pnl-view-row');
      if (!row) return;
      var slot = Number(row.dataset.slot);
      var v = BimViewer.savedViews.get(slot);
      if (!v) return;
      switch (btn.dataset.action) {
        case 'load':
          BimViewer.loadView(slot);
          break;
        case 'rename':
          var name = prompt('New name for the view:', viewName(slot, v));
          if (name !== null) BimViewer.renameView(slot, name);
          break;
        case 'delete':
          if (confirm('Delete the view "' + viewName(slot, v) + '"?')) BimViewer.deleteView(slot);
          break;
      }
    });

    BimViewer.updateSavedViewsList();
    return true;
  }

  // ---------------------------------------------------------------------------
  // SCENES panel
  // ---------------------------------------------------------------------------
  function restoreScenes() {
    var s = BimViewer.scenes;
    if (s.list.length) return;
    var data = readJSON(SCENES_KEY);
    var list = data && Array.isArray(data.scenes) ? data.scenes : null;
    if (!list || !list.length) return;
    try { BimViewer.importScenes(JSON.stringify({ scenes: list })); } catch (_) {}
  }

  function buildScenes(content) {
    var ui = window.GEOBIM_SCENES_UI;
    var list = byId('scenesList');
    if (!ui || !list || !BimViewer.scenes || typeof BimViewer.importScenes !== 'function') return false;

    var root = el('div', 'pnl-tree');

    // SAVE
    var save = node('s:save', 'Save', true, { top: true });
    var saveGroup = content.querySelector('.scenes-save');
    if (saveGroup) saveGroup.classList.add('pnl-scenes-save');
    add(save.sub, saveGroup);

    // SCENES · n
    var scenes = node('s:list', 'Scenes', true, { top: true, meta: true });
    list.classList.add('pnl-scenes-list');
    add(scenes.sub, list, byId('sceneProblems'));

    // FILE
    var file = node('s:file', 'File', true, { top: true });
    var actions = content.querySelector('.scenes-actions');
    if (actions) actions.classList.add('pnl-scenes-file');
    var hint = el('p', 'modern-hint pnl-hint',
      'Scenes are kept in this browser. Export them to back them up or to open them in geoBIM Desktop.');
    add(file.sub, actions, hint);

    add(root, save, scenes, file);
    content.innerHTML = '';
    content.appendChild(root);

    // Count + storage after every change (scenes.js calls render() on each)
    var origRender = ui.render;
    ui.render = function() {
      origRender.apply(this, arguments);
      var n = BimViewer.scenes.list.length;
      scenes.meta.textContent = n ? String(n) : '';
      writeJSON(SCENES_KEY, { scenes: BimViewer.scenes.list });
    };

    restoreScenes();
    ui.render();
    return true;
  }

  // ---------------------------------------------------------------------------
  var doneViews = false;
  var doneScenes = false;
  var tries = 0;
  (function wait() {
    if (window.BimPanelsUI && BimPanelsUI.ready && window.BimViewer) {
      if (!doneViews) {
        var v = document.querySelector('.panels-panel[data-section="views"] .modern-section-content');
        if (v) doneViews = buildViews(v);
      }
      if (!doneScenes) {
        var s = document.querySelector('.panels-panel[data-section="scenes"] .modern-section-content');
        if (s) doneScenes = buildScenes(s);
      }
      if (doneViews && doneScenes) {
        if (window.lucide) lucide.createIcons();
        return;
      }
    }
    if (++tries > 200) return;
    setTimeout(wait, 300);
  })();
})();
