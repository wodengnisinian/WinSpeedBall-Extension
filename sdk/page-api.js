(function (global) {
  "use strict";
  var utils = global.WinSpeedBallSdkApiUtils;

  function create(invoke) {
    utils.requireInvoke(invoke);
    return Object.freeze({
      info: function () { return utils.call(invoke, "page.info", []); },
      text: function () { return utils.call(invoke, "page.text", []); },
      title: function () { return utils.call(invoke, "page.title", []); },
      url: function () { return utils.call(invoke, "page.url", []); }
    });
  }

  global.WinSpeedBallSdkPageApi = Object.freeze({ create: create });
})(self);
