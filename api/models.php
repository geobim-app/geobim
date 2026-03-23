<?php
// Auto-discover GLB/glTF models in the model/ directory
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
    ];
}

// Sort alphabetically by name
usort($models, function($a, $b) { return strcasecmp($a['name'], $b['name']); });

echo json_encode($models);
