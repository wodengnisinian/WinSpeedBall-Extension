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
    var types = ["SET_RATE", "STEP_UP", "STEP_DOWN", "RESET", "SET_MUTED", "TOGGLE_MUTED", "SET_VOLUME", "ENABLE_AUTOPLAY", "DISABLE_AUTOPLAY", "LOCK_STATE", "STOP_LOCK", "PLAY", "PAUSE", "GET_MEDIA_LIST", "GET_STATUS", "EXTRACT_PAGE_TEXT"];
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

  function validUsername(value) {
    return typeof value === "string" && /^[A-Za-z0-9\u4e00-\u9fff_.-]{3,32}$/.test(value.trim());
  }

  function validPassword(value) {
    return typeof value === "string" && value.length >= 8 && value.length <= 128 && /[A-Za-z]/.test(value) && /[0-9]/.test(value) && !/[\u0000-\u001f\u007f]/.test(value);
  }

  function validDisplayName(value) {
    return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 40 && !/[\u0000-\u001f\u007f]/.test(value);
  }

  function validSdkScriptId(value) {
    return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) && ["__proto__", "prototype", "constructor"].indexOf(value) < 0;
  }

  function validSdkSessionToken(value) {
    return typeof value === "string" && /^wsb_rt_[a-f0-9]{64}$/.test(value);
  }

  function validSdkContextNonce(value) {
    return typeof value === "string" && /^wsb_ctx_[a-f0-9]{64}$/.test(value);
  }

  function validateSdkCapabilities(capabilities) {
    return Array.isArray(capabilities) && capabilities.length > 0 && capabilities.length <= 6 && !capabilities.some(function (capability) {
      return !global.WinSpeedBallSdkContracts.validCapability(capability);
    });
  }

  function validatePrepareSdkContext(payload) {
    var error = checkKeys(payload, ["capabilities"], ["capabilities"]);
    if (error) return error;
    return validateSdkCapabilities(payload.capabilities) ? "" : "SDK capabilities are invalid.";
  }

  function validatePrepareSdkSession(payload) {
    var error = checkKeys(payload, ["scriptId", "code", "capabilities", "contextNonce", "confirmed"], ["scriptId", "code", "capabilities", "contextNonce", "confirmed"]);
    if (error) return error;
    if (!validSdkScriptId(payload.scriptId)) return "SDK script ID is invalid.";
    if (!validSdkContextNonce(payload.contextNonce)) return "SDK context confirmation is invalid.";
    if (typeof payload.code !== "string" || !payload.code.trim() || payload.code.length > MAX_SCRIPT_LENGTH) return "SDK script code is invalid or too large.";
    if (!validateSdkCapabilities(payload.capabilities)) return "SDK capabilities are invalid.";
    return payload.confirmed === true ? "" : "SDK capabilities must be explicitly confirmed.";
  }

  function validateInvokeSdkSession(payload) {
    var error = checkKeys(payload, ["sessionToken", "request"], ["sessionToken", "request"]);
    if (error) return error;
    if (!validSdkSessionToken(payload.sessionToken)) return "SDK session token is invalid.";
    if (!isObject(payload.request)) return "SDK request is invalid.";
    error = checkKeys(payload.request, ["channel", "protocolVersion", "scriptId", "requestId", "method", "args"], ["channel", "protocolVersion", "scriptId", "requestId", "method", "args"]);
    if (error) return error;
    var parsed = global.WinSpeedBallSdkContracts.validateRequest(payload.request);
    return parsed.ok ? "" : parsed.error || "SDK request is invalid.";
  }

  function validateRegister(payload) {
    var error = checkKeys(payload, ["username", "password", "displayName"], ["username", "password"]);
    if (error) return error;
    if (!validUsername(payload.username)) return "Username is invalid.";
    if (!validPassword(payload.password)) return "Password must be 8-128 characters and contain letters and numbers.";
    if (payload.displayName != null && String(payload.displayName).trim() && !validDisplayName(payload.displayName)) return "Display name is invalid.";
    return "";
  }

  function validateLogin(payload) {
    var error = checkKeys(payload, ["username", "password"], ["username", "password"]);
    if (error) return error;
    if (!validUsername(payload.username)) return "Username is invalid.";
    return typeof payload.password === "string" && payload.password.length <= 128 ? "" : "Password is invalid.";
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
    getUsageDeclaration: { sources: ["popup"], validate: noPayload },
    acceptUsageDeclaration: { sources: ["popup"], validate: function (payload) {
      var error = checkKeys(payload, ["version", "accepted"], ["version", "accepted"]);
      if (error) return error;
      if (typeof payload.version !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(payload.version)) return "Declaration version is invalid.";
      return payload.accepted === true ? "" : "Declaration must be explicitly accepted.";
    } },
    getUserSession: { sources: ["popup"], validate: noPayload },
    getSubscription: { sources: ["popup"], validate: noPayload },
    getFeatureGates: { sources: ["popup"], validate: noPayload },
    canUseFeature: { sources: ["popup"], validate: function (payload) {
      var error = checkKeys(payload, ["feature"], ["feature"]);
      if (error) return error;
      return typeof payload.feature === "string" && /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(payload.feature) && payload.feature.length <= 64
        ? ""
        : "Feature ID is invalid.";
    } },
    getPrivacySummary: { sources: ["popup"], validate: noPayload },
    clearPrivacyData: { sources: ["popup"], validate: function (payload) {
      var error = checkKeys(payload, ["category", "confirmed"], ["category", "confirmed"]);
      if (error) return error;
      if (["screenshots", "ocr", "ai", "logs", "scripts", "account", "all"].indexOf(payload.category) < 0) return "Privacy category is invalid.";
      return payload.confirmed === true ? "" : "Privacy data clearing must be explicitly confirmed.";
    } },
    getDeveloperMode: { sources: ["popup"], validate: noPayload },
    setDeveloperMode: { sources: ["popup"], validate: function (payload) {
      var error = checkKeys(payload, ["enabled", "confirmed"], ["enabled", "confirmed"]);
      if (error) return error;
      if (typeof payload.enabled !== "boolean" || typeof payload.confirmed !== "boolean") return "Developer Mode state is invalid.";
      return payload.enabled && payload.confirmed !== true ? "Developer Mode must be explicitly confirmed." : "";
    } },
    prepareSdkContext: { sources: ["popup"], validate: validatePrepareSdkContext },
    prepareSdkSession: { sources: ["popup"], validate: validatePrepareSdkSession },
    invokeSdkSession: { sources: ["popup"], validate: validateInvokeSdkSession },
    getSdkSessionStatus: { sources: ["popup"], validate: function (payload) {
      var error = checkKeys(payload, ["sessionToken"], ["sessionToken"]);
      return error || (validSdkSessionToken(payload.sessionToken) ? "" : "SDK session token is invalid.");
    } },
    closeSdkSession: { sources: ["popup"], validate: function (payload) {
      var error = checkKeys(payload, ["sessionToken"], ["sessionToken"]);
      return error || (validSdkSessionToken(payload.sessionToken) ? "" : "SDK session token is invalid.");
    } },
    deleteSdkScriptData: { sources: ["popup"], validate: function (payload) {
      var error = checkKeys(payload, ["scriptId", "confirmed"], ["scriptId", "confirmed"]);
      if (error) return error;
      if (!validSdkScriptId(payload.scriptId)) return "SDK script ID is invalid.";
      return payload.confirmed === true ? "" : "SDK script deletion must be explicitly confirmed.";
    } },
    openPinnedWindow: { sources: ["popup"], validate: noPayload },
    registerUser: { sources: ["popup"], validate: validateRegister },
    loginUser: { sources: ["popup"], validate: validateLogin },
    logoutUser: { sources: ["popup"], validate: noPayload },
    updateUserProfile: { sources: ["popup"], validate: function (payload) {
      var error = checkKeys(payload, ["displayName"], ["displayName"]);
      return error || (validDisplayName(payload.displayName) ? "" : "Display name is invalid.");
    } },
    changeUserPassword: { sources: ["popup"], validate: function (payload) {
      var error = checkKeys(payload, ["currentPassword", "newPassword"], ["currentPassword", "newPassword"]);
      if (error) return error;
      if (typeof payload.currentPassword !== "string" || payload.currentPassword.length > 128) return "Current password is invalid.";
      return validPassword(payload.newPassword) ? "" : "New password must be 8-128 characters and contain letters and numbers.";
    } },
    deleteUserAccount: { sources: ["popup"], validate: function (payload) {
      var error = checkKeys(payload, ["password", "confirm"], ["password", "confirm"]);
      if (error) return error;
      if (typeof payload.password !== "string" || payload.password.length > 128) return "Password is invalid.";
      return payload.confirm === "DELETE" ? "" : "Account deletion confirmation is invalid.";
    } },
    saveAiSettings: { sources: ["popup"], validate: validateAiSettings },
    saveApiKey: { sources: ["popup"], validate: validateAiSettings },
    getSettings: { sources: ["popup"], validate: noPayload },
    getActiveSiteAccess: { sources: ["popup"], validate: noPayload },
    executeUserScript: { sources: ["popup"], validate: function (payload) {
      var error = checkKeys(payload, ["scriptId", "code", "permissions", "permissionConfirmed"], ["scriptId", "code", "permissions", "permissionConfirmed"]);
      if (error) return error;
      if (typeof payload.scriptId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(payload.scriptId)) return "User script ID is invalid.";
      if (typeof payload.code !== "string" || payload.code.length > MAX_SCRIPT_LENGTH) return "User script is invalid or too large.";
      if (!Array.isArray(payload.permissions) || !payload.permissions.length || payload.permissions.some(function (permission) { return ["dom", "network", "automation"].indexOf(permission) < 0; })) return "User script permissions are invalid.";
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
    if (source === "popup") {
      var popupUrl = chrome.runtime.getURL("popup.html");
      return sender.url === popupUrl || String(sender.url || "").indexOf(popupUrl + "?") === 0;
    }
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
