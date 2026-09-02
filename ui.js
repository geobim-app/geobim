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
// CESIUM BIM VIEWER - MODERN UI MODULE v3.2 (INTEGRATED Z-OFFSET) - COMPLETE
// Minimalist Design with Collapsible Sections
// NEW: Z-Offset controls directly in asset list (-70m to +70m)
// ===============================
'use strict';

// Curated demo assets from the geobim.app Ion account (ID → display name)
const DEMO_ASSETS = new Map([
  [4872841, 'Porsche 911'],
  [4538820, 'Construction Stages (Bridge)'],
  [4533896, 'RC_Bridge'],
  [4510773, 'BIMcollab (IFC)'],
  [4496917, 'Asset 4496917'],
  [4495857, 'Dublin Bridge'],
  [4483046, 'Rowing Center (Gaussian Splats)'],
  [4476749, 'Golden Nugget (Revit)'],
  [4458809, 'Atlanta (GLB)'],
  [4452138, 'Bridge Belgium #1 (Reality-Mesh)'],
  [4450806, 'Office Building (IFC)'],
  [4446752, 'Bridge (Gaussian Splats)'],
  [4446751, 'Bridge (Pointcloud)'],
  [4428272, 'House (Pointcloud)'],
  [4427396, 'Bridge (IFC)'],
  [4422193, 'Facades (Revit)'],
  [4422185, 'Architectural (Revit)'],
  [4422182, 'HVAC (Revit)'],
  [4422180, 'Electrical (Revit)'],
  [4422178, 'Plumbing (Revit)'],
  [4422174, 'Site (Revit)'],
  [4422171, 'Structural (Revit)']
]);
// Legacy compat — some code still references VALID_ASSET_IDS
const VALID_ASSET_IDS = new Set(DEMO_ASSETS.keys());

// Global tool cursor helper — set/clear contextual cursor on body
window.BimCursor = {
  _active: null,
  set: function(tool) {
    if (this._active) document.body.classList.remove('tool-' + this._active);
    this._active = tool;
    if (tool) document.body.classList.add('tool-' + tool);
  },
  clear: function() {
    if (this._active) document.body.classList.remove('tool-' + this._active);
    this._active = null;
  }
};

const BimViewerUI = {
  // Track expanded sections
  expandedSections: new Set(['assets']), // Only assets open by default
  
  // Initialize UI
  init() {
    try {
      this.createModernToolbar();
      this.createBottomToolbar();
      this.initEventHandlers();
      this.initCollapseHandlers();
      // Initialize Lucide SVG icons
      if (window.lucide) lucide.createIcons();
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
    toolbar.appendChild(this.createSection('assets', '<i data-lucide="box"></i>', 'Assets', typeof GEOBIM_ASSETS_UI !== 'undefined' ? GEOBIM_ASSETS_UI.getContent() : ''));
    toolbar.appendChild(this.createSection('layers', '<i data-lucide="layers"></i>', 'Layer Manager', typeof GEOBIM_LAYER_UI !== 'undefined' ? GEOBIM_LAYER_UI.getContent() : ''));
    toolbar.appendChild(this.createSection('pointcloud', '<i data-lucide="cloud"></i>', 'Point Cloud Settings', typeof GEOBIM_POINTCLOUD_UI !== 'undefined' ? GEOBIM_POINTCLOUD_UI.getContent() : ''));
    toolbar.appendChild(this.createSection('splat', '<i data-lucide="sparkles"></i>', 'Gaussian Splats', typeof GEOBIM_SPLAT_UI !== 'undefined' ? GEOBIM_SPLAT_UI.getContent() : ''));
    // Data/browse tools stay in sidebar
    toolbar.appendChild(this.createSection('comments', '<i data-lucide="message-square"></i>', 'Annotations', typeof GEOBIM_COMMENTS_UI !== 'undefined' ? GEOBIM_COMMENTS_UI.getContent() : ''));
    toolbar.appendChild(this.createSection('inspection', '<i data-lucide="search"></i>', 'Inspection', typeof GEOBIM_INSPECTION !== 'undefined' ? GEOBIM_INSPECTION.getSummaryContent() : ''));
    toolbar.appendChild(this.createSection('ifc', '<i data-lucide="building-2"></i>', 'IFC Filter', typeof GEOBIM_IFC_UI !== 'undefined' ? GEOBIM_IFC_UI.getContent() : ''));
    toolbar.appendChild(this.createSection('revit', '<i data-lucide="building"></i>', 'Revit Filter', typeof GEOBIM_REVIT_UI !== 'undefined' ? GEOBIM_REVIT_UI.getContent() : ''));
    toolbar.appendChild(this.createSection('split', '<i data-lucide="columns-2"></i>', 'Split View', typeof GEOBIM_SPLIT_UI !== 'undefined' ? GEOBIM_SPLIT_UI.getContent() : ''));
    toolbar.appendChild(this.createSection('views', '<i data-lucide="camera"></i>', 'Saved Views', typeof GEOBIM_VIEWS_UI !== 'undefined' ? GEOBIM_VIEWS_UI.getContent() : ''));
    toolbar.appendChild(this.createSection('settings', '<i data-lucide="settings"></i>', 'Settings', typeof GEOBIM_SETTINGS_UI !== 'undefined' ? GEOBIM_SETTINGS_UI.getContent() : ''));

    // Action tools moved to bottom toolbar (Measure, Visibility, Lighting, Walk, About)
    toolbar.appendChild(this.createSection('drawing', '<i data-lucide="ruler"></i>', 'Measure & Clip', typeof this.getDrawingContent === 'function' ? this.getDrawingContent() : typeof GEOBIM_DRAWING_UI !== 'undefined' ? GEOBIM_DRAWING_UI.getContent() : ''));
    toolbar.appendChild(this.createSection('visibility', '<i data-lucide="eye"></i>', 'Visibility', typeof GEOBIM_VISIBILITY_UI !== 'undefined' ? GEOBIM_VISIBILITY_UI.getContent() : ''));
    toolbar.appendChild(this.createSection('lighting', '<i data-lucide="sun"></i>', 'Lighting', typeof GEOBIM_LIGHTING_UI !== 'undefined' ? GEOBIM_LIGHTING_UI.getContent() : ''));
    toolbar.appendChild(this.createSection('about', '<i data-lucide="info"></i>', 'About & Help', typeof GEOBIM_ABOUT_UI !== 'undefined' ? GEOBIM_ABOUT_UI.getContent() : ''));
  },

  // Create bottom action toolbar (Speckle-style)
  createBottomToolbar() {
    const bar = document.getElementById('bottomToolbar');
    if (!bar) return;

    bar.innerHTML = `
      <button class="bottom-toolbar-btn" data-section="drawing" title="Measure & Clip (📏)">
        <i data-lucide="ruler"></i>
        <span class="bottom-toolbar-label">Measure</span>
      </button>
      <button class="bottom-toolbar-btn" data-section="visibility" title="Hide/Show Elements (H)">
        <i data-lucide="eye"></i>
        <span class="bottom-toolbar-label">Visibility</span>
      </button>
      <div class="bottom-toolbar-sep"></div>
      <button class="bottom-toolbar-btn" data-section="lighting" title="Lighting & Time of Day">
        <i data-lucide="sun"></i>
        <span class="bottom-toolbar-label">Lighting</span>
      </button>
      <button class="bottom-toolbar-btn" id="bottomWalkBtn" title="Walk Mode (G)">
        <i data-lucide="person-standing"></i>
        <span class="bottom-toolbar-label">Walk</span>
      </button>
      <button class="bottom-toolbar-btn" id="gizmoTransformBtn" title="Transform Mode — move/rotate assets (X)">
        <i data-lucide="move-3d"></i>
        <span class="bottom-toolbar-label">Transform</span>
      </button>
      <div class="bottom-toolbar-sep"></div>
      <button class="bottom-toolbar-btn" id="bottomHelpBtn" title="About & Help">
        <i data-lucide="info"></i>
        <span class="bottom-toolbar-label">Help</span>
      </button>
    `;

    // Section toggle buttons — expand in sidebar
    bar.querySelectorAll('[data-section]').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.blur(); // Remove focus so keyboard shortcuts work immediately
        const sectionId = btn.getAttribute('data-section');
        const isActive = btn.classList.contains('active');

        // Deactivate section buttons (not Walk — it has independent state)
        bar.querySelectorAll('.bottom-toolbar-btn[data-section]').forEach(b => b.classList.remove('active'));

        if (!isActive) {
          btn.classList.add('active');
          // Show sidebar if hidden
          const toolbar = document.getElementById('toolbar');
          const toggle = document.getElementById('sidebarToggle');
          if (toolbar && toolbar.classList.contains('collapsed')) {
            toolbar.classList.remove('collapsed');
            if (toggle) toggle.classList.remove('at-edge');
          }
          // Expand the target section, collapse others in action group
          ['drawing', 'visibility', 'lighting', 'about'].forEach(id => {
            this.toggleSection(id, id === sectionId);
          });
          // Auto-open measurement panel when Measure button clicked
          if (sectionId === 'drawing' && window.BimViewer && typeof BimViewer.toggleMeasurementPanel === 'function') {
            setTimeout(() => BimViewer.toggleMeasurementPanel(), 100);
          }
        } else {
          // Collapse the section
          this.toggleSection(sectionId, false);
          // Close measurement panel when deactivating
          if (sectionId === 'drawing' && window.BimViewer && BimViewer.measurement) {
            var mp = document.getElementById('measurementPanel');
            if (mp) mp.style.display = 'none';
          }
        }
      });
    });

    // Walk mode button — direct toggle
    const walkBtn = document.getElementById('bottomWalkBtn');
    if (walkBtn) {
      walkBtn.addEventListener('click', () => {
        if (window.BimFirstPerson) {
          if (BimFirstPerson.isActive()) {
            BimFirstPerson.deactivate();
            walkBtn.classList.remove('active');
          } else {
            BimFirstPerson.activate();
            walkBtn.classList.add('active');
            // Focus canvas + request pointer lock so WASD and mouse work immediately
            walkBtn.blur();
            var canvas = BimViewer.viewer && BimViewer.viewer.scene.canvas;
            if (canvas) {
              canvas.setAttribute('tabindex', '0');
              canvas.focus();
              try { canvas.requestPointerLock(); } catch (_) {}
            }
          }
        }
      });
    }

    // Transform button — direct toggle of the asset gizmo's Transform mode.
    // BimGizmo.setTransformMode already toggles this button's .active class.
    const transformBtn = document.getElementById('gizmoTransformBtn');
    if (transformBtn) {
      transformBtn.addEventListener('click', () => {
        transformBtn.blur(); // keep keyboard shortcuts (incl. X) working
        if (window.BimGizmo && typeof BimGizmo.toggleTransformMode === 'function') {
          BimGizmo.toggleTransformMode();
        }
      });
    }

    // Help button — open About dialog directly on Features tab
    const helpBtn = document.getElementById('bottomHelpBtn');
    if (helpBtn) {
      helpBtn.addEventListener('click', () => {
        helpBtn.blur();
        if (window.BimViewer && typeof BimViewer.showAboutDialog === 'function') {
          BimViewer.showAboutDialog();
          // Switch to Features tab after dialog opens
          setTimeout(() => {
            var featuresTab = document.querySelector('.about-tab[data-tab="features"]');
            if (featuresTab) featuresTab.click();
          }, 50);
        }
      });
    }
  },

  // Toggle a sidebar section open/closed programmatically
  toggleSection(sectionId, expand) {
    const header = document.querySelector(`.modern-section-header[data-section="${sectionId}"]`);
    if (!header) return;
    const content = header.nextElementSibling;
    const toggle = header.querySelector('.modern-section-toggle');
    if (!content) return;

    if (expand) {
      content.classList.add('expanded');
      content.classList.remove('collapsed');
      if (toggle) toggle.textContent = '▼';
      this.expandedSections.add(sectionId);
      // Scroll section into view
      header.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      content.classList.remove('expanded');
      content.classList.add('collapsed');
      if (toggle) toggle.textContent = '▶';
      this.expandedSections.delete(sectionId);
    }
  },

  // Create header
  createHeader() {
    const header = document.createElement('div');
    header.className = 'modern-header';

    header.innerHTML = `
      <div class="modern-header-content">
        <img src="logo/logo_teal_transparent.svg" alt="geobim.app" class="modern-header-logo">
      </div>
      <div id="userBadge">
        <span id="userEmail"></span>
        <button id="logoutBtn" onclick="if(window.authGateLogout){authGateLogout()}else{BimAuth.logout()}">Logout</button>
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
  // Assets content extracted to ui-assets-section.js

  // Layer Manager content
  // Layer Manager content extracted to ui-layer-section.js

  // Drawing & Clipping content
  // Drawing content extracted to ui-drawing-section.js

  // Comments, Visibility, IFC Filter, Revit Filter content extracted to ui-{comments,visibility,ifc,revit}-section.js

  // Split View content
  // Split View extracted to ui-split-section.js (getContent + toggleSplitView + slider drag + Google 3D Tiles left-copy)

  // Saved Views content extracted to ui-views-section.js

  // Lighting content
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
    // Sidebar toggle functionality
    const toggleSidebar = () => {
      const toolbar = document.getElementById('toolbar');
      const toggle = document.getElementById('sidebarToggle');
      if (!toolbar || !toggle) return;

      toolbar.classList.toggle('collapsed');
      const isCollapsed = toolbar.classList.contains('collapsed');
      toggle.textContent = isCollapsed ? '☰' : '✕';
      toggle.classList.toggle('at-edge', isCollapsed);
    };

    document.getElementById('sidebarToggle')?.addEventListener('click', toggleSidebar);

    // Keyboard shortcut: M to toggle sidebar
    document.addEventListener('keydown', function(e) {
      if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.altKey) {
        if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          toggleSidebar();
        }
      }
    });

    // Section handlers extracted to ui-*-section.js
    if (typeof GEOBIM_ASSETS_UI !== 'undefined') GEOBIM_ASSETS_UI.initHandlers();
    if (typeof GEOBIM_DRAWING_UI !== 'undefined') GEOBIM_DRAWING_UI.initHandlers();
    if (typeof GEOBIM_COMMENTS_UI !== 'undefined') GEOBIM_COMMENTS_UI.initHandlers();
    if (typeof GEOBIM_VISIBILITY_UI !== 'undefined') GEOBIM_VISIBILITY_UI.initHandlers();
    if (typeof GEOBIM_IFC_UI !== 'undefined') GEOBIM_IFC_UI.initHandlers();
    if (typeof GEOBIM_REVIT_UI !== 'undefined') GEOBIM_REVIT_UI.initHandlers();
    if (typeof GEOBIM_VIEWS_UI !== 'undefined') GEOBIM_VIEWS_UI.initHandlers();

    // Split View — handlers extracted to ui-split-section.js
    if (typeof GEOBIM_SPLIT_UI !== 'undefined') GEOBIM_SPLIT_UI.initHandlers();

    // Lighting — handlers extracted to ui-lighting-section.js
    if (typeof GEOBIM_LIGHTING_UI !== 'undefined') {
      GEOBIM_LIGHTING_UI.initHandlers();
    }

    // Settings — handlers extracted to ui-settings-section.js
    if (typeof GEOBIM_SETTINGS_UI !== 'undefined') {
      GEOBIM_SETTINGS_UI.initHandlers();
    }

    // Layer Manager — handlers extracted to ui-layer-section.js
    if (typeof GEOBIM_LAYER_UI !== 'undefined') GEOBIM_LAYER_UI.initHandlers();

  },

  // ⭐ NEW: Create asset control WITH INTEGRATED Z-OFFSET
  toggleAssetCard(assetId, evt) {
    if (evt && evt.target && evt.target.closest('.modern-asset-controls button')) return;
    const item = document.getElementById(`asset_${assetId}`);
    if (item) item.classList.toggle('expanded');
  },

  createAssetControls(assetId) {
    // Skip WEA assets — managed by WEA Shadow widget
    var ad = BimViewer.loadedAssets.get(assetId.toString());
    if (ad && ad.isWEA) return;

    // Ensure floating panel exists
    if (typeof BimViewer.createLoadedAssetsPanel === 'function') {
      BimViewer.createLoadedAssetsPanel();
    }
    let container = document.getElementById('loadedAssetsList');
    if (!container) {
      // Fallback: create panel inline if helper not ready
      console.warn('loadedAssetsList not found, creating fallback');
      const fallback = document.createElement('div');
      fallback.id = 'loadedAssetsList';
      document.body.appendChild(fallback);
      container = fallback;
    }

    const assetData = BimViewer.loadedAssets.get(assetId.toString());
    if (!assetData) return;

    // Clear empty state placeholder
    const emptyState = container.querySelector('.modern-empty-state');
    if (emptyState) emptyState.remove();

    const assetDiv = document.createElement('div');
    assetDiv.id = `asset_${assetId}`;
    assetDiv.className = 'modern-asset-item';
    
    if (assetData.type === 'ITWIN') {
      assetDiv.classList.add('modern-asset-itwin');
    }
    
    // Get current offset value if any
    const hasIndividualOffset = !assetData.isGLB && BimViewer.zOffset && assetData.tileset && BimViewer.zOffset.individualOffsets.has(assetData.tileset);
    const currentOffset = hasIndividualOffset ?
      BimViewer.zOffset.individualOffsets.get(assetData.tileset) : 0;
    
    assetDiv.innerHTML = `
      <!-- Asset Header (click to expand) -->
      <div class="modern-asset-header" onclick="BimViewerUI.toggleAssetCard('${assetId}', event)">
        <div class="modern-asset-name" title="${assetData.name}">${assetData.name}</div>
        <div class="modern-asset-controls">
          <button class="modern-icon-btn" onclick="event.stopPropagation();BimViewer.zoomToAsset('${assetId}')" title="Fly to asset">📍</button>
          <button class="modern-icon-btn" onclick="event.stopPropagation();BimViewer.toggleAssetVisibility('${assetId}')" title="Show/hide asset">👁️</button>
          <button class="modern-icon-btn modern-icon-btn-danger" onclick="event.stopPropagation();BimViewer.unloadAsset('${assetId}')" title="Remove asset from viewer">🗑️</button>
          <span class="modern-asset-chevron" aria-hidden="true"><i data-lucide="chevron-right" style="width:14px;height:14px;"></i></span>
        </div>
      </div>

      <div class="modern-asset-details">
      <!-- Opacity Control -->
      <div class="modern-asset-opacity">
        <label class="modern-label-small">Opacity</label>
        <input type="range" min="0" max="1" step="0.1" value="1"
               oninput="BimViewer.updateAssetOpacity('${assetId}', this.value)"
               class="modern-slider-small"
               title="Adjust transparency">
        <span id="opacityValue_${assetId}" class="modern-value-small">100%</span>
      </div>

      ${assetData.isGLB ? `
      <!-- GLB Positioning Controls -->
      <div class="modern-asset-glb-position" style="padding: 4px 0;">
        <label class="modern-label-small">📍 Position</label>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 4px;">
          <div>
            <label style="font-size: 10px; color: rgba(255,255,255,0.4);">Lon</label>
            <input type="number" step="0.0001" value="${assetData.position.lon.toFixed(6)}"
                   id="glb_lon_${assetId}" class="zoffset-input-box" style="width: 100%;"
                   onchange="BimViewerUI.updateGLBParam('${assetId}', 'lon', this.value)">
          </div>
          <div>
            <label style="font-size: 10px; color: rgba(255,255,255,0.4);">Lat</label>
            <input type="number" step="0.0001" value="${assetData.position.lat.toFixed(6)}"
                   id="glb_lat_${assetId}" class="zoffset-input-box" style="width: 100%;"
                   onchange="BimViewerUI.updateGLBParam('${assetId}', 'lat', this.value)">
          </div>
        </div>
        <div style="margin-top: 4px;">
          <label style="font-size: 10px; color: rgba(255,255,255,0.4);">Height (m)</label>
          <input type="number" step="0.5" value="${assetData.position.height.toFixed(1)}"
                 id="glb_height_${assetId}" class="zoffset-input-box" style="width: 100%;"
                 onchange="BimViewerUI.updateGLBParam('${assetId}', 'height', this.value)">
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 4px;">
          <div>
            <label style="font-size: 10px; color: rgba(255,255,255,0.4);">Heading (°)</label>
            <input type="range" min="0" max="360" step="1" value="${assetData.heading || 0}"
                   id="glb_heading_${assetId}" class="modern-slider-small"
                   oninput="BimViewerUI.updateGLBParam('${assetId}', 'heading', this.value)">
            <span id="glb_heading_val_${assetId}" class="modern-value-small">${Math.round(assetData.heading || 0)}°</span>
          </div>
          <div>
            <label style="font-size: 10px; color: rgba(255,255,255,0.4);">Scale</label>
            <input type="range" min="-2" max="2" step="0.01" value="${Math.log10(assetData.scale || 1).toFixed(2)}"
                   id="glb_scale_${assetId}" class="modern-slider-small"
                   oninput="BimViewerUI.updateGLBParam('${assetId}', 'scale', Math.pow(10, parseFloat(this.value)))">
            <input type="number" min="0.01" max="100" step="any" value="${(assetData.scale || 1)}"
                   id="glb_scale_input_${assetId}" class="zoffset-input-box" style="width: 55px; margin-top: 2px;"
                   onchange="BimViewerUI.updateGLBParam('${assetId}', 'scale', this.value)">
            <span id="glb_scale_val_${assetId}" class="modern-value-small">${(assetData.scale || 1).toFixed(2)}x</span>
          </div>
        </div>
        ${assetData.animated ? `
        <div style="margin-top: 6px;">
          <label style="font-size: 10px; color: rgba(255,255,255,0.4);">🎬 Animation Speed</label>
          <input type="range" min="0.1" max="5" step="0.1" value="${assetData.animSpeed || 0.3}"
                 id="glb_animspeed_${assetId}" class="modern-slider-small"
                 oninput="BimViewerUI.updateGLBParam('${assetId}', 'animSpeed', this.value)">
          <span id="glb_animspeed_val_${assetId}" class="modern-value-small">${(assetData.animSpeed || 0.3).toFixed(1)}x</span>
        </div>
        <div style="display: flex; gap: 6px; margin-top: 6px;">
          <button id="glb_playpause_${assetId}" class="modern-btn modern-btn-small" style="flex:1;"
                  onclick="BimViewer.toggleGLBAnimation('${assetId}')">
            ⏸ Pause
          </button>
        </div>
        <div style="display: flex; gap: 6px; margin-top: 4px; align-items: center;">
          <button class="modern-icon-btn" style="width:26px;height:26px;flex:0 0 auto;"
                  onclick="BimViewer.glbStageStep('${assetId}', -1)" title="Previous stage">
            <i data-lucide="chevron-left" style="width:14px;height:14px;"></i>
          </button>
          <span id="glb_stage_${assetId}" style="flex:1; text-align:center; font-size:10px; color:rgba(255,255,255,0.6);">
            Stage —
          </span>
          <button class="modern-icon-btn" style="width:26px;height:26px;flex:0 0 auto;"
                  onclick="BimViewer.glbStageStep('${assetId}', 1)" title="Next stage">
            <i data-lucide="chevron-right" style="width:14px;height:14px;"></i>
          </button>
        </div>
        ` : ''}
        ${!assetData.isPointCloud ? `
        <div style="margin-top: 6px;">
          <button id="glb_pbr_${assetId}" class="modern-btn modern-btn-small ${assetData.pbrEnabled ? 'active' : ''}" style="width:100%;"
                  onclick="BimViewer.toggleGLBPbr('${assetId}')">
            🪨 PBR ${assetData.pbrEnabled ? 'On' : 'Off'}
          </button>
        </div>
        ` : ''}
      </div>
      ` : ''}

      ${(!assetData.isGLB && assetData.tileset && assetData.placement) ? `
      <!-- Tileset heading (gizmo ring is depth-tested and gets buried inside dense
           geometry — e.g. point clouds — with no way to force it on top; see
           glb-gizmo.js's addAxisArrow comment. This is the reliable fallback. -->
      <div class="modern-group">
        <div class="modern-slider-group">
          <label class="modern-label-small">Heading (°)</label>
          <input type="range" min="0" max="360" step="1" value="${assetData.placement.heading || 0}"
                 id="tileset_heading_${assetId}" class="modern-slider-small"
                 oninput="BimViewerUI.updateTilesetHeading('${assetId}', this.value)">
          <span id="tileset_heading_val_${assetId}" class="modern-value-small">${Math.round(assetData.placement.heading || 0)}°</span>
        </div>
      </div>
      ` : ''}

      <!-- 🏔️ Z-OFFSET CONTROLS (COMPACT VERSION -15m to +15m) -->
      <div class="modern-asset-zoffset" ${assetData.isGLB ? 'style="display:none;"' : ''}>
        <div class="zoffset-label-row">
          <label class="modern-label-small">🏔️ Z-Offset</label>
          <span class="zoffset-value" id="zoffset_value_${assetId}">${currentOffset >= 0 ? '+' : ''}${currentOffset.toFixed(2)} m</span>
        </div>
        
        <!-- Slider with color gradient (-15m to +15m) -->
        <input type="range"
               id="zoffset_slider_${assetId}"
               class="zoffset-slider"
               min="-15"
               max="15"
               step="0.01"
               value="${currentOffset}"
               oninput="BimViewerUI.updateAssetZOffset('${assetId}', this.value)"
               title="Move asset up/down">
        
        <!-- Input Box for explicit value -->
        <div class="zoffset-input-row">
          <input type="number" 
                 id="zoffset_input_${assetId}"
                 class="zoffset-input-box"
                 min="-15"
                 max="15"
                 step="0.01" 
                 value="${currentOffset.toFixed(2)}"
                 placeholder="0.00"
                 onchange="BimViewerUI.setAssetZOffsetFromInput('${assetId}', this.value)">
          <button class="zoffset-clamp-btn"
                  onclick="BimViewer.clampAssetToTerrain('${assetId}')"
                  title="Auf Gelände setzen (Clamp to terrain)">
            <i data-lucide="mountain" style="width:13px;height:13px;"></i>
          </button>
          <button class="zoffset-reset-btn"
                  onclick="BimViewerUI.setAssetZOffsetFromInput('${assetId}', 0)"
                  title="Reset to 0">
            ↺
          </button>
        </div>
      </div>
      </div> <!-- /modern-asset-details -->
    `;

    container.appendChild(assetDiv);
    if (window.lucide) lucide.createIcons({ nodes: [assetDiv] });

    // Update count and auto-show panel
    if (typeof BimViewer.updateLoadedAssetsCount === 'function') {
      BimViewer.updateLoadedAssetsCount();
    }
    const assetsPanel = document.getElementById('floatingAssetsPanel');
    if (assetsPanel) {
      assetsPanel.classList.add('visible');
      console.log('📦 Loaded Assets panel shown');
    } else {
      console.warn('📦 floatingAssetsPanel not found in DOM');
    }
  },

  // GLB positioning parameter update
  updateGLBParam(assetId, param, value) {
    const assetData = BimViewer.loadedAssets.get(assetId);
    if (!assetData || !assetData.isGLB) return;

    const v = parseFloat(value);

    switch (param) {
      case 'lon':
        assetData.position.lon = v;
        break;
      case 'lat':
        assetData.position.lat = v;
        break;
      case 'height':
        assetData.position.height = v;
        break;
      case 'heading':
        assetData.heading = v;
        const headingVal = document.getElementById(`glb_heading_val_${assetId}`);
        if (headingVal) headingVal.textContent = Math.round(v) + '°';
        break;
      case 'scale':
        const clampedScale = Math.max(0.01, Math.min(100, v));
        assetData.scale = clampedScale;
        const scaleVal = document.getElementById(`glb_scale_val_${assetId}`);
        if (scaleVal) scaleVal.textContent = clampedScale.toFixed(2) + 'x';
        const scaleSlider = document.getElementById(`glb_scale_${assetId}`);
        if (scaleSlider) scaleSlider.value = Math.log10(clampedScale).toFixed(2);
        const scaleInput = document.getElementById(`glb_scale_input_${assetId}`);
        if (scaleInput) scaleInput.value = clampedScale;
        break;
      case 'animSpeed':
        const speedVal = document.getElementById(`glb_animspeed_val_${assetId}`);
        if (speedVal) speedVal.textContent = v.toFixed(1) + 'x';
        BimViewer.setGLBAnimationSpeed(assetId, v);
        return; // no position update needed
    }

    BimViewer.updateGLBPosition(assetId);
  },

  // Tileset heading — numeric fallback for the gizmo's rotation ring, which is a
  // depth-tested Cesium Entity polyline (disableDepthTestDistance is a no-op on
  // PolylineGraphics) and gets buried inside dense geometry, most noticeably point
  // clouds. Mirrors updateGLBParam('heading', ...) but for assetData.placement.
  updateTilesetHeading(assetId, value) {
    const assetData = BimViewer.loadedAssets.get(assetId);
    if (!assetData || assetData.isGLB || !assetData.placement) return;

    const v = parseFloat(value);
    assetData.placement.heading = v;
    const headingVal = document.getElementById(`tileset_heading_val_${assetId}`);
    if (headingVal) headingVal.textContent = Math.round(v) + '°';

    if (typeof BimViewer.updateAssetPlacement === 'function') {
      BimViewer.updateAssetPlacement(assetId);
    }
  },

  // ⭐ NEW: Update asset Z-Offset (with debouncing)
  updateAssetZOffset(assetId, value) {
    const offsetValue = parseFloat(value);
    const valueDisplay = document.getElementById(`zoffset_value_${assetId}`);
    const inputBox = document.getElementById(`zoffset_input_${assetId}`);
    
    if (valueDisplay) {
      valueDisplay.textContent = `${offsetValue >= 0 ? '+' : ''}${offsetValue.toFixed(2)} m`;
      
      // Color coding based on value (adjusted for -15 to +15 range)
      if (offsetValue < -9) {
        valueDisplay.style.color = '#f44336'; // Red (deep)
      } else if (offsetValue < -3) {
        valueDisplay.style.color = '#ff9800'; // Orange
      } else if (offsetValue >= -3 && offsetValue <= 3) {
        valueDisplay.style.color = '#4caf50'; // Green (near zero)
      } else if (offsetValue <= 9) {
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
    } else if (offsetValue < -200) {
      offsetValue = -200;
    } else if (offsetValue > 200) {
      offsetValue = 200;
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
  },

  _assetsLoadVersion: 0,

  // Auto-load Ion assets on startup
  async autoLoadIonAssets() {
    const loadingEl = document.getElementById('ionAssetsLoading');
    const selector = document.getElementById('ionAssetSelector');
    const importBtn = document.getElementById('importSelectedAsset');

    if (!selector) {
      console.log('Ion asset selector not found, retrying...');
      setTimeout(() => this.autoLoadIonAssets(), 500);
      return;
    }

    // Increment version — if another call starts while we're awaiting,
    // this call's result is stale and should be discarded
    var myVersion = ++this._assetsLoadVersion;

    try {
      console.log('Auto-loading Ion assets...');

      // Fetch assets from Ion account
      const allAssets = await BimViewer.fetchAvailableAssets();

      // Discard if a newer call has started while we were awaiting
      if (myVersion !== this._assetsLoadVersion) return;

      var isOAuth = typeof BimIonAuth !== 'undefined' && BimIonAuth.isOAuthConnected();
      var assets;

      if (isOAuth) {
        // OAuth — show all 3D Tiles and 3D Model assets from user's account
        assets = allAssets.filter(asset =>
          asset.type === '3DTILES' || asset.type === 'GLTF'
        );
      } else {
        // Demo — show curated asset IDs, using live Ion names where available
        var liveNameMap = new Map(allAssets.map(function(a) { return [Number(a.id), a.name]; }));
        assets = Array.from(DEMO_ASSETS, function(entry) {
          return {
            id: entry[0],
            name: liveNameMap.get(Number(entry[0])) || entry[1],
            type: '3DTILES'
          };
        });
      }

      // Optional per-mode allowlist (e.g. Bridge Inspector restricts to a curated set)
      if (window._bridgeInspectorAssetFilter instanceof Set) {
        assets = assets.filter(a => window._bridgeInspectorAssetFilter.has(String(a.id)));
      }

      console.log(`Loaded ${assets.length} assets (from ${allAssets.length} total)`);

      // Show selector
      if (loadingEl) loadingEl.style.display = 'none';
      selector.style.display = 'block';
      if (importBtn) importBtn.style.display = 'block';

      // Clear and populate selector
      selector.innerHTML = '<option value="">-- Select an asset to import --</option>';

      assets.forEach(asset => {
        const option = document.createElement('option');
        option.value = asset.id;
        option.textContent = `${asset.name} (ID: ${asset.id})`;
        selector.appendChild(option);
      });

      console.log(`${assets.length} assets available in selector`);
      BimViewer.updateStatus(`${assets.length} assets available`, 'success');

    } catch (error) {
      console.error('Failed to auto-load Ion assets:', error);
      if (loadingEl) {
        loadingEl.innerHTML = '<span style="color: #f44336;">Failed to load assets. Check console.</span>';
      }
      BimViewer.updateStatus('Failed to load Ion assets', 'error');
    }
  }
};

// Expose globally
window.BimViewerUI = BimViewerUI;

// Reload asset list when Ion token changes (OAuth connect/disconnect)
window.addEventListener('ion-token-changed', function() {
  if (BimViewerUI && typeof BimViewerUI.autoLoadIonAssets === 'function') {
    console.log('Ion token changed — reloading asset list...');
    BimViewerUI.autoLoadIonAssets();
  }
});

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => BimViewerUI.init(), 100);
  });
} else {
  setTimeout(() => BimViewerUI.init(), 100);
}

console.log('✅ Modern UI module v3.2 (COMPLETE) loaded - Integrated Z-Offset Controls (-70m to +70m)');
