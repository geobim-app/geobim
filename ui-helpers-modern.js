// ===============================
// CESIUM BIM VIEWER - MODERN UI HELPERS v4.0 (AREA ANNOTATIONS)
// Helper functions to update lists in modern style
// ===============================
'use strict';

// Add to BimViewer object - override existing list update functions

// ===============================
// COMMENTS LIST UPDATE (Modern Style with Area Support)
// ===============================
BimViewer.updateCommentsList = function() {
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
    const typeClass = comment.type === 'area' ? 'type-area' : 'type-point';
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
    const typeEmoji = comment.type === 'area' ? '📐' : '💬';
    const typeLabel = comment.type === 'area' ? 'Area' : 'Point';
    
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
  if (!badge) return;
  
  const count = this.comments && this.comments.comments ? this.comments.comments.length : 0;
  
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
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
// FLY TO COMMENT (Enhanced for Area Annotations)
// ===============================
BimViewer.flyToComment = function(commentId) {
  const entity = this.viewer.entities.getById(commentId);
  if (!entity) {
    console.warn('Comment entity not found:', commentId);
    return;
  }
  
  const comment = this.comments.comments.find(c => c.id === commentId);
  
  if (comment && comment.type === 'area') {
    // For area annotations, fly to the center of the polygon
    const positions = comment.areaPoints.map(point => 
      Cesium.Cartesian3.fromDegrees(point.lon, point.lat, point.height)
    );
    
    const boundingSphere = Cesium.BoundingSphere.fromPoints(positions);
    const center = boundingSphere.center;
    
    // Calculate appropriate distance based on bounding sphere radius
    const distance = boundingSphere.radius * 3;
    
    this.viewer.camera.flyToBoundingSphere(boundingSphere, {
      duration: 2.0,
      offset: new Cesium.HeadingPitchRange(0, -0.5, distance)
    });
    
    // Select the entity
    setTimeout(() => {
      this.viewer.selectedEntity = entity;
      this.updateStatus('Viewing area annotation', 'success');
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
// INITIALIZE IFC FILTER UI ON LOAD
// ===============================
(function() {
  // Wait for viewer to be ready
  const checkViewer = setInterval(() => {
    if (typeof BimViewer !== 'undefined' && BimViewer.viewer && document.getElementById('ifcFiltersList')) {
      clearInterval(checkViewer);
      
      // Initialize IFC filter UI
      if (typeof BimViewer.updateIFCFilterUI === 'function') {
        BimViewer.updateIFCFilterUI();
        console.log('✅ IFC Filter UI initialized');
      }
    }
  }, 200);
})();

console.log('✅ Modern UI Helpers loaded (v4.1 - Area Annotations with RIGHT-CLICK)');
