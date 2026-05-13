/**
 * geoBIM.app — Inspection Report Generator
 *
 * Copyright (c) 2026 geobim.app
 * Licensed under the Business Source License 1.1 (BSL 1.1)
 * Change Date: 2030-03-01 | Change License: MIT
 */
'use strict';

window.GEOBIM_INSPECTION_REPORT = (function () {

  var CONDITION_LABELS = { 1: 'Good', 2: 'Fair', 3: 'Poor', 4: 'Critical' };
  var CONDITION_COLORS = { 1: '#2ECFB0', 2: '#FBBF24', 3: '#f87171', 4: '#f87171' };
  var CONDITION_BG    = { 1: '#ecfdf5', 2: '#fffbeb', 3: '#fef2f2', 4: '#fef2f2' };

  function componentLabel(v) {
    var map = {
      deck: 'Deck', girder: 'Girder / Beam', arch: 'Arch / Truss',
      parapet: 'Parapet / Railing', abutment: 'Abutment', pier: 'Pier / Column',
      foundation: 'Foundation', bearings: 'Bearings', joints: 'Expansion Joints',
      drainage: 'Drainage', slope_protection: 'Slope Protection'
    };
    return map[v] || v;
  }

  function damageLabel(v) {
    var map = {
      crack: 'Crack', spalling: 'Spalling', delamination: 'Delamination',
      honeycombing: 'Honeycombing', exposed_rebar: 'Exposed Rebar',
      corrosion: 'Corrosion', rust_staining: 'Rust Staining',
      moisture: 'Moisture / Leakage', settlement: 'Settlement / Deformation',
      joint_failure: 'Joint Failure', surface_wear: 'Surface Wear',
      impact_damage: 'Impact Damage', vegetation: 'Vegetation / Fouling', other: 'Other'
    };
    return map[v] || v;
  }

  function formatDate(iso) {
    try { return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); }
    catch (e) { return iso || '—'; }
  }

  function buildHTML(assetName, findings) {
    var now = formatDate(new Date().toISOString());
    var total = findings.length;
    var sumRating = findings.reduce(function (s, f) { return s + (f.conditionRating || 1); }, 0);
    var avgRating = total ? (sumRating / total).toFixed(1) : '—';
    var critCount = findings.filter(function (f) { return (f.conditionRating || 1) >= 3; }).length;
    var avgColor = parseFloat(avgRating) >= 3 ? '#ef4444' : parseFloat(avgRating) >= 2 ? '#f59e0b' : '#2ECFB0';

    var componentMap = {};
    findings.forEach(function (f) {
      var c = f.component || 'unknown';
      if (!componentMap[c]) componentMap[c] = { count: 0, sum: 0 };
      componentMap[c].count++;
      componentMap[c].sum += (f.conditionRating || 1);
    });

    var compRows = Object.keys(componentMap).map(function (c) {
      var d = componentMap[c];
      var avg = (d.sum / d.count).toFixed(1);
      var col = parseFloat(avg) >= 3 ? '#ef4444' : parseFloat(avg) >= 2 ? '#f59e0b' : '#2ECFB0';
      return '<tr><td>' + componentLabel(c) + '</td><td style="text-align:center">' + d.count +
             '</td><td style="text-align:center;color:' + col + ';font-weight:700">' + avg + '</td></tr>';
    }).join('');

    var findingRows = findings.map(function (f, i) {
      var rating = f.conditionRating || 1;
      var badgeColor = CONDITION_COLORS[rating];
      var badgeBg = CONDITION_BG[rating];
      var img = f.screenshotDataUrl
        ? '<img src="' + f.screenshotDataUrl + '" style="width:100%;height:160px;object-fit:cover;display:block;border-radius:4px 4px 0 0;">'
        : '<div style="width:100%;height:100px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px;border-radius:4px 4px 0 0;">No screenshot</div>';

      return '<div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:16px;page-break-inside:avoid;">' +
        img +
        '<div style="padding:12px 16px;">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
            '<span style="font-size:11px;color:#94a3b8;font-weight:600;">#' + (i + 1) + '</span>' +
            '<span style="background:' + badgeBg + ';color:' + badgeColor + ';border:1px solid ' + badgeColor + ';padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">' +
              rating + ' — ' + CONDITION_LABELS[rating] +
            '</span>' +
          '</div>' +
          '<div style="font-weight:700;font-size:14px;color:#0f172a;margin-bottom:4px;">' + (f.title || 'Untitled') + '</div>' +
          '<div style="font-size:12px;color:#64748b;margin-bottom:6px;">' +
            componentLabel(f.component || '') + ' &nbsp;·&nbsp; ' + damageLabel(f.damageType || '') +
          '</div>' +
          (f.description ? '<div style="font-size:12px;color:#374151;margin-bottom:6px;line-height:1.5;">' + f.description + '</div>' : '') +
          '<div style="font-size:11px;color:#94a3b8;">' +
            formatDate(f.timestamp) +
            (f.lat ? ' &nbsp;·&nbsp; ' + Number(f.lat).toFixed(5) + ', ' + Number(f.lon).toFixed(5) : '') +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
      '<title>Inspection Report — ' + assetName + '</title>' +
      '<style>' +
        'body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0f172a;background:#fff;}' +
        'h1,h2,h3{margin:0;}' +
        'table{width:100%;border-collapse:collapse;}' +
        'td,th{padding:8px 12px;text-align:left;font-size:13px;}' +
        'th{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e2e8f0;}' +
        'tr+tr td{border-top:1px solid #f1f5f9;}' +
        '@media print{' +
          '@page{margin:16mm;}' +
          '.no-print{display:none!important;}' +
          'body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
        '}' +
      '</style>' +
      '</head><body>' +

      // Header
      '<div style="background:#0E1117;color:#fff;padding:24px 32px;display:flex;align-items:center;justify-content:space-between;">' +
        '<div>' +
          '<img src="/logo/logo_teal_transparent.svg" style="height:32px;margin-bottom:8px;" onerror="this.style.display=\'none\'">' +
          '<h1 style="font-size:20px;font-weight:700;color:#fff;">' + assetName + '</h1>' +
          '<div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:2px;">Bridge Inspection Report &nbsp;·&nbsp; Generated ' + now + '</div>' +
        '</div>' +
      '</div>' +

      // Summary stats
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#e2e8f0;border-bottom:1px solid #e2e8f0;">' +
        '<div style="background:#fff;padding:20px 24px;text-align:center;">' +
          '<div style="font-size:32px;font-weight:700;color:#0f172a;">' + total + '</div>' +
          '<div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-top:2px;">Total Findings</div>' +
        '</div>' +
        '<div style="background:#fff;padding:20px 24px;text-align:center;">' +
          '<div style="font-size:32px;font-weight:700;color:' + avgColor + ';">' + avgRating + '</div>' +
          '<div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-top:2px;">Avg Condition Rating</div>' +
        '</div>' +
        '<div style="background:#fff;padding:20px 24px;text-align:center;">' +
          '<div style="font-size:32px;font-weight:700;color:' + (critCount > 0 ? '#ef4444' : '#2ECFB0') + ';">' + critCount + '</div>' +
          '<div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-top:2px;">Critical / Poor</div>' +
        '</div>' +
      '</div>' +

      // Component breakdown
      (compRows ? '<div style="padding:24px 32px;border-bottom:1px solid #f1f5f9;">' +
        '<h2 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-bottom:12px;">By Component</h2>' +
        '<table><thead><tr><th>Component</th><th style="text-align:center">Findings</th><th style="text-align:center">Avg Rating</th></tr></thead>' +
        '<tbody>' + compRows + '</tbody></table>' +
      '</div>' : '') +

      // Print button
      '<div class="no-print" style="padding:16px 32px;border-bottom:1px solid #f1f5f9;display:flex;gap:8px;">' +
        '<button onclick="window.print()" style="padding:8px 20px;background:#2ECFB0;color:#0E1117;border:none;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;">Print / Save as PDF</button>' +
      '</div>' +

      // Findings
      '<div style="padding:24px 32px;">' +
        '<h2 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-bottom:16px;">Findings (' + total + ')</h2>' +
        '<div style="columns:2;column-gap:16px;">' + findingRows + '</div>' +
      '</div>' +

      '</body></html>';
  }

  function generate(assetId) {
    if (!BimViewer.comments || !BimViewer.comments.collection) {
      alert('Comments not initialized.');
      return;
    }

    var assetData = assetId && BimViewer.loadedAssets && BimViewer.loadedAssets.get(String(assetId));
    var assetName = assetData ? assetData.name : (assetId || 'Bridge');

    BimViewer.comments.collection
      .where('inspectionMode', '==', true)
      .where('assetId', '==', String(assetId || 'unknown'))
      .orderBy('timestamp', 'desc')
      .get()
      .then(function (snapshot) {
        var findings = [];
        snapshot.forEach(function (doc) { findings.push(doc.data()); });

        if (findings.length === 0) {
          alert('No inspection findings for this asset.');
          return;
        }

        var html = buildHTML(assetName, findings);
        var win = window.open('', '_blank');
        if (!win) { alert('Please allow pop-ups for this site.'); return; }
        win.document.write(html);
        win.document.close();
      })
      .catch(function (e) {
        console.error('Inspection report query failed:', e);
        alert('Failed to load findings: ' + e.message);
      });
  }

  return { generate: generate };

})();
