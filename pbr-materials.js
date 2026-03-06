/**
 * GEOBIM.APP - Geospatial BIM Viewer
 * © 2026 Christof Lorenz. All rights reserved.
 *
 * License: Personal and non-commercial use only.
 * Commercial use requires written permission.
 * Contact: info@geobim.app
 */

// ===============================
// CESIUM BIM VIEWER - PBR MATERIALS MODULE v1.1
// Procedural PBR texturing via CesiumJS CustomShader
// Works on 3D Tiles from Cesium Ion (IFC → 3D Tiles via Ion Design Tiler)
// Material detection: keyword match on feature properties → entity-type fallback → shader color detection
// Coexists with IFC Filter (style) independently
// ===============================
'use strict';

(function(BimViewer) {

  const STORAGE_KEY = 'geoBIM_settings_pbr';

  // === PBR COLOR PALETTE ===
  // Central palette: drives both Cesium3DTileStyle colors AND GLSL shader detection.
  // Colors must have enough distance for unambiguous shader classification.
  // Style sets exact palette color → shader matches nearest → applies PBR params.
  const PBR_PALETTE = {
    concrete:        { hex: '#7A7670', r: 0.478, g: 0.463, b: 0.439, metallic: 0.0,  roughness: 0.85 },
    steel_structural:{ hex: '#4A3828', r: 0.290, g: 0.220, b: 0.157, metallic: 0.8,  roughness: 0.45 },
    steel_polished:  { hex: '#8E8E93', r: 0.557, g: 0.557, b: 0.576, metallic: 0.9,  roughness: 0.25 },
    galvanized:      { hex: '#B3B5B7', r: 0.702, g: 0.710, b: 0.718, metallic: 0.7,  roughness: 0.35 },
    wood:            { hex: '#8C5A2E', r: 0.549, g: 0.353, b: 0.180, metallic: 0.0,  roughness: 0.75 },
    glass:           { hex: '#D9EBF2', r: 0.851, g: 0.922, b: 0.949, metallic: 0.1,  roughness: 0.05 },
    masonry:         { hex: '#A67358', r: 0.651, g: 0.451, b: 0.345, metallic: 0.0,  roughness: 0.90 },
    asphalt:         { hex: '#1A1A1A', r: 0.102, g: 0.102, b: 0.102, metallic: 0.0,  roughness: 0.95 },
    stone:           { hex: '#736B66', r: 0.451, g: 0.420, b: 0.400, metallic: 0.0,  roughness: 0.80 },
    earth:           { hex: '#4D3821', r: 0.302, g: 0.220, b: 0.129, metallic: 0.0,  roughness: 0.95 },
    plaster:         { hex: '#E8E4DF', r: 0.910, g: 0.894, b: 0.875, metallic: 0.0,  roughness: 0.70 },
    insulation:      { hex: '#E8D44D', r: 0.910, g: 0.831, b: 0.302, metallic: 0.0,  roughness: 0.80 },
    rubber:          { hex: '#0F0F0F', r: 0.059, g: 0.059, b: 0.059, metallic: 0.0,  roughness: 0.92 },
    copper:          { hex: '#B87333', r: 0.722, g: 0.451, b: 0.200, metallic: 0.9,  roughness: 0.30 },
    paint_white:     { hex: '#ECECEA', r: 0.925, g: 0.925, b: 0.918, metallic: 0.0,  roughness: 0.40 },
    default_pbr:     { hex: '#8A8580', r: 0.541, g: 0.522, b: 0.502, metallic: 0.0,  roughness: 0.60 }
  };

  // === MATERIAL KEYWORD MAPPING ===
  // Case-insensitive keyword matching on feature Material/MaterialName properties.
  // Comprehensive DE/EN terms covering Revit, Allplan, Archicad, Tekla exports (IFC 2x3/4).
  const MATERIAL_KEYWORDS = {
    concrete:         ['beton', 'concrete', 'stahlbeton', 'ortbeton', 'fertigbeton',
                       'reinforced', 'precast', 'c20', 'c25', 'c30', 'c35', 'c40', 'c45', 'c50'],
    steel_structural: ['stahl', 'steel', 'baustahl', 's235', 's275', 's355', 's450',
                       'structural steel', 'carbon steel', 'hea', 'heb', 'ipe', 'upn'],
    steel_polished:   ['edelstahl', 'stainless', 'aluminium', 'aluminum', 'inox',
                       'chromstahl', 'chrome'],
    galvanized:       ['verzinkt', 'galvanized', 'galvanised', 'zink', 'zinc',
                       'feuerverzinkt', 'hot-dip'],
    wood:             ['holz', 'wood', 'timber', 'brettschichtholz', 'glulam', 'bsh',
                       'kvh', 'eiche', 'oak', 'fichte', 'spruce', 'kiefer', 'pine',
                       'buche', 'beech', 'lärche', 'larch', 'plywood'],
    glass:            ['glas', 'glass', 'verglasung', 'glazing', 'fenster', 'window',
                       'isolierglas', 'float', 'tempered', 'laminated', 'esg', 'vsg'],
    masonry:          ['mauerwerk', 'masonry', 'brick', 'ziegel', 'klinker', 'clinker',
                       'kalksandstein', 'porenbeton', 'ytong', 'poroton', 'block', 'cmu'],
    asphalt:          ['bitumen', 'asphalt', 'teer', 'tar', 'schwarzdecke', 'fahrbahn',
                       'road surface', 'pavement'],
    stone:            ['naturstein', 'stone', 'granit', 'granite', 'sandstein', 'sandstone',
                       'marmor', 'marble', 'kalkstein', 'limestone', 'basalt', 'gneis',
                       'pflaster', 'paving'],
    earth:            ['erde', 'earth', 'soil', 'boden', 'ground', 'terrain', 'erdreich',
                       'auffüllung', 'fill', 'schotter', 'gravel', 'kies'],
    plaster:          ['putz', 'plaster', 'render', 'verputz', 'gips', 'gypsum',
                       'stuck', 'stucco', 'wdvs', 'etics'],
    insulation:       ['dämmung', 'insulation', 'mineralwolle', 'mineral wool', 'eps',
                       'xps', 'pur', 'pir', 'styropor', 'glaswolle', 'steinwolle'],
    rubber:           ['gummi', 'rubber', 'elastomer', 'neopren', 'neoprene', 'epdm',
                       'dichtung', 'seal', 'fugenband', 'lager', 'bearing pad'],
    paint_white:      ['farbe', 'paint', 'anstrich', 'coating', 'beschichtung',
                       'markierung', 'marking', 'fahrbahnmarkierung', 'road marking'],
    copper:           ['kupfer', 'copper', 'bronze', 'messing', 'brass']
  };

  // === IFC ENTITY TYPE → PBR FALLBACK ===
  // Used when no Material property is found in 3D Tiles features (common with poor IFC exports).
  // className / IFC entity type detected via the same ifcPropertyName used by IFC Filter.
  const ENTITY_PBR_MAP = {
    'IfcWall':                  'concrete',
    'IfcWallStandardCase':      'concrete',
    'IfcSlab':                  'concrete',
    'IfcBeam':                  'concrete',
    'IfcColumn':                'concrete',
    'IfcFooting':               'concrete',
    'IfcPile':                  'concrete',
    'IfcRamp':                  'concrete',
    'IfcRoof':                  'concrete',
    'IfcStair':                 'stone',
    'IfcStairFlight':           'stone',
    'IfcPlate':                 'steel_structural',
    'IfcMember':                'steel_structural',
    'IfcReinforcingBar':        'steel_structural',
    'IfcReinforcingMesh':       'steel_structural',
    'IfcTendon':                'steel_structural',
    'IfcWindow':                'glass',
    'IfcCurtainWall':           'glass',
    'IfcDoor':                  'wood',
    'IfcFurnishingElement':     'wood',
    'IfcCovering':              'plaster',
    'IfcRailing':               'galvanized',
    'IfcFlowSegment':           'steel_polished',
    'IfcFlowTerminal':          'steel_polished',
    'IfcFlowFitting':           'galvanized',
    'IfcDistributionElement':   'galvanized',
    'IfcBuildingElementProxy':  'concrete',
    'IfcDiscreteAccessory':     'rubber',
    'IfcSite':                  'earth',
    'IfcOpeningElement':        'default_pbr',
    'IfcSpace':                 'default_pbr',
    'IfcProxy':                 'default_pbr'
  };

  // === PRESET DEFINITIONS ===
  const PRESETS = {
    realistic: { intensity: 0.7, noiseScale: 0.1, label: 'Realistic' },
    schematic: { intensity: 0.3, noiseScale: 0.02, label: 'Schematic' }
  };

  // === STATE ===
  BimViewer.pbr = {
    enabled: false,
    intensity: 0.7,
    noiseScale: 0.1,
    preset: 'realistic',
    shader: null
  };

  // === INITIALIZATION ===
  BimViewer.initPBRMaterials = function() {
    const saved = loadState();
    if (saved) {
      this.pbr.enabled = saved.enabled || false;
      this.pbr.intensity = saved.intensity !== undefined ? saved.intensity : 0.7;
      this.pbr.noiseScale = saved.noiseScale !== undefined ? saved.noiseScale : 0.1;
      this.pbr.preset = saved.preset || 'realistic';
    }
    // Shader creation deferred to first use (avoids startup overhead + errors before viewer ready)
    this.pbr.shader = null;
    console.log('✅ PBR Materials module initialized (enabled: ' + this.pbr.enabled + ')');
  };

  // === CUSTOM SHADER CREATION ===
  // The fragment shader reads material.diffuse (set by Cesium3DTileStyle with PBR palette colors),
  // detects the PBR material type by nearest-color match, then applies procedural noise + PBR params.
  function createPBRShader(intensity, noiseScale) {
    return new Cesium.CustomShader({
      uniforms: {
        u_intensity: { type: Cesium.UniformType.FLOAT, value: intensity },
        u_noiseScale: { type: Cesium.UniformType.FLOAT, value: noiseScale }
      },
      varyings: {
        v_pbrWorldPos: Cesium.VaryingType.VEC3
      },
      vertexShaderText: /* glsl */ `
        void vertexMain(VertexInput vsInput, inout czm_modelVertexOutput vsOutput) {
          v_pbrWorldPos = (czm_model * vec4(vsInput.attributes.positionMC, 1.0)).xyz;
        }
      `,
      fragmentShaderText: /* glsl */ `
        // --- Procedural noise (pure math, no textures) ---
        float pbrHash(vec3 p) {
          p = fract(p * vec3(443.897, 441.423, 437.195));
          p += dot(p, p.yzx + 19.19);
          return fract((p.x + p.y) * p.z);
        }

        float pbrNoise3D(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);

          float n000 = pbrHash(i);
          float n100 = pbrHash(i + vec3(1,0,0));
          float n010 = pbrHash(i + vec3(0,1,0));
          float n110 = pbrHash(i + vec3(1,1,0));
          float n001 = pbrHash(i + vec3(0,0,1));
          float n101 = pbrHash(i + vec3(1,0,1));
          float n011 = pbrHash(i + vec3(0,1,1));
          float n111 = pbrHash(i + vec3(1,1,1));

          float nx00 = mix(n000, n100, f.x);
          float nx10 = mix(n010, n110, f.x);
          float nx01 = mix(n001, n101, f.x);
          float nx11 = mix(n011, n111, f.x);

          float nxy0 = mix(nx00, nx10, f.y);
          float nxy1 = mix(nx01, nx11, f.y);

          return mix(nxy0, nxy1, f.z);
        }

        float pbrTriplanar(vec3 worldPos, vec3 normal, float scale) {
          vec3 blend = abs(normal);
          blend = blend / (blend.x + blend.y + blend.z + 0.001);

          // Inline FBM (4 octaves) for each triplanar axis
          vec2 cYZ = worldPos.yz * scale;
          float nx = 0.5 * pbrNoise3D(vec3(cYZ, 0.0))
                   + 0.25 * pbrNoise3D(vec3(cYZ * 2.0, 0.0))
                   + 0.125 * pbrNoise3D(vec3(cYZ * 4.0, 0.0))
                   + 0.0625 * pbrNoise3D(vec3(cYZ * 8.0, 0.0));

          vec2 cXZ = worldPos.xz * scale;
          float ny = 0.5 * pbrNoise3D(vec3(cXZ, 1.0))
                   + 0.25 * pbrNoise3D(vec3(cXZ * 2.0, 1.0))
                   + 0.125 * pbrNoise3D(vec3(cXZ * 4.0, 1.0))
                   + 0.0625 * pbrNoise3D(vec3(cXZ * 8.0, 1.0));

          vec2 cXY = worldPos.xy * scale;
          float nz = 0.5 * pbrNoise3D(vec3(cXY, 2.0))
                   + 0.25 * pbrNoise3D(vec3(cXY * 2.0, 2.0))
                   + 0.125 * pbrNoise3D(vec3(cXY * 4.0, 2.0))
                   + 0.0625 * pbrNoise3D(vec3(cXY * 8.0, 2.0));

          return nx * blend.x + ny * blend.y + nz * blend.z;
        }

        // --- Material detection by color distance to PBR palette ---
        // IDs: 0=concrete, 1=steel_structural, 2=steel_polished, 3=galvanized,
        //      4=wood, 5=glass, 6=masonry, 7=asphalt, 8=stone, 9=earth,
        //      10=plaster, 11=insulation, 12=rubber, 13=copper, 14=paint_white, 15=default
        // Must match PBR_PALETTE in JS exactly!

        const vec3 PAL_CONCRETE    = vec3(0.478, 0.463, 0.439);
        const vec3 PAL_STEEL_STR   = vec3(0.290, 0.220, 0.157);
        const vec3 PAL_STEEL_POL   = vec3(0.557, 0.557, 0.576);
        const vec3 PAL_GALVANIZED  = vec3(0.702, 0.710, 0.718);
        const vec3 PAL_WOOD        = vec3(0.549, 0.353, 0.180);
        const vec3 PAL_GLASS       = vec3(0.851, 0.922, 0.949);
        const vec3 PAL_MASONRY     = vec3(0.651, 0.451, 0.345);
        const vec3 PAL_ASPHALT     = vec3(0.102, 0.102, 0.102);
        const vec3 PAL_STONE       = vec3(0.451, 0.420, 0.400);
        const vec3 PAL_EARTH       = vec3(0.302, 0.220, 0.129);
        const vec3 PAL_PLASTER     = vec3(0.910, 0.894, 0.875);
        const vec3 PAL_INSULATION  = vec3(0.910, 0.831, 0.302);
        const vec3 PAL_RUBBER      = vec3(0.059, 0.059, 0.059);
        const vec3 PAL_COPPER      = vec3(0.722, 0.451, 0.200);
        const vec3 PAL_PAINT_WHITE = vec3(0.925, 0.925, 0.918);
        const vec3 PAL_DEFAULT     = vec3(0.541, 0.522, 0.502);

        int detectMaterial(vec3 col) {
          float minDist = 1.0e10;
          int matId = 15;
          float d;

          d = distance(col, PAL_CONCRETE);    if (d < minDist) { minDist = d; matId = 0; }
          d = distance(col, PAL_STEEL_STR);   if (d < minDist) { minDist = d; matId = 1; }
          d = distance(col, PAL_STEEL_POL);   if (d < minDist) { minDist = d; matId = 2; }
          d = distance(col, PAL_GALVANIZED);  if (d < minDist) { minDist = d; matId = 3; }
          d = distance(col, PAL_WOOD);        if (d < minDist) { minDist = d; matId = 4; }
          d = distance(col, PAL_GLASS);       if (d < minDist) { minDist = d; matId = 5; }
          d = distance(col, PAL_MASONRY);     if (d < minDist) { minDist = d; matId = 6; }
          d = distance(col, PAL_ASPHALT);     if (d < minDist) { minDist = d; matId = 7; }
          d = distance(col, PAL_STONE);       if (d < minDist) { minDist = d; matId = 8; }
          d = distance(col, PAL_EARTH);       if (d < minDist) { minDist = d; matId = 9; }
          d = distance(col, PAL_PLASTER);     if (d < minDist) { minDist = d; matId = 10; }
          d = distance(col, PAL_INSULATION);  if (d < minDist) { minDist = d; matId = 11; }
          d = distance(col, PAL_RUBBER);      if (d < minDist) { minDist = d; matId = 12; }
          d = distance(col, PAL_COPPER);      if (d < minDist) { minDist = d; matId = 13; }
          d = distance(col, PAL_PAINT_WHITE); if (d < minDist) { minDist = d; matId = 14; }
          d = distance(col, PAL_DEFAULT);     if (d < minDist) { minDist = d; matId = 15; }

          // Only classify if reasonably close to a palette color
          if (minDist > 0.15) matId = 15;
          return matId;
        }

        void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
          float intensity = u_intensity;
          float noiseScale = u_noiseScale;
          if (intensity < 0.01) return;

          vec3 worldPos = v_pbrWorldPos;
          vec3 normal = material.normalEC;
          vec3 baseColor = material.diffuse;

          int matId = detectMaterial(baseColor);

          float metallic = 0.0;
          float roughness = 0.6;
          float noiseVal = 0.0;
          vec3 tint = baseColor;

          // --- Per-material PBR parameters + procedural variation ---
          if (matId == 0) {
            // Concrete: rough, two-scale noise for pores + surface variation
            metallic = 0.0; roughness = 0.85;
            noiseVal = pbrTriplanar(worldPos, normal, noiseScale * 8.0);
            float coarse = pbrTriplanar(worldPos, normal, noiseScale * 2.0);
            tint = baseColor + (noiseVal - 0.5) * 0.12 * intensity + (coarse - 0.5) * 0.06 * intensity;
          }
          else if (matId == 1) {
            // Steel structural: metallic, subtle mill scale variation
            metallic = 0.8; roughness = 0.45;
            noiseVal = pbrTriplanar(worldPos, normal, noiseScale * 20.0);
            tint = baseColor + (noiseVal - 0.5) * 0.05 * intensity;
          }
          else if (matId == 2) {
            // Steel polished / stainless / aluminum: high metallic, very smooth
            metallic = 0.9; roughness = 0.25;
            noiseVal = pbrTriplanar(worldPos, normal, noiseScale * 40.0);
            tint = baseColor + (noiseVal - 0.5) * 0.03 * intensity;
          }
          else if (matId == 3) {
            // Galvanized: metallic with spangle pattern
            metallic = 0.7; roughness = 0.35;
            noiseVal = pbrTriplanar(worldPos, normal, noiseScale * 30.0);
            float spangle = pbrHash(floor(worldPos * noiseScale * 10.0));
            tint = baseColor + (noiseVal - 0.5) * 0.04 * intensity;
            roughness += (spangle - 0.5) * 0.1;
          }
          else if (matId == 4) {
            // Wood: directional grain + surface noise
            metallic = 0.0; roughness = 0.75;
            float grain = pbrNoise3D(vec3(worldPos.x * noiseScale * 2.0, worldPos.y * noiseScale * 15.0, worldPos.z * noiseScale * 2.0));
            noiseVal = pbrTriplanar(worldPos, normal, noiseScale * 5.0);
            tint = baseColor + (grain - 0.5) * 0.15 * intensity + (noiseVal - 0.5) * 0.08 * intensity;
          }
          else if (matId == 5) {
            // Glass: very smooth, minimal variation
            metallic = 0.1; roughness = 0.05;
            tint = baseColor;
          }
          else if (matId == 6) {
            // Masonry: rough, coarse + fine noise for brick texture
            metallic = 0.0; roughness = 0.90;
            noiseVal = pbrTriplanar(worldPos, normal, noiseScale * 6.0);
            float coarse = pbrTriplanar(worldPos, normal, noiseScale * 1.5);
            tint = baseColor + (noiseVal - 0.5) * 0.14 * intensity + (coarse - 0.5) * 0.08 * intensity;
          }
          else if (matId == 7) {
            // Asphalt: very rough, fine aggregate noise
            metallic = 0.0; roughness = 0.95;
            noiseVal = pbrTriplanar(worldPos, normal, noiseScale * 10.0);
            tint = baseColor + (noiseVal - 0.5) * 0.06 * intensity;
          }
          else if (matId == 8) {
            // Stone: moderate roughness, veining
            metallic = 0.0; roughness = 0.80;
            noiseVal = pbrTriplanar(worldPos, normal, noiseScale * 5.0);
            float veins = pbrNoise3D(worldPos * noiseScale * 3.0 + vec3(0.0, noiseVal * 2.0, 0.0));
            tint = baseColor + (noiseVal - 0.5) * 0.10 * intensity + (veins - 0.5) * 0.06 * intensity;
          }
          else if (matId == 9) {
            // Earth: very rough, organic variation
            metallic = 0.0; roughness = 0.95;
            noiseVal = pbrTriplanar(worldPos, normal, noiseScale * 4.0);
            tint = baseColor + (noiseVal - 0.5) * 0.12 * intensity;
          }
          else if (matId == 10) {
            // Plaster: smooth-ish, very subtle texture
            metallic = 0.0; roughness = 0.70;
            noiseVal = pbrTriplanar(worldPos, normal, noiseScale * 12.0);
            tint = baseColor + (noiseVal - 0.5) * 0.04 * intensity;
          }
          else if (matId == 11) {
            // Insulation: fibrous texture
            metallic = 0.0; roughness = 0.80;
            noiseVal = pbrTriplanar(worldPos, normal, noiseScale * 6.0);
            tint = baseColor + (noiseVal - 0.5) * 0.08 * intensity;
          }
          else if (matId == 12) {
            // Rubber: dark, very rough, minimal variation
            metallic = 0.0; roughness = 0.92;
            noiseVal = pbrTriplanar(worldPos, normal, noiseScale * 15.0);
            tint = baseColor + (noiseVal - 0.5) * 0.03 * intensity;
          }
          else if (matId == 13) {
            // Copper: high metallic, subtle patina in crevices
            metallic = 0.9; roughness = 0.30;
            noiseVal = pbrTriplanar(worldPos, normal, noiseScale * 25.0);
            float patina = pbrTriplanar(worldPos, normal, noiseScale * 3.0);
            tint = baseColor + (noiseVal - 0.5) * 0.04 * intensity;
            tint = mix(tint, vec3(0.4, 0.6, 0.5), patina * 0.1 * intensity);
          }
          else if (matId == 14) {
            // Paint / coating: smooth, uniform with very subtle variation
            metallic = 0.0; roughness = 0.40;
            noiseVal = pbrTriplanar(worldPos, normal, noiseScale * 20.0);
            tint = baseColor + (noiseVal - 0.5) * 0.02 * intensity;
          }
          else {
            // Default: moderate roughness, gentle noise
            metallic = 0.0; roughness = 0.60;
            noiseVal = pbrTriplanar(worldPos, normal, noiseScale * 6.0);
            tint = baseColor + (noiseVal - 0.5) * 0.06 * intensity;
          }

          // Apply PBR: diffuse + roughness + specular (simulate metallic via specular)
          // Metallic workflow: metals have colored specular (F0 = base color) and black diffuse.
          // Dielectrics have gray specular (F0 ~ 0.04) and colored diffuse.
          material.diffuse = clamp(tint, 0.0, 1.0) * (1.0 - metallic);
          material.specular = mix(vec3(0.04), clamp(tint, 0.0, 1.0), metallic);
          material.roughness = roughness;
        }
      `,
      mode: Cesium.CustomShaderMode.MODIFY_MATERIAL,
      lightingModel: Cesium.LightingModel.PBR
    });
  }

  // === MATERIAL PROPERTY DETECTION ===
  // Scans loaded 3D Tiles features for Material/MaterialName properties.
  // These are IFC properties preserved by Cesium Ion Design Tiler during IFC→3DTiles conversion.
  // Accessed via feature.getProperty() — same API as features.js uses for IFC Filter.
  BimViewer.detectMaterialProperty = function(tileset) {
    const propertyNames = ['Material', 'MaterialName', 'material', 'materialName', 'mat:Material', 'mat:Name'];
    try {
      const root = tileset.root;
      if (!root || !root.content) return null;

      const featuresLength = root.content.featuresLength || 0;
      for (let i = 0; i < Math.min(featuresLength, 20); i++) {
        for (const propName of propertyNames) {
          try {
            const val = root.content.getFeature(i).getProperty(propName);
            if (val && typeof val === 'string' && val.trim().length > 0) {
              console.log('🎨 PBR: Found material property "' + propName + '" = "' + val + '"');
              return propName;
            }
          } catch (e) { /* skip */ }
        }
      }
    } catch (e) {
      console.warn('🎨 PBR: Material property detection failed:', e);
    }
    return null;
  };

  // === CLASSIFY MATERIAL NAME → PBR TYPE ===
  // Case-insensitive keyword match against comprehensive DE/EN keyword lists.
  function classifyMaterial(materialName) {
    if (!materialName) return 'default_pbr';
    const lower = materialName.toLowerCase();
    for (const [pbrType, keywords] of Object.entries(MATERIAL_KEYWORDS)) {
      for (const kw of keywords) {
        if (lower.includes(kw)) return pbrType;
      }
    }
    return 'default_pbr';
  }

  // === BUILD PBR STYLE ===
  // Builds a Cesium3DTileStyle using PBR palette colors instead of IFC entity colors.
  // Detection priority:
  //   1. Material property keyword match (if feature has Material/MaterialName)
  //   2. className / IFC entity type fallback (via ifcPropertyName from IFC Filter)
  //   3. Default palette color (shader applies luminance/saturation heuristic)
  // Preserves show logic from IFC filter when both are active.
  BimViewer.buildPBRStyle = function(tileset, assetData) {
    const opacity = assetData.opacity !== undefined ? assetData.opacity : 1.0;
    const ifcPropertyName = assetData.ifcPropertyName;

    // Try to detect material property in tile features
    const matPropName = assetData.pbrMaterialProperty || this.detectMaterialProperty(tileset);
    if (matPropName) {
      assetData.pbrMaterialProperty = matPropName;
    }

    // Build show expression (preserve IFC filter visibility)
    let showExpr = 'true';
    const allEnabled = this.ifcFilter.enabledEntities.size === this.ifcFilter.allEntities.size;

    if (ifcPropertyName && !allEnabled) {
      const showConditions = [];
      this.ifcFilter.enabledEntities.forEach(entity => {
        showConditions.push('${' + ifcPropertyName + '} === \'' + entity + '\'');
      });
      if (showConditions.length > 0) {
        showExpr = showConditions.join(' || ');
      } else {
        return new Cesium.Cesium3DTileStyle({ show: false });
      }
    }

    // Build color conditions (priority: material keywords → entity type → default)
    const colorConditions = [];

    // Priority 1: Material-property keyword matching (one regex per material type)
    if (matPropName) {
      for (const [pbrType, keywords] of Object.entries(MATERIAL_KEYWORDS)) {
        const pal = PBR_PALETTE[pbrType];
        // Combine all keywords into single alternation regex: "beton|concrete|stahlbeton|..."
        const pattern = keywords.join('|');
        colorConditions.push([
          'regExp(\'' + pattern + '\', \'i\').test(${' + matPropName + '})',
          'color(\'' + pal.hex + '\', ' + opacity + ')'
        ]);
      }
    }

    // Priority 2: Entity-type fallback (className)
    if (ifcPropertyName) {
      for (const [entity, pbrType] of Object.entries(ENTITY_PBR_MAP)) {
        const pal = PBR_PALETTE[pbrType];
        if (pal) {
          colorConditions.push([
            '${' + ifcPropertyName + '} === \'' + entity + '\'',
            'color(\'' + pal.hex + '\', ' + opacity + ')'
          ]);
        }
      }
    }

    // Priority 3: Default fallback
    const defPal = PBR_PALETTE.default_pbr;
    colorConditions.push(['true', 'color(\'' + defPal.hex + '\', ' + opacity + ')']);

    return new Cesium.Cesium3DTileStyle({
      show: showExpr,
      color: { conditions: colorConditions }
    });
  };

  // === APPLY PBR TO SINGLE TILESET ===
  BimViewer.applyPBRMaterials = function(tileset, assetData) {
    if (!tileset) return;
    if (!assetData) {
      // Find assetData from loaded assets
      for (const [, ad] of this.loadedAssets) {
        if (ad.tileset === tileset) { assetData = ad; break; }
      }
    }
    if (!assetData) return;

    // Skip point clouds — preserve their RGB colors
    if (assetData.isPointCloud) return;

    // Apply PBR color style (sets material.diffuse to palette colors for shader detection)
    tileset.style = this.buildPBRStyle(tileset, assetData);

    // Apply custom shader (reads palette colors, applies procedural PBR)
    if (!this.pbr.shader) {
      this.pbr.shader = createPBRShader(this.pbr.intensity, this.pbr.noiseScale);
    }
    tileset.customShader = this.pbr.shader;

    console.log('🎨 PBR applied to asset');
  };

  // === REMOVE PBR FROM SINGLE TILESET ===
  BimViewer.removePBRMaterials = function(tileset) {
    if (!tileset) return;
    tileset.customShader = undefined;
    // Re-apply IFC filter to restore original entity colors
    if (typeof this.applyIFCFilter === 'function') {
      this.applyIFCFilter();
    }
  };

  // === APPLY/REMOVE PBR TO ALL LOADED TILESETS ===
  // Batched: all changes per tileset happen together to minimize shader recompilations.
  BimViewer.applyPBRToAll = function() {
    if (!this.loadedAssets) return;

    if (this.pbr.enabled) {
      // Enable: set PBR style + customShader in one pass per tileset
      for (const [, assetData] of this.loadedAssets) {
        if (!assetData.tileset || assetData.isPointCloud) continue;
        this.applyPBRMaterials(assetData.tileset, assetData);
      }
    } else {
      // Disable: restore IFC style + clear customShader in one pass per tileset.
      // Do NOT call applyIFCFilter() separately — that would cause a second
      // recompilation round. Instead, clear shader and restore style together.
      for (const [, assetData] of this.loadedAssets) {
        if (!assetData.tileset || assetData.isPointCloud) continue;
        assetData.tileset.customShader = undefined;
      }
      // Single IFC filter pass to restore original colors (after all shaders cleared)
      if (typeof this.applyIFCFilter === 'function') {
        // Defer to next frame so the shader clears settle first
        requestAnimationFrame(() => this.applyIFCFilter());
      }
    }
  };

  // === TOGGLE PBR ===
  BimViewer.togglePBR = function() {
    this.pbr.enabled = !this.pbr.enabled;
    this.savePBRState();

    // Update UI immediately (before heavy GPU work)
    const btn = document.getElementById('pbrToggleBtn');
    if (btn) {
      btn.textContent = this.pbr.enabled ? 'ON' : 'OFF';
      btn.className = 'modern-btn ' + (this.pbr.enabled ? 'modern-btn-primary' : 'modern-btn-secondary');
    }

    console.log('🎨 PBR Materials: ' + (this.pbr.enabled ? 'ON' : 'OFF'));
    this.updateStatus('PBR Materials: ' + (this.pbr.enabled ? 'ON' : 'OFF'), 'success');

    // Track with Plausible (once per session)
    if (typeof plausible !== 'undefined' && !this._pbrTracked) {
      plausible('Feature Used', { props: { feature: 'PBR Materials' } });
      this._pbrTracked = true;
    }

    // Defer heavy shader work to next frame so UI updates first
    requestAnimationFrame(() => this.applyPBRToAll());
  };

  // === SET PRESET ===
  BimViewer.setPBRPreset = function(presetName) {
    const preset = PRESETS[presetName];
    if (!preset) return;

    this.pbr.preset = presetName;
    this.pbr.intensity = preset.intensity;
    this.pbr.noiseScale = preset.noiseScale;

    // Update shader uniforms (live, no re-create needed)
    if (this.pbr.shader) {
      this.pbr.shader.setUniform('u_intensity', this.pbr.intensity);
      this.pbr.shader.setUniform('u_noiseScale', this.pbr.noiseScale);
    }

    // Sync sliders
    const intensitySlider = document.getElementById('pbrIntensitySlider');
    const noiseSlider = document.getElementById('pbrNoiseSlider');
    const intensityVal = document.getElementById('pbrIntensityValue');
    const noiseVal = document.getElementById('pbrNoiseValue');
    if (intensitySlider) intensitySlider.value = this.pbr.intensity;
    if (noiseSlider) noiseSlider.value = this.pbr.noiseScale;
    if (intensityVal) intensityVal.textContent = Math.round(this.pbr.intensity * 100) + '%';
    if (noiseVal) noiseVal.textContent = this.pbr.noiseScale.toFixed(2);

    // Highlight active preset button
    document.querySelectorAll('.pbr-preset-btn').forEach(b => {
      b.className = 'pbr-preset-btn modern-btn ' + (b.dataset.preset === presetName ? 'modern-btn-primary' : 'modern-btn-secondary');
    });

    this.savePBRState();
    console.log('🎨 PBR Preset: ' + preset.label);
  };

  // === SET INTENSITY ===
  BimViewer.setPBRIntensity = function(value) {
    this.pbr.intensity = parseFloat(value);
    if (this.pbr.shader) {
      this.pbr.shader.setUniform('u_intensity', this.pbr.intensity);
    }
    const el = document.getElementById('pbrIntensityValue');
    if (el) el.textContent = Math.round(this.pbr.intensity * 100) + '%';
    this.pbr.preset = 'custom';
    document.querySelectorAll('.pbr-preset-btn').forEach(b => {
      b.className = 'pbr-preset-btn modern-btn modern-btn-secondary';
    });
    this.savePBRState();
  };

  // === SET NOISE SCALE ===
  BimViewer.setPBRNoiseScale = function(value) {
    this.pbr.noiseScale = parseFloat(value);
    if (this.pbr.shader) {
      this.pbr.shader.setUniform('u_noiseScale', this.pbr.noiseScale);
    }
    const el = document.getElementById('pbrNoiseValue');
    if (el) el.textContent = this.pbr.noiseScale.toFixed(2);
    this.pbr.preset = 'custom';
    document.querySelectorAll('.pbr-preset-btn').forEach(b => {
      b.className = 'pbr-preset-btn modern-btn modern-btn-secondary';
    });
    this.savePBRState();
  };

  // === PERSISTENCE ===
  BimViewer.savePBRState = function() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        enabled: this.pbr.enabled,
        intensity: this.pbr.intensity,
        noiseScale: this.pbr.noiseScale,
        preset: this.pbr.preset
      }));
    } catch (e) { /* ignore */ }
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

})(BimViewer);
