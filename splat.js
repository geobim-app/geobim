// ============================================================
// Splat — 3D Gaussian Splatting loader module for geobim.app
//
// Copyright (c) 2026 geobim.app
// Licensed under the Business Source License 1.1 (BSL 1.1)
// Change Date: 2030-03-01 | Change License: MIT
// See LICENSE file for full terms.
//
// Loads 3D Gaussian Splat reconstructions as native Cesium 3D Tiles
// (glTF KHR_gaussian_splatting extension). CesiumJS >= 1.135 decodes
// splats internally via GaussianSplatPrimitive — no custom renderer.
//
// Splats are kept in their OWN registry (BimViewer.splat.instances),
// NOT in loadedAssets, so the IFC/Revit filters, IBL, lighting,
// PBR shaders, env-maps and performance presets never touch them —
// those systems iterate loadedAssets and would break splat rendering.
//
// Notable: the lighting monitor (lighting.js) scans ALL scene
// primitives every 2s and applies imageBasedLighting + style toggles.
// On a splat primitive that breaks the display ("briefly visible,
// then gone"). We register every splat tileset in
// lighting.monitoredTilesets so the monitor skips it.
//
// Source: from URL (self-hosted tileset.json) or Cesium Ion asset id.
// Tuning: maximumScreenSpaceError ~8–24, per-instance height offset
// (along ellipsoid normal) and ENU-local orientation fix.
//
// Tested with CesiumJS 1.141
// ============================================================

(function(BimViewer) {
  'use strict';

  var DEFAULT_SSE = 16;
  var DEMO_URL = 'https://bertt.github.io/3DGS-3DTiles-demo/tileset-data/tileset.json';

  // Lazy state init — no explicit init call needed in the boot sequence
  function state() {
    if (!BimViewer.splat) {
      BimViewer.splat = { instances: new Map(), _counter: 0 };
    }
    return BimViewer.splat;
  }

  function viewer() {
    return BimViewer.viewer;
  }

  // Keep the lighting monitor away from a splat tileset. The monitor
  // skips any primitive already present in monitoredTilesets, so we
  // mark splats as "already handled" without ever lighting them.
  function shieldFromLighting(tileset) {
    var set = BimViewer.lighting && BimViewer.lighting.monitoredTilesets;
    if (set && typeof set.add === 'function') set.add(tileset);
  }

  // Stable ECEF reference point for the surface normal / cartographic.
  // Prefer the baseline transform translation (the georef origin — always
  // available immediately), fall back to the bounding-sphere center only
  // if the tileset has no real transform (origin ≈ earth center).
  function originOf(inst) {
    var o = Cesium.Matrix4.getTranslation(inst.baseline, new Cesium.Cartesian3());
    if (Cesium.Cartesian3.magnitude(o) > 1.0) return o;
    if (inst.tileset && inst.tileset.boundingSphere) return inst.tileset.boundingSphere.center;
    return o;
  }

  // Recompute root.transform from the stored baseline so height and
  // orientation are non-cumulative (re-applying replaces, not stacks).
  //  - orientation: ENU-local rotation, post-multiplied onto baseline
  //  - height: shift along the ellipsoid surface normal, world-space
  function applyTransform(inst) {
    var t = inst.tileset;
    if (!t || !t.root || !inst.baseline) return;

    var m = Cesium.Matrix4.clone(inst.baseline, new Cesium.Matrix4());

    var o = inst.orientation;
    if (o && (o.x || o.y || o.z)) {
      var rot = Cesium.Matrix3.clone(Cesium.Matrix3.IDENTITY, new Cesium.Matrix3());
      if (o.x) Cesium.Matrix3.multiply(rot, Cesium.Matrix3.fromRotationX(Cesium.Math.toRadians(o.x)), rot);
      if (o.y) Cesium.Matrix3.multiply(rot, Cesium.Matrix3.fromRotationY(Cesium.Math.toRadians(o.y)), rot);
      if (o.z) Cesium.Matrix3.multiply(rot, Cesium.Matrix3.fromRotationZ(Cesium.Math.toRadians(o.z)), rot);
      Cesium.Matrix4.multiplyByMatrix3(m, rot, m);
    }

    if (inst.heightM) {
      var origin = originOf(inst);
      var normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(origin, new Cesium.Cartesian3());
      if (normal) {
        var offset = Cesium.Cartesian3.multiplyByScalar(normal, inst.heightM, new Cesium.Cartesian3());
        var tMat = Cesium.Matrix4.fromTranslation(offset, new Cesium.Matrix4());
        Cesium.Matrix4.multiply(tMat, m, m);
      }
    }

    t.root.transform = m;
    if (viewer()) viewer().scene.requestRender();
  }

  // ---- Public API ------------------------------------------------

  // Load a splat tileset.
  // opts: {
  //   id?, name?,
  //   url?           string  tileset.json URL (self-hosted)
  //   ionAssetId?    number  Cesium Ion asset id
  //   sse?           number  maximumScreenSpaceError (default 16)
  //   heightM?       number  vertical offset along ellipsoid normal
  //   orientation?   {x,y,z} degrees, ENU-local rotation fix
  //   show?          bool    initial visibility (default true)
  //   flyTo?         bool    fly camera to the tileset (default true)
  // }
  BimViewer.loadSplat = async function(opts) {
    opts = opts || {};
    var s = state();
    var v = viewer();
    if (!v) { console.warn('[splat] viewer not ready'); return null; }
    if (!opts.url && opts.ionAssetId == null) {
      console.warn('[splat] need either opts.url or opts.ionAssetId');
      return null;
    }

    var id = opts.id || ('splat_' + (++s._counter));
    if (s.instances.has(id)) {
      console.warn('[splat] id already loaded:', id);
      return s.instances.get(id);
    }

    s.lastError = null;
    var tileset;
    try {
      var tilesetOpts = { maximumScreenSpaceError: opts.sse != null ? opts.sse : DEFAULT_SSE };
      if (opts.ionAssetId != null) {
        var resource = await Cesium.IonResource.fromAssetId(opts.ionAssetId);
        tileset = await Cesium.Cesium3DTileset.fromUrl(resource, tilesetOpts);
      } else {
        tileset = await Cesium.Cesium3DTileset.fromUrl(opts.url, tilesetOpts);
      }
    } catch (err) {
      // Self-hosted sources commonly fail on CORS / 404 / non-tileset URLs.
      var msg = (err && (err.message || err.toString())) || 'Unbekannter Fehler';
      if (/Failed to fetch|NetworkError|CORS/i.test(msg)) {
        msg = 'Netzwerk/CORS-Fehler — Server muss Access-Control-Allow-Origin senden';
      } else if (/404|Not Found/i.test(msg)) {
        msg = 'tileset.json nicht gefunden (404) — URL prüfen';
      }
      s.lastError = msg;
      console.error('[splat] failed to load:', err);
      return null;
    }

    // Deliberately NOT applied to splats (would break / no effect):
    //   enableTilesetLighting, configureDynamicEnvMaps, applyIBLToTileset,
    //   applySettingsToTileset (performance presets), PBR custom shaders.
    v.scene.primitives.add(tileset);
    shieldFromLighting(tileset);

    if (opts.show === false) tileset.show = false;

    var inst = {
      id: id,
      name: opts.name || id,
      tileset: tileset,
      source: opts.ionAssetId != null ? ('ion:' + opts.ionAssetId) : opts.url,
      type: 'SPLAT',
      baseline: Cesium.Matrix4.clone(tileset.root.transform, new Cesium.Matrix4()),
      heightM: opts.heightM || 0,
      orientation: opts.orientation ? { x: opts.orientation.x || 0, y: opts.orientation.y || 0, z: opts.orientation.z || 0 }
                                    : { x: 0, y: 0, z: 0 },
      sse: tileset.maximumScreenSpaceError
    };
    s.instances.set(id, inst);

    if (inst.heightM || inst.orientation.x || inst.orientation.y || inst.orientation.z) {
      applyTransform(inst);
    }

    console.log('✨ Splat loaded:', id, '(' + inst.source + ')');

    if (opts.clampToTerrain) {
      await BimViewer.clampSplatToTerrain(id, opts.heightM || 0);
    }

    if (window.BimSplat && BimSplat.refresh) BimSplat.refresh();

    if (opts.flyTo !== false) {
      try { await v.flyTo(tileset, { duration: 1.5 }); } catch (e) { /* user may interrupt */ }
    }
    return inst;
  };

  BimViewer.removeSplat = function(id) {
    var s = state();
    var inst = s.instances.get(id);
    if (!inst) return false;
    try { viewer().scene.primitives.remove(inst.tileset); } catch (e) { /* already gone */ }
    s.instances.delete(id);
    console.log('🗑️ Splat removed:', id);
    if (window.BimSplat && BimSplat.refresh) BimSplat.refresh();
    return true;
  };

  BimViewer.setSplatVisible = function(id, visible) {
    var inst = state().instances.get(id);
    if (!inst) return;
    inst.tileset.show = !!visible;
    if (viewer()) viewer().scene.requestRender();
  };

  BimViewer.setSplatSSE = function(id, sse) {
    var inst = state().instances.get(id);
    if (!inst) return;
    inst.sse = sse;
    inst.tileset.maximumScreenSpaceError = sse;
    if (viewer()) viewer().scene.requestRender();
  };

  // Vertical offset in meters along the ellipsoid normal (non-cumulative).
  BimViewer.setSplatHeight = function(id, meters) {
    var inst = state().instances.get(id);
    if (!inst) return;
    inst.heightM = meters;
    applyTransform(inst);
  };

  // Orientation fix in degrees (ENU-local). Pass {x,y,z}; omitted axes keep current.
  BimViewer.setSplatOrientation = function(id, deg) {
    var inst = state().instances.get(id);
    if (!inst || !deg) return;
    if (deg.x != null) inst.orientation.x = deg.x;
    if (deg.y != null) inst.orientation.y = deg.y;
    if (deg.z != null) inst.orientation.z = deg.z;
    applyTransform(inst);
  };

  // Lift the splat so its origin sits on the terrain surface. Needed
  // when the source data is georeferenced to ELLIPSOID height (e.g.
  // ~1 m) but geobim renders World Terrain — in NL the terrain sits at
  // ~43 m ellipsoidal (EGM96 geoid undulation), so the splat would be
  // buried. Samples the most-detailed terrain at the splat location and
  // sets a non-cumulative height offset. extraM nudges on top.
  BimViewer.clampSplatToTerrain = async function(id, extraM) {
    var inst = state().instances.get(id);
    var v = viewer();
    if (!inst || !v) return;
    // Reference the georef ORIGIN (transform translation), not the
    // bounding sphere — the latter may be coarse/not-ready at load time.
    var origin = originOf(inst);
    var carto = Cesium.Cartographic.fromCartesian(origin);
    var sample = Cesium.Cartographic.fromRadians(carto.longitude, carto.latitude);
    try {
      var res = await Cesium.sampleTerrainMostDetailed(v.terrainProvider, [sample]);
      var terrainH = res[0].height;
      // Map the georef origin height onto the terrain height. extraM lifts
      // on top (e.g. when the origin sits at the object's mid-height rather
      // than its base, nudge by ~half the object height).
      inst.heightM = (terrainH - carto.height) + (extraM || 0);
      applyTransform(inst);
      console.log('[splat] clamped', id, '→ heightM ' + inst.heightM.toFixed(2) +
        'm (origin ' + carto.height.toFixed(2) + 'm → terrain ' + terrainH.toFixed(2) + 'm, extra ' + (extraM || 0) + 'm)');
    } catch (e) {
      console.warn('[splat] terrain sample failed:', e);
    }
    return inst.heightM;
  };

  BimViewer.flyToSplat = function(id) {
    var inst = state().instances.get(id);
    if (inst && viewer()) viewer().flyTo(inst.tileset, { duration: 1.5 });
  };

  BimViewer.listSplats = function() {
    var out = [];
    state().instances.forEach(function(inst) {
      out.push({ id: inst.id, name: inst.name, source: inst.source,
                 sse: inst.sse, heightM: inst.heightM, orientation: inst.orientation,
                 visible: inst.tileset.show });
    });
    console.table(out);
    return out;
  };

  // Convenience: load the public Wilhelmina demo splat (no Ion needed).
  BimViewer.loadSplatDemo = function() {
    // heightM is passed to the terrain clamp as the extra nudge. The
    // Wilhelmina georef origin sits at the object's mid-height (~1 m half),
    // so +1 m lifts the base onto the terrain. Fine-tune via the slider.
    return BimViewer.loadSplat({ id: 'demo', name: 'Wilhelmina (demo)', url: DEMO_URL, sse: 8, clampToTerrain: true, heightM: 1.0 });
  };

})(window.BimViewer = window.BimViewer || {});
