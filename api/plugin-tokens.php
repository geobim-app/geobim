<?php
// geoBIM.app — manage Rhino plugin tokens (Account panel, plugin-tokens.js).
//
//   GET                         → {tokens: [{id, label, prefix, created, lastUsed, revoked}]}
//   POST {label}                → {token, id, ...} — the token is shown only here, once
//   POST {action: "revoke", id} → {ok: true}
//
// Owner only via session cookie or Firebase ID token — never with a plugin
// token itself, so a leaked token can't mint new ones.
header('Content-Type: application/json');
header('Cache-Control: no-store');
require __DIR__ . '/_owner_auth.php';
require __DIR__ . '/_plugin_tokens.php';
$owner = geobim_require_owner();

function fail($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['error' => $message]);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $tokens = array_map('geobim_plugin_token_public', geobim_plugin_tokens_load());
    echo json_encode(['tokens' => array_values(array_filter($tokens, function ($t) { return empty($t['revoked']); }))]);
    exit;
}

if ($method !== 'POST') fail('GET or POST only', 405);

$body = json_decode(file_get_contents('php://input') ?: '{}', true);
if (!is_array($body)) fail('Invalid JSON');

try {
    if (($body['action'] ?? '') === 'revoke') {
        $id = (string)($body['id'] ?? '');
        if (!preg_match('/^[a-f0-9]{16}$/', $id)) fail('Invalid token id');
        $ok = geobim_plugin_tokens_update(function (&$list) use ($id) {
            foreach ($list as &$r) {
                if (($r['id'] ?? '') === $id && empty($r['revoked'])) { $r['revoked'] = gmdate('c'); return true; }
            }
            return false;
        });
        if (!$ok) fail('Unknown token', 404);
        echo json_encode(['ok' => true]);
        exit;
    }

    $label = trim(preg_replace('/[\x00-\x1f]+/', ' ', (string)($body['label'] ?? '')));
    if ($label === '') $label = 'Rhino plugin';
    $label = mb_substr($label, 0, 60);
    $token = geobim_plugin_token_new();
    $rec = [
        'id' => bin2hex(random_bytes(8)),
        'label' => $label,
        'hash' => hash('sha256', $token),
        'prefix' => substr($token, 0, 8),
        'created' => gmdate('c'),
        'createdBy' => $owner['email'] ?? '',
        'lastUsed' => null,
        'revoked' => null,
    ];
    geobim_plugin_tokens_update(function (&$list) use ($rec) {
        $active = array_filter($list, function ($r) { return empty($r['revoked']); });
        if (count($active) >= GEOBIM_PLUGIN_TOKEN_MAX) {
            throw new RuntimeException('At most ' . GEOBIM_PLUGIN_TOKEN_MAX . ' tokens — revoke one first');
        }
        $list[] = $rec;
    });
    echo json_encode(array_merge(geobim_plugin_token_public($rec), ['token' => $token]));
} catch (RuntimeException $e) {
    fail($e->getMessage(), 409);
}
