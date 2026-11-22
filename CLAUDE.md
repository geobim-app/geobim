# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# geobim.app — Projektkontext für Claude Code

## Projektübersicht

**geobim.app** ist ein CesiumJS-basierter BIM/GIS-Viewer, der IFC-Modelle als
3D Tiles über Cesium Ion lädt und im Browser visualisiert. Zielgruppe sind
Ingenieurbüros, Auftraggeber und die Öffentlichkeit.

| Aspekt | Details |
|--------|---------|
| **Server** | Hetzner VPS (168.119.232.12), Apache, Let's Encrypt |
| **Domain** | geobim.app (DNS via INWX) |
| **Auth/Backend** | Firebase (Authentication + Firestore + Storage) |
| **3D Tiles** | Cesium Ion |
| **CesiumJS** | v1.145 (neueste, CDN) |
| **Frontend** | Vanilla JS — kein Framework, kein Bundler |
| **GitHub** | https://github.com/geobim-app/geobim |

---

## Befehle

```powershell
# Lokaler Dev-Server (PHP 8 built-in server + dev/router.php) → http://localhost:8000/
powershell -File dev/serve.ps1            # optional: -Port 8001 -ModelDir <3dtiles-Ordner>
```
- Braucht `config.js` (Vorlage: `config.example.js`), `logo/` und einen auf localhost
  beschränkten Ion-Token in `$HOME\.geobim\ion-dev-token.txt`.
- `dev/router.php` bildet die `.htaccess`-Rewrites nach (`php -S` ignoriert `.htaccess`).
- IFC-/Punktwolken-Upload und Konverter laufen nur auf dem Server → auf beta testen.

```bash
bash qa-check.sh   # einziger automatischer Check (kein Test-Framework, kein Linter)
```
11 Sektionen: Datei-Integrität (alle `src`/`href` in `index.html`), JS-Syntax,
Farben (`#6EECD8`), CSS-Referenzen, Shortcuts, A11y, Performance-Patterns,
Security, Dead Code, Assets, Versionskonsistenz. Exit 0 = ok, 1 = Warnings, 2 = Errors.

---

## Modulare Architektur

Alle Module erweitern das globale `BimViewer`-Objekt. Ladereihenfolge in
`index.html` ist kritisch. Der Baum unten zeigt nur die Kernmodule —
maßgeblich ist die `<script>`-Reihenfolge in `index.html` (~100 Skripte).

**Cache-Busting:** Skripte werden als `datei.js?v=YYYYMMDD[-n]` eingebunden.
Nach Änderungen an einem Modul den `?v=`-Parameter in `index.html` hochzählen,
sonst liefern Browser/Apache die alte Version.

```
index.html
├── config.js              → Cesium Ion Token, Firebase Config (.gitignore!)
├── core.js                → Viewer-Init, Asset-Mgmt, Performance-Presets, BimViewer-Objekt
├── features.js            → IFC-Filtering, Element-Picking (pickAsync), InfoBox, Clipping
├── hideFeatures.js        → Elemente per Click verstecken (H / Shift+H)
├── comments.js            → 3D-Kommentare, Firestore, Annotations, BCF Export
├── inspection.js          → Brückeninspektions-Erweiterung für Comments
├── measurement.js         → Distanz/Fläche/Höhe (Cesium Ion Measurement SDK)
├── measurement-store.js   → Persistenz für Messungen (Firestore)
├── clipping.js            → Polygon/Rectangle Clipping
├── clipping-planes.js     → Per-Asset Section Planes (X/Y/Z)
├── z-offset.js            → Vertikaler Höhenversatz pro Asset
├── layerManager.js        → Basemaps, WMS/WMTS/WFS, NRW LoD2
├── lighting.js            → Dynamische Beleuchtung, Schatten, Tageszeiten
├── ibl.js                 → Image-Based Lighting, Spherical Harmonics
├── pbr-materials.js       → PBR CustomShader (Triplanar Mapping, prozedural)
├── pointcloud.js          → Eye Dome Lighting, Punkt-Einstellungen
├── glb-gizmo.js           → GLB-Modelle positionieren/rotieren per Drag
├── wea-shadow.js          → Windenergieanlagen-Schattensimulation
├── firstperson.js         → First-Person Navigation (WASD, Gamepad, Wall Collision)
├── thirdperson.js         → Third-Person mit Cesium_Man Character
├── sib.js                 → SIB Brückengenerator
├── sensorthings.js        → FROST SensorThings API Live-Daten
├── iot.js                 → IoT Sensor Widget
├── ui.js                  → Sidebar + Bottom Toolbar (Lucide Icons)
├── ui-helpers-modern.js   → Floating Panels (Assets, Comments, Hidden)
├── about-feedback.js      → About-Dialog, Feedback, Guided Tour
├── onboarding.js          → 6-Schritt Onboarding Tour
└── bcf-export.js          → BCF 2.1 Export für Kommentare
```

### Zentrales BimViewer-Objekt

```javascript
window.BimViewer = {
  viewer,                // Cesium.Viewer
  loadedAssets: Map(),   // assetId → {id, name, tileset, isGLB, ...}
  // Alle Module erweitern dieses Objekt
};
```

### Zwei parallele UIs
`panels-ui-loader.js` (im `<head>`) wählt zwischen **classic** (Sidebar, `ui-*-section.js`)
und **panels** (Icon-Rail + Floating Panels, `panels-*.js` / `panels-ui.css`, setzt
`html.ui-panels`). Vorrang: `?ui=panels|classic` → localStorage `geobim_ui` →
Host-Default (`beta.geobim.app` und `localhost` → panels, sonst classic).
Panels-UI baut auf der classic UI auf. UI-Änderungen in **beiden** UIs prüfen;
Cache-Bust der Panels-Dateien über `VERSION` in `panels-ui-loader.js`.

### Modi & Zugang
- **Kurzrouten** (`.htaccess`, lokal `dev/router.php`): `/demo`, `/wea-shadow`,
  `/bridge-inspector`, `/stage-twin` → `index.html?mode=demo|wea|bridge|stagetwin`.
  Die getrimmten Demos (wea/bridge/stagetwin) bleiben immer classic UI.
- **Gäste ohne Ion** (`guest-no-ion.js`, `auth-gate.js`): ohne Login kein einziger
  Cesium-Ion-Request — Mapterhorn-Terrain, TopPlusOpen/WMS, Server-Modelle aus
  `model/guest-models.json`, Nominatim-Suche. Ion-Requests werden per Guard abgefangen.
- **Ion-Token** (`ion-auth.js`): Default-Token vom Server (`api/ion-config.php`) oder
  OAuth2 PKCE mit eigenem Ion-Account; `config.js` enthält nur die OAuth-`clientId`.

### PHP-Backend (`api/`)
Kleine PHP-Endpunkte auf demselben Apache: Server-Modelle (`models.php`,
`model-file.php`), Placement-Speichern, Punktwolken-Upload/-Status, iTwin-Token,
Owner-Session, Stats. `api/_dev.php` liefert lokale Dev-Overrides
(Modelle aus `GEOBIM_DEV_MODEL_DIR`).

---

## Coding-Konventionen

### Allgemein
- **Kein Framework:** Vanilla JS + HTML + CSS (kein React/Vue/Bundler)
- **Module Pattern:** Jedes Modul erweitert `BimViewer` — NICHT bestehende Module ändern
- **Neue Features:** Separates Modul (`feature-name.js`), in `index.html` einbinden
- **Kein Build-Prozess:** `git pull` = Deployment

### CSS
- **CSS Custom Properties nutzen** — alle Farben, Spacing, Radius aus `:root` Variablen
- **Design Tokens:** `--space-xs` bis `--space-2xl`, `--radius-sm` bis `--radius-2xl`,
  `--shadow-sm` bis `--shadow-xl`, `--input-bg`, `--input-bg-solid`
- **Brand-Farbe:** `var(--brand-teal)` = `#2ECFB0` — NIEMALS `#6EECD8` verwenden
- **Keine Inline-Styles** in HTML — CSS-Klassen in `*-styles.css` Dateien
- **Glassmorphism:** Panel-Opacity 0.82, `backdrop-filter: blur(12px)`

### Icons
- **Lucide Icons** via CDN (`<i data-lucide="icon-name"></i>`)
- **Keine Emojis** als UI-Icons (Rendering variiert zwischen Plattformen)
- Nach dynamischem HTML: `if (window.lucide) lucide.createIcons()` aufrufen

### JavaScript
- **`scene.pickAsync()`** statt `scene.pick()` — non-blocking GPU readback
- Aufrufende Funktionen müssen `async` sein, Ergebnis mit `await`
- Ausnahme: `onMouseMove`-Hover bleibt synchron (Performance)
- **Keyboard-Handler:** Immer `BUTTON` im Tag-Filter:
  `if (e.target.tagName === 'INPUT' || ... || e.target.tagName === 'BUTTON') return;`
- Neue Shortcuts: `BimFirstPerson.isActive()`-Guard wenn der Key im Walk-Modus blockiert sein soll
- **IFC-Properties:** Immer keyword-basiert, case-insensitiv, sourcen-agnostisch

### Cesium
- **Version:** 1.145 (neueste), CDN
- **Tone Mapping:** PBR Neutral (`Cesium.Tonemapper.PBR_NEUTRAL`)
- **AO:** HBAO (Horizon-Based, seit v1.124)
- **Environment Maps:** `configureDynamicEnvMaps()` wird auf jedes Tileset angewandt
- **Ion Access Token:** Über `ion-auth.js` / `api/ion-config.php` beziehen, NICHT hardcoden
- **Tileset API:** `feature.getPropertyIds()` / `feature.getProperty(name)` — kein IFC-Parsing

---

## QA-Pflicht

### Vor jedem Commit:
```bash
bash qa-check.sh
```
Muss **0 Errors** zeigen. Warnings prüfen, bekannte akzeptieren.

### Vor jedem Release:
1. `QA-CHECKLIST.md` durchgehen (18 Sektionen, ~80 Punkte)
2. **Versionsnummern synchronisieren:** `splash-screen.js`, `about-feedback.js`, `CHANGELOG.md` — müssen identisch sein
3. **MD-Dateien aktualisieren:** README.md, FEATURES.md, CHANGELOG.md — neue Features dokumentieren
4. **Splash Screen:** Features-Tab und Shortcuts-Tab mit neuen Features/Shortcuts aktualisieren
5. **About Dialog:** Features-Tab, Shortcuts-Tab und Version aktualisieren
6. `bash qa-check.sh` → Sektion 11 (Version Consistency) muss 0 Errors zeigen

### Nach UI-Änderungen:
- Prüfen ob Lucide Icons rendern (`lucide.createIcons()`)
- Touch-Targets ≥ 44px auf Mobile
- `prefers-reduced-motion` nicht brechen
- Focus-visible States für neue Buttons

---

## UI-Architektur

### Sidebar (links, 340px)
Daten-/Browse-Tools: Assets, Layers, Point Cloud, Annotations, Inspection,
IFC Filter, Revit Filter, Split View, Saved Views, Settings.

### Bottom Toolbar (unten, zentriert)
Action-Tools: Measure, Visibility, Lighting, Walk Mode, Help.
Buttons öffnen die entsprechende Section in der Sidebar.

### Floating Panels
- InfoBox (rechts oben), Comments (rechts unten), Assets (links unten)
- WEA Shadow (rechts oben), Sequencing Timeline (unten mitte)
- Alle draggable, alle mit `visible`-Klasse für CSS-Transitions

### Walk Mode
- **G** → First-Person (WASD, Mouse Look, Gamepad, Wall Collision)
- **V** → Third-Person (Cesium_Man GLB, Orbit Camera, `trackedEntity`)
- **T** → Player Start setzen
- `firstperson.js` berechnet Velocity, `thirdperson.js` bewegt Character
- Collision via `scene.pickFromRay()`, throttled 10x/sec

---

## Deployment

```bash
# Auf dem Hetzner-Server (168.119.232.12)
# Web-Root: /var/www/christoflorenz.de/
git pull origin main
# Kein Build-Schritt nötig
```

### Secrets
- `config.js` → `.gitignore` (Ion-OAuth-clientId, Firebase Config, optional ArcGIS-Key); Vorlage `config.example.js`
- Ion-Default-Token liegt serverseitig (`api/ion-config.php`), lokal in `$HOME\.geobim\ion-dev-token.txt`
- Firebase Config kann public sein (Firestore Rules schützen)

---

## Wichtige Regeln für Claude Code

1. **Nie** bestehende Module umstrukturieren ohne explizite Anweisung
2. **Nie** `#6EECD8` verwenden — immer `var(--brand-teal)` / `#2ECFB0`
3. **Nie** Inline-Styles in HTML — CSS-Klassen erstellen
4. **Nie** Emojis als UI-Icons — Lucide SVG verwenden
5. **Nie** `scene.pick()` — immer `await scene.pickAsync()`
6. **Nie** committen ohne `bash qa-check.sh` (0 Errors)
7. **Immer** neue Features als separates Modul
8. **Immer** Design Tokens für Spacing/Radius/Shadows
9. **Immer** Keyboard-Handler mit BUTTON-Tag-Filter
10. **Immer** `CHANGELOG.md` bei jedem Commit aktualisieren
