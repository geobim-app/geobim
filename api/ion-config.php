<?php
/**
 * geoBIM.app — Cesium Ion Default Token Endpoint
 *
 * Returns the default (demo) Cesium Ion access token.
 * Keeps the token server-side instead of hardcoded in JS source.
 *
 * Licensed under the Business Source License 1.1 (BSL 1.1)
 */

header('Content-Type: application/json');
header('Cache-Control: no-store');

// Default demo token — geobim.app Ion account
$token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI4ZGM1ZDdlNi02ZDFhLTRkMGItYTNhNy0wZTRiM2RhZWFlNWUiLCJpZCI6Mzg3NDE4LCJpYXQiOjE3NzAyOTk1MTR9.kdRP3yJ-1NV3Y0vccI14W8-1oeVKOVoOUQAfkjeBCg0';

echo json_encode([
    'token' => $token,
    'name'  => 'geobim.app Demo'
]);
