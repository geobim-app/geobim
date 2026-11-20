<?php
// geoBIM.app — personal access tokens for the Rhino plugin (geobim-rhino).
//
// A desktop plugin can't keep a Firebase sign-in, so the owner creates a
// long-lived token in the Account panel (api/plugin-tokens.php) and pastes it
// into the plugin once. Token: "gbp_" + 32 random bytes, base64url (43 chars).
// Only its SHA-256 is stored, in <site>/model/.tokens/plugin-tokens.json
// (model/ is per site and not in git; dot paths are never served by
// model-file.php, the folder also gets a deny-all .htaccess — like .shares).
//
// Tokens act as the owner, but only on endpoints that opt in with
// geobim_require_owner(['plugin' => true]) — upload, job status and
// plugin-whoami — never on deleting, placing or sharing models.
//
// Record: {id, label, hash, prefix, created, createdBy, lastUsed|null, revoked|null}

const GEOBIM_PLUGIN_TOKEN_PREFIX = 'gbp_';
const GEOBIM_PLUGIN_TOKEN_MAX = 20;

function geobim_plugin_tokens_dir($create = false) {
    $dir = str_replace('\\', '/', __DIR__ . '/../model') . '/.tokens';
    if ($create && !is_dir($dir)) {
        @mkdir($dir, 0750, true);
        @file_put_contents($dir . '/.htaccess', "Require all denied\n");
    }
    return $dir;
}

function geobim_plugin_tokens_file() {
    return geobim_plugin_tokens_dir() . '/plugin-tokens.json';
}

function geobim_plugin_tokens_load() {
    $list = json_decode(@file_get_contents(geobim_plugin_tokens_file()) ?: '[]', true);
    return is_array($list) ? $list : [];
}

// Read-modify-write under an exclusive lock; $fn gets the list by reference
// and returns a result. The file is replaced atomically.
function geobim_plugin_tokens_update(callable $fn) {
    $dir = geobim_plugin_tokens_dir(true);
    $lock = fopen($dir . '/.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Token store busy');
    try {
        $list = geobim_plugin_tokens_load();
        $result = $fn($list);
        $tmp = $dir . '/plugin-tokens.json.' . bin2hex(random_bytes(4)) . '.tmp';
        if (file_put_contents($tmp, json_encode(array_values($list), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)) === false
            || !rename($tmp, geobim_plugin_tokens_file())) {
            @unlink($tmp);
            throw new RuntimeException('Could not save tokens');
        }
        return $result;
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function geobim_plugin_token_new() {
    return GEOBIM_PLUGIN_TOKEN_PREFIX . rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
}

function geobim_plugin_token_looks_valid($t) {
    return is_string($t) && preg_match('/^gbp_[A-Za-z0-9_-]{43}$/', $t) === 1;
}

// The token's record when it is known and not revoked, else null. Updates
// lastUsed at most once a minute (keeps writes rare during job polling).
function geobim_plugin_token_check($token) {
    if (!geobim_plugin_token_looks_valid($token)) return null;
    $hash = hash('sha256', $token);
    $found = null;
    foreach (geobim_plugin_tokens_load() as $rec) {
        if (isset($rec['hash']) && hash_equals($rec['hash'], $hash)) { $found = $rec; break; }
    }
    if (!$found || !empty($found['revoked'])) return null;
    $last = isset($found['lastUsed']) ? strtotime($found['lastUsed']) : 0;
    if (time() - $last > 60) {
        try {
            geobim_plugin_tokens_update(function (&$list) use ($found) {
                foreach ($list as &$r) {
                    if (($r['id'] ?? '') === $found['id']) $r['lastUsed'] = gmdate('c');
                }
            });
        } catch (Throwable $e) {
            // lastUsed is informational only
        }
    }
    return $found;
}

// Public view of a record (never the hash)
function geobim_plugin_token_public($rec) {
    return [
        'id' => $rec['id'] ?? '',
        'label' => $rec['label'] ?? '',
        'prefix' => $rec['prefix'] ?? '',
        'created' => $rec['created'] ?? null,
        'lastUsed' => $rec['lastUsed'] ?? null,
        'revoked' => $rec['revoked'] ?? null,
    ];
}
