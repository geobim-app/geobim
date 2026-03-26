<?php
/**
 * geobim.app — Lightweight Analytics API
 * Reads Apache access logs, returns JSON stats.
 *
 * Query params:
 *   from  — start date (YYYY-MM-DD), default: 7 days ago
 *   to    — end date (YYYY-MM-DD), default: today
 */

header('Content-Type: application/json');
header('Cache-Control: no-cache');

// Auth handled by Apache .htaccess (Basic Auth on stats.php)
// If we get here, user is already authenticated

$from = isset($_GET['from']) ? strtotime($_GET['from'] . ' 00:00:00') : strtotime('-7 days');
$to = isset($_GET['to']) ? strtotime($_GET['to'] . ' 23:59:59') : time();

// Read log files
// Include geobim-specific logs (current + rotated)
$logFiles = glob('/var/log/apache2/geobim.app-access.log*');
// Sort: rotated (.1, .2.gz) first, then current
usort($logFiles, function($a, $b) { return strcmp($b, $a); });

$pageViews = [];      // date => count
$pages = [];          // path => count
$visitors = [];       // date => set of IPs
$referrers = [];      // referrer => count
$browsers = [];       // browser => count
$countries = [];      // (from IP, simplified)
$hourly = array_fill(0, 24, 0);
$totalRequests = 0;
$totalBytes = 0;

// Apache Combined Log Format regex
$pattern = '/^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+) [^"]*" (\d{3}) (\d+|-) "([^"]*)" "([^"]*)"/';

foreach ($logFiles as $logFile) {
    $isGzip = substr($logFile, -3) === '.gz';
    $handle = $isGzip ? gzopen($logFile, 'r') : fopen($logFile, 'r');
    if (!$handle) continue;

    while (($line = $isGzip ? gzgets($handle) : fgets($handle)) !== false) {
        if (!preg_match($pattern, $line, $m)) continue;

        $ip = $m[1];
        $dateStr = $m[2];
        $method = $m[3];
        $path = $m[4];
        $status = (int)$m[5];
        $bytes = $m[6] === '-' ? 0 : (int)$m[6];
        $referrer = $m[7];
        $userAgent = $m[8];

        // Parse date — Apache format: "24/Mar/2026:07:17:48 +0000"
        $ts = strtotime(preg_replace('/^(\d{2})\/(\w{3})\/(\d{4}):/', '$1 $2 $3 ', $dateStr));
        if (!$ts || $ts < $from || $ts > $to) continue;

        $date = date('Y-m-d', $ts);
        $hour = (int)date('G', $ts);

        // Skip assets, only count page views
        $isPage = !preg_match('/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map|glb|json|php)$/i', $path);
        $isBot = preg_match('/bot|crawl|spider|slurp|Googlebot|bingbot|yandex|semrush|ahref|python-requests|curl|wget/i', $userAgent);

        if ($method !== 'GET' || $status >= 400) continue;

        $totalRequests++;
        $totalBytes += $bytes;
        $hourly[$hour]++;

        // Visitors (unique IPs per day, exclude bots)
        if (!$isBot) {
            if (!isset($visitors[$date])) $visitors[$date] = [];
            $visitors[$date][$ip] = true;
        }

        // Page views (exclude assets and bots)
        if ($isPage && !$isBot) {
            if (!isset($pageViews[$date])) $pageViews[$date] = 0;
            $pageViews[$date]++;

            // Normalize path
            $cleanPath = strtok($path, '?');
            if ($cleanPath === '/index.html') $cleanPath = '/';
            if (!isset($pages[$cleanPath])) $pages[$cleanPath] = 0;
            $pages[$cleanPath]++;
        }

        // Referrers (external only)
        if ($referrer !== '-' && $referrer !== '' && !preg_match('/geobim\.app/i', $referrer)) {
            // Extract domain
            $refDomain = parse_url($referrer, PHP_URL_HOST) ?: $referrer;
            if (!isset($referrers[$refDomain])) $referrers[$refDomain] = 0;
            $referrers[$refDomain]++;
        }

        // Browser detection (simplified)
        if (!$isBot) {
            $browser = 'Other';
            if (preg_match('/Chrome\/.*Safari/', $userAgent) && !preg_match('/Edg/', $userAgent)) $browser = 'Chrome';
            elseif (preg_match('/Firefox\//', $userAgent)) $browser = 'Firefox';
            elseif (preg_match('/Safari\//', $userAgent) && !preg_match('/Chrome/', $userAgent)) $browser = 'Safari';
            elseif (preg_match('/Edg\//', $userAgent)) $browser = 'Edge';
            if (!isset($browsers[$browser])) $browsers[$browser] = 0;
            $browsers[$browser]++;
        }
    }

    $isGzip ? gzclose($handle) : fclose($handle);
}

// Sort and limit
arsort($pages);
arsort($referrers);
arsort($browsers);
ksort($pageViews);
ksort($visitors);

// Build visitor counts
$visitorCounts = [];
foreach ($visitors as $date => $ips) {
    $visitorCounts[$date] = count($ips);
}

// Total unique visitors
$allIps = [];
foreach ($visitors as $ips) {
    $allIps = array_merge($allIps, array_keys($ips));
}
$uniqueVisitors = count(array_unique($allIps));

echo json_encode([
    'period' => [
        'from' => date('Y-m-d', $from),
        'to' => date('Y-m-d', $to),
    ],
    'summary' => [
        'pageViews' => array_sum($pageViews),
        'uniqueVisitors' => $uniqueVisitors,
        'totalRequests' => $totalRequests,
        'bandwidth' => round($totalBytes / 1024 / 1024, 1), // MB
    ],
    'daily' => [
        'pageViews' => $pageViews,
        'visitors' => $visitorCounts,
    ],
    'hourly' => $hourly,
    'pages' => array_slice($pages, 0, 20, true),
    'referrers' => array_slice($referrers, 0, 15, true),
    'browsers' => array_slice($browsers, 0, 6, true),
], JSON_PRETTY_PRINT);
