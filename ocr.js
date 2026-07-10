/**
 * Local OCR wrapper.
 * Screenshots stay local unless the user sends recognized text to AI.
 */
(function () {
  "use strict";

  var workerPromise = null;
  var progressCallback = null;

  function extUrl(path) {
    return chrome.runtime.getURL(path);
  }

  function ensureTesseract() {
    if (!window.Tesseract || !window.Tesseract.createWorker) {
      return Promise.reject(new Error("Local tesseract.min.js was not loaded. Check vendor/tesseract files."));
    }
    return Promise.resolve();
  }

  function createLocalWorker(onProgress) {
    progressCallback = onProgress;
    return ensureTesseract().then(function () {
      return window.Tesseract.createWorker("chi_sim+eng", 1, {
        workerPath: extUrl("vendor/tesseract/worker.min.js"),
        workerBlobURL: false,
        corePath: extUrl("vendor/tesseract/tesseract-core.wasm.js"),
        langPath: extUrl("vendor/tesseract"),
        gzip: true,
        logger: function (m) {
          if (typeof progressCallback === "function") progressCallback(m);
        }
      });
    });
  }

  function getWorker(onProgress) {
    progressCallback = onProgress;
    if (!workerPromise) workerPromise = createLocalWorker(onProgress);
    return workerPromise;
  }

  function recognize(dataUrl, onProgress) {
    if (!dataUrl) return Promise.reject(new Error("Please capture the page first."));
    return getWorker(onProgress).then(function (worker) {
      return worker.recognize(dataUrl).then(function (result) {
        return result && result.data ? result.data.text || "" : "";
      });
    }).catch(function (error) {
      workerPromise = null;
      throw error;
    });
  }

  window.winSpeedBallOcr = {
    recognize: recognize
  };
})();
