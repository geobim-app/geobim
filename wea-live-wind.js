/**
 * geoBIM.app
 * © 2026 Christof Lorenz
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/*
 * WEA live wind — live wind and power output for a WEA turbine, as the
 * Desktop does it (GeoBIMLiveWeather / GeoBIMTurbineSubsystem / TurbinePanel).
 *
 * Wind: Deutscher Wetterdienst via Bright Sky, current_weather at the turbine,
 * every 15 minutes (2 minutes after a failure). The browser asks Bright Sky
 * directly (CORS *), like the Desktop does.
 *
 *   wind at hub   v10 · (hub height / 10 m)^shear
 *   rotor         0 below cut-in and above cut-out (storm stop), min..max rpm
 *                 from cut-in up to the rated wind speed
 *   power         rated · (v / v_rated)^3 · rho / 1.225, at most rated: the
 *                 Desktop's 1/2 rho A cp v^3 with cp set so rated power is
 *                 reached at the rated wind speed in standard air (an estimate,
 *                 not the manufacturer's power curve)
 *   air density   station temperature and sea-level pressure brought to the
 *                 hub (lapse rate, barometric formula)
 *   heading       the rotor turns into the wind at 2 deg/s (first data: at once)
 * Rotor speed and power follow with a time constant of 8 s, the energy adds
 * up while the scene is open.
 *
 * start(assetId, cfg) drives that WEA instance (BimWEA) and shows the "Wind
 * turbine" card; stop() ends it. wea-scene.js calls both for the demo scene.
 * cfg: cutIn, rated, cutOut (m/s), minRpm, maxRpm, ratedPower (kW), shear;
 * hub height and rotor diameter come from the WEA panel.
 */
window.BimWEALive = (function() {
  'use strict';

  var API = 'https://api.brightsky.dev/current_weather';
  var FETCH_S = 15 * 60;
  var RETRY_S = 2 * 60;
  var TICK_MS = 200;
  var RPM_TAU = 8;          // s
  var YAW_RATE = 2;         // deg/s
  var STATION_HEIGHT = 10;  // m, DWD wind measurement
  var R_AIR = 287.05, RHO_STD = 1.225, LAPSE = 0.0065, G = 9.80665;
  // The WEA model's hub points to heading + 90 deg (heading 0: east)
  var HUB_OFFSET = 90;
  var DEFAULTS = { cutIn: 3, rated: 11, cutOut: 25, minRpm: 4.5, maxRpm: 10, ratedPower: 7200, shear: 0.16 };
  var COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  var PHONE = window.matchMedia('(max-width: 720px)');

  var s = null;   // running state
  var card = null;

  // ------------------------------------------------------------------
  // Weather
  // ------------------------------------------------------------------

  function fetchWind() {
    var pos = s && turbine() && turbine().assetData.position;
    if (!pos) return;
    s.fetching = true;
    var run = s.run;
    var url = API + '?lat=' + pos.lat.toFixed(6) + '&lon=' + pos.lon.toFixed(6) + '&units=si';
    fetch(url)
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(json) {
        if (!s || s.run !== run) return;
        var w = json && json.weather;
        if (!w || typeof w.wind_speed_10 !== 'number') throw new Error('no wind in the answer');
        var src = json.sources && json.sources[0];
        var first = !s.weather;
        s.weather = {
          v10: w.wind_speed_10,
          dir: typeof w.wind_direction_10 === 'number' ? w.wind_direction_10 : (s.weather ? s.weather.dir : 180),
          gust: typeof w.wind_gust_speed_10 === 'number' ? w.wind_gust_speed_10 : -1,
          tempK: typeof w.temperature === 'number' ? w.temperature : 0,
          pressurePa: typeof w.pressure_msl === 'number' ? w.pressure_msl : 0,
          station: (src && src.station_name) || 'station',
          time: w.timestamp ? new Date(w.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
        };
        if (first) {
          // Start facing the wind and turning at speed instead of spinning up for minutes
          s.yaw = s.weather.dir;
          s.rpm = targetRpm();
          s.power = targetPower();
        }
        s.fetching = false;
        s.nextFetch = now() + FETCH_S;
        render();
      })
      .catch(function(err) {
        if (!s || s.run !== run) return;
        console.warn('WEA live wind: no data', err);
        s.fetching = false;
        s.failed = true;
        s.nextFetch = now() + RETRY_S;
        render();
      });
  }

  // ------------------------------------------------------------------
  // Turbine figures (Desktop GeoBIMTurbineSubsystem)
  // ------------------------------------------------------------------

  function now() { return performance.now() / 1000; }
  function turbine() { return s && window.BimWEA && BimWEA.instances[s.assetId]; }
  function hubHeight() { var t = turbine(); return (t && t.targetHubHeight) || 199; }
  function rotorDiameter() { var t = turbine(); return (t && t.targetRotorDiameter) || 172; }
  function shearFactor() { return Math.pow(hubHeight() / STATION_HEIGHT, s.cfg.shear); }
  function hubWind() { return s.weather ? Math.max(s.weather.v10, 0) * shearFactor() : 0; }

  function targetRpm() {
    var c = s.cfg, v = hubWind();
    if (v < c.cutIn || v > c.cutOut) return 0;
    var a = Math.min(Math.max((v - c.cutIn) / Math.max(c.rated - c.cutIn, 0.1), 0), 1);
    return c.minRpm + (c.maxRpm - c.minRpm) * a;
  }

  function airDensity() {
    var w = s.weather, t = turbine();
    if (!w || w.tempK <= 0 || w.pressurePa <= 0 || !t) return RHO_STD;
    // Ellipsoidal site height (about 50 m above sea level in Germany): < 1 % off
    var site = typeof t.terrainHeight === 'number' ? t.terrainHeight : 0;
    var hubAbs = site + hubHeight();
    var hubT = w.tempK - LAPSE * hubHeight();
    var meanT = hubT + LAPSE * hubAbs * 0.5;
    var hubP = w.pressurePa * Math.exp(-G * hubAbs / (R_AIR * meanT));
    return hubP / (R_AIR * hubT);
  }

  function targetPower() {
    var c = s.cfg, v = hubWind();
    if (v < c.cutIn || v > c.cutOut) return 0;
    return Math.min(c.ratedPower, c.ratedPower * Math.pow(v / c.rated, 3) * airDensity() / RHO_STD);
  }

  function stateText() {
    if (!s.weather) return s.fetching || !s.failed ? 'Waiting for live wind' : 'No live wind';
    var c = s.cfg, v = hubWind();
    if (v < c.cutIn) return 'Too little wind';
    if (v > c.cutOut) return 'Storm stop';
    if (v >= c.rated) return 'Rated power';
    return 'Running';
  }

  // ------------------------------------------------------------------
  // Loop: smooth, integrate, drive the WEA model
  // ------------------------------------------------------------------

  function tick() {
    if (!s) return;
    var t = turbine();
    if (!t) { stop(); return; }
    var tNow = now();
    var dtReal = Math.min(Math.max(tNow - s.last, 0), FETCH_S);
    var dt = Math.min(dtReal, 1);
    s.last = tNow;
    if (!s.fetching && tNow >= s.nextFetch) fetchWind();
    if (s.weather) {
      var k = 1 - Math.exp(-dt / RPM_TAU);
      s.rpm += (targetRpm() - s.rpm) * k;
      s.power += (targetPower() - s.power) * k;
      s.energy += s.power * dtReal / 3600;
      var err = ((s.weather.dir - s.yaw + 540) % 360) - 180;
      s.yaw = (s.yaw + Math.max(-YAW_RATE * dt, Math.min(YAW_RATE * dt, err)) + 360) % 360;
      apply(t);
    }
    if (tNow - s.lastRender > 0.5) render();
  }

  function apply(t) {
    var id = s.assetId;
    if (Math.abs(s.rpm - s.appliedRpm) > 0.02) {
      BimWEA.setAnimSpeed(id, Math.round(s.rpm * 100) / 100);
      s.appliedRpm = s.rpm;
    }
    var heading = (s.yaw - HUB_OFFSET + 360) % 360;
    if (Math.abs(heading - (t.assetData.heading || 0)) > 0.05) {
      BimWEA.setPosition(id, 'heading', heading.toFixed(2));
      var input = document.querySelector('#wea_card_' + id + ' input[onchange*="\'heading\'"]');
      if (input && document.activeElement !== input) input.value = Math.round(heading);
    }
  }

  // ------------------------------------------------------------------
  // Card (Desktop "Wind turbine" panel)
  // ------------------------------------------------------------------

  function grouped(x) {
    return String(Math.round(Math.max(x, 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  function compass(deg) {
    return COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function buildCard() {
    card = el('section', 'wea-live');
    card.id = 'weaLivePanel';
    card.setAttribute('aria-label', 'Wind turbine, live');

    var head = el('div', 'wea-live-head');
    var icon = el('i');
    icon.setAttribute('data-lucide', 'wind');
    var title = el('span', 'wea-live-title', 'Wind turbine');
    var state = el('span', 'wea-live-state');
    state.setAttribute('aria-live', 'polite');
    var mini = el('span', 'wea-live-mini');
    var toggle = el('button', 'wea-live-collapse');
    toggle.type = 'button';
    toggle.innerHTML = '<i data-lucide="chevron-down"></i>';
    toggle.addEventListener('click', function() { setCollapsed(!card.classList.contains('collapsed')); });
    head.append(icon, title, state, mini, toggle);

    var body = el('div', 'wea-live-body');
    var power = el('div', 'wea-live-power');
    power.append(el('span', 'wea-live-kw', '-'), el('span', 'wea-live-unit', 'kW'));
    var bar = el('div', 'wea-live-bar');
    bar.appendChild(el('span'));
    var rows = el('dl', 'wea-live-rows');
    [['wind', 'Wind at hub'], ['gust', 'Gusts at hub'], ['rotor', 'Rotor'], ['energy', 'Energy (session)'], ['rho', 'Air density']].forEach(function(r) {
      var row = el('div', 'wea-live-row');
      var dd = el('dd', '', '-');
      dd.setAttribute('data-k', r[0]);
      row.append(el('dt', '', r[1]), dd);
      rows.appendChild(row);
    });
    var source = el('p', 'wea-live-source');
    body.append(power, bar, rows, source);

    card.append(head, body);
    document.body.appendChild(card);
    if (typeof BimViewer.makeFloatingPanelDraggable === 'function') BimViewer.makeFloatingPanelDraggable(card, head);
    if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide', node: card });
    setCollapsed(PHONE.matches);
  }

  function setCollapsed(on) {
    if (!card) return;
    card.classList.toggle('collapsed', on);
    var btn = card.querySelector('.wea-live-collapse');
    btn.setAttribute('aria-expanded', on ? 'false' : 'true');
    btn.setAttribute('aria-label', on ? 'Show details' : 'Hide details');
    btn.title = on ? 'Show details' : 'Hide details';
  }

  function set(key, text) {
    var dd = card.querySelector('[data-k="' + key + '"]');
    if (dd) dd.textContent = text;
  }

  function render() {
    if (!s || !card) return;
    s.lastRender = now();
    var c = s.cfg, ready = !!s.weather;
    var state = stateText();
    var stateEl = card.querySelector('.wea-live-state');
    stateEl.textContent = state;
    stateEl.classList.toggle('producing', ready && s.power > 1);
    stateEl.classList.toggle('storm', state === 'Storm stop');
    var share = ready && c.ratedPower > 0 ? Math.min(Math.max(s.power / c.ratedPower, 0), 1) : 0;
    card.querySelector('.wea-live-kw').textContent = ready ? grouped(s.power) : '-';
    card.querySelector('.wea-live-unit').textContent = 'kW · ' + Math.round(share * 100) + ' % of ' + grouped(c.ratedPower) + ' kW';
    card.querySelector('.wea-live-bar').style.setProperty('--share', share.toFixed(4));
    card.querySelector('.wea-live-mini').textContent = ready ? grouped(s.power) + ' kW' : '';
    if (ready) {
      var f = shearFactor(), w = s.weather;
      set('wind', hubWind().toFixed(1) + ' m/s ' + compass(w.dir) + ' (' + Math.round(w.dir) + '°)');
      set('gust', w.gust >= 0 ? (w.gust * f).toFixed(1) + ' m/s' : '-');
      set('rotor', s.rpm.toFixed(1) + ' rpm · tip ' + Math.round(s.rpm * Math.PI / 30 * rotorDiameter() / 2) + ' m/s');
      set('energy', s.energy.toFixed(1) + ' kWh');
      set('rho', airDensity().toFixed(3) + ' kg/m³');
    }
    card.querySelector('.wea-live-source').textContent = ready
      ? 'DWD ' + s.weather.station + ', ' + s.weather.time + ' · power estimated from wind'
      : 'Wind: Deutscher Wetterdienst via Bright Sky';
  }

  // ------------------------------------------------------------------
  // Start / stop
  // ------------------------------------------------------------------

  function start(assetId, cfg) {
    stop();
    if (!window.BimWEA || !BimWEA.instances[assetId]) return false;
    s = {
      run: Date.now(),
      assetId: assetId,
      cfg: Object.assign({}, DEFAULTS, cfg || {}),
      weather: null,
      fetching: false,
      failed: false,
      nextFetch: 0,
      rpm: 0,
      appliedRpm: -1,
      power: 0,
      energy: 0,
      yaw: 180,
      last: now(),
      lastRender: 0,
      timer: null
    };
    buildCard();
    render();
    s.timer = setInterval(tick, TICK_MS);
    tick();
    return true;
  }

  function stop() {
    if (s) clearInterval(s.timer);
    s = null;
    if (card) card.remove();
    card = null;
  }

  return {
    start: start,
    stop: stop,
    isActive: function() { return !!s; },
    info: function() {
      if (!s) return null;
      return { state: stateText(), hubWind: s.weather ? hubWind() : null, rpm: s.rpm, powerKW: s.power, energyKWh: s.energy, yaw: s.yaw, weather: s.weather };
    }
  };
})();
