<?php
/**
 * geobim.app — WMS Redirect Resolver
 *
 * Some OGC WMS servers declare a GetMap/GetFeatureInfo endpoint in their
 * GetCapabilities response that 30x-redirects to a different path (server
 * migration, e.g. RLP geoportal: /dCE/services/... -> /inspire/services/...).
 * Browsers require the intermediate redirect response itself to carry
 * Access-Control-Allow-Origin for a cross-origin fetch/XHR to follow it —
 * many of these servers only set CORS headers on the final response, so
 * the whole request chain gets blocked client-side before it ever succeeds.
 *
 * This endpoint resolves such a redirect server-side (no browser CORS
 * involved) and returns only the resolved base URL — never any tile/image
 * payload — so the frontend can talk to the real endpoint directly from
 * then on. HEAD-only, one call per discovered WMS layer.
 *
 * Query params:
 *   url — the http(s) GetMap/GetFeatureInfo base URL to resolve
 */

header('Content-Type: application/json');

$url = isset($_GET['url']) ? trim($_GET['url']) : '';

if ($url === '' || !preg_match('#^https?://#i', $url)) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing or invalid url parameter']);
    exit;
}

$parts = parse_url($url);
if (!$parts || empty($parts['host'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Could not parse url']);
    exit;
}

// SSRF guard: only allow targets that resolve to public IP addresses —
// this proxy exists to unblock third-party WMS layers a user adds in the
// Layers panel, so the target host is inherently untrusted input.
$host = $parts['host'];
$ips = [];
if (filter_var($host, FILTER_VALIDATE_IP)) {
    $ips[] = $host;
} else {
    $records = @dns_get_record($host, DNS_A | DNS_AAAA);
    if ($records) {
        foreach ($records as $r) {
            if (!empty($r['ip'])) $ips[] = $r['ip'];
            if (!empty($r['ipv6'])) $ips[] = $r['ipv6'];
        }
    }
}
if (empty($ips)) {
    http_response_code(400);
    echo json_encode(['error' => 'Could not resolve host']);
    exit;
}
foreach ($ips as $ip) {
    if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
        http_response_code(403);
        echo json_encode(['error' => 'Target host not allowed']);
        exit;
    }
}

// Strip any query string — we only need the redirect target of the base
// path, WMS query params don't affect where a path-migration redirect goes.
$baseUrl = $parts['scheme'] . '://' . $parts['host'] .
    (isset($parts['port']) ? ':' . $parts['port'] : '') .
    ($parts['path'] ?? '/');

$ch = curl_init($baseUrl);
curl_setopt_array($ch, [
    CURLOPT_NOBODY => true,        // HEAD request — no tile/image payload
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 5,
    CURLOPT_TIMEOUT => 8,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_USERAGENT => 'geobim.app WMS redirect resolver',
    CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
    CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
]);
curl_exec($ch);
$effectiveUrl = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
$err = curl_errno($ch) ? curl_error($ch) : null;
curl_close($ch);

if ($err || !$effectiveUrl) {
    http_response_code(502);
    echo json_encode(['error' => $err ?: 'Request failed']);
    exit;
}

// Strip query string from the resolved URL too — callers append their own.
$resolvedBase = strtok($effectiveUrl, '?');

echo json_encode(['resolvedUrl' => $resolvedBase]);
