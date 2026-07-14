(function (global) {
  "use strict";
  var utils = global.WinSpeedBallSdkApiUtils;

  function create(invoke) {
    utils.requireInvoke(invoke);
    return Object.freeze({
      ask: function (prompt) { return utils.call(invoke, "ai.ask", [utils.requireString(prompt, "AI prompt", 50000, false)]); },
      summary: function (sourceText) { return utils.call(invoke, "ai.summary", [utils.requireString(sourceText, "Summary text", 50000, false)]); },
      translate: function (sourceText, targetLanguage) {
        return utils.call(invoke, "ai.translate", [
          utils.requireString(sourceText, "Translation text", 50000, false),
          utils.requireString(targetLanguage, "Target language", 64, false)
        ]);
      }
    });
  }

  global.WinSpeedBallSdkAiApi = Object.freeze({ create: create });
})(self);
