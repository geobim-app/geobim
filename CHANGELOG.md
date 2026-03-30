# Changelog

All notable changes to geobim.app will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

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
