(function (global) {
  "use strict";

  var STORAGE_KEY = "sdkScriptStorage";
  var MAX_KEYS = 100;
  var MAX_VALUE_BYTES = 64 * 1024;
  var MAX_SCRIPT_BYTES = 256 * 1024;
  var storage = global.WinSpeedBallStorageService;
  var mutationQueue = Promise.resolve();

  function enqueueMutation(task) {
    var result = mutationQueue.then(task, task);
    mutationQueue = result.then(function () {}, function () {});
    return result;
  }

  function utf8ByteLength(value) {
    value = String(value || "");
    if (typeof global.TextEncoder === "function") return new global.TextEncoder().encode(value).byteLength;
    var bytes = 0;
    for (var index = 0; index < value.length; index += 1) {
      var code = value.charCodeAt(index);
      if (code <= 0x7f) bytes += 1;
      else if (code <= 0x7ff) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    }
    return bytes;
  }

  function validScriptId(value) {
    return typeof value === "string" &&
      /^[A-Za-z0-9_-]{1,64}$/.test(value) &&
      ["__proto__", "prototype", "constructor"].indexOf(value) < 0;
  }

  function validKey(value) {
    return typeof value === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(value) && ["__proto__", "prototype", "constructor"].indexOf(value) < 0;
  }

  function readAll() {
    return new Promise(function (resolve) {
      storage.get([STORAGE_KEY], function (data) {
        var value = data && data[STORAGE_KEY];
        resolve(value && typeof value === "object" && !Array.isArray(value) ? value : {});
      });
    });
  }

  function writeAll(value) {
    return new Promise(function (resolve) {
      var data = {};
      data[STORAGE_KEY] = value;
      storage.set(data, resolve);
    });
  }

  function cloneValue(value) {
    var serialized;
    try { serialized = JSON.stringify(value); }
    catch (error) { return { ok: false, code: "SDK_INVALID_ARGUMENT", error: "Storage value must be serializable." }; }
    if (serialized === undefined) return { ok: false, code: "SDK_INVALID_ARGUMENT", error: "Storage value must be serializable." };
    if (utf8ByteLength(serialized) > MAX_VALUE_BYTES) return { ok: false, code: "SDK_QUOTA_EXCEEDED", error: "Storage value exceeds 64 KB." };
    return { ok: true, serialized: serialized, value: JSON.parse(serialized) };
  }

  function get(scriptId, key) {
    if (!validScriptId(scriptId) || !validKey(key)) return Promise.resolve({ ok: false, code: "SDK_INVALID_ARGUMENT", error: "Storage script or key is invalid." });
    return readAll().then(function (all) {
      var namespace = all[scriptId];
      var found = !!(namespace && Object.prototype.hasOwnProperty.call(namespace, key));
      return { ok: true, found: found, value: found ? namespace[key] : null };
    });
  }

  function set(scriptId, key, value) {
    if (!validScriptId(scriptId) || !validKey(key)) return Promise.resolve({ ok: false, code: "SDK_INVALID_ARGUMENT", error: "Storage script or key is invalid." });
    var cloned = cloneValue(value);
    if (!cloned.ok) return Promise.resolve(cloned);
    return enqueueMutation(function () { return readAll().then(function (all) {
      var namespace = Object.assign({}, all[scriptId] || {});
      if (!Object.prototype.hasOwnProperty.call(namespace, key) && Object.keys(namespace).length >= MAX_KEYS) {
        return { ok: false, code: "SDK_QUOTA_EXCEEDED", error: "Script storage is limited to 100 keys." };
      }
      namespace[key] = cloned.value;
      var namespaceSize = utf8ByteLength(JSON.stringify(namespace));
      if (namespaceSize > MAX_SCRIPT_BYTES) return { ok: false, code: "SDK_QUOTA_EXCEEDED", error: "Script storage exceeds 256 KB." };
      var next = Object.assign({}, all);
      next[scriptId] = namespace;
      return writeAll(next).then(function (saved) {
        return saved && saved.ok === false ? saved : { ok: true, key: key, bytesUsed: namespaceSize };
      });
    }); });
  }

  function clearScript(scriptId) {
    if (!validScriptId(scriptId)) return Promise.resolve({ ok: false, code: "SDK_INVALID_ARGUMENT", error: "Storage script is invalid." });
    return enqueueMutation(function () { return readAll().then(function (all) {
      var next = Object.assign({}, all);
      delete next[scriptId];
      return writeAll(next).then(function (saved) { return saved && saved.ok === false ? saved : { ok: true }; });
    }); });
  }

  function getSummary() {
    return readAll().then(function (all) {
      return {
        ok: true,
        scripts: Object.keys(all).length,
        keys: Object.keys(all).reduce(function (total, scriptId) { return total + Object.keys(all[scriptId] || {}).length; }, 0),
        bytes: utf8ByteLength(JSON.stringify(all))
      };
    });
  }

  global.WinSpeedBallSdkStorageService = Object.freeze({
    get: get,
    set: set,
    clearScript: clearScript,
    getSummary: getSummary,
    validScriptId: validScriptId,
    validKey: validKey,
    utf8ByteLength: utf8ByteLength
  });
})(self);
