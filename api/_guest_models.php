<?php
// geoBIM.app — server models for guests (no sign-in, no Cesium ion).
//
// model/guest-models.json lists the top-level entries of model/ that everyone
// may see and load: a GLB file name or a tileset folder name, e.g.
//   ["Hollowbox (IFC)", "siegtalbruecke_4d_tiled", "Crane (GLB).glb"]
// Edited on the server (model/ is not in git); a missing or broken file means
// no server models for guests. api/models.php lists only these to guests,
// api/model-file.php serves only files below them.

function geobim_guest_models($modelDir) {
    static $cache = [];
    if (isset($cache[$modelDir])) return $cache[$modelDir];
    $list = json_decode(@file_get_contents($modelDir . '/guest-models.json') ?: '[]', true);
    $names = [];
    foreach (is_array($list) ? $list : [] as $name) {
        // plain top-level names only: no paths, no hidden or staging entries
        if (is_string($name) && $name !== '' && strpbrk($name, "/\\\0") === false
            && $name[0] !== '.' && $name !== '_staging') {
            $names[] = $name;
        }
    }
    return $cache[$modelDir] = $names;
}

// Whether model/<$rel> lies in an entry guests may load
function geobim_guest_may_read($modelDir, $rel) {
    $top = explode('/', $rel, 2)[0];
    return in_array($top, geobim_guest_models($modelDir), true);
}
