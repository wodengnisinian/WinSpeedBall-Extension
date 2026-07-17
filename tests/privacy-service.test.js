const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function buildPrivacyService() {
  const localData = {
    manualCaptureTime: 100,
    manualOcrText: "recognized text",
    manualOcrSourceTime: 100,
    ocrJobSourceTime: 100,
    ocrJobStatus: "completed",
    aiQuestionHistory: [{ id: 1 }, { id: 2 }],
    aiQuestionHistoryByProvider: { deepseek: [{ id: 1 }], openai: [{ id: 2 }] },
    aiProviderWorkspaces: { deepseek: { mode: "custom", question: "q", answer: "a" } },
    aiSelectedProvider: "deepseek",
    manualAiSourceTime: 100,
    manualAiPrompt: "prompt",
    manualAiResponse: "answer",
    popupLogs: ["one", "two"],
    userScripts: [{ id: "script-1" }],
    localUserAccounts: [{ userId: "user-1" }],
    activeUserProviderId: "local",
    usageDeclarationAcceptance: { actorUserId: "user-1" },
    usageDeclarationHistory: [{ actorUserId: "user-1" }]
  };
  const sessionData = { localUserSession: { userId: "user-1" }, pendingCaptureAuthorization: { token: "capture", tabId: 1 } };
  let capture = { id: "latest", sourceTime: 100, dataUrl: "data:image/png;base64,AA==" };
  const runtime = { lastError: null };
  const storageService = {
    get(keys, callback) {
      const result = {};
      for (const key of keys) if (Object.prototype.hasOwnProperty.call(localData, key)) result[key] = localData[key];
      callback(result);
    },
    remove(keys, callback) {
      for (const key of keys) delete localData[key];
      callback({ ok: true });
    },
    set(data, callback) { Object.assign(localData, data); callback({ ok: true }); },
    getLatestCapture() { return Promise.resolve(capture); },
    deleteCaptureRecord() { capture = null; delete localData.manualCaptureDataUrl; delete localData.manualCaptureTime; return Promise.resolve(); }
  };
  const context = {
    self: { WinSpeedBallStorageService: storageService },
    Promise,
    Object,
    Array,
    String,
    Error,
    chrome: {
      runtime,
      storage: {
        session: {
          remove(keys, callback) {
            for (const key of keys) delete sessionData[key];
            callback();
          }
        }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/privacy-service.js"), "utf8"), context);
  return {
    service: context.self.WinSpeedBallPrivacyService,
    localData,
    sessionData,
    getCapture: () => capture
  };
}

test("隐私中心统计六类本地数据", async () => {
  const fixture = buildPrivacyService();
  const result = await fixture.service.getSummary();
  assert.equal(result.ok, true);
  assert.equal(result.localOnly, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.categories.map((item) => [item.id, item.count]))),
    [["screenshots", 1], ["ocr", 1], ["ai", 3], ["logs", 2], ["scripts", 1], ["account", 1]]
  );
});

test("分类清理 OCR 不影响截图、AI 和账户", async () => {
  const fixture = buildPrivacyService();
  const result = await fixture.service.clear("ocr");
  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.cleared), ["ocr"]);
  assert.equal(fixture.localData.manualOcrText, undefined);
  assert.equal(fixture.localData.ocrJobStatus, undefined);
  assert.ok(fixture.getCapture());
  assert.equal(fixture.localData.manualAiResponse, "answer");
  assert.equal(fixture.localData.localUserAccounts.length, 1);
});

test("分类清理 AI 会删除各 Provider 的工作区和历史", async () => {
  const fixture = buildPrivacyService();
  const result = await fixture.service.clear("ai");
  assert.equal(result.ok, true);
  assert.equal(fixture.localData.aiQuestionHistory, undefined);
  assert.equal(fixture.localData.aiQuestionHistoryByProvider, undefined);
  assert.equal(fixture.localData.aiProviderWorkspaces, undefined);
  assert.equal(fixture.localData.aiSelectedProvider, undefined);
  assert.equal(fixture.localData.manualAiResponse, undefined);
});

test("脚本清理会同时删除 Developer 草稿和工作区缓存", async () => {
  const fixture = buildPrivacyService();
  fixture.localData.developerSdkDraft = { code: "sdk draft" };
  fixture.localData.developerSdkDrafts = [{ id: "one", code: "sdk draft one" }, { id: "two", code: "sdk draft two" }];
  fixture.localData.developerActiveDraftId = "one";
  fixture.localData.sdkScriptStorage = { one: { key: "value" } };
  fixture.localData.sdkPermissionGrants = { one: { capabilities: ["storage"] } };
  fixture.sessionData.sdkRuntimeTokens = { token: { scriptId: "one" } };
  fixture.sessionData.sdkRuntimeSessions = { session: { scriptId: "one" } };
  fixture.sessionData.sdkContextIntents = { intent: { scriptId: "one" } };
  fixture.localData.lastWorkspaceScript = { code: "legacy cache" };
  fixture.localData.scriptWorkspaceActive = true;
  fixture.localData.popupState = { lastPanelId: "scriptPanel", scriptWorkspaceActive: true, lastWorkspaceScript: { code: "popup cache" } };
  fixture.localData.popupStateBrowser = { lastPanelId: "aiPanel", scriptWorkspaceActive: false, lastWorkspaceScript: { code: "browser cache" } };
  fixture.localData.popupStatePinned = { lastPanelId: "scriptPanel", scriptWorkspaceActive: true, lastWorkspaceScript: { code: "pinned cache" } };
  const before = await fixture.service.getSummary();
  assert.equal(before.categories.find((item) => item.id === "scripts").count, 3);
  const result = await fixture.service.clear("scripts");
  assert.equal(result.ok, true);
  assert.equal(fixture.localData.userScripts, undefined);
  assert.equal(fixture.localData.developerSdkDraft, undefined);
  assert.equal(fixture.localData.developerSdkDrafts, undefined);
  assert.equal(fixture.localData.developerActiveDraftId, undefined);
  assert.equal(fixture.localData.sdkScriptStorage, undefined);
  assert.equal(fixture.localData.sdkPermissionGrants, undefined);
  assert.equal(fixture.sessionData.sdkRuntimeTokens, undefined);
  assert.equal(fixture.sessionData.sdkRuntimeSessions, undefined);
  assert.equal(fixture.sessionData.sdkContextIntents, undefined);
  assert.equal(fixture.localData.lastWorkspaceScript, undefined);
  assert.equal(fixture.localData.scriptWorkspaceActive, undefined);
  assert.equal(fixture.localData.popupState.lastPanelId, "scriptPanel");
  assert.equal(fixture.localData.popupState.scriptWorkspaceActive, false);
  assert.equal(fixture.localData.popupState.lastWorkspaceScript, undefined);
  assert.equal(fixture.localData.popupStateBrowser.lastPanelId, "aiPanel");
  assert.equal(fixture.localData.popupStateBrowser.lastWorkspaceScript, undefined);
  assert.equal(fixture.localData.popupStatePinned.scriptWorkspaceActive, false);
  assert.equal(fixture.localData.popupStatePinned.lastWorkspaceScript, undefined);
});

test("全部清理会删除六类数据并退出本地账户", async () => {
  const fixture = buildPrivacyService();
  const result = await fixture.service.clear("all");
  assert.equal(result.ok, true);
  assert.equal(result.categories.every((item) => item.count === 0), true);
  assert.equal(fixture.getCapture(), null);
  assert.equal(fixture.sessionData.pendingCaptureAuthorization, undefined);
  assert.equal(fixture.localData.userScripts, undefined);
  assert.equal(fixture.localData.localUserAccounts, undefined);
  assert.equal(fixture.localData.activeUserProviderId, undefined);
  assert.equal(fixture.localData.usageDeclarationAcceptance, undefined);
  assert.equal(fixture.localData.usageDeclarationHistory, undefined);
  assert.equal(fixture.sessionData.localUserSession, undefined);
  assert.equal(fixture.localData.manualCaptureTime, undefined);
});

test("隐私中心消息要求受信弹窗和明确确认", () => {
  const context = {
    self: {},
    URL,
    chrome: { runtime: { id: "extension-id", getURL: (file) => `chrome-extension://extension-id/${file}` } }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/message-schema.js"), "utf8"), context);
  const schema = context.self.WinSpeedBallMessageSchema;
  const sender = { id: "extension-id", url: "chrome-extension://extension-id/popup/index.html" };
  const valid = schema.parse({ version: 1, action: "clearPrivacyData", source: "popup", requestId: "privacy-clear-123", payload: { category: "logs", confirmed: true } }, sender);
  assert.equal(valid.ok, true);
  const unconfirmed = schema.parse({ version: 1, action: "clearPrivacyData", source: "popup", requestId: "privacy-clear-124", payload: { category: "logs", confirmed: false } }, sender);
  assert.equal(unconfirmed.ok, false);
  const invalidCategory = schema.parse({ version: 1, action: "clearPrivacyData", source: "popup", requestId: "privacy-clear-125", payload: { category: "settings", confirmed: true } }, sender);
  assert.equal(invalidCategory.ok, false);
});
