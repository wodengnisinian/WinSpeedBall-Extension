(function (global) {
  "use strict";

  function text(value) {
    return value;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function normalizeDelayMs(value, fallback, min, max) {
    var milliseconds = Number(value);
    if (!Number.isFinite(milliseconds)) milliseconds = fallback;
    if (milliseconds <= 10) milliseconds *= 1000;
    return Math.max(min, Math.min(max, Math.round(milliseconds)));
  }

  function normalizeNavDelayMs(value) {
    return normalizeDelayMs(value, 800, 200, 3000);
  }

  function normalizeNavHideDelayMs(value) {
    return normalizeDelayMs(value, 900, 200, 3000);
  }

  function normalizeNavTransitionMs(value) {
    return normalizeDelayMs(value, 180, 50, 1000);
  }

  function clampNumber(value, fallback, min, max) {
    var number = Number(value);
    if (!Number.isFinite(number)) number = fallback;
    return Math.max(min, Math.min(max, Math.round(number)));
  }

  function normalizeCaptureTone(value) {
    return clampNumber(value, 96, 0, 255);
  }

  function normalizeCaptureWidth(value) {
    var width = Number(value);
    if (!Number.isFinite(width)) width = 2;
    return Math.max(0.1, Math.min(5, Math.round(width * 10) / 10));
  }

  function normalizeNavZones(value) {
    var raw = value || {};
    var zones = {
      left: {
        width: clampNumber(raw.left && raw.left.width, 32, 8, 120),
        top: clampNumber(raw.left && raw.left.top, 0, 0, 320),
        bottom: clampNumber(raw.left && raw.left.bottom, 320, 0, 320)
      },
      right: {
        width: clampNumber(raw.right && raw.right.width, 32, 8, 120),
        top: clampNumber(raw.right && raw.right.top, 0, 0, 320),
        bottom: clampNumber(raw.right && raw.right.bottom, 320, 0, 320)
      },
      top: {
        height: clampNumber(raw.top && raw.top.height, 32, 8, 120),
        left: clampNumber(raw.top && raw.top.left, 0, 0, 380),
        right: clampNumber(raw.top && raw.top.right, 380, 0, 380)
      }
    };
    if (zones.left.bottom <= zones.left.top) zones.left.bottom = Math.min(320, zones.left.top + 8);
    if (zones.right.bottom <= zones.right.top) zones.right.bottom = Math.min(320, zones.right.top + 8);
    if (zones.top.right <= zones.top.left) zones.top.right = Math.min(380, zones.top.left + 8);
    return zones;
  }

  global.WinSpeedBallPopupUtils = {
    text: text,
    byId: byId,
    normalizeNavDelayMs: normalizeNavDelayMs,
    normalizeNavHideDelayMs: normalizeNavHideDelayMs,
    normalizeNavTransitionMs: normalizeNavTransitionMs,
    clampNumber: clampNumber,
    normalizeCaptureTone: normalizeCaptureTone,
    normalizeCaptureWidth: normalizeCaptureWidth,
    normalizeNavZones: normalizeNavZones
  };
})(self);
