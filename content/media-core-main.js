(function (global) {
  "use strict";

  var VERSION = "2026-07-13-main-media-core-v6";
  var SESSION_STATE_KEY = "__winspeedball_media_state_v6";
  if (global.WinSpeedBallMediaCoreV6 && global.WinSpeedBallMediaCoreV6.version === VERSION) return;
  if (!global.HTMLMediaElement || !global.document) return;

  var mediaPrototype = global.HTMLMediaElement.prototype;
  var pristineRuntime = capturePristineRuntime();
  var nativeObjectDefineProperty = pristineRuntime.defineProperty || Object.defineProperty;
  var nativeObjectDefineProperties = pristineRuntime.defineProperties || Object.defineProperties;
  var nativeGetOwnPropertyDescriptor = pristineRuntime.getOwnPropertyDescriptor || Object.getOwnPropertyDescriptor;
  var nativeReflectDefineProperty = pristineRuntime.reflectDefineProperty || Reflect.defineProperty;
  var nativeMediaPrototype = pristineRuntime.mediaPrototype || mediaPrototype;
  var nativeDescriptors = {
    playbackRate: nativeGetOwnPropertyDescriptor(nativeMediaPrototype, "playbackRate"),
    defaultPlaybackRate: nativeGetOwnPropertyDescriptor(nativeMediaPrototype, "defaultPlaybackRate"),
    volume: nativeGetOwnPropertyDescriptor(nativeMediaPrototype, "volume"),
    muted: nativeGetOwnPropertyDescriptor(nativeMediaPrototype, "muted")
  };
  var nativeMethods = {
    play: nativeMediaPrototype.play,
    pause: nativeMediaPrototype.pause,
    load: nativeMediaPrototype.load,
    addEventListener: nativeMediaPrototype.addEventListener
  };

  var state = {
    rate: 1,
    volume: 0.8,
    muted: false,
    lastAudibleVolume: 0.8,
    rateLocked: false,
    rateDefenseUntil: 0,
    externalRateMasked: false,
    lockRequested: false,
    keepPlaying: false,
    continuousPlayback: false,
    controlMode: "stopped",
    transientLockUntil: 0
  };
  restoreContinuousState();
  var mediaRegistry = new Set();
  var shadowRoots = new Set();
  var observedRoots = new WeakSet();
  var mediaData = new WeakMap();
  var repairData = new WeakMap();
  var mediaSequence = 0;
  var observer = null;
  var integrityTimer = null;
  var rateDefenseFrame = null;
  var internalWriteDepth = 0;
  var internalMethodDepth = 0;
  var currentMedia = null;
  var rateAutoPlayTimers = [];
  var continuousStartTimer = null;
  var lastIntegrityScan = 0;
  var metrics = {
    registered: 0,
    repairedRate: 0,
    repairedVolume: 0,
    blockedRateEvents: 0,
    nativeRateAttacks: 0,
    rateDefenseFrames: 0,
    blockedWrites: 0,
    blockedPauses: 0,
    shadowRoots: 0,
    scans: 0
  };

  function capturePristineRuntime() {
    var result = {};
    var frame = null;
    try {
      frame = document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText = "display:none!important;width:0!important;height:0!important;border:0!important";
      (document.documentElement || document.body).appendChild(frame);
      var cleanWindow = frame.contentWindow;
      if (cleanWindow && cleanWindow.Object && cleanWindow.HTMLMediaElement) {
        result.defineProperty = cleanWindow.Object.defineProperty;
        result.defineProperties = cleanWindow.Object.defineProperties;
        result.getOwnPropertyDescriptor = cleanWindow.Object.getOwnPropertyDescriptor;
        result.reflectDefineProperty = cleanWindow.Reflect.defineProperty;
        result.mediaPrototype = cleanWindow.HTMLMediaElement.prototype;
      }
    } catch (error) {
      result = {};
    }
    try { if (frame && frame.parentNode) frame.parentNode.removeChild(frame); } catch (error) {}
    return result;
  }

  function clamp(value, min, max, fallback) {
    value = Number(value);
    if (!Number.isFinite(value)) value = fallback;
    return Math.max(min, Math.min(max, value));
  }

  function normalizeRate(value) {
    return Math.round(clamp(value, 0.25, 16, 1) * 100) / 100;
  }

  function restoreContinuousState() {
    try {
      var saved = JSON.parse(global.sessionStorage.getItem(SESSION_STATE_KEY) || "null");
      if (!saved || saved.continuousPlayback !== true) return false;
      state.rate = normalizeRate(saved.rate);
      state.rateLocked = saved.rateLocked === true;
      state.continuousPlayback = true;
      state.externalRateMasked = siteProfile().id === "chaoxing";
      state.controlMode = "apply";
      return true;
    } catch (error) { return false; }
  }

  function persistContinuousState() {
    try {
      if (!state.continuousPlayback) {
        global.sessionStorage.removeItem(SESSION_STATE_KEY);
        return;
      }
      global.sessionStorage.setItem(SESSION_STATE_KEY, JSON.stringify({
        rate: state.rate,
        rateLocked: state.rateLocked,
        continuousPlayback: true
      }));
    } catch (error) {}
  }

  function isRateProperty(property) {
    return property === "playbackRate" || property === "defaultPlaybackRate";
  }

  function normalizeVolume(value) {
    return Math.round(clamp(value, 0, 1, 0.8) * 100) / 100;
  }

  function isMedia(value) {
    if (!value) return false;
    try { return value instanceof global.HTMLMediaElement; } catch (error) { return false; }
  }

  function dataFor(media) {
    var data = mediaData.get(media);
    if (data) return data;
    var order = ++mediaSequence;
    data = { id: "media-" + order, order: order, explicitPause: false, listenersInstalled: false };
    mediaData.set(media, data);
    return data;
  }

  function isConnectedMedia(media) {
    if (!isMedia(media)) return false;
    try { return media.isConnected !== false; } catch (error) { return true; }
  }

  function isGuarded(property) {
    if (internalWriteDepth > 0) return false;
    if (property === "pause") return state.keepPlaying;
    if (isRateProperty(property) && state.rateLocked) return true;
    return state.lockRequested || Date.now() < state.transientLockUntil;
  }

  function nativeRead(media, property, fallback) {
    var descriptor = nativeDescriptors[property];
    try {
      if (descriptor && typeof descriptor.get === "function") return descriptor.get.call(media);
      return media[property];
    } catch (error) {
      return fallback;
    }
  }

  function nativeWrite(media, property, value) {
    var descriptor = nativeDescriptors[property];
    internalWriteDepth++;
    try {
      if (descriptor && typeof descriptor.set === "function") descriptor.set.call(media, value);
      else media[property] = value;
      return true;
    } catch (error) {
      return false;
    } finally {
      internalWriteDepth--;
    }
  }

  function removeOwnOverride(media, property) {
    try {
      var descriptor = nativeGetOwnPropertyDescriptor(media, property);
      if (descriptor && descriptor.configurable !== false) delete media[property];
    } catch (error) {}
  }

  function enforceRateOnly(media) {
    if (!isMedia(media)) return false;
    removeOwnOverride(media, "playbackRate");
    removeOwnOverride(media, "defaultPlaybackRate");
    var applied = nativeWrite(media, "playbackRate", state.rate);
    nativeWrite(media, "defaultPlaybackRate", state.rate);
    return applied;
  }

  function actualRate(media) {
    return Number(nativeRead(media, "playbackRate", 1));
  }

  function requestDefenseFrame(callback) {
    if (typeof global.requestAnimationFrame === "function") return global.requestAnimationFrame(callback);
    return setTimeout(callback, 16);
  }

  function cancelDefenseFrame(frameId) {
    if (frameId == null) return;
    if (typeof global.cancelAnimationFrame === "function") global.cancelAnimationFrame(frameId);
    else clearTimeout(frameId);
  }

  function runRateDefenseFrame() {
    rateDefenseFrame = null;
    if (Date.now() >= state.rateDefenseUntil) return;
    metrics.rateDefenseFrames++;
    collectMedia().forEach(function (media) {
      if (Math.abs(actualRate(media) - state.rate) <= 0.001) return;
      metrics.nativeRateAttacks++;
      enforceRateOnly(media);
      state.rateDefenseUntil = Math.max(state.rateDefenseUntil, Date.now() + 3000);
    });
    rateDefenseFrame = requestDefenseFrame(runRateDefenseFrame);
  }

  function startRateDefense(duration) {
    state.rateDefenseUntil = Math.max(state.rateDefenseUntil, Date.now() + Math.max(300, Number(duration || 0)));
    if (rateDefenseFrame == null) rateDefenseFrame = requestDefenseFrame(runRateDefenseFrame);
  }

  function stopRateDefense() {
    state.rateDefenseUntil = 0;
    if (rateDefenseFrame != null) cancelDefenseFrame(rateDefenseFrame);
    rateDefenseFrame = null;
  }

  function applyMedia(media) {
    if (!isMedia(media)) return false;
    registerMedia(media);
    removeOwnOverride(media, "playbackRate");
    removeOwnOverride(media, "defaultPlaybackRate");
    removeOwnOverride(media, "volume");
    removeOwnOverride(media, "muted");
    var wantedVolume = state.muted ? 0 : state.volume;
    var applied = false;
    applied = enforceRateOnly(media) || applied;
    nativeWrite(media, "muted", state.muted);
    nativeWrite(media, "volume", wantedVolume);
    return applied;
  }

  function cancelRepairs(media) {
    var repair = repairData.get(media);
    if (!repair) return;
    repair.token++;
    repair.timers.forEach(function (timer) { clearTimeout(timer); });
    repair.timers = [];
  }

  function scheduleRepair(media, property) {
    if (!isMedia(media) || !isGuarded(property)) return;
    var repair = repairData.get(media);
    if (!repair) {
      repair = { token: 0, timers: [] };
      repairData.set(media, repair);
    }
    cancelRepairs(media);
    var token = ++repair.token;
    [0, 120, 600, 1200].forEach(function (delay) {
      repair.timers.push(setTimeout(function () {
        if (repair.token !== token || !isGuarded(property)) return;
        applyMedia(media);
        if (property === "playbackRate" || property === "defaultPlaybackRate") metrics.repairedRate++;
        else metrics.repairedVolume++;
      }, delay));
    });
  }

  function playMedia(media) {
    if (!isMedia(media)) return Promise.resolve(false);
    try {
      if (media.paused === false) return Promise.resolve(true);
    } catch (error) {}
    try {
      internalMethodDepth++;
      var result = nativeMethods.play.call(media);
      return Promise.resolve(result).then(function () { return true; }).catch(function () { return false; });
    } catch (error) {
      return Promise.resolve(false);
    } finally {
      internalMethodDepth--;
    }
  }

  function tryPlay(media) {
    if (!state.keepPlaying || dataFor(media).explicitPause) return Promise.resolve(false);
    return playMedia(media);
  }

  function cancelRateAutoPlay() {
    rateAutoPlayTimers.forEach(function (timer) { clearTimeout(timer); });
    rateAutoPlayTimers = [];
    if (continuousStartTimer) clearTimeout(continuousStartTimer);
    continuousStartTimer = null;
  }

  function resumeAfterRateChange(media) {
    cancelRateAutoPlay();
    var target = chooseMedia(media || collectMedia());
    if (!target) return false;
    currentMedia = target;
    dataFor(target).explicitPause = false;
    playMedia(target);
    [120, 600, 1200].forEach(function (delay) {
      rateAutoPlayTimers.push(setTimeout(function () { playMedia(target); }, delay));
    });
    return true;
  }

  function scheduleContinuousPlayback() {
    if (!state.continuousPlayback) return;
    if (continuousStartTimer) clearTimeout(continuousStartTimer);
    continuousStartTimer = setTimeout(function () {
      continuousStartTimer = null;
      if (!state.continuousPlayback) return;
      resumeAfterRateChange(collectMedia());
    }, 80);
  }

  function installMediaListeners(media) {
    var data = dataFor(media);
    if (data.listenersInstalled || typeof nativeMethods.addEventListener !== "function") return;
    data.listenersInstalled = true;
    ["loadstart", "loadedmetadata", "loadeddata", "canplay", "playing", "durationchange", "emptied"].forEach(function (eventName) {
      nativeMethods.addEventListener.call(media, eventName, function () {
        registerMedia(media);
        if (isGuarded("playbackRate")) scheduleRepair(media, "playbackRate");
        if (state.keepPlaying) tryPlay(media);
        if (state.continuousPlayback && ["loadstart", "loadedmetadata", "loadeddata", "canplay"].indexOf(eventName) >= 0) {
          scheduleContinuousPlayback();
        }
      }, true);
    });
    nativeMethods.addEventListener.call(media, "ratechange", function () {
      if (!isGuarded("playbackRate")) return;
      var actual = Number(nativeRead(media, "playbackRate", 1));
      if (Math.abs(actual - state.rate) > 0.001) scheduleRepair(media, "playbackRate");
    }, true);
    nativeMethods.addEventListener.call(media, "volumechange", function () {
      if (!isGuarded("volume")) return;
      var wantedVolume = state.muted ? 0 : state.volume;
      var actualVolume = Number(nativeRead(media, "volume", 0));
      var actualMuted = !!nativeRead(media, "muted", false);
      if (Math.abs(actualVolume - wantedVolume) > 0.001 || actualMuted !== state.muted) scheduleRepair(media, "volume");
    }, true);
    nativeMethods.addEventListener.call(media, "play", function () {
      currentMedia = media;
      data.explicitPause = false;
      if (isGuarded("playbackRate")) scheduleRepair(media, "playbackRate");
    }, true);
    nativeMethods.addEventListener.call(media, "pause", function () {
      if (state.keepPlaying && !data.explicitPause) setTimeout(function () { tryPlay(media); }, 120);
    }, true);
  }

  function interceptRateChange(event) {
    var media = event && event.target;
    if (!isMedia(media) || !isGuarded("playbackRate")) return;
    metrics.blockedRateEvents++;
    if (event && typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    else if (event && typeof event.stopPropagation === "function") event.stopPropagation();
    if (Math.abs(actualRate(media) - state.rate) <= 0.001) return;
    metrics.nativeRateAttacks++;
    state.externalRateMasked = true;
    enforceRateOnly(media);
    startRateDefense(3000);
  }

  function registerMedia(media) {
    if (!isMedia(media)) return false;
    var added = !mediaRegistry.has(media);
    mediaRegistry.add(media);
    dataFor(media);
    installMediaListeners(media);
    if (added) {
      metrics.registered++;
      if (state.rateLocked) {
        enforceRateOnly(media);
        startRateDefense(1200);
      }
      if (state.continuousPlayback) scheduleContinuousPlayback();
    }
    return added;
  }

  function observeRoot(root) {
    if (!root || !root.querySelectorAll || observedRoots.has(root)) return;
    observedRoots.add(root);
    if (!observer && global.MutationObserver) observer = new MutationObserver(handleMutations);
    if (observer) {
      try { observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] }); } catch (error) {}
    }
    scanRoot(root);
  }

  function scanNode(node) {
    if (!node) return;
    registerMedia(node);
    try {
      if (node.shadowRoot) {
        shadowRoots.add(node.shadowRoot);
        observeRoot(node.shadowRoot);
      }
    } catch (error) {}
    if (!node.querySelectorAll) return;
    var elements = [];
    try { elements = Array.from(node.querySelectorAll("*")); } catch (error) {}
    elements.forEach(function (element) {
      registerMedia(element);
      try {
        if (element.shadowRoot) {
          shadowRoots.add(element.shadowRoot);
          observeRoot(element.shadowRoot);
        }
      } catch (error) {}
    });
  }

  function scanRoot(root) {
    metrics.scans++;
    scanNode(root);
  }

  function handleMutations(records) {
    (records || []).forEach(function (record) {
      Array.from(record.addedNodes || []).forEach(scanNode);
      if (state.continuousPlayback && record.type === "attributes" && isMedia(record.target)) scheduleContinuousPlayback();
    });
    if (state.rateLocked || state.lockRequested || state.keepPlaying) synchronizeAll();
  }

  function collectMedia() {
    var now = Date.now();
    if (now - lastIntegrityScan >= 30000) {
      lastIntegrityScan = now;
      scanRoot(document);
      shadowRoots.forEach(scanRoot);
    }
    return Array.from(mediaRegistry).filter(isConnectedMedia);
  }

  function synchronizeAll() {
    var applied = 0;
    collectMedia().forEach(function (media) {
      if (applyMedia(media)) applied++;
      if (state.keepPlaying) tryPlay(media);
    });
    return applied;
  }

  function installPropertyGuard(property) {
    var descriptor = nativeDescriptors[property];
    if (!descriptor || descriptor.configurable === false || typeof descriptor.get !== "function" || typeof descriptor.set !== "function") return;
    nativeObjectDefineProperty.call(Object, mediaPrototype, property, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: function () {
        registerMedia(this);
        if (isRateProperty(property) && isGuarded(property)) return state.externalRateMasked ? 1 : state.rate;
        return descriptor.get.call(this);
      },
      set: function (value) {
        registerMedia(this);
        if (isGuarded(property)) {
          metrics.blockedWrites++;
          if (isRateProperty(property) && Math.abs(Number(value) - state.rate) > 0.001) state.externalRateMasked = true;
          scheduleRepair(this, property);
          return;
        }
        return descriptor.set.call(this, value);
      }
    });
  }

  function installMethodGuards() {
    if (typeof nativeMethods.play === "function") {
      mediaPrototype.play = function () {
        registerMedia(this);
        dataFor(this).explicitPause = false;
        return nativeMethods.play.apply(this, arguments);
      };
    }
    if (typeof nativeMethods.pause === "function") {
      mediaPrototype.pause = function () {
        registerMedia(this);
        if (internalMethodDepth === 0 && state.keepPlaying && !dataFor(this).explicitPause) {
          metrics.blockedPauses++;
          setTimeout(function (media) { tryPlay(media); }, 120, this);
          return;
        }
        return nativeMethods.pause.apply(this, arguments);
      };
    }
    if (typeof nativeMethods.load === "function") {
      mediaPrototype.load = function () {
        registerMedia(this);
        return nativeMethods.load.apply(this, arguments);
      };
    }
  }

  function installDefinePropertyGuard() {
    Object.defineProperty = function (target, property, descriptor) {
      var propertyName = String(property);
      var controlled = ["playbackRate", "defaultPlaybackRate", "volume", "muted"].indexOf(propertyName) >= 0;
      if (target === mediaPrototype && controlled) {
        metrics.blockedWrites++;
        return target;
      }
      if (!isMedia(target) || !controlled) {
        return nativeObjectDefineProperty.apply(Object, arguments);
      }
      var safeDescriptor = Object.assign({}, descriptor || {}, { configurable: true });
      var result = nativeObjectDefineProperty.call(Object, target, property, safeDescriptor);
      registerMedia(target);
      if (isGuarded(propertyName)) scheduleRepair(target, propertyName);
      return result;
    };
    Object.defineProperties = function (target, descriptors) {
      if ((!isMedia(target) && target !== mediaPrototype) || !descriptors) return nativeObjectDefineProperties.apply(Object, arguments);
      var safe = {};
      Object.keys(descriptors).forEach(function (property) {
        if (target === mediaPrototype && ["playbackRate", "defaultPlaybackRate", "volume", "muted"].indexOf(property) >= 0) {
          metrics.blockedWrites++;
          return;
        }
        safe[property] = ["playbackRate", "defaultPlaybackRate", "volume", "muted"].indexOf(property) >= 0
          ? Object.assign({}, descriptors[property], { configurable: true })
          : descriptors[property];
      });
      var result = nativeObjectDefineProperties.call(Object, target, safe);
      if (isMedia(target)) registerMedia(target);
      ["playbackRate", "defaultPlaybackRate", "volume", "muted"].forEach(function (property) {
        if (isMedia(target) && safe[property] && isGuarded(property)) scheduleRepair(target, property);
      });
      return result;
    };
    Reflect.defineProperty = function (target, property, descriptor) {
      var propertyName = String(property);
      var controlled = ["playbackRate", "defaultPlaybackRate", "volume", "muted"].indexOf(propertyName) >= 0;
      if (target === mediaPrototype && controlled) {
        metrics.blockedWrites++;
        return true;
      }
      if (!isMedia(target) || !controlled) return nativeReflectDefineProperty.apply(Reflect, arguments);
      var result = nativeReflectDefineProperty.call(Reflect, target, property, Object.assign({}, descriptor || {}, { configurable: true }));
      registerMedia(target);
      if (isGuarded(propertyName)) scheduleRepair(target, propertyName);
      return result;
    };
  }

  function startIntegrityLoop() {
    if (integrityTimer) return;
    integrityTimer = setInterval(function () {
      if (!state.rateLocked && !state.lockRequested && !state.keepPlaying) return;
      synchronizeAll();
    }, 250);
  }

  function stopIntegrityLoopIfIdle() {
    if (state.rateLocked || state.lockRequested || state.keepPlaying || !integrityTimer) return;
    clearInterval(integrityTimer);
    integrityTimer = null;
  }

  function transientApply() {
    state.transientLockUntil = Date.now() + 1500;
    state.controlMode = state.lockRequested ? "lock" : "apply";
    var applied = synchronizeAll();
    collectMedia().forEach(function (media) { scheduleRepair(media, "playbackRate"); });
    if (state.rateLocked) {
      startRateDefense(5000);
      startIntegrityLoop();
    }
    return applied;
  }

  function mediaScore(media, index) {
    var score = 0;
    try {
      var tag = String(media.tagName || "").toLowerCase();
      var rect = media.getBoundingClientRect ? media.getBoundingClientRect() : { width: 0, height: 0 };
      var area = Math.max(0, rect.width || 0) * Math.max(0, rect.height || 0);
      if (!media.paused && (tag === "audio" || area >= 400)) score += 1000000;
      var duration = Number(media.duration || 0);
      if (Number.isFinite(duration) && duration >= 8) score += 100000;
      if (tag === "video") score += 50000;
      score += Math.min(500000, area);
      score += dataFor(media).order || 0;
    } catch (error) {}
    return score - index;
  }

  function chooseMedia(media) {
    if (currentMedia && media.indexOf(currentMedia) >= 0) {
      try {
        var currentTag = String(currentMedia.tagName || "").toLowerCase();
        var currentRect = currentMedia.getBoundingClientRect ? currentMedia.getBoundingClientRect() : { width: 0, height: 0 };
        var currentArea = Math.max(0, currentRect.width || 0) * Math.max(0, currentRect.height || 0);
        if (!currentMedia.paused && !currentMedia.ended && (currentTag === "audio" || currentArea >= 400)) return currentMedia;
      } catch (error) {}
    }
    var best = null;
    var bestScore = -Infinity;
    media.forEach(function (item, index) {
      var score = mediaScore(item, index);
      if (score > bestScore) { best = item; bestScore = score; }
    });
    currentMedia = best;
    return best;
  }

  function positiveTime(value) {
    value = Number(value);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function timedRangeEnd(ranges) {
    try {
      if (ranges && ranges.length > 0 && typeof ranges.end === "function") return positiveTime(ranges.end(ranges.length - 1));
    } catch (error) {}
    return 0;
  }

  function parseClockTime(value) {
    var parts = String(value || "").trim().split(":");
    if (parts.length < 2 || parts.length > 3 || parts.some(function (part) { return !/^\d+$/.test(part.trim()); })) return 0;
    var seconds = 0;
    parts.forEach(function (part) { seconds = seconds * 60 + Number(part); });
    return positiveTime(seconds);
  }

  function videoJsDomTime(media, selector) {
    try {
      var root = media && typeof media.closest === "function" ? media.closest(".video-js") : null;
      var node = root && root.querySelector ? root.querySelector(selector) : null;
      if (!node && document.querySelector) node = document.querySelector(selector);
      return node ? parseClockTime(node.textContent) : 0;
    } catch (error) { return 0; }
  }

  function videoJsPlayer(media) {
    if (!media) return null;
    try {
      if (media.player_ && typeof media.player_.duration === "function") return media.player_;
      if (media.tech_ && media.tech_.player_ && typeof media.tech_.player_.duration === "function") return media.tech_.player_;
      var videojs = global.videojs;
      if (!videojs) return null;
      var host = typeof media.closest === "function" ? media.closest(".video-js") : null;
      var ids = [media.id, host && host.id].filter(Boolean);
      for (var index = 0; index < ids.length; index += 1) {
        var player = typeof videojs.getPlayer === "function" ? videojs.getPlayer(ids[index]) : null;
        if (!player && videojs.players) player = videojs.players[ids[index]];
        if (player && typeof player.duration === "function") return player;
      }
    } catch (error) {}
    return null;
  }

  function mediaInfo(media) {
    if (!media) {
      var displayedDuration = videoJsDomTime(null, ".vjs-duration-display");
      var displayedCurrentTime = videoJsDomTime(null, ".vjs-current-time-display");
      return {
        duration: displayedDuration,
        durationSource: displayedDuration ? "videojs-dom" : "",
        currentTime: displayedCurrentTime,
        remainingTime: Math.max(0, displayedDuration - displayedCurrentTime),
        paused: true,
        tag: ""
      };
    }
    var duration = positiveTime(media.duration);
    var durationSource = duration ? "html5" : "";
    var currentTime = Number(media.currentTime || 0);
    var paused = !!media.paused;
    var player = videoJsPlayer(media);
    if (!duration && player) {
      try { duration = positiveTime(player.duration()); } catch (error) {}
      if (duration) durationSource = "videojs";
    }
    if (player) {
      try {
        var playerTime = Number(player.currentTime());
        if (Number.isFinite(playerTime) && playerTime >= 0) currentTime = playerTime;
      } catch (error) {}
      try { paused = !!player.paused(); } catch (error) {}
    }
    if (!duration) {
      duration = timedRangeEnd(media.seekable);
      if (duration) durationSource = "seekable";
    }
    if (!duration && typeof media.getAttribute === "function") {
      try { duration = positiveTime(media.getAttribute("data-duration") || media.getAttribute("duration")); } catch (error) {}
      if (duration) durationSource = "attribute";
    }
    if (!duration) {
      duration = videoJsDomTime(media, ".vjs-duration-display");
      if (duration) durationSource = "videojs-dom";
    }
    if (currentTime <= 0) {
      var displayedCurrentTime = videoJsDomTime(media, ".vjs-current-time-display");
      if (displayedCurrentTime > 0) currentTime = displayedCurrentTime;
    }
    if (!duration) {
      duration = timedRangeEnd(media.buffered);
      if (duration) durationSource = "buffered";
    }
    if (!Number.isFinite(currentTime) || currentTime < 0) currentTime = 0;
    return {
      duration: duration,
      durationSource: durationSource,
      currentTime: currentTime,
      remainingTime: Math.max(0, duration - currentTime),
      paused: paused,
      tag: String(media.tagName || "").toLowerCase()
    };
  }

  function mediaTitle(media) {
    if (!media || typeof media.getAttribute !== "function") return "";
    var value = "";
    try { value = media.getAttribute("title") || media.getAttribute("aria-label") || ""; } catch (error) {}
    return String(value).replace(/\s+/g, " ").trim().slice(0, 256);
  }

  function snapshot(media) {
    var info = mediaInfo(media);
    return {
      id: dataFor(media).id,
      title: mediaTitle(media),
      duration: info.duration,
      durationSource: info.durationSource,
      currentTime: info.currentTime,
      progress: info.duration > 0 ? Math.max(0, Math.min(1, info.currentTime / info.duration)) : 0,
      rate: Number(nativeRead(media, "playbackRate", 1)),
      volume: Number(nativeRead(media, "volume", 0)),
      muted: !!nativeRead(media, "muted", false),
      paused: info.paused,
      mediaType: info.tag
    };
  }

  function siteProfile() {
    var hostname = String(location && location.hostname || "").toLowerCase();
    if (/(^|\.)chaoxing\.com$/.test(hostname)) return { id: "chaoxing", label: "学习通/超星强控制" };
    if (/(^|\.)youtube\.com$/.test(hostname) || hostname === "youtu.be") return { id: "youtube", label: "YouTube" };
    if (/(^|\.)bilibili\.com$/.test(hostname) || hostname === "b23.tv") return { id: "bilibili", label: "Bilibili" };
    return { id: "main-world-html5", label: "HTML5 强控制" };
  }

  function detectSpecial(mediaCount) {
    try {
      if (document.querySelector("ruffle-player, ruffle-embed, ruffle-object, object[type*='shockwave-flash'], embed[type*='shockwave-flash']")) {
        return { type: "Ruffle/Flash", reason: "检测到 Ruffle/Flash，可能不是标准 HTML5 视频" };
      }
      if (!mediaCount) {
        var canvases = Array.from(document.querySelectorAll("canvas"));
        var canvasPlayer = canvases.some(function (canvas) {
          var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : canvas;
          return Number(rect.width || 0) * Number(rect.height || 0) >= 40000;
        });
        if (canvasPlayer) return { type: "Canvas", reason: "检测到 Canvas 播放区域，无法使用 HTML5 媒体强控制" };
      }
    } catch (error) {}
    return { type: "" };
  }

  function buildState(media, applied) {
    var primary = chooseMedia(media);
    var info = mediaInfo(primary);
    var profile = siteProfile();
    var measuredRate = primary ? actualRate(primary) : state.rate;
    var rateStable = media.length > 0 && media.every(function (item) {
      return Math.abs(actualRate(item) - state.rate) <= 0.001;
    });
    return {
      ok: true,
      rate: measuredRate,
      targetRate: state.rate,
      rateStable: rateStable,
      externalRateMasked: state.externalRateMasked,
      rateLocked: state.rateLocked,
      muted: state.muted,
      volume: state.muted ? 0 : state.volume,
      keepPlaying: state.keepPlaying,
      continuousPlayback: state.continuousPlayback,
      controlMode: state.controlMode,
      playerAdapter: profile.id,
      playerType: profile.label,
      mediaCount: media.length,
      applied: applied || 0,
      duration: info.duration,
      durationSource: info.durationSource,
      currentTime: info.currentTime,
      remainingTime: info.remainingTime,
      paused: info.paused,
      mediaTag: info.tag,
      frameResults: []
    };
  }

  function noMediaResult() {
    return { ok: false, error: "No controllable media was found.", mediaCount: 0, applied: 0, frameResults: [] };
  }

  function handleCommand(command) {
    command = command || {};
    var media;
    var applied;
    switch (command.type) {
      case "SET_RATE":
        state.rate = normalizeRate(command.rate);
        state.rateLocked = true;
        state.externalRateMasked = siteProfile().id === "chaoxing";
        if (state.continuousPlayback) persistContinuousState();
        applied = transientApply();
        media = collectMedia();
        return buildState(media, applied);
      case "STEP_UP":
        state.rate = normalizeRate(state.rate + 0.25);
        state.rateLocked = true;
        state.externalRateMasked = siteProfile().id === "chaoxing";
        if (state.continuousPlayback) persistContinuousState();
        applied = transientApply();
        media = collectMedia();
        return buildState(media, applied);
      case "STEP_DOWN":
        state.rate = normalizeRate(state.rate - 0.25);
        state.rateLocked = true;
        state.externalRateMasked = siteProfile().id === "chaoxing";
        if (state.continuousPlayback) persistContinuousState();
        applied = transientApply();
        media = collectMedia();
        return buildState(media, applied);
      case "RESET":
        cancelRateAutoPlay();
        state.continuousPlayback = false;
        persistContinuousState();
        state.rate = 1;
        state.volume = 0.8;
        state.lastAudibleVolume = 0.8;
        state.muted = false;
        state.rateLocked = false;
        state.externalRateMasked = false;
        state.keepPlaying = false;
        state.lockRequested = false;
        state.controlMode = "apply";
        stopRateDefense();
        stopIntegrityLoopIfIdle();
        applied = transientApply();
        return buildState(collectMedia(), applied);
      case "SET_MUTED":
        if (command.muted && state.volume > 0) state.lastAudibleVolume = state.volume;
        state.muted = !!command.muted;
        if (!state.muted && state.volume === 0) state.volume = state.lastAudibleVolume || 0.8;
        applied = transientApply();
        return buildState(collectMedia(), applied);
      case "TOGGLE_MUTED":
        if (!state.muted && state.volume > 0) state.lastAudibleVolume = state.volume;
        state.muted = !state.muted;
        if (!state.muted && state.volume === 0) state.volume = state.lastAudibleVolume || 0.8;
        applied = transientApply();
        return buildState(collectMedia(), applied);
      case "SET_VOLUME":
        state.volume = normalizeVolume(command.volume);
        state.muted = state.volume === 0;
        if (state.volume > 0) state.lastAudibleVolume = state.volume;
        applied = transientApply();
        return buildState(collectMedia(), applied);
      case "ENABLE_AUTOPLAY":
        state.keepPlaying = false;
        state.continuousPlayback = true;
        state.controlMode = state.lockRequested ? "lock" : state.rateLocked ? "apply" : "stopped";
        persistContinuousState();
        media = collectMedia();
        applied = synchronizeAll();
        resumeAfterRateChange(media);
        return buildState(media, applied);
      case "DISABLE_AUTOPLAY":
        cancelRateAutoPlay();
        state.keepPlaying = false;
        state.continuousPlayback = false;
        persistContinuousState();
        state.controlMode = state.lockRequested ? "lock" : state.rateLocked ? "apply" : "stopped";
        stopIntegrityLoopIfIdle();
        return buildState(collectMedia(), 0);
      case "LOCK_STATE":
        state.lockRequested = true;
        state.controlMode = "lock";
        applied = synchronizeAll();
        startRateDefense(5000);
        startIntegrityLoop();
        return buildState(collectMedia(), applied);
      case "STOP_LOCK":
        cancelRateAutoPlay();
        state.lockRequested = false;
        state.rateLocked = false;
        state.externalRateMasked = false;
        state.keepPlaying = false;
        state.continuousPlayback = false;
        persistContinuousState();
        state.transientLockUntil = 0;
        state.controlMode = "stopped";
        stopRateDefense();
        collectMedia().forEach(cancelRepairs);
        stopIntegrityLoopIfIdle();
        return buildState(collectMedia(), 0);
      case "PLAY":
        media = collectMedia();
        var playTarget = chooseMedia(media);
        if (!playTarget) return noMediaResult();
        dataFor(playTarget).explicitPause = false;
        currentMedia = playTarget;
        try {
          internalMethodDepth++;
          var playResult = nativeMethods.play.call(playTarget);
          return Promise.resolve(playResult).then(function () { return buildState(media, 0); }).catch(function (error) {
            return { ok: false, code: "PLAYBACK_BLOCKED", error: error && error.message || "Playback was blocked.", mediaCount: media.length, applied: 0, frameResults: [] };
          });
        } catch (error) {
          return { ok: false, code: "PLAYBACK_BLOCKED", error: error.message || String(error), mediaCount: media.length, applied: 0, frameResults: [] };
        } finally {
          internalMethodDepth--;
        }
      case "PAUSE":
        cancelRateAutoPlay();
        media = collectMedia();
        var pauseTarget = chooseMedia(media);
        if (!pauseTarget) return noMediaResult();
        dataFor(pauseTarget).explicitPause = true;
        try {
          internalMethodDepth++;
          nativeMethods.pause.call(pauseTarget);
        } catch (error) {
          dataFor(pauseTarget).explicitPause = false;
          return { ok: false, error: error.message || String(error), mediaCount: media.length, applied: 0, frameResults: [] };
        } finally {
          internalMethodDepth--;
        }
        return buildState(media, 0);
      case "GET_MEDIA_LIST":
        media = collectMedia();
        var listResult = buildState(media, 0);
        listResult.media = media.map(snapshot);
        return listResult;
      case "GET_STATUS":
        media = collectMedia();
        var status = buildState(media, 0);
        var special = detectSpecial(media.length);
        if (special.type) {
          status.specialPlayerDetected = true;
          status.specialPlayerType = special.type;
          status.reason = special.reason;
        }
        return status;
      default:
        return { ok: false, error: "Unknown media command.", mediaCount: 0, applied: 0, frameResults: [] };
    }
  }

  installPropertyGuard("playbackRate");
  installPropertyGuard("defaultPlaybackRate");
  installPropertyGuard("volume");
  installPropertyGuard("muted");
  installMethodGuards();
  installDefinePropertyGuard();
  if (typeof nativeMethods.addEventListener === "function") {
    nativeMethods.addEventListener.call(document, "ratechange", interceptRateChange, true);
  }
  observeRoot(document);
  if (state.rateLocked) {
    startRateDefense(5000);
    startIntegrityLoop();
  }
  document.addEventListener("winspeedball-shadow-root-attached", function (event) {
    var path = event && event.composedPath ? event.composedPath() : [];
    var host = path.length ? path[0] : event && event.target;
    try {
      if (host && host.shadowRoot) {
        shadowRoots.add(host.shadowRoot);
        metrics.shadowRoots = shadowRoots.size;
        observeRoot(host.shadowRoot);
      }
    } catch (error) {}
  }, true);
  document.addEventListener("visibilitychange", function () {
    if (state.lockRequested || state.rateLocked || state.keepPlaying) synchronizeAll();
  }, true);
  global.addEventListener("pagehide", function () {
    state.lockRequested = false;
    state.rateLocked = false;
    state.keepPlaying = false;
    state.continuousPlayback = false;
    state.transientLockUntil = 0;
    cancelRateAutoPlay();
    stopRateDefense();
    stopIntegrityLoopIfIdle();
  }, true);
  global.addEventListener("pageshow", function () {
    if (!restoreContinuousState()) return;
    startRateDefense(5000);
    startIntegrityLoop();
    synchronizeAll();
    scheduleContinuousPlayback();
  }, true);

  var publicApi = Object.freeze({
    version: VERSION,
    handleCommand: handleCommand,
    getDebugState: function () {
      return Object.assign({}, metrics, {
        mediaCount: mediaRegistry.size,
        rateLocked: state.rateLocked,
        externalRateMasked: state.externalRateMasked,
        lockRequested: state.lockRequested,
        keepPlaying: state.keepPlaying,
        continuousPlayback: state.continuousPlayback,
        controlMode: state.controlMode
      });
    }
  });
  nativeObjectDefineProperty.call(Object, global, "WinSpeedBallMediaCoreV6", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: publicApi
  });
  if (!global.WinSpeedBallMediaCore) {
    nativeObjectDefineProperty.call(Object, global, "WinSpeedBallMediaCore", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: publicApi
    });
  }
})(window);
