(function () {
  "use strict";

  var latestSourceTime = 0;
  var runningSourceTime = 0;

  function report(message) {
    try {
      chrome.runtime.sendMessage(message, function () {
        void chrome.runtime.lastError;
      });
    } catch (e) {}
  }

  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (!request || request.target !== "offscreen-ocr") return false;
    if (request.action === "getOcrWorkerState") {
      sendResponse({ ok: true, runningSourceTime: runningSourceTime });
      return false;
    }
    if (request.action !== "recognizeCapture") return false;

    var sourceTime = Number(request.sourceTime || 0);
    var dataUrl = String(request.dataUrl || "");
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
