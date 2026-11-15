# geoBIM.app Viewer — Projektkontext für Claude Code

CesiumJS-basierter BIM/GIS-Viewer: IFC-Modelle als 3D Tiles (Cesium Ion bzw.
eigener Tiler), dazu Punktwolken, GLB, Gelände- und GIS-Werkzeuge im Browser.
Zielgruppe: Ingenieurbüros, Auftraggeber, Öffentlichkeit.

| Aspekt | Details |
|--------|---------|
| **Live / Beta** | viewer.geobim.app (`main`) / beta.geobim.app (`staging`); geobim.app ist die Firmen-Website (Repo `geobim-app/geobim-site`) und leitet Viewer-Pfade per 308 hierher |
| **Server** | Hetzner VPS 168.119.232.12, Apache, Let's Encrypt, PHP-API unter `api/` |
| **Backend** | Firebase (Auth, Firestore, Storage) |
| **CesiumJS** | v1.147 per CDN |
| **Frontend** | Vanilla JS + HTML + CSS — kein Framework, kein Bundler, kein Build |

## Wo was steht

Diese Dateien bei Bedarf lesen (nicht vorab):

- **Module und ihre Aufgaben:** `FEATURES.md`, Abschnitt „Module Reference“ — vor der Arbeit an einem unbekannten Modul lesen.
- **Ladereihenfolge:** die `<script>`-Tags in `index.html` sind maßgeblich und die Reihenfolge ist kritisch.
- **Deployment, Server-Skripte, Secrets, Fehlersuche:** `DEPLOYMENT.md` — lesen, bevor du etwas an Deploy oder Server machst.
- **Release-Prüfung:** `QA-CHECKLIST.md` — nur vor einem Release.
- **Änderungshistorie und Format der Einträge:** `CHANGELOG.md` (Keep a Changelog, Abschnitt `[Unreleased]`).

## Architektur

- Alle Module erweitern das globale `window.BimViewer` (`viewer`, `loadedAssets: Map` assetId → `{id, name, tileset, isGLB, …}`).
- **Neue Features als eigenes Modul** (`feature-name.js`, Styles in `feature-name-styles.css`), in `index.html` einbinden. Bestehende Module nicht umstrukturieren ohne ausdrückliche Anweisung; neue Module hängen sich an deren Funktionen.
- Nach Änderungen an eingebundenen Dateien den `?v=`-Parameter in `index.html` hochzählen.

## Konventionen

Mit (H) markierte Regeln setzt der Hook `geobim-guard` durch (lokale Mod in `~/.claude/mods`).

- **Farben:** Brand `var(--brand-teal)` = `#2ECFB0`, nie `#6EECD8` (H). Alle Farben, Abstände, Radien, Schatten aus `:root`-Tokens (`--space-xs…2xl`, `--radius-sm…2xl`, `--shadow-sm…xl`, `--input-bg`, `--input-bg-solid`).
- **Kein Inline-Style in HTML** (H) — CSS-Klassen in `*-styles.css`.
- **Glassmorphism:** Panel-Opacity 0.82, `backdrop-filter: blur(12px)`.
- **Icons:** Lucide per CDN (`<i data-lucide="…"></i>`), keine Emojis (H). Nach dynamischem HTML `if (window.lucide) lucide.createIcons()`.
- **Picking:** `await scene.pickAsync()` statt `scene.pick()` (H); aufrufende Funktion `async`. Ausnahme: Hover in `onMouseMove` bleibt synchron.
- **Keyboard-Handler:** Tag-Filter immer mit `BUTTON` (H): `if (e.target.tagName === 'INPUT' || … || e.target.tagName === 'BUTTON') return;`. Shortcuts, die im Walk-Modus blockiert sein sollen, mit `BimFirstPerson.isActive()`-Guard.
- **IFC-Properties:** über `feature.getPropertyIds()` / `feature.getProperty(name)`, keyword-basiert, case-insensitiv, quellen-agnostisch — kein IFC-Parsing.
- **Cesium:** Tone Mapping `Cesium.Tonemapper.PBR_NEUTRAL`, AO = HBAO, `configureDynamicEnvMaps()` auf jedes Tileset. Ion-Token aus `config.js`, nie hardcoden.
- **Secrets:** `config.js` ist gitignored (Ion-Token, Firebase-Config).

## QA

- **Vor jedem Commit:** `bash qa-check.sh` → 0 Errors (H), und `CHANGELOG.md` gehört in jeden Commit (H).
- **Nach UI-Änderungen:** Lucide-Icons rendern, Touch-Targets ≥ 44 px, `prefers-reduced-motion` intakt, Focus-visible für neue Buttons.
- **Vor einem Release:** `QA-CHECKLIST.md` durchgehen; Version in `splash-screen.js`, `about-feedback.js` und `CHANGELOG.md` identisch (qa-check Sektion 11); README.md, FEATURES.md, Features- und Shortcuts-Tab in Splash und About nachziehen.

## Deployment und Server

Push = Deployment per GitHub Action, kein Build. Details in `DEPLOYMENT.md`.

```
lokal → bash qa-check.sh → Commit
  → git push --force-with-lease origin HEAD:staging → beta.geobim.app (prüfen)
  → git push origin HEAD:main                       → viewer.geobim.app (live)
```

- `main` nur vorwärts, nie force-pushen (H); `staging` darf neu gesetzt werden.
- **Nie Dateien auf dem Server ändern** (H) — jede Änderung läuft lokal → Commit → Push → Deploy. Server-Sessions nur zum Lesen, Diagnostizieren und Administrieren. Schlägt ein Deploy fehl, liegt auf dem Server etwas, das nicht im Repo ist: dort diagnostizieren, korrigieren übers Repo.
