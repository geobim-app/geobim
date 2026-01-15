// ===============================
// CESIUM BIM VIEWER - CLIPPING UI EXTENSION v3.0
// Modern UI for enhanced clipping functionality
// ===============================
'use strict';

(function() {
  
  if (typeof BimViewerUI === 'undefined') {
    console.error('❌ BimViewerUI not found! This extension requires ui.js to be loaded first.');
    return;
  }
  
  // Override the getDrawingContent method to use enhanced clipping UI
  const originalGetDrawingContent = BimViewerUI.getDrawingContent;
  
  BimViewerUI.getDrawingContent = function() {
    return `
      <div class="modern-group">
        <div class="modern-label">
          Clipping Polygons
          <span id="clippingPolygonCount" class="modern-badge" style="display: none;">0</span>
        </div>
        
        <button id="startClippingDraw" class="modern-btn modern-btn-primary">
          <span class="modern-btn-icon">✏️</span>
          <span>Draw Polygon</span>
        </button>
        
        <div class="modern-hint" style="margin-top: 8px;">
          <strong>🖱️ RIGHT-CLICK</strong> Add point<br>
          <strong>🖱️ DOUBLE RIGHT-CLICK</strong> Finish polygon<br>
          <strong>⌨️ ENTER</strong> Also finishes polygon<br>
          <strong>⌨️ P</strong> Start/Stop drawing<br>
          <strong>⌨️ ESC</strong> Cancel drawing<br>
          <strong>⌨️ DEL</strong> Remove last polygon<br>
          <strong>✅ LEFT-CLICK stays free</strong> for element info!
        </div>
      </div>
      
      <div class="modern-group" style="margin-top: 12px;">
        <div class="modern-label">Controls</div>
        
        <div class="modern-btn-group">
          <button id="toggleClippingEnabled" class="modern-btn modern-btn-small active">
            <span class="modern-btn-icon">✅</span>
            <span>Enabled</span>
          </button>
          <button id="toggleInverseClipping" class="modern-btn modern-btn-small">
            <span class="modern-btn-icon">➡️</span>
            <span>Normal</span>
          </button>
        </div>
        
        <div class="modern-btn-group" style="margin-top: 8px;">
          <button id="toggleClippingVisualization" class="modern-btn modern-btn-small active">
            <span class="modern-btn-icon">👁️</span>
            <span>Show Fill</span>
          </button>
          <button id="toggleTerrainClipping" class="modern-btn modern-btn-small">
            <span class="modern-btn-icon">🏙️</span>
            <span>Buildings Only</span>
          </button>
        </div>
      </div>
      
      <div class="modern-group" style="margin-top: 12px;">
        <div class="modern-label">Actions</div>
        
        <div class="modern-btn-group">
          <button id="removeLastPolygon" class="modern-btn modern-btn-small modern-btn-warning">
            <span class="modern-btn-icon">⬅️</span>
            <span>Remove Last</span>
          </button>
          <button id="clearAllClipping" class="modern-btn modern-btn-small modern-btn-danger">
            <span class="modern-btn-icon">🗑️</span>
            <span>Clear All</span>
          </button>
        </div>
      </div>
      
      <div class="modern-group" style="margin-top: 12px;">
        <div class="modern-label">Polygons</div>
        <div id="clippingPolygonList" class="modern-clipping-list">
          <div class="modern-empty-state">No clipping polygons</div>
        </div>
      </div>
    `;
  };
  
  // Add event listeners after UI is created
  const originalInitEventHandlers = BimViewerUI.initEventHandlers;
  
  BimViewerUI.initEventHandlers = function() {
    // Call original event listeners
    if (originalInitEventHandlers) {
      originalInitEventHandlers.call(this);
    }
    
    // Enhanced clipping event listeners
    document.getElementById('startClippingDraw')?.addEventListener('click', () => {
      if (BimViewer.clipping.isDrawing) {
        BimViewer.stopClippingDraw();
      } else {
        BimViewer.startClippingDraw();
      }
    });
    
    document.getElementById('toggleClippingEnabled')?.addEventListener('click', () => {
      BimViewer.toggleClippingEnabled();
    });
    
    document.getElementById('toggleClippingVisualization')?.addEventListener('click', () => {
      BimViewer.toggleClippingVisualization();
    });
    
    document.getElementById('toggleInverseClipping')?.addEventListener('click', () => {
      BimViewer.toggleInverseClipping();
    });
    
    document.getElementById('toggleTerrainClipping')?.addEventListener('click', () => {
      BimViewer.toggleTerrainClipping();
    });
    
    document.getElementById('removeLastPolygon')?.addEventListener('click', () => {
      BimViewer.removeLastClippingPolygon();
    });
    
    document.getElementById('clearAllClipping')?.addEventListener('click', () => {
      if (confirm('Remove all clipping polygons?')) {
        BimViewer.clearAllClipping();
      }
    });
    
    console.log('✅ Enhanced clipping event listeners initialized');
  };
  
  // Add modern styles for clipping UI
  const style = document.createElement('style');
  style.textContent = `
    /* Modern Clipping List */
    .modern-clipping-list {
      max-height: 200px;
      overflow-y: auto;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
      padding: 8px;
    }
    
    .modern-clipping-list::-webkit-scrollbar {
      width: 6px;
    }
    
    .modern-clipping-list::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.05);
      border-radius: 3px;
    }
    
    .modern-clipping-list::-webkit-scrollbar-thumb {
      background: rgba(0, 191, 255, 0.5);
      border-radius: 3px;
    }
    
    .modern-clipping-list::-webkit-scrollbar-thumb:hover {
      background: rgba(0, 191, 255, 0.8);
    }
    
    /* Individual Clipping Polygon Item */
    .modern-clipping-item {
      background: rgba(255, 255, 255, 0.05);
      border-left: 3px solid #00bfff;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 8px;
      transition: all 0.2s ease;
    }
    
    .modern-clipping-item:hover {
      background: rgba(255, 255, 255, 0.1);
      transform: translateX(-2px);
    }
    
    .modern-clipping-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    
    .modern-clipping-name {
      font-weight: 600;
      color: #00bfff;
      font-size: 13px;
    }
    
    .modern-clipping-details {
      font-size: 11px;
      color: rgba(255, 255, 255, 0.6);
    }
    
    /* Warning button style */
    .modern-btn-warning {
      background: rgba(255, 165, 0, 0.2) !important;
      color: #ffa500 !important;
      border: 1px solid rgba(255, 165, 0, 0.3) !important;
    }
    
    .modern-btn-warning:hover {
      background: rgba(255, 165, 0, 0.3) !important;
      color: #ffb733 !important;
      border-color: rgba(255, 165, 0, 0.5) !important;
    }
    
    /* Active drawing button animation */
    #startClippingDraw.active {
      animation: clippingPulse 2s infinite;
    }
    
    @keyframes clippingPulse {
      0%, 100% {
        box-shadow: 0 0 10px rgba(0, 191, 255, 0.5);
      }
      50% {
        box-shadow: 0 0 20px rgba(0, 191, 255, 0.8), 0 0 30px rgba(0, 191, 255, 0.4);
      }
    }
    
    /* Enhanced hint box for clipping */
    .modern-group .modern-hint {
      background: rgba(0, 191, 255, 0.1);
      border-left: 3px solid #00bfff;
      padding: 10px;
      border-radius: 6px;
      font-size: 11px;
      line-height: 1.6;
      color: rgba(255, 255, 255, 0.8);
    }
    
    .modern-group .modern-hint strong {
      color: #00bfff;
      font-weight: 600;
    }
  `;
  document.head.appendChild(style);
  
  console.log('✅ Enhanced Clipping UI extension loaded (v3.1 - RIGHT-CLICK + ENTER)');
  
})();
