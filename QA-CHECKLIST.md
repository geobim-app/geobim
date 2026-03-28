# geobim.app — QA Checklist

Run `bash qa-check.sh` for automated checks, then complete this manual checklist.

## Pre-Release Checks

### 1. Core Viewer
- [ ] App loads without JS errors in console
- [ ] 3D globe renders with terrain
- [ ] Left-click + drag rotates view
- [ ] Scroll zooms in/out
- [ ] Middle-click pans

### 2. Assets
- [ ] Ion asset selector shows available assets
- [ ] Loading an asset shows it in viewer
- [ ] Asset opacity slider works
- [ ] Zoom-to-asset button works
- [ ] Unload asset removes it from viewer
- [ ] Floating assets panel opens/closes

### 3. Sidebar Sections
- [ ] All sections expand/collapse on click
- [ ] Section toggle arrows update (▶/▼)
- [ ] Lucide SVG icons render for all sections (no broken images)
- [ ] Only "Assets" expanded by default
- [ ] Sidebar collapses/expands with M key or toggle button
- [ ] Scrolling works when many sections open

### 4. Bottom Toolbar
- [ ] All 5 buttons visible (Measure, Visibility, Lighting, Walk, Help)
- [ ] Clicking section button opens corresponding sidebar section
- [ ] Active state (teal highlight) toggles correctly
- [ ] Walk button activates/deactivates first-person mode
- [ ] Walk button state independent from section buttons
- [ ] Bottom toolbar doesn't overlap floating panels

### 5. Measurement
- [ ] Distance measurement: click two points → shows distance
- [ ] Area measurement: click polygon → shows area
- [ ] Height measurement works
- [ ] Crosshair cursor appears when measuring
- [ ] ESC cancels measurement
- [ ] Cursor returns to default after cancel/complete

### 6. Clipping
- [ ] P key starts polygon draw mode
- [ ] R key starts rectangle draw mode
- [ ] Cell cursor appears when clipping
- [ ] Enter finishes polygon
- [ ] ESC cancels drawing
- [ ] Delete removes last polygon
- [ ] V key toggles visualization (only when NOT in walk mode)

### 7. Comments / Annotations
- [ ] Comment dialog opens on right-click on model
- [ ] All form fields work (title, text, category, priority)
- [ ] Inspection checkbox toggles inspection fields
- [ ] Save creates comment with pin on model
- [ ] Cancel closes dialog without saving
- [ ] Copy cursor appears in comment mode
- [ ] Comment list panel shows comments
- [ ] BCF export button works

### 8. IFC/Revit Filter
- [ ] IFC filter checkboxes show/hide element types
- [ ] "Select All" / "Deselect All" work
- [ ] Revit filter works separately from IFC

### 9. Property Panel (InfoBox)
- [ ] Click element → InfoBox panel appears
- [ ] Properties grouped by category with collapse
- [ ] Search field filters properties by name/value
- [ ] Copy button (⧉) appears on hover
- [ ] Copy works for values with special characters
- [ ] Close button works
- [ ] Panel slides in from right (transition)

### 10. Visibility / Hide
- [ ] H key toggles hide mode
- [ ] Pointer cursor appears in hide mode
- [ ] Click element → element hidden
- [ ] Shift+H shows all hidden elements
- [ ] Hidden elements list updates

### 11. Lighting
- [ ] Time-of-day presets work (dawn → midnight)
- [ ] Enable/disable shadows works
- [ ] Shadow intensity slider works

### 12. Walk Mode (First Person)
- [ ] G key activates first-person mode
- [ ] WASD movement at inspection speed
- [ ] Mouse look with pointer lock
- [ ] Shift = sprint
- [ ] Q/E = up/down
- [ ] Wall collision blocks movement
- [ ] Terrain clamping keeps player on ground
- [ ] ESC exits first-person mode
- [ ] Settings panel opens (via sidebar)
- [ ] Xbox controller: left stick moves, right stick looks
- [ ] Xbox controller: right stick L/R not inverted

### 13. Walk Mode (Third Person)
- [ ] V key switches to third-person
- [ ] Cesium_Man character visible with texture
- [ ] Character faces movement direction
- [ ] Character walks when moving (animation)
- [ ] Character stops animation when still
- [ ] Right stick orbits camera around character
- [ ] Scroll zooms camera distance
- [ ] T key sets Player Start
- [ ] Player Start marker visible
- [ ] Character spawns at Player Start on next activation
- [ ] V key switches back to first-person
- [ ] Camera returns to character position on switch

### 14. Onboarding Tour
- [ ] Tour starts on first visit (clear with `BimTour.reset()`)
- [ ] Spotlight highlights correct elements
- [ ] Next/Back/Skip buttons work
- [ ] Progress dots update
- [ ] ESC skips tour
- [ ] Tour doesn't restart on next visit
- [ ] "Take a guided tour" button in About dialog works

### 15. Keyboard Shortcuts (No Conflicts)
- [ ] G in first-person doesn't trigger other handlers
- [ ] V in walk mode doesn't toggle clipping visualization
- [ ] W in walk mode doesn't open WEA panel
- [ ] A in walk mode doesn't activate area annotation
- [ ] ESC exits only the active mode (not multiple)
- [ ] Keys don't fire when typing in input/textarea/button

### 16. Mobile / Responsive (< 768px)
- [ ] Sidebar goes full width
- [ ] Bottom toolbar labels hidden, icons only
- [ ] Touch targets ≥ 44px
- [ ] Floating panels above bottom toolbar
- [ ] InfoBox goes full width

### 17. Empty States
- [ ] Assets panel: icon + "Select an asset from the sidebar"
- [ ] Comments: icon + "Right-click on the model"
- [ ] Hidden elements: icon + "Press H and click elements"
- [ ] Saved views: icon + "Press 1-9 to save"
- [ ] Comments loading: skeleton shimmer animation

### 18. Visual Consistency
- [ ] All accent colors are #2ECFB0 (no #6EECD8)
- [ ] Panels have visible glassmorphism (scene shows through)
- [ ] Lucide icons are teal, 18px, consistent stroke width
- [ ] Focus rings visible on Tab navigation
