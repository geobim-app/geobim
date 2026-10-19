<?php
/**
 * geoBIM.app — Bentley IMS token exchange relay (itwin-auth.js)
 *
 * Bentley IMS answers the token request of the SPA client without CORS
 * headers, so the browser cannot read it. This relays exactly one request
 * type — authorization_code + PKCE for our public client — and returns IMS's
 * answer unchanged. Nothing is stored or logged; without the code_verifier
 * (held in the user's tab) a code is useless, and codes are single-use.
 *
 * Licensed under the Business Source License 1.1 (BSL 1.1)
 */

header('Content-Type: application/json');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const IMS_TOKEN_URL = 'https://ims.bentley.com/connect/token';
const CLIENT_ID = 'spa-K1Bw2oHFKzK2iZxJkL3GpHtQ0';
const ORIGINS = ['https://geobim.app', 'https://beta.geobim.app', 'https://viewer.geobim.app',
    'http://localhost:8000']; // local development (dev/serve.ps1)

function fail($status, $error) {
    http_response_code($status);
    echo json_encode(['error' => $error]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail(405, 'method_not_allowed');
}

// Same-origin use from our pages only
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (!in_array($origin, ORIGINS, true)) {
    fail(403, 'origin_not_allowed');
}

$code = $_POST['code'] ?? '';
$verifier = $_POST['code_verifier'] ?? '';
$redirectUri = $_POST['redirect_uri'] ?? '';

if ($redirectUri !== $origin . '/itwin-callback.html') {
    fail(400, 'invalid_redirect_uri');
}
if (!preg_match('/^[A-Za-z0-9._~-]{10,2048}$/', $code) || !preg_match('/^[A-Za-z0-9._~-]{43,128}$/', $verifier)) {
    fail(400, 'invalid_request');
}

$ch = curl_init(IMS_TOKEN_URL);
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => http_build_query([
        'grant_type' => 'authorization_code',
        'code' => $code,
        'redirect_uri' => $redirectUri,
        'client_id' => CLIENT_ID,
        'code_verifier' => $verifier,
    ]),
    CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded', 'Accept: application/json'],
    CURLOPT_USERAGENT => 'geobim.app itwin-token relay',
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 20,
]);
$body = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);

if ($body === false || $status === 0) {
    fail(502, 'ims_unreachable');
}

// Pass through only the fields the client needs
$data = json_decode($body, true);
if (!is_array($data)) {
    fail(502, 'ims_bad_response');
}
http_response_code($status);
echo json_encode(array_intersect_key($data, array_flip(['access_token', 'expires_in', 'token_type', 'scope', 'error', 'error_description'])));
