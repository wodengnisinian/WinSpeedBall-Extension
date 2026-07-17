(function (global) {
  "use strict";
  var utils = global.WinSpeedBallSdkApiUtils;

  function create(invoke) {
    utils.requireInvoke(invoke);
    return Object.freeze({
      latest: function () { return utils.call(invoke, "ai.latest", []); },
      history: function (limit) {
        if (limit == null) limit = 10;
        if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw utils.invalid("AI history limit must be between 1 and 20.");
        return utils.call(invoke, "ai.history", [limit]);
      },
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
