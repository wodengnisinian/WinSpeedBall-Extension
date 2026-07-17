const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function buildFeatureGate(plan) {
  const context = {
    self: {
      WinSpeedBallUserService: {
        getUser() {
          return Promise.resolve({ ok: true, providerId: "local", authenticated: true, user: { plan: plan || "free" } });
        }
      }
    },
    Promise,
    Object,
    String
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/subscription-service.js"), "utf8"), context);
  context.self.WinSpeedBallSubscriptionService = context.self.WinSpeedBallSubscriptionService;
  vm.runInContext(fs.readFileSync(path.join(root, "background/feature-gate.js"), "utf8"), context);
  return {
    subscription: context.self.WinSpeedBallSubscriptionService,
    gate: context.self.WinSpeedBallFeatureGate
  };
}

test("3.7.0 已登记能力全部放行", async () => {
  const fixture = buildFeatureGate("free");
  for (const feature of ["video.basic", "ocr.basic", "ai.basic", "ai.summary", "sdk.developer", "cloud.sync"]) {
    assert.equal(await fixture.gate.canUse(feature), true, feature);
  }
});

test("FeatureGate 对未知能力默认拒绝", async () => {
  const fixture = buildFeatureGate();
  const result = await fixture.gate.check("unknown.feature");
  assert.equal(result.ok, false);
  assert.equal(result.allowed, false);
  assert.equal(result.code, "UNKNOWN_FEATURE");
});

test("FeatureGate 列表返回计划和放行原因", async () => {
  const fixture = buildFeatureGate("guest");
  const result = await fixture.gate.list();
  assert.equal(result.ok, true);
  assert.equal(result.features.length, 6);
  assert.equal(result.features.every((item) => item.allowed === true), true);
  assert.equal(result.features.every((item) => item.plan === "guest"), true);
});

test("SubscriptionService 只提供计划与非强制额度预留", async () => {
  const fixture = buildFeatureGate("free");
  const plan = await fixture.subscription.getPlan();
  const quota = await fixture.subscription.getQuota("ocr");
  assert.equal(plan.id, "free");
  assert.equal(plan.commercialEnabled, false);
  assert.deepEqual(JSON.parse(JSON.stringify(quota)), { ok: true, resource: "ocr", plan: "free", limit: 10, remaining: 10, enforced: false });
});

test("FeatureGate 消息动作只允许弹窗并校验能力名", () => {
  const context = {
    self: {},
    URL,
    chrome: { runtime: { id: "extension-id", getURL: (file) => `chrome-extension://extension-id/${file}` } }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/message-schema.js"), "utf8"), context);
  const schema = context.self.WinSpeedBallMessageSchema;
  const sender = { id: "extension-id", url: "chrome-extension://extension-id/popup/index.html" };
  const valid = schema.parse({ version: 1, action: "canUseFeature", source: "popup", requestId: "feature-check-123", payload: { feature: "ai.summary" } }, sender);
  assert.equal(valid.ok, true);
  const invalid = schema.parse({ version: 1, action: "canUseFeature", source: "popup", requestId: "feature-check-bad", payload: { feature: "AI SUMMARY" } }, sender);
  assert.equal(invalid.ok, false);
});

test("FeatureGate 在订阅检查异常时默认拒绝且不泄漏异常", async () => {
  const fixture = buildFeatureGate("free");
  fixture.subscription.hasFeature = function () { return Promise.reject(new Error("provider unavailable")); };
  const result = await fixture.gate.check("video.basic");
  assert.equal(result.ok, false);
  assert.equal(result.allowed, false);
  assert.equal(result.code, "FEATURE_GATE_CHECK_FAILED");
  assert.match(result.error, /provider unavailable/);
});

function loadBackgroundGateAction(check) {
  const source = fs.readFileSync(path.join(root, "background/service-worker.js"), "utf8");
  const start = source.indexOf("  function gateAction(");
  const end = source.indexOf("\n\n  function controlActiveTab", start);
  assert.ok(start >= 0 && end > start, "background gateAction is missing");
  const context = { self: {}, featureGate: { check }, Promise, String };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + "\nself.gateAction = gateAction;", context);
  return context.self.gateAction;
}

test("普通界面动作被拒绝时不执行并统一返回 FEATURE_NOT_AVAILABLE", async () => {
  let executed = false;
  let response;
  const gateAction = loadBackgroundGateAction(function () {
    return Promise.resolve({ ok: true, allowed: false, reason: "disabled for test" });
  });

  await gateAction("video.basic", function () { executed = true; }, function (value) { response = value; });
  assert.equal(executed, false);
  assert.equal(response.ok, false);
  assert.equal(response.code, "FEATURE_NOT_AVAILABLE");
  assert.equal(response.feature, "video.basic");
  assert.equal(response.error, "disabled for test");
});

test("普通界面动作通过门控后只执行一次", async () => {
  let executed = 0;
  const gateAction = loadBackgroundGateAction(function () {
    return Promise.resolve({ ok: true, allowed: true });
  });

  await gateAction("ocr.basic", function () { executed += 1; }, function () {});
  assert.equal(executed, 1);
});

test("普通界面视频、OCR、AI 入口均使用对应 FeatureGate", () => {
  const source = fs.readFileSync(path.join(root, "background/service-worker.js"), "utf8");
  assert.match(source, /controlActiveTab:\s*function\s*\([^)]*\)\s*\{\s*return gateAction\("video\.basic"/);
  for (const action of ["captureVisiblePage", "startRegionCapture", "saveManualCapture", "getManualCapture"]) {
    assert.match(source, new RegExp(action + ":\\s*function\\s*\\([^)]*\\)\\s*\\{\\s*return gateAction\\(\"ocr\\.basic\""));
  }
  for (const action of ["testAI", "askAI", "testDeepSeek", "askDeepSeek"]) {
    assert.match(source, new RegExp(action + ":\\s*function\\s*\\([^)]*\\)\\s*\\{\\s*return gateAction\\(\"ai\\.basic\""));
  }
});
