const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const code = `// ==UserScript==\n// @name Test\n// @version 1.0.0\n// @wsb-capability video.read\n// @wsb-capability storage\n// ==/UserScript==`;
const bookCode = `// ==UserScript==\n// @name Book Test\n// @version 1.0.0\n// @wsb-capability book.read\n// ==/UserScript==`;
const publicDataCode = `// ==UserScript==\n// @name Public Data Test\n// @version 1.0.0\n// @wsb-capability video.read\n// @wsb-capability qa.read\n// @wsb-capability ai.read\n// ==/UserScript==`;
const bookNextCheckAt = Date.UTC(2026, 6, 17, 12, 0, 0);

function buildService(options = {}) {
  let sessions = {};
  let grantedCapabilities = [];
  let tokenSequence = 0;
  let failSessionWrites = options.failSessionWrites === true;
  const revokedTokens = [];
  const storageValues = {};
  const context = { self: {}, Object, Array, String, Number, JSON, Promise, Date };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "sdk/contracts.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "sdk/method-schema.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/sdk-service.js"), "utf8"), context);
  const service = context.self.WinSpeedBallSdkService.create({
    contracts: context.self.WinSpeedBallSdkContracts,
    methodSchema: context.self.WinSpeedBallSdkMethodSchema,
    permissionService: {
      grant(binding) { grantedCapabilities = binding.capabilities.slice(); return Promise.resolve({ ok: true, grant: { scriptId: binding.scriptId, codeHash: "a".repeat(64), fingerprint: "b".repeat(64), sdkVersion: "3.7.0-beta", capabilities: binding.capabilities, originScope: binding.originScope } }); },
      createRuntimeToken() {
        tokenSequence += 1;
        return Promise.resolve({ ok: true, token: "wsb_rt_" + tokenSequence.toString(16).padStart(64, "0"), issuedAt: Date.now(), expiresAt: Date.now() + 300000 });
      },
      validateRuntimeToken(token, value) { return Promise.resolve(grantedCapabilities.includes(value.capability) ? { ok: true, valid: true } : { ok: false, code: "SDK_CAPABILITY_REQUIRED", error: "missing" }); },
      revokeRuntimeToken(token) {
        revokedTokens.push(token);
        return options.revokeFailure ? { ok: false, code: "SDK_TOKEN_REVOKE_FAILED", error: "revoke failed" } : { ok: true, revoked: true };
      },
      revokeAllRuntimeTokens() {
        const revoked = Object.keys(sessions).length;
        return Promise.resolve(options.revokeFailure ? { ok: false, code: "SDK_TOKEN_REVOKE_FAILED", error: "revoke failed" } : { ok: true, revoked });
      },
      revoke() {
        return Promise.resolve({ ok: true, revoked: true });
      }
    },
    featureGate: { check() { return Promise.resolve({ ok: true, allowed: true }); } },
    developerModeService: { getStatus() { return Promise.resolve({ ok: true, enabled: true }); } },
    sdkStorageService: {
      get(scriptId, key) { return Promise.resolve({ ok: true, value: storageValues[`${scriptId}:${key}`] ?? null }); },
      set(scriptId, key, value) { storageValues[`${scriptId}:${key}`] = value; return Promise.resolve({ ok: true, key, bytesUsed: JSON.stringify(value).length }); },
      clearScript(scriptId) {
        Object.keys(storageValues).forEach((key) => { if (key.startsWith(`${scriptId}:`)) delete storageValues[key]; });
        return Promise.resolve({ ok: true });
      }
    },
    consumeContext() { return Promise.resolve({ ok: true, tabId: 9, origin: "https://example.com", originPattern: "https://example.com/*", url: "https://example.com/course" }); },
    validateContext() { return Promise.resolve({ ok: true }); },
    controlTab(tabId, command, callback) {
      if (command.type === "GET_MEDIA_LIST") callback({ ok: true, media: [{ id: "frame-0-media-1", frameId: 0, title: "Course", duration: 100, currentTime: 20, rate: 1, volume: 0.8, muted: false, paused: false, mediaType: "video" }] });
      else if (command.type === "EXTRACT_PAGE_TEXT") callback({ ok: true, frameResults: [{ ok: true, title: "Course", url: "https://example.com/course", text: "Lesson text" }] });
      else callback({
        ok: true, duration: 100, currentTime: 20, remainingTime: 80, rate: 2, targetRate: 2, volume: 0.8,
        muted: false, paused: false, mediaTag: "video", mediaCount: 6, frameCount: 2, rateLocked: true,
        rateStable: true, continuousPlayback: false, keepPlaying: true, playerType: "HTML5 强控制", controlMode: "apply"
      });
    },
    getBookStatus(tabId, callback) {
      callback({
        ok: true,
        mode: "chaoxing",
        detected: true,
        reader: "chaoxing-pdg",
        page: "362",
        pageType: "5",
        pageTypeLabel: "正文页",
        pageJumpDetected: true,
        pageJumpValue: "5",
        pageJumpLabel: "正文362页",
        isBackCover: false,
        running: true,
        interval: 2,
        backCoverCheckEnabled: true,
        backCoverReached: false,
        backCoverCheckIndex: 1,
        backCoverCheckDueAt: bookNextCheckAt,
        backCoverNextCheckSeconds: 300,
        backCoverCheckSequence: [400, 300, 250, 150, 50]
      });
    },
    callAi(payload, callback) { callback({ ok: true, content: `AI:${payload.prompt}`, model: "test-model" }); },
    getLatestOcr(callback) { callback({ ok: true, ocrText: "OCR text", time: 1700000000000 }); },
    getVoiceState(callback) { callback({ ok: true, transcript: "Voice text", status: "completed", progress: 1, updatedAt: 1700000001000, durationMs: 8000 }); },
    getLatestAi(callback) { callback({ ok: true, record: { provider: "openai", model: "test-model", question: "Q", answer: "A", time: "2026-07-17T00:00:00.000Z", source: "history", truncated: false } }); },
    getAiHistory(limit, callback) { callback({ ok: true, records: [{ provider: "openai", question: "Q", answer: "A", limit }] }); },
    readSessions() { return Promise.resolve(JSON.parse(JSON.stringify(sessions))); },
    writeSessions(value) {
      if (failSessionWrites) return Promise.resolve({ ok: false, code: "SDK_SESSION_STORAGE_FAILED", error: "write failed" });
      sessions = JSON.parse(JSON.stringify(value));
      return Promise.resolve({ ok: true });
    }
  });
  return {
    service,
    contracts: context.self.WinSpeedBallSdkContracts,
    getSessions: () => JSON.parse(JSON.stringify(sessions)),
    setFailSessionWrites(value) { failSessionWrites = value; },
    revokedTokens
  };
}

function request(method, args = []) {
  return { channel: "WSB_SDK", protocolVersion: 1, scriptId: "draft_1", requestId: `req-${method.replace(/\W/g, "-")}`, method, args };
}

test("SDK 会话只接受与脚本声明一致的确认能力", async () => {
  const fixture = buildService();
  const denied = await fixture.service.prepareSession({ scriptId: "draft_1", code, capabilities: ["video.read"], confirmed: true });
  assert.equal(denied.code, "SDK_CAPABILITY_MISMATCH");
  const unconfirmed = await fixture.service.prepareSession({ scriptId: "draft_1", code, capabilities: ["video.read", "storage"], confirmed: false });
  assert.equal(unconfirmed.code, "SDK_GRANT_CONFIRMATION_REQUIRED");
  const created = await fixture.service.prepareSession({ scriptId: "draft_1", code, capabilities: ["storage", "video.read"], confirmed: true });
  assert.equal(created.ok, true);
  assert.equal(created.tabId, 9);
  assert.equal(created.origin, "https://example.com");
});

test("真实 SDK 视频和页面读取返回脱敏公开模型", async () => {
  const fixture = buildService();
  const created = await fixture.service.prepareSession({ scriptId: "draft_1", code, capabilities: ["video.read", "storage"], confirmed: true });
  const videos = await fixture.service.invoke(created.sessionToken, request("video.getAll"));
  assert.equal(videos.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(videos.value[0])), { id: "frame-0-media-1", frameId: 0, title: "Course", duration: 100, currentTime: 20, progress: 0.2, rate: 1, volume: 0.8, muted: false, paused: false, mediaType: "video", controlMode: "stopped" });
  const pageRequest = request("page.text");
  pageRequest.scriptId = "draft_1";
  const pageDenied = await fixture.service.invoke(created.sessionToken, pageRequest);
  assert.equal(pageDenied.code, "SDK_CAPABILITY_REQUIRED");
});

test("视频状态公开图片中的全部关键字段", async () => {
  const fixture = buildService();
  const created = await fixture.service.prepareSession({ scriptId: "draft_1", code: publicDataCode, capabilities: ["video.read", "qa.read", "ai.read"], confirmed: true });
  const status = await fixture.service.invoke(created.sessionToken, request("video.getStatus"));
  assert.equal(status.ok, true);
  assert.deepEqual({
    rate: status.value.rate,
    playbackState: status.value.playbackState,
    volume: status.value.volume,
    mediaCount: status.value.mediaCount,
    duration: status.value.duration,
    currentTime: status.value.currentTime,
    autoplay: status.value.autoplay,
    rateLocked: status.value.rateLocked
  }, { rate: 2, playbackState: "playing", volume: 0.8, mediaCount: 6, duration: 100, currentTime: 20, autoplay: false, rateLocked: true });
});

test("问题获取与 AI 回复通过独立只读能力公开", async () => {
  const fixture = buildService();
  const created = await fixture.service.prepareSession({ scriptId: "draft_1", code: publicDataCode, capabilities: ["video.read", "qa.read", "ai.read"], confirmed: true });
  const latestQuestion = await fixture.service.invoke(created.sessionToken, request("qa.latest"));
  assert.equal(latestQuestion.ok, true);
  assert.equal(latestQuestion.value.source, "voice");
  assert.equal(latestQuestion.value.text, "Voice text");
  const ocrQuestion = await fixture.service.invoke(created.sessionToken, request("qa.ocr"));
  assert.equal(ocrQuestion.value.text, "OCR text");
  const answer = await fixture.service.invoke(created.sessionToken, request("ai.latest"));
  assert.equal(answer.value.answer, "A");
  const history = await fixture.service.invoke(created.sessionToken, request("ai.history", [5]));
  assert.equal(history.value[0].limit, 5);
});

test("SDK Storage 通过会话按脚本隔离并可关闭会话", async () => {
  const fixture = buildService();
  const created = await fixture.service.prepareSession({ scriptId: "draft_1", code, capabilities: ["video.read", "storage"], confirmed: true });
  const saved = await fixture.service.invoke(created.sessionToken, request("storage.set", ["progress", 50]));
  assert.equal(saved.ok, true);
  const loaded = await fixture.service.invoke(created.sessionToken, request("storage.get", ["progress"]));
  assert.equal(loaded.value, 50);
  assert.equal((await fixture.service.getSessionStatus(created.sessionToken)).active, true);
  assert.equal((await fixture.service.closeSession(created.sessionToken)).revoked, true);
  assert.equal((await fixture.service.invoke(created.sessionToken, request("storage.get", ["progress"]))).code, "SDK_SESSION_NOT_FOUND");
});

test("后台方法参数校验不能被前端绕过", async () => {
  const fixture = buildService();
  const created = await fixture.service.prepareSession({ scriptId: "draft_1", code, capabilities: ["video.read", "storage"], confirmed: true });
  assert.equal((await fixture.service.invoke(created.sessionToken, request("video.setRate", [99]))).code, "SDK_INVALID_ARGUMENT");
  assert.equal((await fixture.service.invoke(created.sessionToken, request("storage.get", ["__proto__"]))).code, "SDK_INVALID_ARGUMENT");
});

test("SDK 会话并发创建和关闭不会覆盖其他会话", async () => {
  const fixture = buildService();
  const initial = await Promise.all(Array.from({ length: 50 }, (_, index) => fixture.service.prepareSession({
    scriptId: `draft_${index}`,
    code,
    capabilities: ["video.read", "storage"],
    confirmed: true
  })));
  assert.equal(initial.every((result) => result.ok), true);
  assert.equal(Object.keys(fixture.getSessions()).length, 50);

  const mutations = [];
  for (let index = 0; index < 25; index += 1) mutations.push(fixture.service.closeSession(initial[index].sessionToken));
  for (let index = 50; index < 75; index += 1) mutations.push(fixture.service.prepareSession({
    scriptId: `draft_${index}`,
    code,
    capabilities: ["video.read", "storage"],
    confirmed: true
  }));
  const results = await Promise.all(mutations);
  assert.equal(results.every((result) => result.ok), true);
  assert.equal(Object.keys(fixture.getSessions()).length, 50);
});

test("SDK 会话关闭传播令牌和 Session Storage 失败", async () => {
  const revokeFixture = buildService({ revokeFailure: true });
  const revokeCreated = await revokeFixture.service.prepareSession({ scriptId: "draft_revoke", code, capabilities: ["video.read", "storage"], confirmed: true });
  const revokeResult = await revokeFixture.service.closeSession(revokeCreated.sessionToken);
  assert.equal(revokeResult.code, "SDK_TOKEN_REVOKE_FAILED");
  assert.equal(Object.keys(revokeFixture.getSessions()).length, 1);

  const writeFixture = buildService();
  const writeCreated = await writeFixture.service.prepareSession({ scriptId: "draft_write", code, capabilities: ["video.read", "storage"], confirmed: true });
  writeFixture.setFailSessionWrites(true);
  const writeResult = await writeFixture.service.closeSession(writeCreated.sessionToken);
  assert.equal(writeResult.code, "SDK_SESSION_STORAGE_FAILED");
});

test("SDK 会话保存失败会撤销已创建的运行令牌", async () => {
  const fixture = buildService({ failSessionWrites: true });
  const result = await fixture.service.prepareSession({ scriptId: "draft_failed", code, capabilities: ["video.read", "storage"], confirmed: true });
  assert.equal(result.code, "SDK_SESSION_STORAGE_FAILED");
  assert.equal(fixture.revokedTokens.length, 1);
  assert.equal(Object.keys(fixture.getSessions()).length, 0);
});

test("SDK 可以统一撤销多个窗口创建的全部会话", async () => {
  const fixture = buildService();
  await Promise.all(["one", "two", "three"].map((id) => fixture.service.prepareSession({
    scriptId: `draft_${id}`,
    code,
    capabilities: ["video.read", "storage"],
    confirmed: true
  })));
  assert.equal(Object.keys(fixture.getSessions()).length, 3);
  const closed = await fixture.service.closeAllSessions();
  assert.equal(closed.ok, true);
  assert.equal(closed.revoked, 3);
  assert.equal(Object.keys(fixture.getSessions()).length, 0);
});

test("删除 SDK 草稿生命周期会同步清理会话、授权和隔离存储", async () => {
  const fixture = buildService();
  const created = await fixture.service.prepareSession({ scriptId: "draft_delete", code, capabilities: ["video.read", "storage"], confirmed: true });
  assert.equal(created.ok, true);
  await fixture.service.invoke(created.sessionToken, { ...request("storage.set", ["value", 1]), scriptId: "draft_delete" });
  const deleted = await fixture.service.deleteScriptLifecycle("draft_delete");
  assert.equal(deleted.ok, true);
  assert.equal(Object.keys(fixture.getSessions()).length, 0);
  const after = await fixture.service.invoke(created.sessionToken, { ...request("storage.get", ["value"]), scriptId: "draft_delete" });
  assert.equal(after.code, "SDK_SESSION_NOT_FOUND");
});

test("图书 SDK 使用独立 book.read 能力并返回稳定公开模型", async () => {
  const fixture = buildService();
  const created = await fixture.service.prepareSession({ scriptId: "draft_1", code: bookCode, capabilities: ["book.read"], confirmed: true });
  assert.equal(created.ok, true);

  const result = await fixture.service.invoke(created.sessionToken, request("book.getStatus"));
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.value)), {
    mode: "chaoxing",
    detected: true,
    reader: "chaoxing-pdg",
    page: "362",
    pageType: "5",
    pageTypeLabel: "正文页",
    currentOption: { detected: true, value: "5", label: "正文362页" },
    isBackCover: false,
    running: true,
    intervalSeconds: 2,
    monitor: {
      enabled: true,
      reached: false,
      checkIndex: 1,
      nextCheckAt: new Date(bookNextCheckAt).toISOString(),
      nextCheckSeconds: 300,
      sequenceSeconds: [400, 300, 250, 150, 50]
    }
  });

  const pageDenied = await fixture.service.invoke(created.sessionToken, request("page.text"));
  assert.equal(pageDenied.code, "SDK_CAPABILITY_REQUIRED");
});
