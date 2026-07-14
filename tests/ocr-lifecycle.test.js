const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function buildService(options = {}) {
  const data = {
    manualCaptureTime: 100,
    ocrJobSourceTime: 100,
    autoSendOcrToAi: false,
    ocrCancelledSourceTime: 0
  };
  let contexts = [{ contextType: "OFFSCREEN_DOCUMENT" }];
  let closeCount = 0;
  let aiCallCount = 0;
  const storage = {
    get(keys, callback) {
      const result = {};
      for (const key of keys) if (Object.prototype.hasOwnProperty.call(data, key)) result[key] = data[key];
      callback(result);
    },
    set(value, callback) { Object.assign(data, value); if (callback) callback({ ok: true }); },
    appendLog() {},
    getLatestCapture() { return Promise.resolve(options.capture || null); }
  };
  const chrome = {
    runtime: {
      id: "extension-id",
      lastError: null,
      getURL: (file) => `chrome-extension://extension-id/${file}`,
      getContexts: () => Promise.resolve(contexts.slice()),
      sendMessage(message, callback) { callback({ ok: true }); }
    },
    offscreen: {
      createDocument() { contexts = [{ contextType: "OFFSCREEN_DOCUMENT" }]; return Promise.resolve(); },
      closeDocument() { closeCount += 1; contexts = []; return Promise.resolve(); }
    }
  };
  const context = {
    self: {
      WinSpeedBallStorageService: storage,
      WinSpeedBallAiService: {
        call(payload, callback) {
          aiCallCount += 1;
          callback({ ok: true, content: "AI", model: "test" });
        }
      },
      WinSpeedBallFeatureGate: {
        check(feature) {
          assert.equal(feature, "ai.basic");
          return Promise.resolve(options.aiAllowed === false
            ? { ok: true, allowed: false, reason: "disabled for test" }
            : { ok: true, allowed: true });
        }
      }
    },
    chrome,
    Promise,
    Object,
    Array,
    String,
    Number,
    Date,
    Math,
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/ocr-service.js"), "utf8"), context);
  return {
    service: context.self.WinSpeedBallOcrService,
    data,
    getCloseCount: () => closeCount,
    getAiCallCount: () => aiCallCount,
    setContexts(value) { contexts = value.slice(); }
  };
}

test("OCR 完成或失败后关闭空闲离屏文档", async () => {
  const complete = buildService();
  complete.service.handleComplete({ sourceTime: 100, text: "recognized" });
  await flush();
  assert.equal(complete.data.manualOcrText, "recognized");
  assert.equal(complete.getCloseCount(), 1);

  const failed = buildService();
  failed.service.handleFailed({ sourceTime: 100, error: "failed" });
  await flush();
  assert.equal(failed.data.ocrJobStatus, "failed");
  assert.equal(failed.getCloseCount(), 1);
});

test("隐私清理取消 OCR 后迟到结果不能回写", async () => {
  const fixture = buildService();
  const cancelled = await fixture.service.cancel();
  assert.equal(cancelled.ok, true);
  assert.equal(fixture.data.ocrCancelledSourceTime, 100);
  fixture.setContexts([{ contextType: "OFFSCREEN_DOCUMENT" }]);
  fixture.service.handleComplete({ sourceTime: 100, text: "late result" });
  await flush();
  assert.equal(fixture.data.manualOcrText, undefined);
  assert.equal(fixture.data.manualOcrSourceTime, undefined);
});

test("OCR 自动发送 AI 统一经过 ai.basic FeatureGate", async () => {
  const denied = buildService({ aiAllowed: false });
  denied.data.autoSendOcrToAi = true;
  denied.service.handleComplete({ sourceTime: 100, text: "recognized" });
  await flush();
  await flush();
  assert.equal(denied.getAiCallCount(), 0);
  assert.equal(denied.data.aiJobStatus, "failed");
  assert.equal(denied.data.aiJobError, "disabled for test");

  const allowed = buildService({ aiAllowed: true });
  allowed.data.autoSendOcrToAi = true;
  allowed.service.handleComplete({ sourceTime: 100, text: "recognized" });
  await flush();
  await flush();
  assert.equal(allowed.getAiCallCount(), 1);
  assert.equal(allowed.data.aiJobStatus, "completed");
});

test("OCR 与 AI 自动回写都校验当前截图和取消标记", () => {
  const ocrSource = fs.readFileSync(path.join(root, "background/ocr-service.js"), "utf8");
  const aiSource = fs.readFileSync(path.join(root, "background/ai-service.js"), "utf8");
  assert.match(ocrSource, /ocrCancelledSourceTime/);
  assert.match(aiSource, /manualCaptureTime/);
  assert.match(aiSource, /ocrCancelledSourceTime/);
});

test("OCR 重试统一复用后台离屏任务", async () => {
  const fixture = buildService({ capture: { sourceTime: 100, dataUrl: "data:image/png;base64,AA==" } });
  fixture.data.ocrJobStatus = "failed";
  const result = await fixture.service.restartLatest();
  assert.equal(result.ok, true);
  assert.equal(result.restarted, true);
  assert.match(fixture.data.ocrJobStatus, /^(queued|recognizing)$/);
  assert.equal(fixture.data.ocrCancelledSourceTime, 0);
});
