(function (global) {
  "use strict";

  function asPromiseApi(api) {
    var originals = [];
    var wrappers = [];
    var result = {};

    Object.keys(api).forEach(function (name) {
      var method = api[name];
      if (typeof method !== "function") {
        result[name] = method;
        return;
      }

      var index = originals.indexOf(method);
      if (index < 0) {
        originals.push(method);
        wrappers.push(function () {
          try {
            return Promise.resolve(method.apply(api, arguments));
          } catch (error) {
            return Promise.reject(error);
          }
        });
        index = wrappers.length - 1;
      }
      result[name] = wrappers[index];
    });

    return Object.freeze(result);
  }

  function create(options) {
    options = options || {};
    var runtime = {
      version: global.WinSpeedBallSdkContracts.SDK_VERSION,
      video: asPromiseApi(global.WinSpeedBallSdkVideoApi.create(options.invoke)),
      ocr: asPromiseApi(global.WinSpeedBallSdkOcrApi.create(options.invoke)),
      qa: asPromiseApi(global.WinSpeedBallSdkQaApi.create(options.invoke)),
      ai: asPromiseApi(global.WinSpeedBallSdkAiApi.create(options.invoke)),
      page: asPromiseApi(global.WinSpeedBallSdkPageApi.create(options.invoke)),
      book: asPromiseApi(global.WinSpeedBallSdkBookApi.create(options.invoke, options.bookMode)),
      event: global.WinSpeedBallSdkEventApi.create(options.subscribe),
      storage: asPromiseApi(global.WinSpeedBallSdkStorageApi.create(options.invoke))
    };
    return Object.freeze(runtime);
  }

  global.WinSpeedBallSdkRuntime = Object.freeze({ create: create });
})(self);
