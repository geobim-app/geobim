/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// ===============================
// SECTION PROFILE MODULE v2.0
// 2D drawing of the active section (alignment-section.js: axis, line or plan)
// on white paper, like a reinforcement drawing (geoBIM Desktop's profile panel):
// concrete light grey with a heavy outline, steel dark grey, cut bars black,
// bars within the view depth (stirrups) projected, bar marks with Ø in circles,
// dimension chains, title block, scale bar, north arrow (plans), terrain line.
// Wheel zooms, drag pans, double click fits, hover names the element; the
// drawing exports as SVG.
//
// Computed in the browser from the tileset's own GLB tiles — the GPU copy
// Cesium renders can't be read back. Tiles whose bounding box the plane or the
// view depth behind it crosses are fetched once (the browser cache usually has
// them already), decoded (EXT_meshopt_compression + KHR_mesh_quantization, as
// written by the geobim tiler) and kept, so moving the section re-slices in
// memory. Refine is ADD: every element sits in exactly one tile.
// ===============================
'use strict';

(function() {

  var MESHOPT_URL = 'https://cdn.jsdelivr.net/npm/meshoptimizer@1.3.0/meshopt_decoder.mjs';
  var PANEL_ID = 'sectionProfilePanel';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var DEPTHS = [0, 0.1, 0.25, 0.5, 1, 2, 5];
  // Projected reinforcement in the view depth is capped: a deep view into a
  // dense cage is unreadable anyway, and every triangle is SVG path text.
  var MAX_BEYOND_TRIANGLES = 200000;
  var TERRAIN_HALF_WIDTH_M = 100;
  var TERRAIN_STEP_M = 0.5;
  var LEVEL_LOAD_PARALLEL = 6;

  // Drawing (paper) colours, as in geoBIM Desktop.
  var PAPER = '#FCFCF9';
  var INK = '#141414';
  var CONCRETE_FILL = '#DEDEDA';
  var STEEL_FILL = '#808286';
  var OTHER_LINE = '#6E6E6E';
  var TERRAIN_LINE = '#282828';
  var FONT = 'Inter, Arial, sans-serif';

  var KIND = { CONCRETE: 'concrete', STEEL: 'steel', REBAR: 'rebar', OTHER: 'other' };

  BimViewer.sectionProfile = {
    open: false,
    assets: new Map(),   // assetId → { url, index: Promise<[{uri, box}]>, tiles: Map(uri → Promise<tile>) }
    view: null,          // { cx, cy, scale }: model point in the middle, px per metre
    fitKey: null,
    needsFit: true,
    depth: 0.25,
    marks: true,
    terrain: false,
    drawing: null,
    generation: 0
  };

  var decoderPromise = null;
  function meshopt() {
    if (!decoderPromise) {
      decoderPromise = import(MESHOPT_URL).then(function(m) {
        return m.MeshoptDecoder.ready.then(function() { return m.MeshoptDecoder; });
      });
      decoderPromise.catch(function() { decoderPromise = null; });
    }
    return decoderPromise;
  }

  // =====================================
  // GLB DECODING
  // =====================================

  var COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  var TYPED = {
    5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
    5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array
  };
  // KHR_mesh_quantization: normalised integers map to [0, 1] / [-1, 1].
  var NORMALIZE = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

  // Older tilers wrote Windows-1252: no valid UTF-8 means Latin-1.
  var utf8 = new TextDecoder('utf-8', { fatal: true });
  var latin1 = new TextDecoder('windows-1252');
  function decodeText(bytes) {
    try { return utf8.decode(bytes); } catch (e) { return latin1.decode(bytes); }
  }

  function parseGlb(buffer) {
    var dv = new DataView(buffer);
    if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('not a GLB');
    var json = null, bin = null, off = 12;
    while (off < buffer.byteLength) {
      var len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
      var chunk = new Uint8Array(buffer, off + 8, len);
      if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(chunk));
      else if (type === 0x004E4942) bin = chunk;
      off += 8 + len;
    }
    return { json: json, bin: bin };
  }

  // Bytes of a bufferView, decompressing EXT_meshopt_compression views.
  function viewBytes(gltf, bin, index, decoder, cache) {
    if (cache[index]) return cache[index];
    var view = gltf.bufferViews[index];
    var ext = view.extensions && view.extensions.EXT_meshopt_compression;
    var out;
    if (ext) {
      var src = bin.subarray(ext.byteOffset || 0, (ext.byteOffset || 0) + ext.byteLength);
      out = new Uint8Array(ext.count * ext.byteStride);
      decoder.decodeGltfBuffer(out, ext.count, ext.byteStride, src, ext.mode, ext.filter || 'NONE');
    } else {
      out = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    }
    cache[index] = out;
    return out;
  }

  // Accessor → array of numbers, normalised integers scaled to [0, 1] / [-1, 1].
  // Tightly packed data (indices, float positions) is viewed as-is; strided
  // attributes (the tiler pads VEC3 to 4 components) go through a copy.
  function readAccessor(gltf, bin, index, decoder, cache) {
    var acc = gltf.accessors[index];
    var raw = readRaw(gltf, bin, acc, decoder, cache);
    var norm = acc.normalized && NORMALIZE[acc.componentType];
    if (!norm) return raw;
    var out = new Float32Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = Math.max(raw[i] / norm, -1);
    return out;
  }

  function readRaw(gltf, bin, acc, decoder, cache) {
    var view = gltf.bufferViews[acc.bufferView];
    var bytes = viewBytes(gltf, bin, acc.bufferView, decoder, cache);
    var Typed = TYPED[acc.componentType];
    var comps = COMPONENTS[acc.type];
    var ext = view.extensions && view.extensions.EXT_meshopt_compression;
    var stride = (ext ? ext.byteStride : view.byteStride) || comps * Typed.BYTES_PER_ELEMENT;
    var start = acc.byteOffset || 0;
    var size = Typed.BYTES_PER_ELEMENT;
    if (stride === comps * size) {
      var len = acc.count * comps * size;
      var packed = bytes.subarray(start, start + len);
      if (packed.byteOffset % size !== 0) packed = packed.slice();
      return new Typed(packed.buffer, packed.byteOffset, acc.count * comps);
    }
    if (stride % size === 0) {
      var aligned = bytes.byteOffset % size === 0 ? bytes : bytes.slice();
      var src = new Typed(aligned.buffer, aligned.byteOffset, Math.floor(aligned.byteLength / size));
      var step = stride / size, first = start / size;
      var res = new Float64Array(acc.count * comps);
      for (var j = 0; j < acc.count; j++) {
        for (var cc = 0; cc < comps; cc++) res[j * comps + cc] = src[first + j * step + cc];
      }
      return res;
    }
    var copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    var dv = new DataView(copy.buffer);
    var out = new Float64Array(acc.count * comps);
    var get = {
      1: function(o) { return Typed === Int8Array ? dv.getInt8(o) : dv.getUint8(o); },
      2: function(o) { return Typed === Int16Array ? dv.getInt16(o, true) : dv.getUint16(o, true); },
      4: function(o) { return Typed === Float32Array ? dv.getFloat32(o, true) : dv.getUint32(o, true); }
    }[size];
    for (var i = 0; i < acc.count; i++) {
      for (var c = 0; c < comps; c++) out[i * comps + c] = get(start + i * stride + c * size);
    }
    return out;
  }

  var OFFSET_TYPES = { UINT8: Uint8Array, UINT16: Uint16Array, UINT32: Uint32Array };

  // A string column of the property table (EXT_structural_metadata), or null.
  function readStrings(gltf, bin, prop, count, decoder, cache) {
    if (!prop || prop.stringOffsets === undefined) return null;
    var values = viewBytes(gltf, bin, prop.values, decoder, cache);
    var offsBytes = viewBytes(gltf, bin, prop.stringOffsets, decoder, cache);
    var Offsets = OFFSET_TYPES[prop.stringOffsetType || 'UINT32'];
    if (!Offsets) return null;
    var copy = new Uint8Array(offsBytes.byteLength);
    copy.set(offsBytes);
    var offs = new Offsets(copy.buffer, 0, count + 1);
    var out = [];
    for (var i = 0; i < count; i++) out.push(decodeText(values.subarray(offs[i], offs[i + 1])));
    return out;
  }

  // Digits after "Ø" / "ø" / "⌀" in an element name ("Pos 186 Ø20 Fundament oben").
  function parseDiameter(name) {
    var m = /[Øø⌀]\s*(\d+)/.exec(name || '');
    return m ? m[1] : '';
  }

  // Bar mark from "Pos 186 ..." when the property is missing.
  function parsePosition(name) {
    var m = /pos[\s.]*([A-Za-z0-9]+)/i.exec(name || '');
    return m ? m[1] : '';
  }

  // One tile → primitives in the tileset's local frame (Z-up metres) and its
  // features: { prims: [{ pos: Float32Array xyz, idx, fid, color, min, max }], features }
  function decodeTile(buffer, decoder, uri) {
    var glb = parseGlb(buffer);
    var gltf = glb.json, bin = glb.bin, cache = {};
    var prims = [];
    (gltf.nodes || []).forEach(function(node) {
      if (node.mesh === undefined) return;
      var t = node.translation || [0, 0, 0];
      var sc = node.scale || [1, 1, 1];
      (gltf.meshes[node.mesh].primitives || []).forEach(function(prim) {
        if ((prim.mode !== undefined && prim.mode !== 4) || prim.attributes.POSITION === undefined) return;
        var q = readAccessor(gltf, bin, prim.attributes.POSITION, decoder, cache);
        var n = q.length / 3;
        var pos = new Float32Array(n * 3);
        var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (var i = 0; i < n; i++) {
          // glTF Y-up → tileset local Z-up: (x, y, z)_gltf = (x, z, -y)_local
          var gx = t[0] + sc[0] * q[i * 3];
          var gy = t[1] + sc[1] * q[i * 3 + 1];
          var gz = t[2] + sc[2] * q[i * 3 + 2];
          var l = [gx, -gz, gy];
          for (var k = 0; k < 3; k++) {
            pos[i * 3 + k] = l[k];
            if (l[k] < min[k]) min[k] = l[k];
            if (l[k] > max[k]) max[k] = l[k];
          }
        }
        var idx = prim.indices !== undefined ? readAccessor(gltf, bin, prim.indices, decoder, cache) : null;
        var fid = prim.attributes._FEATURE_ID_0 !== undefined
          ? readAccessor(gltf, bin, prim.attributes._FEATURE_ID_0, decoder, cache) : null;
        var mat = gltf.materials && gltf.materials[prim.material];
        var cf = (mat && mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorFactor) || [0.8, 0.8, 0.8, 1];
        prims.push({ pos: pos, idx: idx, fid: fid, color: cf, min: min, max: max });
      });
    });

    // Element properties (geobim tiler: one property table, feature ID = row).
    var features = [];
    var meta = gltf.extensions && gltf.extensions.EXT_structural_metadata;
    var table = meta && meta.propertyTables && meta.propertyTables[0];
    if (table) {
      var col = function(name) { return readStrings(gltf, bin, table.properties[name], table.count, decoder, cache) || []; };
      var names = col('name'), classes = col('className'), ids = col('globalId');
      var positions = col('bewehrungVerlegungPosition'), tags = col('tag'), storeys = col('storey');
      for (var f = 0; f < table.count; f++) {
        var cls = classes[f] || '';
        var position = positions[f] || '';
        if (!position && cls.indexOf('IfcReinforcing') === 0) position = tags[f] || parsePosition(names[f]);
        features.push({
          key: ids[f] || (uri + '#' + f),
          name: names[f] || '',
          className: cls,
          position: position,
          diameter: parseDiameter(names[f]),
          storey: storeys[f] || ''
        });
      }
    }
    return { uri: uri, prims: prims, features: features };
  }

  // =====================================
  // TILES
  // =====================================

  function assetCache(assetId, tilesetUrl) {
    var cache = BimViewer.sectionProfile.assets;
    var entry = cache.get(assetId);
    if (!entry) {
      var url = new URL(tilesetUrl, window.location.href).href;
      entry = { url: url, tiles: new Map() };
      entry.index = fetch(url).then(function(r) {
        if (!r.ok) throw new Error('tileset.json ' + r.status);
        return r.json();
      }).then(tileIndex);
      entry.index.catch(function() { cache.delete(assetId); });
      cache.set(assetId, entry);
    }
    return entry;
  }

  // Content URIs with their boxes. Child tiles of geobim tilesets carry no
  // transforms: every box is in the local frame.
  function tileIndex(json) {
    var out = [];
    (function walk(tile) {
      var c = tile.content && (tile.content.uri || tile.content.url);
      if (c && /\.glb(\?|$)/i.test(c)) {
        var b = tile.boundingVolume && tile.boundingVolume.box;
        out.push({ uri: c, box: b && b.length === 12 ? b : null });
      }
      (tile.children || []).forEach(walk);
    })(json.root);
    return out;
  }

  // Tiles the plane (and the view depth behind it) passes through.
  function tilesInView(index, frame, depth) {
    var p = frame.P, n = frame.N;
    return index.filter(function(t) {
      var b = t.box;
      if (!b) return true;
      var d = n.x * (b[0] - p.x) + n.y * (b[1] - p.y) + n.z * (b[2] - p.z);
      var r = 0;
      for (var k = 0; k < 3; k++) r += Math.abs(n.x * b[3 + k * 3] + n.y * b[4 + k * 3] + n.z * b[5 + k * 3]);
      return !(d + r < 0 || d - r > depth);
    }).map(function(t) { return t.uri; });
  }

  function fetchTile(entry, uri) {
    var url = new URL(uri, entry.url).href;
    return Promise.all([fetch(url).then(function(r) {
      if (!r.ok) throw new Error(uri + ' ' + r.status);
      return r.arrayBuffer();
    }), meshopt()]).then(function(res) { return decodeTile(res[0], res[1], uri); });
  }

  function loadTile(entry, uri) {
    if (!entry.tiles.has(uri)) {
      var p = fetchTile(entry, uri);
      p.catch(function() { entry.tiles.delete(uri); });
      entry.tiles.set(uri, p);
    }
    return entry.tiles.get(uri);
  }

  // =====================================
  // STOREYS (fallback when the tiler wrote no levels.json)
  // =====================================

  // Where a storey's walls and columns start (their floor); storeys without
  // any: their lowest point. Reads every tile once, keeps none it didn't have.
  // Some tilers write the room (IfcSpace) as the storey of furniture and
  // fittings: only containers with building elements count as storeys.
  var STANDING = /^(IfcWall|IfcWallStandardCase|IfcColumn|IfcDoor|IfcCurtainWall)$/i;
  var BUILDING_ELEMENT = /^(IfcWall|IfcWallStandardCase|IfcColumn|IfcSlab|IfcDoor|IfcWindow|IfcCurtainWall|IfcBeam|IfcStair|IfcStairFlight|IfcRamp|IfcRampFlight|IfcRailing|IfcRoof|IfcCovering|IfcPlate|IfcMember|IfcFooting)$/i;

  BimViewer.computeSectionLevels = async function(assetId, tilesetUrl) {
    var entry = assetCache(assetId, tilesetUrl);
    var uris = (await entry.index).map(function(t) { return t.uri; });
    var fromStanding = new Map(), fromAny = new Map(), withElements = new Set();
    var done = 0, next = 0;
    function lower(map, key, z) {
      var v = map.get(key);
      if (v === undefined || z < v) map.set(key, z);
    }
    function take(tile) {
      var standing = tile.features.map(function(f) { return STANDING.test(f.className); });
      tile.features.forEach(function(f) {
        if (f.storey && BUILDING_ELEMENT.test(f.className)) withElements.add(f.storey);
      });
      tile.prims.forEach(function(prim) {
        if (!prim.fid) return;
        for (var v = 0; v < prim.fid.length; v++) {
          var f = tile.features[prim.fid[v]];
          if (!f || !f.storey) continue;
          var z = prim.pos[v * 3 + 2];
          lower(fromAny, f.storey, z);
          if (standing[prim.fid[v]]) lower(fromStanding, f.storey, z);
        }
      });
    }
    async function worker() {
      while (next < uris.length) {
        var uri = uris[next++];
        try {
          take(await (entry.tiles.has(uri) ? entry.tiles.get(uri) : fetchTile(entry, uri)));
        } catch (err) {
          console.warn('Storeys: tile skipped', uri, err);
        }
        done++;
        if (done % 4 === 0 || done === uris.length) {
          BimViewer.updateStatus('Reading the storeys: tiles ' + done + ' / ' + uris.length + '…', 'loading');
        }
      }
    }
    var workers = [];
    for (var w = 0; w < LEVEL_LOAD_PARALLEL; w++) workers.push(worker());
    await Promise.all(workers);
    var levels = [];
    fromAny.forEach(function(z, name) {
      if (withElements.size && !withElements.has(name)) return;
      levels.push({ name: name, z: fromStanding.has(name) ? fromStanding.get(name) : z });
    });
    levels.sort(function(a, b) { return a.z - b.z; });
    BimViewer.updateStatus(levels.length ? levels.length + ' storeys found' : 'No storeys in this model', levels.length ? 'success' : 'info');
    return levels;
  };

  // =====================================
  // SLICING
  // =====================================

  // Drawing frame: right = view × Z, up = right × view. Looking straight down
  // (plan): right = X (east), up = Y (north).
  function getFrame(section) {
    var N = Cesium.Cartesian3.normalize(section.direction, new Cesium.Cartesian3());
    var R = new Cesium.Cartesian3(N.y, -N.x, 0);
    if (Cesium.Cartesian3.magnitude(R) < 1e-6) R = new Cesium.Cartesian3(1, 0, 0);
    Cesium.Cartesian3.normalize(R, R);
    var U = Cesium.Cartesian3.cross(R, N, new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(U, U);
    return { P: section.point, N: N, R: R, U: U };
  }

  var STRUCTURAL = /^(IfcBeam|IfcSlab|IfcWall|IfcWallStandardCase|IfcColumn|IfcFooting|IfcPile|IfcMember|IfcPlate|IfcBridgePart|IfcDeepFoundation|IfcElementAssembly|IfcRoof|IfcStair|IfcStairFlight|IfcRamp|IfcRampFlight|IfcChimney)$/i;

  // Reinforcement by class; structural parts by class and colour: steel is a
  // dark or bluish grey, everything else (concrete greys, coloured masonry of
  // buildings) is drawn as a solid cut face. Other elements: outline only.
  function classify(className, c) {
    if (className.indexOf('IfcReinforcing') === 0 || className === 'IfcTendon') return KIND.REBAR;
    if (!STRUCTURAL.test(className)) return KIND.OTHER;
    var max = Math.max(c[0], c[1], c[2]), min = Math.min(c[0], c[1], c[2]);
    var lum = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    return max - min < 0.12 && (lum < 0.5 || c[0] < c[2]) ? KIND.STEEL : KIND.CONCRETE;
  }

  function emptyBounds() {
    return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  }

  function grow(b, x, y) {
    if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
  }

  function merge(b, o) {
    grow(b, o.minX, o.minY);
    grow(b, o.maxX, o.maxY);
  }

  function valid(b) { return b.minX <= b.maxX; }

  // Cut edges per element (key: globalId) and the reinforcement within the
  // view depth as projected triangles ("beyond").
  function slice(tiles, frame, depth) {
    var P = frame.P, N = frame.N, R = frame.R, U = frame.U;
    var elements = [], byKey = new Map();
    var beyondCount = 0, truncated = false;

    function elementFor(tile, prim, fid) {
      var f = tile.features[fid];
      var key = f ? f.key : tile.uri + '#' + fid;
      var e = byKey.get(key);
      if (e) return e;
      e = {
        name: f ? f.name : '',
        className: f ? f.className : '',
        position: f ? f.position : '',
        diameter: f ? f.diameter : '',
        kind: classify(f ? f.className : '', prim.color),
        edges: [],     // x0 y0 x1 y1 …
        beyond: [],    // triangles x0 y0 x1 y1 x2 y2 …
        fill: null,
        bounds: emptyBounds()
      };
      byKey.set(key, e);
      elements.push(e);
      return e;
    }

    tiles.forEach(function(tile) {
      tile.prims.forEach(function(prim) {
        // Signed distances of the box corners: skip primitives outside [0, depth].
        var bmin = Infinity, bmax = -Infinity;
        for (var c = 0; c < 8; c++) {
          var d = N.x * ((c & 1 ? prim.max[0] : prim.min[0]) - P.x) +
                  N.y * ((c & 2 ? prim.max[1] : prim.min[1]) - P.y) +
                  N.z * ((c & 4 ? prim.max[2] : prim.min[2]) - P.z);
          if (d < bmin) bmin = d;
          if (d > bmax) bmax = d;
        }
        if (bmax < 0 || bmin > Math.max(depth, 0)) return;

        var pos = prim.pos, n = pos.length / 3;
        var s = new Float64Array(n);
        for (var i = 0; i < n; i++) {
          s[i] = N.x * (pos[i * 3] - P.x) + N.y * (pos[i * 3 + 1] - P.y) + N.z * (pos[i * 3 + 2] - P.z);
        }
        function px(i) {
          return R.x * (pos[i * 3] - P.x) + R.y * (pos[i * 3 + 1] - P.y) + R.z * (pos[i * 3 + 2] - P.z);
        }
        function py(i) {
          return U.x * (pos[i * 3] - P.x) + U.y * (pos[i * 3 + 1] - P.y) + U.z * (pos[i * 3 + 2] - P.z);
        }
        var idx = prim.idx;
        var triCount = idx ? idx.length / 3 : n / 3;
        var ids = [0, 0, 0], ss = [0, 0, 0];
        for (var tr = 0; tr < triCount; tr++) {
          ids[0] = idx ? idx[tr * 3] : tr * 3;
          ids[1] = idx ? idx[tr * 3 + 1] : tr * 3 + 1;
          ids[2] = idx ? idx[tr * 3 + 2] : tr * 3 + 2;
          ss[0] = s[ids[0]]; ss[1] = s[ids[1]]; ss[2] = s[ids[2]];
          var crosses = !((ss[0] > 0 && ss[1] > 0 && ss[2] > 0) || (ss[0] < 0 && ss[1] < 0 && ss[2] < 0));
          var centre = (ss[0] + ss[1] + ss[2]) / 3;
          var inDepth = depth > 0 && centre > 0 && centre <= depth;
          if (!crosses && !inDepth) continue;
          var e = elementFor(tile, prim, prim.fid ? prim.fid[ids[0]] : 0);
          if (inDepth && e.kind === KIND.REBAR) {
            if (beyondCount < MAX_BEYOND_TRIANGLES) {
              beyondCount++;
              for (var v = 0; v < 3; v++) e.beyond.push(px(ids[v]), py(ids[v]));
            } else {
              truncated = true;
            }
          }
          if (!crosses) continue;
          var k = 0;
          for (var ed = 0; ed < 3 && k < 4; ed++) {
            var i0 = ids[ed], i1 = ids[(ed + 1) % 3], s0 = ss[ed], s1 = ss[(ed + 1) % 3];
            if ((s0 > 0) === (s1 > 0) || s0 === s1) continue;
            var f = s0 / (s0 - s1);
            e.edges.push(px(i0) + (px(i1) - px(i0)) * f, py(i0) + (py(i1) - py(i0)) * f);
            k += 2;
          }
          if (k === 2) e.edges.length -= 2;   // touched in one vertex only
        }
      });
    });

    var bounds = emptyBounds(), structure = emptyBounds();
    elements.forEach(function(e) {
      if (e.kind !== KIND.OTHER) e.fill = fillEvenOdd(e.edges);
      var i;
      for (i = 0; i < e.edges.length; i += 2) grow(e.bounds, e.edges[i], e.edges[i + 1]);
      for (i = 0; i < e.beyond.length; i += 2) grow(e.bounds, e.beyond[i], e.beyond[i + 1]);
      if (!valid(e.bounds)) return;
      merge(bounds, e.bounds);
      if (e.kind === KIND.CONCRETE && e.edges.length) merge(structure, e.bounds);
    });
    elements = elements.filter(function(e) { return valid(e.bounds); });
    return {
      elements: elements,
      bounds: bounds,
      structure: valid(structure) ? structure : bounds,
      truncated: truncated
    };
  }

  // Even-odd fill of closed outlines (edge pairs) as trapezoids between the
  // vertex heights; holes (hollow box) fall out by themselves.
  // Out: quads x0 y0 x1 y1 x2 y2 x3 y3 (bottom left, bottom right, top right, top left).
  function fillEvenOdd(edges) {
    var list = [], ys = [], out = [];
    for (var i = 0; i + 3 < edges.length; i += 4) {
      var ax = edges[i], ay = edges[i + 1], bx = edges[i + 2], by = edges[i + 3];
      if (Math.abs(ay - by) < 1e-6) continue;
      if (ay > by) { var tx = ax, ty = ay; ax = bx; ay = by; bx = tx; by = ty; }
      list.push({ y0: ay, y1: by, x0: ax, slope: (bx - ax) / (by - ay) });
      ys.push(ay, by);
    }
    if (list.length < 2) return out;
    ys.sort(function(a, b) { return a - b; });
    list.sort(function(a, b) { return a.y0 - b.y0; });
    var active = [], next = 0, xs = [];
    for (var j = 0; j + 1 < ys.length; j++) {
      var ya = ys[j], yb = ys[j + 1];
      if (yb - ya < 1e-6) continue;
      var ym = 0.5 * (ya + yb);
      while (next < list.length && list[next].y0 <= ym) active.push(list[next++]);
      active = active.filter(function(e) { return e.y1 > ym; });
      xs.length = 0;
      for (var a = 0; a < active.length; a++) {
        var e = active[a];
        xs.push([e.x0 + (ya - e.y0) * e.slope, e.x0 + (yb - e.y0) * e.slope, e.x0 + (ym - e.y0) * e.slope]);
      }
      xs.sort(function(p, q) { return p[2] - q[2]; });
      for (var k = 0; k + 1 < xs.length; k += 2) {
        out.push(xs[k][0], ya, xs[k + 1][0], ya, xs[k + 1][1], yb, xs[k][1], yb);
      }
    }
    return out;
  }

  // Bars of one mark ("186", Ø20) across elements: where the leader can point.
  function labelGroups(drawing) {
    var byMark = new Map();
    drawing.elements.forEach(function(e) {
      if (e.kind !== KIND.REBAR || !e.position) return;
      var key = e.position + '|' + e.diameter;
      var g = byMark.get(key);
      if (!g) {
        g = { position: e.position, diameter: e.diameter, points: [], centre: null };
        byMark.set(key, g);
      }
      // Cut bars first (their edges), else the bars in the view depth; thinned out.
      var src = e.edges.length ? e.edges : e.beyond;
      var step = Math.max(1, Math.floor(src.length / 2 / 400)) * 2;
      for (var i = 0; i + 1 < src.length; i += step) g.points.push(src[i], src[i + 1]);
    });
    var groups = [];
    byMark.forEach(function(g) {
      if (!g.points.length) return;
      var b = emptyBounds();
      for (var i = 0; i < g.points.length; i += 2) grow(b, g.points[i], g.points[i + 1]);
      g.centre = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
      groups.push(g);
    });
    return groups;
  }

  // =====================================
  // PANEL
  // =====================================

  function ensurePanel() {
    var panel = document.getElementById(PANEL_ID);
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'section-profile-panel';
    panel.innerHTML =
      '<div class="floating-panel-header section-profile-header" id="sectionProfileHeader">' +
        '<span class="floating-panel-title" id="sectionProfileTitle">Section</span>' +
        '<div class="floating-panel-controls">' +
          '<button class="floating-panel-btn" onclick="BimViewer.exportSectionProfileSvg()" title="Export the drawing as SVG">' +
            '<i data-lucide="download"></i></button>' +
          '<button class="floating-panel-btn" onclick="BimViewer.toggleSectionProfile(false)" title="Close">' +
            '<i data-lucide="x"></i></button>' +
        '</div>' +
      '</div>' +
      '<div class="section-profile-toolbar">' +
        '<span class="sp-depth" id="sectionProfileDepth" title="View depth: reinforcement this far behind the cut is drawn too (stirrups)"></span>' +
        '<button class="sp-tool-btn" onclick="BimViewer.stepSectionProfileDepth(-1)" title="Less view depth">' +
          '<i data-lucide="minus"></i></button>' +
        '<button class="sp-tool-btn" onclick="BimViewer.stepSectionProfileDepth(1)" title="More view depth">' +
          '<i data-lucide="plus"></i></button>' +
        '<span class="sp-tool-gap"></span>' +
        '<button class="sp-tool-btn" id="sectionProfileMarks" onclick="BimViewer.toggleSectionProfileMarks()" title="Show or hide the bar marks">Marks</button>' +
        '<button class="sp-tool-btn" id="sectionProfileTerrain" onclick="BimViewer.toggleSectionProfileTerrain()" ' +
          'title="Terrain line along the cut (zoom out to see it under a high bridge)">Terrain</button>' +
        '<button class="sp-tool-btn" onclick="BimViewer.fitSectionProfile()" title="Fit the drawing (double click)">Fit</button>' +
      '</div>' +
      '<div class="section-profile-body" id="sectionProfileBody">' +
        '<svg id="sectionProfileSvg" class="section-profile-svg" xmlns="http://www.w3.org/2000/svg"></svg>' +
      '</div>' +
      '<div class="section-profile-footer" id="sectionProfileFooter"></div>';
    document.body.appendChild(panel);
    if (typeof BimViewer.makeFloatingPanelDraggable === 'function') {
      BimViewer.makeFloatingPanelDraggable(panel, panel.querySelector('#sectionProfileHeader'));
    }
    if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide', node: panel });
    var svg = panel.querySelector('#sectionProfileSvg');
    wireInteraction(svg);
    if (window.ResizeObserver) {
      new ResizeObserver(function() { if (BimViewer.sectionProfile.open) renderAll(); }).observe(svg);
    }
    updateToolbar();
    return panel;
  }

  var statusText = '';
  var hoverText = '';
  function setStatus(text) {
    statusText = text || '';
    updateFooter();
  }

  function updateFooter() {
    var el = document.getElementById('sectionProfileFooter');
    if (!el) return;
    el.classList.toggle('sp-footer-hover', !!hoverText);
    el.textContent = hoverText || statusText || terrainState.status ||
      'Wheel: zoom · drag: pan · double click: fit · m right of the cut / up';
  }

  function updateToolbar() {
    var sp = BimViewer.sectionProfile;
    var depth = document.getElementById('sectionProfileDepth');
    if (depth) depth.textContent = 'Depth ' + sp.depth.toFixed(2) + ' m';
    var marks = document.getElementById('sectionProfileMarks');
    if (marks) {
      marks.textContent = sp.marks ? 'Marks: on' : 'Marks: off';
      marks.classList.toggle('active', sp.marks);
    }
    var terrain = document.getElementById('sectionProfileTerrain');
    if (terrain) {
      terrain.textContent = sp.terrain ? 'Terrain: on' : 'Terrain: off';
      terrain.classList.toggle('active', sp.terrain);
    }
  }

  BimViewer.toggleSectionProfile = function(force) {
    var sp = this.sectionProfile;
    var open = typeof force === 'boolean' ? force : !sp.open;
    sp.open = open;
    var panel = open ? ensurePanel() : document.getElementById(PANEL_ID);
    if (panel) panel.classList.toggle('visible', open);
    var section = this.getAlignmentSection && this.getAlignmentSection();
    var btn = section && document.getElementById('axisProfile_' + section.assetId);
    if (btn) btn.classList.toggle('flipped', open);
    if (open) {
      sp.needsFit = true;
      schedule();
    }
  };

  BimViewer.fitSectionProfile = function() {
    this.sectionProfile.needsFit = true;
    renderAll();
  };

  BimViewer.stepSectionProfileDepth = function(direction) {
    var sp = this.sectionProfile;
    var i = 0;
    while (i + 1 < DEPTHS.length && DEPTHS[i] < sp.depth - 1e-6) i++;
    sp.depth = DEPTHS[Math.min(Math.max(i + direction, 0), DEPTHS.length - 1)];
    updateToolbar();
    schedule();
  };

  BimViewer.toggleSectionProfileMarks = function() {
    this.sectionProfile.marks = !this.sectionProfile.marks;
    this.sectionProfile.needsFit = true;
    updateToolbar();
    renderAll();
  };

  BimViewer.toggleSectionProfileTerrain = function() {
    this.sectionProfile.terrain = !this.sectionProfile.terrain;
    terrainState.line = null;
    terrainState.key = '';
    terrainState.status = '';
    updateToolbar();
    if (lastFrame && lastSection) requestTerrain(lastSection, lastFrame);
    renderAll();
  };

  // =====================================
  // UPDATE
  // =====================================

  // A timer, not requestAnimationFrame: that one never fires while the tab is
  // hidden, and the update would stay pending for good.
  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(function() {
      pending = false;
      update();
    }, 16);
  }

  var lastSection = null, lastFrame = null;

  async function update() {
    var sp = BimViewer.sectionProfile;
    if (!sp.open) return;
    var section = BimViewer.getAlignmentSection && BimViewer.getAlignmentSection();
    if (!section) {
      if (BimViewer.alignmentSection && BimViewer.alignmentSection.draw) {
        setStatus('Draw the section line in the view');
        return;
      }
      BimViewer.toggleSectionProfile(false);
      return;
    }
    if (!section.tilesetUrl) {
      setStatus('The drawing needs a self-hosted tileset');
      return;
    }
    var gen = ++sp.generation;
    var title = document.getElementById('sectionProfileTitle');
    if (title) title.textContent = section.title + ' · ' + (section.mode === 'axis' ? section.axisName : section.assetName);

    // A new model, axis, line or viewing direction starts fitted; moving the
    // section keeps the view.
    if (sp.fitKey !== section.fitKey) {
      sp.fitKey = section.fitKey;
      sp.needsFit = true;
    }

    try {
      var entry = assetCache(section.assetId, section.tilesetUrl);
      var index = await entry.index;
      var frame = getFrame(section);
      var depth = sp.depth;
      var uris = tilesInView(index, frame, depth);
      var missing = uris.filter(function(u) { return !entry.tiles.has(u); }).length;
      var done = 0;
      function progress() {
        if (missing && gen === sp.generation) setStatus('Reading tiles ' + done + ' / ' + uris.length + '…');
      }
      progress();
      var tiles = await Promise.all(uris.map(function(u) {
        return loadTile(entry, u).then(function(t) { done++; progress(); return t; });
      }));
      if (gen !== sp.generation) return;            // the section moved on
      var drawing = slice(tiles, frame, depth);
      drawing.groups = labelGroups(drawing);
      drawing.section = section;
      sp.drawing = drawing;
      lastSection = section;
      lastFrame = frame;
      hover = -1;
      hoverText = '';
      setStatus(drawing.elements.length ? '' : 'Nothing cut here');
      renderGeometry();
      renderAll();
      requestTerrain(section, frame);
    } catch (err) {
      console.warn('Section drawing failed:', err);
      if (gen === sp.generation) setStatus('Section drawing failed: ' + err.message);
    }
  }

  window.addEventListener('geobim:alignment-section', function() {
    if (BimViewer.sectionProfile.open) schedule();
  });

  // =====================================
  // TERRAIN LINE
  // =====================================

  // The ground the scene shows along the cut, ±100 m every 0.5 m. The models
  // themselves are excluded; Google 3D Tiles include buildings and trees.
  var terrainState = { line: null, status: '', busy: false, dirty: false, key: '' };

  function requestTerrain(section, frame) {
    var sp = BimViewer.sectionProfile;
    if (!sp.terrain) return;
    if (section.mode === 'plan') {
      terrainState.line = null;
      terrainState.status = 'A plan has no terrain line';
      updateFooter();
      return;
    }
    var key = [frame.P.x, frame.P.y, frame.P.z, frame.N.x, frame.N.y, frame.N.z, section.assetId].join(',');
    if (key === terrainState.key) return;
    if (terrainState.busy) {
      terrainState.dirty = true;  // the section moved on: sample again when this one is back
      return;
    }
    var viewer = BimViewer.viewer, scene = viewer.scene;
    // Entities too: the section's own points and markers would be hit first.
    var exclude = viewer.entities.values.slice();
    var assetTilesets = [];
    BimViewer.loadedAssets.forEach(function(ad) {
      if (ad.tileset) { exclude.push(ad.tileset); assetTilesets.push(ad.tileset); }
      if (ad.model) exclude.push(ad.model);
    });
    // Photorealistic 3D tiles shown: their surface; else the globe's terrain.
    var google = false;
    for (var i = 0; i < scene.primitives.length; i++) {
      var prim = scene.primitives.get(i);
      if (prim instanceof Cesium.Cesium3DTileset && prim.show && assetTilesets.indexOf(prim) < 0) google = true;
    }
    var provider = scene.globe.show && scene.globe.terrainProvider;
    if (provider instanceof Cesium.EllipsoidTerrainProvider) provider = null;
    if (google && !scene.sampleHeightSupported) google = false;
    if (!google && !provider) {
      terrainState.line = null;
      terrainState.status = 'No terrain in the scene';
      updateFooter();
      return;
    }
    var tileset = section.tileset;
    var m = tileset.root.computedTransform;
    var cartos = [];
    for (var x = -TERRAIN_HALF_WIDTH_M; x <= TERRAIN_HALF_WIDTH_M + 1e-6; x += TERRAIN_STEP_M) {
      var local = new Cesium.Cartesian3(frame.P.x + frame.R.x * x, frame.P.y + frame.R.y * x, frame.P.z + frame.R.z * x);
      cartos.push(Cesium.Cartographic.fromCartesian(Cesium.Matrix4.multiplyByPoint(m, local, new Cesium.Cartesian3())));
    }
    terrainState.busy = true;
    terrainState.dirty = false;
    terrainState.key = key;
    terrainState.status = 'Sampling the terrain…';
    updateFooter();
    var sampled = google ? scene.sampleHeightMostDetailed(cartos, exclude) : Cesium.sampleTerrainMostDetailed(provider, cartos);
    sampled.then(function(results) {
      var inv = Cesium.Matrix4.inverse(tileset.root.computedTransform, new Cesium.Matrix4());
      var line = [], hits = 0;
      results.forEach(function(c) {
        if (!c || c.height === undefined || !isFinite(c.height)) { line.push(NaN, NaN); return; }
        var l = Cesium.Matrix4.multiplyByPoint(inv, Cesium.Cartographic.toCartesian(c), new Cesium.Cartesian3());
        var dx = l.x - frame.P.x, dy = l.y - frame.P.y, dz = l.z - frame.P.z;
        line.push(frame.R.x * dx + frame.R.y * dy + frame.R.z * dz, frame.U.x * dx + frame.U.y * dy + frame.U.z * dz);
        hits++;
      });
      terrainState.line = hits ? line : null;
      terrainState.status = !hits ? 'No terrain height here'
        : google ? 'Terrain from 3D tiles in the scene: buildings and trees are included' : '';
    }).catch(function(err) {
      console.warn('Terrain sampling failed:', err);
      terrainState.line = null;
      terrainState.status = 'Terrain sampling failed';
    }).then(function() {
      terrainState.busy = false;
      updateFooter();
      renderAll();
      if (terrainState.dirty && lastSection && lastFrame) {
        terrainState.key = '';
        requestTerrain(lastSection, lastFrame);
      }
    });
  }

  // =====================================
  // RENDERING
  // =====================================

  // 1, 2, 5 × 10^n.
  function niceStep(raw) {
    var pow = Math.pow(10, Math.floor(Math.log10(raw)));
    var m = raw / pow;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * pow;
  }

  function f3(v) { return (Math.round(v * 1000) / 1000).toString(); }
  function f1(v) { return (Math.round(v * 10) / 10).toString(); }

  function escapeXml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Close enough for laying out labels without measuring in the DOM.
  function textWidth(text, size, bold) {
    return String(text).length * size * (bold ? 0.62 : 0.56);
  }

  function svgSize() {
    var svg = document.getElementById('sectionProfileSvg');
    var r = svg ? svg.getBoundingClientRect() : { width: 0, height: 0 };
    return { w: r.width, h: r.height };
  }

  function toScreen(v, size, x, y) {
    return { x: (x - v.cx) * v.scale + size.w / 2, y: (v.cy - y) * v.scale + size.h / 2 };
  }

  function toModel(v, size, sx, sy) {
    return { x: v.cx + (sx - size.w / 2) / v.scale, y: v.cy - (sy - size.h / 2) / v.scale };
  }

  // Room for the bar marks beside the drawing, the dimensions below and the title block.
  function fitView(drawing, size) {
    var sp = BimViewer.sectionProfile;
    var b = drawing.bounds;
    var side = sp.marks && drawing.groups.length ? 150 : 70;
    var top = 36, bottom = 120;
    var ex = Math.max(b.maxX - b.minX, 0.5), ey = Math.max(b.maxY - b.minY, 0.5);
    var w = Math.max(size.w - 2 * side, 60), h = Math.max(size.h - top - bottom, 60);
    var scale = Math.min(w / ex, h / ey);
    sp.view = {
      cx: (b.minX + b.maxX) / 2,
      cy: (b.minY + b.maxY) / 2 + (top + 0.5 * h - 0.5 * size.h) / scale,
      scale: scale
    };
  }

  // Model geometry in one group under a model → screen transform; zoom and pan
  // only change that transform. Strokes keep their pixel width.
  var geometryMarkup = '';
  function renderGeometry() {
    var drawing = BimViewer.sectionProfile.drawing;
    var parts = [];
    function fills(kind, color) {
      drawing.elements.forEach(function(e, i) {
        if (e.kind !== kind) return;
        var d = [], k;
        var q = e.fill || [];
        for (k = 0; k + 7 < q.length; k += 8) {
          d.push('M' + f3(q[k]) + ' ' + f3(q[k + 1]) + 'L' + f3(q[k + 2]) + ' ' + f3(q[k + 3]) +
                 'L' + f3(q[k + 4]) + ' ' + f3(q[k + 5]) + 'L' + f3(q[k + 6]) + ' ' + f3(q[k + 7]) + 'Z');
        }
        var t = e.beyond;
        for (k = 0; k + 5 < t.length; k += 6) {
          d.push('M' + f3(t[k]) + ' ' + f3(t[k + 1]) + 'L' + f3(t[k + 2]) + ' ' + f3(t[k + 3]) +
                 'L' + f3(t[k + 4]) + ' ' + f3(t[k + 5]) + 'Z');
        }
        // A hairline in the fill colour closes the seams between the trapezoids.
        if (d.length) {
          parts.push('<path class="sp-el sp-fill" data-i="' + i + '" fill="' + color + '" stroke="' + color +
            '" stroke-width="0.6" vector-effect="non-scaling-stroke" d="' + d.join('') + '"/>');
        }
      });
    }
    function edges(kind, width, color) {
      drawing.elements.forEach(function(e, i) {
        if (e.kind !== kind || !e.edges.length) return;
        var d = [];
        for (var k = 0; k + 3 < e.edges.length; k += 4) {
          d.push('M' + f3(e.edges[k]) + ' ' + f3(e.edges[k + 1]) + 'L' + f3(e.edges[k + 2]) + ' ' + f3(e.edges[k + 3]));
        }
        parts.push('<path class="sp-el sp-edge" data-i="' + i + '" fill="none" stroke="' + color + '" stroke-width="' + width +
          '" stroke-linecap="round" vector-effect="non-scaling-stroke" d="' + d.join('') + '"/>');
      });
    }
    // Cut faces, outlines, the reinforcement on top.
    fills(KIND.CONCRETE, CONCRETE_FILL);
    fills(KIND.STEEL, STEEL_FILL);
    edges(KIND.OTHER, 1, OTHER_LINE);
    edges(KIND.STEEL, 1.2, INK);
    edges(KIND.CONCRETE, 2, INK);
    fills(KIND.REBAR, INK);
    edges(KIND.REBAR, 1, INK);
    geometryMarkup = parts.join('');
  }

  // Everything: paper, terrain, geometry, axis and the annotations in pixels.
  function renderAll() {
    var sp = BimViewer.sectionProfile;
    var svg = document.getElementById('sectionProfileSvg');
    var drawing = sp.drawing;
    if (!svg || !drawing) return;
    var size = svgSize();
    if (size.w < 50 || size.h < 50) return;
    if (sp.needsFit || !sp.view) {
      sp.needsFit = false;
      fitView(drawing, size);
    }
    var v = sp.view;
    svg.setAttribute('viewBox', '0 0 ' + size.w + ' ' + size.h);
    var section = drawing.section;
    var parts = ['<rect x="0" y="0" width="' + size.w + '" height="' + size.h + '" fill="' + PAPER + '"/>'];
    parts.push(terrainMarkup(v, size, section));
    parts.push('<g transform="matrix(' + v.scale + ' 0 0 ' + (-v.scale) + ' ' + (size.w / 2 - v.cx * v.scale) + ' ' +
      (size.h / 2 + v.cy * v.scale) + ')">' + geometryMarkup + '</g>');
    if (section.mode === 'axis') parts.push(axisMarkup(v, size));
    var st = drawing.structure;
    var sMin = toScreen(v, size, st.minX, st.maxY);   // top left on screen
    var sMax = toScreen(v, size, st.maxX, st.minY);   // bottom right
    parts.push(dimensionsMarkup(v, size, sMin, sMax, st, section.mode === 'axis'));
    if (sp.marks) parts.push(labelsMarkup(v, size, drawing.groups, sMin, sMax));
    parts.push(scaleBarMarkup(v, size));
    if (section.mode === 'plan') parts.push(northArrowMarkup(size, lastFrame));
    parts.push(titleBlockMarkup(size, section, drawing));
    svg.innerHTML = parts.join('');
    applyHover();
  }

  function line(a, b, width, color, extra) {
    return '<line x1="' + f1(a.x) + '" y1="' + f1(a.y) + '" x2="' + f1(b.x) + '" y2="' + f1(b.y) +
      '" stroke="' + (color || INK) + '" stroke-width="' + width + '"' + (extra || '') + '/>';
  }

  function text(str, x, y, size, opts) {
    opts = opts || {};
    return '<text x="' + f1(x) + '" y="' + f1(y) + '" font-family="' + FONT + '" font-size="' + size + '"' +
      (opts.bold ? ' font-weight="700"' : '') +
      ' fill="' + (opts.color || INK) + '"' +
      (opts.anchor ? ' text-anchor="' + opts.anchor + '"' : '') +
      (opts.baseline ? ' dominant-baseline="' + opts.baseline + '"' : '') +
      (opts.rotate ? ' transform="rotate(' + opts.rotate + ' ' + f1(x) + ' ' + f1(y) + ')"' : '') +
      '>' + escapeXml(str) + '</text>';
  }

  // Terrain line with the ground hatch below it (short oblique strokes) and
  // its height at the cut's origin. Doesn't count for fitting.
  function terrainMarkup(v, size, section) {
    if (!BimViewer.sectionProfile.terrain || !terrainState.line || section.mode === 'plan') return '';
    var pts = terrainState.line;
    var d = [], hatch = [], run = 0, atAxis = null, labelAt = null;
    var spacing = 9;
    for (var i = 0; i + 3 < pts.length; i += 2) {
      var x0 = pts[i], y0 = pts[i + 1], x1 = pts[i + 2], y1 = pts[i + 3];
      if (isNaN(x0) || isNaN(x1)) continue;
      if (x0 <= 0 && x1 >= 0 && x1 > x0) atAxis = y0 + (y1 - y0) * (-x0 / (x1 - x0));
      var a = toScreen(v, size, x0, y0), b = toScreen(v, size, x1, y1);
      if (Math.max(a.x, b.x) < -20 || Math.min(a.x, b.x) > size.w + 20 || Math.max(a.y, b.y) < -20 || Math.min(a.y, b.y) > size.h + 20) continue;
      if (a.x >= 0 && (!labelAt || a.x < labelAt.x)) labelAt = a;
      d.push('M' + f1(a.x) + ' ' + f1(a.y) + 'L' + f1(b.x) + ' ' + f1(b.y));
      var len = Math.hypot(b.x - a.x, b.y - a.y);
      for (var t = spacing - run; t < len; t += spacing) {
        var px = a.x + (b.x - a.x) * t / Math.max(len, 1e-3), py = a.y + (b.y - a.y) * t / Math.max(len, 1e-3);
        hatch.push('M' + f1(px) + ' ' + f1(py + 2) + 'L' + f1(px - 5) + ' ' + f1(py + 8));
      }
      run = (run + len) % spacing;
    }
    var out = '<path d="' + d.join('') + '" fill="none" stroke="' + TERRAIN_LINE + '" stroke-width="1.4"/>' +
      '<path d="' + hatch.join('') + '" fill="none" stroke="' + TERRAIN_LINE + '" stroke-width="0.7"/>';
    if (labelAt && labelAt.x < size.w) out += text('Terrain', labelAt.x + 4, labelAt.y - 4, 10, { color: TERRAIN_LINE });
    if (atAxis !== null) {
      var p = toScreen(v, size, 0, atAxis);
      out += text((atAxis < 0 ? '−' : '+') + Math.abs(atAxis).toFixed(2), p.x + 4, p.y - 4, 10, { color: TERRAIN_LINE });
    }
    return out;
  }

  // Chain line (long dash, gap, dot, gap) through the axis, the axis point
  // (gradient line height) as a short cross line.
  function axisMarkup(v, size) {
    var o = toScreen(v, size, 0, 0);
    if (o.x < -10 || o.x > size.w + 10) return '';
    return line({ x: o.x, y: 0 }, { x: o.x, y: size.h }, 0.8, '#3C3C3C', ' stroke-dasharray="20 4 2 4"') +
      line({ x: o.x - 7, y: o.y }, { x: o.x + 7, y: o.y }, 1, '#3C3C3C') +
      text('Axis', o.x + 4, 16, 10);
  }

  // One dimension line with oblique ticks, extension lines from the part and
  // the value in metres.
  function dimension(a, b, fromA, fromB, value) {
    var vertical = Math.abs(b.x - a.x) < Math.abs(b.y - a.y);
    var len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    var dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    var outV = vertical ? { x: 1, y: 0 } : { x: 0, y: 1 };
    var out = line({ x: a.x - dir.x * 6, y: a.y - dir.y * 6 }, { x: b.x + dir.x * 6, y: b.y + dir.y * 6 }, 0.8);
    [[a, fromA], [b, fromB]].forEach(function(end) {
      var p = end[0], from = end[1];
      var l = Math.hypot(p.x - from.x, p.y - from.y) || 1;
      var al = { x: (p.x - from.x) / l, y: (p.y - from.y) / l };
      out += line({ x: from.x + al.x * 3, y: from.y + al.y * 3 }, { x: p.x + al.x * 5, y: p.y + al.y * 5 }, 0.6);
      var tl = Math.hypot(dir.x + outV.x, dir.y + outV.y) || 1;
      var tick = { x: (dir.x + outV.x) / tl * 4.5, y: (dir.y + outV.y) / tl * 4.5 };
      out += line({ x: p.x - tick.x, y: p.y - tick.y }, { x: p.x + tick.x, y: p.y + tick.y }, 1.4);
    });
    if (len < 18) return out;
    var mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return out + (vertical
      ? text(value.toFixed(2), mid.x - 5, mid.y, 10, { anchor: 'middle', rotate: -90 })
      : text(value.toFixed(2), mid.x, mid.y - 4, 10, { anchor: 'middle' }));
  }

  // Overall width (split at the axis) below the structure, overall height on its right.
  function dimensionsMarkup(v, size, sMin, sMax, st, splitAtAxis) {
    if (sMax.x - sMin.x < 4) return '';
    var axisX = toScreen(v, size, 0, 0).x;
    var row = sMax.y + 26, out = '';
    if (splitAtAxis && st.minX < -0.01 && st.maxX > 0.01) {
      out += dimension({ x: sMin.x, y: row }, { x: axisX, y: row }, { x: sMin.x, y: sMax.y }, { x: axisX, y: sMax.y }, -st.minX);
      out += dimension({ x: axisX, y: row }, { x: sMax.x, y: row }, { x: axisX, y: sMax.y }, { x: sMax.x, y: sMax.y }, st.maxX);
      row += 22;
    }
    out += dimension({ x: sMin.x, y: row }, { x: sMax.x, y: row }, { x: sMin.x, y: sMax.y }, { x: sMax.x, y: sMax.y }, st.maxX - st.minX);
    var col = sMax.x + 26;
    out += dimension({ x: col, y: sMax.y }, { x: col, y: sMin.y }, { x: sMax.x, y: sMax.y }, { x: sMax.x, y: sMin.y }, st.maxY - st.minY);
    return out;
  }

  // Bar marks in circles with Ø, in columns left and right of the structure,
  // staggered 20 px apart, with leaders to the outermost bar of each mark.
  function labelsMarkup(v, size, groups, sMin, sMax) {
    var LABEL_COLUMN_GAP = 64, LABEL_PITCH = 20, FONT_SIZE = 11;
    var sides = [[], []];
    var midX = 0.5 * (sMin.x + sMax.x);
    groups.forEach(function(g) {
      var right = toScreen(v, size, g.centre.x, g.centre.y).x >= midX;
      var anchor = null;
      for (var i = 0; i + 1 < g.points.length; i += 2) {
        var s = toScreen(v, size, g.points[i], g.points[i + 1]);
        if (!anchor || (right ? s.x > anchor.x : s.x < anchor.x)) anchor = s;
      }
      sides[right ? 1 : 0].push({ group: g, anchor: anchor, y: anchor.y });
    });
    var out = '';
    sides.forEach(function(placed, side) {
      placed.sort(function(a, b) { return a.y - b.y; });
      // Push apart downwards, then back up from the bottom if the column ran out of room.
      for (var i = 1; i < placed.length; i++) placed[i].y = Math.max(placed[i].y, placed[i - 1].y + LABEL_PITCH);
      for (var j = placed.length - 1; j >= 0; j--) {
        var limit = j + 1 < placed.length ? placed[j + 1].y - LABEL_PITCH : size.h - 14;
        placed[j].y = Math.max(Math.min(placed[j].y, limit), 12);
      }
      var right = side === 1;
      var colX = right ? sMax.x + LABEL_COLUMN_GAP : sMin.x - LABEL_COLUMN_GAP;
      placed.forEach(function(p) {
        var mark = p.group.position;
        var bar = p.group.diameter ? 'Ø' + p.group.diameter : '';
        var circleW = Math.max(textWidth(mark, FONT_SIZE) + 10, 18);
        var total = circleW + (bar ? textWidth(bar, FONT_SIZE) + 4 : 0);
        var left = right ? colX : colX - total;
        var from = { x: right ? left - 2 : left + total + 2, y: p.y };
        out += line(from, p.anchor, 0.7);
        out += '<circle cx="' + f1(p.anchor.x) + '" cy="' + f1(p.anchor.y) + '" r="1.8" fill="' + INK + '"/>';
        out += '<rect x="' + f1(left) + '" y="' + f1(p.y - 8) + '" width="' + f1(circleW) + '" height="16" rx="8" ry="8" fill="' +
          PAPER + '" stroke="' + INK + '" stroke-width="1"/>';
        out += text(mark, left + circleW / 2, p.y + 0.5, FONT_SIZE, { anchor: 'middle', baseline: 'middle' });
        if (bar) out += text(bar, left + circleW + 4, p.y + 0.5, FONT_SIZE, { baseline: 'middle' });
      });
    });
    return out;
  }

  function scaleBarMarkup(v, size) {
    var length = niceStep(120 / v.scale);
    var px = length * v.scale;
    var o = { x: 16, y: size.h - 22 };
    var out = '';
    for (var i = 0; i < 4; i++) {
      out += line({ x: o.x + px * i / 4, y: o.y }, { x: o.x + px * (i + 1) / 4, y: o.y }, 5, i % 2 ? PAPER : INK);
    }
    out += line({ x: o.x, y: o.y - 3 }, { x: o.x + px, y: o.y - 3 }, 0.6);
    out += line({ x: o.x, y: o.y + 3 }, { x: o.x + px, y: o.y + 3 }, 0.6);
    var label = length >= 1 ? +length.toPrecision(6) + ' m' : +(length * 100).toPrecision(6) + ' cm';
    return out + text('0', o.x, o.y - 7, 10, { anchor: 'middle' }) + text(label, o.x + px, o.y - 7, 10, { anchor: 'middle' });
  }

  // Plans: north arrow in the top right corner, pointing where local +Y
  // (north) lies in the drawing — down when seen from below.
  function northArrowMarkup(size, frame) {
    if (!frame) return '';
    var nx = frame.R.y, ny = -frame.U.y;   // screen y grows downwards
    var l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    var mid = { x: size.w - 34, y: 44 };
    var tip = { x: mid.x + nx * 18, y: mid.y + ny * 18 }, tail = { x: mid.x - nx * 18, y: mid.y - ny * 18 };
    var side = { x: -ny, y: nx };
    var b = { x: mid.x + nx * 4, y: mid.y + ny * 4 };
    return line(tail, tip, 1.2) +
      '<path d="M' + f1(tip.x) + ' ' + f1(tip.y) + 'L' + f1(b.x + side.x * 6) + ' ' + f1(b.y + side.y * 6) +
      'L' + f1(b.x - side.x * 6) + ' ' + f1(b.y - side.y * 6) + 'Z" fill="' + INK + '"/>' +
      text('N', tip.x + nx * 9, tip.y + ny * 9, 11, { anchor: 'middle', baseline: 'middle', bold: true });
  }

  function titleBlockMarkup(size, section, drawing) {
    var sp = BimViewer.sectionProfile;
    var lines = [
      section.subtitle,
      section.viewText + ' · depth ' + sp.depth.toFixed(2) + ' m',
      section.assetName
    ];
    var width = textWidth(section.title, 13, true);
    lines.forEach(function(l, i) { width = Math.max(width, textWidth(l, i === 0 ? 11 : 10)); });
    width = Math.min(width + 20, Math.max(size.w * 0.5, 160));
    var height = 26 + 15 * lines.length + 6;
    var x = size.w - width - 10, y = size.h - height - 10;
    var out = '<rect x="' + f1(x) + '" y="' + f1(y) + '" width="' + f1(width) + '" height="' + f1(height) +
      '" fill="' + PAPER + '" stroke="' + INK + '" stroke-width="1"/>';
    out += text(section.title, x + 10, y + 19, 13, { bold: true });
    lines.forEach(function(l, i) {
      out += text(l, x + 10, y + 39 + 15 * i, i === 0 ? 11 : 10, { color: i === 0 ? INK : '#464646' });
    });
    if (drawing.truncated) {
      out += text('View depth: not all bars drawn', x, y - 6, 10, { color: '#B31A0D' });
    }
    return out;
  }

  // =====================================
  // HOVER
  // =====================================

  var hover = -1;

  function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
    var d1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    var d2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
    var d3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  }

  // Reinforcement over steel over concrete, then the nearest outline within a few pixels.
  function hitTest(drawing, m, scale) {
    var pad = 4 / scale;
    var kinds = [KIND.REBAR, KIND.STEEL, KIND.CONCRETE];
    for (var k = 0; k < kinds.length; k++) {
      for (var i = 0; i < drawing.elements.length; i++) {
        var e = drawing.elements[i], b = e.bounds;
        if (e.kind !== kinds[k] || m.x < b.minX - pad || m.x > b.maxX + pad || m.y < b.minY - pad || m.y > b.maxY + pad) continue;
        var q = e.fill || [], j;
        for (j = 0; j + 7 < q.length; j += 8) {
          if (inTriangle(m.x, m.y, q[j], q[j + 1], q[j + 2], q[j + 3], q[j + 4], q[j + 5]) ||
              inTriangle(m.x, m.y, q[j], q[j + 1], q[j + 4], q[j + 5], q[j + 6], q[j + 7])) return i;
        }
        var t = e.beyond;
        for (j = 0; j + 5 < t.length; j += 6) {
          if (inTriangle(m.x, m.y, t[j], t[j + 1], t[j + 2], t[j + 3], t[j + 4], t[j + 5])) return i;
        }
      }
    }
    var best = 5 / scale, found = -1;
    drawing.elements.forEach(function(e, idx) {
      var b = e.bounds;
      if (m.x < b.minX - best || m.x > b.maxX + best || m.y < b.minY - best || m.y > b.maxY + best) return;
      for (var s = 0; s + 3 < e.edges.length; s += 4) {
        var ax = e.edges[s], ay = e.edges[s + 1], abx = e.edges[s + 2] - ax, aby = e.edges[s + 3] - ay;
        var tt = Math.min(Math.max(((m.x - ax) * abx + (m.y - ay) * aby) / Math.max(abx * abx + aby * aby, 1e-12), 0), 1);
        var d = Math.hypot(m.x - ax - abx * tt, m.y - ay - aby * tt);
        if (d < best) { best = d; found = idx; }
      }
    });
    return found;
  }

  function applyHover() {
    var svg = document.getElementById('sectionProfileSvg');
    if (!svg) return;
    svg.querySelectorAll('.sp-hover').forEach(function(el) { el.classList.remove('sp-hover'); });
    if (hover >= 0) svg.querySelectorAll('[data-i="' + hover + '"]').forEach(function(el) { el.classList.add('sp-hover'); });
  }

  function setHover(i) {
    if (i === hover) return;
    hover = i;
    var e = i >= 0 ? BimViewer.sectionProfile.drawing.elements[i] : null;
    hoverText = e ? [e.className, e.name].filter(Boolean).join(' · ') : '';
    applyHover();
    updateFooter();
  }

  // =====================================
  // INTERACTION — wheel zoom, drag pan, double click fit, hover
  // =====================================

  function wireInteraction(svg) {
    function local(evt) {
      var rect = svg.getBoundingClientRect();
      return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
    }

    svg.addEventListener('wheel', function(e) {
      var sp = BimViewer.sectionProfile;
      if (!sp.view || !sp.drawing) return;
      e.preventDefault();
      var size = svgSize(), p = local(e);
      var m = toModel(sp.view, size, p.x, p.y);
      var scale = Math.min(Math.max(sp.view.scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2), 0.05), 20000);
      sp.view = {
        cx: m.x - (p.x - size.w / 2) / scale,
        cy: m.y + (p.y - size.h / 2) / scale,
        scale: scale
      };
      renderAll();
    }, { passive: false });

    var drag = null, hoverQueued = null;
    svg.addEventListener('pointerdown', function(e) {
      var sp = BimViewer.sectionProfile;
      if (!sp.view || e.button > 1) return;
      drag = { x: e.clientX, y: e.clientY, cx: sp.view.cx, cy: sp.view.cy };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', function(e) {
      var sp = BimViewer.sectionProfile;
      if (!sp.view || !sp.drawing) return;
      if (drag) {
        sp.view = {
          cx: drag.cx - (e.clientX - drag.x) / sp.view.scale,
          cy: drag.cy + (e.clientY - drag.y) / sp.view.scale,
          scale: sp.view.scale
        };
        renderAll();
        return;
      }
      var first = !hoverQueued;
      hoverQueued = local(e);
      if (!first) return;
      requestAnimationFrame(function() {
        var p = hoverQueued;
        hoverQueued = null;
        if (!sp.drawing || !sp.view) return;
        setHover(hitTest(sp.drawing, toModel(sp.view, svgSize(), p.x, p.y), sp.view.scale));
      });
    });
    svg.addEventListener('pointerleave', function() { if (!drag) setHover(-1); });
    function end(e) {
      if (drag) { drag = null; try { svg.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ } }
    }
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('dblclick', function() { BimViewer.fitSectionProfile(); });
  }

  // =====================================
  // SVG EXPORT
  // =====================================

  BimViewer.exportSectionProfileSvg = function() {
    var svg = document.getElementById('sectionProfileSvg');
    var drawing = this.sectionProfile.drawing;
    if (!svg || !drawing) {
      this.updateStatus('No section drawing to export', 'warning');
      return;
    }
    var size = svgSize();
    var clone = svg.cloneNode(true);
    clone.removeAttribute('id');
    clone.removeAttribute('class');
    clone.setAttribute('xmlns', SVG_NS);
    clone.setAttribute('width', Math.round(size.w));
    clone.setAttribute('height', Math.round(size.h));
    clone.querySelectorAll('.sp-hover').forEach(function(el) { el.classList.remove('sp-hover'); });
    var section = drawing.section;
    var markup = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
    var name = (section.assetName + ' ' + section.title).replace(/[^\w\-+.]+/g, '_').replace(/^_+|_+$/g, '') || 'section';
    var url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = name + '.svg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
    this.updateStatus('Section exported as ' + a.download, 'success');
  };

  // Asset gone → forget its decoded tiles (they can be large)
  var origUnloadAsset = BimViewer.unloadAsset;
  BimViewer.unloadAsset = function(assetId) {
    BimViewer.sectionProfile.assets.delete(String(assetId));
    return origUnloadAsset.apply(this, arguments);
  };

  console.log('Section profile module loaded v2.0');

})();
