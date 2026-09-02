<?php
// Auto-discover GLB/glTF models AND self-hosted 3D Tiles tilesets in model/
header('Content-Type: application/json');
header('Cache-Control: no-cache');

$modelDir = __DIR__ . '/../model';
$models = [];

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
        'file' => 'model/' . $folder . '/tileset.json',
        'size' => filesize($path),
        'type' => 'TILESET',
    ];
}

// Sort alphabetically by name
usort($models, function($a, $b) { return strcasecmp($a['name'], $b['name']); });

echo json_encode($models);
