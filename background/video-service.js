(function (global) {
  "use strict";

  function create() {
    var storage = global.WinSpeedBallStorageService;
    var currentRate = 1.0;
    var currentMuted = false;
    var currentVolume = 0.8;

    function lastErrorMessage() {
      return chrome.runtime.lastError ? chrome.runtime.lastError.message : "";
    }

    function getState() {
      return { rate: currentRate, muted: currentMuted, volume: currentVolume };
    }

    function hydrate(callback) {
      storage.get(["rate", "muted", "volume"], function (data) {
        if (data.rate != null) currentRate = data.rate;
        if (data.muted != null) currentMuted = data.muted;
        if (data.volume != null) currentVolume = data.volume;
        if (typeof callback === "function") callback(getState());
      });
    }

    function aggregateFrameResults(results, command) {
      var frameResults = [];
      var totalMedia = 0;
      var totalApplied = 0;
      var firstOk = null;
      var specialPlayerDetected = false;
      var specialPlayerType = "";
      var reason = "";
      var mediaInfo = null;

      (results || []).forEach(function (item) {
        var result = item && item.result ? item.result : item;
        if (!result) result = { ok: false, error: "no result", mediaCount: 0, applied: 0 };
        frameResults.push(result);
        if (result.ok && !firstOk) firstOk = result;
        if (!mediaInfo && result.ok && result.mediaCount > 0) mediaInfo = result;
        totalMedia += result.mediaCount || 0;
        totalApplied += result.applied || 0;
        if (result.specialPlayerDetected) {
          specialPlayerDetected = true;
          specialPlayerType = result.specialPlayerType || specialPlayerType;
          reason = result.reason || reason;
        }
      });

      if (firstOk && command && command.type !== "GET_STATUS" && command.type !== "EXTRACT_PAGE_TEXT") {
        currentRate = firstOk.rate;
        currentMuted = firstOk.muted;
        currentVolume = firstOk.volume;
        storage.set({ rate: currentRate, muted: currentMuted, volume: currentVolume });
      }

      var output = {
        ok: !!firstOk,
        rate: firstOk ? firstOk.rate : currentRate,
        muted: firstOk ? firstOk.muted : currentMuted,
        volume: firstOk ? firstOk.volume : currentVolume,
        keepPlaying: firstOk ? !!firstOk.keepPlaying : false,
        playerAdapter: mediaInfo ? mediaInfo.playerAdapter || "" : firstOk ? firstOk.playerAdapter || "" : "",
        playerType: mediaInfo ? mediaInfo.playerType || "" : firstOk ? firstOk.playerType || "" : "",
        duration: mediaInfo ? mediaInfo.duration || 0 : 0,
        currentTime: mediaInfo ? mediaInfo.currentTime || 0 : 0,
        remainingTime: mediaInfo ? mediaInfo.remainingTime || 0 : 0,
        paused: mediaInfo ? !!mediaInfo.paused : true,
        mediaTag: mediaInfo ? mediaInfo.mediaTag || "" : "",
        mediaCount: totalMedia,
        applied: totalApplied,
        frameCount: results ? results.length : 0,
        frameResults: frameResults
      };
      if (!firstOk) output.error = "No controllable media was found on this page.";
      if (specialPlayerDetected) {
        output.specialPlayerDetected = true;
        output.specialPlayerType = specialPlayerType;
        output.reason = reason;
      }
      return output;
    }

    function sendCommandToAllFrames(tabId, command, callback) {
      function executeCommand(done) {
        chrome.scripting.executeScript({
          target: { tabId: tabId, allFrames: true },
          world: "ISOLATED",
          func: function (cmd) {
            if (window.__WinSpeedBallLoadedVersion === "2026-07-11-player-adapters-v1" && window.winSpeedBall && window.winSpeedBall.handleCommand) {
              return window.winSpeedBall.handleCommand(cmd);
            }
            return { ok: false, error: "content script not loaded", url: location.href, mediaCount: 0, applied: 0 };
          },
          args: [command]
        }, done);
      }

      try {
        executeCommand(function (results) {
          var error = lastErrorMessage();
          if (error) {
            callback(Object.assign({ ok: false, error: error, mediaCount: 0, applied: 0, frameCount: 0, frameResults: [] }, getState()));
            return;
          }
          var unloaded = (results || []).length > 0 && results.every(function (item) {
            return item && item.result && item.result.error === "content script not loaded";
          });
          if (!unloaded) {
            callback(aggregateFrameResults(results || [], command));
            return;
          }

          chrome.scripting.executeScript({
            target: { tabId: tabId, allFrames: true },
            files: ["shadow_hook.js"],
            world: "MAIN"
          }, function () {
            lastErrorMessage();
            chrome.scripting.executeScript({
              target: { tabId: tabId, allFrames: true },
              files: ["content/player-adapters.js", "content_script.js"]
            }, function () {
              var injectError = lastErrorMessage();
              if (injectError) {
                callback({ ok: false, error: injectError, mediaCount: 0, applied: 0, frameResults: [] });
                return;
              }
              executeCommand(function (retryResults) {
                var retryError = lastErrorMessage();
                if (retryError) callback({ ok: false, error: retryError, mediaCount: 0, applied: 0, frameResults: [] });
                else callback(aggregateFrameResults(retryResults || [], command));
              });
            });
          });
        });
      } catch (error) {
        callback(Object.assign({
          ok: false,
          error: error.message || String(error),
          mediaCount: 0,
          applied: 0,
          frameCount: 0,
          frameResults: []
        }, getState()));
      }
    }

    function controlTab(tabId, command, callback) {
      sendCommandToAllFrames(tabId, command || { type: "GET_STATUS" }, callback);
    }

    return {
      controlTab: controlTab,
      aggregateFrameResults: aggregateFrameResults,
      hydrate: hydrate,
      getState: getState
    };
  }

  global.WinSpeedBallVideoService = { create: create };
})(self);
