// ===============================
// CESIUM BIM VIEWER - FEATURES MODULE (FIXED IFC FILTER v2.6)
// Drawing, Clipping, Saved Views, IFC Filtering with className Support
// v2.6: Removed auto-init - now called from index.html after viewer ready
// ===============================
'use strict';

(function() {
  
  console.log('🔧 Loading Features Module v2.6 (No Auto-Init)...');
  
  // Drawing & Clipping Functions
  BimViewer.enterDrawingMode = function() {
    this.drawing.active = true;
    this.drawing.positions = [];
    this.updateModeIndicator();
    console.log('✏️ Entered drawing mode');
  };

  BimViewer.exitDrawingMode = function() {
    this.drawing.active = false;
    this.updateModeIndicator();
    console.log('🔒 Exited drawing mode');
  };

  BimViewer.updateModeIndicator = function() {
    const indicator = document.getElementById('modeIndicator');
    if (indicator && this.drawing.active) {
      indicator.classList.add('active');
      indicator.innerHTML = `✏️ DRAWING MODE - Points: ${this.drawing.positions.length} (Click to add, ESC to stop)`;
    } else if (indicator) {
      indicator.classList.remove('active');
    }
  };

  BimViewer.applyClipping = function() {
    if (!this.drawing.positions || this.drawing.positions.length < 3) return;
    
    const clippingPolygons = new Cesium.ClippingPolygonCollection({
      polygons: [new Cesium.ClippingPolygon({ positions: this.drawing.positions })],
      enabled: true,
    });

    if (this.osmBuildings.tileset && this.osmBuildings.enabled) {
      this.osmBuildings.tileset.clippingPolygons = clippingPolygons;
    }
    
    this.loadedAssets.forEach((assetData) => {
      if (assetData.tileset && assetData.tileset.clippingPolygons !== undefined) {
        assetData.tileset.clippingPolygons = clippingPolygons;
      }
    });
    
    if (this.drawing.clipBoth) {
      this.viewer.scene.globe.clippingPolygons = clippingPolygons;
      if (this.googleTiles.tileset && this.googleTiles.enabled) {
        this.googleTiles.tileset.clippingPolygons = clippingPolygons;
      }
    } else {
      this.viewer.scene.globe.clippingPolygons = undefined;
      if (this.googleTiles.tileset) {
        this.googleTiles.tileset.clippingPolygons = undefined;
      }
    }
    
    this.updateStatus(`Clipping applied: ${this.drawing.clipBoth ? 'Buildings + Terrain' : 'Buildings Only'} (${this.drawing.positions.length} points)`, 'success');
  };

  BimViewer.clearClipping = function() {
    this.viewer.scene.globe.clippingPolygons = undefined;
    
    if (this.googleTiles.tileset) {
      this.googleTiles.tileset.clippingPolygons = undefined;
    }
    
    if (this.osmBuildings.tileset?.clippingPolygons) {
      this.osmBuildings.tileset.clippingPolygons.removeAll();
      this.osmBuildings.tileset.clippingPolygons.enabled = false;
    }
    
    this.loadedAssets.forEach((assetData) => {
      if (assetData.tileset?.clippingPolygons) {
        assetData.tileset.clippingPolygons.removeAll();
        assetData.tileset.clippingPolygons.enabled = false;
      }
    });
    
    console.log('✅ All clipping cleared');
  };

  BimViewer.updateClippingModeUI = function() {
    const clippingBtn = document.getElementById('toggleClipMode');
    if (clippingBtn) {
      clippingBtn.textContent = this.drawing.clipBoth ? '🌍 Buildings + Terrain' : '🏙️ Buildings Only';
      clippingBtn.classList.toggle('active', this.drawing.clipBoth);
    }
  };

  // Saved Views Functions
  BimViewer.saveView = function(slot = null) {
    if (slot === null) {
      slot = this.nextViewSlot;
      this.nextViewSlot++;
    }
    
    const camera = this.viewer.camera;
    
    this.viewer.scene.screenSpaceCameraController.enableInputs = false;
    
    setTimeout(() => {
      this.viewer.scene.screenSpaceCameraController.enableInputs = true;
    }, 100);
    
    const viewState = {
      position: Cesium.Cartesian3.clone(camera.position),
      direction: Cesium.Cartesian3.clone(camera.direction),
      up: Cesium.Cartesian3.clone(camera.up),
      right: Cesium.Cartesian3.clone(camera.right),
      timestamp: new Date(),
      googleTilesEnabled: this.googleTiles.enabled,
      clipBoth: this.drawing.clipBoth,
      hasPolygon: this.drawing.positions.length > 2
    };
    
    this.savedViews.set(slot, viewState);
    this.updateSavedViewsList();
    this.updateStatus(`View saved to slot ${slot}`, 'success');
    console.log(`📷 View saved to slot ${slot}`);
  };

  BimViewer.loadView = function(slot) {
    const viewState = this.savedViews.get(slot);
    if (!viewState) {
      this.updateStatus(`No view saved in slot ${slot}`, 'error');
      return;
    }
    
    this.viewer.camera.setView({
      destination: viewState.position,
      orientation: {
        direction: viewState.direction,
        up: viewState.up
      }
    });
    
    this.viewer.camera.position = Cesium.Cartesian3.clone(viewState.position);
    this.viewer.camera.direction = Cesium.Cartesian3.clone(viewState.direction);
    this.viewer.camera.up = Cesium.Cartesian3.clone(viewState.up);
    this.viewer.camera.right = Cesium.Cartesian3.clone(viewState.right);
    
    if (viewState.googleTilesEnabled !== this.googleTiles.enabled) {
      this.toggleGoogle3DTiles();
    }
    
    if (viewState.clipBoth !== this.drawing.clipBoth) {
      this.drawing.clipBoth = viewState.clipBoth;
      this.updateClippingModeUI();
      if (this.drawing.positions.length > 2) {
        this.applyClipping();
      }
    }
    
    this.updateStatus(`View ${slot} loaded`, 'success');
    console.log(`✅ View ${slot} loaded`);
  };

  BimViewer.deleteView = function(slot) {
    if (this.savedViews.has(slot)) {
      this.savedViews.delete(slot);
      this.updateSavedViewsList();
      this.updateStatus(`View ${slot} deleted`, 'success');
      console.log(`✅ View ${slot} deleted`);
    }
  };

  BimViewer.updateSavedViewsList = function() {
    const container = document.getElementById('savedViewsList');
    if (!container) return;
    
    if (this.savedViews.size === 0) {
      container.innerHTML = '<div class="text-center text-muted text-small">No saved views</div>';
      return;
    }
    
    let html = '';
    const sortedViews = Array.from(this.savedViews.entries()).sort((a, b) => a[0] - b[0]);
    
    sortedViews.forEach(([slot, viewState]) => {
      const timeStr = viewState.timestamp.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
      
      const cartographic = Cesium.Cartographic.fromCartesian(viewState.position);
      const height = Math.round(cartographic.height);
      
      html += `
        <div class="saved-view-item">
          <div class="saved-view-info">
            <div class="saved-view-name">📷 View ${slot}</div>
            <div class="saved-view-details">${timeStr} • ${height}m height</div>
          </div>
          <div class="saved-view-controls">
            <button class="saved-view-btn load-view-btn" onclick="BimViewer.loadView(${slot})" title="Load View (press ${slot})">👁️</button>
            <button class="saved-view-btn delete-view-btn" onclick="BimViewer.deleteView(${slot})" title="Delete View">🗑️</button>
          </div>
        </div>
      `;
    });
    
    container.innerHTML = html;
  };

  // ===============================
  // ✅ FIXED IFC FILTERING - v2.5 with className Support
  // ===============================
  
  // ✅ ENHANCED: Detect IFC Properties with extra wait time
  BimViewer.detectIFCProperties = async function(tileset) {
    console.log('🔍 Detecting IFC properties in tileset...');
    
    // Wait for tileset
    try {
      await tileset.readyPromise;
      
      // 🔧 FIX: Extra wait for tiles to load (CRITICAL!)
      console.log('⏳ Waiting 2 seconds for tiles to load...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      console.warn('⚠️ Tileset ready promise failed:', error);
    }
    
    // 🔧 FIX: className at first position - most common for IFC
    const possiblePropertyNames = [
      'className',        // Most common for IFC exports
      'IfcEntity', 
      'element_type',
      'IfcType',
      'IFC_Type',
      'Category',
      'class',
      'type',
      'ifcType',
      'entityType'
    ];
    
    const checkTileRecursive = (tile, depth = 0) => {
      if (depth > 5) return null;
      
      if (tile.content && tile.content.featuresLength > 0) {
        const featuresToCheck = Math.min(tile.content.featuresLength, 20);
        
        for (let i = 0; i < featuresToCheck; i++) {
          try {
            const feature = tile.content.getFeature(i);
            const propertyIds = feature.getPropertyIds();
            
            if (i === 0) {
              console.log(`📋 First feature properties (${propertyIds.length}):`, propertyIds);
            }
            
            for (const propName of possiblePropertyNames) {
              if (propertyIds.includes(propName)) {
                const value = feature.getProperty(propName);
                console.log(`✅ Found IFC property: "${propName}" = "${value}"`);
                return propName;
              }
            }
          } catch (error) {
            console.warn(`⚠️ Error checking feature ${i}:`, error.message);
          }
        }
      }
      
      if (tile.children && tile.children.length > 0) {
        for (const child of tile.children) {
          const found = checkTileRecursive(child, depth + 1);
          if (found) return found;
        }
      }
      
      return null;
    };
    
    const foundProperty = checkTileRecursive(tileset.root);
    
    if (foundProperty) {
      console.log(`🎯 IFC Property detected: "${foundProperty}"`);
      return foundProperty;
    } else {
      console.log('❌ No IFC properties found');
      return null;
    }
  };
  
  // ✅ ENHANCED: Apply IFC filter with better error handling
  BimViewer.applyIFCFilter = async function() {
    console.log('🎨 ============================================');
    console.log('🎨 Applying IFC Filter...');
    console.log(`🎨 Enabled entities: ${this.ifcFilter.enabledEntities.size}/${this.ifcFilter.allEntities.size}`);
    
    if (this.loadedAssets.size === 0) {
      console.warn('⚠️ No assets loaded, cannot apply IFC filter');
      return;
    }
    
    let filteredCount = 0;
    let assetsWithIFC = 0;
    
    for (const [assetId, assetData] of this.loadedAssets) {
      const tileset = assetData.tileset;
      
      if (!tileset) {
        console.warn(`⚠️ Asset ${assetId}: No tileset`);
        continue;
      }
      
      try {
        const opacity = assetData.opacity || 1.0;
        
        // ✅ Detect IFC property name if not already detected
        if (assetData.ifcPropertyName === undefined) {
          console.log(`🔍 Asset ${assetId}: Detecting IFC properties...`);
          
          try {
            assetData.ifcPropertyName = await this.detectIFCProperties(tileset);
            console.log(`📋 Asset ${assetId}: IFC property = ${assetData.ifcPropertyName || 'NONE'}`);
          } catch (detectError) {
            console.error(`❌ Asset ${assetId}: IFC detection failed:`, detectError);
            assetData.ifcPropertyName = null;
          }
        }
        
        const ifcPropertyName = assetData.ifcPropertyName;
        
        // No IFC properties found
        if (!ifcPropertyName) {
          console.log(`📋 Asset ${assetId}: No IFC properties - applying simple style`);
          tileset.style = new Cesium.Cesium3DTileStyle({
            color: `color('white', ${opacity})`,
            show: true
          });
          continue;
        }
        
        assetsWithIFC++;
        console.log(`📋 Asset ${assetId}: Has IFC properties - building filter...`);
        
        // Build show conditions
        const showConditions = [];
        this.ifcFilter.enabledEntities.forEach(entity => {
          showConditions.push(`\${${ifcPropertyName}} === '${entity}'`);
        });
        
        console.log(`📋 Asset ${assetId}: Show conditions count: ${showConditions.length}`);
        
        // Build color conditions
        const colorConditions = [];
        IFC_ENTITIES.forEach(entityInfo => {
          if (this.ifcFilter.enabledEntities.has(entityInfo.entity)) {
            const finalOpacity = entityInfo.entity === 'IfcWindow' ? Math.min(0.7, opacity) : opacity;
            colorConditions.push([
              `\${${ifcPropertyName}} === '${entityInfo.entity}'`,
              `color('${entityInfo.color}', ${finalOpacity})`
            ]);
          }
        });
        
        // Default color for unmatched entities
        colorConditions.push(["true", `color('white', ${opacity})`]);
        
        console.log(`📋 Asset ${assetId}: Color conditions count: ${colorConditions.length}`);

        // Apply style
        if (showConditions.length > 0) {
          const styleConfig = {
            show: showConditions.join(' || '),
            color: { conditions: colorConditions }
          };
          
          console.log(`📋 Asset ${assetId}: Applying style...`);
          console.log('Style show expression:', styleConfig.show);
          
          tileset.style = new Cesium.Cesium3DTileStyle(styleConfig);
          
          filteredCount++;
          console.log(`✅ Asset ${assetId}: Filter applied successfully`);
        } else {
          // All entities disabled
          console.log(`🚫 Asset ${assetId}: All entities disabled - hiding tileset`);
          tileset.style = new Cesium.Cesium3DTileStyle({
            show: false
          });
        }
        
      } catch (error) {
        console.error(`❌ Asset ${assetId}: Error applying IFC filter:`, error);
        console.error('Error stack:', error.stack);
        
        // Fallback to simple style
        try {
          const opacity = assetData.opacity || 1.0;
          tileset.style = new Cesium.Cesium3DTileStyle({
            color: `color('white', ${opacity})`,
            show: true
          });
          console.log(`✅ Asset ${assetId}: Applied fallback style`);
        } catch (fallbackError) {
          console.error(`❌ Asset ${assetId}: Even fallback failed:`, fallbackError);
        }
      }
    }
    
    console.log(`✅ IFC Filter complete: ${filteredCount} assets filtered, ${assetsWithIFC} with IFC properties`);
    console.log('🎨 ============================================');
    
    this.updateEntityCounts();
  };

  // ✅ Manual IFC Property Override
  BimViewer.setManualIFCProperty = function(assetId, propertyName) {
    const assetData = this.loadedAssets.get(assetId.toString());
    if (!assetData) {
      console.error(`❌ Asset ${assetId} not found`);
      return false;
    }
    
    console.log(`🔧 Manually setting IFC property for asset ${assetId}: "${propertyName}"`);
    assetData.ifcPropertyName = propertyName;
    
    // Apply filter immediately
    this.applyIFCFilter();
    return true;
  };

  // ✅ Test function for manual debugging
  BimViewer.testIFCFilter = function() {
    console.log('🧪 ============================================');
    console.log('🧪 MANUAL IFC FILTER TEST');
    console.log('🧪 ============================================');
    console.log(`Assets loaded: ${this.loadedAssets.size}`);
    console.log(`Enabled entities: ${this.ifcFilter.enabledEntities.size}`);
    console.log(`Total entities: ${this.ifcFilter.allEntities.size}`);
    
    this.loadedAssets.forEach((assetData, assetId) => {
      console.log(`\nAsset ${assetId}:`);
      console.log(`  - Has tileset: ${!!assetData.tileset}`);
      console.log(`  - IFC property name: ${assetData.ifcPropertyName || 'NOT DETECTED'}`);
      console.log(`  - Opacity: ${assetData.opacity}`);
    });
    
    console.log('\n🔄 Applying IFC filter now...');
    this.applyIFCFilter();
  };

  BimViewer.updateEntityCounts = function() {
    const activeCount = this.ifcFilter.enabledEntities.size;
    const totalCount = this.ifcFilter.allEntities.size;
    
    const activeCountElement = document.getElementById('activeEntityCount');
    const totalCountElement = document.getElementById('totalEntityCount');
    
    if (activeCountElement) activeCountElement.textContent = activeCount;
    if (totalCountElement) totalCountElement.textContent = totalCount;
    
    console.log(`📊 Entity counts updated: ${activeCount}/${totalCount} active`);
  };

  // ===============================
  // CLICK HANDLER
  // ===============================
  BimViewer.initClickHandler = function() {
    console.log('🖱️ Initializing click handler...');
    
    const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    
    handler.setInputAction((movement) => {
      // Skip if in measurement mode
      if (this.isMeasuring && this.isMeasuring()) {
        return;
      }
      
      // Handle drawing mode
      if (this.drawing.active) {
        const cartesian = this.viewer.scene.pickPosition(movement.position);
        if (cartesian) {
          this.drawing.positions.push(cartesian);
          this.updateModeIndicator();
          
          if (this.drawing.positions.length > 2) {
            if (this.drawing.polygon) {
              this.viewer.entities.remove(this.drawing.polygon);
            }
            
            this.drawing.polygon = this.viewer.entities.add({
              polygon: {
                hierarchy: new Cesium.CallbackProperty(() => 
                  new Cesium.PolygonHierarchy(this.drawing.positions), false),
                material: Cesium.Color.RED.withAlpha(0.5),
                outline: true,
                outlineColor: Cesium.Color.RED
              },
              show: this.drawing.visible
            });
            
            this.applyClipping();
            this.updateStatus(`Polygon with ${this.drawing.positions.length} points created`, 'success');
          } else {
            this.updateStatus(`Drawing: ${this.drawing.positions.length} points - need ${3 - this.drawing.positions.length} more`, 'loading');
          }
        }
        return;
      }

      // Handle IFC/Feature selection
      this.handleIFCSelection(movement);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    
    console.log('✅ Click handler initialized');
    
    // Initialize hide features AFTER click handler is ready
    if (typeof this.initHideFeatures === 'function') {
      setTimeout(() => {
        this.initHideFeatures();
      }, 100);
    }
  };

  BimViewer.handleIFCSelection = function(movement) {
    try {
      console.log('🎯 IFC Selection handler triggered');
      
      // Reset previous selection
      if (this.selectedFeature) {
        try {
          this.selectedFeature.color = this.selectedOriginalColor;
        } catch (error) {
          console.warn('⚠️ Could not reset previous feature color:', error.message);
        }
        this.selectedFeature = undefined;
      }

      // Pick feature at click position
      const picked = this.viewer.scene.pick(movement.position);

      if (picked && picked instanceof Cesium.Cesium3DTileFeature) {
        console.log('🎯 Feature picked:', picked);
        
        this.selectedFeature = picked;
        
        // Highlight the feature
        try {
          Cesium.Color.clone(picked.color, this.selectedOriginalColor);
          picked.color = Cesium.Color.LIME;
          console.log('✅ Feature highlighted');
        } catch (error) {
          console.warn('⚠️ Could not change feature color:', error.message);
        }

        // Extract properties
        const properties = {};
        let ids = [];
        
        try {
          ids = picked.getPropertyIds();
          console.log(`📋 Found ${ids.length} properties:`, ids);
        } catch (error) {
          console.warn('⚠️ Could not get property IDs:', error.message);
        }
        
        ids.forEach(id => {
          try {
            const value = picked.getProperty(id);
            if (value !== undefined && value !== null) {
              properties[id] = value;
            }
          } catch (error) {
            console.warn(`⚠️ Could not get property ${id}:`, error.message);
          }
        });

        console.log('📋 Properties extracted:', properties);

        // Display properties in info box
        this.displayIFCProperties(properties);
        
        const elementType = properties.className || properties.IfcEntity || properties.element_type || properties.building || 'Element';
        this.updateStatus(`Element selected: ${elementType}`, 'success');
      } else {
        console.log('❌ No feature picked');
        
        // Clear info box
        const infoBox = document.getElementById('infoBoxCustom');
        if (infoBox) {
          infoBox.innerHTML = '';
          infoBox.className = '';
        }
      }
    } catch (error) {
      console.error('❌ Error in click handler:', error);
      const infoBox = document.getElementById('infoBoxCustom');
      if (infoBox) {
        infoBox.innerHTML = '';
        infoBox.className = '';
      }
      this.updateStatus('Error during element selection', 'error');
    }
  };

  // ===============================
  // PROPERTY DISPLAY
  // ===============================
  BimViewer.displayIFCProperties = function(properties) {
    console.log('📋 Displaying IFC properties...');
    
    const infoBox = document.getElementById('infoBoxCustom');
    if (!infoBox) {
      console.error('❌ Info box not found!');
      return;
    }
    
    const getValue = (propNames) => {
      if (!Array.isArray(propNames)) propNames = [propNames];
      for (const prop of propNames) {
        if (properties[prop] !== undefined && properties[prop] !== null && properties[prop] !== '') {
          return properties[prop];
        }
      }
      return 'n/a';
    };
    
    const isOSMBuilding = properties.building !== undefined || 
                          properties['building:levels'] !== undefined ||
                          properties['addr:street'] !== undefined;
    
    console.log(`📋 Element type: ${isOSMBuilding ? 'OSM Building' : 'IFC Element'}`);
    
    let html = '<span class="close-btn" onclick="this.parentNode.innerHTML=\'\'; this.parentNode.className=\'\';">&times;</span>';
    
    html += '<table class="bim-property-table">';
    html += '<tr class="bim-header-row">';
    html += '<th class="bim-header-cell" style="width: 45%;">Property</th>';
    html += '<th class="bim-header-cell" style="width: 55%;">Value</th>';
    html += '</tr>';

    let propertySets = {};
    
    if (isOSMBuilding) {
      propertySets = {
        'building_info': {
          title: '🏢 OSM Building Information',
          props: {
            'Building Type': ['building'],
            'Levels': ['building:levels'],
            'Height': ['height'],
            'Min Height': ['min_height'],
            'Name': ['name'],
            'Description': ['description']
          },
          expanded: true
        },
        'address': {
          title: '📍 Address',
          props: {
            'Street': ['addr:street'],
            'House Number': ['addr:housenumber'],
            'Postcode': ['addr:postcode'],
            'City': ['addr:city'],
            'Country': ['addr:country']
          },
          expanded: true
        },
        'construction': {
          title: '🏗️ Construction',
          props: {
            'Material': ['building:material'],
            'Roof Shape': ['roof:shape'],
            'Roof Material': ['roof:material'],
            'Roof Color': ['roof:colour'],
            'Facade Color': ['building:colour']
          },
          expanded: false
        }
      };
    } else {
      propertySets = {
        'identification': {
          title: '🏷️ Identification & Classification',
          props: {
            'Global ID': ['globalId', 'GlobalId', 'Guid'],
            'Name': ['name', 'Name'],
            'Tag': ['tag', 'Tag'],
            'IFC Entity': ['className', 'IfcEntity', 'element_type', 'IfcType', 'IFC_Type'],
            'Object Type': ['objectType', 'ObjectType'],
            'Description': ['description', 'Description'],
            'Predefined Type': ['predefinedType', 'PredefinedType']
          },
          expanded: true
        },
        'geometry': {
          title: '📐 Geometry & Position',
          props: {
            'Level / Storey': ['Level', 'StoreyName', 'level'],
            'Elevation': ['Elevation', 'elevation'],
            'Height': ['Height', 'height'],
            'Width': ['Width', 'width'],
            'Length': ['Length', 'length'],
            'Thickness': ['Thickness', 'thickness'],
            'Area': ['Area', 'area'],
            'Volume': ['Volume', 'volume'],
            'Net Area': ['NetArea', 'netArea'],
            'Gross Area': ['GrossArea', 'grossArea']
          },
          expanded: false
        },
        'material': {
          title: '🧱 Material & Construction',
          props: {
            'Material': ['Material', 'MaterialName', 'material'],
            'Layer Set': ['LayerSetName', 'layerSetName'],
            'Construction Type': ['Construction', 'ConstructionType', 'construction'],
            'Finish': ['Finish', 'finish'],
            'Color': ['Color', 'color']
          },
          expanded: false
        },
        'physics': {
          title: '🔥 Building Physics & Properties',
          props: {
            'Is External': ['isExternal', 'IsExternal', 'psetWallCommonIsExternal'],
            'Load Bearing': ['loadBearing', 'LoadBearing', 'psetWallCommonLoadBearing', 'psetSlabCommonLoadBearing', 'psetBeamCommonLoadBearing'],
            'Fire Rating': ['FireRating', 'fireRating'],
            'Thermal Transmittance': ['ThermalTransmittance', 'thermalTransmittance'],
            'Acoustic Rating': ['AcousticRating', 'acousticRating'],
            'Combustible': ['Combustible', 'combustible']
          },
          expanded: false
        },
        'manufacturer': {
          title: '🏭 Manufacturer & Product',
          props: {
            'Manufacturer': ['Manufacturer', 'manufacturer'],
            'Model': ['Model', 'model'],
            'Reference': ['Reference', 'reference', 'psetWallCommonReference', 'psetSlabCommonReference', 'psetBeamCommonReference'],
            'Status': ['Status', 'status'],
            'Acquisition Date': ['AcquisitionDate', 'acquisitionDate']
          },
          expanded: false
        }
      };
    }

    const usedProps = new Set();
    let totalPropertyCount = 0;

    Object.entries(propertySets).forEach(([setKey, setConfig]) => {
      const categoryId = `category_${setKey}`;
      const expandIcon = setConfig.expanded ? '▼' : '▶';
      
      let hasValues = false;
      Object.entries(setConfig.props).forEach(([displayName, propNames]) => {
        const value = getValue(propNames);
        if (value !== 'n/a') hasValues = true;
        
        if (!Array.isArray(propNames)) propNames = [propNames];
        propNames.forEach(prop => {
          if (properties[prop] !== undefined) usedProps.add(prop);
        });
      });
      
      html += `<tr class="bim-category-row" onclick="BimViewer.togglePropertyCategory('${categoryId}')">`;
      html += `<td class="bim-category-cell" colspan="2">`;
      html += `<span class="bim-expand-icon" id="icon_${categoryId}">${expandIcon}</span>${setConfig.title}`;
      html += `</td></tr>`;

      Object.entries(setConfig.props).forEach(([displayName, propNames]) => {
        const value = getValue(propNames);
        const valueClass = value === 'n/a' ? 'bim-property-value-na' : 'bim-property-value';
        
        html += `<tr class="bim-property-row ${categoryId}_props" ${!setConfig.expanded ? 'style="display:none;"' : ''}>`;
        html += `<td class="bim-property-name">${displayName}</td>`;
        html += `<td class="${valueClass}">${value}</td>`;
        html += '</tr>';
        
        totalPropertyCount++;
      });
    });

    const otherProps = Object.keys(properties).filter(prop => !usedProps.has(prop));
    
    if (otherProps.length > 0) {
      const categoryId = 'Other_Properties';
      const expandIcon = '▼';
      
      html += `<tr class="bim-category-row" onclick="BimViewer.togglePropertyCategory('${categoryId}')">`;
      html += `<td class="bim-category-cell" colspan="2">`;
      html += `<span class="bim-expand-icon" id="icon_${categoryId}">${expandIcon}</span>📦 Other Properties (${otherProps.length})`;
      html += `</td></tr>`;
      
      otherProps.forEach(prop => {
        const value = properties[prop];
        const displayValue = value === undefined ? '<i style="color:#888;">undefined</i>' : 
                            value === null ? '<i style="color:#888;">null</i>' : 
                            value === '' ? '<i style="color:#888;">empty</i>' : 
                            value;
        
        html += `<tr class="bim-property-row ${categoryId}_props">`;
        html += `<td class="bim-property-name">${prop}</td>`;
        html += `<td class="bim-property-value">${displayValue}</td>`;
        html += '</tr>';
        
        totalPropertyCount++;
      });
    }

    html += '</table>';
    
    infoBox.innerHTML = html;
    
    infoBox.className = '';
    if (totalPropertyCount <= 10) {
      infoBox.classList.add('compact');
    } else if (totalPropertyCount <= 20) {
      infoBox.classList.add('medium');
    } else {
      infoBox.classList.add('large');
    }
    
    const elementType = isOSMBuilding ? 'OSM Building' : 'IFC Element';
    console.log(`✅ ${elementType} - Total properties displayed: ${totalPropertyCount} (${Object.keys(properties).length} available)`);
  };

  BimViewer.togglePropertyCategory = function(categoryId) {
    const rows = document.querySelectorAll(`.${categoryId}_props`);
    const icon = document.getElementById(`icon_${categoryId}`);
    if (!rows.length || !icon) return;
    
    const isHidden = rows[0].style.display === 'none';
    
    rows.forEach(row => {
      row.style.display = isHidden ? '' : 'none';
    });
    
    icon.textContent = isHidden ? '▼' : '▶';
  };

  // ===============================
  // INITIALIZATION
  // ===============================
  BimViewer.initFeatures = function() {
    if (!this.viewer || !this.viewer.scene) {
      console.warn('⚠️ initFeatures called but viewer not ready yet');
      return false;
    }
    
    console.log('🚀 Initializing features...');
    this.initClickHandler();
    this.updateSavedViewsList();
    console.log('✅ Features initialized');
    console.log('💡 TIP: Use BimViewer.testIFCFilter() in console to test IFC filtering');
    return true;
  };
  
  // ✅ CHANGED v2.6: Don't auto-init - will be called from index.html after viewer is ready
  console.log('📋 Features module ready - waiting for BimViewer.initFeatures() call');

})();

console.log('✅ Features module loaded - v2.6 (No Auto-Init)');
