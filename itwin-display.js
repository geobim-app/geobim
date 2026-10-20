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
// ITWIN DISPLAY
// The Bentley mesh export (3DTILES) writes an iModel's linework — element
// edges, 2D outlines, dashed footprints — as glTF LINES primitives next to the
// triangles. Rendered in 3D they show as red / blue lines over the models
// (e.g. around the seats in the iTwin demo station). This module hides them
// for every iTwin tileset loaded through BimViewer.loadITwinModel().
//
// Line primitives carry no NORMAL attribute, the surfaces do, so a custom
// shader discards fragments of primitives without normals (CesiumJS defines
// HAS_NORMALS per primitive). Surfaces exported without normals would go too;
// the demo station has 3 of 432.
// ===============================
'use strict';

(function() {

  var shader = null;

  function noLinesShader() {
    if (!shader) {
      shader = new Cesium.CustomShader({
        fragmentShaderText:
          'void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {\n' +
          '#ifndef HAS_NORMALS\n' +
          '  discard;\n' +
          '#endif\n' +
          '}\n'
      });
    }
    return shader;
  }

  // Leaves a shader someone else set (e.g. PBR materials) alone
  BimViewer.hideITwinLinework = function(tileset) {
    if (!tileset || tileset.customShader) return false;
    tileset.customShader = noLinesShader();
    return true;
  };

  if (typeof BimViewer.loadITwinModel === 'function') {
    var origLoad = BimViewer.loadITwinModel;
    BimViewer.loadITwinModel = async function() {
      var assetData = await origLoad.apply(this, arguments);
      if (assetData && assetData.tileset) BimViewer.hideITwinLinework(assetData.tileset);
      return assetData;
    };
  }

  console.log('iTwin display module loaded');
})();
