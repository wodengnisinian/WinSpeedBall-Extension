(function (global) {
  "use strict";

  function ok() { return { ok: true }; }
  function invalid(error) { return { ok: false, code: "SDK_INVALID_ARGUMENT", error: error }; }
  function noArgs(args) { return args.length === 0 ? ok() : invalid("This SDK method does not accept arguments."); }
  function text(value, max, name) { return typeof value === "string" && value.trim() && value.length <= max ? ok() : invalid(name + " is invalid."); }

  function validate(method, args) {
    if (!Array.isArray(args)) return invalid("SDK arguments must be an array.");
    if (["video.getAll", "video.current", "video.getStatus", "video.play", "video.pause", "ocr.latest", "ocr.capture", "qa.latest", "qa.ocr", "qa.voice", "ai.latest", "page.info", "page.text", "page.title", "page.url", "book.getStatus"].indexOf(method) >= 0) return noArgs(args);
    if (method === "video.setRate") return args.length === 1 && Number.isFinite(args[0]) && args[0] >= 0.25 && args[0] <= 16 ? ok() : invalid("Playback rate must be between 0.25 and 16.");
    if (method === "video.setVolume") return args.length === 1 && Number.isFinite(args[0]) && args[0] >= 0 && args[0] <= 1 ? ok() : invalid("Volume must be between 0 and 1.");
    if (method === "video.mute") return args.length === 1 && typeof args[0] === "boolean" ? ok() : invalid("Muted state must be a boolean.");
    if (method === "ocr.recognize") {
      var input = args[0];
      if (args.length !== 1 || !input || typeof input !== "object" || Array.isArray(input)) return invalid("OCR input must be an object.");
      if (typeof input.dataUrl !== "string" || !/^data:image\/(png|jpeg|webp);base64,/i.test(input.dataUrl) || input.dataUrl.length > 16 * 1024 * 1024) return invalid("OCR image is invalid or too large.");
      if (input.language != null && (typeof input.language !== "string" || !/^[A-Za-z0-9_+-]{1,64}$/.test(input.language))) return invalid("OCR language is invalid.");
      return ok();
    }
    if (method === "ai.ask" || method === "ai.summary") return args.length === 1 ? text(args[0], 50000, "AI text") : invalid("AI method requires one text argument.");
    if (method === "ai.history") return args.length === 0 || (args.length === 1 && Number.isInteger(args[0]) && args[0] >= 1 && args[0] <= 20) ? ok() : invalid("AI history limit must be between 1 and 20.");
    if (method === "ai.translate") {
      if (args.length !== 2) return invalid("Translate requires text and target language.");
      var source = text(args[0], 50000, "Translation text");
      return source.ok ? text(args[1], 64, "Target language") : source;
    }
    if (method === "event.on") return args.length === 1 && Object.prototype.hasOwnProperty.call(global.WinSpeedBallSdkContracts.EVENT_CAPABILITIES, args[0]) ? ok() : invalid("SDK event is invalid.");
    if (method === "storage.get") return args.length === 1 && typeof args[0] === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(args[0]) && ["__proto__", "prototype", "constructor"].indexOf(args[0]) < 0 ? ok() : invalid("Storage key is invalid.");
    if (method === "storage.set") {
      var key = validate("storage.get", [args[0]]);
      if (args.length !== 2 || !key.ok) return key.ok ? invalid("Storage set requires a key and value.") : key;
      var serialized;
      try { serialized = JSON.stringify(args[1]); } catch (error) { return invalid("Storage value must be serializable."); }
      return serialized !== undefined && serialized.length <= 65536 ? ok() : invalid("Storage value is invalid or too large.");
    }
    return { ok: false, code: "SDK_METHOD_NOT_ALLOWED", error: "SDK method is not supported." };
  }

  global.WinSpeedBallSdkMethodSchema = Object.freeze({ validate: validate });
})(self);
