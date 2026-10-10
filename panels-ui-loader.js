/**
 * geobim.app — Panel UI switch
 *
 * Decides between the classic sidebar UI (default) and the parallel panel UI
 * (icon rail + floating panels, panels-ui.js / panels-ui.css). Classic loads
 * nothing extra; only this small loader is always present.
 *
 * Order of precedence:
 *   1. ?ui=panels | ?ui=classic   (remembered in localStorage for this browser)
 *   2. remembered choice
 *   3. default by host: beta.geobim.app → panels, everything else → classic
 * Demo modes with their own trimmed UI (WEA, Bridge Inspector, StageTwin)
 * always stay classic for now.
 *
 * Loaded in <head> after all stylesheets so panels-ui.css wins the cascade
 * and html.ui-panels is set before first paint.
 */
(function() {
  'use strict';

  var VERSION = '0.5.0'; // cache-bust for panels-ui.js / panels-ui.css
  var STORAGE_KEY = 'geobim_ui';
  var BETA_HOSTS = ['beta.geobim.app'];
  var CLASSIC_ONLY_MODES = { wea: '/wea-shadow', bridge: '/bridge-inspector', stagetwin: '/stage-twin' };

  function store(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (_) {}
  }

  function recall(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function isClassicOnlyMode(params) {
    var path = window.location.pathname.replace(/\/+$/, '');
    var mode = params.get('mode');
    return Object.keys(CLASSIC_ONLY_MODES).some(function(m) {
      return mode === m || path === CLASSIC_ONLY_MODES[m];
    });
  }

  function chooseUI() {
    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get('ui');
    if (fromUrl === 'panels' || fromUrl === 'classic') store(STORAGE_KEY, fromUrl);
    if (isClassicOnlyMode(params)) return 'classic';
    if (fromUrl === 'panels' || fromUrl === 'classic') return fromUrl;
    var remembered = recall(STORAGE_KEY);
    if (remembered === 'panels' || remembered === 'classic') return remembered;
    return BETA_HOSTS.indexOf(window.location.hostname) !== -1 ? 'panels' : 'classic';
  }

  function addStylesheet(href) {
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = href + '?v=' + VERSION;
    document.head.appendChild(css);
  }

  // Beta only: a small "New interface" button in the classic view, so testers
  // get back to the panels without typing ?ui=panels
  function addSwitchBack() {
    addStylesheet('panels-ui-switch.css');
    function add() {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'panelsSwitchBtn';
      btn.className = 'panels-switch-btn';
      btn.title = 'Switch to the new panel interface (beta)';
      btn.innerHTML = '<i data-lucide="panels-top-left"></i><span>New interface</span>';
      btn.addEventListener('click', function() {
        var url = new URL(window.location.href);
        url.searchParams.set('ui', 'panels');
        window.location.href = url.toString();
      });
      document.body.appendChild(btn);
      if (window.lucide) lucide.createIcons();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add);
    else add();
  }

  var ui = chooseUI();
  window.GEOBIM_UI = ui;
  console.log('UI layout: ' + ui);
  if (ui !== 'panels') {
    var isBeta = BETA_HOSTS.indexOf(window.location.hostname) !== -1;
    if (isBeta && !isClassicOnlyMode(new URLSearchParams(window.location.search))) addSwitchBack();
    return;
  }

  document.documentElement.classList.add('ui-panels');
  addStylesheet('panels-ui.css');

  // Dynamic scripts run async; panels-ui.js waits for the classic UI itself.
  var js = document.createElement('script');
  js.src = 'panels-ui.js?v=' + VERSION;
  document.head.appendChild(js);
})();
