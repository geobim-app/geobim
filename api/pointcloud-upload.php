<?php
// geoBIM.app — Point cloud upload endpoint.
// Accepts a LAS/LAZ/E57/PLY file (+ optional lon/lat/height/heading), stages it under
// model/_staging/<jobId>/, and spawns a detached background worker
// (scripts/convert_pointcloud.py) that runs py3dtiles and — once done — drops
// the tiled result into model/<slug>/, where it's auto-discovered by
// models.php exactly like any other GLB/tileset asset.
//
// Owner only, checked server-side (2026-09-27): the owner session cookie set
// by api/owner-session.php after Firebase sign-in, an ID token, or a Rhino
// plugin token (api/_plugin_tokens.php).
//
// Optional "replace=<slug>" (IFC and GLB, used by the Rhino plugin): the new
// result replaces model/<slug>/ (or model/<slug>.glb) instead of getting a new
// one, so the viewer link stays the same while the model is being worked on.
//
// GLB (binary glTF 2.0) needs no conversion: it is stored as model/<slug>.glb
// right away, and lon/lat/height/heading — if sent — become its saved placement
// in model/placements.json (the entry api/placement-save.php writes; height =
// ellipsoidal WGS84 height in metres, as the viewer uses it — or send
// height_datum=orthometric for a height above sea level). The response and
// api/pointcloud-status.php look like a finished job, so the upload UI and the
// Rhino plugin need no special case.
header('Content-Type: application/json');
require __DIR__ . '/_owner_auth.php';
$user = geobim_require_owner(['plugin' => true]);   // session cookie, ID token or Rhino plugin token

// Deliberately modest while usage is low-volume/single-user — flock()-serialized
// conversion in convert_pointcloud.py already prevents concurrent jobs from
// overloading the server, this cap is about not tying up the queue for a long
// time or eating disk space on one huge upload. Raise later based on real
// usage. Keep in sync with api/.user.ini's upload_max_filesize.
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024 * 1024;

function fail($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['error' => $message]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail('POST only', 405);
}

if (!isset($_FILES['file'])) {
    // post_max_size exceeded empties $_FILES/$_POST entirely rather than
    // reporting a per-file error — Content-Length is the only signal left.
    $contentLength = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($contentLength > MAX_UPLOAD_BYTES) {
        fail('File too large — 3 GB limit');
    }
    fail('Upload failed (no file received)');
}
if ($_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    $err = $_FILES['file']['error'];
    if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) {
        fail('File too large — 3 GB limit');
    }
    fail('Upload failed (error code ' . $err . ')');
}
if ($_FILES['file']['size'] > MAX_UPLOAD_BYTES) {
    fail('File too large — 3 GB limit');
}

$origName = $_FILES['file']['name'];
$ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
if (!in_array($ext, ['las', 'laz', 'e57', 'ply', 'ifc', 'glb'], true)) {
    fail('Only .las/.laz/.e57/.ply/.ifc/.glb files are supported');
}
$isGlb = $ext === 'glb';
if ($isGlb) {
    // Binary glTF 2.0: magic "glTF", version 2, declared length = file size
    $head = @file_get_contents($_FILES['file']['tmp_name'], false, null, 0, 12);
    $hdr = ($head !== false && strlen($head) === 12) ? unpack('a4magic/Vversion/Vlength', $head) : null;
    if (!$hdr || $hdr['magic'] !== 'glTF' || $hdr['version'] !== 2 || $hdr['length'] !== (int)$_FILES['file']['size']) {
        fail('Not a valid binary glTF 2.0 file (.glb)');
    }
}

$name = trim($_POST['name'] ?? pathinfo($origName, PATHINFO_FILENAME));
if ($name === '') {
    fail('Missing name');
}
$baseSlug = trim(preg_replace('/[^a-z0-9]+/', '_', strtolower($name)), '_');
if ($baseSlug === '') {
    fail('Name must contain at least one letter or digit');
}
// GLB: the file name is the model id in api/models.php, so no "_tiled" suffix
$slug = $isGlb ? $baseSlug : $baseSlug . '_tiled';

$modelDir = __DIR__ . '/../model';
// A model id is taken by a tileset folder or a GLB file of that name
function geobim_slug_taken($modelDir, $slug) {
    return is_dir($modelDir . '/' . $slug) || is_file($modelDir . '/' . $slug . '.glb');
}
// Avoid clobbering an existing asset folder — same convention as models.php's
// id generation, just with a numeric suffix appended on collision. Slugs of
// jobs still queued or converting count as taken too: their folder doesn't
// exist yet, and the converter refuses to replace one that does.
function geobim_slug_pending($modelDir, $slug) {
    foreach (glob($modelDir . '/_staging/*/job.json') ?: [] as $jobFile) {
        $job = json_decode(@file_get_contents($jobFile) ?: '', true);
        if (!is_array($job) || ($job['slug'] ?? null) !== $slug) continue;
        $st = json_decode(@file_get_contents(dirname($jobFile) . '/status.json') ?: '', true);
        if (in_array($st['status'] ?? 'queued', ['queued', 'converting'], true)) return true;
    }
    return false;
}
$replace = isset($_POST['replace']) ? trim($_POST['replace']) : '';
if ($replace !== '') {
    if ($isGlb) {
        // a GLB replaces a GLB only — the viewer loads the two kinds differently
        if (!preg_match('/^[a-z0-9_]+$/', $replace) || !is_file($modelDir . '/' . $replace . '.glb')) {
            fail('Model to replace not found: ' . $replace, 404);
        }
    } else {
        if (!preg_match('/^[a-z0-9_]+$/', $replace) || !is_file($modelDir . '/' . $replace . '/tileset.json')) {
            fail('Model to replace not found: ' . $replace, 404);
        }
        if ($ext !== 'ifc') {
            fail('Only IFC and GLB models can be replaced');
        }
        if (geobim_slug_pending($modelDir, $replace)) {
            fail('This model is still being converted — try again when it is done', 409);
        }
    }
    $slug = $replace;
} else {
    $i = 2;
    while (geobim_slug_taken($modelDir, $slug) || geobim_slug_pending($modelDir, $slug)) {
        $slug = $baseSlug . ($isGlb ? '_' : '_tiled_') . $i;
        $i++;
    }
}

// Optional real-world placement — parsed leniently, all-or-nothing (need at
// least lon+lat to be useful; height/heading default to 0 in the worker).
$lon = isset($_POST['lon']) && $_POST['lon'] !== '' ? floatval($_POST['lon']) : null;
$lat = isset($_POST['lat']) && $_POST['lat'] !== '' ? floatval($_POST['lat']) : null;
$height = isset($_POST['height']) && $_POST['height'] !== '' ? floatval($_POST['height']) : 0.0;
$heading = isset($_POST['heading']) && $_POST['heading'] !== '' ? floatval($_POST['heading']) : 0.0;
if ($lon === null || $lat === null) {
    $lon = null;
    $lat = null;
}
// 'view' = the client sent the centre of its view because nothing was typed;
// the worker then doesn't warn when a georeferenced file ignores it.
$positionSource = (isset($_POST['position_source']) && $_POST['position_source'] === 'view') ? 'view' : 'manual';

// Optional EPSG code: for LAS/LAZ files whose header carries no CRS (the
// worker reads the header CRS first and guesses German UTM 32N otherwise), and
// for IFC files whose georeferencing names no usable CRS. IFC may add a
// vertical datum: "25832+7837" (UTM 32N + DHHN2016); point clouds use the
// horizontal part.
$epsg = isset($_POST['epsg']) ? preg_replace('/\s+/', '', $_POST['epsg']) : '';
$epsg = preg_replace('/^EPSG:/i', '', $epsg);
if ($epsg !== '' && !preg_match('/^\d{4,6}(\+\d{4,5})?$/', $epsg)) {
    fail('EPSG must be a numeric code, e.g. 25832 or 25832+7837');
}
// Optional IFC reference height: orthometric height (m) of IFC z = 0 (±0.00)
$refHeight = isset($_POST['ref_height']) && trim($_POST['ref_height']) !== '' ? str_replace(',', '.', trim($_POST['ref_height'])) : null;
if ($refHeight !== null) {
    if (!is_numeric($refHeight) || (float)$refHeight < -500 || (float)$refHeight > 9000) {
        fail('Height of ±0.00 must be a number between -500 and 9000 m');
    }
    $refHeight = (float)$refHeight;
}
// Optional IFC height datum: 'ellipsoid' = heights in the file are already
// ellipsoidal (GPS), the tiler then skips the geoid lift; default 'auto'
$heightDatum = isset($_POST['height_datum']) ? trim($_POST['height_datum']) : 'auto';
// GLB: 'orthometric' = height above sea level (e.g. Rhino's EarthAnchorPoint),
// converted here to the ellipsoidal height the viewer uses; default ellipsoidal
if (!in_array($heightDatum, $isGlb ? ['auto', 'ellipsoid', 'orthometric'] : ['auto', 'ellipsoid'], true)) {
    fail($isGlb ? 'Height datum must be ellipsoid or orthometric' : 'Height datum must be auto or ellipsoid');
}
if ($isGlb && $heightDatum === 'orthometric' && $lon !== null) {
    require_once __DIR__ . '/_geoid.php';
    if (is_finite($lat) && is_finite($lon) && abs($lat) <= 90) {
        $height += geobim_geoid_height($lat, $lon);
    }
}

// GLB: no conversion. model/<slug>.glb is replaced atomically (a temporary
// dot name that models.php never lists, then rename), the placement goes into
// model/placements.json under the same lock api/placement-save.php uses, and a
// job folder with status "done" keeps api/pointcloud-status.php working.
function geobim_store_glb($modelDir, $slug, $replace, $lon, $lat, $height, $heading, $user) {
    $placement = null;
    if ($lon !== null) {
        foreach (['lon' => [$lon, -180, 180], 'lat' => [$lat, -90, 90], 'height' => [$height, -1000, 10000], 'heading' => [$heading, -720, 720]] as $k => [$v, $lo, $hi]) {
            if (!is_finite($v) || $v < $lo || $v > $hi) fail("$k out of range");
        }
        $placement = ['lon' => $lon, 'lat' => $lat, 'height' => $height, 'heading' => $heading, 'scale' => 1.0,
                      'source' => 'upload', 'savedAt' => gmdate('c'), 'savedBy' => $user['email'] ?? ''];
    }

    $file = $slug . '.glb';
    $tmp = $modelDir . '/.upload-' . bin2hex(random_bytes(6));
    if (!move_uploaded_file($_FILES['file']['tmp_name'], $tmp)) {
        fail('Could not store uploaded file', 500);
    }
    @chmod($tmp, 0664);
    if (!rename($tmp, $modelDir . '/' . $file)) {
        @unlink($tmp);
        fail('Could not store uploaded file', 500);
    }

    $kept = false;
    $store = $modelDir . '/placements.json';
    $fh = fopen($store, 'c+');
    if ($fh && flock($fh, LOCK_EX)) {
        $all = json_decode(stream_get_contents($fh) ?: '{}', true) ?: [];
        if ($placement !== null) {
            $all[$file] = $placement;
        } elseif ($replace === '') {
            unset($all[$file]);          // a new model must not inherit a stale entry
        } else {
            $kept = isset($all[$file]);  // replace without position: keep the saved one
        }
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, json_encode($all, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        fflush($fh);
        flock($fh, LOCK_UN);
        fclose($fh);
    } elseif ($placement !== null) {
        fail('Stored the model, but could not save its position (placements.json locked)', 500);
    }

    $jobId = $slug . '_' . bin2hex(random_bytes(4));
    $jobDir = $modelDir . '/_staging/' . $jobId;
    $status = ['status' => 'done', 'updated' => time(), 'kind' => 'glb'];
    $status['placement'] = $placement !== null
        ? sprintf('%.6f, %.6f, %.2f m, heading %.1f°', $lat, $lon, $height, $heading)
        : ($kept ? 'saved position kept' : 'none — place it in geoBIM.app and save its position');
    if (@mkdir($jobDir, 0775, true)) {
        file_put_contents($jobDir . '/job.json', json_encode(['input' => $file, 'slug' => $slug, 'name' => $slug, 'kind' => 'glb']));
        file_put_contents($jobDir . '/status.json', json_encode($status));
    }
    echo json_encode(['jobId' => $jobId, 'slug' => $slug, 'replace' => $replace !== '', 'status' => 'done']);
}

if ($isGlb) {
    geobim_store_glb($modelDir, $slug, $replace, $lon, $lat, $height, $heading, $user);
    exit;
}

$jobId = $slug . '_' . bin2hex(random_bytes(4));
$jobDir = $modelDir . '/_staging/' . $jobId;
if (!mkdir($jobDir, 0775, true)) {
    fail('Could not create job directory', 500);
}

$inputName = 'input.' . $ext;
$inputPath = $jobDir . '/' . $inputName;
if (!move_uploaded_file($_FILES['file']['tmp_name'], $inputPath)) {
    fail('Could not store uploaded file', 500);
}

$job = [
    'input' => $inputName,
    'slug' => $slug,
    'name' => $name,
];
if ($replace !== '') {
    $job['replace'] = true;
}
if ($epsg !== '') {
    $job['epsg'] = (int)explode('+', $epsg)[0];
    $job['epsg_full'] = $epsg;
}
if ($refHeight !== null) {
    $job['ref_height'] = $refHeight;
}
if ($heightDatum !== 'auto') {
    $job['height_datum'] = $heightDatum;
}
if ($lon !== null) {
    $job['lon'] = $lon;
    $job['lat'] = $lat;
    $job['height'] = $height;
    $job['heading'] = $heading;
    $job['position_source'] = $positionSource;
}
file_put_contents($jobDir . '/job.json', json_encode($job));
file_put_contents($jobDir . '/status.json', json_encode(['status' => 'queued', 'updated' => time()]));

$worker = escapeshellarg(__DIR__ . '/../scripts/convert_pointcloud.py');
$dir = escapeshellarg($jobDir);
$python = '/opt/py3dtiles/venv/bin/python3';
exec("$python $worker $dir > /dev/null 2>&1 &");

echo json_encode(['jobId' => $jobId, 'slug' => $slug, 'replace' => $replace !== '']);
