(function (global) {
  "use strict";
  var utils = global.WinSpeedBallSdkApiUtils;

  function create(invoke) {
    utils.requireInvoke(invoke);
    return Object.freeze({
      latest: function () { return utils.call(invoke, "qa.latest", []); },
      ocr: function () { return utils.call(invoke, "qa.ocr", []); },
      voice: function () { return utils.call(invoke, "qa.voice", []); }
    });
  }

  global.WinSpeedBallSdkQaApi = Object.freeze({ create: create });
})(self);
