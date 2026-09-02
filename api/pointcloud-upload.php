<?php
// geoBIM.app — Point cloud upload endpoint.
// Accepts a LAS/LAZ file (+ optional lon/lat/height/heading), stages it under
// model/_staging/<jobId>/, and spawns a detached background worker
// (scripts/convert_pointcloud.py) that runs py3dtiles and — once done — drops
// the tiled result into model/<slug>/, where it's auto-discovered by
// models.php exactly like any other GLB/tileset asset.
//
// KNOWN GAP: no server-side auth. The Assets panel only shows the upload UI
// to BimViewer.isLabUser() (client-side check, matching the existing GLB lab
// section) — this endpoint itself accepts requests from anyone who finds the
// URL. Acceptable for now given this project's other api/*.php endpoints are
// equally unauthenticated and labUsers is effectively one person, but a real
// gate (e.g. Firebase ID token verification) would be needed before opening
// this more broadly.
header('Content-Type: application/json');

// Deliberately modest while usage is low-volume/single-user — flock()-serialized
// conversion in convert_pointcloud.py already prevents concurrent jobs from
// overloading the server, this cap is about not tying up the queue for a long
// time or eating disk space on one huge upload. Raise later based on real
// usage. Keep in sync with api/.user.ini's upload_max_filesize.
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

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
        fail('File too large — 200 MB limit for now');
    }
    fail('Upload failed (no file received)');
}
if ($_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    $err = $_FILES['file']['error'];
    if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) {
        fail('File too large — 200 MB limit for now');
    }
    fail('Upload failed (error code ' . $err . ')');
}
if ($_FILES['file']['size'] > MAX_UPLOAD_BYTES) {
    fail('File too large — 200 MB limit for now');
}

$origName = $_FILES['file']['name'];
$ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
if (!in_array($ext, ['las', 'laz'], true)) {
    fail('Only .las/.laz files are supported');
}

$name = trim($_POST['name'] ?? pathinfo($origName, PATHINFO_FILENAME));
if ($name === '') {
    fail('Missing name');
}
$baseSlug = trim(preg_replace('/[^a-z0-9]+/', '_', strtolower($name)), '_');
if ($baseSlug === '') {
    fail('Name must contain at least one letter or digit');
}
$slug = $baseSlug . '_tiled';

$modelDir = __DIR__ . '/../model';
// Avoid clobbering an existing asset folder — same convention as models.php's
// id generation, just with a numeric suffix appended on collision.
$i = 2;
while (is_dir($modelDir . '/' . $slug)) {
    $slug = $baseSlug . '_tiled_' . $i;
    $i++;
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
if ($lon !== null) {
    $job['lon'] = $lon;
    $job['lat'] = $lat;
    $job['height'] = $height;
    $job['heading'] = $heading;
}
file_put_contents($jobDir . '/job.json', json_encode($job));
file_put_contents($jobDir . '/status.json', json_encode(['status' => 'queued', 'updated' => time()]));

$worker = escapeshellarg(__DIR__ . '/../scripts/convert_pointcloud.py');
$dir = escapeshellarg($jobDir);
$python = '/opt/py3dtiles/venv/bin/python3';
exec("$python $worker $dir > /dev/null 2>&1 &");

echo json_encode(['jobId' => $jobId, 'slug' => $slug]);
