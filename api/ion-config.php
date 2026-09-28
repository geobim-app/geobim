<?php
/**
 * geoBIM.app — Cesium Ion Default Token Endpoint
 *
 * Returns the default (demo) Cesium Ion access token.
 * Keeps the token server-side instead of hardcoded in JS source.
 *
 * Licensed under the Business Source License 1.1 (BSL 1.1)
 */

header('Content-Type: application/json');
header('Cache-Control: no-store');

// Default demo token — restricted, read-only token from the geobim.app Ion account.
// Kept outside the web root and git (the previous token leaked via the public repo).
$tokenFile = '/etc/geobim/ion-demo-token';
$token = is_readable($tokenFile) ? trim(file_get_contents($tokenFile)) : '';
if ($token === '') {
    http_response_code(500);
    echo json_encode(['error' => 'Demo token not configured']);
    exit;
}

echo json_encode([
    'token' => $token,
    'name'  => 'geobim.app Demo'
]);
