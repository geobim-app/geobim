/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// ===============================
// SITE EARTHWORKS v1.1
// Closed cut and fill bodies of a grading (site-analysis.js) and their
// export as IFC 4.3 (IfcEarthworksCut / IfcEarthworksFill), together with
// the final ground of the project area as one closed body
// (IfcGeographicElement TERRAIN, see buildTerrain).
//
// Geometry: the grading grid (cell centres) as two triangles per square.
// Each triangle is clipped against the unclamped slope cones (see pieces):
// the cut part (T ≥ cut cone) gets T on top and the cone below, the fill part
// the fill cone on top and T below. On the clip line both coincide, so top
// and bottom share their vertices there and the body closes without a wall —
// the line is the same smooth intersection the dashed slope edge shows. Terrace groups split each part
// again at the line of equal distance to two terraces, so every terrace gets
// its own bodies; walls close them where they meet. Volumes are checked
// against the grid volumes of the grading.
//
// IFC: IFC4X3_ADD2, one IfcSite with the bodies and the existing ground
// (IfcGeotechnicalStratum, voided by every cut), coordinates in the UTM zone of the site
// (ETRS89 in Europe) with IfcMapConversion and an offset origin, heights as
// in the grading (orthometric for Mapterhorn). Quantities in
// Qto_EarthworksCutBaseQuantities / Qto_EarthworksFillBaseQuantities.
// Button: the IFC icon in the grading row (site-analysis.js).
// ===============================
'use strict';

(function() {

  var ZERO = 1e-6;              // |top − bottom| below this: one shared vertex
  var KEY_DIGITS = 4;           // vertex welding (0.1 mm)

  function sa() { return window.BimViewer && BimViewer.siteAnalysis; }
  function g() { return sa() && sa()._grading; }

  // ---- Geometry ----

  // Grid vertex: position, existing ground T, signed distance s to the
  // nearest planum outline (< 0 inside) and that planum's level P, lowest cut
  // cone C and highest fill cone F (inside a planum continued linearly below
  // and above P, so both meet P on the outline), distances d to the terraces
  // (group) and the terrain-body value e. Outside the planums graded
  // R = min(max(T, F), C), inside R = P.
  function lerp(a, b, t) {
    var v = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, T: a.T + (b.T - a.T) * t,
              s: a.s + (b.s - a.s) * t, P: a.P + (b.P - a.P) * t,
              C: a.C + (b.C - a.C) * t, F: a.F + (b.F - a.F) * t, d: null };
    if (a.d) { v.d = a.d.map(function(da, m) { return da + (b.d[m] - da) * t; }); }
    if (a.e !== undefined) v.e = a.e + (b.e - a.e) * t;
    // On the planum outline both cones are the planum (the linear inside
    // continuation and the outside cone differ there by rounding only)
    if (Math.abs(v.s) < 1e-7) { v.s = 0; v.C = v.F = v.P; }
    return v;
  }

  // Sutherland–Hodgman against value(v) ≥ 0 (convex polygon in, convex out)
  function clip(poly, value) {
    var out = [], n = poly.length;
    for (var i = 0; i < n; i++) {
      var a = poly[i], b = poly[(i + 1) % n], va = value(a), vb = value(b);
      if (va >= 0) out.push(a);
      if ((va >= 0) !== (vb >= 0) && va !== vb) out.push(lerp(a, b, va / (va - vb)));
    }
    return out;
  }

  function hT(v) { return v.T; }
  function hC(v) { return v.C; }
  function hF(v) { return v.F; }
  function hP(v) { return v.P; }

  // A grid triangle split where the grading changes: first at the planum
  // outline (s = 0; inside cut where T ≥ P, fill where T ≤ P, graded P), then
  // outside into cut (T ≥ C, graded C), fill (T ≤ F ≤ C, graded F; or F > C
  // and T ≤ C, graded C) and unchanged (graded T). s, T − C and F − T are
  // linear in the triangle, so the planum edge and the slope edge run
  // straight through it (the outline itself, the intersection of slope and
  // terrain), not from grid point to grid point — R is clamped to T and the
  // planum ends at the last grid point inside, so clips at T = R or d = 0
  // would follow the cells: the sawtooth edge.
  function pieces(tri) {
    var io = split(tri, function(v) { return -v.s; }), out = [];
    if (io[0].length >= 3) {
      var pl = split(io[0], function(v) { return v.T - v.P; });
      if (pl[0].length >= 3) out.push({ kind: 'cut', poly: pl[0], R: hP });
      if (pl[1].length >= 3) out.push({ kind: 'fill', poly: pl[1], R: hP });
    }
    if (io[1].length >= 3) outside(io[1], out);
    return out;
  }

  function outside(tri, out) {
    var cr = split(tri, function(v) { return v.T - v.C; });
    if (cr[0].length >= 3) out.push({ kind: 'cut', poly: cr[0], R: hC });
    if (cr[1].length < 3) return out;
    var lc = split(cr[1], function(v) { return v.C - v.F; });
    if (lc[0].length >= 3) {
      var fk = split(lc[0], function(v) { return v.F - v.T; });
      if (fk[0].length >= 3) out.push({ kind: 'fill', poly: fk[0], R: hF });
      if (fk[1].length >= 3) out.push({ kind: 'keep', poly: fk[1], R: hT });
    }
    if (lc[1].length >= 3) out.push({ kind: 'fill', poly: lc[1], R: hC });
    return out;
  }

  // poly into [value ≥ 0, value ≤ 0]; a polygon lying on the line (value 0
  // at every corner, e.g. a planum where C = F) goes to one side only
  function split(poly, value) {
    var pos = false, neg = false;
    poly.forEach(function(v) { var x = value(v); if (x > 0) pos = true; else if (x < 0) neg = true; });
    if (!neg) return [poly, []];
    if (!pos) return [[], poly];
    return [clip(poly, value), clip(poly, function(v) { return -value(v); })];
  }

  function area2(poly) {
    var s = 0;
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length];
      s += a.x * b.y - b.x * a.y;
    }
    return s;
  }

  // Signed distance to the boundary between terrace m and its nearest other
  // terrace (≥ 0 where m is the nearest)
  function ownerValue(m) {
    return function(v) {
      var other = Infinity;
      for (var n = 0; n < v.d.length; n++) if (n !== m && v.d[n] < other) other = v.d[n];
      return other - v.d[m];
    };
  }

  function newBody(kind, owner) {
    return { kind: kind, owner: owner, verts: [], keys: {}, pairs: {}, tris: [], volume: 0, area: 0, maxDepth: 0, open: 0 };
  }

  // Vertex id on the top or bottom surface; where both coincide (the slope
  // edge) one id serves both, so the body closes there without a wall
  function vid(body, v, side, shared, z) {
    var key = (shared ? 's' : side) + v.x.toFixed(KEY_DIGITS) + ',' + v.y.toFixed(KEY_DIGITS);
    var id = body.keys[key];
    if (id !== undefined) return id;
    id = body.verts.length;
    body.verts.push([v.x, v.y, z]);
    body.keys[key] = id;
    return id;
  }

  function pushTri(body, a, b, c) {
    if (a === b || b === c || a === c) return;
    body.tris.push(a, b, c);
  }

  // Convex polygon as top (height top(v)) and bottom (bot(v)) faces
  function addPolygon(body, poly, top, bot) {
    if (poly.length < 3) return;
    if (area2(poly) < 0) poly = poly.slice().reverse();
    if (Math.abs(area2(poly)) < 1e-10) return;
    var tp = [], bt = [];
    poly.forEach(function(v) {
      var zt = top(v), zb = bot(v), shared = Math.abs(zt - zb) < ZERO;
      tp.push(vid(body, v, 't', shared, shared ? (zt + zb) / 2 : zt));
      bt.push(vid(body, v, 'b', shared, shared ? (zt + zb) / 2 : zb));
    });
    for (var i = 1; i < poly.length - 1; i++) {
      pushTri(body, tp[0], tp[i], tp[i + 1]);       // counter-clockwise from above: faces up
      pushTri(body, bt[0], bt[i + 1], bt[i]);       // reversed: faces down
    }
    for (i = 0; i < poly.length; i++) body.pairs[tp[i]] = bt[i];
  }

  // Walls where a top edge has no partner (band edge, border between two
  // terraces): quad down to the bottom surface, outward facing
  function closeBody(body) {
    var dir = {}, i, e, a, b;
    function key(p, q) { return p + '>' + q; }
    var isTop = {};
    for (i = 0; i < body.tris.length; i += 3) {
      for (e = 0; e < 3; e++) {
        a = body.tris[i + e]; b = body.tris[i + (e + 1) % 3];
        dir[key(a, b)] = (dir[key(a, b)] || 0) + 1;
      }
    }
    Object.keys(body.pairs).forEach(function(t) { isTop[t] = true; });
    var n = body.tris.length;
    for (i = 0; i < n; i += 3) {
      for (e = 0; e < 3; e++) {
        a = body.tris[i + e]; b = body.tris[i + (e + 1) % 3];
        if (dir[key(b, a)]) continue;
        if (!isTop[a] || !isTop[b]) continue;          // a bottom edge: its wall comes from the top edge
        var ba = body.pairs[a], bb = body.pairs[b];
        if (ba === a && bb === b) continue;
        pushTri(body, a, ba, bb);
        pushTri(body, a, bb, b);
        dir[key(b, a)] = 1;
      }
    }
    // Check: every directed edge exactly once, and its reverse exactly once
    var count = {};
    for (i = 0; i < body.tris.length; i += 3) {
      for (e = 0; e < 3; e++) {
        a = body.tris[i + e]; b = body.tris[i + (e + 1) % 3];
        count[key(a, b)] = (count[key(a, b)] || 0) + 1;
      }
    }
    var open = 0;
    Object.keys(count).forEach(function(k) {
      var p = k.split('>');
      if (count[k] !== 1 || count[p[1] + '>' + p[0]] !== 1) open++;
    });
    body.open = open;
  }

  function measure(body) {
    var V = body.verts, vol = 0, area = 0, zMin = Infinity, zMax = -Infinity;
    var o = V.length ? V[0] : [0, 0, 0];
    for (var i = 0; i < body.tris.length; i += 3) {
      var p = V[body.tris[i]], q = V[body.tris[i + 1]], r = V[body.tris[i + 2]];
      var ax = p[0] - o[0], ay = p[1] - o[1], az = p[2] - o[2];
      var bx = q[0] - o[0], by = q[1] - o[1], bz = q[2] - o[2];
      var cx = r[0] - o[0], cy = r[1] - o[1], cz = r[2] - o[2];
      vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
      var ux = bx - ax, uy = by - ay, uz = bz - az, wx = cx - ax, wy = cy - ay, wz = cz - az;
      area += Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
    }
    V.forEach(function(v) { zMin = Math.min(zMin, v[2]); zMax = Math.max(zMax, v[2]); });
    body.volume = vol;
    body.area = area;
    body.zMin = zMin; body.zMax = zMax;
  }

  function inRing(x, y, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // Signed distance to the outline of a ring, < 0 inside
  function signedDist(x, y, pts) {
    var m = Infinity;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var ax = pts[j][0], ay = pts[j][1], dx = pts[i][0] - ax, dy = pts[i][1] - ay, l2 = dx * dx + dy * dy;
      var t = l2 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      m = Math.min(m, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
    return inRing(x, y, pts) ? -m : m;
  }

  // The planum (site-analysis.js unit.planums) with the smallest signed distance
  function nearestPlanum(planums, x, y) {
    var best = { s: Infinity, planum: planums[0] };
    planums.forEach(function(p) {
      var s = signedDist(x, y, p.ring);
      if (s < best.s) best = { s: s, planum: p };
    });
    return best;
  }

  // Grid vertex k of a grading unit (cached)
  function vertexSource(G, u, group, extra) {
    var gg = u.gg, nx = gg.nx, cache = new Array(gg.T.length);
    return function(k) {
      if (cache[k]) return cache[k];
      var i = k % nx, j = (k - i) / nx, cf = u.cones(k), x = G.cellX(gg, i), y = G.cellY(gg, j);
      var near = nearestPlanum(u.planums, x, y), pl = near.planum, P = pl.level(x, y);
      var v = { x: x, y: y, T: gg.T[k], s: near.s, P: P, C: cf[0], F: cf[1], d: null };
      if (near.s < 0) { v.C = P + near.s / pl.nC; v.F = P - near.s / pl.nF; }
      if (group) v.d = gg.D.map(function(D) { var d = D[k]; return d <= gg.W ? d : 1e9; });
      if (extra) extra(v, k);
      return (cache[k] = v);
    };
  }

  // Cut and fill bodies of a grading unit (site-analysis.js gradingUnit)
  function buildBodies(site) {
    var G = g(), u = G.unit(site), gg = u.gg, nx = gg.nx, ny = gg.ny;
    var group = !!(u.extras && u.extras.terraces);
    var M = group ? u.extras.terraces.length : 1;
    var names = group ? u.extras.terraces.map(function(t) { return t.site; }) : [u.site.name];
    var mask = G.meshMask(u);
    var vert = vertexSource(G, u, group);
    var bodies = { cut: [], fill: [] };
    for (var m = 0; m < M; m++) { bodies.cut.push(newBody('cut', m)); bodies.fill.push(newBody('fill', m)); }
    var owners = [];
    for (m = 0; m < M; m++) owners.push(ownerValue(m));

    function addPiece(pc) {
      if (pc.kind === 'keep') return;
      var top = pc.kind === 'cut' ? hT : pc.R, bot = pc.kind === 'cut' ? pc.R : hT;
      for (var mm = 0; mm < M; mm++) {
        var own = M > 1 ? clip(pc.poly, owners[mm]) : pc.poly;
        if (own.length >= 3) addPolygon(bodies[pc.kind][mm], own, top, bot);
      }
    }
    for (var j = 0; j < ny - 1; j++) {
      for (var i = 0; i < nx - 1; i++) {
        var a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        if (!mask[a] || !mask[b] || !mask[c] || !mask[d]) continue;
        pieces([vert(a), vert(c), vert(b)]).forEach(addPiece);
        pieces([vert(b), vert(c), vert(d)]).forEach(addPiece);
      }
    }
    var out = [];
    ['cut', 'fill'].forEach(function(kind) {
      bodies[kind].forEach(function(body) {
        if (!body.tris.length) return;
        closeBody(body);
        measure(body);
        if (body.volume < 0.05) return;            // below 0.05 m³: not a body worth exporting
        body.name = names[body.owner] + ' – ' + (kind === 'cut' ? 'Abtrag' : 'Auftrag');
        body.site = names[body.owner];
        body.maxDepth = body.zMax - body.zMin;
        out.push(body);
      });
    });
    var terrain = buildTerrain(G, u, group);
    return { unit: u, bodies: out, terrain: terrain, group: group, names: names };
  }

  // The graded landform of the whole project area as one closed body: the
  // final ground on top (planums, slopes and the untouched ground between
  // and around them, split as in pieces so the slope edges match the cut and
  // fill bodies), sides on a smooth offset of the planum outlines — the
  // widest slope plus TERRAIN_MARGIN —, flat base a full metre at least 1 m
  // below the lowest point.
  var TERRAIN_MARGIN = 2;     // m beyond the widest slope

  function buildTerrain(G, u, group) {
    var gg = u.gg, nx = gg.nx, ny = gg.ny, n = gg.T.length;
    var minD = new Float32Array(n).fill(Infinity), R = new Float32Array(n), ok = new Uint8Array(n);
    var reach = 0, zLow = Infinity;
    for (var k = 0; k < n; k++) {
      if (!u.inBand(k)) continue;
      ok[k] = 1;
      R[k] = u.R(k);
      if (group) { for (var m = 0; m < gg.D.length; m++) if (gg.D[m][k] < minD[k]) minD[k] = gg.D[m][k]; }
      else minD[k] = gg.D[k];
      if (Math.abs(gg.T[k] - R[k]) > G.CUT_EPS) reach = Math.max(reach, minD[k]);
    }
    var W = Math.min(reach + TERRAIN_MARGIN, gg.W - 2 * gg.cell);
    if (!(W > 0)) return null;
    for (k = 0; k < n; k++) if (ok[k] && minD[k] <= W + gg.cell) zLow = Math.min(zLow, R[k]);
    var body = newBody('terrain', 0);
    body.base = Math.floor(zLow - 1);
    body.margin = W;
    var vert = vertexSource(G, u, false, function(v, k) { v.e = W - minD[k]; });
    function inside(v) { return v.e; }
    function base() { return body.base; }
    function addLand(tri) {
      var land = clip(tri, inside);
      if (land.length >= 3) pieces(land).forEach(function(pc) { addPolygon(body, pc.poly, pc.R, base); });
    }
    for (var j = 0; j < ny - 1; j++) {
      for (var i = 0; i < nx - 1; i++) {
        var a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        if (!ok[a] || !ok[b] || !ok[c] || !ok[d]) continue;
        if (W - minD[a] < 0 && W - minD[b] < 0 && W - minD[c] < 0 && W - minD[d] < 0) continue;
        addLand([vert(a), vert(c), vert(b)]);
        addLand([vert(b), vert(c), vert(d)]);
      }
    }
    if (!body.tris.length) return null;
    closeBody(body);
    measure(body);
    body.name = (group ? 'Terrassen ' + u.extras.terraces.map(function(t) { return t.site; }).join(', ') : u.site.name) + ' – Geländekörper Endzustand';
    body.maxDepth = body.zMax - body.base;
    return body;
  }

  // ---- IFC (STEP physical file) ----

  var B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

  function guid() {
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
    // 128 bits → 22 characters: 2 bits first, then 21 × 6 bits
    var bits = '';
    bytes.forEach(function(x) { bits += ('00000000' + x.toString(2)).slice(-8); });
    var out = B64[parseInt(bits.slice(0, 2), 2)];
    for (var i = 2; i < 128; i += 6) out += B64[parseInt(bits.slice(i, i + 6), 2)];
    return out;
  }

  // STEP string: ISO 10303-21 escapes for ' \ and non-ASCII (\X2\…\X0\)
  function str(s) {
    if (s === null || s === undefined) return '$';
    var out = '';
    String(s).split('').forEach(function(ch) {
      var c = ch.charCodeAt(0);
      if (ch === "'") out += "''";
      else if (ch === '\\') out += '\\\\';
      else if (c < 32 || c > 126) out += '\\X2\\' + ('0000' + c.toString(16).toUpperCase()).slice(-4) + '\\X0\\';
      else out += ch;
    });
    return "'" + out + "'";
  }

  function real(x, digits) {
    var s = Number(x).toFixed(digits === undefined ? 6 : digits);
    if (s.indexOf('.') === -1) s += '.';
    s = s.replace(/0+$/, '');
    if (s.charAt(s.length - 1) === '.') s += '0';
    return s === '-0.0' ? '0.0' : s;
  }

  function Writer() { this.lines = []; }
  Writer.prototype.add = function(entity, args) {
    var id = this.lines.length + 1;
    this.lines.push('#' + id + '=' + entity + '(' + args.join(',') + ');');
    return '#' + id;
  };
  function list(a) { return '(' + a.join(',') + ')'; }

  // IfcCompoundPlaneAngleMeasure: degrees, minutes, seconds, millionths
  function dms(deg) {
    var s = deg < 0 ? -1 : 1, a = Math.abs(deg), d = Math.floor(a), mf = (a - d) * 60, m = Math.floor(mf);
    var sf = (mf - m) * 60, sec = Math.floor(sf), mic = Math.round((sf - sec) * 1e6);
    if (mic === 1e6) { mic = 0; sec += 1; }
    return list([s * d, s * m, s * sec, s * mic].map(String));
  }

  async function buildIfc(result) {
    var G = g(), u = result.unit, site = u.site;
    var proj = await G.utm(site);
    var o = proj.en(0, 0), E0 = Math.round(o[0]), N0 = Math.round(o[1]);
    var w = new Writer();
    var P0 = w.add('IFCCARTESIANPOINT', [list(['0.', '0.', '0.'])]);
    var origin = w.add('IFCAXIS2PLACEMENT3D', [P0, '$', '$']);
    var north = w.add('IFCDIRECTION', [list(['0.', '1.'])]);
    var ctx = w.add('IFCGEOMETRICREPRESENTATIONCONTEXT', ['$', "'Model'", '3', '1.0E-05', origin, north]);
    var bodyCtx = w.add('IFCGEOMETRICREPRESENTATIONSUBCONTEXT', ["'Body'", "'Model'", '*', '*', '*', '*', ctx, '$', '.MODEL_VIEW.', '$']);
    var units = [
      w.add('IFCSIUNIT', ['*', '.LENGTHUNIT.', '$', '.METRE.']),
      w.add('IFCSIUNIT', ['*', '.AREAUNIT.', '$', '.SQUARE_METRE.']),
      w.add('IFCSIUNIT', ['*', '.VOLUMEUNIT.', '$', '.CUBIC_METRE.']),
      w.add('IFCSIUNIT', ['*', '.PLANEANGLEUNIT.', '$', '.RADIAN.'])
    ];
    var ua = w.add('IFCUNITASSIGNMENT', [list(units)]);
    var project = w.add('IFCPROJECT', [str(guid()), '$', str(site.name + ' – Erdbau'), str('Grading aus geoBIM.app Site Analysis'), '$', '$', '$', list([ctx]), ua]);
    var crs = w.add('IFCPROJECTEDCRS', [str('EPSG:' + proj.info.epsg), str(proj.name), str(proj.info.datum), str(site.grid.datum),
                                        str('UTM'), str(String(proj.info.zone) + (proj.info.south ? 'S' : 'N')), units[0]]);
    w.add('IFCMAPCONVERSION', [ctx, crs, real(E0, 3), real(N0, 3), '0.0', '1.0', '0.0', '1.0']);

    var sitePlacement = w.add('IFCLOCALPLACEMENT', ['$', origin]);
    var ifcSite = w.add('IFCSITE', [str(guid()), '$', str(site.name), str(u.desc), '$', sitePlacement, '$', '$', '.ELEMENT.',
                                    dms(site.frame.lat0), dms(site.frame.lon0), real(u.t, 3), '$', '$']);
    w.add('IFCRELAGGREGATES', [str(guid()), '$', '$', '$', project, list([ifcSite])]);

    var pal = G.palette(), styles = {};
    ['cut', 'fill'].forEach(function(kind) {
      var c = pal[kind];
      var colour = w.add('IFCCOLOURRGB', ['$', real(c[0] / 255, 4), real(c[1] / 255, 4), real(c[2] / 255, 4)]);
      var shading = w.add('IFCSURFACESTYLESHADING', [colour, '0.25']);
      styles[kind] = w.add('IFCSURFACESTYLE', [str(kind === 'cut' ? 'Abtrag' : 'Auftrag'), '.BOTH.', list([shading])]);
    });
    var pc = G.rgb(G.cssVar('--sa-planum', '#b9b2a3'));
    styles.terrain = w.add('IFCSURFACESTYLE', [str('Geplantes Gelände'), '.BOTH.', list([
      w.add('IFCSURFACESTYLESHADING', [w.add('IFCCOLOURRGB', ['$', real(pc[0] / 255, 4), real(pc[1] / 255, 4), real(pc[2] / 255, 4)]), '0.0'])])]);

    // Closed triangulated body in project coordinates (UTM minus E0 / N0)
    function shapeOf(b) {
      var coords = b.verts.map(function(v) {
        var en = proj.en(v[0], v[1]);
        return '(' + real(en[0] - E0, 4) + ',' + real(en[1] - N0, 4) + ',' + real(v[2], 4) + ')';
      });
      var idx = [];
      for (var t = 0; t < b.tris.length; t += 3) idx.push('(' + (b.tris[t] + 1) + ',' + (b.tris[t + 1] + 1) + ',' + (b.tris[t + 2] + 1) + ')');
      var pts = w.add('IFCCARTESIANPOINTLIST3D', ['(' + coords.join(',') + ')', '$']);
      var fs = w.add('IFCTRIANGULATEDFACESET', [pts, '$', b.open ? '.F.' : '.T.', '(' + idx.join(',') + ')', '$']);
      w.add('IFCSTYLEDITEM', [fs, list([styles[b.kind]]), '$']);
      var rep = w.add('IFCSHAPEREPRESENTATION', [bodyCtx, "'Body'", "'Tessellation'", list([fs])]);
      return w.add('IFCPRODUCTDEFINITIONSHAPE', ['$', '$', list([rep])]);
    }

    function geometryQto(el, b) {
      var geo = w.add('IFCELEMENTQUANTITY', [str(guid()), '$', "'Qto_BodyGeometryValidation'", '$', '$', list([
        w.add('IFCQUANTITYAREA', ["'GrossSurfaceArea'", '$', '$', real(b.area, 3), '$']),
        w.add('IFCQUANTITYVOLUME', ["'GrossVolume'", '$', '$', real(b.volume, 3), '$']),
        w.add('IFCQUANTITYCOUNT', ["'SurfaceGenusBeforeFeatures'", '$', '$', '0', '$'])])]);
      w.add('IFCRELDEFINESBYPROPERTIES', [str(guid()), '$', '$', '$', list([el]), geo]);
    }

    // A cut is a subtraction (IfcFeatureElementSubtraction): it voids the
    // existing ground, here one stratum without own geometry
    var ground = null, elements = [];
    if (result.bodies.some(function(b) { return b.kind === 'cut'; })) {
      ground = w.add('IFCGEOTECHNICALSTRATUM', [str(guid()), '$', str('Gewachsener Boden (Bestand)'),
        str('Bestandsgelände ' + site.grid.source + ', vom Abtrag ausgehöhlt'), '$', sitePlacement, '$', '$', '.SOLID.']);
      elements.push(ground);
    }

    // The graded landform: planums and slopes on top, cut out of the terrain
    // along the slope edge, closed on a flat base
    var tb = result.terrain;
    if (tb) {
      var terrainEl = w.add('IFCGEOGRAPHICELEMENT', [str(guid()), '$', str(tb.name),
        str('Geplantes Gelände (Endzustand): ' + u.desc + '; Projektfläche = Planien mit Böschungen plus ' + TERRAIN_MARGIN +
            ' m Rand (bis ' + tb.margin.toFixed(1) + ' m vom Planumrand), dazwischen unverändertes Gelände; Unterseite eben auf ' +
            tb.base.toFixed(1) + ' m; Höhen ' + site.grid.datum),
        '$', w.add('IFCLOCALPLACEMENT', [sitePlacement, origin]), shapeOf(tb), '$', '.TERRAIN.']);
      elements.push(terrainEl);
      geometryQto(terrainEl, tb);
    }
    result.bodies.forEach(function(b) {
      var shape = shapeOf(b);
      var place = w.add('IFCLOCALPLACEMENT', [sitePlacement, origin]);
      var cut = b.kind === 'cut';
      var desc = (cut ? 'Abtrag' : 'Auftrag') + ' aus Grading, Böschungen bis zum Schnitt mit dem Gelände; Höhen ' + site.grid.datum;
      var el = w.add(cut ? 'IFCEARTHWORKSCUT' : 'IFCEARTHWORKSFILL',
                     [str(guid()), '$', str(b.name), str(desc), '$', place, shape, '$', cut ? '.CUT.' : '.EMBANKMENT.']);
      // A feature sits in the structure only through the element it voids
      if (cut) w.add('IFCRELVOIDSELEMENT', [str(guid()), '$', '$', '$', ground, el]);
      else elements.push(el);
      var vol = real(b.volume, 3);
      var base = w.add('IFCELEMENTQUANTITY', [str(guid()), '$', str(cut ? 'Qto_EarthworksCutBaseQuantities' : 'Qto_EarthworksFillBaseQuantities'), '$',
        str('geoBIM.app grading, closed body'), list([
          w.add('IFCQUANTITYVOLUME', [str(cut ? 'UndisturbedVolume' : 'CompactedVolume'), '$', '$', vol, '$']),
          w.add('IFCQUANTITYLENGTH', ["'Depth'", '$', '$', real(b.maxDepth, 3), '$'])])]);
      w.add('IFCRELDEFINESBYPROPERTIES', [str(guid()), '$', '$', '$', list([el]), base]);
      geometryQto(el, b);
    });
    w.add('IFCRELCONTAINEDINSPATIALSTRUCTURE', [str(guid()), '$', '$', '$', list(elements), ifcSite]);

    var header = [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');",
      'FILE_NAME(' + str(G.fileBase(site) + '-earthworks.ifc') + ",'" + new Date().toISOString().slice(0, 19) + "',(''),(''),'geoBIM.app','geoBIM.app site analysis','');",
      "FILE_SCHEMA(('IFC4X3_ADD2'));",
      'ENDSEC;',
      'DATA;'
    ];
    return header.concat(w.lines, ['ENDSEC;', 'END-ISO-10303-21;']).join('\n') + '\n';
  }

  async function exportIfc(site) {
    var G = g();
    if (!G) throw new Error('Site analysis is not loaded');
    if (!site.grading || !site.grading.result) return null;
    G.status('Building earthworks bodies…', '');
    var res = buildBodies(site);
    if (!res.bodies.length) { G.status('No cut or fill to export', 'error'); return res; }
    var text = await buildIfc(res);
    var u = res.unit, cut = 0, fill = 0, open = 0;
    res.bodies.forEach(function(b) { if (b.kind === 'cut') cut += b.volume; else fill += b.volume; open += b.open; });
    if (res.terrain) open += res.terrain.open;
    G.download(G.fileBase(u.site) + '-earthworks.ifc', text, 'application/x-step');
    G.status('IFC 4.3: ' + (res.terrain ? 'graded landform ' + G.num(res.terrain.volume) + ' m³ above ' + res.terrain.base + ' m, ' : '') +
      res.bodies.length + ' cut/fill bodies, cut ' + G.num(cut) + ' m³, fill ' + G.num(fill) + ' m³ (grid ' + G.num(u.cut) + ' / ' + G.num(u.fill) + ' m³)' +
      (open ? ', ' + open + ' open edges' : ''), open ? 'error' : 'ok');
    return res;
  }

  BimViewer.siteEarthworks = {
    buildBodies: buildBodies,
    buildIfc: buildIfc,
    exportIfc: exportIfc
  };

  console.log('Site earthworks module loaded v1.1');

})();
