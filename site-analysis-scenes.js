/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// ===============================
// SITE ANALYSIS IN SCENES
// Saves the site analysis (site-analysis.js) with a scene and restores it.
// Scene field "siteAnalysis" (web only; the Desktop does not know it, the web
// keeps unknown fields): sites with outline, height source and grid size,
// contour interval, cut & fill settings, layers with visibility and opacity,
// the profile line, and a summary of the results at save time. The height
// grids are sampled again on load (see site-analysis.js, STATE).
//
// scenes.js stays unchanged; this module wraps its functions. Load order
// matters: AFTER scenes.js and BEFORE scenes-store.js, so the store's own
// wrappers around saveNewScene / updateScene run outside these and persist
// the scene with the field already in it.
//
// Loading a scene replaces the site analysis like everything else: a scene
// without the field removes the current sites. The restore runs after the
// scene has loaded and does not hold it up (sampling takes about a second
// per site); problems go to the status line.
// ===============================
'use strict';

(function() {

  var FIELD = 'siteAnalysis';

  function sa() { return BimViewer.siteAnalysis; }

  function attach(scene) {
    if (!scene || !sa()) return;
    var state = sa().exportState();
    if (state && (state.sites.length || state.profile)) scene[FIELD] = state;
    else delete scene[FIELD];
  }

  function wrap(name, make) {
    var orig = BimViewer[name];
    if (typeof orig !== 'function' || orig._siteAnalysis) return;
    var fn = make(orig);
    fn._siteAnalysis = true;
    BimViewer[name] = fn;
  }

  function count(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  if (!window.BimViewer || !BimViewer.siteAnalysis || typeof BimViewer.saveNewScene !== 'function') {
    console.warn('site-analysis-scenes.js: scenes.js or site-analysis.js missing — site analysis is not saved in scenes');
    return;
  }

  wrap('saveNewScene', function(orig) {
    return function() {
      var id = orig.apply(this, arguments);
      if (id) attach(this.getScene(id));
      return id;
    };
  });

  wrap('updateScene', function(orig) {
    return function(id) {
      var ok = orig.apply(this, arguments);
      if (ok) attach(this.getScene(id));
      return ok;
    };
  });

  wrap('restoreSceneObject', function(orig) {
    return async function(scene) {
      var result = await orig.apply(this, arguments);
      if (result === null) return result;   // not loaded (busy or no scene)
      var state = scene && scene[FIELD];
      sa().importState(state).then(function(problems) {
        if (problems.length) {
          console.warn('Site analysis restore:', problems);
          BimViewer.updateStatus('Scene "' + scene.name + '": ' + problems.join('; '), 'warning');
        }
      }).catch(function(err) {
        console.error('Site analysis restore failed:', err);
      });
      return result;
    };
  });

  wrap('clearCurrentScene', function(orig) {
    return function() {
      if (sa()) sa().clearAll();
      return orig.apply(this, arguments);
    };
  });

  wrap('deactivateAllTools', function(orig) {
    return function() {
      try { if (sa()) sa().stopDraw(); } catch (e) { /* not essential */ }
      return orig.apply(this, arguments);
    };
  });

  // Scene list: "… · 2 sites · profile"
  wrap('summarizeScene', function(orig) {
    return function(scene) {
      var text = orig.apply(this, arguments);
      var st = scene && scene[FIELD];
      if (!st) return text;
      var parts = text ? [text] : [];
      var n = Array.isArray(st.sites) ? st.sites.length : 0;
      if (n) parts.push(count(n, 'site', 'sites'));
      if (n && st.sites.some(function(s) { return s && s.grading; })) parts.push('grading');
      if (st.profile) parts.push('profile');
      return parts.join(' · ');
    };
  });

})();
