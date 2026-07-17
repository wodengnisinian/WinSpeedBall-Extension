(function (global) {
  "use strict";

  var OCR_OFFSCREEN_PATH = "ocr/offscreen.html";
  var offscreenCreating = null;
  var lastProgress = { sourceTime: 0, status: "", percent: -1 };
  var requestSequence = 0;
  var activeSourceTime = 0;
  var storage = global.WinSpeedBallStorageService;
  var ai = global.WinSpeedBallAiService;
  var featureGate = global.WinSpeedBallFeatureGate;

  function normalizeText(value) {
    var normalizer = global.WinSpeedBallTextNormalizer;
    return normalizer && typeof normalizer.normalize === "function"
      ? normalizer.normalize(value || "")
      : String(value || "").trim();
  }

  function lastErrorMessage() {
    return chrome.runtime.lastError ? chrome.runtime.lastError.message : "";
  }

  function isWorkerSender(sender) {
    return !!(sender && !sender.tab && sender.url === chrome.runtime.getURL(OCR_OFFSCREEN_PATH));
  }

  function ensureOffscreen() {
    if (offscreenCreating) return offscreenCreating;
    var offscreenUrl = chrome.runtime.getURL(OCR_OFFSCREEN_PATH);
    offscreenCreating = chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    }).then(function (contexts) {
      if (contexts && contexts.length) return;
      return chrome.offscreen.createDocument({
        url: OCR_OFFSCREEN_PATH,
        reasons: ["WORKERS", "USER_MEDIA"],
        justification: "Run local OCR and capture tab audio for local speech recognition while the popup is closed."
      });
    }).then(function () {
      offscreenCreating = null;
    }).catch(function (error) {
      offscreenCreating = null;
      throw error;
    });
    return offscreenCreating;
  }

  function closeOffscreen(completedTask) {
    completedTask = String(completedTask || "");
    return new Promise(function (resolve) {
      storage.get(["ocrJobStatus", "voiceJobStatus"], function (data) {
        var ocrActive = /^(queued|loading|recognizing)$/.test(String(data.ocrJobStatus || ""));
        var voiceActive = /^(starting|recording|loading|transcribing)$/.test(String(data.voiceJobStatus || ""));
        if ((completedTask !== "ocr" && ocrActive) || (completedTask !== "voice" && voiceActive)) {
          resolve({ ok: true, closed: false, busy: true });
          return;
        }
        closeOffscreenNow().then(resolve);
      });
    });
  }

  function closeOffscreenNow() {
    var pending = offscreenCreating || Promise.resolve();
    return pending.catch(function () {}).then(function () {
      offscreenCreating = null;
      return chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [chrome.runtime.getURL(OCR_OFFSCREEN_PATH)]
      }).then(function (contexts) {
        if (!contexts || !contexts.length) return { ok: true, closed: false };
        return chrome.offscreen.closeDocument().then(function () { return { ok: true, closed: true }; });
      });
    }).catch(function (error) {
      return { ok: false, error: error && error.message || String(error) };
    });
  }

  function finishOffscreen(sourceTime) {
    storage.get(["ocrJobSourceTime"], function (data) {
      if (activeSourceTime && activeSourceTime !== sourceTime) return;
      if (Number(data.ocrJobSourceTime || 0) !== sourceTime) return;
      activeSourceTime = 0;
      closeOffscreen("ocr");
    });
  }

  function cancel() {
    return new Promise(function (resolve) {
      storage.get(["manualCaptureTime"], function (data) {
        var sourceTime = Number(data.manualCaptureTime || activeSourceTime || 0);
        activeSourceTime = 0;
        storage.set({ ocrCancelledSourceTime: sourceTime }, function () {
          closeOffscreen("ocr").then(resolve);
        });
      });
    });
  }

  function updateJobState(sourceTime, status, progress, error) {
    storage.set({
      ocrJobSourceTime: sourceTime,
      ocrJobStatus: status,
      ocrJobProgress: Number(progress || 0),
      ocrJobStage: status === "recognizing" ? "recognizing" : "",
      ocrJobError: error || "",
      ocrJobUpdatedAt: Date.now()
    });
  }

  function start(dataUrl, sourceTime) {
    activeSourceTime = sourceTime;
    storage.set({ ocrCancelledSourceTime: 0 });
    updateJobState(sourceTime, "queued", 0, "");
    storage.appendLog("OCR", "后台任务已创建", {
      任务: "#" + String(sourceTime).slice(-8),
      图片大小: Math.round(dataUrl.length / 1024) + "KB"
    });
    ensureOffscreen().then(function () {
      chrome.runtime.sendMessage({
        version: 1,
        action: "recognizeCapture",
        source: "background",
        requestId: "background-" + Date.now() + "-" + (++requestSequence),
        payload: {
          target: "offscreen-ocr",
          sourceTime: sourceTime,
          dataUrl: dataUrl
        }
      }, function (response) {
        var error = lastErrorMessage();
        if (error || !response || !response.ok) {
          var message = error || response && response.error || "OCR worker did not accept the job.";
          updateJobState(sourceTime, "failed", 0, message);
          storage.appendLog("OCR", "后台任务启动失败", { 任务: "#" + String(sourceTime).slice(-8), 原因: message });
          finishOffscreen(sourceTime);
          return;
        }
        updateJobState(sourceTime, "recognizing", 0, "");
      });
    }).catch(function (error) {
      var message = error && error.message ? error.message : String(error || "Could not create OCR worker.");
      updateJobState(sourceTime, "failed", 0, message);
      storage.appendLog("OCR", "隐藏工作页创建失败", { 任务: "#" + String(sourceTime).slice(-8), 原因: message });
      finishOffscreen(sourceTime);
    });
  }

  function buildAutoPrompt(sourceText, template) {
    template = String(template || "").trim();
    if (!template) return sourceText;
    if (template.indexOf("{{OCR}}") >= 0) return template.split("{{OCR}}").join(sourceText);
    return template + "\n\n" + sourceText;
  }

  function callAiWhenAvailable(payload, sourceTime, callback) {
    Promise.resolve().then(function () {
      return featureGate.check("ai.basic");
    }).catch(function (error) {
      return { ok: false, allowed: false, error: error && error.message || String(error || "Feature availability could not be checked.") };
    }).then(function (gate) {
      storage.get(["manualCaptureTime", "ocrCancelledSourceTime"], function (current) {
        if (Number(current.manualCaptureTime || 0) !== sourceTime || Number(current.ocrCancelledSourceTime || 0) === sourceTime) return;
        if (!gate || gate.allowed !== true) {
          var reason = String(gate && (gate.reason || gate.error) || "AI feature is unavailable.").slice(0, 300);
          storage.set({
            aiJobSourceTime: sourceTime,
            aiJobStatus: "failed",
            aiJobError: reason,
            aiJobUpdatedAt: Date.now()
          });
          storage.appendLog("AI", "Automatic OCR request blocked by FeatureGate", { feature: "ai.basic", reason: reason });
          return;
        }
        ai.call(payload, callback);
      });
    });
  }

  function handleProgress(request) {
    var sourceTime = Number(request.sourceTime || 0);
    var status = String(request.status || "recognizing");
    var percent = Math.max(0, Math.min(100, Math.round(Number(request.progress || 0) * 100)));
    if (!sourceTime) return;
    if (lastProgress.sourceTime === sourceTime && lastProgress.status === status && percent < lastProgress.percent + 5) return;
    lastProgress = { sourceTime: sourceTime, status: status, percent: percent };
    storage.get(["manualCaptureTime", "ocrCancelledSourceTime"], function (data) {
      if (Number(data.manualCaptureTime || 0) !== sourceTime || Number(data.ocrCancelledSourceTime || 0) === sourceTime) return;
      updateJobState(sourceTime, "recognizing", percent / 100, "");
      storage.set({ ocrJobStage: status });
    });
  }

  function handleComplete(request) {
    var sourceTime = Number(request.sourceTime || 0);
    var recognizedText = normalizeText(request.text);
    storage.get(["manualCaptureTime", "ocrCancelledSourceTime", "manualAiSourceTime", "manualAiResponse", "autoSendOcrToAi", "autoOcrPromptTemplate"], function (data) {
      if (!sourceTime || Number(data.manualCaptureTime || 0) !== sourceTime || Number(data.ocrCancelledSourceTime || 0) === sourceTime) {
        storage.appendLog("OCR", "忽略过期识别结果", { 任务: "#" + String(sourceTime).slice(-8) });
        finishOffscreen(sourceTime);
        return;
      }
      finishOffscreen(sourceTime);
      storage.set({
        manualOcrText: recognizedText,
        manualOcrSourceTime: sourceTime,
        ocrJobSourceTime: sourceTime,
        ocrJobStatus: recognizedText ? "completed" : "empty",
        ocrJobProgress: 1,
        ocrJobStage: "",
        ocrJobError: "",
        ocrJobUpdatedAt: Date.now()
      }, function () {
        storage.appendLog("OCR", recognizedText ? "后台识别完成" : "后台识别结果为空", {
          任务: "#" + String(sourceTime).slice(-8),
          字数: recognizedText.length
        });
        if (!recognizedText || data.autoSendOcrToAi !== true) {
          if (recognizedText) storage.set({ aiJobStatus: "disabled", aiJobError: "" });
          return;
        }
        if (Number(data.manualAiSourceTime || 0) === sourceTime && data.manualAiResponse) {
          storage.set({ aiJobSourceTime: sourceTime, aiJobStatus: "completed", aiJobError: "" });
          return;
        }
        var prompt = buildAutoPrompt(recognizedText, data.autoOcrPromptTemplate);
        storage.set({
          manualAiPrompt: prompt,
          aiJobSourceTime: sourceTime,
          aiJobStatus: "requesting",
          aiJobError: "",
          aiJobUpdatedAt: Date.now()
        });
        storage.appendLog("AI", "后台自动发送开始", {
          任务: "#" + String(sourceTime).slice(-8),
          OCR字数: recognizedText.length,
          提示词字数: prompt.length
        });
        callAiWhenAvailable({ prompt: prompt, autoOcrSourceTime: sourceTime }, sourceTime, function (result) {
          if (result && result.ok && typeof global.WinSpeedBallShowAiReplyWindow === "function") {
            global.WinSpeedBallShowAiReplyWindow({ content: result.content }, function () {});
          }
          storage.get(["manualCaptureTime", "ocrCancelledSourceTime"], function (current) {
            if (Number(current.manualCaptureTime || 0) !== sourceTime || Number(current.ocrCancelledSourceTime || 0) === sourceTime) return;
            storage.set({
              aiJobSourceTime: sourceTime,
              aiJobStatus: result && result.ok ? "completed" : "failed",
              aiJobError: result && result.ok ? "" : result && result.error || "AI request failed.",
              aiJobUpdatedAt: Date.now()
            });
            storage.appendLog("AI", result && result.ok ? "后台自动发送成功" : "后台自动发送失败", {
              任务: "#" + String(sourceTime).slice(-8),
              模型: result && result.model || "-",
              回复字数: result && result.ok ? String(result.content || "").length : 0,
              原因: result && result.ok ? "-" : result && result.error || "未知错误"
            });
          });
        });
      });
    });
  }

  function handleFailed(request) {
    var sourceTime = Number(request.sourceTime || 0);
    var error = String(request.error || "OCR failed.");
    storage.get(["manualCaptureTime", "ocrCancelledSourceTime"], function (data) {
      if (!sourceTime || Number(data.manualCaptureTime || 0) !== sourceTime || Number(data.ocrCancelledSourceTime || 0) === sourceTime) {
        finishOffscreen(sourceTime);
        return;
      }
      updateJobState(sourceTime, "failed", 0, error);
      storage.appendLog("OCR", "后台识别失败", { 任务: "#" + String(sourceTime).slice(-8), 原因: error });
      finishOffscreen(sourceTime);
    });
  }

  function resume() {
    storage.get(["manualCaptureTime", "ocrJobSourceTime", "ocrJobStatus"], function (data) {
      var sourceTime = Number(data.manualCaptureTime || 0);
      var status = String(data.ocrJobStatus || "");
      if (!sourceTime || Number(data.ocrJobSourceTime || 0) !== sourceTime || !/^(queued|recognizing|loading)/.test(status)) return;
      ensureOffscreen().then(function () {
        chrome.runtime.sendMessage({
          version: 1,
          action: "getOcrWorkerState",
          source: "background",
          requestId: "background-" + Date.now() + "-" + (++requestSequence),
          payload: { target: "offscreen-ocr" }
        }, function (response) {
          lastErrorMessage();
          if (response && Number(response.runningSourceTime || 0) === sourceTime) return;
          storage.getLatestCapture().then(function (capture) {
            if (capture && Number(capture.sourceTime || 0) === sourceTime && capture.dataUrl) start(capture.dataUrl, sourceTime);
          }).catch(function () {});
        });
      }).catch(function () {});
    });
  }

  function restartLatest() {
    return storage.getLatestCapture().then(function (capture) {
      var sourceTime = Number(capture && capture.sourceTime || 0);
      if (!capture || !capture.dataUrl || !sourceTime) {
        return { ok: false, error: "No captured image is available for OCR." };
      }
      return new Promise(function (resolve) {
        storage.get(["manualCaptureTime", "ocrJobSourceTime", "ocrJobStatus"], function (data) {
          if (Number(data.manualCaptureTime || 0) !== sourceTime) {
            resolve({ ok: false, error: "The latest capture changed before OCR could restart." });
            return;
          }
          var currentStatus = String(data.ocrJobStatus || "");
          if (activeSourceTime === sourceTime && /^(queued|loading|recognizing)$/.test(currentStatus)) {
            resolve({ ok: true, pending: true, sourceTime: sourceTime, status: currentStatus });
            return;
          }
          start(capture.dataUrl, sourceTime);
          resolve({ ok: true, restarted: true, sourceTime: sourceTime, status: "queued" });
        });
      });
    }).catch(function (error) {
      return { ok: false, error: error && error.message || String(error || "Could not restart OCR.") };
    });
  }

  function getManualCapture(callback) {
    storage.getLatestCapture().then(function (capture) {
      storage.get([
        "manualCaptureTime", "manualOcrText", "manualOcrSourceTime", "manualAiSourceTime", "manualAiPrompt", "manualAiResponse",
        "ocrJobSourceTime", "ocrJobStatus", "ocrJobProgress", "ocrJobStage", "ocrJobError", "aiJobSourceTime", "aiJobStatus", "aiJobError"
      ], function (data) {
        var sourceTime = capture ? Number(capture.sourceTime || 0) : Number(data.manualCaptureTime || 0);
        callback({
          ok: true,
          dataUrl: capture && capture.dataUrl || "",
          time: sourceTime,
          ocrText: Number(data.manualOcrSourceTime || 0) === sourceTime ? normalizeText(data.manualOcrText) : "",
          ocrStatus: Number(data.ocrJobSourceTime || 0) === sourceTime ? data.ocrJobStatus || "" : "",
          ocrProgress: Number(data.ocrJobSourceTime || 0) === sourceTime ? Number(data.ocrJobProgress || 0) : 0,
          ocrStage: Number(data.ocrJobSourceTime || 0) === sourceTime ? data.ocrJobStage || "" : "",
          ocrError: Number(data.ocrJobSourceTime || 0) === sourceTime ? data.ocrJobError || "" : "",
          aiSourceTime: data.manualAiSourceTime || 0,
          aiPrompt: Number(data.manualAiSourceTime || 0) === sourceTime ? normalizeText(data.manualAiPrompt) : "",
          aiResponse: Number(data.manualAiSourceTime || 0) === sourceTime ? normalizeText(data.manualAiResponse) : "",
          aiStatus: Number(data.aiJobSourceTime || 0) === sourceTime ? data.aiJobStatus || "" : "",
          aiError: Number(data.aiJobSourceTime || 0) === sourceTime ? data.aiJobError || "" : ""
        });
      });
    }).catch(function (error) {
      callback({ ok: false, error: error && error.message ? error.message : String(error || "Could not read capture.") });
    });
  }

  global.WinSpeedBallOcrService = {
    isWorkerSender: isWorkerSender,
    ensureOffscreen: ensureOffscreen,
    start: start,
    handleProgress: handleProgress,
    handleComplete: handleComplete,
    handleFailed: handleFailed,
    cancel: cancel,
    closeOffscreen: closeOffscreen,
    resume: resume,
    restartLatest: restartLatest,
    getManualCapture: getManualCapture,
    buildAutoPrompt: buildAutoPrompt
  };
})(self);
