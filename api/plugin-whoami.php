<?php
// geoBIM.app — "Test connection" for the Rhino plugin: checks the plugin
// token and tells the plugin what the server accepts.
header('Content-Type: application/json');
header('Cache-Control: no-store');
require __DIR__ . '/_owner_auth.php';
$who = geobim_require_owner(['plugin' => true]);

echo json_encode([
    'ok' => true,
    'via' => $who['via'] ?? '',
    'label' => $who['label'] ?? null,
    'formats' => ['ifc'],
    'maxUploadBytes' => 3 * 1024 * 1024 * 1024,
    'replace' => true,
]);
