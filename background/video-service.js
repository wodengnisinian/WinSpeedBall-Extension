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
      var authoritative = null;
      var media = [];

      (results || []).forEach(function (item, frameIndex) {
        var result = item && item.result ? item.result : item;
        if (!result) result = { ok: false, error: "no result", mediaCount: 0, applied: 0 };
        frameResults.push(result);
        if (result.ok && !firstOk) firstOk = result;
        if (result.ok && (result.mediaCount > 0 || Number(result.duration || 0) > 0)) {
          if (!mediaInfo || (Number(mediaInfo.duration || 0) <= 0 && Number(result.duration || 0) > 0)) mediaInfo = result;
        }
        totalMedia += result.mediaCount || 0;
        totalApplied += result.applied || 0;
        if (result.specialPlayerDetected) {
          specialPlayerDetected = true;
          specialPlayerType = result.specialPlayerType || specialPlayerType;
          reason = result.reason || reason;
        }
        (Array.isArray(result.media) ? result.media : []).forEach(function (snapshot) {
          var frameId = item && item.frameId != null ? item.frameId : frameIndex;
          snapshot = snapshot || {};
          media.push({
            id: "frame-" + String(frameId) + "-" + String(snapshot.id || "media"),
            frameId: frameId,
            title: String(snapshot.title || "").slice(0, 256),
            duration: Number(snapshot.duration || 0),
            currentTime: Number(snapshot.currentTime || 0),
            progress: Number(snapshot.progress || 0),
            rate: Number(snapshot.rate || 1),
            volume: Number(snapshot.volume || 0),
            muted: snapshot.muted === true,
            paused: snapshot.paused !== false,
            mediaType: String(snapshot.mediaType || "")
          });
        });
      });

      authoritative = mediaInfo || firstOk;

      if (authoritative && command && command.type !== "GET_STATUS" && command.type !== "EXTRACT_PAGE_TEXT") {
        currentRate = authoritative.targetRate == null ? authoritative.rate : authoritative.targetRate;
        currentMuted = authoritative.muted;
        currentVolume = authoritative.volume;
        storage.set({ rate: currentRate, muted: currentMuted, volume: currentVolume });
      }

      var output = {
        ok: !!firstOk,
        rate: authoritative ? authoritative.rate : currentRate,
        targetRate: authoritative && authoritative.targetRate != null ? authoritative.targetRate : authoritative ? authoritative.rate : currentRate,
        rateLocked: authoritative ? authoritative.rateLocked === true : false,
        rateStable: authoritative ? authoritative.rateStable !== false : false,
        externalRateMasked: authoritative ? authoritative.externalRateMasked === true : false,
        muted: authoritative ? authoritative.muted : currentMuted,
        volume: authoritative ? authoritative.volume : currentVolume,
        keepPlaying: authoritative ? !!authoritative.keepPlaying : false,
        continuousPlayback: authoritative ? authoritative.continuousPlayback === true : false,
        controlMode: authoritative ? authoritative.controlMode || "stopped" : "stopped",
        playerAdapter: mediaInfo ? mediaInfo.playerAdapter || "" : firstOk ? firstOk.playerAdapter || "" : "",
        playerType: mediaInfo ? mediaInfo.playerType || "" : firstOk ? firstOk.playerType || "" : "",
        duration: mediaInfo ? mediaInfo.duration || 0 : 0,
        durationSource: mediaInfo ? mediaInfo.durationSource || "" : "",
        currentTime: mediaInfo ? mediaInfo.currentTime || 0 : 0,
        remainingTime: mediaInfo ? mediaInfo.remainingTime || 0 : 0,
        paused: mediaInfo ? !!mediaInfo.paused : true,
        mediaTag: mediaInfo ? mediaInfo.mediaTag || "" : "",
        mediaCount: totalMedia,
        applied: totalApplied,
        frameCount: results ? results.length : 0,
        frameResults: frameResults
      };
      output.media = media;
      if (!firstOk) output.error = "No controllable media was found on this page.";
      if (specialPlayerDetected) {
        output.specialPlayerDetected = true;
        output.specialPlayerType = specialPlayerType;
        output.reason = reason;
      }
      return output;
    }

    function sendIsolatedCommandToAllFrames(tabId, command, callback) {
      function executeCommand(done) {
        chrome.scripting.executeScript({
          target: { tabId: tabId, allFrames: true },
          world: "ISOLATED",
          func: function (cmd) {
            if (window.__WinSpeedBallLoadedVersion === "2026-07-11-sdk-lifecycle-v2" && window.winSpeedBall && window.winSpeedBall.handleCommand) {
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
            files: ["content/shadow-hook.js"],
            world: "MAIN"
          }, function () {
            lastErrorMessage();
            chrome.scripting.executeScript({
              target: { tabId: tabId, allFrames: true },
              files: ["content/player-adapters.js", "content/index.js"]
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

    function sendMainWorldCommandToAllFrames(tabId, command, callback) {
      function executeCommand(done) {
        chrome.scripting.executeScript({
          target: { tabId: tabId, allFrames: true },
          world: "MAIN",
          func: function (cmd) {
            if (window.WinSpeedBallMediaCoreV6 && typeof window.WinSpeedBallMediaCoreV6.handleCommand === "function") {
              return window.WinSpeedBallMediaCoreV6.handleCommand(cmd);
            }
            return { ok: false, error: "main media core upgrade required", url: location.href, mediaCount: 0, applied: 0 };
          },
          args: [command]
        }, done);
      }

      function finish(results) {
        var error = lastErrorMessage();
        if (error) {
          callback(Object.assign({ ok: false, error: error, mediaCount: 0, applied: 0, frameCount: 0, frameResults: [] }, getState()));
          return;
        }
        callback(aggregateFrameResults(results || [], command));
      }

      try {
        executeCommand(function (results) {
          var error = lastErrorMessage();
          if (error) {
            callback(Object.assign({ ok: false, error: error, mediaCount: 0, applied: 0, frameCount: 0, frameResults: [] }, getState()));
            return;
          }
          var unloaded = !results || !results.length || results.some(function (item) {
            return item && item.result && item.result.error === "main media core upgrade required";
          });
          if (!unloaded) {
            finish(results);
            return;
          }
          chrome.scripting.executeScript({
            target: { tabId: tabId, allFrames: true },
            world: "MAIN",
            func: function () {
              var legacy = window.WinSpeedBallMediaCoreV5 || window.WinSpeedBallMediaCoreV4 || window.WinSpeedBallMediaCoreV3 || window.WinSpeedBallMediaCore;
              if (!window.WinSpeedBallMediaCoreV6 && legacy && typeof legacy.handleCommand === "function") {
                try { legacy.handleCommand({ type: "STOP_LOCK" }); } catch (error) {}
              }
              return true;
            }
          }, function () {
            lastErrorMessage();
            chrome.scripting.executeScript({
              target: { tabId: tabId, allFrames: true },
              world: "MAIN",
              files: ["content/shadow-hook.js", "content/media-core-main.js"]
            }, function () {
              var injectError = lastErrorMessage();
              if (injectError) {
                callback({ ok: false, error: injectError, mediaCount: 0, applied: 0, frameCount: 0, frameResults: [] });
                return;
              }
              executeCommand(finish);
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

    function sendCommandToAllFrames(tabId, command, callback) {
      if (command && command.type === "EXTRACT_PAGE_TEXT") {
        sendIsolatedCommandToAllFrames(tabId, command, callback);
        return;
      }
      sendMainWorldCommandToAllFrames(tabId, command, callback);
    }

    function controlTab(tabId, command, callback) {
      command = command || { type: "GET_STATUS" };
      var rateCommand = ["SET_RATE", "STEP_UP", "STEP_DOWN"].indexOf(command.type) >= 0;
      if (!rateCommand) {
        sendCommandToAllFrames(tabId, command, callback);
        return;
      }
      sendCommandToAllFrames(tabId, command, function (initial) {
        if (!initial || !initial.ok || !initial.mediaCount) {
          callback(initial || { ok: false, error: "未检测到可控制的视频。", mediaCount: 0, applied: 0 });
          return;
        }
        var expectedRate = Number(command.type === "SET_RATE" ? command.rate : initial.targetRate || initial.rate);
        setTimeout(function () {
          sendCommandToAllFrames(tabId, { type: "GET_STATUS" }, function (verified) {
            verified = verified || { ok: false, mediaCount: 0 };
            var measuredRate = Number(verified.rate || 0);
            var rateStable = verified.ok && verified.mediaCount > 0 && verified.rateLocked === true && verified.rateStable !== false &&
              Number.isFinite(expectedRate) && Math.abs(measuredRate - expectedRate) <= 0.01;
            var result = Object.assign({}, verified, {
              ok: rateStable,
              applied: initial.applied || 0,
              targetRate: expectedRate,
              verifiedAfterMs: 700
            });
            if (!rateStable) {
              result.error = verified.mediaCount > 0
                ? "目标倍速未能稳定保持，页面仍在覆盖播放速度。请刷新视频页面后重试。"
                : "延迟校验时未检测到可控制的视频。";
            }
            callback(result);
          });
        }, 700);
      });
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
