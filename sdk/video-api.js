(function (global) {
  "use strict";
  var utils = global.WinSpeedBallSdkApiUtils;

  function create(invoke) {
    utils.requireInvoke(invoke);
    return Object.freeze({
      getAll: function () { return utils.call(invoke, "video.getAll", []); },
      current: function () { return utils.call(invoke, "video.current", []); },
      getStatus: function () { return utils.call(invoke, "video.getStatus", []); },
      setRate: function (rate) { return utils.call(invoke, "video.setRate", [utils.requireNumber(rate, "Playback rate", 0.25, 16)]); },
      setVolume: function (volume) { return utils.call(invoke, "video.setVolume", [utils.requireNumber(volume, "Volume", 0, 1)]); },
      mute: function (muted) {
        if (muted == null) muted = true;
        if (typeof muted !== "boolean") throw utils.invalid("Muted state must be a boolean.");
        return utils.call(invoke, "video.mute", [muted]);
      },
      play: function () { return utils.call(invoke, "video.play", []); },
      pause: function () { return utils.call(invoke, "video.pause", []); }
    });
  }

  global.WinSpeedBallSdkVideoApi = Object.freeze({ create: create });
})(self);
