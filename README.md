# geoBIM.app

**BIM x GIS = Geospatial Intelligence**

[Live Demo](https://geobim.app)

![License: BSL 1.1](https://img.shields.io/badge/License-BSL_1.1-blue.svg)
![CesiumJS 1.139.1](https://img.shields.io/badge/CesiumJS-1.139.1-teal.svg)

---

## What is geoBIM.app?

geoBIM.app is a web-native application for streaming massive 3D BIM and geospatial data directly in the browser, powered by CesiumJS and OGC 3D Tiles. It places your BIM models in their real geographic context — embedded in terrain, imagery, and existing urban structures rather than viewed in isolation.

geoBIM.app streams all formats supported by CesiumJS. IFC and Revit files can be converted to 3D Tiles via the Cesium Ion design tiler. It targets architects, engineers, contractors, authorities, operators, and project managers — all stakeholders involved in the lifecycle of a built asset.

---

## Features

- **Asset Management** — Load and manage 3D Tiles from Cesium Ion and Bentley iTwin
- **Layer Management** — Switch basemaps, terrain providers, Google 3D Tiles, OSM Buildings
- **IFC & Revit Filtering** — Show/hide by entity class or category with color-coded visualization
- **Measurements** — Distance, area, height, vertical distance, and coordinate tools with Firestore persistence
- **Clipping** — Polygon, rectangle, and per-asset axis-aligned section planes
- **Construction Sequencing** — 4D BIM stage animation via IFC properties
- **Annotations** — Point and area comments with Firestore persistence
- **SensorThings API** — Live bridge monitoring via FROST-Server with MQTT, sparkline charts, and damage event detection
- **IoT Live Module** — Real-time water level monitoring via Pegelonline with threshold alerts
- **Geoid Module** — EGM96 undulation lookup for orthometric height display in coordinate picker
- **NRW LoD2 Buildings** — Open Data 3D building models (Geobasis NRW) as toggleable layer
- **Lighting** — Dynamic sun/shadows, IBL (spherical harmonics), SSAO, time-of-day control
- **Point Clouds** — Eye Dome Lighting, color modes (RGB, height, classification), rendering presets
- **Saved Views** — Capture and restore camera positions with scene state
- **Split-Screen** — Side-by-side comparison mode
- **Z-Offset** — Vertical repositioning of assets (-70m to +70m)
- **Performance Presets** — 4 levels from Performance to Ultra with tileset-level tuning

For a complete feature reference see [FEATURES.md](FEATURES.md).

---

## Prerequisites

A **Cesium Ion** account is required. The [Community plan](https://cesium.com/platform/cesium-ion/pricing/) (free) includes:

- 5 GB asset storage
- 15 GB streaming per month
- 1,000 Google Photorealistic 3D Tiles sessions per month

The free plan covers personal projects and exploratory commercial evaluation. A paid plan is required if your organization exceeds $50K annual revenue or raised funds, works on government projects, or exceeds usage limits. See [Cesium Ion Pricing](https://cesium.com/platform/cesium-ion/pricing/) for details.

---

## Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/geobim-app/geobim.git
   cd geobim
   ```

2. Create your configuration file:
   ```bash
   cp config.example.js config.js
   ```
   Edit `config.js` and fill in your Firebase credentials. The Cesium Ion token is entered at runtime in the app.

3. Serve locally:
   ```bash
   npx serve .
   ```
   Or open `index.html` directly in a browser.

---

## Architecture

### Technology Stack

| Layer | Technology |
|---|---|
| 3D Rendering | CesiumJS 1.139.1 |
| Code Style | Vanilla JavaScript, IIFE modules |
| BIM Conversion | Cesium Ion (IFC / Revit → 3D Tiles) |
| Backend / Auth | Firebase (Firestore, Email/Password Auth) |
| Hosting | Static (no build step) |

### Modules

| Module | Description |
|---|---|
| `core.js` | Viewer initialization, asset loading, performance presets, Google/OSM, globe controls |
| `features.js` | IFC/Revit filtering, element selection, property display, saved views |
| `hideFeatures.js` | Click-to-hide individual BIM elements |
| `comments.js` | Point and area annotations with Firestore persistence |
| `measurement.js` | Distance, area, height, vertical distance, coordinate tools |
| `clipping.js` | Polygon and rectangle clipping masks |
| `pointcloud.js` | Point cloud detection, Eye Dome Lighting, color modes |
| `z-offset.js` | Per-asset vertical offset system |
| `layerManager.js` | Basemap switching and terrain provider management |
| `lighting.js` | Dynamic sun/shadows, atmosphere, time-based positioning |
| `ibl.js` | Image-based lighting via spherical harmonics and KTX2 cubemaps |
| `ui.js` | Collapsible sidebar toolbar with 12 sections |
| `ui-helpers-modern.js` | List rendering helpers for UI components |
| `measurement-store.js` | Measurement persistence in Firestore |
| `clipping-planes.js` | Per-asset axis-aligned clipping planes (X/Y/Z) |
| `sequencing.js` | Construction sequencing (4D BIM) — stage animation |
| `sensorthings.js` | OGC SensorThings API module — live bridge monitoring with MQTT and damage detection |
| `iot.js` | Pegelonline IoT live module — water level and temperature markers |
| `geoid.js` | EGM96 geoid undulation lookup for coordinate picker |
| `auth.js` | Demo mode authentication and Ion token management |
| `config.js` | Firebase credentials (gitignored) |

---

## Data Sources & References

The bridge monitoring module (`sensorthings.js`) simulates a structural health monitoring (SHM) scenario based on real sensor typologies used in civil engineering practice.

### Sensor Types

| Sensor | Observed Property | Threshold |
|---|---|---|
| Accelerometer (MEMS) | Vertical Acceleration (g) | \|a\| > 0.08 g |
| Inclinometer (biaxial) | Inclination Angle (deg) | \|angle\| > 0.25 deg |
| Thermocouple (Type K) | Temperature (°C) | — |
| Strain Gauge (foil) | Strain (microstrain) | < -65 µε |

### OGC SensorThings API

Live sensor data is served via [FROST-Server](https://github.com/FraunhoferIOSB/FROST-Server) (Fraunhofer IOSB), an open-source implementation of the [OGC SensorThings API Part 1: Sensing (v1.1)](https://docs.ogc.org/is/18-088/18-088.html). Data is consumed via REST and MQTT over WebSocket.

### Academic Reference

The SHM scenario draws on sensor configurations described in:

> Retze, U. *Beispielhafte Untersuchung zum Einsatz von Monitoringmethoden an einer Brücke.* Dissertation, Universität der Bundeswehr München, Institut für Konstruktiven Ingenieurbau. [athene-forschung](https://athene-forschung.unibw.de/doc/85913/85913.pdf)

### 3D Model

The bridge Reality Mesh was generated from UAV photogrammetry by the Geomatics Research Group at KU Leuven:

- Sketchfab model: [skfb.ly/oVzUQ](https://skfb.ly/oVzUQ)
- Project: [UAS-Assisted Bridge Inspections](https://iiw.kuleuven.be/onderzoek/geomatics/uas-assisted-bridge-inspections)

### INSPIRE & API4INSPIRE

The SensorThings API is one of the download services recommended by the [INSPIRE Maintenance and Implementation Group](https://inspire.ec.europa.eu/) for environmental monitoring data (INSPIRE theme EF — Environmental Monitoring Facilities). The [API4INSPIRE](https://datacoveeu.github.io/API4INSPIRE/) project provides guidance on deploying STA as an INSPIRE-compliant download service.

---

## License

Licensed under the [Business Source License 1.1](LICENSE). Non-commercial use, research, and education permitted. Commercial use requires written permission — [info@geobim.app](mailto:info@geobim.app). Converts to MIT on 2030-03-01.

---

## Consulting

geoBIM.app is developed and maintained by [Christof Lorenz](https://www.linkedin.com/in/christoflorenz).

For T&M consulting on geospatial BIM integration, digital twins, or CesiumJS-based applications, reach out via [geobim.app](https://geobim.app), LinkedIn, or email at info@geobim.app.
