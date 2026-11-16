# geoBIM.app Roadmap (Web)

Roadmap für geoBIM.app (CesiumJS, dieses Repo). Die Desktop-Version
geoBIM Unreal hat ihre eigene Roadmap in `Docs/ROADMAP.md` im Repo
`christof2304/geobim-unreal`. Punkte, die es in beiden Produkten gibt, stehen
in beiden Roadmaps, jeweils mit dem eigenen Teil.

Am 06.11.2026 aus der früheren gemeinsamen Roadmap im Unreal-Repo
herausgelöst. Was schon erledigt ist, steht in `CHANGELOG.md`.

## Als Nächstes

### Site Analysis (Gelände) — Stand 16.11.2026
Gefälle im Planum und Terrassen aus verbundenen Flächen sind fertig und auf
beta (Branch `feature/site-grading-slope`, in `staging-combined-2.0`); sie gehen
mit Release 2.1 nach `main`, sobald sie auf beta geprüft sind.

**A. Oberflächendifferenz (Haldenvolumen, Aushub, Baufortschritt) — als Nächstes**
- Zweite Höhenquelle pro Fläche: DGM gegen ein geladenes Modell (Drohnen-
  Punktwolke, 3D-Tiles-Mesh) oder Google 3D Tiles (nur mit Cesium ion);
  später ein importiertes LandXML-TIN (Planungs- oder Aufmaßstand).
- Bezugsebene ohne Urgelände: aus den Randpunkten der Fläche interpoliert
  (Haldenfuß), wie bei Haldenvolumen üblich.
- Ergebnis: Volumen darüber / darunter, Differenzraster, zusammenhängende
  Bereiche mit Fläche und Volumen; Export CSV, PNG, LandXML.
- Vorhanden: `sampleHeights` mit Quelle „active“ (Gelände und 3D Tiles),
  Raster, Cut-&-Fill-Darstellung mit Regionen, Exporte. Neu: zweite Quelle,
  Bezugsebene, LandXML-Import.
- Reihenfolge: zuerst DGM gegen geladenes Modell und die Bezugsebene aus den
  Randpunkten, danach LandXML-Import. Zielgruppe Vermessung.

**B. Verknüpfung mit BIM**
- Längsprofil entlang einer IfcAlignment-Achse: Gelände gegen Gradiente,
  Abtrag / Auftrag je Station (Achsen lädt `alignment-section.js` schon).
- Planum aus einem IFC-Modell: Unterkante bzw. Grundriss einer Bodenplatte
  oder eines Fundaments als Planumshöhe und Fläche, daraus die Baugrube mit
  Volumen (Baugrube beim Clipping gibt es schon, `clipping-pit.js`).

**C. Kleinere Ergänzungen**
- Share-Links übernehmen die Geländeanalyse (fehlt bisher).
- Kostenschätzung: €/m³ für Abtrag, Auftrag, Abfuhr; Bodenklassen mit
  Auflockerungsfaktor (Faktor gibt es schon).
- Exporte: DXF für Höhenlinien und Planum, einseitiger PDF-Bericht.

**D. Weitere Analysen**
- Fließwege und Senken (D8) als erster Hinweis zur Entwässerung.
- Sichtbarkeit von einem Punkt oder einer Windkraftanlage aus (passt zu
  `wea-shadow.js`).
- PV-Eignung aus Neigung, Exposition und Sonnenstand (`lighting.js`).

### 1. BIM-Modelle nach Eigenschaften einfärben
Idee aus Cesium for Unreal Samples, Level 15/16 (Apache 2.0); Desktop plant
dasselbe.
- Thematische Einfärbung nach beliebiger IFC-Eigenschaft: Kategorien
  (Material, Bauphase, Status) als Farbtabelle, Zahlen (Länge, Feuerwiderstand,
  Kosten) als Farbverlauf oder Wertebereich mit Schieberegler; Elemente ohne
  Treffer ausblenden oder ausgrauen.
- `Cesium3DTileStyle` mit `conditions` – geoBIM.app färbt schon nach
  IFC-Klasse / Revit-Kategorie (`features.js`); ausbauen auf frei wählbare
  Eigenschaft, Wertebereiche und Legende.

### 2. OSM-Gebäude mit prozeduralen Fenstern
Idee aus Samples, Level 10; Desktop plant dasselbe.
- Untexturierte Umgebungsbebauung bekommt Fenster, die tagsüber spiegeln und
  nachts leuchten; Fassadenfarbe nach OSM-Gebäudetyp.
- `CustomShader` auf dem OSM-Buildings-Tileset (wird in `core.js` bereits
  geladen); Fenster prozedural aus Modellkoordinaten und Normale, Leuchten
  abhängig vom Sonnenstand.

### 3. Wasserflächen
Idee aus Samples, Level 8/9: Gelände per Polygon ausschneiden, echte
Wasserfläche mit Material darunter. Vor allem für Brückenprojekte.
Desktop zuerst, Web danach.

### 4. Ansichten in Szenen
Szenen haben eine optionale Liste benannter Kamerapositionen (`views`:
Name, `cameraLongitudeLatitudeHeight`, `cameraYaw`, `cameraPitch` – gleiche
Konvention wie die Szenenkamera; Format in `geobim-tiler/docs/SPEC.md`,
Kapitel 1). Desktop ist seit 20.10.2026 fertig.
- geoBIM.app reicht das Feld heute schon unverändert durch; Anzeige und
  Bearbeitung nachziehen (wie Desktop: Szenen-Ansichten oben in „Saved Views“,
  Kameraflug per Klick, Speichern / Umbenennen / Löschen, persönliche Slots
  1–9 unberührt).
- Danach die Web-iTwin-Demo auf eine Szene „Demo: iTwin Station“ mit den
  Ansichten Birdseye, Station, Platform, Atrium, Roof umstellen.
- Aufwand grob: ½ Tag.

### 5. iTwin Reality Data in Szenen
Realitätsdaten aus einem iTwin über die Reality Management API: jeder Datensatz
hat eine Reality-Data-ID, daraus eine signierte URL (3D Tiles, OPC, ...).
- geoBIM.app lädt sie schon (iTwin-Demo, Umgebungs-Mesh: `itwin_reality_<id>`
  in `itwin-demo.js` über `ITwinData.createTilesetForRealityDataId`), kann sie
  aber nicht in Szenen speichern.
- **Szenenformat:** Feld `iTwinRealityDataId` in `assets[]` (analog
  `iTwinIModelId`), ID-Schema wie bei iModels mit eigenem Präfix
  (`"itwin-reality:" + id`); in `geobim-tiler/docs/SPEC.md` festhalten
  (gemeinsam mit Desktop).
- Aufwand grob: ½ Tag.

### 6. VR-Brille im Browser (WebXR)
VR direkt im Browser per URL (Quest-Browser, ohne Installation), wie auf der
Cesium Developer Conference 2026 gezeigt (CesiumJS + WebXR + Cesium ion).
CesiumJS hat dafür keine offizielle Unterstützung (PR CesiumGS/cesium#11372 als
Ausgangspunkt). Bedienung wie im VR-Modus von geoBIM Desktop.
- Plan: `docs/WEBXR_PLAN.md` (nur lokal).
- Stand laut `CHANGELOG.md` (Unreleased): Bewegung, Einstellungen, Start aus
  der Globus-Ansicht und Bildausgabe im Quest-Browser umgesetzt; in der Brille
  noch nicht durchgehend geprüft.

### 7. 4D: Taktschieben der Siegtalbrücke realistisch animieren
Heute blendet `construction-schedule.js` nur ein/aus und färbt: jedes Feld
erscheint orange an seinem Endplatz. Ziel: der Stahlüberbau wächst am
Montageplatz und wird in Schubtakten über die Pfeiler geschoben (in geoBIM
Desktop seit 28.10.2026 vorhanden).
- **Entscheidungen (Christof):** Bewegung in Schubtakten, Vorbauschnabel
  schematisch, Felder wachsen am Montageplatz.
- **Daten** (`siegtalbruecke_4d_tiled`): Phase „Taktschieben des
  Stahlüberbaus von Norden“ (2032-01 bis 2033-08), Vorgänge T043.2–T043.8
  „Einschieben Feld k (bis Achse NN)“ mit je 5 Elementen (Stahlhohlkasten mit
  `feldNummer` / `feldKonstruktionshoeheM`, 2 Randlängsträger,
  2 Konsolträger). Achse „Neubau (Mitte Überbau)“ in `alignments.json`,
  1068 m, Achsmarken 10=0, 20=125, 30=317, 40=509, 50=701, 60=893, 70=1013,
  80=1068. Eine Kachel mit `EXT_mesh_features` (286 Elemente). In der IFC
  fehlen Vorbauschnabel und Takt-Eigenschaft.
- **Vorschubstrecke** d(t) von 0 bis 1068 m: pro Vorgang bis zur Achsmarke in
  Takten von 25 m (Stillstand für die Montage, dann Schub von etwa 1 Tag);
  zwischen den Vorgängen Stillstand. Überbau-Elemente um (d − 1068) entlang der
  Achse verschoben, hinter Station 0 geradlinig entlang der Anfangstangente.
- **Technik:** `CustomShader`, `vertexMain` liest `featureId_0` und holt den
  Versatz aus einer `TextureUniform` (ein Texel pro Feature), Zuordnung
  GlobalId → Feature-ID in JS über `getProperty('globalId')`. Fragment-Shader
  verwirft Überbau hinter −40 m (Montageplatz wächst), bewusst ohne
  `ClippingPlaneCollection` (Absturz in CesiumJS 1.145). PBR-Shader ist
  währenddessen aus (geteilter `tileset.customShader`).
- **Vorbauschnabel:** Cesium-Primitive, 60 m, verjüngt (hinten
  Konstruktionshöhe Feld 7, vorne ein Drittel), nur während der Phase.
- **Code:** eigenes Modul `construction-launch.js` plus kleine Hooks in
  `construction-schedule.js` (onActivate, onTime, onDeactivate,
  stateOverride); orange während der Phase, danach weiß. Tiler unverändert.
  Mit der Session „Bauablauf (4D)“ abstimmen, die `construction-schedule.js`
  betreut.
- Stand 28.10.2026: Konzept, noch nichts umgesetzt.

## Offen aus laufender Arbeit

- **Punktwolken-Einfärbung:** Server-Konverter (`scripts/convert_pointcloud.py`)
  braucht die Fixes aus `geobim-tiler` (Klassifikation bei LAS-Format 0–5 –
  laut `CHANGELOG.md` erledigt –, glb-Ausgabe mit Feature-IDs);
  `pointcloud.js` auf die glb-Attribute umstellen.
- **OpenStreetMap-Basiskarte wieder anbieten:** CARTO liefert die
  Voyager-Kacheln seit der Umstellung im September 2026 nur noch mit API-Key
  (ohne Key Platzhalter „API KEY REQUIRED“); bis dahin ist die Karte seit
  22.10.2026 aus der Auswahl genommen (`layerManager.js`), Esri Streets
  ersetzt sie vorerst. Key kostenlos bis 1 Mio. Anfragen/Monat kommerziell
  (darüber ab 500 $/Monat), Attribution „© OpenStreetMap contributors,
  © CARTO“ Pflicht. Umsetzung: Key beantragen, in `config.js` (nicht ins Repo),
  an die Kachel-URL hängen, Eintrag `osm` wieder aktivieren; Alternativen ohne
  Key (OSM-Kachelserver, OpenTopoMap, basemap.de) vorher abwägen.
- **Rocketbox-Bauarbeiter:** als glb mit Rocketbox' eigenen
  Idle/Walk/Run-Animationen (MIT).
