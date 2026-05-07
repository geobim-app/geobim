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

      <div class="modern-hint">
        <strong>RIGHT-CLICK</strong> on 3D model to place comment<br>
        <strong>LEFT-CLICK</strong> for element info • <strong>C</strong> to toggle • <strong>ESC</strong> to cancel
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
