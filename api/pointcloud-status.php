<?php
// geoBIM.app — polls a point cloud conversion job started by
// pointcloud-upload.php. Returns the contents of
// model/_staging/<jobId>/status.json as written by scripts/convert_pointcloud.py.
header('Content-Type: application/json');

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

readfile($statusPath);
