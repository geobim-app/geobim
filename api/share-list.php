<?php
// geoBIM.app — the share links of this site, newest first. Owner only.
// GET [?sceneId=<id>] → [{token, path, sceneId, sceneName, label, createdAt,
//                         expiresAt, revokedAt, state, models, excluded}]
header('Content-Type: application/json');
header('Cache-Control: no-store');
require __DIR__ . '/_owner_auth.php';
require __DIR__ . '/_shares.php';

geobim_require_owner();

$sceneId = $_GET['sceneId'] ?? null;
$out = [];
foreach (glob(geobim_shares_dir() . '/*.json') ?: [] as $file) {
    $rec = geobim_share_load(basename($file, '.json'));
    if (!$rec) continue;
    if ($sceneId !== null && (string)($rec['sceneId'] ?? '') !== (string)$sceneId) continue;
    $out[] = geobim_share_public_info($rec);
}
usort($out, function ($a, $b) { return strcmp((string)$b['createdAt'], (string)$a['createdAt']); });
echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
