(function (global) {
  "use strict";

  var CHANNEL = "WSB_USER_SCRIPT_BRIDGE";

  function exactKeys(value, allowed) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    var keys = Object.keys(value);
    return keys.length === allowed.length && keys.every(function (key) { return allowed.indexOf(key) >= 0; });
  }

  function isWebUrl(value) {
    try {
      var url = new URL(String(value || ""));
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (error) {
      return false;
    }
  }

  function publicVideoStatus(result) {
    result = result || {};
    return {
      ok: result.ok === true,
      duration: Number(result.duration || 0),
      currentTime: Number(result.currentTime || 0),
      mediaCount: Number(result.mediaCount || 0),
      paused: result.paused !== false,
      rate: Number(result.rate || 1),
      durationSource: String(result.durationSource || ""),
      playerType: String(result.playerType || ""),
      error: result.ok === true ? "" : String(result.error || "Video status is unavailable.").slice(0, 300)
    };
  }

  function create(options) {
    options = options || {};
    var runtime = options.runtime || (global.chrome && global.chrome.runtime);
    var controlTab = options.controlTab;
    var canUseFeature = options.canUseFeature || function () { return Promise.resolve({ allowed: true }); };
    var onAudit = options.onAudit || function () {};

    function respondError(sendResponse, code, error) {
      sendResponse({ ok: false, code: code, error: error });
    }

    function handle(message, sender, sendResponse) {
      if (!exactKeys(message, ["channel", "version", "action"]) ||
          message.channel !== CHANNEL || message.version !== 1 || message.action !== "GET_VIDEO_STATUS") {
        respondError(sendResponse, "USER_SCRIPT_BRIDGE_INVALID", "Invalid user script bridge request.");
        return false;
      }
      if (!sender || !sender.tab || !Number.isInteger(sender.tab.id) || sender.frameId !== 0 || !isWebUrl(sender.url || sender.tab.url)) {
        respondError(sendResponse, "USER_SCRIPT_BRIDGE_DENIED", "Only a top-level web page may read plugin video status.");
        return false;
      }
      if (typeof controlTab !== "function") {
        respondError(sendResponse, "USER_SCRIPT_BRIDGE_UNAVAILABLE", "Plugin video service is unavailable.");
        return false;
      }

      Promise.resolve().then(function () {
        return canUseFeature("video.basic");
      }).then(function (gate) {
        if (!gate || gate.allowed !== true) {
          respondError(sendResponse, "FEATURE_NOT_AVAILABLE", gate && (gate.reason || gate.error) || "Video feature is unavailable.");
          return;
        }
        controlTab(sender.tab.id, { type: "GET_STATUS" }, function (result) {
          var response = publicVideoStatus(result);
          onAudit(response, sender);
          sendResponse(response);
        });
      }).catch(function (error) {
        respondError(sendResponse, "USER_SCRIPT_BRIDGE_FAILED", String(error && error.message || error || "Unknown error").slice(0, 300));
      });
      return true;
    }

    function install() {
      if (!runtime || !runtime.onUserScriptMessage || typeof runtime.onUserScriptMessage.addListener !== "function") {
        return { supported: false };
      }
      runtime.onUserScriptMessage.addListener(handle);
      return { supported: true };
    }

    return { handle: handle, install: install, publicVideoStatus: publicVideoStatus };
  }

  global.WinSpeedBallUserScriptBridge = Object.freeze({ create: create });
})(self);
