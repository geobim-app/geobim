<?php
// Auto-discover GLB/glTF models AND self-hosted 3D Tiles tilesets in model/
// and in the members' areas model/users/<area>/ (_members.php)
header('Content-Type: application/json');
header('Cache-Control: no-cache');
require __DIR__ . '/_owner_auth.php';
require __DIR__ . '/_members.php';
require __DIR__ . '/_dev.php';
require __DIR__ . '/_guest_models.php';
require __DIR__ . '/_shares.php';
// Local development: a folder of tilesets instead of model/ (see _dev.php)
$devDir = geobim_dev_model_dir();
$modelDir = $devDir ?: __DIR__ . '/../model';

// Display names: model-names.json (per area) maps a GLB file / tileset folder
// name to the name shown in the app (e.g. {"siegtalbruecke_4d_tiled": "Siegtalbrücke 4D"});
// the file/folder name stays the id that scenes, placements and
// guest-models.json refer to. Without an alias: the name without "(IFC)".
function geobim_model_name($key, $fallback, $aliases) {
    if (isset($aliases[$key]) && is_string($aliases[$key]) && trim($aliases[$key]) !== '') return trim($aliases[$key]);
    return trim(preg_replace('/\s*\(IFC\)\s*$/i', '', $fallback)) ?: $fallback;
}

// The models of one area.
//   $dir     — model/ or model/users/<area>/
//   $prefix  — URL path of $dir ("model/", "model/users/<area>/")
//   $only    — names in $dir to list, null = all
//   $area    — member area (null = model/ itself); goes into each entry so
//              placement-save.php / pointcloud-delete.php know where it lives
//   $idPrefix, $namePrefix — keep a member's models apart in the owner's list
function geobim_list_models($dir, $prefix, $only, $area, $idPrefix = '', $namePrefix = '') {
    $models = [];
    if (!is_dir($dir)) return $models;
    $aliases = json_decode(@file_get_contents($dir . '/model-names.json') ?: '{}', true) ?: [];
    // Placements saved in geobim.app (api/placement-save.php), keyed by GLB file name
    $saved = json_decode(@file_get_contents($dir . '/placements.json') ?: '{}', true) ?: [];
    $extra = $area !== null ? ['area' => $area] : [];

    foreach (glob($dir . '/*.{glb,gltf}', GLOB_BRACE) ?: [] as $path) {
        $filename = basename($path);
        if ($only !== null && !in_array($filename, $only, true)) continue;

        // Skip non-model files (e.g. tileset.gltf)
        if (stripos($filename, 'tileset') !== false) continue;

        // Generate ID from filename: remove extension, lowercase, replace non-alnum with underscore
        $name = pathinfo($filename, PATHINFO_FILENAME);
        $id = trim(preg_replace('/[^a-z0-9]+/', '_', strtolower($name)), '_');

        // Human-readable name: replace underscores/hyphens with spaces, title case
        $displayName = geobim_model_name($filename, ucwords(str_replace(['_', '-'], ' ', $name)), $aliases);

        $entry = [
            'id'   => $idPrefix . $id,
            'name' => $namePrefix . $displayName,
            'file' => $prefix . $filename,
            'size' => filesize($path),
            'type' => 'GLB',
        ] + $extra + ($area !== null ? ['entry' => $filename] : []);
        if (isset($saved[$filename])) $entry['savedPlacement'] = $saved[$filename];
        $models[] = $entry;
    }

    // Self-hosted 3D Tiles tilesets — one level deep, e.g. model/hotel_tiled/tileset.json
    // (py3dtiles or similar output, not routed through Ion). The containing folder name
    // becomes the id/display name, same convention as the GLB files above.
    foreach (glob($dir . '/*/tileset.json') ?: [] as $path) {
        $folder = basename(dirname($path));
        if ($only !== null && !in_array($folder, $only, true)) continue;

        $id = trim(preg_replace('/[^a-z0-9]+/', '_', strtolower($folder)), '_');
        $displayName = geobim_model_name($folder, ucwords(str_replace(['_', '-'], ' ', $folder)), $aliases);

        $models[] = [
            'id'   => $idPrefix . $id,
            'name' => $namePrefix . $displayName,
            // ?v=mtime: a saved placement rewrites tileset.json, so a cached
            // copy must not bring back the old position
            'file' => $prefix . $folder . '/tileset.json?v=' . filemtime($path),
            'size' => filesize($path),
            'type' => 'TILESET',
        ] + $extra + ($area !== null ? ['entry' => $folder] : []);
    }
    return $models;
}

// The owner's list prefixes members' models: "<label>: <name>", id "<area>__<id>"
// (models.php ids never contain "__" otherwise)
function geobim_member_prefixes($m) {
    return [$m['area'] . '__', $m['label'] . ': '];
}

$models = [];
if ($devDir) {
    $models = geobim_list_models($devDir, 'model/', null, null);
} elseif (geobim_is_owner()) {
    // Server models are the owner's, plus every member's area
    $models = geobim_list_models($modelDir, 'model/', null, null);
    foreach (geobim_members() as $m) {
        [$idp, $namep] = geobim_member_prefixes($m);
        $models = array_merge($models, geobim_list_models(geobim_area_dir($m['area']),
            'model/' . GEOBIM_USERS_DIR . '/' . $m['area'] . '/', null, $m['area'], $idp, $namep));
    }
} else {
    // A member: their own area. Everyone (members too): the entries of
    // model/guest-models.json and of share links opened in this browser
    // (model-file.php serves no others, 404).
    $member = geobim_session_user();
    if ($member && $member['role'] === 'member') {
        $models = geobim_list_models(geobim_area_dir($member['area']),
            'model/' . GEOBIM_USERS_DIR . '/' . $member['area'] . '/', null, $member['area']);
    }
    $top = geobim_guest_models($modelDir);
    $byArea = [];
    foreach (geobim_share_models() as $entry) {
        $parts = explode('/', $entry);
        if (count($parts) === 3) $byArea[$parts[1]][] = $parts[2];
        else $top[] = $entry;
    }
    $top = array_values(array_unique($top));
    if ($top) $models = array_merge($models, geobim_list_models($modelDir, 'model/', $top, null));
    foreach ($byArea as $area => $names) {
        if (!geobim_area_valid($area) || ($member && $member['area'] === $area)) continue;   // own area listed above
        $m = geobim_member_by_area($area);
        if (!$m) continue;
        [$idp] = geobim_member_prefixes($m);
        $models = array_merge($models, geobim_list_models(geobim_area_dir($area),
            'model/' . GEOBIM_USERS_DIR . '/' . $area . '/', array_values(array_unique($names)), $area, $idp));
    }
}

// Sort alphabetically by name
usort($models, function($a, $b) { return strcasecmp($a['name'], $b['name']); });

echo json_encode($models);
