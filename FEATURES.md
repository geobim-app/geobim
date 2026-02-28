# geoBIM.app — Feature Reference

**CesiumJS 1.138** | Vanilla JavaScript | No build step

---

## 1. Authentication & Configuration

| Feature | Description | Files |
|---|---|---|
| Demo Mode | Auto-applies demo Cesium Ion token without login. Anonymous Firestore access for shared comments. | `auth.js` |
| Email/Password Login | Optional Firebase auth gate overlay. Persistent sessions, logout support. | `auth-gate.js` |
| External Config | Firebase credentials in `config.js` (gitignored). Template provided as `config.example.js`. | `config.js`, `config.example.js` |
| Splash Screen | Branded landing page with "Enter Demo" button, copyright, license, and contact info. | `index.html` |
| Plausible Analytics | Privacy-friendly tracking (no cookies). Events: Enter Demo, Asset Loaded, Feature Used, Contact Click. | `index.html`, various |

---

## 2. Asset & Model Management

| Feature | Description | Files |
|---|---|---|
| Cesium Ion Asset Loading | Load 3D Tiles from Ion via REST API. Curated whitelist of valid asset IDs. Tile content polling after flyTo. | `core.js`, `ui.js` |
| iTwin Model Integration | Load Bentley iTwin iModels via share keys and iModel IDs. | `core.js` |
| Asset Visibility Toggle | Show/hide individual loaded assets. | `core.js`, `ui.js` |
| Asset Opacity Control | Adjust transparency per asset (0–1 slider). | `core.js`, `ui.js` |
| Asset Unloading | Remove assets from viewer with full cleanup of UI and references. | `core.js`, `ui.js` |
| Zoom to Asset | Fly camera to asset bounding sphere. | `core.js` |

---

## 3. Layer & Terrain Management

| Feature | Description | Files |
|---|---|---|
| Basemap Switcher | 6 options: Bing Aerial (default), Bing Roads, OSM, Google Contour, Google Satellite w/ Labels, None. | `layerManager.js` |
| Terrain Providers | Cesium World Terrain (default), Cesium World Bathymetry, custom terrain via Ion Asset ID. | `layerManager.js` |
| OSM Buildings | Toggle OpenStreetMap 3D building footprints. Auto-disabled when Google 3D Tiles active. | `core.js` |
| Google 3D Tiles | Photorealistic 3D buildings (Ion Asset 2275207). 3 quality presets: Performance, Balanced, Quality. | `core.js` |
| Globe Transparency | Toggle terrain translucency and adjust opacity (0–1) for underground viewing. | `core.js` |
| Globe Fade by Distance | Distance-based terrain transparency with configurable near/far alpha. | `core.js` |
| Underground Mode | Disable terrain collision detection for below-ground camera navigation. | `core.js` |

---

## 4. IFC & Revit Filtering

| Feature | Description | Files |
|---|---|---|
| IFC Entity Filter | Filter 3D Tiles by 31 IFC entity classes (IfcWall, IfcDoor, IfcColumn, etc.) with color-coded visualization. OR-logic show conditions. | `features.js`, `core.js` |
| IFC Auto-Detection | Auto-detect IFC property name (className, IfcEntity, etc.) from tile content. Inline detection with caching. | `features.js`, `core.js` |
| Revit Category Filter | Filter by 34+ Revit categories with English/German name mapping (e.g., "Wände" → "Walls"). | `features.js`, `core.js` |
| Select/Deselect All | Bulk toggle all IFC entities or Revit categories on/off. | `features.js` |
| Manual Property Override | Override auto-detected IFC property name per asset via dropdown. | `features.js` |

---

## 5. Feature Selection & Properties

| Feature | Description | Files |
|---|---|---|
| Element Selection | Left-click to select 3D elements. Lime green highlight on selection. | `features.js` |
| Property Display | Popup info box with properties grouped by: Identification, Geometry, Material, Building Physics, Manufacturer, OSM. | `features.js` |
| Silhouette Outline | Post-processing glow outline on selected elements. 6 color options, adjustable strength. | `features.js` |
| Hide Individual Elements | Click-to-hide mode (H key). Undo per element or show all (Shift+H). Persists across style changes. | `hideFeatures.js` |

---

## 6. Measurements

| Feature | Description | Files |
|---|---|---|
| Distance | Click 2 points. Shows total, horizontal, and vertical distance with glow line. | `measurement.js` |
| Area | Click 3+ points, right-click or Enter to finish. Polygon area + perimeter with semi-transparent fill. | `measurement.js` |
| Height over Terrain | Click one point. Shows height above terrain, terrain elevation, and WGS84 height. | `measurement.js` |
| Vertical Distance | Click 2 points. Shows +/- height difference with direction indicator. | `measurement.js` |
| Coordinate Picking | Click one point. Shows lat/lon (7 decimals), WGS84 height, terrain height. Copy-to-clipboard button. | `measurement.js` |

---

## 7. Clipping & Section Planes

| Feature | Description | Files |
|---|---|---|
| Polygon Clipping | Draw arbitrary polygons via right-click. Cyan numbered markers, dashed lines. Min 3 points. | `clipping.js` |
| Rectangle Clipping | 3-point rectangle mode: corner 1, corner 2 (edge), corner 3 (width). Live preview. | `clipping.js` |
| Inverse Clipping | Flip clipping inside/outside. | `clipping.js` |
| Terrain Clipping | Toggle terrain inclusion in clipping (Buildings Only vs. Buildings + Terrain). | `clipping.js` |
| Clipping Visualization | Show/hide cyan polygon fill while clipping stays active. | `clipping.js` |
| Polygon Management | Remove last polygon (DEL), remove specific polygon by ID, clear all, flip orientation (F). | `clipping.js` |

---

## 8. Annotations & Comments

| Feature | Description | Files |
|---|---|---|
| Point Comments | Right-click to place annotation with title, text, category, and priority. SVG billboard marker. | `comments.js` |
| Area Annotations | Right-click 3+ points to draw polygon annotation with fill, outline, and center label. Calculates area. | `comments.js` |
| Categories | General, Architecture, Structure, MEP, Issue, Question. | `comments.js` |
| Priorities | Low, Normal, High (color-coded markers). | `comments.js` |
| Firestore Persistence | CRUD operations on shared Firestore collection. Real-time sync across users. | `comments.js` |
| Comment Fly-To | Click comment in list to fly camera to annotation location. | `comments.js` |
| Edit & Delete | Edit existing comments via dialog. Delete individual or all comments. | `comments.js` |
| Visibility Toggle | Show/hide all comments at once. | `comments.js` |
| Comment Dialog | Modal with title, text, category, and priority selectors. Auto-positioned near click location. | `comments.js`, `index.html` |

---

## 9. Z-Offset (Vertical Positioning)

| Feature | Description | Files |
|---|---|---|
| Per-Asset Z-Offset | Slider -70m to +70m per asset. Relative to original position, no terrain calculation. | `z-offset.js` |
| Global Z-Offset | Shift+PageUp/Down to raise/lower all visible assets by 1m increments. | `ui-z-offset-extension.js` |

---

## 10. Saved Views

| Feature | Description | Files |
|---|---|---|
| Save View | Capture camera position, orientation, Google Tiles state, and clipping state. | `features.js` |
| Load View | Restore saved view with camera and scene state. Keys 1–9 for quick load. | `features.js` |
| Delete View | Remove saved view by slot number. | `features.js` |
| View List | UI list showing slot number, capture time, and altitude. | `features.js`, `ui.js` |

---

## 11. Split-Screen View

| Feature | Description | Files |
|---|---|---|
| Split Mode | Divide viewport into left/right halves for before/after comparison. | `core.js`, `ui.js` |
| Google Tiles Split | Left copy of Google 3D Tiles created automatically for side-by-side view. | `ui.js` |
| Slider Control | Draggable horizontal separator to adjust split position. | `ui.js` |

---

## 12. Lighting & Rendering

| Feature | Description | Files |
|---|---|---|
| Dynamic Lighting | Sun-based shadows with globe lighting, dynamic atmosphere, and time-of-day control. | `lighting.js` |
| Time Presets | Dawn, Morning, Noon, Afternoon, Sunset, Dusk, Night, Midnight. | `lighting.js` |
| Time Animation | Animate sun position with adjustable speed multiplier. | `lighting.js` |
| Shadow Quality | Soft shadows, normal offset, configurable max distance (150m–500m) and bias per preset. | `lighting.js`, `core.js` |
| Shadow Intensity | Adjustable darkness (0–1). Default 0.4. | `lighting.js` |
| Sun Intensity | Adjustable brightness. 0.75 default, 0.85 with dynamic lighting. Prevents overexposure on white BIM surfaces. | `core.js` |
| IBL (Dynamic) | Real-time environment reflections via CesiumJS environmentMapManager + spherical harmonics. | `ibl.js` |
| IBL (Static) | Pre-baked KTX2 cubemap (Kiara 6 Afternoon) for consistent outdoor lighting. | `ibl.js` |
| IBL Diffuse/Specular | Independent sliders for diffuse (0.35 default) and specular (0.25 default) IBL contribution. | `ibl.js` |
| SSAO | Screen-space ambient occlusion. Configurable intensity, bias, directions, step size, blur. Optimized for BIM geometry. | `core.js` |
| PBR Neutral Tone Mapping | Prevents overexposure on bright surfaces. Applied at viewer init. | `core.js` |
| FXAA | Fast approximate anti-aliasing toggle. | `core.js` |
| MSAA | Multi-sample anti-aliasing (4x, Ultra preset only). | `core.js` |
| HDR | High dynamic range rendering toggle. | `core.js` |

---

## 13. Point Cloud Support

| Feature | Description | Files |
|---|---|---|
| Auto-Detection | Detect point clouds by tile URI (.pnts), Ion asset metadata, or IFC property absence. | `pointcloud.js` |
| Eye Dome Lighting | EDL post-processing for depth perception. Adjustable strength and radius. | `pointcloud.js` |
| Color Modes | RGB (original), Height gradient, Intensity, Classification (ASPRS colors). | `pointcloud.js` |
| Point Size | Base pixel size (0.5–10px). Default 2.0. | `pointcloud.js` |
| Distance Attenuation | Scale points by camera distance. Max attenuation factor 1–10. | `pointcloud.js` |
| Geometric Error Scale | LOD quality multiplier (0.5–3.0). | `pointcloud.js` |
| Back Face Culling | Performance toggle for culling back-facing points. | `pointcloud.js` |
| Presets | Quality (EDL 1.5x, size 3), Performance (no EDL, size 1.5), Detailed (EDL 2x, size 4). | `pointcloud.js` |

---

## 14. Performance Management

| Feature | Description | Files |
|---|---|---|
| 4 Performance Presets | Performance, Balanced, Quality, Ultra — control SSAO, shadows, LOD, memory, anti-aliasing. | `core.js` |
| Tileset-Level Settings | `maximumScreenSpaceError`, `maximumCacheSize`, `skipLevelOfDetail`, `cullRequestsWhileMoving`, `preloadWhenHidden`, `dynamicScreenSpaceError` applied per tileset. | `core.js` |
| Google 3D Tiles Protection | `skipLevelOfDetail` forced false for Google tiles to prevent black crack artifacts. | `core.js` |
| New Asset Auto-Config | Newly loaded tilesets automatically receive current performance preset settings. | `core.js` |

---

## 15. User Interface

| Feature | Description | Files |
|---|---|---|
| Collapsible Sidebar | 12 sections with icons. Only Assets section open by default. Toggle via M key. | `ui.js` |
| Per-Asset Controls | Visibility, zoom, opacity slider, z-offset slider, unload button per loaded asset. | `ui.js` |
| Status Messages | Floating notifications (success/error/warning/loading) with auto-dismiss. | `core.js` |
| Mode Indicators | Overlay text for active modes: Drawing, Hide, Comment. | various |
| User Badge | Logged-in user email display with logout button in header. | `ui.js` |
| Empty States | Placeholder messages when no assets, comments, or hidden features exist. | `ui-helpers-modern.js` |

### Toolbar Sections

| # | Icon | Section | Content |
|---|---|---|---|
| 1 | 📦 | Assets | Ion asset selector, loaded asset cards |
| 2 | 🗺️ | Layer Manager | Basemap switcher, terrain picker, OSM/Google toggles |
| 3 | ☁️ | Point Cloud | EDL, point size, color mode, presets |
| 4 | 📏 | Measure & Clip | Measurement tools, clipping polygon/rectangle, controls |
| 5 | 💬 | Comments | Comment/area toggle, visibility, recent list |
| 6 | 👁️ | Visibility | Hide mode toggle, hidden elements list |
| 7 | 🏗️ | IFC Filter | Entity checkboxes with select all/none |
| 8 | 🏢 | Revit Filter | Category checkboxes with select all/none |
| 9 | ↔️ | Split View | Enable/disable, slider control |
| 10 | 📷 | Saved Views | View list with load/delete, keys 1–9 |
| 11 | ☀️ | Lighting | Dynamic lighting, time, IBL, SSAO controls |
| 12 | ⚙️ | Settings | Performance preset, camera home, globe fade, fullscreen |

---

## 16. Keyboard Shortcuts

| Key | Action | File |
|---|---|---|
| **M** | Toggle sidebar | `ui.js` |
| **H** | Toggle hide mode | `hideFeatures.js` |
| **Shift+H** | Show all hidden elements | `hideFeatures.js` |
| **C** | Toggle point comment mode | `comments.js` |
| **A** | Switch to area annotation mode | `comments.js` |
| **P** | Toggle polygon clipping mode | `clipping.js` |
| **R** | Toggle rectangle clipping mode | `clipping.js` |
| **ENTER** | Finish polygon/area annotation | `clipping.js`, `comments.js` |
| **ESC** | Cancel drawing/annotation/clipping | `clipping.js`, `comments.js` |
| **DELETE** | Remove last clipping polygon | `clipping.js` |
| **F** | Flip last polygon orientation | `clipping.js` |
| **V** | Toggle clipping visualization | `clipping.js` |
| **1–9** | Load saved view slot | `features.js` |
| **Shift+PageUp** | Raise all visible assets +1m | `ui-z-offset-extension.js` |
| **Shift+PageDown** | Lower all visible assets -1m | `ui-z-offset-extension.js` |

---

## 17. Localization

| Feature | Description | Files |
|---|---|---|
| German/English Category Mapping | Revit categories auto-translated: "Wände" → "Walls", "Türen" → "Doors", etc. (34+ mappings). | `core.js` |

---

## 18. Error Handling & Recovery

| Feature | Description | Files |
|---|---|---|
| Render Error Handler | Catches CesiumJS rendering crashes, logs details, attempts recovery. | `core.js` |
| Tileset Monitor | Background 2s polling for new tilesets to apply lighting and performance settings. | `lighting.js` |
| Graceful Fallbacks | OSM imagery fallback if Ion imagery fails. Try-catch around all Cesium operations. | `core.js` |

---

## Module Reference

| File | Purpose |
|---|---|
| `config.js` | Firebase credentials (gitignored) |
| `config.example.js` | Template for config.js |
| `auth.js` | Demo mode authentication, Ion token management, Firestore init |
| `auth-gate.js` | Optional email/password login overlay |
| `core.js` | Viewer initialization, asset loading, performance presets, Google/OSM, globe controls |
| `features.js` | IFC/Revit filtering, element selection, property display, saved views, silhouette |
| `hideFeatures.js` | Click-to-hide individual elements with undo |
| `comments.js` | Point and area annotations with Firestore CRUD |
| `measurement.js` | Distance, area, height, vertical distance, coordinate tools |
| `clipping.js` | Polygon and rectangle clipping masks |
| `pointcloud.js` | Point cloud detection, EDL, color modes, rendering presets |
| `z-offset.js` | Per-asset vertical offset system |
| `layerManager.js` | Basemap switching, terrain provider management |
| `lighting.js` | Dynamic shadows, atmosphere, time-based sun positioning |
| `ibl.js` | Image-based lighting via spherical harmonics and KTX2 cubemaps |
| `ui.js` | Main toolbar with 12 collapsible sections, event handlers, asset UI |
| `ui-helpers-modern.js` | List rendering helpers for comments, hidden features, assets, saved views |
| `ui-comments-extension.js` | Comments section UI controls |
| `ui-clipping-extension.js` | Clipping section UI controls |
| `ui-z-offset-extension.js` | Z-offset UI controls, global keyboard offset |
| `ui-lighting-standalone.js` | Lighting UI integration |
| `index.html` | Splash screen, comment dialog, script loading, Plausible analytics |

---

*Generated from codebase analysis — 2026-02-28*
