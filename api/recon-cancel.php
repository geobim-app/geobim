<?php
// geoBIM.app — cancel a photo reconstruction job (owner only).
// A queued job is simply not handed out any more; a running one is stopped by
// the worker on its next status report (recon-worker.php answers cancel: true).
header('Content-Type: application/json');
require __DIR__ . '/_owner_auth.php';
require __DIR__ . '/_recon.php';
geobim_require_owner();   // owner session cookie (api/owner-session.php) or ID token

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'POST only']);
    exit;
}

$jobId = $_GET['job'] ?? '';
$dir = geobim_recon_job_dir($jobId);
if ($dir === null) {
    http_response_code(404);
    echo json_encode(['error' => 'Unknown job']);
    exit;
}
$st = geobim_read_json($dir . '/status.json') ?: ['status' => 'queued'];
if (!in_array($st['status'] ?? 'queued', ['queued', 'claimed', 'converting'], true)) {
    http_response_code(409);
    echo json_encode(['error' => 'Job is ' . $st['status']]);
    exit;
}
geobim_recon_set_status($dir, 'cancelled', ['message' => 'cancelled']);
$job = geobim_read_json($dir . '/job.json');
@unlink($dir . '/' . ($job['input'] ?? 'input.zip'));
echo json_encode(['cancelled' => $jobId]);
