// ===============================
// CESIUM BIM VIEWER - UI COMMENTS EXTENSION v4.1 (RIGHT-CLICK ONLY)
// Adds point/area toggle buttons with correct instructions
// ===============================
'use strict';

(function() {
  
  if (typeof BimViewerUI === 'undefined') {
    console.error('❌ BimViewerUI not found! This extension requires ui.js to be loaded first.');
    return;
  }
  
  // Override the getCommentsContent method with v4.1 version
  const originalGetCommentsContent = BimViewerUI.getCommentsContent;
  
  BimViewerUI.getCommentsContent = function() {
    return `
      <div class="modern-group">
        <div class="modern-label">Annotation Type</div>
        <div class="modern-btn-group">
          <button id="annotationTypePoint" class="modern-btn modern-btn-small active" onclick="BimViewer.setAnnotationType('point')">
            <span class="modern-btn-icon">💬</span>
            <span>Point</span>
          </button>
          <button id="annotationTypeArea" class="modern-btn modern-btn-small" onclick="BimViewer.setAnnotationType('area')">
            <span class="modern-btn-icon">📐</span>
            <span>Area</span>
          </button>
        </div>
      </div>
      
      <div class="modern-group" style="margin-top: 12px;">
        <button id="toggleCommentMode" class="modern-btn modern-btn-primary">
          <span class="modern-btn-icon">💬</span>
          <span>Add Comment</span>
          <span id="commentsCount" class="modern-badge" style="display: none;">0</span>
        </button>
        
        <button id="initFirebaseBtn" class="modern-btn modern-btn-success" style="display: none;">
          <span class="modern-btn-icon">🔥</span>
          <span>Initialize Firebase</span>
        </button>
      </div>
      
      <div class="modern-group" style="margin-top: 8px;">
        <div class="modern-btn-group">
          <button id="toggleAllCommentsBtn" class="modern-btn modern-btn-small" onclick="BimViewer.toggleAllCommentsVisibility()" title="Show/Hide all comments">
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
        <strong>💬 Point:</strong> RIGHT-CLICK once → Dialog opens<br>
        <strong>📐 Area:</strong> RIGHT-CLICK 3+ times → ENTER to finish<br>
        <strong>✅ LEFT-CLICK stays free</strong> for element info!<br>
        <br>
        Shortcuts: <strong>C</strong> Point • <strong>A</strong> Area • <strong>ENTER</strong> Finish • <strong>ESC</strong> Cancel
      </div>
      
      <div class="modern-label" style="margin-top: 12px;">
        Recent Comments
        <span id="commentsListStatus" class="modern-status">Loading...</span>
      </div>
      <div id="commentsList" class="modern-comments-list">
        <div class="modern-empty-state">Initializing...</div>
      </div>
    `;
  };
  
  // Add modern styles
  const style = document.createElement('style');
  style.textContent = `
    /* Modern Button Group */
    .modern-btn-group {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 8px;
    }
    
    .modern-btn-small {
      padding: 8px 12px !important;
      font-size: 13px !important;
    }
    
    .modern-btn-small .modern-btn-icon {
      font-size: 16px;
    }
    
    .modern-btn-small.active {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4) !important;
      transform: translateY(-1px);
    }
    
    .modern-btn-small:not(.active) {
      background: rgba(255, 255, 255, 0.08) !important;
      color: rgba(255, 255, 255, 0.6);
    }
    
    .modern-btn-small:not(.active):hover {
      background: rgba(255, 255, 255, 0.12) !important;
      color: rgba(255, 255, 255, 0.9);
    }
    
    .modern-btn-danger {
      background: rgba(231, 76, 60, 0.2) !important;
      color: #ff6b6b !important;
      border: 1px solid rgba(231, 76, 60, 0.3) !important;
    }
    
    .modern-btn-danger:hover {
      background: rgba(231, 76, 60, 0.3) !important;
      color: #ff8787 !important;
      border-color: rgba(231, 76, 60, 0.5) !important;
    }
    
    /* Modern Comment List Item */
    .modern-comment-item {
      background: rgba(255, 255, 255, 0.05);
      border-left: 3px solid #667eea;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    
    .modern-comment-item:hover {
      background: rgba(255, 255, 255, 0.1);
      transform: translateX(-2px);
    }
    
    .modern-comment-item.priority-high {
      border-left-color: #ee0979;
    }
    
    .modern-comment-item.priority-normal {
      border-left-color: #667eea;
    }
    
    .modern-comment-item.priority-low {
      border-left-color: #718096;
    }
    
    .modern-comment-item.type-area {
      border-left-width: 4px;
      border-left-style: dashed;
    }
    
    .modern-comment-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }
    
    .modern-comment-title {
      font-weight: 600;
      color: #e2e8f0;
      font-size: 13px;
      flex: 1;
    }
    
    .modern-comment-controls {
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    
    .modern-comment-item:hover .modern-comment-controls {
      opacity: 1;
    }
    
    .modern-comment-btn {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.1);
      color: white;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    
    .modern-comment-btn:hover {
      transform: scale(1.1);
    }
    
    .modern-comment-btn.edit-btn:hover {
      background: #667eea;
    }
    
    .modern-comment-btn.delete-btn:hover {
      background: #ee0979;
    }
    
    .modern-comment-text {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.7);
      line-height: 1.4;
      margin-bottom: 6px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    
    .modern-comment-meta {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      font-size: 10px;
      color: rgba(255, 255, 255, 0.5);
    }
    
    .modern-comment-type {
      background: rgba(102, 126, 234, 0.3);
      padding: 2px 6px;
      border-radius: 3px;
      font-weight: 600;
    }
    
    .modern-comment-category {
      background: rgba(255, 255, 255, 0.1);
      padding: 2px 6px;
      border-radius: 3px;
      font-weight: 600;
    }
    
    .modern-comment-priority {
      padding: 2px 6px;
      border-radius: 3px;
      font-weight: 600;
    }
    
    .modern-comment-priority.high {
      background: rgba(238, 9, 121, 0.2);
      color: #ff6a9e;
    }
    
    .modern-comment-priority.normal {
      background: rgba(102, 126, 234, 0.2);
      color: #a5b4fc;
    }
    
    .modern-comment-priority.low {
      background: rgba(113, 128, 150, 0.2);
      color: #cbd5e0;
    }
    
    /* Modern Hidden Features List Item */
    .modern-hidden-item {
      background: rgba(255, 255, 255, 0.05);
      border-left: 3px solid #ee0979;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 8px;
      transition: all 0.2s ease;
    }
    
    .modern-hidden-item:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    
    .modern-hidden-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .modern-hidden-name {
      font-weight: 600;
      color: #e2e8f0;
      font-size: 13px;
      flex: 1;
    }
    
    .modern-hidden-time {
      font-size: 10px;
      color: rgba(255, 255, 255, 0.5);
      margin-top: 4px;
    }
    
    /* Modern Saved View Item */
    .modern-view-item {
      background: rgba(255, 255, 255, 0.05);
      border-left: 3px solid #11998e;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 8px;
      transition: all 0.2s ease;
    }
    
    .modern-view-item:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    
    .modern-view-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    
    .modern-view-name {
      font-weight: 600;
      color: #e2e8f0;
      font-size: 13px;
    }
    
    .modern-view-controls {
      display: flex;
      gap: 4px;
    }
    
    .modern-view-details {
      font-size: 11px;
      color: rgba(255, 255, 255, 0.5);
    }
    
    /* Enhanced hints section */
    .modern-hint {
      background: rgba(102, 126, 234, 0.1);
      border-left: 3px solid #667eea;
      padding: 10px;
      border-radius: 6px;
      font-size: 11px;
      line-height: 1.6;
      color: rgba(255, 255, 255, 0.8);
      margin-bottom: 12px;
    }
    
    .modern-hint strong {
      color: #a5b4fc;
      font-weight: 600;
    }
  `;
  document.head.appendChild(style);
  
  console.log('✅ Modern Comments UI extension loaded (v4.1 - RIGHT-CLICK ONLY)');
  
})();
