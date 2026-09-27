<?php
// geoBIM.app — trade the owner's Firebase ID token for the session cookie that
// unlocks model/ (see _owner_auth.php). POST: set (owner only). DELETE: clear.
header('Content-Type: application/json');
header('Cache-Control: no-store');
require __DIR__ . '/_owner_auth.php';

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    geobim_clear_session_cookie();
    echo json_encode(['session' => false]);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'POST or DELETE']);
    exit;
}
$user = geobim_require_owner();
if (!geobim_session_secret()) {
    http_response_code(500);
    echo json_encode(['error' => 'Session secret not configured']);
    exit;
}
geobim_set_session_cookie($user['email']);
echo json_encode(['session' => true, 'ttl' => GEOBIM_SESSION_TTL]);
