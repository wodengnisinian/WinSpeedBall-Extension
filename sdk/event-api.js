(function (global) {
  "use strict";
  var utils = global.WinSpeedBallSdkApiUtils;

  function create(subscribe) {
    if (typeof subscribe !== "function") throw utils.invalid("SDK event transport is required.");
    return Object.freeze({
      on: function (eventName, callback) {
        eventName = utils.requireString(eventName, "Event name", 64, false);
        if (!Object.prototype.hasOwnProperty.call(global.WinSpeedBallSdkContracts.EVENT_CAPABILITIES, eventName)) {
          throw utils.invalid("Event name is not supported.");
        }
        if (typeof callback !== "function") throw utils.invalid("Event callback must be a function.");
        var unsubscribe = subscribe(eventName, callback);
        if (typeof unsubscribe !== "function") throw utils.invalid("Event transport must return an unsubscribe function.");
        return unsubscribe;
      }
    });
  }

  global.WinSpeedBallSdkEventApi = Object.freeze({ create: create });
})(self);
