(function (global) {
  "use strict";

  var SESSION_KEY = "pinnedPopupWindowId";
  var TEACHING_MODE_KEY = "pinnedPopupTeachingMode";
  var STATE_KEY = "pinnedPopupWindowState";
  var DEFAULT_BOUNDS = { width: 320, height: 340 };
  var TEACHING_BOUNDS = { width: 720, height: 600 };
  var openRequest = null;
  var teachingModeRequest = Promise.resolve();
  var boundsSaveTimer = null;
  var pendingBoundsWindow = null;

  function lastErrorMessage() {
    return chrome.runtime.lastError ? chrome.runtime.lastError.message : "";
  }

  function popupUrl() {
    return chrome.runtime.getURL("popup/index.html?pinned=1");
  }

  function getStoredWindowId(callback) {
    try {
      chrome.storage.session.get([SESSION_KEY], function (data) {
        callback(lastErrorMessage() ? null : Number(data && data[SESSION_KEY]));
      });
    } catch (error) { callback(null); }
  }

  function setStoredWindowId(windowId, callback) {
    var data = {};
    data[SESSION_KEY] = windowId;
    try {
      chrome.storage.session.set(data, function () {
        var error = lastErrorMessage();
        callback(error ? { ok: false, error: error } : { ok: true });
      });
    } catch (error) { callback({ ok: false, error: error.message || String(error) }); }
  }

  function getStoredTeachingMode(callback) {
    try {
      chrome.storage.session.get([TEACHING_MODE_KEY], function (data) {
        callback(!lastErrorMessage() && !!(data && data[TEACHING_MODE_KEY]));
      });
    } catch (error) { callback(false); }
  }

  function setStoredTeachingMode(enabled, callback) {
    var data = {};
    data[TEACHING_MODE_KEY] = enabled === true;
    try {
      chrome.storage.session.set(data, function () {
        var error = lastErrorMessage();
        callback(error ? { ok: false, error: error } : { ok: true });
      });
    } catch (error) { callback({ ok: false, error: error.message || String(error) }); }
  }

  function clearStoredWindowId(callback) {
    try {
      chrome.storage.session.remove([SESSION_KEY, TEACHING_MODE_KEY], function () {
        lastErrorMessage();
        if (typeof callback === "function") callback();
      });
    } catch (error) { if (typeof callback === "function") callback(); }
  }

  function normalizeBounds(value) {
    value = value || {};
    var bounds = {
      width: DEFAULT_BOUNDS.width,
      height: DEFAULT_BOUNDS.height
    };
    if (Number.isFinite(value.left)) bounds.left = Math.round(value.left);
    if (Number.isFinite(value.top)) bounds.top = Math.round(value.top);
    return bounds;
  }

  function fixedBounds(teachingMode) {
    return teachingMode === true ? TEACHING_BOUNDS : DEFAULT_BOUNDS;
  }

  function getPersistentState(callback) {
    try {
      chrome.storage.local.get([STATE_KEY], function (data) {
        var stored = lastErrorMessage() ? {} : data && data[STATE_KEY] || {};
        callback(Object.assign({ open: false }, normalizeBounds(stored), {
          open: stored.open === true,
          updatedAt: Number(stored.updatedAt || 0),
          lastClosedAt: Number(stored.lastClosedAt || 0)
        }));
      });
    } catch (error) { callback(Object.assign({ open: false }, DEFAULT_BOUNDS)); }
  }

  function updatePersistentState(patch, callback) {
    getPersistentState(function (current) {
      var next = Object.assign({}, current, patch || {}, { updatedAt: Date.now() });
      var data = {};
      data[STATE_KEY] = next;
      try {
        chrome.storage.local.set(data, function () {
          var error = lastErrorMessage();
          if (typeof callback === "function") callback(error ? { ok: false, error: error } : { ok: true, state: next });
        });
      } catch (error) {
        if (typeof callback === "function") callback({ ok: false, error: error.message || String(error) });
      }
    });
  }

  function statePatchFromWindow(windowInfo, open) {
    var bounds = normalizeBounds(windowInfo);
    bounds.open = open === true;
    return bounds;
  }

  function saveWindowState(windowInfo, open, callback) {
    updatePersistentState(statePatchFromWindow(windowInfo, open), callback);
  }

  function createPinnedWindow(savedState, callback) {
    var bounds = normalizeBounds(savedState);
    chrome.windows.create(Object.assign({
      url: popupUrl(),
      type: "popup",
      focused: true
    }, bounds), function (created) {
      var error = lastErrorMessage();
      if (error || !created || created.id == null) {
        callback({ ok: false, error: error || "Could not create pinned window." });
        return;
      }
      setStoredWindowId(created.id, function (stored) {
        if (stored.ok === false) { callback(stored); return; }
        saveWindowState(created, true, function (saved) {
          callback(saved && saved.ok === false
            ? saved
            : { ok: true, pinned: true, reused: false, restored: !!(savedState && savedState.updatedAt), windowId: created.id, bounds: normalizeBounds(created) });
        });
      });
    });
  }

  function isPinnedWindow(windowInfo) {
    return !!(windowInfo && windowInfo.type === "popup" && Array.isArray(windowInfo.tabs) && windowInfo.tabs.some(function (tab) {
      return String(tab && tab.url || "") === popupUrl();
    }));
  }

  function findUsingWindowList(callback) {
    if (!chrome.windows || typeof chrome.windows.getAll !== "function") { callback(null); return; }
    try {
      chrome.windows.getAll({ populate: true, windowTypes: ["popup"] }, function (windows) {
        if (lastErrorMessage()) { callback(null); return; }
        callback((windows || []).find(isPinnedWindow) || null);
      });
    } catch (error) { callback(null); }
  }

  function findUsingExtensionContexts(callback) {
    if (!chrome.runtime || typeof chrome.runtime.getContexts !== "function") { callback(null); return; }
    chrome.runtime.getContexts({ documentUrls: [popupUrl()] }).then(function (contexts) {
      var windowIds = (contexts || []).map(function (context) { return context.windowId; }).filter(function (windowId, index, list) {
        return Number.isInteger(windowId) && windowId >= 0 && list.indexOf(windowId) === index;
      });
      return windowIds.reduce(function (chain, windowId) {
        return chain.then(function (found) {
          if (found) return found;
          return new Promise(function (resolve) {
            chrome.windows.get(windowId, function (windowInfo) {
              var error = lastErrorMessage();
              resolve(!error && windowInfo && windowInfo.type === "popup" && isPinnedWindow(windowInfo) ? windowInfo : null);
            });
          });
        });
      }, Promise.resolve(null));
    }).then(callback).catch(function () { callback(null); });
  }

  function findExistingPinnedWindow(callback) {
    findUsingExtensionContexts(function (existing) {
      if (existing) { callback(existing); return; }
      findUsingWindowList(callback);
    });
  }

  function restoreFixedBounds(windowInfo, focused, callback) {
    getStoredTeachingMode(function (teachingMode) {
      var bounds = fixedBounds(teachingMode);
      var patch = {
        width: bounds.width,
        height: bounds.height
      };
      if (focused === true) patch.focused = true;

      function applyBounds() {
        chrome.windows.update(windowInfo.id, patch, function (updated) {
          var error = lastErrorMessage();
          callback(error || !updated ? null : updated, error);
        });
      }

      if (windowInfo && windowInfo.state && windowInfo.state !== "normal") {
        chrome.windows.update(windowInfo.id, { state: "normal" }, function (normalized) {
          var error = lastErrorMessage();
          if (error || !normalized) { callback(null, error || "Could not restore pinned window state."); return; }
          applyBounds();
        });
        return;
      }
      applyBounds();
    });
  }

  function focusExistingWindow(windowInfo, recovered, callback) {
    restoreFixedBounds(windowInfo, true, function (updated, error) {
      if (error || !updated) { callback({ ok: false, error: error || "Could not focus pinned window." }); return; }
      setStoredWindowId(windowInfo.id, function (stored) {
        if (stored.ok === false) { callback(stored); return; }
        saveWindowState(updated, true, function (saved) {
          callback(saved && saved.ok === false
            ? saved
            : { ok: true, pinned: true, reused: true, recovered: recovered === true, windowId: windowInfo.id, bounds: normalizeBounds(updated) });
        });
      });
    });
  }

  function recoverOrCreate(callback) {
    findExistingPinnedWindow(function (existing) {
      if (existing) { focusExistingWindow(existing, true, callback); return; }
      getPersistentState(function (state) { createPinnedWindow(state, callback); });
    });
  }

  function openPinnedWindow() {
    if (openRequest) return openRequest;
    openRequest = new Promise(function (resolve) {
      getStoredWindowId(function (windowId) {
        if (!Number.isInteger(windowId) || windowId < 0) { recoverOrCreate(resolve); return; }
        chrome.windows.get(windowId, { populate: true }, function (existing) {
          var error = lastErrorMessage();
          if (error || !existing || !isPinnedWindow(existing)) {
            clearStoredWindowId(function () { recoverOrCreate(resolve); });
            return;
          }
          focusExistingWindow(existing, false, resolve);
        });
      });
    });
    openRequest.then(function () { openRequest = null; }, function () { openRequest = null; });
    return openRequest;
  }

  function setTeachingMode(enabled, preferredWindowId) {
    enabled = enabled === true;
    function applyTeachingMode() {
      return new Promise(function (resolve) {
      function resizeWindow(existing) {
        if (!existing || !isPinnedWindow(existing)) {
          resolve({ ok: true, active: false, teachingMode: enabled });
          return;
        }
        var windowId = existing.id;
        setStoredWindowId(windowId, function (windowStored) {
          if (windowStored.ok === false) { resolve(windowStored); return; }
          setStoredTeachingMode(enabled, function (stored) {
            if (stored.ok === false) { resolve(stored); return; }
            restoreFixedBounds(existing, false, function (updated, updateError) {
              if (updateError || !updated) {
                resolve({ ok: false, error: updateError || "Could not resize pinned window." });
                return;
              }
              var bounds = fixedBounds(enabled);
              resolve({
                ok: true,
                active: true,
                teachingMode: enabled,
                windowId: windowId,
                bounds: { width: bounds.width, height: bounds.height }
              });
            });
          });
        });
      }

      function recoverWindow() {
        findExistingPinnedWindow(function (existing) {
          resizeWindow(existing);
        });
      }

      function readWindow(windowId, fallback) {
        if (!Number.isInteger(windowId) || windowId < 0) {
          fallback();
          return;
        }
        chrome.windows.get(windowId, { populate: true }, function (existing) {
          var error = lastErrorMessage();
          if (error || !existing || !isPinnedWindow(existing)) {
            fallback();
            return;
          }
          resizeWindow(existing);
        });
      }

      var preferred = Number(preferredWindowId);
      if (Number.isInteger(preferred) && preferred >= 0) {
        readWindow(preferred, function () {
          getStoredWindowId(function (storedWindowId) {
            if (storedWindowId === preferred) {
              recoverWindow();
              return;
            }
            readWindow(storedWindowId, recoverWindow);
          });
        });
        return;
      }
      getStoredWindowId(function (storedWindowId) {
        readWindow(storedWindowId, recoverWindow);
      });
      });
    }
    var result = teachingModeRequest.then(applyTeachingMode, applyTeachingMode);
    teachingModeRequest = result.then(function () {}, function () {});
    return result;
  }

  function getState() {
    return new Promise(function (resolve) {
      Promise.all([
        new Promise(function (done) { getStoredWindowId(done); }),
        new Promise(function (done) { getPersistentState(done); })
      ]).then(function (values) {
        var windowId = values[0];
        var state = values[1];
        if (!Number.isInteger(windowId) || windowId < 0) {
          resolve({ ok: true, active: false, windowId: null, state: state });
          return;
        }
        chrome.windows.get(windowId, { populate: true }, function (existing) {
          var error = lastErrorMessage();
          var active = !error && !!existing && isPinnedWindow(existing);
          resolve({ ok: true, active: active, windowId: active ? windowId : null, state: state });
        });
      });
    });
  }

  try {
    chrome.windows.onBoundsChanged.addListener(function (windowInfo) {
      getStoredWindowId(function (storedId) {
        if (storedId !== windowInfo.id) return;
        pendingBoundsWindow = windowInfo;
        if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
        boundsSaveTimer = setTimeout(function () {
          boundsSaveTimer = null;
          var pending = pendingBoundsWindow;
          pendingBoundsWindow = null;
          if (!pending) return;
          getStoredTeachingMode(function (teachingMode) {
            var expected = fixedBounds(teachingMode);
            if (pending.width === expected.width && pending.height === expected.height) {
              saveWindowState(pending, true);
              return;
            }
            restoreFixedBounds(pending, false, function (updated, error) {
              var corrected = Object.assign({}, pending, error || !updated ? {} : updated, {
                left: pending.left,
                top: pending.top,
                width: DEFAULT_BOUNDS.width,
                height: DEFAULT_BOUNDS.height
              });
              saveWindowState(corrected, true);
            });
          });
        }, 250);
      });
    });
  } catch (error) {}

  try {
    chrome.windows.onRemoved.addListener(function (windowId) {
      getStoredWindowId(function (storedId) {
        if (storedId !== windowId) return;
        clearStoredWindowId(function () {
          updatePersistentState({ open: false, lastClosedAt: Date.now() });
        });
      });
    });
  } catch (error) {}

  global.WinSpeedBallWindowService = {
    openPinnedWindow: openPinnedWindow,
    setTeachingMode: setTeachingMode,
    getState: getState,
    normalizeBounds: normalizeBounds,
    defaultBounds: Object.freeze({ width: DEFAULT_BOUNDS.width, height: DEFAULT_BOUNDS.height }),
    teachingBounds: Object.freeze({ width: TEACHING_BOUNDS.width, height: TEACHING_BOUNDS.height })
  };
})(self);
