/**
 * geoBIM.app
 * (c) 2026 Christof Lorenz. All rights reserved.
 *
 * Licensed under the Business Source License 1.1 (BSL 1.1)
 * Non-commercial use, evaluation, research, and education permitted.
 * Commercial use requires written permission.
 * Contact: info@geobim.app
 *
 * Change Date: 2030-03-01 — converts to MIT License
 */

// ===============================
// CESIUM BIM VIEWER - INSPECTION MODULE v1.0
// Bridge/Infrastructure Inspection Workflows
// Checkbox in comment dialog adds condition rating, component, damage type
// Color-coded markers by severity, summary panel with live Firestore updates
// ===============================
'use strict';

(function() {

  console.log('Loading Inspection module v1.0...');

  // =====================================
  // STATE
  // =====================================

  var state = {
    summaryUnsubscribe: null,
    currentAssetId: null
  };

  // =====================================
  // COLOR MAPPING (conditionRating → marker color)
  // =====================================

  var CONDITION_COLORS = {
    1: '#6EECD8', // Good — default teal
    2: '#FBBF24', // Fair — yellow
    3: '#e74c3c', // Poor — red
    4: '#e74c3c'  // Critical — red
  };

  // =====================================
  // HELPERS
  // =====================================

  function isChecked() {
    var cb = document.getElementById('inspectionCheckbox');
    return cb && cb.checked;
  }

  function getAssetId() {
    if (BimViewer.loadedAssets && BimViewer.loadedAssets.size > 0) {
      return String(BimViewer.loadedAssets.keys().next().value);
    }
    return 'unknown';
  }

  // =====================================
  // HOOK: saveCommentFromDialog
  // =====================================

  function installHooks() {
    if (typeof BimViewer.saveCommentFromDialog !== 'function') {
      setTimeout(installHooks, 500);
      return;
    }

    // Hook saveCommentFromDialog — read checkbox + fields before save
    var _origSaveFromDialog = BimViewer.saveCommentFromDialog;

    BimViewer.saveCommentFromDialog = async function() {
      if (!isChecked()) {
        return _origSaveFromDialog.call(BimViewer);
      }

      // Read inspection fields from DOM
      var ratingEl = document.getElementById('inspectionRating');
      var componentEl = document.getElementById('inspectionComponent');
      var damageEl = document.getElementById('inspectionDamageType');

      var inspectionData = {
        inspectionMode: true,
        conditionRating: ratingEl ? parseInt(ratingEl.value, 10) : 1,
        component: componentEl ? componentEl.value : 'superstructure',
        damageType: damageEl ? damageEl.value : 'other',
        assetId: getAssetId()
      };

      // Temporarily patch saveComment to merge inspection fields
      var _origSave = BimViewer.saveComment;
      BimViewer.saveComment = async function(commentData) {
        Object.assign(commentData, inspectionData);
        BimViewer.saveComment = _origSave;
        return _origSave.call(BimViewer, commentData);
      };

      await _origSaveFromDialog.call(BimViewer);

      // Restore in case patch wasn't triggered (e.g. validation failure)
      BimViewer.saveComment = _origSave;

      // Refresh summary if visible
      refreshSummaryIfOpen();
    };

    // Hook addCommentEntity — override marker color for inspection comments
    var _origAddEntity = BimViewer.addCommentEntity;

    BimViewer.addCommentEntity = function(comment) {
      if (comment.inspectionMode && comment.conditionRating) {
        var color = CONDITION_COLORS[comment.conditionRating] || '#6EECD8';
        createInspectionEntity(comment, color);
        return;
      }
      _origAddEntity.call(BimViewer, comment);
    };

    console.log('Inspection hooks installed');
  }

  // =====================================
  // CREATE ENTITY WITH INSPECTION COLOR
  // =====================================

  function createInspectionEntity(comment, color) {
    var position = Cesium.Cartesian3.fromDegrees(
      comment.lon, comment.lat, comment.height
    );

    var highResSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="160" viewBox="0 0 128 160">' +
      '<defs><filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">' +
      '<feGaussianBlur in="SourceAlpha" stdDeviation="3"/>' +
      '<feOffset dx="0" dy="2" result="offsetblur"/>' +
      '<feComponentTransfer><feFuncA type="linear" slope="0.5"/></feComponentTransfer>' +
      '<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>' +
      '</filter></defs>' +
      '<circle cx="64" cy="64" r="58" fill="' + color + '" stroke="white" stroke-width="8" filter="url(#shadow)"/>' +
      '<circle cx="64" cy="64" r="26" fill="white"/>' +
      '<circle cx="64" cy="64" r="14" fill="' + color + '"/>' +
      '</svg>';

    BimViewer.viewer.entities.add({
      id: comment.id,
      position: position,
      show: true,
      billboard: {
        image: 'data:image/svg+xml;base64,' + btoa(highResSvg),
        scale: 0.5,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.CLAMP_TO_3D_TILE,
        scaleByDistance: new Cesium.NearFarScalar(5, 1.0, 100, 0.2),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 100)
      },
      label: {
        text: comment.title,
        font: 'bold 26px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 4,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -60),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.CLAMP_TO_3D_TILE,
        scale: 1.0,
        scaleByDistance: new Cesium.NearFarScalar(5, 1.2, 100, 0.3),
        pixelOffsetScaleByDistance: new Cesium.NearFarScalar(5, 1.0, 100, 0.3),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 100),
        showBackground: true,
        backgroundColor: new Cesium.Color(0, 0, 0, 0.85),
        backgroundPadding: new Cesium.Cartesian2(14, 8)
      },
      description: BimViewer.createCommentDescription(comment)
    });

    console.log('Inspection entity added: ' + comment.title + ' (rating ' + comment.conditionRating + ', color ' + color + ')');
  }

  // =====================================
  // PERSIST INSPECTION FIELDS TO FIRESTORE
  // =====================================

  function patchSaveComment() {
    if (typeof BimViewer.saveComment !== 'function') {
      setTimeout(patchSaveComment, 500);
      return;
    }

    var _origSave = BimViewer.saveComment;

    BimViewer.saveComment = async function(commentData) {
      if (!commentData.inspectionMode) {
        return _origSave.call(BimViewer, commentData);
      }

      // Save normally first, then update Firestore doc with inspection fields
      var result = await _origSave.call(BimViewer, commentData);

      if (result) {
        var saved = BimViewer.comments.comments[BimViewer.comments.comments.length - 1];
        if (saved && BimViewer.comments.collection) {
          try {
            await BimViewer.comments.collection.doc(saved.id).update({
              inspectionMode: true,
              conditionRating: commentData.conditionRating,
              component: commentData.component,
              damageType: commentData.damageType,
              assetId: commentData.assetId
            });
            // Update local copy
            saved.inspectionMode = true;
            saved.conditionRating = commentData.conditionRating;
            saved.component = commentData.component;
            saved.damageType = commentData.damageType;
            saved.assetId = commentData.assetId;
          } catch (e) {
            console.error('Inspection: failed to update Firestore:', e);
          }
        }
      }

      return result;
    };

    console.log('Inspection: saveComment patched for Firestore fields');
  }

  // =====================================
  // SUMMARY PANEL (in toolbar)
  // =====================================

  function refreshSummaryIfOpen() {
    var summaryEl = document.getElementById('inspectionSummaryContent');
    if (summaryEl && summaryEl.innerHTML !== '') {
      openSummaryForAsset(state.currentAssetId || getAssetId());
    }
  }

  function openSummaryForAsset(assetId) {
    if (!assetId) assetId = getAssetId();
    state.currentAssetId = assetId;

    var summaryEl = document.getElementById('inspectionSummaryContent');
    if (!summaryEl) return;

    // Unsubscribe previous listener
    closeSummary();

    if (!BimViewer.comments || !BimViewer.comments.collection) {
      summaryEl.innerHTML = '<div style="color: rgba(255,255,255,0.5); padding: 8px;">Comments not initialized</div>';
      return;
    }

    summaryEl.innerHTML = '<div style="color: rgba(255,255,255,0.5); padding: 8px;">Loading...</div>';

    var query = BimViewer.comments.collection
      .where('inspectionMode', '==', true)
      .where('assetId', '==', assetId);

    state.summaryUnsubscribe = query.onSnapshot(function(snapshot) {
      var findings = [];
      snapshot.forEach(function(doc) {
        findings.push(doc.data());
      });
      renderSummary(findings, summaryEl);
    }, function(error) {
      console.error('Inspection summary query error:', error);
      summaryEl.innerHTML = '<div style="color: #e74c3c; padding: 8px;">Error loading summary</div>';
    });
  }

  function closeSummary() {
    if (state.summaryUnsubscribe) {
      state.summaryUnsubscribe();
      state.summaryUnsubscribe = null;
    }
  }

  function renderSummary(findings, container) {
    if (findings.length === 0) {
      container.innerHTML = '<div style="color: rgba(255,255,255,0.5); padding: 8px;">No inspection findings for this asset</div>';
      return;
    }

    var totalCount = findings.length;
    var sumRating = 0;
    var redCount = 0;
    var componentMap = {};

    findings.forEach(function(f) {
      var r = f.conditionRating || 1;
      sumRating += r;
      if (r >= 3) redCount++;

      var comp = f.component || 'unknown';
      if (!componentMap[comp]) {
        componentMap[comp] = { count: 0, sumRating: 0 };
      }
      componentMap[comp].count++;
      componentMap[comp].sumRating += r;
    });

    var avgRating = (sumRating / totalCount).toFixed(1);

    var html = '';
    html += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">';
    html += '<div style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 10px; text-align: center;">';
    html += '<div style="font-size: 20px; font-weight: 700; color: #6EECD8;">' + totalCount + '</div>';
    html += '<div style="font-size: 10px; color: rgba(255,255,255,0.5); text-transform: uppercase;">Findings</div>';
    html += '</div>';
    html += '<div style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 10px; text-align: center;">';
    html += '<div style="font-size: 20px; font-weight: 700; color: ' + (parseFloat(avgRating) >= 3 ? '#e74c3c' : parseFloat(avgRating) >= 2 ? '#FBBF24' : '#6EECD8') + ';">' + avgRating + '</div>';
    html += '<div style="font-size: 10px; color: rgba(255,255,255,0.5); text-transform: uppercase;">Avg Rating</div>';
    html += '</div>';
    html += '</div>';

    if (redCount > 0) {
      html += '<div style="background: rgba(231,76,60,0.15); border: 1px solid rgba(231,76,60,0.3); border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; color: #e74c3c; font-size: 12px; font-weight: 600;">';
      html += redCount + ' critical/poor finding' + (redCount > 1 ? 's' : '') + ' (rating >= 3)';
      html += '</div>';
    }

    var components = Object.keys(componentMap);
    if (components.length > 0) {
      html += '<div style="font-size: 11px; color: rgba(255,255,255,0.5); text-transform: uppercase; margin-bottom: 6px; font-weight: 600;">By Component</div>';
      html += '<table style="width: 100%; font-size: 12px; border-collapse: collapse;">';
      html += '<tr style="color: rgba(255,255,255,0.4); font-size: 10px; text-transform: uppercase;">';
      html += '<td style="padding: 4px 0;">Component</td><td style="text-align: center;">Count</td><td style="text-align: center;">Avg</td></tr>';

      components.forEach(function(comp) {
        var data = componentMap[comp];
        var compAvg = (data.sumRating / data.count).toFixed(1);
        var compColor = parseFloat(compAvg) >= 3 ? '#e74c3c' : parseFloat(compAvg) >= 2 ? '#FBBF24' : '#6EECD8';
        html += '<tr style="border-top: 1px solid rgba(255,255,255,0.05);">';
        html += '<td style="padding: 6px 0; color: rgba(255,255,255,0.8);">' + comp + '</td>';
        html += '<td style="text-align: center; color: rgba(255,255,255,0.6);">' + data.count + '</td>';
        html += '<td style="text-align: center; color: ' + compColor + '; font-weight: 600;">' + compAvg + '</td>';
        html += '</tr>';
      });

      html += '</table>';
    }

    container.innerHTML = html;
  }

  // =====================================
  // SUMMARY TOOLBAR CONTENT
  // =====================================

  function getSummaryContent() {
    var html = '';

    html += '<button onclick="GEOBIM_INSPECTION.openSummaryForAsset()" ';
    html += 'style="width: 100%; padding: 8px 14px; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; ';
    html += 'background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.8); ';
    html += 'font-size: 12px; font-weight: 600; cursor: pointer; margin-bottom: 10px; transition: all 0.2s ease;">';
    html += 'Load Inspection Summary</button>';

    html += '<div id="inspectionSummaryContent"></div>';

    return html;
  }

  // =====================================
  // INSTALL HOOKS ON LOAD
  // =====================================

  installHooks();
  patchSaveComment();

  // =====================================
  // PUBLIC API
  // =====================================

  window.GEOBIM_INSPECTION = {
    isActive: isChecked,
    openSummaryForAsset: openSummaryForAsset,
    getSummaryContent: getSummaryContent
  };

  console.log('Inspection module v1.0 loaded');

})();
