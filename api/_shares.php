<?php
// geoBIM.app — scene share links (helpers for api/share-*.php, models.php,
// model-file.php).
//
// A share link is an unguessable token (128 random bits, base64url, 22 chars)
// whose record lives in <site>/model/.shares/<token>.json. model/ is per site
// and not in git, so beta and live keep their own links; dot paths are never
// served (model-file.php), the folder also gets a deny-all .htaccess.
//
// Record: {v, token, sceneId, sceneName, label, createdAt, createdBy,
//          expiresAt|null, revokedAt|null, models[], excluded[], snapshot}
//   models   — top-level entries of model/ the link may load (server-side,
//              built from the scene's assets that exist here)
//   snapshot — the scene frozen at share time, cleaned (see share-create.php)
//
// Opening a link (share-get.php) remembers its token in the HttpOnly cookie
// geobim_share (newest first, at most GEOBIM_SHARE_COOKIE_MAX tokens joined by
// "."); model-file.php and models.php then allow the models of every still
// valid token in it. No HMAC: the token itself is the secret and each request
// checks it against its record.

const GEOBIM_SHARE_COOKIE = 'geobim_share';
const GEOBIM_SHARE_COOKIE_MAX = 5;
const GEOBIM_SHARE_TTL = 43200;   // cookie lifetime, 12 h (refreshed on every open)

function geobim_share_token_valid($t) {
    return is_string($t) && preg_match('/^[A-Za-z0-9_-]{22}$/', $t) === 1;
}

function geobim_share_new_token() {
    return rtrim(strtr(base64_encode(random_bytes(16)), '+/', '-_'), '=');
}

// The site's model/ (never the dev model folder: links stay in the repo's
// model/ locally, so Desktop's tileset folder stays clean)
function geobim_shares_dir($create = false) {
    $dir = str_replace('\\', '/', __DIR__ . '/../model') . '/.shares';
    if ($create && !is_dir($dir)) {
        @mkdir($dir, 0750, true);
        @file_put_contents($dir . '/.htaccess', "Require all denied\n");
    }
    return $dir;
}

function geobim_share_path($t) {
    return geobim_shares_dir() . '/' . $t . '.json';
}

function geobim_share_load($t) {
    static $cache = [];
    if (!geobim_share_token_valid($t)) return null;
    if (array_key_exists($t, $cache)) return $cache[$t];
    $rec = json_decode(@file_get_contents(geobim_share_path($t)) ?: 'null', true);
    return $cache[$t] = (is_array($rec) && ($rec['token'] ?? '') === $t) ? $rec : null;
}

// "active" | "expired" | "revoked"
function geobim_share_state($rec) {
    if (!empty($rec['revokedAt'])) return 'revoked';
    if (!empty($rec['expiresAt']) && strtotime($rec['expiresAt']) <= time()) return 'expired';
    return 'active';
}

// A file or folder name directly in model/, as api/models.php lists it
// (same rule as valid_entry_name in placement-save.php)
function geobim_share_entry_name_valid($name) {
    return is_string($name) && $name !== '' && strlen($name) <= 255
        && mb_check_encoding($name, 'UTF-8')
        && !preg_match('#[/\\\\\x00-\x1F\x7F]#', $name)
        && $name[0] !== '.' && $name[0] !== '_';
}

function geobim_write_json_atomic($path, $data) {
    $tmp = $path . '.tmp-' . getmypid();
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($json === false || file_put_contents($tmp, $json) === false) return false;
    return rename($tmp, $path);
}

// Tokens remembered in this browser's cookie (valid syntax only)
function geobim_share_cookie_tokens() {
    $raw = $_COOKIE[GEOBIM_SHARE_COOKIE] ?? '';
    if (!is_string($raw) || $raw === '') return [];
    $out = [];
    foreach (explode('.', $raw) as $t) {
        if (geobim_share_token_valid($t) && !in_array($t, $out, true)) $out[] = $t;
        if (count($out) >= GEOBIM_SHARE_COOKIE_MAX) break;
    }
    return $out;
}

function geobim_share_remember($t) {
    $tokens = array_values(array_filter(geobim_share_cookie_tokens(), function ($x) use ($t) { return $x !== $t; }));
    array_unshift($tokens, $t);
    $tokens = array_slice($tokens, 0, GEOBIM_SHARE_COOKIE_MAX);
    $https = ($_SERVER['HTTPS'] ?? '') !== '' && strtolower($_SERVER['HTTPS']) !== 'off';
    setcookie(GEOBIM_SHARE_COOKIE, implode('.', $tokens), [
        'expires' => time() + GEOBIM_SHARE_TTL, 'path' => '/',
        'secure' => $https, 'httponly' => true, 'samesite' => 'Lax',
    ]);
}

// Top-level model/ entries the still valid links in this browser's cookie allow
function geobim_share_models() {
    static $models = null;
    if ($models !== null) return $models;
    $models = [];
    foreach (geobim_share_cookie_tokens() as $t) {
        $rec = geobim_share_load($t);
        if (!$rec || geobim_share_state($rec) !== 'active') continue;
        foreach ($rec['models'] ?? [] as $name) {
            if (geobim_share_entry_name_valid($name) && !in_array($name, $models, true)) $models[] = $name;
        }
    }
    return $models;
}

// Whether model/<$rel> lies in an entry a share link in the cookie allows
function geobim_share_may_read($rel) {
    if (empty($_COOKIE[GEOBIM_SHARE_COOKIE])) return false;
    $top = explode('/', $rel, 2)[0];
    return in_array($top, geobim_share_models(), true);
}

// Record without the snapshot, for the owner's link list
function geobim_share_public_info($rec) {
    return [
        'token' => $rec['token'],
        'path' => '/s/' . $rec['token'],
        'sceneId' => $rec['sceneId'] ?? null,
        'sceneName' => $rec['sceneName'] ?? '',
        'label' => $rec['label'] ?? '',
        'createdAt' => $rec['createdAt'] ?? null,
        'expiresAt' => $rec['expiresAt'] ?? null,
        'revokedAt' => $rec['revokedAt'] ?? null,
        'state' => geobim_share_state($rec),
        'models' => $rec['models'] ?? [],
        'excluded' => $rec['excluded'] ?? [],
    ];
}
