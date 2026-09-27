<?php
// Auto-discover GLB/glTF models AND self-hosted 3D Tiles tilesets in model/
header('Content-Type: application/json');
header('Cache-Control: no-cache');
require __DIR__ . '/_owner_auth.php';
// Server models are the owner's; everyone else gets an empty list (and model/
// itself answers 404 to them, see model/.htaccess).
if (!geobim_is_owner()) {
    echo '[]';
    exit;
}

$modelDir = __DIR__ . '/../model';
$models = [];
// Placements saved in geobim.app (api/placement-save.php), keyed by GLB file name
$saved = json_decode(@file_get_contents($modelDir . '/placements.json') ?: '{}', true) ?: [];

foreach (glob($modelDir . '/*.{glb,gltf}', GLOB_BRACE) as $path) {
    $filename = basename($path);

    // Skip non-model files (e.g. tileset.gltf)
    if (stripos($filename, 'tileset') !== false) continue;

    // Generate ID from filename: remove extension, lowercase, replace non-alnum with underscore
    $name = pathinfo($filename, PATHINFO_FILENAME);
    $id = preg_replace('/[^a-z0-9]+/', '_', strtolower($name));
    $id = trim($id, '_');

    // Human-readable name: replace underscores/hyphens with spaces, title case
    $displayName = str_replace(['_', '-'], ' ', $name);
    $displayName = ucwords($displayName);

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

    $id = preg_replace('/[^a-z0-9]+/', '_', strtolower($folder));
    $id = trim($id, '_');

    $displayName = str_replace(['_', '-'], ' ', $folder);
    $displayName = ucwords($displayName);

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
