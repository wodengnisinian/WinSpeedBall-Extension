/**
 * WinSpeedBall content script
 * 页面内媒体控制和页面文字提取。
 */
(function () {
  "use strict";
  // Guard: skip chrome:// and edge:// internal pages
  try { if (/^(chrome|edge|about|chrome-extension):\/\//i.test(location.href)) return; } catch (e) { return; }

  if (window.__WinSpeedBallLoadedVersion === "2026-07-11-player-adapters-v1") return;
  var playerAdapters = window.WinSpeedBallPlayerAdapters;
  if (!playerAdapters || !playerAdapters.html5) {
    console.warn("WinSpeedBall: player adapters are not loaded.");
    return;
  }
  window.__WinSpeedBallLoadedVersion = "2026-07-11-player-adapters-v1";
  window.__WinSpeedBallLoaded = true;
  var html5Adapter = playerAdapters.html5;

  var rate = 1.0;
  var muted = false;
  var volume = 0.8;
  var lastAudibleVolume = 0.8;
  var active = false;
  var keepPlaying = false;
  var lockTimer = null;
  var observerStarted = false;
  var registryInitialized = false;
  var incrementalApplyTimer = null;
  var lastIntegrityScan = 0;
  var regionCaptureActive = false;
  var regionCaptureToken = "";
  var contentRequestSequence = 0;
  var knownMedia = new WeakSet();
  var mediaRegistry = new Set();
  var observedRoots = new WeakSet();
  var mediaObserver = null;
  var pendingMedia = new Set();
  var mediaMetrics = { initialScans: 0, incrementalScans: 0, integrityScans: 0, mutationBatches: 0, addedNodes: 0, observedRoots: 0 };

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

  function playbackState() {
    return { rate: rate, muted: muted, volume: volume };
  }

  function isConnectedMedia(element) {
    if (!html5Adapter.isMedia(element)) return false;
    try {
      return element.isConnected !== false && element.ownerDocument === document;
    } catch (error) {
      return true;
    }
  }

  function collectAll() {
    ensureMediaRegistry();
    runIntegrityScanIfStale();
    pruneDisconnectedMedia();
    var all = [];
    mediaRegistry.forEach(function (element) {
      all.push(element);
    });
    return all;
  }

  function pruneDisconnectedMedia() {
    mediaRegistry.forEach(function (element) {
      if (isConnectedMedia(element)) return;
      mediaRegistry.delete(element);
      pendingMedia.delete(element);
    });
  }

  function registerMedia(element, discovered) {
    if (!html5Adapter.isMedia(element)) return false;
    var wasRegistered = mediaRegistry.has(element);
    mediaRegistry.add(element);
    if (!wasRegistered && discovered) discovered.push(element);
    if (knownMedia.has(element)) return !wasRegistered;
    knownMedia.add(element);

    ["loadedmetadata", "loadeddata", "canplay", "playing", "durationchange"].forEach(function (name) {
      element.addEventListener(name, function () {
        mediaRegistry.add(element);
        if (!active) return;
        try { applyToMedia(element); } catch (error) {}
        if (keepPlaying) tryPlayMedia(element);
      }, true);
    });

    element.addEventListener("ratechange", function () {
      if (!active) return;
      if (Math.abs(Number(element.playbackRate || 1) - rate) > 0.001) {
        setTimeout(function () { try { element.playbackRate = rate; } catch (error) {} }, 0);
        setTimeout(function () { try { element.playbackRate = rate; } catch (error) {} }, 120);
      }
    }, true);

    element.addEventListener("volumechange", function () {
      if (!active) return;
      var wantedVolume = muted ? 0 : volume;
      if (element.muted !== muted || Math.abs(Number(element.volume || 0) - wantedVolume) > 0.001) {
        setTimeout(function () {
          try { element.muted = muted; element.volume = wantedVolume; } catch (error) {}
        }, 0);
      }
    }, true);
    return !wasRegistered;
  }

  function observeRoot(root, discovered) {
    if (!root || !root.querySelectorAll || observedRoots.has(root)) return;
    observedRoots.add(root);
    mediaMetrics.observedRoots++;
    if (!mediaObserver) mediaObserver = new MutationObserver(handleMediaMutations);
    mediaObserver.observe(root, { childList: true, subtree: true });
    scanNode(root, discovered, false);
  }

  function scanNode(node, discovered, incremental) {
    if (!node) return;
    if (incremental) mediaMetrics.incrementalScans++;
    registerMedia(node, discovered);
    try {
      if (node.shadowRoot) observeRoot(node.shadowRoot, discovered);
    } catch (error) {}
    if (!node.querySelectorAll) return;
    var descendants;
    try {
      descendants = node.querySelectorAll("*");
    } catch (error) {
      return;
    }
    descendants.forEach(function (element) {
      registerMedia(element, discovered);
      try {
        if (element.shadowRoot) observeRoot(element.shadowRoot, discovered);
      } catch (error) {}
    });
  }

  function queueDiscoveredMedia(discovered) {
    discovered.forEach(function (element) { pendingMedia.add(element); });
    if (!active) {
      pendingMedia.clear();
      return;
    }
    if (incrementalApplyTimer || !pendingMedia.size) return;
    incrementalApplyTimer = setTimeout(function () {
      incrementalApplyTimer = null;
      var media = Array.from(pendingMedia).filter(isConnectedMedia);
      pendingMedia.clear();
      if (!active || !media.length) return;
      applyToAll(media);
      if (keepPlaying) playAll(media);
    }, 50);
  }

  function handleMediaMutations(records) {
    mediaMetrics.mutationBatches++;
    var discovered = [];
    (records || []).forEach(function (record) {
      (record.addedNodes || []).forEach(function (node) {
        mediaMetrics.addedNodes++;
        scanNode(node, discovered, true);
      });
    });
    pruneDisconnectedMedia();
    queueDiscoveredMedia(discovered);
  }

  function ensureMediaRegistry() {
    if (registryInitialized) return;
    registryInitialized = true;
    mediaMetrics.initialScans++;
    lastIntegrityScan = Date.now();
    observeRoot(document, []);
  }

  function runIntegrityScanIfStale() {
    var now = Date.now();
    if (now - lastIntegrityScan < 30000) return;
    var discovered = [];
    lastIntegrityScan = now;
    mediaMetrics.integrityScans++;
    scanNode(document, discovered, false);
    queueDiscoveredMedia(discovered);
  }
  function applyToMedia(element) {
    registerMedia(element);
    html5Adapter.apply(element, playbackState());
  }

  function applyToAll(media) {
    var applied = 0;
    media.forEach(function (element) {
      try {
        applyToMedia(element);
        applied++;
      } catch (error) {}
    });
    return applied;
  }

  function syncRegisteredMedia(media) {
    var synchronized = 0;
    var state = playbackState();
    media.forEach(function (element) {
      try {
        if (!html5Adapter.needsSync(element, state)) return;
        html5Adapter.apply(element, state);
        synchronized++;
      } catch (error) {}
    });
    return synchronized;
  }

  function tryPlayMedia(element) {
    html5Adapter.tryPlay(element);
  }

  function playAll(media) {
    var played = 0;
    var state = playbackState();
    media.forEach(function (element) {
      try {
        if (html5Adapter.needsSync(element, state)) html5Adapter.apply(element, state);
        html5Adapter.tryPlay(element);
        played++;
      } catch (error) {}
    });
    return played;
  }

  function detectSpecial(mediaCount) {
    return playerAdapters.detectSpecial(document, window, mediaCount);
  }

  function buildState(media, applied) {
    var mediaInfo = getPrimaryMediaInfo(media);
    var player = playerAdapters.identify(location);
    return {
      ok: true,
      rate: rate,
      muted: muted,
      volume: muted ? 0 : volume,
      keepPlaying: keepPlaying,
      playerAdapter: player.id,
      playerType: player.label,
      mediaCount: media.length,
      applied: applied,
      duration: mediaInfo.duration,
      currentTime: mediaInfo.currentTime,
      remainingTime: mediaInfo.remainingTime,
      paused: mediaInfo.paused,
      mediaTag: mediaInfo.tag,
      frameResults: []
    };
  }

  function getPrimaryMediaInfo(media) {
    return html5Adapter.getInfo(choosePrimaryMedia(media));
  }

  function choosePrimaryMedia(media) {
    var best = null;
    var bestScore = -1;
    media.forEach(function (element, index) {
      var score = html5Adapter.score(element, index);
      if (score > bestScore) {
        bestScore = score;
        best = element;
      }
    });
    return best;
  }
  function startLock() {
    active = true;
    if (lockTimer) return;
    lockTimer = setInterval(function () {
      if (!active) return;
      var media = collectAll();
      syncRegisteredMedia(media);
      if (keepPlaying) playAll(media);
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
    document.addEventListener("winspeedball-shadow-root-attached", function (event) {
      var path = event && event.composedPath ? event.composedPath() : [];
      var host = path && path.length ? path[0] : event && event.target;
      var discovered = [];
      try {
        if (host && host.shadowRoot) observeRoot(host.shadowRoot, discovered);
      } catch (error) {}
      queueDiscoveredMedia(discovered);
    }, true);
    ensureMediaRegistry();
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
        message = message || {};
        var payload = {};
        Object.keys(message).forEach(function (key) {
          if (key !== "action") payload[key] = message[key];
        });
        chrome.runtime.sendMessage({
          version: 1,
          action: String(message.action || ""),
          source: "content",
          requestId: "content-" + Date.now() + "-" + (++contentRequestSequence),
          payload: payload
        }, function (response) {
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

  function startRegionCapture(captureToken) {
    if (regionCaptureActive) return { ok: false, error: "Region capture is already active." };
    captureToken = String(captureToken || "");
    if (captureToken.length < 16) return { ok: false, error: "Capture authorization is invalid." };
    regionCaptureActive = true;
    regionCaptureToken = captureToken;

    var startX = 0;
    var startY = 0;
    var currentRect = null;
    var dragging = false;
    var overlay = document.createElement("div");
    var selection = document.createElement("div");
    sendRuntimeMessage({ action: "setCaptureIndicator", active: true, captureToken: captureToken });

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
      sendRuntimeMessage({ action: "getCapturePreferences" }).then(function (data) {
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
      var cleanupToken = regionCaptureToken;
      regionCaptureActive = false;
      regionCaptureToken = "";
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("mouseup", onMouseUp, true);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (selection.parentNode) selection.parentNode.removeChild(selection);
      if (!keepIndicator) sendRuntimeMessage({ action: "setCaptureIndicator", active: false, captureToken: cleanupToken });
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
      var token = regionCaptureToken;
      cleanup(true);
      setTimeout(function () {
        sendRuntimeMessage({ action: "captureVisiblePage", captureToken: token }).then(function (res) {
          if (!res.ok || !res.dataUrl) {
            sendRuntimeMessage({ action: "setCaptureIndicator", active: false, captureToken: token });
            return;
          }
          cropDataUrl(res.dataUrl, rect).then(function (cropped) {
            if (!cropped) {
              sendRuntimeMessage({ action: "setCaptureIndicator", active: false, captureToken: token });
              return;
            }
            sendRuntimeMessage({ action: "saveManualCapture", dataUrl: cropped, captureToken: token }).then(function (saveRes) {
              sendRuntimeMessage({ action: "setCaptureIndicator", active: false, captureToken: token });
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
        var special = detectSpecial(ms.length);
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
    if (!request || request.version !== 1 || request.source !== "background" || !request.payload || !sender || sender.id !== chrome.runtime.id || sender.tab) {
      sendResponse({ ok: false, error: "Unauthorized command.", mediaCount: 0, applied: 0, frameResults: [] });
      return true;
    }
    sendResponse(handleCommand(request.payload.command));
    return true;
  });

  window.winSpeedBall = {
    handleCommand: handleCommand,
    startRegionCapture: startRegionCapture,
    getMediaDebugState: function () {
      return Object.assign({}, mediaMetrics, {
        registeredMedia: collectAll().length
      });
    }
  };

})();
