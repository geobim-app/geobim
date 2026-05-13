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

(function() {
  'use strict';

  function getContent() {
    return `
      <div class="modern-group">
        <div class="modern-label">Type</div>
        <div class="modern-btn-group annotation-type-grid">
          <button id="annotationTypePoint" class="modern-btn modern-btn-icon-only active" onclick="BimViewer.setAnnotationType('point')" title="Point — right-click to place">
            📍
          </button>
          <button id="annotationTypeCircle" class="modern-btn modern-btn-icon-only" onclick="BimViewer.setAnnotationType('circle')" title="Circle — right-click center, then radius">
            ⭕
          </button>
          <button id="annotationTypePolyline" class="modern-btn modern-btn-icon-only" onclick="BimViewer.setAnnotationType('polyline')" title="Polyline — right-click 2+ points, ENTER to finish">
            〰️
          </button>
          <button id="annotationTypeArea" class="modern-btn modern-btn-icon-only" onclick="BimViewer.setAnnotationType('area')" title="Area — right-click 3+ points, ENTER to finish">
            ⬡
          </button>
        </div>
      </div>

      <div class="modern-group" style="margin-top: 12px;">
        <button id="toggleCommentMode" class="modern-btn modern-btn-primary" title="Click to place a comment marker">
          <span class="modern-btn-icon">💬</span>
          <span>Add Comment</span>
          <span id="commentsCount" class="modern-badge" style="display: none;">0</span>
        </button>

        <button id="initFirebaseBtn" class="modern-btn modern-btn-secondary" style="display: none;">
          <span class="modern-btn-icon">🔥</span>
          <span>Initialize Firebase</span>
        </button>
      </div>

      <div class="modern-group" style="margin-top: 8px;">
        <div class="modern-btn-group">
          <button id="toggleAllCommentsBtn" class="modern-btn modern-btn-small" onclick="BimViewer.toggleAllCommentsVisibility()" title="Show/hide all comments">
            <span class="modern-btn-icon">👁️</span>
            <span>Hide All</span>
          </button>
          <button id="deleteAllCommentsBtn" class="modern-btn modern-btn-small modern-btn-danger" onclick="BimViewer.deleteAllComments()" title="Delete all comments">
            <span class="modern-btn-icon">🗑️</span>
            <span>Delete All</span>
          </button>
        </div>
      </div>

      <div class="modern-hint">
        <strong>📍 Point:</strong> RIGHT-CLICK once<br>
        <strong>⭕ Circle:</strong> RIGHT-CLICK center, then edge<br>
        <strong>〰️ Polyline:</strong> RIGHT-CLICK 2+ pts → ENTER<br>
        <strong>⬡ Area:</strong> RIGHT-CLICK 3+ pts → ENTER<br>
        Shortcuts: <strong>C</strong> Point • <strong>A</strong> Area • <strong>ENTER</strong> Finish • <strong>ESC</strong> Cancel
      </div>

      <div class="modern-group" style="margin-top: 8px;">
        <button class="modern-btn modern-btn-small" onclick="BimViewer.toggleCommentsPanel()" title="Show/hide Recent Annotations panel">
          <span class="modern-btn-icon">📋</span>
          <span>Recent Annotations</span>
          <span id="commentsListStatus" class="modern-status" style="margin-left: auto;">Loading...</span>
        </button>
      </div>
    `;
  }

  function initHandlers() {
    document.getElementById('toggleCommentMode')?.addEventListener('click', () => {
      BimViewer.toggleCommentMode();
    });

    document.getElementById('initFirebaseBtn')?.addEventListener('click', () => {
      BimViewer.initFirebase();
    });
  }

  window.GEOBIM_COMMENTS_UI = {
    getContent: getContent,
    initHandlers: initHandlers
  };
})();
