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

// ===============================
// ITWIN CALLBACK (itwin-callback.html)
// Bentley IMS returns here after sign-in: exchange the code via
// itwin-auth.js, then go back to the page the sign-in started from.
// Errors stay visible with a link back.
// ===============================
'use strict';

(function() {
  var message = document.getElementById('itwinCallbackMessage');
  var back = document.getElementById('itwinCallbackBack');

  window.GEOBIM_ITWIN_AUTH.handleCallback().then(function(returnTo) {
    message.textContent = 'Signed in — returning to geoBIM.app…';
    window.location.replace(returnTo);
  }).catch(function(err) {
    message.textContent = 'Bentley sign-in failed: ' + err.message;
    message.classList.add('is-error');
    back.hidden = false;
  });
})();
