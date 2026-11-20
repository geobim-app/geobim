<?php
// geoBIM.app — polls a point cloud conversion job started by
// pointcloud-upload.php. Returns the contents of
// model/_staging/<jobId>/status.json as written by scripts/convert_pointcloud.py.
header('Content-Type: application/json');
require __DIR__ . '/_owner_auth.php';
require __DIR__ . '/_members.php';
$user = geobim_require_user(['plugin' => true]);   // session cookie, ID token or Rhino plugin token
// Jobs live in the caller's area: model/_staging or model/users/<area>/_staging
$target = geobim_target_area($user);

$jobId = $_GET['job'] ?? '';
// Job ids are generated server-side (slug + hex suffix) — still validate the
// shape strictly since it's used to build a filesystem path.
if (!preg_match('/^[a-z0-9_]+$/', $jobId)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid job id']);
    exit;
}

$statusPath = $target['dir'] . '/_staging/' . $jobId . '/status.json';
if (!is_file($statusPath)) {
    http_response_code(404);
    echo json_encode(['error' => 'Unknown job']);
    exit;
}

readfile($statusPath);
