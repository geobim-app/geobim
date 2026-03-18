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
// CONSTRUCTION SEQUENCING MODULE v1.0
// 4D BIM — animate construction stages via IFC "stage" property
// Elements without "stage" stay always visible
// ===============================
'use strict';

(function() {

  // =====================================
  // STATE
  // =====================================

  // Property names to search for (Cesium Ion concatenates pset+property)
  var STAGE_PROPS = ['stage', 'psetStageInfostage', 'pset_StageInfo_stage', 'Stage'];

  BimViewer.sequencing = {
    activeAssetId: null,
    stagePropName: null,  // detected property name
    currentStage: 1,
    minStage: 1,
    maxStage: 1,
    stageNames: {},       // { stageNum: 'name' } — future: named stages
    playing: false,
    playInterval: null,
    playSpeed: 1500       // ms per stage
  };

  // =====================================
  // DETECT STAGE PROPERTY
  // =====================================

  BimViewer.detectStageProperty = function(tileset) {
    if (!tileset || !tileset.root) return false;

    var detectedProp = null;
    var minStage = Infinity;
    var maxStage = -Infinity;

    var checkTile = function(tile) {
      if (tile.content && tile.content.featuresLength > 0) {
        for (var i = 0; i < Math.min(tile.content.featuresLength, 50); i++) {
          try {
            var feature = tile.content.getFeature(i);

            // Try known property names
            if (!detectedProp) {
              var ids = feature.getPropertyIds();
              for (var p = 0; p < STAGE_PROPS.length; p++) {
                if (ids.indexOf(STAGE_PROPS[p]) >= 0) {
                  detectedProp = STAGE_PROPS[p];
                  break;
                }
              }
              // Also try case-insensitive search for any prop containing "stage"
              if (!detectedProp) {
                for (var k = 0; k < ids.length; k++) {
                  if (ids[k].toLowerCase().indexOf('stage') >= 0) {
                    detectedProp = ids[k];
                    break;
                  }
                }
              }
            }

            if (detectedProp) {
              var stageVal = feature.getProperty(detectedProp);
              if (stageVal !== undefined && stageVal !== null) {
                var num = parseInt(stageVal, 10);
                if (!isNaN(num)) {
                  if (num < minStage) minStage = num;
                  if (num > maxStage) maxStage = num;
                }
              }
            }
          } catch (e) { /* skip */ }
        }
      }
      if (tile.children) {
        for (var c = 0; c < tile.children.length; c++) {
          checkTile(tile.children[c]);
        }
      }
    };

    checkTile(tileset.root);

    if (detectedProp && maxStage > -Infinity) {
      console.log('Sequencing: detected property "' + detectedProp + '" (stages ' + minStage + '-' + maxStage + ')');
      return { min: minStage, max: maxStage, prop: detectedProp };
    }
    return false;
  };

  // Full scan — iterate all loaded tiles to find true min/max
  BimViewer.scanAllStages = function(tileset, propName) {
    var min = Infinity;
    var max = -Infinity;

    var checkTile = function(tile) {
      if (tile.content && tile.content.featuresLength > 0) {
        for (var i = 0; i < tile.content.featuresLength; i++) {
          try {
            var feature = tile.content.getFeature(i);
            var stageVal = feature.getProperty(propName);
            if (stageVal !== undefined && stageVal !== null) {
              var num = parseInt(stageVal, 10);
              if (!isNaN(num)) {
                if (num < min) min = num;
                if (num > max) max = num;
              }
            }
          } catch (e) { /* skip */ }
        }
      }
      if (tile.children) {
        for (var c = 0; c < tile.children.length; c++) {
          checkTile(tile.children[c]);
        }
      }
    };

    checkTile(tileset.root);
    if (max > -Infinity) return { min: min, max: max };
    return null;
  };

  // =====================================
  // ACTIVATE / DEACTIVATE
  // =====================================

  BimViewer.toggleSequencing = function(assetId) {
    assetId = assetId.toString();
    if (this.sequencing.activeAssetId === assetId) {
      this.deactivateSequencing();
    } else {
      if (this.sequencing.activeAssetId) {
        this.deactivateSequencing();
      }
      this.activateSequencing(assetId);
    }
  };

  BimViewer.activateSequencing = function(assetId) {
    assetId = assetId.toString();
    var assetData = this.loadedAssets.get(assetId);
    if (!assetData || !assetData.tileset) return;

    // Detect stages
    var stageInfo = this.detectStageProperty(assetData.tileset);
    if (!stageInfo) {
      this.updateStatus('No "stage" property found in this asset', 'warning');
      return;
    }

    this.sequencing.activeAssetId = assetId;
    this.sequencing.stagePropName = stageInfo.prop;
    this.sequencing.minStage = stageInfo.min;
    this.sequencing.maxStage = stageInfo.max;
    this.sequencing.currentStage = stageInfo.max; // Start showing all stages

    // Do a full scan after a delay (more tiles may have streamed in)
    var self = this;
    setTimeout(function() {
      var fullScan = self.scanAllStages(assetData.tileset, self.sequencing.stagePropName);
      if (fullScan && fullScan.max > self.sequencing.maxStage) {
        self.sequencing.maxStage = fullScan.max;
        self.sequencing.currentStage = fullScan.max;
        self.updateSequencingUI();
        self.applySequencingStyle(assetId);
      }
    }, 3000);

    // Apply initial style (show all)
    this.applySequencingStyle(assetId);

    // Show timeline UI
    this.createSequencingTimeline();
    this.updateSequencingUI();

    // Highlight button
    var btn = document.getElementById('seqBtn_' + assetId);
    if (btn) btn.classList.add('seq-active');

    this.updateStatus('Construction sequencing active (stages ' + stageInfo.min + '-' + stageInfo.max + ')', 'success');

    if (typeof plausible !== 'undefined' && !this._seqTracked) {
      plausible('Feature Used', { props: { feature: 'Sequencing' } });
      this._seqTracked = true;
    }
  };

  BimViewer.deactivateSequencing = function() {
    var assetId = this.sequencing.activeAssetId;
    if (!assetId) return;

    // Stop playback
    this.stopSequencingPlayback();

    // Remove style (show everything)
    var assetData = this.loadedAssets.get(assetId);
    if (assetData && assetData.tileset) {
      assetData.tileset.style = undefined;
    }

    // Re-apply IFC filter if active
    if (typeof this.applyIFCFilter === 'function') {
      this.applyIFCFilter();
    }

    // Hide timeline
    var timeline = document.getElementById('seqTimeline');
    if (timeline) timeline.classList.remove('visible');

    // Un-highlight button
    var btn = document.getElementById('seqBtn_' + assetId);
    if (btn) btn.classList.remove('seq-active');

    this.sequencing.activeAssetId = null;
    this.updateStatus('Sequencing deactivated', 'success');
  };

  // =====================================
  // STYLE APPLICATION
  // =====================================

  BimViewer.applySequencingStyle = function(assetId) {
    assetId = assetId.toString();
    var assetData = this.loadedAssets.get(assetId);
    if (!assetData || !assetData.tileset) return;

    var stage = this.sequencing.currentStage;
    var prop = this.sequencing.stagePropName;

    // Guard: isNaN check must come BEFORE any < or === on the property,
    // because Cesium evaluates conditions top-to-bottom and the < operator
    // throws when the property is undefined on a feature.
    var hasProp = "!isNaN(Number(${" + prop + "}))";
    var noProp  = "isNaN(Number(${" + prop + "}))";
    var numProp = "Number(${" + prop + "})";

    var conditions = [];

    // No stage property → neutral (must be first to guard the operators below)
    conditions.push([noProp, "color('#CCCCCC')"]);

    // Current stage: gold highlight
    conditions.push([numProp + " === " + stage, "color('#FFD700')"]);

    // Past stages: muted built look
    if (stage > this.sequencing.minStage) {
      conditions.push([numProp + " < " + stage, "color('#8899AA')"]);
    }

    // Fallback
    conditions.push(["true", "color('#CCCCCC')"]);

    var showExpr = noProp + " || " + numProp + " <= " + stage;

    assetData.tileset.style = new Cesium.Cesium3DTileStyle({
      show: showExpr,
      color: {
        conditions: conditions
      }
    });
  };

  // =====================================
  // NAVIGATION
  // =====================================

  BimViewer.setSequencingStage = function(stage) {
    stage = parseInt(stage, 10);
    if (isNaN(stage)) return;
    stage = Math.max(this.sequencing.minStage, Math.min(this.sequencing.maxStage, stage));

    this.sequencing.currentStage = stage;
    if (this.sequencing.activeAssetId) {
      this.applySequencingStyle(this.sequencing.activeAssetId);
    }
    this.updateSequencingUI();
  };

  BimViewer.nextStage = function() {
    if (this.sequencing.currentStage < this.sequencing.maxStage) {
      this.setSequencingStage(this.sequencing.currentStage + 1);
    } else if (this.sequencing.playing) {
      // Loop back to start
      this.setSequencingStage(this.sequencing.minStage);
    }
  };

  BimViewer.prevStage = function() {
    if (this.sequencing.currentStage > this.sequencing.minStage) {
      this.setSequencingStage(this.sequencing.currentStage - 1);
    }
  };

  // =====================================
  // PLAYBACK
  // =====================================

  BimViewer.toggleSequencingPlayback = function() {
    if (this.sequencing.playing) {
      this.stopSequencingPlayback();
    } else {
      this.startSequencingPlayback();
    }
  };

  BimViewer.startSequencingPlayback = function() {
    this.sequencing.playing = true;

    // Start from beginning if at the end
    if (this.sequencing.currentStage >= this.sequencing.maxStage) {
      this.setSequencingStage(this.sequencing.minStage);
    }

    var self = this;
    this.sequencing.playInterval = setInterval(function() {
      self.nextStage();
      if (self.sequencing.currentStage >= self.sequencing.maxStage) {
        self.stopSequencingPlayback();
      }
    }, this.sequencing.playSpeed);

    this.updateSequencingUI();
  };

  BimViewer.stopSequencingPlayback = function() {
    this.sequencing.playing = false;
    if (this.sequencing.playInterval) {
      clearInterval(this.sequencing.playInterval);
      this.sequencing.playInterval = null;
    }
    this.updateSequencingUI();
  };

  // =====================================
  // UI — TIMELINE BAR
  // =====================================

  BimViewer.createSequencingTimeline = function() {
    var existing = document.getElementById('seqTimeline');
    if (existing) {
      existing.classList.add('visible');
      return;
    }

    var bar = document.createElement('div');
    bar.id = 'seqTimeline';
    bar.className = 'seq-timeline visible';

    bar.innerHTML =
      '<div class="seq-header" id="seqHeader">' +
        '<span class="seq-title">Construction Sequencing</span>' +
        '<div class="seq-header-right">' +
          '<span class="seq-stage-label" id="seqStageLabel">Stage 1</span>' +
          '<button class="seq-close-btn" onclick="BimViewer.deactivateSequencing()" title="Close">\u2715</button>' +
        '</div>' +
      '</div>' +
      '<div class="seq-body">' +
        '<div class="seq-slider-row">' +
          '<span class="seq-stage-counter" id="seqCounter">1/' + this.sequencing.maxStage + '</span>' +
          '<input type="range" class="seq-slider" id="seqSlider" ' +
            'min="' + this.sequencing.minStage + '" max="' + this.sequencing.maxStage + '" ' +
            'step="1" value="' + this.sequencing.currentStage + '" ' +
            'oninput="BimViewer.setSequencingStage(this.value)">' +
        '</div>' +
        '<div class="seq-controls">' +
          '<button class="seq-btn" onclick="BimViewer.setSequencingStage(' + this.sequencing.minStage + ')" title="First stage">\u23EE</button>' +
          '<button class="seq-btn" onclick="BimViewer.prevStage()" title="Previous stage">\u25C0</button>' +
          '<button class="seq-btn" id="seqPlayBtn" onclick="BimViewer.toggleSequencingPlayback()" title="Play/Pause">\u25B6</button>' +
          '<button class="seq-btn" onclick="BimViewer.nextStage()" title="Next stage">\u25B6</button>' +
          '<button class="seq-btn" onclick="BimViewer.setSequencingStage(' + this.sequencing.maxStage + ')" title="Last stage">\u23ED</button>' +
          '<span class="seq-stage-name" id="seqStageName">Stage ' + this.sequencing.currentStage + '</span>' +
        '</div>' +
        '<div class="seq-chips" id="seqChips"></div>' +
      '</div>';

    document.body.appendChild(bar);

    // Make draggable
    if (typeof BimViewer.makeFloatingPanelDraggable === 'function') {
      BimViewer.makeFloatingPanelDraggable(bar, document.getElementById('seqHeader'));
    }

    // Build stage chips
    this.updateSequencingChips();
  };

  BimViewer.updateSequencingUI = function() {
    var slider = document.getElementById('seqSlider');
    var counter = document.getElementById('seqCounter');
    var label = document.getElementById('seqStageLabel');
    var name = document.getElementById('seqStageName');
    var playBtn = document.getElementById('seqPlayBtn');

    var stage = this.sequencing.currentStage;
    var max = this.sequencing.maxStage;

    if (slider) {
      slider.value = stage;
      slider.max = max;
    }
    if (counter) counter.textContent = stage + '/' + max;
    if (label) label.textContent = 'Stage ' + stage;
    if (name) {
      var stageName = this.sequencing.stageNames[stage] || 'Stage ' + stage;
      name.textContent = stageName;
    }
    if (playBtn) {
      playBtn.textContent = this.sequencing.playing ? '\u23F8' : '\u25B6';
      playBtn.classList.toggle('active', this.sequencing.playing);
    }

    this.updateSequencingChips();
  };

  BimViewer.updateSequencingChips = function() {
    var container = document.getElementById('seqChips');
    if (!container) return;

    var html = '';
    var current = this.sequencing.currentStage;
    for (var i = this.sequencing.minStage; i <= this.sequencing.maxStage; i++) {
      var cls = 'seq-chip';
      if (i === current) cls += ' current';
      else if (i < current) cls += ' past';
      html += '<span class="' + cls + '" onclick="BimViewer.setSequencingStage(' + i + ')">' + i + '</span>';
    }
    container.innerHTML = html;
  };

  // =====================================
  // INJECT SEQUENCING BUTTON INTO ASSET CARDS
  // =====================================

  BimViewer.injectSequencingButton = function(assetId) {
    assetId = assetId.toString();
    var assetDiv = document.getElementById('asset_' + assetId);
    if (!assetDiv) return;

    var controlsDiv = assetDiv.querySelector('.modern-asset-controls');
    if (!controlsDiv) return;

    // Don't add duplicate
    if (document.getElementById('seqBtn_' + assetId)) return;

    var btn = document.createElement('button');
    btn.id = 'seqBtn_' + assetId;
    btn.className = 'modern-icon-btn';
    btn.title = 'Construction sequencing';
    btn.textContent = '\u23F5';
    btn.onclick = function() { BimViewer.toggleSequencing(assetId); };

    // Insert before the clip button or delete button
    var clipBtn = document.getElementById('clipBtn_' + assetId);
    if (clipBtn) {
      controlsDiv.insertBefore(btn, clipBtn);
    } else {
      controlsDiv.insertBefore(btn, controlsDiv.lastElementChild);
    }
  };

  // =====================================
  // HOOKS
  // =====================================

  // Inject sequencing button when asset card is created
  if (window.BimViewerUI && typeof BimViewerUI.createAssetControls === 'function') {
    var origCreateAssetControls = BimViewerUI.createAssetControls.bind(BimViewerUI);
    BimViewerUI.createAssetControls = function(assetId) {
      origCreateAssetControls(assetId);
      BimViewer.injectSequencingButton(assetId);
    };
  }

  // Clean up when asset is unloaded
  var origUnloadAsset = BimViewer.unloadAsset.bind(BimViewer);
  BimViewer.unloadAsset = function(assetId) {
    if (BimViewer.sequencing.activeAssetId === assetId.toString()) {
      BimViewer.deactivateSequencing();
    }
    origUnloadAsset(assetId);
  };

  console.log('\u23F5 Construction Sequencing module loaded v1.0');
  console.log('\uD83D\uDCA1 Detects IFC "stage" property for 4D BIM animation');

})();
