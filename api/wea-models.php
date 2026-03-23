<?php
// Auto-discover WEA GLB models in model/wind/
header('Content-Type: application/json');
header('Cache-Control: no-cache');

$modelDir = __DIR__ . '/../model/wind';
$models = [];

if (!is_dir($modelDir)) {
    echo json_encode($models);
    exit;
}

foreach (glob($modelDir . '/*.{glb,gltf}', GLOB_BRACE) as $path) {
    $filename = basename($path);
    $name = pathinfo($filename, PATHINFO_FILENAME);
    $id = preg_replace('/[^a-z0-9]+/', '_', strtolower($name));
    $id = trim($id, '_');
    $displayName = str_replace(['_', '-'], ' ', $name);
    $displayName = ucwords($displayName);

    $models[] = [
        'id'   => $id,
        'name' => $displayName,
        'file' => 'model/wind/' . $filename,
        'size' => filesize($path),
    ];
}

usort($models, function($a, $b) { return strcasecmp($a['name'], $b['name']); });
echo json_encode($models);
