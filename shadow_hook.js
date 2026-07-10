/**
 * Runs in MAIN world.
 * Forces future closed shadow roots to open roots so media inside them can be found.
 */
(function () {
  "use strict";
  // Guard: skip chrome:// and edge:// internal pages
  try { if (/^(chrome|edge|about|chrome-extension):\/\//i.test(location.href)) return; } catch (e) { return; }

  if (window.__WinSpeedBallShadowHooked) return;
  window.__WinSpeedBallShadowHooked = true;

  try {
    var nativeAttachShadow = Element.prototype.attachShadow;
    if (!nativeAttachShadow || nativeAttachShadow.__winSpeedBallHooked) return;

    function hookedAttachShadow(init) {
      var options = init && typeof init === "object" ? Object.assign({}, init, { mode: "open" }) : init;
      return nativeAttachShadow.call(this, options);
    }

    hookedAttachShadow.__winSpeedBallHooked = true;
    Element.prototype.attachShadow = hookedAttachShadow;
  } catch (e) {}
})();
