/**
 * Local OCR wrapper.
 * Screenshots stay local unless the user sends recognized text to AI.
 */
(function () {
  "use strict";

  var MAX_PREPROCESS_PIXELS = 12 * 1024 * 1024;
  var OCR_PADDING = 12;
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
    }).then(function (worker) {
      var pageSegmentationMode = window.Tesseract.PSM && window.Tesseract.PSM.SINGLE_BLOCK || "6";
      return worker.setParameters({
        tessedit_pageseg_mode: pageSegmentationMode,
        preserve_interword_spaces: "1",
        user_defined_dpi: "300"
      }).then(function () {
        return worker;
      });
    });
  }

  function getWorker(onProgress) {
    progressCallback = onProgress;
    if (!workerPromise) workerPromise = createLocalWorker(onProgress);
    return workerPromise;
  }

  function preferredScale(width, height) {
    var largestSide = Math.max(Number(width || 0), Number(height || 0));
    if (largestSide <= 900) return 2.4;
    if (largestSide <= 1600) return 2;
    return 1.35;
  }

  function boundedScale(width, height) {
    var pixels = Math.max(1, Number(width || 0) * Number(height || 0));
    return Math.max(0.1, Math.min(preferredScale(width, height), Math.sqrt(MAX_PREPROCESS_PIXELS / pixels)));
  }

  function enhancedLuminance(red, green, blue, alpha) {
    var opacity = Math.max(0, Math.min(255, Number(alpha == null ? 255 : alpha))) / 255;
    var compositedRed = 255 - (255 - Number(red || 0)) * opacity;
    var compositedGreen = 255 - (255 - Number(green || 0)) * opacity;
    var compositedBlue = 255 - (255 - Number(blue || 0)) * opacity;
    var luminance = compositedRed * 0.299 + compositedGreen * 0.587 + compositedBlue * 0.114;
    var darkness = Math.max(0, 255 - luminance);
    if (darkness < 7) return 255;
    var gain = darkness < 96 ? 2.4 : (darkness < 160 ? 1.8 : 1.35);
    return Math.max(0, Math.min(255, Math.round(255 - Math.min(255, darkness * gain))));
  }

  function preprocess(dataUrl, onProgress) {
    if (typeof onProgress === "function") onProgress({ status: "preprocessing", progress: 0.02 });
    return new Promise(function (resolve) {
      var image = new Image();
      image.onload = function () {
        try {
          var sourceWidth = Math.max(1, Number(image.naturalWidth || image.width || 1));
          var sourceHeight = Math.max(1, Number(image.naturalHeight || image.height || 1));
          var scale = boundedScale(sourceWidth, sourceHeight);
          var padding = Math.max(6, Math.round(OCR_PADDING * Math.min(scale, 2)));
          var targetWidth = Math.max(1, Math.round(sourceWidth * scale));
          var targetHeight = Math.max(1, Math.round(sourceHeight * scale));
          var canvas = document.createElement("canvas");
          canvas.width = targetWidth + padding * 2;
          canvas.height = targetHeight + padding * 2;
          var context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) {
            resolve(dataUrl);
            return;
          }
          context.fillStyle = "#fff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.imageSmoothingEnabled = true;
          if ("imageSmoothingQuality" in context) context.imageSmoothingQuality = "high";
          context.drawImage(image, 0, 0, sourceWidth, sourceHeight, padding, padding, targetWidth, targetHeight);
          var pixels = context.getImageData(0, 0, canvas.width, canvas.height);
          var values = pixels.data;
          for (var offset = 0; offset < values.length; offset += 4) {
            var gray = enhancedLuminance(values[offset], values[offset + 1], values[offset + 2], values[offset + 3]);
            values[offset] = gray;
            values[offset + 1] = gray;
            values[offset + 2] = gray;
            values[offset + 3] = 255;
          }
          context.putImageData(pixels, 0, 0);
          resolve(canvas.toDataURL("image/png"));
        } catch (error) {
          resolve(dataUrl);
        }
      };
      image.onerror = function () {
        resolve(dataUrl);
      };
      image.src = dataUrl;
    }).then(function (processed) {
      if (typeof onProgress === "function") onProgress({ status: "preprocessing", progress: 0.08 });
      return processed;
    });
  }

  function recognize(dataUrl, onProgress) {
    if (!dataUrl) return Promise.reject(new Error("Please capture the page first."));
    return Promise.all([getWorker(onProgress), preprocess(dataUrl, onProgress)]).then(function (values) {
      var worker = values[0];
      var processedDataUrl = values[1];
      return worker.recognize(processedDataUrl).then(function (result) {
        return result && result.data ? result.data.text || "" : "";
      });
    }).catch(function (error) {
      workerPromise = null;
      throw error;
    });
  }

  window.winSpeedBallOcr = {
    recognize: recognize,
    preprocess: preprocess
  };
})();
