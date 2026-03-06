<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$trigger = '/opt/frost/damage_trigger.txt';
touch($trigger);
echo json_encode(['ok' => true, 'message' => 'Damage event triggered']);
