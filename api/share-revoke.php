<?php
// geoBIM.app — revoke a share link. Owner only; calling it again is harmless.
// POST {token} → {token, revokedAt}
// The record stays (for the link list); share-get.php answers 410 from now on
// and model-file.php no longer serves its models.
header('Content-Type: application/json');
header('Cache-Control: no-store');
require __DIR__ . '/_owner_auth.php';
require __DIR__ . '/_shares.php';

function fail($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['error' => $message]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('POST only', 405);
geobim_require_owner();

$req = json_decode(file_get_contents('php://input'), true);
$token = is_array($req) ? ($req['token'] ?? '') : '';
if (!geobim_share_token_valid($token)) fail('Invalid token');

$path = geobim_share_path($token);
$fh = is_file($path) ? @fopen($path, 'r+') : false;
if (!$fh || !flock($fh, LOCK_EX)) fail('Not found', 404);
$rec = json_decode(stream_get_contents($fh) ?: 'null', true);
if (!is_array($rec) || ($rec['token'] ?? '') !== $token) {
    flock($fh, LOCK_UN); fclose($fh);
    fail('Not found', 404);
}
if (empty($rec['revokedAt'])) {
    $rec['revokedAt'] = gmdate('Y-m-d\TH:i:s\Z');
    ftruncate($fh, 0); rewind($fh);
    fwrite($fh, json_encode($rec, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    fflush($fh);
}
flock($fh, LOCK_UN); fclose($fh);
echo json_encode(['token' => $token, 'revokedAt' => $rec['revokedAt']]);
