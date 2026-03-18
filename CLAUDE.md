# geobim.app – Projektkontext für Claude Code

## Projektübersicht

**geobim.app** ist ein CesiumJS-basierter BIM/GIS-Viewer, der IFC-Modelle als
3D Tiles über Cesium Ion lädt und im Browser visualisiert. Zielgruppe sind
Ingenieurbüros, Auftraggeber und die Öffentlichkeit (Entwurfspräsentationen,
Brückeninspektionen, Infrastrukturprojekte).

- **Server:** Hetzner (IP: 168.119.232.12), Apache
- **Domain:** geobim.app (DNS via INWX)
- **Auth/Backend:** Firebase (Authentication + Firestore + Storage)
- **3D Tiles Hosting:** Cesium Ion
- **Cesium Version:** CesiumJS (aktuelle stabile Version per CDN oder npm)

---

## Modulare Architektur

Die App ist in eigenständige JS-Module aufgeteilt, die über ein zentrales
`BimViewer`-Objekt kommunizieren.

```
index.html
├── core.js              → Viewer-Init, Asset-Management, BimViewer-Objekt
├── features.js          → IFC-Filtering, Element-Interaktion, InfoBox, Clipping
├── hideFeatures.js      → Einzelne BIM-Elemente per Click verstecken
├── comments.js          → 3D-Kommentare mit Firebase Firestore
├── measurement.js       → Messwerkzeuge (Cesium Ion SDK)
├── pbr-materials.js     → PBR CustomShader (prozedurales Material-Texturing)
├── ui.js                → Benutzeroberfläche (Panels, Buttons, Toolbar)
└── ui-comments-extension.js  → Kommentar-UI-Erweiterung
```

### Zentrales BimViewer-Objekt (core.js)

Alle Module greifen auf das globale `BimViewer`-Objekt zu:

```javascript
window.BimViewer = {
  viewer,           // Cesium.Viewer Instanz
  tilesets: [],     // geladene Cesium3DTileset-Objekte
  assets: [],       // Asset-Metadaten {id, name, ionAssetId, tileset}
  // ...
};
```

---

## IFC → 3D Tiles Workflow

```
IFC-Datei
  → Upload auf Cesium Ion (Design Tiler)
  → 3D Tiles (IFC-Properties als Feature-Metadaten erhalten)
  → geobim.app lädt Tileset: Cesium.Cesium3DTileset.fromUrl(resource)
  → Feature-Properties: feature.getPropertyIds() / feature.getProperty(name)
```

**Wichtig:** Die App macht **kein** IFC-Parsing. Alles läuft über die
Feature-Properties der 3D Tiles, so wie Cesium Ion sie aus dem IFC übernimmt.

### Relevante IFC Feature-Properties

| Property          | Beispielwert                  | Verwendung             |
|-------------------|-------------------------------|------------------------|
| `className`       | `IfcWall`, `IfcBeam`         | Entity-Typ-Erkennung   |
| `IfcEntity`       | `IfcColumn`                   | Alternativ zu className|
| `Material`        | `Baustahl - S355`             | PBR-Material-Matching  |
| `MaterialName`    | `Beton C30/37`                | Fallback Material      |
| `Name`            | `Wandtyp-Außen-30cm`          | Element-Name           |
| `GlobalId`        | `2X9NnrP...`                  | IFC-Referenz           |

---

## Firebase Setup

- **Firestore Collection:** `comments_trainbridge` (Beispiel, pro Projekt variiert)
- **Kommentar-Datenstruktur:**
  ```javascript
  {
    title: "Riss am Widerlager",
    text: "Kommentartext",
    lon: 10.9544,
    lat: 50.7323,
    height: 5.2,
    imageUrl: "https://...",   // optional, Firebase Storage
    author: "user@email.com",
    timestamp: Firestore.FieldValue.serverTimestamp(),
    status: "open"             // open | resolved
  }
  ```
- **Firebase Storage:** Für Kommentar-Bild-Uploads (Spark Plan: 5 GB)
- **Auth:** Firebase Authentication (Email/Password oder Google)

---

## Module – Kernfunktionen

### core.js
- Cesium Viewer initialisieren (Ion Access Token via Env/Config)
- Assets laden: `Cesium3DTileset.fromIonAssetId()` oder `fromUrl()`
- Mehrere Assets gleichzeitig, Opazität pro Asset steuerbar
- Performance-Presets (Performance → Ultra)
- Auto-IFC-Detection: erkennt automatisch IFC-Properties

### features.js
- **IFC-Filtering:** 30+ IFC-Entitätstypen (Wände, Säulen, Türen, MEP etc.)
- Farbcodierung nach Kategorie (Struktur, MEP, Innenausbau)
- **InfoBox:** Zeigt alle Feature-Properties kategorisiert an
- **Clipping:** Polygon zeichnen → Gebäude oder Terrain clippen
- OSM-Building-Support (Adress-/Bauinfos)

### hideFeatures.js
- Einzelne Elemente per Click verstecken/zeigen
- **H** = Toggle, **Shift+H** = Alle wiederherstellen
- Liste versteckter Elemente mit Bulk-Restore

### comments.js
- 3D-Kommentare: Picking → Weltkoordinaten → Firebase speichern
- Kommentar-Pins als Cesium Billboards/Labels in der Szene
- Bild-Upload via Firebase Storage (URL in Firestore)

### pbr-materials.js (Extension)
- **Triplanar Mapping** im GLSL Fragment Shader (keine UVs nötig)
- **Prozedurales Noise** (FBM-ähnlich) für Material-Variation
- Material-Erkennung per IFC Feature-Properties (keyword-basiert, case-insensitiv)
- Unterstützte Materialtypen: Stahlbeton, Baustahl, Stahl poliert,
  Verzinkt, Naturstein/Granit, Bitumen/Asphalt, Holz, Glas, Mauerwerk, Erde

#### Material-Matching Fallback-Kette:
1. Feature-Property `Material` oder `MaterialName` (Keyword-Matching)
2. IFC Entity-Typ (`IfcWindow` → Glas, `IfcWall` → Beton etc.)
3. Luminanz der Basisfarbe (dunkel → Stahl, mittel → Beton, hell → Putz)

### measurement.js
- Distanz-, Flächen- und Höhenmessungen
- Nutzt Cesium Ion Measurement SDK

---

## Coding-Konventionen

- **Kein Framework:** Vanilla JS + HTML + CSS (kein React/Vue)
- **Module Pattern:** Jedes Modul exportiert Funktionen oder erweitert `BimViewer`
- **Neue Extensions:** Neues Modul anlegen, in `index.html` einbinden,
  über `BimViewer`-Objekt integrieren – nicht bestehende Module verändern
- **IFC-Properties:** Immer keyword-basiert und case-insensitiv matchen,
  da Materialnamen je nach BIM-Tool (Revit, Allplan, Archicad, Tekla)
  und Sprache (DE/EN) stark variieren
- **Cesium3DTileset API:** `feature.getPropertyIds()` / `feature.getProperty(name)`
  für alle Feature-Daten – kein direktes IFC-Parsing

---

## Infrastruktur & Tooling

- **Server:** Hetzner VPS, Apache + Let's Encrypt
- **Domain/DNS:** INWX → Hetzner
- **E-Mail:** Mailbox.org (Standard), MX/SPF/DKIM konfiguriert
- **Nextcloud:** Selbst gehostet auf Hetzner (selber Server)
- **Versionskontrolle:** Git (lokal + Hetzner)
- **Cesium Ion:** Eigener Account, Cesium Certified Developer

---

## Offene Features / Backlog

- [ ] Bild-Upload in Kommentarfunktion (Firebase Storage, ~50-100 LOC)
- [ ] DSGVO-konforme Analytics (Matomo self-hosted auf Hetzner)
- [ ] Mehrseitige Kommentarbilder (Galerie-View)
- [ ] PBR-Material-Editor in der UI (Slider für Roughness/Metallic)
- [ ] Revit → IFC4 → Ion Pipeline Dokumentation

---

## Deployment & Git-Workflow

### Repository

- **GitHub Repo:** https://github.com/geobim-app/geobim
- **Branch-Strategie:** `main` = Produktion, Feature-Branches für neue Module

### Deployment auf Hetzner (Apache)

```bash
# Auf dem Hetzner-Server (168.119.232.12)
# Web-Root:  /var/www/christoflorenz.de/

# Typischer Deploy-Workflow:
git pull origin main
# Kein Build-Schritt nötig (Vanilla JS, kein Bundler)
```

### Commit & Release Workflow

Claude Code kann direkt per natürlicher Sprache beauftragt werden:
- `"Mache ein Commit auf GitHub"` → `git add . && git commit -m "..." && git push`
- `"Erzeuge ein neues Release"` → alle `*.md` Dateien aktualisieren (Changelog, README, Versionsnummer), dann `gh release create`

Git-Credentials sind systemseitig konfiguriert (gh CLI / SSH-Key), kein Token in der CLAUDE.md nötig.

### Kein Build-Prozess

Die App verwendet **Vanilla JS ohne Bundler** (kein Webpack/Vite/npm build).
Deployment = einfach Dateien auf den Server kopieren bzw. `git pull`.
Neue Module nur in `index.html` per `<script src="neues-modul.js">` einbinden.

### Umgebungsvariablen / Secrets

- **Cesium Ion Access Token:** Nicht hardcoden – aus einer separaten Config-Datei
  lesen (z.B. `config.js` die in `.gitignore` steht)
- **Firebase Config:** Über Firebase SDK Config (kann public sein, aber
  Firestore Rules korrekt setzen)
- `.gitignore` sollte enthalten: `config.js`, `*.env`, `node_modules/`



---

## Wichtige Hinweise für Claude Code

1. **Nie** bestehende Module umstrukturieren ohne explizite Anweisung
2. Neue Features immer als separates Modul (`feature-name.js`)
3. IFC-Properties **nie** direkt parsen – immer über `feature.getProperty()`
4. Cesium Ion Access Token nicht hardcoden – aus Config/Env lesen
5. Firebase-Credentials nicht in den Code – aus Firebase SDK Config
6. Material-Matching muss **sourcen-agnostisch** sein (Revit, Allplan, IFC2x3/4)
7. GLSL-Shader: Triplanar Mapping bevorzugen (keine UV-Abhängigkeit)
