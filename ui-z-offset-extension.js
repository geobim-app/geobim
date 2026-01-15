// ===============================
// CESIUM BIM VIEWER - Z-OFFSET UI EXTENSION v2.0
// OPTIONAL: Legacy global Z-offset functionality
// NOTE: Individual Z-offset is now integrated directly in asset list!
// ===============================
'use strict';

(function() {
  
  if (typeof BimViewerUI === 'undefined') {
    console.error('❌ BimViewerUI not found! This extension requires ui.js to be loaded first.');
    return;
  }
  
  console.log('ℹ️ Z-Offset UI Extension v2.0 loaded (Legacy Global Z-Offset Support)');
  console.log('   Individual Z-Offset controls are now integrated in the asset list!');
  console.log('   This extension only provides optional global Z-offset functionality.');
  
  // You can optionally add a global Z-offset section if needed
  // For now, individual Z-offset per asset (integrated in asset cards) is the primary method
  
  // Helper function to update all asset Z-offset UI elements (called when assets are added/removed)
  BimViewer.updateZOffsetAssetsList = function() {
    // This function is called when assets are added
    // Individual Z-offset controls are already in each asset card
    // No need to update a separate list
    console.log('✅ Z-Offset controls updated (integrated in asset cards)');
  };
  
  // Optional: Add keyboard shortcuts for quick Z-offset adjustments
  document.addEventListener('keydown', (event) => {
    // Skip if user is typing in an input
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
    
    const key = event.key;
    
    // Example: Use PageUp/PageDown to adjust Z-offset of visible assets
    if (key === 'PageUp' && event.shiftKey) {
      event.preventDefault();
      adjustAllVisibleAssetsZOffset(1); // +1m
    } else if (key === 'PageDown' && event.shiftKey) {
      event.preventDefault();
      adjustAllVisibleAssetsZOffset(-1); // -1m
    }
  });
  
  // Helper to adjust all visible assets by delta
  function adjustAllVisibleAssetsZOffset(delta) {
    let adjusted = 0;
    BimViewer.loadedAssets.forEach((asset, assetId) => {
      if (asset.tileset && asset.tileset.show) {
        const currentOffset = BimViewer.zOffset.individualOffsets.get(asset.tileset) || 0;
        const newOffset = Math.max(-70, Math.min(70, currentOffset + delta));
        
        // Update slider and value display
        const slider = document.getElementById(`zoffset_slider_${assetId}`);
        if (slider) {
          slider.value = newOffset;
          BimViewerUI.updateAssetZOffset(assetId, newOffset);
          adjusted++;
        }
      }
    });
    
    if (adjusted > 0) {
      BimViewer.updateStatus(`Adjusted ${adjusted} visible asset(s) by ${delta >= 0 ? '+' : ''}${delta}m`, 'success');
    }
  }
  
  console.log('💡 Shortcuts:');
  console.log('   - Shift+PageUp: Raise all visible assets by +1m');
  console.log('   - Shift+PageDown: Lower all visible assets by -1m');
  
})();
