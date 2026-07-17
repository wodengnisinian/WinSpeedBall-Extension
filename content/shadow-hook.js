/**
 * Runs in MAIN world.
 * Forces future closed shadow roots to open roots so media inside them can be found.
 */
(function () {
  "use strict";
  // Guard: skip chrome:// and edge:// internal pages
  try { if (/^(chrome|edge|about|chrome-extension):\/\//i.test(location.href)) return; } catch (e) { return; }

  if (window.__WinSpeedBallShadowHookedVersion === "2026-07-11-v2") return;
  window.__WinSpeedBallShadowHooked = true;
  window.__WinSpeedBallShadowHookedVersion = "2026-07-11-v2";

  try {
    var nativeAttachShadow = Element.prototype.attachShadow;
    if (!nativeAttachShadow) return;

    function hookedAttachShadow(init) {
      var options = init && typeof init === "object" ? Object.assign({}, init, { mode: "open" }) : init;
      var root = nativeAttachShadow.call(this, options);
      try {
        this.dispatchEvent(new CustomEvent("winspeedball-shadow-root-attached", { bubbles: true, composed: true }));
      } catch (e) {}
      return root;
    }

    hookedAttachShadow.__winSpeedBallHooked = true;
    Element.prototype.attachShadow = hookedAttachShadow;
  } catch (e) {}
})();
