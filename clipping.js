/**
 * GEOBIM.APP - Geospatial BIM Viewer
 * © 2026 Christof Lorenz. All rights reserved.
 *
 * License: Personal and non-commercial use only.
 * Commercial use requires written permission.
 * Contact: info@geobim.app
 */

// ===============================
// CESIUM BIM VIEWER - ENHANCED CLIPPING MODULE v4.3
// Polygon-based clipping for Google 3D Tiles, OSM Buildings, and Terrain
// RIGHT-CLICK to add points, DOUBLE RIGHT-CLICK or ENTER to finish (LEFT-CLICK stays free!)
// v4.3: Rectangle draw mode (2-click axis-aligned rectangle)
// ===============================
'use strict';

(function() {
  
  console.log('✂️ Loading Enhanced Clipping Module v4.3 (Rectangle Mode)...');
  
  // ===============================
  // STATE MANAGEMENT
  // ===============================
  BimViewer.clipping = {
    polygons: [], // Array of polygon objects
    isDrawing: false,
    drawMode: null, // 'polygon' or 'rectangle'
    currentPoints: [],
    drawHandler: null,
    previewEntity: null, // Live rectangle preview entity
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
    this.clipping.drawMode = 'polygon';
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
      indicator.textContent = '✏️ POLYGON MODE - RIGHT-CLICK to add points, DOUBLE RIGHT-CLICK or ENTER to finish (min 3 points)';
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

    const wasMode = this.clipping.drawMode;
    this.clipping.isDrawing = false;
    this.clipping.drawMode = null;
    this.clipping.currentPoints = [];

    // Clean up handler
    if (this.clipping.drawHandler) {
      this.clipping.drawHandler.destroy();
      this.clipping.drawHandler = null;
    }

    // Clean up rectangle preview entity
    if (this.clipping.previewEntity) {
      this.viewer.entities.remove(this.clipping.previewEntity);
      this.clipping.previewEntity = null;
    }

    // Update UI
    const btn = document.getElementById('startClippingDraw');
    if (btn) {
      btn.classList.remove('active');
      btn.querySelector('span:last-child').textContent = 'Polygon';
    }

    const rectBtn = document.getElementById('startClippingRect');
    if (rectBtn) {
      rectBtn.classList.remove('active');
      rectBtn.querySelector('span:last-child').textContent = 'Rectangle';
    }

    const indicator = document.getElementById('modeIndicator');
    if (indicator) {
      indicator.classList.remove('active');
    }

    this.updateStatus('Clipping drawing stopped', 'success');
    console.log('✂️ Stopped clipping drawing (was: ' + wasMode + ')');
  };
  
  // ===============================
  // RECTANGLE DRAWING MODE
  // ===============================

  // Compute 4 rectangle corners from 3 points:
  // P1, P2 define one edge; P3 defines the width (projected perpendicular to P1→P2)
  // Returns [P1, P2, P2+perp, P1+perp]
  BimViewer.computeRectangleCorners = function(p1, p2, p3) {
    // Edge vector: P1 → P2
    var edge = Cesium.Cartesian3.subtract(p2, p1, new Cesium.Cartesian3());
    // Vector from P2 to P3
    var w = Cesium.Cartesian3.subtract(p3, p2, new Cesium.Cartesian3());
    // Project w onto edge to get the perpendicular component
    var edgeLenSq = Cesium.Cartesian3.dot(edge, edge);
    if (edgeLenSq < 1e-10) return [p1, p2, p3, p1]; // degenerate
    var proj = Cesium.Cartesian3.multiplyByScalar(
      edge, Cesium.Cartesian3.dot(w, edge) / edgeLenSq, new Cesium.Cartesian3()
    );
    var perp = Cesium.Cartesian3.subtract(w, proj, new Cesium.Cartesian3());

    // 4 corners: P1, P2, P2+perp, P1+perp
    var p3r = Cesium.Cartesian3.add(p2, perp, new Cesium.Cartesian3());
    var p4r = Cesium.Cartesian3.add(p1, perp, new Cesium.Cartesian3());

    return [p1, p2, p3r, p4r];
  };

  BimViewer.startClippingRectDraw = function() {
    if (this.clipping.isDrawing) {
      this.stopClippingDraw();
    }

    this.clipping.isDrawing = true;
    this.clipping.drawMode = 'rectangle';
    this.clipping.currentPoints = [];

    // Update UI
    var rectBtn = document.getElementById('startClippingRect');
    if (rectBtn) {
      rectBtn.classList.add('active');
      rectBtn.querySelector('span:last-child').textContent = 'Drawing...';
    }

    var indicator = document.getElementById('modeIndicator');
    if (indicator) {
      indicator.classList.add('active');
      indicator.textContent = '⬜ RECTANGLE MODE - RIGHT-CLICK 3 points: corner 1, corner 2 (edge), corner 3 (width)';
    }

    this.updateStatus('Rectangle mode - RIGHT-CLICK first corner', 'loading');
    console.log('✂️ Started clipping rectangle drawing (3-point mode)');

    var self = this;
    var corner1 = null;
    var corner2 = null;

    // Create event handler
    this.clipping.drawHandler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);

    // Helper to pick position from click
    function pickPosition(position) {
      var cartesian = self.viewer.scene.pickPosition(position);
      if (!cartesian) {
        var ray = self.viewer.camera.getPickRay(position);
        cartesian = self.viewer.scene.globe.pick(ray, self.viewer.scene);
      }
      return cartesian;
    }

    // Helper to add a numbered point marker
    function addMarker(cartesian, number) {
      self.viewer.entities.add({
        position: cartesian,
        point: {
          pixelSize: 10,
          color: Cesium.Color.CYAN,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
        },
        label: {
          text: String(number),
          font: '14px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -15)
        }
      });
    }

    // RIGHT CLICK - Place corners
    this.clipping.drawHandler.setInputAction(function(click) {
      var cartesian = pickPosition(click.position);
      if (!cartesian) {
        self.updateStatus('Cannot place point - RIGHT-CLICK on the model or terrain', 'warning');
        return;
      }

      if (!corner1) {
        // First corner
        corner1 = cartesian;
        addMarker(cartesian, 1);
        self.updateStatus('RIGHT-CLICK second corner to define the edge', 'loading');
        console.log('✂️ Rectangle: corner 1 placed');

      } else if (!corner2) {
        // Second corner — defines the first edge
        corner2 = cartesian;
        addMarker(cartesian, 2);

        // Draw dashed line for the first edge
        self.viewer.entities.add({
          polyline: {
            positions: [corner1, corner2],
            width: 3,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.CYAN,
              dashLength: 16
            }),
            clampToGround: true
          }
        });

        self.updateStatus('RIGHT-CLICK to set rectangle width', 'loading');
        console.log('✂️ Rectangle: corner 2 placed, edge defined');

      } else {
        // Third click — defines the width direction
        var corners = self.computeRectangleCorners(corner1, corner2, cartesian);
        self.clipping.currentPoints = corners;
        console.log('✂️ Rectangle: corner 3 placed, finishing with 4 corners');
        self.finishClippingPolygon();
      }
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    // MOUSE MOVE - Live preview
    this.clipping.drawHandler.setInputAction(function(movement) {
      // Preview the edge line after corner1, preview the rectangle after corner2
      if (!corner1) return;

      var cartesian = pickPosition(movement.endPosition);
      if (!cartesian) return;

      if (!corner2) {
        // After first point: show edge preview line
        if (!self.clipping.previewEntity) {
          self.clipping.previewEntity = self.viewer.entities.add({
            polyline: {
              positions: new Cesium.CallbackProperty(function() {
                return [corner1, cartesian];
              }, false),
              width: 2,
              material: new Cesium.PolylineDashMaterialProperty({
                color: Cesium.Color.CYAN.withAlpha(0.5),
                dashLength: 12
              }),
              clampToGround: true
            }
          });
        }

        // Update line endpoint
        var currentPos = cartesian;
        self.clipping.previewEntity.polyline.positions = new Cesium.CallbackProperty(function() {
          return [corner1, currentPos];
        }, false);

      } else {
        // After second point: show rectangle preview
        var corners = self.computeRectangleCorners(corner1, corner2, cartesian);

        if (self.clipping.previewEntity && self.clipping.previewEntity.polyline) {
          // Switch from line preview to polygon preview
          self.viewer.entities.remove(self.clipping.previewEntity);
          self.clipping.previewEntity = null;
        }

        if (!self.clipping.previewEntity) {
          self.clipping.previewEntity = self.viewer.entities.add({
            polygon: {
              hierarchy: new Cesium.CallbackProperty(function() {
                return new Cesium.PolygonHierarchy(corners);
              }, false),
              material: Cesium.Color.CYAN.withAlpha(0.15),
              outline: true,
              outlineColor: Cesium.Color.CYAN,
              outlineWidth: 2,
              perPositionHeight: true
            }
          });
        }

        var currentCorners = corners;
        self.clipping.previewEntity.polygon.hierarchy = new Cesium.CallbackProperty(function() {
          return new Cesium.PolygonHierarchy(currentCorners);
        }, false);
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
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

      // Ensure globe stays hidden so terrain/imagery doesn't bleed through clip voids
      this.viewer.scene.globe.show = false;
      this.viewer.imageryLayers.removeAll();
      this.viewer.scene.backgroundColor = Cesium.Color.BLACK;
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

    // Apply to terrain (globe) — skip when Google 3D Tiles are active (globe is hidden)
    // and skip in split mode so left side stays unclipped
    if (this.viewer.scene.globe && !this.splitMode && !this.googleTiles.enabled) {
      console.log('✂️ Applying clipping to Terrain');

      // Terrain needs its own collection
      const terrainCollection = this.createClippingPolygonCollection();
      this.viewer.scene.globe.clippingPolygons = terrainCollection;
      this.clipping.collections.terrain = terrainCollection;
    } else if (this.viewer.scene.globe && (this.splitMode || this.googleTiles.enabled)) {
      console.log(`✂️ Skipping terrain clipping (${this.googleTiles.enabled ? 'Google 3D Tiles active' : 'split mode — left side stays clean'})`);
      // Disable any existing terrain clipping
      if (this.viewer.scene.globe.clippingPolygons) {
        this.viewer.scene.globe.clippingPolygons.enabled = false;
      }
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
    const visible = this.clipping.visualizationVisible;

    // Toggle visibility of tracked polygon entities
    this.clipping.entities.forEach(entity => {
      entity.show = visible;
    });

    // Toggle visibility of drawing artifacts (cyan points, polylines, labels)
    this.viewer.entities.values.forEach(entity => {
      if (entity.point?.color?.equals?.(Cesium.Color.CYAN) ||
          entity.point?.color?.getValue?.(Cesium.JulianDate.now())?.equals(Cesium.Color.CYAN) ||
          entity.polyline?.material?.color?.equals?.(Cesium.Color.CYAN) ||
          entity.polyline?.material?.color?.getValue?.(Cesium.JulianDate.now())?.equals(Cesium.Color.CYAN)) {
        entity.show = visible;
      }
    });

    if (visible) {
      btn?.classList.add('active');
      if (icon) icon.textContent = '👁️';
      if (text) text.textContent = 'Visible';
      this.updateStatus('Clipping visualization shown', 'success');
    } else {
      btn?.classList.remove('active');
      if (icon) icon.textContent = '👁️‍🗨️';
      if (text) text.textContent = 'Hidden';
      this.updateStatus('Clipping visualization hidden (clipping still active)', 'success');
    }

    console.log(`👁️ Clipping visualization ${visible ? 'visible' : 'hidden'}`);
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

    // Remove tracked polygon entities
    this.clipping.entities.forEach(entity => {
      this.viewer.entities.remove(entity);
    });

    // Remove orphaned drawing artifacts (cyan points, polylines, labels)
    const orphans = [];
    this.viewer.entities.values.forEach(entity => {
      if (entity.point?.color?.getValue?.(Cesium.JulianDate.now())?.equals(Cesium.Color.CYAN) ||
          entity.point?.color?.equals?.(Cesium.Color.CYAN) ||
          entity.polyline?.material?.color?.getValue?.(Cesium.JulianDate.now())?.equals(Cesium.Color.CYAN) ||
          entity.polyline?.material?.color?.equals?.(Cesium.Color.CYAN)) {
        orphans.push(entity);
      }
    });
    orphans.forEach(entity => this.viewer.entities.remove(entity));
    if (orphans.length > 0) {
      console.log('✂️ Removed', orphans.length, 'orphaned drawing artifacts');
    }

    // Clear arrays
    this.clipping.polygons = [];
    this.clipping.entities = [];
    this.clipping.currentPoints = [];

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
    
    // P = Toggle clipping polygon draw mode
    if (key === 'p' && !event.shiftKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();

      if (BimViewer.clipping.isDrawing && BimViewer.clipping.drawMode === 'polygon') {
        BimViewer.stopClippingDraw();
      } else {
        // startClippingDraw checks isDrawing internally; for rectangle→polygon switch
        // we need to stop first
        if (BimViewer.clipping.isDrawing) BimViewer.stopClippingDraw();
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
    
    // ESC = Cancel drawing (polygon or rectangle)
    if (key === 'escape' && BimViewer.clipping.isDrawing) {
      event.preventDefault();

      // Remove temporary points
      BimViewer.clipping.currentPoints = [];

      // Remove temporary visual elements (cyan points and polylines)
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

    // R = Toggle rectangle draw mode
    if (key === 'r' && !event.shiftKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();

      if (BimViewer.clipping.isDrawing && BimViewer.clipping.drawMode === 'rectangle') {
        BimViewer.stopClippingDraw();
      } else {
        BimViewer.startClippingRectDraw();
      }
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
  
  console.log('✅ Enhanced Clipping module loaded v4.3 (Rectangle mode)');
  console.log('💡 Usage:');
  console.log('   - Press P to start/stop drawing clipping polygons');
  console.log('   - Press R to start/stop drawing clipping rectangles');
  console.log('   - RIGHT-CLICK to add points / place corners');
  console.log('   - DOUBLE RIGHT-CLICK or ENTER to finish polygon');
  console.log('   - Press V to toggle visualization (show/hide cyan filling)');
  console.log('   - Press F to flip polygon orientation (if clipping is wrong)');
  console.log('   - Press ESC to cancel drawing');
  console.log('   - Press DELETE to remove last polygon');
  
})();
