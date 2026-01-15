// ===============================
// CESIUM BIM VIEWER - MODERN UI MODULE v3.2 (INTEGRATED Z-OFFSET) - COMPLETE
// Minimalist Design with Collapsible Sections
// NEW: Z-Offset controls directly in asset list (-70m to +70m)
// ===============================
'use strict';

const BimViewerUI = {
  // Track expanded sections
  expandedSections: new Set(['assets']), // Only assets open by default
  
  // Initialize UI
  init() {
    try {
      this.createModernToolbar();
      this.initEventHandlers();
      this.initCollapseHandlers();
      console.log('✅ Modern BIM Viewer UI initialized v3.2 (Integrated Z-Offset -70m to +70m)');
    } catch (error) {
      console.error('❌ Failed to initialize UI:', error);
    }
  },

  // Create modern minimalist toolbar
  createModernToolbar() {
    const toolbar = document.getElementById("toolbar");
    if (!toolbar) {
      console.error('❌ Toolbar element not found');
      return;
    }
    
    // Clear existing content
    toolbar.innerHTML = '';
    
    // Header
    toolbar.appendChild(this.createHeader());
    
    // Collapsible sections
    toolbar.appendChild(this.createSection('assets', '📦', 'Assets', this.getAssetsContent()));
    toolbar.appendChild(this.createSection('lighting', '☀️', 'Lighting & Time', this.getLightingContent()));
    toolbar.appendChild(this.createSection('pointcloud', '☁️', 'Point Cloud Settings', this.getPointCloudContent()));
    toolbar.appendChild(this.createSection('drawing', '✏️', 'Drawing & Clipping', this.getDrawingContent()));
    toolbar.appendChild(this.createSection('comments', '💬', 'Comments', this.getCommentsContent()));
    toolbar.appendChild(this.createSection('visibility', '👁️', 'Visibility', this.getVisibilityContent()));
    toolbar.appendChild(this.createSection('ifc', '🏗️', 'IFC Filter', this.getIFCContent()));
    toolbar.appendChild(this.createSection('views', '📷', 'Saved Views', this.getViewsContent()));
    toolbar.appendChild(this.createSection('settings', '⚙️', 'Settings', this.getSettingsContent()));
  },

  // Create header
  createHeader() {
    const header = document.createElement('div');
    header.className = 'modern-header';
    header.innerHTML = `
      <div class="modern-header-content">
        <div class="modern-logo">
          <span class="modern-logo-icon">🏗️</span>
          <div class="modern-logo-text">
            <div class="modern-logo-title">CESIUM BIM</div>
            <div class="modern-logo-subtitle">Ultra Viewer</div>
          </div>
        </div>
      </div>
    `;
    return header;
  },

  // Create collapsible section
  createSection(id, icon, title, content) {
    const isExpanded = this.expandedSections.has(id);
    
    const section = document.createElement('div');
    section.className = 'modern-section';
    section.innerHTML = `
      <div class="modern-section-header" data-section="${id}">
        <div class="modern-section-title">
          <span class="modern-section-icon">${icon}</span>
          <span>${title}</span>
        </div>
        <span class="modern-section-toggle">${isExpanded ? '▼' : '▶'}</span>
      </div>
      <div class="modern-section-content ${isExpanded ? 'expanded' : 'collapsed'}">
        ${content}
      </div>
    `;
    return section;
  },

  // Assets content
  getAssetsContent() {
    return `
      <div class="modern-group">
        <div class="modern-label">🌍 Cesium Ion Assets</div>
        <button id="loadIonAssets" class="modern-btn modern-btn-primary">
          <span class="modern-btn-icon">🌍</span>
          <span>Load Ion Assets</span>
        </button>
        
        <select id="ionAssetSelector" class="modern-select">
          <option value="">-- Select an asset --</option>
        </select>
        
        <button id="importSelectedAsset" class="modern-btn modern-btn-primary" disabled>
          <span class="modern-btn-icon">➕</span>
          <span>Import Selected</span>
        </button>
      </div>
      
      <div class="modern-divider">
        <span class="modern-divider-text">or import by ID</span>
      </div>
      
      <div class="modern-group">
        <input type="text" id="assetNameInput" placeholder="Asset Name (optional)" class="modern-input">
        <input type="number" id="assetIdInput" placeholder="Ion Asset ID" class="modern-input">
        <button id="importAssetById" class="modern-btn modern-btn-primary">
          <span class="modern-btn-icon">➕</span>
          <span>Import by ID</span>
        </button>
      </div>
      
      <div class="modern-divider">
        <span class="modern-divider-text">🏗️ iTwin Models</span>
      </div>
      
      <div class="modern-group">
        <div class="modern-hint" style="margin-bottom: 8px;">
          <strong>📝 Both fields required:</strong><br>
          Share Key for the iTwin Project<br>
          iModel ID for the specific Model
        </div>
        
        <input type="text" id="iTwinShareKeyInput" placeholder="iTwin Share Key (eyJhbGci...)" class="modern-input" style="font-family: monospace; font-size: 11px;">
        <input type="text" id="iTwinModelIdInput" placeholder="iModel ID (d57113ce-...)" class="modern-input" style="font-family: monospace; font-size: 11px;">
        <input type="text" id="iTwinModelNameInput" placeholder="Model Name (optional)" class="modern-input">
        <button id="importITwinModel" class="modern-btn modern-btn-itwin">
          <span class="modern-btn-icon">🏗️</span>
          <span>Import iTwin Model</span>
        </button>
      </div>
      
      <div class="modern-hint" style="margin-top: 8px;">
        <strong>💡 How to get:</strong><br>
        <strong>Share Key:</strong> iTwin Platform API<br>
        <strong>iModel ID:</strong> From iTwin project
      </div>
      
      <div id="loadedAssetsList" class="modern-assets-list"></div>
    `;
  },

  // Lighting & Time content
  getLightingContent() {
    return `
      <div class="modern-group">
        <div class="modern-label">☀️ Dynamic Lighting</div>
        
        <button id="toggleDynamicLighting" class="modern-btn modern-btn-primary">
          <span class="modern-btn-icon">🌅</span>
          <span>Enable Lighting</span>
        </button>
        
        <div id="lightingControls" style="display: none; margin-top: 12px;">
          <div class="modern-label-small">Night Brightness</div>
          <select id="ambientLightMode" class="modern-select" style="margin-bottom: 12px;">
            <option value="realistic" selected>🌙 Realistic (Dark at Night)</option>
            <option value="soft">🌆 Soft (Slightly Visible)</option>
            <option value="balanced">🌃 Balanced (Moderately Lit)</option>
            <option value="bright">💡 Bright (Always Visible)</option>
          </select>
          
          <div class="modern-hint" style="margin-bottom: 12px; font-size: 10px;">
            <strong>🌙 Realistic:</strong> Assets are completely dark at night (like real life)<br>
            <strong>🌆 Soft:</strong> Slight ambient glow at night (subtle)<br>
            <strong>🌃 Balanced:</strong> Moderate visibility at night<br>
            <strong>💡 Bright:</strong> Always bright (default Cesium)
          </div>
          
          <div class="modern-label-small">Time of Day</div>
          
          <div class="modern-time-presets">
            <button class="modern-time-btn" data-time="dawn" title="6:00 AM">🌄 Dawn</button>
            <button class="modern-time-btn" data-time="morning" title="9:00 AM">🌞 Morning</button>
            <button class="modern-time-btn" data-time="noon" title="12:00 PM">☀️ Noon</button>
            <button class="modern-time-btn" data-time="afternoon" title="3:00 PM">🌤️ Afternoon</button>
            <button class="modern-time-btn" data-time="sunset" title="6:00 PM">🌇 Sunset</button>
            <button class="modern-time-btn" data-time="dusk" title="7:30 PM">🌆 Dusk</button>
            <button class="modern-time-btn" data-time="night" title="11:00 PM">🌙 Night</button>
            <button class="modern-time-btn" data-time="midnight" title="12:00 AM">🌃 Midnight</button>
          </div>
          
          <div style="margin-top: 12px;">
            <div class="modern-label-small">Time Animation</div>
            <div class="modern-btn-group">
              <button id="toggleTimeAnimation" class="modern-btn modern-btn-small">
                <span class="modern-btn-icon">▶️</span>
                <span>Play</span>
              </button>
              <button id="stopTimeAnimation" class="modern-btn modern-btn-small">
                <span class="modern-btn-icon">⏸️</span>
                <span>Pause</span>
              </button>
            </div>
            
            <div style="margin-top: 8px;">
              <label class="modern-label-small">
                Speed: <span id="timeSpeedValue">100x</span>
              </label>
              <input type="range" 
                     id="timeSpeedSlider" 
                     class="modern-slider"
                     min="1" 
                     max="1000" 
                     value="100"
                     style="width: 100%;">
            </div>
          </div>
          
          <div class="modern-hint" style="margin-top: 12px;">
            <strong>💡 Tip:</strong> Set to "Realistic" and try "🌙 Night" preset to see assets become completely dark!
          </div>
        </div>
      </div>
    `;
  },

  // Point Cloud Settings content
  getPointCloudContent() {
    return `
      <div class="modern-group">
        <div class="modern-label">Presets</div>
        <div class="modern-btn-group-3">
          <button class="modern-btn modern-btn-small" onclick="BimViewer.applyPointCloudPreset('quality')">
            <span class="modern-btn-icon">💎</span>
            <span>Quality</span>
          </button>
          <button class="modern-btn modern-btn-small" onclick="BimViewer.applyPointCloudPreset('performance')">
            <span class="modern-btn-icon">⚡</span>
            <span>Speed</span>
          </button>
          <button class="modern-btn modern-btn-small" onclick="BimViewer.applyPointCloudPreset('detailed')">
            <span class="modern-btn-icon">🔍</span>
            <span>Detail</span>
          </button>
        </div>
      </div>
      
      <div class="modern-divider">
        <span class="modern-divider-text">Color Mode</span>
      </div>
      
      <div class="modern-group">
        <div class="modern-label">Point Colors</div>
        <select id="colorModeSelect" class="modern-select" onchange="BimViewer.setColorMode(this.value)">
          <option value="rgb" selected>🎨 Original RGB Colors</option>
          <option value="height">📏 Height-based</option>
          <option value="intensity">💡 Intensity-based</option>
          <option value="classification">🏷️ Classification</option>
        </select>
      </div>
      
      <div class="modern-divider">
        <span class="modern-divider-text">Eye Dome Lighting (EDL)</span>
      </div>
      
      <div class="modern-group">
        <button id="toggleEDL" class="modern-toggle-btn active" onclick="BimViewer.setEyeDomeLighting(!BimViewer.pointCloudSettings.edlEnabled)">
          <span class="modern-btn-icon">💡</span>
          <span>Enable EDL</span>
        </button>
        
        <div class="modern-slider-group">
          <label class="modern-label-small">EDL Strength</label>
          <input type="range" id="edlStrengthSlider" min="0" max="3" step="0.1" value="1" 
                 oninput="BimViewer.setEDLStrength(this.value); document.getElementById('edlStrengthValue').textContent = parseFloat(this.value).toFixed(1)" 
                 class="modern-slider-small">
          <span id="edlStrengthValue" class="modern-value-small">1.0</span>
        </div>
        
        <div class="modern-slider-group">
          <label class="modern-label-small">EDL Radius</label>
          <input type="range" id="edlRadiusSlider" min="0.5" max="3" step="0.1" value="1" 
                 oninput="BimViewer.setEDLRadius(this.value); document.getElementById('edlRadiusValue').textContent = parseFloat(this.value).toFixed(1)" 
                 class="modern-slider-small">
          <span id="edlRadiusValue" class="modern-value-small">1.0</span>
        </div>
      </div>
      
      <div class="modern-divider">
        <span class="modern-divider-text">Point Appearance</span>
      </div>
      
      <div class="modern-group">
        <div class="modern-slider-group">
          <label class="modern-label-small">Point Size</label>
          <input type="range" id="pointSizeSlider" min="0.5" max="10" step="0.5" value="2" 
                 oninput="BimViewer.setPointSize(this.value); document.getElementById('pointSizeValue').textContent = parseFloat(this.value).toFixed(1)" 
                 class="modern-slider-small">
          <span id="pointSizeValue" class="modern-value-small">2.0</span>
        </div>
      </div>
      
      <div class="modern-divider">
        <span class="modern-divider-text">Distance Attenuation</span>
      </div>
      
      <div class="modern-group">
        <button id="toggleAttenuation" class="modern-toggle-btn active" onclick="BimViewer.setAttenuation(!BimViewer.pointCloudSettings.attenuationEnabled)">
          <span class="modern-btn-icon">📐</span>
          <span>Enable Attenuation</span>
        </button>
        
        <div class="modern-slider-group">
          <label class="modern-label-small">Maximum Attenuation</label>
          <input type="range" id="maxAttenuationSlider" min="1" max="10" step="0.5" value="1" 
                 oninput="BimViewer.setMaximumAttenuation(this.value); document.getElementById('maxAttenuationValue').textContent = this.value == 1 ? 'None' : parseFloat(this.value).toFixed(1)" 
                 class="modern-slider-small">
          <span id="maxAttenuationValue" class="modern-value-small">None</span>
        </div>
      </div>
      
      <div class="modern-divider">
        <span class="modern-divider-text">Advanced</span>
      </div>
      
      <div class="modern-group">
        <div class="modern-slider-group">
          <label class="modern-label-small">Geometric Error Scale</label>
          <input type="range" id="geometricErrorSlider" min="0.5" max="3" step="0.1" value="1" 
                 oninput="BimViewer.setGeometricErrorScale(this.value); document.getElementById('geometricErrorValue').textContent = parseFloat(this.value).toFixed(1)" 
                 class="modern-slider-small">
          <span id="geometricErrorValue" class="modern-value-small">1.0</span>
        </div>
        
        <button id="toggleBackFaceCulling" class="modern-toggle-btn" onclick="BimViewer.setBackFaceCulling(!BimViewer.pointCloudSettings.backFaceCulling)">
          <span class="modern-btn-icon">🔄</span>
          <span>Back Face Culling</span>
        </button>
        
        <button class="modern-btn modern-btn-danger" onclick="BimViewer.resetPointCloudSettings()">
          <span class="modern-btn-icon">🔄</span>
          <span>Reset to Defaults</span>
        </button>
      </div>
      
      <div class="modern-hint">
        <strong>🎨 RGB Colors</strong> are preserved by default<br>
        <strong>💡 EDL</strong> improves depth perception<br>
        <strong>📐 Attenuation</strong> adjusts point size by distance<br>
        <strong>⚙️ Geometric Error</strong> controls detail level
      </div>
    `;
  },

  // Drawing & Clipping content
  getDrawingContent() {
    return `
      <div class="modern-group">
        <button id="startDrawing" class="modern-btn modern-btn-accent">
          <span class="modern-btn-icon">✏️</span>
          <span>Start Drawing</span>
        </button>
        <button id="stopDrawing" class="modern-btn modern-btn-success hidden">
          <span class="modern-btn-icon">✅</span>
          <span>Stop Drawing</span>
        </button>
      </div>
      
      <div class="modern-group">
        <button id="togglePolygon" class="modern-btn modern-btn-secondary">
          <span class="modern-btn-icon">👁️</span>
          <span>Toggle Polygon</span>
        </button>
        <button id="clearPolygon" class="modern-btn modern-btn-danger">
          <span class="modern-btn-icon">🗑️</span>
          <span>Clear Polygon</span>
        </button>
      </div>
      
      <div class="modern-info-box">
        <div class="modern-label">Clipping Mode:</div>
        <button id="toggleClipMode" class="modern-toggle-btn">
          <span class="modern-btn-icon">🏙️</span>
          <span>Buildings Only</span>
        </button>
      </div>
      
      <div class="modern-hint">
        <strong>Usage:</strong> Click map to add points • ESC to exit
      </div>
    `;
  },

  // Comments content
  getCommentsContent() {
    return `
      <div class="modern-group">
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
      
      <div class="modern-hint">
        <strong>RIGHT-CLICK</strong> on 3D model to place comment<br>
        <strong>LEFT-CLICK</strong> for element info • <strong>C</strong> to toggle • <strong>ESC</strong> to cancel
      </div>
      
      <div class="modern-label" style="margin-top: 12px;">
        Recent Comments
        <span id="commentsListStatus" class="modern-status">Loading...</span>
      </div>
      <div id="commentsList" class="modern-comments-list">
        <div class="modern-empty-state">Initializing...</div>
      </div>
    `;
  },

  // Visibility content (Hidden Elements + Hide Mode)
  getVisibilityContent() {
    return `
      <div class="modern-group">
        <button id="toggleHideMode" class="modern-btn modern-btn-danger">
          <span class="modern-btn-icon">🙈</span>
          <span>Hide Elements</span>
          <span id="hiddenFeaturesCount" class="modern-badge" style="display: none;">0</span>
        </button>
        
        <button id="showAllHidden" class="modern-btn modern-btn-success">
          <span class="modern-btn-icon">👁️</span>
          <span>Show All Hidden</span>
        </button>
      </div>
      
      <div class="modern-hint">
        <strong>H</strong> to toggle hide mode • <strong>Shift+H</strong> to show all
      </div>
      
      <div class="modern-label" style="margin-top: 12px;">Hidden Elements</div>
      <div id="hiddenFeaturesList" class="modern-hidden-list">
        <div class="modern-empty-state">No hidden elements</div>
      </div>
    `;
  },

  // IFC Filter content
  getIFCContent() {
    return `
      <div class="modern-group">
        <button id="selectAllIFC" class="modern-btn modern-btn-secondary">
          <span class="modern-btn-icon">✅</span>
          <span>Select All</span>
        </button>
        <button id="deselectAllIFC" class="modern-btn modern-btn-secondary">
          <span class="modern-btn-icon">❌</span>
          <span>Deselect All</span>
        </button>
      </div>
      
      <div id="ifcFiltersList" class="modern-ifc-filters">
        <!-- Will be populated dynamically -->
      </div>
    `;
  },

  // Saved Views content
  getViewsContent() {
    return `
      <div class="modern-group">
        <button id="saveCurrentView" class="modern-btn modern-btn-success">
          <span class="modern-btn-icon">💾</span>
          <span>Save Current View</span>
        </button>
      </div>
      
      <div class="modern-hint">
        <strong>Ctrl+1-9</strong> to save • <strong>1-9</strong> to load
      </div>
      
      <div id="savedViewsList" class="modern-views-list"></div>
    `;
  },

  // Settings content
  getSettingsContent() {
    return `
      <div class="modern-group">
        <div class="modern-label">Performance Preset</div>
        <select id="performancePreset" class="modern-select">
          <option value="PERFORMANCE">⚡ Performance</option>
          <option value="BALANCED" selected>⚖️ Balanced</option>
          <option value="QUALITY">💎 Quality</option>
          <option value="ULTRA">🌟 Ultra</option>
        </select>
      </div>
      
      <div class="modern-group">
        <div class="modern-label">Base Layers</div>
        <button id="toggleOSMBuildings" class="modern-toggle-btn active">
          <span class="modern-btn-icon">🏙️</span>
          <span>OSM Buildings</span>
        </button>
        <button id="toggleGoogle3DTiles" class="modern-toggle-btn">
          <span class="modern-btn-icon">🌍</span>
          <span>Google 3D Tiles</span>
        </button>
      </div>
      
      <div class="modern-group">
        <div class="modern-label">Globe Transparency</div>
        <button id="toggleGlobeTransparency" class="modern-toggle-btn">
          <span class="modern-btn-icon">🌐</span>
          <span>Enable Transparency</span>
        </button>
        
        <div id="globeTransparencyControls" style="display: none;">
          <div class="modern-slider-group">
            <label class="modern-label-small">Alpha</label>
            <input type="range" id="globeAlphaSlider" min="0" max="1" step="0.1" value="0.5" class="modern-slider-small">
            <span id="globeAlphaValue" class="modern-value-small">50%</span>
          </div>
        </div>
      </div>
      
      <div class="modern-group">
        <div class="modern-label">Advanced</div>
        <button id="toggleUndergroundView" class="modern-toggle-btn">
          <span class="modern-btn-icon">🕳️</span>
          <span>Underground Mode</span>
        </button>
      </div>
    `;
  },

  // Initialize section collapse handlers
  initCollapseHandlers() {
    document.querySelectorAll('.modern-section-header').forEach(header => {
      header.addEventListener('click', () => {
        const sectionId = header.dataset.section;
        const content = header.nextElementSibling;
        const toggle = header.querySelector('.modern-section-toggle');
        
        if (content.classList.contains('expanded')) {
          content.classList.remove('expanded');
          content.classList.add('collapsed');
          toggle.textContent = '▶';
          this.expandedSections.delete(sectionId);
        } else {
          content.classList.remove('collapsed');
          content.classList.add('expanded');
          toggle.textContent = '▼';
          this.expandedSections.add(sectionId);
        }
      });
    });
  },

  // ✅ COMPLETE: Initialize all event handlers
  initEventHandlers() {
    // ✅ iTwin Model Import
    document.getElementById('importITwinModel')?.addEventListener('click', () => {
      const shareKey = document.getElementById('iTwinShareKeyInput').value.trim();
      const iModelId = document.getElementById('iTwinModelIdInput').value.trim();
      const modelName = document.getElementById('iTwinModelNameInput').value.trim() || null;
      
      if (!shareKey) {
        BimViewer.updateStatus('❌ Please enter Share Key', 'error');
        return;
      }
      
      if (!iModelId) {
        BimViewer.updateStatus('❌ Please enter iModel ID', 'error');
        return;
      }
      
      BimViewer.loadITwinModel(shareKey, iModelId, modelName);
      
      // Clear inputs after successful submission
      document.getElementById('iTwinShareKeyInput').value = '';
      document.getElementById('iTwinModelIdInput').value = '';
      document.getElementById('iTwinModelNameInput').value = '';
    });

    // Enter key support for iTwin inputs
    document.getElementById('iTwinModelIdInput')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        document.getElementById('importITwinModel').click();
      }
    });

    document.getElementById('iTwinShareKeyInput')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        document.getElementById('iTwinModelIdInput').focus();
      }
    });

    // ✅ Ion Assets Loading
    document.getElementById('loadIonAssets')?.addEventListener('click', async () => {
      const btn = document.getElementById('loadIonAssets');
      const selector = document.getElementById('ionAssetSelector');
      const importBtn = document.getElementById('importSelectedAsset');
      
      if (!btn || !selector) return;
      
      try {
        btn.innerHTML = '<span class="modern-btn-icon">⏳</span><span>Loading...</span>';
        btn.disabled = true;
        
        // Call the fetchAvailableAssets function from core.js
        const assets = await BimViewer.fetchAvailableAssets();
        
        // Clear and populate selector
        selector.innerHTML = '<option value="">-- Select an asset --</option>';
        
        assets.forEach(asset => {
          const option = document.createElement('option');
          option.value = asset.id;
          option.textContent = `${asset.name} (ID: ${asset.id})`;
          selector.appendChild(option);
        });
        
        importBtn.disabled = false;
        btn.innerHTML = '<span class="modern-btn-icon">✅</span><span>Assets Loaded</span>';
        
        setTimeout(() => {
          btn.innerHTML = '<span class="modern-btn-icon">🌍</span><span>Load Ion Assets</span>';
          btn.disabled = false;
        }, 2000);
        
        BimViewer.updateStatus(`${assets.length} assets loaded`, 'success');
        
      } catch (error) {
        console.error('Failed to load assets:', error);
        btn.innerHTML = '<span class="modern-btn-icon">❌</span><span>Failed</span>';
        setTimeout(() => {
          btn.innerHTML = '<span class="modern-btn-icon">🌍</span><span>Load Ion Assets</span>';
          btn.disabled = false;
        }, 2000);
        BimViewer.updateStatus('Failed to load assets', 'error');
      }
    });

    document.getElementById('importSelectedAsset')?.addEventListener('click', () => {
      const selector = document.getElementById('ionAssetSelector');
      const assetId = selector.value;
      const assetName = selector.options[selector.selectedIndex].text;
      if (assetId) BimViewer.loadSelectedAsset(assetId, assetName);
    });

    document.getElementById('importAssetById')?.addEventListener('click', () => {
      const assetId = document.getElementById('assetIdInput').value;
      const assetName = document.getElementById('assetNameInput').value || `Asset ${assetId}`;
      if (assetId) BimViewer.loadSelectedAsset(assetId, assetName);
    });

    // Drawing
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

    // Comments
    document.getElementById('toggleCommentMode')?.addEventListener('click', () => {
      BimViewer.toggleCommentMode();
    });

    document.getElementById('initFirebaseBtn')?.addEventListener('click', () => {
      BimViewer.initFirebase();
    });

    // Visibility
    document.getElementById('toggleHideMode')?.addEventListener('click', () => {
      BimViewer.toggleHideMode();
    });

    document.getElementById('showAllHidden')?.addEventListener('click', () => {
      BimViewer.showAllHiddenFeatures();
    });

    // IFC Filter
    document.getElementById('selectAllIFC')?.addEventListener('click', () => {
      BimViewer.selectAllIFCTypes();
    });

    document.getElementById('deselectAllIFC')?.addEventListener('click', () => {
      BimViewer.deselectAllIFCTypes();
    });

    // Views
    document.getElementById('saveCurrentView')?.addEventListener('click', () => {
      BimViewer.saveView();
    });

    // Settings
    document.getElementById('performancePreset')?.addEventListener('change', (e) => {
      const preset = CONFIG.performance.presets[e.target.value];
      if (preset) {
        BimViewer.applyPerformanceSettings(preset);
        BimViewer.updateStatus(`Performance: ${preset.name}`, 'success');
      }
    });

    document.getElementById('toggleOSMBuildings')?.addEventListener('click', (e) => {
      BimViewer.toggleOSMBuildings();
      e.target.classList.toggle('active');
    });

    document.getElementById('toggleGoogle3DTiles')?.addEventListener('click', (e) => {
      BimViewer.toggleGoogle3DTiles();
      e.target.classList.toggle('active');
    });

    document.getElementById('toggleGlobeTransparency')?.addEventListener('click', (e) => {
      BimViewer.toggleGlobeTransparency();
      e.target.classList.toggle('active');
      const controls = document.getElementById('globeTransparencyControls');
      controls.style.display = BimViewer.globeTransparency.enabled ? 'block' : 'none';
    });

    document.getElementById('toggleUndergroundView')?.addEventListener('click', (e) => {
      BimViewer.toggleUndergroundView();
      e.target.classList.toggle('active');
    });

    document.getElementById('globeAlphaSlider')?.addEventListener('input', (e) => {
      const alpha = parseFloat(e.target.value);
      BimViewer.setGlobeTransparency(alpha);
      document.getElementById('globeAlphaValue').textContent = Math.round(alpha * 100) + '%';
    });

    // ⭐ NEW: Lighting Controls
    document.getElementById('toggleDynamicLighting')?.addEventListener('click', function() {
      const isEnabled = BimViewer.lighting?.enabled || false;
      BimViewer.enableDynamicLighting(!isEnabled);
      
      const controls = document.getElementById('lightingControls');
      const btn = this;
      
      if (!isEnabled) {
        // Enable
        btn.classList.add('active');
        btn.innerHTML = '<span class="modern-btn-icon">🌞</span><span>Lighting ON</span>';
        if (controls) controls.style.display = 'block';
      } else {
        // Disable
        btn.classList.remove('active');
        btn.innerHTML = '<span class="modern-btn-icon">🌅</span><span>Enable Lighting</span>';
        if (controls) controls.style.display = 'none';
      }
    });
    
    // Ambient lighting mode selector
    document.getElementById('ambientLightMode')?.addEventListener('change', function() {
      const mode = this.value;
      if (typeof BimViewer.setAmbientLightingMode === 'function') {
        BimViewer.setAmbientLightingMode(mode);
      }
    });
    
    // Time preset buttons
    document.querySelectorAll('.modern-time-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const preset = this.dataset.time;
        BimViewer.setPresetTime(preset);
        
        // Visual feedback
        document.querySelectorAll('.modern-time-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
      });
    });
    
    // Time animation toggle
    document.getElementById('toggleTimeAnimation')?.addEventListener('click', function() {
      const speed = parseInt(document.getElementById('timeSpeedSlider').value);
      BimViewer.animateTime(true, speed);
      this.classList.add('active');
      document.getElementById('stopTimeAnimation')?.classList.remove('active');
    });
    
    document.getElementById('stopTimeAnimation')?.addEventListener('click', function() {
      BimViewer.animateTime(false);
      this.classList.add('active');
      document.getElementById('toggleTimeAnimation')?.classList.remove('active');
    });
    
    // Time speed slider
    document.getElementById('timeSpeedSlider')?.addEventListener('input', function() {
      const speed = parseInt(this.value);
      document.getElementById('timeSpeedValue').textContent = speed + 'x';
      
      // Update speed if animation is running
      if (BimViewer.lighting?.animateTime) {
        BimViewer.viewer.clock.multiplier = speed;
      }
    });
  },

  // ⭐ NEW: Create asset control WITH INTEGRATED Z-OFFSET
  createAssetControls(assetId) {
    const container = document.getElementById('loadedAssetsList');
    if (!container) return;

    const assetData = BimViewer.loadedAssets.get(assetId.toString());
    if (!assetData) return;

    const assetDiv = document.createElement('div');
    assetDiv.id = `asset_${assetId}`;
    assetDiv.className = 'modern-asset-item';
    
    if (assetData.type === 'ITWIN') {
      assetDiv.classList.add('modern-asset-itwin');
    }
    
    // Get current offset value if any
    const hasIndividualOffset = BimViewer.zOffset && BimViewer.zOffset.individualOffsets.has(assetData.tileset);
    const currentOffset = hasIndividualOffset ? 
      BimViewer.zOffset.individualOffsets.get(assetData.tileset) : 0;
    
    assetDiv.innerHTML = `
      <!-- Asset Header -->
      <div class="modern-asset-header">
        <div class="modern-asset-name">${assetData.name}</div>
        <div class="modern-asset-controls">
          <button class="modern-icon-btn" onclick="BimViewer.zoomToAsset('${assetId}')" title="Zoom to">📍</button>
          <button class="modern-icon-btn" onclick="BimViewer.toggleAssetVisibility('${assetId}')" title="Toggle visibility">👁️</button>
          <button class="modern-icon-btn modern-icon-btn-danger" onclick="BimViewer.unloadAsset('${assetId}')" title="Remove">🗑️</button>
        </div>
      </div>
      
      <!-- Opacity Control -->
      <div class="modern-asset-opacity">
        <label class="modern-label-small">Opacity</label>
        <input type="range" min="0" max="1" step="0.1" value="1" 
               oninput="BimViewer.updateAssetOpacity('${assetId}', this.value)" 
               class="modern-slider-small">
        <span id="opacityValue_${assetId}" class="modern-value-small">100%</span>
      </div>
      
      <!-- 🏔️ Z-OFFSET CONTROLS (COMPACT VERSION -5m to +5m) -->
      <div class="modern-asset-zoffset">
        <div class="zoffset-label-row">
          <label class="modern-label-small">🏔️ Z-Offset</label>
          <span class="zoffset-value" id="zoffset_value_${assetId}">${currentOffset >= 0 ? '+' : ''}${currentOffset.toFixed(2)} m</span>
        </div>
        
        <!-- Slider with color gradient (-5m to +5m) -->
        <input type="range" 
               id="zoffset_slider_${assetId}"
               class="zoffset-slider"
               min="-5" 
               max="5" 
               step="0.01" 
               value="${currentOffset}"
               oninput="BimViewerUI.updateAssetZOffset('${assetId}', this.value)">
        
        <!-- Input Box for explicit value -->
        <div class="zoffset-input-row">
          <input type="number" 
                 id="zoffset_input_${assetId}"
                 class="zoffset-input-box"
                 min="-5" 
                 max="5" 
                 step="0.01" 
                 value="${currentOffset.toFixed(2)}"
                 placeholder="0.00"
                 onchange="BimViewerUI.setAssetZOffsetFromInput('${assetId}', this.value)">
          <button class="zoffset-reset-btn" 
                  onclick="BimViewerUI.setAssetZOffsetFromInput('${assetId}', 0)"
                  title="Reset to 0">
            ↺
          </button>
        </div>
      </div>
    `;

    container.appendChild(assetDiv);
  },

  // ⭐ NEW: Update asset Z-Offset (with debouncing)
  updateAssetZOffset(assetId, value) {
    const offsetValue = parseFloat(value);
    const valueDisplay = document.getElementById(`zoffset_value_${assetId}`);
    const inputBox = document.getElementById(`zoffset_input_${assetId}`);
    
    if (valueDisplay) {
      valueDisplay.textContent = `${offsetValue >= 0 ? '+' : ''}${offsetValue.toFixed(2)} m`;
      
      // Color coding based on value (adjusted for -5 to +5 range)
      if (offsetValue < -3) {
        valueDisplay.style.color = '#f44336'; // Red (deep)
      } else if (offsetValue < -1) {
        valueDisplay.style.color = '#ff9800'; // Orange
      } else if (offsetValue >= -1 && offsetValue <= 1) {
        valueDisplay.style.color = '#4caf50'; // Green (near zero)
      } else if (offsetValue <= 3) {
        valueDisplay.style.color = '#2196f3'; // Blue
      } else {
        valueDisplay.style.color = '#9c27b0'; // Purple (high)
      }
    }
    
    // Update input box to match slider
    if (inputBox) {
      inputBox.value = offsetValue.toFixed(2);
    }
    
    // SMOOTH live updates - use requestAnimationFrame for 60fps
    if (this._zoffsetAnimationFrame) {
      cancelAnimationFrame(this._zoffsetAnimationFrame);
    }
    
    this._zoffsetAnimationFrame = requestAnimationFrame(() => {
      if (typeof BimViewer.applyIndividualZOffset === 'function') {
        // Pass isLiveUpdate=true to reduce console logging during slider movement
        BimViewer.applyIndividualZOffset(assetId, offsetValue, true);
      }
    });
  },

  // ⭐ NEW: Set Z-Offset from input box
  setAssetZOffsetFromInput(assetId, value) {
    let offsetValue = parseFloat(value);
    
    // Clamp to valid range
    if (isNaN(offsetValue)) {
      offsetValue = 0;
    } else if (offsetValue < -5) {
      offsetValue = -5;
    } else if (offsetValue > 5) {
      offsetValue = 5;
    }
    
    const slider = document.getElementById(`zoffset_slider_${assetId}`);
    const inputBox = document.getElementById(`zoffset_input_${assetId}`);
    const valueDisplay = document.getElementById(`zoffset_value_${assetId}`);
    
    // Update all controls
    if (slider) {
      slider.value = offsetValue;
    }
    
    if (inputBox) {
      inputBox.value = offsetValue.toFixed(2);
    }
    
    if (valueDisplay) {
      valueDisplay.textContent = `${offsetValue >= 0 ? '+' : ''}${offsetValue.toFixed(2)} m`;
      
      // Color coding
      if (offsetValue < -3) {
        valueDisplay.style.color = '#f44336';
      } else if (offsetValue < -1) {
        valueDisplay.style.color = '#ff9800';
      } else if (offsetValue >= -1 && offsetValue <= 1) {
        valueDisplay.style.color = '#4caf50';
      } else if (offsetValue <= 3) {
        valueDisplay.style.color = '#2196f3';
      } else {
        valueDisplay.style.color = '#9c27b0';
      }
    }
    
    // Apply Z-offset
    if (typeof BimViewer.applyIndividualZOffset === 'function') {
      BimViewer.applyIndividualZOffset(assetId, offsetValue, false);
      BimViewer.updateStatus(`Z-Offset set to ${offsetValue >= 0 ? '+' : ''}${offsetValue.toFixed(2)}m`, 'success');
    }
  },

  // ⭐ NEW: Set asset Z-Offset preset
  setAssetZOffsetPreset(assetId, value) {
    const slider = document.getElementById(`zoffset_slider_${assetId}`);
    const valueDisplay = document.getElementById(`zoffset_value_${assetId}`);
    
    if (slider) {
      slider.value = value;
    }
    
    // Update display
    if (valueDisplay) {
      valueDisplay.textContent = `${value >= 0 ? '+' : ''}${value.toFixed(1)} m`;
      
      // Color coding
      if (value < -30) {
        valueDisplay.style.color = '#f44336';
      } else if (value < -10) {
        valueDisplay.style.color = '#ff9800';
      } else if (value < 10) {
        valueDisplay.style.color = '#4caf50';
      } else if (value < 40) {
        valueDisplay.style.color = '#2196f3';
      } else {
        valueDisplay.style.color = '#9c27b0';
      }
    }
    
    // Preset buttons are explicit user actions, so log them (isLiveUpdate=false)
    if (typeof BimViewer.applyIndividualZOffset === 'function') {
      BimViewer.applyIndividualZOffset(assetId, value, false);
    }
  }
};

// Expose globally
window.BimViewerUI = BimViewerUI;

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => BimViewerUI.init(), 100);
  });
} else {
  setTimeout(() => BimViewerUI.init(), 100);
}

console.log('✅ Modern UI module v3.2 (COMPLETE) loaded - Integrated Z-Offset Controls (-70m to +70m)');
