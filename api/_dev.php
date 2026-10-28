<?php
// geoBIM.app — local development only (dev/serve.ps1).
//
// With the PHP built-in server and GEOBIM_DEV_MODEL_DIR set, api/models.php
// and api/model-file.php list and serve that folder (e.g. the tilesets
// geoBIM Desktop writes) without the owner session, which needs secrets that
// only exist on the server. Never active under Apache/PHP-FPM, and only for
// requests from this machine. Writing endpoints still require the owner;
// api/placement-save.php then writes into that folder too (upload does not).

function geobim_dev_model_dir() {
    if (PHP_SAPI !== 'cli-server') return null;
    if (!in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true)) return null;
    $dir = getenv('GEOBIM_DEV_MODEL_DIR');
    if (!$dir) return null;
    $real = realpath($dir);
    return ($real !== false && is_dir($real)) ? str_replace('\\', '/', $real) : null;
}
