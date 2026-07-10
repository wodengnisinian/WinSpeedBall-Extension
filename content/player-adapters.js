(function (global) {
  "use strict";

  if (global.WinSpeedBallPlayerAdapters) return;

  function isMedia(element) {
    if (!element) return false;
    try {
      if (element instanceof HTMLMediaElement) return true;
    } catch (error) {}
    return /^(VIDEO|AUDIO)$/.test(element.tagName || "");
  }

  function findMedia(root) {
    if (!root || !root.querySelectorAll) return [];
    try {
      return Array.from(root.querySelectorAll("video, audio"));
    } catch (error) {
      return [];
    }
  }

  function expectedVolume(state) {
    return state.muted ? 0 : state.volume;
  }

  function needsSync(element, state) {
    if (!isMedia(element)) return false;
    try {
      return Math.abs(Number(element.playbackRate || 1) - state.rate) > 0.001 ||
        Math.abs(Number(element.defaultPlaybackRate || 1) - state.rate) > 0.001 ||
        element.muted !== state.muted ||
        Math.abs(Number(element.volume || 0) - expectedVolume(state)) > 0.001;
    } catch (error) {
      return true;
    }
  }

  function apply(element, state) {
    element.playbackRate = state.rate;
    element.defaultPlaybackRate = state.rate;
    element.muted = state.muted;
    element.volume = expectedVolume(state);
  }

  function tryPlay(element) {
    try {
      if (!element.paused || element.readyState < 2) return;
      var result = element.play();
      if (result && result.catch) result.catch(function () {});
    } catch (error) {}
  }

  function getInfo(element) {
    if (!element) return { duration: 0, currentTime: 0, remainingTime: 0, paused: true, tag: "" };
    var duration = Number(element.duration);
    var currentTime = Number(element.currentTime);
    if (!Number.isFinite(duration)) duration = 0;
    if (!Number.isFinite(currentTime)) currentTime = 0;
    return {
      duration: duration,
      currentTime: currentTime,
      remainingTime: Math.max(0, duration - currentTime),
      paused: !!element.paused,
      tag: element.tagName ? element.tagName.toLowerCase() : ""
    };
  }

  function score(element, index) {
    if (!element) return -1;
    var rect = { width: 0, height: 0 };
    try { rect = element.getBoundingClientRect(); } catch (error) {}
    var area = Math.max(0, rect.width || 0) * Math.max(0, rect.height || 0);
    var duration = Number(element.duration);
    if (!Number.isFinite(duration)) duration = 0;
    var value = 0;
    if (!element.paused) value += 1000000;
    if (duration >= 8) value += 100000;
    if ((element.tagName || "").toLowerCase() === "video") value += 50000;
    value += Math.min(area, 500000);
    value += Math.min(duration, 36000);
    return value - index;
  }

  var html5Adapter = {
    id: "html5",
    label: "HTML5",
    capabilities: { playbackRate: true, volume: true, muted: true, autoplay: true },
    isMedia: isMedia,
    findMedia: findMedia,
    needsSync: needsSync,
    apply: apply,
    tryPlay: tryPlay,
    getInfo: getInfo,
    score: score
  };

  var siteProfiles = [
    {
      id: "youtube",
      label: "YouTube",
      matches: function (locationValue) {
        var hostname = String(locationValue && locationValue.hostname || "").toLowerCase();
        return /(^|\.)youtube\.com$/.test(hostname) || hostname === "youtu.be";
      }
    },
    {
      id: "bilibili",
      label: "Bilibili",
      matches: function (locationValue) {
        var hostname = String(locationValue && locationValue.hostname || "").toLowerCase();
        return /(^|\.)bilibili\.com$/.test(hostname) || hostname === "b23.tv";
      }
    },
    {
      id: "html5",
      label: "HTML5",
      matches: function () { return true; }
    }
  ];

  function identify(locationValue) {
    for (var index = 0; index < siteProfiles.length; index++) {
      if (siteProfiles[index].matches(locationValue)) {
        return { id: siteProfiles[index].id, label: siteProfiles[index].label };
      }
    }
    return { id: "html5", label: "HTML5" };
  }

  function detectSpecial(documentValue, windowValue, mediaCount) {
    try {
      if (documentValue.querySelector("ruffle-player, ruffle-embed, ruffle-object, object[type*='shockwave-flash'], embed[type*='shockwave-flash'], object[data$='.swf'], embed[src$='.swf']")) {
        return { type: "Ruffle/Flash", reason: "检测到 Ruffle/Flash，可能不是标准 HTML5 视频" };
      }
    } catch (error) {}
    try {
      var canvases = !mediaCount ? Array.from(documentValue.querySelectorAll("canvas")) : [];
      var likelyCanvasPlayer = canvases.some(function (canvas) {
        var rect = { width: Number(canvas.width || 0), height: Number(canvas.height || 0) };
        try {
          var visibleRect = canvas.getBoundingClientRect();
          if (visibleRect.width && visibleRect.height) rect = visibleRect;
        } catch (error) {}
        var semantic = String(canvas.id || "") + " " + String(canvas.className || "") + " " + String(canvas.getAttribute && canvas.getAttribute("role") || "");
        return rect.width * rect.height >= 40000 || /(player|video|flash|ruffle)/i.test(semantic);
      });
      if (likelyCanvasPlayer) {
        return { type: "Canvas", reason: "检测到疑似 Canvas 播放区域，当前播放器可能无法直接控制" };
      }
    } catch (error) {}
    return { type: "" };
  }

  global.WinSpeedBallPlayerAdapters = {
    html5: html5Adapter,
    identify: identify,
    detectSpecial: detectSpecial
  };
})(window);
