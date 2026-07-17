(function (global) {
  "use strict";

  function create(options) {
    options = options || {};
    var runtime = {
      version: global.WinSpeedBallSdkContracts.SDK_VERSION,
      video: global.WinSpeedBallSdkVideoApi.create(options.invoke),
      ocr: global.WinSpeedBallSdkOcrApi.create(options.invoke),
      qa: global.WinSpeedBallSdkQaApi.create(options.invoke),
      ai: global.WinSpeedBallSdkAiApi.create(options.invoke),
      page: global.WinSpeedBallSdkPageApi.create(options.invoke),
      book: global.WinSpeedBallSdkBookApi.create(options.invoke),
      event: global.WinSpeedBallSdkEventApi.create(options.subscribe),
      storage: global.WinSpeedBallSdkStorageApi.create(options.invoke)
    };
    return Object.freeze(runtime);
  }

  global.WinSpeedBallSdkRuntime = Object.freeze({ create: create });
})(self);
