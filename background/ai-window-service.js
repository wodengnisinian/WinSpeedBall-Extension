(function (global) {
  "use strict";

  function create(options) {
    options = options || {};
    var storageKey = String(options.storageKey || "aiReplyWindowPayload");
    var bounds = Object.freeze({
      width: Math.max(1, Math.round(Number(options.bounds && options.bounds.width) || 280)),
      height: Math.max(1, Math.round(Number(options.bounds && options.bounds.height) || 180))
    });
    var replyWindowId = null;
    var recoveredWindowId = null;
    var queue = Promise.resolve();
    var hydration = null;
    var resizeTimer = null;
    var pendingResize = null;

    function lastErrorMessage() {
      return chrome.runtime.lastError ? chrome.runtime.lastError.message : "";
    }

    function replyUrl() {
      return chrome.runtime.getURL("ai_reply.html");
    }

    function isReplyWindow(windowInfo) {
      return !!(windowInfo && windowInfo.type === "popup" && Array.isArray(windowInfo.tabs) && windowInfo.tabs.some(function (tab) {
        return String(tab && tab.url || "") === replyUrl();
      }));
    }

    function getWindow(windowId) {
      return new Promise(function (resolve) {
        if (!Number.isInteger(windowId) || windowId < 0) { resolve(null); return; }
        try {
          chrome.windows.get(windowId, { populate: true }, function (windowInfo) {
            var error = lastErrorMessage();
            resolve(error || !isReplyWindow(windowInfo) ? null : windowInfo);
          });
        } catch (error) { resolve(null); }
      });
    }

    function firstValidWindow(windowIds) {
      return (windowIds || []).reduce(function (chain, windowId) {
        return chain.then(function (found) { return found || getWindow(windowId); });
      }, Promise.resolve(null));
    }

    function findUsingContexts() {
      if (!chrome.runtime || typeof chrome.runtime.getContexts !== "function") return Promise.resolve(null);
      try {
        return Promise.resolve(chrome.runtime.getContexts({ documentUrls: [replyUrl()] })).then(function (contexts) {
          var ids = (contexts || []).map(function (context) { return context.windowId; }).filter(function (windowId, index, list) {
            return Number.isInteger(windowId) && windowId >= 0 && list.indexOf(windowId) === index;
          });
          return firstValidWindow(ids);
        }).catch(function () { return null; });
      } catch (error) { return Promise.resolve(null); }
    }

    function findUsingWindowList() {
      if (!chrome.windows || typeof chrome.windows.getAll !== "function") return Promise.resolve(null);
      return new Promise(function (resolve) {
        try {
          chrome.windows.getAll({ populate: true, windowTypes: ["popup"] }, function (windows) {
            var error = lastErrorMessage();
            resolve(error ? null : (windows || []).find(isReplyWindow) || null);
          });
        } catch (error) { resolve(null); }
      });
    }

    function findExistingWindow() {
      return findUsingContexts().then(function (windowInfo) {
        return windowInfo || findUsingWindowList();
      });
    }

    function hydrate() {
      if (replyWindowId != null) return Promise.resolve({ ok: true, active: true, windowId: replyWindowId });
      if (hydration) return hydration;
      hydration = findExistingWindow().then(function (windowInfo) {
        if (windowInfo) {
          replyWindowId = windowInfo.id;
          recoveredWindowId = windowInfo.id;
        }
        return { ok: true, active: !!windowInfo, windowId: windowInfo ? windowInfo.id : null };
      }).catch(function () {
        return { ok: true, active: false, windowId: null };
      }).then(function (result) {
        hydration = null;
        return result;
      });
      return hydration;
    }

    function savePayload(request) {
      return new Promise(function (resolve, reject) {
        var payload = {};
        payload[storageKey] = {
          content: String(request && request.content || ""),
          updatedAt: Date.now()
        };
        try {
          chrome.storage.session.set(payload, function () {
            var error = lastErrorMessage();
            if (error) reject(new Error(error));
            else resolve();
          });
        } catch (error) { reject(error); }
      });
    }

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function resolvePosition(request) {
      request = request || {};
      var hasSourceBounds = [request.windowLeft, request.windowTop, request.windowWidth, request.windowHeight].every(Number.isFinite);
      if (hasSourceBounds) {
        var left = request.windowLeft + (request.windowWidth - bounds.width) / 2;
        var top = request.windowTop + request.windowHeight + 8;
        var hasScreenBounds = [request.screenLeft, request.screenTop, request.screenWidth, request.screenHeight].every(Number.isFinite);
        if (hasScreenBounds && request.screenWidth > 0 && request.screenHeight > 0) {
          var screenRight = request.screenLeft + request.screenWidth;
          var screenBottom = request.screenTop + request.screenHeight;
          left = clamp(left, request.screenLeft, Math.max(request.screenLeft, screenRight - bounds.width));
          if (top + bounds.height > screenBottom) top = request.windowTop - bounds.height - 8;
          top = clamp(top, request.screenTop, Math.max(request.screenTop, screenBottom - bounds.height));
        }
        return Promise.resolve({ left: Math.round(left), top: Math.round(top) });
      }
      return new Promise(function (resolve) {
        chrome.windows.getLastFocused({ populate: false }, function (browserWindow) {
          var error = lastErrorMessage();
          if (error || !browserWindow) { resolve({ left: 40, top: 80 }); return; }
          if (browserWindow.id === replyWindowId) {
            resolve({ left: Math.round(Number(browserWindow.left || 40)), top: Math.round(Number(browserWindow.top || 80)) });
            return;
          }
          resolve({
            left: Math.round(Number(browserWindow.left || 0) + Math.max(16, Number(browserWindow.width || bounds.width) - bounds.width - 20)),
            top: Math.round(Number(browserWindow.top || 0) + 80)
          });
        });
      });
    }

    function createWindow(windowBounds) {
      return new Promise(function (resolve) {
        chrome.windows.create(Object.assign({
          url: replyUrl(),
          type: "popup"
        }, windowBounds), function (created) {
          var error = lastErrorMessage();
          if (error || !created || created.id == null) {
            resolve({ ok: false, error: error || "Could not create AI reply window." });
            return;
          }
          replyWindowId = created.id;
          resolve({ ok: true, windowId: created.id, reused: false, recovered: false });
        });
      });
    }

    function focusWindow(windowInfo, windowBounds, recovered) {
      return new Promise(function (resolve) {
        chrome.windows.update(windowInfo.id, windowBounds, function (updated) {
          var error = lastErrorMessage();
          if (error || !updated) { resolve(null); return; }
          replyWindowId = windowInfo.id;
          resolve({ ok: true, windowId: windowInfo.id, reused: true, recovered: recovered === true });
        });
      });
    }

    function createOrReuse(position) {
      var windowBounds = {
        focused: true,
        left: position.left,
        top: position.top,
        width: bounds.width,
        height: bounds.height
      };
      var knownId = replyWindowId;
      var existing = knownId == null ? Promise.resolve(null) : getWindow(knownId);
      return existing.then(function (windowInfo) {
        if (windowInfo) {
          var wasRecovered = recoveredWindowId === windowInfo.id;
          recoveredWindowId = null;
          return focusWindow(windowInfo, windowBounds, wasRecovered);
        }
        if (knownId != null && replyWindowId === knownId) replyWindowId = null;
        return findExistingWindow().then(function (recoveredWindow) {
          if (!recoveredWindow) return null;
          return focusWindow(recoveredWindow, windowBounds, true);
        });
      }).then(function (result) {
        if (result) return result;
        return createWindow(windowBounds);
      });
    }

    function show(request, callback) {
      callback = typeof callback === "function" ? callback : function () {};
      var task = queue.catch(function () {}).then(hydrate).then(function () { return savePayload(request || {}); }).then(function () {
        return resolvePosition(request || {});
      }).then(createOrReuse);
      queue = task;
      task.then(callback).catch(function (error) {
        callback({ ok: false, error: error && error.message || String(error || "Could not display AI reply.") });
      });
      return task;
    }

    function handleRemoved(windowId) {
      if (windowId === replyWindowId) replyWindowId = null;
      if (windowId === recoveredWindowId) recoveredWindowId = null;
    }

    function handleBoundsChanged(windowInfo) {
      if (!windowInfo || windowInfo.id !== replyWindowId) return;
      if (windowInfo.width === bounds.width && windowInfo.height === bounds.height) return;
      pendingResize = windowInfo;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        resizeTimer = null;
        var pending = pendingResize;
        pendingResize = null;
        if (!pending || pending.id !== replyWindowId) return;
        chrome.windows.update(pending.id, { width: bounds.width, height: bounds.height }, function () { lastErrorMessage(); });
      }, 120);
    }

    return Object.freeze({
      show: show,
      hydrate: hydrate,
      getBounds: function () { return { width: bounds.width, height: bounds.height }; },
      getWindowId: function () { return replyWindowId; },
      handleRemoved: handleRemoved,
      handleBoundsChanged: handleBoundsChanged
    });
  }

  global.WinSpeedBallAiWindowService = { create: create };
})(self);
