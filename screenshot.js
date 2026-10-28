/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
// ===============================
// SCREENSHOT — PNG of the 3D view with logo and data credits
// Button in the bottom toolbar (next to Transform) and F9 (as in geoBIM Desktop).
// The viewer is created with preserveDrawingBuffer (core.js), so after a
// render() the WebGL canvas can be copied like in bcf-export.js.
// Cesium's credits are HTML outside the canvas; the data licences (Google,
// Bing, splat datasets …) require them on screenshots too, so their text is
// drawn into the image (bottom left), the logo bottom right.
// ===============================

(function() {
  'use strict';

  var LOGO_URL = 'logo/logo_teal_transparent.png';
  var logo = null;          // HTMLImageElement once loaded, false if it failed

  function loadLogo() {
    if (logo !== null) return;
    var img = new Image();
    img.onload = function() { logo = img; };
    img.onerror = function() { logo = false; };
    img.src = LOGO_URL;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function fileName(d) {
    return 'geobim_' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      '_' + pad(d.getHours()) + '-' + pad(d.getMinutes()) + '.png';
  }

  // Plain text of a Cesium credit (HTML: text, link or logo image).
  function creditText(credit) {
    if (credit && credit.credit) credit = credit.credit;   // {credit, count} in frame lists
    if (!credit || !credit.html) return '';
    var div = document.createElement('div');
    div.innerHTML = credit.html;
    var text = (div.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) return text;
    var img = div.querySelector('img');
    if (!img) return '';
    var name = img.getAttribute('alt') || img.getAttribute('title') || '';
    if (name) return name;
    var src = (img.getAttribute('src') || '').toLowerCase();
    if (src.indexOf('google') >= 0) return 'Google';
    if (src.indexOf('bing') >= 0 || src.indexOf('microsoft') >= 0) return 'Microsoft Bing';
    if (src.indexOf('cesium') >= 0 || src.indexOf('data:image') === 0) return 'Cesium';
    return '';
  }

  // Credits of the frame just rendered: on-screen and "Data attribution" list.
  function collectCredits(viewer) {
    var cd = viewer.creditDisplay;
    var out = [];
    function add(t) { if (t && out.indexOf(t) < 0) out.push(t); }
    try {
      var frame = cd && cd._currentFrameCredits;
      if (frame) {
        add(creditText(cd._currentCesiumCredit));
        frame.screenCredits.values.forEach(function(c) { add(creditText(c)); });
        frame.lightboxCredits.values.forEach(function(c) { add(creditText(c)); });
      }
      // Static credits (splat dataset attribution, splat.js addStaticCredit)
      var stat = cd && cd._staticCredits;
      if (stat) (stat.values || stat).forEach(function(c) { add(creditText(c)); });
    } catch (e) { /* private Cesium API changed — fall back to the DOM */ }
    if (out.length <= 1 && cd && cd.container) {
      String(cd.container.innerText || '').split(/\n|•/).forEach(function(t) {
        t = t.trim();
        if (t && !/^data attribution$/i.test(t)) add(t);
      });
    }
    return out;
  }

  // Greedy word wrap of the credits into at most maxLines lines.
  function wrapCredits(ctx, parts, maxWidth, maxLines) {
    var words = ('© ' + parts.join(' · ')).split(' ');
    var lines = [];
    var line = '';
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = words[i];
        if (lines.length === maxLines) break;
      } else {
        line = test;
      }
    }
    if (lines.length < maxLines && line) lines.push(line);
    else if (lines.length === maxLines && i < words.length) lines[maxLines - 1] += ' …';
    return lines;
  }

  function compose(viewer) {
    var scene = viewer.scene;
    scene.render();
    var src = scene.canvas;
    var w = src.width;
    var h = src.height;
    var out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    var ctx = out.getContext('2d');
    ctx.drawImage(src, 0, 0, w, h);

    var unit = Math.min(w, h);
    var margin = Math.round(unit * 0.02);

    // Logo bottom right, about 18 % of the width (between 120 and 360 px).
    var logoW = 0;
    if (logo) {
      logoW = Math.round(Math.max(120, Math.min(360, w * 0.18)));
      var logoH = Math.round(logoW * logo.naturalHeight / logo.naturalWidth);
      ctx.drawImage(logo, w - margin - logoW, h - margin - logoH, logoW, logoH);
    }

    // Credits bottom left on a dark band, font relative to the image height.
    var credits = collectCredits(viewer);
    if (credits.length) {
      var size = Math.max(11, Math.round(h * 0.016));
      ctx.font = size + 'px "Inter", "Segoe UI", Arial, sans-serif';
      var maxWidth = Math.max(200, w - 3 * margin - logoW);
      var lines = wrapCredits(ctx, credits, maxWidth, 3);
      var lineH = Math.round(size * 1.35);
      var boxW = 0;
      lines.forEach(function(l) { boxW = Math.max(boxW, ctx.measureText(l).width); });
      var padX = Math.round(size * 0.6);
      var boxH = lines.length * lineH + padX;
      ctx.fillStyle = 'rgba(14, 17, 23, 0.55)';
      ctx.fillRect(margin, h - margin - boxH, boxW + 2 * padX, boxH);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.textBaseline = 'top';
      lines.forEach(function(l, i) {
        ctx.fillText(l, margin + padX, h - margin - boxH + padX / 2 + i * lineH);
      });
    }
    return out;
  }

  function download(canvas, name) {
    function save(href, revoke) {
      var a = document.createElement('a');
      a.href = href;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (revoke) setTimeout(function() { URL.revokeObjectURL(href); }, 1000);
    }
    if (canvas.toBlob) {
      canvas.toBlob(function(blob) {
        if (blob) save(URL.createObjectURL(blob), true);
        else save(canvas.toDataURL('image/png'), false);
      }, 'image/png');
    } else {
      save(canvas.toDataURL('image/png'), false);
    }
  }

  BimViewer.takeScreenshot = function() {
    var viewer = this.viewer;
    if (!viewer || !viewer.scene) return null;
    try {
      var name = fileName(new Date());
      download(compose(viewer), name);
      this.updateStatus('Screenshot saved: ' + name, 'success');
      if (typeof plausible !== 'undefined') plausible('Feature Used', { props: { feature: 'Screenshot' } });
      return name;
    } catch (e) {
      // SecurityError: a layer without CORS tainted the canvas.
      console.warn('Screenshot failed:', e);
      this.updateStatus('Screenshot failed: ' + (e && e.message ? e.message : e), 'error');
      return null;
    }
  };

  // Button before the separator in front of Help (the toolbar is built by ui.js).
  function addButton() {
    var bar = document.getElementById('bottomToolbar');
    var help = document.getElementById('bottomHelpBtn');
    if (!bar || !help) return false;
    if (document.getElementById('bottomScreenshotBtn')) return true;
    var btn = document.createElement('button');
    btn.className = 'bottom-toolbar-btn';
    btn.id = 'bottomScreenshotBtn';
    btn.title = 'Screenshot as PNG (F9)';
    btn.innerHTML = '<i data-lucide="camera"></i><span class="bottom-toolbar-label">Screenshot</span>';
    btn.addEventListener('click', function() {
      btn.blur();
      BimViewer.takeScreenshot();
    });
    var before = help.previousElementSibling && help.previousElementSibling.classList.contains('bottom-toolbar-sep')
      ? help.previousElementSibling : help;
    bar.insertBefore(btn, before);
    if (window.lucide) lucide.createIcons();
    return true;
  }

  function init() {
    loadLogo();
    var tries = 0;
    (function poll() {
      if (addButton() || ++tries > 120) return;
      setTimeout(poll, 500);
    })();
  }

  document.addEventListener('keydown', function(e) {
    if (e.key !== 'F9' || e.ctrlKey || e.altKey || e.metaKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' ||
              t.tagName === 'BUTTON' || t.isContentEditable)) return;
    e.preventDefault();
    BimViewer.takeScreenshot();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
