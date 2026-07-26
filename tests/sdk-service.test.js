const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const code = `// ==UserScript==\n// @name Test\n// @version 1.0.0\n// @wsb-capability video.read\n// @wsb-capability storage\n// ==/UserScript==`;
const bookCode = `// ==UserScript==\n// @name Book Test\n// @version 1.0.0\n// @wsb-capability book.read\n// ==/UserScript==`;
const bookControlOnlyCode = `// ==UserScript==\n// @name Book Control Only Test\n// @version 1.0.0\n// @wsb-capability book.control\n// ==/UserScript==`;
const videoControlCode = `// ==UserScript==\n// @name Video Control Test\n// @version 1.0.0\n// @wsb-capability video.control\n// ==/UserScript==`;
const publicDataCode = `// ==UserScript==\n// @name Public Data Test\n// @version 1.0.0\n// @wsb-capability video.read\n// @wsb-capability qa.read\n// @wsb-capability ai.read\n// ==/UserScript==`;
const bookNextCheckAt = Date.UTC(2026, 6, 17, 12, 0, 0);

function storedSession(overrides = {}) {
  return Object.assign({
    scriptId: "stored_script",
    tabId: 9,
    origin: "https://example.com",
    originPattern: "https://example.com/*",
    url: "https://example.com/course",
    bookMode: "",
    ownerSessionId: "sdk_owner_stored",
    sdkVersion: "3.7.0-beta",
    codeHash: "a".repeat(64),
    grantFingerprint: "b".repeat(64),
    issuedAt: Date.now(),
    persistent: true
  }, overrides);
}

function buildService(options = {}) {
  let sessions = JSON.parse(JSON.stringify(options.initialSessions || {}));
  let grantedCapabilities = [];
  let tokenSequence = 0;
  let failSessionWrites = options.failSessionWrites === true;
  let readSessionFailures = Math.max(0, Number(options.readSessionFailures) || 0);
  let readSessionCount = 0;
  const revokedTokens = [];
  const storageValues = {};
  const videoCommands = [];
  const bookCommands = [];
  const releasedBookResources = [];
  const contextConsumptions = [];
  const validatedContexts = [];
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
        return Promise.resolve({ ok: true, token: "wsb_rt_" + tokenSequence.toString(16).padStart(64, "0"), issuedAt: Date.now(), persistent: true });
      },
      validateRuntimeToken(token, value) {
        if (typeof options.validateRuntimeToken === "function") {
          return Promise.resolve(options.validateRuntimeToken(token, value, grantedCapabilities.slice()));
        }
        return Promise.resolve(grantedCapabilities.includes(value.capability) ? { ok: true, valid: true } : { ok: false, code: "SDK_CAPABILITY_REQUIRED", error: "missing" });
      },
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
    consumeContext(nonce, capabilities, bookMode) {
      const normalizedCapabilities = Array.from(capabilities || []);
      const hasBookCapability = normalizedCapabilities.some((capability) => String(capability).startsWith("book."));
      contextConsumptions.push({ nonce, capabilities: normalizedCapabilities, bookMode });
      if (hasBookCapability && !["book", "image", "chaoxing"].includes(bookMode)) {
        return Promise.resolve({ ok: false, code: "SDK_BOOK_MODE_REQUIRED", error: "book mode required" });
      }
      if (!hasBookCapability && bookMode != null && bookMode !== "") {
        return Promise.resolve({ ok: false, code: "SDK_BOOK_MODE_NOT_ALLOWED", error: "book mode not allowed" });
      }
      const resolvedContext = {
        ok: true,
        tabId: options.noTab ? null : 9,
        origin: "https://example.com",
        originPattern: "https://example.com/*",
        url: "https://example.com/course",
        bookMode: hasBookCapability ? bookMode : ""
      };
      if (typeof options.consumeContextGate === "function") {
        return Promise.resolve(options.consumeContextGate()).then(() => resolvedContext);
      }
      return Promise.resolve(resolvedContext);
    },
    validateContext(session) {
      validatedContexts.push({
        tabId: session && session.tabId,
        origin: session && session.origin,
        originPattern: session && session.originPattern
      });
      if ((options.contextValidationRejectTabIds || []).includes(session && session.tabId)) {
        return Promise.reject(new Error("context validation failed"));
      }
      if ((options.invalidContextTabIds || []).includes(session && session.tabId)) {
        return Promise.resolve({ ok: false, code: "SDK_CONTEXT_CLOSED", error: "tab context changed" });
      }
      return Promise.resolve({ ok: true });
    },
    controlTab(tabId, command, callback, boundContext) {
      videoCommands.push({
        tabId,
        command: JSON.parse(JSON.stringify(command)),
        boundContext: JSON.parse(JSON.stringify(boundContext || null))
      });
      if (options.videoFailureType === command.type) {
        callback({
          ok: false,
          code: "VIDEO_RATE_UNSTABLE",
          error: "control failed",
          duration: 600,
          currentTime: 321,
          remainingTime: 279,
          frameCount: 4,
          frameResults: [{ title: "private title" }],
          playerType: "private player"
        });
        return;
      }
      if (command.type === "GET_MEDIA_LIST") callback({ ok: true, media: [{ id: "frame-0-media-1", frameId: 0, title: "Course", duration: 100, currentTime: 20, rate: 1, volume: 0.8, muted: false, paused: false, mediaType: "video" }] });
      else if (command.type === "EXTRACT_PAGE_TEXT") callback({ ok: true, frameResults: [{ ok: true, title: "Course", url: "https://example.com/course", text: "Lesson text" }] });
      else callback({
        ok: true, duration: 100, currentTime: 20, remainingTime: 80, rate: 2, targetRate: 2, volume: 0.8,
        muted: false, paused: false, mediaTag: "video", mediaCount: 6, frameCount: 2, rateLocked: true,
        rateStable: true, continuousPlayback: false, keepPlaying: true, playerType: "HTML5 强控制", controlMode: "apply"
      });
    },
    controlBook(session, command, callback) {
      bookCommands.push({
        scriptId: session.scriptId,
        tabId: session.tabId,
        originPattern: session.originPattern,
        ownerSessionId: session.ownerSessionId,
        runtimeToken: session.runtimeToken,
        command: JSON.parse(JSON.stringify(command))
      });
      callback({
        ok: true,
        mode: command.mode || "chaoxing",
        detected: true,
        reader: "chaoxing-pdg",
        readerEngine: "jpath-readweb",
        title: "private book title",
        frameUrl: "https://reader.example/private",
        selector: "#private-reader",
        diagnostics: { frames: ["private"] },
        page: "362",
        pageType: "5",
        pageTypeLabel: "正文页",
        imageIndex: 4,
        imageCount: 20,
        canPrev: true,
        canNext: true,
        method: command.command === "GET_STATUS" ? "" : "browser-native-click",
        pageJumpDetected: true,
        pageJumpValue: "5",
        pageJumpLabel: "正文362页",
        isBackCover: false,
        running: true,
        interval: command.interval || 2,
        backCoverCheckEnabled: true,
        backCoverReached: false,
        backCoverCheckIndex: 1,
        backCoverCheckDueAt: bookNextCheckAt,
        backCoverNextCheckSeconds: 300,
        backCoverCheckSequence: [400, 300, 250, 150, 50]
      });
    },
    releaseBookResources(owner) {
      releasedBookResources.push(JSON.parse(JSON.stringify(owner)));
      return Promise.resolve(options.bookCleanupFailure
        ? { ok: false, code: "SDK_BOOK_CLEANUP_FAILED", error: "cleanup failed" }
        : { ok: true });
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
    readSessions() {
      readSessionCount += 1;
      if (readSessionFailures > 0) {
        readSessionFailures -= 1;
        return Promise.reject({ ok: false, code: "SDK_SESSION_STORAGE_FAILED", error: "read failed" });
      }
      return Promise.resolve(JSON.parse(JSON.stringify(sessions)));
    },
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
    setReadSessionFailures(value) { readSessionFailures = Math.max(0, Number(value) || 0); },
    getReadSessionCount() { return readSessionCount; },
    revokedTokens,
    videoCommands,
    bookCommands,
    releasedBookResources,
    contextConsumptions,
    validatedContexts
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
  assert.equal(created.persistent, true);
  assert.equal(Object.prototype.hasOwnProperty.call(created, "expiresAt"), false);
  assert.equal(fixture.getSessions()[created.sessionToken].originPattern, "https://example.com/*");
  assert.equal(fixture.getSessions()[created.sessionToken].persistent, true);
  assert.equal(Object.prototype.hasOwnProperty.call(fixture.getSessions()[created.sessionToken], "expiresAt"), false);
});

test("SDK 会话创建只允许图书能力携带已确认的阅读模式", async () => {
  const fixture = buildService();
  const missingBookMode = await fixture.service.prepareSession({
    scriptId: "draft_book_missing",
    code: bookCode,
    capabilities: ["book.read"],
    confirmed: true
  });
  assert.equal(missingBookMode.ok, false);

  const extraBookMode = await fixture.service.prepareSession({
    scriptId: "draft_video_extra",
    code,
    capabilities: ["video.read", "storage"],
    bookMode: "image",
    confirmed: true
  });
  assert.equal(extraBookMode.ok, false);
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

test("视频自动播放、倍速锁定和重置接口映射到现有原生控制命令", async () => {
  const fixture = buildService();
  const created = await fixture.service.prepareSession({
    scriptId: "draft_1",
    code: videoControlCode,
    capabilities: ["video.control"],
    confirmed: true
  });
  assert.equal(created.ok, true);
  const controlValues = [];
  for (const [method, args] of [
    ["video.setAutoplay", [true]],
    ["video.setAutoplay", [false]],
    ["video.setRateLock", [true]],
    ["video.setRateLock", [false]],
    ["video.reset", []]
  ]) {
    const result = await fixture.service.invoke(created.sessionToken, request(method, args));
    assert.equal(result.ok, true, method);
    controlValues.push(result.value);
  }
  assert.deepEqual(fixture.videoCommands.map((item) => item.command.type), [
    "ENABLE_AUTOPLAY",
    "DISABLE_AUTOPLAY",
    "ENABLE_RATE_LOCK",
    "DISABLE_RATE_LOCK",
    "RESET"
  ]);
  const allowedFields = ["action", "applied", "rate", "volume", "muted", "autoplay", "rateLocked"];
  for (const value of controlValues) {
    assert.deepEqual(Object.keys(value), allowedFields);
    for (const readField of ["id", "frameId", "title", "duration", "currentTime", "progress", "mediaType", "mediaCount", "frameCount", "remainingTime", "playing", "playbackState", "playerType"]) {
      assert.equal(Object.prototype.hasOwnProperty.call(value, readField), false, readField);
    }
  }
  assert.deepEqual(controlValues.map((value) => value.action), ["auto", "auto", "lock", "lock", "reset"]);
  assert.equal(fixture.videoCommands.every((item) => item.tabId === 9), true);
  assert.equal(fixture.videoCommands.every((item) => item.boundContext.origin === "https://example.com"), true);
  assert.equal(fixture.videoCommands.every((item) => item.boundContext.originPattern === "https://example.com/*"), true);
});

test("仅声明视频控制时失败回执不会泄露只读媒体字段", async () => {
  const fixture = buildService({ videoFailureType: "SET_RATE" });
  const created = await fixture.service.prepareSession({
    scriptId: "draft_1",
    code: videoControlCode,
    capabilities: ["video.control"],
    confirmed: true
  });
  const result = await fixture.service.invoke(created.sessionToken, request("video.setRate", [2]));
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    ok: false,
    code: "VIDEO_RATE_UNSTABLE",
    error: "control failed"
  });
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
  assert.equal(fixture.validatedContexts.length, 4);
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

  const cleanupFixture = buildService({ bookCleanupFailure: true });
  const cleanupCreated = await cleanupFixture.service.prepareSession({
    scriptId: "draft_cleanup",
    code: bookControlOnlyCode,
    capabilities: ["book.control"],
    confirmed: true,
    bookMode: "chaoxing"
  });
  const cleanupResult = await cleanupFixture.service.closeSession(cleanupCreated.sessionToken);
  assert.equal(cleanupResult.code, "SDK_BOOK_CLEANUP_FAILED");
  assert.equal(cleanupResult.resourceCleanupOk, false);
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

test("图书 SDK 使用独立 book.read 能力、绑定阅读模式并返回稳定公开模型", async () => {
  const fixture = buildService();
  const created = await fixture.service.prepareSession({
    scriptId: "draft_1",
    code: bookCode,
    capabilities: ["book.read"],
    bookMode: "chaoxing",
    confirmed: true
  });
  assert.equal(created.ok, true);
  assert.equal(created.bookMode, "chaoxing");
  assert.equal(fixture.getSessions()[created.sessionToken].bookMode, "chaoxing");
  assert.equal(fixture.contextConsumptions[0].bookMode, "chaoxing");

  const result = await fixture.service.invoke(created.sessionToken, request("book.getStatus"));
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.value)), {
    mode: "chaoxing",
    detected: true,
    reader: "chaoxing-pdg",
    readerEngine: "jpath-readweb",
    page: "362",
    pageType: "5",
    imageIndex: 4,
    imageCount: 20,
    canPrev: true,
    canNext: true,
    method: "",
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
  for (const privateField of ["title", "frameUrl", "selector", "diagnostics"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(result.value, privateField), false, privateField);
  }

  const crossModeRead = await fixture.service.invoke(created.sessionToken, request("book.getStatus", ["book"]));
  assert.equal(crossModeRead.code, "BOOK_MODE_NOT_AUTHORIZED");
  const pageDenied = await fixture.service.invoke(created.sessionToken, request("page.text"));
  assert.equal(pageDenied.code, "SDK_CAPABILITY_REQUIRED");
  const controlDenied = await fixture.service.invoke(created.sessionToken, request("book.turnNext", ["book"]));
  assert.equal(controlDenied.code, "SDK_CAPABILITY_REQUIRED");
});

test("图书控制接口把短方法转换为绑定标签页的后台命令", async () => {
  const fixture = buildService();
  const created = await fixture.service.prepareSession({
    scriptId: "draft_1",
    code: bookControlOnlyCode,
    capabilities: ["book.control"],
    bookMode: "book",
    confirmed: true
  });
  assert.equal(created.ok, true);
  const controlValues = [];
  for (const [method, args] of [
    ["book.turnPrev", ["book"]],
    ["book.turnNext", ["book"]],
    ["book.startAuto", [{ mode: "book", intervalSeconds: 45 }]],
    ["book.stopAuto", []],
    ["book.setInterval", [60, "book"]]
  ]) {
    const result = await fixture.service.invoke(created.sessionToken, request(method, args));
    assert.equal(result.ok, true, method);
    controlValues.push(result.value);
  }
  assert.deepEqual(fixture.bookCommands.map((item) => item.command), [
    { command: "PREV", mode: "book" },
    { command: "NEXT", mode: "book" },
    { command: "START", mode: "book", interval: 45 },
    { command: "STOP", mode: "book" },
    { command: "SET_INTERVAL", interval: 60, mode: "book" }
  ]);
  const allowedControlFields = ["action", "mode", "running", "intervalSeconds", "method"];
  for (const value of controlValues) {
    assert.deepEqual(Object.keys(value), allowedControlFields);
    for (const sensitiveField of ["detected", "reader", "readerEngine", "page", "pageType", "pageTypeLabel", "imageIndex", "imageCount", "canPrev", "canNext", "currentOption", "monitor", "title", "frameUrl", "selector", "diagnostics"]) {
      assert.equal(Object.prototype.hasOwnProperty.call(value, sensitiveField), false, sensitiveField);
    }
  }
  assert.deepEqual(controlValues.map((value) => value.action), ["prev", "next", "start", "stop", "interval"]);
  assert.equal(fixture.bookCommands.every((item) => item.tabId === 9), true);
  assert.equal(fixture.bookCommands.every((item) => item.originPattern === "https://example.com/*"), true);
  assert.equal(fixture.bookCommands.every((item) => item.ownerSessionId === fixture.getSessions()[created.sessionToken].ownerSessionId), true);
  assert.equal(fixture.bookCommands.every((item) => item.runtimeToken === created.sessionToken), true);

  for (const [method, args] of [
    ["book.turnPrev", ["image"]],
    ["book.turnNext", ["chaoxing"]],
    ["book.startAuto", [{ mode: "image", intervalSeconds: 45 }]],
    ["book.setInterval", [60, "image"]]
  ]) {
    const denied = await fixture.service.invoke(created.sessionToken, request(method, args));
    assert.equal(denied.code, "BOOK_MODE_NOT_AUTHORIZED", method);
  }
  assert.equal(fixture.bookCommands.length, 5);

  const statusDenied = await fixture.service.invoke(created.sessionToken, request("book.getStatus"));
  assert.equal(statusDenied.code, "SDK_CAPABILITY_REQUIRED");
  const pageDenied = await fixture.service.invoke(created.sessionToken, request("page.text"));
  assert.equal(pageDenied.code, "SDK_CAPABILITY_REQUIRED");
});

test("图书控制接口拒绝没有授权标签页的会话", async () => {
  const fixture = buildService({ noTab: true });
  const created = await fixture.service.prepareSession({
    scriptId: "draft_1",
    code: bookControlOnlyCode,
    capabilities: ["book.control"],
    bookMode: "book",
    confirmed: true
  });
  assert.equal(created.ok, true);
  const denied = await fixture.service.invoke(created.sessionToken, request("book.turnNext", ["book"]));
  assert.equal(denied.code, "SDK_TAB_REQUIRED");
  assert.equal(fixture.bookCommands.length, 0);
});

test("同一脚本的新会话替换旧会话并清理旧图书资源", async () => {
  const fixture = buildService();
  const first = await fixture.service.prepareSession({
    scriptId: "draft_1",
    code: bookControlOnlyCode,
    capabilities: ["book.control"],
    bookMode: "book",
    confirmed: true
  });
  assert.equal(first.ok, true);
  const firstOwner = fixture.getSessions()[first.sessionToken].ownerSessionId;

  const second = await fixture.service.prepareSession({
    scriptId: "draft_1",
    code: bookControlOnlyCode,
    capabilities: ["book.control"],
    bookMode: "book",
    confirmed: true
  });
  assert.equal(second.ok, true);
  const secondOwner = fixture.getSessions()[second.sessionToken].ownerSessionId;
  assert.match(firstOwner, /^sdk_owner_[A-Za-z0-9]+$/);
  assert.match(secondOwner, /^sdk_owner_[A-Za-z0-9]+$/);
  assert.notEqual(firstOwner, secondOwner);
  assert.deepEqual(Object.keys(fixture.getSessions()), [second.sessionToken]);
  assert.deepEqual(fixture.releasedBookResources[0], {
    scriptId: "draft_1",
    tabId: 9,
    ownerSessionId: firstOwner
  });

  const oldRequest = request("book.turnNext", ["book"]);
  assert.equal((await fixture.service.invoke(first.sessionToken, oldRequest)).code, "SDK_SESSION_NOT_FOUND");
  assert.equal(Object.prototype.hasOwnProperty.call(fixture.getSessions(), second.sessionToken), true);

  assert.equal((await fixture.service.closeSession(second.sessionToken)).ok, true);
  assert.deepEqual(fixture.releasedBookResources[1], {
    scriptId: "draft_1",
    tabId: 9,
    ownerSessionId: secondOwner
  });
});

test("长期 SDK 会话不会因旧到期字段或时间流逝被清理", async () => {
  const persistentToken = "wsb_rt_" + "d".repeat(64);
  const fixture = buildService({
    initialSessions: {
      [persistentToken]: storedSession({ expiresAt: Date.now() - 24 * 60 * 60 * 1000 })
    }
  });
  const pruned = await fixture.service.pruneSessions();
  assert.equal(pruned.ok, true);
  assert.equal(pruned.removed, 0);
  const status = await fixture.service.getSessionStatus(persistentToken);
  assert.equal(status.ok, true);
  assert.equal(status.active, true);
  assert.equal(status.persistent, true);
  assert.equal(Object.prototype.hasOwnProperty.call(status, "expiresAt"), false);
  assert.equal(fixture.revokedTokens.length, 0);
});

test("SDK 会话会清理旧限时记录并限制长期有效会话数量", async () => {
  const legacyToken = "wsb_rt_" + "e".repeat(64);
  const legacyFixture = buildService({
    initialSessions: {
      [legacyToken]: storedSession({
        scriptId: "expired_script",
        ownerSessionId: "sdk_owner_expired",
        persistent: false,
        expiresAt: Date.now() - 1
      })
    }
  });
  const pruned = await legacyFixture.service.pruneSessions();
  assert.equal(pruned.ok, true);
  assert.equal(pruned.removed, 1);
  assert.deepEqual(legacyFixture.getSessions(), {});
  assert.equal(legacyFixture.revokedTokens.includes(legacyToken), true);
  assert.deepEqual(legacyFixture.releasedBookResources[0], {
    scriptId: "expired_script",
    tabId: 9,
    ownerSessionId: "sdk_owner_expired"
  });

  const fullSessions = {};
  for (let index = 0; index < 50; index += 1) {
    fullSessions["wsb_rt_" + (index + 100).toString(16).padStart(64, "0")] = storedSession({
      scriptId: `other_${index}`,
      ownerSessionId: `sdk_owner_${index}`
    });
  }
  const fullFixture = buildService({ initialSessions: fullSessions });
  const denied = await fullFixture.service.prepareSession({
    scriptId: "draft_1",
    code,
    capabilities: ["video.read", "storage"],
    confirmed: true
  });
  assert.equal(denied.code, "SDK_SESSION_LIMIT_REACHED");
  assert.equal(Object.keys(fullFixture.getSessions()).length, 50);
  assert.equal(fullFixture.revokedTokens.length, 1);
});

test("按标签页关闭会话会保留同源刷新并清理跨来源与关闭标签页的资源", async () => {
  const sameOriginToken = "wsb_rt_" + "1".repeat(64);
  const oldOriginToken = "wsb_rt_" + "2".repeat(64);
  const otherTabToken = "wsb_rt_" + "3".repeat(64);
  const fixture = buildService({
    initialSessions: {
      [sameOriginToken]: storedSession({
        scriptId: "same_origin",
        ownerSessionId: "sdk_owner_sameorigin"
      }),
      [oldOriginToken]: storedSession({
        scriptId: "old_origin",
        origin: "https://old.example.org",
        originPattern: "https://old.example.org/*",
        url: "https://old.example.org/course",
        ownerSessionId: "sdk_owner_oldorigin"
      }),
      [otherTabToken]: storedSession({
        scriptId: "other_tab",
        tabId: 10,
        ownerSessionId: "sdk_owner_othertab"
      })
    }
  });

  const navigated = await fixture.service.closeSessionsForTab(9, "https://example.com");
  assert.deepEqual(JSON.parse(JSON.stringify(navigated)), {
    ok: true,
    tabId: 9,
    closed: 1,
    revoked: 1
  });
  assert.deepEqual(Object.keys(fixture.getSessions()).sort(), [otherTabToken, sameOriginToken].sort());
  assert.deepEqual(fixture.releasedBookResources[0], {
    scriptId: "old_origin",
    tabId: 9,
    ownerSessionId: "sdk_owner_oldorigin"
  });

  const removed = await fixture.service.closeSessionsForTab(9);
  assert.equal(removed.ok, true);
  assert.equal(removed.closed, 1);
  assert.deepEqual(Object.keys(fixture.getSessions()), [otherTabToken]);
  assert.deepEqual(fixture.revokedTokens, [oldOriginToken, sameOriginToken]);

  assert.equal((await fixture.service.closeSessionsForTab(-1)).code, "SDK_TAB_INVALID");
  assert.equal((await fixture.service.closeSessionsForTab(10, "not-an-origin")).code, "SDK_ORIGIN_INVALID");
});

test("标签页回收与并发会话创建使用同一生命周期队列", async () => {
  const fixture = buildService();
  const creating = fixture.service.prepareSession({
    scriptId: "draft_concurrent_tab",
    code,
    capabilities: ["video.read", "storage"],
    confirmed: true
  });
  const closing = fixture.service.closeSessionsForTab(9);
  const [created, closed] = await Promise.all([creating, closing]);
  assert.equal(created.ok, true);
  assert.equal(closed.ok, true);
  assert.equal(closed.closed, 1);
  assert.deepEqual(fixture.getSessions(), {});
  assert.equal(fixture.revokedTokens.includes(created.sessionToken), true);
});

test("会话确认期间发生生命周期撤销会保守拒绝创建", async () => {
  let releaseContext;
  let contextEntered;
  const entered = new Promise((resolve) => { contextEntered = resolve; });
  const contextGate = new Promise((resolve) => { releaseContext = resolve; });
  const fixture = buildService({
    consumeContextGate() {
      contextEntered();
      return contextGate;
    }
  });
  const preparing = fixture.service.prepareSession({
    scriptId: "draft_context_race",
    code,
    capabilities: ["video.read", "storage"],
    confirmed: true
  });
  await entered;
  const closing = fixture.service.closeSessionsForTab(9);
  releaseContext();
  const [created, closed] = await Promise.all([preparing, closing]);
  assert.equal(created.code, "SDK_CONTEXT_CHANGED");
  assert.equal(closed.ok, true);
  assert.equal(closed.closed, 0);
  assert.deepEqual(fixture.getSessions(), {});
});

test("会话读取暂时失败会重试恢复，持续失败会显式报错并保守阻断旧会话", async () => {
  const recoverToken = "wsb_rt_" + "c".repeat(64);
  const recoverFixture = buildService({
    readSessionFailures: 2,
    initialSessions: {
      [recoverToken]: storedSession({
        scriptId: "recover_read",
        ownerSessionId: "sdk_owner_recoverread"
      })
    }
  });
  const recovered = await recoverFixture.service.closeSessionsForTab(9);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.closed, 1);
  assert.equal(recoverFixture.getReadSessionCount(), 3);
  assert.deepEqual(recoverFixture.getSessions(), {});

  const blockedToken = "wsb_rt_" + "f".repeat(64);
  const blockedFixture = buildService({
    readSessionFailures: 10,
    initialSessions: {
      [blockedToken]: storedSession({
        scriptId: "draft_1",
        ownerSessionId: "sdk_owner_blockedread"
      })
    }
  });
  const failed = await blockedFixture.service.closeSessionsForTab(9);
  assert.equal(failed.ok, false);
  assert.equal(failed.code, "SDK_SESSION_STORAGE_FAILED");
  assert.equal(blockedFixture.getReadSessionCount(), 3);
  assert.equal(Object.keys(blockedFixture.getSessions()).length, 1);

  blockedFixture.setReadSessionFailures(0);
  const invoked = await blockedFixture.service.invoke(blockedToken, request("storage.get", ["progress"]));
  assert.equal(invoked.code, "SDK_SESSION_REVOKED");
});

test("撤销到达后会阻断已通过会话读取但尚未分发的非页面调用", async () => {
  let releaseValidation;
  let validationEntered;
  const entered = new Promise((resolve) => { validationEntered = resolve; });
  const validationGate = new Promise((resolve) => { releaseValidation = resolve; });
  const fixture = buildService({
    validateRuntimeToken() {
      validationEntered();
      return validationGate.then(() => ({ ok: true, valid: true }));
    }
  });
  const created = await fixture.service.prepareSession({
    scriptId: "draft_1",
    code,
    capabilities: ["video.read", "storage"],
    confirmed: true
  });
  const invoking = fixture.service.invoke(created.sessionToken, request("storage.set", ["race", 1]));
  await entered;
  const closing = fixture.service.closeSessionsForTab(9);
  releaseValidation();
  const [invokeResult, closeResult] = await Promise.all([invoking, closing]);
  assert.equal(invokeResult.code, "SDK_SESSION_REVOKED");
  assert.equal(closeResult.ok, true);
  assert.deepEqual(fixture.getSessions(), {});
});

test("同草稿替换会撤销旧的并发调用且新会话不受旧 tombstone 影响", async () => {
  let releaseValidation;
  let validationEntered;
  let gateEnabled = false;
  const entered = new Promise((resolve) => { validationEntered = resolve; });
  const validationGate = new Promise((resolve) => { releaseValidation = resolve; });
  const fixture = buildService({
    validateRuntimeToken() {
      if (!gateEnabled) return { ok: true, valid: true };
      validationEntered();
      return validationGate.then(() => ({ ok: true, valid: true }));
    }
  });
  const first = await fixture.service.prepareSession({
    scriptId: "draft_1",
    code,
    capabilities: ["video.read", "storage"],
    confirmed: true
  });
  gateEnabled = true;
  const oldInvocation = fixture.service.invoke(first.sessionToken, request("storage.get", ["progress"]));
  await entered;
  const second = await fixture.service.prepareSession({
    scriptId: "draft_1",
    code,
    capabilities: ["video.read", "storage"],
    confirmed: true
  });
  assert.equal(second.ok, true);
  releaseValidation();
  assert.equal((await oldInvocation).code, "SDK_SESSION_REVOKED");
  const newInvocation = await fixture.service.invoke(second.sessionToken, request("storage.get", ["progress"]));
  assert.equal(newInvocation.ok, true);
});

test("按来源权限撤销长期会话支持通配来源且保留无关来源", async () => {
  const httpsToken = "wsb_rt_" + "4".repeat(64);
  const httpToken = "wsb_rt_" + "5".repeat(64);
  const otherToken = "wsb_rt_" + "6".repeat(64);
  const localToken = "wsb_rt_" + "7".repeat(64);
  const fixture = buildService({
    initialSessions: {
      [httpsToken]: storedSession({
        scriptId: "https_subdomain",
        origin: "https://study.example.com",
        originPattern: "https://study.example.com/*",
        url: "https://study.example.com/course",
        ownerSessionId: "sdk_owner_httpssubdomain"
      }),
      [httpToken]: storedSession({
        scriptId: "http_root",
        origin: "http://example.com",
        originPattern: "http://example.com/*",
        url: "http://example.com/course",
        ownerSessionId: "sdk_owner_httproot"
      }),
      [otherToken]: storedSession({
        scriptId: "other_origin",
        origin: "https://other.test",
        originPattern: "https://other.test/*",
        url: "https://other.test/course",
        ownerSessionId: "sdk_owner_otherorigin"
      }),
      [localToken]: storedSession({
        scriptId: "local_session",
        tabId: null,
        origin: "https://developer-mode.local",
        originPattern: "https://developer-mode.local/*",
        url: "https://developer-mode.local/",
        ownerSessionId: "sdk_owner_localsession"
      })
    }
  });

  const result = await fixture.service.closeSessionsForOrigins(["*://*.example.com/*"]);
  assert.equal(result.ok, true);
  assert.equal(result.originCount, 1);
  assert.equal(result.closed, 2);
  assert.equal(result.revoked, 2);
  assert.deepEqual(Object.keys(fixture.getSessions()).sort(), [localToken, otherToken].sort());
  assert.deepEqual(fixture.revokedTokens.sort(), [httpToken, httpsToken].sort());
  const allOrigins = await fixture.service.closeSessionsForOrigins(["<all_urls>"]);
  assert.equal(allOrigins.ok, true);
  assert.equal(allOrigins.closed, 1);
  assert.deepEqual(Object.keys(fixture.getSessions()), [localToken]);
  assert.equal(fixture.revokedTokens.includes(otherToken), true);
  assert.equal(fixture.revokedTokens.includes(localToken), false);
  assert.equal((await fixture.service.closeSessionsForOrigins([])).code, "SDK_ORIGIN_SCOPE_INVALID");
  assert.equal((await fixture.service.closeSessionsForOrigins(["javascript://example.com/*"])).code, "SDK_ORIGIN_SCOPE_INVALID");
});

test("标签页批量回收会尝试全部清理并传播令牌、图书与存储错误", async () => {
  const token = "wsb_rt_" + "8".repeat(64);
  const initialSessions = {
    [token]: storedSession({
      scriptId: "cleanup_errors",
      ownerSessionId: "sdk_owner_cleanuperrors"
    })
  };

  const revokeFixture = buildService({ initialSessions, revokeFailure: true });
  const revokeResult = await revokeFixture.service.closeSessionsForTab(9);
  assert.equal(revokeResult.code, "SDK_TOKEN_REVOKE_FAILED");
  assert.equal(revokeResult.closed, 1);
  assert.equal(revokeResult.revoked, 0);
  assert.deepEqual(revokeFixture.getSessions(), {});
  assert.equal(revokeFixture.releasedBookResources.length, 1);

  const bookFixture = buildService({ initialSessions, bookCleanupFailure: true });
  const bookResult = await bookFixture.service.closeSessionsForTab(9);
  assert.equal(bookResult.code, "SDK_BOOK_CLEANUP_FAILED");
  assert.equal(bookResult.closed, 1);
  assert.equal(bookResult.revoked, 1);
  assert.equal(bookResult.resourceCleanupOk, false);
  assert.deepEqual(bookFixture.getSessions(), {});

  const storageFixture = buildService({ initialSessions, failSessionWrites: true });
  const storageResult = await storageFixture.service.closeSessionsForTab(9);
  assert.equal(storageResult.code, "SDK_SESSION_STORAGE_FAILED");
  assert.equal(storageResult.closed, 0);
  assert.equal(storageResult.revoked, 1);
  assert.equal(Object.keys(storageFixture.getSessions()).length, 1);
});

test("启动清理验证标签页存在、顶层来源和网站权限并保留纯本地会话", async () => {
  const validToken = "wsb_rt_" + "9".repeat(64);
  const invalidToken = "wsb_rt_" + "a".repeat(64);
  const localToken = "wsb_rt_" + "b".repeat(64);
  const fixture = buildService({
    invalidContextTabIds: [10],
    initialSessions: {
      [validToken]: storedSession({
        scriptId: "valid_tab",
        ownerSessionId: "sdk_owner_validtab"
      }),
      [invalidToken]: storedSession({
        scriptId: "closed_tab",
        tabId: 10,
        ownerSessionId: "sdk_owner_closedtab"
      }),
      [localToken]: storedSession({
        scriptId: "local_only",
        tabId: null,
        origin: "https://developer-mode.local",
        originPattern: "https://developer-mode.local/*",
        url: "https://developer-mode.local/",
        ownerSessionId: "sdk_owner_localonly"
      })
    }
  });

  const pruned = await fixture.service.pruneSessions();
  assert.equal(pruned.ok, true);
  assert.equal(pruned.removed, 1);
  assert.equal(pruned.revoked, 1);
  assert.deepEqual(Object.keys(fixture.getSessions()).sort(), [localToken, validToken].sort());
  assert.deepEqual(fixture.validatedContexts.map((entry) => entry.tabId), [9, 10]);
  assert.equal(fixture.revokedTokens.includes(invalidToken), true);
});
