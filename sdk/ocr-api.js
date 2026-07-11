(function (global) {
  "use strict";
  var utils = global.WinSpeedBallSdkApiUtils;

  function create(invoke) {
    utils.requireInvoke(invoke);
    return Object.freeze({
      latest: function () { return utils.call(invoke, "ocr.latest", []); },
      capture: function () { return utils.call(invoke, "ocr.capture", []); },
      recognize: function (input) {
        if (input == null) throw utils.invalid("OCR input is required.");
        return utils.call(invoke, "ocr.recognize", [input]);
      }
    });
  }

  global.WinSpeedBallSdkOcrApi = Object.freeze({ create: create });
})(self);
