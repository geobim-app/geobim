// ===============================
// CESIUM BIM VIEWER - LIGHTING UI (STANDALONE v4.0)
// Funktioniert unabhängig von anderen UI-Extensions
// ===============================
'use strict';

(function() {
  console.log('🌅 Loading Standalone Lighting UI v4.0...');
  
  // Wait for BimViewer and lighting to be ready
  const waitForReady = setInterval(() => {
    if (typeof BimViewer === 'undefined' || 
        !BimViewer.viewer || 
        typeof BimViewer.enableDynamicLighting !== 'function') {
      return;
    }
    
    clearInterval(waitForReady);
    initStandaloneLightingUI();
  }, 100);
  
  function initStandaloneLightingUI() {
    console.log('✅ Initializing Standalone Lighting UI...');
    
    // Find or create toolbar section
    const toolbar = document.getElementById('toolbar');
    if (!toolbar) {
      console.error('❌ Toolbar not found!');
      return;
    }
    
    // Create lighting section
    const lightingSection = document.createElement('div');
    lightingSection.id = 'standalone-lighting-section';
    lightingSection.className = 'lighting-section';
    lightingSection.innerHTML = `
      <div class="lighting-header">
        <h3>☀️ Lighting & Time</h3>
      </div>
      
      <div class="lighting-content">
        <!-- Enable Button -->
        <button id="toggleLightingBtn" class="lighting-btn lighting-btn-primary">
          <span class="btn-icon">🌅</span>
          <span>Enable Lighting</span>
        </button>
        
        <!-- Status Box -->
        <div id="lightingStatusBox" class="lighting-status-box" style="display: none;">
          <div class="status-item">
            <span class="status-label">🌍 Terrain:</span>
            <span id="terrainStatusValue" class="status-value">Loading...</span>
          </div>
          <div class="status-item">
            <span class="status-label">⏰ Time:</span>
            <span id="timeStatusValue" class="status-value">--:--</span>
          </div>
          <div class="status-item">
            <span class="status-label">💡 Mode:</span>
            <span id="modeStatusValue" class="status-value">realistic</span>
          </div>
        </div>
        
        <!-- Controls Container -->
        <div id="lightingControlsContainer" style="display: none;">
          
          <!-- Ambient Modes -->
          <div class="lighting-group">
            <label class="lighting-label">💡 Ambient Mode</label>
            <div class="ambient-grid">
              <button class="ambient-btn active" data-mode="realistic" title="Dark at night">
                <span class="ambient-icon">🌙</span>
                <span class="ambient-text">Realistic</span>
              </button>
              <button class="ambient-btn" data-mode="soft" title="Slightly lit at night">
                <span class="ambient-icon">🌆</span>
                <span class="ambient-text">Soft</span>
              </button>
              <button class="ambient-btn" data-mode="balanced" title="Well lit at night">
                <span class="ambient-icon">🌃</span>
                <span class="ambient-text">Balanced</span>
              </button>
              <button class="ambient-btn" data-mode="bright" title="Always bright">
                <span class="ambient-icon">💡</span>
                <span class="ambient-text">Bright</span>
              </button>
            </div>
          </div>
          
          <!-- Time Presets -->
          <div class="lighting-group">
            <label class="lighting-label">⏰ Time of Day</label>
            <div class="time-grid">
              <button class="time-btn" data-time="dawn">🌄 Dawn</button>
              <button class="time-btn" data-time="morning">🌞 Morning</button>
              <button class="time-btn active" data-time="noon">☀️ Noon</button>
              <button class="time-btn" data-time="afternoon">🌤️ Afternoon</button>
              <button class="time-btn" data-time="sunset">🌇 Sunset</button>
              <button class="time-btn" data-time="dusk">🌆 Dusk</button>
              <button class="time-btn" data-time="night">🌙 Night</button>
              <button class="time-btn" data-time="midnight">🌃 Midnight</button>
            </div>
          </div>
          
          <!-- Animation Controls -->
          <div class="lighting-group">
            <label class="lighting-label">🎬 Animation</label>
            <div class="animation-controls">
              <button id="playAnimBtn" class="anim-btn">
                <span>▶️</span> Play
              </button>
              <button id="pauseAnimBtn" class="anim-btn active">
                <span>⏸️</span> Pause
              </button>
            </div>
            <div class="speed-control">
              <label class="speed-label">
                Speed: <span id="speedValue">100x</span>
              </label>
              <input type="range" id="speedSlider" class="speed-slider" 
                     min="10" max="1000" value="100" step="10">
            </div>
          </div>
          
          <!-- Quick Presets -->
          <div class="lighting-group">
            <label class="lighting-label">⚡ Quick Presets</label>
            <div class="preset-grid">
              <button class="preset-btn" data-preset="moonlight">
                🌙 Moonlight
              </button>
              <button class="preset-btn" data-preset="golden">
                🌅 Golden Hour
              </button>
              <button class="preset-btn" data-preset="bright">
                ☀️ Bright Day
              </button>
              <button class="preset-btn" data-preset="timelapse">
                🎬 Time-Lapse
              </button>
            </div>
          </div>
          
          <!-- Tips -->
          <div class="lighting-tips">
            <strong>💡 Tip:</strong> Try <strong>Realistic + Night</strong> for maximum effect!
          </div>
        </div>
      </div>
    `;
    
    // Add to toolbar (at the top)
    toolbar.insertBefore(lightingSection, toolbar.firstChild);
    
    // Add styles
    addLightingStyles();
    
    // Attach event handlers
    attachEventHandlers();
    
    console.log('✅ Standalone Lighting UI ready!');
  }
  
  function attachEventHandlers() {
    // Toggle Lighting Button
    const toggleBtn = document.getElementById('toggleLightingBtn');
    const controlsContainer = document.getElementById('lightingControlsContainer');
    const statusBox = document.getElementById('lightingStatusBox');
    
    toggleBtn?.addEventListener('click', () => {
      const isEnabled = BimViewer.lighting?.enabled || false;
      BimViewer.enableDynamicLighting(!isEnabled);
      
      if (!isEnabled) {
        // Enabled
        toggleBtn.classList.add('active');
        toggleBtn.innerHTML = '<span class="btn-icon">🌞</span><span>Lighting ON</span>';
        controlsContainer.style.display = 'block';
        statusBox.style.display = 'block';
        startStatusUpdates();
      } else {
        // Disabled
        toggleBtn.classList.remove('active');
        toggleBtn.innerHTML = '<span class="btn-icon">🌅</span><span>Enable Lighting</span>';
        controlsContainer.style.display = 'none';
        statusBox.style.display = 'none';
        stopStatusUpdates();
      }
    });
    
    // Ambient Mode Buttons
    document.querySelectorAll('.ambient-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const mode = this.dataset.mode;
        BimViewer.setAmbientLightingMode(mode);
        
        document.querySelectorAll('.ambient-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        
        updateStatusDisplay();
      });
    });
    
    // Time Preset Buttons
    document.querySelectorAll('.time-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const time = this.dataset.time;
        BimViewer.setPresetTime(time);
        
        document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        
        updateStatusDisplay();
      });
    });
    
    // Animation Controls
    document.getElementById('playAnimBtn')?.addEventListener('click', function() {
      const speed = parseInt(document.getElementById('speedSlider').value);
      BimViewer.animateTime(true, speed);
      
      this.classList.add('active');
      document.getElementById('pauseAnimBtn').classList.remove('active');
    });
    
    document.getElementById('pauseAnimBtn')?.addEventListener('click', function() {
      BimViewer.animateTime(false);
      
      this.classList.add('active');
      document.getElementById('playAnimBtn').classList.remove('active');
    });
    
    // Speed Slider
    document.getElementById('speedSlider')?.addEventListener('input', function() {
      const speed = parseInt(this.value);
      document.getElementById('speedValue').textContent = speed + 'x';
      
      if (BimViewer.lighting?.animateTime) {
        BimViewer.viewer.clock.multiplier = speed;
      }
    });
    
    // Quick Presets
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const preset = this.dataset.preset;
        
        switch(preset) {
          case 'moonlight':
            BimViewer.setAmbientLightingMode('realistic');
            BimViewer.setPresetTime('midnight');
            updateActiveButtons('realistic', 'midnight');
            break;
          case 'golden':
            BimViewer.setAmbientLightingMode('realistic');
            BimViewer.setPresetTime('sunset');
            updateActiveButtons('realistic', 'sunset');
            break;
          case 'bright':
            BimViewer.setAmbientLightingMode('balanced');
            BimViewer.setPresetTime('noon');
            updateActiveButtons('balanced', 'noon');
            break;
          case 'timelapse':
            document.getElementById('speedSlider').value = 200;
            document.getElementById('speedValue').textContent = '200x';
            BimViewer.animateTime(true, 200);
            document.getElementById('playAnimBtn').classList.add('active');
            document.getElementById('pauseAnimBtn').classList.remove('active');
            break;
        }
        
        BimViewer.updateStatus(`${preset} preset activated`, 'success');
      });
    });
  }
  
  function updateActiveButtons(mode, time) {
    // Update ambient mode
    document.querySelectorAll('.ambient-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    
    // Update time
    document.querySelectorAll('.time-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.time === time);
    });
  }
  
  let statusInterval = null;
  
  function startStatusUpdates() {
    stopStatusUpdates();
    updateStatusDisplay();
    statusInterval = setInterval(updateStatusDisplay, 2000);
  }
  
  function stopStatusUpdates() {
    if (statusInterval) {
      clearInterval(statusInterval);
      statusInterval = null;
    }
  }
  
  function updateStatusDisplay() {
    // Terrain Status
    const terrainStatus = document.getElementById('terrainStatusValue');
    if (terrainStatus && BimViewer.lighting) {
      terrainStatus.textContent = BimViewer.lighting.terrainReloaded ? '✅ Ready' : '⏳ Loading...';
      terrainStatus.style.color = BimViewer.lighting.terrainReloaded ? '#4caf50' : '#ffa500';
    }
    
    // Time Status
    const timeStatus = document.getElementById('timeStatusValue');
    if (timeStatus && BimViewer.viewer) {
      const currentTime = BimViewer.viewer.clock.currentTime;
      const date = Cesium.JulianDate.toDate(currentTime);
      const hours = date.getUTCHours().toString().padStart(2, '0');
      const minutes = date.getUTCMinutes().toString().padStart(2, '0');
      timeStatus.textContent = `${hours}:${minutes}`;
    }
    
    // Mode Status
    const modeStatus = document.getElementById('modeStatusValue');
    if (modeStatus && BimViewer.lighting) {
      const mode = BimViewer.lighting.ambientMode || 'realistic';
      modeStatus.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
    }
  }
  
  function addLightingStyles() {
    const style = document.createElement('style');
    style.textContent = `
      /* Lighting Section */
      .lighting-section {
        background: rgba(26, 32, 44, 0.95);
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 16px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      }
      
      .lighting-header h3 {
        margin: 0 0 12px 0;
        color: #f5f5f5;
        font-size: 16px;
        font-weight: 600;
      }
      
      .lighting-content {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      
      /* Buttons */
      .lighting-btn {
        width: 100%;
        padding: 12px 16px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: all 0.3s ease;
      }
      
      .lighting-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
      }
      
      .lighting-btn.active {
        background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        animation: pulse 2s infinite;
      }
      
      @keyframes pulse {
        0%, 100% { box-shadow: 0 0 10px rgba(245, 87, 108, 0.5); }
        50% { box-shadow: 0 0 20px rgba(245, 87, 108, 0.8); }
      }
      
      .btn-icon {
        font-size: 18px;
      }
      
      /* Status Box */
      .lighting-status-box {
        background: rgba(0, 0, 0, 0.3);
        border-left: 3px solid #4caf50;
        border-radius: 6px;
        padding: 10px;
      }
      
      .status-item {
        display: flex;
        justify-content: space-between;
        padding: 4px 0;
        font-size: 12px;
      }
      
      .status-label {
        color: rgba(255, 255, 255, 0.7);
        font-weight: 600;
      }
      
      .status-value {
        color: #4caf50;
        font-weight: 700;
        font-family: 'Courier New', monospace;
      }
      
      /* Groups */
      .lighting-group {
        margin-top: 8px;
      }
      
      .lighting-label {
        display: block;
        font-size: 11px;
        color: rgba(255, 255, 255, 0.7);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 8px;
      }
      
      /* Ambient Grid */
      .ambient-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
      }
      
      .ambient-btn {
        background: rgba(255, 255, 255, 0.08);
        border: 2px solid rgba(255, 255, 255, 0.15);
        color: white;
        padding: 12px 8px;
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        font-weight: 600;
        transition: all 0.3s ease;
      }
      
      .ambient-btn:hover {
        background: rgba(255, 255, 255, 0.15);
        transform: translateY(-2px);
      }
      
      .ambient-btn.active {
        background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        border-color: rgba(245, 87, 108, 0.8);
        box-shadow: 0 4px 12px rgba(245, 87, 108, 0.4);
      }
      
      .ambient-icon {
        font-size: 24px;
      }
      
      .ambient-text {
        font-size: 11px;
        text-transform: uppercase;
      }
      
      /* Time Grid */
      .time-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 6px;
      }
      
      .time-btn {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: white;
        padding: 8px 10px;
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s ease;
        text-align: left;
      }
      
      .time-btn:hover {
        background: rgba(255, 255, 255, 0.15);
        transform: translateY(-1px);
      }
      
      .time-btn.active {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
      }
      
      /* Animation Controls */
      .animation-controls {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-bottom: 8px;
      }
      
      .anim-btn {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: white;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      
      .anim-btn:hover {
        background: rgba(255, 255, 255, 0.15);
      }
      
      .anim-btn.active {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      }
      
      /* Speed Control */
      .speed-control {
        margin-top: 8px;
      }
      
      .speed-label {
        display: block;
        font-size: 11px;
        color: rgba(255, 255, 255, 0.7);
        margin-bottom: 4px;
      }
      
      .speed-slider {
        width: 100%;
        height: 4px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 2px;
        outline: none;
        -webkit-appearance: none;
        cursor: pointer;
      }
      
      .speed-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 16px;
        height: 16px;
        background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        border-radius: 50%;
        cursor: pointer;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }
      
      .speed-slider::-moz-range-thumb {
        width: 16px;
        height: 16px;
        background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        border-radius: 50%;
        cursor: pointer;
        border: none;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }
      
      /* Preset Grid */
      .preset-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 6px;
      }
      
      .preset-btn {
        background: rgba(102, 126, 234, 0.2);
        border: 1px solid rgba(102, 126, 234, 0.3);
        color: white;
        padding: 8px 10px;
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      
      .preset-btn:hover {
        background: rgba(102, 126, 234, 0.3);
        transform: translateY(-1px);
      }
      
      /* Tips */
      .lighting-tips {
        background: rgba(102, 126, 234, 0.1);
        border-left: 3px solid #667eea;
        padding: 10px;
        border-radius: 6px;
        font-size: 11px;
        line-height: 1.6;
        color: rgba(255, 255, 255, 0.8);
        margin-top: 8px;
      }
      
      .lighting-tips strong {
        color: #a5b4fc;
      }
    `;
    document.head.appendChild(style);
  }
  
  console.log('✅ Standalone Lighting UI module loaded');
})();
