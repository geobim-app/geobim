#!/opt/py3dtiles/venv/bin/python3
"""
geoBIM.app — unpack one tileset sent by the photo reconstruction worker.

Called by api/recon-worker.php (action=result) for each part (mesh, point
cloud, splats) of a recon job. The ZIP comes from geobim_recon_worker.py on
the GPU PC; it is still checked like any upload:

  - entries must be relative paths inside the target (no "..", no absolute or
    drive paths, no symlinks) and of a tileset file type;
  - at most MAX_FILES entries and MAX_BYTES uncompressed;
  - tileset.json at the top level.

Unpacked next to the ZIP, then renamed to <target> (never replaces an
existing folder). <target>/.recon-job holds the job id, so a retry of the same
job may replace its own earlier result (see recon-worker.php).

Tilesets without a root.transform (reconstruction without GPS) are placed at
--lonlat/--height (the upload position or the centre of the view), east-north-up
like scripts/convert_pointcloud.py's ecef_heading_transform with heading 0.

Usage: recon_unpack.py <zip> <target> --job <jobId> [--lonlat LON,LAT --height H]
Prints one JSON line: {"files", "bytes", "type", "placed"}.
"""
import argparse
import json
import math
import os
import shutil
import stat
import sys
import zipfile

ALLOWED_EXT = {".json", ".glb", ".gltf", ".b3dm", ".pnts", ".i3dm", ".cmpt", ".subtree", ".bin",
               ".png", ".jpg", ".jpeg", ".webp", ".ktx2"}
MAX_FILES = 200_000
MAX_BYTES = 30 * 1024 ** 3


def enu_transform(lon_deg, lat_deg, height):
    """Column-major 4x4: local east-north-up at lon/lat/height (WGS84) -> ECEF."""
    a, f = 6378137.0, 1 / 298.257223563
    e2 = 2 * f - f * f
    lat, lon = math.radians(lat_deg), math.radians(lon_deg)
    n = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
    x = (n + height) * math.cos(lat) * math.cos(lon)
    y = (n + height) * math.cos(lat) * math.sin(lon)
    z = (n * (1 - e2) + height) * math.sin(lat)
    east = [-math.sin(lon), math.cos(lon), 0.0]
    north = [-math.sin(lat) * math.cos(lon), -math.sin(lat) * math.sin(lon), math.cos(lat)]
    up = [math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)]
    return east + [0.0] + north + [0.0] + up + [0.0] + [x, y, z, 1.0]


def safe_name(name):
    """The entry's relative path, or None if it must not be extracted."""
    if not name or "\\" in name or name.startswith("/") or ":" in name:
        return None
    parts = name.split("/")
    if any(p in ("", ".", "..") for p in parts[:-1]) or parts[-1] in (".", ".."):
        return None
    return name


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("zip")
    ap.add_argument("target")
    ap.add_argument("--job", required=True)
    ap.add_argument("--lonlat")
    ap.add_argument("--height", type=float, default=0.0)
    args = ap.parse_args()

    target = os.path.abspath(args.target)
    if os.path.exists(target):
        raise SystemExit(f"{os.path.basename(target)} already exists")
    # Unpacked next to the ZIP (model/_staging/<job>/), not as model/<x>.partial: api/models.php lists every
    # model/*/tileset.json and would show a half-written folder
    partial = os.path.join(os.path.dirname(os.path.abspath(args.zip)), "unpack_" + os.path.basename(target))
    shutil.rmtree(partial, ignore_errors=True)

    try:
        with zipfile.ZipFile(args.zip) as z:
            infos = [i for i in z.infolist() if not i.is_dir()]
            if len(infos) > MAX_FILES:
                raise SystemExit(f"too many files ({len(infos)})")
            if sum(i.file_size for i in infos) > MAX_BYTES:
                raise SystemExit("too large uncompressed")
            names = set()
            for info in infos:
                name = safe_name(info.filename)
                if name is None:
                    raise SystemExit(f"refused path: {info.filename[:100]}")
                if stat.S_ISLNK(info.external_attr >> 16):
                    raise SystemExit(f"refused symlink: {name[:100]}")
                if os.path.splitext(name)[1].lower() not in ALLOWED_EXT:
                    raise SystemExit(f"refused file type: {name[:100]}")
                names.add(name)
            if "tileset.json" not in names:
                raise SystemExit("no tileset.json at the top level")
            os.makedirs(partial)
            for info in infos:
                dest = os.path.join(partial, *info.filename.split("/"))
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with z.open(info) as src, open(dest, "wb") as out:
                    shutil.copyfileobj(src, out, 1024 * 1024)
    except zipfile.BadZipFile as e:
        raise SystemExit(f"not a ZIP: {e}")

    tileset_path = os.path.join(partial, "tileset.json")
    try:
        with open(tileset_path, encoding="utf-8") as f:
            tileset = json.load(f)
        root = tileset["root"]
    except Exception as e:
        shutil.rmtree(partial, ignore_errors=True)
        raise SystemExit(f"tileset.json unreadable: {e}")

    placed = False
    if not root.get("transform") and args.lonlat:
        lon, lat = (float(v) for v in args.lonlat.split(","))
        root["transform"] = enu_transform(lon, lat, args.height)
        extras = tileset.setdefault("asset", {}).setdefault("extras", {})
        extras["placement"] = {"source": "upload position (reconstruction without GPS)",
                               "lon": lon, "lat": lat, "height": args.height}
        with open(tileset_path, "w", encoding="utf-8") as f:
            json.dump(tileset, f)
        placed = True

    with open(os.path.join(partial, ".recon-job"), "w", encoding="utf-8") as f:
        f.write(args.job)
    os.rename(partial, target)
    print(json.dumps({"files": len(infos), "bytes": sum(i.file_size for i in infos),
                      "type": (tileset.get("asset", {}).get("extras") or {}).get("type"), "placed": placed}))


if __name__ == "__main__":
    try:
        main()
    except SystemExit as e:
        if isinstance(e.code, str):
            print(f"ERROR: {e.code}", file=sys.stderr)
            sys.exit(1)
        raise
