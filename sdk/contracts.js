(function (global) {
  "use strict";

  var SDK_VERSION = "3.7.0-beta";
  var PROTOCOL_VERSION = 1;
  var CHANNEL = "WSB_SDK";
  var CAPABILITIES = Object.freeze([
    "video.read",
    "video.control",
    "ocr.read",
    "qa.read",
    "ai.read",
    "ai.request",
    "page.read",
    "book.read",
    "storage"
  ]);
  var METHOD_CAPABILITIES = Object.freeze({
    "video.getAll": "video.read",
    "video.current": "video.read",
    "video.getStatus": "video.read",
    "video.setRate": "video.control",
    "video.setVolume": "video.control",
    "video.mute": "video.control",
    "video.play": "video.control",
    "video.pause": "video.control",
    "ocr.latest": "ocr.read",
    "ocr.capture": "ocr.read",
    "ocr.recognize": "ocr.read",
    "qa.latest": "qa.read",
    "qa.ocr": "qa.read",
    "qa.voice": "qa.read",
    "ai.latest": "ai.read",
    "ai.history": "ai.read",
    "ai.ask": "ai.request",
    "ai.summary": "ai.request",
    "ai.translate": "ai.request",
    "page.info": "page.read",
    "page.text": "page.read",
    "page.title": "page.read",
    "page.url": "page.read",
    "book.getStatus": "book.read",
    "event.on": "event-specific",
    "storage.get": "storage",
    "storage.set": "storage"
  });
  var PUBLIC_METHODS = Object.freeze({
    "video.all": "video.getAll",
    "video.current": "video.current",
    "video.status": "video.getStatus",
    "video.rate": "video.setRate",
    "video.volume": "video.setVolume",
    "video.mute": "video.mute",
    "video.play": "video.play",
    "video.pause": "video.pause",
    "ocr.latest": "ocr.latest",
    "ocr.capture": "ocr.capture",
    "ocr.recognize": "ocr.recognize",
    "qa.latest": "qa.latest",
    "qa.ocr": "qa.ocr",
    "qa.voice": "qa.voice",
    "ai.latest": "ai.latest",
    "ai.history": "ai.history",
    "ai.ask": "ai.ask",
    "ai.summary": "ai.summary",
    "ai.translate": "ai.translate",
    "page.info": "page.info",
    "page.text": "page.text",
    "page.title": "page.title",
    "page.url": "page.url",
    "book.status": "book.getStatus",
    "event.on": "event.on",
    "storage.get": "storage.get",
    "storage.set": "storage.set"
  });
  var EVENT_CAPABILITIES = Object.freeze({
    "video.play": "video.read",
    "video.pause": "video.read",
    "video.finish": "video.read",
    "ocr.complete": "ocr.read",
    "ai.complete": "ai.request",
    "page.change": "page.read"
  });

  function unique(values) {
    return values.filter(function (value, index, list) { return list.indexOf(value) === index; });
  }

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function validCapability(value) {
    return CAPABILITIES.indexOf(String(value || "")) >= 0;
  }

  function normalizeCapabilities(values) {
    return unique((Array.isArray(values) ? values : []).map(function (value) {
      return String(value || "").trim().toLowerCase();
    }).filter(validCapability));
  }

  function parseMetadata(code) {
    var metadata = {
      name: "",
      version: "",
      capabilities: [],
      unsupportedCapabilities: [],
      legacyPermissions: []
    };
    var source = String(code || "");
    var start = source.indexOf("// ==UserScript==");
    var end = source.indexOf("// ==/UserScript==");
    if (start < 0 || end < start) return metadata;
    source.slice(start, end).split(/\r?\n/).forEach(function (line) {
      var match = line.match(/^\s*\/\/\s*@(\S+)\s+(.+?)\s*$/);
      if (!match) return;
      var key = match[1].toLowerCase();
      var value = String(match[2] || "").trim();
      if (key === "name" && !metadata.name) metadata.name = value;
      else if (key === "version" && !metadata.version) metadata.version = value;
      else if (key === "wsb-capability") {
        var capability = value.toLowerCase();
        if (validCapability(capability)) metadata.capabilities.push(capability);
        else metadata.unsupportedCapabilities.push(capability);
      } else if (key === "permission") {
        metadata.legacyPermissions.push(value.toLowerCase());
      }
    });
    metadata.capabilities = unique(metadata.capabilities);
    metadata.unsupportedCapabilities = unique(metadata.unsupportedCapabilities);
    metadata.legacyPermissions = unique(metadata.legacyPermissions);
    return metadata;
  }

  function requiredCapability(method, args) {
    method = String(method || "");
    if (method !== "event.on") return METHOD_CAPABILITIES[method] || "";
    var eventName = Array.isArray(args) ? String(args[0] || "") : "";
    return EVENT_CAPABILITIES[eventName] || "";
  }

  function classifyMetadata(metadata) {
    metadata = metadata || {};
    var capabilities = normalizeCapabilities(metadata.capabilities);
    var unsupported = unique(Array.isArray(metadata.unsupportedCapabilities) ? metadata.unsupportedCapabilities : []);
    var legacy = unique(Array.isArray(metadata.legacyPermissions) ? metadata.legacyPermissions : []);
    if (unsupported.length) {
      return { ok: false, mode: "invalid", code: "SDK_CAPABILITY_UNKNOWN", unsupportedCapabilities: unsupported, error: "The script declares unsupported SDK capabilities." };
    }
    if (capabilities.length && legacy.length) {
      return { ok: false, mode: "invalid", code: "SDK_METADATA_CONFLICT", error: "SDK capabilities and legacy permissions cannot be mixed." };
    }
    if (capabilities.length) return { ok: true, mode: "sdk", capabilities: capabilities };
    if (legacy.length) return { ok: true, mode: "legacy", legacyPermissions: legacy };
    return { ok: false, mode: "invalid", code: "SDK_CAPABILITY_REQUIRED", error: "The script does not declare an SDK capability." };
  }

  function authorize(method, args, grantedCapabilities) {
    var capability = requiredCapability(method, args);
    if (!capability) return { ok: false, code: "SDK_METHOD_NOT_ALLOWED", error: "SDK method or event is not supported." };
    var granted = normalizeCapabilities(grantedCapabilities);
    if (granted.indexOf(capability) < 0) {
      return { ok: false, code: "SDK_CAPABILITY_REQUIRED", capability: capability, error: "The script has not been granted the required capability." };
    }
    return { ok: true, capability: capability };
  }

  function validIdentifier(value, maxLength) {
    return typeof value === "string" && value.length >= 1 && value.length <= maxLength && /^[A-Za-z0-9_-]+$/.test(value);
  }

  function validScriptId(value) {
    return validIdentifier(value, 64) && ["__proto__", "prototype", "constructor"].indexOf(value) < 0;
  }

  function validateRequest(request) {
    if (!isObject(request)) return { ok: false, code: "SDK_INVALID_REQUEST", error: "SDK request must be an object." };
    if (request.channel !== CHANNEL || request.protocolVersion !== PROTOCOL_VERSION) {
      return { ok: false, code: "SDK_PROTOCOL_MISMATCH", error: "SDK protocol version is not supported." };
    }
    if (!validScriptId(request.scriptId) || !validIdentifier(request.requestId, 96)) {
      return { ok: false, code: "SDK_INVALID_REQUEST", error: "SDK request identifiers are invalid." };
    }
    if (typeof request.method !== "string" || !Object.prototype.hasOwnProperty.call(METHOD_CAPABILITIES, request.method)) {
      return { ok: false, code: "SDK_METHOD_NOT_ALLOWED", error: "SDK method is not supported." };
    }
    if (!Array.isArray(request.args) || request.args.length > 16) {
      return { ok: false, code: "SDK_INVALID_ARGUMENT", error: "SDK arguments are invalid." };
    }
    var capability = requiredCapability(request.method, request.args);
    if (!capability) return { ok: false, code: "SDK_EVENT_NOT_ALLOWED", error: "SDK event is not supported." };
    var serializedLength = 0;
    try { serializedLength = JSON.stringify(request.args).length; }
    catch (error) { return { ok: false, code: "SDK_INVALID_ARGUMENT", error: "SDK arguments must be serializable." }; }
    if (serializedLength > 65536) return { ok: false, code: "SDK_PAYLOAD_TOO_LARGE", error: "SDK request payload is too large." };
    return { ok: true, capability: capability };
  }

  global.WinSpeedBallSdkContracts = Object.freeze({
    SDK_VERSION: SDK_VERSION,
    PROTOCOL_VERSION: PROTOCOL_VERSION,
    CHANNEL: CHANNEL,
    CAPABILITIES: CAPABILITIES,
    METHOD_CAPABILITIES: METHOD_CAPABILITIES,
    PUBLIC_METHODS: PUBLIC_METHODS,
    EVENT_CAPABILITIES: EVENT_CAPABILITIES,
    validCapability: validCapability,
    normalizeCapabilities: normalizeCapabilities,
    parseMetadata: parseMetadata,
    classifyMetadata: classifyMetadata,
    requiredCapability: requiredCapability,
    authorize: authorize,
    validateRequest: validateRequest
  });
})(self);
