(function () {
  "use strict";

  var latestSourceTime = 0;
  var runningSourceTime = 0;
  var workerRequestSequence = 0;

  function getVoiceWorker() {
    if (window.WinSpeedBallVoiceWorker) return Promise.resolve(window.WinSpeedBallVoiceWorker);
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        window.removeEventListener("winspeedball-voice-worker-ready", ready);
        reject(new Error("Local Whisper worker did not load."));
      }, 15000);
      function ready() {
        clearTimeout(timer);
        resolve(window.WinSpeedBallVoiceWorker);
      }
      window.addEventListener("winspeedball-voice-worker-ready", ready, { once: true });
    });
  }

  function report(message) {
    try {
      var payload = {};
      Object.keys(message || {}).forEach(function (key) {
        if (key !== "action") payload[key] = message[key];
      });
      chrome.runtime.sendMessage({
        version: 1,
        action: String(message && message.action || ""),
        source: "offscreen-ocr",
        requestId: "offscreen-" + Date.now() + "-" + (++workerRequestSequence),
        payload: payload
      }, function () {
        void chrome.runtime.lastError;
      });
    } catch (e) {}
  }

  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (!request || request.version !== 1 || request.source !== "background" || !request.payload || ["offscreen-ocr", "offscreen-processing"].indexOf(request.payload.target) < 0) return false;
    if (!sender || sender.id !== chrome.runtime.id || sender.tab) return false;
    var payload = request.payload;
    if (["startTabAudioRecording", "stopTabAudioRecording", "cancelTabAudioRecording"].indexOf(request.action) >= 0) {
      getVoiceWorker().then(function (worker) {
        if (request.action === "startTabAudioRecording") return worker.start(payload);
        if (request.action === "stopTabAudioRecording") return worker.stop();
        return worker.cancel();
      }).then(sendResponse).catch(function (error) {
        sendResponse({ ok: false, error: error && error.message || String(error || "Local voice worker failed.") });
      });
      return true;
    }
    if (request.action === "getOcrWorkerState") {
      sendResponse({ ok: true, runningSourceTime: runningSourceTime });
      return false;
    }
    if (request.action !== "recognizeCapture") return false;

    var sourceTime = Number(payload.sourceTime || 0);
    var dataUrl = String(payload.dataUrl || "");
    if (!sourceTime || !dataUrl || !window.winSpeedBallOcr) {
      sendResponse({ ok: false, error: "OCR job data is invalid." });
      return false;
    }

    latestSourceTime = sourceTime;
    runningSourceTime = sourceTime;
    sendResponse({ ok: true, accepted: true, sourceTime: sourceTime });

    window.winSpeedBallOcr.recognize(dataUrl, function (progress) {
      if (sourceTime !== latestSourceTime) return;
      report({
        action: "ocrJobProgress",
        sourceTime: sourceTime,
        status: progress && progress.status || "recognizing",
        progress: progress && progress.progress == null ? 0 : Number(progress.progress)
      });
    }).then(function (recognizedText) {
      if (runningSourceTime === sourceTime) runningSourceTime = 0;
      report({
        action: "ocrJobComplete",
        sourceTime: sourceTime,
        text: String(recognizedText || "")
      });
    }).catch(function (error) {
      if (runningSourceTime === sourceTime) runningSourceTime = 0;
      report({
        action: "ocrJobFailed",
        sourceTime: sourceTime,
        error: error && error.message ? error.message : String(error || "OCR failed.")
      });
    });

    return false;
  });
})();
