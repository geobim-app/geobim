<?php
// geoBIM.app — create a share link for a saved scene. Owner only.
//
// POST {sceneId, scene, label?, expiresAt?: ISO date|null}
//   → {token, path: "/s/<token>", share: <record without snapshot>, warnings: []}
//
// The scene is frozen and cleaned here, on the server:
//   - only camera, assets and environment fields are kept (no Desktop paths,
//     nothing a customer must not see)
//   - only self-hosted models that exist in this site's model/ are kept;
//     Cesium ion and iTwin assets and missing models go to "excluded"
//   - the environment is reduced to what works without Cesium ion: open
//     terrain (Mapterhorn / ArcGIS) and open basemaps (TopPlusOpen, Esri)
// Every replacement is reported in "warnings".
header('Content-Type: application/json');
header('Cache-Control: no-store');
require __DIR__ . '/_owner_auth.php';
require __DIR__ . '/_dev.php';
require __DIR__ . '/_shares.php';

function fail($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['error' => $message]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('POST only', 405);
$user = geobim_require_owner();

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

function finite_num($v) { return (is_int($v) || is_float($v)) && is_finite((float)$v); }

// --- Models in this site's model/ (or the dev folder), by lower-case name ---
$modelDir = geobim_dev_model_dir() ?: str_replace('\\', '/', realpath(__DIR__ . '/../model') ?: '');
if ($modelDir === '') fail('model/ missing on the server', 500);
$entries = [];
foreach (scandir($modelDir) ?: [] as $name) {
    if (!geobim_share_entry_name_valid($name)) continue;
    $path = $modelDir . '/' . $name;
    if (is_dir($path) && is_file($path . '/tileset.json')) $entries[strtolower($name)] = ['name' => $name, 'kind' => 'tileset'];
    elseif (is_file($path) && preg_match('/\.(glb|gltf)$/i', $name)) $entries[strtolower($name)] = ['name' => $name, 'kind' => 'glb'];
}

// Folder (tileset) or file name (GLB) of a scene's localPath, like scenes.js localKey()
function local_key($path) {
    $parts = array_values(array_filter(explode('/', str_replace('\\', '/', explode('?', (string)$path)[0])), 'strlen'));
    if (!$parts) return '';
    $last = $parts[count($parts) - 1];
    $key = preg_match('/^tileset\.json$/i', $last) ? ($parts[count($parts) - 2] ?? '') : $last;
    return rawurldecode($key);
}

$warnings = [];
$assets = [];
$models = [];
$excluded = [];
foreach (is_array($scene['assets'] ?? null) ? $scene['assets'] : [] as $a) {
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
if (!$models) fail('The scene has no model that can be shared from this server (only self-hosted models can be shared)');
foreach ($excluded as $x) $warnings[] = '"' . $x['name'] . '" left out (' . $x['reason'] . ')';

// --- Camera ---
$cam = $scene['cameraLongitudeLatitudeHeight'] ?? null;
if (!is_array($cam) || !finite_num($cam['x'] ?? null) || !finite_num($cam['y'] ?? null) || !finite_num($cam['z'] ?? null)) {
    fail('The scene has no valid camera position');
}

// --- Environment: what works without Cesium ion ---
$OPEN_BASEMAPS = ['topplus', 'esri-imagery', 'esri-streets', 'esri-topo', 'none'];
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
