(function (global) {
  "use strict";

  function normalize(input) {
    return String(input || "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .replace(/\uFEFF/g, "")
      .trim();
  }

  global.WinSpeedBallStructuredTextNormalizer = Object.freeze({
    normalize: normalize
  });
})(self);
