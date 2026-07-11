(function (global) {
  "use strict";
  var utils = global.WinSpeedBallSdkApiUtils;

  function create(invoke) {
    utils.requireInvoke(invoke);
    return Object.freeze({
      get: function (key) { return utils.call(invoke, "storage.get", [utils.requireStorageKey(key)]); },
      set: function (key, value) {
        var serialized;
        try { serialized = JSON.stringify(value); }
        catch (error) { throw utils.invalid("Storage value must be serializable."); }
        if (serialized === undefined) throw utils.invalid("Storage value must be serializable.");
        if (serialized.length > 65536) throw utils.invalid("Storage value is too large.");
        return utils.call(invoke, "storage.set", [utils.requireStorageKey(key), value]);
      }
    });
  }

  global.WinSpeedBallSdkStorageApi = Object.freeze({ create: create });
})(self);
