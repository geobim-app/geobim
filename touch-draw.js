/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// Touch for measuring and clipping: on a touchscreen there is no right-click
// and no Enter / Esc, so:
//   - Clip polygon / rectangle: a tap places a point (clipping.js listens to
//     RIGHT_CLICK so that a mouse left-click stays free for element info;
//     only touch taps are routed to it, element picking skips those taps).
//     While drawing, a floating bar offers Finish (polygon) and Cancel.
//   - Classic measurement panel: Finish (area) / Cancel under the result while
//     measuring. The panel layout has its own (panels-measure.js).
// Only wraps BimViewer functions; measurement.js and clipping.js keep working
// as before with mouse and keyboard.

(function() {
  'use strict';

  var lastPointer = 'mouse';
  var bar = null;
  var before = null;      // entities that existed when the drawing started
  var finishing = false;  // finishClippingPolygon stops the drawing itself

  function isTouchTap() { return lastPointer === 'touch' || lastPointer === 'pen'; }

  function button(text, cls, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'modern-btn modern-btn-small ' + cls;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  // ---------------------------------------------------------------------------
  // CLIP: taps → points, Finish / Cancel bar
  // ---------------------------------------------------------------------------
  function routeTaps() {
    var handler = BimViewer.clipping.drawHandler;
    if (!handler) return;
    var addPoint = handler.getInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    if (!addPoint) return;
    handler.setInputAction(function(click) {
      if (!isTouchTap()) return;
      // two quick taps are two points, not clipping.js's double right-click
      BimViewer.clipping.lastRightClickTime = 0;
      addPoint(click);
      syncBar();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  // Points / lines of a drawing that is cancelled (Cancel, Esc, P / R) go
  // again. clipping.js's Esc handler means to do this too, but compares
  // Cesium properties with a Color, which never matches. A finished polygon
  // keeps its markers as before.
  function removeTempEntities() {
    if (!before) return;
    var temp = BimViewer.viewer.entities.values.filter(function(entity) {
      return !before.has(entity) && (entity.point || entity.polyline);
    });
    temp.forEach(function(entity) { BimViewer.viewer.entities.remove(entity); });
  }

  function cancelClip() {
    if (BimViewer.clipping.isDrawing) BimViewer.stopClippingDraw();
  }

  function createBar() {
    bar = document.createElement('div');
    bar.id = 'touchDrawBar';
    bar.className = 'touch-draw-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Clipping');
    bar.hidden = true;
    var label = document.createElement('span');
    label.className = 'touch-draw-label';
    bar.appendChild(label);
    bar.appendChild(button('Finish', 'modern-btn-primary touch-draw-finish', function() {
      BimViewer.finishClippingPolygon();
      syncBar();
    }));
    bar.appendChild(button('Cancel', 'modern-btn-secondary touch-draw-cancel', function() {
      cancelClip();
      syncBar();
    }));
    document.body.appendChild(bar);
  }

  function syncBar() {
    if (!bar) return;
    var c = BimViewer.clipping;
    bar.hidden = !c.isDrawing;
    if (!c.isDrawing) return;
    var n = c.currentPoints.length;
    var polygon = c.drawMode === 'polygon';
    bar.querySelector('.touch-draw-label').textContent = (polygon ? 'Clip polygon' : 'Clip rectangle') +
      ' · ' + n + (n === 1 ? ' point' : ' points');
    var finish = bar.querySelector('.touch-draw-finish');
    finish.hidden = !polygon;
    finish.disabled = n < 3;
  }

  function initClip() {
    createBar();
    ['startClippingDraw', 'startClippingRectDraw'].forEach(function(name) {
      var orig = BimViewer[name];
      BimViewer[name] = function() {
        var wasDrawing = this.clipping.isDrawing;
        var r = orig.apply(this, arguments);
        if (!wasDrawing || name === 'startClippingRectDraw') before = new Set(this.viewer.entities.values);
        routeTaps();
        syncBar();
        return r;
      };
    });
    var origStop = BimViewer.stopClippingDraw;
    BimViewer.stopClippingDraw = function() {
      var cancelled = this.clipping.isDrawing && !finishing;
      var r = origStop.apply(this, arguments);
      if (cancelled) removeTempEntities();
      before = null;
      syncBar();
      return r;
    };
    var origFinish = BimViewer.finishClippingPolygon;
    BimViewer.finishClippingPolygon = function() {
      finishing = true;
      try { return origFinish.apply(this, arguments); } finally { finishing = false; syncBar(); }
    };
    var origAdd = BimViewer.addClippingPoint;
    BimViewer.addClippingPoint = function() {
      var r = origAdd.apply(this, arguments);
      syncBar();
      return r;
    };
    // A tap that places a clip point is not an element pick
    var origSelect = BimViewer.handleIFCSelection;
    if (typeof origSelect === 'function') {
      BimViewer.handleIFCSelection = function() {
        if (this.clipping && this.clipping.isDrawing && isTouchTap()) return;
        return origSelect.apply(this, arguments);
      };
    }
    // Esc / Enter / R / P in clipping.js change the state without a hook
    document.addEventListener('keyup', function() { setTimeout(syncBar, 0); });
  }

  // ---------------------------------------------------------------------------
  // CLASSIC MEASUREMENT PANEL: Finish / Cancel under the result
  // ---------------------------------------------------------------------------
  var msActions = null;

  function placeMeasureActions() {
    var result = document.getElementById('measurementResult');
    if (!result) return;
    if (!msActions) {
      msActions = document.createElement('div');
      msActions.className = 'ms-touch-actions';
      msActions.hidden = true;
      var finish = button('Finish', 'modern-btn-primary ms-touch-finish', function() {
        BimViewer.completeAreaMeasurement();
        syncMeasure();
      });
      finish.id = 'msTouchFinish';
      var cancel = button('Cancel', 'modern-btn-secondary ms-touch-cancel', function() {
        BimViewer.cancelMeasurement();
        syncMeasure();
      });
      cancel.id = 'msTouchCancel';
      msActions.appendChild(finish);
      msActions.appendChild(cancel);
    }
    if (msActions.previousElementSibling !== result) result.insertAdjacentElement('afterend', msActions);
  }

  function syncMeasure() {
    if (!msActions) return;
    var m = BimViewer.measurement || {};
    msActions.hidden = !m.active;
    msActions.querySelector('.ms-touch-finish').hidden = m.type !== 'area';
  }

  function initMeasure() {
    // measurement.js rebuilds #measurementPanel on init
    var origCreate = BimViewer.createMeasurementPanel;
    BimViewer.createMeasurementPanel = function() {
      var r = origCreate.apply(this, arguments);
      placeMeasureActions();
      syncMeasure();
      return r;
    };
    // every step and the end of a measurement go through these two
    ['updateMeasurementResult', 'cleanupMeasurementHandlers'].forEach(function(name) {
      var orig = BimViewer[name];
      BimViewer[name] = function() {
        var r = orig.apply(this, arguments);
        syncMeasure();
        return r;
      };
    });
    placeMeasureActions();
    syncMeasure();
  }

  // ---------------------------------------------------------------------------
  function init() {
    document.addEventListener('pointerdown', function(e) { lastPointer = e.pointerType || 'mouse'; }, true);
    if (BimViewer.clipping && typeof BimViewer.startClippingDraw === 'function') initClip();
    if (window.GEOBIM_UI !== 'panels' && typeof BimViewer.createMeasurementPanel === 'function') initMeasure();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
