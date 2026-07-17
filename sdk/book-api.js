(function (global) {
  "use strict";
  var utils = global.WinSpeedBallSdkApiUtils;

  function create(invoke) {
    utils.requireInvoke(invoke);
    function status() { return utils.call(invoke, "book.getStatus", []); }
    return Object.freeze({
      status: status,
      getStatus: status
    });
  }

  global.WinSpeedBallSdkBookApi = Object.freeze({ create: create });
})(self);
