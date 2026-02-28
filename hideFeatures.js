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
// CESIUM BIM VIEWER - HIDE FEATURES MODULE (COMPLETE v2.2)
// Click to hide individual BIM elements/features
// ===============================
'use strict';

(function() {
  
  // State management for hidden features
  BimViewer.hiddenFeatures = {
    features: new Map(),
    isHideMode: false,
    counter: 0
  };

  // Toggle hide mode on/off
  BimViewer.toggleHideMode = function() {
    this.hiddenFeatures.isHideMode = !this.hiddenFeatures.isHideMode;
    
    const toggleBtn = document.getElementById('toggleHideMode');
    const indicator = document.getElementById('hideModeIndicator');
    
    if (this.hiddenFeatures.isHideMode) {
      toggleBtn.classList.add('active');
      if (indicator) {
        indicator.classList.add('active');
        indicator.textContent = '🙈 HIDE MODE ACTIVE - Click on elements to hide them (ESC or H to exit)';
      }
      this.updateStatus('Hide mode activated - Click elements to hide', 'warning');
      console.log('🙈 Hide mode ACTIVATED');
    } else {
      toggleBtn.classList.remove('active');
      if (indicator) {
        indicator.classList.remove('active');
      }
      this.updateStatus('Hide mode deactivated', 'success');
      console.log('👁️ Hide mode DEACTIVATED');
    }
    
    this.updateHiddenFeaturesCount();
  };

  // Hide a specific feature
  BimViewer.hideFeature = function(feature) {
    if (!feature) return;
    
    try {
      const featureId = this.hiddenFeatures.counter++;
      
      let elementType = 'Unknown Element';
      try {
        const className = feature.getProperty('className');
        const name = feature.getProperty('Name') || feature.getProperty('name');
        elementType = className || name || 'Element';
      } catch (error) {
        console.warn('⚠️ Could not get element properties:', error.message);
      }
      
      const originalColor = Cesium.Color.clone(feature.color, new Cesium.Color());
      
      feature.show = false;
      
      this.hiddenFeatures.features.set(featureId, {
        feature: feature,
        originalColor: originalColor,
        elementType: elementType,
        timestamp: new Date()
      });
      
      this.updateStatus(`Element hidden: ${elementType}`, 'success');
      this.updateHiddenFeaturesList();
      this.updateHiddenFeaturesCount();
      
      console.log(`🙈 Feature ${featureId} hidden:`, elementType);
      
    } catch (error) {
      console.error('❌ Error hiding feature:', error);
      this.updateStatus('Error hiding element', 'error');
    }
  };

  // Show a specific hidden feature
  BimViewer.showHiddenFeature = function(featureId) {
    const hiddenData = this.hiddenFeatures.features.get(featureId);
    
    if (!hiddenData) {
      console.warn(`⚠️ Feature ${featureId} not found in hidden features`);
      return;
    }
    
    try {
      hiddenData.feature.show = true;
      hiddenData.feature.color = hiddenData.originalColor;
      
      this.hiddenFeatures.features.delete(featureId);
      
      this.updateStatus(`Element shown: ${hiddenData.elementType}`, 'success');
      this.updateHiddenFeaturesList();
      this.updateHiddenFeaturesCount();
      
      console.log(`👁️ Feature ${featureId} restored:`, hiddenData.elementType);
      
    } catch (error) {
      console.error(`❌ Error showing feature ${featureId}:`, error);
      this.updateStatus('Error showing element', 'error');
    }
  };

  // Show all hidden features
  BimViewer.showAllHiddenFeatures = function() {
    if (this.hiddenFeatures.features.size === 0) {
      this.updateStatus('No hidden elements to show', 'warning');
      return;
    }
    
    const count = this.hiddenFeatures.features.size;
    
    try {
      this.hiddenFeatures.features.forEach((hiddenData, featureId) => {
        try {
          hiddenData.feature.show = true;
          hiddenData.feature.color = hiddenData.originalColor;
        } catch (error) {
          console.warn(`⚠️ Could not restore feature ${featureId}:`, error.message);
        }
      });
      
      this.hiddenFeatures.features.clear();
      
      this.updateStatus(`${count} element(s) shown`, 'success');
      this.updateHiddenFeaturesList();
      this.updateHiddenFeaturesCount();
      
      console.log(`✅ ${count} hidden features restored`);
      
    } catch (error) {
      console.error('❌ Error showing all features:', error);
      this.updateStatus('Error showing all elements', 'error');
    }
  };

  // Update the list of hidden features in the UI
  BimViewer.updateHiddenFeaturesList = function() {
    const container = document.getElementById('hiddenFeaturesList');
    if (!container) return;
    
    if (this.hiddenFeatures.features.size === 0) {
      container.innerHTML = '<div class="text-center text-muted text-small">No hidden elements</div>';
      return;
    }
    
    let html = '';
    
    this.hiddenFeatures.features.forEach((hiddenData, featureId) => {
      const timeStr = hiddenData.timestamp.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit'
      });
      
      html += `
        <div class="hidden-feature-item">
          <div class="hidden-feature-info">
            <div class="hidden-feature-name">🚫 ${hiddenData.elementType}</div>
            <div class="hidden-feature-details">Hidden at ${timeStr}</div>
          </div>
          <div class="hidden-feature-controls">
            <button class="hidden-feature-btn show-btn" 
                    onclick="BimViewer.showHiddenFeature(${featureId})" 
                    title="Show element">
              👁️
            </button>
          </div>
        </div>
      `;
    });
    
    container.innerHTML = html;
  };

  // Update hidden features counter badge
  BimViewer.updateHiddenFeaturesCount = function() {
    const badge = document.getElementById('hiddenFeaturesCount');
    if (!badge) return;
    
    const count = this.hiddenFeatures.features.size;
    
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  };

  // Re-apply hidden state after style changes (e.g. IFC/Revit filter)
  // CesiumJS applies styles lazily during the next render pass, so we also
  // schedule a second pass via requestAnimationFrame.
  BimViewer.reapplyHiddenFeatures = function() {
    if (this.hiddenFeatures.features.size === 0) return;

    const apply = () => {
      this.hiddenFeatures.features.forEach((hiddenData) => {
        try {
          hiddenData.feature.show = false;
        } catch (error) {
          // Feature may have been unloaded
        }
      });
    };

    // Apply immediately
    apply();
    // Re-apply after CesiumJS processes the style in the next render pass
    requestAnimationFrame(apply);

    console.log(`🙈 Re-applied hidden state to ${this.hiddenFeatures.features.size} feature(s)`);
  };

  // Get current hide mode state
  BimViewer.getHiddenFeaturesState = function() {
    return {
      isHideMode: this.hiddenFeatures.isHideMode,
      hiddenCount: this.hiddenFeatures.features.size,
      features: Array.from(this.hiddenFeatures.features.entries())
    };
  };

  // ✅ FIXED: Store reference to ORIGINAL click handler WRAPPER
  BimViewer._originalClickHandler = null;

  // ✅ FIXED: Initialize hide features AFTER features.js is ready
  BimViewer.initHideFeatures = function() {
    console.log('🙈 Initializing Hide Features...');
    
    // Store original handler if not already stored
    if (!this._originalClickHandler && typeof this.handleIFCSelection === 'function') {
      this._originalClickHandler = this.handleIFCSelection.bind(this);
      console.log('✅ Original IFC selection handler stored');
    }
    
    // Replace with our wrapper
    this.handleIFCSelection = function(movement) {
      // If hide mode is active, hide the clicked feature instead
      if (this.hiddenFeatures.isHideMode) {
        try {
          const picked = this.viewer.scene.pick(movement.position);
          
          if (picked && picked instanceof Cesium.Cesium3DTileFeature) {
            this.hideFeature(picked);
          } else {
            this.updateStatus('No element found at click position', 'warning');
          }
        } catch (error) {
          console.error('❌ Error in hide mode click handler:', error);
          this.updateStatus('Error hiding element', 'error');
        }
        return; // Don't proceed with normal IFC selection
      }
      
      // Otherwise, use the original IFC selection handler
      if (this._originalClickHandler) {
        this._originalClickHandler(movement);
      }
    };
    
    console.log('✅ Hide Features click handler installed');
  };

  // Keyboard shortcuts
  document.addEventListener('keydown', (event) => {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
    
    const key = event.key.toLowerCase();
    
    // H = Toggle hide mode
    if (key === 'h' && !event.shiftKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      BimViewer.toggleHideMode();
    }
    
    // Shift+H = Show all hidden features
    if (key === 'h' && event.shiftKey) {
      event.preventDefault();
      BimViewer.showAllHiddenFeatures();
    }
  });

  console.log('✅ Hide Features module loaded');
  console.log('💡 Usage:');
  console.log('   - Press H to toggle hide mode');
  console.log('   - Press Shift+H to show all hidden elements');
  console.log('   - Click "🙈 Hide Elements" button in toolbar');

})();