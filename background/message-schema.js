(function (global) {
  "use strict";

  var VERSION = 1;
  var MAX_IMAGE_LENGTH = 32 * 1024 * 1024;
  var MAX_SCRIPT_LENGTH = 200000;

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function checkKeys(payload, allowed, required) {
    var keys = Object.keys(payload);
    if (keys.some(function (key) { return allowed.indexOf(key) < 0; })) return "Message payload contains unsupported fields.";
    if ((required || []).some(function (key) { return !Object.prototype.hasOwnProperty.call(payload, key); })) return "Message payload is missing required fields.";
    return "";
  }

  function noPayload(payload) {
    return Object.keys(payload).length ? "This action does not accept a payload." : "";
  }

  function validToken(value) {
    return typeof value === "string" && value.length >= 16 && value.length <= 128;
  }

  function validOriginPattern(value) {
    return typeof value === "string" && /^https?:\/\/[^/*]+\/\*$/i.test(value) && value.length <= 2048;
  }

  function validSecureBaseUrl(value) {
    if (typeof value !== "string" || value.length > 2048) return false;
    try {
      var parsed = new URL(value);
      if (parsed.username || parsed.password || parsed.search || parsed.hash) return false;
      if (parsed.protocol === "https:") return true;
      return parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].indexOf(parsed.hostname) >= 0;
    } catch (e) {
      return false;
    }
  }

  function validateControl(payload) {
    var error = checkKeys(payload, ["command"], ["command"]);
    if (error) return error;
    if (!isObject(payload.command)) return "Control command must be an object.";
    var command = payload.command;
    var types = ["SET_RATE", "STEP_UP", "STEP_DOWN", "RESET", "SET_MUTED", "TOGGLE_MUTED", "SET_VOLUME", "ENABLE_AUTOPLAY", "DISABLE_AUTOPLAY", "GET_STATUS", "EXTRACT_PAGE_TEXT"];
    if (types.indexOf(command.type) < 0) return "Unsupported control command.";
    if (command.type === "SET_RATE" && (!isFiniteNumber(command.rate) || command.rate < 0.25 || command.rate > 16)) return "Playback rate is invalid.";
    if (command.type === "SET_VOLUME" && (!isFiniteNumber(command.volume) || command.volume < 0 || command.volume > 1)) return "Volume is invalid.";
    if (command.type === "SET_MUTED" && typeof command.muted !== "boolean") return "Muted state is invalid.";
    return "";
  }

  function validateCaptureTokenPayload(payload, extraAllowed, extraRequired) {
    var allowed = ["captureToken"].concat(extraAllowed || []);
    var required = ["captureToken"].concat(extraRequired || []);
    var error = checkKeys(payload, allowed, required);
    if (error) return error;
    return validToken(payload.captureToken) ? "" : "Capture token is invalid.";
  }

  function validateAutomation(payload) {
    var error = checkKeys(payload, ["command", "interval", "tabId", "originPattern"], ["command"]);
    if (error) return error;
    if (["START", "STOP", "NEXT", "PREV", "SET_INTERVAL", "GET_STATE"].indexOf(payload.command) < 0) return "Automation command is invalid.";
    if (payload.interval != null && (!isFiniteNumber(payload.interval) || payload.interval < 30 || payload.interval > 3600)) return "Automation interval is invalid.";
    if (payload.command === "START") {
      if (!Number.isInteger(payload.tabId) || payload.tabId < 0) return "Automation tab is invalid.";
      if (!validOriginPattern(payload.originPattern)) return "Automation site permission is invalid.";
    }
    return "";
  }

  function validateAi(payload) {
    var error = checkKeys(payload, ["prompt", "messages", "temperature", "autoOcrSourceTime", "task", "targetLanguage"], []);
    if (error) return error;
    if (payload.prompt != null && (typeof payload.prompt !== "string" || payload.prompt.length > 50000)) return "AI prompt is too large.";
    if (payload.messages != null) {
      if (!Array.isArray(payload.messages) || payload.messages.length > 50) return "AI messages are invalid.";
      var totalLength = 0;
      if (payload.messages.some(function (item) {
        if (!isObject(item) || ["system", "user", "assistant"].indexOf(item.role) < 0 || typeof item.content !== "string" || item.content.length > 50000) return true;
        totalLength += item.content.length;
        return false;
      })) return "AI messages are invalid.";
      if (totalLength > 100000) return "AI messages are too large.";
    }
    if (payload.temperature != null && (!isFiniteNumber(payload.temperature) || payload.temperature < 0 || payload.temperature > 2)) return "AI temperature is invalid.";
    if (payload.autoOcrSourceTime != null && (!isFiniteNumber(payload.autoOcrSourceTime) || payload.autoOcrSourceTime < 0)) return "OCR source time is invalid.";
    if (payload.task != null && ["chat", "summary", "translate"].indexOf(payload.task) < 0) return "AI task is invalid.";
    if (payload.targetLanguage != null && (typeof payload.targetLanguage !== "string" || payload.targetLanguage.length > 64)) return "Target language is invalid.";
    return "";
  }

  function validateAiSettings(payload) {
    var error = checkKeys(payload, ["provider", "apiKey", "baseUrl", "model", "clearApiKey"], []);
    if (error) return error;
    if (payload.provider != null && ["deepseek", "openai", "claude", "local"].indexOf(payload.provider) < 0) return "AI provider is invalid.";
    if (payload.apiKey != null && (typeof payload.apiKey !== "string" || payload.apiKey.length > 512 || /[\u0000-\u001f\u007f]/.test(payload.apiKey))) return "API key is invalid.";
    if (payload.baseUrl != null && !validSecureBaseUrl(payload.baseUrl)) return "Base URL must use HTTPS. HTTP is allowed only for localhost.";
    if (payload.model != null && (typeof payload.model !== "string" || payload.model.length > 128 || !/^[A-Za-z0-9._:/-]+$/.test(payload.model))) return "Model is invalid.";
    if (payload.clearApiKey != null && typeof payload.clearApiKey !== "boolean") return "API key clear flag is invalid.";
    if (payload.clearApiKey === true && String(payload.apiKey || "").trim()) return "API key and clear flag cannot be used together.";
    return "";
  }

  var rules = {
    controlActiveTab: { sources: ["popup"], validate: validateControl },
    captureVisiblePage: { sources: ["content"], validate: function (payload) { return validateCaptureTokenPayload(payload); } },
    startRegionCapture: { sources: ["popup"], validate: noPayload },
    getCapturePreferences: { sources: ["content"], validate: noPayload },
    setCaptureIndicator: { sources: ["content"], validate: function (payload) {
      var error = validateCaptureTokenPayload(payload, ["active"], ["active"]);
      return error || (typeof payload.active !== "boolean" ? "Capture indicator state is invalid." : "");
    } },
    saveManualCapture: { sources: ["content"], validate: function (payload) {
      var error = validateCaptureTokenPayload(payload, ["dataUrl"], ["dataUrl"]);
      if (error) return error;
      return typeof payload.dataUrl === "string" && /^data:image\/png;base64,/i.test(payload.dataUrl) && payload.dataUrl.length <= MAX_IMAGE_LENGTH ? "" : "Capture image is invalid or too large.";
    } },
    getManualCapture: { sources: ["popup"], validate: noPayload },
    saveAiSettings: { sources: ["popup"], validate: validateAiSettings },
    saveApiKey: { sources: ["popup"], validate: validateAiSettings },
    getSettings: { sources: ["popup"], validate: noPayload },
    getActiveSiteAccess: { sources: ["popup"], validate: noPayload },
    executeUserScript: { sources: ["popup"], validate: function (payload) {
      var error = checkKeys(payload, ["scriptId", "code", "permissions", "permissionConfirmed"], ["scriptId", "code", "permissions", "permissionConfirmed"]);
      if (error) return error;
      if (typeof payload.scriptId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(payload.scriptId)) return "User script ID is invalid.";
      if (typeof payload.code !== "string" || payload.code.length > MAX_SCRIPT_LENGTH) return "User script is invalid or too large.";
      if (!Array.isArray(payload.permissions) || !payload.permissions.length || payload.permissions.some(function (permission) { return ["dom", "network"].indexOf(permission) < 0; })) return "User script permissions are invalid.";
      return payload.permissionConfirmed === true ? "" : "User script permissions are not confirmed.";
    } },
    getUserScriptsStatus: { sources: ["popup"], validate: noPayload },
    douyinPanel: { sources: ["popup"], validate: validateAutomation },
    bookPanel: { sources: ["popup"], validate: validateAutomation },
    testAI: { sources: ["popup"], validate: noPayload },
    askAI: { sources: ["popup"], validate: validateAi },
    testDeepSeek: { sources: ["popup"], validate: noPayload },
    askDeepSeek: { sources: ["popup"], validate: validateAi },
    syncUserScripts: { sources: ["popup"], validate: noPayload },
    ocrJobProgress: { sources: ["offscreen-ocr"], validate: function (payload) {
      var error = checkKeys(payload, ["sourceTime", "status", "progress"], ["sourceTime", "status", "progress"]);
      if (error) return error;
      if (!isFiniteNumber(payload.sourceTime) || payload.sourceTime <= 0) return "OCR source time is invalid.";
      if (typeof payload.status !== "string" || payload.status.length > 64) return "OCR status is invalid.";
      return isFiniteNumber(payload.progress) && payload.progress >= 0 && payload.progress <= 1 ? "" : "OCR progress is invalid.";
    } },
    ocrJobComplete: { sources: ["offscreen-ocr"], validate: function (payload) {
      var error = checkKeys(payload, ["sourceTime", "text"], ["sourceTime", "text"]);
      if (error) return error;
      if (!isFiniteNumber(payload.sourceTime) || payload.sourceTime <= 0) return "OCR source time is invalid.";
      return typeof payload.text === "string" && payload.text.length <= 1000000 ? "" : "OCR text is too large.";
    } },
    ocrJobFailed: { sources: ["offscreen-ocr"], validate: function (payload) {
      var error = checkKeys(payload, ["sourceTime", "error"], ["sourceTime", "error"]);
      if (error) return error;
      if (!isFiniteNumber(payload.sourceTime) || payload.sourceTime <= 0) return "OCR source time is invalid.";
      return typeof payload.error === "string" && payload.error.length <= 2000 ? "" : "OCR error is invalid.";
    } }
  };

  function senderMatches(source, sender) {
    if (!sender || sender.id !== chrome.runtime.id) return false;
    if (source === "popup") return sender.url === chrome.runtime.getURL("popup.html");
    if (source === "offscreen-ocr") return sender.url === chrome.runtime.getURL("ocr_worker.html");
    if (source === "content" || source === "auto-script-trigger") {
      return !!sender.tab && /^https?:\/\//i.test(String(sender.url || ""));
    }
    return false;
  }

  function parse(raw, sender) {
    if (!isObject(raw)) return { ok: false, error: "Message must be an object." };
    if (raw.version !== VERSION) return { ok: false, error: "Unsupported message version." };
    if (typeof raw.action !== "string" || !rules[raw.action]) return { ok: false, error: "Unknown action." };
    if (typeof raw.source !== "string" || rules[raw.action].sources.indexOf(raw.source) < 0) return { ok: false, error: "Source is not allowed for this action." };
    if (typeof raw.requestId !== "string" || !raw.requestId || raw.requestId.length > 64) return { ok: false, error: "Request ID is invalid." };
    if (!isObject(raw.payload)) return { ok: false, error: "Message payload must be an object." };
    if (!senderMatches(raw.source, sender)) return { ok: false, error: "Message sender is not authorized." };
    var validationError = rules[raw.action].validate(raw.payload);
    if (validationError) return { ok: false, error: validationError };
    return { ok: true, message: { version: VERSION, action: raw.action, source: raw.source, requestId: raw.requestId, payload: raw.payload } };
  }

  global.WinSpeedBallMessageSchema = {
    VERSION: VERSION,
    parse: parse
  };
})(self);
