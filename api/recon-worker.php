<?php
// geoBIM.app — endpoint for the photo reconstruction worker (GPU PC running
// geobim-tiler's geobim_recon_worker.py). See api/_recon.php for the job flow.
//
// Auth: Authorization: Bearer <token from /etc/geobim/recon-worker-token>.
// Actions (?action=):
//   ping                         GET   heartbeat while idle
//   claim                        GET   oldest queued recon job -> {jobId, job} or 204
//   input&job=                   GET   the uploaded photo ZIP
//   status&job=                  POST  {"progress": "..."} -> {"cancel": bool}
//   result&job=&part=            POST  body = ZIP of one tileset folder (mesh|pointcloud|splats)
//   done&job=                    POST  {"warning": "...", "report": {...}}
//   fail&job=                    POST  {"message": "..."}
header('Content-Type: application/json');
require __DIR__ . '/_recon.php';
geobim_recon_require_worker();

function fail($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['error' => $message]);
    exit;
}

function body_json() {
    $data = json_decode(file_get_contents('php://input') ?: '{}', true);
    return is_array($data) ? $data : [];
}

$staging = geobim_recon_staging_dir();
$modelDir = dirname($staging);
@mkdir($staging, 0775, true);
geobim_write_json($staging . '/.recon-worker.json', ['seen' => time()]);

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];
$isPost = in_array($action, ['status', 'result', 'done', 'fail'], true);
if ($isPost && $method !== 'POST') fail('POST only', 405);

if ($action === 'ping') {
    echo json_encode(['ok' => true]);
    exit;
}

if ($action === 'claim') {
    $lock = fopen($staging . '/.recon.lock', 'c');
    flock($lock, LOCK_EX);
    $best = null;
    foreach (glob($staging . '/*/job.json') ?: [] as $jobFile) {
        $dir = dirname($jobFile);
        $job = geobim_read_json($jobFile);
        if (!$job || ($job['kind'] ?? '') !== 'recon') continue;
        $st = geobim_read_json($dir . '/status.json') ?: ['status' => 'queued'];
        $state = $st['status'] ?? 'queued';
        // Worker went away (PC off, crash): the job is free again
        if (in_array($state, ['claimed', 'converting'], true) && time() - (int)($st['updated'] ?? 0) > RECON_STALE_SECONDS) {
            geobim_recon_set_status($dir, 'queued', ['progress' => 'requeued: worker did not report for 10 min']);
            $state = 'queued';
        }
        if ($state !== 'queued' || !is_file($dir . '/' . ($job['input'] ?? ''))) continue;
        $created = (int)($job['created'] ?? filemtime($jobFile));
        if ($best === null || $created < $best[0]) $best = [$created, $dir, $job];
    }
    if ($best === null) {
        flock($lock, LOCK_UN);
        http_response_code(204);
        exit;
    }
    [, $dir, $job] = $best;
    geobim_recon_set_status($dir, 'claimed', ['progress' => 'picked up by the reconstruction PC']);
    flock($lock, LOCK_UN);
    echo json_encode(['jobId' => basename($dir), 'job' => $job,
                      'size' => filesize($dir . '/' . $job['input'])]);
    exit;
}

$jobId = $_GET['job'] ?? '';
$dir = geobim_recon_job_dir($jobId);
if ($dir === null) fail('Unknown job', 404);
$job = geobim_read_json($dir . '/job.json');
$st = geobim_read_json($dir . '/status.json') ?: ['status' => 'queued'];
$cancelled = ($st['status'] ?? '') === 'cancelled';

if ($action === 'input') {
    $path = $dir . '/' . $job['input'];
    if (!is_file($path)) fail('Input gone', 410);
    header('Content-Type: application/zip');
    header('Content-Length: ' . filesize($path));
    readfile($path);
    exit;
}

// A job that is finished or cancelled takes no more updates
if (in_array($st['status'] ?? '', ['done', 'error', 'cancelled'], true) && $action !== 'status') {
    fail('Job is ' . $st['status'], 409);
}

if ($action === 'status') {
    if (!$cancelled && !in_array($st['status'] ?? '', ['done', 'error'], true)) {
        $progress = geobim_cut((string)(body_json()['progress'] ?? ''), 300);
        geobim_recon_set_status($dir, 'converting', $progress !== '' ? ['progress' => $progress] : []);
    }
    echo json_encode(['cancel' => $cancelled]);
    exit;
}

if ($action === 'result') {
    $part = $_GET['part'] ?? '';
    if (!in_array($part, RECON_PARTS, true)) fail('Invalid part');
    $final = geobim_recon_part_dirs($modelDir, $job['slug'])[$part];
    if (file_exists($final)) {
        // Left over from an earlier attempt of this same job (worker restarted): replace it
        if (trim((string)@file_get_contents($final . '/.recon-job')) !== $jobId) {
            fail('model/' . basename($final) . ' already exists', 409);
        }
        geobim_rrmdir($final);
    }
    $zip = $dir . '/result_' . $part . '.zip';
    $in = fopen('php://input', 'rb');
    $out = fopen($zip, 'wb');
    $bytes = stream_copy_to_stream($in, $out);
    fclose($in);
    fclose($out);
    if (!$bytes) fail('Empty body');
    // Unpacking and checking the ZIP (paths, file types, tileset.json, placement)
    // is done in Python like the other converters: scripts/recon_unpack.py
    $python = getenv('GEOBIM_RECON_PYTHON') ?: '/opt/py3dtiles/venv/bin/python3';
    $cmd = [$python, __DIR__ . '/../scripts/recon_unpack.py', $zip, $final, '--job', $jobId];
    if (isset($job['lon'], $job['lat'])) {
        array_push($cmd, '--lonlat', $job['lon'] . ',' . $job['lat'], '--height', (string)($job['height'] ?? 0));
    }
    $outLines = [];
    exec(implode(' ', array_map('escapeshellarg', $cmd)) . ' 2>&1', $outLines, $code);
    @unlink($zip);
    $reply = json_decode(end($outLines) ?: '', true);
    if ($code !== 0 || !is_array($reply)) {
        fail('Unpacking failed: ' . geobim_cut(implode(' | ', array_slice($outLines, -3)), 300), 422);
    }
    echo json_encode($reply);
    exit;
}

if ($action === 'done') {
    $body = body_json();
    $tilesets = [];
    foreach (geobim_recon_part_dirs($modelDir, $job['slug']) as $part => $final) {
        if (is_file($final . '/tileset.json')) {
            $tilesets[] = ['id' => basename($final), 'part' => $part,
                           'file' => 'model/' . basename($final) . '/tileset.json'];
        }
    }
    if (!$tilesets) fail('No tileset was uploaded');
    if (isset($body['report']) && is_array($body['report'])) {
        geobim_write_json($dir . '/report.json', $body['report']);
    }
    $extra = ['tilesets' => $tilesets, 'tileset' => $tilesets[0]['file']];
    $warning = geobim_cut((string)($body['warning'] ?? ''), 500);
    if ($warning !== '') $extra['warning'] = $warning;
    geobim_recon_set_status($dir, 'done', $extra);
    @unlink($dir . '/' . $job['input']);   // the photos are on the PC; free the disk
    echo json_encode(['ok' => true, 'tilesets' => $tilesets]);
    exit;
}

if ($action === 'fail') {
    $message = geobim_cut((string)(body_json()['message'] ?? 'reconstruction failed'), 500);
    geobim_recon_set_status($dir, 'error', ['message' => $message]);
    @unlink($dir . '/' . $job['input']);
    echo json_encode(['ok' => true]);
    exit;
}

fail('Unknown action');
