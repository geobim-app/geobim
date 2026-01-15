// ===============================
// CESIUM BIM VIEWER - ENHANCED CLIPPING MODULE v4.2
// Polygon-based clipping for Google 3D Tiles, OSM Buildings, and Terrain
// RIGHT-CLICK to add points, DOUBLE RIGHT-CLICK or ENTER to finish (LEFT-CLICK stays free!)
// v4.2: Fixed polygon plane (perPositionHeight) + visualization toggle
// ===============================
'use strict';

(function() {
  
  console.log('✂️ Loading Enhanced Clipping Module v4.2 (Polygon Plane Fix)...');
  
  // ===============================
  // STATE MANAGEMENT
  // ===============================
  BimViewer.clipping = {
    polygons: [], // Array of polygon objects
    isDrawing: false,
    currentPoints: [],
    drawHandler: null,
    entities: [], // Visual entities for polygons
    enabled: true,
    inverse: false,
    terrainOnly: false, // If true, only clip terrain, not buildings
    lastRightClickTime: 0, // For double-click detection
    visualizationVisible: true, // Toggle for showing/hiding polygon visualization
    
    // ClippingPlaneCollections for different targets
    collections: {
      google3DTiles: null,
      osmBuildings: null,
      terrain: null
    }
  };
  
  // ===============================
  // POLYGON DRAWING
  // ===============================
  
  BimViewer.startClippingDraw = function() {
    if (this.clipping.isDrawing) {
      console.log('⚠️ Already drawing a clipping polygon');
      return;
    }
    
    this.clipping.isDrawing = true;
    this.clipping.currentPoints = [];
    this.clipping.lastRightClickTime = 0; // For double-click detection
    
    // Update UI
    const btn = document.getElementById('startClippingDraw');
    if (btn) {
      btn.classList.add('active');
      btn.querySelector('span:last-child').textContent = 'Drawing...';
    }
    
    const indicator = document.getElementById('modeIndicator');
    if (indicator) {
      indicator.classList.add('active');
      indicator.textContent = '✏️ CLIPPING MODE - RIGHT-CLICK to add points, DOUBLE RIGHT-CLICK or ENTER to finish (min 3 points)';
    }
    
    this.updateStatus('Clipping polygon mode active - RIGHT-CLICK to add points', 'loading');
    console.log('✂️ Started clipping polygon drawing');
    
    // Create event handler
    this.clipping.drawHandler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    
    // RIGHT CLICK - Add point OR finish with double-click
    this.clipping.drawHandler.setInputAction((click) => {
      const currentTime = Date.now();
      const timeSinceLastClick = currentTime - this.clipping.lastRightClickTime;
      
      // Double RIGHT-CLICK detection (within 500ms)
      if (timeSinceLastClick < 500 && this.clipping.currentPoints.length >= 3) {
        console.log('🖱️ Double RIGHT-CLICK detected - finishing polygon');
        this.finishClippingPolygon();
        return;
      }
      
      this.clipping.lastRightClickTime = currentTime;
      
      const cartesian = this.viewer.scene.pickPosition(click.position);
      
      if (!cartesian) {
        // Try to get position from globe
        const ray = this.viewer.camera.getPickRay(click.position);
        const globe_cartesian = this.viewer.scene.globe.pick(ray, this.viewer.scene);
        if (globe_cartesian) {
          this.addClippingPoint(globe_cartesian);
        } else {
          this.updateStatus('Cannot add point - RIGHT-CLICK on the model or terrain', 'warning');
        }
      } else {
        this.addClippingPoint(cartesian);
      }
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  };
  
  BimViewer.addClippingPoint = function(cartesian) {
    this.clipping.currentPoints.push(cartesian);
    
    // Add visual marker
    this.viewer.entities.add({
      position: cartesian,
      point: {
        pixelSize: 10,
        color: Cesium.Color.CYAN,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      },
      label: {
        text: String(this.clipping.currentPoints.length),
        font: '14px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -15)
      }
    });
    
    // Draw line between points
    if (this.clipping.currentPoints.length > 1) {
      this.viewer.entities.add({
        polyline: {
          positions: [...this.clipping.currentPoints],
          width: 3,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.CYAN,
            dashLength: 16
          }),
          clampToGround: true
        }
      });
    }
    
    this.updateStatus(`Added point ${this.clipping.currentPoints.length} - ${this.clipping.currentPoints.length >= 3 ? 'Press ENTER or DOUBLE RIGHT-CLICK to finish' : 'RIGHT-CLICK to add more points'}`, 'loading');
    console.log(`✂️ Added clipping point ${this.clipping.currentPoints.length}`);
  };
  
  BimViewer.finishClippingPolygon = function() {
    if (this.clipping.currentPoints.length < 3) {
      this.updateStatus('Need at least 3 points for clipping polygon', 'error');
      return;
    }
    
    console.log(`✂️ Finishing clipping polygon with ${this.clipping.currentPoints.length} points`);
    
    // Store polygon
    const polygon = {
      id: Date.now(),
      points: [...this.clipping.currentPoints],
      timestamp: new Date()
    };
    
    this.clipping.polygons.push(polygon);
    
    // Create visual polygon entity
    const polygonEntity = this.viewer.entities.add({
      id: `clipping_polygon_${polygon.id}`, // ID for easy reference
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(polygon.points),
        material: Cesium.Color.CYAN.withAlpha(0.3),
        outline: true,
        outlineColor: Cesium.Color.CYAN,
        outlineWidth: 3,
        perPositionHeight: true, // Follow the points exactly (terrain-fitted)
        classificationType: Cesium.ClassificationType.BOTH
      }
    });
    
    this.clipping.entities.push(polygonEntity);
    
    // Apply clipping
    this.applyClipping();
    
    // Stop drawing mode
    this.stopClippingDraw();
    
    // Update UI
    this.updateClippingPolygonList();
    this.updateClippingPolygonCount();
    
    this.updateStatus(`Clipping polygon created with ${polygon.points.length} points`, 'success');
  };
  
  BimViewer.stopClippingDraw = function() {
    if (!this.clipping.isDrawing) return;
    
    this.clipping.isDrawing = false;
    this.clipping.currentPoints = [];
    
    // Clean up handler
    if (this.clipping.drawHandler) {
      this.clipping.drawHandler.destroy();
      this.clipping.drawHandler = null;
    }
    
    // Update UI
    const btn = document.getElementById('startClippingDraw');
    if (btn) {
      btn.classList.remove('active');
      btn.querySelector('span:last-child').textContent = 'Draw Polygon';
    }
    
    const indicator = document.getElementById('modeIndicator');
    if (indicator) {
      indicator.classList.remove('active');
    }
    
    this.updateStatus('Clipping polygon drawing stopped', 'success');
    console.log('✂️ Stopped clipping polygon drawing');
  };
  
  // ===============================
  // CLIPPING POLYGON GENERATION (Cesium ClippingPolygon API)
  // ===============================
  
  // Helper: Check if polygon is counter-clockwise (CCW) using signed area
  BimViewer.isCounterClockwise = function(points) {
    if (points.length < 3) return true;
    
    // Calculate signed area in Cartographic coordinates
    let signedArea = 0;
    
    for (let i = 0; i < points.length; i++) {
      const p1 = Cesium.Cartographic.fromCartesian(points[i]);
      const p2 = Cesium.Cartographic.fromCartesian(points[(i + 1) % points.length]);
      
      // Shoelace formula
      signedArea += (p2.longitude - p1.longitude) * (p2.latitude + p1.latitude);
    }
    
    const isCCW = signedArea < 0; // Negative area = CCW in geographic coordinates
    console.log(`📐 Polygon signed area: ${signedArea.toFixed(6)} → ${isCCW ? 'CCW' : 'CW'}`);
    
    return isCCW;
  };
  
  BimViewer.createClippingPolygonCollection = function() {
    if (this.clipping.polygons.length === 0) {
      console.log('⚠️ No polygons to create clipping collection from');
      return null;
    }
    
    const clippingPolygons = [];
    
    // Convert each polygon to Cesium.ClippingPolygon
    this.clipping.polygons.forEach(polygon => {
      let points = polygon.points;
      
      // Check and fix orientation
      const isCCW = this.isCounterClockwise(points);
      
      // For ClippingPolygon, we want CCW for normal clipping (clip INSIDE)
      // If polygon is CW, reverse it to make it CCW
      if (!isCCW) {
        console.log('🔄 Reversing polygon to CCW (for clipping INSIDE)');
        points = [...points].reverse();
      } else {
        console.log('✅ Polygon already CCW (correct orientation)');
      }
      
      const clippingPolygon = new Cesium.ClippingPolygon({
        positions: points
      });
      clippingPolygons.push(clippingPolygon);
    });
    
    console.log(`✂️ Created ${clippingPolygons.length} ClippingPolygon(s)`);
    
    // Create ClippingPolygonCollection
    const collection = new Cesium.ClippingPolygonCollection({
      polygons: clippingPolygons,
      enabled: this.clipping.enabled,
      inverse: this.clipping.inverse
    });
    
    return collection;
  };
  
  // ===============================
  // APPLY CLIPPING
  // ===============================
  
  BimViewer.applyClipping = function() {
    console.log('✂️ Applying clipping to all targets...');
    
    const collection = this.createClippingPolygonCollection();
    
    if (!collection) {
      console.log('⚠️ No clipping collection to apply');
      return;
    }
    
    // Apply to Google 3D Tiles
    if (this.googleTiles.tileset && this.googleTiles.enabled) {
      if (!this.clipping.terrainOnly) {
        console.log('✂️ Applying clipping to Google 3D Tiles');
        this.googleTiles.tileset.clippingPolygons = collection;
        this.clipping.collections.google3DTiles = collection;
      } else if (this.googleTiles.tileset.clippingPolygons) {
        // Terrain-only mode: disable existing clipping
        this.googleTiles.tileset.clippingPolygons.enabled = false;
      }
    }
    
    // Apply to OSM Buildings
    if (this.osmBuildings.tileset && this.osmBuildings.enabled) {
      if (!this.clipping.terrainOnly) {
        console.log('✂️ Applying clipping to OSM Buildings');
        
        // OSM Buildings need their own collection
        const osmCollection = this.createClippingPolygonCollection();
        this.osmBuildings.tileset.clippingPolygons = osmCollection;
        this.clipping.collections.osmBuildings = osmCollection;
      } else if (this.osmBuildings.tileset.clippingPolygons) {
        // Terrain-only mode: disable existing clipping
        this.osmBuildings.tileset.clippingPolygons.enabled = false;
      }
    }
    
    // Apply to terrain (globe)
    if (this.viewer.scene.globe) {
      console.log('✂️ Applying clipping to Terrain');
      
      // Terrain needs its own collection
      const terrainCollection = this.createClippingPolygonCollection();
      this.viewer.scene.globe.clippingPolygons = terrainCollection;
      this.clipping.collections.terrain = terrainCollection;
    }
    
    this.updateStatus(`Clipping applied to ${this.getActiveTargetCount()} target(s)`, 'success');
  };
  
  BimViewer.getActiveTargetCount = function() {
    let count = 0;
    
    if (this.googleTiles.tileset && this.googleTiles.enabled && !this.clipping.terrainOnly) count++;
    if (this.osmBuildings.tileset && this.osmBuildings.enabled && !this.clipping.terrainOnly) count++;
    if (this.viewer.scene.globe) count++;
    
    return count;
  };
  
  // ===============================
  // TOGGLE FUNCTIONS
  // ===============================
  
  BimViewer.toggleClippingEnabled = function() {
    this.clipping.enabled = !this.clipping.enabled;
    
    const btn = document.getElementById('toggleClippingEnabled');
    const icon = btn?.querySelector('.modern-btn-icon');
    const text = btn?.querySelector('span:last-child');
    
    if (this.clipping.enabled) {
      btn?.classList.add('active');
      if (icon) icon.textContent = '✅';
      if (text) text.textContent = 'Enabled';
      
      // Re-apply clipping
      this.applyClipping();
      this.updateStatus('Clipping enabled', 'success');
    } else {
      btn?.classList.remove('active');
      if (icon) icon.textContent = '❌';
      if (text) text.textContent = 'Disabled';
      
      // Disable clipping on all targets
      this.disableAllClipping();
      this.updateStatus('Clipping disabled', 'success');
    }
    
    console.log(`✂️ Clipping ${this.clipping.enabled ? 'enabled' : 'disabled'}`);
  };
  
  BimViewer.toggleClippingVisualization = function() {
    this.clipping.visualizationVisible = !this.clipping.visualizationVisible;
    
    const btn = document.getElementById('toggleClippingVisualization');
    const icon = btn?.querySelector('.modern-btn-icon');
    const text = btn?.querySelector('span:last-child');
    
    // Toggle visibility of all polygon entities
    this.clipping.entities.forEach(entity => {
      entity.show = this.clipping.visualizationVisible;
    });
    
    if (this.clipping.visualizationVisible) {
      btn?.classList.add('active');
      if (icon) icon.textContent = '👁️';
      if (text) text.textContent = 'Show Fill';
      this.updateStatus('Clipping visualization shown', 'success');
    } else {
      btn?.classList.remove('active');
      if (icon) icon.textContent = '👁️‍🗨️';
      if (text) text.textContent = 'Hide Fill';
      this.updateStatus('Clipping visualization hidden (clipping still active)', 'success');
    }
    
    console.log(`👁️ Clipping visualization ${this.clipping.visualizationVisible ? 'visible' : 'hidden'}`);
  };
  
  BimViewer.toggleInverseClipping = function() {
    this.clipping.inverse = !this.clipping.inverse;
    
    const btn = document.getElementById('toggleInverseClipping');
    const icon = btn?.querySelector('.modern-btn-icon');
    const text = btn?.querySelector('span:last-child');
    
    if (this.clipping.inverse) {
      btn?.classList.add('active');
      if (icon) icon.textContent = '↩️';
      if (text) text.textContent = 'Inverse';
      
      // Set inverse on all collections
      Object.values(this.clipping.collections).forEach(collection => {
        if (collection) {
          collection.inverse = true;
        }
      });
      
      this.updateStatus('Inverse clipping enabled - showing only clipped area', 'success');
    } else {
      btn?.classList.remove('active');
      if (icon) icon.textContent = '➡️';
      if (text) text.textContent = 'Normal';
      
      // Set inverse to false on all collections
      Object.values(this.clipping.collections).forEach(collection => {
        if (collection) {
          collection.inverse = false;
        }
      });
      
      this.updateStatus('Normal clipping enabled - hiding clipped area', 'success');
    }
    
    console.log(`✂️ Inverse clipping ${this.clipping.inverse ? 'enabled' : 'disabled'}`);
  };
  
  BimViewer.toggleTerrainClipping = function() {
    this.clipping.terrainOnly = !this.clipping.terrainOnly;
    
    const btn = document.getElementById('toggleTerrainClipping');
    const icon = btn?.querySelector('.modern-btn-icon');
    const text = btn?.querySelector('span:last-child');
    
    if (this.clipping.terrainOnly) {
      btn?.classList.add('active');
      if (icon) icon.textContent = '🏔️';
      if (text) text.textContent = 'Terrain Only';
      
      // Disable clipping on buildings (don't set to undefined, causes Cesium error!)
      if (this.googleTiles.tileset && this.googleTiles.tileset.clippingPolygons) {
        this.googleTiles.tileset.clippingPolygons.enabled = false;
      }
      if (this.osmBuildings.tileset && this.osmBuildings.tileset.clippingPolygons) {
        this.osmBuildings.tileset.clippingPolygons.enabled = false;
      }
      
      this.updateStatus('Clipping terrain only - buildings not affected', 'success');
    } else {
      btn?.classList.remove('active');
      if (icon) icon.textContent = '🏙️';
      if (text) text.textContent = 'Buildings Only';
      
      // Re-enable clipping on buildings
      if (this.googleTiles.tileset && this.googleTiles.tileset.clippingPolygons) {
        this.googleTiles.tileset.clippingPolygons.enabled = true;
      }
      if (this.osmBuildings.tileset && this.osmBuildings.tileset.clippingPolygons) {
        this.osmBuildings.tileset.clippingPolygons.enabled = true;
      }
      
      this.updateStatus('Clipping all elements', 'success');
    }
    
    console.log(`✂️ Terrain-only clipping ${this.clipping.terrainOnly ? 'enabled' : 'disabled'}`);
  };
  
  BimViewer.disableAllClipping = function() {
    // Disable clipping on all targets (safer than setting to undefined!)
    if (this.googleTiles.tileset && this.googleTiles.tileset.clippingPolygons) {
      this.googleTiles.tileset.clippingPolygons.enabled = false;
    }
    
    if (this.osmBuildings.tileset && this.osmBuildings.tileset.clippingPolygons) {
      this.osmBuildings.tileset.clippingPolygons.enabled = false;
    }
    
    if (this.viewer.scene.globe && this.viewer.scene.globe.clippingPolygons) {
      this.viewer.scene.globe.clippingPolygons.enabled = false;
    }
    
    // Clear collections references
    this.clipping.collections.google3DTiles = null;
    this.clipping.collections.osmBuildings = null;
    this.clipping.collections.terrain = null;
    
    console.log('✂️ Clipping disabled on all targets');
  };
  
  // ===============================
  // POLYGON MANAGEMENT
  // ===============================
  
  BimViewer.flipLastPolygonOrientation = function() {
    if (this.clipping.polygons.length === 0) {
      this.updateStatus('No polygons to flip', 'warning');
      return;
    }
    
    // Flip the last polygon's orientation
    const lastPolygon = this.clipping.polygons[this.clipping.polygons.length - 1];
    lastPolygon.points = [...lastPolygon.points].reverse();
    
    console.log('🔄 Flipped last polygon orientation');
    
    // Re-apply clipping with flipped polygon
    this.applyClipping();
    
    this.updateStatus('Polygon orientation flipped - check if clipping improved', 'success');
  };
  
  BimViewer.removeLastClippingPolygon = function() {
    if (this.clipping.polygons.length === 0) {
      this.updateStatus('No clipping polygons to remove', 'warning');
      return;
    }
    
    // Remove last polygon
    this.clipping.polygons.pop();
    
    // Remove last entity
    const lastEntity = this.clipping.entities.pop();
    if (lastEntity) {
      this.viewer.entities.remove(lastEntity);
    }
    
    // Re-apply clipping (or clear if no polygons left)
    if (this.clipping.polygons.length > 0) {
      this.applyClipping();
    } else {
      this.disableAllClipping();
    }
    
    // Update UI
    this.updateClippingPolygonList();
    this.updateClippingPolygonCount();
    
    this.updateStatus('Last clipping polygon removed', 'success');
    console.log('✂️ Removed last clipping polygon');
  };
  
  BimViewer.removeClippingPolygon = function(polygonId) {
    const index = this.clipping.polygons.findIndex(p => p.id === polygonId);
    
    if (index === -1) {
      console.warn('⚠️ Polygon not found:', polygonId);
      return;
    }
    
    // Remove polygon
    this.clipping.polygons.splice(index, 1);
    
    // Remove entity
    const entity = this.clipping.entities[index];
    if (entity) {
      this.viewer.entities.remove(entity);
      this.clipping.entities.splice(index, 1);
    }
    
    // Re-apply clipping
    if (this.clipping.polygons.length > 0) {
      this.applyClipping();
    } else {
      this.disableAllClipping();
    }
    
    // Update UI
    this.updateClippingPolygonList();
    this.updateClippingPolygonCount();
    
    this.updateStatus('Clipping polygon removed', 'success');
    console.log('✂️ Removed clipping polygon:', polygonId);
  };
  
  BimViewer.clearAllClipping = function() {
    console.log('✂️ Clearing all clipping polygons...');
    
    // Remove all entities
    this.clipping.entities.forEach(entity => {
      this.viewer.entities.remove(entity);
    });
    
    // Clear arrays
    this.clipping.polygons = [];
    this.clipping.entities = [];
    
    // Disable clipping
    this.disableAllClipping();
    
    // Update UI
    this.updateClippingPolygonList();
    this.updateClippingPolygonCount();
    
    this.updateStatus('All clipping polygons cleared', 'success');
    console.log('✂️ All clipping polygons cleared');
  };
  
  // ===============================
  // UI UPDATES
  // ===============================
  
  BimViewer.updateClippingPolygonList = function() {
    const container = document.getElementById('clippingPolygonList');
    if (!container) return;
    
    if (this.clipping.polygons.length === 0) {
      container.innerHTML = '<div class="modern-empty-state">No clipping polygons</div>';
      return;
    }
    
    let html = '';
    
    this.clipping.polygons.forEach((polygon, index) => {
      const timeStr = polygon.timestamp.toLocaleTimeString('de-DE', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
      
      html += `
        <div class="modern-clipping-item">
          <div class="modern-clipping-header">
            <div class="modern-clipping-name">✂️ Polygon ${index + 1}</div>
            <button class="modern-icon-btn modern-icon-btn-danger" 
                    onclick="BimViewer.removeClippingPolygon(${polygon.id})" 
                    title="Remove polygon">
              🗑️
            </button>
          </div>
          <div class="modern-clipping-details">
            ${polygon.points.length} points • ${timeStr}
          </div>
        </div>
      `;
    });
    
    container.innerHTML = html;
  };
  
  BimViewer.updateClippingPolygonCount = function() {
    const badge = document.getElementById('clippingPolygonCount');
    if (!badge) return;
    
    const count = this.clipping.polygons.length;
    
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  };
  
  // ===============================
  // KEYBOARD SHORTCUTS
  // ===============================
  
  document.addEventListener('keydown', (event) => {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
    
    const key = event.key.toLowerCase();
    
    // P = Toggle clipping draw mode
    if (key === 'p' && !event.shiftKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      
      if (BimViewer.clipping.isDrawing) {
        BimViewer.stopClippingDraw();
      } else {
        BimViewer.startClippingDraw();
      }
    }
    
    // ENTER = Finish polygon (when drawing)
    if ((key === 'enter' || event.key === 'Enter') && BimViewer.clipping.isDrawing) {
      event.preventDefault();
      event.stopPropagation();
      console.log('⌨️ ENTER pressed - finishing polygon');
      BimViewer.finishClippingPolygon();
    }
    
    // ESC = Cancel drawing
    if (key === 'escape' && BimViewer.clipping.isDrawing) {
      event.preventDefault();
      
      // Remove temporary points
      BimViewer.clipping.currentPoints = [];
      
      // Remove temporary visual elements
      const entitiesToRemove = [];
      BimViewer.viewer.entities.values.forEach(entity => {
        if (entity.point?.color?.equals(Cesium.Color.CYAN) || 
            entity.polyline?.material?.color?.equals(Cesium.Color.CYAN)) {
          entitiesToRemove.push(entity);
        }
      });
      entitiesToRemove.forEach(entity => BimViewer.viewer.entities.remove(entity));
      
      BimViewer.stopClippingDraw();
    }
    
    // DELETE = Remove last polygon
    if (key === 'delete' && !BimViewer.clipping.isDrawing) {
      event.preventDefault();
      BimViewer.removeLastClippingPolygon();
    }
    
    // F = Flip last polygon orientation (for debugging)
    if (key === 'f' && !BimViewer.clipping.isDrawing && BimViewer.clipping.polygons.length > 0) {
      event.preventDefault();
      console.log('⌨️ F pressed - flipping polygon orientation');
      BimViewer.flipLastPolygonOrientation();
    }
    
    // V = Toggle visualization (show/hide polygon filling)
    if (key === 'v' && !event.shiftKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      console.log('⌨️ V pressed - toggling clipping visualization');
      BimViewer.toggleClippingVisualization();
    }
  });
  
  // ===============================
  // INITIALIZATION
  // ===============================
  
  console.log('✅ Enhanced Clipping module loaded v4.2 (STABLE)');
  console.log('💡 Usage:');
  console.log('   - Press P to start/stop drawing clipping polygons');
  console.log('   - RIGHT-CLICK to add points');
  console.log('   - DOUBLE RIGHT-CLICK or ENTER to finish');
  console.log('   - Press V to toggle visualization (show/hide cyan filling)');
  console.log('   - Press F to flip polygon orientation (if clipping is wrong)');
  console.log('   - Press ESC to cancel drawing');
  console.log('   - Press DELETE to remove last polygon');
  console.log('   - LEFT-CLICK stays free for IFC Feature Selection!');
  console.log('🎯 v4.2: Polygon lies on terrain plane (perPositionHeight)');
  console.log('👁️ v4.2: Toggle visualization with V key or "Show/Hide Fill" button');
  
})();
