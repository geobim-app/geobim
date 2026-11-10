<?php
// geoBIM.app — open a share link. Public: the token is the secret.
// GET ?token=<22 chars>
//   200 {sceneName, label, expiresAt, snapshot}  + remembers the token in the
//       geobim_share cookie, so model-file.php serves the link's models
//   404 {error: "not found"}   unknown or malformed token
//   410 {error: "revoked" | "expired"}
// Never returns who created it, other models or what was left out.
header('Content-Type: application/json');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');
require __DIR__ . '/_shares.php';

$token = $_GET['token'] ?? '';
$rec = geobim_share_load($token);
if (!$rec) {
    http_response_code(404);
    echo json_encode(['error' => 'not found']);
    exit;
}
$state = geobim_share_state($rec);
if ($state !== 'active') {
    http_response_code(410);
    echo json_encode(['error' => $state]);
    exit;
}
geobim_share_remember($token);
echo json_encode([
    'sceneName' => $rec['sceneName'] ?? '',
    'label' => $rec['label'] ?? '',
    'expiresAt' => $rec['expiresAt'] ?? null,
    'snapshot' => $rec['snapshot'] ?? null,
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
