<?php
// geoBIM.app — trade a Firebase ID token for the session cookie that unlocks
// model/ (see _owner_auth.php): the owner's, or a member's model area
// (_members.php). POST: set → {session, role: "owner"|"member", label, ttl}.
// Any other account: {session: false}, a stale cookie is cleared. DELETE: clear.
header('Content-Type: application/json');
header('Cache-Control: no-store');
require __DIR__ . '/_owner_auth.php';
require __DIR__ . '/_members.php';

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
$auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
$payload = preg_match('/^Bearer\s+(\S+)$/', $auth, $m) && strncmp($m[1], 'gbp_', 4) !== 0
    ? geobim_verify_firebase_token($m[1]) : null;
if (!$payload) {
    http_response_code(401);
    echo json_encode(['error' => 'Invalid or expired sign-in']);
    exit;
}
$user = geobim_user_for_token($payload);
if (!$user) {
    // signed in, but neither owner nor member: no server models
    geobim_clear_session_cookie();
    echo json_encode(['session' => false]);
    exit;
}
if (!geobim_session_secret()) {
    http_response_code(500);
    echo json_encode(['error' => 'Session secret not configured']);
    exit;
}
geobim_set_session_cookie($user['email']);
echo json_encode(['session' => true, 'role' => $user['role'], 'label' => $user['label'], 'ttl' => GEOBIM_SESSION_TTL]);
