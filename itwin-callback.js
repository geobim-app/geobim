/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
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
