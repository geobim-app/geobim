// ===============================
// CESIUM BIM VIEWER - COMMENTS MODULE (v4.4 - FIREBASE FIX)
// 3D Comment/Annotation System with Point & Area Support
// NO LEFT-CLICK CONFLICT!
// VERSION: 4.4 - FIXED: Never calls initializeApp - uses auth.js instance
// ===============================
'use strict';

(function() {
  
  console.log('💬 Loading Comments module v4.4 (FIREBASE FIX)...');
  console.log('✅ New functions available: toggleAllCommentsVisibility(), deleteAllComments()');

  // =====================================
  // UTILITY FUNCTIONS
  // =====================================
  
  function sanitizeInput(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // =====================================
  // STATE MANAGEMENT
  // =====================================
  
  BimViewer.comments = {
    db: null,
    initialized: false,
    isAddingComment: false,
    annotationType: 'point', // 'point' or 'area'
    editingComment: null,
    previewEntity: null,
    currentPosition: null,
    currentSurfaceNormal: null,
    // Area annotation state
    areaPoints: [],
    areaPreviewEntities: [],
    areaPolygonEntity: null,
    areaFinishButton: null,
    comments: [],
    selectedComment: null,
    allVisible: true,
    clickHandlerInitialized: false
  };

  // =====================================
  // IMPROVED SURFACE PICKING
  // =====================================
  
  BimViewer.getAccurateSurfacePosition = function(screenPosition) {
    const scene = this.viewer.scene;
    
    const pickedObject = scene.pick(screenPosition);
    
    if (Cesium.defined(pickedObject)) {
      const cartesian = scene.pickPosition(screenPosition);
      
      if (Cesium.defined(cartesian)) {
        console.log('✅ Accurate position picked from 3D Tileset');
        
        let surfaceNormal = null;
        
        if (pickedObject.primitive && pickedObject.primitive instanceof Cesium.Cesium3DTileset) {
          const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
          const ellipsoid = scene.globe.ellipsoid;
          surfaceNormal = ellipsoid.geodeticSurfaceNormal(cartesian);
        }
        
        return {
          position: cartesian,
          normal: surfaceNormal,
          type: '3D_TILESET'
        };
      }
    }
    
    const ray = this.viewer.camera.getPickRay(screenPosition);
    const globePosition = scene.globe.pick(ray, scene);
    
    if (Cesium.defined(globePosition)) {
      const ellipsoid = scene.globe.ellipsoid;
      const surfaceNormal = ellipsoid.geodeticSurfaceNormal(globePosition);
      
      return {
        position: globePosition,
        normal: surfaceNormal,
        type: 'TERRAIN'
      };
    }
    
    console.warn('⚠️ Could not pick any surface position');
    return null;
  };

  // =====================================
  // FIREBASE INITIALIZATION (v4.4 FIXED)
  // =====================================
  
  BimViewer.initFirebase = function() {
    // ✅ FIX: Prüfen ob bereits initialisiert
    if (this.comments.initialized) {
      console.log('💬 Comments Firebase already initialized');
      return true;
    }
    
    if (typeof firebase === 'undefined') {
      console.error('❌ Firebase SDK not loaded!');
      this.updateStatus('Firebase SDK not loaded', 'error');
      return false;
    }
    
    try {
      // ✅ FIX v4.4: NIEMALS initializeApp aufrufen - auth.js macht das bereits!
      if (firebase.apps.length === 0) {
        console.error('❌ Firebase not initialized by auth module!');
        this.updateStatus('Please login first', 'error');
        return false;
      }
      
      console.log('✅ Using existing Firebase instance from auth module');
      
      // ✅ Nur Firestore initialisieren
      this.comments.db = firebase.firestore();
      this.comments.initialized = true;
      console.log('✅ Firestore ready for comments');
      
      // ✅ Listener starten
      this.setupCommentsListener();
      
      // ✅ Click-Handler initialisieren (falls noch nicht geschehen)
      if (!this.comments.clickHandlerInitialized) {
        this.initCommentClickHandler();
        this.comments.clickHandlerInitialized = true;
      }
      
      return true;
      
    } catch (error) {
      console.error('❌ Firebase initialization error:', error);
      this.updateStatus('Firebase initialization failed: ' + error.message, 'error');
      return false;
    }
  };

  // =====================================
  // FIREBASE LISTENERS
  // =====================================
  
  BimViewer.setupCommentsListener = function() {
    if (!this.comments.initialized) {
      console.warn('⚠️ Cannot setup listener - Firebase not initialized');
      return;
    }
    
    let isFirstLoad = true;
    
    this.comments.db.collection('bim_viewer_comments').onSnapshot((snapshot) => {
      console.log('🔥 Comments snapshot received:', snapshot.size, 'comment(s)');
      
      const previousCount = this.comments.comments.length;
      
      this.viewer.entities.suspendEvents();
      
      this.comments.comments = [];
      snapshot.forEach((doc) => {
        const comment = { id: doc.id, ...doc.data() };
        this.comments.comments.push(comment);
        
        if (!this.viewer.entities.getById(comment.id)) {
          if (comment.type === 'area') {
            this.addAreaEntity(comment);
          } else {
            this.addCommentEntity(comment);
          }
        } else {
          const entity = this.viewer.entities.getById(comment.id);
          if (entity && entity.description) {
            entity.description = this.createCommentDescription(comment);
          }
        }
      });
      
      this.viewer.entities.resumeEvents();
      
      this.updateCommentsList();
      this.updateCommentsCount();
      
      console.log(`📝 Loaded ${this.comments.comments.length} comment(s)`);
      
      if (!isFirstLoad && this.comments.comments.length > previousCount) {
        const newCount = this.comments.comments.length - previousCount;
        this.updateStatus(`🔔 ${newCount} new comment(s) from other users!`, 'success');
      }
      
      isFirstLoad = false;
      
    }, (error) => {
      console.error('❌ Error listening to comments:', error);
      this.updateStatus('Error loading comments', 'error');
    });
  };

  // =====================================
  // COMMENT CRUD OPERATIONS
  // =====================================
  
  BimViewer.saveComment = async function(commentData) {
    if (!this.comments.initialized) {
      this.updateStatus('Firebase not initialized', 'error');
      return false;
    }
    
    try {
      const sanitizedData = {
        title: sanitizeInput(commentData.title),
        text: sanitizeInput(commentData.text),
        timestamp: commentData.timestamp,
        category: commentData.category || 'General',
        priority: commentData.priority || 'Normal',
        type: commentData.type || 'point'
      };
      
      if (commentData.type === 'area') {
        sanitizedData.areaPoints = commentData.areaPoints;
      } else {
        sanitizedData.lon = commentData.lon;
        sanitizedData.lat = commentData.lat;
        sanitizedData.height = commentData.height;
      }
      
      await this.comments.db.collection('bim_viewer_comments')
        .doc(commentData.id)
        .set(sanitizedData);
      
      console.log('✅ Comment saved:', commentData.id);
      return true;
    } catch (error) {
      console.error('❌ Error saving comment:', error);
      this.updateStatus('Error saving comment: ' + error.message, 'error');
      return false;
    }
  };

  BimViewer.deleteComment = async function(commentId) {
    if (!this.comments.initialized) {
      this.updateStatus('Firebase not initialized', 'error');
      return false;
    }
    
    if (!confirm('Delete this comment?')) return false;
    
    try {
      await this.comments.db.collection('bim_viewer_comments')
        .doc(commentId)
        .delete();
      
      this.viewer.entities.removeById(commentId);
      console.log('✅ Comment deleted:', commentId);
      this.updateStatus('Comment deleted', 'success');
      return true;
    } catch (error) {
      console.error('❌ Error deleting comment:', error);
      this.updateStatus('Error deleting comment: ' + error.message, 'error');
      return false;
    }
  };

  // =====================================
  // TOGGLE ALL COMMENTS VISIBILITY
  // =====================================
  
  BimViewer.toggleAllCommentsVisibility = function() {
    if (!this.comments.comments || this.comments.comments.length === 0) {
      this.updateStatus('No comments to toggle', 'warning');
      return;
    }
    
    this.comments.allVisible = !this.comments.allVisible;
    
    this.comments.comments.forEach(comment => {
      const entity = this.viewer.entities.getById(comment.id);
      if (entity) {
        entity.show = this.comments.allVisible;
      }
    });
    
    const status = this.comments.allVisible ? 'shown' : 'hidden';
    this.updateStatus(`All comments ${status}`, 'success');
    console.log(`👁️ All comments ${status}`);
    
    const toggleBtn = document.getElementById('toggleAllCommentsBtn');
    if (toggleBtn) {
      toggleBtn.textContent = this.comments.allVisible ? '👁️ Hide All' : '👁️ Show All';
    }
  };

  // =====================================
  // DELETE ALL COMMENTS
  // =====================================
  
  BimViewer.deleteAllComments = async function() {
    if (!this.comments.initialized) {
      this.updateStatus('Firebase not initialized', 'error');
      return false;
    }
    
    if (!this.comments.comments || this.comments.comments.length === 0) {
      this.updateStatus('No comments to delete', 'warning');
      return false;
    }
    
    const count = this.comments.comments.length;
    
    if (!confirm(`⚠️ Delete ALL ${count} comment(s)?\n\nThis action cannot be undone!`)) {
      return false;
    }
    
    try {
      this.updateStatus('Deleting all comments...', 'loading');
      
      const batch = this.comments.db.batch();
      
      this.comments.comments.forEach(comment => {
        const docRef = this.comments.db.collection('bim_viewer_comments').doc(comment.id);
        batch.delete(docRef);
      });
      
      await batch.commit();
      
      this.comments.comments.forEach(comment => {
        this.viewer.entities.removeById(comment.id);
      });
      
      console.log(`✅ All ${count} comments deleted`);
      this.updateStatus(`All ${count} comment(s) deleted`, 'success');
      return true;
      
    } catch (error) {
      console.error('❌ Error deleting all comments:', error);
      this.updateStatus('Error deleting comments: ' + error.message, 'error');
      return false;
    }
  };

  // =====================================
  // POINT COMMENT ENTITY
  // =====================================
  
  BimViewer.addCommentEntity = function(comment) {
    const priorityColors = {
      'High': '#e74c3c',
      'Normal': '#5ac',
      'Low': '#95a5a6'
    };
    
    const color = priorityColors[comment.priority] || '#5ac';
    
    const position = Cesium.Cartesian3.fromDegrees(
      comment.lon,
      comment.lat,
      comment.height
    );
    
    const highResSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="128" height="160" viewBox="0 0 128 160">
        <defs>
          <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="3"/>
            <feOffset dx="0" dy="2" result="offsetblur"/>
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.5"/>
            </feComponentTransfer>
            <feMerge>
              <feMergeNode/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        <circle cx="64" cy="64" r="58" fill="${color}" stroke="white" stroke-width="8" filter="url(#shadow)"/>
        <circle cx="64" cy="64" r="26" fill="white"/>
        <circle cx="64" cy="64" r="14" fill="${color}"/>
      </svg>
    `;
    
    this.viewer.entities.add({
      id: comment.id,
      position: position,
      show: true,
      
      billboard: {
        image: 'data:image/svg+xml;base64,' + btoa(highResSvg),
        scale: 0.5,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.CLAMP_TO_3D_TILE,
        scaleByDistance: new Cesium.NearFarScalar(10, 1.0, 500, 0.3)
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
        scaleByDistance: new Cesium.NearFarScalar(10, 1.4, 500, 0.6),
        pixelOffsetScaleByDistance: new Cesium.NearFarScalar(10, 1.0, 500, 0.6),
        showBackground: true,
        backgroundColor: new Cesium.Color(0, 0, 0, 0.85),
        backgroundPadding: new Cesium.Cartesian2(14, 8)
      },
      
      description: this.createCommentDescription(comment)
    });
    
    console.log(`📍 Point comment entity added: ${comment.title}`);
  };

  // =====================================
  // AREA ANNOTATION ENTITY
  // =====================================
  
  BimViewer.addAreaEntity = function(comment) {
    const priorityColors = {
      'High': '#e74c3c',
      'Normal': '#5ac',
      'Low': '#95a5a6'
    };
    
    const color = priorityColors[comment.priority] || '#5ac';
    const cesiumColor = Cesium.Color.fromCssColorString(color);
    
    const OFFSET_HEIGHT = 0.02;
    
    const positions = comment.areaPoints.map(point => {
      const cartographic = Cesium.Cartographic.fromDegrees(point.lon, point.lat, point.height + OFFSET_HEIGHT);
      return Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, cartographic.height);
    });
    
    const centerCart = Cesium.BoundingSphere.fromPoints(positions).center;
    
    this.viewer.entities.add({
      id: comment.id,
      polygon: {
        hierarchy: positions,
        material: cesiumColor.withAlpha(0.5),
        outline: true,
        outlineColor: cesiumColor,
        outlineWidth: 3,
        perPositionHeight: true
      },
      
      position: centerCart,
      
      label: {
        text: `📐 ${comment.title}`,
        font: 'bold 28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 4,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        pixelOffset: new Cesium.Cartesian2(0, 0),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scale: 1.0,
        scaleByDistance: new Cesium.NearFarScalar(10, 1.5, 500, 0.6),
        pixelOffsetScaleByDistance: new Cesium.NearFarScalar(10, 1.0, 500, 0.6),
        backgroundColor: cesiumColor.withAlpha(0.9),
        backgroundPadding: new Cesium.Cartesian2(14, 8),
        showBackground: true
      },
      
      description: this.createCommentDescription(comment)
    });
    
    console.log(`📐 Area annotation entity added: ${comment.title} (${comment.areaPoints.length} points)`);
  };

  // =====================================
  // CALCULATE POLYGON AREA
  // =====================================
  
  BimViewer.calculatePolygonArea = function(positions) {
    if (!positions || positions.length < 3) return 0;
    
    const coords = positions.map(pos => {
      const cartographic = Cesium.Cartographic.fromCartesian(pos);
      return {
        lon: Cesium.Math.toDegrees(cartographic.longitude),
        lat: Cesium.Math.toDegrees(cartographic.latitude)
      };
    });
    
    let area = 0;
    for (let i = 0; i < coords.length; i++) {
      const j = (i + 1) % coords.length;
      area += coords[i].lon * coords[j].lat;
      area -= coords[j].lon * coords[i].lat;
    }
    area = Math.abs(area) / 2.0;
    
    const avgLat = coords.reduce((sum, c) => sum + c.lat, 0) / coords.length;
    const latRad = Cesium.Math.toRadians(avgLat);
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLon = 111320 * Math.cos(latRad);
    
    area = area * metersPerDegreeLat * metersPerDegreeLon;
    
    return area;
  };

  BimViewer.createCommentDescription = function(comment) {
    const timeLabel = comment.isUpdated ? 'Updated' : 'Created';
    const typeEmoji = comment.type === 'area' ? '📐' : '💬';
    const typeLabel = comment.type === 'area' ? 'Area Annotation' : 'Point Comment';
    
    const priorityBadges = {
      'High': '<span style="background: #e74c3c; color: white; padding: 3px 8px; border-radius: 3px; font-weight: bold;">🔴 HIGH</span>',
      'Normal': '<span style="background: #5ac; color: white; padding: 3px 8px; border-radius: 3px; font-weight: bold;">🔵 NORMAL</span>',
      'Low': '<span style="background: #95a5a6; color: white; padding: 3px 8px; border-radius: 3px; font-weight: bold;">⚪ LOW</span>'
    };
    
    const priorityBadge = priorityBadges[comment.priority] || priorityBadges['Normal'];
    
    const categoryEmojis = {
      'General': '📋',
      'Architecture': '🏛️',
      'Structure': '🏗️',
      'MEP': '⚡',
      'Issue': '⚠️',
      'Question': '❓'
    };
    
    const categoryEmoji = categoryEmojis[comment.category] || '📋';
    
    let areaInfo = '';
    if (comment.type === 'area' && comment.areaPoints) {
      areaInfo = `
        <div style="background: rgba(90, 170, 204, 0.2); padding: 8px; border-radius: 4px; margin-bottom: 12px;">
          <strong>📐 Area:</strong> ${comment.areaPoints.length} points
        </div>
      `;
    }
    
    return `
      <div class="modern-infobox" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 0; min-width: 300px;">
        <h3 style="margin: 0; padding: 15px; background: rgba(90, 170, 204, 0.1); border-bottom: 2px solid rgba(90, 170, 204, 0.3); color: #5ac; font-size: 18px;">
          ${typeEmoji} ${comment.title}
        </h3>
        
        <div style="padding: 15px;">
          <div style="margin-bottom: 12px; font-size: 11px; color: rgba(255,255,255,0.6);">
            ${typeLabel}
          </div>
          
          <div style="margin-bottom: 15px;">
            ${priorityBadge}
            <span style="background: rgba(255,255,255,0.1); color: white; padding: 3px 8px; border-radius: 3px; margin-left: 5px;">
              ${categoryEmoji} ${comment.category}
            </span>
          </div>
          
          ${areaInfo}
          
          <div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 6px; margin-bottom: 12px; line-height: 1.6;">
            ${comment.text}
          </div>
          
          <div style="font-size: 11px; color: rgba(255,255,255,0.6); margin-bottom: 10px;">
            ${timeLabel}: ${new Date(comment.timestamp).toLocaleString('de-DE')}
          </div>
          
          <div style="display: flex; gap: 8px;">
            <button onclick="BimViewer.editComment('${comment.id}')" 
                    style="flex: 1; background: #2196f3; color: white; border: none; padding: 8px; border-radius: 4px; cursor: pointer; font-weight: 600;">
              ✏️ Edit
            </button>
            <button onclick="BimViewer.deleteComment('${comment.id}')" 
                    style="flex: 1; background: #e74c3c; color: white; border: none; padding: 8px; border-radius: 4px; cursor: pointer; font-weight: 600;">
              🗑️ Delete
            </button>
          </div>
        </div>
      </div>
    `;
  };

  // =====================================
  // PREVIEW MARKER (POINT)
  // =====================================
  
  BimViewer.createPreviewMarker = function(lon, lat, height) {
    this.removePreviewMarker();
    
    const position = Cesium.Cartesian3.fromDegrees(lon, lat, height);
    
    const highResSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="128" height="160" viewBox="0 0 128 160">
        <defs>
          <filter id="shadowPreview" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="3"/>
            <feOffset dx="0" dy="2" result="offsetblur"/>
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.5"/>
            </feComponentTransfer>
            <feMerge>
              <feMergeNode/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        <circle cx="64" cy="64" r="58" fill="#FFD700" stroke="white" stroke-width="8" opacity="0.8" filter="url(#shadowPreview)"/>
        <circle cx="64" cy="64" r="26" fill="white" opacity="0.9"/>
        <circle cx="64" cy="64" r="14" fill="#FFD700"/>
      </svg>
    `;
    
    this.comments.previewEntity = this.viewer.entities.add({
      position: position,
      billboard: {
        image: 'data:image/svg+xml;base64,' + btoa(highResSvg),
        scale: 0.6,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.CLAMP_TO_3D_TILE,
        scaleByDistance: new Cesium.NearFarScalar(10, 1.0, 500, 0.3)
      },
      label: {
        text: 'New Comment Location',
        font: 'bold 26px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
        fillColor: Cesium.Color.YELLOW,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 4,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -70),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.CLAMP_TO_3D_TILE,
        scale: 1.0,
        scaleByDistance: new Cesium.NearFarScalar(10, 1.4, 500, 0.6),
        pixelOffsetScaleByDistance: new Cesium.NearFarScalar(10, 1.0, 500, 0.6),
        showBackground: true,
        backgroundColor: new Cesium.Color(0, 0, 0, 0.85),
        backgroundPadding: new Cesium.Cartesian2(14, 8)
      }
    });
  };

  BimViewer.removePreviewMarker = function() {
    if (this.comments.previewEntity) {
      this.viewer.entities.remove(this.comments.previewEntity);
      this.comments.previewEntity = null;
    }
  };

  // =====================================
  // AREA ANNOTATION DRAWING
  // =====================================
  
  BimViewer.addAreaPoint = function(lon, lat, height) {
    const OFFSET_HEIGHT = 0.02;
    
    this.comments.areaPoints.push({ lon, lat, height });
    
    const cartographic = Cesium.Cartographic.fromDegrees(lon, lat, height + OFFSET_HEIGHT);
    const position = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, cartographic.height);
    
    const pointEntity = this.viewer.entities.add({
      position: position,
      point: {
        pixelSize: 14,
        color: Cesium.Color.YELLOW,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(10, 1.5, 500, 0.5)
      },
      label: {
        text: `${this.comments.areaPoints.length}`,
        font: 'bold 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 4,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -25),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scale: 1.0,
        scaleByDistance: new Cesium.NearFarScalar(10, 1.4, 500, 0.7),
        pixelOffsetScaleByDistance: new Cesium.NearFarScalar(10, 1.0, 500, 0.7),
        showBackground: true,
        backgroundColor: new Cesium.Color(0, 0, 0, 0.85),
        backgroundPadding: new Cesium.Cartesian2(10, 6)
      }
    });
    
    this.comments.areaPreviewEntities.push(pointEntity);
    
    if (this.comments.areaPoints.length >= 3) {
      this.updateAreaPolygonPreview();
      this.showAreaFinishButton();
    }
    
    console.log(`📐 Area point ${this.comments.areaPoints.length} added`);
  };

  BimViewer.updateAreaPolygonPreview = function() {
    if (this.comments.areaPolygonEntity) {
      this.viewer.entities.remove(this.comments.areaPolygonEntity);
    }
    
    const OFFSET_HEIGHT = 0.02;
    
    const positions = this.comments.areaPoints.map(point => {
      const cartographic = Cesium.Cartographic.fromDegrees(point.lon, point.lat, point.height + OFFSET_HEIGHT);
      return Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, cartographic.height);
    });
    
    this.comments.areaPolygonEntity = this.viewer.entities.add({
      polygon: {
        hierarchy: positions,
        material: Cesium.Color.YELLOW.withAlpha(0.5),
        outline: true,
        outlineColor: Cesium.Color.YELLOW,
        outlineWidth: 3,
        perPositionHeight: true
      }
    });
    
    console.log('📐 Area polygon preview updated');
  };

  // =====================================
  // FLOATING "FINISH AREA" BUTTON
  // =====================================
  
  BimViewer.showAreaFinishButton = function() {
    if (this.comments.areaFinishButton) return;
    
    const button = document.createElement('div');
    button.id = 'areaFinishButton';
    button.style.cssText = `
      position: fixed;
      bottom: 100px;
      right: 20px;
      z-index: 150;
      background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
      color: white;
      padding: 15px 25px;
      border-radius: 12px;
      cursor: pointer;
      font-size: 16px;
      font-weight: bold;
      box-shadow: 0 8px 24px rgba(17, 153, 142, 0.4);
      transition: all 0.3s ease;
      animation: bounceIn 0.5s ease;
    `;
    button.innerHTML = `✅ Finish Area (${this.comments.areaPoints.length} points)<br><small style="font-weight: normal; opacity: 0.9;">or press ENTER</small>`;
    
    button.onclick = () => this.finishAreaAnnotation();
    
    button.onmouseenter = function() {
      this.style.transform = 'translateY(-3px) scale(1.05)';
      this.style.boxShadow = '0 12px 32px rgba(17, 153, 142, 0.6)';
    };
    
    button.onmouseleave = function() {
      this.style.transform = 'translateY(0) scale(1)';
      this.style.boxShadow = '0 8px 24px rgba(17, 153, 142, 0.4)';
    };
    
    document.body.appendChild(button);
    this.comments.areaFinishButton = button;
    
    const style = document.createElement('style');
    style.textContent = `
      @keyframes bounceIn {
        0% { transform: scale(0.3); opacity: 0; }
        50% { transform: scale(1.05); }
        70% { transform: scale(0.9); }
        100% { transform: scale(1); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  };

  BimViewer.hideAreaFinishButton = function() {
    if (this.comments.areaFinishButton) {
      document.body.removeChild(this.comments.areaFinishButton);
      this.comments.areaFinishButton = null;
    }
  };

  BimViewer.clearAreaPreview = function() {
    this.comments.areaPreviewEntities.forEach(entity => {
      this.viewer.entities.remove(entity);
    });
    this.comments.areaPreviewEntities = [];
    
    if (this.comments.areaPolygonEntity) {
      this.viewer.entities.remove(this.comments.areaPolygonEntity);
      this.comments.areaPolygonEntity = null;
    }
    
    this.comments.areaPoints = [];
    
    this.hideAreaFinishButton();
    
    console.log('📐 Area preview cleared');
  };

  BimViewer.finishAreaAnnotation = function() {
    if (this.comments.areaPoints.length < 3) {
      this.updateStatus('⚠️ Area needs at least 3 points!', 'error');
      return;
    }
    
    this.hideAreaFinishButton();
    this.openCommentDialog(null, false, true);
  };

  // =====================================
  // COMMENT DIALOG
  // =====================================
  
  BimViewer.openCommentDialog = function(screenPosition, isEdit = false, isArea = false) {
    const dialog = document.getElementById('commentDialog');
    const title = document.getElementById('commentDialogTitle');
    const titleInput = document.getElementById('commentTitleInput');
    const textInput = document.getElementById('commentTextInput');
    const categorySelect = document.getElementById('commentCategory');
    const prioritySelect = document.getElementById('commentPriority');
    
    if (!dialog) {
      console.error('Comment dialog not found');
      return;
    }
    
    if (isEdit && this.comments.editingComment) {
      title.textContent = 'Edit Comment';
      titleInput.value = this.comments.editingComment.title;
      textInput.value = this.comments.editingComment.text;
      categorySelect.value = this.comments.editingComment.category || 'General';
      prioritySelect.value = this.comments.editingComment.priority || 'Normal';
    } else if (isArea) {
      title.textContent = `New Area Annotation (${this.comments.areaPoints.length} points)`;
      titleInput.value = '';
      textInput.value = '';
      categorySelect.value = 'Issue';
      prioritySelect.value = 'Normal';
    } else {
      title.textContent = 'New Point Comment';
      titleInput.value = '';
      textInput.value = '';
      categorySelect.value = 'General';
      prioritySelect.value = 'Normal';
    }
    
    if (screenPosition) {
      dialog.style.left = Math.min(screenPosition.x + 10, window.innerWidth - 450) + 'px';
      dialog.style.top = Math.min(screenPosition.y + 10, window.innerHeight - 400) + 'px';
    } else {
      dialog.style.left = '50%';
      dialog.style.top = '50%';
      dialog.style.transform = 'translate(-50%, -50%)';
    }
    
    dialog.style.display = 'block';
    titleInput.focus();
  };

  BimViewer.closeCommentDialog = function() {
    const dialog = document.getElementById('commentDialog');
    if (dialog) {
      dialog.style.display = 'none';
    }
    
    this.removePreviewMarker();
    this.clearAreaPreview();
    this.comments.editingComment = null;
    this.comments.currentPosition = null;
    this.comments.currentSurfaceNormal = null;
    
    if (this.comments.isAddingComment) {
      this.toggleCommentMode();
    }
  };

  // =====================================
  // TOGGLE COMMENT MODE
  // =====================================
  
  BimViewer.toggleCommentMode = function() {
    this.comments.isAddingComment = !this.comments.isAddingComment;
    
    const toggleBtn = document.getElementById('toggleCommentMode');
    const indicator = document.getElementById('commentModeIndicator');
    
    if (this.comments.isAddingComment) {
      if (toggleBtn) {
        toggleBtn.classList.add('active');
        toggleBtn.innerHTML = '✋ Cancel';
      }
      
      if (indicator) {
        indicator.classList.add('active');
        
        if (this.comments.annotationType === 'area') {
          indicator.textContent = '📐 AREA MODE - RIGHT-CLICK to add points (min. 3), then press ENTER or click "Finish Area"';
        } else {
          indicator.textContent = '💬 POINT MODE - RIGHT-CLICK on 3D model to place comment';
        }
      }
      
      const modeText = this.comments.annotationType === 'area' 
        ? 'RIGHT-CLICK to add area points (min. 3)...' 
        : 'RIGHT-CLICK on the 3D model to place a comment...';
      
      this.updateStatus(modeText, 'warning');
    } else {
      if (toggleBtn) {
        toggleBtn.classList.remove('active');
        toggleBtn.innerHTML = this.comments.annotationType === 'area' ? '📐 Add Area' : '💬 Add Comment';
      }
      
      if (indicator) {
        indicator.classList.remove('active');
      }
      
      this.closeCommentDialog();
    }
  };

  // =====================================
  // TOGGLE ANNOTATION TYPE
  // =====================================
  
  BimViewer.setAnnotationType = function(type) {
    this.comments.annotationType = type;
    
    const pointBtn = document.getElementById('annotationTypePoint');
    const areaBtn = document.getElementById('annotationTypeArea');
    
    if (pointBtn && areaBtn) {
      if (type === 'point') {
        pointBtn.classList.add('active');
        areaBtn.classList.remove('active');
      } else {
        pointBtn.classList.remove('active');
        areaBtn.classList.add('active');
      }
    }
    
    const toggleBtn = document.getElementById('toggleCommentMode');
    if (toggleBtn && !this.comments.isAddingComment) {
      toggleBtn.innerHTML = type === 'area' ? '📐 Add Area' : '💬 Add Comment';
    }
    
    const indicator = document.getElementById('commentModeIndicator');
    if (indicator && this.comments.isAddingComment) {
      if (type === 'area') {
        indicator.textContent = '📐 AREA MODE - RIGHT-CLICK to add points (min. 3), then press ENTER or click "Finish Area"';
      } else {
        indicator.textContent = '💬 POINT MODE - RIGHT-CLICK on 3D model to place comment';
      }
    }
    
    console.log(`📝 Annotation type set to: ${type}`);
  };

  // =====================================
  // EDIT COMMENT
  // =====================================
  
  BimViewer.editComment = function(commentId) {
    const comment = this.comments.comments.find(c => c.id === commentId);
    if (!comment) {
      console.error('Comment not found:', commentId);
      return;
    }
    
    this.comments.editingComment = comment;
    
    if (comment.type === 'area') {
      this.openCommentDialog(null, true, true);
    } else {
      this.comments.currentPosition = {
        lon: comment.lon,
        lat: comment.lat,
        height: comment.height
      };
      
      this.createPreviewMarker(comment.lon, comment.lat, comment.height);
      this.openCommentDialog(null, true, false);
    }
  };

  // =====================================
  // SAVE COMMENT
  // =====================================
  
  BimViewer.saveCommentFromDialog = async function() {
    const title = document.getElementById('commentTitleInput').value.trim();
    const text = document.getElementById('commentTextInput').value.trim();
    const category = document.getElementById('commentCategory').value;
    const priority = document.getElementById('commentPriority').value;
    
    if (!title || !text) {
      alert('Please fill in both title and comment text!');
      return;
    }
    
    const isArea = this.comments.areaPoints.length >= 3;
    
    if (!isArea && !this.comments.currentPosition) {
      alert('No position selected!');
      return;
    }
    
    if (isArea && this.comments.areaPoints.length < 3) {
      alert('Area needs at least 3 points!');
      return;
    }
    
    if (this.comments.editingComment) {
      const updatedComment = {
        ...this.comments.editingComment,
        title: title,
        text: text,
        category: category,
        priority: priority,
        timestamp: new Date().toISOString(),
        isUpdated: true
      };
      
      this.updateStatus('Updating comment...', 'loading');
      const success = await this.saveComment(updatedComment);
      
      if (success) {
        const entity = this.viewer.entities.getById(this.comments.editingComment.id);
        if (entity) {
          if (entity.label) {
            entity.label.text = updatedComment.type === 'area' ? `📐 ${title}` : title;
          }
          entity.description = this.createCommentDescription(updatedComment);
          
          const priorityColors = {
            'High': '#e74c3c',
            'Normal': '#5ac',
            'Low': '#95a5a6'
          };
          const color = priorityColors[priority] || '#5ac';
          
          if (updatedComment.type === 'area' && entity.polygon) {
            const cesiumColor = Cesium.Color.fromCssColorString(color);
            entity.polygon.material = cesiumColor.withAlpha(0.4);
            entity.polygon.outlineColor = cesiumColor;
          } else if (entity.billboard) {
            entity.billboard.image = 'data:image/svg+xml;base64,' + btoa(`
              <svg xmlns="http://www.w3.org/2000/svg" width="40" height="50">
                <circle cx="20" cy="20" r="18" fill="${color}" stroke="white" stroke-width="3"/>
                <circle cx="20" cy="20" r="8" fill="white"/>
              </svg>
            `);
          }
        }
        
        this.removePreviewMarker();
        this.clearAreaPreview();
        this.closeCommentDialog();
        this.updateStatus('Comment updated!', 'success');
      }
    } else {
      const comment = {
        id: 'comment_' + Date.now(),
        title: title,
        text: text,
        timestamp: new Date().toISOString(),
        category: category,
        priority: priority,
        isUpdated: false,
        type: isArea ? 'area' : 'point'
      };
      
      if (isArea) {
        comment.areaPoints = this.comments.areaPoints;
      } else {
        comment.lon = this.comments.currentPosition.lon;
        comment.lat = this.comments.currentPosition.lat;
        comment.height = this.comments.currentPosition.height;
      }
      
      this.updateStatus('Saving comment...', 'loading');
      const success = await this.saveComment(comment);
      
      if (success) {
        this.removePreviewMarker();
        this.clearAreaPreview();
        this.closeCommentDialog();
        const typeLabel = isArea ? 'Area annotation' : 'Comment';
        this.updateStatus(`${typeLabel} "${title}" saved!`, 'success');
      }
    }
  };

  // =====================================
  // CLICK HANDLER (RIGHT-CLICK ONLY)
  // =====================================
  
  BimViewer.initCommentClickHandler = function() {
    console.log('💬 Initializing RIGHT-CLICK-only comment handler (v4.4)...');
    
    const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    
    handler.setInputAction((click) => {
      if (!this.comments.isAddingComment) return;
      
      try {
        const surfaceData = this.getAccurateSurfacePosition(click.position);
        
        if (!surfaceData || !surfaceData.position) {
          this.updateStatus('⚠️ Please RIGHT-CLICK on a 3D model or terrain surface!', 'error');
          return;
        }
        
        const cartographic = Cesium.Cartographic.fromCartesian(surfaceData.position);
        const lon = Cesium.Math.toDegrees(cartographic.longitude);
        const lat = Cesium.Math.toDegrees(cartographic.latitude);
        const height = cartographic.height;
        
        if (this.comments.annotationType === 'area') {
          this.addAreaPoint(lon, lat, height);
          
          const pointCount = this.comments.areaPoints.length;
          if (pointCount < 3) {
            this.updateStatus(`Point ${pointCount} added - Need ${3 - pointCount} more (min. 3)`, 'success');
          } else {
            this.updateStatus(`Point ${pointCount} added - Press ENTER or click "Finish Area" button`, 'success');
          }
        } else {
          this.comments.currentPosition = { lon, lat, height };
          this.comments.currentSurfaceNormal = surfaceData.normal;
          
          this.createPreviewMarker(lon, lat, height);
          this.openCommentDialog(click.position);
          
          const surfaceInfo = surfaceData.type === '3D_TILESET' 
            ? 'on 3D model surface' 
            : 'on terrain';
          this.updateStatus(`📍 Comment placed ${surfaceInfo}`, 'success');
        }
        
      } catch (error) {
        console.error('❌ Error in RIGHT-CLICK handler:', error);
        this.updateStatus('Error placing annotation', 'error');
      }
      
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    
    console.log('✅ RIGHT-CLICK-only handler installed!');
  };

  // =====================================
  // KEYBOARD SHORTCUTS
  // =====================================
  
  document.addEventListener('keydown', (event) => {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
    
    const key = event.key.toLowerCase();
    
    if (key === 'c' && !event.shiftKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      BimViewer.toggleCommentMode();
    }
    
    if (key === 'a' && !event.shiftKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      BimViewer.setAnnotationType('area');
      if (!BimViewer.comments.isAddingComment) {
        BimViewer.toggleCommentMode();
      }
    }
    
    if (key === 'enter' && BimViewer.comments.annotationType === 'area' && BimViewer.comments.areaPoints.length >= 3) {
      event.preventDefault();
      BimViewer.finishAreaAnnotation();
    }
    
    if (key === 'escape') {
      event.preventDefault();
      if (BimViewer.comments.areaPoints.length > 0) {
        BimViewer.clearAreaPreview();
        BimViewer.updateStatus('Area annotation cancelled', 'warning');
      }
      if (BimViewer.comments.isAddingComment) {
        BimViewer.closeCommentDialog();
      }
    }
  });

  // =====================================
  // INITIALIZATION
  // =====================================
  
  console.log('✅ Comments module loaded (v4.4 - FIREBASE FIX)');
  console.log('');
  console.log('💡 NEW in v4.4:');
  console.log('   ✅ FIXED: Never calls initializeApp - uses auth.js instance');
  console.log('   ✅ Firebase is initialized AFTER successful login');
  console.log('   ✅ No more duplicate-app errors');
  console.log('');
  console.log('⌨️  Keyboard shortcuts:');
  console.log('   - C = Toggle point comment mode');
  console.log('   - A = Toggle area annotation mode');
  console.log('   - ENTER = Finish area (when >= 3 points)');
  console.log('   - ESC = Cancel');

})();
