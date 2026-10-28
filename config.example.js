/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
const GEOBIM_CONFIG = {
  cesiumIon: {
    // One Ion OAuth app per domain (each app allows a single redirect URI),
    // e.g. a separate app with redirect http://localhost:8000/ for local development
    clientId: window.location.hostname === 'localhost' ? 'your-localhost-oauth-client-id'
      : 'your-oauth-client-id'
  },
  firebase: {
    apiKey: "your-firebase-api-key",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project-id",
    storageBucket: "your-project.firebasestorage.app",
    messagingSenderId: "your-messaging-sender-id",
    appId: "your-app-id"
  },
  // Optional (arcgis.js): ArcGIS Location Platform API key, sent as token to
  // Esri services; the public services used without it work too
  arcgis: {
    apiKey: ''
  }
};
