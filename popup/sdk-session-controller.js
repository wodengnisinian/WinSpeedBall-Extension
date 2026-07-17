(function (global) {
  "use strict";

  function create(options) {
    options = options || {};
    var byId = options.byId;
    var sendMessage = options.sendMessage;
    var draftStore = options.draftStore;
    var contracts = options.contracts;
    var protocol = options.protocol;
    var ensureSiteAccess = options.ensureSiteAccess;
    var confirmAction = options.confirmAction;
    var runtimeUrl = options.runtimeUrl;
    var iframe = null;
    var port = null;
    var session = null;
    var runId = "";
    var sandboxSessionId = "";
    var readyResolve = null;
    var readyReject = null;
    var readyTimer = null;

    function status(message) {
      byId("developerSessionStatus").textContent = message;
    }

    function randomId(prefix) {
      try { return prefix + crypto.randomUUID().replace(/-/g, ""); }
      catch (error) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2); }
    }

    function requiresSite(capabilities) {
      return capabilities.some(function (capability) {
        return capability === "video.read" || capability === "video.control" || capability === "page.read" || capability === "book.read" || capability === "ocr.read";
      });
    }

    function post(type, payload) {
      if (!port || !sandboxSessionId) throw new Error("SDK sandbox is not connected.");
      port.postMessage(protocol.createEnvelope(sandboxSessionId, type, payload));
    }

    function clearReady(error) {
      if (readyTimer) clearTimeout(readyTimer);
      readyTimer = null;
      if (error && readyReject) readyReject(error);
      readyResolve = null;
      readyReject = null;
    }

    function destroySandbox() {
      clearReady();
      if (port) {
        try { port.close(); } catch (error) {}
      }
      port = null;
      if (iframe) iframe.remove();
      iframe = null;
      runId = "";
      sandboxSessionId = "";
    }

    function resetSessionButtons() {
      byId("startDeveloperSessionBtn").disabled = !!session;
      byId("stopDeveloperSessionBtn").disabled = !session;
    }

    function revokeCreatedSession() {
      var current = session;
      session = null;
      destroySandbox();
      resetSessionButtons();
      if (!current || !current.sessionToken) return Promise.resolve();
      return sendMessage({ action: "closeSdkSession", payload: { sessionToken: current.sessionToken } }).catch(function () {});
    }

    function sendRpcResult(message, result) {
      var payload = {
        runId: message.runId,
        requestId: message.request.requestId,
        ok: !!(result && result.ok)
      };
      if (payload.ok) payload.value = result.value;
      else payload.error = { code: result && result.code || "SDK_RPC_FAILED", message: result && result.error || "SDK request failed." };
      try { post("RPC_RESULT", payload); }
      catch (error) { status("SDK 响应无法返回沙箱：" + (error.message || String(error))); }
    }

    function handlePortMessage(event) {
      var message = event.data;
      var validation = protocol.validateEnvelope(message, { sessionId: sandboxSessionId, allowedTypes: ["READY", "STARTED", "SDK_REQUEST", "RESULT", "ERROR", "TERMINATED"] });
      if (!validation.ok) { status("沙箱协议错误：" + validation.error); return; }
      if (message.type === "READY") {
        if (readyResolve) readyResolve();
        clearReady();
        return;
      }
      if (message.type === "STARTED") {
        status("SDK 脚本正在沙箱 Worker 中运行。会话到期时间：" + new Date(session.expiresAt).toLocaleTimeString());
        return;
      }
      if (message.type === "SDK_REQUEST") {
        sendMessage({ action: "invokeSdkSession", payload: { sessionToken: session.sessionToken, request: message.request } }).then(function (result) {
          sendRpcResult(message, result);
        });
        return;
      }
      if (message.type === "RESULT") {
        status("SDK 脚本执行完成，授权会话仍有效，可继续进行 API 测试。");
        runId = "";
        return;
      }
      if (message.type === "TERMINATED") {
        status("SDK 脚本已终止，授权会话仍有效。原因：" + (message.reason || "用户停止"));
        runId = "";
        return;
      }
      status("SDK 脚本运行失败：" + (message.error && (message.error.message || message.error.code) || "未知错误"));
      runId = "";
    }

    function connectSandbox() {
      destroySandbox();
      sandboxSessionId = randomId("session_");
      iframe = document.createElement("iframe");
      iframe.className = "hidden";
      iframe.setAttribute("aria-hidden", "true");
      iframe.src = runtimeUrl("sdk/script-runner.html");
      document.body.appendChild(iframe);
      return new Promise(function (resolve, reject) {
        readyResolve = resolve;
        readyReject = reject;
        readyTimer = setTimeout(function () {
          var error = new Error("SDK sandbox initialization timed out.");
          clearReady(error);
          destroySandbox();
        }, 5000);
        iframe.addEventListener("load", function () {
          var channel = new MessageChannel();
          port = channel.port1;
          port.onmessage = handlePortMessage;
          port.onmessageerror = function () { status("SDK 沙箱消息无法解析。"); };
          port.start();
          iframe.contentWindow.postMessage(protocol.createEnvelope(sandboxSessionId, "INIT", {}), "*", [channel.port2]);
        }, { once: true });
      });
    }

    function ensureDraftSaved() {
      var code = byId("developerScriptEditor").value || "";
      var validation = draftStore.analyze(code);
      if (!validation.ok) return Promise.reject(Object.assign(new Error(validation.error), { code: validation.code }));
      return draftStore.saveDraft(byId("developerDraftSelect").value, code);
    }

    function start() {
      if (session) return Promise.resolve({ ok: false, code: "SDK_SESSION_ACTIVE", error: "请先停止当前 SDK 会话。" });
      status("正在校验 SDK 草稿...");
      return ensureDraftSaved().then(function (draft) {
        status("正在锁定 SDK 运行页面...");
        return sendMessage({ action: "prepareSdkContext", payload: { capabilities: draft.capabilities } }).then(function (context) {
          if (!context || !context.ok) throw Object.assign(new Error(context && context.error || "无法锁定 SDK 运行页面。"), { code: context && context.code || "SDK_CONTEXT_UNAVAILABLE" });
          var targetLabel = context.tabId == null ? "本地开发者上下文" : context.origin;
          if (!confirmAction("脚本请求以下能力：\n" + draft.capabilities.join("\n") + "\n\n运行范围：" + targetLabel + "\n授权与代码、网站和 SDK 版本绑定。确定启动吗？")) {
            throw Object.assign(new Error("用户取消了 SDK 授权。"), { code: "SDK_GRANT_CANCELLED" });
          }
          var access = requiresSite(draft.capabilities) ? ensureSiteAccess(context) : Promise.resolve(context);
          return access.then(function (site) {
          if (!site || !site.ok) throw Object.assign(new Error(site && site.error || "当前网页未授权。"), { code: "SDK_ORIGIN_NOT_ALLOWED" });
          status("正在创建受控 SDK 会话...");
          return sendMessage({ action: "prepareSdkSession", payload: { scriptId: draft.id, code: draft.code, capabilities: draft.capabilities, contextNonce: context.contextNonce, confirmed: true } }).then(function (created) {
            if (!created || !created.ok) throw Object.assign(new Error(created && created.error || "SDK 会话创建失败。"), { code: created && created.code || "SDK_SESSION_CREATE_FAILED" });
            session = Object.assign({}, created, { code: draft.code });
            return connectSandbox().then(function () {
              runId = randomId("run_");
              post("RUN", { runId: runId, scriptId: draft.id, code: draft.code, timeoutMs: 5000 });
              byId("startDeveloperSessionBtn").disabled = true;
              byId("stopDeveloperSessionBtn").disabled = false;
              return { ok: true, session: session };
            });
          });
          });
        });
      }).catch(function (error) {
        var failure = { ok: false, code: error.code || "SDK_SESSION_CREATE_FAILED", error: error.message || String(error) };
        return revokeCreatedSession().then(function () {
          status("SDK 会话启动失败：" + failure.error);
          return failure;
        });
      });
    }

    function stop() {
      var current = session;
      if (runId && port) {
        try { post("TERMINATE", { runId: runId }); } catch (error) {}
      }
      session = null;
      byId("startDeveloperSessionBtn").disabled = false;
      byId("stopDeveloperSessionBtn").disabled = true;
      destroySandbox();
      if (!current) { status("当前没有运行会话。"); return Promise.resolve({ ok: true, revoked: false }); }
      return sendMessage({ action: "closeSdkSession", payload: { sessionToken: current.sessionToken } }).then(function (result) {
        if (!result || !result.ok) {
          session = current;
          resetSessionButtons();
        }
        status(result && result.ok ? "SDK 会话已停止，运行令牌已撤销。" : "SDK 会话关闭失败：" + (result && result.error || "未知错误"));
        return result;
      });
    }

    function invoke(method, args) {
      if (!session) return Promise.resolve({ ok: false, code: "SDK_SESSION_REQUIRED", error: "请先授权并启动 SDK 会话。" });
      var request = {
        channel: contracts.CHANNEL,
        protocolVersion: contracts.PROTOCOL_VERSION,
        scriptId: session.scriptId,
        requestId: randomId("request_"),
        method: method,
        args: args
      };
      return sendMessage({ action: "invokeSdkSession", payload: { sessionToken: session.sessionToken, request: request } });
    }

    function handleRuntimeMessage(message) {
      if (!message || message.channel !== "WSB_INTERNAL" || message.version !== 1 || message.type !== "SDK_SESSIONS_REVOKED") return;
      session = null;
      destroySandbox();
      resetSessionButtons();
      status("SDK 会话已由后台撤销。原因：" + String(message.reason || "安全状态变更"));
    }

    function bind() {
      byId("startDeveloperSessionBtn").addEventListener("click", start);
      byId("stopDeveloperSessionBtn").addEventListener("click", stop);
      window.addEventListener("pagehide", function () { stop(); }, { once: true });
      chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    }

    return Object.freeze({
      bind: bind,
      start: start,
      stop: stop,
      invoke: invoke,
      isActive: function () { return !!session; },
      getSession: function () { return session ? Object.assign({}, session, { code: undefined }) : null; }
    });
  }

  global.WinSpeedBallSdkSessionController = Object.freeze({ create: create });
})(self);
