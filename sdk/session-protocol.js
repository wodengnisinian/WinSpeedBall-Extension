(function (global) {
  "use strict";

  function createProtocol() {

  var CHANNEL = "WSB_SDK_SANDBOX";
  var PROTOCOL_VERSION = 1;
  var TYPES = Object.freeze([
    "INIT",
    "READY",
    "WORKER_INIT",
    "RUN",
    "STARTED",
    "SDK_REQUEST",
    "RPC_RESULT",
    "EVENT",
    "RESULT",
    "ERROR",
    "TERMINATE",
    "TERMINATED"
  ]);
  var DEFAULT_TIMEOUT_MS = 5000;
  var MIN_TIMEOUT_MS = 100;
  var MAX_TIMEOUT_MS = 30000;

  function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function validIdentifier(value, maxLength, minLength) {
    var text = typeof value === "string" ? value : "";
    var minimum = Number.isInteger(minLength) ? minLength : 1;
    return text.length >= minimum && text.length <= maxLength && /^[A-Za-z0-9_-]+$/.test(text);
  }

  function validSessionId(value) {
    return validIdentifier(value, 128, 8);
  }

  function validType(value) {
    return TYPES.indexOf(String(value || "")) >= 0;
  }

  function validateEnvelope(message, options) {
    options = options || {};
    if (!isRecord(message)) {
      return { ok: false, code: "SDK_SESSION_INVALID_ENVELOPE", error: "Sandbox message must be an object." };
    }
    if (message.channel !== CHANNEL || message.protocolVersion !== PROTOCOL_VERSION) {
      return { ok: false, code: "SDK_SESSION_PROTOCOL_MISMATCH", error: "Sandbox protocol is not supported." };
    }
    if (!validSessionId(message.sessionId)) {
      return { ok: false, code: "SDK_SESSION_INVALID_ID", error: "Sandbox session identifier is invalid." };
    }
    if (options.sessionId && message.sessionId !== options.sessionId) {
      return { ok: false, code: "SDK_SESSION_MISMATCH", error: "Sandbox message belongs to another session." };
    }
    if (!validType(message.type)) {
      return { ok: false, code: "SDK_SESSION_INVALID_TYPE", error: "Sandbox message type is not supported." };
    }
    if (Array.isArray(options.allowedTypes) && options.allowedTypes.indexOf(message.type) < 0) {
      return { ok: false, code: "SDK_SESSION_UNEXPECTED_TYPE", error: "Sandbox message type is not allowed in the current state." };
    }
    return { ok: true };
  }

  function createEnvelope(sessionId, type, payload) {
    if (!validSessionId(sessionId)) throw new TypeError("Invalid sandbox session identifier.");
    if (!validType(type)) throw new TypeError("Invalid sandbox message type.");
    var envelope = {};
    if (isRecord(payload)) {
      Object.keys(payload).forEach(function (key) {
        if (key !== "channel" && key !== "protocolVersion" && key !== "sessionId" && key !== "type") {
          envelope[key] = payload[key];
        }
      });
    }
    envelope.channel = CHANNEL;
    envelope.protocolVersion = PROTOCOL_VERSION;
    envelope.sessionId = sessionId;
    envelope.type = type;
    return envelope;
  }

  function normalizeTimeout(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_TIMEOUT_MS;
    return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(number)));
  }

  function serializeError(error, fallbackCode) {
    var code = error && typeof error.code === "string" ? error.code : String(fallbackCode || "SDK_SANDBOX_ERROR");
    var message = error && typeof error.message === "string" ? error.message : String(error || "Sandbox execution failed.");
    if (!/^[A-Z0-9_]{3,64}$/.test(code)) code = String(fallbackCode || "SDK_SANDBOX_ERROR");
    return {
      code: code.slice(0, 64),
      message: message.slice(0, 1000)
    };
  }

  return Object.freeze({
    CHANNEL: CHANNEL,
    PROTOCOL_VERSION: PROTOCOL_VERSION,
    TYPES: TYPES,
    DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
    MIN_TIMEOUT_MS: MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS: MAX_TIMEOUT_MS,
    isRecord: isRecord,
    validIdentifier: validIdentifier,
    validSessionId: validSessionId,
    validType: validType,
    validateEnvelope: validateEnvelope,
    createEnvelope: createEnvelope,
    normalizeTimeout: normalizeTimeout,
    serializeError: serializeError
  });
  }

  global.WinSpeedBallSdkSessionProtocolFactory = createProtocol;
  global.WinSpeedBallSdkSessionProtocol = createProtocol();
})(self);
