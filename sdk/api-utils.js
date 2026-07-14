(function (global) {
  "use strict";

  function invalid(message) {
    var error = new TypeError(message || "SDK argument is invalid.");
    error.code = "SDK_INVALID_ARGUMENT";
    return error;
  }

  function requireInvoke(invoke) {
    if (typeof invoke !== "function") throw invalid("SDK invoke transport is required.");
    return invoke;
  }

  function call(invoke, method, args) {
    try { return Promise.resolve(requireInvoke(invoke)(method, args || [])); }
    catch (error) { return Promise.reject(error); }
  }

  function requireString(value, name, maxLength, allowEmpty) {
    if (typeof value !== "string") throw invalid(name + " must be a string.");
    var normalized = value.trim();
    if (!allowEmpty && !normalized) throw invalid(name + " cannot be empty.");
    if (value.length > maxLength) throw invalid(name + " is too large.");
    return value;
  }

  function requireNumber(value, name, min, max) {
    if (!Number.isFinite(value) || value < min || value > max) throw invalid(name + " is outside the supported range.");
    return value;
  }

  function requireStorageKey(value) {
    value = requireString(value, "Storage key", 128, false);
    if (!/^[A-Za-z0-9._-]+$/.test(value) || ["__proto__", "prototype", "constructor"].indexOf(value) >= 0) {
      throw invalid("Storage key is not allowed.");
    }
    return value;
  }

  global.WinSpeedBallSdkApiUtils = Object.freeze({
    invalid: invalid,
    call: call,
    requireInvoke: requireInvoke,
    requireString: requireString,
    requireNumber: requireNumber,
    requireStorageKey: requireStorageKey
  });
})(self);
