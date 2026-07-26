(function (global) {
  "use strict";

  var MODE_BROWSER = "browser";
  var MODE_PINNED = "pinned";
  var STATE_KEYS = {
    browser: "popupStateBrowser",
    pinned: "popupStatePinned"
  };
  var PANEL_KEYS = {
    browser: "popupLastPanelBrowser",
    pinned: "popupLastPanelPinned"
  };
  var SHARED_PANEL_KEY = "popupLastPanel";
  var SHARED_VIEW_KEY = "popupLastView";

  function normalizePanelId(value) {
    var panelId = typeof value === "string" && value ? value : "videoPanel";
    if (panelId === "assistantPanel") return "ocrPanel";
    if (panelId === "aiTeachingPanel") return "aiPanel";
    return panelId;
  }

  function detectMode(search) {
    try {
      return new URLSearchParams(String(search || "")).get("pinned") === "1" ? MODE_PINNED : MODE_BROWSER;
    } catch (error) {
      return MODE_BROWSER;
    }
  }

  function normalizeScrollPositions(value) {
    value = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    var result = {};
    Object.keys(value).forEach(function (key) {
      if (!/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(key)) return;
      var position = Number(value[key]);
      if (!Number.isFinite(position)) return;
      result[key] = Math.max(0, Math.min(1000000, Math.round(position)));
    });
    return result;
  }

  function normalizeState(value, mode) {
    value = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    var legacyTeachingView = value.lastPanelId === "aiTeachingPanel";
    return {
      lastPanelId: normalizePanelId(value.lastPanelId),
      viewMode: value.viewMode === "aiTeaching" || legacyTeachingView ? "aiTeaching" : "main",
      questionView: value.questionView === "voice" ? "voice" : "capture",
      bookView: ["book", "image", "chaoxing"].indexOf(value.bookView) >= 0 ? value.bookView : "book",
      logView: value.logView === "updates" ? "updates" : "runtime",
      scrollPositions: normalizeScrollPositions(value.scrollPositions),
      chromeHidden: true,
      scriptWorkspaceActive: mode === MODE_PINNED && value.scriptWorkspaceActive === true,
      lastWorkspaceScript: value.lastWorkspaceScript && typeof value.lastWorkspaceScript === "object"
        ? value.lastWorkspaceScript
        : null
    };
  }

  function create(options) {
    options = options || {};
    var mode = detectMode(options.search);
    var stateKey = STATE_KEYS[mode];
    var panelKey = PANEL_KEYS[mode];
    var documentRef = options.document;
    var storage = options.storage;
    var openPinnedWindow = options.openPinnedWindow;
    var closeWindow = options.closeWindow;

    function applyMode() {
      if (!documentRef) return;
      documentRef.documentElement.dataset.windowMode = mode;
      documentRef.body.dataset.windowMode = mode;
      documentRef.body.classList.toggle("pinned-window", mode === MODE_PINNED);
      documentRef.title = mode === MODE_PINNED ? "学习助手 - 独立窗口" : "学习助手";
      var heading = documentRef.querySelector("h1");
      if (heading) heading.textContent = mode === MODE_PINNED ? "学习助手 · 独立" : "学习助手";
    }

    function loadState(callback) {
      storage.get([stateKey, panelKey, SHARED_PANEL_KEY, SHARED_VIEW_KEY, "popupState", "lastWorkspaceScript", "popupLastQuestionView"], function (data) {
        data = data || {};
        var rawState = data[stateKey] || data.popupState || {};
        var state = normalizeState(rawState, mode);
        var hasSharedView = data[SHARED_VIEW_KEY] && typeof data[SHARED_VIEW_KEY] === "object";
        if (hasSharedView) {
          var sharedView = normalizeState(data[SHARED_VIEW_KEY], mode);
          state.lastPanelId = sharedView.lastPanelId;
          state.viewMode = sharedView.viewMode;
          state.questionView = sharedView.questionView;
          state.bookView = sharedView.bookView;
          state.logView = sharedView.logView;
          state.scrollPositions = sharedView.scrollPositions;
        } else {
          var savedPanel = data[SHARED_PANEL_KEY] || data[panelKey];
          if (typeof savedPanel === "string" && savedPanel) state.lastPanelId = normalizePanelId(savedPanel);
        }
        if (!hasSharedView && !Object.prototype.hasOwnProperty.call(rawState, "questionView") && typeof data.popupLastQuestionView === "string") {
          state.questionView = data.popupLastQuestionView === "voice" ? "voice" : "capture";
        }
        if (!state.lastWorkspaceScript && data.lastWorkspaceScript && typeof data.lastWorkspaceScript === "object") {
          state.lastWorkspaceScript = data.lastWorkspaceScript;
        }
        callback(state, data);
      });
    }

    function saveState(value, extra, callback) {
      var state = normalizeState(value, mode);
      var payload = Object.assign({}, extra || {});
      payload[stateKey] = state;
      payload[panelKey] = state.lastPanelId;
      payload[SHARED_PANEL_KEY] = state.lastPanelId;
      payload[SHARED_VIEW_KEY] = {
        lastPanelId: state.lastPanelId,
        viewMode: state.viewMode,
        questionView: state.questionView,
        bookView: state.bookView,
        logView: state.logView,
        scrollPositions: state.scrollPositions
      };
      if (mode === MODE_PINNED) payload.popupState = state;
      storage.set(payload, callback);
    }

    function setButtonIdle(button) {
      var label = mode === MODE_PINNED ? "关闭独立窗口" : "打开独立窗口";
      button.disabled = false;
      button.classList.toggle("active", mode === MODE_PINNED);
      button.title = label;
      button.setAttribute("aria-label", label);
    }

    function bindPinButton(button) {
      if (!button) return;
      setButtonIdle(button);
      button.addEventListener("click", function () {
        if (mode === MODE_PINNED) {
          closeWindow();
          return;
        }
        button.disabled = true;
        button.title = "正在打开独立窗口...";
        button.setAttribute("aria-label", button.title);
        Promise.resolve().then(openPinnedWindow).then(function (response) {
          if (response && response.ok) {
            closeWindow();
            return;
          }
          setButtonIdle(button);
          button.title = "打开失败：" + String(response && response.error || "后台窗口服务不可用");
          button.setAttribute("aria-label", button.title);
        }).catch(function (error) {
          setButtonIdle(button);
          button.title = "打开失败：" + String(error && error.message || error || "未知错误");
          button.setAttribute("aria-label", button.title);
        });
      });
    }

    return Object.freeze({
      mode: mode,
      stateKey: stateKey,
      panelKey: panelKey,
      sharedPanelKey: SHARED_PANEL_KEY,
      sharedViewKey: SHARED_VIEW_KEY,
      isPinned: mode === MODE_PINNED,
      normalizePanelId: normalizePanelId,
      applyMode: applyMode,
      loadState: loadState,
      saveState: saveState,
      bindPinButton: bindPinButton
    });
  }

  global.WinSpeedBallPopupWindowMode = {
    create: create,
    detectMode: detectMode,
    normalizePanelId: normalizePanelId,
    normalizeState: normalizeState,
    normalizeScrollPositions: normalizeScrollPositions
  };
})(self);
