# Changelog

All notable changes to geobim.app will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
