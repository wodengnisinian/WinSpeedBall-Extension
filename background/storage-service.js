(function (global) {
  "use strict";

  var CAPTURE_DB_NAME = "winspeedball-captures";
  var CAPTURE_STORE_NAME = "captures";
  var CAPTURE_RECORD_ID = "latest";
  var logMutationQueue = Promise.resolve();

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

  function mutateLogs(mutator) {
    var operation = logMutationQueue.then(function () {
      return new Promise(function (resolve) {
        get(["popupLogs"], function (data) {
          var current = global.WinSpeedBallLogRecord.normalizeList(Array.isArray(data.popupLogs) ? data.popupLogs : [], 500);
          var next = global.WinSpeedBallLogRecord.normalizeList(mutator(current) || [], 500);
          set({ popupLogs: next }, function (result) {
            resolve(result && result.ok === false ? result : { ok: true, logs: next });
          });
        });
      });
    });
    logMutationQueue = operation.then(function () {}, function () {});
    return operation;
  }

  function appendLogRecord(record) {
    var entry = global.WinSpeedBallLogRecord.normalize(record);
    if (!entry) return Promise.resolve({ ok: false, error: "Log record is invalid." });
    return mutateLogs(function (logs) { return [entry].concat(logs); });
  }

  function appendLog(category, message, details, level) {
    return appendLogRecord(global.WinSpeedBallLogRecord.create(category, message, details, level));
  }

  function clearLogs() {
    return mutateLogs(function () { return []; });
  }

  function restrictAccess() {
    try {
      return Promise.resolve(chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })).catch(function (error) {
        appendLog("隐私", "敏感存储隔离失败", { 原因: error && error.message || String(error || "unknown") });
      });
    } catch (error) {
      appendLog("隐私", "敏感存储隔离失败", { 原因: error.message || String(error) });
      return Promise.resolve();
    }
  }

  function openCaptureDb() {
    return new Promise(function (resolve, reject) {
      var request;
      try {
        request = indexedDB.open(CAPTURE_DB_NAME, 1);
      } catch (error) {
        reject(error);
        return;
      }
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(CAPTURE_STORE_NAME)) db.createObjectStore(CAPTURE_STORE_NAME, { keyPath: "id" });
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error("Could not open capture database.")); };
    });
  }

  function saveCaptureRecord(dataUrl, sourceTime) {
    return openCaptureDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var transaction = db.transaction(CAPTURE_STORE_NAME, "readwrite");
        transaction.objectStore(CAPTURE_STORE_NAME).put({
          id: CAPTURE_RECORD_ID,
          sourceTime: sourceTime,
          dataUrl: dataUrl
        });
        transaction.oncomplete = function () { db.close(); resolve(); };
        transaction.onerror = function () {
          var error = transaction.error;
          db.close();
          reject(error || new Error("Could not save capture."));
        };
        transaction.onabort = transaction.onerror;
      });
    });
  }

  function getCaptureRecord() {
    return openCaptureDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var request = db.transaction(CAPTURE_STORE_NAME, "readonly").objectStore(CAPTURE_STORE_NAME).get(CAPTURE_RECORD_ID);
        request.onsuccess = function () {
          var result = request.result || null;
          db.close();
          resolve(result);
        };
        request.onerror = function () {
          var error = request.error;
          db.close();
          reject(error || new Error("Could not read capture."));
        };
      });
    });
  }

  function deleteCaptureRecord() {
    return openCaptureDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var transaction = db.transaction(CAPTURE_STORE_NAME, "readwrite");
        transaction.objectStore(CAPTURE_STORE_NAME).delete(CAPTURE_RECORD_ID);
        transaction.oncomplete = function () {
          db.close();
          remove(["manualCaptureDataUrl", "manualCaptureTime"], function (result) {
            if (result && result.ok === false) {
              reject(new Error(result.error || "Could not delete legacy capture."));
              return;
            }
            resolve();
          });
        };
        transaction.onerror = function () {
          var error = transaction.error;
          db.close();
          reject(error || new Error("Could not delete capture."));
        };
        transaction.onabort = transaction.onerror;
      });
    });
  }

  function getLatestCapture() {
    return getCaptureRecord().then(function (record) {
      if (record && record.dataUrl) return record;
      return new Promise(function (resolve) {
        get(["manualCaptureDataUrl", "manualCaptureTime"], function (data) {
          if (!data.manualCaptureDataUrl) {
            resolve(null);
            return;
          }
          var migrated = {
            id: CAPTURE_RECORD_ID,
            sourceTime: Number(data.manualCaptureTime || Date.now()),
            dataUrl: data.manualCaptureDataUrl
          };
          saveCaptureRecord(migrated.dataUrl, migrated.sourceTime).then(function () {
            remove(["manualCaptureDataUrl"]);
            resolve(migrated);
          }).catch(function () {
            resolve(migrated);
          });
        });
      });
    });
  }

  global.WinSpeedBallStorageService = {
    get: get,
    set: set,
    remove: remove,
    appendLog: appendLog,
    appendLogRecord: appendLogRecord,
    clearLogs: clearLogs,
    restrictAccess: restrictAccess,
    saveCaptureRecord: saveCaptureRecord,
    getLatestCapture: getLatestCapture,
    deleteCaptureRecord: deleteCaptureRecord
  };
})(self);
