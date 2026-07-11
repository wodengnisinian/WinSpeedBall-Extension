importScripts("background/storage-service.js");
importScripts("background/declaration-service.js");
importScripts("background/user-service.js");
importScripts("background/user-provider.js");
importScripts("background/subscription-service.js");
importScripts("background/feature-gate.js");
importScripts("sdk/contracts.js");
importScripts("sdk/method-schema.js");
importScripts("background/permission-service.js");
importScripts("background/sdk-storage-service.js");
importScripts("background/sdk-context-service.js");
importScripts("background/developer-mode-service.js");
importScripts("background/privacy-service.js");
importScripts("background/window-service.js");
importScripts("background/ai-providers.js");
importScripts("background/ai-service.js");
importScripts("background/ocr-service.js");
importScripts("background/video-service.js");
importScripts("background/sdk-service.js");
importScripts("background/message-schema.js");
importScripts("background/message-router.js");
importScripts("background/user-script-service.js");

/**
 * WinSpeedBall background service worker.
 * ASCII only in this file to avoid encoding issues in extension loading.
 */
(function () {
  "use strict";

  var MAX_USER_SCRIPT_LENGTH = 200000;
  var MIN_ALARM_INTERVAL_SECONDS = 30;
  var AUTO_SCRIPT_TRIGGER_ID = "winspeedball-auto-script-trigger";
  var SDK_SESSIONS_KEY = "sdkRuntimeSessions";
  var SDK_CONTEXT_INTENTS_KEY = "sdkContextIntents";
  var CAPTURE_AUTH_KEY = "pendingCaptureAuthorization";
  var pendingCapture = null;
  var lastAccessibleTab = null;
  var DOUYIN_ALARM = "douyin-panel-auto-next";
  var douyinState = { running: false, interval: MIN_ALARM_INTERVAL_SECONDS, tabId: null, originPattern: "" };
  var BOOK_ALARM = "book-panel-auto-next";
  var bookState = { running: false, interval: MIN_ALARM_INTERVAL_SECONDS, tabId: null, originPattern: "" };
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
  var callAi = self.WinSpeedBallAiService.call;
  var saveAiSettings = self.WinSpeedBallAiService.saveSettings;
  var ocrService = self.WinSpeedBallOcrService;
  var startOcrJob = ocrService.start;
  var handleOcrProgress = ocrService.handleProgress;
  var handleOcrComplete = ocrService.handleComplete;
  var handleOcrFailed = ocrService.handleFailed;
  var cancelOcrJob = ocrService.cancel;
  var getManualCapture = ocrService.getManualCapture;
  var resumePendingOcrJob = ocrService.resume;
  var isOcrWorkerSender = ocrService.isWorkerSender;
  var videoService = self.WinSpeedBallVideoService.create();
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
    consumeContext: function (nonce, capabilities) { return sdkContextService.consume(nonce, capabilities); },
    validateContext: validateSdkContext,
    controlTab: function (tabId, command, callback) { videoService.controlTab(tabId, command, callback); },
    callAi: callAi,
    getLatestOcr: getManualCapture,
    readSessions: readSdkSessions,
    writeSessions: writeSdkSessions
  });
  var normalIcon = {
    16: "icons/icon-blue-16.png",
    32: "icons/icon-blue-32.png",
    48: "icons/icon-blue-48.png",
    128: "icons/icon-blue-128.png"
  };
  var captureIcon = {
    16: "icons/icon-gray-16.png",
    32: "icons/icon-gray-32.png",
    48: "icons/icon-gray-48.png",
    128: "icons/icon-gray-128.png"
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

  function syncRegisteredUserScripts() {
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
    }).catch(function (error) {
      var message = error && error.message || String(error || "unknown");
      if (!error || error.code !== "USER_SCRIPTS_DISABLED") appendBackgroundLog("脚本", "同步用户脚本失败", { 原因: message });
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
    return new Promise(function (resolve) {
      try {
        chrome.storage.session.get([SDK_SESSIONS_KEY], function (data) {
          var error = lastErrorMessage();
          var stored = !error && data && data[SDK_SESSIONS_KEY];
          resolve(stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {});
        });
      } catch (error) { resolve({}); }
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
      return capability === "video.read" || capability === "video.control" || capability === "page.read" || capability === "ocr.read";
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
            resolve({ ok: false, code: "SDK_CONTEXT_CLOSED", error: error || "The authorized page navigated to another origin or closed." });
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
            files: ["shadow_hook.js"],
            world: "MAIN"
          }, function () {
            lastErrorMessage();
            chrome.scripting.executeScript({
              target: { tabId: tab.id, allFrames: false },
              files: ["content/player-adapters.js", "content_script.js"]
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

  function runBookTurn(direction, tabId, originPattern, callback) {
    function execute(tab) {
      if (!tab || tab.id == null || isInternalUrl(tab.url || "")) {
        callback({ ok: false, error: "No readable page found." });
        return;
      }
      chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: false },
        func: function (turnDirection) {
          var nextSelectors = [
            '[rel="next"]', '[data-action="next"]', '[data-page="next"]',
            'button[aria-label*="\u4e0b\u4e00"]', 'a[title*="\u4e0b\u4e00"]',
            '.next-page', '.page-next', '.reader-next', '.pagination-next'
          ];
          var prevSelectors = [
            '[rel="prev"]', '[data-action="prev"]', '[data-page="prev"]',
            'button[aria-label*="\u4e0a\u4e00"]', 'a[title*="\u4e0a\u4e00"]',
            '.prev-page', '.page-prev', '.reader-prev', '.pagination-prev'
          ];
          var selectors = turnDirection === "PREV" ? prevSelectors : nextSelectors;
          for (var i = 0; i < selectors.length; i++) {
            var element = document.querySelector(selectors[i]);
            if (element && !element.disabled) {
              element.click();
              return { ok: true, method: "button", selector: selectors[i] };
            }
          }
          var key = turnDirection === "PREV" ? "ArrowLeft" : "ArrowRight";
          var code = turnDirection === "PREV" ? "ArrowLeft" : "ArrowRight";
          var event = new KeyboardEvent("keydown", { key: key, code: code, bubbles: true, cancelable: true });
          document.dispatchEvent(event);
          if (document.body) document.body.dispatchEvent(new KeyboardEvent("keydown", { key: key, code: code, bubbles: true, cancelable: true }));
          return { ok: true, method: "keyboard", key: key };
        },
        args: [direction]
      }, function (results) {
        var err = lastErrorMessage();
        if (err) callback({ ok: false, error: err });
        else callback((results && results[0] && results[0].result) || { ok: false, error: "No page response." });
      });
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

  function scheduleBookAlarm() {
    chrome.alarms.clear(BOOK_ALARM, function () {
      lastErrorMessage();
      if (bookState.running) {
        chrome.alarms.create(BOOK_ALARM, { periodInMinutes: bookState.interval / 60 });
      }
    });
  }

  function handleBookPanel(req, callback) {
    var command = req.command || "GET_STATE";
    if (command === "GET_STATE") {
      callback({ ok: true, running: bookState.running, interval: bookState.interval, originPattern: bookState.originPattern });
      return;
    }
    if (command === "NEXT" || command === "PREV") {
      runBookTurn(command, null, "", function (res) {
        callback({ ok: !!res.ok, running: bookState.running, interval: bookState.interval, method: res.method, error: res.error });
      });
      return;
    }
    if (command === "STOP") {
      bookState.running = false;
      bookState.tabId = null;
      bookState.originPattern = "";
      saveBookState(function () {
        scheduleBookAlarm();
        callback({ ok: true, running: false, interval: bookState.interval, message: "Book auto turn stopped." });
      });
      return;
    }
    bookState.interval = normalizeAlarmInterval(req.interval || bookState.interval);
    if (command === "SET_INTERVAL") {
      saveBookState(function () {
        scheduleBookAlarm();
        callback({ ok: true, running: bookState.running, interval: bookState.interval });
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
        bookState.running = true;
        bookState.tabId = tab.id;
        bookState.originPattern = requested.originPattern;
        saveBookState(function () {
          scheduleBookAlarm();
          runBookTurn("NEXT", bookState.tabId, bookState.originPattern, function (res) {
            if (!res.ok) {
              bookState.running = false;
              saveBookState(scheduleBookAlarm);
            }
            callback({ ok: !!res.ok, running: bookState.running, interval: bookState.interval, method: res.method, error: res.error });
          });
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
    if (!scriptId || req.permissionConfirmed !== true || !permissions.length) {
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
        self.WinSpeedBallUserScriptService.execute(scriptId, code, tab.id).then(function () {
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
      startRegionCapture(function () {});
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
  } catch (e) {}

  try {
    chrome.alarms.onAlarm.addListener(function (alarm) {
      if (!alarm) return;
      if (alarm.name === DOUYIN_ALARM && douyinState.running) {
        runDouyinNext(function (res) {
          if (!res || !res.ok) {
            douyinState.running = false;
            saveDouyinState(scheduleDouyinAlarm);
          }
        });
      } else if (alarm.name === BOOK_ALARM && bookState.running) {
        runBookTurn("NEXT", bookState.tabId, bookState.originPattern, function (res) {
          if (!res || !res.ok) {
            bookState.running = false;
            bookState.tabId = null;
            bookState.originPattern = "";
            saveBookState(scheduleBookAlarm);
          }
        });
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
      stopsCapture ? clearCaptureAuthorization() : Promise.resolve({ ok: true })
    ];
    return Promise.all(tasks).then(function () {
      return privacyService.clear(request.category);
    }).then(function (result) {
      if (stopsScripts) notifySdkSessionsRevoked("privacy-clear");
      if (!stopsScripts) return result;
      return syncRegisteredUserScripts().then(function () { return result; });
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
    prepareSdkContext: function (request) { return sdkContextService.prepare(request.capabilities); },
    prepareSdkSession: function (request) { return sdkService.prepareSession(request); },
    invokeSdkSession: function (request) { return sdkService.invoke(request.sessionToken, request.request); },
    getSdkSessionStatus: function (request) { return sdkService.getSessionStatus(request.sessionToken); },
    closeSdkSession: function (request) { return sdkService.closeSession(request.sessionToken); },
    deleteSdkScriptData: function (request) { return sdkService.deleteScriptLifecycle(request.scriptId); },
    getPrivacySummary: function () { return privacyService.getSummary(); },
    clearPrivacyData: function (request) { return clearPrivacyData(request); },
    openPinnedWindow: function () { return windowService.openPinnedWindow(); },
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
    executeUserScript: function (request, sender, respond) { executeUserScript(request, respond); },
    getUserScriptsStatus: function (request, sender, respond) { getUserScriptsStatus(respond); },
    douyinPanel: function (request, sender, respond) { handleDouyinPanel(request, respond); },
    bookPanel: function (request, sender, respond) { handleBookPanel(request, respond); },
    syncUserScripts: function () { return syncRegisteredUserScripts(); },
    testAI: function (request, sender, respond) {
      return gateAction("ai.basic", function () { callAi({ prompt: "Please reply: connection ok" }, respond); }, respond);
    },
    askAI: function (request, sender, respond, message) {
      return gateAction("ai.basic", function () { callAi(message.payload, respond); }, respond);
    },
    testDeepSeek: function (request, sender, respond) {
      return gateAction("ai.basic", function () { callAi({ prompt: "Please reply: connection ok" }, respond); }, respond);
    },
    askDeepSeek: function (request, sender, respond, message) {
      return gateAction("ai.basic", function () { callAi(message.payload, respond); }, respond);
    }
  });

  try {
    chrome.permissions.onAdded.addListener(function () {
      syncRegisteredUserScripts();
    });
    chrome.permissions.onRemoved.addListener(function (permissions) {
      var removed = permissions && permissions.origins || [];
      if (douyinState.originPattern && removed.indexOf(douyinState.originPattern) >= 0) {
        douyinState.running = false;
        douyinState.tabId = null;
        douyinState.originPattern = "";
        saveDouyinState(scheduleDouyinAlarm);
      }
      if (bookState.originPattern && removed.indexOf(bookState.originPattern) >= 0) {
        bookState.running = false;
        bookState.tabId = null;
        bookState.originPattern = "";
        saveBookState(scheduleBookAlarm);
      }
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
      syncRegisteredUserScripts();
    });
    chrome.storage.onChanged.addListener(function (changes, areaName) {
      if (areaName === "local" && changes.userScripts) syncRegisteredUserScripts();
    });
  } catch (e) {}

  chrome.runtime.onInstalled.addListener(function (details) {
    if (details && (details.reason === "install" || details.reason === "update")) syncRegisteredUserScripts();
  });

  restrictStorageAccess();
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
    bookState.interval = normalizeAlarmInterval(d.bookPanelState.interval);
    bookState.tabId = d.bookPanelState.tabId == null ? null : d.bookPanelState.tabId;
    bookState.originPattern = String(d.bookPanelState.originPattern || "");
    scheduleBookAlarm();
  });
  syncRegisteredUserScripts();
  resumePendingOcrJob();
})();
