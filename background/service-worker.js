importScripts("../shared/log-record.js");
importScripts("storage-service.js");
importScripts("declaration-service.js");
importScripts("user-service.js");
importScripts("user-provider.js");
importScripts("subscription-service.js");
importScripts("feature-gate.js");
importScripts("../sdk/contracts.js");
importScripts("../sdk/method-schema.js");
importScripts("permission-service.js");
importScripts("sdk-storage-service.js");
importScripts("sdk-context-service.js");
importScripts("developer-mode-service.js");
importScripts("privacy-service.js");
importScripts("window-service.js");
importScripts("ai-window-service.js");
importScripts("ai-providers.js");
importScripts("../vendor/opencc/opencc-full-1.4.1.js");
importScripts("../shared/structured-text-normalizer.js");
importScripts("../voice/text-filter.js");
importScripts("ai-service.js");
importScripts("ocr-service.js");
importScripts("voice-service.js");
importScripts("video-service.js");
importScripts("book-service.js");
importScripts("sdk-service.js");
importScripts("message-schema.js");
importScripts("message-router.js");
importScripts("user-script-service.js");
importScripts("user-script-bridge.js");

/**
 * WinSpeedBall background service worker.
 * ASCII only in this file to avoid encoding issues in extension loading.
 */
(function () {
  "use strict";

  var MAX_USER_SCRIPT_LENGTH = 200000;
  var MIN_ALARM_INTERVAL_SECONDS = 30;
  var MIN_CHAOXING_INTERVAL_SECONDS = 2;
  var AUTO_SCRIPT_TRIGGER_ID = "winspeedball-auto-script-trigger";
  var SDK_SESSIONS_KEY = "sdkRuntimeSessions";
  var SDK_CONTEXT_INTENTS_KEY = "sdkContextIntents";
  var SDK_LIFECYCLE_MAINTENANCE_ALARM = "sdk-lifecycle-maintenance";
  var CAPTURE_AUTH_KEY = "pendingCaptureAuthorization";
  var AI_REPLY_KEY = "aiReplyWindowPayload";
  var AI_REPLY_BOUNDS = { width: 320, height: 240 };
  var pendingCapture = null;
  var lastAccessibleTab = null;
  var DOUYIN_ALARM = "douyin-panel-auto-next";
  var douyinState = { running: false, interval: MIN_ALARM_INTERVAL_SECONDS, tabId: null, originPattern: "" };
  var BOOK_ALARM = "book-panel-auto-next";
  var BOOK_BACK_COVER_ALARM = "book-panel-chaoxing-back-cover-check";
  var CHAOXING_BACK_COVER_CHECK_DELAYS_SECONDS = [400, 300, 250, 150, 50];
  var bookState = { running: false, interval: MIN_ALARM_INTERVAL_SECONDS, tabId: null, originPattern: "", mode: "book", ownerType: "", ownerOrigin: "", ownerScriptId: "", ownerSessionId: "", backCoverCheckIndex: 0, backCoverCheckDueAt: 0, backCoverPageJumpLabel: "", backCoverReached: false };
  var bookFastTimer = null;
  var bookFastTurnInFlight = false;
  var bookBackCoverCheckInFlight = false;
  var sdkBookMutationQueue = Promise.resolve();
  var sdkBookPendingOwners = Object.create(null);
  var sdkBookCancelledOwners = Object.create(null);
  var bookStateGeneration = 0;
  var lastBookDetection = { book: null, image: null, chaoxing: null };
  var storageGet = self.WinSpeedBallStorageService.get;
  var storageSet = self.WinSpeedBallStorageService.set;
  var storageRemove = self.WinSpeedBallStorageService.remove;
  var restrictStorageAccess = self.WinSpeedBallStorageService.restrictAccess;
  var appendBackgroundLog = self.WinSpeedBallStorageService.appendLog;
  var saveCaptureRecord = self.WinSpeedBallStorageService.saveCaptureRecord;
  var declarationService = self.WinSpeedBallDeclarationService;
  var userService = self.WinSpeedBallUserService;
  var subscriptionService = self.WinSpeedBallSubscriptionService;
  var featureGate = self.WinSpeedBallFeatureGate;
  var permissionService = self.WinSpeedBallPermissionService;
  var sdkStorageService = self.WinSpeedBallSdkStorageService;
  var developerModeService = self.WinSpeedBallDeveloperModeService;
  var privacyService = self.WinSpeedBallPrivacyService;
  var windowService = self.WinSpeedBallWindowService;
  var aiWindowService = self.WinSpeedBallAiWindowService.create({ storageKey: AI_REPLY_KEY, bounds: AI_REPLY_BOUNDS });
  var callAi = self.WinSpeedBallAiService.call;
  var getLatestAi = self.WinSpeedBallAiService.getLatest;
  var getAiHistory = self.WinSpeedBallAiService.getHistory;
  var saveAiSettings = self.WinSpeedBallAiService.saveSettings;
  var ocrService = self.WinSpeedBallOcrService;
  var voiceService = self.WinSpeedBallVoiceService;
  var startOcrJob = ocrService.start;
  var handleOcrProgress = ocrService.handleProgress;
  var handleOcrComplete = ocrService.handleComplete;
  var handleOcrFailed = ocrService.handleFailed;
  var cancelOcrJob = ocrService.cancel;
  var getManualCapture = ocrService.getManualCapture;
  var resumePendingOcrJob = ocrService.resume;
  var restartLatestOcrJob = ocrService.restartLatest;
  var isOcrWorkerSender = ocrService.isWorkerSender;
  var videoService = self.WinSpeedBallVideoService.create();
  var bookService = self.WinSpeedBallBookService;

  function normalizeBookMode(mode) {
    return ["book", "image", "chaoxing"].indexOf(mode) >= 0 ? mode : "book";
  }
  var userScriptBridge = self.WinSpeedBallUserScriptBridge.create({
    runtime: chrome.runtime,
    controlTab: function (tabId, command, callback) { videoService.controlTab(tabId, command, callback); },
    canUseFeature: function (featureId) { return featureGate.check(featureId); },
    onAudit: function (result) {
      appendBackgroundLog("脚本", result && result.ok ? "读取插件视频状态成功" : "读取插件视频状态失败", {
        总时长: result && result.duration || 0,
        当前时间: result && result.currentTime || 0,
        媒体数量: result && result.mediaCount || 0,
        原因: result && result.error || "-"
      }, result && result.ok ? "success" : "warn");
      try {
        var shared = chrome.runtime.sendMessage({
          source: "user-script-bridge",
          type: "WSB_SHARED_VIDEO_STATUS",
          status: result || { ok: false, duration: 0, currentTime: 0, mediaCount: 0 }
        });
        if (shared && typeof shared.catch === "function") shared.catch(function () {});
      } catch (error) {}
    }
  });
  var sdkContextService = self.WinSpeedBallSdkContextService.create({
    contracts: self.WinSpeedBallSdkContracts,
    resolveCurrent: resolveSdkContext,
    validateContext: validateSdkContext,
    readIntents: readSdkContextIntents,
    writeIntents: writeSdkContextIntents
  });
  var sdkService = self.WinSpeedBallSdkService.create({
    contracts: self.WinSpeedBallSdkContracts,
    methodSchema: self.WinSpeedBallSdkMethodSchema,
    permissionService: permissionService,
    featureGate: featureGate,
    developerModeService: developerModeService,
    sdkStorageService: sdkStorageService,
    consumeContext: function (nonce, capabilities, bookMode) { return sdkContextService.consume(nonce, capabilities, bookMode); },
    validateContext: validateSdkContext,
    controlTab: function (tabId, command, callback, boundContext) {
      videoService.controlTab(tabId, command, callback, boundContext);
    },
    getBookStatus: function (tabId, mode, callback, boundContext) {
      readSdkBookStatusBound(tabId, mode, boundContext, callback);
    },
    controlBook: controlSdkBook,
    releaseBookResources: releaseSdkBookResources,
    callAi: callAi,
    getLatestOcr: getManualCapture,
    getVoiceState: function (callback) {
      voiceService.getState().then(callback).catch(function (error) {
        callback({ ok: false, error: error && error.message || String(error) });
      });
    },
    getLatestAi: getLatestAi,
    getAiHistory: getAiHistory,
    readSessions: readSdkSessions,
    writeSessions: writeSdkSessions
  });
  var normalIcon = {
    16: "assets/icons/icon-blue-16.png",
    32: "assets/icons/icon-blue-32.png",
    48: "assets/icons/icon-blue-48.png",
    128: "assets/icons/icon-blue-128.png"
  };
  var captureIcon = {
    16: "assets/icons/icon-gray-16.png",
    32: "assets/icons/icon-gray-32.png",
    48: "assets/icons/icon-gray-48.png",
    128: "assets/icons/icon-gray-128.png"
  };

  function lastErrorMessage() {
    return chrome.runtime.lastError ? chrome.runtime.lastError.message : "";
  }

  function setCaptureIndicator(active) {
    try {
      chrome.action.setIcon({ path: active ? captureIcon : normalIcon }, function () {
        lastErrorMessage();
      });
      chrome.action.setTitle({ title: active ? "WinSpeedBall - OCR selecting" : "WinSpeedBall" });
    } catch (e) {}
  }

  function writeCaptureAuthorization(value) {
    pendingCapture = value || null;
    return new Promise(function (resolve) {
      var area = chrome.storage && chrome.storage.session;
      if (!area) { resolve({ ok: false, error: "Session storage is unavailable." }); return; }
      var callback = function () {
        var error = lastErrorMessage();
        resolve(error ? { ok: false, error: error } : { ok: true });
      };
      try {
        if (value) {
          var data = {};
          data[CAPTURE_AUTH_KEY] = value;
          area.set(data, callback);
        } else area.remove([CAPTURE_AUTH_KEY], callback);
      } catch (error) { resolve({ ok: false, error: error.message || String(error) }); }
    });
  }

  function readCaptureAuthorization() {
    return new Promise(function (resolve) {
      var area = chrome.storage && chrome.storage.session;
      if (!area) { resolve(null); return; }
      try {
        area.get([CAPTURE_AUTH_KEY], function (data) {
          var error = lastErrorMessage();
          var record = !error && data && data[CAPTURE_AUTH_KEY];
          if (!record || typeof record !== "object" || typeof record.token !== "string" || !Number.isInteger(record.tabId) || !Number.isFinite(record.expiresAt)) record = null;
          pendingCapture = record;
          resolve(record);
        });
      } catch (error) { resolve(null); }
    });
  }

  function clearCaptureAuthorization() {
    return writeCaptureAuthorization(null);
  }

  function createCaptureAuthorization(tabId) {
    var token = "";
    try { token = crypto.randomUUID(); } catch (e) { token = Date.now() + "-" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }
    var record = { token: token, tabId: tabId, expiresAt: Date.now() + 120000, stage: "selecting" };
    return writeCaptureAuthorization(record).then(function (saved) {
      if (!saved.ok) throw new Error(saved.error || "Could not save capture authorization.");
      return token;
    });
  }

  function validateCaptureAuthorization(req, sender) {
    return readCaptureAuthorization().then(function (record) {
      if (!record || record.expiresAt < Date.now()) {
        return clearCaptureAuthorization().then(function () { return { ok: false, error: "Capture authorization expired." }; });
      }
      if (!req || req.captureToken !== record.token) return { ok: false, error: "Capture authorization is invalid." };
      if (!sender || !sender.tab || sender.tab.id !== record.tabId) return { ok: false, error: "Capture tab does not match the authorized tab." };
      return { ok: true, record: record };
    });
  }

  function getCapturePreferences(callback) {
    storageGet(["captureSelectionTone", "captureSelectionWidth"], function (data) {
      callback({
        ok: true,
        captureSelectionTone: data.captureSelectionTone,
        captureSelectionWidth: data.captureSelectionWidth
      });
    });
  }

  function isInternalUrl(url) {
    return /^(chrome|edge|about|chrome-extension|devtools):\/\//i.test(String(url || ""));
  }

  function originPatternFromUrl(url) {
    try {
      var parsed = new URL(String(url || ""));
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
      return parsed.protocol + "//" + parsed.hostname + "/*";
    } catch (e) {
      return "";
    }
  }

  function urlMatchesOriginPattern(url, originPattern) {
    return !!originPattern && originPatternFromUrl(url) === originPattern;
  }

  function hasOriginPermission(originPattern) {
    if (!originPattern) return Promise.resolve(false);
    return chrome.permissions.contains({ origins: [originPattern] }).catch(function () { return false; });
  }

  function getActiveSiteAccess(callback) {
    queryScriptTargetTab(function (tab, err) {
      if (err || !tab || tab.id == null) {
        callback({ ok: false, error: err || "No active tab found." });
        return;
      }
      var originPattern = originPatternFromUrl(tab.url || "");
      if (!originPattern) {
        callback({ ok: false, error: "Current page does not support site authorization." });
        return;
      }
      hasOriginPermission(originPattern).then(function (granted) {
        callback({
          ok: true,
          tabId: tab.id,
          url: tab.url || "",
          originPattern: originPattern,
          granted: granted
        });
      });
    });
  }

  function syncRegisteredUserScripts(reason) {
    reason = String(reason || "系统同步");
    return Promise.all([
      new Promise(function (resolve) {
        storageGet(["userScripts"], function (data) {
          resolve(Array.isArray(data.userScripts) ? data.userScripts : []);
        });
      }),
      chrome.permissions.getAll().catch(function () { return { origins: [] }; })
    ]).then(function (values) {
      var scripts = values[0];
      var granted = new Set(values[1] && values[1].origins || []);
      scripts = scripts.map(function (script) {
        if (!script) return script;
        var copy = Object.assign({}, script);
        copy.grantedOrigins = (Array.isArray(script.grantedOrigins) ? script.grantedOrigins : []).filter(function (origin) { return granted.has(origin); });
        return copy;
      });
      return chrome.scripting.getRegisteredContentScripts({ ids: [AUTO_SCRIPT_TRIGGER_ID] }).then(function (registered) {
        var remove = registered && registered.length
          ? chrome.scripting.unregisterContentScripts({ ids: [AUTO_SCRIPT_TRIGGER_ID] })
          : Promise.resolve();
        return remove.then(function () {
          return self.WinSpeedBallUserScriptService.sync(scripts);
        });
      });
    }).then(function (result) {
      appendBackgroundLog("脚本", "同步用户脚本成功", {
        触发原因: reason,
        已注册: result && result.registered || 0,
        功能可用: result && result.available ? "是" : "否"
      }, "success");
      return result;
    }).catch(function (error) {
      var message = error && error.message || String(error || "unknown");
      appendBackgroundLog("脚本", error && error.code === "USER_SCRIPTS_DISABLED" ? "用户脚本功能不可用" : "同步用户脚本失败", {
        触发原因: reason,
        原因: message
      }, error && error.code === "USER_SCRIPTS_DISABLED" ? "warn" : "error");
      return { available: false, registered: 0, error: message, code: error && error.code || "USER_SCRIPT_SYNC_FAILED" };
    });
  }

  function rememberAccessibleTab(tab) {
    if (tab && tab.id != null && tab.url && !isInternalUrl(tab.url)) {
      lastAccessibleTab = { id: tab.id, url: tab.url, windowId: tab.windowId };
    }
  }

  function queryActiveTab(callback) {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        var err = lastErrorMessage();
        if (err) {
          callback(null, err);
          return;
        }
        var tab = tabs && tabs.length ? tabs[0] : null;
        rememberAccessibleTab(tab);
        callback(tab, "");
      });
    } catch (e) {
      callback(null, e.message || String(e));
    }
  }

  function queryScriptTargetTab(callback) {
    queryActiveTab(function (tab, err) {
      if (err) {
        callback(null, err);
        return;
      }
      if (tab && tab.id != null && !isInternalUrl(tab.url || "")) {
        callback(tab, "");
        return;
      }
      if (!lastAccessibleTab || lastAccessibleTab.id == null) {
        callback(null, "\u5f53\u524d\u9875\u9762\u662f\u6d4f\u89c8\u5668\u5185\u90e8\u9875\u9762\uff0c\u4e0d\u80fd\u8fd0\u884c\u811a\u672c\u3002\u8bf7\u5148\u5207\u6362\u5230\u666e\u901a\u7f51\u9875\u518d\u8fd0\u884c\u3002");
        return;
      }
      try {
        chrome.tabs.get(lastAccessibleTab.id, function (savedTab) {
          var getErr = lastErrorMessage();
          if (getErr || !savedTab || savedTab.id == null || isInternalUrl(savedTab.url || "")) {
            callback(null, "\u5f53\u524d\u9875\u9762\u662f\u6d4f\u89c8\u5668\u5185\u90e8\u9875\u9762\uff0c\u4e0d\u80fd\u8fd0\u884c\u811a\u672c\u3002\u8bf7\u5148\u5207\u6362\u5230\u666e\u901a\u7f51\u9875\u518d\u8fd0\u884c\u3002");
            return;
          }
          rememberAccessibleTab(savedTab);
          callback(savedTab, "");
        });
      } catch (e) {
        callback(null, e.message || String(e));
      }
    });
  }

  function readSdkSessions() {
    return new Promise(function (resolve, reject) {
      try {
        chrome.storage.session.get([SDK_SESSIONS_KEY], function (data) {
          var error = lastErrorMessage();
          if (error) {
            reject({ ok: false, code: "SDK_SESSION_STORAGE_FAILED", error: error });
            return;
          }
          var stored = data && data[SDK_SESSIONS_KEY];
          resolve(stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {});
        });
      } catch (error) {
        reject({ ok: false, code: "SDK_SESSION_STORAGE_FAILED", error: error.message || String(error) });
      }
    });
  }

  function writeSdkSessions(sessions) {
    return new Promise(function (resolve) {
      var data = {};
      data[SDK_SESSIONS_KEY] = sessions || {};
      try {
        chrome.storage.session.set(data, function () {
          var error = lastErrorMessage();
          resolve(error ? { ok: false, code: "SDK_SESSION_STORAGE_FAILED", error: error } : { ok: true });
        });
      } catch (error) { resolve({ ok: false, code: "SDK_SESSION_STORAGE_FAILED", error: error.message || String(error) }); }
    });
  }

  function readSdkContextIntents() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.session.get([SDK_CONTEXT_INTENTS_KEY], function (data) {
          var error = lastErrorMessage();
          var stored = !error && data && data[SDK_CONTEXT_INTENTS_KEY];
          resolve(stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {});
        });
      } catch (error) { resolve({}); }
    });
  }

  function writeSdkContextIntents(intents) {
    return new Promise(function (resolve) {
      var data = {};
      data[SDK_CONTEXT_INTENTS_KEY] = intents || {};
      try {
        chrome.storage.session.set(data, function () {
          var error = lastErrorMessage();
          resolve(error ? { ok: false, code: "SDK_CONTEXT_STORAGE_FAILED", error: error } : { ok: true });
        });
      } catch (error) { resolve({ ok: false, code: "SDK_CONTEXT_STORAGE_FAILED", error: error.message || String(error) }); }
    });
  }

  function sdkOrigin(url) {
    try {
      var parsed = new URL(String(url || ""));
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : "";
    } catch (error) { return ""; }
  }

  function resolveSdkContext(capabilities) {
    capabilities = Array.isArray(capabilities) ? capabilities : [];
    var requiresTab = capabilities.some(function (capability) {
      return capability === "video.read" || capability === "video.control" || capability === "page.read" || capability === "book.read" || capability === "book.control" || capability === "ocr.read";
    });
    return new Promise(function (resolve) {
      queryScriptTargetTab(function (tab, error) {
        var origin = tab && sdkOrigin(tab.url);
        var originPattern = origin && originPatternFromUrl(tab.url || "");
        if (!error && tab && tab.id != null && origin && originPattern) {
          resolve({ ok: true, tabId: tab.id, url: tab.url || origin, origin: origin, originPattern: originPattern });
          return;
        }
        if (requiresTab) {
          resolve({ ok: false, code: "SDK_TAB_REQUIRED", error: error || "Open an authorized web page before starting this SDK session." });
          return;
        }
        resolve({ ok: true, tabId: null, url: "https://developer-mode.local/", origin: "https://developer-mode.local", originPattern: "https://developer-mode.local/*" });
      });
    });
  }

  function validateSdkContext(session) {
    if (!session || !Number.isInteger(session.tabId)) {
      return Promise.resolve(session && session.origin === "https://developer-mode.local"
        ? { ok: true }
        : { ok: false, code: "SDK_CONTEXT_CLOSED", error: "SDK page context is unavailable." });
    }
    return new Promise(function (resolve) {
      try {
        chrome.tabs.get(session.tabId, function (tab) {
          var error = lastErrorMessage();
          var origin = tab && sdkOrigin(tab.url);
          if (error || !tab || origin !== session.origin) {
            resolve({ ok: false, code: "SDK_CONTEXT_CHANGED", error: error || "The authorized page navigated to another origin or closed." });
            return;
          }
          var pattern = originPatternFromUrl(tab.url || "");
          hasOriginPermission(pattern).then(function (granted) {
            resolve(granted ? { ok: true } : { ok: false, code: "SDK_ORIGIN_NOT_ALLOWED", error: "Site permission was removed." });
          });
        });
      } catch (error) { resolve({ ok: false, code: "SDK_CONTEXT_CLOSED", error: error.message || String(error) }); }
    });
  }

  function gateAction(featureId, run, respond) {
    return Promise.resolve().then(function () {
      return featureGate.check(featureId);
    }).catch(function (error) {
      return {
        ok: false,
        allowed: false,
        error: String(error && error.message || error || "Feature availability could not be checked.").slice(0, 300)
      };
    }).then(function (gate) {
      if (!gate || gate.allowed !== true) {
        respond({
          ok: false,
          code: "FEATURE_NOT_AVAILABLE",
          feature: featureId,
          error: gate && (gate.reason || gate.error) || "Feature is unavailable."
        });
        return;
      }
      return run();
    });
  }

  function controlActiveTab(command, callback) {
    queryActiveTab(function (tab, error) {
      if (error) {
        callback({ ok: false, error: error });
        return;
      }
      if (!tab || tab.id == null) {
        callback({ ok: false, error: "No active tab found." });
        return;
      }
      if (isInternalUrl(tab.url || "")) {
        callback({ ok: false, error: "Cannot access internal browser pages." });
        return;
      }
      videoService.controlTab(tab.id, command || { type: "GET_STATUS" }, callback);
    });
  }

  function normalizeAlarmInterval(value) {
    var interval = Math.round(Number(value));
    return Number.isFinite(interval) && interval >= MIN_ALARM_INTERVAL_SECONDS
      ? interval
      : MIN_ALARM_INTERVAL_SECONDS;
  }

  function normalizeBookInterval(value, mode) {
    var interval = Math.round(Number(value));
    var minimum = normalizeBookMode(mode) === "chaoxing" ? MIN_CHAOXING_INTERVAL_SECONDS : MIN_ALARM_INTERVAL_SECONDS;
    return Number.isFinite(interval) && interval >= minimum ? interval : minimum;
  }

  function captureVisiblePage(req, sender, callback) {
    validateCaptureAuthorization(req, sender).then(function (authorization) {
      if (!authorization.ok) {
        callback({ ok: false, error: authorization.error });
        return;
      }
      var captureAuthorization = authorization.record;
      try {
      chrome.windows.getCurrent(function (win) {
        var winErr = lastErrorMessage();
        if (winErr) {
          callback({ ok: false, error: winErr });
          return;
        }
        chrome.tabs.query({ active: true, windowId: win.id }, function (tabs) {
          var queryErr = lastErrorMessage();
          if (queryErr) {
            callback({ ok: false, error: queryErr });
            return;
          }
          var activeTab = tabs && tabs[0];
          if (!activeTab || activeTab.id !== captureAuthorization.tabId) {
            callback({ ok: false, error: "The authorized tab is no longer active." });
            return;
          }
          if (activeTab && activeTab.url) {
            try {
              if (/^(chrome|edge|about|chrome-extension|devtools):\/\//i.test(activeTab.url)) {
                callback({ ok: false, error: "Cannot capture internal browser pages." });
                return;
              }
            } catch (e) {}
          }
          chrome.tabs.captureVisibleTab(win.id, { format: "png" }, function (dataUrl) {
            var err = lastErrorMessage();
            if (err) callback({ ok: false, error: err });
            else {
              captureAuthorization.stage = "captured";
              captureAuthorization.expiresAt = Date.now() + 30000;
              writeCaptureAuthorization(captureAuthorization).then(function (saved) {
                callback(saved.ok ? { ok: true, dataUrl: dataUrl } : { ok: false, error: saved.error });
              });
            }
          });
        });
      });
      } catch (e) {
        callback({ ok: false, error: e.message || String(e) });
      }
    }).catch(function (error) { callback({ ok: false, error: error && error.message || String(error) }); });
  }

  function startRegionCapture(callback) {
    queryActiveTab(function (tab, err) {
      if (err) {
        callback({ ok: false, error: err });
        return;
      }
      if (!tab || tab.id == null) {
        callback({ ok: false, error: "No active tab found." });
        return;
      }
      try {
        var url = tab.url || "";
        if (isInternalUrl(url)) {
          callback({ ok: false, error: "Cannot access internal browser pages." });
          return;
        }
      } catch (e) {}

      createCaptureAuthorization(tab.id).then(function (captureToken) {
        function invokeStartCapture(allowInject) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: false },
          world: "ISOLATED",
          func: function (token) {
            if (window.winSpeedBall && typeof window.winSpeedBall.startRegionCapture === "function") {
              return window.winSpeedBall.startRegionCapture(token);
            }
            return { ok: false, error: "content script not loaded" };
          },
          args: [captureToken]
        }, function (results) {
          var execErr = lastErrorMessage();
          var result = results && results[0] && results[0].result;
          if (!execErr && result && result.ok) {
            callback(result);
            return;
          }
          if (!allowInject) {
            setCaptureIndicator(false);
            clearCaptureAuthorization();
            callback(result || { ok: false, error: execErr || "No response from page." });
            return;
          }
          chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: false },
            files: ["content/shadow-hook.js"],
            world: "MAIN"
          }, function () {
            lastErrorMessage();
            chrome.scripting.executeScript({
              target: { tabId: tab.id, allFrames: false },
              files: ["content/player-adapters.js", "content/index.js"]
            }, function () {
              var injectErr = lastErrorMessage();
              if (injectErr) {
                setCaptureIndicator(false);
                clearCaptureAuthorization();
                callback({ ok: false, error: injectErr });
                return;
              }
              invokeStartCapture(false);
            });
          });
        });
        }

        invokeStartCapture(true);
      }).catch(function (error) {
        setCaptureIndicator(false);
        callback({ ok: false, error: error && error.message || String(error) });
      });
    });
  }

  function showAiReplyWindow(req, callback) {
    return aiWindowService.show(req || {}, callback);
  }

  self.WinSpeedBallShowAiReplyWindow = showAiReplyWindow;

  function saveManualCapture(req, sender, callback) {
    validateCaptureAuthorization(req, sender).then(function (authorization) {
      if (!authorization.ok) {
        callback({ ok: false, error: authorization.error });
        return;
      }
      if (!req.dataUrl || !/^data:image\/png;base64,/i.test(req.dataUrl)) {
        callback({ ok: false, error: "Invalid capture image." });
        return;
      }
      var sourceTime = Date.now();
      saveCaptureRecord(req.dataUrl, sourceTime).then(function () {
        storageSet({
          manualCaptureTime: sourceTime,
          manualOcrText: "",
          manualOcrSourceTime: 0,
          manualAiSourceTime: 0,
          manualAiPrompt: "",
          manualAiResponse: "",
          ocrJobSourceTime: sourceTime,
          ocrJobStatus: "queued",
          ocrJobProgress: 0,
          ocrJobError: "",
          ocrJobUpdatedAt: Date.now(),
          aiJobSourceTime: sourceTime,
          aiJobStatus: "waiting",
          aiJobError: "",
          aiJobUpdatedAt: Date.now()
        }, function (res) {
          if (!res || !res.ok) {
            callback(res || { ok: false, error: "Could not save capture metadata." });
            return;
          }
          storageRemove(["manualCaptureDataUrl"], function () {});
          var record = authorization.record;
          record.stage = "saved";
          record.expiresAt = Date.now() + 5000;
          writeCaptureAuthorization(record).then(function () {
            callback({ ok: true, time: sourceTime });
            startOcrJob(req.dataUrl, sourceTime);
          });
        });
      }).catch(function (error) {
        var message = error && error.message ? error.message : String(error || "Could not save capture.");
        appendBackgroundLog("截图", "保存到 IndexedDB 失败", { 原因: message });
        callback({ ok: false, error: message });
      });
    }).catch(function (error) {
      callback({ ok: false, error: error && error.message || String(error) });
    });
  }

  function getSettings(callback) {
    self.WinSpeedBallAiService.getConfig(function (config) {
      storageGet(["rate", "muted", "volume"], function (data) {
        var playback = videoService.getState();
        callback({
          ok: true,
          aiProvider: config.aiProvider,
          aiProviderLabel: config.aiProviderLabel,
          aiBaseUrl: config.aiBaseUrl,
          aiModel: config.aiModel,
          hasApiKey: config.hasApiKey,
          requiresApiKey: config.requiresApiKey,
          configured: config.configured,
          providerOptions: config.providerOptions,
          deepseekBaseUrl: config.deepseekBaseUrl,
          deepseekModel: config.deepseekModel,
          rate: data.rate == null ? playback.rate : data.rate,
          muted: data.muted == null ? playback.muted : data.muted,
          volume: data.volume == null ? playback.volume : data.volume,
          mediaCount: 0,
          applied: 0,
          frameResults: []
        });
      });
    });
  }

  function resolvePersistentTarget(state, callback) {
    if (!state || state.tabId == null || !state.originPattern) {
      callback(null, "Persistent site authorization is missing.");
      return;
    }
    chrome.tabs.get(state.tabId, function (tab) {
      var err = lastErrorMessage();
      if (err || !tab || !urlMatchesOriginPattern(tab.url || "", state.originPattern)) {
        callback(null, err || "The authorized tab has navigated to another site.");
        return;
      }
      hasOriginPermission(state.originPattern).then(function (granted) {
        callback(granted ? tab : null, granted ? "" : "Site permission was removed.");
      });
    });
  }

  function runDouyinNext(callback) {
    var resolveTarget = douyinState.running && douyinState.tabId != null
      ? function (done) { resolvePersistentTarget(douyinState, done); }
      : queryScriptTargetTab;
    resolveTarget(function (tab, err) {
      if (err || !tab || tab.id == null) {
        if (typeof callback === "function") callback({ ok: false, error: err || "No active tab found." });
        return;
      }
      chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: false },
        func: function () {
          var activeElement = document.activeElement;
          var tag = activeElement && String(activeElement.tagName || "").toLowerCase();
          if (activeElement && (tag === "input" || tag === "textarea" || activeElement.isContentEditable)) return "typing";
          var options = { key: "ArrowDown", code: "ArrowDown", keyCode: 40, which: 40, bubbles: true, cancelable: true };
          document.dispatchEvent(new KeyboardEvent("keydown", options));
          if (document.body) document.body.dispatchEvent(new KeyboardEvent("keydown", options));
          window.dispatchEvent(new KeyboardEvent("keydown", options));
          return "ok";
        }
      }, function (results) {
        var executeError = lastErrorMessage();
        if (typeof callback === "function") callback(executeError
          ? { ok: false, error: executeError }
          : { ok: true, result: results && results[0] ? results[0].result : null });
      });
    });
  }

  function saveDouyinState(callback) {
    storageSet({ douyinPanelState: douyinState }, function () {
      if (typeof callback === "function") callback();
    });
  }

  function scheduleDouyinAlarm() {
    try {
      chrome.alarms.clear(DOUYIN_ALARM, function () {
        lastErrorMessage();
        if (!douyinState.running) return;
        chrome.alarms.create(DOUYIN_ALARM, { periodInMinutes: douyinState.interval / 60 });
      });
    } catch (e) {}
  }

  function startDouyinAuto(req, callback) {
    var requested = {
      tabId: Number(req.tabId),
      originPattern: String(req.originPattern || "")
    };
    resolvePersistentTarget(requested, function (tab, targetError) {
      if (!tab) {
        callback({ ok: false, running: false, interval: douyinState.interval, error: targetError || "Site authorization is required." });
        return;
      }
      douyinState.running = true;
      douyinState.tabId = tab.id;
      douyinState.originPattern = requested.originPattern;
      douyinState.interval = normalizeAlarmInterval(req.interval || douyinState.interval);
      saveDouyinState(function () {
        scheduleDouyinAlarm();
        runDouyinNext(function (res) {
          if (!res || !res.ok) {
            douyinState.running = false;
            douyinState.tabId = null;
            douyinState.originPattern = "";
            saveDouyinState(scheduleDouyinAlarm);
            callback({ ok: false, running: false, interval: douyinState.interval, error: (res && res.error) || "\u81ea\u52a8\u7ffb\u9875\u542f\u52a8\u5931\u8d25\u3002" });
            return;
          }
          callback({ ok: true, running: true, interval: douyinState.interval, message: "\u81ea\u52a8\u7ffb\u9875\u5df2\u542f\u52a8\u3002" });
        });
      });
    });
  }

  function stopDouyinAuto(callback) {
    douyinState.running = false;
    douyinState.tabId = null;
    douyinState.originPattern = "";
    saveDouyinState(function () {
      scheduleDouyinAlarm();
      callback({ ok: true, running: false, interval: douyinState.interval, message: "\u81ea\u52a8\u7ffb\u9875\u5df2\u505c\u6b62\u3002" });
    });
  }

  function setDouyinInterval(req, callback) {
    douyinState.interval = normalizeAlarmInterval(req.interval || douyinState.interval);
    saveDouyinState(function () {
      scheduleDouyinAlarm();
      callback({ ok: true, running: douyinState.running, interval: douyinState.interval, message: "\u95f4\u9694\u5df2\u66f4\u65b0\u3002" });
    });
  }

  function handleDouyinPanel(req, callback) {
    if (req.command === "START") startDouyinAuto(req, callback);
    else if (req.command === "STOP") stopDouyinAuto(callback);
    else if (req.command === "NEXT") {
      runDouyinNext(function (res) {
        callback({
          ok: !!(res && res.ok),
          running: douyinState.running,
          interval: douyinState.interval,
          message: res && res.ok ? "\u5df2\u53d1\u9001\u4e0b\u4e00\u6761\u6307\u4ee4\u3002" : "",
          error: res && res.error
        });
      });
    }
    else if (req.command === "SET_INTERVAL") setDouyinInterval(req, callback);
    else if (req.command === "GET_STATE") callback({ ok: true, running: douyinState.running, interval: douyinState.interval, originPattern: douyinState.originPattern });
    else callback({ ok: false, error: "Unknown douyin command.", running: douyinState.running, interval: douyinState.interval });
  }

  function sdkContextChanged(error) {
    return {
      ok: false,
      code: "SDK_CONTEXT_CHANGED",
      error: String(error || "The authorized page changed before the SDK operation could run.")
    };
  }

  function validateSdkBoundPage(target, boundContext, callback) {
    if (!boundContext) {
      callback(null);
      return;
    }
    var tabId = Number(target && target.tabId);
    var expectedOrigin = String(boundContext.origin || "");
    var expectedPattern = String(boundContext.originPattern || "");
    if (!Number.isInteger(tabId) || !expectedOrigin || !expectedPattern) {
      callback(sdkContextChanged("The SDK page binding is incomplete."));
      return;
    }
    try {
      chrome.tabs.get(tabId, function (tab) {
        var tabError = lastErrorMessage();
        var actualOrigin = tab && sdkOrigin(tab.url || "");
        var actualPattern = tab && originPatternFromUrl(tab.url || "");
        callback(tabError || !tab || actualOrigin !== expectedOrigin || actualPattern !== expectedPattern
          ? sdkContextChanged(tabError || "The authorized page navigated to another origin or closed.")
          : null);
      });
    } catch (error) {
      callback(sdkContextChanged(error && error.message || String(error)));
    }
  }

  function bindSdkBookTarget(target, boundContext, callback) {
    if (!boundContext) {
      callback(target, null);
      return;
    }
    if (!chrome.webNavigation || typeof chrome.webNavigation.getAllFrames !== "function") {
      callback(null, sdkContextChanged("Browser document binding is unavailable."));
      return;
    }
    validateSdkBoundPage(target, boundContext, function (contextFailure) {
      if (contextFailure) {
        callback(null, contextFailure);
        return;
      }
      var tabId = Number(target && target.tabId);
      try {
        chrome.webNavigation.getAllFrames({ tabId: tabId }, function (frames) {
          var frameError = lastErrorMessage();
          var list = Array.isArray(frames) ? frames : [];
          var topFrame = list.find(function (frame) { return frame && frame.frameId === 0; });
          var topOrigin = topFrame && sdkOrigin(topFrame.url || "");
          var topPattern = topFrame && originPatternFromUrl(topFrame.url || "");
          if (frameError || !topFrame
              || topOrigin !== String(boundContext.origin || "")
              || topPattern !== String(boundContext.originPattern || "")) {
            callback(null, sdkContextChanged(frameError || "The authorized document changed before the SDK operation could run."));
            return;
          }

          var requestedFrameIds = Array.isArray(target && target.frameIds) ? target.frameIds.map(Number) : null;
          var selected = target && target.allFrames === true
            ? list.slice()
            : (requestedFrameIds
              ? requestedFrameIds.map(function (frameId) {
                return list.find(function (frame) { return frame && frame.frameId === frameId; }) || null;
              })
              : [topFrame]);
          if (!selected.length || selected.some(function (frame) {
            return !frame || typeof frame.documentId !== "string" || !frame.documentId;
          })) {
            callback(null, sdkContextChanged("The authorized document could not be bound safely."));
            return;
          }
          var documentIds = selected.map(function (frame) { return frame.documentId; }).filter(function (documentId, index, values) {
            return values.indexOf(documentId) === index;
          });
          if (!documentIds.length) {
            callback(null, sdkContextChanged("The authorized document could not be bound safely."));
            return;
          }
          callback({ tabId: tabId, documentIds: documentIds }, null);
        });
      } catch (error) {
        callback(null, sdkContextChanged(error && error.message || String(error)));
      }
    });
  }

  function callMainWorldBookCore(target, command, callback, boundContext) {
    bindSdkBookTarget(target, boundContext, function (boundTarget, contextFailure) {
      if (contextFailure) {
        callback([], contextFailure);
        return;
      }
      chrome.scripting.executeScript({
        target: boundTarget,
        world: "MAIN",
        func: function (command) {
          if (window.WinSpeedBallBookCoreV7 && typeof window.WinSpeedBallBookCoreV7.handleCommand === "function") {
            return window.WinSpeedBallBookCoreV7.handleCommand(command);
          }
          return { ok: false, detected: false, error: "main book core required", frameUrl: location.href };
        },
        args: [command]
      }, function (results) {
        var executeError = lastErrorMessage();
        if (!boundContext) {
          callback(results, null);
          return;
        }
        if (executeError) {
          validateSdkBoundPage(target, boundContext, function (postContextFailure) {
            callback([], postContextFailure || { ok: false, error: executeError });
          });
          return;
        }
        validateSdkBoundPage(target, boundContext, function (postContextFailure) {
          callback(postContextFailure ? [] : results, postContextFailure);
        });
      });
    });
  }

  function scheduleSdkLifecycleMaintenance(reason, result) {
    try {
      appendBackgroundLog("SDK", "长期会话生命周期清理失败，已安排重试", {
        触发原因: String(reason || "unknown"),
        错误代码: result && result.code || "SDK_SESSION_CLOSE_FAILED",
        原因: result && result.error || "unknown"
      }, "warn");
    } catch (error) {}
    try {
      chrome.alarms.create(SDK_LIFECYCLE_MAINTENANCE_ALARM, { delayInMinutes: 1 });
    } catch (error) {}
    return result;
  }

  function inspectSdkLifecycleCleanup(reason, operation) {
    return Promise.resolve(operation).then(function (result) {
      return result && result.ok
        ? result
        : scheduleSdkLifecycleMaintenance(reason, result || {
          ok: false,
          code: "SDK_SESSION_CLOSE_FAILED",
          error: "SDK lifecycle cleanup returned no result."
        });
    }, function (error) {
      return scheduleSdkLifecycleMaintenance(reason, {
        ok: false,
        code: "SDK_SESSION_CLOSE_FAILED",
        error: error && error.message || String(error)
      });
    });
  }

  function releaseSdkTabSessions(tabId, preserveOrigin) {
    try {
      return inspectSdkLifecycleCleanup("tab:" + tabId, sdkService.closeSessionsForTab(tabId, preserveOrigin));
    } catch (error) {
      return inspectSdkLifecycleCleanup("tab:" + tabId, Promise.resolve({
          ok: false,
          code: "SDK_TAB_SESSION_CLOSE_FAILED",
          error: error && error.message || String(error),
          tabId: tabId
      }));
    }
  }

  function releaseSdkOriginSessions(originPatterns) {
    try {
      return inspectSdkLifecycleCleanup("permissions", sdkService.closeSessionsForOrigins(originPatterns));
    } catch (error) {
      return inspectSdkLifecycleCleanup("permissions", Promise.resolve({
          ok: false,
          code: "SDK_ORIGIN_SESSION_CLOSE_FAILED",
          error: error && error.message || String(error)
      }));
    }
  }

  function injectMainWorldBookCore(target, callback, boundContext) {
    bindSdkBookTarget(target, boundContext, function (boundTarget, contextFailure) {
      if (contextFailure) {
        callback([], contextFailure);
        return;
      }
      chrome.scripting.executeScript({
        target: boundTarget,
        world: "MAIN",
        files: ["content/book-core-main.js"]
      }, function (results) {
        var executeError = lastErrorMessage();
        if (!boundContext) {
          callback(results, null);
          return;
        }
        if (executeError) {
          validateSdkBoundPage(target, boundContext, function (postContextFailure) {
            callback([], postContextFailure || { ok: false, error: executeError });
          });
          return;
        }
        validateSdkBoundPage(target, boundContext, function (postContextFailure) {
          callback(postContextFailure ? [] : results, postContextFailure);
        });
      });
    });
  }

  function runBookTurn(direction, tabId, originPattern, mode, callback, continueCheck, boundContext) {
    mode = normalizeBookMode(mode);
    function execute(tab) {
      if (!tab || tab.id == null || isInternalUrl(tab.url || "")) {
        callback({ ok: false, error: "No readable page found." });
        return;
      }

      function finishDetection(results) {
        var err = lastErrorMessage();
        if (err) {
          callback({ ok: false, error: err });
          return;
        }
        var selected = bookService.selectFrame(results, direction);
        if (!selected) {
          var frameDiagnostics = (Array.isArray(results) ? results : []).map(function (entry) {
            var result = entry && entry.result || {};
            return {
              frameId: entry && entry.frameId,
              url: result.frameUrl || "",
              hostname: result.hostname || "",
              markers: Number(result.markerCount || 0),
              jpath: !!result.jpathControllerReady,
              pdgDom: !!result.jpathDomReady,
              pdgImages: Number(result.pdgImageCount || 0),
              pdgReady: !!result.chaoxingPdgReady
            };
          }).slice(0, 30);
          callback({
            ok: false,
            detected: false,
            frameCount: Array.isArray(results) ? results.length : 0,
            frameDiagnostics: frameDiagnostics,
            mode: mode,
            error: mode === "image"
              ? "\u672a\u68c0\u6d4b\u5230\u53ef\u81ea\u52a8\u6eda\u52a8\u7684\u56fe\u7247\u5e8f\u5217\u3002\u8bf7\u5148\u6253\u5f00\u56fe\u7247\u5f62\u5f0f\u7684\u56fe\u4e66\u3002"
              : (mode === "chaoxing" ? "CHAOXING_PDG_READER_NOT_FOUND" : "\u672a\u68c0\u6d4b\u5230\u53ef\u63a7\u5236\u7684\u7f51\u9875\u56fe\u4e66\u9605\u8bfb\u5668\u3002\u8bf7\u5148\u6253\u5f00\u56fe\u4e66\u5185\u5bb9\u3002")
          });
          return;
        }
        var detection = Object.assign({}, selected.result, {
          ok: true,
          detected: true,
          frameId: selected.frameId,
          frameCount: Array.isArray(results) ? results.length : 0
        });
        lastBookDetection[mode] = detection;
        if (direction === "DETECT") {
          callback(detection);
          return;
        }
        if (typeof continueCheck === "function" && !continueCheck()) {
          callback({ ok: false, code: "BOOK_TASK_CANCELLED", error: "Book task changed before the page turn was applied." });
          return;
        }
        callMainWorldBookCore({ tabId: tab.id, frameIds: [selected.frameId] }, { type: direction, mode: mode }, function (turnResults, turnContextFailure) {
          if (turnContextFailure) {
            callback(turnContextFailure);
            return;
          }
          var turnError = lastErrorMessage();
          if (turnError) {
            callback({ ok: false, detected: true, frameId: selected.frameId, frameCount: detection.frameCount, error: turnError });
            return;
          }
          var action = turnResults && turnResults[0] && turnResults[0].result;
          if (!action || !action.ok) {
            callback(Object.assign({}, detection, action || {}, {
              ok: false,
              detected: true,
              frameId: selected.frameId,
              frameCount: detection.frameCount,
              reader: detection.reader,
              error: action && action.error || "\u56fe\u4e66\u9605\u8bfb\u5668\u6ca1\u6709\u54cd\u5e94\u7ffb\u9875\u6307\u4ee4\u3002"
            }));
            return;
          }
          var response = Object.assign({}, detection, action, {
            ok: true,
            detected: true,
            frameId: selected.frameId,
            frameCount: detection.frameCount
          });
          lastBookDetection[mode] = response;
          callback(response);
        }, boundContext);
      }

      function detectWithMainCore() {
        callMainWorldBookCore({ tabId: tab.id, allFrames: true }, { type: "DETECT", mode: mode }, function (results, detectionContextFailure) {
          if (detectionContextFailure) {
            callback(detectionContextFailure);
            return;
          }
          var detectionError = lastErrorMessage();
          if (detectionError) {
            callback({ ok: false, error: detectionError });
            return;
          }
          var coreMissing = !results || !results.length || results.some(function (entry) {
            return entry && entry.result && entry.result.error === "main book core required";
          });
          if (!coreMissing) {
            finishDetection(results);
            return;
          }
          injectMainWorldBookCore({ tabId: tab.id, allFrames: true }, function (injectResults, injectContextFailure) {
            if (injectContextFailure) {
              callback(injectContextFailure);
              return;
            }
            var injectError = lastErrorMessage();
            if (injectError) {
              callback({ ok: false, error: injectError });
              return;
            }
            callMainWorldBookCore({ tabId: tab.id, allFrames: true }, { type: "DETECT", mode: mode }, function (retryResults, retryContextFailure) {
              if (retryContextFailure) {
                callback(retryContextFailure);
                return;
              }
              finishDetection(retryResults);
            }, boundContext);
          }, boundContext);
        }, boundContext);
      }

      detectWithMainCore();
    }

    if (tabId != null) {
      if (originPattern) {
        resolvePersistentTarget({ tabId: tabId, originPattern: originPattern }, function (tab, err) {
          if (err || !tab) callback({ ok: false, error: err || "Site authorization is required." });
          else execute(tab);
        });
      } else {
        chrome.tabs.get(tabId, function (tab) {
          var err = lastErrorMessage();
          if (err) callback({ ok: false, error: err });
          else execute(tab);
        });
      }
    } else {
      queryScriptTargetTab(function (tab, err) {
        if (err) callback({ ok: false, error: err });
        else execute(tab);
      });
    }
  }

  function saveBookState(callback) {
    storageSet({ bookPanelState: bookState }, function () {
      if (typeof callback === "function") callback();
    });
  }

  function clearBookRunningState() {
    bookStateGeneration += 1;
    bookState.running = false;
    bookState.tabId = null;
    bookState.originPattern = "";
    bookState.ownerType = "";
    bookState.ownerOrigin = "";
    bookState.ownerScriptId = "";
    bookState.ownerSessionId = "";
    bookState.backCoverCheckIndex = 0;
    bookState.backCoverCheckDueAt = 0;
    bookState.backCoverPageJumpLabel = "";
    bookState.backCoverReached = false;
    bookFastTurnInFlight = false;
    bookBackCoverCheckInFlight = false;
  }

  function captureBookTaskIdentity() {
    return {
      generation: bookStateGeneration,
      tabId: bookState.tabId,
      mode: bookState.mode,
      ownerType: bookState.ownerType,
      ownerOrigin: bookState.ownerOrigin,
      ownerScriptId: bookState.ownerScriptId,
      ownerSessionId: bookState.ownerSessionId
    };
  }

  function sameBookTask(identity) {
    return !!(identity
      && bookState.running
      && bookStateGeneration === identity.generation
      && Number(bookState.tabId) === Number(identity.tabId)
      && bookState.mode === identity.mode
      && bookState.ownerType === identity.ownerType
      && bookState.ownerOrigin === identity.ownerOrigin
      && bookState.ownerScriptId === identity.ownerScriptId
      && bookState.ownerSessionId === identity.ownerSessionId
      && !(identity.ownerType === "sdk" && sdkBookCancelledOwners[identity.ownerSessionId]));
  }

  function sameBookTaskOwner(identity) {
    return !!(identity
      && bookState.running
      && Number(bookState.tabId) === Number(identity.tabId)
      && bookState.mode === identity.mode
      && bookState.ownerType === identity.ownerType
      && bookState.ownerOrigin === identity.ownerOrigin
      && bookState.ownerScriptId === identity.ownerScriptId
      && bookState.ownerSessionId === identity.ownerSessionId);
  }

  function activeSdkBookBoundContext() {
    return bookState.ownerType === "sdk"
      ? { origin: String(bookState.ownerOrigin || ""), originPattern: String(bookState.originPattern || "") }
      : null;
  }

  function normalizeBackCoverCheckIndex(value) {
    var index = Math.floor(Number(value));
    if (!Number.isFinite(index) || index < 0) return 0;
    return Math.min(index, CHAOXING_BACK_COVER_CHECK_DELAYS_SECONDS.length - 1);
  }

  function bookBackCoverMonitorState() {
    var dueAt = Math.max(0, Number(bookState.backCoverCheckDueAt) || 0);
    return {
      backCoverCheckEnabled: !!(bookState.running && bookState.mode === "chaoxing"),
      backCoverCheckIndex: normalizeBackCoverCheckIndex(bookState.backCoverCheckIndex),
      backCoverCheckDueAt: dueAt,
      backCoverNextCheckSeconds: dueAt > 0 ? Math.max(0, Math.ceil((dueAt - Date.now()) / 1000)) : 0,
      backCoverPageJumpLabel: String(bookState.backCoverPageJumpLabel || ""),
      backCoverReached: !!bookState.backCoverReached,
      backCoverCheckSequence: CHAOXING_BACK_COVER_CHECK_DELAYS_SECONDS.slice()
    };
  }

  function readSdkBookStatus(tabId, mode, callback) {
    readSdkBookStatusBound(tabId, mode, null, callback);
  }

  function readSdkBookStatusBound(tabId, mode, boundContext, callback) {
    var targetTabId = Number(tabId);
    var selectedMode = normalizeBookMode(mode);
    runBookTurn("DETECT", targetTabId, "", selectedMode, function (result) {
      var sameTask = Number.isInteger(targetTabId) && Number(bookState.tabId) === targetTabId && bookState.mode === selectedMode;
      var monitor = sameTask ? bookBackCoverMonitorState() : {
        backCoverCheckEnabled: false,
        backCoverCheckIndex: 0,
        backCoverCheckDueAt: 0,
        backCoverNextCheckSeconds: 0,
        backCoverPageJumpLabel: "",
        backCoverReached: false,
        backCoverCheckSequence: CHAOXING_BACK_COVER_CHECK_DELAYS_SECONDS.slice()
      };
      callback(normalizeSdkBookResult(Object.assign({}, result || {}, {
        mode: selectedMode,
        running: !!(sameTask && bookState.running),
        interval: sameTask ? bookState.interval : 0
      }, monitor)));
    }, null, boundContext);
  }

  function sdkBookOriginPattern(session) {
    return String(session && session.originPattern || originPatternFromUrl(session && (session.url || session.origin) || ""));
  }

  function sdkBookBoundContext(session) {
    return {
      origin: String(session && session.origin || ""),
      originPattern: sdkBookOriginPattern(session)
    };
  }

  function sdkBookTaskMatches(session, mode) {
    return !!(bookState.running
      && bookState.ownerType === "sdk"
      && bookState.ownerScriptId === String(session && session.scriptId || "")
      && bookState.ownerSessionId === String(session && session.ownerSessionId || "")
      && Number(bookState.tabId) === Number(session && session.tabId)
      && bookState.mode === mode);
  }

  function validateSdkBookRuntimeSession(session, capability, callback) {
    var runtimeToken = String(session && session.runtimeToken || "");
    if (!runtimeToken) {
      callback({ ok: false, code: "SDK_SESSION_NOT_FOUND", error: "SDK session is no longer active." });
      return;
    }
    readSdkSessions().then(function (sessions) {
      var active = sessions && sessions[runtimeToken];
      var valid = active
        && active.persistent === true
        && !!active.ownerSessionId
        && !!session.ownerSessionId
        && active.scriptId === session.scriptId
        && active.ownerSessionId === session.ownerSessionId
        && active.bookMode === session.bookMode
        && active.origin === session.origin
        && active.originPattern === session.originPattern
        && Number(active.tabId) === Number(session.tabId);
      if (!valid) {
        callback({ ok: false, code: "SDK_SESSION_NOT_FOUND", error: "SDK session is no longer active." });
        return;
      }
      Promise.resolve(permissionService.validateRuntimeToken(runtimeToken, {
        scriptId: active.scriptId,
        sdkVersion: active.sdkVersion,
        capability: capability,
        origin: active.origin,
        codeHash: active.codeHash,
        fingerprint: active.grantFingerprint
      })).then(function (authorization) {
        callback(authorization && authorization.ok && authorization.valid
          ? { ok: true }
          : { ok: false, code: "SDK_SESSION_NOT_FOUND", error: "SDK session is no longer active." });
      }, function () {
        callback({ ok: false, code: "SDK_SESSION_NOT_FOUND", error: "SDK session could not be verified." });
      });
    }, function () {
      callback({ ok: false, code: "SDK_SESSION_NOT_FOUND", error: "SDK session could not be verified." });
    });
  }

  function normalizeSdkBookResult(result) {
    if (!result || result.ok !== false) return result;
    var error = String(result.error || "");
    if (/permission|cannot access contents|missing host|not allowed to access|权限|无权|无法访问|不允许访问/i.test(error)) {
      return Object.assign({}, result, {
        code: "BOOK_PAGE_PERMISSION_REQUIRED",
        error: "Book page permission is missing. Open the Book panel once and authorize the reader page, then run the script again."
      });
    }
    if (/^(?:BOOK_|SDK_)/.test(String(result.code || ""))) return result;
    return Object.assign({}, result, {
      code: "SDK_BOOK_FAILED",
      error: "Book reader operation failed."
    });
  }

  function enqueueSdkBookMutation(task, callback) {
    var operation = sdkBookMutationQueue.then(function () {
      return new Promise(function (resolve) { task(resolve); });
    });
    sdkBookMutationQueue = operation.then(function () {}, function () {});
    operation.then(callback, function (error) {
      callback({ ok: false, code: "SDK_BOOK_FAILED", error: "Book reader operation failed." });
    });
  }

  function sdkBookOwnerId(value) {
    return String(value || "");
  }

  function registerSdkBookPendingOwner(session) {
    var ownerSessionId = sdkBookOwnerId(session && session.ownerSessionId);
    if (!ownerSessionId) return "";
    var pending = sdkBookPendingOwners[ownerSessionId];
    if (pending) pending.count += 1;
    else {
      sdkBookPendingOwners[ownerSessionId] = {
        scriptId: String(session && session.scriptId || ""),
        tabId: Number(session && session.tabId),
        count: 1
      };
    }
    return ownerSessionId;
  }

  function unregisterSdkBookPendingOwner(ownerSessionId) {
    ownerSessionId = sdkBookOwnerId(ownerSessionId);
    var pending = ownerSessionId && sdkBookPendingOwners[ownerSessionId];
    if (!pending) return;
    pending.count -= 1;
    if (pending.count <= 0) delete sdkBookPendingOwners[ownerSessionId];
  }

  function sdkBookOwnerMatches(criteria, ownerSessionId, scriptId, tabId) {
    criteria = criteria || {};
    if (criteria.all === true) return true;
    if (criteria.ownerSessionId) return String(criteria.ownerSessionId) === String(ownerSessionId || "");
    return !!criteria.scriptId
      && String(criteria.scriptId) === String(scriptId || "")
      && (criteria.tabId == null || Number(criteria.tabId) === Number(tabId));
  }

  function cancelSdkBookOwners(criteria) {
    var cancelled = [];
    Object.keys(sdkBookPendingOwners).forEach(function (ownerSessionId) {
      var pending = sdkBookPendingOwners[ownerSessionId] || {};
      if (!sdkBookOwnerMatches(criteria, ownerSessionId, pending.scriptId, pending.tabId)) return;
      sdkBookCancelledOwners[ownerSessionId] = true;
      cancelled.push(ownerSessionId);
    });
    if (bookState.running
        && bookState.ownerType === "sdk"
        && sdkBookOwnerMatches(criteria, bookState.ownerSessionId, bookState.ownerScriptId, bookState.tabId)) {
      sdkBookCancelledOwners[bookState.ownerSessionId] = true;
      if (cancelled.indexOf(bookState.ownerSessionId) < 0) cancelled.push(bookState.ownerSessionId);
      bookStateGeneration += 1;
    }
    return cancelled;
  }

  function clearSdkBookCancellations(ownerSessionIds) {
    (ownerSessionIds || []).forEach(function (ownerSessionId) {
      delete sdkBookCancelledOwners[ownerSessionId];
    });
  }

  function controlSdkBookStateAuthorized(session, request, command, selectedMode, tabId, originPattern, callback) {
    if (command === "START") {
      if (sdkBookCancelledOwners[sdkBookOwnerId(session && session.ownerSessionId)]) {
        callback({ ok: false, code: "BOOK_TASK_CANCELLED", error: "The SDK session was closed before the book task started." });
        return;
      }
      if (bookState.running) {
        callback({
          ok: false,
          code: sdkBookTaskMatches(session, selectedMode) ? "BOOK_TASK_ALREADY_RUNNING" : "BOOK_TASK_CONFLICT",
          error: sdkBookTaskMatches(session, selectedMode)
            ? "This SDK script already has a book auto-turn task."
            : "Another book auto-turn task is already running."
        });
        return;
      }
      handleBookPanel({
        command: "START",
        mode: selectedMode,
        interval: request.interval,
        tabId: tabId,
        originPattern: originPattern,
        sdkOwnerOrigin: String(session.origin || ""),
        sdkOwnerScriptId: String(session.scriptId || ""),
        sdkOwnerSessionId: String(session.ownerSessionId || ""),
        expectedGeneration: bookStateGeneration
      }, function (result) { callback(normalizeSdkBookResult(result)); });
      return;
    }
    if (command === "STOP") {
      if (!bookState.running) {
        callback({ ok: true, detected: false, mode: selectedMode, running: false, interval: 0 });
        return;
      }
      if (bookState.ownerType !== "sdk"
          || bookState.ownerScriptId !== String(session.scriptId || "")
          || bookState.ownerSessionId !== String(session.ownerSessionId || "")
          || Number(bookState.tabId) !== tabId) {
        callback({ ok: false, code: "BOOK_TASK_CONFLICT", error: "The active book task belongs to another page or script." });
        return;
      }
      handleBookPanel({ command: "STOP", mode: bookState.mode }, callback);
      return;
    }
    if (!bookState.running) {
      callback({ ok: false, code: "BOOK_TASK_NOT_RUNNING", error: "Start this script's book auto-turn task before changing its interval." });
      return;
    }
    if (bookState.ownerType !== "sdk"
        || bookState.ownerScriptId !== String(session.scriptId || "")
        || bookState.ownerSessionId !== String(session.ownerSessionId || "")
        || Number(bookState.tabId) !== tabId) {
      callback({ ok: false, code: "BOOK_TASK_CONFLICT", error: "The active book task belongs to another page or script." });
      return;
    }
    if (bookState.mode !== selectedMode) {
      callback({ ok: false, code: "BOOK_TASK_MODE_MISMATCH", error: "The interval mode must match the active book task." });
      return;
    }
    handleBookPanel({ command: "SET_INTERVAL", mode: selectedMode, interval: request.interval }, callback);
  }

  function controlSdkBookState(session, request, command, selectedMode, tabId, originPattern, callback) {
    validateSdkBookRuntimeSession(session, "book.control", function (validation) {
      if (!validation.ok) {
        callback(validation);
        return;
      }
      validateSdkBoundPage({ tabId: tabId }, sdkBookBoundContext(session), function (contextFailure) {
        if (contextFailure) {
          callback(contextFailure);
          return;
        }
        controlSdkBookStateAuthorized(session, request, command, selectedMode, tabId, originPattern, callback);
      });
    });
  }

  function controlSdkBook(session, request, callback) {
    request = request || {};
    var command = String(request.command || "GET_STATUS");
    var authorizedMode = String(session && session.bookMode || "");
    if (["book", "image", "chaoxing"].indexOf(authorizedMode) < 0) {
      callback({ ok: false, code: "SDK_BOOK_MODE_REQUIRED", error: "This SDK session has no book authorization mode." });
      return;
    }
    var selectedMode = request.mode == null ? authorizedMode : normalizeBookMode(request.mode);
    var tabId = Number(session && session.tabId);
    var originPattern = sdkBookOriginPattern(session);
    var boundContext = sdkBookBoundContext(session);

    if (selectedMode !== authorizedMode) {
      callback({ ok: false, code: "BOOK_MODE_NOT_AUTHORIZED", error: "The requested book mode was not approved for this SDK session." });
      return;
    }

    if (!Number.isInteger(tabId)) {
      callback({ ok: false, code: "SDK_TAB_REQUIRED", error: "This book method requires an authorized web page." });
      return;
    }
    if (command === "GET_STATUS") {
      validateSdkBookRuntimeSession(session, "book.read", function (validation) {
        if (!validation.ok) {
          callback(validation);
          return;
        }
        readSdkBookStatusBound(tabId, selectedMode, boundContext, function (result) {
          callback(normalizeSdkBookResult(result));
        });
      });
      return;
    }
    if (!originPattern && (command === "PREV" || command === "NEXT" || command === "START")) {
      callback({ ok: false, code: "BOOK_PAGE_PERMISSION_REQUIRED", error: "Book page authorization is missing." });
      return;
    }
    if (command === "PREV" || command === "NEXT") {
      var turnOwnerSessionId = registerSdkBookPendingOwner(session);
      enqueueSdkBookMutation(function (done) {
        validateSdkBookRuntimeSession(session, "book.control", function (validation) {
          if (!validation.ok) {
            done(validation);
            return;
          }
          runBookTurn(command, tabId, originPattern, selectedMode, function (result) {
            done(normalizeSdkBookResult(Object.assign({}, result || {}, {
              ok: !!(result && result.ok),
              mode: selectedMode,
              running: sdkBookTaskMatches(session, selectedMode),
              interval: sdkBookTaskMatches(session, selectedMode) ? bookState.interval : 0
            })));
          }, function () {
            return !sdkBookCancelledOwners[sdkBookOwnerId(session && session.ownerSessionId)];
          }, boundContext);
        });
      }, function (result) {
        unregisterSdkBookPendingOwner(turnOwnerSessionId);
        callback(result);
      });
      return;
    }
    if (command === "START" || command === "STOP" || command === "SET_INTERVAL") {
      var pendingOwnerSessionId = command === "START" ? registerSdkBookPendingOwner(session) : "";
      var stopCancelledOwnerSessionIds = command === "STOP"
        ? cancelSdkBookOwners({ ownerSessionId: sdkBookOwnerId(session && session.ownerSessionId) })
        : [];
      enqueueSdkBookMutation(function (done) {
        controlSdkBookState(session, request, command, selectedMode, tabId, originPattern, done);
      }, function (result) {
        unregisterSdkBookPendingOwner(pendingOwnerSessionId);
        if (result && result.ok !== false) clearSdkBookCancellations(stopCancelledOwnerSessionIds);
        callback(result);
      });
      return;
    }
    callback({ ok: false, code: "SDK_METHOD_NOT_ALLOWED", error: "Unknown book SDK command." });
  }

  function releaseSdkBookResources(criteria) {
    criteria = criteria || {};
    var cancelledOwnerSessionIds = cancelSdkBookOwners(criteria);
    return new Promise(function (resolve) {
      enqueueSdkBookMutation(function (done) {
        if (!bookState.running || bookState.ownerType !== "sdk") {
          done({ ok: true, released: false });
          return;
        }
        var matches = sdkBookOwnerMatches(
          criteria,
          bookState.ownerSessionId,
          bookState.ownerScriptId,
          bookState.tabId
        );
        if (!matches) {
          done({ ok: true, released: false });
          return;
        }
        handleBookPanel({ command: "STOP", mode: bookState.mode }, function (result) {
          done(Object.assign({ released: !!(result && result.ok) }, result || { ok: false, error: "Book task cleanup failed." }));
        });
      }, function (result) {
        if (result && result.ok !== false) clearSdkBookCancellations(cancelledOwnerSessionIds);
        resolve(result);
      });
    });
  }

  function scheduleBookBackCoverAlarm() {
    chrome.alarms.clear(BOOK_BACK_COVER_ALARM, function () {
      lastErrorMessage();
      if (!bookState.running || bookState.mode !== "chaoxing") return;
      bookState.backCoverCheckIndex = normalizeBackCoverCheckIndex(bookState.backCoverCheckIndex);
      if (!Number.isFinite(Number(bookState.backCoverCheckDueAt)) || Number(bookState.backCoverCheckDueAt) <= 0) {
        bookState.backCoverCheckDueAt = Date.now() + CHAOXING_BACK_COVER_CHECK_DELAYS_SECONDS[bookState.backCoverCheckIndex] * 1000;
      }
      chrome.alarms.create(BOOK_BACK_COVER_ALARM, {
        when: Math.max(Date.now() + MIN_ALARM_INTERVAL_SECONDS * 1000, Number(bookState.backCoverCheckDueAt))
      });
    });
  }

  function runChaoxingBackCoverCheck() {
    if (!bookState.running || bookState.mode !== "chaoxing" || bookBackCoverCheckInFlight) return;
    var taskIdentity = captureBookTaskIdentity();
    bookBackCoverCheckInFlight = true;
    runBookTurn("DETECT", bookState.tabId, bookState.originPattern, "chaoxing", function (res) {
      if (!sameBookTask(taskIdentity)) return;
      bookBackCoverCheckInFlight = false;
      var reachedBackCover = !!(res && res.ok && res.pageJumpDetected && res.isBackCover && String(res.pageJumpLabel || "").replace(/\s+/g, "") === "封底页");
      bookState.backCoverPageJumpLabel = String(res && res.pageJumpLabel || "");
      bookState.backCoverReached = reachedBackCover;
      appendBackgroundLog("\u56fe\u4e66", reachedBackCover ? "\u5df2\u68c0\u6d4b\u5230\u5c01\u5e95\u9875\uff0c\u81ea\u52a8\u505c\u6b62\u5b66\u4e60\u901a\u7ffb\u9605" : "\u5b66\u4e60\u901a\u5c01\u5e95\u9875\u5b9a\u65f6\u68c0\u6d4b\u5b8c\u6210", {
        "\u68c0\u6d4b\u987a\u5e8f": CHAOXING_BACK_COVER_CHECK_DELAYS_SECONDS.join("/") + "s",
        "\u4e0b\u62c9\u6846": res && res.pageJumpDetected ? "#pagejump" : "-",
        "\u5f53\u524d\u9009\u9879": res && res.pageJumpLabel || "-",
        "\u5f53\u524d\u503c": res && res.pageJumpValue || "-",
        "\u539f\u56e0": res && res.error || "-"
      }, reachedBackCover ? "success" : (res && res.ok ? "info" : "warn"));
      if (reachedBackCover) {
        lastBookDetection.chaoxing = Object.assign({}, res, {
          running: false,
          message: "\u5df2\u68c0\u6d4b\u5230\u5c01\u5e95\u9875\uff0c\u5b66\u4e60\u901a\u81ea\u52a8\u7ffb\u9605\u5df2\u505c\u6b62\u3002"
        });
        clearBookRunningState();
        saveBookState(scheduleBookAlarm);
        return;
      }
      bookState.backCoverCheckIndex = Math.min(
        normalizeBackCoverCheckIndex(bookState.backCoverCheckIndex) + 1,
        CHAOXING_BACK_COVER_CHECK_DELAYS_SECONDS.length - 1
      );
      bookState.backCoverCheckDueAt = Date.now() + CHAOXING_BACK_COVER_CHECK_DELAYS_SECONDS[bookState.backCoverCheckIndex] * 1000;
      saveBookState(scheduleBookBackCoverAlarm);
    }, null, activeSdkBookBoundContext());
  }

  function isFastChaoxingBookInterval() {
    return bookState.running && bookState.mode === "chaoxing" && bookState.interval < MIN_ALARM_INTERVAL_SECONDS;
  }

  function clearBookFastTimer() {
    if (bookFastTimer != null) clearTimeout(bookFastTimer);
    bookFastTimer = null;
  }

  function scheduleBookFastTurn() {
    clearBookFastTimer();
    if (!isFastChaoxingBookInterval()) return;
    bookFastTimer = setTimeout(function () {
      bookFastTimer = null;
      runFastBookTurn();
    }, bookState.interval * 1000);
  }

  function runFastBookTurn() {
    if (!isFastChaoxingBookInterval()) return;
    if (bookFastTurnInFlight) {
      scheduleBookFastTurn();
      return;
    }
    var taskIdentity = captureBookTaskIdentity();
    bookFastTurnInFlight = true;
    runBookTurn("NEXT", bookState.tabId, bookState.originPattern, bookState.mode, function (res) {
      if (!sameBookTask(taskIdentity)) return;
      bookFastTurnInFlight = false;
      appendBackgroundLog("\u56fe\u4e66", res && res.ok ? "\u5b66\u4e60\u901a\u5feb\u901f\u81ea\u52a8\u7ffb\u9875\u6210\u529f" : "\u5b66\u4e60\u901a\u5feb\u901f\u81ea\u52a8\u7ffb\u9875\u5931\u8d25", {
        "\u95f4\u9694": bookState.interval + "s",
        "\u9875\u7801": res && res.page || "-",
        "\u65b9\u5f0f": res && res.method || "-",
        "\u539f\u56e0": res && res.error || "-"
      }, res && res.ok ? "success" : "error");
      if (!res || !res.ok) {
        clearBookRunningState();
        saveBookState(scheduleBookAlarm);
        return;
      }
      scheduleBookFastTurn();
    }, function () { return sameBookTask(taskIdentity); }, activeSdkBookBoundContext());
  }

  function scheduleBookAlarm() {
    clearBookFastTimer();
    scheduleBookBackCoverAlarm();
    chrome.alarms.clear(BOOK_ALARM, function () {
      lastErrorMessage();
      if (bookState.running) {
        if (isFastChaoxingBookInterval()) {
          chrome.alarms.create(BOOK_ALARM, { periodInMinutes: MIN_ALARM_INTERVAL_SECONDS / 60 });
          scheduleBookFastTurn();
        } else {
          chrome.alarms.create(BOOK_ALARM, { periodInMinutes: bookState.interval / 60 });
        }
      }
    });
  }

  function handleBookPanel(req, callback) {
    var command = req.command || "GET_STATE";
    var requestedMode = normalizeBookMode(req.mode);
    if (command === "GET_STATE") {
      callback(Object.assign({ ok: true }, lastBookDetection[requestedMode] || {}, {
        ok: true,
        running: bookState.running,
        interval: bookState.interval,
        originPattern: bookState.originPattern,
        mode: bookState.running ? bookState.mode : requestedMode
      }, bookBackCoverMonitorState()));
      return;
    }
    if (command === "DETECT" || command === "NEXT" || command === "PREV") {
      var commandTabId = req.tabId == null ? null : Number(req.tabId);
      var commandOrigin = String(req.originPattern || "");
      runBookTurn(command, commandTabId, commandOrigin, requestedMode, function (res) {
        callback(Object.assign({}, res || {}, {
          ok: !!(res && res.ok),
          running: bookState.running,
          interval: bookState.interval
        }, bookBackCoverMonitorState()));
      });
      return;
    }
    if (command === "STOP") {
      var stoppedMode = bookState.mode;
      clearBookRunningState();
      saveBookState(function () {
        scheduleBookAlarm();
        callback(Object.assign({ ok: true, running: false, interval: bookState.interval, mode: stoppedMode, message: "Book auto turn stopped." }, bookBackCoverMonitorState()));
      });
      return;
    }
    bookState.interval = normalizeBookInterval(req.interval || bookState.interval, requestedMode);
    if (command === "SET_INTERVAL") {
      if (!bookState.running) bookState.mode = requestedMode;
      saveBookState(function () {
        scheduleBookAlarm();
        callback(Object.assign({ ok: true, running: bookState.running, interval: bookState.interval, mode: bookState.mode }, bookBackCoverMonitorState()));
      });
      return;
    }
    if (command === "START") {
      var requested = { tabId: Number(req.tabId), originPattern: String(req.originPattern || "") };
      resolvePersistentTarget(requested, function (tab, err) {
        if (err || !tab || tab.id == null) {
          callback({ ok: false, running: false, interval: bookState.interval, error: err || "Site authorization is required." });
          return;
        }
        if (req.sdkOwnerSessionId && sdkBookCancelledOwners[String(req.sdkOwnerSessionId)]) {
          callback({ ok: false, code: "BOOK_TASK_CANCELLED", error: "The SDK session was closed before the book task started." });
          return;
        }
        if (bookState.running || (req.sdkOwnerScriptId && Number(req.expectedGeneration) !== bookStateGeneration)) {
          callback({ ok: false, code: "BOOK_TASK_CONFLICT", error: "Another book auto-turn task is already running or the task state changed." });
          return;
        }
        bookStateGeneration += 1;
        bookState.running = true;
        bookState.tabId = tab.id;
        bookState.originPattern = requested.originPattern;
        bookState.mode = requestedMode;
        bookState.ownerType = req.sdkOwnerScriptId ? "sdk" : "popup";
        bookState.ownerOrigin = bookState.ownerType === "sdk" ? String(req.sdkOwnerOrigin || "") : "";
        bookState.ownerScriptId = req.sdkOwnerScriptId ? String(req.sdkOwnerScriptId) : "";
        bookState.ownerSessionId = bookState.ownerType === "sdk" ? String(req.sdkOwnerSessionId || "") : "";
        bookState.backCoverCheckIndex = 0;
        bookState.backCoverCheckDueAt = requestedMode === "chaoxing"
          ? Date.now() + CHAOXING_BACK_COVER_CHECK_DELAYS_SECONDS[0] * 1000
          : 0;
        bookState.backCoverPageJumpLabel = "";
        bookState.backCoverReached = false;
        var startedTaskIdentity = captureBookTaskIdentity();
        saveBookState(function () {
          if (!sameBookTask(startedTaskIdentity)) {
            callback({ ok: false, code: "BOOK_TASK_CANCELLED", error: "Book task was cancelled before the first turn." });
            return;
          }
          bookFastTurnInFlight = true;
          runBookTurn("NEXT", bookState.tabId, bookState.originPattern, bookState.mode, function (res) {
            if (!sameBookTask(startedTaskIdentity)) {
              var cancelled = { ok: false, code: "BOOK_TASK_CANCELLED", error: "Book task changed before the first turn completed." };
              if (!sameBookTaskOwner(startedTaskIdentity)) {
                callback(cancelled);
                return;
              }
              clearBookRunningState();
              saveBookState(function () {
                scheduleBookAlarm();
                callback(cancelled);
              });
              return;
            }
            bookFastTurnInFlight = false;
            if (!res.ok) {
              clearBookRunningState();
              saveBookState(scheduleBookAlarm);
            } else {
              scheduleBookAlarm();
            }
            callback(Object.assign({}, res || {}, {
              ok: !!(res && res.ok),
              running: bookState.running,
              interval: bookState.interval
            }, bookBackCoverMonitorState()));
          }, function () { return sameBookTask(startedTaskIdentity); }, activeSdkBookBoundContext());
        });
      });
      return;
    }
    callback({ ok: false, error: "Unknown book command.", running: bookState.running, interval: bookState.interval });
  }

  function executeUserScript(req, callback) {
    var code = String(req.code || "");
    var scriptId = String(req.scriptId || "");
    var permissions = Array.isArray(req.permissions) ? req.permissions : [];
    if (!code.trim()) {
      callback({ ok: false, error: "Script is empty." });
      return;
    }
    if (code.length > MAX_USER_SCRIPT_LENGTH) {
      callback({ ok: false, error: "Script is too large." });
      return;
    }
    if (!scriptId ||
        req.permissionConfirmed !== true ||
        permissions.indexOf("dom") < 0 ||
        permissions.some(function (permission, index, list) {
          return ["dom", "network", "automation"].indexOf(permission) < 0 || list.indexOf(permission) !== index;
        })) {
      callback({ ok: false, error: "脚本权限尚未确认。" });
      return;
    }
    storageGet(["userScripts"], function (data) {
      var scripts = Array.isArray(data.userScripts) ? data.userScripts : [];
      var stored = scripts.find(function (script) { return script && script.id === scriptId; });
      var storedPermissions = stored && stored.meta && Array.isArray(stored.meta.permissions) ? stored.meta.permissions.slice().sort().join(",") : "";
      if (!stored || stored.code !== code || stored.permissionConfirmed !== true || storedPermissions !== permissions.slice().sort().join(",")) {
        callback({ ok: false, error: "脚本内容或权限状态已变化，请重新确认。" });
        return;
      }
      queryScriptTargetTab(function (tab, err) {
      if (err) {
        callback({ ok: false, error: err });
        return;
      }
      if (!tab || tab.id == null) {
        callback({ ok: false, error: "No active tab found." });
        return;
      }
      try { var url = tab.url || ""; if (isInternalUrl(url)) { callback({ ok: false, error: "\u5f53\u524d\u9875\u9762\u662f\u6d4f\u89c8\u5668\u5185\u90e8\u9875\u9762\uff0c\u4e0d\u80fd\u8fd0\u884c\u811a\u672c\u3002\u8bf7\u5148\u5207\u6362\u5230\u666e\u901a\u7f51\u9875\u518d\u8fd0\u884c\u3002" }); return; } } catch (e) {}
        self.WinSpeedBallUserScriptService.execute(scriptId, code, permissions, tab.id).then(function () {
          callback({ ok: true });
        }).catch(function (error) {
          callback({ ok: false, code: error && error.code || "USER_SCRIPT_EXECUTION_FAILED", error: error && error.message || String(error) });
        });
      });
    });
  }

  function getUserScriptsStatus(callback) {
    self.WinSpeedBallUserScriptService.getStatus().then(callback);
  }

  chrome.commands.onCommand.addListener(function (command) {
    if (command === "region-capture") {
      startRegionCapture(function (result) {
        appendBackgroundLog("截图", result && result.ok ? "快捷键框选已启动" : "快捷键框选启动失败", {
          命令: command,
          原因: result && result.error || "-"
        }, result && result.ok ? "success" : "error");
      });
    }
  });

  try {
    chrome.tabs.onActivated.addListener(function (activeInfo) {
      chrome.tabs.get(activeInfo.tabId, function (tab) {
        lastErrorMessage();
        rememberAccessibleTab(tab);
      });
    });
    chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
      if (changeInfo && changeInfo.url) rememberAccessibleTab(tab);
    });
    chrome.tabs.onRemoved.addListener(function (tabId) {
      releaseSdkTabSessions(tabId, "");
    });
  } catch (e) {}

  try {
    chrome.webNavigation.onCommitted.addListener(function (details) {
      if (!details || details.frameId !== 0 || !Number.isInteger(details.tabId)) return;
      if (details.documentLifecycle === "prerender") return;
      releaseSdkTabSessions(details.tabId, sdkOrigin(details.url));
    });
  } catch (e) {}

  try {
    chrome.alarms.onAlarm.addListener(function (alarm) {
      if (!alarm) return;
      if (alarm.name === SDK_LIFECYCLE_MAINTENANCE_ALARM) {
        inspectSdkLifecycleCleanup("maintenance-alarm", sdkService.pruneSessions());
        return;
      }
      if (voiceService.handleAlarm(alarm)) return;
      if (alarm.name === BOOK_BACK_COVER_ALARM) {
        if (bookState.running && bookState.mode === "chaoxing") runChaoxingBackCoverCheck();
        return;
      }
      if (alarm.name === DOUYIN_ALARM && douyinState.running) {
        runDouyinNext(function (res) {
          appendBackgroundLog("自动化", res && res.ok ? "自动下一条执行成功" : "自动下一条执行失败", {
            间隔: douyinState.interval + "s",
            页面响应: res && res.result || "-",
            原因: res && res.error || "-"
          }, res && res.ok ? "success" : "error");
          if (!res || !res.ok) {
            douyinState.running = false;
            saveDouyinState(scheduleDouyinAlarm);
          }
        });
      } else if (alarm.name === BOOK_ALARM && bookState.running) {
        if (isFastChaoxingBookInterval()) {
          if (bookFastTimer == null && !bookFastTurnInFlight) scheduleBookFastTurn();
          return;
        }
        var taskIdentity = captureBookTaskIdentity();
        runBookTurn("NEXT", bookState.tabId, bookState.originPattern, bookState.mode, function (res) {
          if (!sameBookTask(taskIdentity)) return;
          appendBackgroundLog("图书", res && res.ok ? "自动翻页执行成功" : "自动翻页执行失败", {
            方向: "下一页",
            间隔: bookState.interval + "s",
            阅读器: res && res.reader || "-",
            框架: res && res.frameId == null ? "-" : String(res.frameId),
            页码: res && res.page || "-",
            方式: res && res.method || "-",
            模式: bookState.mode === "image" ? "图片自动翻阅" : (bookState.mode === "chaoxing" ? "学习通版本" : "图书自动翻阅"),
            原生强控: res && res.nativeController ? "是" : "否",
            控制环境: res && res.controllerWorld || "-",
            原因: res && res.error || "-"
          }, res && res.ok ? "success" : "error");
          if (!res || !res.ok) {
            clearBookRunningState();
            saveBookState(scheduleBookAlarm);
          }
        }, function () { return sameBookTask(taskIdentity); }, activeSdkBookBoundContext());
      }
    });
  } catch (e) {}

  function notifySdkSessionsRevoked(reason) {
    try {
      chrome.runtime.sendMessage({
        channel: "WSB_INTERNAL",
        version: 1,
        type: "SDK_SESSIONS_REVOKED",
        reason: String(reason || "revoked")
      }, function () { lastErrorMessage(); });
    } catch (error) {}
  }

  function closeAllSdkSessions(reason) {
    return sdkService.closeAllSessions().then(function (result) {
      return sdkContextService.clear().then(function (cleared) {
        if (!result || !result.ok) return result;
        return cleared && cleared.ok === false ? cleared : result;
      });
    }).then(function (result) {
      if (result && result.ok) notifySdkSessionsRevoked(reason);
      return result;
    });
  }

  function updateDeveloperMode(request) {
    if (request.enabled) {
      return closeAllSdkSessions("developer-mode-reset").then(function (closed) {
        if (!closed || !closed.ok) return closed || { ok: false, code: "SDK_SESSION_CLOSE_FAILED", error: "Existing SDK sessions could not be closed." };
        return developerModeService.setEnabled(true, request.confirmed);
      });
    }
    return developerModeService.setEnabled(false, false).then(function (status) {
      return closeAllSdkSessions("developer-mode-disabled").then(function (closed) {
        if (!status || !status.ok) return status;
        status.sessionCleanupOk = !!(closed && closed.ok);
        if (!status.sessionCleanupOk) status.sessionCleanupError = closed && closed.error || "SDK sessions could not be fully cleared.";
        return status;
      });
    });
  }

  function clearPrivacyData(request) {
    var stopsScripts = request.category === "scripts" || request.category === "all";
    var stopsOcr = request.category === "ocr" || request.category === "all";
    var stopsCapture = request.category === "screenshots" || request.category === "all";
    var tasks = [
      stopsScripts ? closeAllSdkSessions("privacy-clear") : Promise.resolve({ ok: true }),
      stopsOcr ? Promise.resolve(cancelOcrJob()).catch(function () { return { ok: false }; }) : Promise.resolve({ ok: true }),
      stopsOcr ? Promise.resolve(voiceService.cancel()).catch(function () { return { ok: false }; }) : Promise.resolve({ ok: true }),
      stopsCapture ? clearCaptureAuthorization() : Promise.resolve({ ok: true })
    ];
    return Promise.all(tasks).then(function () {
      return privacyService.clear(request.category);
    }).then(function (result) {
      if (stopsScripts) notifySdkSessionsRevoked("privacy-clear");
      if (!stopsScripts) return result;
      return syncRegisteredUserScripts("隐私数据清理").then(function () { return result; });
    });
  }

  self.WinSpeedBallMessageRouter.install({
    ocrJobProgress: function (request, sender) {
      if (!isOcrWorkerSender(sender)) return { ok: false, error: "Unauthorized OCR worker message." };
      handleOcrProgress(request);
      return { ok: true };
    },
    ocrJobComplete: function (request, sender) {
      if (!isOcrWorkerSender(sender)) return { ok: false, error: "Unauthorized OCR worker message." };
      handleOcrComplete(request);
      return { ok: true };
    },
    ocrJobFailed: function (request, sender) {
      if (!isOcrWorkerSender(sender)) return { ok: false, error: "Unauthorized OCR worker message." };
      handleOcrFailed(request);
      return { ok: true };
    },
    voiceJobProgress: function (request, sender) {
      if (!isOcrWorkerSender(sender)) return { ok: false, error: "Unauthorized voice worker message." };
      return voiceService.handleProgress(request).then(function () { return { ok: true }; });
    },
    voiceJobComplete: function (request, sender) {
      if (!isOcrWorkerSender(sender)) return { ok: false, error: "Unauthorized voice worker message." };
      return voiceService.handleComplete(request).then(function () { return { ok: true }; });
    },
    voiceJobFailed: function (request, sender) {
      if (!isOcrWorkerSender(sender)) return { ok: false, error: "Unauthorized voice worker message." };
      return voiceService.handleFailed(request).then(function () { return { ok: true }; });
    },
    controlActiveTab: function (request, sender, respond) {
      return gateAction("video.basic", function () { controlActiveTab(request.command, respond); }, respond);
    },
    captureVisiblePage: function (request, sender, respond) {
      return gateAction("ocr.basic", function () { captureVisiblePage(request, sender, respond); }, respond);
    },
    startRegionCapture: function (request, sender, respond) {
      return gateAction("ocr.basic", function () { startRegionCapture(respond); }, respond);
    },
    getCapturePreferences: function (request, sender, respond) { getCapturePreferences(respond); },
    setCaptureIndicator: function (request, sender) {
      return validateCaptureAuthorization(request, sender).then(function (authorization) {
        if (!authorization.ok) return { ok: false, error: authorization.error };
        setCaptureIndicator(!!request.active);
        if (!request.active) return clearCaptureAuthorization().then(function () { return { ok: true }; });
        return { ok: true };
      });
    },
    saveManualCapture: function (request, sender, respond) {
      return gateAction("ocr.basic", function () { saveManualCapture(request, sender, respond); }, respond);
    },
    getManualCapture: function (request, sender, respond) {
      return gateAction("ocr.basic", function () { getManualCapture(respond); }, respond);
    },
    retryManualOcr: function (request, sender, respond) {
      return gateAction("ocr.basic", function () {
        restartLatestOcrJob().then(respond).catch(function (error) {
          respond({ ok: false, error: error && error.message || String(error || "Could not restart OCR.") });
        });
      }, respond);
    },
    startTabAudioCapture: function (request, sender, respond) {
      return gateAction("ocr.basic", function () {
        queryScriptTargetTab(function (tab, error) {
          if (error || !tab) { respond({ ok: false, error: error || "没有可捕获声音的网页标签页。" }); return; }
          voiceService.start(tab).then(respond);
        });
      }, respond);
    },
    stopTabAudioCapture: function (request, sender, respond) {
      return gateAction("ocr.basic", function () { voiceService.stop().then(respond); }, respond);
    },
    cancelTabAudioCapture: function (request, sender, respond) {
      return gateAction("ocr.basic", function () { voiceService.cancel().then(respond); }, respond);
    },
    getTabAudioCaptureState: function (request, sender, respond) {
      return gateAction("ocr.basic", function () { voiceService.getState().then(respond); }, respond);
    },
    getUsageDeclaration: function () { return declarationService.get(); },
    acceptUsageDeclaration: function (request) {
      return userService.getSession().then(function (session) {
        return declarationService.accept({
          version: request.version,
          accepted: request.accepted,
          actorUserId: session && session.authenticated && session.user ? session.user.userId : "guest"
        });
      });
    },
    getUserSession: function () { return userService.getSession(); },
    getSubscription: function () { return subscriptionService.getPlan(); },
    getFeatureGates: function () { return featureGate.list(); },
    canUseFeature: function (request) { return featureGate.check(request.feature); },
    getDeveloperMode: function () { return developerModeService.getStatus(); },
    setDeveloperMode: function (request) { return updateDeveloperMode(request); },
    prepareSdkContext: function (request) { return sdkContextService.prepare(request.capabilities, request.bookMode); },
    prepareSdkSession: function (request) { return sdkService.prepareSession(request); },
    invokeSdkSession: function (request) { return sdkService.invoke(request.sessionToken, request.request); },
    getSdkSessionStatus: function (request) { return sdkService.getSessionStatus(request.sessionToken); },
    closeSdkSession: function (request) { return sdkService.closeSession(request.sessionToken); },
    deleteSdkScriptData: function (request) { return sdkService.deleteScriptLifecycle(request.scriptId); },
    appendPopupLog: function (request) { return self.WinSpeedBallStorageService.appendLogRecord(request.record); },
    clearPopupLogs: function () { return self.WinSpeedBallStorageService.clearLogs(); },
    getPrivacySummary: function () { return privacyService.getSummary(); },
    clearPrivacyData: function (request) { return clearPrivacyData(request); },
    openPinnedWindow: function () { return windowService.openPinnedWindow(); },
    setPinnedWindowTeachingMode: function (request, sender) {
      return windowService.setTeachingMode(request.enabled, sender && sender.tab && sender.tab.windowId);
    },
    registerUser: function (request) { return userService.register(request); },
    loginUser: function (request) { return userService.login(request); },
    logoutUser: function () { return userService.logout(); },
    updateUserProfile: function (request) { return userService.updateProfile(request); },
    changeUserPassword: function (request) { return userService.changePassword(request); },
    deleteUserAccount: function (request) { return userService.deleteAccount(request); },
    saveAiSettings: function (request, sender, respond) { saveAiSettings(request, respond); },
    saveApiKey: function (request, sender, respond) { saveAiSettings(request, respond); },
    getSettings: function (request, sender, respond) { getSettings(respond); },
    getActiveSiteAccess: function (request, sender, respond) { getActiveSiteAccess(respond); },
    showAiReplyWindow: function (request, sender, respond) { showAiReplyWindow(request, respond); },
    executeUserScript: function (request, sender, respond) { executeUserScript(request, respond); },
    getUserScriptsStatus: function (request, sender, respond) { getUserScriptsStatus(respond); },
    douyinPanel: function (request, sender, respond) { handleDouyinPanel(request, respond); },
    bookPanel: function (request, sender, respond) { handleBookPanel(request, respond); },
    syncUserScripts: function () { return syncRegisteredUserScripts("手动同步"); },
    testAI: function (request, sender, respond) {
      return gateAction("ai.basic", function () { callAi({ prompt: "Please reply: connection ok" }, respond); }, respond);
    },
    askAI: function (request, sender, respond, message) {
      return gateAction("ai.basic", function () {
        callAi(message.payload, function (result) {
          if (result && result.ok) showAiReplyWindow({
            content: result.content,
            truncated: result.truncated === true
          }, function () {});
          respond(result);
        });
      }, respond);
    },
    askAiTeaching: function (request, sender, respond, message) {
      return gateAction("ai.basic", function () {
        callAi(message.payload, respond);
      }, respond);
    },
    testDeepSeek: function (request, sender, respond) {
      return gateAction("ai.basic", function () { callAi({ prompt: "Please reply: connection ok" }, respond); }, respond);
    },
    askDeepSeek: function (request, sender, respond, message) {
      return gateAction("ai.basic", function () {
        callAi(message.payload, function (result) {
          if (result && result.ok) showAiReplyWindow({
            content: result.content,
            truncated: result.truncated === true
          }, function () {});
          respond(result);
        });
      }, respond);
    }
  });

  try {
    chrome.permissions.onAdded.addListener(function (permissions) {
      var added = permissions && permissions.origins || [];
      appendBackgroundLog("权限", "网站权限已新增", { 数量: added.length }, "success");
      syncRegisteredUserScripts("网站权限新增");
    });
    chrome.permissions.onRemoved.addListener(function (permissions) {
      var removed = permissions && permissions.origins || [];
      if (removed.length) releaseSdkOriginSessions(removed);
      var stoppedTasks = [];
      if (douyinState.originPattern && removed.indexOf(douyinState.originPattern) >= 0) {
        douyinState.running = false;
        douyinState.tabId = null;
        douyinState.originPattern = "";
        saveDouyinState(scheduleDouyinAlarm);
        stoppedTasks.push("自动下一条");
      }
      if (bookState.originPattern && removed.indexOf(bookState.originPattern) >= 0) {
        clearBookRunningState();
        saveBookState(scheduleBookAlarm);
        stoppedTasks.push("图书自动翻页");
      }
      appendBackgroundLog("权限", "网站权限已移除", {
        数量: removed.length,
        已停止任务: stoppedTasks.length ? stoppedTasks.join("、") : "无"
      }, "warn");
      if (removed.length) {
        storageGet(["userScripts"], function (data) {
          var scripts = Array.isArray(data.userScripts) ? data.userScripts : [];
          var changed = false;
          scripts.forEach(function (script) {
            var origins = Array.isArray(script && script.grantedOrigins) ? script.grantedOrigins : [];
            var nextOrigins = origins.filter(function (origin) { return removed.indexOf(origin) < 0; });
            if (nextOrigins.length !== origins.length) {
              script.grantedOrigins = nextOrigins;
              changed = true;
            }
          });
          if (changed) storageSet({ userScripts: scripts }, function () {});
        });
      }
      syncRegisteredUserScripts("网站权限移除");
    });
    chrome.storage.onChanged.addListener(function (changes, areaName) {
      if (areaName === "local" && changes.userScripts) syncRegisteredUserScripts("脚本配置变更");
    });
  } catch (e) {}

  chrome.runtime.onInstalled.addListener(function (details) {
    if (details && (details.reason === "install" || details.reason === "update")) syncRegisteredUserScripts("扩展安装或更新");
  });

  chrome.windows.onRemoved.addListener(function (windowId) {
    aiWindowService.handleRemoved(windowId);
  });

  chrome.windows.onBoundsChanged.addListener(function (windowInfo) {
    aiWindowService.handleBoundsChanged(windowInfo);
  });

  aiWindowService.hydrate();

  restrictStorageAccess();
  userScriptBridge.install();
  videoService.hydrate();
  storageGet(["douyinPanelState"], function (d) {
    if (d.douyinPanelState) {
      douyinState.running = !!d.douyinPanelState.running;
      douyinState.interval = normalizeAlarmInterval(d.douyinPanelState.interval);
      douyinState.tabId = d.douyinPanelState.tabId == null ? null : d.douyinPanelState.tabId;
      douyinState.originPattern = String(d.douyinPanelState.originPattern || "");
      scheduleDouyinAlarm();
    }
  });
  storageGet(["bookPanelState"], function (d) {
    if (!d.bookPanelState) return;
    bookState.running = !!d.bookPanelState.running;
    bookState.tabId = d.bookPanelState.tabId == null ? null : d.bookPanelState.tabId;
    bookState.originPattern = String(d.bookPanelState.originPattern || "");
    bookState.mode = normalizeBookMode(d.bookPanelState.mode);
    bookState.interval = normalizeBookInterval(d.bookPanelState.interval, bookState.mode);
    bookState.ownerType = bookState.running && d.bookPanelState.ownerType === "sdk" ? "sdk" : (bookState.running ? "popup" : "");
    bookState.ownerOrigin = bookState.ownerType === "sdk" ? String(d.bookPanelState.ownerOrigin || "") : "";
    bookState.ownerScriptId = bookState.ownerType === "sdk" ? String(d.bookPanelState.ownerScriptId || "") : "";
    bookState.ownerSessionId = bookState.ownerType === "sdk" ? String(d.bookPanelState.ownerSessionId || "") : "";
    bookState.backCoverCheckIndex = normalizeBackCoverCheckIndex(d.bookPanelState.backCoverCheckIndex);
    bookState.backCoverCheckDueAt = Number.isFinite(Number(d.bookPanelState.backCoverCheckDueAt))
      ? Math.max(0, Number(d.bookPanelState.backCoverCheckDueAt))
      : 0;
    bookState.backCoverPageJumpLabel = String(d.bookPanelState.backCoverPageJumpLabel || "");
    bookState.backCoverReached = !!d.bookPanelState.backCoverReached;
    if (bookState.ownerType !== "sdk") {
      scheduleBookAlarm();
      return;
    }
    readSdkSessions().then(function (sessions) {
      var ownerToken = Object.keys(sessions || {}).find(function (token) {
        var session = sessions[token];
        return session
          && session.persistent === true
          && !!bookState.ownerSessionId
          && session.scriptId === bookState.ownerScriptId
           && session.ownerSessionId === bookState.ownerSessionId
           && session.bookMode === bookState.mode
           && session.originPattern === bookState.originPattern
           && Number(session.tabId) === Number(bookState.tabId);
      });
      var ownerSession = ownerToken && sessions[ownerToken];
      if (!ownerSession) {
        clearBookRunningState();
        saveBookState(scheduleBookAlarm);
        return;
      }
      bookState.ownerOrigin = String(ownerSession.origin || "");
      Promise.resolve(permissionService.validateRuntimeToken(ownerToken, {
        scriptId: ownerSession.scriptId,
        sdkVersion: ownerSession.sdkVersion,
        capability: "book.control",
        origin: ownerSession.origin,
        codeHash: ownerSession.codeHash,
        fingerprint: ownerSession.grantFingerprint
      })).then(function (authorization) {
        if (!authorization || !authorization.ok || !authorization.valid) clearBookRunningState();
        saveBookState(scheduleBookAlarm);
      }, function () {
        clearBookRunningState();
        saveBookState(scheduleBookAlarm);
      });
    }, function (error) {
      clearBookRunningState();
      saveBookState(scheduleBookAlarm);
      scheduleSdkLifecycleMaintenance("book-session-hydration", error && error.ok === false ? error : {
        ok: false,
        code: "SDK_SESSION_STORAGE_FAILED",
        error: error && error.message || String(error)
      });
    });
  });
  inspectSdkLifecycleCleanup("startup-prune", sdkService.pruneSessions());
  syncRegisteredUserScripts("后台启动");
  resumePendingOcrJob();
})();
