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

  function detectMode(search) {
    try {
      return new URLSearchParams(String(search || "")).get("pinned") === "1" ? MODE_PINNED : MODE_BROWSER;
    } catch (error) {
      return MODE_BROWSER;
    }
  }

  function normalizeState(value, mode) {
    value = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      lastPanelId: typeof value.lastPanelId === "string" && value.lastPanelId ? value.lastPanelId : "videoPanel",
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
      storage.get([stateKey, panelKey, "popupState", "lastWorkspaceScript"], function (data) {
        data = data || {};
        var state = data[stateKey] || data.popupState || {};
        state = normalizeState(state, mode);
        if (typeof data[panelKey] === "string" && data[panelKey]) state.lastPanelId = data[panelKey];
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
      isPinned: mode === MODE_PINNED,
      applyMode: applyMode,
      loadState: loadState,
      saveState: saveState,
      bindPinButton: bindPinButton
    });
  }

  global.WinSpeedBallPopupWindowMode = {
    create: create,
    detectMode: detectMode,
    normalizeState: normalizeState
  };
})(self);
