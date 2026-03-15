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
// BCF 2.1 EXPORT MODULE v1.1 (Schema-compliant per buildingSMART/BCF-XML release_2_1)
// Exports comments as BCF ZIP files with viewpoint + snapshot
// ===============================
'use strict';

(function() {

  console.log('Loading BCF Export Module v1.1...');

  // =====================================
  // HELPERS
  // =====================================

  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function escapeXml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function toISOString(ts) {
    if (!ts) return new Date().toISOString();
    var d = new Date(ts);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }

  function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) : str;
  }

  // =====================================
  // GET PRIMARY IFC TILESET
  // =====================================

  function getPrimaryTileset() {
    if (!BimViewer.loadedAssets || BimViewer.loadedAssets.size === 0) return null;
    // Return first loaded tileset that has a root with a transform
    for (var entry of BimViewer.loadedAssets.values()) {
      if (entry.tileset && entry.tileset.root && entry.tileset.root.transform) {
        return entry.tileset;
      }
    }
    return null;
  }

  // =====================================
  // CAMERA TRANSFORM: ECEF → IFC LOCAL (Y-UP)
  // =====================================

  function getCameraInLocalCoords() {
    var viewer = BimViewer.viewer;
    if (!viewer || !viewer.camera) return null;

    var tileset = getPrimaryTileset();

    // Camera in ECEF (Cesium world coordinates)
    var posWC = viewer.camera.positionWC;
    var dirWC = viewer.camera.directionWC;
    var upWC = viewer.camera.upWC;

    var pos, dir, up;

    if (tileset && tileset.root && tileset.root.transform) {
      // Compute inverse of tileset root transform
      var inverseTransform = Cesium.Matrix4.inverse(tileset.root.transform, new Cesium.Matrix4());

      // Transform position (point — w=1)
      var localPos = Cesium.Matrix4.multiplyByPoint(inverseTransform, posWC, new Cesium.Cartesian3());
      // Transform direction and up (vectors — w=0)
      var localDir = Cesium.Matrix4.multiplyByPointAsVector(inverseTransform, dirWC, new Cesium.Cartesian3());
      var localUp = Cesium.Matrix4.multiplyByPointAsVector(inverseTransform, upWC, new Cesium.Cartesian3());

      Cesium.Cartesian3.normalize(localDir, localDir);
      Cesium.Cartesian3.normalize(localUp, localUp);

      // Swap Y/Z: Cesium is Z-up, IFC/BCF is Y-up
      // IFC_x = local_x, IFC_y = local_z, IFC_z = -local_y
      pos = { x: localPos.x, y: localPos.z, z: -localPos.y };
      dir = { x: localDir.x, y: localDir.z, z: -localDir.y };
      up  = { x: localUp.x,  y: localUp.z,  z: -localUp.y };
    } else {
      // Fallback: convert ECEF to cartographic, use as-is (approximate)
      var carto = Cesium.Cartographic.fromCartesian(posWC);
      pos = {
        x: Cesium.Math.toDegrees(carto.longitude),
        y: carto.height,
        z: Cesium.Math.toDegrees(carto.latitude)
      };
      dir = { x: dirWC.x, y: dirWC.z, z: -dirWC.y };
      up  = { x: upWC.x,  y: upWC.z,  z: -upWC.y };
    }

    // Field of view in degrees
    var fov = Cesium.Math.toDegrees(viewer.camera.frustum.fovy || viewer.camera.frustum.fov || 1.0472);

    return { position: pos, direction: dir, up: up, fov: fov };
  }

  // =====================================
  // CAPTURE SNAPSHOT
  // =====================================

  function captureSnapshot() {
    var viewer = BimViewer.viewer;
    if (!viewer || !viewer.canvas) return null;

    try {
      // Force render to ensure canvas has current frame
      viewer.scene.render();
      return viewer.canvas.toDataURL('image/png');
    } catch (e) {
      console.warn('BCF: Could not capture snapshot:', e);
      return null;
    }
  }

  // =====================================
  // GENERATE XML FILES
  // =====================================

  function generateMarkupXml(comment, topicGuid, commentGuid) {
    var iso = toISOString(comment.timestamp);
    var author = escapeXml(comment.author || 'Unknown');
    var title = escapeXml(truncate(comment.title || comment.text || 'Comment', 80));
    var description = escapeXml(comment.text || '');
    var commentText = escapeXml(comment.text || '');

    // Priority from inspection data (optional element, before Description in schema)
    var priorityLine = '';
    if (comment.conditionRating) {
      var ratingLabels = { 1: 'Good', 2: 'Fair', 3: 'Poor', 4: 'Critical' };
      priorityLine = '    <Priority>' + escapeXml(ratingLabels[comment.conditionRating] || 'Normal') + '</Priority>\n';
    } else if (comment.priority && comment.priority !== 'Normal') {
      priorityLine = '    <Priority>' + escapeXml(comment.priority) + '</Priority>\n';
    }

    // BCF 2.1 schema: Topic requires Guid attr, Title, CreationDate, CreationAuthor
    // Comment requires Guid attr, Date, Author, Comment text
    // Viewpoints requires Guid attr
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Markup xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n' +
      '  <Topic Guid="' + topicGuid + '" TopicType="Issue" TopicStatus="Open">\n' +
      '    <Title>' + title + '</Title>\n' +
      priorityLine +
      '    <CreationDate>' + iso + '</CreationDate>\n' +
      '    <CreationAuthor>' + author + '</CreationAuthor>\n' +
      '    <Description>' + description + '</Description>\n' +
      '  </Topic>\n' +
      '  <Comment Guid="' + commentGuid + '">\n' +
      '    <Date>' + iso + '</Date>\n' +
      '    <Author>' + author + '</Author>\n' +
      '    <Comment>' + commentText + '</Comment>\n' +
      '    <Viewpoint Guid="' + topicGuid + '"/>\n' +
      '  </Comment>\n' +
      '  <Viewpoints Guid="' + topicGuid + '">\n' +
      '    <Viewpoint>viewpoint.bcfv</Viewpoint>\n' +
      '    <Snapshot>snapshot.png</Snapshot>\n' +
      '  </Viewpoints>\n' +
      '</Markup>';
  }

  function generateViewpointXml(camera, guid) {
    var p = camera.position;
    var d = camera.direction;
    var u = camera.up;
    // BCF 2.1 schema restricts FieldOfView to 45–60, clamp to be safe
    var fov = Math.max(45, Math.min(60, camera.fov)).toFixed(1);

    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<VisualizationInfo Guid="' + guid + '">\n' +
      '  <PerspectiveCamera>\n' +
      '    <CameraViewPoint>\n' +
      '      <X>' + p.x.toFixed(6) + '</X>\n' +
      '      <Y>' + p.y.toFixed(6) + '</Y>\n' +
      '      <Z>' + p.z.toFixed(6) + '</Z>\n' +
      '    </CameraViewPoint>\n' +
      '    <CameraDirection>\n' +
      '      <X>' + d.x.toFixed(6) + '</X>\n' +
      '      <Y>' + d.y.toFixed(6) + '</Y>\n' +
      '      <Z>' + d.z.toFixed(6) + '</Z>\n' +
      '    </CameraDirection>\n' +
      '    <CameraUpVector>\n' +
      '      <X>' + u.x.toFixed(6) + '</X>\n' +
      '      <Y>' + u.y.toFixed(6) + '</Y>\n' +
      '      <Z>' + u.z.toFixed(6) + '</Z>\n' +
      '    </CameraUpVector>\n' +
      '    <FieldOfView>' + fov + '</FieldOfView>\n' +
      '  </PerspectiveCamera>\n' +
      '</VisualizationInfo>';
  }

  function generateVersionXml() {
    // Matches buildingSMART MinimumInformation test case exactly
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Version VersionId="2.1">\n' +
      '  <DetailedVersion>2.1</DetailedVersion>\n' +
      '</Version>';
  }

  // =====================================
  // DATA URI → BLOB CONVERSION
  // =====================================

  function dataURItoBlob(dataURI) {
    var parts = dataURI.split(',');
    var mime = parts[0].match(/:(.*?);/)[1];
    var raw = atob(parts[1]);
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) {
      arr[i] = raw.charCodeAt(i);
    }
    return new Blob([arr], { type: mime });
  }

  // =====================================
  // BUILD ZIP & DOWNLOAD
  // =====================================

  async function buildAndDownload(comment) {
    var topicGuid = generateUUID();
    var commentGuid = generateUUID();
    var camera = getCameraInLocalCoords();

    if (!camera) {
      BimViewer.updateStatus('BCF Export: Camera data not available', 'error');
      return;
    }

    // Check JSZip availability
    if (typeof JSZip === 'undefined') {
      BimViewer.updateStatus('BCF Export: JSZip library not loaded', 'error');
      console.error('BCF Export requires JSZip. Include it via <script> tag.');
      return;
    }

    var zip = new JSZip();

    // bcf.version (root level)
    zip.file('bcf.version', generateVersionXml());

    // Topic folder (named by topic GUID)
    var folder = zip.folder(topicGuid);
    folder.file('markup.bcf', generateMarkupXml(comment, topicGuid, commentGuid));
    folder.file('viewpoint.bcfv', generateViewpointXml(camera, topicGuid));

    // Snapshot
    var snapshotDataURI = captureSnapshot();
    if (snapshotDataURI) {
      var snapshotBlob = dataURItoBlob(snapshotDataURI);
      folder.file('snapshot.png', snapshotBlob);
    }

    // Generate ZIP
    try {
      var blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/octet-stream' });
      var filename = 'geobim-' + topicGuid + '.bcf';

      // Trigger download
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);

      BimViewer.updateStatus('BCF exported: ' + filename, 'success');
      console.log('BCF exported:', filename);

    } catch (err) {
      console.error('BCF ZIP generation failed:', err);
      BimViewer.updateStatus('BCF export failed: ' + err.message, 'error');
    }
  }

  // =====================================
  // PUBLIC API
  // =====================================

  window.GEOBIM_BCF = {
    exportComment: function(comment) {
      if (!comment) {
        console.error('BCF Export: No comment provided');
        return;
      }
      buildAndDownload(comment);
    }
  };

  console.log('BCF Export Module loaded');

})();
