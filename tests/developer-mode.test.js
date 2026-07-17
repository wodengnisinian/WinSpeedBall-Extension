const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function buildService(featureAllowed = true) {
  const localData = {};
  const context = {
    self: {
      WinSpeedBallStorageService: {
        get(keys, callback) {
          const result = {};
          for (const key of keys) if (Object.prototype.hasOwnProperty.call(localData, key)) result[key] = localData[key];
          callback(result);
        },
        set(data, callback) { Object.assign(localData, data); callback({ ok: true }); }
      },
      WinSpeedBallFeatureGate: {
        check() { return Promise.resolve({ ok: true, allowed: featureAllowed, reason: featureAllowed ? "enabled" : "denied" }); }
      }
    },
    Promise,
    Object,
    Array,
    Number,
    Date,
    String,
    JSON
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "sdk/contracts.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/developer-mode-service.js"), "utf8"), context);
  return { service: context.self.WinSpeedBallDeveloperModeService, localData };
}

test("Developer Mode 默认关闭但能力可用", async () => {
  const fixture = buildService();
  const status = await fixture.service.getStatus();
  assert.equal(status.ok, true);
  assert.equal(status.enabled, false);
  assert.equal(status.available, true);
  assert.equal(status.runtimeReady, true);
  assert.equal(status.runtimeStage, "beta");
  assert.equal(status.sdkVersion, "3.7.0-beta");
});

test("开启 Developer Mode 必须明确确认", async () => {
  const fixture = buildService();
  const denied = await fixture.service.setEnabled(true, false);
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "DEVELOPER_CONFIRMATION_REQUIRED");
  assert.equal(fixture.localData.developerModeSettings, undefined);
});

test("Developer Mode 开关持久化且关闭不删除草稿", async () => {
  const fixture = buildService();
  fixture.localData.developerSdkDraft = { code: "draft" };
  const enabled = await fixture.service.setEnabled(true, true);
  assert.equal(enabled.enabled, true);
  assert.equal(fixture.localData.developerModeSettings.enabled, true);
  const disabled = await fixture.service.setEnabled(false, false);
  assert.equal(disabled.enabled, false);
  assert.equal(fixture.localData.developerModeSettings.enabled, false);
  assert.deepEqual(fixture.localData.developerSdkDraft, { code: "draft" });
});

test("FeatureGate 拒绝时不能开启 Developer Mode", async () => {
  const fixture = buildService(false);
  const result = await fixture.service.setEnabled(true, true);
  assert.equal(result.ok, false);
  assert.equal(result.code, "FEATURE_NOT_AVAILABLE");
});

test("FeatureGate 不可用时仍然可以关闭 Developer Mode", async () => {
  const fixture = buildService(false);
  fixture.localData.developerModeSettings = { enabled: true, enabledAt: 10, updatedAt: 10 };
  const result = await fixture.service.setEnabled(false, false);
  assert.equal(result.ok, true);
  assert.equal(result.enabled, false);
  assert.equal(fixture.localData.developerModeSettings.enabled, false);
});

test("Developer Mode 消息只允许受信弹窗并校验确认", () => {
  const context = {
    self: {},
    URL,
    chrome: { runtime: { id: "extension-id", getURL: (file) => `chrome-extension://extension-id/${file}` } }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/message-schema.js"), "utf8"), context);
  const schema = context.self.WinSpeedBallMessageSchema;
  const sender = { id: "extension-id", url: "chrome-extension://extension-id/popup/index.html" };
  const valid = schema.parse({ version: 1, action: "setDeveloperMode", source: "popup", requestId: "developer-mode-1", payload: { enabled: true, confirmed: true } }, sender);
  assert.equal(valid.ok, true);
  const unconfirmed = schema.parse({ version: 1, action: "setDeveloperMode", source: "popup", requestId: "developer-mode-2", payload: { enabled: true, confirmed: false } }, sender);
  assert.equal(unconfirmed.ok, false);
  const untrusted = schema.parse({ version: 1, action: "getDeveloperMode", source: "popup", requestId: "developer-mode-3", payload: {} }, { id: "extension-id", url: "chrome-extension://extension-id/other.html" });
  assert.equal(untrusted.ok, false);
});
