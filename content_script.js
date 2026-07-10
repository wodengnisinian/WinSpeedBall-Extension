/**
 * WinSpeedBall content script
 * 页面内媒体控制和页面文字提取。
 */
(function () {
  "use strict";
  // Guard: skip chrome:// and edge:// internal pages
  try { if (/^(chrome|edge|about|chrome-extension):\/\//i.test(location.href)) return; } catch (e) { return; }

  if (window.__WinSpeedBallLoadedVersion === "2026-07-10-capture-style-v4") return;
  window.__WinSpeedBallLoadedVersion = "2026-07-10-capture-style-v4";
  window.__WinSpeedBallLoaded = true;

  var rate = 1.0;
  var muted = false;
  var volume = 0.8;
  var lastAudibleVolume = 0.8;
  var active = false;
  var keepPlaying = false;
  var lockTimer = null;
  var observerStarted = false;
  var mutationScanTimer = null;
  var regionCaptureActive = false;
  var knownMedia = new WeakSet();

  function clamp(num, min, max) {
    return Math.max(min, Math.min(max, num));
  }

  function normalizeVolume(v, fallback) {
    var n = Number(v);
    if (Number.isNaN(n)) n = fallback;
    return clamp(n, 0, 1);
  }

  function normalizeRate(v) {
    var n = Number(v);
    if (Number.isNaN(n)) n = 1;
    return clamp(n, 0.25, 16);
  }

  function rememberAudibleVolume() {
    if (volume > 0) lastAudibleVolume = volume;
  }

  function collectAll() {
    var all = [];
    var seen = new Set();

    function isControllableMedia(el) {
      if (!el) return false;
      try {
        if (el instanceof HTMLMediaElement) return true;
      } catch (e) {}
      return /^(VIDEO|AUDIO)$/.test(el.tagName || "");
    }

    function add(el) {
      if (isControllableMedia(el) && !seen.has(el)) {
        seen.add(el);
        registerMedia(el);
        all.push(el);
      }
    }

    function scan(root) {
      if (!root || !root.querySelectorAll) return;
      try {
        root.querySelectorAll("video, audio").forEach(function (el) {
          add(el);
          try {
            if (el.shadowRoot) scan(el.shadowRoot);
          } catch (e) {}
        });
      } catch (e) {}

      try {
        root.querySelectorAll("*").forEach(function (el) {
          try {
            if (el.shadowRoot) scan(el.shadowRoot);
          } catch (e) {}
        });
      } catch (e) {}
    }

    scan(document);

    return all;
  }

  function registerMedia(el) {
    if (!el || knownMedia.has(el)) return;
    knownMedia.add(el);

    ["loadedmetadata", "loadeddata", "canplay", "playing", "durationchange"].forEach(function (name) {
      el.addEventListener(name, function () {
        if (!active) return;
        try { applyToMedia(el); } catch (e) {}
        if (keepPlaying) tryPlayMedia(el);
      }, true);
    });

    el.addEventListener("ratechange", function () {
      if (!active) return;
      if (Math.abs(Number(el.playbackRate || 1) - rate) > 0.001) {
        setTimeout(function () { try { el.playbackRate = rate; } catch (e) {} }, 0);
        setTimeout(function () { try { el.playbackRate = rate; } catch (e) {} }, 120);
      }
    }, true);

    el.addEventListener("volumechange", function () {
      if (!active) return;
      var wantedVolume = muted ? 0 : volume;
      if (el.muted !== muted || Math.abs(Number(el.volume || 0) - wantedVolume) > 0.001) {
        setTimeout(function () {
          try { el.muted = muted; el.volume = wantedVolume; } catch (e) {}
        }, 0);
      }
    }, true);
  }

  function applyToMedia(el) {
    registerMedia(el);
    el.playbackRate = rate;
    el.defaultPlaybackRate = rate;
    el.muted = muted;
    el.volume = muted ? 0 : volume;
  }

  function applyToAll(ms) {
    var applied = 0;
    ms.forEach(function (el) {
      try {
        applyToMedia(el);
        applied++;
      } catch (e) {}
    });
    return applied;
  }

  function tryPlayMedia(el) {
    try {
      if (el.paused && el.readyState >= 2) {
        var p = el.play();
        if (p && p.catch) p.catch(function () {});
      }
    } catch (e) {}
  }

  function playAll(ms) {
    var played = 0;
    ms.forEach(function (el) {
      try {
        applyToMedia(el);
        tryPlayMedia(el);
        played++;
      } catch (e) {}
    });
    return played;
  }

  function detectSpecial() {
    var result = { type: "" };
    try {
      if (window.RufflePlayer || document.querySelector("ruffle-player, ruffle-embed, ruffle-object")) {
        result.type = "Ruffle/Flash";
        result.reason = "检测到 Ruffle/Flash，可能不是标准 HTML5 视频";
        return result;
      }
    } catch (e) {}

    try {
      if (!document.querySelector("video") && document.querySelector("canvas")) {
        result.type = "Canvas";
        result.reason = "检测到 Canvas 播放区域，可能无法完全控制";
        return result;
      }
    } catch (e) {}

    return result;
  }

  function buildState(ms, applied) {
    var mediaInfo = getPrimaryMediaInfo(ms);
    return {
      ok: true,
      rate: rate,
      muted: muted,
      volume: muted ? 0 : volume,
      keepPlaying: keepPlaying,
      mediaCount: ms.length,
      applied: applied,
      duration: mediaInfo.duration,
      currentTime: mediaInfo.currentTime,
      remainingTime: mediaInfo.remainingTime,
      paused: mediaInfo.paused,
      mediaTag: mediaInfo.tag,
      frameResults: []
    };
  }

  function safeNumber(n) {
    n = Number(n);
    return Number.isFinite(n) ? n : 0;
  }

  function getPrimaryMediaInfo(ms) {
    var chosen = choosePrimaryMedia(ms);
    if (!chosen) {
      return { duration: 0, currentTime: 0, remainingTime: 0, paused: true, tag: "" };
    }
    var duration = safeNumber(chosen.duration);
    var currentTime = safeNumber(chosen.currentTime);
    return {
      duration: duration,
      currentTime: currentTime,
      remainingTime: Math.max(0, duration - currentTime),
      paused: !!chosen.paused,
      tag: chosen.tagName ? chosen.tagName.toLowerCase() : ""
    };
  }

  function choosePrimaryMedia(ms) {
    var best = null;
    var bestScore = -1;
    ms.forEach(function (el, index) {
      if (!el) return;
      var rect = { width: 0, height: 0 };
      try { rect = el.getBoundingClientRect(); } catch (e) {}
      var area = Math.max(0, rect.width || 0) * Math.max(0, rect.height || 0);
      var duration = safeNumber(el.duration);
      var score = 0;
      if (!el.paused) score += 1000000;
      if (duration >= 8) score += 100000;
      if ((el.tagName || "").toLowerCase() === "video") score += 50000;
      score += Math.min(area, 500000);
      score += Math.min(duration, 36000);
      score -= index;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    });
    return best;
  }

  function startLock() {
    active = true;
    if (lockTimer) return;
    lockTimer = setInterval(function () {
      if (!active) return;
      var ms = collectAll();
      applyToAll(ms);
      if (keepPlaying) playAll(ms);
    }, 1000);
  }

  function enableKeepPlaying() {
    keepPlaying = true;
    active = true;
    var ms = collectAll();
    var applied = applyToAll(ms);
    var played = playAll(ms);
    startLock();
    var state = buildState(ms, applied);
    state.played = played;
    return state;
  }

  function disableKeepPlaying() {
    keepPlaying = false;
    var ms = collectAll();
    var state = buildState(ms, 0);
    state.played = 0;
    return state;
  }

  function startObserver() {
    if (observerStarted) return;
    var root = document.documentElement || document.body;
    if (!root) {
      setTimeout(startObserver, 50);
      return;
    }
    observerStarted = true;
    new MutationObserver(function () {
      if (!active) return;
      if (mutationScanTimer) clearTimeout(mutationScanTimer);
      mutationScanTimer = setTimeout(function () {
        mutationScanTimer = null;
        applyToAll(collectAll());
      }, 300);
    }).observe(root, { childList: true, subtree: true });
  }

  function extractPageText() {
    var text = "";
    try {
      text = document.body && document.body.innerText ? document.body.innerText : "";
    } catch (e) {}
    text = text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (text.length > 8000) text = text.slice(0, 8000);
    return {
      ok: true,
      title: document.title || "",
      url: location.href,
      text: text,
      mediaCount: collectAll().length,
      applied: 0,
      rate: rate,
      muted: muted,
      volume: muted ? 0 : volume
    };
  }

  function sendRuntimeMessage(message) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(message, function (response) {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { ok: false, error: "No response." });
        });
      } catch (e) {
        resolve({ ok: false, error: e.message || String(e) });
      }
    });
  }

  function cropDataUrl(dataUrl, rect) {
    return new Promise(function (resolve) {
      var image = new Image();
      image.onload = function () {
        var scaleX = image.naturalWidth / window.innerWidth;
        var scaleY = image.naturalHeight / window.innerHeight;
        var sx = clamp(Math.round(rect.left * scaleX), 0, image.naturalWidth - 1);
        var sy = clamp(Math.round(rect.top * scaleY), 0, image.naturalHeight - 1);
        var sw = clamp(Math.round(rect.width * scaleX), 1, image.naturalWidth - sx);
        var sh = clamp(Math.round(rect.height * scaleY), 1, image.naturalHeight - sy);
        var canvas = document.createElement("canvas");
        canvas.width = sw;
        canvas.height = sh;
        var ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve("");
          return;
        }
        ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
        resolve(canvas.toDataURL("image/png"));
      };
      image.onerror = function () {
        resolve("");
      };
      image.src = dataUrl;
    });
  }

  function startRegionCapture() {
    if (regionCaptureActive) return { ok: true, message: "already active" };
    regionCaptureActive = true;

    var startX = 0;
    var startY = 0;
    var currentRect = null;
    var dragging = false;
    var overlay = document.createElement("div");
    var selection = document.createElement("div");
    sendRuntimeMessage({ action: "setCaptureIndicator", active: true });

    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "background:transparent",
      "pointer-events:none",
      "user-select:none"
    ].join(";");
    selection.style.cssText = [
      "position:fixed",
      "display:none",
      "z-index:2147483647",
      "border:2px solid rgb(96,96,96)",
      "background:transparent",
      "pointer-events:none"
    ].join(";");
    try {
      chrome.storage.local.get(["captureSelectionTone", "captureSelectionWidth"], function (data) {
        var tone = Number(data && data.captureSelectionTone);
        var width = Number(data && data.captureSelectionWidth);
        if (!Number.isFinite(tone)) tone = 96;
        if (!Number.isFinite(width)) width = 2;
        tone = clamp(Math.round(tone), 0, 255);
        width = clamp(Math.round(width * 10) / 10, 0.1, 5);
        selection.style.borderColor = "rgb(" + tone + "," + tone + "," + tone + ")";
        selection.style.borderWidth = width + "px";
      });
    } catch (e) {}
    document.documentElement.appendChild(overlay);
    document.documentElement.appendChild(selection);

    function cleanup(keepIndicator) {
      regionCaptureActive = false;
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("mouseup", onMouseUp, true);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (selection.parentNode) selection.parentNode.removeChild(selection);
      if (!keepIndicator) sendRuntimeMessage({ action: "setCaptureIndicator", active: false });
    }

    function onKeyDown(event) {
      if (event.key === "Escape") cleanup(false);
    }

    function updateRect(x, y) {
      var left = Math.min(startX, x);
      var top = Math.min(startY, y);
      var width = Math.abs(x - startX);
      var height = Math.abs(y - startY);
      currentRect = { left: left, top: top, width: width, height: height };
      selection.style.display = width && height ? "block" : "none";
      selection.style.left = left + "px";
      selection.style.top = top + "px";
      selection.style.width = width + "px";
      selection.style.height = height + "px";
    }

    function onMouseDown(event) {
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      updateRect(startX, startY);
      event.preventDefault();
      event.stopPropagation();
    }

    function onMouseMove(event) {
      if (!dragging) return;
      updateRect(event.clientX, event.clientY);
      event.preventDefault();
      event.stopPropagation();
    }

    function onMouseUp(event) {
      if (!dragging) return;
      dragging = false;
      updateRect(event.clientX, event.clientY);
      event.preventDefault();
      event.stopPropagation();
      if (!currentRect || currentRect.width < 8 || currentRect.height < 8) {
        cleanup(false);
        return;
      }

      var rect = currentRect;
      cleanup(true);
      setTimeout(function () {
        sendRuntimeMessage({ action: "captureVisiblePage" }).then(function (res) {
          if (!res.ok || !res.dataUrl) {
            sendRuntimeMessage({ action: "setCaptureIndicator", active: false });
            return;
          }
          cropDataUrl(res.dataUrl, rect).then(function (cropped) {
            if (!cropped) {
              sendRuntimeMessage({ action: "setCaptureIndicator", active: false });
              return;
            }
            sendRuntimeMessage({ action: "saveManualCapture", dataUrl: cropped }).then(function (saveRes) {
              sendRuntimeMessage({ action: "setCaptureIndicator", active: false });
              if (!saveRes || !saveRes.ok) {
                console.warn("WinSpeedBall: capture could not be saved", saveRes && saveRes.error);
              }
            });
          });
        });
      }, 80);
    }

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("mouseup", onMouseUp, true);
    return { ok: true };
  }

  function handleCommand(command) {
    command = command || {};
    var ms;
    var applied;

    switch (command.type) {
      case "SET_RATE":
        rate = normalizeRate(command.rate);
        ms = collectAll();
        applied = applyToAll(ms);
        startLock();
        return buildState(ms, applied);

      case "STEP_UP":
        rate = normalizeRate(rate + 0.25);
        ms = collectAll();
        applied = applyToAll(ms);
        startLock();
        return buildState(ms, applied);

      case "STEP_DOWN":
        rate = normalizeRate(rate - 0.25);
        ms = collectAll();
        applied = applyToAll(ms);
        startLock();
        return buildState(ms, applied);

      case "RESET":
        rate = 1.0;
        muted = false;
        volume = 0.8;
        lastAudibleVolume = 0.8;
        ms = collectAll();
        applied = applyToAll(ms);
        startLock();
        return buildState(ms, applied);

      case "SET_MUTED":
        if (command.muted) rememberAudibleVolume();
        muted = !!command.muted;
        if (!muted && volume === 0) volume = lastAudibleVolume || 0.8;
        ms = collectAll();
        applied = applyToAll(ms);
        startLock();
        return buildState(ms, applied);

      case "TOGGLE_MUTED":
        if (!muted) rememberAudibleVolume();
        muted = !muted;
        if (!muted && volume === 0) volume = lastAudibleVolume || 0.8;
        ms = collectAll();
        applied = applyToAll(ms);
        startLock();
        return buildState(ms, applied);

      case "SET_VOLUME":
        volume = normalizeVolume(command.volume, 0.8);
        if (volume > 0) {
          muted = false;
          lastAudibleVolume = volume;
        } else {
          muted = true;
        }
        ms = collectAll();
        applied = applyToAll(ms);
        startLock();
        return buildState(ms, applied);

      case "ENABLE_AUTOPLAY":
        return enableKeepPlaying();

      case "DISABLE_AUTOPLAY":
        return disableKeepPlaying();

      case "GET_STATUS":
        ms = collectAll();
        var status = buildState(ms, 0);
        var special = detectSpecial();
        if (special.type) {
          status.specialPlayerDetected = true;
          status.specialPlayerType = special.type;
          status.reason = special.reason;
        }
        return status;

      case "EXTRACT_PAGE_TEXT":
        return extractPageText();

      default:
        return { ok: false, error: "未知命令", mediaCount: 0, applied: 0, frameResults: [] };
    }
  }

  startObserver();

  document.addEventListener("play", function (event) {
    if (active && event.target && /^(VIDEO|AUDIO)$/.test(event.target.tagName)) {
      try { applyToMedia(event.target); } catch (e) {}
    }
  }, true);

  document.addEventListener("loadedmetadata", function (event) {
    if (active && event.target && /^(VIDEO|AUDIO)$/.test(event.target.tagName)) {
      try { applyToMedia(event.target); } catch (e) {}
      if (keepPlaying) tryPlayMedia(event.target);
    }
  }, true);

  document.addEventListener("pause", function (event) {
    if (keepPlaying && event.target && /^(VIDEO|AUDIO)$/.test(event.target.tagName)) {
      setTimeout(function () { tryPlayMedia(event.target); }, 120);
    }
  }, true);

  document.addEventListener("visibilitychange", function () {
    if (keepPlaying) setTimeout(function () { playAll(collectAll()); }, 120);
  }, true);

  window.addEventListener("blur", function () {
    if (keepPlaying) setTimeout(function () { playAll(collectAll()); }, 120);
  }, true);

  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (!request) {
      sendResponse({ ok: false, error: "Empty command.", mediaCount: 0, applied: 0, frameResults: [] });
      return true;
    }
    sendResponse(handleCommand(request));
    return true;
  });

  window.winSpeedBall = {
    handleCommand: handleCommand,
    startRegionCapture: startRegionCapture
  };

  setTimeout(function () {
    sendRuntimeMessage({ action: "runMatchingUserScripts", url: location.href });
  }, 50);
})();
