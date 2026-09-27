<?php
// geoBIM.app — serves model/ files to the owner only (model/.htaccess routes
// everything here except the few files public features need). Tilesets load
// many small files, so this stays lean: cookie check, path check, readfile
// with caching headers.
require __DIR__ . '/_owner_auth.php';

if (!geobim_is_owner()) {
    http_response_code(404);   // don't reveal what exists
    exit;
}
$modelDir = realpath(__DIR__ . '/../model');
$rel = $_GET['path'] ?? '';
if ($rel === '' || strpos($rel, "\0") !== false || preg_match('#(^|/)(\.|_staging(/|$))#', $rel)) {
    http_response_code(404);
    exit;
}
$path = realpath($modelDir . '/' . $rel);
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
