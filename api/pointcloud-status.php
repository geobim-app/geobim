<?php
// geoBIM.app — polls a point cloud conversion job started by
// pointcloud-upload.php. Returns the contents of
// model/_staging/<jobId>/status.json as written by scripts/convert_pointcloud.py.
header('Content-Type: application/json');
require __DIR__ . '/_owner_auth.php';
require __DIR__ . '/_recon.php';
geobim_require_owner();   // owner session cookie (api/owner-session.php) or ID token

$jobId = $_GET['job'] ?? '';
// Job ids are generated server-side (slug + hex suffix) — still validate the
// shape strictly since it's used to build a filesystem path.
if (!preg_match('/^[a-z0-9_]+$/', $jobId)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid job id']);
    exit;
}

$statusPath = __DIR__ . '/../model/_staging/' . $jobId . '/status.json';
if (!is_file($statusPath)) {
    http_response_code(404);
    echo json_encode(['error' => 'Unknown job']);
    exit;
}

// Photo reconstruction jobs: is the GPU worker there to pick them up?
if (geobim_recon_job_dir($jobId) !== null) {
    $status = json_decode(file_get_contents($statusPath), true) ?: ['status' => 'queued'];
    $status['kind'] = 'recon';
    $status['worker_online'] = geobim_recon_worker_online();
    echo json_encode($status, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

readfile($statusPath);
