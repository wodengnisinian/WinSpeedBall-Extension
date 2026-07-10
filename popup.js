(function () {
  "use strict";

  var lastCaptureDataUrl = "";
  var lastCaptureTime = 0;
  var ocrRunId = 0;
  var autoAiRequestSourceTime = 0;
  var latestPageText = "";
  var logs = [];
  var logsLoaded = false;
  var lastPanelId = "videoPanel";
  var MAX_SAVED_SCRIPT_LENGTH = 200000;
  var MIN_AUTO_INTERVAL_SECONDS = 30;
  var navRevealTimer = null;
  var navHideTimer = null;
  var rightRevealTimer = null;
  var rightHideTimer = null;
  var topRevealTimer = null;
  var topHideTimer = null;
  var lastWorkspaceScript = null;
  var douyinPanelState = { running: false, interval: MIN_AUTO_INTERVAL_SECONDS };
  var bookPanelState = { running: false, interval: MIN_AUTO_INTERVAL_SECONDS };
  var navRevealDelayMs = 800;
  var navHideDelayMs = 900;
  var navTransitionMs = 180;
  var captureSelectionTone = 96;
  var captureSelectionWidth = 2;
  var autoSendOcrToAi = false;
  var autoOcrPromptTemplate = "";
  var aiProviderOptions = [];
  var AI_PROVIDER_FALLBACKS = [
    { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", requiresApiKey: true },
    { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-5.4-mini", requiresApiKey: true },
    { id: "claude", label: "Claude", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5", requiresApiKey: true },
    { id: "local", label: "本地模型", baseUrl: "http://localhost:11434/v1", model: "gpt-oss:20b", requiresApiKey: false }
  ];
  var userScriptsAvailable = false;
  var scriptMigrationNeeded = false;
  var popupUtils = self.WinSpeedBallPopupUtils;
  var popupStorage = self.WinSpeedBallPopupStorage;
  var messageClient = self.WinSpeedBallPopupMessageClient;
  var text = popupUtils.text;
  var $ = popupUtils.byId;
  var normalizeNavDelayMs = popupUtils.normalizeNavDelayMs;
  var normalizeNavHideDelayMs = popupUtils.normalizeNavHideDelayMs;
  var normalizeNavTransitionMs = popupUtils.normalizeNavTransitionMs;
  var clampNumber = popupUtils.clampNumber;
  var normalizeCaptureTone = popupUtils.normalizeCaptureTone;
  var normalizeCaptureWidth = popupUtils.normalizeCaptureWidth;
  var normalizeNavZones = popupUtils.normalizeNavZones;
  var storageGet = popupStorage.get;
  var storageSet = popupStorage.set;
  var sendMessage = messageClient.send;
  var getCurrentSiteAccess = messageClient.getCurrentSiteAccess;
  var ensureSiteAccess = messageClient.ensureSiteAccess;
  var requestCurrentSiteAccess = messageClient.requestCurrentSiteAccess;
  var ensureServiceOrigin = messageClient.ensureServiceOrigin;
  var navZones = {
    left: { width: 32, top: 0, bottom: 320 },
    right: { width: 32, top: 0, bottom: 320 },
    top: { height: 32, left: 0, right: 380 }
  };

  function applyNavTransition() {
    document.body.style.setProperty("--nav-transition", navTransitionMs + "ms");
  }

  function normalizeAutoInterval(value) {
    var interval = Math.round(Number(value));
    return Number.isFinite(interval) && interval >= MIN_AUTO_INTERVAL_SECONDS
      ? interval
      : MIN_AUTO_INTERVAL_SECONDS;
  }

  function renderCaptureTone() {
    var input = $("captureToneInput");
    var widthInput = $("captureWidthInput");
    var preview = $("captureTonePreview");
    if (input) input.value = String(captureSelectionTone);
    if (widthInput) widthInput.value = String(captureSelectionWidth);
    if (!preview) return;
    preview.style.borderColor = "rgb(" + captureSelectionTone + "," + captureSelectionTone + "," + captureSelectionTone + ")";
    preview.style.borderWidth = captureSelectionWidth + "px";
    preview.style.backgroundColor = "rgba(" + captureSelectionTone + "," + captureSelectionTone + "," + captureSelectionTone + ",.14)";
    preview.textContent = text("\u5f53\u524d\u7c97\u7ec6\uff1a") + captureSelectionWidth.toFixed(1) + "px";
  }

  function saveCaptureStyle() {
    storageSet({
      captureSelectionTone: captureSelectionTone,
      captureSelectionWidth: captureSelectionWidth
    });
  }

  function readNavZonesFromInputs() {
    return normalizeNavZones({
      left: {
        width: $("leftZoneWidthInput").value,
        top: $("leftZoneTopInput").value,
        bottom: $("leftZoneBottomInput").value
      },
      right: {
        width: $("rightZoneWidthInput").value,
        top: $("rightZoneTopInput").value,
        bottom: $("rightZoneBottomInput").value
      },
      top: {
        height: $("topZoneHeightInput").value,
        left: $("topZoneLeftInput").value,
        right: $("topZoneRightInput").value
      }
    });
  }

  function writeNavZonesToInputs() {
    if (!$("leftZoneWidthInput")) return;
    $("leftZoneWidthInput").value = String(navZones.left.width);
    $("leftZoneTopInput").value = String(navZones.left.top);
    $("leftZoneBottomInput").value = String(navZones.left.bottom);
    $("rightZoneWidthInput").value = String(navZones.right.width);
    $("rightZoneTopInput").value = String(navZones.right.top);
    $("rightZoneBottomInput").value = String(navZones.right.bottom);
    $("topZoneHeightInput").value = String(navZones.top.height);
    $("topZoneLeftInput").value = String(navZones.top.left);
    $("topZoneRightInput").value = String(navZones.top.right);
  }

  function setTopStatus(value) {
    addLog(value);
  }

  function addLog(value) {
    if (!value) return;
    var time = new Date().toLocaleTimeString();
    logs.unshift("[" + time + "] " + value);
    logs = logs.slice(0, 300);
    if (logsLoaded) storageSet({ popupLogs: logs });
    renderLogs();
  }

  function captureLabel(sourceTime) {
    sourceTime = Number(sourceTime || 0);
    return sourceTime ? ("#" + String(sourceTime).slice(-8)) : "#unknown";
  }

  function safeLogValue(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, 180);
  }

  function addDetailedLog(category, message, details) {
    var suffix = [];
    Object.keys(details || {}).forEach(function (key) {
      var value = safeLogValue(details[key]);
      if (value) suffix.push(key + "=" + value);
    });
    addLog("[" + category + "] " + message + (suffix.length ? " | " + suffix.join(" | ") : ""));
  }

  function loadLogs() {
    storageGet(["popupLogs"], function (data) {
      var saved = Array.isArray(data.popupLogs) ? data.popupLogs : [];
      logs = saved.concat(logs).filter(function (item, index, list) {
        return list.indexOf(item) === index;
      }).slice(0, 300);
      logsLoaded = true;
      storageSet({ popupLogs: logs });
      renderLogs();
    });
  }

  function renderLogs() {
    var el = $("logText");
    if (el) el.textContent = logs.length ? logs.join("\n") : text("\u6682\u65e0\u65e5\u5fd7\u3002");
  }

  function savePopupState() {
    storageSet({
      popupState: {
        lastPanelId: lastPanelId,
        chromeHidden: true,
        scriptWorkspaceActive: document.body.classList.contains("script-ui-active"),
        lastWorkspaceScript: lastWorkspaceScript
      }
    });
  }

  function restorePopupStateOnOpen() {
    storageGet(["popupState", "scriptWorkspaceActive", "lastWorkspaceScript"], function (data) {
      var state = data && data.popupState ? data.popupState : {};
      document.body.classList.add("chrome-hidden");
      if (state.lastPanelId) {
        lastPanelId = state.lastPanelId;
        showPanel(lastPanelId, false);
      }
      if (state.lastWorkspaceScript && state.lastWorkspaceScript.code) {
        lastWorkspaceScript = state.lastWorkspaceScript;
      } else if (data && data.lastWorkspaceScript && data.lastWorkspaceScript.code) {
        lastWorkspaceScript = data.lastWorkspaceScript;
      }
      var workspaceActive = state.scriptWorkspaceActive;
      if (workspaceActive == null) workspaceActive = !!(data && data.scriptWorkspaceActive);
      if (workspaceActive && lastWorkspaceScript && lastWorkspaceScript.code) {
        showScriptWorkspaceUi(lastWorkspaceScript.name, lastWorkspaceScript.code);
      }
    });
  }

  function bindPanels() {
    document.querySelectorAll(".side-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (document.body.classList.contains("script-ui-active")) {
          showScriptManager();
        }
        document.querySelectorAll(".script-feature-btn").forEach(function (item) { item.classList.remove("active"); });
        showPanel(btn.dataset.panel, true);
        hideScriptChromeNow();
      });
    });
    var content = document.querySelector(".content");
    if (content) {
      content.addEventListener("click", function () {
        hideScriptChromeNow();
      });
    }
  }

  function showPanel(panelId, remember) {
    if (!panelId) return;
    if (panelId !== "logPanel" && remember) {
      lastPanelId = panelId;
      savePopupState();
    }
    document.querySelectorAll(".side-btn").forEach(function (item) {
      item.classList.toggle("active", item.dataset.panel === panelId);
    });
    document.querySelectorAll(".panel").forEach(function (panel) {
      panel.classList.toggle("active", panel.id === panelId);
    });
  }

  function enterScriptWorkspace() {
    showPanel("scriptPanel", true);
    document.body.classList.add("chrome-hidden");
    document.body.classList.add("script-workspace");
    document.body.classList.remove("nav-open");
    document.body.classList.remove("right-open");
    document.body.classList.remove("top-open");
    closeScriptNavSoon();
    closeScriptRightSoon();
    closeScriptTopSoon();
  }

  function showScriptManager() {
    document.body.classList.remove("script-ui-active");
    document.body.classList.remove("script-workspace");
    document.body.classList.add("chrome-hidden");
    hideScriptChromeNow();
    storageSet({ scriptWorkspaceActive: false });
    savePopupState();
  }

  function postScriptToWorkspace(script) {
    var frame = $("scriptFrame");
    if (!frame || !frame.contentWindow || !script) return;
    frame.contentWindow.postMessage({
      source: "WinSpeedBallPopup",
      type: "RUN_SCRIPT_UI",
      name: script.name || "",
      code: script.code || ""
    }, "*");
  }

  function postToScriptFrame(message) {
    var frame = $("scriptFrame");
    if (frame && frame.contentWindow) frame.contentWindow.postMessage(message, "*");
  }

  function postDouyinState(ok, message) {
    postToScriptFrame({
      source: "DouyinPanelHost",
      type: "STATE",
      ok: ok !== false,
      running: douyinPanelState.running,
      interval: douyinPanelState.interval,
      message: message || ""
    });
  }

  function runDouyinNext(callback) {
    sendMessage({ action: "douyinPanel", command: "NEXT" }).then(function (res) {
      douyinPanelState.running = !!res.running;
      douyinPanelState.interval = Number(res.interval || douyinPanelState.interval);
      postDouyinState(res.ok, res.message || res.error || "");
      if (typeof callback === "function") callback(res);
    });
  }

  function startDouyinPanel(interval) {
    douyinPanelState.interval = normalizeAutoInterval(interval || douyinPanelState.interval);
    requestCurrentSiteAccess().then(function (site) {
      if (!site.ok) {
        postDouyinState(false, site.error || text("\u5f53\u524d\u7f51\u7ad9\u672a\u6388\u6743\u3002"));
        return null;
      }
      return sendMessage({ action: "douyinPanel", command: "START", interval: douyinPanelState.interval, tabId: site.tabId, originPattern: site.originPattern });
    }).then(function (res) {
      if (!res) return;
      douyinPanelState.running = !!res.running;
      douyinPanelState.interval = Number(res.interval || douyinPanelState.interval);
      postDouyinState(res.ok, res.message || res.error || "");
    });
  }

  function stopDouyinPanel(message) {
    sendMessage({ action: "douyinPanel", command: "STOP" }).then(function (res) {
      douyinPanelState.running = !!res.running;
      douyinPanelState.interval = Number(res.interval || douyinPanelState.interval);
      postDouyinState(res.ok, message || res.message || res.error || "");
    });
  }

  function handleDouyinPanelMessage(data) {
    var payload = data.payload || {};
    if (data.action === "START") startDouyinPanel(payload.interval);
    else if (data.action === "STOP") stopDouyinPanel();
    else if (data.action === "NEXT") {
      runDouyinNext(function () {
        postDouyinState(true, text("\u5df2\u53d1\u9001\u4e0b\u4e00\u6761\u6307\u4ee4\u3002"));
      });
    }
    else if (data.action === "SET_INTERVAL") {
      douyinPanelState.interval = normalizeAutoInterval(payload.interval);
      sendMessage({ action: "douyinPanel", command: "SET_INTERVAL", interval: douyinPanelState.interval }).then(function (res) {
        douyinPanelState.running = !!res.running;
        douyinPanelState.interval = Number(res.interval || douyinPanelState.interval);
        postDouyinState(res.ok, res.message || res.error || "");
      });
    }
    else if (data.action === "GET_STATE") {
      sendMessage({ action: "douyinPanel", command: "GET_STATE" }).then(function (res) {
        douyinPanelState.running = !!res.running;
        douyinPanelState.interval = Number(res.interval || douyinPanelState.interval);
        postDouyinState(res.ok, res.message || res.error || "");
      });
    }
  }

  function updateBookPanel(res, message) {
    res = res || {};
    bookPanelState.running = !!res.running;
    bookPanelState.interval = normalizeAutoInterval(res.interval || bookPanelState.interval);
    $("bookIntervalInput").value = String(bookPanelState.interval);
    $("bookStartBtn").disabled = bookPanelState.running;
    $("bookStopBtn").disabled = !bookPanelState.running;
    $("bookStatus").textContent = message || res.message || (res.ok === false
      ? text("\u64cd\u4f5c\u5931\u8d25\uff1a") + (res.error || text("\u672a\u77e5\u9519\u8bef"))
      : (bookPanelState.running ? text("\u81ea\u52a8\u7ffb\u9875\u8fd0\u884c\u4e2d\u3002") : text("\u81ea\u52a8\u7ffb\u9875\u5df2\u505c\u6b62\u3002")));
  }

  function sendBookCommand(command, interval, message) {
    addDetailedLog("\u56fe\u4e66", "\u53d1\u9001\u64cd\u4f5c", { \u547d\u4ee4: command, \u95f4\u9694: interval ? interval + "s" : "-" });
    return sendMessage({ action: "bookPanel", command: command, interval: interval }).then(function (res) {
      updateBookPanel(res, res.ok && message ? message : "");
      addDetailedLog("\u56fe\u4e66", res.ok ? "\u64cd\u4f5c\u6210\u529f" : "\u64cd\u4f5c\u5931\u8d25", {
        \u547d\u4ee4: command,
        \u8fd0\u884c\u4e2d: res.running ? "\u662f" : "\u5426",
        \u65b9\u5f0f: res.method || "-",
        \u539f\u56e0: res.error || "-"
      });
      if (message || !res.ok) setTopStatus(res.ok ? message : (res.error || text("\u56fe\u4e66\u64cd\u4f5c\u5931\u8d25")));
      return res;
    });
  }

  function bindBook() {
    $("bookPrevBtn").addEventListener("click", function () {
      sendBookCommand("PREV", null, text("\u5df2\u53d1\u9001\u4e0a\u4e00\u9875\u6307\u4ee4\u3002"));
    });
    $("bookNextBtn").addEventListener("click", function () {
      sendBookCommand("NEXT", null, text("\u5df2\u53d1\u9001\u4e0b\u4e00\u9875\u6307\u4ee4\u3002"));
    });
    $("bookStartBtn").addEventListener("click", function () {
      var interval = normalizeAutoInterval($("bookIntervalInput").value);
      $("bookIntervalInput").value = String(interval);
      getCurrentSiteAccess().then(function (site) {
        if (!site.ok) {
          updateBookPanel({ ok: false, running: false, interval: interval, error: site.error });
          return;
        }
        addDetailedLog("\u56fe\u4e66", "\u5f53\u524d\u7f51\u7ad9\u5df2\u6388\u6743", { \u7f51\u7ad9: site.originPattern });
        return sendMessage({ action: "bookPanel", command: "START", interval: interval, tabId: site.tabId, originPattern: site.originPattern }).then(function (res) {
          updateBookPanel(res, res.ok ? text("\u81ea\u52a8\u7ffb\u9875\u5df2\u542f\u52a8\u3002") : "");
        });
      });
    });
    $("bookStopBtn").addEventListener("click", function () {
      sendBookCommand("STOP", null, text("\u81ea\u52a8\u7ffb\u9875\u5df2\u505c\u6b62\u3002"));
    });
    $("bookIntervalInput").addEventListener("change", function () {
      var interval = normalizeAutoInterval($("bookIntervalInput").value);
      $("bookIntervalInput").value = String(interval);
      sendBookCommand("SET_INTERVAL", interval, text("\u7ffb\u9875\u95f4\u9694\u5df2\u4fdd\u5b58\u3002"));
    });
    sendBookCommand("GET_STATE");
  }

  function showScriptWorkspaceUi(name, code) {
    lastWorkspaceScript = { name: name || text("\u811a\u672c\u754c\u9762"), code: code || "" };
    $("scriptRunnerTitle").textContent = lastWorkspaceScript.name;
    enterScriptWorkspace();
    document.body.classList.add("script-ui-active");
    storageSet({
      scriptWorkspaceActive: true,
      lastWorkspaceScript: lastWorkspaceScript,
      popupState: {
        lastPanelId: lastPanelId,
        chromeHidden: true,
        scriptWorkspaceActive: true,
        lastWorkspaceScript: lastWorkspaceScript
      }
    });
    setTimeout(function () {
      postScriptToWorkspace(lastWorkspaceScript);
    }, 80);
  }

  function openScriptNav() {
    if (!document.body.classList.contains("chrome-hidden")) return;
    clearTimeout(navHideTimer);
    document.body.classList.add("nav-open");
  }

  function closeScriptNavSoon() {
    clearTimeout(navHideTimer);
    navHideTimer = setTimeout(function () {
      document.body.classList.remove("nav-open");
    }, navHideDelayMs);
  }

  function hideScriptChromeNow() {
    clearTimeout(navRevealTimer);
    clearTimeout(navHideTimer);
    clearTimeout(rightRevealTimer);
    clearTimeout(rightHideTimer);
    clearTimeout(topRevealTimer);
    clearTimeout(topHideTimer);
    navRevealTimer = null;
    rightRevealTimer = null;
    topRevealTimer = null;
    document.body.classList.remove("nav-open");
    document.body.classList.remove("right-open");
    document.body.classList.remove("top-open");
  }

  function openScriptRight() {
    if (!document.body.classList.contains("chrome-hidden")) return;
    clearTimeout(rightHideTimer);
    document.body.classList.add("right-open");
  }

  function closeScriptRightSoon() {
    clearTimeout(rightHideTimer);
    rightHideTimer = setTimeout(function () {
      document.body.classList.remove("right-open");
    }, navHideDelayMs);
  }

  function openScriptTop() {
    if (!document.body.classList.contains("chrome-hidden")) return;
    clearTimeout(topHideTimer);
    document.body.classList.add("top-open");
  }

  function closeScriptTopSoon() {
    clearTimeout(topHideTimer);
    topHideTimer = setTimeout(function () {
      document.body.classList.remove("top-open");
    }, navHideDelayMs);
  }

  function bindScriptWorkspaceNav() {
    var leftSide = document.querySelector(".left-side");
    var rightSide = document.querySelector(".right-side");
    var header = document.querySelector(".header");
    if (leftSide) {
      leftSide.addEventListener("mouseenter", openScriptNav);
      leftSide.addEventListener("mouseleave", closeScriptNavSoon);
    }
    if (rightSide) {
      rightSide.addEventListener("mouseenter", openScriptRight);
      rightSide.addEventListener("mouseleave", closeScriptRightSoon);
    }
    if (header) {
      header.addEventListener("mouseenter", openScriptTop);
      header.addEventListener("mouseleave", closeScriptTopSoon);
    }
    document.addEventListener("mousemove", function (event) {
      if (!document.body.classList.contains("chrome-hidden")) return;
      var width = window.innerWidth || document.documentElement.clientWidth || 0;
      var inLeftZone = event.clientX <= navZones.left.width && event.clientY >= navZones.left.top && event.clientY <= navZones.left.bottom;
      var inRightZone = width && event.clientX >= width - navZones.right.width && event.clientY >= navZones.right.top && event.clientY <= navZones.right.bottom;
      var inTopZone = event.clientY <= navZones.top.height && event.clientX >= navZones.top.left && event.clientX <= navZones.top.right;
      if (inLeftZone) {
        if (!navRevealTimer) {
          navRevealTimer = setTimeout(function () {
            navRevealTimer = null;
            openScriptNav();
          }, navRevealDelayMs);
        }
      } else {
        clearTimeout(navRevealTimer);
        navRevealTimer = null;
        if (document.body.classList.contains("nav-open") && event.clientX > 92) closeScriptNavSoon();
      }
      if (inRightZone) {
        if (!rightRevealTimer) {
          rightRevealTimer = setTimeout(function () {
            rightRevealTimer = null;
            openScriptRight();
          }, navRevealDelayMs);
        }
      } else {
        clearTimeout(rightRevealTimer);
        rightRevealTimer = null;
        if (document.body.classList.contains("right-open") && event.clientX < width - 86) closeScriptRightSoon();
      }
      if (inTopZone) {
        if (!topRevealTimer) {
          topRevealTimer = setTimeout(function () {
            topRevealTimer = null;
            openScriptTop();
          }, navRevealDelayMs);
        }
      } else {
        clearTimeout(topRevealTimer);
        topRevealTimer = null;
        if (document.body.classList.contains("top-open") && event.clientY > 46) closeScriptTopSoon();
      }
    });
  }

  function control(command) {
    var commandType = command && command.type ? command.type : "GET_STATUS";
    var startedAt = Date.now();
    if (commandType !== "GET_STATUS") addDetailedLog("\u89c6\u9891", "\u53d1\u9001\u63a7\u5236\u547d\u4ee4", { \u547d\u4ee4: commandType });
    setTopStatus(text("\u5904\u7406\u4e2d"));
    return sendMessage({ action: "controlActiveTab", command: command }).then(function (res) {
      updateVideoStatus(res);
      if (commandType !== "GET_STATUS" || !res.ok) {
        addDetailedLog("\u89c6\u9891", res.ok ? "\u63a7\u5236\u6210\u529f" : "\u63a7\u5236\u5931\u8d25", {
          \u547d\u4ee4: commandType,
          \u8017\u65f6: (Date.now() - startedAt) + "ms",
          \u5a92\u4f53\u6570: res.mediaCount || 0,
          \u5df2\u5e94\u7528: res.applied || 0,
          \u539f\u56e0: res.error || "-"
        });
      }
      setTopStatus(res.ok ? text("\u5b8c\u6210") : text("\u5931\u8d25"));
      return res;
    });
  }

  function setStatus(name, value) {
    var el = document.querySelector('[data-status="' + name + '"]');
    if (el) el.textContent = value;
  }

  function fmtTime(seconds) {
    seconds = Number(seconds || 0);
    if (!Number.isFinite(seconds) || seconds <= 0) return text("\u672a\u77e5");
    var total = Math.floor(seconds);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    return m + ":" + String(s).padStart(2, "0");
  }

  function updateVideoStatus(res) {
    if (!res || !res.ok) {
      ["rate", "paused", "volume", "mediaCount", "muted", "duration", "applied"].forEach(function (name) {
        setStatus(name, "-");
      });
      $("videoStatusHint").textContent = text("\u5f53\u524d\u64ad\u653e\u5668\u65e0\u6cd5\u76f4\u63a5\u63a7\u5236\u3002\u539f\u56e0\uff1a") + ((res && res.error) || text("\u672a\u68c0\u6d4b\u5230\u53ef\u63a7\u5236\u7684\u5a92\u4f53"));
      return;
    }

    var rate = Number(res.rate || 1);
    var volumePercent = Math.round(Number(res.volume || 0) * 100);
    setStatus("rate", rate.toFixed(2) + "x");
    setStatus("paused", res.paused ? text("\u6682\u505c") : text("\u64ad\u653e\u4e2d"));
    setStatus("volume", volumePercent + "%");
    setStatus("mediaCount", res.mediaCount || 0);
    setStatus("muted", res.muted ? text("\u662f") : text("\u5426"));
    setStatus("duration", fmtTime(res.duration));
    setStatus("applied", res.applied || 0);
    $("rateInput").value = rate.toFixed(2);
    $("volumeInput").value = volumePercent;
    $("videoStatusHint").textContent = res.specialPlayerDetected
      ? (res.reason || text("\u68c0\u6d4b\u5230\u7279\u6b8a\u64ad\u653e\u5668"))
      : (res.playerType ? text("\u5f53\u524d\u64ad\u653e\u5668：") + res.playerType : "");
  }

  function loadManualCapture() {
    return sendMessage({ action: "getManualCapture" }).then(function (res) {
      if (res.ok && res.dataUrl) {
        lastCaptureDataUrl = res.dataUrl;
        lastCaptureTime = Number(res.time || 0);
        addDetailedLog("\u622a\u56fe", "\u8bfb\u53d6\u6700\u8fd1\u622a\u56fe", {
          \u4efb\u52a1: captureLabel(lastCaptureTime),
          OCR\u7f13\u5b58: res.ocrText ? "\u6709" : "\u65e0",
          AI\u7f13\u5b58: res.aiResponse ? "\u6709" : "\u65e0"
        });
        $("capturePreview").src = lastCaptureDataUrl;
        $("capturePreview").style.display = "block";
        $("ocrStatus").textContent = text("\u5df2\u8bfb\u53d6\u6700\u8fd1\u4e00\u6b21\u6846\u9009\u622a\u56fe\u3002");
        if (res.ocrText) {
          $("ocrText").value = res.ocrText;
          if (Number(res.aiSourceTime || 0) === lastCaptureTime && res.aiResponse) {
            $("aiMode").value = "custom";
            $("aiQuestion").value = res.aiPrompt || res.ocrText;
            $("aiAnswer").value = res.aiResponse;
            $("ocrStatus").textContent = text("\u5df2\u6062\u590d OCR \u7ed3\u679c\u548c AI \u56de\u590d\u3002");
            addDetailedLog("AI", "\u6062\u590d\u5df2\u4fdd\u5b58\u56de\u590d", {
              \u4efb\u52a1: captureLabel(lastCaptureTime),
              \u56de\u590d\u5b57\u6570: res.aiResponse.length
            });
            showPanel("aiPanel", false);
          } else {
            $("ocrStatus").textContent = text("\u5df2\u6062\u590d\u4e0a\u6b21 OCR \u7ed3\u679c\u3002");
            if (res.aiStatus === "requesting" || res.aiStatus === "waiting") {
              $("ocrStatus").textContent = text("OCR \u5df2\u5b8c\u6210\uff0cAI \u540e\u53f0\u5904\u7406\u4e2d...");
            } else if (res.aiStatus === "failed") {
              $("ocrStatus").textContent = text("OCR \u5df2\u5b8c\u6210\uff0cAI \u540e\u53f0\u53d1\u9001\u5931\u8d25\uff1a") + (res.aiError || text("\u672a\u77e5\u9519\u8bef"));
            } else if (!res.aiStatus) {
              maybeAutoSendOcrToAi(res.ocrText, lastCaptureTime);
            }
          }
        } else {
          if (/^(queued|loading|recognizing)/.test(res.ocrStatus || "")) {
            var progress = Math.round(Number(res.ocrProgress || 0) * 100);
            $("ocrStatus").textContent = text("OCR \u540e\u53f0\u8bc6\u522b\u4e2d...") + (progress ? " " + progress + "%" : "");
          } else if (res.ocrStatus === "failed") {
            $("ocrStatus").textContent = text("OCR \u540e\u53f0\u8bc6\u522b\u5931\u8d25\uff1a") + (res.ocrError || text("\u672a\u77e5\u9519\u8bef"));
          } else if (res.ocrStatus === "empty") {
            $("ocrStatus").textContent = text("OCR \u8bc6\u522b\u5b8c\u6210\uff0c\u4f46\u672a\u8bc6\u522b\u5230\u6587\u5b57\u3002");
          } else {
            runPanelOcr(lastCaptureDataUrl);
          }
        }
      } else if (!res.ok) {
        addDetailedLog("\u622a\u56fe", "\u8bfb\u53d6\u5931\u8d25", { \u539f\u56e0: res.error || "\u672a\u77e5\u9519\u8bef" });
      }
      return res;
    });
  }

  function runPanelOcr(dataUrl) {
    dataUrl = dataUrl || lastCaptureDataUrl;
    if (!dataUrl || !window.winSpeedBallOcr) return Promise.resolve("");
    var runId = ++ocrRunId;
    var sourceTime = lastCaptureTime;
    addDetailedLog("OCR", "\u5f00\u59cb\u8bc6\u522b", { \u4efb\u52a1: captureLabel(sourceTime) });
    $("ocrStatus").textContent = text("\u6b63\u5728 OCR \u8bc6\u522b...");
    return window.winSpeedBallOcr.recognize(dataUrl, function (m) {
      if (runId !== ocrRunId) return;
      if (m && m.status) {
        var p = m.progress == null ? "" : " " + Math.round(m.progress * 100) + "%";
        $("ocrStatus").textContent = "OCR: " + m.status + p;
      }
    }).then(function (recognizedText) {
      if (runId !== ocrRunId) return "";
      var cleanText = recognizedText.trim();
      if (sourceTime !== lastCaptureTime) {
        addDetailedLog("OCR", "\u5ffd\u7565\u8fc7\u671f\u8bc6\u522b\u7ed3\u679c", { \u4efb\u52a1: captureLabel(sourceTime) });
        return "";
      }
      $("ocrText").value = cleanText;
      $("ocrStatus").textContent = text("OCR \u5b8c\u6210\u3002");
      addDetailedLog("OCR", cleanText ? "\u8bc6\u522b\u5b8c\u6210" : "\u8bc6\u522b\u7ed3\u679c\u4e3a\u7a7a", {
        \u4efb\u52a1: captureLabel(sourceTime),
        \u5b57\u6570: cleanText.length
      });
      storageSet({
        manualOcrText: cleanText,
        manualOcrSourceTime: sourceTime
      });
      return maybeAutoSendOcrToAi(cleanText, sourceTime).then(function () {
        return recognizedText;
      });
    }).catch(function (error) {
      if (runId !== ocrRunId) return "";
      $("ocrStatus").textContent = text("OCR \u5931\u8d25\uff1a") + (error.message || String(error));
      addDetailedLog("OCR", "\u8bc6\u522b\u5931\u8d25", {
        \u4efb\u52a1: captureLabel(sourceTime),
        \u539f\u56e0: error.message || String(error)
      });
      return "";
    });
  }

  function maybeAutoSendOcrToAi(recognizedText, sourceTime) {
    var cleanText = String(recognizedText || "").trim();
    sourceTime = Number(sourceTime || 0);
    if (!cleanText || !sourceTime) {
      addDetailedLog("AI", "\u8df3\u8fc7\u81ea\u52a8\u53d1\u9001", { \u539f\u56e0: !cleanText ? "OCR \u6587\u672c\u4e3a\u7a7a" : "\u622a\u56fe\u4efb\u52a1\u65e0\u6548" });
      return Promise.resolve({ ok: false, skipped: true });
    }
    if (sourceTime !== lastCaptureTime) {
      addDetailedLog("AI", "\u8df3\u8fc7\u8fc7\u671f OCR \u7ed3\u679c", { \u4efb\u52a1: captureLabel(sourceTime) });
      return Promise.resolve({ ok: false, skipped: true, stale: true });
    }

    return new Promise(function (resolve) {
      storageGet(["autoSendOcrToAi", "manualAiSourceTime"], function (data) {
        if (chrome.runtime.lastError) {
          addDetailedLog("AI", "\u8bfb\u53d6\u81ea\u52a8\u53d1\u9001\u8bbe\u7f6e\u5931\u8d25", { \u539f\u56e0: chrome.runtime.lastError.message });
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        autoSendOcrToAi = data && data.autoSendOcrToAi === true;
        if (!autoSendOcrToAi) {
          addDetailedLog("AI", "\u81ea\u52a8\u53d1\u9001\u672a\u5f00\u542f", { \u4efb\u52a1: captureLabel(sourceTime) });
          resolve({ ok: true, skipped: true });
          return;
        }
        if (Number(data.manualAiSourceTime || 0) === sourceTime) {
          addDetailedLog("AI", "\u672c\u6b21\u622a\u56fe\u5df2\u53d1\u9001\uff0c\u963b\u6b62\u91cd\u590d\u8bf7\u6c42", { \u4efb\u52a1: captureLabel(sourceTime) });
          resolve({ ok: true, skipped: true });
          return;
        }
        if (autoAiRequestSourceTime === sourceTime) {
          addDetailedLog("AI", "\u81ea\u52a8\u53d1\u9001\u6b63\u5728\u8fdb\u884c", { \u4efb\u52a1: captureLabel(sourceTime) });
          resolve({ ok: true, skipped: true, pending: true });
          return;
        }

        autoAiRequestSourceTime = sourceTime;
        addDetailedLog("AI", "\u5f00\u59cb\u81ea\u52a8\u53d1\u9001 OCR \u7ed3\u679c", {
          \u4efb\u52a1: captureLabel(sourceTime),
          OCR\u5b57\u6570: cleanText.length
        });
        $("ocrStatus").textContent = text("OCR \u5b8c\u6210\uff0c\u6b63\u5728\u81ea\u52a8\u53d1\u9001\u7ed9 AI...");
        askAi(cleanText, { autoOcrSourceTime: sourceTime }).then(function (res) {
          autoAiRequestSourceTime = 0;
          if (res && res.ok) {
            addDetailedLog("AI", "\u81ea\u52a8\u53d1\u9001\u6210\u529f", {
              \u4efb\u52a1: captureLabel(sourceTime),
              \u6a21\u578b: res.model || "\u672a\u77e5",
              \u56de\u590d\u5b57\u6570: String(res.content || "").length
            });
            $("ocrStatus").textContent = text("OCR \u5b8c\u6210\uff0c\u5df2\u81ea\u52a8\u53d1\u9001\u7ed9 AI\u3002");
            showPanel("aiPanel", true);
          } else {
            addDetailedLog("AI", "\u81ea\u52a8\u53d1\u9001\u5931\u8d25", {
              \u4efb\u52a1: captureLabel(sourceTime),
              \u539f\u56e0: (res && res.error) || "\u672a\u77e5\u9519\u8bef"
            });
            $("ocrStatus").textContent = text("OCR \u5b8c\u6210\uff0cAI \u81ea\u52a8\u53d1\u9001\u5931\u8d25\uff1a") + ((res && res.error) || text("\u672a\u77e5\u9519\u8bef"));
          }
          resolve(res || { ok: false, error: text("\u672a\u77e5\u9519\u8bef") });
        });
      });
    });
  }

  function startRegionCaptureFromPopup() {
    $("ocrStatus").textContent = text("\u8bf7\u56de\u5230\u7f51\u9875\uff0c\u7528\u666e\u901a\u9f20\u6807\u6307\u9488\u6846\u9009\u9700\u8981\u8bc6\u522b\u7684\u533a\u57df\u3002");
    setTopStatus(text("\u7b49\u5f85\u6846\u9009"));
    return sendMessage({ action: "startRegionCapture" }).then(function (res) {
      if (!res.ok) {
        $("ocrStatus").textContent = text("\u6846\u9009\u622a\u56fe\u542f\u52a8\u5931\u8d25\uff1a") + (res.error || text("\u672a\u77e5\u9519\u8bef"));
        setTopStatus(text("\u5931\u8d25"));
      } else {
        $("ocrStatus").textContent = text("\u6846\u9009\u5df2\u542f\u52a8\uff0c\u677e\u5f00\u9f20\u6807\u540e\u56de\u5230\u63d2\u4ef6\u67e5\u770b OCR \u7ed3\u679c\u3002");
      }
      return res;
    });
  }

  function extractPageText() {
    setTopStatus(text("\u8bfb\u53d6\u9875\u9762"));
    return control({ type: "EXTRACT_PAGE_TEXT" }).then(function (res) {
      var first = null;
      (res.frameResults || []).some(function (item) {
        if (item && item.ok && item.text) {
          first = item;
          return true;
        }
        return false;
      });
      latestPageText = first ? first.text : "";
      if (latestPageText && !$("aiQuestion").value.trim()) $("aiQuestion").value = text("\u8bf7\u603b\u7ed3\u5f53\u524d\u9875\u9762\u5185\u5bb9");
      setTopStatus(latestPageText ? text("\u5b8c\u6210") : text("\u65e0\u6587\u5b57"));
      return latestPageText;
    });
  }

  var aiController = self.WinSpeedBallPopupAiController.create({
    byId: $,
    sendMessage: sendMessage,
    storage: popupStorage,
    addDetailedLog: addDetailedLog,
    captureLabel: captureLabel,
    setTopStatus: setTopStatus,
    getLatestPageText: function () { return latestPageText; },
    getAutoOcrPromptTemplate: function () { return autoOcrPromptTemplate; }
  });
  var askAi = aiController.ask;
  var loadAiHistory = aiController.loadHistory;

  function normalizeProviderId(providerId) {
    providerId = String(providerId || "").toLowerCase();
    return AI_PROVIDER_FALLBACKS.some(function (item) { return item.id === providerId; }) ? providerId : "deepseek";
  }

  function providerFallback(providerId) {
    providerId = normalizeProviderId(providerId);
    return AI_PROVIDER_FALLBACKS.filter(function (item) { return item.id === providerId; })[0] || AI_PROVIDER_FALLBACKS[0];
  }

  function normalizeProviderOptions(rawOptions) {
    var sourceById = {};
    if (Array.isArray(rawOptions)) {
      rawOptions.forEach(function (item) {
        if (!item || typeof item !== "object") return;
        sourceById[normalizeProviderId(item.id || item.provider || item.providerId)] = item;
      });
    } else if (rawOptions && typeof rawOptions === "object") {
      Object.keys(rawOptions).forEach(function (key) {
        var item = rawOptions[key];
        if (!item || typeof item !== "object") return;
        sourceById[normalizeProviderId(item.id || item.provider || item.providerId || key)] = item;
      });
    }
    return AI_PROVIDER_FALLBACKS.map(function (fallback) {
      var source = sourceById[fallback.id] || {};
      return {
        id: fallback.id,
        label: String(source.label || fallback.label),
        baseUrl: String(source.baseUrl || source.defaultBaseUrl || fallback.baseUrl),
        model: String(source.model || source.defaultModel || fallback.model),
        hasApiKey: source.hasApiKey === true,
        requiresApiKey: typeof source.requiresApiKey === "boolean" ? source.requiresApiKey : fallback.requiresApiKey
      };
    });
  }

  function findProviderOption(providerId) {
    providerId = normalizeProviderId(providerId);
    var option = aiProviderOptions.filter(function (item) { return item.id === providerId; })[0];
    if (option) return option;
    var fallback = providerFallback(providerId);
    return {
      id: fallback.id,
      label: fallback.label,
      baseUrl: fallback.baseUrl,
      model: fallback.model,
      hasApiKey: false,
      requiresApiKey: fallback.requiresApiKey
    };
  }

  function syncProviderSelectLabels() {
    var select = $("providerInput");
    if (!select) return;
    aiProviderOptions.forEach(function (item) {
      var option = select.querySelector('option[value="' + item.id + '"]');
      if (option) option.textContent = item.label;
    });
  }

  function providerStatus(option, prefix) {
    var detail;
    if (!option.requiresApiKey) detail = text("无需 API Key，可直接使用。");
    else if (option.hasApiKey) detail = text("已保存 API Key；输入框留空表示保持不变。");
    else detail = text("尚未保存 API Key。");
    return (prefix ? prefix + " " : "") + option.label + "：" + detail;
  }

  function showProvider(providerId, overrides, prefix) {
    var option = findProviderOption(providerId);
    overrides = overrides || {};
    if (overrides.baseUrl) option.baseUrl = String(overrides.baseUrl);
    if (overrides.model) option.model = String(overrides.model);
    if (typeof overrides.hasApiKey === "boolean") option.hasApiKey = overrides.hasApiKey;
    if (typeof overrides.requiresApiKey === "boolean") option.requiresApiKey = overrides.requiresApiKey;
    $("providerInput").value = option.id;
    $("baseUrlInput").value = option.baseUrl;
    $("modelInput").value = option.model;
    $("apiKeyInput").value = "";
    $("apiKeyInput").placeholder = option.requiresApiKey
      ? (option.hasApiKey ? text("已保存，留空表示保持不变") : text("请输入 API Key"))
      : text("可选，本地模型通常无需 API Key");
    $("settingsStatus").textContent = providerStatus(option, prefix);
    return option;
  }

  function loadSettings() {
    sendMessage({ action: "getSettings" }).then(function (res) {
      if (!res.ok) {
        $("settingsStatus").textContent = text("读取 AI 设置失败：") + (res.error || text("未知错误"));
        return;
      }
      aiProviderOptions = normalizeProviderOptions(res.providerOptions);
      syncProviderSelectLabels();
      showProvider(res.aiProvider, {
        baseUrl: res.aiBaseUrl || res.deepseekBaseUrl,
        model: res.aiModel || res.deepseekModel,
        hasApiKey: typeof res.hasApiKey === "boolean" ? res.hasApiKey : undefined,
        requiresApiKey: typeof res.requiresApiKey === "boolean" ? res.requiresApiKey : undefined
      });
      updateVideoStatus(res);
    });
    loadUiSettings();
  }

  function loadUiSettings() {
    storageGet(["navRevealDelayMs", "navHideDelayMs", "navTransitionMs", "navRevealZones", "navRevealEdgePx", "captureSelectionTone", "captureSelectionWidth", "autoSendOcrToAi", "autoOcrPromptTemplate"], function (data) {
      navRevealDelayMs = normalizeNavDelayMs(data.navRevealDelayMs || 800);
      navHideDelayMs = normalizeNavHideDelayMs(data.navHideDelayMs || 900);
      navTransitionMs = normalizeNavTransitionMs(data.navTransitionMs || 180);
      captureSelectionTone = normalizeCaptureTone(data.captureSelectionTone);
      captureSelectionWidth = normalizeCaptureWidth(data.captureSelectionWidth);
      autoSendOcrToAi = data.autoSendOcrToAi === true;
      autoOcrPromptTemplate = String(data.autoOcrPromptTemplate || "");
      if (data.navRevealZones) {
        navZones = normalizeNavZones(data.navRevealZones);
      } else if (data.navRevealEdgePx) {
        var oldEdge = clampNumber(data.navRevealEdgePx, 24, 8, 120);
        navZones = normalizeNavZones({
          left: { width: oldEdge, top: 0, bottom: 320 },
          right: { width: oldEdge, top: 0, bottom: 320 },
          top: { height: oldEdge, left: 0, right: 380 }
        });
      } else {
        navZones = normalizeNavZones(navZones);
      }
      if ($("navDelayInput")) $("navDelayInput").value = (navRevealDelayMs / 1000).toFixed(1);
      if ($("navHideDelayInput")) $("navHideDelayInput").value = (navHideDelayMs / 1000).toFixed(1);
      if ($("navTransitionInput")) $("navTransitionInput").value = (navTransitionMs / 1000).toFixed(2);
      applyNavTransition();
      writeNavZonesToInputs();
      renderCaptureTone();
      if ($("autoSendOcrToAiInput")) $("autoSendOcrToAiInput").checked = autoSendOcrToAi;
      if ($("autoOcrPromptInput")) $("autoOcrPromptInput").value = autoOcrPromptTemplate;
      if ($("autoOcrAiStatus")) $("autoOcrAiStatus").textContent = autoSendOcrToAi
        ? text("\u5df2\u5f00\u542f\uff1aOCR \u7ed3\u679c\u4f1a\u81ea\u52a8\u53d1\u9001\u7ed9 AI\u3002")
        : text("\u5df2\u5173\u95ed\u81ea\u52a8\u53d1\u9001\u3002");
    });
  }

  function saveUiSettings(delayMs, zones, tone, width, hideDelayMs, transitionMs) {
    navRevealDelayMs = normalizeNavDelayMs(delayMs == null ? $("navDelayInput").value : delayMs);
    navHideDelayMs = normalizeNavHideDelayMs(hideDelayMs == null ? $("navHideDelayInput").value : hideDelayMs);
    navTransitionMs = normalizeNavTransitionMs(transitionMs == null ? $("navTransitionInput").value : transitionMs);
    navZones = normalizeNavZones(zones || readNavZonesFromInputs());
    captureSelectionTone = normalizeCaptureTone(tone == null ? $("captureToneInput").value : tone);
    captureSelectionWidth = normalizeCaptureWidth(width == null ? $("captureWidthInput").value : width);
    storageSet({ navRevealDelayMs: navRevealDelayMs, navHideDelayMs: navHideDelayMs, navTransitionMs: navTransitionMs, navRevealZones: navZones, captureSelectionTone: captureSelectionTone, captureSelectionWidth: captureSelectionWidth }, function () {
      if ($("navDelayInput")) $("navDelayInput").value = (navRevealDelayMs / 1000).toFixed(1);
      if ($("navHideDelayInput")) $("navHideDelayInput").value = (navHideDelayMs / 1000).toFixed(1);
      if ($("navTransitionInput")) $("navTransitionInput").value = (navTransitionMs / 1000).toFixed(2);
      applyNavTransition();
      writeNavZonesToInputs();
      renderCaptureTone();
      if ($("uiSettingsStatus")) $("uiSettingsStatus").textContent = text("\u754c\u9762\u8bbe\u7f6e\u5df2\u4fdd\u5b58\u3002");
    });
  }

  function saveSettings(clearKey) {
    var providerId = normalizeProviderId($("providerInput").value);
    var option = findProviderOption(providerId);
    var baseUrl = String($("baseUrlInput").value || option.baseUrl).trim();
    var model = String($("modelInput").value || option.model).trim();
    var enteredApiKey = String($("apiKeyInput").value || "").trim();
    var payload = { provider: providerId, baseUrl: baseUrl, model: model };
    if (clearKey) payload.clearApiKey = true;
    else if (enteredApiKey) payload.apiKey = enteredApiKey;

    $("settingsStatus").textContent = clearKey ? text("正在清除 API Key...") : text("正在检查 AI 服务地址权限...");
    var permission = clearKey ? Promise.resolve({ ok: true }) : ensureServiceOrigin(baseUrl);
    return permission.then(function (permissionResult) {
      if (!permissionResult.ok) {
        $("settingsStatus").textContent = text("保存失败：") + (permissionResult.error || text("未授权 AI 服务地址。"));
        return permissionResult;
      }
      return sendMessage({ action: "saveAiSettings", payload: payload }).then(function (res) {
        if (!res.ok) {
          $("settingsStatus").textContent = text("保存失败：") + (res.error || text("未知错误"));
          return res;
        }
        option.baseUrl = baseUrl;
        option.model = model;
        if (clearKey) option.hasApiKey = false;
        else if (enteredApiKey) option.hasApiKey = true;
        if (typeof res.hasApiKey === "boolean") option.hasApiKey = res.hasApiKey;
        showProvider(providerId, option, clearKey ? text("API Key 已清除。") : text("设置已保存。"));
        return res;
      });
    });
  }

  function bindVideo() {
    $("applyRateBtn").addEventListener("click", function () {
      var rate = Number($("rateInput").value);
      if (Number.isNaN(rate)) rate = 1;
      rate = Math.max(0.25, Math.min(16, rate));
      $("rateInput").value = rate;
      control({ type: "SET_RATE", rate: rate });
    });
    $("rateInput").addEventListener("keydown", function (event) {
      if (event.key === "Enter") $("applyRateBtn").click();
    });
    $("applyVolumeBtn").addEventListener("click", function () {
      var volume = Number($("volumeInput").value);
      if (Number.isNaN(volume)) volume = 80;
      volume = Math.max(0, Math.min(100, volume));
      $("volumeInput").value = volume;
      control({ type: "SET_VOLUME", volume: volume / 100 });
    });
    $("volumeInput").addEventListener("keydown", function (event) {
      if (event.key === "Enter") $("applyVolumeBtn").click();
    });
    $("stepUp").addEventListener("click", function () { control({ type: "STEP_UP" }); });
    $("stepDown").addEventListener("click", function () { control({ type: "STEP_DOWN" }); });
    $("resetVideo").addEventListener("click", function () { control({ type: "RESET" }); });
    $("muteBtn").addEventListener("click", function () { control({ type: "SET_MUTED", muted: true }); });
    $("unmuteBtn").addEventListener("click", function () { control({ type: "SET_MUTED", muted: false }); });
    $("toggleMuteBtn").addEventListener("click", function () { control({ type: "TOGGLE_MUTED" }); });
  }

  function bindOcr() {
    $("regionCaptureBtn").addEventListener("click", startRegionCaptureFromPopup);
    chrome.storage.onChanged.addListener(function (changes, areaName) {
      if (areaName !== "local") return;
      if (changes.manualCaptureTime || changes.manualOcrText || changes.manualAiResponse) {
        loadManualCapture();
        return;
      }
      if (changes.ocrJobStatus || changes.ocrJobProgress || changes.ocrJobError) {
        var status = changes.ocrJobStatus ? String(changes.ocrJobStatus.newValue || "") : "recognizing";
        var progress = changes.ocrJobProgress ? Math.round(Number(changes.ocrJobProgress.newValue || 0) * 100) : 0;
        if (status === "failed") {
          $("ocrStatus").textContent = text("OCR \u540e\u53f0\u8bc6\u522b\u5931\u8d25\uff1a") + (changes.ocrJobError && changes.ocrJobError.newValue || text("\u672a\u77e5\u9519\u8bef"));
        } else if (/^(queued|loading|recognizing)/.test(status)) {
          $("ocrStatus").textContent = text("OCR \u540e\u53f0\u8bc6\u522b\u4e2d...") + (progress ? " " + progress + "%" : "");
        }
      }
    });
    $("copyOcrBtn").addEventListener("click", function () {
      navigator.clipboard.writeText($("ocrText").value || "").then(function () {
        $("ocrStatus").textContent = text("OCR \u7ed3\u679c\u5df2\u590d\u5236\u3002");
      }).catch(function (error) {
        $("ocrStatus").textContent = text("OCR \u7ed3\u679c\u590d\u5236\u5931\u8d25\uff1a") + (error.message || String(error));
      });
    });
    $("sendOcrToAiBtn").addEventListener("click", function () {
      document.querySelector('[data-panel="aiPanel"]').click();
      askAi($("ocrText").value);
    });
  }

  function bindAi() {
    $("usePageTextBtn").addEventListener("click", extractPageText);
    $("askAiBtn").addEventListener("click", function () {
      var pageText = $("ocrText").value.trim() || latestPageText;
      if (pageText) askAi(pageText);
      else extractPageText().then(askAi);
    });
    $("clearAiHistoryBtn").addEventListener("click", function () {
      aiController.clearHistory();
    });
  }

  function bindSettings() {
    $("providerInput").addEventListener("change", function () {
      showProvider($("providerInput").value);
    });
    $("saveSettingsBtn").addEventListener("click", function () {
      saveSettings(false);
      saveUiSettings();
    });
    $("clearKeyBtn").addEventListener("click", function () { saveSettings(true); });
    $("saveUiSettingsBtn").addEventListener("click", function () { saveUiSettings(); });
    $("resetUiSettingsBtn").addEventListener("click", function () {
      saveUiSettings(800, {
        left: { width: 32, top: 0, bottom: 320 },
        right: { width: 32, top: 0, bottom: 320 },
        top: { height: 32, left: 0, right: 380 }
      }, 96, 2, 900, 180);
    });
    $("navDelayInput").addEventListener("change", function () {
      navRevealDelayMs = normalizeNavDelayMs($("navDelayInput").value);
      $("navDelayInput").value = (navRevealDelayMs / 1000).toFixed(1);
    });
    $("navHideDelayInput").addEventListener("change", function () {
      navHideDelayMs = normalizeNavHideDelayMs($("navHideDelayInput").value);
      saveUiSettings();
    });
    $("navTransitionInput").addEventListener("input", function () {
      navTransitionMs = normalizeNavTransitionMs($("navTransitionInput").value);
      applyNavTransition();
    });
    $("navTransitionInput").addEventListener("change", function () {
      saveUiSettings();
    });
    $("captureToneInput").addEventListener("input", function () {
      captureSelectionTone = normalizeCaptureTone($("captureToneInput").value);
      renderCaptureTone();
    });
    $("captureToneInput").addEventListener("change", saveCaptureStyle);
    $("captureWidthInput").addEventListener("input", function () {
      captureSelectionWidth = normalizeCaptureWidth($("captureWidthInput").value);
      renderCaptureTone();
    });
    $("captureWidthInput").addEventListener("change", saveCaptureStyle);
    $("autoSendOcrToAiInput").addEventListener("change", function () {
      autoSendOcrToAi = $("autoSendOcrToAiInput").checked;
      storageSet({ autoSendOcrToAi: autoSendOcrToAi }, function () {
        $("autoOcrAiStatus").textContent = autoSendOcrToAi
          ? text("\u5df2\u5f00\u542f\uff1aOCR \u7ed3\u679c\u4f1a\u81ea\u52a8\u53d1\u9001\u7ed9 AI\u3002")
          : text("\u5df2\u5173\u95ed\u81ea\u52a8\u53d1\u9001\u3002");
        if (autoSendOcrToAi) maybeAutoSendOcrToAi($("ocrText").value, lastCaptureTime);
      });
    });
    $("autoOcrPromptInput").addEventListener("input", function () {
      autoOcrPromptTemplate = String($("autoOcrPromptInput").value || "");
    });
    $("autoOcrPromptInput").addEventListener("change", function () {
      autoOcrPromptTemplate = String($("autoOcrPromptInput").value || "").trim();
      $("autoOcrPromptInput").value = autoOcrPromptTemplate;
      storageSet({ autoOcrPromptTemplate: autoOcrPromptTemplate }, function () {
        $("autoOcrAiStatus").textContent = autoOcrPromptTemplate
          ? text("\u81ea\u5b9a\u4e49\u63d0\u793a\u8bcd\u5df2\u4fdd\u5b58\u3002")
          : text("\u63d0\u793a\u8bcd\u5df2\u6e05\u7a7a\uff0c\u5c06\u76f4\u63a5\u53d1\u9001 OCR \u539f\u6587\u3002");
        addDetailedLog("AI", "OCR \u81ea\u52a8\u53d1\u9001\u63d0\u793a\u8bcd\u5df2\u66f4\u65b0", {
          \u6a21\u5f0f: autoOcrPromptTemplate ? "\u81ea\u5b9a\u4e49\u6a21\u677f" : "OCR \u539f\u6587",
          \u6a21\u677f\u5b57\u6570: autoOcrPromptTemplate.length
        });
      });
    });
    [
      "leftZoneWidthInput", "leftZoneTopInput", "leftZoneBottomInput",
      "rightZoneWidthInput", "rightZoneTopInput", "rightZoneBottomInput",
      "topZoneHeightInput", "topZoneLeftInput", "topZoneRightInput"
    ].forEach(function (id) {
      $(id).addEventListener("change", function () {
        navZones = readNavZonesFromInputs();
        writeNavZonesToInputs();
      });
    });
    $("testAiBtn").addEventListener("click", function () {
      var startedAt = Date.now();
      addDetailedLog("AI", "\u5f00\u59cb\u8fde\u63a5\u6d4b\u8bd5", {});
      saveSettings(false).then(function (saved) {
        if (!saved || !saved.ok) {
          addDetailedLog("AI", "\u8fde\u63a5\u6d4b\u8bd5\u5df2\u53d6\u6d88", {
            \u8017\u65f6: (Date.now() - startedAt) + "ms",
            \u539f\u56e0: saved && saved.error || "\u8bbe\u7f6e\u4fdd\u5b58\u5931\u8d25"
          });
          return;
        }
        $("settingsStatus").textContent = text("\u6b63\u5728\u6d4b\u8bd5\u8fde\u63a5...");
        return sendMessage({ action: "testAI" }).then(function (res) {
          $("settingsStatus").textContent = res.ok ? text("\u8fde\u63a5\u6210\u529f\uff1a") + res.content : text("\u8fde\u63a5\u5931\u8d25\uff1a") + (res.error || text("\u672a\u77e5\u9519\u8bef"));
          addDetailedLog("AI", res.ok ? "\u8fde\u63a5\u6d4b\u8bd5\u6210\u529f" : "\u8fde\u63a5\u6d4b\u8bd5\u5931\u8d25", {
            \u8017\u65f6: (Date.now() - startedAt) + "ms",
            \u6a21\u578b: res.model || "-",
            \u539f\u56e0: res.error || "-"
          });
        });
      });
    });
  }

  function bindLogs() {
    $("clearLogBtn").addEventListener("click", function () {
      logs = [];
      storageSet({ popupLogs: [] });
      renderLogs();
    });
  }

  function parseUserScriptMeta(code) {
    var meta = { name: "", property: "", description: "", version: "", matches: [], includes: [], excludes: [], permissions: [], runAt: "" };
    var textCode = String(code || "");
    var start = textCode.indexOf("// ==UserScript==");
    var end = textCode.indexOf("// ==/UserScript==");
    if (start < 0 || end < start) return meta;
    textCode.slice(start, end).split(/\r?\n/).forEach(function (line) {
      var m = line.match(/^\s*\/\/\s*@(\S+)\s+(.+?)\s*$/);
      if (!m) return;
      var key = m[1].toLowerCase();
      var value = m[2];
      if ((key === "\u540d\u79f0" || key === "name") && !meta.name) meta.name = value;
      else if ((key === "\u5c5e\u6027" || key === "property") && !meta.property) meta.property = value;
      else if (key === "description" && !meta.description) meta.description = value;
      else if (key === "version" && !meta.version) meta.version = value;
      else if (key === "match") meta.matches.push(value);
      else if (key === "include") meta.includes.push(value);
      else if (key === "exclude") meta.excludes.push(value);
      else if (key === "permission") meta.permissions.push(String(value || "").trim().toLowerCase());
      else if (key === "run-at" && !meta.runAt) meta.runAt = value;
    });
    meta.permissions = meta.permissions.filter(function (permission, index, list) { return permission && list.indexOf(permission) === index; });
    return meta;
  }

  function normalizeScriptProperty(value) {
    var property = String(value || "").trim();
    if (/^ai$/i.test(property)) return "AI";
    if (/^ocr$/i.test(property)) return "OCR";
    if (property === "\u89c6\u9891" || property === "\u56fe\u4e66" || property === "\u811a\u672c" || property === "\u5176\u4ed6") return property;
    return "";
  }

  function validateScriptMeta(meta) {
    var property = normalizeScriptProperty(meta && meta.property);
    if (!property) {
      return { ok: false, error: text("\u811a\u672c\u5fc5\u987b\u58f0\u660e @\u5c5e\u6027\uff0c\u53ef\u7528\u503c\uff1a\u89c6\u9891\u3001AI\u3001OCR\u3001\u56fe\u4e66\u3001\u811a\u672c\u3001\u5176\u4ed6\u3002") };
    }
    var permissions = Array.isArray(meta && meta.permissions) ? meta.permissions : [];
    if (!permissions.length) {
      return { ok: false, error: text("\u811a\u672c\u5fc5\u987b\u58f0\u660e @permission\uff0c\u53ef\u7528\u503c\uff1adom\u3001network\u3002") };
    }
    if (permissions.some(function (permission) { return ["dom", "network"].indexOf(permission) < 0; })) {
      return { ok: false, error: text("\u811a\u672c\u5305\u542b\u4e0d\u652f\u6301\u7684 @permission\uff0c\u5f53\u524d\u4ec5\u652f\u6301 dom \u548c network\u3002") };
    }
    meta.property = property;
    meta.permissions = permissions.slice().sort();
    return { ok: true, property: property, permissions: meta.permissions };
  }

  function createScriptId() {
    try { return crypto.randomUUID().replace(/-/g, ""); } catch (e) { return (Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 48); }
  }

  function permissionSignature(meta) {
    return (Array.isArray(meta && meta.permissions) ? meta.permissions.slice().sort() : []).join(",");
  }

  function permissionDescription(meta) {
    var permissions = Array.isArray(meta && meta.permissions) ? meta.permissions : [];
    return permissions.map(function (permission) {
      if (permission === "dom") return "- dom：读取和修改当前网页内容";
      if (permission === "network") return "- network：发起受网页跨域规则限制的网络请求";
      return "- " + permission;
    }).join("\n");
  }

  function userScriptsEnableInstruction() {
    var match = navigator.userAgent.match(/(?:Edg|Chrome|Chromium)\/([0-9]+)/i);
    var version = match ? Number(match[1]) : 138;
    return version >= 138
      ? text("\u8bf7\u6253\u5f00 edge://extensions/ \u6216 chrome://extensions/\uff0c\u8fdb\u5165 WinSpeedBall \u8be6\u7ec6\u4fe1\u606f\uff0c\u5f00\u542f\u201c\u5141\u8bb8\u7528\u6237\u811a\u672c\u201d\u540e\u91cd\u65b0\u52a0\u8f7d\u6269\u5c55\u3002")
      : text("\u8bf7\u6253\u5f00 edge://extensions/ \u6216 chrome://extensions/\uff0c\u5f00\u542f\u9875\u9762\u53f3\u4e0a\u89d2\u7684\u201c\u5f00\u53d1\u4eba\u5458\u6a21\u5f0f\u201d\u540e\u91cd\u65b0\u52a0\u8f7d\u6269\u5c55\u3002");
  }

  function loadUserScriptsStatus() {
    return sendMessage({ action: "getUserScriptsStatus" }).then(function (status) {
      userScriptsAvailable = !!(status && status.available);
      var element = $("userScriptsApiStatus");
      if (element) element.textContent = userScriptsAvailable
        ? text("\u7528\u6237\u811a\u672c\u5b89\u5168\u6a21\u5f0f\u5df2\u5f00\u542f\uff0c\u5df2\u6ce8\u518c\uff1a") + Number(status.registered || 0)
        : userScriptsEnableInstruction();
      if ($("runAllScriptsBtn")) $("runAllScriptsBtn").disabled = !userScriptsAvailable;
      return status;
    });
  }

  function confirmInputPermissions(input) {
    var meta = safeParseJson(input.dataset.scriptMeta || "{}", parseUserScriptMeta(input.dataset.scriptCode || ""));
    var validation = validateScriptMeta(meta);
    if (!validation.ok) return Promise.resolve({ ok: false, error: validation.error });
    var signature = permissionSignature(meta);
    if (input.dataset.permissionConfirmed === "true" && input.dataset.permissionSignature === signature) return Promise.resolve({ ok: true, meta: meta });
    var name = input.dataset.scriptName || input.value || text("\u672a\u547d\u540d\u811a\u672c");
    var confirmed = window.confirm(text("\u811a\u672c\u201c") + name + text("\u201d\u7533\u8bf7\u4ee5\u4e0b\u6743\u9650\uff1a\n\n") + permissionDescription(meta) + text("\n\n\u53ea\u8fd0\u884c\u4f60\u4fe1\u4efb\u7684\u811a\u672c\u3002\u662f\u5426\u5141\u8bb8\uff1f"));
    if (!confirmed) return Promise.resolve({ ok: false, error: text("\u7528\u6237\u53d6\u6d88\u4e86\u811a\u672c\u6743\u9650\u3002") });
    input.dataset.permissionConfirmed = "true";
    input.dataset.permissionSignature = signature;
    updateScriptMeta(input);
    return new Promise(function (resolve) {
      saveScriptRows(function () { resolve({ ok: true, meta: meta }); });
    });
  }

  function scriptPatternMatches(pattern, url) {
    pattern = String(pattern || "").trim();
    if (!pattern || pattern === "<all_urls>") return pattern === "<all_urls>";
    var escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    try { return new RegExp("^" + escaped + "$").test(url); } catch (e) { return false; }
  }

  function scriptMetaMatchesUrl(meta, url) {
    var matches = (meta && meta.matches || []).concat(meta && meta.includes || []);
    var excludes = meta && meta.excludes || [];
    if (!matches.length || excludes.some(function (pattern) { return scriptPatternMatches(pattern, url); })) return false;
    return matches.some(function (pattern) { return scriptPatternMatches(pattern, url); });
  }

  function hasBroadScriptPattern(meta) {
    return (meta && meta.matches || []).concat(meta && meta.includes || []).some(function (pattern) {
      pattern = String(pattern || "").trim();
      if (pattern === "<all_urls>") return true;
      var match = pattern.match(/^[^:]+:\/\/([^/]+)/);
      return !!(match && match[1].indexOf("*") >= 0);
    });
  }

  function executeScriptFeature(script, openWorkspace) {
    var input = Array.prototype.slice.call(document.querySelectorAll("#scriptList .script-row input[type='text']")).find(function (item) {
      return item.dataset.scriptId === script.id;
    });
    if (!input) return Promise.resolve({ ok: false, error: text("\u672a\u627e\u5230\u5bf9\u5e94\u811a\u672c\u3002") });
    return confirmInputPermissions(input).then(function (permissionResult) {
      if (!permissionResult.ok) return permissionResult;
      if (!userScriptsAvailable) return { ok: false, code: "USER_SCRIPTS_DISABLED", error: userScriptsEnableInstruction() };
      if (openWorkspace) showScriptWorkspaceUi(script.name, script.code);
      var startedAt = Date.now();
      addDetailedLog("\u811a\u672c", "\u5f00\u59cb\u6267\u884c", {
        \u540d\u79f0: script.name || "\u672a\u547d\u540d",
        \u5c5e\u6027: permissionResult.meta.property || "-",
        \u6743\u9650: permissionSignature(permissionResult.meta)
      });
      return sendMessage({
        action: "executeUserScript",
        scriptId: input.dataset.scriptId,
        code: script.code,
        permissions: permissionResult.meta.permissions,
        permissionConfirmed: true
      }).then(function (res) {
        if (res.ok) {
          input.dataset.lastRunAt = String(Date.now());
          updateScriptMeta(input);
          saveScriptRows();
        }
      addDetailedLog("\u811a\u672c", res.ok ? "\u6267\u884c\u6210\u529f" : "\u6267\u884c\u5931\u8d25", {
        \u540d\u79f0: script.name || "\u672a\u547d\u540d",
        \u8017\u65f6: (Date.now() - startedAt) + "ms",
        \u539f\u56e0: res.error || "-"
      });
      setTopStatus(res.ok ? text("\u811a\u672c\u529f\u80fd\u5df2\u6267\u884c") : text("\u811a\u672c\u529f\u80fd\u6267\u884c\u5931\u8d25"));
      return res;
      });
    });
  }

  function renderFeatureHost(hostId, scripts) {
    var host = $(hostId);
    if (!host) return;
    host.textContent = "";
    if (!scripts.length) return;
    var group = document.createElement("div");
    var title = document.createElement("div");
    var actions = document.createElement("div");
    group.className = "script-feature-group";
    title.className = "script-feature-title";
    title.textContent = text("\u811a\u672c\u529f\u80fd");
    actions.className = "script-feature-actions";
    scripts.forEach(function (script) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "script-feature-action";
      button.textContent = script.name;
      button.addEventListener("click", function () { executeScriptFeature(script, false); });
      actions.appendChild(button);
    });
    group.appendChild(title);
    group.appendChild(actions);
    host.appendChild(group);
  }

  function renderScriptFeatures(scripts) {
    scripts = (scripts || []).filter(function (script) {
      var meta = script.meta || parseUserScriptMeta(script.code);
      var validation = validateScriptMeta(meta);
      if (validation.ok) script.meta = meta;
      return script.enabled !== false && validation.ok;
    });
    renderFeatureHost("videoScriptFeatures", scripts.filter(function (script) { return normalizeScriptProperty(script.meta.property) === "\u89c6\u9891"; }));
    renderFeatureHost("aiScriptFeatures", scripts.filter(function (script) { return normalizeScriptProperty(script.meta.property) === "AI"; }));
    renderFeatureHost("ocrScriptFeatures", scripts.filter(function (script) { return normalizeScriptProperty(script.meta.property) === "OCR"; }));
    renderFeatureHost("bookScriptFeatures", scripts.filter(function (script) { return normalizeScriptProperty(script.meta.property) === "\u56fe\u4e66"; }));
    renderFeatureHost("scriptScriptFeatures", scripts.filter(function (script) { return normalizeScriptProperty(script.meta.property) === "\u811a\u672c"; }));

    var otherScripts = scripts.filter(function (script) { return normalizeScriptProperty(script.meta.property) === "\u5176\u4ed6"; });
    var nav = $("scriptFeatureNav");
    var separator = $("scriptFeatureSep");
    nav.textContent = "";
    separator.style.display = otherScripts.length ? "block" : "none";
    otherScripts.forEach(function (script) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "script-feature-btn";
      button.textContent = script.name;
      button.title = script.name;
      button.addEventListener("click", function () {
        button.disabled = true;
        button.textContent = script.name + text("\u00b7\u8fd0\u884c\u4e2d");
        executeScriptFeature(script, true).then(function (res) {
          button.disabled = false;
          button.textContent = script.name;
          button.title = res && res.ok ? text("\u6267\u884c\u6210\u529f") : ((res && res.error) || text("\u6267\u884c\u5931\u8d25"));
        });
      });
      nav.appendChild(button);
    });
  }

  function safeParseJson(value, fallback) {
    try {
      return JSON.parse(value);
    } catch (e) {
      return fallback;
    }
  }

  function getSavedScriptRows() {
    var rows = [];
    document.querySelectorAll("#scriptList .script-row input[type='text']").forEach(function (input) {
      var row = input.closest(".script-row");
      var enabled = row ? row.querySelector(".script-enabled") : null;
      var code = String(input.dataset.scriptCode || "");
      if (!code.trim()) return;
      var savedMeta = safeParseJson(input.dataset.scriptMeta || "{}", parseUserScriptMeta(code));
      if (!validateScriptMeta(savedMeta).ok) return;
      rows.push({
        id: input.dataset.scriptId || createScriptId(),
        name: input.dataset.scriptName || input.value || text("\u672a\u547d\u540d\u811a\u672c"),
        code: code,
        enabled: enabled ? enabled.checked : true,
        grantedOrigins: safeParseJson(input.dataset.grantedOrigins || "[]", []),
        permissionConfirmed: input.dataset.permissionConfirmed === "true" && input.dataset.permissionSignature === permissionSignature(savedMeta),
        permissionSignature: permissionSignature(savedMeta),
        meta: savedMeta,
        savedAt: Number(input.dataset.savedAt || Date.now()),
        lastRunAt: Number(input.dataset.lastRunAt || 0)
      });
    });
    return rows.slice(0, 20);
  }

  function saveScriptRows(callback) {
    var scripts = getSavedScriptRows();
    renderScriptFeatures(scripts);
    storageSet({ userScripts: scripts }, function () {
      if (chrome.runtime.lastError) {
        $("scriptStatus").textContent = text("\u811a\u672c\u4fdd\u5b58\u5931\u8d25\uff1a") + chrome.runtime.lastError.message;
      }
      if (typeof callback === "function") callback();
    });
  }

  function fmtDateTime(time) {
    time = Number(time || 0);
    if (!time) return text("\u672a\u8fd0\u884c");
    return new Date(time).toLocaleString();
  }

  function updateScriptMeta(input, meta) {
    var row = input.closest(".script-row");
    var metaEl = row ? row.querySelector(".script-meta") : null;
    var enabled = row ? row.querySelector(".script-enabled") : null;
    var hasCode = !!String(input.dataset.scriptCode || "").trim();
    input.classList.toggle("has-script", hasCode);
    if (!metaEl) return;
    if (!hasCode) {
      metaEl.textContent = text("\u672a\u4fdd\u5b58\u811a\u672c");
      return;
    }
    var scriptMeta = safeParseJson(input.dataset.scriptMeta || "{}", {});
    var property = normalizeScriptProperty(scriptMeta.property);
    var patterns = (scriptMeta.matches || []).concat(scriptMeta.includes || []);
    var autoInfo = patterns.length ? ("@match: " + patterns.slice(0, 2).join(", ")) : text("\u672a\u8bbe\u7f6e @match\uff0c\u4ec5\u624b\u52a8\u8fd0\u884c");
    var grantedCount = safeParseJson(input.dataset.grantedOrigins || "[]", []).length;
    var permissions = permissionSignature(scriptMeta) || text("\u672a\u58f0\u660e");
    var permissionState = input.dataset.permissionConfirmed === "true" && input.dataset.permissionSignature === permissionSignature(scriptMeta)
      ? text("\u5df2\u786e\u8ba4")
      : text("\u5f85\u786e\u8ba4");
    var version = scriptMeta.version ? (" v" + scriptMeta.version + " | ") : "";
    var state = enabled && !enabled.checked ? text("\u5df2\u505c\u7528 | ") : text("\u5df2\u542f\u7528 | ");
    metaEl.textContent = meta || (state + "@\u5c5e\u6027: " + (property || text("\u672a\u8bbe\u7f6e")) + " | " + version + autoInfo + text(" | \u6743\u9650\uff1a") + permissions + "(" + permissionState + ")" + text(" | \u5df2\u6388\u6743\u7f51\u7ad9\uff1a") + grantedCount + text(" | \u4e0a\u6b21\u8fd0\u884c\uff1a") + fmtDateTime(input.dataset.lastRunAt));
  }

  function runScriptInput(input) {
    var row = input.closest(".script-row");
    var enabled = row ? row.querySelector(".script-enabled") : null;
    var code = String(input.dataset.scriptCode || "").trim();
    var name = input.dataset.scriptName || input.value || text("\u672a\u547d\u540d\u811a\u672c");
    if (enabled && !enabled.checked) {
      $("scriptStatus").textContent = text("\u811a\u672c\u5df2\u505c\u7528\uff1a") + name;
      return Promise.resolve({ ok: false, disabled: true });
    }
    if (!code) {
      $("scriptStatus").textContent = text("\u8bf7\u5148\u9009\u62e9\u672c\u5730 .js \u811a\u672c\u6587\u4ef6\u3002");
      return Promise.resolve({ ok: false });
    }
    var scriptMeta = safeParseJson(input.dataset.scriptMeta || "{}", parseUserScriptMeta(code));
    var validation = validateScriptMeta(scriptMeta);
    if (!validation.ok) {
      $("scriptStatus").textContent = validation.error;
      updateScriptMeta(input, validation.error);
      return Promise.resolve({ ok: false, error: validation.error });
    }
    return confirmInputPermissions(input).then(function (permissionResult) {
      if (!permissionResult.ok) {
        $("scriptStatus").textContent = permissionResult.error;
        return permissionResult;
      }
      if (!userScriptsAvailable) {
        var unavailable = { ok: false, code: "USER_SCRIPTS_DISABLED", error: userScriptsEnableInstruction() };
        $("scriptStatus").textContent = unavailable.error;
        return unavailable;
      }
      $("scriptStatus").textContent = text("\u6b63\u5728\u6267\u884c\uff1a") + name;
      updateScriptMeta(input, text("\u6b63\u5728\u8fd0\u884c..."));
      return sendMessage({
        action: "executeUserScript",
        scriptId: input.dataset.scriptId,
        code: code,
        permissions: permissionResult.meta.permissions,
        permissionConfirmed: true
      }).then(function (res) {
      if (res.ok) {
        input.dataset.lastRunAt = String(Date.now());
        updateScriptMeta(input);
        saveScriptRows();
        $("scriptStatus").textContent = text("\u811a\u672c\u5df2\u6267\u884c\uff1a") + name;
      } else {
        updateScriptMeta(input, text("\u8fd0\u884c\u5931\u8d25"));
        $("scriptStatus").textContent = text("\u811a\u672c\u6267\u884c\u5931\u8d25\uff1a") + (res.error || text("\u672a\u77e5\u9519\u8bef"));
      }
      return res;
      });
    });
  }

  function runAllScripts() {
    var inputs = Array.prototype.slice.call(document.querySelectorAll("#scriptList .script-row input[type='text']")).filter(function (input) {
      var row = input.closest(".script-row");
      var enabled = row ? row.querySelector(".script-enabled") : null;
      return !!String(input.dataset.scriptCode || "").trim() && (!enabled || enabled.checked);
    });
    var chain = Promise.resolve();
    var okCount = 0;
    var failCount = 0;
    if (!inputs.length) {
      $("scriptStatus").textContent = text("\u6ca1\u6709\u53ef\u8fd0\u884c\u7684\u811a\u672c\u3002");
      return;
    }
    inputs.forEach(function (input) {
      chain = chain.then(function () {
        return runScriptInput(input).then(function (res) {
          if (res && res.ok) okCount++;
          else failCount++;
        });
      });
    });
    chain.then(function () {
      $("scriptStatus").textContent = text("\u5168\u90e8\u811a\u672c\u6267\u884c\u5b8c\u6210\u3002\u6210\u529f\uff1a") + okCount + text("\uff0c\u5931\u8d25\uff1a") + failCount;
    });
  }

  function loadScriptRows() {
    storageGet(["userScripts"], function (data) {
      var list = Array.isArray(data.userScripts) ? data.userScripts : [];
      scriptMigrationNeeded = false;
      $("scriptList").textContent = "";
      if (!list.length) {
        addScriptRow();
        renderScriptFeatures([]);
        return;
      }
      list.forEach(function (item) {
        addScriptRow(item);
      });
      var normalized = getSavedScriptRows();
      renderScriptFeatures(normalized);
      if (scriptMigrationNeeded) {
        saveScriptRows(function () {
          $("scriptStatus").textContent = text("\u65e7\u811a\u672c\u5df2\u8fc1\u79fb\u4e3a dom \u6743\u9650\uff0c\u4e0b\u6b21\u8fd0\u884c\u524d\u9700\u91cd\u65b0\u786e\u8ba4\u3002");
        });
      } else {
        $("scriptStatus").textContent = text("\u5df2\u6062\u590d\u4e0a\u6b21\u4fdd\u5b58\u7684\u811a\u672c\u3002");
      }
    });
  }

  function addScriptRow(savedScript) {
    var list = $("scriptList");
    var wrap = document.createElement("div");
    var input = document.createElement("input");
    var enabledInput = document.createElement("input");
    var fileInput = document.createElement("input");
    var authorizeBtn = document.createElement("button");
    var runBtn = document.createElement("button");
    var renameBtn = document.createElement("button");
    var removeBtn = document.createElement("button");
    var meta = document.createElement("div");
    wrap.className = "script-row";
    enabledInput.type = "checkbox";
    enabledInput.className = "script-enabled";
    enabledInput.title = text("\u542f\u7528\u81ea\u52a8\u8fd0\u884c");
    enabledInput.checked = !savedScript || savedScript.enabled !== false;
    input.type = "text";
    input.readOnly = true;
    input.dataset.scriptId = savedScript && savedScript.id || createScriptId();
    if (savedScript && !savedScript.id) scriptMigrationNeeded = true;
    input.dataset.permissionConfirmed = "false";
    input.dataset.permissionSignature = "";
    input.placeholder = text("\u9009\u62e9\u672c\u5730 .js \u811a\u672c\u6587\u4ef6");
    if (savedScript && savedScript.code) {
      var savedMeta = savedScript.meta || parseUserScriptMeta(savedScript.code);
      if (!Array.isArray(savedMeta.permissions) || !savedMeta.permissions.length) {
        savedMeta.permissions = ["dom"];
        savedScript.permissionConfirmed = false;
        scriptMigrationNeeded = true;
      }
      input.value = savedScript.name || savedMeta.name || text("\u5df2\u4fdd\u5b58\u811a\u672c");
      input.dataset.scriptName = input.value;
      input.dataset.scriptCode = String(savedScript.code || "");
      input.dataset.scriptMeta = JSON.stringify(savedMeta);
      input.dataset.savedAt = String(savedScript.savedAt || Date.now());
      input.dataset.lastRunAt = String(savedScript.lastRunAt || 0);
      input.dataset.grantedOrigins = JSON.stringify(Array.isArray(savedScript.grantedOrigins) ? savedScript.grantedOrigins : []);
      input.dataset.permissionSignature = permissionSignature(savedMeta);
      input.dataset.permissionConfirmed = savedScript.permissionConfirmed === true && savedScript.permissionSignature === permissionSignature(savedMeta) ? "true" : "false";
    }
    if (!input.dataset.grantedOrigins) input.dataset.grantedOrigins = "[]";
    fileInput.type = "file";
    fileInput.accept = ".js,text/javascript,application/javascript,text/plain";
    fileInput.style.display = "none";
    runBtn.type = "button";
    authorizeBtn.type = "button";
    renameBtn.type = "button";
    removeBtn.type = "button";
    runBtn.className = "icon-btn";
    authorizeBtn.className = "icon-btn";
    renameBtn.className = "icon-btn";
    removeBtn.className = "icon-btn";
    runBtn.title = text("\u6267\u884c");
    authorizeBtn.title = text("\u6388\u6743\u5f53\u524d\u7f51\u7ad9\u81ea\u52a8\u8fd0\u884c");
    renameBtn.title = text("\u91cd\u547d\u540d");
    removeBtn.title = text("\u5220\u9664");
    runBtn.textContent = "\u25b6";
    authorizeBtn.textContent = "\u6743";
    renameBtn.textContent = "\u6539";
    removeBtn.textContent = "Del";
    meta.className = "script-meta";
    wrap.appendChild(enabledInput);
    wrap.appendChild(input);
    wrap.appendChild(fileInput);
    wrap.appendChild(authorizeBtn);
    wrap.appendChild(runBtn);
    wrap.appendChild(renameBtn);
    wrap.appendChild(removeBtn);
    wrap.appendChild(meta);
    list.appendChild(wrap);
    updateScriptMeta(input);

    enabledInput.addEventListener("change", function () {
      updateScriptMeta(input);
      saveScriptRows(function () {
        $("scriptStatus").textContent = enabledInput.checked ? text("\u811a\u672c\u5df2\u542f\u7528\u3002") : text("\u811a\u672c\u5df2\u505c\u7528\u3002");
      });
    });

    removeBtn.addEventListener("click", function () {
      wrap.remove();
      saveScriptRows();
      if (!list.children.length) addScriptRow();
    });
    authorizeBtn.addEventListener("click", function () {
      var code = String(input.dataset.scriptCode || "");
      if (!code) {
        $("scriptStatus").textContent = text("\u8bf7\u5148\u9009\u62e9\u811a\u672c\u6587\u4ef6\u3002");
        return;
      }
      confirmInputPermissions(input).then(function (permissionResult) {
        if (!permissionResult.ok) {
          $("scriptStatus").textContent = permissionResult.error;
          return;
        }
        if (!userScriptsAvailable) {
          $("scriptStatus").textContent = userScriptsEnableInstruction();
          return;
        }
        return getCurrentSiteAccess().then(function (site) {
        if (!site.ok) {
          $("scriptStatus").textContent = site.error || text("\u5f53\u524d\u7f51\u7ad9\u6388\u6743\u5931\u8d25\u3002");
          return;
        }
        var scriptMeta = permissionResult.meta;
        if (hasBroadScriptPattern(scriptMeta)) {
          $("scriptStatus").textContent = text("\u672c\u6279\u6b21\u4e0d\u5141\u8bb8 <all_urls> \u6216\u8de8\u7ad9\u901a\u914d\u6388\u6743\uff0c\u8bf7\u6539\u4e3a\u660e\u786e\u7f51\u7ad9\u3002");
          return;
        }
        if (!scriptMetaMatchesUrl(scriptMeta, site.url || "")) {
          $("scriptStatus").textContent = text("\u5f53\u524d\u7f51\u7ad9\u4e0d\u5728\u811a\u672c @match \u8303\u56f4\u5185\uff0c\u672a\u6388\u6743\u3002");
          return;
        }
        ensureSiteAccess(site).then(function (grantedSite) {
          if (!grantedSite.ok) {
            $("scriptStatus").textContent = grantedSite.error || text("\u5f53\u524d\u7f51\u7ad9\u6388\u6743\u5931\u8d25\u3002");
            return;
          }
          var origins = safeParseJson(input.dataset.grantedOrigins || "[]", []);
          if (origins.indexOf(grantedSite.originPattern) < 0) origins.push(grantedSite.originPattern);
          input.dataset.grantedOrigins = JSON.stringify(origins);
          enabledInput.checked = true;
          updateScriptMeta(input);
          saveScriptRows(function () {
            sendMessage({ action: "syncUserScripts" }).then(loadUserScriptsStatus);
            $("scriptStatus").textContent = text("\u5df2\u6388\u6743\u5f53\u524d\u7f51\u7ad9\uff1a") + grantedSite.originPattern;
          });
        });
        });
      });
    });
    input.addEventListener("click", function () {
      fileInput.click();
    });
    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      input.value = file ? file.name : "";
      input.dataset.scriptCode = "";
      input.dataset.lastRunAt = "0";
      input.dataset.permissionConfirmed = "false";
      input.dataset.permissionSignature = "";
      updateScriptMeta(input);
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var code = String(reader.result || "");
        if (code.length > MAX_SAVED_SCRIPT_LENGTH) {
          input.value = "";
          input.dataset.scriptCode = "";
          input.dataset.scriptName = "";
          input.dataset.scriptMeta = "";
          $("scriptStatus").textContent = text("\u811a\u672c\u592a\u5927\uff0c\u672a\u4fdd\u5b58\u3002");
          saveScriptRows();
          return;
        }
        var parsedMeta = parseUserScriptMeta(code);
        var validation = validateScriptMeta(parsedMeta);
        if (!validation.ok) {
          input.value = "";
          input.dataset.scriptCode = "";
          input.dataset.scriptName = "";
          input.dataset.scriptMeta = "";
          $("scriptStatus").textContent = validation.error;
          updateScriptMeta(input, validation.error);
          return;
        }
        var displayName = parsedMeta.name || file.name;
        input.value = displayName;
        input.dataset.scriptCode = code;
        input.dataset.scriptName = displayName;
        input.dataset.scriptMeta = JSON.stringify(parsedMeta);
        input.dataset.grantedOrigins = "[]";
        input.dataset.permissionConfirmed = "false";
        input.dataset.permissionSignature = permissionSignature(parsedMeta);
        input.dataset.savedAt = String(Date.now());
        input.dataset.lastRunAt = "0";
        updateScriptMeta(input);
        $("scriptStatus").textContent = text("\u811a\u672c\u5df2\u8bfb\u53d6\uff1a") + file.name;
        saveScriptRows();
      };
      reader.onerror = function () {
        $("scriptStatus").textContent = text("\u811a\u672c\u8bfb\u53d6\u5931\u8d25\u3002");
      };
      reader.readAsText(file, "utf-8");
    });
    renameBtn.addEventListener("click", function () {
      var oldName = input.dataset.scriptName || input.value || "";
      var nextName = window.prompt(text("\u8f93\u5165\u65b0\u811a\u672c\u540d\u79f0"), oldName);
      if (nextName == null) return;
      nextName = String(nextName || "").trim();
      if (!nextName) {
        $("scriptStatus").textContent = text("\u811a\u672c\u540d\u79f0\u4e0d\u80fd\u4e3a\u7a7a\u3002");
        return;
      }
      input.value = nextName;
      input.dataset.scriptName = nextName;
      saveScriptRows(function () {
        $("scriptStatus").textContent = text("\u811a\u672c\u5df2\u91cd\u547d\u540d\u3002");
      });
    });
    runBtn.addEventListener("click", function () {
      saveScriptRows(function () {
        runScriptInput(input);
      });
    });
  }

  function bindScripts() {
    loadUserScriptsStatus();
    $("addScriptRowBtn").addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      addScriptRow();
    });
    $("runAllScriptsBtn").addEventListener("click", runAllScripts);
    $("clearScriptsBtn").addEventListener("click", function () {
      $("scriptList").textContent = "";
      addScriptRow();
      saveScriptRows(function () {
        $("scriptStatus").textContent = text("\u811a\u672c\u5df2\u6e05\u7a7a\u3002");
      });
    });
    $("backToScriptsBtn").addEventListener("click", showScriptManager);
    $("reloadScriptUiBtn").addEventListener("click", function () {
      postScriptToWorkspace(lastWorkspaceScript);
    });
    window.addEventListener("message", function (event) {
      var frame = $("scriptFrame");
      if (!frame || event.source !== frame.contentWindow) return;
      var data = event.data || {};
      if (data.source === "DouyinPanelScript") {
        handleDouyinPanelMessage(data);
        return;
      }
      if (data.source !== "WinSpeedBallScriptWorkspace") return;
      if (data.type === "POINTER_MOVE") {
        var rect = frame.getBoundingClientRect();
        document.dispatchEvent(new MouseEvent("mousemove", {
          clientX: rect.left + Number(data.clientX || 0),
          clientY: rect.top + Number(data.clientY || 0)
        }));
        return;
      }
      if (!data.ok) {
        $("scriptStatus").textContent = text("\u811a\u672c\u754c\u9762\u8fd0\u884c\u5931\u8d25\uff1a") + (data.error || text("\u672a\u77e5\u9519\u8bef"));
      }
    });
    loadScriptRows();
  }

  bindPanels();
  bindScriptWorkspaceNav();
  bindVideo();
  bindOcr();
  bindAi();
  bindBook();
  bindSettings();
  bindScripts();
  bindLogs();
  loadLogs();
  restorePopupStateOnOpen();
  loadSettings();
  loadManualCapture();
  loadAiHistory();
  control({ type: "GET_STATUS" });
})();
