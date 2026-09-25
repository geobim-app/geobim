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
// SECTION PROFILE MODULE v1.0
// 2D cross section at the alignment section's station (alignment-section.js):
// the cut edges of every element, drawn as SVG in a floating panel, looking
// in the direction of increasing station (right = right of the axis).
//
// Computed in the browser from the tileset's own GLB tiles — the GPU copy
// Cesium renders can't be read back. Tiles whose bounding box the plane
// crosses are fetched once (the browser cache usually has them already),
// decoded (EXT_meshopt_compression + KHR_mesh_quantization, as written by the
// geobim tiler) and kept, so moving the station re-slices in memory.
// ===============================
'use strict';

(function() {

  var MESHOPT_URL = 'https://cdn.jsdelivr.net/npm/meshoptimizer@1.3.0/meshopt_decoder.mjs';
  var PANEL_ID = 'sectionProfilePanel';
  var PAD_FRACTION = 0.08;

  BimViewer.sectionProfile = {
    open: false,
    assets: new Map(),   // assetId → { url, json: Promise, tiles: Map(uri → Promise<tile>) }
    view: null,          // current SVG viewBox {x, y, w, h}; null = fit
    fitKey: null,        // assetId|axisIndex the view was fitted for
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

  // Accessor → plain array of numbers (normalised ints are not needed here:
  // positions come quantised with the node scale, ids and indices are ints).
  function readAccessor(gltf, bin, index, decoder, cache) {
    var acc = gltf.accessors[index];
    var view = gltf.bufferViews[acc.bufferView];
    var bytes = viewBytes(gltf, bin, acc.bufferView, decoder, cache);
    var Typed = TYPED[acc.componentType];
    var comps = COMPONENTS[acc.type];
    var ext = view.extensions && view.extensions.EXT_meshopt_compression;
    var stride = (ext ? ext.byteStride : view.byteStride) || comps * Typed.BYTES_PER_ELEMENT;
    var start = acc.byteOffset || 0;
    var copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    var dv = new DataView(copy.buffer);
    var out = new Float64Array(acc.count * comps);
    var size = Typed.BYTES_PER_ELEMENT;
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

  function readStrings(gltf, bin, prop, count, decoder, cache) {
    if (!prop || prop.stringOffsets === undefined) return null;
    var values = viewBytes(gltf, bin, prop.values, decoder, cache);
    var offsBytes = viewBytes(gltf, bin, prop.stringOffsets, decoder, cache);
    var copy = new Uint8Array(offsBytes.byteLength);
    copy.set(offsBytes);
    var offs = new Uint32Array(copy.buffer, 0, count + 1);
    var dec = new TextDecoder();
    var out = [];
    for (var i = 0; i < count; i++) out.push(dec.decode(values.subarray(offs[i], offs[i + 1])));
    return out;
  }

  // One tile → primitives in the tileset's local frame (Z-up metres):
  // { pos: Float64Array xyz, idx, fid, color: 'rgb(...)' } + feature names.
  function decodeTile(buffer, decoder) {
    var glb = parseGlb(buffer);
    var gltf = glb.json, bin = glb.bin, cache = {};
    var node = (gltf.nodes || []).find(function(n) { return n.mesh !== undefined; }) || {};
    var t = node.translation || [0, 0, 0];
    var sc = node.scale || [1, 1, 1];
    var prims = [];
    (gltf.meshes[node.mesh || 0].primitives || []).forEach(function(prim) {
      if (prim.mode !== undefined && prim.mode !== 4) return;
      var q = readAccessor(gltf, bin, prim.attributes.POSITION, decoder, cache);
      var n = q.length / 3;
      var pos = new Float64Array(n * 3);
      for (var i = 0; i < n; i++) {
        // glTF Y-up → tileset local Z-up: (x, y, z)_gltf = (x, z, -y)_local
        var gx = t[0] + sc[0] * q[i * 3];
        var gy = t[1] + sc[1] * q[i * 3 + 1];
        var gz = t[2] + sc[2] * q[i * 3 + 2];
        pos[i * 3] = gx; pos[i * 3 + 1] = -gz; pos[i * 3 + 2] = gy;
      }
      var idx = prim.indices !== undefined ? readAccessor(gltf, bin, prim.indices, decoder, cache) : null;
      var fid = prim.attributes._FEATURE_ID_0 !== undefined
        ? readAccessor(gltf, bin, prim.attributes._FEATURE_ID_0, decoder, cache) : null;
      var mat = gltf.materials && gltf.materials[prim.material];
      var cf = (mat && mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorFactor) || [0.8, 0.8, 0.8, 1];
      prims.push({ pos: pos, idx: idx, fid: fid, color: cf });
    });

    var names = null, classes = null;
    var meta = gltf.extensions && gltf.extensions.EXT_structural_metadata;
    var table = meta && meta.propertyTables && meta.propertyTables[0];
    if (table) {
      names = readStrings(gltf, bin, table.properties.name, table.count, decoder, cache);
      classes = readStrings(gltf, bin, table.properties.className, table.count, decoder, cache);
    }
    return { prims: prims, names: names, classes: classes };
  }

  // =====================================
  // TILES
  // =====================================

  function assetCache(section) {
    var cache = BimViewer.sectionProfile.assets;
    var entry = cache.get(section.assetId);
    if (!entry) {
      var url = new URL(section.tilesetUrl, window.location.href).href;
      entry = {
        url: url,
        json: fetch(url).then(function(r) {
          if (!r.ok) throw new Error('tileset.json ' + r.status);
          return r.json();
        }),
        tiles: new Map()
      };
      cache.set(section.assetId, entry);
    }
    return entry;
  }

  // Content URIs whose (local-frame, axis-aligned in our tiler) bounding box
  // the plane n·(x − p) = 0 crosses. Child tiles carry no transforms.
  function tilesCrossing(tilesetJson, p, n) {
    var out = [];
    (function walk(tile) {
      var b = tile.boundingVolume && tile.boundingVolume.box;
      if (b) {
        var d = n.x * (b[0] - p.x) + n.y * (b[1] - p.y) + n.z * (b[2] - p.z);
        var r = 0;
        for (var k = 0; k < 3; k++) {
          r += Math.abs(n.x * b[3 + k * 3] + n.y * b[4 + k * 3] + n.z * b[5 + k * 3]);
        }
        if (Math.abs(d) > r) return;
      }
      var c = tile.content && (tile.content.uri || tile.content.url);
      if (c) out.push(c);
      (tile.children || []).forEach(walk);
    })(tilesetJson.root);
    return out;
  }

  function loadTile(entry, uri) {
    if (!entry.tiles.has(uri)) {
      var url = new URL(uri, entry.url).href;
      var p = Promise.all([fetch(url).then(function(r) {
        if (!r.ok) throw new Error(uri + ' ' + r.status);
        return r.arrayBuffer();
      }), meshopt()]).then(function(res) { return decodeTile(res[0], res[1]); });
      p.catch(function() { entry.tiles.delete(uri); });
      entry.tiles.set(uri, p);
    }
    return entry.tiles.get(uri);
  }

  // =====================================
  // SLICING
  // =====================================

  // Cut edges of one tile with the plane through P normal T, projected onto
  // (R, U): R = T × Z (right, horizontal), U = R × T (up, in the plane).
  function sliceTile(tile, frame, byFeature) {
    var P = frame.P, T = frame.T, R = frame.R, U = frame.U;
    tile.prims.forEach(function(prim) {
      var pos = prim.pos, n = pos.length / 3;
      var s = new Float64Array(n);
      for (var i = 0; i < n; i++) {
        s[i] = T.x * (pos[i * 3] - P.x) + T.y * (pos[i * 3 + 1] - P.y) + T.z * (pos[i * 3 + 2] - P.z);
      }
      var idx = prim.idx;
      var triCount = idx ? idx.length / 3 : n / 3;
      var hit = [0, 0, 0, 0, 0, 0];
      for (var tr = 0; tr < triCount; tr++) {
        var a = idx ? idx[tr * 3] : tr * 3, b = idx ? idx[tr * 3 + 1] : tr * 3 + 1, c = idx ? idx[tr * 3 + 2] : tr * 3 + 2;
        var sa = s[a], sb = s[b], sc = s[c];
        if ((sa > 0 && sb > 0 && sc > 0) || (sa < 0 && sb < 0 && sc < 0)) continue;
        var k = 0;
        var edges = [[a, b, sa, sb], [b, c, sb, sc], [c, a, sc, sa]];
        for (var e = 0; e < 3 && k < 6; e++) {
          var i0 = edges[e][0], i1 = edges[e][1], s0 = edges[e][2], s1 = edges[e][3];
          if ((s0 > 0) === (s1 > 0) || s0 === s1) continue;
          var f = s0 / (s0 - s1);
          var x = pos[i0 * 3] + (pos[i1 * 3] - pos[i0 * 3]) * f - P.x;
          var y = pos[i0 * 3 + 1] + (pos[i1 * 3 + 1] - pos[i0 * 3 + 1]) * f - P.y;
          var z = pos[i0 * 3 + 2] + (pos[i1 * 3 + 2] - pos[i0 * 3 + 2]) * f - P.z;
          hit[k++] = R.x * x + R.y * y + R.z * z;
          hit[k++] = U.x * x + U.y * y + U.z * z;
        }
        if (k < 4) continue;
        var fid = prim.fid ? prim.fid[a] : 0;
        var key = fid + '|' + prim.color.join(',');
        var g = byFeature.get(key);
        if (!g) {
          g = {
            color: prim.color,
            name: tile.names ? tile.names[fid] : '',
            className: tile.classes ? tile.classes[fid] : '',
            segs: []
          };
          byFeature.set(key, g);
        }
        g.segs.push(hit[0], hit[1], hit[2], hit[3]);
      }
    });
  }

  function sectionFrame(section) {
    var P = section.point, T = section.tangent;
    var R = new Cesium.Cartesian3(T.y, -T.x, 0);            // T × Z
    if (Cesium.Cartesian3.magnitude(R) < 1e-9) R = new Cesium.Cartesian3(1, 0, 0);
    Cesium.Cartesian3.normalize(R, R);
    var U = Cesium.Cartesian3.cross(R, T, new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(U, U);
    return { P: P, T: T, R: R, U: U };
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
        '<span class="floating-panel-title" id="sectionProfileTitle">Cross section</span>' +
        '<div class="floating-panel-controls">' +
          '<button class="floating-panel-btn" onclick="BimViewer.fitSectionProfile()" title="Fit to view">' +
            '<i data-lucide="maximize"></i></button>' +
          '<button class="floating-panel-btn" onclick="BimViewer.toggleSectionProfile(false)" title="Close">' +
            '<i data-lucide="x"></i></button>' +
        '</div>' +
      '</div>' +
      '<div class="section-profile-body">' +
        '<svg id="sectionProfileSvg" class="section-profile-svg" xmlns="http://www.w3.org/2000/svg"></svg>' +
        '<div class="section-profile-status" id="sectionProfileStatus"></div>' +
        '<div class="section-profile-legend" id="sectionProfileLegend"></div>' +
        '<div class="section-profile-hover" id="sectionProfileHover"></div>' +
      '</div>';
    document.body.appendChild(panel);
    if (typeof BimViewer.makeFloatingPanelDraggable === 'function') {
      BimViewer.makeFloatingPanelDraggable(panel, panel.querySelector('#sectionProfileHeader'));
    }
    if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide', node: panel });
    wireInteraction(panel.querySelector('#sectionProfileSvg'));
    return panel;
  }

  function setStatus(text) {
    var el = document.getElementById('sectionProfileStatus');
    if (el) el.textContent = text || '';
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
      sp.view = null;
      schedule();
    }
  };

  BimViewer.fitSectionProfile = function() {
    this.sectionProfile.view = null;
    schedule();
  };

  // =====================================
  // UPDATE
  // =====================================

  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function() {
      pending = false;
      update();
    });
  }

  async function update() {
    var sp = BimViewer.sectionProfile;
    if (!sp.open) return;
    var section = BimViewer.getAlignmentSection && BimViewer.getAlignmentSection();
    if (!section) {
      BimViewer.toggleSectionProfile(false);
      return;
    }
    if (!section.tilesetUrl) {
      setStatus('Cross section needs a self-hosted tileset');
      return;
    }
    var gen = ++sp.generation;
    var title = document.getElementById('sectionProfileTitle');
    if (title) title.textContent = 'Cross section · ' + section.axisName + ' · ' + section.stationText;

    var fitKey = section.assetId + '|' + section.axisIndex;
    if (sp.fitKey !== fitKey) {
      sp.fitKey = fitKey;
      sp.view = null;
    }

    try {
      var entry = assetCache(section);
      var json = await entry.json;
      var frame = sectionFrame(section);
      var uris = tilesCrossing(json, frame.P, frame.T);
      var missing = uris.filter(function(u) { return !entry.tiles.has(u); }).length;
      if (missing) setStatus('Loading ' + missing + ' tile' + (missing > 1 ? 's' : '') + '…');
      var tiles = await Promise.all(uris.map(function(u) { return loadTile(entry, u); }));
      if (gen !== sp.generation) return;            // a newer station won
      var byFeature = new Map();
      tiles.forEach(function(t) { sliceTile(t, frame, byFeature); });
      setStatus(byFeature.size ? '' : 'Nothing cut at this station');
      render(Array.from(byFeature.values()));
    } catch (err) {
      console.warn('Section profile failed:', err);
      if (gen === sp.generation) setStatus('Cross section failed: ' + err.message);
    }
  }

  window.addEventListener('geobim:alignment-section', function() {
    if (BimViewer.sectionProfile.open) schedule();
  });

  // =====================================
  // RENDERING
  // =====================================

  function niceStep(span, target) {
    var raw = span / target;
    var pow = Math.pow(10, Math.floor(Math.log10(raw)));
    var m = raw / pow;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * pow;
  }

  // Dark model colours vanish on the dark panel: lift them to a minimum
  // lightness, keeping the hue.
  function strokeColor(c) {
    var r = c[0], g = c[1], b = c[2];
    var l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    var k = l < 0.45 ? 0.45 / Math.max(l, 0.05) : 1;
    function ch(v) { return Math.round(Math.min(1, v * k + (l < 0.05 ? 0.4 : 0)) * 255); }
    return 'rgb(' + ch(r) + ',' + ch(g) + ',' + ch(b) + ')';
  }

  function fmt(v, step) {
    var dec = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
    return v.toFixed(dec);
  }

  var lastGroups = [];
  function render(groups) {
    lastGroups = groups;
    var sp = BimViewer.sectionProfile;
    var svg = document.getElementById('sectionProfileSvg');
    if (!svg) return;

    if (!sp.view) {
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      groups.forEach(function(g) {
        for (var i = 0; i < g.segs.length; i += 2) {
          var x = g.segs[i], y = g.segs[i + 1];
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      });
      if (!isFinite(minX)) { minX = -10; maxX = 10; minY = -5; maxY = 5; }
      minX = Math.min(minX, 0); maxX = Math.max(maxX, 0);
      minY = Math.min(minY, 0); maxY = Math.max(maxY, 0);
      var w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);
      var rect = svg.getBoundingClientRect();
      var aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 9;
      if (w / h < aspect) w = h * aspect; else h = w / aspect;
      var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      w *= 1 + 2 * PAD_FRACTION; h *= 1 + 2 * PAD_FRACTION;
      sp.view = { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
    }
    var v = sp.view;
    // SVG y grows downwards: draw with y' = −y
    svg.setAttribute('viewBox', v.x + ' ' + (-v.y - v.h) + ' ' + v.w + ' ' + v.h);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    var step = niceStep(Math.max(v.w, v.h), 8);
    var parts = [];
    // grid
    var gx0 = Math.ceil(v.x / step) * step, gy0 = Math.ceil(v.y / step) * step;
    var lab = v.h / 40;
    for (var gx = gx0; gx <= v.x + v.w; gx += step) {
      parts.push('<line class="sp-grid' + (Math.abs(gx) < step / 1e6 ? ' sp-grid-zero' : '') + '" x1="' + gx + '" y1="' + (-v.y - v.h) + '" x2="' + gx + '" y2="' + (-v.y) + '"/>');
      parts.push('<text class="sp-label" x="' + (gx + lab * 0.3) + '" y="' + (-v.y - lab * 0.5) + '" font-size="' + lab + '">' + fmt(gx, step) + '</text>');
    }
    for (var gy = gy0; gy <= v.y + v.h; gy += step) {
      parts.push('<line class="sp-grid' + (Math.abs(gy) < step / 1e6 ? ' sp-grid-zero' : '') + '" x1="' + v.x + '" y1="' + (-gy) + '" x2="' + (v.x + v.w) + '" y2="' + (-gy) + '"/>');
      parts.push('<text class="sp-label" x="' + (v.x + lab * 0.3) + '" y="' + (-gy - lab * 0.3) + '" font-size="' + lab + '">' + fmt(gy, step) + '</text>');
    }
    // cut edges, one path per element
    groups.forEach(function(g, i) {
      var d = [];
      for (var k = 0; k < g.segs.length; k += 4) {
        d.push('M' + g.segs[k].toFixed(3) + ' ' + (-g.segs[k + 1]).toFixed(3) +
               'L' + g.segs[k + 2].toFixed(3) + ' ' + (-g.segs[k + 3]).toFixed(3));
      }
      parts.push('<path class="sp-cut" data-i="' + i + '" stroke="' + strokeColor(g.color) + '" d="' + d.join('') + '"/>');
    });
    // axis point
    var r = Math.max(v.w, v.h) / 120;
    parts.push('<circle class="sp-axis" cx="0" cy="0" r="' + r + '"/>');
    svg.innerHTML = parts.join('');
    var legend = document.getElementById('sectionProfileLegend');
    if (legend) legend.textContent = 'x: m right of axis · y: m above axis · grid ' + fmt(step, step) + ' m';
  }

  // =====================================
  // INTERACTION — wheel zoom, drag pan, hover
  // =====================================

  function wireInteraction(svg) {
    function toModel(evt) {
      var v = BimViewer.sectionProfile.view;
      var rect = svg.getBoundingClientRect();
      // meet-fit: uniform scale, centred
      var s = Math.min(rect.width / v.w, rect.height / v.h);
      var ox = (rect.width - v.w * s) / 2, oy = (rect.height - v.h * s) / 2;
      return {
        x: v.x + (evt.clientX - rect.left - ox) / s,
        y: v.y + v.h - (evt.clientY - rect.top - oy) / s,
        s: s
      };
    }

    svg.addEventListener('wheel', function(e) {
      var sp = BimViewer.sectionProfile;
      if (!sp.view) return;
      e.preventDefault();
      var m = toModel(e);
      var f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      var v = sp.view;
      sp.view = { x: m.x - (m.x - v.x) * f, y: m.y - (m.y - v.y) * f, w: v.w * f, h: v.h * f };
      render(lastGroups);
    }, { passive: false });

    var drag = null;
    svg.addEventListener('pointerdown', function(e) {
      if (!BimViewer.sectionProfile.view) return;
      drag = { x: e.clientX, y: e.clientY, view: Object.assign({}, BimViewer.sectionProfile.view), s: toModel(e).s };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', function(e) {
      if (drag) {
        var v = drag.view;
        BimViewer.sectionProfile.view = {
          x: v.x - (e.clientX - drag.x) / drag.s, y: v.y + (e.clientY - drag.y) / drag.s, w: v.w, h: v.h
        };
        render(lastGroups);
        return;
      }
      var hover = document.getElementById('sectionProfileHover');
      var t = e.target;
      if (hover) {
        var g = t && t.classList && t.classList.contains('sp-cut') ? lastGroups[+t.getAttribute('data-i')] : null;
        hover.textContent = g ? [g.className, g.name].filter(Boolean).join(' · ') : '';
      }
    });
    function end(e) {
      if (drag) { drag = null; try { svg.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ } }
    }
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('dblclick', function() { BimViewer.fitSectionProfile(); });
  }

  // Asset gone → forget its decoded tiles (they can be large)
  var origUnloadAsset = BimViewer.unloadAsset;
  BimViewer.unloadAsset = function(assetId) {
    BimViewer.sectionProfile.assets.delete(String(assetId));
    return origUnloadAsset.apply(this, arguments);
  };

  console.log('Section profile module loaded v1.0');

})();
