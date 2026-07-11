(function (global) {
  "use strict";

  var SESSION_KEY = "pinnedPopupWindowId";

  function lastErrorMessage() {
    return chrome.runtime.lastError ? chrome.runtime.lastError.message : "";
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

  function clearStoredWindowId(callback) {
    try {
      chrome.storage.session.remove([SESSION_KEY], function () {
        lastErrorMessage();
        if (typeof callback === "function") callback();
      });
    } catch (error) { if (typeof callback === "function") callback(); }
  }

  function createPinnedWindow(callback) {
    chrome.windows.create({
      url: chrome.runtime.getURL("popup.html?pinned=1"),
      type: "popup",
      focused: true,
      width: 400,
      height: 420
    }, function (created) {
      var error = lastErrorMessage();
      if (error || !created || created.id == null) {
        callback({ ok: false, error: error || "Could not create pinned window." });
        return;
      }
      setStoredWindowId(created.id, function (stored) {
        callback(stored.ok === false ? stored : { ok: true, pinned: true, reused: false, windowId: created.id });
      });
    });
  }

  function openPinnedWindow() {
    return new Promise(function (resolve) {
      getStoredWindowId(function (windowId) {
        if (!Number.isInteger(windowId) || windowId < 0) {
          createPinnedWindow(resolve);
          return;
        }
        chrome.windows.get(windowId, function (existing) {
          var error = lastErrorMessage();
          if (error || !existing) {
            clearStoredWindowId(function () { createPinnedWindow(resolve); });
            return;
          }
          chrome.windows.update(windowId, { focused: true }, function () {
            var updateError = lastErrorMessage();
            resolve(updateError
              ? { ok: false, error: updateError }
              : { ok: true, pinned: true, reused: true, windowId: windowId });
          });
        });
      });
    });
  }

  try {
    chrome.windows.onRemoved.addListener(function (windowId) {
      getStoredWindowId(function (storedId) {
        if (storedId === windowId) clearStoredWindowId();
      });
    });
  } catch (error) {}

  global.WinSpeedBallWindowService = {
    openPinnedWindow: openPinnedWindow
  };
})(self);
