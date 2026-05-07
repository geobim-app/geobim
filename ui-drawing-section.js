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
        <button id="toggleMeasurement" class="modern-btn modern-btn-primary" onclick="BimViewer.toggleMeasurementPanel()" title="Open measurement tools">
          <span class="modern-btn-icon">📏</span>
          <span>Measurement Tools</span>
        </button>
      </div>

      <div class="modern-divider">
        <span class="modern-divider-text">Clipping</span>
      </div>

      <div class="modern-group">
        <button id="startDrawing" class="modern-btn modern-btn-primary" title="Right-click to draw clipping polygon">
          <span class="modern-btn-icon">✏️</span>
          <span>Start Drawing</span>
        </button>
        <button id="stopDrawing" class="modern-btn modern-btn-secondary hidden" title="Cut through model with polygon">
          <span class="modern-btn-icon">✅</span>
          <span>Apply Clipping</span>
        </button>
      </div>

      <div class="modern-group">
        <button id="togglePolygon" class="modern-btn modern-btn-secondary" title="Show/hide clipping polygon">
          <span class="modern-btn-icon">👁️</span>
          <span>Toggle Polygon</span>
        </button>
        <button id="clearPolygon" class="modern-btn modern-btn-danger" title="Remove clipping polygon">
          <span class="modern-btn-icon">🗑️</span>
          <span>Clear Polygon</span>
        </button>
      </div>

      <div class="modern-info-box">
        <div class="modern-label">Clipping Mode:</div>
        <button id="toggleClipMode" class="modern-toggle-btn" title="Include/exclude terrain in clipping">
          <span class="modern-btn-icon">🏙️</span>
          <span>Buildings Only</span>
        </button>
      </div>

      <div class="modern-hint">
        <strong>Usage:</strong> Click map to add points • ESC to exit
      </div>
    `;
  }

  function initHandlers() {
    document.getElementById('startDrawing')?.addEventListener('click', () => {
      BimViewer.enterDrawingMode();
      document.getElementById('startDrawing').classList.add('hidden');
      document.getElementById('stopDrawing').classList.remove('hidden');
    });

    document.getElementById('stopDrawing')?.addEventListener('click', () => {
      BimViewer.exitDrawingMode();
      document.getElementById('stopDrawing').classList.add('hidden');
      document.getElementById('startDrawing').classList.remove('hidden');
    });

    document.getElementById('togglePolygon')?.addEventListener('click', () => {
      BimViewer.drawing.visible = !BimViewer.drawing.visible;
      if (BimViewer.drawing.polygon) {
        BimViewer.drawing.polygon.show = BimViewer.drawing.visible;
      }
    });

    document.getElementById('clearPolygon')?.addEventListener('click', () => {
      BimViewer.clearClipping();
      if (BimViewer.drawing.polygon) {
        BimViewer.viewer.entities.remove(BimViewer.drawing.polygon);
        BimViewer.drawing.polygon = null;
      }
      BimViewer.drawing.positions = [];
      BimViewer.updateStatus('Polygon cleared', 'success');
    });

    document.getElementById('toggleClipMode')?.addEventListener('click', () => {
      BimViewer.drawing.clipBoth = !BimViewer.drawing.clipBoth;
      BimViewer.updateClippingModeUI();
      if (BimViewer.drawing.positions.length > 2) {
        BimViewer.applyClipping();
      }
    });
  }

  window.GEOBIM_DRAWING_UI = {
    getContent: getContent,
    initHandlers: initHandlers
  };
})();
