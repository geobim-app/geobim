<?php
// Auto-discover GLB/glTF models AND self-hosted 3D Tiles tilesets in model/
header('Content-Type: application/json');
header('Cache-Control: no-cache');
require __DIR__ . '/_owner_auth.php';
require __DIR__ . '/_dev.php';
require __DIR__ . '/_guest_models.php';
// Local development: a folder of tilesets instead of model/ (see _dev.php)
$devDir = geobim_dev_model_dir();
$modelDir = $devDir ?: __DIR__ . '/../model';
// Server models are the owner's; everyone else gets only the entries of
// model/guest-models.json (model-file.php serves no others, 404).
$guestList = (!$devDir && !geobim_is_owner()) ? geobim_guest_models($modelDir) : null;
if ($guestList !== null && !$guestList) {
    echo '[]';
    exit;
}
$models = [];
// Display names: model/model-names.json maps a GLB file / tileset folder name
// to the name shown in the app (e.g. {"siegtalbruecke_4d_tiled": "Siegtalbrücke 4D"});
// the file/folder name stays the id that scenes, placements and
// guest-models.json refer to. Without an alias: the name without "(IFC)".
$aliases = json_decode(@file_get_contents($modelDir . '/model-names.json') ?: '{}', true) ?: [];
function geobim_model_name($key, $fallback, $aliases) {
    if (isset($aliases[$key]) && is_string($aliases[$key]) && trim($aliases[$key]) !== '') return trim($aliases[$key]);
    return trim(preg_replace('/\s*\(IFC\)\s*$/i', '', $fallback)) ?: $fallback;
}
// Placements saved in geobim.app (api/placement-save.php), keyed by GLB file name
$saved = json_decode(@file_get_contents($modelDir . '/placements.json') ?: '{}', true) ?: [];

foreach (glob($modelDir . '/*.{glb,gltf}', GLOB_BRACE) as $path) {
    $filename = basename($path);
    if ($guestList !== null && !in_array($filename, $guestList, true)) continue;

    // Skip non-model files (e.g. tileset.gltf)
    if (stripos($filename, 'tileset') !== false) continue;

    // Generate ID from filename: remove extension, lowercase, replace non-alnum with underscore
    $name = pathinfo($filename, PATHINFO_FILENAME);
    $id = preg_replace('/[^a-z0-9]+/', '_', strtolower($name));
    $id = trim($id, '_');

    // Human-readable name: replace underscores/hyphens with spaces, title case
    $displayName = str_replace(['_', '-'], ' ', $name);
    $displayName = geobim_model_name($filename, ucwords($displayName), $aliases);

    $models[] = [
        'id'   => $id,
        'name' => $displayName,
        'file' => 'model/' . $filename,
        'size' => filesize($path),
        'type' => 'GLB',
    ];
    if (isset($saved[$filename])) {
        $models[count($models) - 1]['savedPlacement'] = $saved[$filename];
    }
}

// Self-hosted 3D Tiles tilesets — one level deep, e.g. model/hotel_tiled/tileset.json
// (py3dtiles or similar output, not routed through Ion). The containing folder name
// becomes the id/display name, same convention as the GLB files above.
foreach (glob($modelDir . '/*/tileset.json') as $path) {
    $folder = basename(dirname($path));
    if ($guestList !== null && !in_array($folder, $guestList, true)) continue;

    $id = preg_replace('/[^a-z0-9]+/', '_', strtolower($folder));
    $id = trim($id, '_');

    $displayName = str_replace(['_', '-'], ' ', $folder);
    $displayName = geobim_model_name($folder, ucwords($displayName), $aliases);

    $models[] = [
        'id'   => $id,
        'name' => $displayName,
        // ?v=mtime: a saved placement rewrites tileset.json, so a cached
        // copy must not bring back the old position
        'file' => 'model/' . $folder . '/tileset.json?v=' . filemtime($path),
        'size' => filesize($path),
        'type' => 'TILESET',
    ];
}

// Sort alphabetically by name
usort($models, function($a, $b) { return strcasecmp($a['name'], $b['name']); });

echo json_encode($models);
