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

    function originPatternFromUrl(url) {
      try {
        var parsed = new URL(String(url || ""));
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
        return parsed.protocol + "//" + parsed.hostname + "/*";
      } catch (error) {
        return "";
      }
    }

    function originFromUrl(url) {
      try {
        var parsed = new URL(String(url || ""));
        return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : "";
      } catch (error) {
        return "";
      }
    }

    function contextChanged(error) {
      return {
        ok: false,
        code: "SDK_CONTEXT_CHANGED",
        error: String(error || "The authorized page changed before the SDK operation could run."),
        mediaCount: 0,
        applied: 0,
        frameCount: 0,
        frameResults: []
      };
    }

    function validateBoundContext(tabId, boundContext, callback) {
      if (!boundContext) {
        callback(null);
        return;
      }
      var expectedOrigin = String(boundContext.origin || "");
      var expectedPattern = String(boundContext.originPattern || "");
      if (!expectedOrigin || !expectedPattern) {
        callback(contextChanged("The SDK page binding is incomplete."));
        return;
      }
      try {
        chrome.tabs.get(tabId, function (tab) {
          var tabError = lastErrorMessage();
          var actualOrigin = tab && originFromUrl(tab.url || "");
          var actualPattern = tab && originPatternFromUrl(tab.url || "");
          if (tabError || !tab || actualOrigin !== expectedOrigin || actualPattern !== expectedPattern) {
            callback(contextChanged(tabError || "The authorized page navigated to another origin or closed."));
            return;
          }
          callback(null);
        });
      } catch (error) {
        callback(contextChanged(error && error.message || String(error)));
      }
    }

    function bindSdkDocumentTarget(tabId, details, boundContext, callback) {
      if (!boundContext) {
        callback(details, null);
        return;
      }
      if (!chrome.webNavigation || typeof chrome.webNavigation.getAllFrames !== "function") {
        callback(null, contextChanged("Browser document binding is unavailable."));
        return;
      }
      validateBoundContext(tabId, boundContext, function (contextFailure) {
        if (contextFailure) {
          callback(null, contextFailure);
          return;
        }
        try {
          chrome.webNavigation.getAllFrames({ tabId: tabId }, function (frames) {
            var frameError = lastErrorMessage();
            var list = Array.isArray(frames) ? frames : [];
            var topFrame = list.find(function (frame) { return frame && frame.frameId === 0; });
            var topOrigin = topFrame && originFromUrl(topFrame.url || "");
            var topPattern = topFrame && originPatternFromUrl(topFrame.url || "");
            if (frameError || !topFrame
                || topOrigin !== String(boundContext.origin || "")
                || topPattern !== String(boundContext.originPattern || "")) {
              callback(null, contextChanged(frameError || "The authorized document changed before the SDK operation could run."));
              return;
            }

            var requestedTarget = details && details.target || {};
            var requestedFrameIds = Array.isArray(requestedTarget.frameIds) ? requestedTarget.frameIds.map(Number) : null;
            var selected = requestedTarget.allFrames === true
              ? list.slice()
              : (requestedFrameIds
                ? requestedFrameIds.map(function (frameId) {
                  return list.find(function (frame) { return frame && frame.frameId === frameId; }) || null;
                })
                : [topFrame]);
            if (!selected.length || selected.some(function (frame) {
              return !frame || typeof frame.documentId !== "string" || !frame.documentId;
            })) {
              callback(null, contextChanged("The authorized document could not be bound safely."));
              return;
            }
            var documentIds = selected.map(function (frame) { return frame.documentId; }).filter(function (documentId, index, values) {
              return values.indexOf(documentId) === index;
            });
            if (!documentIds.length) {
              callback(null, contextChanged("The authorized document could not be bound safely."));
              return;
            }
            callback(Object.assign({}, details, {
              target: { tabId: tabId, documentIds: documentIds }
            }), null);
          });
        } catch (error) {
          callback(null, contextChanged(error && error.message || String(error)));
        }
      });
    }

    function executeScriptInBoundContext(tabId, details, boundContext, callback) {
      function execute(boundDetails) {
        try {
          chrome.scripting.executeScript(boundDetails, function (results) {
            var executeError = lastErrorMessage();
            if (!boundContext) {
              callback(results, null);
              return;
            }
            if (executeError) {
              validateBoundContext(tabId, boundContext, function (contextFailure) {
                callback([], contextFailure || {
                  ok: false,
                  error: executeError,
                  mediaCount: 0,
                  applied: 0,
                  frameCount: 0,
                  frameResults: []
                });
              });
              return;
            }
            validateBoundContext(tabId, boundContext, function (contextFailure) {
              callback(contextFailure ? [] : results, contextFailure);
            });
          });
        } catch (error) {
          callback([], {
            ok: false,
            error: error && error.message || String(error),
            mediaCount: 0,
            applied: 0,
            frameCount: 0,
            frameResults: []
          });
        }
      }

      bindSdkDocumentTarget(tabId, details, boundContext, function (boundDetails, contextFailure) {
        if (contextFailure) callback([], contextFailure);
        else execute(boundDetails);
      });
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

    function sendIsolatedCommandToAllFrames(tabId, command, callback, boundContext) {
      function executeCommand(done) {
        executeScriptInBoundContext(tabId, {
          target: { tabId: tabId, allFrames: true },
          world: "ISOLATED",
          func: function (cmd) {
            if (window.__WinSpeedBallLoadedVersion === "2026-07-11-sdk-lifecycle-v2" && window.winSpeedBall && window.winSpeedBall.handleCommand) {
              return window.winSpeedBall.handleCommand(cmd);
            }
            return { ok: false, error: "content script not loaded", url: location.href, mediaCount: 0, applied: 0 };
          },
          args: [command]
        }, boundContext, done);
      }

      try {
        executeCommand(function (results, contextFailure) {
          if (contextFailure) {
            callback(contextFailure);
            return;
          }
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

          executeScriptInBoundContext(tabId, {
            target: { tabId: tabId, allFrames: true },
            files: ["content/shadow-hook.js"],
            world: "MAIN"
          }, boundContext, function (shadowResults, shadowContextFailure) {
            if (shadowContextFailure) {
              callback(shadowContextFailure);
              return;
            }
            lastErrorMessage();
            executeScriptInBoundContext(tabId, {
              target: { tabId: tabId, allFrames: true },
              files: ["content/player-adapters.js", "content/index.js"]
            }, boundContext, function (injectResults, injectContextFailure) {
              if (injectContextFailure) {
                callback(injectContextFailure);
                return;
              }
              var injectError = lastErrorMessage();
              if (injectError) {
                callback({ ok: false, error: injectError, mediaCount: 0, applied: 0, frameResults: [] });
                return;
              }
              executeCommand(function (retryResults, retryContextFailure) {
                if (retryContextFailure) {
                  callback(retryContextFailure);
                  return;
                }
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

    function sendMainWorldCommandToAllFrames(tabId, command, callback, boundContext) {
      function executeCommand(done) {
        executeScriptInBoundContext(tabId, {
          target: { tabId: tabId, allFrames: true },
          world: "MAIN",
          func: function (cmd) {
            if (window.WinSpeedBallMediaCoreV7 && typeof window.WinSpeedBallMediaCoreV7.handleCommand === "function") {
              return window.WinSpeedBallMediaCoreV7.handleCommand(cmd);
            }
            return { ok: false, error: "main media core upgrade required", url: location.href, mediaCount: 0, applied: 0 };
          },
          args: [command]
        }, boundContext, done);
      }

      function finish(results, contextFailure) {
        if (contextFailure) {
          callback(contextFailure);
          return;
        }
        var error = lastErrorMessage();
        if (error) {
          callback(Object.assign({ ok: false, error: error, mediaCount: 0, applied: 0, frameCount: 0, frameResults: [] }, getState()));
          return;
        }
        callback(aggregateFrameResults(results || [], command));
      }

      try {
        executeCommand(function (results, contextFailure) {
          if (contextFailure) {
            callback(contextFailure);
            return;
          }
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
          executeScriptInBoundContext(tabId, {
            target: { tabId: tabId, allFrames: true },
            world: "MAIN",
            func: function () {
              var legacy = window.WinSpeedBallMediaCoreV6 || window.WinSpeedBallMediaCoreV5 || window.WinSpeedBallMediaCoreV4 || window.WinSpeedBallMediaCoreV3 || window.WinSpeedBallMediaCore;
              if (!window.WinSpeedBallMediaCoreV7 && legacy && typeof legacy.handleCommand === "function") {
                try { legacy.handleCommand({ type: "STOP_LOCK" }); } catch (error) {}
              }
              return true;
            }
          }, boundContext, function (legacyResults, legacyContextFailure) {
            if (legacyContextFailure) {
              callback(legacyContextFailure);
              return;
            }
            lastErrorMessage();
            executeScriptInBoundContext(tabId, {
              target: { tabId: tabId, allFrames: true },
              world: "MAIN",
              files: ["content/shadow-hook.js", "content/media-core-main.js"]
            }, boundContext, function (injectResults, injectContextFailure) {
              if (injectContextFailure) {
                callback(injectContextFailure);
                return;
              }
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

    function sendCommandToAllFrames(tabId, command, callback, boundContext) {
      if (command && command.type === "EXTRACT_PAGE_TEXT") {
        sendIsolatedCommandToAllFrames(tabId, command, callback, boundContext);
        return;
      }
      sendMainWorldCommandToAllFrames(tabId, command, callback, boundContext);
    }

    function controlTab(tabId, command, callback, boundContext) {
      command = command || { type: "GET_STATUS" };
      var rateCommand = ["SET_RATE", "STEP_UP", "STEP_DOWN"].indexOf(command.type) >= 0;
      if (!rateCommand) {
        sendCommandToAllFrames(tabId, command, callback, boundContext);
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
            if (verified && verified.code === "SDK_CONTEXT_CHANGED") {
              callback(verified);
              return;
            }
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
          }, boundContext);
        }, 700);
      }, boundContext);
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
