# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-03-01

### Added

#### Authentication & Configuration
- Demo mode with auto-applied Cesium Ion token and anonymous Firestore access
- Optional email/password login via Firebase auth gate overlay
- External configuration file (`config.js` / `config.example.js`) for Firebase credentials
- Branded splash screen with "Enter Demo" button
- Plausible analytics integration (privacy-friendly, no cookies)

#### Asset & Model Management
- Load 3D Tiles from Cesium Ion via REST API with curated asset whitelist
- Bentley iTwin iModel integration via share keys and iModel IDs
- Per-asset visibility toggle, opacity control, and unloading
- Fly-to-asset camera navigation

#### Layer & Terrain Management
- Basemap switcher with 6 options (Bing Aerial, Bing Roads, OSM, Google Contour, Google Satellite w/ Labels, None)
- Terrain provider switching (Cesium World Terrain, World Bathymetry, custom Ion assets)
- OSM Buildings toggle with auto-disable when Google 3D Tiles active
- Google Photorealistic 3D Tiles with 3 quality presets (Performance, Balanced, Quality)
- Globe transparency and distance-based fade controls
- Underground navigation mode

#### IFC & Revit Filtering
- IFC entity filter for 31 entity classes with color-coded visualization and OR-logic conditions
- Auto-detection of IFC property names from tile content with caching
- Revit category filter for 34+ categories with English/German name mapping
- Bulk select/deselect all entities or categories
- Manual IFC property name override per asset

#### Feature Selection & Properties
- Click-to-select 3D elements with lime green highlight
- Property display popup grouped by Identification, Geometry, Material, Building Physics, Manufacturer, OSM
- Silhouette post-processing outline with 6 color options and adjustable strength
- Click-to-hide mode for individual elements with undo and show-all

#### Measurements
- Distance measurement (total, horizontal, vertical) with glow line visualization
- Area measurement with polygon fill and perimeter display
- Height-over-terrain measurement with WGS84 and terrain elevation
- Vertical distance measurement between two points
- Coordinate picking with lat/lon display and copy-to-clipboard

#### Clipping & Section Planes
- Polygon clipping via right-click drawing with numbered markers and dashed lines
- Rectangle clipping via 3-point input with live preview
- Inverse clipping mode (flip inside/outside)
- Terrain clipping toggle (Buildings Only vs. Buildings + Terrain)
- Clipping visualization toggle (show/hide polygon fill)
- Polygon management (remove last, remove by ID, clear all, flip orientation)

#### Annotations & Comments
- Point comments via right-click with title, text, category, and priority
- Area annotations via polygon drawing with fill, outline, center label, and area calculation
- 6 comment categories (General, Architecture, Structure, MEP, Issue, Question)
- 3 priority levels (Low, Normal, High) with color-coded markers
- Firestore persistence with CRUD operations and real-time sync across users
- Comment fly-to, edit, delete (individual and bulk), and visibility toggle
- Auto-positioned comment dialog modal

#### Z-Offset (Vertical Positioning)
- Per-asset vertical offset slider (-70m to +70m) relative to original position
- Global Z-offset via Shift+PageUp/Down (1m increments for all visible assets)

#### Saved Views
- Save camera position, orientation, Google Tiles state, and clipping state
- Load saved views with automatic scene state restoration (keys 1–9 for quick load)
- Delete saved views by slot number
- View list UI with slot number, capture time, and altitude

#### Split-Screen View
- Left/right viewport split for before/after comparison
- Automatic left copy of Google 3D Tiles for side-by-side viewing
- Draggable slider to adjust split position

#### Lighting & Rendering
- Dynamic sun-based lighting with globe lighting, atmosphere, and time-of-day control
- 8 time presets (Dawn, Morning, Noon, Afternoon, Sunset, Dusk, Night, Midnight)
- Time animation with adjustable speed multiplier
- Shadow system with soft shadows, normal offset, configurable max distance (150m–500m) and bias per preset
- Adjustable shadow darkness and sun intensity (prevents overexposure on white BIM surfaces)
- Image-Based Lighting in dynamic mode (environmentMapManager + spherical harmonics) and static mode (Kiara 6 Afternoon KTX2 cubemap)
- Independent IBL diffuse and specular sliders
- Screen-space ambient occlusion (SSAO) optimized for BIM geometry
- PBR Neutral tone mapping
- FXAA and MSAA anti-aliasing options
- HDR rendering toggle

#### Point Cloud Support
- Auto-detection of point cloud tilesets by tile URI, Ion metadata, or IFC property absence
- Eye Dome Lighting (EDL) with adjustable strength and radius
- 4 color modes (RGB, Height gradient, Intensity, ASPRS Classification)
- Point size, distance attenuation, geometric error scale, and back-face culling controls
- 3 rendering presets (Quality, Performance, Detailed)

#### Performance Management
- 4 performance presets (Performance, Balanced, Quality, Ultra) controlling SSAO, shadows, LOD, memory, and anti-aliasing
- Tileset-level settings applied per primitive (screenSpaceError, cacheSize, skipLevelOfDetail, preloading)
- Google 3D Tiles protection (skipLevelOfDetail forced false to prevent black crack artifacts)
- Automatic performance preset application to newly loaded tilesets

#### User Interface
- Collapsible sidebar with 12 sections (Assets, Layer Manager, Point Cloud, Measure & Clip, Comments, Visibility, IFC Filter, Revit Filter, Split View, Saved Views, Lighting, Settings)
- Per-asset control cards with visibility, zoom, opacity slider, z-offset slider, and unload button
- Floating status notifications with auto-dismiss
- Mode indicator overlays for Drawing, Hide, and Comment modes
- User badge with email display and logout button

#### Keyboard Shortcuts
- M (toggle sidebar), H (hide mode), Shift+H (show all hidden)
- C (point comment), A (area annotation)
- P (polygon clipping), R (rectangle clipping), ENTER (finish), ESC (cancel), DELETE (remove last polygon)
- F (flip polygon orientation), V (toggle clipping visualization)
- 1–9 (load saved views)
- Shift+PageUp/Down (global Z-offset)

#### Localization
- German/English Revit category auto-translation (34+ mappings)

#### Error Handling
- CesiumJS render error handler with logging and recovery
- Background tileset monitor for applying lighting and performance settings to new primitives
- Graceful fallback to OSM imagery when Ion imagery fails
