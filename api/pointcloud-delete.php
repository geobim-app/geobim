<?php
// geoBIM.app — permanently deletes a self-hosted tileset created by the
// pointcloud upload pipeline (pointcloud-upload.php + convert_pointcloud.py)
// from model/ on the server.
//
// Same known gap as pointcloud-upload.php: no server-side auth, only the
// isLabUser() client-side gate. Kept intentionally narrow in scope to reduce
// blast radius: only folders matching our own naming convention
// (<slug>_tiled[_N]) that actually contain a tileset.json can be targeted —
// this can't be used to delete arbitrary files/GLBs elsewhere in model/.
header('Content-Type: application/json');

function fail($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['error' => $message]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail('POST only', 405);
}

$slug = $_GET['slug'] ?? '';
if (!preg_match('/^[a-z0-9_]+_tiled(_[0-9]+)?$/', $slug)) {
    fail('Invalid slug');
}

$modelDir = realpath(__DIR__ . '/../model');
$target = realpath($modelDir . '/' . $slug);

if ($target === false || dirname($target) !== $modelDir) {
    fail('Not found', 404);
}
if (!is_file($target . '/tileset.json')) {
    fail('Refusing to delete: not a tileset folder', 400);
}

function rrmdir($dir) {
    foreach (scandir($dir) as $entry) {
        if ($entry === '.' || $entry === '..') continue;
        $path = $dir . '/' . $entry;
        is_dir($path) ? rrmdir($path) : unlink($path);
    }
    rmdir($dir);
}

rrmdir($target);

echo json_encode(['deleted' => $slug]);
