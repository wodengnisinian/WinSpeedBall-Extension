(function (global) {
  "use strict";

  function lastErrorMessage() {
    return chrome.runtime.lastError ? chrome.runtime.lastError.message : "";
  }

  function get(keys, callback) {
    try {
      chrome.storage.local.get(keys, function (data) {
        var error = lastErrorMessage();
        callback(error ? {} : data || {});
      });
    } catch (error) {
      callback({});
    }
  }

  function set(data, callback) {
    callback = typeof callback === "function" ? callback : function () {};
    try {
      chrome.storage.local.set(data, function () {
        var error = lastErrorMessage();
        callback(error ? { ok: false, error: error } : { ok: true });
      });
    } catch (error) {
      callback({ ok: false, error: error.message || String(error) });
    }
  }

  function remove(keys, callback) {
    callback = typeof callback === "function" ? callback : function () {};
    try {
      chrome.storage.local.remove(keys, function () {
        var error = lastErrorMessage();
        callback(error ? { ok: false, error: error } : { ok: true });
      });
    } catch (error) {
      callback({ ok: false, error: error.message || String(error) });
    }
  }

  global.WinSpeedBallPopupStorage = {
    get: get,
    set: set,
    remove: remove
  };
})(self);
