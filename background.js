/**
 * WinSpeedBall background service worker.
 * ASCII only in this file to avoid encoding issues in extension loading.
 */
(function () {
  "use strict";

  var DEFAULT_BASE_URL = "https://api.deepseek.com";
  var DEFAULT_MODEL = "deepseek-chat";
  var MAX_USER_SCRIPT_LENGTH = 200000;
  var MIN_ALARM_INTERVAL_SECONDS = 30;
  var CAPTURE_DB_NAME = "winspeedball-captures";
  var CAPTURE_STORE_NAME = "captures";
  var CAPTURE_RECORD_ID = "latest";
  var OCR_OFFSCREEN_PATH = "ocr_worker.html";
  var offscreenCreating = null;
  var lastOcrProgress = { sourceTime: 0, status: "", percent: -1 };
  var currentRate = 1.0;
  var currentMuted = false;
  var currentVolume = 0.8;
  var lastAccessibleTab = null;
  var DOUYIN_ALARM = "douyin-panel-auto-next";
  var douyinState = { running: false, interval: MIN_ALARM_INTERVAL_SECONDS };
  var BOOK_ALARM = "book-panel-auto-next";
  var bookState = { running: false, interval: MIN_ALARM_INTERVAL_SECONDS, tabId: null };
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

  function safeSend(sendResponse, payload) {
    try {
      sendResponse(payload || { ok: false, error: "empty response" });
    } catch (e) {}
  }

  function setCaptureIndicator(active) {
    try {
      chrome.action.setIcon({ path: active ? captureIcon : normalIcon }, function () {
        lastErrorMessage();
      });
      chrome.action.setTitle({ title: active ? "WinSpeedBall - OCR selecting" : "WinSpeedBall" });
    } catch (e) {}
  }

  function storageGet(keys, callback) {
    try {
      chrome.storage.local.get(keys, function (data) {
        callback(data || {});
      });
    } catch (e) {
      callback({});
    }
  }

  function storageSet(data, callback) {
    try {
      chrome.storage.local.set(data, function () {
        var err = lastErrorMessage();
        callback(err ? { ok: false, error: err } : { ok: true });
      });
    } catch (e) {
      callback({ ok: false, error: e.message || String(e) });
    }
  }

  function isInternalUrl(url) {
    return /^(chrome|edge|about|chrome-extension|devtools):\/\//i.test(String(url || ""));
  }

  function isOcrWorkerSender(sender) {
    return !!(sender && sender.url === chrome.runtime.getURL(OCR_OFFSCREEN_PATH));
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

  function normalizeBaseUrl(baseUrl) {
    baseUrl = String(baseUrl || DEFAULT_BASE_URL).trim();
    return baseUrl.replace(/\/+$/, "");
  }

  function storageRemove(keys, callback) {
    try {
      chrome.storage.local.remove(keys, function () {
        var err = lastErrorMessage();
        if (typeof callback === "function") callback(err ? { ok: false, error: err } : { ok: true });
      });
    } catch (e) {
      if (typeof callback === "function") callback({ ok: false, error: e.message || String(e) });
    }
  }

  function appendBackgroundLog(category, message, details) {
    storageGet(["popupLogs"], function (data) {
      var suffix = [];
      Object.keys(details || {}).forEach(function (key) {
        var value = String(details[key] == null ? "" : details[key]).replace(/\s+/g, " ").trim().slice(0, 180);
        if (value) suffix.push(key + "=" + value);
      });
      var entry = "[" + new Date().toLocaleTimeString() + "] [" + category + "] " + message + (suffix.length ? " | " + suffix.join(" | ") : "");
      var logs = Array.isArray(data.popupLogs) ? data.popupLogs : [];
      logs.unshift(entry);
      storageSet({ popupLogs: logs.slice(0, 300) }, function () {});
    });
  }

  function openCaptureDb() {
    return new Promise(function (resolve, reject) {
      var request;
      try {
        request = indexedDB.open(CAPTURE_DB_NAME, 1);
      } catch (e) {
        reject(e);
        return;
      }
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(CAPTURE_STORE_NAME)) db.createObjectStore(CAPTURE_STORE_NAME, { keyPath: "id" });
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error("Could not open capture database.")); };
    });
  }

  function saveCaptureRecord(dataUrl, sourceTime) {
    return openCaptureDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var transaction = db.transaction(CAPTURE_STORE_NAME, "readwrite");
        transaction.objectStore(CAPTURE_STORE_NAME).put({
          id: CAPTURE_RECORD_ID,
          sourceTime: sourceTime,
          dataUrl: dataUrl
        });
        transaction.oncomplete = function () { db.close(); resolve(); };
        transaction.onerror = function () { var error = transaction.error; db.close(); reject(error || new Error("Could not save capture.")); };
        transaction.onabort = transaction.onerror;
      });
    });
  }

  function getCaptureRecord() {
    return openCaptureDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var request = db.transaction(CAPTURE_STORE_NAME, "readonly").objectStore(CAPTURE_STORE_NAME).get(CAPTURE_RECORD_ID);
        request.onsuccess = function () { var result = request.result || null; db.close(); resolve(result); };
        request.onerror = function () { var error = request.error; db.close(); reject(error || new Error("Could not read capture.")); };
      });
    });
  }

  function getLatestCapture() {
    return getCaptureRecord().then(function (record) {
      if (record && record.dataUrl) return record;
      return new Promise(function (resolve) {
        storageGet(["manualCaptureDataUrl", "manualCaptureTime"], function (data) {
          if (!data.manualCaptureDataUrl) {
            resolve(null);
            return;
          }
          var migrated = {
            id: CAPTURE_RECORD_ID,
            sourceTime: Number(data.manualCaptureTime || Date.now()),
            dataUrl: data.manualCaptureDataUrl
          };
          saveCaptureRecord(migrated.dataUrl, migrated.sourceTime).then(function () {
            storageRemove(["manualCaptureDataUrl"], function () {});
            resolve(migrated);
          }).catch(function () { resolve(migrated); });
        });
      });
    });
  }

  function ensureOcrOffscreen() {
    if (offscreenCreating) return offscreenCreating;
    var offscreenUrl = chrome.runtime.getURL(OCR_OFFSCREEN_PATH);
    offscreenCreating = chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    }).then(function (contexts) {
      if (contexts && contexts.length) return;
      return chrome.offscreen.createDocument({
        url: OCR_OFFSCREEN_PATH,
        reasons: ["WORKERS"],
        justification: "Run the local Tesseract worker after a region capture while the popup is closed."
      });
    }).then(function () {
      offscreenCreating = null;
    }).catch(function (error) {
      offscreenCreating = null;
      throw error;
    });
    return offscreenCreating;
  }

  function updateOcrJobState(sourceTime, status, progress, error) {
    storageSet({
      ocrJobSourceTime: sourceTime,
      ocrJobStatus: status,
      ocrJobProgress: Number(progress || 0),
      ocrJobStage: status === "recognizing" ? "recognizing" : "",
      ocrJobError: error || "",
      ocrJobUpdatedAt: Date.now()
    }, function () {});
  }

  function startOcrJob(dataUrl, sourceTime) {
    updateOcrJobState(sourceTime, "queued", 0, "");
    appendBackgroundLog("OCR", "后台任务已创建", { 任务: "#" + String(sourceTime).slice(-8), 图片大小: Math.round(dataUrl.length / 1024) + "KB" });
    ensureOcrOffscreen().then(function () {
      chrome.runtime.sendMessage({
        target: "offscreen-ocr",
        action: "recognizeCapture",
        sourceTime: sourceTime,
        dataUrl: dataUrl
      }, function (response) {
        var err = lastErrorMessage();
        if (err || !response || !response.ok) {
          var message = err || response && response.error || "OCR worker did not accept the job.";
          updateOcrJobState(sourceTime, "failed", 0, message);
          appendBackgroundLog("OCR", "后台任务启动失败", { 任务: "#" + String(sourceTime).slice(-8), 原因: message });
          return;
        }
        updateOcrJobState(sourceTime, "recognizing", 0, "");
      });
    }).catch(function (error) {
      var message = error && error.message ? error.message : String(error || "Could not create OCR worker.");
      updateOcrJobState(sourceTime, "failed", 0, message);
      appendBackgroundLog("OCR", "隐藏工作页创建失败", { 任务: "#" + String(sourceTime).slice(-8), 原因: message });
    });
  }

  function buildBackgroundAutoOcrPrompt(sourceText, template) {
    template = String(template || "").trim();
    if (!template) return sourceText;
    if (template.indexOf("{{OCR}}") >= 0) return template.split("{{OCR}}").join(sourceText);
    return template + "\n\n" + sourceText;
  }

  function handleOcrProgress(req) {
    var sourceTime = Number(req.sourceTime || 0);
    var status = String(req.status || "recognizing");
    var percent = Math.max(0, Math.min(100, Math.round(Number(req.progress || 0) * 100)));
    if (!sourceTime) return;
    if (lastOcrProgress.sourceTime === sourceTime && lastOcrProgress.status === status && percent < lastOcrProgress.percent + 5) return;
    lastOcrProgress = { sourceTime: sourceTime, status: status, percent: percent };
    storageGet(["manualCaptureTime"], function (data) {
      if (Number(data.manualCaptureTime || 0) !== sourceTime) return;
      updateOcrJobState(sourceTime, "recognizing", percent / 100, "");
      storageSet({ ocrJobStage: status }, function () {});
    });
  }

  function handleOcrComplete(req) {
    var sourceTime = Number(req.sourceTime || 0);
    var recognizedText = String(req.text || "").trim();
    storageGet(["manualCaptureTime", "manualAiSourceTime", "manualAiResponse", "autoSendOcrToAi", "autoOcrPromptTemplate"], function (data) {
      if (!sourceTime || Number(data.manualCaptureTime || 0) !== sourceTime) {
        appendBackgroundLog("OCR", "忽略过期识别结果", { 任务: "#" + String(sourceTime).slice(-8) });
        return;
      }
      storageSet({
        manualOcrText: recognizedText,
        manualOcrSourceTime: sourceTime,
        ocrJobSourceTime: sourceTime,
        ocrJobStatus: recognizedText ? "completed" : "empty",
        ocrJobProgress: 1,
        ocrJobStage: "",
        ocrJobError: "",
        ocrJobUpdatedAt: Date.now()
      }, function () {
        appendBackgroundLog("OCR", recognizedText ? "后台识别完成" : "后台识别结果为空", {
          任务: "#" + String(sourceTime).slice(-8),
          字数: recognizedText.length
        });
        if (!recognizedText || data.autoSendOcrToAi !== true) {
          if (recognizedText) storageSet({ aiJobStatus: "disabled", aiJobError: "" }, function () {});
          return;
        }
        if (Number(data.manualAiSourceTime || 0) === sourceTime && data.manualAiResponse) {
          storageSet({ aiJobSourceTime: sourceTime, aiJobStatus: "completed", aiJobError: "" }, function () {});
          return;
        }
        var prompt = buildBackgroundAutoOcrPrompt(recognizedText, data.autoOcrPromptTemplate);
        storageSet({
          manualAiPrompt: prompt,
          aiJobSourceTime: sourceTime,
          aiJobStatus: "requesting",
          aiJobError: "",
          aiJobUpdatedAt: Date.now()
        }, function () {});
        appendBackgroundLog("AI", "后台自动发送开始", {
          任务: "#" + String(sourceTime).slice(-8),
          OCR字数: recognizedText.length,
          提示词字数: prompt.length
        });
        callDeepSeek({ prompt: prompt, autoOcrSourceTime: sourceTime }, function (result) {
          storageSet({
            aiJobSourceTime: sourceTime,
            aiJobStatus: result && result.ok ? "completed" : "failed",
            aiJobError: result && result.ok ? "" : result && result.error || "AI request failed.",
            aiJobUpdatedAt: Date.now()
          }, function () {});
          appendBackgroundLog("AI", result && result.ok ? "后台自动发送成功" : "后台自动发送失败", {
            任务: "#" + String(sourceTime).slice(-8),
            模型: result && result.model || "-",
            回复字数: result && result.ok ? String(result.content || "").length : 0,
            原因: result && result.ok ? "-" : result && result.error || "未知错误"
          });
        });
      });
    });
  }

  function handleOcrFailed(req) {
    var sourceTime = Number(req.sourceTime || 0);
    var error = String(req.error || "OCR failed.");
    storageGet(["manualCaptureTime"], function (data) {
      if (!sourceTime || Number(data.manualCaptureTime || 0) !== sourceTime) return;
      updateOcrJobState(sourceTime, "failed", 0, error);
      appendBackgroundLog("OCR", "后台识别失败", { 任务: "#" + String(sourceTime).slice(-8), 原因: error });
    });
  }

  function resumePendingOcrJob() {
    storageGet(["manualCaptureTime", "ocrJobSourceTime", "ocrJobStatus"], function (data) {
      var sourceTime = Number(data.manualCaptureTime || 0);
      var status = String(data.ocrJobStatus || "");
      if (!sourceTime || Number(data.ocrJobSourceTime || 0) !== sourceTime || !/^(queued|recognizing|loading)/.test(status)) return;
      ensureOcrOffscreen().then(function () {
        chrome.runtime.sendMessage({ target: "offscreen-ocr", action: "getOcrWorkerState" }, function (response) {
          lastErrorMessage();
          if (response && Number(response.runningSourceTime || 0) === sourceTime) return;
          getLatestCapture().then(function (capture) {
            if (capture && Number(capture.sourceTime || 0) === sourceTime && capture.dataUrl) startOcrJob(capture.dataUrl, sourceTime);
          }).catch(function () {});
        });
      }).catch(function () {});
    });
  }

  function normalizeAlarmInterval(value) {
    var interval = Math.round(Number(value));
    return Number.isFinite(interval) && interval >= MIN_ALARM_INTERVAL_SECONDS
      ? interval
      : MIN_ALARM_INTERVAL_SECONDS;
  }

  function buildChatCompletionsUrl(baseUrl) {
    var normalized = normalizeBaseUrl(baseUrl);
    try {
      var parsed = new URL(normalized);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return { ok: false, error: "Base URL must start with http:// or https://." };
      }
      parsed.pathname = parsed.pathname.replace(/\/+$/, "") + "/chat/completions";
      parsed.search = "";
      parsed.hash = "";
      return { ok: true, url: parsed.toString() };
    } catch (e) {
      return { ok: false, error: "Base URL is invalid." };
    }
  }

  function aggregateFrameResults(results, command) {
    var frameResults = [];
    var totalMedia = 0;
    var totalApplied = 0;
    var firstOk = null;
    var specialPlayerDetected = false;
    var specialPlayerType = "";
    var reason = "";
    var mediaInfo = null;

    (results || []).forEach(function (item) {
      var result = item && item.result ? item.result : item;
      if (!result) result = { ok: false, error: "no result", mediaCount: 0, applied: 0 };
      frameResults.push(result);

      if (result.ok && !firstOk) firstOk = result;
      if (!mediaInfo && result.ok && result.mediaCount > 0) mediaInfo = result;
      totalMedia += result.mediaCount || 0;
      totalApplied += result.applied || 0;

      if (result.specialPlayerDetected) {
        specialPlayerDetected = true;
        specialPlayerType = result.specialPlayerType || specialPlayerType;
        reason = result.reason || reason;
      }
    });

    if (firstOk && command && command.type !== "GET_STATUS" && command.type !== "EXTRACT_PAGE_TEXT") {
      currentRate = firstOk.rate;
      currentMuted = firstOk.muted;
      currentVolume = firstOk.volume;
      storageSet({ rate: currentRate, muted: currentMuted, volume: currentVolume }, function () {});
    }

    var output = {
      ok: !!firstOk,
      rate: firstOk ? firstOk.rate : currentRate,
      muted: firstOk ? firstOk.muted : currentMuted,
      volume: firstOk ? firstOk.volume : currentVolume,
      keepPlaying: firstOk ? !!firstOk.keepPlaying : false,
      duration: mediaInfo ? mediaInfo.duration || 0 : 0,
      currentTime: mediaInfo ? mediaInfo.currentTime || 0 : 0,
      remainingTime: mediaInfo ? mediaInfo.remainingTime || 0 : 0,
      paused: mediaInfo ? !!mediaInfo.paused : true,
      mediaTag: mediaInfo ? mediaInfo.mediaTag || "" : "",
      mediaCount: totalMedia,
      applied: totalApplied,
      frameCount: results ? results.length : 0,
      frameResults: frameResults
    };

    if (!firstOk) output.error = "No controllable media was found on this page.";
    if (specialPlayerDetected) {
      output.specialPlayerDetected = true;
      output.specialPlayerType = specialPlayerType;
      output.reason = reason;
    }
    return output;
  }

  function sendCommandToAllFrames(tabId, command, callback) {
    function executeCommand(done) {
      chrome.scripting.executeScript({
        target: { tabId: tabId, allFrames: true },
        world: "ISOLATED",
        func: function (cmd) {
          if (window.winSpeedBall && window.winSpeedBall.handleCommand) {
            return window.winSpeedBall.handleCommand(cmd);
          }
          return {
            ok: false,
            error: "content script not loaded",
            url: location.href,
            mediaCount: 0,
            applied: 0
          };
        },
        args: [command]
      }, done);
    }

    try {
      executeCommand(function (results) {
        var err = lastErrorMessage();
        if (err) {
          callback({
            ok: false,
            error: err,
            rate: currentRate,
            muted: currentMuted,
            volume: currentVolume,
            mediaCount: 0,
            applied: 0,
            frameCount: 0,
            frameResults: []
          });
          return;
        }
        var unloaded = (results || []).length > 0 && (results || []).every(function (item) {
          return item && item.result && item.result.error === "content script not loaded";
        });
        if (!unloaded) {
          callback(aggregateFrameResults(results || [], command));
          return;
        }

        chrome.scripting.executeScript({
          target: { tabId: tabId, allFrames: true },
          files: ["shadow_hook.js"],
          world: "MAIN"
        }, function () {
          lastErrorMessage();
          chrome.scripting.executeScript({
          target: { tabId: tabId, allFrames: true },
          files: ["content_script.js"]
          }, function () {
            var injectErr = lastErrorMessage();
            if (injectErr) {
              callback({ ok: false, error: injectErr, mediaCount: 0, applied: 0, frameResults: [] });
              return;
            }
            executeCommand(function (retryResults) {
              var retryErr = lastErrorMessage();
              if (retryErr) callback({ ok: false, error: retryErr, mediaCount: 0, applied: 0, frameResults: [] });
              else callback(aggregateFrameResults(retryResults || [], command));
            });
          });
        });
      });
    } catch (e) {
      callback({
        ok: false,
        error: e.message || String(e),
        rate: currentRate,
        muted: currentMuted,
        volume: currentVolume,
        mediaCount: 0,
        applied: 0,
        frameCount: 0,
        frameResults: []
      });
    }
  }

  function controlActiveTab(command, callback) {
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
        var tabUrl = tab.url || "";
        if (/^(chrome|edge|about|chrome-extension|devtools):\/\//i.test(tabUrl)) {
          callback({ ok: false, error: "Cannot access internal browser pages." });
          return;
        }
      } catch (e) {}
      sendCommandToAllFrames(tab.id, command || { type: "GET_STATUS" }, callback);
    });
  }

  function captureVisiblePage(callback) {
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
            else callback({ ok: true, dataUrl: dataUrl });
          });
        });
      });
    } catch (e) {
      callback({ ok: false, error: e.message || String(e) });
    }
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

      function invokeStartCapture(allowInject) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: false },
          world: "ISOLATED",
          func: function () {
            if (window.winSpeedBall && window.winSpeedBall.startRegionCapture) {
              return window.winSpeedBall.startRegionCapture();
            }
            return { ok: false, error: "content script not loaded" };
          }
        }, function (results) {
          var execErr = lastErrorMessage();
          var result = results && results[0] && results[0].result;
          if (!execErr && result && result.ok) {
            callback(result);
            return;
          }
          if (!allowInject) {
            setCaptureIndicator(false);
            callback(result || { ok: false, error: execErr || "No response from page." });
            return;
          }
          chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: false },
            files: ["content_script.js"]
          }, function () {
            var injectErr = lastErrorMessage();
            if (injectErr) {
              setCaptureIndicator(false);
              callback({ ok: false, error: injectErr });
              return;
            }
            invokeStartCapture(false);
          });
        });
      }

      invokeStartCapture(true);
    });
  }

  function saveManualCapture(req, callback) {
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
        callback({ ok: true, time: sourceTime });
        startOcrJob(req.dataUrl, sourceTime);
      });
    }).catch(function (error) {
      var message = error && error.message ? error.message : String(error || "Could not save capture.");
      appendBackgroundLog("截图", "保存到 IndexedDB 失败", { 原因: message });
      callback({ ok: false, error: message });
    });
  }

  function getManualCapture(callback) {
    getLatestCapture().then(function (capture) {
      storageGet([
        "manualCaptureTime", "manualOcrText", "manualOcrSourceTime", "manualAiSourceTime", "manualAiPrompt", "manualAiResponse",
        "ocrJobSourceTime", "ocrJobStatus", "ocrJobProgress", "ocrJobStage", "ocrJobError", "aiJobSourceTime", "aiJobStatus", "aiJobError"
      ], function (d) {
        var sourceTime = capture ? Number(capture.sourceTime || 0) : Number(d.manualCaptureTime || 0);
        callback({
          ok: true,
          dataUrl: capture && capture.dataUrl || "",
          time: sourceTime,
          ocrText: Number(d.manualOcrSourceTime || 0) === sourceTime ? (d.manualOcrText || "") : "",
          ocrStatus: Number(d.ocrJobSourceTime || 0) === sourceTime ? (d.ocrJobStatus || "") : "",
          ocrProgress: Number(d.ocrJobSourceTime || 0) === sourceTime ? Number(d.ocrJobProgress || 0) : 0,
          ocrStage: Number(d.ocrJobSourceTime || 0) === sourceTime ? (d.ocrJobStage || "") : "",
          ocrError: Number(d.ocrJobSourceTime || 0) === sourceTime ? (d.ocrJobError || "") : "",
          aiSourceTime: d.manualAiSourceTime || 0,
          aiPrompt: Number(d.manualAiSourceTime || 0) === sourceTime ? (d.manualAiPrompt || "") : "",
          aiResponse: Number(d.manualAiSourceTime || 0) === sourceTime ? (d.manualAiResponse || "") : "",
          aiStatus: Number(d.aiJobSourceTime || 0) === sourceTime ? (d.aiJobStatus || "") : "",
          aiError: Number(d.aiJobSourceTime || 0) === sourceTime ? (d.aiJobError || "") : ""
        });
      });
    }).catch(function (error) {
      callback({ ok: false, error: error && error.message ? error.message : String(error || "Could not read capture.") });
    });
  }

  function callDeepSeek(payload, callback) {
    payload = payload || {};
    storageGet(["deepseekApiKey", "deepseekBaseUrl", "deepseekModel"], function (settings) {
      var apiKey = String(settings.deepseekApiKey || "").trim();
      var baseUrl = normalizeBaseUrl(settings.deepseekBaseUrl);
      var model = String(settings.deepseekModel || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
      var endpoint = buildChatCompletionsUrl(baseUrl);

      if (!apiKey) {
        callback({ ok: false, error: "Please set DeepSeek API Key first." });
        return;
      }
      if (!endpoint.ok) {
        callback({ ok: false, error: endpoint.error });
        return;
      }

      var messages = payload.messages || [
        { role: "system", content: "You are a study assistant. Help with understanding, summary, explanation, key point extraction, and translation only. Do not help with cheating, auto answering, or auto submitting forms." },
        { role: "user", content: String(payload.prompt || "") }
      ];

      fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + apiKey
        },
        body: JSON.stringify({
          model: model,
          messages: messages,
          temperature: payload.temperature == null ? 0.3 : payload.temperature
        })
      }).then(function (resp) {
        return resp.text().then(function (bodyText) {
          var data = {};
          try { data = JSON.parse(bodyText); } catch (e) {}
          if (!resp.ok) {
            callback({ ok: false, error: (data.error && data.error.message) || bodyText || ("HTTP " + resp.status) });
            return;
          }
          var result = {
            ok: true,
            content: data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : "",
            model: model
          };
          var autoOcrSourceTime = Number(payload.autoOcrSourceTime || 0);
          if (!autoOcrSourceTime) {
            callback(result);
            return;
          }
          storageSet({
            manualAiSourceTime: autoOcrSourceTime,
            manualAiPrompt: String(payload.prompt || ""),
            manualAiResponse: result.content
          }, function () {
            callback(result);
          });
        });
      }).catch(function (error) {
        callback({ ok: false, error: error.message || String(error) });
      });
    });
  }

  function saveApiKey(req, callback) {
    var data = {};
    if (Object.prototype.hasOwnProperty.call(req, "apiKey")) data.deepseekApiKey = String(req.apiKey || "").trim();
    if (Object.prototype.hasOwnProperty.call(req, "baseUrl")) data.deepseekBaseUrl = normalizeBaseUrl(req.baseUrl);
    if (Object.prototype.hasOwnProperty.call(req, "model")) data.deepseekModel = String(req.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    storageSet(data, callback);
  }

  function getSettings(callback) {
    storageGet(["deepseekApiKey", "deepseekBaseUrl", "deepseekModel", "rate", "muted", "volume"], function (d) {
      callback({
        ok: true,
        hasApiKey: !!d.deepseekApiKey,
        deepseekBaseUrl: d.deepseekBaseUrl || DEFAULT_BASE_URL,
        deepseekModel: d.deepseekModel || DEFAULT_MODEL,
        rate: d.rate == null ? currentRate : d.rate,
        muted: d.muted == null ? currentMuted : d.muted,
        volume: d.volume == null ? currentVolume : d.volume,
        mediaCount: 0,
        applied: 0,
        frameResults: []
      });
    });
  }

  function parseUserScriptMeta(code) {
    var meta = { name: "", matches: [], includes: [], excludes: [] };
    var source = String(code || "");
    var start = source.indexOf("// ==UserScript==");
    var end = source.indexOf("// ==/UserScript==");
    if (start < 0 || end < start) return meta;
    source.slice(start, end).split(/\r?\n/).forEach(function (line) {
      var m = line.match(/^\s*\/\/\s*@(\S+)\s+(.+?)\s*$/);
      if (!m) return;
      var key = m[1].toLowerCase();
      var value = m[2];
      if (key === "name" && !meta.name) meta.name = value;
      else if (key === "match") meta.matches.push(value);
      else if (key === "include") meta.includes.push(value);
      else if (key === "exclude") meta.excludes.push(value);
    });
    return meta;
  }

  function wildcardToRegExp(pattern) {
    pattern = String(pattern || "").trim();
    if (!pattern) return null;
    if (pattern === "<all_urls>") pattern = "*://*/*";
    var escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    try {
      return new RegExp("^" + escaped + "$");
    } catch (e) {
      return null;
    }
  }

  function patternMatches(pattern, url) {
    var re = wildcardToRegExp(pattern);
    return !!(re && re.test(url));
  }

  function userScriptMatchesUrl(script, url) {
    var code = String(script && script.code || "");
    var meta = script && script.meta ? script.meta : parseUserScriptMeta(code);
    var matches = (meta.matches || []).concat(meta.includes || []);
    var excludes = meta.excludes || [];
    if (!matches.length) return false;
    if (excludes.some(function (pattern) { return patternMatches(pattern, url); })) return false;
    return matches.some(function (pattern) { return patternMatches(pattern, url); });
  }

  function runUserScriptInTarget(target, code, callback) {
    code = String(code || "");
    if (!code.trim()) {
      callback({ ok: false, error: "Script is empty." });
      return;
    }
    if (code.length > MAX_USER_SCRIPT_LENGTH) {
      callback({ ok: false, error: "Script is too large." });
      return;
    }
    try {
      chrome.scripting.executeScript({
        target: target,
        world: "ISOLATED",
        func: function (source) {
          var run = new Function(source);
          return run();
        },
        args: [code]
      }, function (results) {
        var execErr = lastErrorMessage();
        if (execErr) {
          callback({ ok: false, error: execErr });
          return;
        }
        callback({ ok: true, result: results && results[0] ? results[0].result : null });
      });
    } catch (e) {
      callback({ ok: false, error: e.message || String(e) });
    }
  }

  function runDouyinNext(callback) {
    var code = [
      "(function(){",
      "function isTyping(){var el=document.activeElement;if(!el)return false;var tag=(el.tagName||'').toLowerCase();return tag==='input'||tag==='textarea'||el.isContentEditable;}",
      "if(isTyping())return 'typing';",
      "var opts={key:'ArrowDown',code:'ArrowDown',keyCode:40,which:40,bubbles:true,cancelable:true};",
      "document.dispatchEvent(new KeyboardEvent('keydown',opts));",
      "document.body&&document.body.dispatchEvent(new KeyboardEvent('keydown',opts));",
      "window.dispatchEvent(new KeyboardEvent('keydown',opts));",
      "return 'ok';",
      "})();"
    ].join("");
    queryScriptTargetTab(function (tab, err) {
      if (err || !tab || tab.id == null) {
        if (typeof callback === "function") callback({ ok: false, error: err || "No active tab found." });
        return;
      }
      runUserScriptInTarget({ tabId: tab.id, allFrames: false }, code, function (res) {
        if (typeof callback === "function") callback(res);
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
    douyinState.running = true;
    douyinState.interval = normalizeAlarmInterval(req.interval || douyinState.interval);
    saveDouyinState(function () {
      scheduleDouyinAlarm();
      runDouyinNext(function (res) {
        if (!res || !res.ok) {
          douyinState.running = false;
          saveDouyinState(scheduleDouyinAlarm);
          callback({ ok: false, running: false, interval: douyinState.interval, error: (res && res.error) || "\u81ea\u52a8\u7ffb\u9875\u542f\u52a8\u5931\u8d25\u3002" });
          return;
        }
        callback({ ok: true, running: true, interval: douyinState.interval, message: "\u81ea\u52a8\u7ffb\u9875\u5df2\u542f\u52a8\u3002" });
      });
    });
  }

  function stopDouyinAuto(callback) {
    douyinState.running = false;
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
    else if (req.command === "GET_STATE") callback({ ok: true, running: douyinState.running, interval: douyinState.interval });
    else callback({ ok: false, error: "Unknown douyin command.", running: douyinState.running, interval: douyinState.interval });
  }

  function runBookTurn(direction, tabId, callback) {
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
      chrome.tabs.get(tabId, function (tab) {
        var err = lastErrorMessage();
        if (err) callback({ ok: false, error: err });
        else execute(tab);
      });
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
      callback({ ok: true, running: bookState.running, interval: bookState.interval });
      return;
    }
    if (command === "NEXT" || command === "PREV") {
      runBookTurn(command, null, function (res) {
        callback({ ok: !!res.ok, running: bookState.running, interval: bookState.interval, method: res.method, error: res.error });
      });
      return;
    }
    if (command === "STOP") {
      bookState.running = false;
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
      queryScriptTargetTab(function (tab, err) {
        if (err || !tab || tab.id == null) {
          callback({ ok: false, running: false, interval: bookState.interval, error: err || "No active tab found." });
          return;
        }
        bookState.running = true;
        bookState.tabId = tab.id;
        saveBookState(function () {
          scheduleBookAlarm();
          runBookTurn("NEXT", bookState.tabId, function (res) {
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
    if (!code.trim()) {
      callback({ ok: false, error: "Script is empty." });
      return;
    }
    if (code.length > MAX_USER_SCRIPT_LENGTH) {
      callback({ ok: false, error: "Script is too large." });
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
      runUserScriptInTarget({ tabId: tab.id, allFrames: false }, code, callback);
    });
  }

  function runMatchingUserScripts(req, sender, callback) {
    var tabId = sender && sender.tab && sender.tab.id;
    var frameId = sender && sender.frameId;
    var url = String(req.url || (sender && sender.url) || "");
    if (tabId == null || !url || /^(chrome|edge|about|chrome-extension|devtools):\/\//i.test(url)) {
      callback({ ok: false, error: "Unsupported page." });
      return;
    }
    storageGet(["userScripts"], function (data) {
      var scripts = Array.isArray(data.userScripts) ? data.userScripts : [];
      var runnable = scripts.filter(function (script) {
        var property = String(script && script.meta && script.meta.property || "").trim();
        var validProperty = /^(\u89c6\u9891|AI|OCR|\u56fe\u4e66|\u811a\u672c|\u5176\u4ed6)$/i.test(property);
        return script && validProperty && script.enabled !== false && String(script.code || "").length <= MAX_USER_SCRIPT_LENGTH && userScriptMatchesUrl(script, url);
      });
      var index = 0;
      var okCount = 0;
      var failCount = 0;

      function next() {
        if (index >= runnable.length) {
          if (!okCount) {
            callback({ ok: true, ran: 0, failed: failCount });
            return;
          }
          storageSet({ userScripts: scripts }, function () {
            callback({ ok: true, ran: okCount, failed: failCount });
          });
          return;
        }
        var script = runnable[index++];
        runUserScriptInTarget({ tabId: tabId, frameIds: [frameId == null ? 0 : frameId] }, script.code, function (res) {
          if (res && res.ok) {
            okCount++;
            script.lastRunAt = Date.now();
          }
          else failCount++;
          next();
        });
      }

      next();
    });
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
        runBookTurn("NEXT", bookState.tabId, function (res) {
          if (!res || !res.ok) {
            bookState.running = false;
            saveBookState(scheduleBookAlarm);
          }
        });
      }
    });
  } catch (e) {}

  chrome.runtime.onMessage.addListener(function (req, sender, sendResponse) {
    var responded = false;

    function respond(payload) {
      if (responded) return;
      responded = true;
      safeSend(sendResponse, payload);
    }

    try {
      req = req || {};
      if (req.action === "ocrJobProgress") {
        if (!isOcrWorkerSender(sender)) {
          respond({ ok: false, error: "Unauthorized OCR worker message." });
          return true;
        }
        handleOcrProgress(req);
        respond({ ok: true });
      }
      else if (req.action === "ocrJobComplete") {
        if (!isOcrWorkerSender(sender)) {
          respond({ ok: false, error: "Unauthorized OCR worker message." });
          return true;
        }
        handleOcrComplete(req);
        respond({ ok: true });
      }
      else if (req.action === "ocrJobFailed") {
        if (!isOcrWorkerSender(sender)) {
          respond({ ok: false, error: "Unauthorized OCR worker message." });
          return true;
        }
        handleOcrFailed(req);
        respond({ ok: true });
      }
      else if (req.action === "controlActiveTab") controlActiveTab(req.command, respond);
      else if (req.action === "captureVisiblePage") captureVisiblePage(respond);
      else if (req.action === "startRegionCapture") startRegionCapture(respond);
      else if (req.action === "setCaptureIndicator") {
        setCaptureIndicator(!!req.active);
        respond({ ok: true });
      }
      else if (req.action === "saveManualCapture") saveManualCapture(req, respond);
      else if (req.action === "getManualCapture") getManualCapture(respond);
      else if (req.action === "saveApiKey") saveApiKey(req, respond);
      else if (req.action === "getSettings") getSettings(respond);
      else if (req.action === "executeUserScript") executeUserScript(req, respond);
      else if (req.action === "douyinPanel") handleDouyinPanel(req, respond);
      else if (req.action === "bookPanel") handleBookPanel(req, respond);
      else if (req.action === "runMatchingUserScripts") runMatchingUserScripts(req, sender, respond);
      else if (req.action === "testDeepSeek") callDeepSeek({ prompt: "Please reply: connection ok" }, respond);
      else if (req.action === "askDeepSeek") callDeepSeek(req.payload || {}, respond);
      else respond({ ok: false, error: "Unknown action." });
    } catch (e) {
      respond({ ok: false, error: e.message || String(e) });
    }

    return true;
  });

  storageGet(["rate", "muted", "volume"], function (d) {
    if (d.rate != null) currentRate = d.rate;
    if (d.muted != null) currentMuted = d.muted;
    if (d.volume != null) currentVolume = d.volume;
  });
  storageGet(["douyinPanelState"], function (d) {
    if (d.douyinPanelState) {
      douyinState.running = !!d.douyinPanelState.running;
      douyinState.interval = normalizeAlarmInterval(d.douyinPanelState.interval);
      scheduleDouyinAlarm();
    }
  });
  storageGet(["bookPanelState"], function (d) {
    if (!d.bookPanelState) return;
    bookState.running = !!d.bookPanelState.running;
    bookState.interval = normalizeAlarmInterval(d.bookPanelState.interval);
    bookState.tabId = d.bookPanelState.tabId == null ? null : d.bookPanelState.tabId;
    scheduleBookAlarm();
  });
  resumePendingOcrJob();
})();
