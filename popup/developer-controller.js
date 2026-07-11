(function (global) {
  "use strict";

  var DEFAULT_DRAFT = [
    "// ==UserScript==",
    "// @name My WinSpeedBall Script",
    "// @version 1.0.0",
    "// @wsb-capability video.read",
    "// ==/UserScript==",
    "",
    "const video = await WSB.video.current();",
    "console.log(video);"
  ].join("\n");

  function create(dependencies) {
    var byId = dependencies.byId;
    var sendMessage = dependencies.sendMessage;
    var draftStore = dependencies.draftStore;
    var sessionController = dependencies.sessionController;
    var confirmAction = dependencies.confirmAction;
    var contracts = dependencies.contracts;
    var lastStatus = null;
    var draftsLoaded = Promise.resolve();

    function output(elementId, value) {
      var element = byId(elementId);
      if (!element) return;
      element.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    }

    function currentMetadata() {
      return contracts.parseMetadata(byId("developerScriptEditor").value || "");
    }

    function renderDocumentation() {
      var capabilityList = byId("developerCapabilityList");
      var apiList = byId("developerApiList");
      var methodSelect = byId("developerApiMethod");
      capabilityList.textContent = "";
      apiList.textContent = "";
      methodSelect.textContent = "";
      contracts.CAPABILITIES.forEach(function (capability) {
        var item = document.createElement("div");
        var title = document.createElement("strong");
        title.textContent = capability;
        item.className = "developer-item";
        item.appendChild(title);
        capabilityList.appendChild(item);
      });
      Object.keys(contracts.METHOD_CAPABILITIES).forEach(function (method) {
        var capability = contracts.METHOD_CAPABILITIES[method];
        var item = document.createElement("div");
        var title = document.createElement("strong");
        var description = document.createElement("span");
        var option = document.createElement("option");
        item.className = "developer-item";
        title.textContent = "WSB." + method;
        description.textContent = "需要能力：" + capability;
        option.value = method;
        option.textContent = method;
        item.appendChild(title);
        item.appendChild(description);
        apiList.appendChild(item);
        methodSelect.appendChild(option);
      });
    }

    function renderStatus(status) {
      if (!status || status.ok !== true) {
        var previous = lastStatus || {};
        byId("developerModeToggle").checked = previous.enabled === true;
        byId("developerModeToggle").disabled = previous.available !== true;
        byId("developerModeStatus").textContent = "Developer Mode 状态更新失败：" + (status && status.error || "未知错误");
        return;
      }
      lastStatus = status;
      var enabled = !!(status && status.ok && status.enabled);
      var available = !!(status && status.ok && status.available);
      byId("developerModeToggle").checked = enabled;
      byId("developerModeToggle").disabled = !available;
      byId("developerNavBtn").classList.toggle("hidden", !enabled);
      byId("developerSdkVersion").textContent = status && status.sdkVersion || "-";
      byId("developerRuntimeStatus").textContent = status && status.runtimeReady ? "已连接" : "契约阶段";
      byId("developerCapabilityCount").textContent = String(status && status.capabilities ? status.capabilities.length : 0);
      byId("developerModeStatus").textContent = available
        ? (enabled ? "Developer Mode 已开启。" : "Developer Mode 默认关闭，普通用户看不到开发者入口。")
        : "Developer Mode 当前不可用：" + (status && status.reason || "功能未开放");
      byId("developerOverviewStatus").textContent = status && status.runtimeReady
        ? "SDK Runtime 已连接。"
        : "SDK Runtime 当前不可用，请重新加载扩展后再试。";
      if (!enabled && byId("developerPanel").classList.contains("active")) {
        var settingsButton = document.querySelector('[data-panel="settingsPanel"]');
        if (settingsButton) settingsButton.click();
      }
    }

    function loadStatus() {
      return sendMessage({ action: "getDeveloperMode" }).then(function (status) {
        renderStatus(status);
        return status;
      });
    }

    function setEnabled(enabled) {
      if (enabled && !confirmAction("Developer Mode 面向高级用户。SDK 脚本会在受限沙箱中运行，并且只能调用确认过的 WSB 能力。确定开启吗？")) {
        byId("developerModeToggle").checked = false;
        return;
      }
      byId("developerModeToggle").disabled = true;
      byId("developerModeStatus").textContent = enabled ? "正在开启 Developer Mode..." : "正在关闭 Developer Mode...";
      var stopSession = !enabled && sessionController.isActive() ? sessionController.stop() : Promise.resolve();
      stopSession.then(function () {
        return sendMessage({ action: "setDeveloperMode", payload: { enabled: enabled, confirmed: enabled } });
      }).then(function (status) {
        renderStatus(status);
      });
    }

    function analyzeDraft() {
      var code = byId("developerScriptEditor").value || "";
      if (code.length > 200000) {
        var tooLarge = { ok: false, code: "SCRIPT_TOO_LARGE", error: "脚本超过 200000 字符。" };
        output("developerScriptOutput", tooLarge);
        return tooLarge;
      }
      var metadata = contracts.parseMetadata(code);
      var classification = contracts.classifyMetadata(metadata);
      var result = {
        ok: classification.ok,
        mode: classification.mode,
        name: metadata.name || "未命名",
        version: metadata.version || "未声明",
        capabilities: metadata.capabilities,
        legacyPermissions: metadata.legacyPermissions,
        unsupportedCapabilities: metadata.unsupportedCapabilities
      };
      if (!classification.ok) {
        result.code = classification.code;
        result.error = classification.error;
      } else if (classification.mode === "legacy") {
        result.ok = false;
        result.code = "LEGACY_SCRIPT_ONLY";
        result.error = "旧 @permission 脚本只能使用兼容模式，不能作为 SDK 脚本运行。";
      }
      output("developerScriptOutput", result);
      return result;
    }

    function renderDrafts(snapshot, keepEditor) {
      var select = byId("developerDraftSelect");
      select.textContent = "";
      if (!snapshot.drafts.length) {
        var empty = document.createElement("option");
        empty.value = "";
        empty.textContent = "未保存草稿";
        select.appendChild(empty);
        if (!keepEditor) byId("developerScriptEditor").value = DEFAULT_DRAFT;
      } else {
        snapshot.drafts.forEach(function (draft) {
          var option = document.createElement("option");
          option.value = draft.id;
          option.textContent = draft.name;
          select.appendChild(option);
        });
        select.value = snapshot.activeId;
        var active = draftStore.getActive();
        if (active && !keepEditor) byId("developerScriptEditor").value = active.code;
      }
      analyzeDraft();
    }

    function loadDraft() {
      draftsLoaded = draftStore.load().then(function (snapshot) {
        renderDrafts(snapshot, false);
        return snapshot;
      }).catch(function (error) {
        output("developerScriptOutput", { ok: false, error: error.message || String(error) });
      });
      return draftsLoaded;
    }

    function saveDraft() {
      var validation = analyzeDraft();
      if (!validation.ok) return;
      draftsLoaded.then(function () {
        return draftStore.saveDraft(byId("developerDraftSelect").value, byId("developerScriptEditor").value);
      }).then(function (draft) {
        renderDrafts(draftStore.snapshot(), true);
        output("developerScriptOutput", { ok: true, message: "SDK 脚本草稿已保存在当前浏览器。", draftId: draft.id, capabilities: draft.capabilities });
      }).catch(function (error) {
        output("developerScriptOutput", { ok: false, code: error.code || "DRAFT_SAVE_FAILED", error: error.message || String(error) });
      });
    }

    function clearDraft() {
      byId("developerScriptEditor").value = "";
      output("developerScriptOutput", "编辑器已清空，点击“保存草稿”后才会覆盖当前草稿。");
    }

    function createDraft() {
      if (sessionController.isActive()) { output("developerScriptOutput", { ok: false, error: "请先停止当前 SDK 会话。" }); return; }
      draftsLoaded.then(function () { return draftStore.createDraft(DEFAULT_DRAFT); }).then(function (draft) {
        renderDrafts(draftStore.snapshot(), false);
        output("developerScriptOutput", { ok: true, message: "已新建 SDK 草稿。", draftId: draft.id });
      }).catch(function (error) {
        output("developerScriptOutput", { ok: false, error: error.message || String(error) });
      });
    }

    function deleteDraft() {
      if (sessionController.isActive()) { output("developerScriptOutput", { ok: false, error: "请先停止当前 SDK 会话。" }); return; }
      var draftId = byId("developerDraftSelect").value;
      if (!draftId) { clearDraft(); return; }
      if (!confirmAction("确定删除当前 SDK 草稿吗？删除后无法恢复。")) return;
      sendMessage({ action: "deleteSdkScriptData", payload: { scriptId: draftId, confirmed: true } }).then(function (deleted) {
        if (!deleted || !deleted.ok) throw Object.assign(new Error(deleted && deleted.error || "SDK 脚本数据清理失败。"), { code: deleted && deleted.code });
        return draftsLoaded.then(function () { return draftStore.removeDraft(draftId); });
      }).then(function (snapshot) {
        renderDrafts(snapshot, false);
        output("developerScriptOutput", "当前 SDK 草稿已删除。");
      }).catch(function (error) {
        output("developerScriptOutput", { ok: false, error: error.message || String(error) });
      });
    }

    function selectDraft() {
      if (sessionController.isActive()) { output("developerScriptOutput", { ok: false, error: "请先停止当前 SDK 会话。" }); renderDrafts(draftStore.snapshot(), true); return; }
      var draftId = byId("developerDraftSelect").value;
      if (!draftId) return;
      draftsLoaded.then(function () { return draftStore.selectDraft(draftId); }).then(function (draft) {
        byId("developerScriptEditor").value = draft.code;
        analyzeDraft();
      }).catch(function (error) {
        output("developerScriptOutput", { ok: false, error: error.message || String(error) });
      });
    }

    function importDraftFile(file) {
      if (!file) return;
      if (sessionController.isActive()) { output("developerScriptOutput", { ok: false, error: "请先停止当前 SDK 会话。" }); return; }
      if (file.size > 200000) {
        output("developerScriptOutput", { ok: false, code: "SCRIPT_TOO_LARGE", error: "导入脚本超过 200000 字节。" });
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        draftsLoaded.then(function () { return draftStore.createDraft(String(reader.result || "")); }).then(function (draft) {
          renderDrafts(draftStore.snapshot(), false);
          output("developerScriptOutput", { ok: true, message: "SDK 脚本已导入。", draftId: draft.id, name: draft.name });
        }).catch(function (error) {
          output("developerScriptOutput", { ok: false, code: error.code || "IMPORT_FAILED", error: error.message || String(error) });
        });
      };
      reader.onerror = function () { output("developerScriptOutput", { ok: false, error: "脚本文件读取失败。" }); };
      reader.readAsText(file, "utf-8");
    }

    function exportDraft() {
      var draftId = byId("developerDraftSelect").value;
      if (!draftId) { output("developerScriptOutput", { ok: false, error: "请先保存当前草稿。" }); return; }
      try {
        var exported = draftStore.exportDraft(draftId);
        var url = URL.createObjectURL(new Blob([exported.code], { type: "text/javascript;charset=utf-8" }));
        var link = document.createElement("a");
        link.href = url;
        link.download = exported.fileName;
        link.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 0);
        output("developerScriptOutput", { ok: true, message: "SDK 草稿已导出。", fileName: exported.fileName });
      } catch (error) {
        output("developerScriptOutput", { ok: false, error: error.message || String(error) });
      }
    }

    function runContractTest() {
      var args;
      try { args = JSON.parse(byId("developerApiArgs").value || "[]"); }
      catch (error) {
        output("developerApiOutput", { ok: false, code: "INVALID_JSON", error: "参数必须是 JSON 数组。" });
        return;
      }
      var method = byId("developerApiMethod").value;
      var request = {
        channel: contracts.CHANNEL,
        protocolVersion: contracts.PROTOCOL_VERSION,
        scriptId: "developer-test",
        requestId: "contract-" + Date.now(),
        method: method,
        args: args
      };
      var requestResult = contracts.validateRequest(request);
      if (!requestResult.ok) { output("developerApiOutput", requestResult); return; }
      var metadata = currentMetadata();
      var classification = contracts.classifyMetadata(metadata);
      if (!classification.ok || classification.mode !== "sdk") {
        output("developerApiOutput", { ok: false, code: classification.code || "SDK_SCRIPT_REQUIRED", error: classification.error || "当前编辑器不是有效 SDK 脚本。" });
        return;
      }
      var authorization = contracts.authorize(method, args, classification.capabilities);
      if (!authorization.ok) { output("developerApiOutput", authorization); return; }
      if (!sessionController.isActive()) {
        output("developerApiOutput", { ok: false, code: "SDK_SESSION_REQUIRED", error: "契约检查已通过，请先点击“授权并启动”建立真实 SDK 会话。", requiredCapability: authorization.capability });
        return;
      }
      output("developerApiOutput", "正在调用真实 SDK Service...");
      sessionController.invoke(method, args).then(function (result) {
        output("developerApiOutput", result && result.ok ? {
          ok: true,
          contractOnly: false,
          method: method,
          args: args,
          requiredCapability: authorization.capability,
          value: result.value
        } : result || { ok: false, error: "SDK Service 无响应。" });
      });
    }

    function bind() {
      renderDocumentation();
      byId("developerModeToggle").addEventListener("change", function () { setEnabled(byId("developerModeToggle").checked); });
      byId("validateDeveloperScriptBtn").addEventListener("click", analyzeDraft);
      byId("saveDeveloperDraftBtn").addEventListener("click", saveDraft);
      byId("clearDeveloperDraftBtn").addEventListener("click", clearDraft);
      byId("newDeveloperDraftBtn").addEventListener("click", createDraft);
      byId("deleteDeveloperDraftBtn").addEventListener("click", deleteDraft);
      byId("developerDraftSelect").addEventListener("change", selectDraft);
      byId("importDeveloperDraftBtn").addEventListener("click", function () { byId("developerDraftFileInput").click(); });
      byId("developerDraftFileInput").addEventListener("change", function () {
        importDraftFile(byId("developerDraftFileInput").files && byId("developerDraftFileInput").files[0]);
        byId("developerDraftFileInput").value = "";
      });
      byId("exportDeveloperDraftBtn").addEventListener("click", exportDraft);
      byId("runDeveloperApiTestBtn").addEventListener("click", runContractTest);
      loadDraft();
    }

    return {
      bind: bind,
      loadStatus: loadStatus,
      loadDraft: loadDraft,
      analyzeDraft: analyzeDraft,
      runContractTest: runContractTest,
      getLastStatus: function () { return lastStatus; }
    };
  }

  global.WinSpeedBallDeveloperController = Object.freeze({ create: create });
})(self);
