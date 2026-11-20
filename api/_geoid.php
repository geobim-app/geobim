<?php
// geoBIM.app — geoid height N (m) for lat/lon: GCG2016 inside Germany, EGM2008
// (1° grid) elsewhere. Same grids and bilinear interpolation as
// geoidHeight() in mapterhorn-terrain.js, so a height converted here lands
// where the viewer expects it: ellipsoidal h = orthometric H + N.

function geobim_geoid_height($lat, $lon) {
    $n = geobim_gcg2016($lat, $lon);
    return $n === null ? geobim_egm2008($lat, $lon) : $n;
}

// geodesy/de_bkg_gcg2016_x4.u16: every 4th node of BKG's GCG2016 grid, uint16
// millimetres, 0 = no data; null outside Germany
function geobim_gcg2016($lat, $lon) {
    static $d = null;
    $rows = 263; $cols = 238;
    $lon0 = 3.25625; $lat0 = 55.979166667; $dLon = 0.05; $dLat = 0.033333333335872;
    $c = ($lon - $lon0) / $dLon;
    $r = ($lat0 - $lat) / $dLat;
    $c0 = (int)floor($c); $r0 = (int)floor($r);
    if ($c0 < 0 || $r0 < 0 || $c0 >= $cols - 1 || $r0 >= $rows - 1) return null;
    if ($d === null) {
        $raw = @file_get_contents(__DIR__ . '/../geodesy/de_bkg_gcg2016_x4.u16');
        if ($raw === false || strlen($raw) !== $rows * $cols * 2) return null;
        $d = array_values(unpack('v*', $raw));
    }
    $i = $r0 * $cols + $c0;
    $q00 = $d[$i]; $q01 = $d[$i + 1]; $q10 = $d[$i + $cols]; $q11 = $d[$i + $cols + 1];
    if (!$q00 || !$q01 || !$q10 || !$q11) return null;
    $fc = $c - $c0; $fr = $r - $r0;
    return ($q00 * (1 - $fc) * (1 - $fr) + $q01 * $fc * (1 - $fr) + $q10 * (1 - $fc) * $fr + $q11 * $fc * $fr) / 1000;
}

// data/egm2008_1deg.bin: float32, 181 rows (90° N … 90° S) × 361 columns (0° … 360° E)
function geobim_egm2008($lat, $lon) {
    static $d = null;
    $rows = 181; $cols = 361;
    if ($d === null) {
        $raw = @file_get_contents(__DIR__ . '/../data/egm2008_1deg.bin');
        if ($raw === false || strlen($raw) !== $rows * $cols * 4) {
            throw new RuntimeException('EGM2008 grid missing');
        }
        $d = array_values(unpack('g*', $raw));
    }
    $lat = max(-90, min(90, $lat));
    $lon = fmod(fmod($lon, 360) + 360, 360);
    $r = 90 - $lat; $c = $lon;
    $r0 = min((int)floor($r), $rows - 2); $c0 = min((int)floor($c), $cols - 2);
    $fr = $r - $r0; $fc = $c - $c0; $i = $r0 * $cols + $c0;
    return $d[$i] * (1 - $fc) * (1 - $fr) + $d[$i + 1] * $fc * (1 - $fr)
         + $d[$i + $cols] * (1 - $fc) * $fr + $d[$i + $cols + 1] * $fc * $fr;
}
