<?php
// geoBIM.app — photo reconstruction jobs (shared by pointcloud-upload.php,
// pointcloud-status.php, recon-cancel.php and recon-worker.php).
//
// The server has no GPU, so photo jobs (a ZIP of images) are not run by
// scripts/convert_pointcloud.py. They wait in model/_staging/<jobId>/ with
// job.json {"kind": "recon", ...} until a GPU worker (geobim-tiler's
// geobim_recon_worker.py on a Windows PC) claims them through
// api/recon-worker.php, runs geobim_recon.py and sends the tilesets back.
//
// Status flow in status.json: queued -> claimed -> converting -> done | error,
// or cancelled (owner, recon-cancel.php). A claimed/converting job whose
// worker went silent for RECON_STALE_SECONDS is queued again.

const RECON_STALE_SECONDS = 600;          // worker silent this long: job back to queued
const RECON_WORKER_ONLINE_SECONDS = 120;  // worker counts as online when seen this recently
const RECON_PARTS = ['mesh', 'pointcloud', 'splats'];

function geobim_recon_staging_dir() {
    return __DIR__ . '/../model/_staging';
}

function geobim_read_json($path) {
    $data = json_decode(@file_get_contents($path) ?: '', true);
    return is_array($data) ? $data : null;
}

// Atomic like write_status() in scripts/convert_pointcloud.py
function geobim_write_json($path, $data) {
    $tmp = $path . '.tmp' . bin2hex(random_bytes(3));
    file_put_contents($tmp, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    rename($tmp, $path);
}

function geobim_recon_job_dir($jobId) {
    if (!is_string($jobId) || !preg_match('/^[a-z0-9_]+$/', $jobId)) return null;
    $dir = geobim_recon_staging_dir() . '/' . $jobId;
    $job = geobim_read_json($dir . '/job.json');
    return ($job && ($job['kind'] ?? '') === 'recon') ? $dir : null;
}

function geobim_recon_set_status($dir, $status, $extra = []) {
    geobim_write_json($dir . '/status.json', array_merge(['status' => $status, 'updated' => time()], $extra));
}

// The three output folders of a recon slug: model/<slug>_mesh, _pointcloud, _splats
function geobim_recon_part_dirs($modelDir, $slug) {
    $dirs = [];
    foreach (RECON_PARTS as $part) $dirs[$part] = $modelDir . '/' . $slug . '_' . $part;
    return $dirs;
}

function geobim_recon_worker_online() {
    $hb = geobim_read_json(geobim_recon_staging_dir() . '/.recon-worker.json');
    return $hb && (time() - (int)($hb['seen'] ?? 0)) < RECON_WORKER_ONLINE_SECONDS;
}

// Worker token: /etc/geobim/recon-worker-token (one line), outside the docroot
// like the other secrets; GEOBIM_RECON_TOKEN_FILE overrides it for local tests.
function geobim_recon_require_worker() {
    $file = getenv('GEOBIM_RECON_TOKEN_FILE') ?: '/etc/geobim/recon-worker-token';
    $token = trim((string)@file_get_contents($file));
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    $sent = preg_match('/^Bearer\s+(\S+)$/', $auth, $m) ? $m[1] : ($_SERVER['HTTP_X_RECON_TOKEN'] ?? '');
    if (strlen($token) < 32 || !is_string($sent) || !hash_equals($token, $sent)) {
        http_response_code(401);
        echo json_encode(['error' => 'Unauthorized']);
        exit;
    }
}

function geobim_rrmdir($dir) {
    foreach (scandir($dir) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..') continue;
        $path = $dir . '/' . $entry;
        (is_dir($path) && !is_link($path)) ? geobim_rrmdir($path) : unlink($path);
    }
    rmdir($dir);
}

// First $n characters of a UTF-8 string without mbstring (not installed everywhere)
function geobim_cut($s, $n) {
    $s = (string)$s;
    return preg_match('/^.{0,' . (int)$n . '}/us', $s, $m) ? $m[0] : substr($s, 0, $n);
}
