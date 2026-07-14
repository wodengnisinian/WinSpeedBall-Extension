(function () {
  "use strict";

  var root = document.getElementById("root");
  var nativeDocAdd = document.addEventListener.bind(document);
  var nativeWinAdd = window.addEventListener.bind(window);
  var nativeDocWrite = document.write.bind(document);
  var nativeDocWriteln = document.writeln.bind(document);
  var nativeWinDispatch = window.dispatchEvent.bind(window);
  var NativeMessageEvent = window.MessageEvent;
  var gmValueStore = {};
  var baselineHeadNodes = Array.prototype.slice.call(document.head.children);
  var lastPointerSentAt = 0;
  var workspacePort = null;
  var workspacePortPost = null;
  var workspaceRunId = "";
  var workspaceHasRun = false;
  var SCRIPT_WORKSPACE_CHANNEL = "WSB_LEGACY_WORKSPACE";
  var SCRIPT_WORKSPACE_PROTOCOL_VERSION = 1;

  function ensureRoot() {
    if (root && root.isConnected) return root;
    root = document.createElement("div");
    root.id = "root";
    document.body.insertBefore(root, document.body.firstChild || null);
    return root;
  }

  function clearWorkspace() {
    document.documentElement.removeAttribute("style");
    document.documentElement.className = "";
    document.body.removeAttribute("style");
    document.body.className = "";
    document.querySelectorAll("[data-wsb-runtime]").forEach(function (el) {
      el.remove();
    });
    Array.prototype.slice.call(document.body.children).forEach(function (el) {
      if (el !== root && el.tagName !== "SCRIPT") el.remove();
    });
    Array.prototype.slice.call(document.head.children).forEach(function (el) {
      if (baselineHeadNodes.indexOf(el) < 0) el.remove();
    });
    ensureRoot();
    root.innerHTML = "";
  }

  function makeBox(className, value) {
    ensureRoot();
    root.innerHTML = "";
    var box = document.createElement("div");
    box.className = className;
    box.textContent = value;
    root.appendChild(box);
    return box;
  }

  function showError(error) {
    makeBox("ws-error", "脚本界面运行失败：\n" + (error && error.stack ? error.stack : String(error || "未知错误")));
  }

  function hasVisibleUi() {
    ensureRoot();
    var rootHasVisibleUi = Array.prototype.slice.call(root.children).some(function (el) {
      var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
      return rect.width > 0 || rect.height > 0 || String(el.textContent || "").trim();
    });
    if (rootHasVisibleUi) return true;
    return Array.prototype.slice.call(document.body.children).some(function (el) {
      if (el === root || el.tagName === "SCRIPT") return false;
      var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
      return rect.width > 0 || rect.height > 0 || String(el.textContent || "").trim();
    });
  }

  function showNoUiHint(name) {
    if (hasVisibleUi()) return;
    makeBox(
      "ws-empty",
      (name || "当前脚本") + " 已运行，但没有创建可显示的界面。这个脚本可能只会操作网页本身，或需要点击下方菜单命令。"
    );
  }

  function gmAddStyle(css) {
    var style = document.createElement("style");
    style.setAttribute("data-wsb-runtime", "1");
    style.textContent = String(css || "");
    document.head.appendChild(style);
    return style;
  }

  function createMenuArea() {
    var area = document.createElement("div");
    area.className = "ws-menu";
    area.setAttribute("data-wsb-runtime", "1");
    root.appendChild(area);
    return area;
  }

  function createNotification(value) {
    var note = document.createElement("div");
    note.className = "ws-note";
    note.setAttribute("data-wsb-runtime", "1");
    note.textContent = value;
    document.body.appendChild(note);
    setTimeout(function () { note.remove(); }, 3000);
  }

  function patchReadyEvents() {
    document.addEventListener = function (type, listener, options) {
      nativeDocAdd(type, listener, options);
      if (/^(DOMContentLoaded|readystatechange)$/i.test(type) && typeof listener === "function") {
        setTimeout(function () {
          try { listener.call(document, new Event(type)); } catch (e) { showError(e); }
        }, 0);
      }
    };
    window.addEventListener = function (type, listener, options) {
      nativeWinAdd(type, listener, options);
      if (/^load$/i.test(type) && typeof listener === "function") {
        setTimeout(function () {
          try { listener.call(window, new Event(type)); } catch (e) { showError(e); }
        }, 0);
      }
    };
  }

  function patchDocumentWrite() {
    document.write = function (html) {
      root.insertAdjacentHTML("beforeend", String(html || ""));
    };
    document.writeln = function (html) {
      document.write(String(html || "") + "\n");
    };
  }

  function restorePatchedApis() {
    document.addEventListener = nativeDocAdd;
    window.addEventListener = nativeWinAdd;
    document.write = nativeDocWrite;
    document.writeln = nativeDocWriteln;
  }

  function installGmApis(payload, scriptWindowFacade) {
    var menuArea = null;
    var menuSeq = 0;
    var storagePrefix = "wsb:" + (payload.name || "script") + ":";

    window.unsafeWindow = scriptWindowFacade;
    window.GM_info = {
      script: {
        name: payload.name || "",
        version: payload.version || ""
      }
    };
    window.GM_addStyle = gmAddStyle;
    window.GM_getValue = function (key, fallback) {
      var storeKey = storagePrefix + key;
      return Object.prototype.hasOwnProperty.call(gmValueStore, storeKey) ? gmValueStore[storeKey] : fallback;
    };
    window.GM_setValue = function (key, value) {
      gmValueStore[storagePrefix + key] = value;
    };
    window.GM_deleteValue = function (key) {
      delete gmValueStore[storagePrefix + key];
    };
    window.GM_openInTab = function (url) {
      window.open(String(url || ""), "_blank");
    };
    window.GM_notification = function (detail) {
      createNotification(typeof detail === "string" ? detail : (detail && (detail.text || detail.title)) || "通知");
    };
    window.GM_registerMenuCommand = function (caption, command) {
      if (!menuArea) menuArea = createMenuArea();
      var id = "menu-" + (++menuSeq);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ws-menu-btn";
      btn.dataset.menuId = id;
      btn.textContent = String(caption || "脚本菜单");
      btn.addEventListener("click", function () {
        try { if (typeof command === "function") command(); } catch (e) { showError(e); }
      });
      menuArea.appendChild(btn);
      return id;
    };
    window.GM_unregisterMenuCommand = function (id) {
      var btn = document.querySelector('[data-menu-id="' + String(id).replace(/"/g, '\\"') + '"]');
      if (btn) btn.remove();
    };
    window.GM_xmlhttpRequest = function (detail) {
      detail = detail || {};
      fetch(detail.url, {
        method: detail.method || "GET",
        headers: detail.headers || {},
        body: detail.data
      }).then(function (resp) {
        return resp.text().then(function (text) {
          var result = { status: resp.status, statusText: resp.statusText, responseText: text, finalUrl: resp.url };
          if (typeof detail.onload === "function") detail.onload(result);
        });
      }).catch(function (error) {
        if (typeof detail.onerror === "function") detail.onerror(error);
      });
    };
    window.GM = {
      addStyle: gmAddStyle,
      getValue: function (key, fallback) { return Promise.resolve(window.GM_getValue(key, fallback)); },
      setValue: function (key, value) { window.GM_setValue(key, value); return Promise.resolve(); },
      deleteValue: function (key) { window.GM_deleteValue(key); return Promise.resolve(); },
      xmlHttpRequest: window.GM_xmlhttpRequest,
      notification: window.GM_notification,
      openInTab: window.GM_openInTab,
      registerMenuCommand: window.GM_registerMenuCommand
    };
  }

  function isWorkspaceEnvelope(data, allowedTypes) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    if (Object.keys(data).some(function (key) { return ["channel", "protocolVersion", "runId", "type", "payload"].indexOf(key) < 0; })) return false;
    return data.channel === SCRIPT_WORKSPACE_CHANNEL &&
      data.protocolVersion === SCRIPT_WORKSPACE_PROTOCOL_VERSION &&
      data.runId === workspaceRunId &&
      allowedTypes.indexOf(data.type) >= 0 &&
      data.payload && typeof data.payload === "object" && !Array.isArray(data.payload);
  }

  function sendWorkspaceMessage(type, payload) {
    if (!workspacePortPost || !workspaceRunId) return;
    workspacePortPost({
      channel: SCRIPT_WORKSPACE_CHANNEL,
      protocolVersion: SCRIPT_WORKSPACE_PROTOCOL_VERSION,
      runId: workspaceRunId,
      type: type,
      payload: payload || {}
    });
  }

  function forwardLegacyPostMessage(message) {
    if (!message || typeof message !== "object" || Array.isArray(message)) return;
    if (message.source !== "DouyinPanelScript") return;
    if (["START", "STOP", "NEXT", "SET_INTERVAL", "GET_STATE"].indexOf(message.action) < 0) return;
    var payload = message.payload || {};
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
    sendWorkspaceMessage("BRIDGE_REQUEST", { action: message.action, payload: payload });
  }

  function createScriptFacades() {
    var parentFacade = Object.freeze({ postMessage: forwardLegacyPostMessage });
    var scriptWindowFacade;
    scriptWindowFacade = new Proxy(Object.create(null), {
      get: function (_target, key) {
        if (key === "parent" || key === "top") return parentFacade;
        if (key === "window" || key === "self" || key === "globalThis") return scriptWindowFacade;
        var value = window[key];
        return typeof value === "function" ? value.bind(window) : value;
      },
      set: function (_target, key, value) {
        if (key === "parent" || key === "top") return false;
        window[key] = value;
        return true;
      },
      has: function (_target, key) {
        return key === "parent" || key === "top" || key in window;
      },
      deleteProperty: function (_target, key) {
        if (key === "parent" || key === "top") return false;
        return delete window[key];
      }
    });
    return { parent: parentFacade, window: scriptWindowFacade };
  }

  function dispatchLegacyBridgeState(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
    nativeWinDispatch(new NativeMessageEvent("message", {
      data: payload,
      origin: "null"
    }));
  }

  function runScript(payload) {
    restorePatchedApis();
    clearWorkspace();
    try {
      patchReadyEvents();
      patchDocumentWrite();
      var facades = createScriptFacades();
      installGmApis(payload, facades.window);
      new Function("window", "parent", "top", "self", "globalThis", String(payload.code || ""))(
        facades.window,
        facades.parent,
        facades.parent,
        facades.window,
        facades.window
      );
      setTimeout(function () { showNoUiHint(payload.name); }, 800);
      sendWorkspaceMessage("RESULT", { ok: true, name: payload.name || "" });
    } catch (error) {
      showError(error);
      sendWorkspaceMessage("RESULT", { ok: false, error: error.message || String(error) });
    }
  }

  nativeDocAdd("mousemove", function (event) {
    var now = Date.now();
    if (now - lastPointerSentAt < 30) return;
    lastPointerSentAt = now;
    sendWorkspaceMessage("POINTER_MOVE", {
      clientX: event.clientX,
      clientY: event.clientY
    });
  }, true);

  function handleWorkspacePortMessage(event) {
    var data = event.data;
    if (!isWorkspaceEnvelope(data, ["RUN_SCRIPT_UI", "BRIDGE_STATE", "TERMINATE"])) return;
    if (data.type === "RUN_SCRIPT_UI") {
      if (workspaceHasRun || Object.keys(data.payload).some(function (key) { return ["name", "code"].indexOf(key) < 0; })) return;
      if (typeof data.payload.name !== "string" || typeof data.payload.code !== "string" || data.payload.code.length > 200000) return;
      workspaceHasRun = true;
      runScript(data.payload);
      return;
    }
    if (!workspaceHasRun) return;
    if (data.type === "BRIDGE_STATE") {
      dispatchLegacyBridgeState(data.payload);
      return;
    }
    if (data.type === "TERMINATE") {
      try { workspacePort.close(); } catch (e) {}
      workspacePort = null;
      workspacePortPost = null;
      workspaceRunId = "";
    }
  }

  nativeWinAdd("message", function (event) {
    if (workspacePort || event.source !== window.parent) return;
    var data = event.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return;
    if (Object.keys(data).some(function (key) { return ["channel", "protocolVersion", "runId", "type", "payload"].indexOf(key) < 0; })) return;
    if (data.channel !== SCRIPT_WORKSPACE_CHANNEL || data.protocolVersion !== SCRIPT_WORKSPACE_PROTOCOL_VERSION || data.type !== "INIT") return;
    if (typeof data.runId !== "string" || !/^legacy_[A-Za-z0-9_-]{12,80}$/.test(data.runId)) return;
    if (!data.payload || Object.keys(data.payload).length || !event.ports || event.ports.length !== 1) return;
    workspacePort = event.ports[0];
    workspacePortPost = workspacePort.postMessage.bind(workspacePort);
    workspaceRunId = data.runId;
    workspaceHasRun = false;
    workspacePort.onmessage = handleWorkspacePortMessage;
    if (typeof workspacePort.start === "function") workspacePort.start();
    sendWorkspaceMessage("READY", {});
  });
})();
