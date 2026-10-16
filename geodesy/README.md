# Geodesy grids

- `de_adv_BETA2007.tif` — BeTA2007 grid for DHDN ↔ ETRS89 (Germany), used by
  `projected-coords.js` to show Gauss-Krüger coordinates in the measurement tool.
  Copied unchanged from PROJ-data (`de_adv_BETA2007.tif`).
  "Derived from work by AdV. Free redistribution is allowed and welcome."
- `de_bkg_gcg2016_x4.u16` — German geoid GCG2016 (ETRS89 → DHHN2016), used by
  `mapterhorn-terrain.js` to lift NHN terrain heights onto the ellipsoid.
  Every 4th node of PROJ-data `de_bkg_gcg2016.tif` (0.05° × 0.0333°, 238 × 263
  nodes, first node 3.25625° E / 55.979166667° N), little-endian uint16 in
  millimetres, 0 = no data. Within 4.4 cm of PROJ with the full grid.
  "Derived from work by BKG. CC-BY-4.0 https://creativecommons.org/licenses/by/4.0/"
