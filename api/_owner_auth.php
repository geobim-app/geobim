<?php
// geoBIM.app — server-side owner check for write endpoints.
//
// Verifies a Firebase ID token (Authorization: Bearer <token>) the way the
// Admin SDK does, without it: RS256 signature against Google's published
// securetoken certificates, audience/issuer = our Firebase project, not
// expired, and the account's email is the owner's. Firebase allows one
// account per email, so the address identifies the owner.

const GEOBIM_FIREBASE_PROJECT = 'publictwin-ad6c7';
const GEOBIM_OWNER_EMAILS = ['christof2304@gmail.com'];
const GEOBIM_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

function geobim_b64url_decode($s) {
    return base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4));
}

// Google rotates these keys; cache them for the max-age it announces.
function geobim_firebase_certs() {
    $cache = sys_get_temp_dir() . '/geobim_firebase_certs.json';
    if (is_file($cache)) {
        $c = json_decode(file_get_contents($cache), true);
        if (is_array($c) && ($c['expires'] ?? 0) > time()) return $c['certs'];
    }
    $ch = curl_init(GEOBIM_CERTS_URL);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true, CURLOPT_TIMEOUT => 10]);
    $resp = curl_exec($ch);
    $hsize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false || $code !== 200) return null;
    $headers = substr($resp, 0, $hsize);
    $certs = json_decode(substr($resp, $hsize), true);
    if (!is_array($certs)) return null;
    $maxAge = preg_match('/max-age=(\d+)/i', $headers, $m) ? (int)$m[1] : 3600;
    @file_put_contents($cache, json_encode(['expires' => time() + $maxAge, 'certs' => $certs]), LOCK_EX);
    return $certs;
}

// Returns the verified token payload, or null.
function geobim_verify_firebase_token($jwt) {
    $parts = explode('.', $jwt);
    if (count($parts) !== 3) return null;
    [$h, $p, $sig] = $parts;
    $header = json_decode(geobim_b64url_decode($h), true);
    $payload = json_decode(geobim_b64url_decode($p), true);
    if (!is_array($header) || !is_array($payload)) return null;
    if (($header['alg'] ?? '') !== 'RS256' || empty($header['kid'])) return null;
    $certs = geobim_firebase_certs();
    if (!$certs || empty($certs[$header['kid']])) return null;
    $key = openssl_pkey_get_public($certs[$header['kid']]);
    if (!$key || openssl_verify("$h.$p", geobim_b64url_decode($sig), $key, OPENSSL_ALGO_SHA256) !== 1) return null;
    $now = time();
    if (($payload['aud'] ?? '') !== GEOBIM_FIREBASE_PROJECT) return null;
    if (($payload['iss'] ?? '') !== 'https://securetoken.google.com/' . GEOBIM_FIREBASE_PROJECT) return null;
    if (($payload['exp'] ?? 0) < $now || ($payload['iat'] ?? PHP_INT_MAX) > $now + 300) return null;
    if (empty($payload['sub'])) return null;
    return $payload;
}

// ---------------------------------------------------------------------------
// Owner session cookie. Cesium loads tiles with plain GETs that cannot carry
// the ID token, so after sign-in api/owner-session.php trades the token for a
// cookie: "<email>|<expiry>|<hmac>" signed with /etc/geobim/session-secret.
// The browser sends it with every same-origin request (tiles, uploads, ...).
// ---------------------------------------------------------------------------
const GEOBIM_SESSION_COOKIE = 'geobim_owner';
const GEOBIM_SESSION_TTL = 12 * 3600;

function geobim_session_secret() {
    $s = @file_get_contents('/etc/geobim/session-secret');
    return $s ? trim($s) : null;
}

function geobim_session_value($email, $expires) {
    $secret = geobim_session_secret();
    if (!$secret) return null;
    $data = strtolower($email) . '|' . $expires;
    return $data . '|' . hash_hmac('sha256', $data, $secret);
}

// Owner email from a valid session cookie, or null.
function geobim_owner_from_cookie() {
    $v = $_COOKIE[GEOBIM_SESSION_COOKIE] ?? '';
    $parts = explode('|', $v);
    if (count($parts) !== 3) return null;
    [$email, $expires, $mac] = $parts;
    if (!ctype_digit($expires) || (int)$expires < time()) return null;
    $expected = geobim_session_value($email, (int)$expires);
    if (!$expected || !hash_equals($expected, $v)) return null;
    return in_array($email, GEOBIM_OWNER_EMAILS, true) ? $email : null;
}

function geobim_set_session_cookie($email) {
    $expires = time() + GEOBIM_SESSION_TTL;
    setcookie(GEOBIM_SESSION_COOKIE, geobim_session_value($email, $expires), [
        'expires' => $expires, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Lax',
    ]);
}

function geobim_clear_session_cookie() {
    setcookie(GEOBIM_SESSION_COOKIE, '', [
        'expires' => 1, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Lax',
    ]);
}

function geobim_is_owner() {
    return geobim_owner_from_cookie() !== null;
}

// Ends the request with 401/403 unless the caller is the owner (session
// cookie, or a Firebase ID token in the Authorization header).
function geobim_require_owner() {
    $email = geobim_owner_from_cookie();
    if ($email) return ['email' => $email, 'via' => 'cookie'];
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (!preg_match('/^Bearer\s+(\S+)$/', $auth, $m)) {
        http_response_code(401);
        echo json_encode(['error' => 'Sign-in required']);
        exit;
    }
    $payload = geobim_verify_firebase_token($m[1]);
    if (!$payload) {
        http_response_code(401);
        echo json_encode(['error' => 'Invalid or expired sign-in']);
        exit;
    }
    if (!in_array(strtolower($payload['email'] ?? ''), GEOBIM_OWNER_EMAILS, true)) {
        http_response_code(403);
        echo json_encode(['error' => 'Owner only']);
        exit;
    }
    return $payload;
}
