(function (global) {
  "use strict";

  function safeRespond(sendResponse, payload) {
    try {
      sendResponse(payload || { ok: false, error: "Empty response." });
    } catch (error) {}
  }

  function install(handlers) {
    chrome.runtime.onMessage.addListener(function (rawMessage, sender, sendResponse) {
      var responded = false;

      function respond(payload) {
        if (responded) return;
        responded = true;
        safeRespond(sendResponse, payload);
      }

      try {
        var parsed = global.WinSpeedBallMessageSchema.parse(rawMessage, sender);
        if (!parsed.ok) {
          respond({ ok: false, error: parsed.error || "Message validation failed." });
          return true;
        }

        var message = parsed.message;
        var handler = handlers[message.action];
        if (typeof handler !== "function") {
          respond({ ok: false, error: "Unknown action." });
          return true;
        }

        var request = Object.assign({
          action: message.action,
          source: message.source,
          requestId: message.requestId
        }, message.payload);
        var result = handler(request, sender, respond, message);
        if (result && typeof result.then === "function") {
          result.then(function (payload) {
            if (payload !== undefined) respond(payload);
          }).catch(function (error) {
            respond({ ok: false, error: error && error.message || String(error) });
          });
        } else if (result !== undefined) {
          respond(result);
        }
      } catch (error) {
        respond({ ok: false, error: error.message || String(error) });
      }

      return true;
    });
  }

  global.WinSpeedBallMessageRouter = { install: install };
})(self);
