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

// ===============================
// CESIUM BIM VIEWER - MODERN UI HELPERS v4.0 (AREA ANNOTATIONS)
// Helper functions to update lists in modern style
// ===============================
'use strict';

// Add to BimViewer object - override existing list update functions

// ===============================
// FLOATING COMMENTS PANEL
// ===============================
BimViewer.createCommentsPanel = function() {
  if (document.getElementById('floatingCommentsPanel')) return;

  const panel = document.createElement('div');
  panel.id = 'floatingCommentsPanel';
  panel.innerHTML = `
    <div id="commentsPanelHeader" class="floating-panel-header">
      <span class="floating-panel-title">💬 Recent Annotations</span>
      <div class="floating-panel-controls">
        <button class="floating-panel-btn" onclick="BimViewer.toggleCommentsPanelCollapse()" title="Collapse">−</button>
        <button class="floating-panel-btn" onclick="BimViewer.toggleCommentsPanel()" title="Close">✕</button>
      </div>
    </div>
    <div id="commentsPanelBody" class="floating-panel-body">
      <div id="commentsList" class="floating-comments-list">
        <div class="modern-empty-state">Loading...</div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // Make draggable
  this.makeFloatingPanelDraggable(panel, panel.querySelector('#commentsPanelHeader'));
};

BimViewer.toggleCommentsPanel = function() {
  let panel = document.getElementById('floatingCommentsPanel');
  if (!panel) {
    this.createCommentsPanel();
    panel = document.getElementById('floatingCommentsPanel');
    this.updateCommentsList();
    panel.classList.add('visible');
  } else {
    panel.classList.toggle('visible');
  }
};

BimViewer.toggleCommentsPanelCollapse = function() {
  const body = document.getElementById('commentsPanelBody');
  const btn = document.querySelector('#floatingCommentsPanel .floating-panel-btn');
  if (!body) return;
  body.classList.toggle('collapsed');
  btn.textContent = body.classList.contains('collapsed') ? '+' : '−';
};

BimViewer.makeFloatingPanelDraggable = function(panel, handle) {
  let isDragging = false, startX, startY, startLeft, startTop;

  handle.addEventListener('mousedown', function(e) {
    if (e.target.tagName === 'BUTTON') return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = panel.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    panel.style.transition = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', function(e) {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    panel.style.left = (startLeft + dx) + 'px';
    panel.style.top = (startTop + dy) + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  });

  document.addEventListener('mouseup', function() {
    if (isDragging) {
      isDragging = false;
      panel.style.transition = '';
    }
  });
};

// ===============================
// INFOBOX FLOATING PANEL CONTROLS
// ===============================
BimViewer.closeInfoBox = function() {
  const panel = document.getElementById('infoBoxPanel');
  if (panel) panel.classList.remove('visible');
  const infoBox = document.getElementById('infoBoxCustom');
  if (infoBox) infoBox.innerHTML = '';
};

BimViewer.toggleInfoBoxCollapse = function() {
  const body = document.getElementById('infoBoxBody');
  const btn = document.getElementById('infoBoxCollapseBtn');
  if (!body) return;
  body.classList.toggle('collapsed');
  if (btn) btn.textContent = body.classList.contains('collapsed') ? '+' : '−';
};

// ===============================
// FLOATING LOADED ASSETS PANEL
// ===============================
BimViewer.createLoadedAssetsPanel = function() {
  if (document.getElementById('floatingAssetsPanel')) return;

  const panel = document.createElement('div');
  panel.id = 'floatingAssetsPanel';
  panel.innerHTML = `
    <div id="assetsPanelHeader" class="floating-panel-header">
      <span class="floating-panel-title">📦 Loaded Assets</span>
      <div class="floating-panel-controls">
        <button class="floating-panel-btn" onclick="BimViewer.toggleAssetsPanelCollapse()" title="Collapse">−</button>
        <button class="floating-panel-btn" onclick="BimViewer.toggleLoadedAssetsPanel()" title="Close">✕</button>
      </div>
    </div>
    <div id="assetsPanelBody" class="floating-panel-body">
      <div id="loadedAssetsList" class="floating-assets-list">
        <div class="modern-empty-state">No assets loaded yet</div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  this.makeFloatingPanelDraggable(panel, panel.querySelector('#assetsPanelHeader'));
};

BimViewer.toggleLoadedAssetsPanel = function() {
  this.createLoadedAssetsPanel();
  var panel = document.getElementById('floatingAssetsPanel');
  if (!panel) {
    console.error('Failed to create floatingAssetsPanel');
    return;
  }
  panel.classList.toggle('visible');
  this.updateLoadedAssetsCount();
};

BimViewer.toggleAssetsPanelCollapse = function() {
  const body = document.getElementById('assetsPanelBody');
  const btn = document.querySelector('#floatingAssetsPanel .floating-panel-btn');
  if (!body) return;
  body.classList.toggle('collapsed');
  btn.textContent = body.classList.contains('collapsed') ? '+' : '−';
};

BimViewer.updateLoadedAssetsCount = function() {
  const countEl = document.getElementById('loadedAssetsCount');
  const count = this.loadedAssets ? this.loadedAssets.size : 0;
  if (countEl) {
    countEl.textContent = count > 0 ? count + ' assets' : '0';
  }
};

// ===============================
// COMMENTS LIST UPDATE (Modern Style with Area Support)
// ===============================
BimViewer.updateCommentsList = function() {
  // Ensure floating panel exists
  if (!document.getElementById('floatingCommentsPanel')) {
    this.createCommentsPanel();
  }
  const container = document.getElementById('commentsList');
  if (!container) return;
  
  if (!this.comments || this.comments.comments.length === 0) {
    container.innerHTML = '<div class="modern-empty-state">No comments yet</div>';
    return;
  }
  
  let html = '';
  
  // Sort by timestamp (newest first)
  const sortedComments = [...this.comments.comments].sort((a, b) => 
    new Date(b.timestamp) - new Date(a.timestamp)
  );
  
  sortedComments.forEach(comment => {
    const priorityClass = comment.priority ? comment.priority.toLowerCase() : 'normal';
    const typeClasses = { 'point': 'type-point', 'circle': 'type-circle', 'polyline': 'type-polyline', 'rectangle': 'type-rectangle', 'area': 'type-area' };
    const typeClass = typeClasses[comment.type] || 'type-point';
    const timeLabel = comment.isUpdated ? 'Updated' : 'Created';
    const timestamp = new Date(comment.timestamp);
    const timeStr = timestamp.toLocaleString('de-DE', { 
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    // Truncate text for preview
    const truncatedText = comment.text.length > 60 
      ? comment.text.substring(0, 60) + '...' 
      : comment.text;
    
    // Type emoji and label
    const typeEmojis = { 'point': '📍', 'circle': '⭕', 'polyline': '〰️', 'rectangle': '▭', 'area': '⬡' };
    const typeLabelsMap = { 'point': 'Point', 'circle': 'Circle', 'polyline': 'Polyline', 'rectangle': 'Rectangle', 'area': 'Area' };
    const typeEmoji = typeEmojis[comment.type] || '📍';
    const typeLabel = typeLabelsMap[comment.type] || 'Point';
    
    html += `
      <div class="modern-comment-item priority-${priorityClass} ${typeClass}" onclick="BimViewer.flyToComment('${comment.id}')">
        <div class="modern-comment-header">
          <div class="modern-comment-title">${typeEmoji} ${comment.title}</div>
          <div class="modern-comment-controls">
            <button class="modern-comment-btn edit-btn" 
                    onclick="event.stopPropagation(); BimViewer.editComment('${comment.id}')" 
                    title="Edit">
              ✏️
            </button>
            <button class="modern-comment-btn delete-btn" 
                    onclick="event.stopPropagation(); BimViewer.deleteComment('${comment.id}')" 
                    title="Delete">
              🗑️
            </button>
          </div>
        </div>
        <div class="modern-comment-text">${truncatedText}</div>
        <div class="modern-comment-meta">
          <span class="modern-comment-type">${typeLabel}</span>
          <span class="modern-comment-category">${comment.category || 'General'}</span>
          <span class="modern-comment-priority ${priorityClass}">${comment.priority || 'Normal'}</span>
          ${comment.author ? '<span>' + comment.author + '</span>' : ''}
          <span>${timeStr}</span>
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
};

// ===============================
// COMMENTS COUNT UPDATE
// ===============================
BimViewer.updateCommentsCount = function() {
  const badge = document.getElementById('commentsCount');
  const count = this.comments && this.comments.comments ? this.comments.comments.length : 0;

  if (badge) {
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  }

  // Update status in sidebar button
  const statusEl = document.getElementById('commentsListStatus');
  if (statusEl) {
    statusEl.textContent = count > 0 ? count + ' comments' : 'Ready';
  }
};

// ===============================
// HIDDEN FEATURES LIST UPDATE (Modern Style)
// ===============================
BimViewer.updateHiddenFeaturesList = function() {
  const container = document.getElementById('hiddenFeaturesList');
  if (!container) return;
  
  if (this.hiddenFeatures.features.size === 0) {
    container.innerHTML = '<div class="modern-empty-state">No hidden elements</div>';
    return;
  }
  
  let html = '';
  
  this.hiddenFeatures.features.forEach((hiddenData, featureId) => {
    const timeStr = hiddenData.timestamp.toLocaleTimeString('de-DE', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
    
    html += `
      <div class="modern-hidden-item">
        <div class="modern-hidden-header">
          <div class="modern-hidden-name">🚫 ${hiddenData.elementType}</div>
          <button class="modern-icon-btn" 
                  onclick="BimViewer.showHiddenFeature(${featureId})" 
                  title="Show element">
            👁️
          </button>
        </div>
        <div class="modern-hidden-time">Hidden at ${timeStr}</div>
      </div>
    `;
  });
  
  container.innerHTML = html;
};

// ===============================
// SAVED VIEWS LIST UPDATE (Modern Style)
// ===============================
BimViewer.updateSavedViewsList = function() {
  const container = document.getElementById('savedViewsList');
  if (!container) return;
  
  if (this.savedViews.size === 0) {
    container.innerHTML = '<div class="modern-empty-state">No saved views</div>';
    return;
  }
  
  let html = '';
  const sortedViews = Array.from(this.savedViews.entries()).sort((a, b) => a[0] - b[0]);
  
  sortedViews.forEach(([slot, viewState]) => {
    const timeStr = viewState.timestamp.toLocaleTimeString('de-DE', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    const cartographic = Cesium.Cartographic.fromCartesian(viewState.position);
    const height = Math.round(cartographic.height);
    
    html += `
      <div class="modern-view-item">
        <div class="modern-view-header">
          <div class="modern-view-name">📷 View ${slot}</div>
          <div class="modern-view-controls">
            <button class="modern-icon-btn" 
                    onclick="BimViewer.loadView(${slot})" 
                    title="Load View (press ${slot})">
              👁️
            </button>
            <button class="modern-icon-btn modern-icon-btn-danger" 
                    onclick="BimViewer.deleteView(${slot})" 
                    title="Delete View">
              🗑️
            </button>
          </div>
        </div>
        <div class="modern-view-details">${timeStr} • ${height}m height</div>
      </div>
    `;
  });
  
  container.innerHTML = html;
};

// ===============================
// IFC FILTER LIST UPDATE (Modern Style)
// ===============================
BimViewer.updateIFCFilterUI = function() {
  const container = document.getElementById('ifcFiltersList');
  if (!container) return;
  
  // Group IFC entities by category
  const categories = {
    structure: { title: '🏗️ Structure', entities: [] },
    interior: { title: '🚪 Interior', entities: [] },
    mep: { title: '⚡ MEP', entities: [] },
    building: { title: '🏢 Building', entities: [] },
    other: { title: '📦 Other', entities: [] }
  };
  
  IFC_ENTITIES.forEach(entity => {
    const category = entity.category || 'other';
    if (categories[category]) {
      categories[category].entities.push(entity);
    }
  });
  
  let html = '';
  
  Object.entries(categories).forEach(([key, category]) => {
    if (category.entities.length === 0) return;
    
    html += `<div class="modern-ifc-category">`;
    html += `<div class="modern-ifc-category-title">${category.title}</div>`;
    
    category.entities.forEach(entity => {
      const isChecked = this.ifcFilter.enabledEntities.has(entity.entity);
      
      html += `
        <label class="modern-ifc-item">
          <input type="checkbox" 
                 class="modern-ifc-checkbox" 
                 data-entity="${entity.entity}"
                 ${isChecked ? 'checked' : ''}
                 onchange="BimViewer.toggleIFCEntity('${entity.entity}')">
          <div class="modern-ifc-color" style="background: ${entity.color};"></div>
          <span class="modern-ifc-name">${entity.displayName}</span>
        </label>
      `;
    });
    
    html += `</div>`;
  });
  
  container.innerHTML = html;
};

// ===============================
// TOGGLE IFC ENTITY
// ===============================
BimViewer.toggleIFCEntity = function(entityName) {
  if (this.ifcFilter.enabledEntities.has(entityName)) {
    this.ifcFilter.enabledEntities.delete(entityName);
  } else {
    this.ifcFilter.enabledEntities.add(entityName);
  }

  if (typeof this.applyIFCFilter === 'function') {
    this.applyIFCFilter();
  }
};

// ===============================
// SELECT/DESELECT ALL IFC
// ===============================
BimViewer.selectAllIFCTypes = function() {
  IFC_ENTITIES.forEach(entity => {
    this.ifcFilter.enabledEntities.add(entity.entity);
  });

  this.updateIFCFilterUI();

  if (typeof this.applyIFCFilter === 'function') {
    this.applyIFCFilter();
  }

  this.updateStatus('All IFC types selected', 'success');
};

BimViewer.deselectAllIFCTypes = function() {
  this.ifcFilter.enabledEntities.clear();

  this.updateIFCFilterUI();

  if (typeof this.applyIFCFilter === 'function') {
    this.applyIFCFilter();
  }

  this.updateStatus('All IFC types deselected', 'success');
};

// ===============================
// REVIT FILTER LIST UPDATE (Modern Style)
// ===============================
BimViewer.updateRevitFilterUI = function() {
  const container = document.getElementById('revitFiltersList');
  if (!container) return;

  // Check if REVIT_CATEGORIES and revitFilter are available
  if (typeof REVIT_CATEGORIES === 'undefined') {
    console.warn('⚠️ REVIT_CATEGORIES not available yet');
    return;
  }

  if (!this.revitFilter || !this.revitFilter.enabledCategories) {
    console.warn('⚠️ revitFilter not initialized yet');
    return;
  }

  // Group Revit categories by group
  const groups = {
    structure: { title: '🏗️ Structure', categories: [] },
    interior: { title: '🚪 Interior', categories: [] },
    mep: { title: '⚡ MEP', categories: [] },
    other: { title: '📦 Other', categories: [] }
  };

  REVIT_CATEGORIES.forEach(cat => {
    const group = cat.group || 'other';
    if (groups[group]) {
      groups[group].categories.push(cat);
    }
  });

  let html = '';

  Object.entries(groups).forEach(([key, group]) => {
    if (group.categories.length === 0) return;

    html += `<div class="modern-ifc-category">`;
    html += `<div class="modern-ifc-category-title">${group.title}</div>`;

    group.categories.forEach(cat => {
      const isChecked = this.revitFilter.enabledCategories.has(cat.category);

      html += `
        <label class="modern-ifc-item">
          <input type="checkbox"
                 class="modern-ifc-checkbox"
                 data-category="${cat.category}"
                 ${isChecked ? 'checked' : ''}
                 onchange="BimViewer.toggleRevitCategory('${cat.category}')">
          <div class="modern-ifc-color" style="background: ${cat.color};"></div>
          <span class="modern-ifc-name">${cat.displayName}</span>
        </label>
      `;
    });

    html += `</div>`;
  });

  container.innerHTML = html;
};

// ===============================
// FLY TO COMMENT (Enhanced for Area Annotations)
// ===============================
BimViewer.flyToComment = function(commentId) {
  const entity = this.viewer.entities.getById(commentId);
  if (!entity) {
    console.warn('Comment entity not found:', commentId);
    return;
  }
  
  const comment = this.comments.comments.find(c => c.id === commentId);
  
  if (comment && comment.type === 'rectangle') {
    // For rectangle annotations, fly to the center of the 2 corners
    const c1 = comment.corner1;
    const c2 = comment.corner2;
    const centerLon = (c1.lon + c2.lon) / 2;
    const centerLat = (c1.lat + c2.lat) / 2;
    const centerHeight = (c1.height + c2.height) / 2;
    const center = Cesium.Cartesian3.fromDegrees(centerLon, centerLat, centerHeight);

    // Estimate size from corner distance
    const p1 = Cesium.Cartesian3.fromDegrees(c1.lon, c1.lat, c1.height);
    const p2 = Cesium.Cartesian3.fromDegrees(c2.lon, c2.lat, c2.height);
    const diagonal = Cesium.Cartesian3.distance(p1, p2);
    const distance = diagonal * 2;

    this.viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(center, diagonal / 2), {
      duration: 2.0,
      offset: new Cesium.HeadingPitchRange(0, -0.5, distance)
    });

    setTimeout(() => {
      this.viewer.selectedEntity = entity;
      this.updateStatus('Viewing rectangle annotation', 'success');
    }, 2100);

  } else if (comment && (comment.type === 'area' || comment.type === 'polyline')) {
    // For area/polyline annotations, fly to the center of the points
    const positions = comment.areaPoints.map(point =>
      Cesium.Cartesian3.fromDegrees(point.lon, point.lat, point.height)
    );

    const boundingSphere = Cesium.BoundingSphere.fromPoints(positions);

    // Calculate appropriate distance based on bounding sphere radius
    const distance = boundingSphere.radius * 3;

    this.viewer.camera.flyToBoundingSphere(boundingSphere, {
      duration: 2.0,
      offset: new Cesium.HeadingPitchRange(0, -0.5, distance)
    });

    // Select the entity
    setTimeout(() => {
      this.viewer.selectedEntity = entity;
      this.updateStatus('Viewing ' + comment.type + ' annotation', 'success');
    }, 2100);

  } else if (comment && comment.type === 'circle') {
    const center = Cesium.Cartesian3.fromDegrees(comment.centerLon, comment.centerLat, comment.centerHeight);
    const distance = comment.radius * 3;

    this.viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(center, comment.radius), {
      duration: 2.0,
      offset: new Cesium.HeadingPitchRange(0, -0.5, distance)
    });

    setTimeout(() => {
      this.viewer.selectedEntity = entity;
      this.updateStatus('Viewing circle annotation', 'success');
    }, 2100);

  } else {
    // For point comments, fly to the point
    this.viewer.flyTo(entity, {
      duration: 2.0,
      offset: new Cesium.HeadingPitchRange(0, -0.5, 50)
    }).then(() => {
      // Select the comment to show info
      this.viewer.selectedEntity = entity;
      this.updateStatus('Viewing comment', 'success');
    });
  }
};

// ===============================
// INITIALIZE FILTER UIs ON LOAD
// ===============================
(function() {
  let ifcInitialized = false;
  let revitInitialized = false;

  // Wait for viewer and UI to be ready
  const checkViewer = setInterval(() => {
    const viewerReady = typeof BimViewer !== 'undefined' && BimViewer.viewer;

    // Initialize IFC filter UI
    if (!ifcInitialized && viewerReady) {
      const ifcContainer = document.getElementById('ifcFiltersList');
      if (ifcContainer && typeof BimViewer.updateIFCFilterUI === 'function') {
        BimViewer.updateIFCFilterUI();
        ifcInitialized = true;
        console.log('✅ IFC Filter UI initialized');
      }
    }

    // Initialize Revit filter UI
    if (!revitInitialized && viewerReady && typeof REVIT_CATEGORIES !== 'undefined') {
      const revitContainer = document.getElementById('revitFiltersList');
      const revitFilterReady = BimViewer.revitFilter && BimViewer.revitFilter.enabledCategories;
      if (revitContainer && revitFilterReady && typeof BimViewer.updateRevitFilterUI === 'function') {
        BimViewer.updateRevitFilterUI();
        revitInitialized = true;
        console.log('✅ Revit Filter UI initialized');
      }
    }

    // Stop checking once both are initialized
    if (ifcInitialized && revitInitialized) {
      clearInterval(checkViewer);
    }
  }, 200);
})();

console.log('✅ Modern UI Helpers loaded (v4.1 - Area Annotations with RIGHT-CLICK)');
