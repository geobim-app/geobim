<?php
// geoBIM.app — member areas: signed-in accounts with a model area of their own.
//
// The list lives on the server only, in /etc/geobim/members.json (not in git:
// the repo is public and these are other people's addresses), keyed by the
// account's email:
//   {"someone@example.com": {"area": "smith", "label": "Smith",
//                            "uid": "<Firebase uid, optional>", "quota_gb": 10}}
//   area     — folder name model/users/<area>/, [a-z0-9_]{2,32}, unique
//   label    — prefix of the member's models in the owner's model list
//   uid      — if set, only this Firebase account gets the area, not another
//              one that happens to carry the same address
//   quota_gb — disk space of the area (default GEOBIM_MEMBER_QUOTA_GB)
//
// model/users/<area>/ has the layout of model/ itself: GLBs, tileset folders,
// placements.json, model-names.json, _staging/ (the converter puts a job's
// result next to its _staging/, so it lands in the area by itself). Members
// see, upload, position, delete and share their own models only; the owner
// sees all areas as well. The session cookie (_owner_auth.php) carries just
// the email; owner or member is decided on every request, so removing an
// entry here takes effect at once.
require_once __DIR__ . '/_owner_auth.php';

const GEOBIM_MEMBERS_FILE = '/etc/geobim/members.json';
const GEOBIM_MEMBER_QUOTA_GB = 10;
const GEOBIM_USERS_DIR = 'users';   // model/users/<area>/

function geobim_area_valid($area) {
    return is_string($area) && preg_match('/^[a-z0-9_]{2,32}$/', $area) === 1;
}

// email => ['email', 'area', 'label', 'uid', 'quota_bytes']
function geobim_members() {
    static $members = null;
    if ($members !== null) return $members;
    $members = [];
    $areas = [];
    $raw = json_decode(@file_get_contents(GEOBIM_MEMBERS_FILE) ?: '{}', true);
    foreach (is_array($raw) ? $raw : [] as $email => $m) {
        if (!is_string($email) || !is_array($m)) continue;
        $email = strtolower(trim($email));
        $area = $m['area'] ?? '';
        if ($email === '' || !geobim_area_valid($area) || isset($areas[$area])) continue;
        if (in_array($email, GEOBIM_OWNER_EMAILS, true)) continue;   // the owner has model/ itself
        $areas[$area] = true;
        $label = is_string($m['label'] ?? null) ? trim($m['label']) : '';
        $quota = is_numeric($m['quota_gb'] ?? null) ? max(0, (float)$m['quota_gb']) : GEOBIM_MEMBER_QUOTA_GB;
        $members[$email] = [
            'email' => $email,
            'area' => $area,
            'label' => $label !== '' ? (function_exists('mb_substr') ? mb_substr($label, 0, 40) : substr($label, 0, 40)) : $area,
            'uid' => is_string($m['uid'] ?? null) && $m['uid'] !== '' ? $m['uid'] : null,
            'quota_bytes' => (int)($quota * 1024 * 1024 * 1024),
        ];
    }
    return $members;
}

function geobim_member_by_area($area) {
    foreach (geobim_members() as $m) {
        if ($m['area'] === $area) return $m;
    }
    return null;
}

// The site's model/ with "/" separators (also on Windows, dev)
function geobim_model_root() {
    $real = realpath(__DIR__ . '/../model');
    return str_replace('\\', '/', $real !== false ? $real : __DIR__ . '/../model');
}

function geobim_area_dir($area, $create = false) {
    $dir = geobim_model_root() . '/' . GEOBIM_USERS_DIR . '/' . $area;
    if ($create && !is_dir($dir)) @mkdir($dir, 0775, true);
    return $dir;
}

// Caller as owner or member, or null. $uid: Firebase uid when known (ID token)
function geobim_user_for_email($email, $via, $uid = null) {
    $email = strtolower((string)$email);
    if (in_array($email, GEOBIM_OWNER_EMAILS, true)) {
        return ['email' => $email, 'role' => 'owner', 'via' => $via, 'area' => null, 'label' => '', 'member' => null];
    }
    $m = geobim_members()[$email] ?? null;
    if (!$m) return null;
    if ($uid !== null && $m['uid'] !== null && $uid !== $m['uid']) return null;
    return ['email' => $email, 'role' => 'member', 'via' => $via, 'area' => $m['area'], 'label' => $m['label'], 'member' => $m];
}

// Caller for a verified ID token's payload, or null. The address counts only
// once Firebase has verified it (geobim_token_email_verified); a member entry
// bound to this uid needs no such proof, the uid is the account itself
// (geobim_user_for_email has already refused any other uid).
function geobim_user_for_token($payload) {
    $u = geobim_user_for_email($payload['email'] ?? '', 'token', $payload['sub'] ?? null);
    if (!$u) return null;
    $uidBound = $u['role'] === 'member' && $u['member']['uid'] !== null;
    return ($uidBound || geobim_token_email_verified($payload)) ? $u : null;
}

function geobim_session_user() {
    $email = geobim_cookie_email();
    return $email !== null ? geobim_user_for_email($email, 'cookie') : null;
}

function geobim_is_member() {
    $u = geobim_session_user();
    return $u !== null && $u['role'] === 'member';
}

// Like geobim_require_owner(), but members pass too. Plugin tokens stay the
// owner's ($opts['plugin'], see _plugin_tokens.php).
function geobim_require_user($opts = []) {
    $u = geobim_session_user();
    if ($u) return $u;
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (!preg_match('/^Bearer\s+(\S+)$/', $auth, $m)) {
        http_response_code(401);
        echo json_encode(['error' => 'Sign-in required']);
        exit;
    }
    if (strncmp($m[1], 'gbp_', 4) === 0) {
        $owner = geobim_require_owner($opts);
        return ['email' => $owner['email'], 'role' => 'owner', 'via' => 'plugin-token', 'area' => null, 'label' => '', 'member' => null];
    }
    $payload = geobim_verify_firebase_token($m[1]);
    if (!$payload) {
        http_response_code(401);
        echo json_encode(['error' => 'Invalid or expired sign-in']);
        exit;
    }
    $u = geobim_user_for_token($payload);
    if (!$u) {
        http_response_code(403);
        echo json_encode(['error' => 'No model area for this account']);
        exit;
    }
    return $u;
}

// The model area a request works on: the caller's own (owner: model/,
// member: model/users/<area>/) or, for the owner, a member's area named in
// $area. A member naming another area gets 404 (don't reveal what exists).
// Returns ['dir', 'area' (null = model/ itself), 'prefix' (URL path)].
function geobim_target_area($user, $area = null, $create = false) {
    $area = ($area === null || $area === '') ? null : (string)$area;
    if ($area === null && $user['role'] === 'member') $area = $user['area'];
    if ($area === null) {
        return ['dir' => geobim_model_root(), 'area' => null, 'prefix' => 'model/'];
    }
    $allowed = geobim_area_valid($area) && geobim_member_by_area($area) !== null
        && ($user['role'] === 'owner' || $user['area'] === $area);
    if (!$allowed) {
        http_response_code(404);
        echo json_encode(['error' => 'Not found']);
        exit;
    }
    return ['dir' => geobim_area_dir($area, $create), 'area' => $area,
            'prefix' => 'model/' . GEOBIM_USERS_DIR . '/' . $area . '/'];
}

// Disk space an area uses (bytes), for the quota
function geobim_dir_bytes($dir) {
    if (!is_dir($dir)) return 0;
    $total = 0;
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $f) {
        if ($f->isFile()) $total += $f->getSize();
    }
    return $total;
}
