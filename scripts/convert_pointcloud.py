#!/opt/py3dtiles/venv/bin/python3
"""
geoBIM.app — Point cloud conversion worker.

Invoked as a detached background process by api/pointcloud-upload.php (one
process per upload). Runs `py3dtiles convert` on a staged LAS/LAZ/E57 file
(LAZ and E57 are pre-converted to LAS first — see the two branches in
main() for why), then — if the caller supplied a position — patches the
resulting tileset.json's
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
    xs, ys, zs, rs, gs, bs = [], [], [], [], [], []
    for i in range(e57.scan_count):
        fields = set(e57.get_header(i).point_fields)
        has_color = {"colorRed", "colorGreen", "colorBlue"} <= fields
        has_intensity = "intensity" in fields
        d = e57.read_scan(i, colors=has_color, intensity=has_intensity,
                           transform=True, ignore_missing_fields=True)
        xs.append(d["cartesianX"]); ys.append(d["cartesianY"]); zs.append(d["cartesianZ"])
        if has_color:
            rs.append(d["colorRed"].astype(np.uint16) * 257)  # 8-bit -> 16-bit range
            gs.append(d["colorGreen"].astype(np.uint16) * 257)
            bs.append(d["colorBlue"].astype(np.uint16) * 257)
        elif has_intensity:
            inten = d["intensity"].astype(np.float64)
            lo, hi = inten.min(), inten.max()
            gray = (((inten - lo) / (hi - lo)) * 65535).astype(np.uint16) if hi > lo \
                else np.zeros(len(inten), dtype=np.uint16)
            rs.append(gray); gs.append(gray); bs.append(gray)
        else:
            gray = np.full(len(d["cartesianX"]), 32768, dtype=np.uint16)
            rs.append(gray); gs.append(gray); bs.append(gray)
    e57.close()

    x = np.concatenate(xs); y = np.concatenate(ys); z = np.concatenate(zs)
    r = np.concatenate(rs); g = np.concatenate(gs); b = np.concatenate(bs)

    header = laspy.LasHeader(point_format=laspy.PointFormat(3), version="1.2")
    header.offsets = [float(x.min()), float(y.min()), float(z.min())]
    header.scales = [0.001, 0.001, 0.001]
    las = laspy.LasData(header)
    las.x = x; las.y = y; las.z = z
    las.red = r; las.green = g; las.blue = b
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
            laspy.read(input_path).write(las_path)
            input_path = las_path
        elif input_path.lower().endswith(".e57"):
            las_path = os.path.splitext(input_path)[0] + ".las"
            convert_e57_to_las(input_path, las_path)
            input_path = las_path

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

        if job.get("lon") is not None and job.get("lat") is not None:
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

        write_status(job_dir, "done", tileset=f"model/{slug}/tileset.json")

    except Exception as e:
        write_status(job_dir, "error", message=str(e))
    finally:
        fcntl.flock(lock_fp, fcntl.LOCK_UN)
        lock_fp.close()


if __name__ == "__main__":
    main()
