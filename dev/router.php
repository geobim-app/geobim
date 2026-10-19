<?php
/**
 * Router for the PHP built-in server (local development only, see dev/serve.ps1).
 * php -S ignores .htaccess; this mirrors its rewrites and blocks.
 */

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// Block VCS metadata and dotfiles (.htaccess: RewriteRule (^|/)\.(git|svn|hg|env)(/|$))
if (preg_match('#(^|/)\.(git|svn|hg|env)(/|$)#', $path)) {
    http_response_code(403);
    exit;
}

// Short routes (.htaccess: /demo, /wea-shadow, /bridge-inspector, /stage-twin)
$modes = [
    'demo' => 'demo',
    'wea-shadow' => 'wea',
    'bridge-inspector' => 'bridge',
    'stage-twin' => 'stagetwin',
];
$route = trim($path, '/');
if (isset($modes[$route])) {
    $query = $_SERVER['QUERY_STRING'] ?? '';
    header('Location: /index.html?mode=' . $modes[$route] . ($query !== '' ? '&' . $query : ''), true, 302);
    exit;
}

// Everything else: let the built-in server serve the file or run the PHP script
return false;
