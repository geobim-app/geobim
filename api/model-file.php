<?php
// geoBIM.app — serves model/ files to the owner only (model/.htaccess routes
// everything here except the few files public features need). Tilesets load
// many small files, so this stays lean: cookie check, path check, readfile
// with caching headers.
require __DIR__ . '/_owner_auth.php';
require __DIR__ . '/_dev.php';
require __DIR__ . '/_guest_models.php';
require __DIR__ . '/_shares.php';

// Local development: a folder of tilesets instead of model/ (see _dev.php)
$devDir = geobim_dev_model_dir();
$modelDir = $devDir ?: str_replace('\\', '/', realpath(__DIR__ . '/../model'));   // "/" also on Windows (dev)
$rel = $_GET['path'] ?? '';
if ($rel === '' || strpos($rel, "\0") !== false || preg_match('#(^|/)(\.|_staging(/|$))#', $rel)) {
    http_response_code(404);
    exit;
}
// Everyone but the owner: only the entries of model/guest-models.json and
// those of share links opened in this browser (cookie, see _shares.php)
if (!$devDir && !geobim_is_owner() && !geobim_guest_may_read($modelDir, $rel) && !geobim_share_may_read($rel)) {
    http_response_code(404);   // don't reveal what exists
    exit;
}
$path = realpath($modelDir . '/' . $rel);
if ($path !== false) $path = str_replace('\\', '/', $path);   // Windows (dev)
if ($path === false || strpos($path, $modelDir . '/') !== 0 || !is_file($path)) {
    http_response_code(404);
    exit;
}
$types = [
    'json' => 'application/json', 'glb' => 'model/gltf-binary', 'gltf' => 'model/gltf+json',
    'bin' => 'application/octet-stream', 'b3dm' => 'application/octet-stream',
    'pnts' => 'application/octet-stream', 'i3dm' => 'application/octet-stream',
    'cmpt' => 'application/octet-stream', 'subtree' => 'application/octet-stream',
    'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'ktx2' => 'image/ktx2',
    'html' => 'text/html; charset=utf-8',
];
$ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
$mtime = filemtime($path);
$size = filesize($path);
$etag = '"' . dechex($mtime) . '-' . dechex($size) . '"';
header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
header('Cache-Control: private, no-cache');   // revalidate: saved placements rewrite tileset.json
header('ETag: ' . $etag);
header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $mtime) . ' GMT');
if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
    http_response_code(304);
    exit;
}
header('Content-Length: ' . $size);
readfile($path);
