(function (global) {
  "use strict";

  var storage = global.WinSpeedBallStorageService;
  var textFilter = global.WinSpeedBallVoiceTextFilter;
  var MAX_RECORDING_MS = 60000;
  var MODEL_IDLE_ALARM = "winspeedball-whisper-model-idle";
  var MODEL_IDLE_MINUTES = 5;
  var requestSequence = 0;
  var activeJobId = "";

  function clearModelIdleAlarm() {
    try { chrome.alarms.clear(MODEL_IDLE_ALARM, function () { void chrome.runtime.lastError; }); } catch (error) {}
  }

  function scheduleModelIdleClose() {
    try { chrome.alarms.create(MODEL_IDLE_ALARM, { delayInMinutes: MODEL_IDLE_MINUTES }); } catch (error) {}
  }

  function lastErrorMessage() {
    return chrome.runtime.lastError ? chrome.runtime.lastError.message : "";
  }

  function writeState(patch) {
    return new Promise(function (resolve) {
      storage.set(Object.assign({ voiceJobUpdatedAt: Date.now() }, patch || {}), function (result) {
        resolve(result && result.ok === false ? result : { ok: true });
      });
    });
  }

  function sendWorker(action, payload) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendMessage({
          version: 1,
          action: action,
          source: "background",
          requestId: "voice-background-" + Date.now() + "-" + (++requestSequence),
          payload: Object.assign({ target: "offscreen-processing" }, payload || {})
        }, function (response) {
          var error = lastErrorMessage();
          if (error || !response || response.ok === false) {
            reject(new Error(error || response && response.error || "Local voice worker did not accept the request."));
            return;
          }
          resolve(response);
        });
      } catch (error) { reject(error); }
    });
  }

  function getMediaStreamId(tabId) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, function (streamId) {
          var error = lastErrorMessage();
          if (error || !streamId) {
            reject(new Error(error || "Edge did not provide the current tab audio stream."));
            return;
          }
          resolve(streamId);
        });
      } catch (error) { reject(error); }
    });
  }

  function fail(error, extraState) {
    var message = error && error.message || String(error || "Local speech recognition failed.");
    return writeState(Object.assign({
      voiceJobStatus: "failed",
      voiceJobProgress: 0,
      voiceJobError: message
    }, extraState || {})).then(function () {
      storage.appendLog("语音", "网页语音获取失败", { 原因: message }, "error");
      return { ok: false, error: message, needsToolbarPopup: !!(extraState && extraState.voiceNeedsToolbarPopup) };
    });
  }

  function isActiveTabInvocationError(error) {
    return /(activeTab|has not been invoked|Chrome pages cannot be captured|Edge pages cannot be captured)/i.test(String(error && error.message || error || ""));
  }

  function start(tab) {
    var tabId = Number(tab && tab.id);
    if (!Number.isInteger(tabId) || tabId < 0) return Promise.resolve({ ok: false, error: "没有可捕获声音的网页标签页。" });
    var jobId = "voice-" + Date.now() + "-" + Math.random().toString(16).slice(2, 10);
    activeJobId = jobId;
    function requireActiveJob(value) {
      if (activeJobId === jobId) return value;
      var error = new Error("网页语音获取已取消。");
      error.voiceCancelled = true;
      throw error;
    }
    clearModelIdleAlarm();
    return writeState({
      voiceJobId: jobId,
      voiceJobStatus: "starting",
      voiceJobProgress: 0,
      voiceJobError: "",
      voiceTranscript: "",
      voiceNeedsToolbarPopup: false,
      voiceStartedAt: Date.now(),
      voiceTabId: tabId
    }).then(function () {
      return getMediaStreamId(tabId);
    }).then(function (streamId) {
      requireActiveJob();
      return global.WinSpeedBallOcrService.ensureOffscreen().then(function () { return streamId; });
    }).then(function (streamId) {
      requireActiveJob();
      return sendWorker("startTabAudioRecording", {
        jobId: jobId,
        streamId: streamId,
        maxDurationMs: MAX_RECORDING_MS
      });
    }).then(function (response) {
      requireActiveJob();
      if (response && response.status === "cancelled") {
        activeJobId = "";
        return writeState({ voiceJobStatus: "cancelled", voiceJobProgress: 0 }).then(function () {
          return { ok: true, jobId: jobId, status: "cancelled" };
        });
      }
      return writeState({ voiceJobStatus: "recording", voiceJobProgress: 0 }).then(function () {
        storage.appendLog("语音", "开始获取网页声音", { 标签页: String(tabId), 最长录制: "60秒" }, "success");
        return { ok: true, jobId: jobId, status: "recording", maxDurationMs: MAX_RECORDING_MS };
      });
    }).catch(function (error) {
      if (error && error.voiceCancelled) return { ok: true, jobId: jobId, status: "cancelled" };
      activeJobId = "";
      if (isActiveTabInvocationError(error)) {
        return fail(new Error("Edge 安全限制：请先切换到播放语音的网页，点击工具栏中的 WinSpeedBall 图标，再从“网页语音”点击“开始录音”。"), { voiceNeedsToolbarPopup: true });
      }
      return fail(error);
    });
  }

  function stop() {
    return sendWorker("stopTabAudioRecording", {}).then(function (response) {
      return writeState({ voiceJobStatus: "loading", voiceJobProgress: 0 }).then(function () {
        return { ok: true, status: "loading", durationMs: Number(response.durationMs || 0) };
      });
    }).catch(fail);
  }

  function cancel() {
    clearModelIdleAlarm();
    activeJobId = "";
    return sendWorker("cancelTabAudioRecording", {}).catch(function () { return {}; }).then(function () {
      return writeState({ voiceJobStatus: "cancelled", voiceJobProgress: 0, voiceJobError: "" });
    }).then(function () {
      return global.WinSpeedBallOcrService.closeOffscreen("voice");
    }).then(function () { return { ok: true, status: "cancelled" }; });
  }

  function getState() {
    return new Promise(function (resolve) {
      storage.get([
        "voiceJobId", "voiceJobStatus", "voiceJobProgress", "voiceJobError", "voiceTranscript",
        "voiceStartedAt", "voiceJobUpdatedAt", "voiceTabId", "voiceDurationMs", "voiceNeedsToolbarPopup"
      ], function (data) {
        resolve({
          ok: true,
          jobId: String(data.voiceJobId || ""),
          status: String(data.voiceJobStatus || "idle"),
          progress: Number(data.voiceJobProgress || 0),
          error: String(data.voiceJobError || ""),
          transcript: String(data.voiceTranscript || ""),
          startedAt: Number(data.voiceStartedAt || 0),
          updatedAt: Number(data.voiceJobUpdatedAt || 0),
          tabId: Number(data.voiceTabId || 0),
          durationMs: Number(data.voiceDurationMs || 0),
          needsToolbarPopup: data.voiceNeedsToolbarPopup === true,
          maxDurationMs: MAX_RECORDING_MS
        });
      });
    });
  }

  function handleProgress(request) {
    var status = String(request.status || "transcribing");
    if (["recording", "loading", "transcribing"].indexOf(status) < 0) status = "transcribing";
    return new Promise(function (resolve) {
      storage.get(["voiceJobId"], function (data) {
        if (String(data.voiceJobId || "") !== String(request.jobId || "")) { resolve({ ok: true, ignored: true }); return; }
        writeState({
          voiceJobStatus: status,
          voiceJobProgress: Math.max(0, Math.min(1, Number(request.progress || 0))),
          voiceJobError: "",
          voiceDurationMs: Math.max(0, Number(request.durationMs || 0))
        }).then(resolve);
      });
    });
  }

  function handleComplete(request) {
    var text = textFilter.filter(request.text || "");
    return new Promise(function (resolve) {
      storage.get(["voiceJobId"], function (data) {
        if (String(data.voiceJobId || "") !== String(request.jobId || "")) { resolve({ ok: true, ignored: true }); return; }
        activeJobId = "";
        writeState({
          voiceJobStatus: text ? "completed" : "empty",
          voiceJobProgress: 1,
          voiceJobError: "",
          voiceTranscript: text,
          voiceDurationMs: Math.max(0, Number(request.durationMs || 0))
        }).then(function () {
          storage.appendLog("语音", text ? "本地语音识别完成" : "本地语音未识别到文字", {
            时长: Math.round(Number(request.durationMs || 0) / 1000) + "秒",
            字数: String(text.length)
          }, text ? "success" : "warn");
          scheduleModelIdleClose();
          resolve({ ok: true, retained: true });
        });
      });
    });
  }

  function handleFailed(request) {
    return new Promise(function (resolve) {
      storage.get(["voiceJobId"], function (data) {
        if (String(data.voiceJobId || "") !== String(request.jobId || "")) { resolve({ ok: true, ignored: true }); return; }
        activeJobId = "";
        fail(new Error(String(request.error || "Local speech recognition failed."))).then(function (result) {
          scheduleModelIdleClose();
          resolve(result);
        });
      });
    });
  }

  function handleAlarm(alarm) {
    if (!alarm || alarm.name !== MODEL_IDLE_ALARM) return false;
    getState().then(function (state) {
      if (/^(starting|recording|loading|transcribing)$/.test(state.status)) return;
      global.WinSpeedBallOcrService.closeOffscreen("voice");
    });
    return true;
  }

  global.WinSpeedBallVoiceService = {
    start: start,
    stop: stop,
    cancel: cancel,
    getState: getState,
    handleProgress: handleProgress,
    handleComplete: handleComplete,
    handleFailed: handleFailed,
    handleAlarm: handleAlarm,
    modelIdleAlarm: MODEL_IDLE_ALARM,
    maxRecordingMs: MAX_RECORDING_MS
  };
})(self);
