<?php
// geoBIM.app — create a share link for a saved scene. Owner, or a member for
// scenes with models of their own area (_members.php): those are entries
// "users/<area>/<name>". The owner can also share members' models.
//
// POST {sceneId, scene, include?: [index into scene.assets], label?,
//       expiresAt?: ISO date|null}
//   → {token, path: "/s/<token>", share: <record without snapshot>, warnings: []}
//
// The scene is frozen and cleaned here, on the server:
//   - only camera, assets and environment fields are kept (no Desktop paths,
//     nothing a customer must not see)
//   - only the models ticked in the share dialog ("include"; without it the
//     visible ones): a scene holds every model that was loaded when it was
//     saved, also hidden ones, which the customer could show again
//   - only self-hosted models that exist in this site's model/ are kept;
//     Cesium ion and iTwin assets and missing models go to "excluded"
//   - the environment is reduced to what works without Cesium ion: open
//     terrain (Mapterhorn / ArcGIS) and open basemaps (TopPlusOpen, Esri)
// Every replacement is reported in "warnings".
header('Content-Type: application/json');
header('Cache-Control: no-store');
require __DIR__ . '/_owner_auth.php';
require __DIR__ . '/_members.php';
require __DIR__ . '/_dev.php';
require __DIR__ . '/_shares.php';

function fail($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['error' => $message]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('POST only', 405);
$user = geobim_require_user();

$raw = file_get_contents('php://input');
if (strlen($raw) > 262144) fail('Request too large', 413);
$req = json_decode($raw, true);
if (!is_array($req)) fail('JSON body required');
$scene = $req['scene'] ?? null;
if (!is_array($scene)) fail('scene required');

$sceneId = $req['sceneId'] ?? ($scene['id'] ?? null);
if (!is_int($sceneId) && !(is_string($sceneId) && preg_match('/^[A-Za-z0-9_-]{1,64}$/', $sceneId))) fail('Invalid sceneId');
$label = trim((string)($req['label'] ?? ''));
if (mb_strlen($label) > 120) fail('Label too long (max 120)');

$expiresAt = null;
if (!empty($req['expiresAt'])) {
    $ts = strtotime((string)$req['expiresAt']);
    if ($ts === false) fail('Invalid expiresAt');
    if ($ts <= time()) fail('expiresAt must be in the future');
    if ($ts > time() + 2 * 365 * 86400) fail('expiresAt at most 2 years ahead');
    $expiresAt = gmdate('Y-m-d\TH:i:s\Z', $ts);
}

// Models ticked in the share dialog, as indices into scene.assets (null =
// the visible ones)
$include = null;
if (array_key_exists('include', $req)) {
    if (!is_array($req['include']) || count($req['include']) > 1000) fail('Invalid include');
    $include = [];
    foreach ($req['include'] as $i) {
        if (!is_int($i) || $i < 0) fail('Invalid include');
        $include[$i] = true;
    }
}

function finite_num($v) { return (is_int($v) || is_float($v)) && is_finite((float)$v); }

// --- Models the caller may share, by lower-case entry ---
// Owner: model/ (or the dev folder) by name, members' areas as
// "users/<area>/<name>". Member: their own area, by entry and by bare name.
function add_entries(&$entries, $dir, $entryPrefix, $bareKeys) {
    foreach (is_dir($dir) ? (scandir($dir) ?: []) : [] as $name) {
        if (!geobim_share_entry_name_valid($name)) continue;
        $path = $dir . '/' . $name;
        if (is_dir($path) && is_file($path . '/tileset.json')) $kind = 'tileset';
        elseif (is_file($path) && preg_match('/\.(glb|gltf)$/i', $name)) $kind = 'glb';
        else continue;
        $e = ['name' => $entryPrefix . $name, 'kind' => $kind];
        $entries[strtolower($e['name'])] = $e;
        if ($bareKeys && !isset($entries[strtolower($name)])) $entries[strtolower($name)] = $e;
    }
}
$entries = [];
if ($user['role'] === 'owner') {
    $modelDir = geobim_dev_model_dir() ?: str_replace('\\', '/', realpath(__DIR__ . '/../model') ?: '');
    if ($modelDir === '') fail('model/ missing on the server', 500);
    add_entries($entries, $modelDir, '', false);
    foreach (geobim_members() as $m) {
        add_entries($entries, geobim_area_dir($m['area']), GEOBIM_USERS_DIR . '/' . $m['area'] . '/', false);
    }
} else {
    add_entries($entries, geobim_area_dir($user['area']), GEOBIM_USERS_DIR . '/' . $user['area'] . '/', true);
}

// Entry of a scene's localPath: "users/<area>/<name>" for a web path into a
// member's area, else the folder (tileset) or file name (GLB) like scenes.js
// localKey() — the Desktop stores absolute Windows paths
function local_key($path) {
    $p = str_replace('\\', '/', explode('?', (string)$path)[0]);
    if (preg_match('#(?:^|/)model/(users/[a-z0-9_]{2,32}/[^/]+)#', $p, $m)) return rawurldecode($m[1]);
    $parts = array_values(array_filter(explode('/', $p), 'strlen'));
    if (!$parts) return '';
    $last = $parts[count($parts) - 1];
    $key = preg_match('/^tileset\.json$/i', $last) ? ($parts[count($parts) - 2] ?? '') : $last;
    return rawurldecode($key);
}

$warnings = [];
$assets = [];
$models = [];
$excluded = [];
$notSelected = 0;
foreach (is_array($scene['assets'] ?? null) ? array_values($scene['assets']) : [] as $i => $a) {
    if (!is_array($a)) continue;
    $name = mb_substr(trim((string)($a['name'] ?? '')), 0, 200);
    $local = (string)($a['localPath'] ?? '');
    if (!empty($a['iTwinIModelId'])) {
        $excluded[] = ['name' => $name, 'reason' => 'iTwin model'];
        continue;
    }
    if ($local === '') {
        $excluded[] = ['name' => $name ?: ('Asset ' . ($a['ionAssetId'] ?? '?')), 'reason' => 'Cesium ion asset'];
        continue;
    }
    $chosen = $include !== null ? isset($include[$i]) : (($a['bVisible'] ?? true) !== false);
    if (!$chosen) {
        $excluded[] = ['name' => $name ?: local_key($local), 'reason' => 'not selected'];
        $notSelected++;
        continue;
    }
    $key = local_key($local);
    $entry = $entries[strtolower($key)] ?? null;
    if (!$entry) {
        $excluded[] = ['name' => $name ?: $key, 'reason' => 'not on this server'];
        continue;
    }
    if (!in_array($entry['name'], $models, true)) $models[] = $entry['name'];
    $assets[] = [
        'ionAssetId' => finite_num($a['ionAssetId'] ?? null) ? $a['ionAssetId'] : 0,
        'name' => $name ?: $entry['name'],
        'type' => $entry['kind'] === 'tileset' ? '3DTILES' : 'GLTF',
        'bVisible' => ($a['bVisible'] ?? true) !== false,
        'localPath' => 'model/' . $entry['name'] . ($entry['kind'] === 'tileset' ? '/tileset.json' : ''),
    ];
}
if (!$models) fail($notSelected
    ? 'No model selected that can be shared from this server'
    : 'The scene has no model that can be shared from this server (only self-hosted models can be shared)');
foreach ($excluded as $x) {
    if ($x['reason'] !== 'not selected') $warnings[] = '"' . $x['name'] . '" left out (' . $x['reason'] . ')';
}

// --- Camera ---
$cam = $scene['cameraLongitudeLatitudeHeight'] ?? null;
if (!is_array($cam) || !finite_num($cam['x'] ?? null) || !finite_num($cam['y'] ?? null) || !finite_num($cam['z'] ?? null)) {
    fail('The scene has no valid camera position');
}

// --- Environment: what works without Cesium ion ---
$OPEN_BASEMAPS = ['topplus', 'topplus-grey', 'basemapde-color', 'basemapde-grey',
    'bayern-dop20', 'bayern-dok', 'bayern-dtk25', 'bayern-parcels', 'bayern-relief',
    'esri-imagery', 'esri-streets', 'esri-topo', 'esri-light-gray', 'esri-dark-gray', 'none'];
$OPEN_TERRAIN = ['mapterhorn', 'arcgis-elevation'];
$webBasemap = (string)($scene['webBasemap'] ?? '');
if (!in_array($webBasemap, $OPEN_BASEMAPS, true)) {
    $warnings[] = 'Basemap ' . ($webBasemap !== '' ? '"' . $webBasemap . '"' : '(Cesium ion)') . ' replaced by TopPlusOpen (no Cesium ion in shared links)';
    $webBasemap = 'topplus';
}
if (($scene['basemap'] ?? '') === 'GooglePhotorealistic') $warnings[] = 'Google 3D Tiles left out (no Cesium ion in shared links)';
$terrain = strtolower(trim((string)($scene['terrain'] ?? '')));
if (!in_array($terrain, $OPEN_TERRAIN, true)) {
    $warnings[] = 'Terrain replaced by Mapterhorn (no Cesium ion in shared links)';
    $terrain = 'mapterhorn';
}

$snapshot = [
    'version' => 1,
    'id' => $sceneId,
    'name' => mb_substr(trim((string)($scene['name'] ?? 'Scene')), 0, 200) ?: 'Scene',
    'modified' => (string)($scene['modified'] ?? ''),
    'cameraLongitudeLatitudeHeight' => ['x' => (float)$cam['x'], 'y' => (float)$cam['y'], 'z' => (float)$cam['z']],
    'cameraYaw' => finite_num($scene['cameraYaw'] ?? null) ? (float)$scene['cameraYaw'] : 0,
    'cameraPitch' => finite_num($scene['cameraPitch'] ?? null) ? (float)$scene['cameraPitch'] : -45,
    'assets' => $assets,
    'basemap' => 'WorldTerrain',
    'imageryAssetId' => 0,
    'terrainAssetId' => 1,
    'terrain' => $terrain,
    'webBasemap' => $webBasemap,
];
foreach (['solarTime', 'month', 'day'] as $k) {
    if (finite_num($scene[$k] ?? null)) $snapshot[$k] = $scene[$k];
}

$dir = geobim_shares_dir(true);
if (!is_dir($dir) || !is_writable($dir)) fail('Share store not writable', 500);
$token = null;
for ($i = 0; $i < 5 && $token === null; $i++) {
    $t = geobim_share_new_token();
    $fh = @fopen(geobim_share_path($t), 'x');   // never overwrite an existing link
    if ($fh) { fclose($fh); $token = $t; }
}
if ($token === null) fail('Could not create a link', 500);

$rec = [
    'v' => 1,
    'token' => $token,
    'sceneId' => $sceneId,
    'sceneName' => $snapshot['name'],
    'label' => $label,
    'createdAt' => gmdate('Y-m-d\TH:i:s\Z'),
    'createdBy' => $user['email'] ?? '',
    'expiresAt' => $expiresAt,
    'revokedAt' => null,
    'models' => $models,
    'excluded' => $excluded,
    'snapshot' => $snapshot,
];
if (!geobim_write_json_atomic(geobim_share_path($token), $rec)) {
    @unlink(geobim_share_path($token));
    fail('Write failed', 500);
}

echo json_encode([
    'token' => $token,
    'path' => '/s/' . $token,
    'share' => geobim_share_public_info($rec),
    'warnings' => $warnings,
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
