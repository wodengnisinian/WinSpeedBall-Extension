(function (global) {
  "use strict";
  var utils = global.WinSpeedBallSdkApiUtils;
  var MODES = ["book", "image", "chaoxing"];
  var MAX_INTERVAL_SECONDS = 240;

  function mode(value, fallback) {
    if (value == null || value === "") return fallback;
    value = String(value).trim().toLowerCase();
    if (MODES.indexOf(value) < 0) throw utils.invalid("Book mode must be book, image, or chaoxing.");
    return value;
  }

  function intervalSeconds(value, selectedMode) {
    var minimum = selectedMode === "chaoxing" ? 2 : 30;
    return utils.requireNumber(value, "Book interval", minimum, MAX_INTERVAL_SECONDS);
  }

  function create(invoke, defaultMode) {
    utils.requireInvoke(invoke);
    var authorizedMode = mode(defaultMode, "book");
    function status(selectedMode) {
      return utils.call(invoke, "book.getStatus", selectedMode == null || selectedMode === "" ? [] : [mode(selectedMode, authorizedMode)]);
    }
    function prev(selectedMode) { return utils.call(invoke, "book.turnPrev", [mode(selectedMode, authorizedMode)]); }
    function next(selectedMode) { return utils.call(invoke, "book.turnNext", [mode(selectedMode, authorizedMode)]); }
    function start(options) {
      if (options == null) options = {};
      if (!options || typeof options !== "object" || Array.isArray(options)) {
        throw utils.invalid("Book start options must be an object.");
      }
      var keys = Object.keys(options);
      if (keys.some(function (key) { return ["mode", "intervalSeconds"].indexOf(key) < 0; })) {
        throw utils.invalid("Book start options contain an unsupported field.");
      }
      var selectedMode = mode(options.mode, authorizedMode);
      var seconds = options.intervalSeconds == null
        ? (selectedMode === "chaoxing" ? 2 : 30)
        : intervalSeconds(options.intervalSeconds, selectedMode);
      return utils.call(invoke, "book.startAuto", [{ mode: selectedMode, intervalSeconds: seconds }]);
    }
    function stop() { return utils.call(invoke, "book.stopAuto", []); }
    function interval(value, selectedMode) {
      selectedMode = mode(selectedMode, authorizedMode);
      return utils.call(invoke, "book.setInterval", [intervalSeconds(value, selectedMode), selectedMode]);
    }
    return Object.freeze({
      status: status,
      prev: prev,
      next: next,
      start: start,
      stop: stop,
      interval: interval,
      getStatus: status,
      turnPrev: prev,
      turnNext: next,
      startAuto: start,
      stopAuto: stop,
      setInterval: interval
    });
  }

  global.WinSpeedBallSdkBookApi = Object.freeze({ create: create });
})(self);
