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
// 1. Linework, all iModels: the Bentley mesh export (3DTILES) writes an
//    iModel's linework — element edges, 2D outlines, dashed footprints — as
//    glTF LINES primitives next to the triangles. Rendered in 3D they show as
//    red / blue lines over the models. Line primitives carry no NORMAL
//    attribute, the surfaces do, so a custom shader discards fragments of
//    primitives without normals (CesiumJS defines HAS_NORMALS per primitive).
//    Surfaces exported without normals go too; the demo station has 3 of 432.
// 2. Overlays, iTwin demo station only: the export contains every category,
//    also those a Bentley view leaves off. Hidden by subcategory id (the tiles
//    carry only ids, no names; found by reading the demo's glTF):
//      2199023256763 translucent cyan volumes (alpha 0.13, e.g. around the
//                    seats) — the glass is in other subcategories and stays
//      2199023257007 floor overlay, coplanar with the floor (purple flicker)
//      2199023257253 one coarse floor plate over the detailed floor (grey
//                    streaks); the floor itself is 2199023256839
// ===============================
'use strict';

(function() {

  var HIDDEN_SUBCATEGORIES = {
    '669dde67-eb69-4e0b-bcf2-f722eee94746': ['2199023256763', '2199023257007', '2199023257253']
  };

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

  // Leaves a shader someone else set alone
  BimViewer.hideITwinLinework = function(tileset) {
    if (!tileset || tileset.customShader) return false;
    tileset.customShader = noLinesShader();
    return true;
  };

  // Subcategory ids are uint64 (BigInt in CesiumJS) — compared as strings
  function overlayStyle(assetData) {
    var ids = HIDDEN_SUBCATEGORIES[String(assetData.iModelId || '').toLowerCase()];
    if (!ids) return null;
    var style = { show: ids.map(function(id) { return "String(${subcategory}) !== '" + id + "'"; }).join(' && ') };
    // like core.js updateAssetOpacity
    if (assetData.opacity !== undefined && assetData.opacity < 1) style.color = "color('white', " + assetData.opacity + ')';
    return new Cesium.Cesium3DTileStyle(style);
  }

  function applyOverlays(assetData) {
    var style = assetData && assetData.tileset && overlayStyle(assetData);
    if (style) assetData.tileset.style = style;
  }

  if (typeof BimViewer.loadITwinModel === 'function') {
    var origLoad = BimViewer.loadITwinModel;
    BimViewer.loadITwinModel = async function() {
      var assetData = await origLoad.apply(this, arguments);
      if (assetData && assetData.tileset) {
        BimViewer.hideITwinLinework(assetData.tileset);
        applyOverlays(assetData);
      }
      return assetData;
    };
  }

  // The opacity slider replaces the style of tilesets without an IFC filter
  // (core.js updateAssetOpacity) — keep the overlays hidden
  if (typeof BimViewer.updateAssetOpacity === 'function') {
    var origOpacity = BimViewer.updateAssetOpacity;
    BimViewer.updateAssetOpacity = function(assetId) {
      var result = origOpacity.apply(this, arguments);
      var assetData = this.loadedAssets && this.loadedAssets.get(assetId);
      if (assetData && assetData.type === 'ITWIN') applyOverlays(assetData);
      return result;
    };
  }

  console.log('iTwin display module loaded');
})();
