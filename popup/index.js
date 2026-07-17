(function () {
  "use strict";

  var lastCaptureDataUrl = "";
  var lastCaptureTime = 0;
  var autoAiRequestSourceTime = 0;
  var latestPageText = "";
  var logs = [];
  var logsLoaded = false;
  var pendingLogEntries = [];
  var videoDurationRetryTimer = null;
  var videoDurationRetryCount = 0;
  var voiceUiTimer = null;
  var bookBackCoverUiTimer = null;
  var lastVideoStatus = null;
  var logApi = window.WinSpeedBallLogRecord;
  var lastPanelId = "videoPanel";
  var panelSelectedThisOpen = false;
  var panelScrollPositions = Object.create(null);
  var MAX_SAVED_SCRIPT_LENGTH = 200000;
  var MIN_AUTO_INTERVAL_SECONDS = 30;
  var MIN_CHAOXING_INTERVAL_SECONDS = 2;
  var navRevealTimer = null;
  var navHideTimer = null;
  var rightRevealTimer = null;
  var rightHideTimer = null;
  var topRevealTimer = null;
  var topHideTimer = null;
  var lastWorkspaceScript = null;
  var pendingWorkspaceScript = null;
  var scriptWorkspaceReady = false;
  var scriptWorkspaceRunSequence = 0;
  var scriptWorkspacePort = null;
  var scriptWorkspaceRunId = "";
  var scriptWorkspaceAutomationAllowed = false;
  var SCRIPT_WORKSPACE_CHANNEL = "WSB_LEGACY_WORKSPACE";
  var SCRIPT_WORKSPACE_PROTOCOL_VERSION = 1;
  var douyinBridgeDecision = null;
  var douyinPanelState = { running: false, interval: MIN_AUTO_INTERVAL_SECONDS };
  var bookPanelState = {
    running: false,
    interval: MIN_AUTO_INTERVAL_SECONDS,
    mode: "book",
    selectedMode: "book",
    detected: { book: false, image: false, chaoxing: false },
    reader: { book: "", image: "", chaoxing: "" },
    backCover: { enabled: false, dueAt: 0, index: 0, currentOption: "", reached: false }
  };
  var navRevealDelayMs = 800;
  var navHideDelayMs = 900;
  var navTransitionMs = 180;
  var captureSelectionTone = 96;
  var captureSelectionWidth = 2;
  var autoSendOcrToAi = false;
  var autoOcrPromptTemplate = "";
  var aiProviderOptions = [];
  var aiProviderWorkspaces = Object.create(null);
  var activeAiProviderId = "deepseek";
  var aiWorkspaceSaveTimer = null;
  var usageDeclaration = null;
  var currentUserSession = null;
  var AI_PROVIDER_FALLBACKS = [
    { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", requiresApiKey: true },
    { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-5.4-mini", requiresApiKey: true },
    { id: "claude", label: "Claude", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5", requiresApiKey: true },
    { id: "local", label: "Local model", baseUrl: "http://localhost:11434/v1", model: "gpt-oss:20b", requiresApiKey: false }
  ];
  var userScriptsAvailable = false;
  var scriptMigrationNeeded = false;
  var MESSAGE_AUDIT_ACTIONS = {
    startRegionCapture: ["OCR", "启动框选截图"],
    retryManualOcr: ["OCR", "重新识别"],
    startTabAudioCapture: ["语音", "开始获取网页声音"],
    stopTabAudioCapture: ["语音", "停止录音并识别"],
    cancelTabAudioCapture: ["语音", "取消网页语音获取"],
    acceptUsageDeclaration: ["使用声明", "接受使用声明"],
    setDeveloperMode: ["开发者", "更新开发者模式"],
    prepareSdkContext: ["开发者", "准备 SDK 上下文"],
    prepareSdkSession: ["开发者", "创建 SDK 会话"],
    invokeSdkSession: ["开发者", "调用 SDK 功能"],
    closeSdkSession: ["开发者", "关闭 SDK 会话"],
    deleteSdkScriptData: ["开发者", "删除 SDK 脚本数据"],
    clearPrivacyData: ["隐私", "清理隐私数据"],
    openPinnedWindow: ["窗口", "打开独立窗口"],
    registerUser: ["账户", "注册账户"],
    loginUser: ["账户", "登录账户"],
    logoutUser: ["账户", "退出账户"],
    updateUserProfile: ["账户", "更新账户资料"],
    changeUserPassword: ["账户", "修改账户密码"],
    deleteUserAccount: ["账户", "删除账户"],
    saveAiSettings: ["AI", "保存 AI 设置"],
    saveApiKey: ["AI", "保存 AI 密钥"],
    syncUserScripts: ["脚本", "同步用户脚本"],
    showAiReplyWindow: ["AI", "打开 AI 回复窗口"]
  };
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
  var rawSendMessage = messageClient.send;
  var sendMessage = sendMessageWithAudit;
  var getCurrentSiteAccess = messageClient.getCurrentSiteAccess;
  var ensureSiteAccess = messageClient.ensureSiteAccess;
  var requestCurrentSiteAccess = messageClient.requestCurrentSiteAccess;
  var ensureMediaAccess = messageClient.ensureMediaAccess;
  var ensureBookAccess = messageClient.ensureBookAccess;
  var ensureServiceOrigin = messageClient.ensureServiceOrigin;
  var windowModeController = self.WinSpeedBallPopupWindowMode.create({
    search: window.location.search,
    document: document,
    storage: popupStorage,
    openPinnedWindow: function () { return sendMessage({ action: "openPinnedWindow" }); },
    closeWindow: function () { window.close(); }
  });
  var isPinnedWindow = windowModeController.isPinned;
  var developerDraftStore = self.WinSpeedBallDeveloperDraftStore.create({
    storage: popupStorage,
    contracts: self.WinSpeedBallSdkContracts
  });
  var sdkSessionController = self.WinSpeedBallSdkSessionController.create({
    byId: $,
    sendMessage: sendMessage,
    draftStore: developerDraftStore,
    contracts: self.WinSpeedBallSdkContracts,
    protocol: self.WinSpeedBallSdkSessionProtocol,
    ensureSiteAccess: ensureSiteAccess,
    confirmAction: function (message) { return window.confirm(message); },
    runtimeUrl: function (path) { return chrome.runtime.getURL(path); }
  });
  var developerController = self.WinSpeedBallDeveloperController.create({
    byId: $,
    sendMessage: sendMessage,
    draftStore: developerDraftStore,
    sessionController: sdkSessionController,
    contracts: self.WinSpeedBallSdkContracts,
    confirmAction: function (message) { return window.confirm(message); }
  });
  var navZones = {
    left: { width: 32, top: 0, bottom: 320 },
    right: { width: 32, top: 0, bottom: 320 },
    top: { height: 32, left: 0, right: 380 }
  };

  windowModeController.applyMode();

  function applyNavTransition() {
    document.body.style.setProperty("--nav-transition", navTransitionMs + "ms");
  }

  function normalizeAutoInterval(value, mode) {
    var interval = Math.round(Number(value));
    var minimum = normalizeBookMode(mode) === "chaoxing" ? MIN_CHAOXING_INTERVAL_SECONDS : MIN_AUTO_INTERVAL_SECONDS;
    return Number.isFinite(interval) && interval >= minimum
      ? interval
      : minimum;
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
    }, function (result) {
      addDetailedLog("界面", result && result.ok === false ? "保存框选样式失败" : "保存框选样式成功", {
        颜色深浅: captureSelectionTone,
        边框粗细: captureSelectionWidth + "px",
        原因: result && result.error || "-"
      }, result && result.ok === false ? "error" : "success");
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
    addDetailedLog("状态", value, {});
  }

  function addLog(value) {
    if (!value) return;
    var entry = typeof value === "object" ? logApi.normalize(value) : logApi.create("状态", value, {});
    if (!entry) return;
    logs = logApi.normalizeList([entry].concat(logs), 500);
    if (logsLoaded) persistLogEntry(entry);
    else pendingLogEntries.push(entry);
    renderLogs();
  }

  function captureLabel(sourceTime) {
    sourceTime = Number(sourceTime || 0);
    return sourceTime ? ("#" + String(sourceTime).slice(-8)) : "#unknown";
  }

  function addDetailedLog(category, message, details, level) {
    addLog(logApi.create(category, message, details, level));
  }

  function persistLogEntry(entry) {
    rawSendMessage({ action: "appendPopupLog", record: entry }).then(function () {});
  }

  function messageAuditDetails(message, response, startedAt) {
    var action = String(message && message.action || "");
    var payload = message && message.payload && typeof message.payload === "object" ? message.payload : message || {};
    var details = {
      动作: action,
      耗时: Math.max(0, Date.now() - startedAt) + "ms"
    };
    if (payload.command) details.命令 = payload.command;
    if (payload.interval) details.间隔 = payload.interval + "s";
    if (action === "invokeSdkSession" && payload.request) {
      details.SDK方法 = payload.request.method || "-";
    }
    if (action === "clearPrivacyData") details.范围 = payload.category || "-";
    if (response && response.ok === false) details.原因 = response.error || "未知错误";
    return details;
  }

  function messageAuditDescriptor(message) {
    var action = String(message && message.action || "");
    var payload = message && message.payload && typeof message.payload === "object" ? message.payload : message || {};
    if (action === "saveAiSettings" && payload.clearApiKey) return ["AI", "清除 AI 密钥"];
    if (MESSAGE_AUDIT_ACTIONS[action]) return MESSAGE_AUDIT_ACTIONS[action];
    if (action === "douyinPanel" && payload.command !== "GET_STATE") {
      return ["自动化", ({ START: "启动自动下一条", STOP: "停止自动下一条", NEXT: "执行下一条", SET_INTERVAL: "更新自动下一条间隔" })[payload.command] || "执行自动化操作"];
    }
    return null;
  }

  function sendMessageWithAudit(message) {
    var action = String(message && message.action || "");
    var audit = messageAuditDescriptor(message);
    var startedAt = Date.now();
    return rawSendMessage(message).then(function (response) {
      if (audit) {
        var succeeded = !!(response && response.ok !== false);
        addDetailedLog(
          audit[0],
          audit[1] + (succeeded ? "成功" : "失败"),
          messageAuditDetails(message, response, startedAt),
          succeeded ? "success" : "error"
        );
      }
      return response;
    });
  }

  function auditPanelCategory(element) {
    var panel = element && element.closest ? element.closest(".panel") : null;
    var categories = {
      videoPanel: "视频",
      ocrPanel: "OCR",
      aiPanel: "AI",
      bookPanel: "图书",
      settingsPanel: "设置",
      accountPanel: "账户",
      privacyPanel: "隐私",
      scriptPanel: "脚本",
      developerPanel: "开发者",
      logPanel: "日志"
    };
    return panel && categories[panel.id] || "界面";
  }

  function auditControlLabel(element) {
    if (!element) return "未知操作";
    if (element.closest && element.closest("#aiHistoryList")) return "打开 AI 历史记录";
    var label = String(element.getAttribute("aria-label") || element.textContent || "").replace(/\s+/g, " ").trim();
    if (!label && element.closest) {
      var section = element.closest(".section");
      var title = section && section.querySelector(".section-title");
      if (title) label = String(title.textContent || "").replace(/\s+/g, " ").trim();
    }
    return (label || element.id || element.name || element.tagName || "未知操作").slice(0, 80);
  }

  function auditUiInteraction(element, type) {
    if (!element || element.disabled) return;
    var details = {
      操作: auditControlLabel(element),
      类型: type,
      控件: element.id || element.name || element.tagName || "-"
    };
    if (element.type === "checkbox") details.状态 = element.checked ? "开启" : "关闭";
    addDetailedLog(auditPanelCategory(element), "触发界面操作", details, "info");
  }

  function bindComprehensiveActionLogging() {
    document.addEventListener("click", function (event) {
      var button = event.target && event.target.closest ? event.target.closest("button") : null;
      if (button) auditUiInteraction(button, "点击");
    }, true);
    document.addEventListener("change", function (event) {
      var control = event.target;
      if (!control || !control.matches || !control.matches("input,select,textarea")) return;
      auditUiInteraction(control, "更改");
    }, true);
  }

  function loadLogs(replace, callback) {
    storageGet(["popupLogs"], function (data) {
      var saved = Array.isArray(data.popupLogs) ? data.popupLogs : [];
      logs = logApi.normalizeList(replace ? saved : saved.concat(logs), 500);
      logsLoaded = true;
      var pending = pendingLogEntries.slice();
      pendingLogEntries = [];
      pending.forEach(persistLogEntry);
      renderLogs();
      if (typeof callback === "function") callback(logs);
    });
  }

  function visibleLogs() {
    var query = $("logSearchInput") ? $("logSearchInput").value : "";
    var level = $("logLevelFilter") ? $("logLevelFilter").value : "all";
    return logs.filter(function (record) { return logApi.matches(record, query, level); });
  }

  function appendLogDetail(host, key, value) {
    var detail = document.createElement("span");
    detail.className = "log-detail";
    detail.textContent = key + "：" + value;
    host.appendChild(detail);
  }

  function logTimeLabel(timestamp) {
    var date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "--:--:--";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function createLogEntry(record) {
    var labels = { error: "异常", warn: "警告", success: "成功", info: "信息" };
    var entry = document.createElement("article");
    var head = document.createElement("div");
    var level = document.createElement("span");
    var category = document.createElement("span");
    var time = document.createElement("time");
    var message = document.createElement("div");
    var details = document.createElement("div");
    entry.className = "log-entry";
    entry.dataset.level = record.level;
    entry.dataset.logId = record.id;
    head.className = "log-entry-head";
    level.className = "log-level";
    level.textContent = labels[record.level] || "信息";
    category.className = "log-category";
    category.textContent = record.category;
    time.className = "log-time";
    time.dateTime = record.timestamp;
    time.textContent = logTimeLabel(record.timestamp);
    message.className = "log-message";
    message.textContent = record.message;
    details.className = "log-details";
    Object.keys(record.details || {}).forEach(function (key) {
      appendLogDetail(details, key, record.details[key]);
    });
    head.appendChild(level);
    head.appendChild(category);
    head.appendChild(time);
    entry.appendChild(head);
    entry.appendChild(message);
    if (details.childNodes.length) entry.appendChild(details);
    return entry;
  }

  function renderLogs(resetScroll) {
    var list = $("logList");
    if (!list) return;
    var previousTop = list.scrollTop;
    var previousHeight = list.scrollHeight;
    var keepAtTop = resetScroll === true || previousTop <= 4;
    var visible = visibleLogs();
    var fragment = document.createDocumentFragment();
    list.textContent = "";
    if (!visible.length) {
      var empty = document.createElement("div");
      empty.className = "log-empty";
      empty.textContent = logs.length ? "没有符合搜索条件的日志" : "暂无运行日志";
      fragment.appendChild(empty);
    } else {
      visible.forEach(function (record) { fragment.appendChild(createLogEntry(record)); });
    }
    list.appendChild(fragment);
    if (keepAtTop) list.scrollTop = 0;
    else list.scrollTop = Math.max(0, previousTop + list.scrollHeight - previousHeight);
    $("logTotalCount").textContent = String(logs.length);
    $("logErrorCount").textContent = String(logs.filter(function (record) { return record.level === "error"; }).length);
    $("logVisibleCount").textContent = String(visible.length);
  }

  function currentPopupState() {
    return {
      lastPanelId: lastPanelId,
      chromeHidden: true,
      scriptWorkspaceActive: document.body.classList.contains("script-ui-active"),
      lastWorkspaceScript: lastWorkspaceScript
    };
  }

  function savePopupState(extra, callback) {
    windowModeController.saveState(currentPopupState(), extra, callback);
  }

  function restorePopupStateOnOpen() {
    windowModeController.loadState(function (state, data) {
      document.body.classList.add("chrome-hidden");
      if (!panelSelectedThisOpen && state.lastPanelId) {
        lastPanelId = state.lastPanelId;
        showPanel(lastPanelId, false);
      }
      if (state.lastWorkspaceScript && state.lastWorkspaceScript.code) {
        lastWorkspaceScript = state.lastWorkspaceScript;
      } else if (data && data.lastWorkspaceScript && data.lastWorkspaceScript.code) {
        lastWorkspaceScript = data.lastWorkspaceScript;
      }
      var workspaceActive = isPinnedWindow && state.scriptWorkspaceActive === true;
      if (workspaceActive && lastWorkspaceScript && lastWorkspaceScript.code) {
        showScriptWorkspaceUi(
          lastWorkspaceScript.name,
          lastWorkspaceScript.code,
          lastWorkspaceScript.permissionConfirmed === true,
          lastWorkspaceScript.permissionSignature
        );
      }
    });
  }

  function bindPanels() {
    document.querySelectorAll(".side-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        panelSelectedThisOpen = true;
        if (document.body.classList.contains("script-ui-active")) {
          showScriptManager();
        }
        document.querySelectorAll(".script-feature-btn").forEach(function (item) { item.classList.remove("active"); });
        showPanel(btn.dataset.panel, true);
        if (btn.dataset.panel === "videoPanel") control({ type: "GET_STATUS" });
        if (btn.dataset.panel === "settingsPanel") loadPrivacySummary();
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
    panelId = windowModeController.normalizePanelId(panelId);
    var targetPanel = document.getElementById(panelId);
    if (!targetPanel || !targetPanel.classList.contains("panel")) panelId = "videoPanel";
    var content = document.querySelector(".content");
    var activePanel = document.querySelector(".panel.active");
    if (content && activePanel) panelScrollPositions[activePanel.id] = content.scrollTop;
    document.querySelectorAll(".side-btn").forEach(function (item) {
      item.classList.toggle("active", item.dataset.panel === panelId);
    });
    document.querySelectorAll(".panel").forEach(function (panel) {
      panel.classList.toggle("active", panel.id === panelId);
    });
    document.body.classList.toggle("video-panel-active", panelId === "videoPanel");
    lastPanelId = panelId;
    if (remember) {
      savePopupState();
    }
    if (content) {
      requestAnimationFrame(function () {
        content.scrollTop = Number(panelScrollPositions[panelId] || 0);
      });
    }
  }

  function selectOcrView(view) {
    view = ["capture", "voice"].indexOf(view) >= 0 ? view : "capture";
    document.querySelectorAll("[data-ocr-view]").forEach(function (button) {
      var active = button.dataset.ocrView === view;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.tabIndex = active ? 0 : -1;
    });
    $("ocrCaptureView").classList.toggle("hidden", view !== "capture");
    $("voiceCaptureView").classList.toggle("hidden", view !== "voice");
  }

  function selectBookView(view) {
    view = normalizeBookMode(view);
    bookPanelState.selectedMode = view;
    document.querySelectorAll("[data-book-view]").forEach(function (button) {
      var active = button.dataset.bookView === view;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.tabIndex = active ? 0 : -1;
    });
    $("bookPageView").classList.toggle("hidden", view !== "book");
    $("bookImageView").classList.toggle("hidden", view !== "image");
    $("bookChaoxingView").classList.toggle("hidden", view !== "chaoxing");
    $("bookBackCoverMonitor").classList.toggle("hidden", view !== "chaoxing");
  }

  function normalizeBookMode(mode) {
    return ["book", "image", "chaoxing"].indexOf(mode) >= 0 ? mode : "book";
  }

  function bookModeLabel(mode) {
    mode = normalizeBookMode(mode);
    if (mode === "image") return "图片自动翻阅";
    if (mode === "chaoxing") return "学习通版本";
    return "图书自动翻阅";
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
    savePopupState(isPinnedWindow ? { scriptWorkspaceActive: false } : {});
  }

  function postScriptToWorkspace(script) {
    var frame = $("scriptFrame");
    if (!frame || !frame.contentWindow || !script) return;
    closeScriptWorkspaceChannel();
    pendingWorkspaceScript = {
      name: script.name || "",
      code: script.code || "",
      permissionConfirmed: script.permissionConfirmed === true,
      permissionSignature: String(script.permissionSignature || "")
    };
    scriptWorkspaceReady = false;
    douyinBridgeDecision = null;
    scriptWorkspaceRunSequence += 1;
    frame.src = chrome.runtime.getURL("workspace/index.html") + "?run=" + scriptWorkspaceRunSequence;
  }

  function createScriptWorkspaceRunId() {
    try { return "legacy_" + crypto.randomUUID().replace(/-/g, ""); }
    catch (e) { return "legacy_" + Date.now().toString(36) + Math.random().toString(36).slice(2); }
  }

  function closeScriptWorkspaceChannel() {
    scriptWorkspaceReady = false;
    scriptWorkspaceRunId = "";
    scriptWorkspaceAutomationAllowed = false;
    if (!scriptWorkspacePort) return;
    try { scriptWorkspacePort.close(); } catch (e) {}
    scriptWorkspacePort = null;
  }

  function isScriptWorkspaceEnvelope(data, runId, allowedTypes) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    var keys = Object.keys(data);
    if (keys.some(function (key) { return ["channel", "protocolVersion", "runId", "type", "payload"].indexOf(key) < 0; })) return false;
    return data.channel === SCRIPT_WORKSPACE_CHANNEL &&
      data.protocolVersion === SCRIPT_WORKSPACE_PROTOCOL_VERSION &&
      data.runId === runId &&
      allowedTypes.indexOf(data.type) >= 0 &&
      data.payload && typeof data.payload === "object" && !Array.isArray(data.payload);
  }

  function postToScriptWorkspace(type, payload) {
    if (!scriptWorkspaceReady || !scriptWorkspacePort || !scriptWorkspaceRunId) return;
    scriptWorkspacePort.postMessage({
      channel: SCRIPT_WORKSPACE_CHANNEL,
      protocolVersion: SCRIPT_WORKSPACE_PROTOCOL_VERSION,
      runId: scriptWorkspaceRunId,
      type: type,
      payload: payload || {}
    });
  }

  function postDouyinState(ok, message) {
    postToScriptWorkspace("BRIDGE_STATE", {
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
    if (["START", "NEXT", "SET_INTERVAL"].indexOf(data.action) >= 0) {
      if (!scriptWorkspaceAutomationAllowed) {
        postDouyinState(false, "\u811a\u672c\u672a\u58f0\u660e\u6216\u672a\u786e\u8ba4 @permission automation\uff0c\u5df2\u62d2\u7edd\u81ea\u52a8\u5316\u64cd\u4f5c\u3002");
        return;
      }
      if (douyinBridgeDecision == null) {
        douyinBridgeDecision = window.confirm("脚本“" + (lastWorkspaceScript && lastWorkspaceScript.name || "未命名脚本") + "”请求控制网页自动翻页。仅在你信任该脚本时允许。是否继续？");
      }
      if (!douyinBridgeDecision) {
        postDouyinState(false, "已拒绝脚本的自动翻页请求。");
        return;
      }
    }
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

  function renderBookBackCoverMonitor() {
    var monitor = bookPanelState.backCover;
    var stateElement = $("bookBackCoverState");
    var optionElement = $("bookBackCoverOption");
    var nextElement = $("bookBackCoverNext");
    if (!stateElement || !optionElement || !nextElement) return;
    var stateLabel = monitor.reached ? "已到封底" : (monitor.enabled ? "检测中" : (monitor.currentOption ? "已停止" : "待启动"));
    stateElement.textContent = stateLabel;
    stateElement.classList.toggle("reached", monitor.reached);
    optionElement.textContent = monitor.currentOption || "-";
    if (monitor.reached) {
      nextElement.textContent = "已自动停止";
    } else if (monitor.enabled && monitor.dueAt > 0) {
      nextElement.textContent = Math.max(0, Math.ceil((monitor.dueAt - Date.now()) / 1000)) + " 秒";
    } else {
      nextElement.textContent = "启动后 400 秒";
    }
  }

  function updateBookBackCoverMonitor(res) {
    res = res || {};
    var monitor = bookPanelState.backCover;
    if (Object.prototype.hasOwnProperty.call(res, "backCoverCheckEnabled")) monitor.enabled = !!res.backCoverCheckEnabled;
    if (Object.prototype.hasOwnProperty.call(res, "backCoverCheckDueAt")) monitor.dueAt = Math.max(0, Number(res.backCoverCheckDueAt) || 0);
    if (Object.prototype.hasOwnProperty.call(res, "backCoverCheckIndex")) monitor.index = Math.max(0, Number(res.backCoverCheckIndex) || 0);
    if (Object.prototype.hasOwnProperty.call(res, "backCoverReached")) monitor.reached = !!res.backCoverReached;
    if (Object.prototype.hasOwnProperty.call(res, "backCoverPageJumpLabel")) monitor.currentOption = String(res.backCoverPageJumpLabel || "");
    if (res.pageJumpLabel) monitor.currentOption = String(res.pageJumpLabel);
    renderBookBackCoverMonitor();
  }

  function updateBookPanel(res, message) {
    res = res || {};
    var mode = res.mode ? normalizeBookMode(res.mode) : bookPanelState.selectedMode;
    var controlMap = {
      book: { interval: "bookIntervalInput", start: "bookStartBtn", stop: "bookStopBtn", status: "bookStatus" },
      image: { interval: "bookImageIntervalInput", start: "bookImageStartBtn", stop: "bookImageStopBtn", status: "bookImageStatus" },
      chaoxing: { interval: "bookChaoxingIntervalInput", start: "bookChaoxingStartBtn", stop: "bookChaoxingStopBtn", status: "bookChaoxingStatus" }
    };
    var controls = controlMap[mode];
    bookPanelState.running = !!res.running;
    bookPanelState.interval = normalizeAutoInterval(res.interval || bookPanelState.interval, mode);
    bookPanelState.mode = res.running ? mode : bookPanelState.mode;
    if (res.running && bookPanelState.selectedMode !== mode) selectBookView(mode);
    if (Object.prototype.hasOwnProperty.call(res, "detected")) bookPanelState.detected[mode] = !!res.detected;
    if (res.reader) bookPanelState.reader[mode] = String(res.reader);
    updateBookBackCoverMonitor(res);
    $(controls.interval).value = String(bookPanelState.interval);
    ["bookStartBtn", "bookImageStartBtn", "bookChaoxingStartBtn"].forEach(function (id) { $(id).disabled = bookPanelState.running; });
    ["bookStopBtn", "bookImageStopBtn", "bookChaoxingStopBtn"].forEach(function (id) { $(id).disabled = !bookPanelState.running; });
    var readerLabel = mode === "image"
      ? "\u56fe\u7247\u5e8f\u5217\u9605\u8bfb\u5668"
      : (mode === "chaoxing" ? "超星 PDG/JPath 图像书" : ((res.reader || bookPanelState.reader[mode]) === "chaoxing-book" ? "\u5b66\u4e60\u901a\u5185\u5d4c\u56fe\u4e66" : "\u7f51\u9875\u56fe\u4e66\u9605\u8bfb\u5668"));
    var detectedMessage = (res.detected || bookPanelState.detected[mode])
      ? "\u5df2\u68c0\u6d4b\u5230" + readerLabel + (res.page ? (mode === "image" ? "\uff0c\u5f53\u4f4d\u7f6e\uff1a" : "\uff0c\u5f53\u524d\u9875\u7801\uff1a") + res.page : "") + (res.imageCount ? "/" + res.imageCount : "") + "\u3002"
      : "";
    $(controls.status).textContent = (mode === "chaoxing" && res.backCoverReached ? "已检测到封底页，学习通自动翻阅已停止。" : "") || message || res.message || (res.ok === false
      ? text("\u64cd\u4f5c\u5931\u8d25\uff1a") + (res.error || text("\u672a\u77e5\u9519\u8bef"))
      : (bookPanelState.running && bookPanelState.mode === mode ? bookModeLabel(mode) + "运行中。" : (detectedMessage || text("\u81ea\u52a8\u7ffb\u9605\u5df2\u505c\u6b62\u3002"))));
  }

  function bookControlMethodLabel(method) {
    if (method === "jpath-native-controller") return "超星原生阅读器";
    if (method === "jpath-image-controller") return "超星图片控制器";
    if (method === "image-native-scroll") return "浏览器图片滚动控制器";
    if (method === "jpath-dom-force") return "超星图片节点强制切换";
    if (method === "chaoxing-pdg-native") return "学习通 PDG 原生阅读器";
    if (method === "chaoxing-pdg-force") return "学习通 PDG 页面强制切换";
    if (method === "browser-native-click") return "浏览器原生按钮";
    if (method === "page-native-controller") return "页面原生控制器";
    if (method === "browser-native-keyboard") return "浏览器原生方向键";
    if (method === "button") return "阅读器按钮";
    return "方向键";
  }

  function bookControlErrorMessage(res) {
    var code = String(res && res.error || "");
    if (code === "BOOK_NATIVE_CONTROL_FAILED") {
      if (res && res.jpathDomError === "JPATH_TARGET_IMAGE_NOT_FOUND") return "没有找到可切换的目标图片，可能已经到达第一页或最后一页。";
      if (res && res.jpathControllerError === "JPATH_PAGE_DID_NOT_CHANGE") return "学习通阅读器拒绝了翻页，并且图片节点强制切换也没有成功。";
      return "已找到阅读器，但阅读器没有响应页码、图片或按钮控制。";
    }
    if (code === "BOOK_READER_NOT_FOUND") return "没有在当前页面或内嵌框架中找到可控制的图书阅读器。";
    if (code === "CHAOXING_PDG_READER_NOT_FOUND") return "没有检测到学习通 PDG/JPath 图像书。请先在学习通章节中真正打开图书阅读页。";
    if (code === "CHAOXING_PDG_TURN_FAILED") return "已检测到学习通图像书，但页码、目标图片或学习通阅读器状态没有发生变化。";
    return code || "未知错误";
  }

  function sendBookCommand(command, interval, message, target, mode) {
    mode = normalizeBookMode(mode);
    addDetailedLog("\u56fe\u4e66", "\u53d1\u9001\u64cd\u4f5c", { \u547d\u4ee4: command, \u6a21\u5f0f: bookModeLabel(mode), \u95f4\u9694: interval ? interval + "s" : "-" });
    var payload = { action: "bookPanel", command: command, interval: interval, mode: mode };
    if (target && target.tabId != null && target.originPattern) {
      payload.tabId = target.tabId;
      payload.originPattern = target.originPattern;
    }
    return sendMessage(payload).then(function (res) {
      if (!res.ok) res.error = bookControlErrorMessage(res);
      var successMessage = message;
      if (res.ok && command === "DETECT") successMessage = mode === "image" ? "已检测到图片序列，图片原生控制已就绪。" : (mode === "chaoxing" ? "已检测到学习通 PDG/JPath 图像书，专用控制已就绪。" : (res.reader === "chaoxing-book" ? "已检测到学习通内嵌图书" : "已检测到网页图书阅读器") + (res.nativeController ? "，MAIN 原生强控已就绪。" : "。"));
      else if (res.ok && (command === "NEXT" || command === "PREV")) {
        successMessage = "已通过" + bookControlMethodLabel(res.method) + (mode === "image" ? (command === "NEXT" ? "翻到下一张。" : "翻到上一张。") : (command === "NEXT" ? "翻到下一页。" : "翻到上一页。"));
      }
      updateBookPanel(res, res.ok && successMessage ? successMessage : "");
      addDetailedLog("\u56fe\u4e66", res.ok ? "\u64cd\u4f5c\u6210\u529f" : "\u64cd\u4f5c\u5931\u8d25", {
        \u547d\u4ee4: command,
        \u6a21\u5f0f: bookModeLabel(mode),
        \u8fd0\u884c\u4e2d: res.running ? "\u662f" : "\u5426",
        \u9605\u8bfb\u5668: res.reader || "-",
        \u6846\u67b6: res.frameId == null ? "-" : String(res.frameId),
        \u9875\u7801: res.page || "-",
        \u65b9\u5f0f: res.method || "-",
        原生强控: res.nativeController ? "是" : "否",
        控制环境: res.controllerWorld || "-",
        JPath控制器: res.jpathControllerError || "-",
        图片节点: res.jpathDomError || "-",
        PDG页类型: res.pageTypeLabel || res.pageType || "-",
        PDG图片: res.jpgName || "-",
        框架诊断: res.frameDiagnostics ? JSON.stringify(res.frameDiagnostics) : "-",
        \u539f\u56e0: res.error || "-"
      });
      if (successMessage || !res.ok) setTopStatus(res.ok ? successMessage : (res.error || text("\u56fe\u4e66\u64cd\u4f5c\u5931\u8d25")));
      return res;
    });
  }

  function sendBookTargetCommand(command, interval, message, mode) {
    mode = normalizeBookMode(mode);
    return getCurrentSiteAccess().then(function (site) {
      return ensureBookAccess(site);
    }).then(function (site) {
      if (!site || !site.ok) {
        updateBookPanel({ ok: false, running: bookPanelState.running, interval: interval || bookPanelState.interval, mode: mode, error: site && site.error || "\u5f53\u524d\u9875\u9762\u4e0d\u652f\u6301\u56fe\u4e66\u63a7\u5236\u3002" });
        return site || { ok: false };
      }
      addDetailedLog("\u56fe\u4e66", "\u56fe\u4e66\u9875\u9762\u6388\u6743\u5b8c\u6210", { \u7f51\u7ad9: site.originPattern, \u6846\u67b6\u6765\u6e90: String((site.bookFrameOrigins || []).length), MAIN预注入: site.preloadRegistered ? "已启用" : "运行时注入" });
      return sendBookCommand(command, interval, message, site, mode);
    });
  }

  function bindBook() {
    document.querySelectorAll("[data-book-view]").forEach(function (button) {
      button.addEventListener("click", function () {
        var view = normalizeBookMode(button.dataset.bookView);
        selectBookView(view);
        if (view === "chaoxing") {
          sendMessage({ action: "bookPanel", command: "GET_STATE", mode: "chaoxing" }).then(function (res) { updateBookPanel(res || {}); });
        }
      });
    });
    function bindMode(mode, ids) {
      $(ids.detect).addEventListener("click", function () { sendBookTargetCommand("DETECT", null, "", mode); });
      $(ids.prev).addEventListener("click", function () { sendBookTargetCommand("PREV", null, "", mode); });
      $(ids.next).addEventListener("click", function () { sendBookTargetCommand("NEXT", null, "", mode); });
      $(ids.start).addEventListener("click", function () {
        var interval = normalizeAutoInterval($(ids.interval).value, mode);
        $(ids.interval).value = String(interval);
        sendBookTargetCommand("START", interval, bookModeLabel(mode) + "已启动。", mode);
      });
      $(ids.stop).addEventListener("click", function () { sendBookCommand("STOP", null, "\u81ea\u52a8\u7ffb\u9605\u5df2\u505c\u6b62\u3002", null, mode); });
      $(ids.interval).addEventListener("change", function () {
        var interval = normalizeAutoInterval($(ids.interval).value, mode);
        $(ids.interval).value = String(interval);
        sendBookCommand("SET_INTERVAL", interval, "\u7ffb\u9605\u95f4\u9694\u5df2\u4fdd\u5b58\u3002", null, mode);
      });
    }
    bindMode("book", { detect: "bookDetectBtn", prev: "bookPrevBtn", next: "bookNextBtn", start: "bookStartBtn", stop: "bookStopBtn", interval: "bookIntervalInput" });
    bindMode("image", { detect: "bookImageDetectBtn", prev: "bookImagePrevBtn", next: "bookImageNextBtn", start: "bookImageStartBtn", stop: "bookImageStopBtn", interval: "bookImageIntervalInput" });
    bindMode("chaoxing", { detect: "bookChaoxingDetectBtn", prev: "bookChaoxingPrevBtn", next: "bookChaoxingNextBtn", start: "bookChaoxingStartBtn", stop: "bookChaoxingStopBtn", interval: "bookChaoxingIntervalInput" });
    chrome.storage.onChanged.addListener(function (changes, areaName) {
      if (areaName !== "local" || !changes.bookPanelState || !changes.bookPanelState.newValue) return;
      var state = changes.bookPanelState.newValue;
      if (normalizeBookMode(state.mode) !== "chaoxing") return;
      updateBookPanel(Object.assign({ ok: true, mode: "chaoxing" }, state, {
        backCoverCheckEnabled: !!(state.running && state.mode === "chaoxing"),
        backCoverPageJumpLabel: String(state.backCoverPageJumpLabel || ""),
        backCoverReached: !!state.backCoverReached
      }));
    });
    if (bookBackCoverUiTimer) clearInterval(bookBackCoverUiTimer);
    bookBackCoverUiTimer = setInterval(renderBookBackCoverMonitor, 1000);
    renderBookBackCoverMonitor();
    selectBookView("book");
    sendBookCommand("GET_STATE", null, "", null, "book");
  }

  function showScriptWorkspaceUi(name, code, permissionConfirmed, confirmedPermissionSignature) {
    lastWorkspaceScript = {
      name: name || text("\u811a\u672c\u754c\u9762"),
      code: code || "",
      permissionConfirmed: permissionConfirmed === true,
      permissionSignature: String(confirmedPermissionSignature || "")
    };
    $("scriptRunnerTitle").textContent = lastWorkspaceScript.name;
    enterScriptWorkspace();
    document.body.classList.add("script-ui-active");
    savePopupState(Object.assign({ lastWorkspaceScript: lastWorkspaceScript }, isPinnedWindow ? { scriptWorkspaceActive: true } : {}));
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
    var mediaAccess = null;
    if (commandType !== "GET_STATUS") videoDurationRetryCount = 0;
    if (commandType !== "GET_STATUS") addDetailedLog("\u89c6\u9891", "\u53d1\u9001\u63a7\u5236\u547d\u4ee4", {
      \u547d\u4ee4: commandType,
      \u76ee\u6807\u500d\u901f: command.rate || "-",
      \u76ee\u6807\u97f3\u91cf: command.volume == null ? "-" : command.volume,
      \u8df3\u8f6c\u79d2\u6570: command.seconds == null ? "-" : command.seconds
    });
    if (commandType !== "GET_STATUS") setTopStatus(text("\u5904\u7406\u4e2d"));
    var access = commandType === "GET_STATUS"
      ? Promise.resolve({ ok: true })
      : getCurrentSiteAccess().then(ensureMediaAccess);
    return access.then(function (result) {
      mediaAccess = result || { ok: false, error: text("\u5f53\u524d\u9875\u9762\u672a\u6388\u6743") };
      if (!mediaAccess.ok) return mediaAccess;
      return sendMessage({ action: "controlActiveTab", command: command });
    }).then(function (res) {
      if (!res.ok && mediaAccess && mediaAccess.preloadRegistered) {
        res.error = (res.error || text("\u672a\u68c0\u6d4b\u5230\u53ef\u63a7\u5236\u7684\u5a92\u4f53")) + " " + text("\u5df2\u542f\u7528\u6df1\u5ea6\u5f3a\u63a7\uff0c\u8bf7\u5237\u65b0\u89c6\u9891\u9875\u540e\u91cd\u8bd5\u3002");
      }
      if (!res.ok && mediaAccess && mediaAccess.mediaAccessWarning) {
        res.error = (res.error || "") + " " + mediaAccess.mediaAccessWarning;
      }
      updateVideoStatus(res);
      if (commandType !== "GET_STATUS" || !res.ok) {
        addDetailedLog("\u89c6\u9891", res.ok ? "\u63a7\u5236\u6210\u529f" : "\u63a7\u5236\u5931\u8d25", {
          \u547d\u4ee4: commandType,
          \u8017\u65f6: (Date.now() - startedAt) + "ms",
          \u5a92\u4f53\u6570: res.mediaCount || 0,
          \u5df2\u5e94\u7528: res.applied || 0,
          iframe\u6570: res.frameCount || 0,
          \u5ef6\u8fdf\u6821\u9a8c: res.verifiedAfterMs ? res.verifiedAfterMs + "ms" : "-",
          \u5b9e\u9645\u500d\u901f: res.rate || "-",
          \u603b\u65f6\u957f: res.duration ? fmtTime(res.duration) : "\u672a\u8bfb\u53d6",
          \u65f6\u957f\u6765\u6e90: res.durationSource || "-",
          \u76ee\u6807\u500d\u901f: res.targetRate || command.rate || "-",
          \u500d\u901f\u7a33\u5b9a: res.rateStable === false ? "\u5426" : "\u662f",
          \u53cd\u68c0\u6d4b\u4f2a\u88c5: res.externalRateMasked ? "\u5df2\u542f\u7528" : "-",
          \u500d\u901f\u5f3a\u63a7: res.rateLocked ? "\u5df2\u542f\u7528" : "\u672a\u542f\u7528",
          \u8fde\u7eed\u64ad\u653e: res.continuousPlayback ? "\u5df2\u542f\u7528" : "\u672a\u542f\u7528",
          \u6df1\u5ea6\u9884\u52a0\u8f7d: mediaAccess && mediaAccess.preloadRegistered ? "\u5df2\u6ce8\u518c" : "-",
          \u7ad9\u70b9: mediaAccess && mediaAccess.originPattern || "-",
          \u63d0\u793a: mediaAccess && mediaAccess.mediaAccessWarning || "-",
          \u539f\u56e0: res.error || "-"
        });
      }
      if (commandType !== "GET_STATUS") setTopStatus(res.ok ? text("\u5b8c\u6210") : text("\u5931\u8d25"));
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
    lastVideoStatus = res && res.ok ? Object.assign({}, res) : null;
    if (!res || !res.ok) {
      if (videoDurationRetryTimer) clearTimeout(videoDurationRetryTimer);
      videoDurationRetryTimer = null;
      videoDurationRetryCount = 0;
      ["rate", "paused", "volume", "mediaCount", "duration", "applied", "continuous", "rateLocked"].forEach(function (name) {
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
    setStatus("duration", fmtTime(res.duration));
    setStatus("applied", res.applied || 0);
    setStatus("continuous", res.continuousPlayback ? text("\u5df2\u5f00\u542f") : text("\u5df2\u5173\u95ed"));
    setStatus("rateLocked", res.rateLocked ? text("\u5df2\u5f00\u542f") : text("\u5df2\u5173\u95ed"));
    if ($("enableAutoplayBtn")) $("enableAutoplayBtn").disabled = res.continuousPlayback === true;
    if ($("disableAutoplayBtn")) $("disableAutoplayBtn").disabled = res.continuousPlayback !== true;
    $("rateInput").value = rate.toFixed(2);
    $("volumeInput").value = volumePercent;
    if (videoDurationRetryTimer) clearTimeout(videoDurationRetryTimer);
    videoDurationRetryTimer = null;
    if (Number(res.mediaCount || 0) > 0 && Number(res.duration || 0) <= 0 && videoDurationRetryCount < 4) {
      var retryDelays = [350, 800, 1600, 3000];
      var retryDelay = retryDelays[videoDurationRetryCount] || 3000;
      videoDurationRetryCount += 1;
      videoDurationRetryTimer = setTimeout(function () {
        videoDurationRetryTimer = null;
        var videoPanel = $("videoPanel");
        if (videoPanel && videoPanel.classList.contains("active")) control({ type: "GET_STATUS" });
      }, retryDelay);
    } else if (Number(res.duration || 0) > 0) {
      videoDurationRetryCount = 0;
    }
    var playerHint = res.specialPlayerDetected
      ? (res.reason || text("\u68c0\u6d4b\u5230\u7279\u6b8a\u64ad\u653e\u5668"))
      : (res.playerType ? text("\u5f53\u524d\u64ad\u653e\u5668：") + res.playerType : "");
    $("videoStatusHint").textContent = [
      res.rateLocked ? text("\u500d\u901f\u5f3a\u63a7\u5df2\u542f\u7528") : "",
      res.continuousPlayback ? text("\u8fde\u7eed\u64ad\u653e\u5df2\u542f\u7528") : "",
      playerHint,
      Number(res.mediaCount || 0) > 0 && Number(res.duration || 0) <= 0 ? text("\u6b63\u5728\u8bfb\u53d6\u89c6\u9891\u603b\u65f6\u957f") : ""
    ].filter(Boolean).join(" · ");
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
          scheduleAiProviderWorkspaceSave();
        } else {
          if (/^(queued|loading|recognizing)/.test(res.ocrStatus || "")) {
            var progress = Math.round(Number(res.ocrProgress || 0) * 100);
            $("ocrStatus").textContent = text("OCR \u540e\u53f0\u8bc6\u522b\u4e2d...") + (progress ? " " + progress + "%" : "");
          } else if (res.ocrStatus === "failed") {
            $("ocrStatus").textContent = text("OCR \u540e\u53f0\u8bc6\u522b\u5931\u8d25\uff1a") + (res.ocrError || text("\u672a\u77e5\u9519\u8bef"));
          } else if (res.ocrStatus === "empty") {
            $("ocrStatus").textContent = text("OCR \u8bc6\u522b\u5b8c\u6210\uff0c\u4f46\u672a\u8bc6\u522b\u5230\u6587\u5b57\u3002");
          } else {
            requestBackgroundOcrRetry();
          }
        }
      } else if (!res.ok) {
        addDetailedLog("\u622a\u56fe", "\u8bfb\u53d6\u5931\u8d25", { \u539f\u56e0: res.error || "\u672a\u77e5\u9519\u8bef" });
      }
      return res;
    });
  }

  function requestBackgroundOcrRetry() {
    if (!lastCaptureDataUrl || !lastCaptureTime) return Promise.resolve({ ok: false, error: "没有可识别的截图。" });
    $("ocrStatus").textContent = text("\u6b63\u5728\u542f\u52a8\u540e\u53f0 OCR...");
    return sendMessage({ action: "retryManualOcr" }).then(function (result) {
      if (!result || !result.ok) {
        $("ocrStatus").textContent = text("OCR \u91cd\u8bd5\u5931\u8d25\uff1a") + (result && result.error || text("\u672a\u77e5\u9519\u8bef"));
        return result;
      }
      $("ocrStatus").textContent = result.pending
        ? text("OCR \u540e\u53f0\u8bc6\u522b\u4ecd\u5728\u8fdb\u884c\u4e2d...")
        : text("OCR \u540e\u53f0\u8bc6\u522b\u5df2\u91cd\u65b0\u542f\u52a8\u3002");
      return result;
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
      if (latestPageText && !$("aiQuestion").value.trim()) {
        $("aiQuestion").value = text("\u8bf7\u603b\u7ed3\u5f53\u524d\u9875\u9762\u5185\u5bb9");
        scheduleAiProviderWorkspaceSave();
      }
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
    getProviderId: function () { return activeAiProviderId; },
    updateProviderWorkspace: updateAiProviderWorkspace,
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
        requiresApiKey: typeof source.requiresApiKey === "boolean" ? source.requiresApiKey : fallback.requiresApiKey,
        configured: typeof source.configured === "boolean"
          ? source.configured
          : ((typeof source.requiresApiKey === "boolean" ? source.requiresApiKey : fallback.requiresApiKey) ? source.hasApiKey === true : true)
      };
    });
  }

  function emptyAiWorkspace() {
    return { mode: "summary", question: "", answer: "" };
  }

  function normalizeAiWorkspace(value) {
    value = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    var mode = ["summary", "explain", "points", "translate", "custom"].indexOf(value.mode) >= 0 ? value.mode : "summary";
    return {
      mode: mode,
      question: String(value.question || "").slice(0, 50000),
      answer: String(value.answer || "").slice(0, 2 * 1024 * 1024)
    };
  }

  function captureActiveAiWorkspace() {
    if (!$("aiMode") || !$("aiQuestion") || !$("aiAnswer")) return;
    aiProviderWorkspaces[activeAiProviderId] = normalizeAiWorkspace({
      mode: $("aiMode").value,
      question: $("aiQuestion").value,
      answer: $("aiAnswer").value
    });
  }

  function applyActiveAiWorkspace() {
    var workspace = normalizeAiWorkspace(aiProviderWorkspaces[activeAiProviderId] || emptyAiWorkspace());
    aiProviderWorkspaces[activeAiProviderId] = workspace;
    $("aiMode").value = workspace.mode;
    $("aiQuestion").value = workspace.question;
    $("aiAnswer").value = workspace.answer;
  }

  function flushAiProviderWorkspaces() {
    if (aiWorkspaceSaveTimer) {
      clearTimeout(aiWorkspaceSaveTimer);
      aiWorkspaceSaveTimer = null;
    }
    captureActiveAiWorkspace();
    storageSet({
      aiSelectedProvider: activeAiProviderId,
      aiProviderWorkspaces: aiProviderWorkspaces
    });
  }

  function scheduleAiProviderWorkspaceSave() {
    captureActiveAiWorkspace();
    if (aiWorkspaceSaveTimer) clearTimeout(aiWorkspaceSaveTimer);
    aiWorkspaceSaveTimer = setTimeout(flushAiProviderWorkspaces, 160);
  }

  function updateAiProviderWorkspace(providerId, patch) {
    providerId = normalizeProviderId(providerId);
    var workspace = normalizeAiWorkspace(aiProviderWorkspaces[providerId] || emptyAiWorkspace());
    patch = patch || {};
    if (Object.prototype.hasOwnProperty.call(patch, "mode")) workspace.mode = normalizeAiWorkspace({ mode: patch.mode }).mode;
    if (Object.prototype.hasOwnProperty.call(patch, "question")) workspace.question = String(patch.question || "").slice(0, 50000);
    if (Object.prototype.hasOwnProperty.call(patch, "answer")) workspace.answer = String(patch.answer || "").slice(0, 2 * 1024 * 1024);
    aiProviderWorkspaces[providerId] = workspace;
    if (providerId === activeAiProviderId) applyActiveAiWorkspace();
    scheduleAiProviderWorkspaceSave();
  }

  function updateAiProviderTabSelection() {
    document.querySelectorAll("[data-ai-provider]").forEach(function (button) {
      var active = button.dataset.aiProvider === activeAiProviderId;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.tabIndex = active ? 0 : -1;
    });
  }

  function selectAiProvider(providerId, remember) {
    providerId = normalizeProviderId(providerId);
    if (providerId !== activeAiProviderId) {
      captureActiveAiWorkspace();
      activeAiProviderId = providerId;
      applyActiveAiWorkspace();
    }
    updateAiProviderTabSelection();
    aiController.renderHistory();
    if (remember !== false) scheduleAiProviderWorkspaceSave();
  }

  function showAiUnconfiguredDialog(providerId) {
    var option = findProviderOption(providerId);
    var dialog = $("aiUnconfiguredDialog");
    dialog.dataset.providerId = option.id;
    $("aiUnconfiguredTitle").textContent = option.label + " 尚未配置";
    $("aiUnconfiguredMessage").textContent = "该AI功能尚未配置，请先前往设置配置";
    dialog.classList.remove("hidden");
    $("goToAiSettingsBtn").focus();
  }

  function closeAiUnconfiguredDialog() {
    $("aiUnconfiguredDialog").classList.add("hidden");
  }

  function renderAiProviderTabs() {
    var wrap = $("aiProviderTabs");
    var shortLabels = { deepseek: "DS", openai: "OAI", claude: "CLD", local: "LM" };
    if (!wrap) return;
    wrap.textContent = "";
    aiProviderOptions.forEach(function (option) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "btn view-tab ai-provider-tab";
      button.dataset.aiProvider = option.id;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-label", option.label);
      button.textContent = shortLabels[option.id] || option.label;
      button.title = option.configured ? option.label + " · " + option.model : option.label + " 尚未配置，请先到设置页面保存配置";
      button.addEventListener("click", function () {
        if (!option.configured) {
          showAiUnconfiguredDialog(option.id);
          return;
        }
        selectAiProvider(option.id, true);
      });
      wrap.appendChild(button);
    });
    updateAiProviderTabSelection();
  }

  function loadAiProviderWorkspaces(defaultProviderId) {
    storageGet(["aiSelectedProvider", "aiProviderWorkspaces"], function (data) {
      aiProviderWorkspaces = Object.create(null);
      var stored = data.aiProviderWorkspaces;
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        AI_PROVIDER_FALLBACKS.forEach(function (option) {
          if (stored[option.id]) aiProviderWorkspaces[option.id] = normalizeAiWorkspace(stored[option.id]);
        });
      }
      var selected = AI_PROVIDER_FALLBACKS.some(function (item) { return item.id === data.aiSelectedProvider; })
        ? data.aiSelectedProvider
        : normalizeProviderId(defaultProviderId);
      activeAiProviderId = selected;
      if (!aiProviderWorkspaces[selected]) captureActiveAiWorkspace();
      renderAiProviderTabs();
      applyActiveAiWorkspace();
      loadAiHistory();
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
      requiresApiKey: fallback.requiresApiKey,
      configured: !fallback.requiresApiKey
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
        aiProviderOptions = normalizeProviderOptions([]);
        loadAiProviderWorkspaces("deepseek");
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
      loadAiProviderWorkspaces(res.aiProvider);
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
    storageSet({ navRevealDelayMs: navRevealDelayMs, navHideDelayMs: navHideDelayMs, navTransitionMs: navTransitionMs, navRevealZones: navZones, captureSelectionTone: captureSelectionTone, captureSelectionWidth: captureSelectionWidth }, function (result) {
      if ($("navDelayInput")) $("navDelayInput").value = (navRevealDelayMs / 1000).toFixed(1);
      if ($("navHideDelayInput")) $("navHideDelayInput").value = (navHideDelayMs / 1000).toFixed(1);
      if ($("navTransitionInput")) $("navTransitionInput").value = (navTransitionMs / 1000).toFixed(2);
      applyNavTransition();
      writeNavZonesToInputs();
      renderCaptureTone();
      if ($("uiSettingsStatus")) $("uiSettingsStatus").textContent = result && result.ok === false ? text("界面设置保存失败。") : text("\u754c\u9762\u8bbe\u7f6e\u5df2\u4fdd\u5b58\u3002");
      addDetailedLog("界面", result && result.ok === false ? "保存界面设置失败" : "保存界面设置成功", {
        显示延迟: navRevealDelayMs + "ms",
        隐藏延迟: navHideDelayMs + "ms",
        过渡时间: navTransitionMs + "ms",
        原因: result && result.error || "-"
      }, result && result.ok === false ? "error" : "success");
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
        addDetailedLog("AI", "保存 AI 设置失败", {
          阶段: "服务地址授权",
          原因: permissionResult.error || "未授权 AI 服务地址"
        }, "error");
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
        option.configured = !option.requiresApiKey || option.hasApiKey;
        showProvider(providerId, option, clearKey ? text("API Key 已清除。") : text("设置已保存。"));
        renderAiProviderTabs();
        selectAiProvider(providerId, true);
        return res;
      });
    });
  }

  function renderDeclarationSections(containerId, sections) {
    var container = $(containerId);
    if (!container) return;
    container.innerHTML = "";
    (Array.isArray(sections) ? sections : []).forEach(function (section) {
      var wrapper = document.createElement("div");
      wrapper.className = "declaration-section";
      var title = document.createElement("h3");
      title.textContent = String(section && section.title || "");
      wrapper.appendChild(title);
      var list = document.createElement("ul");
      (section && Array.isArray(section.items) ? section.items : []).forEach(function (item) {
        var entry = document.createElement("li");
        entry.textContent = String(item || "");
        list.appendChild(entry);
      });
      wrapper.appendChild(list);
      container.appendChild(wrapper);
    });
  }

  function showDeclarationGate(visible) {
    var gate = $("declarationGate");
    if (gate) gate.classList.toggle("hidden", !visible);
  }

  function declarationAcceptedLabel(response) {
    var acceptance = response && response.acceptance;
    if (!response || !response.accepted || !acceptance) return "尚未确认当前版本声明。";
    var acceptedAt = acceptance.acceptedAt ? new Date(acceptance.acceptedAt).toLocaleString() : "未知时间";
    return "已确认版本 " + response.version + "，时间：" + acceptedAt + "。";
  }

  function renderUsageDeclaration(response) {
    usageDeclaration = response;
    if ($("declarationTitle")) $("declarationTitle").textContent = response.title + "（" + response.version + "）";
    if ($("declarationSummary")) $("declarationSummary").textContent = response.summary;
    if ($("declarationGateTitle")) $("declarationGateTitle").textContent = response.title;
    if ($("declarationGateSummary")) $("declarationGateSummary").textContent = response.summary;
    renderDeclarationSections("declarationSections", response.sections);
    renderDeclarationSections("declarationGateSections", response.sections);
    if ($("declarationAcceptanceStatus")) $("declarationAcceptanceStatus").textContent = declarationAcceptedLabel(response);
    if ($("declarationPanelCheckbox")) $("declarationPanelCheckbox").checked = response.accepted === true;
    if ($("declarationGateCheckbox")) $("declarationGateCheckbox").checked = false;
    showDeclarationGate(response.accepted !== true);
  }

  function loadUsageDeclaration() {
    return sendMessage({ action: "getUsageDeclaration" }).then(function (response) {
      if (!response.ok) {
        $("declarationGateStatus").textContent = "声明读取失败：" + (response.error || "未知错误");
        $("declarationAcceptanceStatus").textContent = "声明读取失败：" + (response.error || "未知错误");
        $("reloadExtensionBtn").classList.toggle("hidden", response.code !== "BACKGROUND_RELOAD_REQUIRED");
        showDeclarationGate(true);
        return response;
      }
      $("reloadExtensionBtn").classList.add("hidden");
      renderUsageDeclaration(response);
      return response;
    });
  }

  function acceptUsageDeclaration(checkboxId, buttonId, statusId) {
    var checkbox = $(checkboxId);
    var button = $(buttonId);
    var status = $(statusId);
    if (!usageDeclaration || !usageDeclaration.version) {
      status.textContent = "声明尚未加载，请稍后再试。";
      return Promise.resolve({ ok: false });
    }
    if (!checkbox.checked) {
      status.textContent = "请先勾选已阅读并同意。";
      return Promise.resolve({ ok: false });
    }
    button.disabled = true;
    status.textContent = "正在记录确认信息...";
    return sendMessage({
      action: "acceptUsageDeclaration",
      payload: { version: usageDeclaration.version, accepted: true }
    }).then(function (response) {
      button.disabled = false;
      if (!response.ok) {
        status.textContent = "确认失败：" + (response.error || "未知错误");
        if (response.code === "DECLARATION_UPDATED") loadUsageDeclaration();
        return response;
      }
      status.textContent = "声明已确认。";
      return loadUsageDeclaration();
    });
  }

  function bindDeclaration() {
    $("acceptDeclarationGateBtn").addEventListener("click", function () {
      acceptUsageDeclaration("declarationGateCheckbox", "acceptDeclarationGateBtn", "declarationGateStatus");
    });
    $("acceptDeclarationPanelBtn").addEventListener("click", function () {
      acceptUsageDeclaration("declarationPanelCheckbox", "acceptDeclarationPanelBtn", "declarationAcceptanceStatus");
    });
    $("declineDeclarationBtn").addEventListener("click", function () { window.close(); });
    $("reloadExtensionBtn").addEventListener("click", function () {
      $("declarationGateStatus").textContent = "正在重新加载扩展，请稍后重新打开弹窗。";
      chrome.runtime.reload();
    });
  }

  function bindDonation() {
    var dialog = $("donationThanksDialog");
    var closeButton = $("closeDonationThanksBtn");
    var methodButtons = Array.from(document.querySelectorAll("[data-donation-method]"));
    var qrFigures = Array.from(document.querySelectorAll("[data-donation-qr]"));

    function selectMethod(method) {
      methodButtons.forEach(function (button) {
        var active = button.dataset.donationMethod === method;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
      });
      qrFigures.forEach(function (figure) {
        figure.classList.toggle("hidden", figure.dataset.donationQr !== method);
      });
    }

    function closeThanks() {
      if (dialog) dialog.classList.add("hidden");
    }

    methodButtons.forEach(function (button) {
      button.addEventListener("click", function () { selectMethod(button.dataset.donationMethod); });
    });
    $("donationCompleteBtn").addEventListener("click", function () {
      dialog.classList.remove("hidden");
      closeButton.focus();
    });
    closeButton.addEventListener("click", closeThanks);
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) closeThanks();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !dialog.classList.contains("hidden")) closeThanks();
    });
    selectMethod("wechat");
  }

  function bindAiUnconfiguredDialog() {
    var dialog = $("aiUnconfiguredDialog");
    $("closeAiUnconfiguredBtn").addEventListener("click", closeAiUnconfiguredDialog);
    $("goToAiSettingsBtn").addEventListener("click", function () {
      var providerId = normalizeProviderId(dialog.dataset.providerId);
      closeAiUnconfiguredDialog();
      showPanel("settingsPanel", true);
      showProvider(providerId);
    });
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) closeAiUnconfiguredDialog();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !dialog.classList.contains("hidden")) closeAiUnconfiguredDialog();
    });
  }

  function planLabel(plan) {
    if (plan === "pro") return "Pro";
    if (plan === "free") return "免费用户";
    return "游客模式";
  }

  function renderUserSession(response) {
    currentUserSession = response;
    var authenticated = !!response.authenticated;
    var user = response.user || {};
    $("accountGuestView").classList.toggle("hidden", authenticated);
    $("accountUserView").classList.toggle("hidden", !authenticated);
    $("headerAccountLabel").textContent = authenticated ? (user.displayName || user.username) + " · " + planLabel(user.plan) : "游客模式";
    if (!authenticated) {
      $("accountStatus").textContent = "当前为游客模式。注册或登录后可建立本地用户身份；功能数据仍保存在当前浏览器。";
      return;
    }
    $("accountNameValue").textContent = user.displayName || user.username || "-";
    $("accountPlanValue").textContent = planLabel(user.plan);
    var quotaSuffix = user.quota && user.quota.enforced === false ? "（未启用）" : "";
    $("accountOcrQuotaValue").textContent = String(user.quota && user.quota.dailyOCR != null ? user.quota.dailyOCR : "-") + quotaSuffix;
    $("accountAiQuotaValue").textContent = String(user.quota && user.quota.dailyAI != null ? user.quota.dailyAI : "-") + quotaSuffix;
    $("profileDisplayNameInput").value = user.displayName || user.username || "";
    $("accountStatus").textContent = "已登录本地账户 " + user.username + "。会话在浏览器关闭后失效。";
  }

  function loadUserSession() {
    return sendMessage({ action: "getUserSession" }).then(function (response) {
      if (!response.ok) {
        $("accountStatus").textContent = "账户状态读取失败：" + (response.error || "未知错误");
        return response;
      }
      renderUserSession(response);
      return response;
    });
  }

  function clearAccountPasswords() {
    ["loginPasswordInput", "registerPasswordInput", "registerPasswordConfirmInput", "currentPasswordInput", "newPasswordInput", "newPasswordConfirmInput", "deletePasswordInput"].forEach(function (id) {
      if ($(id)) $(id).value = "";
    });
  }

  function bindAccount() {
    $("loginUserBtn").addEventListener("click", function () {
      $("accountStatus").textContent = "正在登录...";
      sendMessage({ action: "loginUser", payload: {
        username: $("loginUsernameInput").value.trim(),
        password: $("loginPasswordInput").value
      } }).then(function (response) {
        clearAccountPasswords();
        if (!response.ok) {
          $("accountStatus").textContent = "登录失败：" + (response.error || "未知错误");
          return;
        }
        renderUserSession(response);
      });
    });
    $("registerUserBtn").addEventListener("click", function () {
      var password = $("registerPasswordInput").value;
      if (password !== $("registerPasswordConfirmInput").value) {
        $("accountStatus").textContent = "两次输入的密码不一致。";
        return;
      }
      $("accountStatus").textContent = "正在创建本地账户...";
      var registerPayload = {
        username: $("registerUsernameInput").value.trim(),
        password: password
      };
      var displayName = $("registerDisplayNameInput").value.trim();
      if (displayName) registerPayload.displayName = displayName;
      sendMessage({ action: "registerUser", payload: registerPayload }).then(function (response) {
        clearAccountPasswords();
        if (!response.ok) {
          $("accountStatus").textContent = "注册失败：" + (response.error || "未知错误");
          if (response.code === "DECLARATION_REQUIRED") showPanel("declarationPanel", true);
          return;
        }
        renderUserSession(response);
      });
    });
    $("logoutUserBtn").addEventListener("click", function () {
      sendMessage({ action: "logoutUser" }).then(function (response) {
        clearAccountPasswords();
        if (response.ok) renderUserSession(response);
        else $("accountStatus").textContent = "退出失败：" + (response.error || "未知错误");
      });
    });
    $("updateProfileBtn").addEventListener("click", function () {
      sendMessage({ action: "updateUserProfile", payload: { displayName: $("profileDisplayNameInput").value.trim() } }).then(function (response) {
        if (response.ok) renderUserSession(response);
        else $("accountStatus").textContent = "资料保存失败：" + (response.error || "未知错误");
      });
    });
    $("changePasswordBtn").addEventListener("click", function () {
      var nextPassword = $("newPasswordInput").value;
      if (nextPassword !== $("newPasswordConfirmInput").value) {
        $("accountStatus").textContent = "两次输入的新密码不一致。";
        return;
      }
      sendMessage({ action: "changeUserPassword", payload: {
        currentPassword: $("currentPasswordInput").value,
        newPassword: nextPassword
      } }).then(function (response) {
        clearAccountPasswords();
        if (response.ok) {
          renderUserSession(response);
          $("accountStatus").textContent = "密码已修改，会话已刷新。";
        } else $("accountStatus").textContent = "密码修改失败：" + (response.error || "未知错误");
      });
    });
    $("deleteUserBtn").addEventListener("click", function () {
      sendMessage({ action: "deleteUserAccount", payload: {
        password: $("deletePasswordInput").value,
        confirm: $("deleteConfirmInput").value.trim()
      } }).then(function (response) {
        clearAccountPasswords();
        $("deleteConfirmInput").value = "";
        if (response.ok) {
          renderUserSession(response);
          $("accountStatus").textContent = "本地账户已删除。其他功能数据未被删除。";
        } else $("accountStatus").textContent = "删除失败：" + (response.error || "未知错误");
      });
    });
    ["loginUsernameInput", "loginPasswordInput"].forEach(function (id) {
      $(id).addEventListener("keydown", function (event) { if (event.key === "Enter") $("loginUserBtn").click(); });
    });
  }

  function bindVideo() {
    chrome.runtime.onMessage.addListener(function (message, sender) {
      if (!sender || sender.id !== chrome.runtime.id || !message || message.source !== "user-script-bridge" || message.type !== "WSB_SHARED_VIDEO_STATUS") return;
      if (Object.keys(message).some(function (key) { return ["source", "type", "status"].indexOf(key) < 0; })) return;
      var status = message.status;
      if (!status || typeof status !== "object" || Array.isArray(status)) return;
      updateVideoStatus(status);
    });
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
    $("playVideoBtn").addEventListener("click", function () { control({ type: "PLAY" }); });
    $("pauseVideoBtn").addEventListener("click", function () { control({ type: "PAUSE" }); });
    $("enableAutoplayBtn").addEventListener("click", function () { control({ type: "ENABLE_AUTOPLAY" }); });
    $("disableAutoplayBtn").addEventListener("click", function () { control({ type: "DISABLE_AUTOPLAY" }); });
    $("muteBtn").addEventListener("click", function () { control({ type: "SET_MUTED", muted: true }); });
    $("unmuteBtn").addEventListener("click", function () { control({ type: "SET_MUTED", muted: false }); });
    $("toggleMuteBtn").addEventListener("click", function () { control({ type: "TOGGLE_MUTED" }); });
  }

  function formatVoiceDuration(durationMs) {
    var seconds = Math.max(0, Math.min(60, Math.floor(Number(durationMs || 0) / 1000)));
    return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
  }

  function renderVoiceState(state) {
    state = state || {};
    var status = String(state.status || "idle");
    var active = ["starting", "recording", "loading", "transcribing"].indexOf(status) >= 0;
    var progress = Math.max(0, Math.min(100, Math.round(Number(state.progress || 0) * 100)));
    var duration = Number(state.durationMs || 0);
    if (status === "recording" && state.startedAt) duration = Math.max(duration, Date.now() - Number(state.startedAt));

    $("startTabAudioBtn").disabled = active;
    $("stopTabAudioBtn").disabled = status !== "recording";
    $("cancelTabAudioBtn").disabled = status !== "starting" && status !== "recording";
    if (status === "starting" || status === "recording") $("voiceText").value = String(state.transcript || "");
    else if (typeof state.transcript === "string") $("voiceText").value = state.transcript;

    if (status === "starting") $("voiceStatus").textContent = "正在连接当前 Edge 网页的声音...";
    else if (status === "recording") $("voiceStatus").textContent = "正在录制 " + formatVoiceDuration(duration) + " / 01:00，请播放网页中的题目语音。";
    else if (status === "loading") $("voiceStatus").textContent = "正在加载本地 Whisper 模型" + (progress ? " " + progress + "%" : "") + "，首次使用会稍慢。";
    else if (status === "transcribing") $("voiceStatus").textContent = "正在本地识别网页语音" + (progress ? " " + progress + "%" : "") + "...";
    else if (status === "completed") $("voiceStatus").textContent = "识别完成，共 " + String($("voiceText").value.trim().length) + " 个字。";
    else if (status === "empty") $("voiceStatus").textContent = "识别完成，但没有识别到文字。请确认网页正在播放声音后重试。";
    else if (status === "failed") $("voiceStatus").textContent = "网页语音识别失败：" + (state.error || "未知错误");
    else if (status === "cancelled") $("voiceStatus").textContent = "已取消网页语音获取。";
    else $("voiceStatus").textContent = "点击开始后播放网页声音，最长录制 60 秒。";

    if (voiceUiTimer) clearInterval(voiceUiTimer);
    voiceUiTimer = null;
    if (status === "recording") {
      voiceUiTimer = setInterval(function () { loadVoiceState(); }, 1000);
    }
  }

  function loadVoiceState() {
    return sendMessage({ action: "getTabAudioCaptureState" }).then(function (response) {
      if (!response || response.ok === false) {
        renderVoiceState({ status: "failed", error: response && response.error || "扩展后台无响应" });
        return response;
      }
      if (response.needsToolbarPopup) selectOcrView("voice");
      renderVoiceState(response);
      return response;
    });
  }

  function startTabAudioCapture() {
    selectOcrView("voice");
    renderVoiceState({ status: "starting", transcript: "" });
    return sendMessage({ action: "startTabAudioCapture" }).then(function (response) {
      if (!response || response.ok === false) {
        renderVoiceState({ status: "failed", error: response && response.error || "无法获取当前网页声音", needsToolbarPopup: response && response.needsToolbarPopup });
        return response;
      }
      return loadVoiceState();
    });
  }

  function stopTabAudioCapture() {
    $("stopTabAudioBtn").disabled = true;
    $("voiceStatus").textContent = "正在停止录音并准备本地识别...";
    return sendMessage({ action: "stopTabAudioCapture" }).then(function (response) {
      if (!response || response.ok === false) {
        renderVoiceState({ status: "failed", error: response && response.error || "停止录音失败" });
        return response;
      }
      return loadVoiceState();
    });
  }

  function cancelTabAudioCapture() {
    return sendMessage({ action: "cancelTabAudioCapture" }).then(function (response) {
      renderVoiceState(response && response.ok !== false ? response : { status: "failed", error: response && response.error || "取消失败" });
      return response;
    });
  }

  function bindOcr() {
    document.querySelectorAll("[data-ocr-view]").forEach(function (button) {
      button.addEventListener("click", function () { selectOcrView(button.dataset.ocrView); });
    });
    selectOcrView("capture");
    $("regionCaptureBtn").addEventListener("click", startRegionCaptureFromPopup);
    $("retryOcrBtn").addEventListener("click", requestBackgroundOcrRetry);
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
      if (changes.voiceJobStatus || changes.voiceJobProgress || changes.voiceJobError || changes.voiceTranscript || changes.voiceDurationMs) {
        loadVoiceState();
      }
    });
    $("startTabAudioBtn").addEventListener("click", startTabAudioCapture);
    $("stopTabAudioBtn").addEventListener("click", stopTabAudioCapture);
    $("cancelTabAudioBtn").addEventListener("click", cancelTabAudioCapture);
    $("copyVoiceBtn").addEventListener("click", function () {
      navigator.clipboard.writeText($("voiceText").value || "").then(function () {
        $("voiceStatus").textContent = "网页语音文字已复制。";
      }).catch(function (error) {
        $("voiceStatus").textContent = "复制失败：" + (error.message || String(error));
      });
    });
    $("sendVoiceToAiBtn").addEventListener("click", function () {
      var transcript = $("voiceText").value.trim();
      if (!transcript) {
        $("voiceStatus").textContent = "请先获取网页语音文字。";
        return;
      }
      showPanel("aiPanel", true);
      askAi(transcript);
    });
    $("copyOcrBtn").addEventListener("click", function () {
      navigator.clipboard.writeText($("ocrText").value || "").then(function () {
        $("ocrStatus").textContent = text("OCR \u7ed3\u679c\u5df2\u590d\u5236\u3002");
      }).catch(function (error) {
        $("ocrStatus").textContent = text("OCR \u7ed3\u679c\u590d\u5236\u5931\u8d25\uff1a") + (error.message || String(error));
      });
    });
    $("sendOcrToAiBtn").addEventListener("click", function () {
      showPanel("aiPanel", true);
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
    ["aiMode", "aiQuestion", "aiAnswer"].forEach(function (id) {
      $(id).addEventListener(id === "aiMode" ? "change" : "input", scheduleAiProviderWorkspaceSave);
    });
    window.addEventListener("pagehide", flushAiProviderWorkspaces);
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
      storageSet({ autoSendOcrToAi: autoSendOcrToAi }, function (result) {
        $("autoOcrAiStatus").textContent = autoSendOcrToAi
          ? text("\u5df2\u5f00\u542f\uff1aOCR \u7ed3\u679c\u4f1a\u81ea\u52a8\u53d1\u9001\u7ed9 AI\u3002")
          : text("\u5df2\u5173\u95ed\u81ea\u52a8\u53d1\u9001\u3002");
        addDetailedLog("AI", result && result.ok === false ? "更新 OCR 自动发送失败" : "更新 OCR 自动发送成功", {
          状态: autoSendOcrToAi ? "开启" : "关闭",
          原因: result && result.error || "-"
        }, result && result.ok === false ? "error" : "success");
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
    var logViewButtons = Array.from(document.querySelectorAll("[data-log-view]"));
    function selectLogView(view) {
      logViewButtons.forEach(function (button) {
        var active = button.dataset.logView === view;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
      });
      $("runtimeLogView").classList.toggle("hidden", view !== "runtime");
      $("updateLogView").classList.toggle("hidden", view !== "updates");
    }
    logViewButtons.forEach(function (button) {
      button.addEventListener("click", function () { selectLogView(button.dataset.logView); });
    });
    selectLogView("runtime");

    function setActionStatus(message) {
      $("logActionStatus").textContent = message;
    }

    function copyText(value) {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(value);
      return new Promise(function (resolve, reject) {
        var area = document.createElement("textarea");
        area.value = value;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        try {
          if (!document.execCommand("copy")) throw new Error("浏览器未允许复制");
          resolve();
        } catch (error) {
          reject(error);
        } finally {
          area.remove();
        }
      });
    }

    var logList = $("logList");
    var updateLogView = $("updateLogView");
    logList.addEventListener("wheel", function (event) {
      if (logList.scrollHeight <= logList.clientHeight) return;
      var scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? logList.clientHeight : 1;
      var previousTop = logList.scrollTop;
      logList.scrollTop += event.deltaY * scale;
      if (logList.scrollTop !== previousTop) event.preventDefault();
    }, { passive: false });
    logList.addEventListener("keydown", function (event) {
      var amount = 0;
      if (event.key === "ArrowDown") amount = 38;
      else if (event.key === "ArrowUp") amount = -38;
      else if (event.key === "PageDown") amount = logList.clientHeight * 0.85;
      else if (event.key === "PageUp") amount = -logList.clientHeight * 0.85;
      else if (event.key === "Home") logList.scrollTop = 0;
      else if (event.key === "End") logList.scrollTop = logList.scrollHeight;
      else return;
      if (amount) logList.scrollTop += amount;
      event.preventDefault();
    });
    updateLogView.addEventListener("wheel", function (event) {
      if (updateLogView.scrollHeight <= updateLogView.clientHeight) return;
      var scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? updateLogView.clientHeight : 1;
      var previousTop = updateLogView.scrollTop;
      updateLogView.scrollTop += event.deltaY * scale;
      if (updateLogView.scrollTop !== previousTop) event.preventDefault();
    }, { passive: false });
    updateLogView.addEventListener("keydown", function (event) {
      var amount = 0;
      if (event.key === "ArrowDown") amount = 38;
      else if (event.key === "ArrowUp") amount = -38;
      else if (event.key === "PageDown") amount = updateLogView.clientHeight * 0.85;
      else if (event.key === "PageUp") amount = -updateLogView.clientHeight * 0.85;
      else if (event.key === "Home") updateLogView.scrollTop = 0;
      else if (event.key === "End") updateLogView.scrollTop = updateLogView.scrollHeight;
      else return;
      if (amount) updateLogView.scrollTop += amount;
      event.preventDefault();
    });
    $("logSearchInput").addEventListener("input", function () { renderLogs(true); });
    $("logLevelFilter").addEventListener("change", function () { renderLogs(true); });
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, areaName) {
        if (areaName !== "local" || !changes.popupLogs || !logsLoaded) return;
        logs = logApi.normalizeList(changes.popupLogs.newValue, 500);
        renderLogs(false);
      });
    }
    $("refreshLogBtn").addEventListener("click", function () {
      setActionStatus("正在刷新日志...");
      loadLogs(true, function (items) { setActionStatus("已刷新，共 " + items.length + " 条日志"); });
    });
    $("copyLogBtn").addEventListener("click", function () {
      var visible = visibleLogs();
      if (!visible.length) {
        setActionStatus("当前没有可复制的日志");
        return;
      }
      copyText(visible.map(logApi.format).join("\n")).then(function () {
        setActionStatus("已复制 " + visible.length + " 条当前结果");
      }).catch(function (error) {
        setActionStatus("复制失败：" + (error.message || String(error)));
      });
    });
    $("exportLogBtn").addEventListener("click", function () {
      var visible = visibleLogs();
      if (!visible.length) {
        setActionStatus("当前没有可导出的日志");
        return;
      }
      var payload = {
        exportedAt: new Date().toISOString(),
        total: logs.length,
        exported: visible.length,
        filters: { query: $("logSearchInput").value, level: $("logLevelFilter").value },
        records: visible
      };
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = "winspeedball-logs-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 0);
      setActionStatus("已导出 " + visible.length + " 条当前结果");
    });
    $("clearLogBtn").addEventListener("click", function () {
      if (!logs.length) {
        setActionStatus("当前没有需要清空的日志");
        return;
      }
      if (!window.confirm("确定清空全部运行日志吗？清空后无法恢复。")) return;
      rawSendMessage({ action: "clearPopupLogs" }).then(function (response) {
        if (!response || response.ok === false) {
          setActionStatus("日志清空失败：" + (response && response.error || "未知错误"));
          return;
        }
        logs = [];
        pendingLogEntries = [];
        renderLogs();
        setActionStatus("全部日志已清空");
      });
    });
  }

  var privacyLabels = {
    screenshots: "截图",
    ocr: "OCR 记录",
    ai: "AI 历史",
    logs: "日志",
    scripts: "用户脚本",
    account: "账户数据",
    all: "全部隐私数据"
  };

  function renderPrivacySummary(response) {
    if (!response || !response.ok) {
      $("privacyStatus").textContent = "隐私数据读取失败：" + (response && response.error || "未知错误");
      return;
    }
    (response.categories || []).forEach(function (category) {
      var count = document.querySelector('[data-privacy-count="' + category.id + '"]');
      if (count) count.textContent = String(Number(category.count || 0));
    });
    $("privacyStatus").textContent = "数据仅保存在当前浏览器。删除后无法恢复。";
  }

  function loadPrivacySummary() {
    if (!$("privacyStatus")) return Promise.resolve();
    $("privacyStatus").textContent = "正在读取本地数据...";
    return sendMessage({ action: "getPrivacySummary" }).then(function (response) {
      renderPrivacySummary(response);
      return response;
    });
  }

  function refreshAfterPrivacyClear(category) {
    if (category === "screenshots" || category === "all") {
      lastCaptureDataUrl = "";
      var preview = $("capturePreview");
      preview.removeAttribute("src");
      preview.style.display = "none";
    }
    if (category === "ocr" || category === "all") {
      ocrRunId += 1;
      $("ocrText").value = "";
      $("ocrStatus").textContent = "OCR 记录已删除。";
    }
    if (category === "ai" || category === "all") {
      aiProviderWorkspaces = Object.create(null);
      aiController.clearHistory();
      $("aiQuestion").value = "";
      $("aiAnswer").value = "";
      aiProviderWorkspaces[activeAiProviderId] = emptyAiWorkspace();
      scheduleAiProviderWorkspaceSave();
    }
    if (category === "logs" || category === "all") {
      logs = [];
      logsLoaded = true;
      renderLogs();
    }
    if (category === "scripts" || category === "all") {
      loadScriptRows();
      developerController.loadDraft();
    }
    if (category === "account" || category === "all") {
      loadUserSession();
      loadUsageDeclaration();
    }
  }

  function clearPrivacyData(category) {
    var label = privacyLabels[category] || category;
    var warning = category === "account" || category === "all"
      ? "此操作会删除" + label + "，退出当前本地账户，并清除本机声明确认记录。删除后无法恢复，确定继续吗？"
      : "确定删除" + label + "吗？删除后无法恢复。";
    if (!window.confirm(warning)) return;
    $("privacyStatus").textContent = "正在删除" + label + "...";
    var stopSdkSession = (category === "scripts" || category === "all") && sdkSessionController.isActive()
      ? sdkSessionController.stop()
      : Promise.resolve();
    if (category === "scripts" || category === "all") {
      closeScriptWorkspaceChannel();
      pendingWorkspaceScript = null;
      scriptWorkspaceReady = false;
      lastWorkspaceScript = null;
      var scriptFrame = $("scriptFrame");
      if (scriptFrame) scriptFrame.src = chrome.runtime.getURL("workspace/index.html") + "?cleared=" + Date.now();
    }
    stopSdkSession.then(function () {
      return sendMessage({ action: "clearPrivacyData", payload: { category: category, confirmed: true } });
    }).then(function (response) {
      if (!response || !response.ok) {
        $("privacyStatus").textContent = "删除失败：" + (response && response.error || "未知错误");
        return;
      }
      refreshAfterPrivacyClear(category);
      renderPrivacySummary(response);
      $("privacyStatus").textContent = label + "已删除。";
    });
  }

  function bindPrivacyCenter() {
    document.querySelectorAll(".privacy-clear-btn").forEach(function (button) {
      button.addEventListener("click", function () { clearPrivacyData(button.dataset.privacyCategory); });
    });
    $("clearAllPrivacyBtn").addEventListener("click", function () { clearPrivacyData("all"); });
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
      return { ok: false, error: text("\u811a\u672c\u5fc5\u987b\u58f0\u660e @permission\uff0c\u53ef\u7528\u503c\uff1adom\u3001network\u3001automation\u3002") };
    }
    if (permissions.some(function (permission) { return ["dom", "network", "automation"].indexOf(permission) < 0; })) {
      return { ok: false, error: text("\u811a\u672c\u5305\u542b\u4e0d\u652f\u6301\u7684 @permission\uff0c\u5f53\u524d\u4ec5\u652f\u6301 dom\u3001network \u548c automation\u3002") };
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
      if (permission === "automation") return "- automation：允许脚本请求自动翻页和下一条操作";
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
      saveScriptRows(function (result) {
        if (result && result.ok === false) {
          resolve({ ok: false, error: text("\u811a\u672c\u6743\u9650\u4fdd\u5b58\u5931\u8d25\uff1a") + (result.error || text("\u672a\u77e5\u9519\u8bef")) });
          return;
        }
        resolve({ ok: true, meta: meta });
      });
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
      var currentScript = {
        id: String(input.dataset.scriptId || ""),
        name: input.dataset.scriptName || input.value || script.name || text("\u672a\u547d\u540d\u811a\u672c"),
        code: String(input.dataset.scriptCode || ""),
        meta: safeParseJson(input.dataset.scriptMeta || "{}", permissionResult.meta)
      };
      var currentValidation = validateScriptMeta(currentScript.meta);
      if (!currentScript.id || !currentScript.code.trim() || !currentValidation.ok) {
        return { ok: false, error: currentValidation.error || text("\u5f53\u524d\u811a\u672c\u5185\u5bb9\u65e0\u6548\uff0c\u8bf7\u91cd\u65b0\u5bfc\u5165\u3002") };
      }
      if (permissionSignature(currentScript.meta) !== permissionSignature(permissionResult.meta)) {
        return { ok: false, error: text("\u811a\u672c\u6743\u9650\u521a\u521a\u53d1\u751f\u53d8\u5316\uff0c\u8bf7\u91cd\u65b0\u786e\u8ba4\u3002") };
      }
      if (openWorkspace) showScriptWorkspaceUi(currentScript.name, currentScript.code, true, permissionSignature(currentScript.meta));
      var startedAt = Date.now();
      addDetailedLog("\u811a\u672c", "\u5f00\u59cb\u6267\u884c", {
        \u540d\u79f0: currentScript.name,
        \u5c5e\u6027: currentScript.meta.property || "-",
        \u6743\u9650: permissionSignature(currentScript.meta)
      });
      return sendMessage({
        action: "executeUserScript",
        scriptId: currentScript.id,
        code: currentScript.code,
        permissions: currentScript.meta.permissions,
        permissionConfirmed: true
      }).then(function (res) {
        if (res.ok) {
          input.dataset.lastRunAt = String(Date.now());
          updateScriptMeta(input);
          saveScriptRows();
        }
      addDetailedLog("\u811a\u672c", res.ok ? "\u6267\u884c\u6210\u529f" : "\u6267\u884c\u5931\u8d25", {
        \u540d\u79f0: currentScript.name,
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
    var detail = document.createElement("div");
    group.className = "script-feature-group";
    if (scripts.some(function (script) { return /@wsb-card\s+duration-next\b/i.test(String(script.code || "")); })) {
      group.classList.add("duration-next-card");
    }
    title.className = "script-feature-title";
    title.textContent = text("\u811a\u672c\u529f\u80fd");
    actions.className = "script-feature-actions";
    detail.className = "script-feature-detail";
    detail.hidden = true;

    function renderDetail(script, phase, result) {
      var meta = script.meta || parseUserScriptMeta(script.code);
      var isDurationNext = /@wsb-card\s+duration-next\b/i.test(String(script.code || ""));
      var videoStatus = lastVideoStatus || {};
      var values = isDurationNext ? [
        ["插件总时长", Number(videoStatus.duration || 0) > 0 ? fmtTime(videoStatus.duration) : "未获取"],
        ["当前时间", Number(videoStatus.currentTime || 0) > 0 ? fmtTime(videoStatus.currentTime) : "0:00"],
        ["读取方式", "WSB.video.status"],
        ["无总时长", "8 秒后下一节"]
      ] : [
        ["版本", meta.version || "-"],
        ["权限", permissionSignature(meta) || "-"],
        ["网站授权", (script.grantedOrigins || []).length + " 个"],
        ["执行时间", phase === "idle" ? "未运行" : phase === "running" ? "处理中" : new Date().toLocaleTimeString()]
      ];
      detail.textContent = "";
      detail.hidden = false;
      var head = document.createElement("div");
      var name = document.createElement("strong");
      var state = document.createElement("span");
      var grid = document.createElement("div");
      var message = document.createElement("div");
      head.className = "script-feature-detail-head";
      name.className = "script-feature-detail-name";
      state.className = "script-feature-detail-state " + (phase === "success" ? "success" : phase === "error" ? "error" : "");
      grid.className = "script-feature-detail-grid";
      message.className = "script-feature-detail-message";
      name.textContent = script.name || "未命名脚本";
      state.textContent = phase === "idle" ? "等待启动" : phase === "running" ? "正在启动" : phase === "success" ? "已启动" : "启动失败";
      message.textContent = isDurationNext
        ? (phase === "idle"
          ? "总时长由插件视频模块提供；脚本不会每秒扫描网页。"
          : phase === "running"
            ? "正在启动并读取一次插件视频状态。"
            : phase === "success"
              ? "自动下一节已启动。切换课程后会再次读取一次插件状态。"
              : (result && result.error || "脚本未能启动，请检查插件权限和当前页面。"))
        : (phase === "idle"
          ? "点击上方脚本按钮启动该功能。"
          : phase === "running"
            ? "正在检查权限并把脚本注入当前网页。"
            : phase === "success"
              ? "脚本已注入当前网页。"
              : (result && result.error || "脚本未能启动，请检查权限和当前页面。"));
      values.forEach(function (entry) {
        var item = document.createElement("div");
        var label = document.createElement("span");
        var value = document.createElement("span");
        item.className = "script-feature-detail-item";
        label.className = "script-feature-detail-label";
        value.className = "script-feature-detail-value";
        label.textContent = entry[0];
        value.textContent = entry[1];
        item.appendChild(label);
        item.appendChild(value);
        grid.appendChild(item);
      });
      head.appendChild(name);
      head.appendChild(state);
      detail.appendChild(head);
      detail.appendChild(grid);
      detail.appendChild(message);
    }

    scripts.forEach(function (script) {
      var button = document.createElement("button");
      var isDurationNext = /@wsb-card\s+duration-next\b/i.test(String(script.code || ""));
      button.type = "button";
      button.className = "script-feature-action";
      button.textContent = isDurationNext ? "启动自动下一节" : script.name;
      button.addEventListener("click", function () {
        actions.querySelectorAll(".script-feature-action").forEach(function (item) { item.classList.toggle("active", item === button); });
        renderDetail(script, "running", null);
        executeScriptFeature(script, false).then(function (result) {
          renderDetail(script, result && result.ok ? "success" : "error", result);
        }).catch(function (error) {
          renderDetail(script, "error", { error: error && error.message || String(error) });
        });
      });
      actions.appendChild(button);
    });
    group.appendChild(title);
    group.appendChild(actions);
    group.appendChild(detail);
    host.appendChild(group);
    if (scripts[0]) renderDetail(scripts[0], "idle", null);
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
    storageSet({ userScripts: scripts }, function (result) {
      if (result && result.ok === false) {
        $("scriptStatus").textContent = text("\u811a\u672c\u4fdd\u5b58\u5931\u8d25\uff1a") + (result.error || text("未知错误"));
      }
      addDetailedLog("脚本", result && result.ok === false ? "保存脚本配置失败" : "保存脚本配置成功", {
        脚本数量: scripts.length,
        已启用: scripts.filter(function (script) { return script && script.enabled !== false; }).length,
        原因: result && result.error || "-"
      }, result && result.ok === false ? "error" : "success");
      if (typeof callback === "function") callback(result || { ok: true });
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

  function validLegacyBridgeRequest(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    if (Object.keys(payload).some(function (key) { return ["action", "payload"].indexOf(key) < 0; })) return false;
    if (["START", "STOP", "NEXT", "SET_INTERVAL", "GET_STATE"].indexOf(payload.action) < 0) return false;
    var detail = payload.payload || {};
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) return false;
    var detailKeys = Object.keys(detail);
    if (["START", "SET_INTERVAL"].indexOf(payload.action) >= 0) {
      return detailKeys.every(function (key) { return key === "interval"; }) &&
        (detail.interval == null || (typeof detail.interval === "number" && Number.isFinite(detail.interval)));
    }
    return detailKeys.length === 0;
  }

  function openScriptWorkspaceChannel(workspaceFrame, script) {
    closeScriptWorkspaceChannel();
    var runId = createScriptWorkspaceRunId();
    var channel = new MessageChannel();
    var port = channel.port1;
    var parsedMeta = parseUserScriptMeta(script.code);
    var declaredSignature = permissionSignature(parsedMeta);
    scriptWorkspacePort = port;
    scriptWorkspaceRunId = runId;
    scriptWorkspaceAutomationAllowed = script.permissionConfirmed === true &&
      script.permissionSignature === declaredSignature &&
      parsedMeta.permissions.indexOf("automation") >= 0;
    port.onmessage = function (event) {
      if (scriptWorkspacePort !== port || scriptWorkspaceRunId !== runId) return;
      var data = event.data;
      if (!isScriptWorkspaceEnvelope(data, runId, ["READY", "RESULT", "POINTER_MOVE", "BRIDGE_REQUEST", "PROTOCOL_ERROR"])) return;
      if (data.type === "READY") {
        if (scriptWorkspaceReady || Object.keys(data.payload).length) return;
        scriptWorkspaceReady = true;
        postToScriptWorkspace("RUN_SCRIPT_UI", { name: script.name, code: script.code });
        return;
      }
      if (!scriptWorkspaceReady) return;
      if (data.type === "BRIDGE_REQUEST") {
        if (validLegacyBridgeRequest(data.payload)) handleDouyinPanelMessage(data.payload);
        return;
      }
      if (data.type === "POINTER_MOVE") {
        if (Object.keys(data.payload).some(function (key) { return ["clientX", "clientY"].indexOf(key) < 0; })) return;
        if (!Number.isFinite(data.payload.clientX) || !Number.isFinite(data.payload.clientY)) return;
        var rect = workspaceFrame.getBoundingClientRect();
        document.dispatchEvent(new MouseEvent("mousemove", {
          clientX: rect.left + data.payload.clientX,
          clientY: rect.top + data.payload.clientY
        }));
        return;
      }
      if (data.type === "PROTOCOL_ERROR") {
        $("scriptStatus").textContent = text("\u811a\u672c\u5de5\u4f5c\u533a\u534f\u8bae\u9519\u8bef\uff1a") + String(data.payload.error || text("\u672a\u77e5\u9519\u8bef"));
        return;
      }
      if (data.type === "RESULT" && data.payload.ok === false) {
        $("scriptStatus").textContent = text("\u811a\u672c\u754c\u9762\u8fd0\u884c\u5931\u8d25\uff1a") + (data.payload.error || text("\u672a\u77e5\u9519\u8bef"));
      }
    };
    port.onmessageerror = function () {
      if (scriptWorkspacePort === port) closeScriptWorkspaceChannel();
    };
    if (typeof port.start === "function") port.start();
    workspaceFrame.contentWindow.postMessage({
      channel: SCRIPT_WORKSPACE_CHANNEL,
      protocolVersion: SCRIPT_WORKSPACE_PROTOCOL_VERSION,
      runId: runId,
      type: "INIT",
      payload: {}
    }, "*", [channel.port2]);
  }

  function bindScripts() {
    loadUserScriptsStatus();
    var workspaceFrame = $("scriptFrame");
    workspaceFrame.addEventListener("load", function () {
      closeScriptWorkspaceChannel();
      if (!pendingWorkspaceScript) return;
      var script = pendingWorkspaceScript;
      pendingWorkspaceScript = null;
      openScriptWorkspaceChannel(workspaceFrame, script);
    });
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
    window.addEventListener("pagehide", closeScriptWorkspaceChannel);
    loadScriptRows();
  }

  bindComprehensiveActionLogging();
  bindPanels();
  windowModeController.bindPinButton($("pinWindowBtn"));
  bindScriptWorkspaceNav();
  bindVideo();
  bindOcr();
  bindAi();
  bindBook();
  bindAccount();
  bindDeclaration();
  bindAiUnconfiguredDialog();
  bindDonation();
  bindSettings();
  bindPrivacyCenter();
  developerController.bind();
  sdkSessionController.bind();
  bindScripts();
  bindLogs();
  loadLogs();
  restorePopupStateOnOpen();
  loadSettings();
  loadPrivacySummary();
  developerController.loadStatus();
  loadUsageDeclaration();
  loadUserSession();
  loadManualCapture();
  loadVoiceState();
  control({ type: "GET_STATUS" });
})();
