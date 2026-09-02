# Changelog

All notable changes to geobim.app will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **`hotel.glb`-Standardposition hinterlegt** (`core.js` `glbModelOverrides`): Punktwolke lädt jetzt direkt an der per Gizmo eingestellten Position/Höhe, kein manuelles Nachjustieren bei jedem Laden mehr nötig
- **Numerischer Heading-Regler für Tileset-Assets** (`ui.js`): der Gizmo-Rotationsring (`glb-gizmo.js`) ist eine tiefengetestete `Cesium.Entity`-Polyline — `disableDepthTestDistance` ist auf `PolylineGraphics` laut Cesium-API-Dokumentation wirkungslos (nur Point/Billboard/Label unterstützen es; im Code als bekannte Einschränkung dokumentiert), der Ring wird also von dichter Geometrie verdeckt statt immer obenauf zu liegen. Bei kompakten Gebäuden/Assets fiel das kaum auf, bei Punktwolken (Millionen Punkte, die den Pivot-Bereich dicht umschließen) macht es das Heading praktisch nicht mehr per Drag erreichbar — gemeldet an `hotel.glb`. GLB-Assets hatten dafür schon immer einen Slider (`updateGLBParam('heading', …)`), reguläre Tileset-Assets (`assetData.placement`) nicht. Neuer Slider auf der Asset-Karte für genau diesen Fall, ruft `BimViewer.updateAssetPlacement()` — dieselbe Funktion, die auch der Gizmo-Ring nutzt

- **Schnittebenen jetzt auch für GLB-Modelle** (`clipping-planes.js`): Der ✂️-Button wurde schon immer auf *jede* Asset-Karte injiziert (`injectClipButton` hängt sich typunabhängig an `BimViewerUI.createAssetControls`, das auch der GLB-Pfad in `core.js` aufruft), aber `activateAssetClipping` stieg bei `!assetData.tileset` stumm aus — auf GLB-Karten war der Knopf also sichtbar und tot. Ziel wird jetzt über `getClipTarget()` aufgelöst: `Cesium3DTileset` für 3D Tiles, `Cesium.Model` für GLB (gleiche `clippingPlanes`-API). Betrifft vor allem die eigenen Pipelines, deren Endformat GLB ist — infraFEM/SOFiSTiK-Ergebnisse, SIB-Brücken, SAF-Träger. Zwei Unterschiede zum Tileset-Fall sind dabei berücksichtigt: (1) Ebenendistanzen liegen im Frame der `modelMatrix` (`Model.js` `referenceMatrix ?? modelMatrix`), die bei GLBs die Asset-Skalierung enthält — die Slider bleiben in Welt-Metern und werden über `unitScale` umgerechnet, sonst läge crane1.glb (`scale: 0.01`) um Faktor 100 daneben; (2) die Achsen drehen mit dem Gizmo-Heading mit, sind also modell- statt nordbezogen — im Panel als „(model axes)" ausgewiesen. Ein Klick vor Ende des Ladens meldet das jetzt, statt nichts zu tun

### Fixed

- **GLB-Punktwolken wurden monochrom statt in Original-RGB gerendert** (`core.js`): `loadGLBAsset()` hängte allen nicht-WEA-GLBs unbesehen den prozeduralen „Concrete"-PBR-`CustomShader` an (`material.diffuse` fest auf Beton-Grau gesetzt) — der überschreibt jedes Material, inklusive der per-Vertex-`COLOR_0`-Farben, mit denen Punktwolken-Exporte (CloudCompare, Potree, Reality-Capture-Scans, mode-0-Primitives) ausschließlich eingefärbt sind. Neu: `_isLikelyPointCloudGLB()` liest per HTTP-Range-Request nur den glTF-JSON-Chunk (kein Download der oft riesigen Punktwolke) und prüft `primitive.mode === 0`; bei Treffer bleibt der Concrete-Shader aus und Cesiums Standard-PBR-Pfad rendert `COLOR_0` wie vom Modell vorgesehen. Getestet gegen `model/hotel.glb` (218-KB-JSON-Chunk, `POSITION`+`COLOR_0`, mode 0)
- **Point-Cloud-Settings (EDL, Punktgröße, Attenuation, Geometric Error, Back-Face-Culling) wirkten sich nicht auf GLB-Punktwolken aus** (`pointcloud.js`, `core.js`, `ui.js`): Das gesamte Modul war seit jeher ausschließlich auf `Cesium3DTileset` zugeschnitten (`assetData.tileset`, `Cesium3DTileStyle`) — GLB-Punktwolken (`assetData.model`, `Cesium.Model`) wurden von `applyPointCloudSettingsToAllTilesets()`, `getPointCloudInfo()` etc. schlicht nie erfasst, das Sidebar-Panel griff also ins Leere. Neu: `applyPointCloudSettingsToModel()` wendet dieselbe `Cesium.PointCloudShading`-Instanz, die auch `Cesium3DTileset.pointCloudShading` nutzt, direkt auf `Model.pointCloudShading` an; `applyPointCloudSettingsToAllTilesets()`, `getPointCloudInfo()` und `setColorMode()` erkennen GLB-Punktwolken jetzt zusätzlich zu Tileset-Punktwolken. Ausgenommen bleibt bewusst der Farbmodus-Wechsel (Height/Intensity/Classification): der liest 3D-Tiles-Batch-Table-Properties, die ein reines glTF mit nur `POSITION`+`COLOR_0` nicht besitzt — GLB-Punktwolken bleiben entsprechend immer bei Original-RGB, mit Konsolenhinweis statt stillem No-op. Der „PBR On/Off"-Knopf auf der GLB-Asset-Karte (der den Concrete-Shader reaktiviert hätte und damit die gerade gefixten RGB-Farben wieder überschrieben hätte) ist für erkannte Punktwolken jetzt ausgeblendet, `toggleGLBPbr()` bricht zusätzlich serverseitig ab
- **Punktgröße/Attenuation/Geometric-Error-Regler blieben trotz obigem Fix praktisch wirkungslos auf GLB-Punktwolken** (`pointcloud.js`): dekompilierter Cesium-1.141-Quellcode (`Build/Cesium/Cesium.js`) zeigt, dass die finale, attenuierte Punktgröße im Vertex-Shader als `min((geometricError/depth)*depthMultiplier, maximumAttenuation)` berechnet wird. Bleibt `maximumAttenuation` (unser „Maximum Attenuation"-Regler) auf `undefined`, fällt Cesium bei einem `Cesium3DTileset` intern automatisch auf `tileset.memoryAdjustedScreenSpaceError` (≈16 px) zurück — bei einem eigenständigen `Cesium.Model` (unser GLB-Fall, kein Tileset-Kontext) dagegen hart auf **1 px**. Jeder Punkt war also unabhängig von „Point Size" und „Geometric Error Scale" auf ~1 px gedeckelt. Fix: `applyPointCloudSettingsToModel()` setzt `maximumAttenuation` bei `undefined` jetzt explizit auf `16`, um den Tileset-Fallback nachzubilden
- **Sämtliche Regler außer dem reinen Attenuation-Ein/Aus-Toggle blieben weiterhin wirkungslos auf GLB-Punktwolken** (`pointcloud.js`): tieferliegende Ursache in `Model.js`s eigenem `pointCloudShading`-Property-Setter — `set(e){ e!==this._pointCloudShading && this.resetDrawCommands(); this._pointCloudShading=e }`. `resetDrawCommands()` (baut die Render-Pipeline inkl. der `HAS_POINT_CLOUD_ATTENUATION`/`HAS_POINT_CLOUD_BACK_FACE_CULLING`-Shader-Defines neu) feuert **ausschließlich**, wenn die komplette Objektreferenz ausgetauscht wird. Der bisherige Code wies `model.pointCloudShading` nur beim allerersten Laden neu zu und mutierte bei jedem weiteren Regler-Update (`setPointSize`, `setMaximumAttenuation`, `setGeometricErrorScale`, `setAttenuation`, …) nur noch dessen Felder in-place (`model.pointCloudShading.baseResolution = x`) — das erreicht den Setter nie wieder. Anders als bei `Cesium3DTileset`, das `attenuation`/`backFaceCulling` intern jeden Frame gegen den Vorwert diff't und bei Bedarf selbst zurücksetzt, hat `Model` keinen solchen Mechanismus. `applyPointCloudSettingsToModel()` erzeugt jetzt bei **jedem** Aufruf ein komplett neues `Cesium.PointCloudShading`-Objekt mit dem vollständigen aktuellen Settings-Stand statt einzelner Feld-Mutationen — jede Regler-Änderung löst damit garantiert einen Pipeline-Rebuild aus
- **Eye Dome Lighting hatte auf GLB-Punktwolken keinen Effekt** — Ursache: laut Cesium-1.141-Quellcode existiert der EDL-Screenspace-Pass (`_pointCloudEyeDomeLighting`) ausschließlich auf `Cesium3DTileset` und `TimeDynamicPointCloud` — `Cesium.Model` hat kein Äquivalent, keine Property-Kombination kann das nachträglich aktivieren. **Echter Fix statt Doku-Hinweis** (`core.js`): `loadGLBAsset()` erkennt Punktwolken jetzt schon *vor* dem Laden (`_inspectGLBForPointCloud()`, liest nur den JSON-Chunk per Range-Request, liefert dabei gleich die Bounding-Sphere aus den `POSITION`-Accessor-Bounds aller Primitives mit) und wickelt sie in ein minimales, rein clientseitig gebautes 3D-Tiles-1.1-`tileset.json` (als `data:`-URI, kein Server-Roundtrip, keine Re-Encodierung — 3D Tiles 1.1 erlaubt `.glb` direkt als `content.uri`). `root.transform` wird aus derselben `headingPitchRollToFixedFrame`-Matrix gebaut, die vorher an `Model.modelMatrix` ging (Scale hineinmultipliziert, da Tilesets keine separate `scale`-Option haben). Geladen wird per `Cesium3DTileset.fromUrl()` statt `Cesium.Model.fromGltfAsync()` — der Asset wird dadurch zu einem ganz gewöhnlichen Tileset-Asset (`assetData.tileset`, `isGLB: false`), wodurch Gizmo, Clipping-Planes, Z-Offset und `applyPointCloudSettings()` (dieselbe, bereits vorhandene Funktion für echte Ion-Punktwolken) ohne jede Sonderbehandlung greifen — **EDL und Attenuation funktionieren damit nativ**, live gegen `model/hotel.glb` verifiziert (zunächst manuell per Konsole gegen ein Test-`tileset.json`, danach die volle Automatik). Schlägt das Tileset-Wrapping ausnahmsweise fehl (z. B. Range-Requests vom Server blockiert), fällt der Code automatisch auf den bisherigen `Cesium.Model`-Pfad zurück — dort bleibt EDL wie oben beschrieben ein dokumentiertes Cesium-Limit, alles andere (RGB, Attenuation, Punktgröße) funktioniert weiterhin dank der vorherigen Fixes. Bewusst weiterhin ausgenommen: Farbmodus-Wechsel (Height/Intensity/Classification) — braucht 3D-Tiles-Batch-Table-Properties, die ein reines glTF mit nur `POSITION`+`COLOR_0` nicht hat, auch nicht über den Tileset-Wrapper

- **Gizmo-Drehpunkt lag weit neben dem Asset** (`glb-gizmo.js`, `splat-gizmo.js`): beide Gizmos verankerten Handles **und** Rotation am Transform-Ursprung des Assets — bei 3D Tiles die ECEF-Translation von `root.transform` (`core.js` `initAssetPlacement`), bei Splats die Baseline-Translation. Das ist der Georeferenz-Ursprung der Quelle, bei IFC-/Revit-Exporten typischerweise der Projekt-/Vermessungsnullpunkt und damit routinemäßig hunderte Meter neben der Geometrie. Folge: Pfeile und Ring schwebten weit vom Modell entfernt, und weil `updateAssetPlacement` (`ENU(pos,heading) × inverse(root.transform)`) bzw. `applyTransform` (post-multiplizierte Rotation) genau um diesen Punkt drehen, schwang das Asset beim Drehen auf einem weiten Kreisbogen davon statt sich um sich selbst zu drehen. Neu: ein **Pivot** = Bounding-Volume-Mitte horizontal, auf Höhe des Transform-Ursprungs (Ring liegt am Boden unter dem Modell; der Z-Pfeil startet weiterhin exakt bei `placement.height`, damit der Z-Offset-Slider kohärent bleibt). Beim Heading-Drag wird der Ursprung um denselben Winkel gegenläufig um den Pivot rotiert (`ENU(pivot) · rotZ(−Δ) · ENU(pivot)⁻¹`), sodass der Pivot stehen bleibt — Restfehler ~3 cm bei 500 m Versatz (ENU-Frames an verschiedenen Punkten sind nicht exakt parallel), vorher wanderte der Bezugspunkt bei 500 m/90° um ~760 m. Fällt auf den Transform-Ursprung zurück, solange das Bounding-Volume noch nicht geladen ist
- **Heading-Drag drehte im GLB-/Tiles-Gizmo gegen den Cursor** (`glb-gizmo.js`): Bildschirmwinkel wachsen im Uhrzeigersinn (Fenster-Y zeigt nach unten) und Heading wächst im Uhrzeigersinn ab Nord — das Minus vor `deltaDeg` war also falsch. `splat-gizmo.js` verwendete durchgehend ein Plus; die Gizmos widersprachen sich. Beide nutzen jetzt das Plus
- **Heading-Drag sprang beim Überqueren der ±180°-Naht** (`glb-gizmo.js`, `splat-gizmo.js`): die Rohdifferenz gegen den Startwinkel springt an `atan2`s Verzweigungsschnitt um eine volle Umdrehung. Ersetzt durch Aufsummieren entfalteter Frame-Inkremente — beliebig weit drehbar, und mit der neuen Gegenrotation hätte der Sprung das Asset sonst weggeschleudert
- **Asset sprang beim Verschieben unter den Cursor** (`glb-gizmo.js`, `splat-gizmo.js`): der Globus-Drag setzte den Ursprung direkt auf den Bodenpunkt unter dem Cursor, was das Asset um den Ursprungs-Versatz versetzte. Jetzt wird der Boden-Delta seit dem Greifen angewendet, der Greif-Offset bleibt erhalten
- **NRW LoD2 Gebäude schwebten über dem Terrain** (`layerManager.js`): der `ogc-api.nrw.de`-3D-Tiles-Dienst kodiert jedes Gebäude bei ~0 m WGS84-Ellipsoidhöhe — verifiziert durch Decoding realer glTF-Vertices an zwei weit auseinanderliegenden NRW-Standorten (Kölner Dom, ~55 m NHN, und Kahler Asten, NRWs höchster Punkt, ~841 m NHN); beide ergaben dieselbe ~0–15 m lokale Spanne, reale Geländehöhe ist also nicht enthalten. Der bisherige fixe `heightOffset: 100` (einmalig an Kölner Dom austariert) war daher nur dort richtig, überall tiefer gelegenen Gebieten (Rhein-/Ruhr-Niederungen) schwebten die Gebäude entsprechend zu hoch. Fix: `_alignNrwTilesetToTerrain()` sampelt beim Laden und bei jedem `camera.moveEnd` die reale Bodenhöhe (`scene.sampleHeightMostDetailed` — Terrain **oder** aktuell sichtbare 3D Tiles wie Google, eigenes Tileset ausgeschlossen) und verschiebt den Tileset per `modelMatrix`-Translation exakt dorthin. Referenzpunkt ist `camera.positionCartographic` (nicht ein Blickstrahl vom Bildschirmmittelpunkt — der schwenkt bei flachem Blickwinkel kilometerweit und lieferte damit je nach Zoom/Blickrichtung unterschiedliche Höhen), zusätzlich verhindert eine 300-m-Bewegungsschwelle unnötiges Neu-Sampling. (Zwischenzeitlich probeweise auf reine Identity-`modelMatrix` ganz ohne Korrektur umgestellt, nach unklarem Live-Test — führte aber dazu, dass die Gebäude tief unter dem Terrain vergraben und komplett unsichtbar wurden, was die ursprüngliche Diagnose bestätigt; wieder auf das Sampling zurückgestellt. Details in der Projekt-Memory `project_nrw_lod2_offset.md`.) `Cesium3DTileset.heightReference` (natives Clamp-to-Ground) wäre ohnehin nicht anwendbar gewesen — klemmt laut Cesium-Changelog nur Vector-3D-Tiles-Punktfeatures (Billboards/Labels), keine vollen Gebäude-Meshes
- **NRW LoD2 nach dem Laden wieder unsichtbar, ohne dass die Kamera bewegt wurde** (`layerManager.js`): `_alignNrwTilesetToTerrain()` gab bei fehlgeschlagenem Sampling (z. B. Terrain an der aktuellen Stelle noch nicht geladen) still auf — ohne erneuten Versuch blieb der Tileset dauerhaft bei der unkorrigierten (vergrabenen) Position, bis irgendwann ein `camera.moveEnd` das nachholte. Reines Betrachten nach dem Aktivieren des Layers, ohne zu navigieren, ist aber ein ganz normaler Anwendungsfall. Neu: bis zur ersten erfolgreichen Ausrichtung retryt die Funktion bis zu 12× im 500-ms-Abstand (`_retryAlignNrwTileset`, 6 s Budget statt vorher 2,5 s), bricht ab sobald der Layer deaktiviert wird. Zusätzlich löst `tileset.initialTilesLoaded` einen weiteren Ausrichtungsversuch aus, sobald die initialen Kacheln der (neu aktivierten) Ebene selbst da sind
- **NRW LoD2 blieb nach Toggle off/on dauerhaft unausgerichtet (kein Log, kein Fehler)** (`layerManager.js`): `entry.aligning` (Sperre gegen parallele Sample-Aufrufe) wurde bei `disableTileset()` nicht zurückgesetzt. Wurde der Layer deaktiviert während `sampleHeightMostDetailed()` noch async lief (typisch direkt nach dem Zoomen), blieb die Sperre `true` hängen — der frische Ausrichtungsversuch beim erneuten Aktivieren sah die verwaiste Sperre und brach sofort und lautlos ab, für immer, bis zufällig die Kamera bewegt wurde. Live in der Konsole beobachtet: nach dem letzten „enabled" fehlte jede „aligned to ground"-Zeile. Ein erster Fix (`entry.aligning = false` in `disableTileset()`) reichte nicht: ein spät auflösender, verwaister Call der *alten* Tileset-Instanz konnte das geteilte Boolean-Lock zurücksetzen, während der frische Call für die *neue* Instanz noch mittendrin war — Race Condition. Jetzt ist das Lock an die konkrete Tileset-**Instanz** gebunden (`entry._aligningTileset`, ersetzt das Boolean vollständig): ein Call löscht das Lock beim Abschluss nur noch, wenn er es selbst noch hält, was ausgeschlossen ist sobald eine neue Instanz übernommen hat — keine `disableTileset()`-Sonderbehandlung mehr nötig. Zusätzliche Härtungen aus demselben Log: (1) ein verwaister, spät auflösender Sample-Aufruf schreibt nicht mehr in einen zwischenzeitlich ausgetauschten Tileset (`entry.tileset !== tileset`-Check), (2) ein beobachteter Ausreißerwert (`-2823.6m`, offensichtlich unplausibel für NRW) wird jetzt wie ein fehlgeschlagenes Sampling behandelt und erneut versucht statt kurz übernommen zu werden — Plausibilitätsbereich -100 bis 1000 m
- **NRW LoD2 lud nur vom initialen Globe-View, bei nahem Zoom vorab blieb der Layer leer — trotz korrektem Ausrichtungs-Log ohne Fehler** (`layerManager.js`): der Tileset startet mit `modelMatrix` bei der rohen ~0m-Ellipsoidposition (bis zur ersten erfolgreichen Höhenkorrektur), was aus großer Kameradistanz (Globe-View) vernachlässigbar ist, bei nahem Zoom aber ausreicht, damit die (noch falsch platzierte) Bounding-Volume komplett aus dem Sichtkegel fällt. Cesiums Traversal entscheidet dann initial „nicht sichtbar" und fordert gar keine Kachel-Inhalte an — und diese Entscheidung wurde offenbar nicht zuverlässig neu bewertet, bis irgendein anderer Trigger (z. B. Kamerabewegung) durchgriff, was erklärt warum einmal sichtbare Gebäude danach beliebigem Zoomen anstandslos folgten. Fix: der Tileset startet jetzt mit `show = false` und wird erst von `_alignNrwTilesetToTerrain()` nach der ersten erfolgreichen Höhenkorrektur auf `show = true` gesetzt — Cesium bewertet die Sichtbarkeit dadurch nie mit einer falschen Position

### Changed

- **Schnittebenen-Bereich liegt jetzt um die Geometrie statt um den Rahmen-Ursprung** (`clipping-planes.js`): `computeClipRanges` spannte `±1,1·radius` symmetrisch um den Ursprung des Bezugsrahmens auf. Bei GLBs sitzt dieser Ursprung praktisch immer auf der Modellunterkante, nach oben reichte die Ebene also nur `1,1·radius` — und sobald ein Modell höher als breit ist, gilt `radius ≈ H/2`, die Z-Ebene blieb damit bei rund 60 % der Höhe stehen (gemeldet an „Free Atlanta"; nachgerechnet: 59 % bei 100 m × 40 m). Flache, breite Modelle waren nie betroffen, weil dort die Breite den Radius bestimmt. Der Bereich wird jetzt über `computeCenterOffsets()` auf die Bounding-Sphere-Mitte zentriert, gemessen gegen genau die Matrix, mit der Cesium schneidet (`Model.modelMatrix` bzw. `Cesium3DTileset.clippingPlanesOriginMatrix`) — dadurch ist der Versatz 0 für Assets, deren Ursprung ohnehin mittig liegt, und der bestehende 3D-Tiles-Pfad ändert sich dort nicht. Die Ebenen starten jetzt in der Mitte des Assets, und die Meterangabe im Panel ist relativ dazu (0,0 m = Schnitt durch die Mitte). Fällt auf den alten Bezug zurück, wenn der Rahmen noch nicht steht (`clippingPlanesOriginMatrix` liefert vor `ready` `IDENTITY`)
- **Achsen-Handles ziehen exakt statt geschätzt** (`glb-gizmo.js`, `splat-gizmo.js`): X-, Y- und Z-Pfeil laufen jetzt über denselben Pfad — der Cursor-Strahl wird auf die Achsgerade projiziert (Closest-Approach zweier windschiefer Geraden) und nur das Delta seit dem Greifen angewendet. Der Z-Drag schätzte Meter vorher aus Bildschirm-Y × Kameradistanz (`camDist * 0.001`) und driftete dadurch mit Zoom und Blickwinkel; X/Y hing an einem Terrain-Pick und brauchte geladenes Terrain. Der angefasste Punkt am Pfeil bleibt jetzt unter dem Cursor

## [1.10.0] — 2026-07-12

### Added

- **Asset-Gizmo für reguläre 3D Tiles — Ion-Location-Editor-Look** (`glb-gizmo.js`, `core.js`, `z-offset.js`, `ui.js`, `features.js`) — _live only (wie das GLB-Gizmo):_ das bisherige GLB-Gizmo wurde zu einem generischen Asset-Gizmo verallgemeinert, das jetzt auch reguläre 3D-Tiles-Assets (IFC/Revit/iTwin/CityGML/lokale Tiles) verschiebt/dreht, nicht nur GLB. **Transform-Modus** per Toolbar-Button (**Transform**, Lucide `move-3d`) oder Taste **X** (`BimGizmo.setTransformMode/toggleTransformMode`): solange AN, selektiert ein Klick jedes bewegliche Asset per Pick und die normale Element-Inspektion ist unterdrückt (Ctrl+Click erzwingt weiterhin die InfoBox); solange AUS, verhält sich alles normal und GLB bleibt wie gehabt immer selektierbar. Optik am Cesium Ion Location Editor orientiert: **drei farbige Achsen-Pfeile** (X=Ost=rot, Y=Nord=grün, Z=hoch=blau) mit **Pfeilspitzen** (`PolylineArrowMaterial` — bleibt via `disableDepthTest` immer sichtbar, echte Cone-Geometrie würde im Modell okkludiert) und achsen-beschränktem Ziehen + gelber Heading-Ring; kamera-skalierte, bildschirm-feste Handle-Größe. Tilesets werden statt per Silhouette (fehlt bei Tilesets) mit einer Bounding-Outline markiert. Transform via `core.js` `updateAssetPlacement` (`modelMatrix = ENU(pos,heading) × inverse(root.transform)`, non-cumulativ aus `assetData.placement`), Baseline beim Laden über `initAssetPlacement`
- **z-offset ↔ Gizmo Reconciliation** (`core.js`, `z-offset.js`, `glb-gizmo.js`): Höhen-Slider (Z-Offset) und Gizmo-Z-Handle teilen sich jetzt **ein** Feld. Bisher schrieben beide Systeme unabhängig `tileset.modelMatrix` und überschrieben sich gegenseitig. `initAssetPlacement` merkt sich die Original-Georef-Höhe als `placement.baseHeight` und markiert root.transform-abgeleitete Ion-Assets als `trusted` (dort gilt `ENU(baseHeight,0) × inverse(root.transform) ≈ Identity`, also keine Reorientierung). Für trusted-Assets leitet `applyZOffsetToAsset` den Offset in `placement.position.height` um und ruft `updateAssetPlacement` — **einziger** modelMatrix-Schreiber. Exotische Tilesets (Bounding-Sphere-Fallback) bleiben sicher auf dem Legacy-Translations-Pfad. Der Gizmo synct nach jedem Höhen-Drag den Karten-Slider (`syncZOffsetUI`), Clamp-to-Terrain und Reset laufen konsistent über dieselbe Höhe

### Changed

- _(interne Vorbereitung)_ pitch/roll-Rotationsringe und Placement-Persistenz bewusst nicht in dieser Version — Heading genügt für Georeferenzierung, Persistenz kommt später gemeinsam für GLB + Tiles

## [1.9.0] — 2026-07-12

### Added

- **3D Gaussian Splatting — Datensatz-Attribution / Lizenz** (`splat.js`, `FEATURES.md`): eine Splat-`tileset.json` kann jetzt verpflichtende Autoren-/Lizenzangaben unter `asset.extras.attribution` (`text`, `html`, `licenseUrl`, `required`) tragen. `loadSplat` liest das über `tileset.asset.extras` und zeigt `html` als **immer sichtbare, anklickbare Cesium-On-Screen-Credit** (unten rechts) an, solange der Splat geladen & sichtbar ist (ein-/ausgeblendet via `addStaticCredit`/`removeStaticCredit` in Load/Show/Hide/Remove). Erfüllt Lizenzen, die explizite Attribution mit aktiven Links verlangen (z. B. Teleportour / Andrii Shramko Drohnenscans); reist mit den Daten und funktioniert für jeden self-hosted Datensatz. Wiederverwendbares Template in `FEATURES.md`
- **Saved Views — optionaler weicher Übergang** (`features.js`, `ui-views-section.js`, `style.css`): neue Checkbox „Smooth transition" (standardmäßig **aus**) im Saved-Views-Tab. Ist sie aktiv, fliegt die Kamera beim Laden einer Ansicht weich in ~3 s zum Ziel (`camera.flyTo`, Dauer in `BimViewer.SMOOTH_VIEW_DURATION`) statt hart zu springen — eine Art Kamerafahrt zwischen gespeicherten Ansichten. Im Smooth-Pfad wird das nachträgliche Vektor-Snapping bewusst übersprungen (würde die Animation überschreiben); Default bleibt der instantane `setView`-Sprung. `flyTo` konvertiert die gespeicherten `direction`/`up`-Vektoren intern zu Heading/Pitch/Roll. Neue wiederverwendbare CSS-Klasse `.modern-check`

### Fixed

- **Geocoder-Suche liefert keine Ergebnisse (eingeloggte User)** (`core.js`): das Cesium-Such-/Geocoder-Widget nutzte den aktiven Login-Token. OAuth-App-Tokens (`client_id 1899`) haben nur den Scope `assets:list assets:read` und antworten am Ion-`/v1/geocode`-Endpoint mit **HTTP 404** — die Karte lädt, die Ortssuche bleibt aber leer. Fix: dem Geocoder-Widget wird nach der Viewer-Erstellung ein eigener `IonGeocoderService` zugewiesen, der fest den Server-Default-Token (`BimIonAuth.getDefaultToken()`, hat Geocode-Recht) verwendet — unabhängig davon, wer eingeloggt ist. Geocoding funktioniert damit sofort für alle User ohne Re-Consent

### Changed

- **3D Gaussian Splatting — Detail/SSE-Slider entfernt** (`splat-ui.js`, `splat.js`): der Per-Instanz-„Detail"-Slider wurde entfernt — auf CesiumJS 1.141 steuert bei großen Splat-Tilesets der interne Splat-Budget-Mechanismus das LOD (skaliert den SSE automatisch auf die GPU-Textur-Kapazität), sodass ein manuell gesetzter `maximumScreenSpaceError` praktisch keine sichtbare Wirkung hat. Dabei toten Code aufgeräumt: der `tileset.gaussianSplatPrimitive._dirty`-Poke (die Property existiert in 1.141 nicht mehr — stammte aus der 1.132-Ära). `BimViewer.setSplatSSE(id, n)` bleibt als Konsolen-/API-Hook erhalten
- **3D Gaussian Splatting — UI vollständig auf Englisch** (`ui-splat-section.js`, `splat-ui.js`, `splat.js`): die „Gaussian Splats"-Sidebar-Sektion ist jetzt durchgängig englisch — Labels (Source, Height, Rotation, Scale), Buttons (Load splat, Load demo, Clamp to terrain), Tooltips, Status-/Fehlermeldungen (inkl. CORS/404-Klartext)

### Docs

- **README.md / FEATURES.md**: Hinweis ergänzt, dass das Splat-Gizmo (Move/Rotate/Height) nur für self-hosted Splats wirkt — Ion-geladene Splats tragen ihre Georeferenzierung im Tile-Inhalt (ECEF-gebackene Geometrie, Identity-`root.transform`), sodass der Gizmo-Anker am Erdmittelpunkt landet und keine sichtbare Wirkung hat; solche Splats über die normale Asset-Pipeline (Z-Offset) repositionieren

## [1.8.0] — 2026-06-09

### Security

- **Web-Root `.git`-Schutz** (`.htaccess`): Zugriff auf VCS-Metadaten und sensible Dotfiles geblockt (`RewriteRule (^|/)\.(git|svn|hg|env)(/|$) - [F,L]`); verhindert das Auslesen von z. B. `/.git/config` aus dem Web-Root (der Web-Root ist ein Live-git-Checkout)

### Added

- **Assets-Panel — „Auf Gelände setzen" pro Asset** (`ui.js`, `integrated-zoffset-styles.css`): neuer Per-Asset-Button (Lucide `mountain`) in der Z-Offset-Zeile jeder Asset-Card ruft das bestehende `BimViewer.clampAssetToTerrain(assetId)` auf — sampled die Geländehöhe an der Asset-Position und setzt den Z-Offset relativ zur aktuellen Lage, sodass das Asset auf dem Terrain aufsitzt (UI-Slider/-Input synchronisieren automatisch). Ergänzt den bereits vorhandenen „Clamp all to terrain"-Button. Funktioniert für alle 3D-Tiles-Assets inkl. via Asset-Selektor geladener Ion-Gaussian-Splats
- **3D Gaussian Splatting** (`splat.js`): neues Modul lädt Gaussian-Splat-Rekonstruktionen als native Cesium 3D Tiles (glTF `KHR_gaussian_splatting`, ab CesiumJS 1.135 GPU-dekodiert — kein eigener Renderer). Quelle wahlweise per `url` (self-hosted `tileset.json`) oder `ionAssetId`. Splats laufen in eigener Registry (`BimViewer.splat.instances`, **nicht** in `loadedAssets`), damit IFC/Revit-Filter, IBL, Lighting, PBR-Shader, Env-Maps und Performance-Presets sie nicht anfassen (diese Systeme iterieren `loadedAssets` und würden das Splat-Rendering brechen). Jedes Splat-Tileset wird in `lighting.monitoredTilesets` registriert, damit der 2-Sekunden-Lighting-Monitor es überspringt (sonst „kurz sichtbar, dann weg"). API: `loadSplat()`, `removeSplat()`, `setSplatVisible/SSE/Height/Orientation()`, `clampSplatToTerrain()`, `flyToSplat()`, `listSplats()`, `loadSplatDemo()`. Höhenoffset entlang Ellipsoid-Normale + ENU-lokaler Orientierungs-Fix (non-cumulative via baseline-Transform). `clampToTerrain` löst Ellipsoid-vs-World-Terrain-Höhenversatz automatisch (Geländesample + Bounding-Sphere-Radius-Lift)
- **3D Gaussian Splatting — UI** (`ui-splat-section.js`, `splat-ui.js`, `splat-styles.css`): neue Sidebar-Sektion „Gaussian Splats" (Lucide `sparkles`, nach Point Cloud) mit URL/Ion-ID-Eingabe (Enter lädt), „Auf Gelände setzen"-Checkbox, Demo-Button und Liste der geladenen Splats (pro Instanz: Hinfliegen, Ein-/Ausblenden, Entfernen, Detail-/SSE-Slider, Höhen-Slider, Terrain-Clamp). Section-Content im `modern-*`-Stil wie die anderen Tabs; `BimSplat`-Global treibt die `splat.js`-Logik; `splat.js` ruft nach Load/Remove `BimSplat.refresh()` für Sync auch bei Konsolen-Aktionen. **Self-hosted-Härtung:** Status-/Fehler-Feedback beim Laden (CORS/404 werden klartextlich gemeldet, `BimViewer.splat.lastError`), Drehung-Slider (Z/Heading 0–360°) pro Splat für verdrehte Eigen-Scans + den 1.141-Orientation-Bug
- **3D Gaussian Splatting — Skalierung** (`splat.js`, `splat-ui.js`): uniformer Scale-Faktor pro Splat (`BimViewer.setSplatScale()`, `loadSplat({scale})`, logarithmischer „Größe"-Slider in der Instanz-Liste). 3DGS-Rekonstruktionen kommen oft in nicht-metrischen Einheiten → zu klein/groß; non-cumulative via `Matrix4.multiplyByUniformScale` auf die Baseline (um den Georef-Ursprung, unabhängig vom Höhenversatz)
- **3D Gaussian Splatting — Gizmo** (`splat-gizmo.js`): neues interaktives 3D-Gizmo (Geschwister von `glb-gizmo.js`, aber für Splat-`Cesium3DTileset` in eigener Registry). Auswahl über die Sidebar-Liste (Button Lucide `move-3d`), dann Drag-Handles: Mittelpunkt = auf dem Globus verschieben (`setSplatPosition()`), senkrechte Linie = Höhe, Ring = Drehung; Scale über den Sidebar-Slider. Eigener `ScreenSpaceEventHandler` (stört das GLB-Gizmo nicht: `_splatGizmoAxis`-Marker, `if(!active)`-Guard), Handles skalieren mit Kameradistanz, Esc hebt die Auswahl auf. `setSplatPosition()` zerlegt die Baseline einmalig in ENU×Reorient und re-ankert verschiebungssicher (erhält Converter-Reorientierung + Höhe + Heading + Scale)
- **3D Gaussian Splatting — gespeicherte Ansicht** (`splat.js`): `loadSplat({view})` speichert eine Kamera-Ansicht (`destination`+`orientation`) pro Instanz; initialer Flug **und** der „Hinfliegen"-Button (`flyToSplat`) nutzen sie statt der generischen Bounding-Sphere-Rahmung
- **3D Gaussian Splatting — Cochem-Demo** (`splat.js`, `ui-splat-section.js`, `splat-ui.js`): Ein-Klick-Demo „Reichsburg Cochem" (`BimViewer.loadSplatCochem()`, Sidebar-Button Lucide `castle`) — self-hosted Tileset mit fest eingebackener Platzierung (Position/Heading/Scale/Höhe in `root.transform`) und getunter Start-Ansicht
- **WEA Shadow — Guided Tour** (`onboarding.js`): die bestehende Onboarding-Tour unterstützt jetzt den WEA-Standalone-Modus (`window._weaDemoMode`); eigenes 9-Schritt-Step-Array (Welcome → Panel → Turbine laden → Schatten → Datum/Zeit → Play Day → Immissionsanalyse → Gebäudekontext → Sign-in-CTA) mit eigenem `localStorage`-Key (`geobim_wea_tour_v1`); Auto-Start wartet im WEA-Modus auf `#weaShadowPanel.visible` statt auf die (ausgeblendete) Sidebar
- **Atmosphere & Sky Presets** (`atmosphere.js`): neues Modul orchestriert `scene.skyAtmosphere` + Globe-Atmosphere + PostFX (Bloom, Color Grading) in 4 Presets — *Klarer Tag*, *Goldene Stunde* (warm/dramatisch), *Bewölkt* (desaturiert/Nebel), *Standard* (Cesium-Reset); wird automatisch mit "Standard" aktiviert
- **WEA Shadow — Layer Panel**: Google Maps Basemaps (Contour + Sat Labels via Cesium Ion) jetzt in der Basemap-Auswahl verfügbar
- **WEA Shadow — WMS One-Click-Presets**: Buttons "Helsinki Map" + "Cadastre" im Layer-Bereich (`addPresetWms`); laden Helsinki GeoServer WMS-Layer (`avoindata:Kantakartta` / `Kiinteistokartta`) direkt ohne Discovery; WMS-URL-Feld mit Helsinki-Service vorbelegt
- **WEA Shadow — Buildings-Kontext**: "Load Buildings & Terrain" lädt zusätzlich Ion-Asset `4510773` (BIMcollab IFC) als Gebäudekontext; Button mit Lucide-`house`-Icon statt Emoji
- **Demo-Asset**: "Porsche 911" (Ion-Asset `4872841`) in `DEMO_ASSETS` (`ui.js`)

### Fixed

- **3D Gaussian Splatting — SSE/Schärfe** (`splat.js`): Änderungen an `maximumScreenSpaceError` (Detail-Slider) wirkten nicht, weil `GaussianSplatPrimitive.update` (CesiumJS 1.141) seine aggregierten Splat-Puffer nur bei Kamerabewegung neu baut. `setSplatSSE()` erzwingt jetzt den Rebuild (`gaussianSplatPrimitive._dirty = true`); `loadSplat` hängt sich an `tileset.tileLoad`, damit asynchron nachladende Feindetail-Tiles nach einem SSE-Wechsel sichtbar werden (Rebuild + `requestRender`)

### Changed

- **Atmosphäre-Default**: Auto-Init wendet nicht mehr "Klarer Tag", sondern "Standard" an (`atmosphere.js`)
- **WEA Shadow — Default-Position**: von Wasserkuppe/Bayern (`11.508, 49.262`) nach Helsinki (`24.9587, 60.2043`) verschoben (`wea-shadow.js`)
- **WEA Shadow — Panel aufgeräumt**: Atmosphäre-Preset-Sektion (2×2 Grid) aus dem WEA-Panel entfernt
- **InfoBox-Position**: von oben-rechts nach unten-links verschoben, Slide-In jetzt von links (`style.css`)

### Fixed

- **WEA Rotor Animation**: Concrete PBR-Shader wird nicht mehr auf WEA-Modelle angewandt (Turbinen haben eigene PBR-Texturen); `model._ready` durch `model.ready` (public API) ersetzt; `_restartGLBAnimations` robuster: Safety-Guard für `duration=0`, Fallback auf `add({index:0})` und plain-`multiplier` wenn `addAll` keine Animationen findet; WEA-Rotoranimation komplett auf `scene.postUpdate` + direktes `node._transform` umgestellt (`_startWeaRotation`/`_stopWeaRotation` in `wea-shadow.js`): `model.activeAnimations` wird für WEA nicht mehr verwendet — mehrere Turbinen derselben GLB-URL teilen Cesiums `ResourceCache`, jede `addAll`/`removeAll`-Operation auf einer Instanz betrifft alle; `postUpdate`-Listener rotiert den `bladesRuntimeNode` mit Wanduhr-Zeit (unabhängig vom Scene-Clock), Speed-Änderungen wirken sofort ohne Neustart
- **OpenStreetMap Basemap**: ersetzt deprecated `OpenStreetMapImageryProvider` + direkte OSM-Tile-Server durch `UrlTemplateImageryProvider` mit CARTO Voyager Tiles (OSM-Daten, CARTO-CDN, commercial use erlaubt, kein TOTP-Blocking)

### Added

- **WEA Shadow — Day Animation (Play Day)**: Play-button animiert den Zeitslider automatisch durch den Tag; Speed-Selektor ×30/×60/×180/×360 (Echtzeit-Minuten pro Sekunde); `requestAnimationFrame`-Loop mit delta-time
- **WEA Shadow — Add 2nd Turbine**: Lädt dasselbe Modell ein zweites Mal mit +0.005° Lon-Versatz (~400 m) relativ zur letzten geladenen Anlage; beide synchron durch "Play Day" animierbar
- **WEA Shadow — Receptor (Immissionspunkt)**: "Set Receptor"-Button aktiviert Crosshair-Modus; Klick auf Karte setzt orangen Point-Entity + Label ("Receptor 1/2/…"); Liste im Panel mit Einzellöschung; `disableDepthTestDistance` für Sichtbarkeit vor Terrain
- **WEA Shadow — Layer Manager Panel**: separates Floating Panel (draggable, `right: 330px`); Basemap-Radio-Buttons für alle 7 Basemaps (`BimLayerManager.switchBasemap()`); WMS/WMTS/WFS-Discover-Flow (URL → GetCapabilities → Layer-Picker → Add); geladene Layer mit Sichtbarkeits-Toggle und Remove; "Layer Manager"-Button im WEA-Panel; CSS `#weaLayerPanel` in `style.css`
- **WEA Shadow — View from Receptor**: Auge-Icon neben jedem Receptor; Kamera fliegt auf Augenhöhe (Terrain + 1.7 m) und schaut präzise zur Nabenhöhe der nächsten WEA (Heading aus Lon/Lat-Delta, Pitch aus `atan2(ΔHöhe, Distanz)`); Sichtachsenprüfung für Behördenpräsentationen

## [1.7.4] — 2026-05-20

### Added

- **System overview page** (`overview.html` + `overview-styles.css`) — standalone HTML/CSS infographic at `/overview.html`: 4-tier architecture diagram (expandable details boxes), Cesium platform section, 10 feature cards, 6 use-case cards; no build step, no external JS frameworks, Lucide icons, dark design using brand tokens

### Fixed

- **Version strings** in `splash-screen.js` and `about-feedback.js` corrected to 1.7.3 (were stuck at 1.7.2)

## [1.7.3] — 2026-05-13

### Added

- **Bridge Inspector demo** (`bridge-inspector.js`) — anonymous 30-min demo at `/bridge-inspector`; auto-loads 5 bridge assets (IFC, Reality Mesh, Pointcloud, RC Bridge, Dublin Bridge); session countdown, expired overlay
- **IOT live button** in Loaded Assets card for Bridge Belgium — pulses teal, toggles FROST SensorThings panel; `#staToggleBtn` replaced by in-card control
- **STA info flyout** — `ⓘ` button in Bridge Monitoring Live panel explains all 4 sensor types (Acceleration, Inclination, Temperature, Strain) with thresholds
- **STA prefetch** — FROST data fetched as soon as Bridge Belgium loads so IOT button opens instantly; `$top` reduced 50 → 10
- **Inspection report generator** (`inspection-report.js`) — "Export Report" button in Inspection sidebar opens a print-optimised HTML page (logo, summary stats, component breakdown, per-finding screenshots); `window.print()` → PDF
- **Screenshot capture on inspection save** — `preserveDrawingBuffer: true` on Cesium Viewer; 480×270 JPEG thumbnail stored in Firestore with each inspection finding
- **Comment TTL auto-cleanup** — `COMMENT_TTL_HOURS = 24`; expired docs deleted from Firestore via batch query before loading; applies to both `demo_comments` and `bridge_demo_comments`
- **Tablet support**: long-press (600 ms) on Cesium canvas places annotations (mirrors RIGHT_CLICK); touch drag for all floating panels (`makeFloatingPanelDraggable`); `.cd-grid-3` collapses to single column on ≤768px; select min-height 44px

### Fixed

- **Clipping broken in all modes** — `ui-clipping-extension.js` overrode `BimViewerUI.getDrawingContent` but `ui.js` called `GEOBIM_DRAWING_UI.getContent()` instead; `ui.js` now prefers `this.getDrawingContent()` when available — clipping polygon and rectangle drawing now work
- **Point cloud preset not applied** in Bridge Inspector — `hasTileContent` returns false for point clouds (`featuresLength === 0`), causing detection timeout; Bridge Pointcloud (4446751) is now force-marked and quality preset applied directly
- **Ion asset names hardcoded** — `fetchAvailableAssets` now queries `api.cesium.com/v1/assets` with the static Ion token; `DEMO_ASSETS` map used only as fallback; names update automatically when changed in Ion

### Changed

- **Damage type dropdown** expanded from 6 → 14 structured options in 4 `<optgroup>`s (Concrete, Steel/Rebar, Water/Movement, Surface/Other)
- **Component dropdown** expanded from 6 → 11 options in 3 groups (Superstructure, Substructure, Secondary Elements)
- **Loaded Assets panel** height is now dynamic (`max-height: calc(100vh - 100px)`, `height: auto`) — panel grows and shrinks with expanded asset cards instead of fixed 500px cap
- **Damage simulation button** (⚠ Damage) hidden by default in Bridge Inspector mode
- **IoT toggle button** always hidden in Bridge Inspector (Pegel Deggendorf irrelevant to Belgian bridge)
- **Bridge Inspector KEEP_SECTIONS** — removed `assets` (auto-loaded, selector hidden)

## [1.7.2] — 2026-05-07

CesiumJS upgrade from 1.139.1 to 1.141 (skipping 1.140). Brings clipping performance fixes directly relevant to `clipping.js` / `clipping-planes.js`, plus general engine improvements.

### Changed

- **CesiumJS upgraded to 1.141** (was 1.139.1)
- Documentation refs updated across `README.md`, `FEATURES.md`, `CLAUDE.md`, and per-module "Tested with" comments
- SkyBox texture URLs in `core.js` remain pinned to 1.134 (immutable CDN, intentional)

### Notable Cesium changes consumed

- **1.140 — ClippingPolygon performance + quality** improvements on `Cesium3DTileset` (multiple ClippingPolygons, ClippingPolygonCollection)
- **1.140 — Gaussian splat** memory leak fix, large-tileset crash fix (>16M splats), modelMatrix fix
- **1.140 — Camera zoom** behavior fix when transform is set (`lookAt`, `trackedEntity`)
- **1.141 — Vector tilesets** now support `EXT_structural_metadata`

### Breaking changes (not impactful for geobim.app)

- **1.140**: Billboards/Labels require WebGL 2 or WebGL 1 with `ANGLE_instanced_arrays` (all modern browsers OK)
- **1.141**: Min Node 22 — only matters for build pipelines, geobim.app loads via CDN
- **1.141**: `BufferPrimitiveCollection` properties read-only — not used in geobim.app

## [1.7.1] — 2026-05-07

Stability & maintainability release. No new user-facing features.

### Changed

#### `ui.js` Refactor
- Extracted 13 sidebar/toolbar sections out of `ui.js` (2303 → 831 lines, **-64%**)
- New section modules: `ui-{assets,comments,drawing,ifc,layer,lighting,pointcloud,revit,settings,split,views,visibility,about}-section.js`
- Each module exposes `GEOBIM_<NAME>_UI.getContent()` and `GEOBIM_<NAME>_UI.initHandlers()`
- `ui.js` now only carries toolbar scaffolding (`createModernToolbar`, `createBottomToolbar`, `createSection`), global init wiring, and cross-cutting helpers (`autoLoadIonAssets`)
- `ui-split-section.js` absorbs full Split View feature (`toggleSplitView`, slider drag, Google 3D Tiles unclipped left-copy management); `core.js` Google 3D Tiles integration retargeted to `GEOBIM_SPLIT_UI.X`

### Fixed

- `auth-gate.js`: `signOut()` promise now has a `.catch` so reload still happens on sign-out failure (was: silent unhandled rejection)
- `wea-shadow.js`: replaced two silent catch blocks with `console.warn` so WEA model discovery / GLB analysis failures surface in the console (was: presented as "no models available" with no diagnostic)

## [1.7.0] — 2026-04-15

### Added

#### Post-Processing Effects Module (`postfx.js`)
- Bloom (Cesium built-in) — toggleable with contrast, brightness, sigma, stepSize
- Lens Flare (Cesium built-in) — intensity, distortion, ghostDispersal, haloWidth
- Vignette + Color Grading (custom GLSL) — vignette strength/radius, contrast, saturation, warmth, brightness
- New "Cinematic" performance preset — MSAA 4x + Bloom + Lens Flare + Vignette + SSAO + resolutionScale 1.5
- All effects wrapped in try/catch for mobile WebGL compatibility
- Public API: `GEOBIM_POSTFX.setBloom()`, `.setLensFlare()`, `.setColorGrading()`, `.activateCinematic()`

#### Cesium Ion OAuth2 Integration
- OAuth2 PKCE flow for connecting personal Cesium Ion accounts (`ion-auth.js`)
- Ion status indicator (top-right) with connect/disconnect dropdown
- Asset selector shows user's own 3D Tiles and GLB assets when connected
- Demo token moved server-side (`api/ion-config.php`) — no longer hardcoded in JS
- Curated demo asset list with proper names (was: numeric IDs only)
- Required Ion Assets info panel (Cesium World Terrain, Bing Maps, Google Maps)
- Graceful error messages when Ion assets are not activated in user's account
- Token persistence via localStorage, automatic refresh (90-day refresh token)
- Asset list auto-reloads on connect/disconnect

### Changed

#### Google 3D Tiles Rendering Optimization
- `skipLevelOfDetail` set to `false` in all presets — eliminates hole/seam/stretched texture artifacts
- `dynamicScreenSpaceErrorFactor` updated from 4.0 to 24.0 (new CesiumJS default, 39% faster loading)
- Shadows disabled on Google tiles (`KHR_materials_unlit` — no visual effect, saves GPU)
- `backFaceCulling` set to `false` in all presets — fixes missing faces from inconsistent winding
- Fog re-enabled with Google tiles — masks LOD transitions at horizon
- Cache updated to Google defaults: 1.5 GB + 1 GB overflow (replaces deprecated `maximumMemoryUsage`)
- `enableCollision: true` added for walk mode `pickFromRay` support

### Fixed

#### Walk Mode
- T key (Player Start) now works from any mode — first-person, third-person, or normal orbit
- Third-person collision upgraded from single ray to fan of 6 rays (3 directions × 2 heights)
- Third-person edge detection added — character blocked at cliff edges (>2m drop)
- Mouse sensitivity slider now correctly defaults to match config value (0.003)
- Cesium clock multiplier always restored on third-person deactivate (prevents frozen shadows/WEA)

## [1.6.0] — 2026-03-29

### Added

#### Third-Person Navigation
- Third-person mode with Cesium_Man.glb animated character (V key to toggle)
- Unreal Engine-style controls: character faces movement direction, no backward walking
- Camera follows via `trackedEntity`, right stick/mouse orbits around character
- Player Start (T key): click any surface to set spawn point (terrain, rooftops, 3D tiles)
- Walk animation synced to movement speed, stops on idle
- Wall collision against 3D Tiles mesh geometry
- Terrain + 3D tile dual floor clamping (`globe.getHeight` + `pickFromRay`)

#### First-Person Improvements
- Raycast wall collision (6 rays, 3 directions × 2 heights, throttled 10x/sec)
- Velocity smoothing (lerp acceleration/deceleration for keyboard + gamepad)
- Unified gamepad + keyboard input pipeline (merged by magnitude)
- Xbox controller right stick inversion fix
- Inspection-speed tuning (moveSpeed=0.15, smooth acceleration)
- Terrain clamping via downward raycast (fixes indoor floor jumping)
- Wall Collision toggle in settings panel

#### UI Refresh (15-point roadmap)
- **Bottom Action Toolbar**: Measure, Visibility, Lighting, Walk, Help (Speckle-style)
- **Lucide SVG Icons**: 14 toolbar section emojis replaced with consistent SVG icons
- **Unified Brand Color**: 147 occurrences of legacy `#6EECD8` replaced with `#2ECFB0`
- **Glassmorphism**: Panel opacity reduced from 0.95 to 0.82 (scene shows through)
- **Design Token System**: CSS variables for spacing, radius, shadows, input surfaces
- **Inline Styles Extracted**: ~120 lines from comment dialog → `comments-styles.css`
- **Loading Skeletons**: Shimmer animation for async loading states
- **Enhanced Empty States**: Icon + title + contextual hint (was: plain gray text)
- **Property Panel Redesign**: Search filter + copy-to-clipboard on every value
- **Contextual Cursors**: Crosshair (measure), Cell (clip), Copy (comment), Pointer (hide)
- **Panel Transitions**: Slide/fade animations with cubic-bezier easing
- **Guided Tour / Onboarding**: 6-step spotlight tour, localStorage persistence
- **Accessibility**: `prefers-reduced-motion`, focus-visible states, Z-index variables
- **Mobile**: Touch targets ≥ 44px, panels positioned above bottom toolbar

#### CesiumJS 1.139.1 Features
- HBAO (Horizon-Based Ambient Occlusion) replaces legacy SSAO
- Dynamic Environment Maps configured per tileset for better reflections
- AO toggle button in Lighting sidebar section
- Verified PBR Neutral tone mapping and ES6 Cartesian class compatibility

#### Performance
- `scene.pick()` → `await scene.pickAsync()` migration (6 call sites)
  Non-blocking GPU readback prevents pipeline stalls during BIM interaction
- 3D tile floor raycast throttled to 5x/sec (prevents tile flickering)
- Height smoothing via lerp (eliminates terrain/tile oscillation)

#### Demo Mode
- `/demo` URL: 30-minute full-access trial without login
- Demo banner with countdown timer (teal → amber → red + blink)
- Auto-opens About dialog on entry (with "Take a guided tour" button)
- Firestore demo collections open for unauthenticated access
- Session persists across page refresh (sessionStorage)
- Expired overlay with sign-in CTA and restart option

#### Quality Assurance
- `qa-check.sh`: 10-section automated pre-release check script
- `QA-CHECKLIST.md`: 18-section, ~80-point manual browser test checklist

### Fixed
- Measurement tool click no longer activates first-person mode (BUTTON tag filter)
- V key conflict between third-person toggle and clipping visualization
- W/A/C keys blocked in walk mode to prevent WEA/comment/annotation activation
- ESC/ENTER keyboard handler conflicts resolved with `stopPropagation` + context checks
- Copy button XSS with special characters in IFC property values
- Walk button active state no longer cleared by section button clicks
- Floating panels positioned above bottom toolbar on mobile
- Status indicator repositioned above bottom toolbar
- Dead CSS selector `#modernCommentsPanel` → `#floatingCommentsPanel`
- Dead CSS for removed iTwin integration cleaned up
- Missing `await` on `_originalClickHandler` in hideFeatures.js async chain
- ESC not fully exiting walk mode (third-person + orbit controls not restored)
- WASD not working after activating walk mode via bottom toolbar (button focus issue)
- Measurement cursor stuck as crosshair after measurement completes
- Measurement panel not auto-opening from bottom toolbar Measure button
- setPointerCapture errors when switching to third-person mode
- Demo mode login dialog appearing (race condition with auth flags)
- Infinite "Waiting for anonymous auth" loop in demo mode

### Changed
- CLAUDE.md completely rewritten with current architecture, conventions, and rules
- Sidebar reorganized: action tools moved to bottom toolbar, data tools remain
- Comment dialog: all inline styles extracted to CSS classes (`cd-*` namespace)
