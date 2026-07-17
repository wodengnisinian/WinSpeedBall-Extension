(function (global) {
  "use strict";
  var utils = global.WinSpeedBallSdkApiUtils;

  function create(invoke) {
    utils.requireInvoke(invoke);
    function all() { return utils.call(invoke, "video.getAll", []); }
    function current() { return utils.call(invoke, "video.current", []); }
    function status() { return utils.call(invoke, "video.getStatus", []); }
    function rate(value) { return utils.call(invoke, "video.setRate", [utils.requireNumber(value, "Playback rate", 0.25, 16)]); }
    function volume(value) { return utils.call(invoke, "video.setVolume", [utils.requireNumber(value, "Volume", 0, 1)]); }
    return Object.freeze({
      all: all,
      current: current,
      status: status,
      rate: rate,
      volume: volume,
      mute: function (muted) {
        if (muted == null) muted = true;
        if (typeof muted !== "boolean") throw utils.invalid("Muted state must be a boolean.");
        return utils.call(invoke, "video.mute", [muted]);
      },
      play: function () { return utils.call(invoke, "video.play", []); },
      pause: function () { return utils.call(invoke, "video.pause", []); },
      getAll: all,
      getStatus: status,
      setRate: rate,
      setVolume: volume
    });
  }

  global.WinSpeedBallSdkVideoApi = Object.freeze({ create: create });
})(self);
