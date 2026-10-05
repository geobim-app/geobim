<?php
// geoBIM.app — save (or reset) the placement of a self-hosted model. Owner only
// (Firebase ID token, see _owner_auth.php).
//
//   {kind: "tileset", folder, transform: [16], placement: {lon, lat, height, heading}}
//     root.transform of model/<folder>/tileset.json := transform (ECEF,
//     column-major). The tileset-local frame is untouched, so alignments.json
//     and the tiles stay valid. The first save keeps the original transform
//     and placement in asset.extras.placementOriginal for reset.
//   {kind: "glb", file, placement: {lon, lat, height, heading, scale}}
//     stored in model/placements.json; api/models.php hands it out as the
//     model's default position/heading/scale.
//   add "reset": true to either to go back to the original.
header('Content-Type: application/json');
require __DIR__ . '/_owner_auth.php';

function fail($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['error' => $message]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('POST only', 405);
$user = geobim_require_owner();

$req = json_decode(file_get_contents('php://input'), true);
if (!is_array($req)) fail('JSON body required');
$modelDir = realpath(__DIR__ . '/../model');
$reset = !empty($req['reset']);

function finite_num($v) { return (is_int($v) || is_float($v)) && is_finite((float)$v); }

// A file or folder name directly in model/ as api/models.php lists it: any
// name (spaces, brackets, umlauts, "+") except path separators, control
// characters and hidden / internal entries (".", "_staging"). The realpath
// check below keeps it inside model/.
function valid_entry_name($name) {
    return is_string($name) && $name !== '' && strlen($name) <= 255
        && mb_check_encoding($name, 'UTF-8')
        && !preg_match('#[/\\\\\x00-\x1F\x7F]#', $name)
        && $name[0] !== '.' && $name[0] !== '_';
}

function write_json_atomic($path, $data) {
    $tmp = $path . '.tmp-' . getmypid();
    if (file_put_contents($tmp, json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)) === false) return false;
    return rename($tmp, $path);
}

function clean_placement($p, $withScale) {
    if (!is_array($p)) fail('placement required');
    $out = [];
    foreach (['lon' => [-180, 180], 'lat' => [-90, 90], 'height' => [-1000, 10000], 'heading' => [-720, 720]] as $k => [$lo, $hi]) {
        if (!finite_num($p[$k] ?? null) || $p[$k] < $lo || $p[$k] > $hi) fail("placement.$k out of range");
        $out[$k] = (float)$p[$k];
    }
    if ($withScale) {
        $s = $p['scale'] ?? 1;
        if (!finite_num($s) || $s <= 0 || $s > 1000) fail('placement.scale out of range');
        $out['scale'] = (float)$s;
    }
    return $out;
}

$stamp = ['savedAt' => gmdate('c'), 'savedBy' => $user['email']];

if (($req['kind'] ?? '') === 'tileset') {
    $folder = $req['folder'] ?? '';
    if (!valid_entry_name($folder)) fail('Invalid folder');
    $dir = realpath($modelDir . '/' . $folder);
    if ($dir === false || dirname($dir) !== $modelDir || !is_file("$dir/tileset.json")) fail('Not found', 404);
    $path = "$dir/tileset.json";
    $ts = json_decode(file_get_contents($path), true);
    if (!is_array($ts) || !isset($ts['root'])) fail('Unreadable tileset.json', 500);
    $extras = $ts['asset']['extras'] ?? [];

    if ($reset) {
        $orig = $extras['placementOriginal'] ?? null;
        if (!$orig) fail('Nothing to reset');
        if (isset($orig['transform'])) $ts['root']['transform'] = $orig['transform'];
        else unset($ts['root']['transform']);
        $extras['placement'] = $orig['placement'] ?? null;
        unset($extras['placementOriginal']);
    } else {
        $m = $req['transform'] ?? null;
        if (!is_array($m) || count($m) !== 16) fail('transform must be 16 numbers');
        foreach ($m as $v) if (!finite_num($v)) fail('transform must be finite');
        // a rigid ENU frame on the earth: orthonormal rotation, origin near the surface
        for ($c = 0; $c < 3; $c++) {
            $len = sqrt($m[4*$c]**2 + $m[4*$c+1]**2 + $m[4*$c+2]**2);
            if (abs($len - 1) > 1e-6) fail('transform rotation must be orthonormal');
        }
        $r = sqrt($m[12]**2 + $m[13]**2 + $m[14]**2);
        if ($r < 6.34e6 || $r > 6.40e6) fail('transform origin is not near the earth surface');
        if (abs($m[3]) + abs($m[7]) + abs($m[11]) > 1e-9 || abs($m[15] - 1) > 1e-9) fail('transform must be affine');
        if (!isset($extras['placementOriginal'])) {
            $extras['placementOriginal'] = ['placement' => $extras['placement'] ?? null];
            if (isset($ts['root']['transform'])) $extras['placementOriginal']['transform'] = $ts['root']['transform'];
        }
        $ts['root']['transform'] = array_map('floatval', $m);
        $prev = $extras['placement'] ?? [];
        $extras['placement'] = array_merge(
            clean_placement($req['placement'] ?? null, false),
            ['source' => 'saved in geobim.app', 'local_offset' => $prev['local_offset'] ?? ($extras['placementOriginal']['placement']['local_offset'] ?? [0, 0, 0])],
            $stamp
        );
    }
    $ts['asset']['extras'] = $extras;
    if (!write_json_atomic($path, $ts)) fail('Write failed', 500);
    echo json_encode(['saved' => $folder, 'reset' => $reset, 'placement' => $extras['placement']]);
    exit;
}

if (($req['kind'] ?? '') === 'glb') {
    $file = $req['file'] ?? '';
    if (!valid_entry_name($file) || !preg_match('/\.(glb|gltf)$/i', $file)) fail('Invalid file');
    $real = realpath($modelDir . '/' . $file);
    if ($real === false || dirname($real) !== $modelDir) fail('Not found', 404);
    $store = "$modelDir/placements.json";
    $fh = fopen($store, 'c+');
    if (!$fh || !flock($fh, LOCK_EX)) fail('Store locked', 500);
    $all = json_decode(stream_get_contents($fh) ?: '{}', true) ?: [];
    if ($reset) unset($all[$file]);
    else $all[$file] = array_merge(clean_placement($req['placement'] ?? null, true), $stamp);
    ftruncate($fh, 0); rewind($fh);
    fwrite($fh, json_encode($all, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    fflush($fh); flock($fh, LOCK_UN); fclose($fh);
    echo json_encode(['saved' => $file, 'reset' => $reset, 'placement' => $all[$file] ?? null]);
    exit;
}

fail('kind must be tileset or glb');
