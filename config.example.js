/**
 * geoBIM.app
 * © 2026 Christof Lorenz. All rights reserved.
 *
 * Licensed under the Business Source License 1.1 (BSL 1.1)
 * Non-commercial use, evaluation, research, and education permitted.
 * Commercial use requires written permission.
 * Contact: info@geobim.app
 *
 * Change Date: 2030-03-01 — converts to MIT License
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
  }
};
