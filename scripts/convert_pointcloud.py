#!/opt/py3dtiles/venv/bin/python3
"""
geoBIM.app — Point cloud conversion worker.

Invoked as a detached background process by api/pointcloud-upload.php (one
process per upload). Runs `py3dtiles convert` on a staged LAS/LAZ/E57/PLY file
(LAZ and E57 are pre-converted to LAS first — see the two branches in
main() for why; PLY needs no pre-conversion, py3dtiles reads it natively
same as LAS — but only if `plyfile` is installed in this venv; py3dtiles
doesn't declare it as a hard dependency, so a fresh `py3dtiles[las]` install
lacks it and every .ply upload fails with "support not found for files" in
convert.log, exit code 1. `/opt/py3dtiles/venv/bin/pip install plyfile` fixes
it — hit and fixed once already, 2026-09-06), then — if the caller supplied
a position — patches the resulting tileset.json's
root.transform to place it at that real-world position (composing with
py3dtiles' own local recentering, not replacing it), matching exactly what
core.js's _loadGLBPointCloudAsTileset() does client-side for GLB point
clouds, and what was done manually for model/hotel_tiled/ earlier.

Concurrent jobs serialize via flock() on a shared lockfile — this server also
runs live Apache/pm2/Docker traffic, so only one conversion (CPU/RAM heavy)
runs at a time regardless of how many uploads arrive close together.

Usage: convert_pointcloud.py <job_dir>

job_dir must contain job.json:
  {
    "input": "input.las",        # filename inside job_dir
    "slug": "hotel_tiled",       # output folder name under model/ (already
                                  # sanitized/uniqueness-checked by the PHP
                                  # endpoint)
    "lon": 18.737..., "lat": 47.79..., "height": 146.6,  # optional
    "heading": 0                 # optional, defaults to 0
  }

Writes job_dir/status.json: {"status": "queued"|"converting"|"done"|"error", ...}
"""
import sys
import os
import json
import subprocess
import shutil
import fcntl
import math
import time

MODEL_DIR = "/var/www/christoflorenz.de/model"
STAGING_DIR = os.path.join(MODEL_DIR, "_staging")
LOCK_PATH = os.path.join(STAGING_DIR, ".convert.lock")
PY3DTILES = "/opt/py3dtiles/venv/bin/py3dtiles"
# IFC -> 3D Tiles 1.1 (geoBIM Cloud concept, Phase 1): IfcOpenShell-based tiler
# in its own venv, sharing this script's queue/lock and status.json protocol.
IFC_TILER_PY = "/opt/geobim-tiler/venv/bin/python"
IFC_TILER = "/opt/geobim-tiler/geobim_tile.py"
IFC_TILER_MEMORY_GB = "8"
# Leave headroom for live Apache/pm2/Docker traffic on the shared 8-core VPS
# (py3dtiles defaults --jobs to all CPUs).
CONVERT_JOBS = "4"


def write_status(job_dir, status, **extra):
    data = {"status": status, "updated": time.time(), **extra}
    tmp = os.path.join(job_dir, "status.json.tmp")
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, os.path.join(job_dir, "status.json"))


def ecef_heading_transform(lon_deg, lat_deg, height, heading_deg, old_transform):
    """Mirror of core.js's ENU(position,heading) x oldTransform composition —
    same WGS84 math as Cesium.Transforms.headingPitchRollToFixedFrame, and the
    same East/North rotation-by-heading convention already established in
    glb-gizmo.js (heading indicator: local (sin(heading), cos(heading)) in
    East/North — 0=North, clockwise), verified there against the app's own
    heading slider. old_transform is py3dtiles' own 16-element column-major
    transform array (identity rotation + local-recentering translation);
    composing (not replacing) preserves that recentering.
    """
    a = 6378137.0
    f = 1 / 298.257223563
    e2 = 2 * f - f * f

    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    heading = math.radians(heading_deg)
    h = height

    N = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
    X = (N + h) * math.cos(lat) * math.cos(lon)
    Y = (N + h) * math.cos(lat) * math.sin(lon)
    Z = (N * (1 - e2) + h) * math.sin(lat)

    east = (-math.sin(lon), math.cos(lon), 0.0)
    north = (-math.sin(lat) * math.cos(lon), -math.sin(lat) * math.sin(lon), math.cos(lat))
    up = (math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat))

    ch, sh = math.cos(heading), math.sin(heading)
    east_r = tuple(ch * east[i] - sh * north[i] for i in range(3))
    north_r = tuple(sh * east[i] + ch * north[i] for i in range(3))
    up_r = up

    def matvec(v):
        return tuple(east_r[i] * v[0] + north_r[i] * v[1] + up_r[i] * v[2] for i in range(3))

    old_c0 = old_transform[0:3]
    old_c1 = old_transform[4:7]
    old_c2 = old_transform[8:11]
    old_c3 = old_transform[12:15]

    new_c0 = matvec(old_c0)
    new_c1 = matvec(old_c1)
    new_c2 = matvec(old_c2)
    t = matvec(old_c3)
    new_c3 = (X + t[0], Y + t[1], Z + t[2])

    return list(new_c0) + [0] + list(new_c1) + [0] + list(new_c2) + [0] + list(new_c3) + [1]


def convert_e57_to_las(e57_path, las_path):
    """py3dtiles doesn't read E57 at all (only .las/.laz/.xyz/.ply) — pre-convert
    via pye57 (pip-installable, bundles libE57Format, no system package needed).
    E57 files can hold multiple scan stations, each in its own local frame;
    pye57's read_scan(transform=True) applies each scan's pose to the file's
    global reference frame for us, so multi-scan files merge correctly instead
    of overlapping at the origin — verified against a synthetic 2-scan file
    before wiring this in for real. Falls back to intensity-derived grayscale
    when a scan carries no RGB (E57s often have one or the other, sometimes
    both — Union_Station.e57 test file has both)."""
    import pye57
    import numpy as np
    import laspy

    e57 = pye57.E57(e57_path)
    xs, ys, zs, rs, gs, bs, ints = [], [], [], [], [], [], []
    for i in range(e57.scan_count):
        fields = set(e57.get_header(i).point_fields)
        has_color = {"colorRed", "colorGreen", "colorBlue"} <= fields
        has_intensity = "intensity" in fields
        d = e57.read_scan(i, colors=has_color, intensity=has_intensity,
                           transform=True, ignore_missing_fields=True)
        xs.append(d["cartesianX"]); ys.append(d["cartesianY"]); zs.append(d["cartesianZ"])
        n = len(d["cartesianX"])

        # Normalize into the LAS uint16 0..65535 intensity range (E57 has no
        # fixed intensity scale across sensors, so per-scan min/max is the best
        # we can do) — carried through to the output LAS's own "intensity"
        # dimension below, not just used as a grayscale color fallback like
        # before. Without this, --extra-fields intensity (see main(), below)
        # picks up nothing for E57 uploads and pointcloud.js's Intensity color
        # mode (`color() * (intensity/65535)`) renders the whole cloud solid
        # black — every point multiplied by a missing field's implicit 0.
        # Scans with no intensity at all default to 65535 ("full") rather than
        # 0 ("none") for the same reason: 0 there means black, not "no data".
        if has_intensity:
            inten = d["intensity"].astype(np.float64)
            lo, hi = inten.min(), inten.max()
            norm_intensity = (((inten - lo) / (hi - lo)) * 65535).astype(np.uint16) if hi > lo \
                else np.zeros(n, dtype=np.uint16)
        else:
            norm_intensity = np.full(n, 65535, dtype=np.uint16)
        ints.append(norm_intensity)

        if has_color:
            rs.append(d["colorRed"].astype(np.uint16) * 257)  # 8-bit -> 16-bit range
            gs.append(d["colorGreen"].astype(np.uint16) * 257)
            bs.append(d["colorBlue"].astype(np.uint16) * 257)
        elif has_intensity:
            rs.append(norm_intensity); gs.append(norm_intensity); bs.append(norm_intensity)
        else:
            gray = np.full(n, 32768, dtype=np.uint16)
            rs.append(gray); gs.append(gray); bs.append(gray)
    e57.close()

    x = np.concatenate(xs); y = np.concatenate(ys); z = np.concatenate(zs)
    r = np.concatenate(rs); g = np.concatenate(gs); b = np.concatenate(bs)
    intensity = np.concatenate(ints)

    header = laspy.LasHeader(point_format=laspy.PointFormat(3), version="1.2")
    header.offsets = [float(x.min()), float(y.min()), float(z.min())]
    header.scales = [0.001, 0.001, 0.001]
    las = laspy.LasData(header)
    las.x = x; las.y = y; las.z = z
    las.red = r; las.green = g; las.blue = b
    las.intensity = intensity
    las.write(las_path)


def patch_root_transform(tileset_path, lon, lat, height, heading):
    with open(tileset_path) as f:
        ts = json.load(f)
    old_transform = ts["root"].get(
        "transform", [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    )
    ts["root"]["transform"] = ecef_heading_transform(lon, lat, height, heading, old_transform)
    with open(tileset_path, "w") as f:
        json.dump(ts, f)


# ---------------------------------------------------------------------------
# Georeferenced LAS/LAZ
# ---------------------------------------------------------------------------
# Survey point clouds (drone, MLS, TLS registered to control points) usually
# carry real map coordinates — in Germany ETRS89 / UTM 32N (EPSG:25832) with
# NHN (DHHN2016) heights. Treated as local coordinates those land either inside
# the Earth (no manual position) or thousands of km off (UTM offset composed
# onto the manual position). For those, py3dtiles reprojects straight to ECEF
# (--srs_out 4978), which is what Cesium renders natively — no manual
# placement. py3dtiles treats the input Z as ellipsoidal height, so NHN heights
# end up ~45-50 m too low; lift_to_ellipsoid() fixes that with the GCG2016
# geoid grid (de_bkg_gcg2016.tif in pyproj's data dir).

# Plausible ranges for German UTM coordinates when the header has no CRS.
_UTM32_E = (250_000, 950_000)
_UTM32_N = (5_200_000, 6_150_000)
DHHN2016 = 7837  # EPSG code of the DHHN2016 (NHN) height system


def detect_crs(las_path, job):
    """Return (pyproj.CRS | None, from_header: bool, warning | None)."""
    import laspy
    import pyproj
    with laspy.open(las_path) as f:
        header = f.header
        try:
            crs = header.parse_crs()
        except Exception:
            crs = None
        if crs is not None:
            return crs, True, None
        if job.get("epsg"):
            return pyproj.CRS.from_epsg(int(job["epsg"])), False, None
        (x0, y0, _), (x1, y1, _) = header.mins, header.maxs
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    if _UTM32_E[0] <= cx <= _UTM32_E[1] and _UTM32_N[0] <= cy <= _UTM32_N[1]:
        return pyproj.CRS.from_epsg(25832), False, \
            "No CRS in LAS header - assumed ETRS89 / UTM 32N (EPSG:25832)"
    if 32_000_000 + _UTM32_E[0] <= cx <= 32_000_000 + _UTM32_E[1] and _UTM32_N[0] <= cy <= _UTM32_N[1]:
        return pyproj.CRS.from_epsg(4647), False, \
            "No CRS in LAS header - assumed ETRS89 / UTM 32N with zone prefix (EPSG:4647)"
    return None, False, None


def has_vertical_datum(crs):
    return crs.is_compound or any(
        getattr(sub, "is_vertical", False) for sub in (crs.sub_crs_list or [])
    )


def geoid_undulation(las_path, crs):
    """GCG2016 undulation N (m) at the cloud centre, or None when it can't be
    determined (outside Germany, grid missing, CRS without an EPSG code)."""
    import laspy
    import pyproj
    epsg = crs.to_epsg()
    if epsg is None:
        return None
    with laspy.open(las_path) as f:
        (x0, y0, z0), (x1, y1, z1) = f.header.mins, f.header.maxs
    cx, cy, cz = (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2
    try:
        t = pyproj.Transformer.from_crs(f"EPSG:{epsg}+{DHHN2016}", "EPSG:4937", always_xy=True)
        lon, lat, h = t.transform(cx, cy, cz)
    except Exception:
        return None
    n = h - cz
    # Without the grid PROJ falls back to a "ballpark" transform that leaves
    # the height unchanged — treat that as "unknown", never as N = 0.
    if not math.isfinite(n) or abs(n) < 1.0:
        return None
    return n


def lift_to_ellipsoid(tileset_path, n):
    """Raise the ECEF tileset by the geoid undulation n along the ellipsoid
    normal at its centre (exact: ECEF -> lon/lat/h -> h + n -> ECEF)."""
    import pyproj
    with open(tileset_path) as f:
        ts = json.load(f)
    t = ts["root"]["transform"]
    to_geo = pyproj.Transformer.from_crs(4978, 4979, always_xy=True)
    to_ecef = pyproj.Transformer.from_crs(4979, 4978, always_xy=True)
    lon, lat, h = to_geo.transform(t[12], t[13], t[14])
    t[12], t[13], t[14] = to_ecef.transform(lon, lat, h + n)
    with open(tileset_path, "w") as f:
        json.dump(ts, f)


def convert_ifc(job, job_dir, input_path, out_dir, final_dir, slug):
    """IFC upload: run the geobim tiler. Its placement comes from the file's
    own georeferencing (IfcMapConversion / IfcSite); the upload position is
    only a fallback for files without any. The tiler writes live progress
    into status.json; a single broken element never fails the job (it is
    listed in report.json instead)."""
    cmd = [
        "nice", "-n", "10", "ionice", "-c", "2", "-n", "4",
        IFC_TILER_PY, IFC_TILER, input_path,
        "--out", out_dir,
        "--name", job.get("name") or slug,
        "--status-file", os.path.join(job_dir, "status.json"),
        "--memory-gb", IFC_TILER_MEMORY_GB,
    ]
    if job.get("lon") is not None and job.get("lat") is not None:
        height = float(job.get("height") or 0)
        # The upload dialog's view-centre fallback can yield nonsense heights
        # (observed: -13 km); never place a model kilometres off the ground.
        if not -500 <= height <= 9000:
            height = 0.0
        cmd += ["--fallback-lonlat", f"{float(job['lon'])},{float(job['lat'])}",
                "--fallback-height", str(height)]
    with open(os.path.join(job_dir, "convert.log"), "w") as log:
        result = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT,
                                env=dict(os.environ, PYTHONUNBUFFERED="1"))
    if result.returncode != 0:
        msg = "memory limit exceeded" if result.returncode == 3 else f"exit code {result.returncode}"
        write_status(job_dir, "error", message=f"IFC tiler failed ({msg}) - see convert.log")
        return
    report = {}
    try:
        with open(os.path.join(out_dir, "report.json")) as f:
            report = json.load(f)
    except Exception:
        pass
    if os.path.isdir(final_dir):
        shutil.rmtree(final_dir)
    shutil.move(out_dir, final_dir)
    # Keep the source IFC (not web-reachable: model/_staging is denied via
    # .htaccess) so a model can be re-tiled after tiler fixes without asking
    # for a new upload — the geoBIM Cloud concept keeps sources anyway.
    if os.path.isfile(input_path):
        os.replace(input_path, os.path.join(job_dir, "source.ifc"))
    done = {"tileset": f"model/{slug}/tileset.json",
            "placement": (report.get("placement") or {}).get("source")}
    notes = list(report.get("warnings") or [])
    if report.get("without_geometry"):
        notes.append(f"{report['without_geometry']} of {report['elements']} elements without geometry (see report.json)")
    if notes:
        done["warning"] = "; ".join(notes)
    write_status(job_dir, "done", **done)


def main():
    if len(sys.argv) != 2:
        print("usage: convert_pointcloud.py <job_dir>", file=sys.stderr)
        sys.exit(1)

    job_dir = sys.argv[1]
    job_path = os.path.join(job_dir, "job.json")
    with open(job_path) as f:
        job = json.load(f)

    input_path = os.path.join(job_dir, job["input"])
    slug = job["slug"]
    out_dir = os.path.join(job_dir, "out")
    final_dir = os.path.join(MODEL_DIR, slug)

    write_status(job_dir, "queued")

    os.makedirs(STAGING_DIR, exist_ok=True)
    lock_fp = open(LOCK_PATH, "w")
    fcntl.flock(lock_fp, fcntl.LOCK_EX)  # blocks here until any prior job finishes
    try:
        write_status(job_dir, "converting")

        if input_path.lower().endswith(".ifc"):
            convert_ifc(job, job_dir, input_path, out_dir, final_dir, slug)
            return

        # py3dtiles only reads .las/.laz/.xyz/.ply — anything else gets
        # pre-converted to .las ourselves before handing it off.
        original_input_path = input_path
        if input_path.lower().endswith(".laz"):
            # py3dtiles' own .laz reading path is pathologically slow/hangs —
            # verified directly: a 2.2M-point .laz that never finished in 90s
            # (with --disable-processpool and -v, still zero output) converted
            # the identical points as plain .las in 7.9s. lazrs/laspy
            # decompression itself is fast (confirmed separately), so the fix
            # is to decompress ourselves first and hand py3dtiles an
            # uncompressed .las it's actually fast with.
            las_path = os.path.splitext(input_path)[0] + ".las"
            import laspy
            # Chunked, not laspy.read(): decompressing a multi-GB .laz in one
            # go needs several times its size in RAM on a shared server.
            with laspy.open(input_path) as reader, laspy.open(
                las_path, mode="w", header=reader.header
            ) as writer:
                for points in reader.chunk_iterator(2_000_000):
                    writer.write_points(points)
            input_path = las_path
        elif input_path.lower().endswith(".e57"):
            las_path = os.path.splitext(input_path)[0] + ".las"
            convert_e57_to_las(input_path, las_path)
            input_path = las_path

        # Georeferenced LAS/LAZ (E57/PLY scans are handled as local clouds).
        georef_args = []
        georef = None
        warnings = []
        if input_path.lower().endswith(".las"):
            crs, from_header, warn = detect_crs(input_path, job)
            if warn:
                warnings.append(warn)
            if crs is not None:
                georef_args = ["--srs_out", "4978"]
                if not from_header:
                    georef_args += ["--srs_in", str(crs.to_epsg())]
                georef = crs
                if warnings:
                    write_status(job_dir, "converting", warning="; ".join(warnings))

        log_path = os.path.join(job_dir, "convert.log")
        # numba (py3dtiles' JIT compiler) caches compiled functions next to its own
        # source files under the venv by default — those are root-owned (the venv
        # was installed as root), unwritable by www-data (the php-fpm/worker user).
        # Redirect its cache to a directory www-data actually owns. PYTHONUNBUFFERED
        # so convert.log actually shows progress while running instead of staying
        # empty until exit (Python fully block-buffers stdout once it's not a tty).
        env = dict(os.environ, NUMBA_CACHE_DIR="/opt/py3dtiles/numba_cache", PYTHONUNBUFFERED="1")
        with open(log_path, "w") as log:
            result = subprocess.run(
                [
                    # "best effort" I/O (class 2, mid priority) rather than "idle"
                    # (class 3) — idle starved the job to a crawl behind ordinary
                    # traffic in testing (a 28MB LAZ took >20 minutes and had to be
                    # killed). Still throttled relative to live traffic (nice 10,
                    # --jobs 4 of 8), just no longer effectively paused by it.
                    "nice", "-n", "10", "ionice", "-c", "2", "-n", "4",
                    PY3DTILES, "convert", input_path,
                    "--out", out_dir,
                    "--overwrite",
                    "--jobs", CONVERT_JOBS,
                    # Carry LAS intensity/classification into the tileset's batch
                    # table so pointcloud.js's Intensity/Classification color modes
                    # have something to read (previously always empty — see
                    # pointcloud.js applyColorMode). --extra-fields is `action="append"`
                    # in py3dtiles' own argparse setup, so it's repeated per field, not
                    # space-separated in one occurrence. Field names must be the exact
                    # (lowercase) laspy dimension name — py3dtiles writes the batch
                    # table property key verbatim from what's passed here.
                    # "intensity" exists on every LAS point format. "classification"
                    # only exists as its own field on LAS 1.4 point formats 6-10; on
                    # older point formats (0-5 — still common, and what this script's
                    # own convert_e57_to_las() above produces) it's packed into a
                    # bit-field instead, so py3dtiles just logs a warning in
                    # convert.log and omits the property for those files rather than
                    # failing the conversion (verified in point_tiler.py).
                    "--extra-fields", "intensity",
                    "--extra-fields", "classification",
                    *georef_args,
                ],
                stdout=log, stderr=subprocess.STDOUT, env=env,
            )

        if result.returncode != 0:
            write_status(job_dir, "error", message=f"py3dtiles exited with code {result.returncode} — see convert.log")
            return

        tileset_path = os.path.join(out_dir, "tileset.json")
        if not os.path.isfile(tileset_path):
            write_status(job_dir, "error", message="Conversion finished but tileset.json is missing")
            return

        if georef is not None:
            # Already in ECEF at its real position. Horizontal-only CRS: py3dtiles
            # took Z as ellipsoidal, but German survey heights are NHN.
            if not has_vertical_datum(georef):
                n = geoid_undulation(input_path, georef)
                if n is not None:
                    lift_to_ellipsoid(tileset_path, n)
                else:
                    warnings.append("Heights not geoid-corrected (outside GCG2016 coverage or grid missing)")
            if job.get("lon") is not None:
                warnings.append("File is georeferenced - manual position ignored")
            if warnings:
                write_status(job_dir, "converting", warning="; ".join(warnings))
        elif job.get("lon") is not None and job.get("lat") is not None:
            try:
                patch_root_transform(
                    tileset_path,
                    float(job["lon"]), float(job["lat"]),
                    float(job.get("height", 0)), float(job.get("heading", 0)),
                )
            except Exception as e:
                # Positioning is best-effort — a broken patch shouldn't lose an
                # otherwise-good conversion; it just needs manual gizmo placement.
                write_status(job_dir, "converting", warning=f"Position patch failed: {e}")

        if os.path.isdir(final_dir):
            shutil.rmtree(final_dir)
        shutil.move(out_dir, final_dir)

        # Raw upload no longer needed once tiled — the staging dir itself
        # (job.json/status.json/log) stays for status polling and debugging.
        # Two files if the input was .laz (original + the decompressed .las
        # py3dtiles actually converted — see above).
        for p in {original_input_path, input_path}:
            if os.path.isfile(p):
                os.remove(p)

        done = {"tileset": f"model/{slug}/tileset.json"}
        if georef is not None:
            done["crs"] = georef.to_string()
        if warnings:
            done["warning"] = "; ".join(warnings)
        write_status(job_dir, "done", **done)

    except Exception as e:
        write_status(job_dir, "error", message=str(e))
    finally:
        fcntl.flock(lock_fp, fcntl.LOCK_UN)
        lock_fp.close()


if __name__ == "__main__":
    main()
