const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const sdkFiles = [
  "contracts.js", "api-utils.js", "video-api.js", "ocr-api.js", "qa-api.js", "ai-api.js",
  "page-api.js", "book-api.js", "event-api.js", "storage-api.js", "runtime.js"
];

function buildRuntime(options = {}) {
  const calls = [];
  const subscriptions = [];
  const context = { self: {}, Object, Array, String, Number, JSON, Promise, TypeError };
  vm.createContext(context);
  for (const file of sdkFiles) vm.runInContext(fs.readFileSync(path.join(root, "sdk", file), "utf8"), context);
  const runtime = context.self.WinSpeedBallSdkRuntime.create({
    bookMode: options.bookMode,
    invoke(method, args) {
      calls.push({ method, args });
      return { method, args };
    },
    subscribe(eventName, callback) {
      const record = { eventName, callback, active: true };
      subscriptions.push(record);
      return function () { record.active = false; };
    }
  });
  return { runtime, calls, subscriptions };
}

test("SDK Runtime 暴露包含问题、AI 回复和图书状态的八组冻结 API", () => {
  const fixture = buildRuntime();
  assert.equal(fixture.runtime.version, "3.7.0-beta");
  assert.deepEqual(Object.keys(fixture.runtime), ["version", "video", "ocr", "qa", "ai", "page", "book", "event", "storage"]);
  assert.equal(Object.isFrozen(fixture.runtime), true);
  assert.equal(Object.isFrozen(fixture.runtime.video), true);
  assert.equal(Object.isFrozen(fixture.runtime.qa), true);
  assert.equal(Object.isFrozen(fixture.runtime.book), true);
  assert.equal(Object.isFrozen(fixture.runtime.storage), true);
});

test("Video API 使用精简名称并转换为稳定协议方法", async () => {
  const fixture = buildRuntime();
  await fixture.runtime.video.all();
  await fixture.runtime.video.current();
  await fixture.runtime.video.status();
  await fixture.runtime.video.rate(2);
  await fixture.runtime.video.volume(0.5);
  await fixture.runtime.video.mute();
  await fixture.runtime.video.play();
  await fixture.runtime.video.pause();
  await fixture.runtime.video.auto();
  await fixture.runtime.video.lock(false);
  await fixture.runtime.video.reset();
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.calls)), [
    { method: "video.getAll", args: [] },
    { method: "video.current", args: [] },
    { method: "video.getStatus", args: [] },
    { method: "video.setRate", args: [2] },
    { method: "video.setVolume", args: [0.5] },
    { method: "video.mute", args: [true] },
    { method: "video.play", args: [] },
    { method: "video.pause", args: [] },
    { method: "video.setAutoplay", args: [true] },
    { method: "video.setRateLock", args: [false] },
    { method: "video.reset", args: [] }
  ]);
});

test("旧版长方法名继续映射到同一实现", () => {
  const { runtime } = buildRuntime();
  assert.equal(runtime.video.getAll, runtime.video.all);
  assert.equal(runtime.video.getStatus, runtime.video.status);
  assert.equal(runtime.video.setRate, runtime.video.rate);
  assert.equal(runtime.video.setVolume, runtime.video.volume);
  assert.equal(runtime.video.autoplay, runtime.video.auto);
  assert.equal(runtime.video.setAutoplay, runtime.video.auto);
  assert.equal(runtime.video.rateLock, runtime.video.lock);
  assert.equal(runtime.video.setRateLock, runtime.video.lock);
  assert.equal(runtime.book.getStatus, runtime.book.status);
  assert.equal(runtime.book.turnPrev, runtime.book.prev);
  assert.equal(runtime.book.turnNext, runtime.book.next);
  assert.equal(runtime.book.startAuto, runtime.book.start);
  assert.equal(runtime.book.stopAuto, runtime.book.stop);
  assert.equal(runtime.book.setInterval, runtime.book.interval);
});

test("Book API 提供状态、翻页和自动翻阅短接口并补齐安全默认参数", async () => {
  const fixture = buildRuntime();
  await fixture.runtime.book.status();
  await fixture.runtime.book.status("image");
  await fixture.runtime.book.prev();
  await fixture.runtime.book.next("chaoxing");
  await fixture.runtime.book.start();
  await fixture.runtime.book.start({ mode: "chaoxing" });
  await fixture.runtime.book.stop();
  await fixture.runtime.book.interval(45);
  await fixture.runtime.book.interval(2, "chaoxing");
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.calls)), [
    { method: "book.getStatus", args: [] },
    { method: "book.getStatus", args: ["image"] },
    { method: "book.turnPrev", args: ["book"] },
    { method: "book.turnNext", args: ["chaoxing"] },
    { method: "book.startAuto", args: [{ mode: "book", intervalSeconds: 30 }] },
    { method: "book.startAuto", args: [{ mode: "chaoxing", intervalSeconds: 2 }] },
    { method: "book.stopAuto", args: [] },
    { method: "book.setInterval", args: [45, "book"] },
    { method: "book.setInterval", args: [2, "chaoxing"] }
  ]);
});

test("Book API 无参控制方法使用本次会话授权模式", async () => {
  const fixture = buildRuntime({ bookMode: "chaoxing" });
  await fixture.runtime.book.status();
  await fixture.runtime.book.prev();
  await fixture.runtime.book.next();
  await fixture.runtime.book.start();
  await fixture.runtime.book.interval(2);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.calls)), [
    { method: "book.getStatus", args: [] },
    { method: "book.turnPrev", args: ["chaoxing"] },
    { method: "book.turnNext", args: ["chaoxing"] },
    { method: "book.startAuto", args: [{ mode: "chaoxing", intervalSeconds: 2 }] },
    { method: "book.setInterval", args: [2, "chaoxing"] }
  ]);
});

test("OCR、问题、AI 和 Page API 使用统一异步调用", async () => {
  const fixture = buildRuntime();
  await fixture.runtime.ocr.latest();
  await fixture.runtime.ocr.capture();
  await fixture.runtime.ocr.recognize({ dataUrl: "data:image/png;base64,AA==" });
  await fixture.runtime.qa.latest();
  await fixture.runtime.qa.ocr();
  await fixture.runtime.qa.voice();
  await fixture.runtime.ai.latest();
  await fixture.runtime.ai.history();
  await fixture.runtime.ai.ask("question");
  await fixture.runtime.ai.summary("source");
  await fixture.runtime.ai.translate("hello", "zh-CN");
  await fixture.runtime.page.info();
  await fixture.runtime.book.status();
  assert.deepEqual(fixture.calls.map((item) => item.method), [
    "ocr.latest", "ocr.capture", "ocr.recognize", "qa.latest", "qa.ocr", "qa.voice", "ai.latest", "ai.history",
    "ai.ask", "ai.summary", "ai.translate", "page.info", "book.getStatus"
  ]);
});

test("Event API 返回可立即调用的取消订阅函数", () => {
  const fixture = buildRuntime();
  const callback = () => {};
  const unsubscribe = fixture.runtime.event.on("video.finish", callback);
  assert.equal(fixture.subscriptions.length, 1);
  assert.equal(fixture.subscriptions[0].callback, callback);
  assert.equal(fixture.subscriptions[0].active, true);
  unsubscribe();
  assert.equal(fixture.subscriptions[0].active, false);
});

test("Storage API 校验键、序列化和单值大小", async () => {
  const fixture = buildRuntime();
  await fixture.runtime.storage.set("learning.progress", { value: 50 });
  await fixture.runtime.storage.get("learning.progress");
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.calls)), [
    { method: "storage.set", args: ["learning.progress", { value: 50 }] },
    { method: "storage.get", args: ["learning.progress"] }
  ]);
  await assert.rejects(fixture.runtime.storage.get("__proto__"), (error) => error.code === "SDK_INVALID_ARGUMENT");
  await assert.rejects(fixture.runtime.storage.set("large", "x".repeat(65537)), (error) => error.code === "SDK_INVALID_ARGUMENT");
});

test("SDK API 在发送前通过 Promise 拒绝明显错误参数", async () => {
  const fixture = buildRuntime();
  const invalidRate = fixture.runtime.video.setRate(0);
  assert.equal(invalidRate instanceof Promise, true);
  await assert.rejects(invalidRate, (error) => error.code === "SDK_INVALID_ARGUMENT");
  await assert.rejects(fixture.runtime.video.setVolume(2), (error) => error.code === "SDK_INVALID_ARGUMENT");
  await assert.rejects(fixture.runtime.video.auto("yes"), (error) => error.code === "SDK_INVALID_ARGUMENT");
  await assert.rejects(fixture.runtime.video.lock(1), (error) => error.code === "SDK_INVALID_ARGUMENT");
  await assert.rejects(fixture.runtime.book.prev("course"), (error) => error.code === "SDK_INVALID_ARGUMENT");
  await assert.rejects(fixture.runtime.book.start({ mode: "book", intervalSeconds: 29 }), (error) => error.code === "SDK_INVALID_ARGUMENT");
  await assert.rejects(fixture.runtime.book.start({ mode: "image", intervalSeconds: 241 }), (error) => error.code === "SDK_INVALID_ARGUMENT");
  await assert.rejects(fixture.runtime.book.start({ mode: "book", intervalSeconds: 30, extra: true }), (error) => error.code === "SDK_INVALID_ARGUMENT");
  await assert.rejects(fixture.runtime.book.interval(1, "chaoxing"), (error) => error.code === "SDK_INVALID_ARGUMENT");
  await assert.rejects(fixture.runtime.ai.ask(""), (error) => error.code === "SDK_INVALID_ARGUMENT");
  await assert.rejects(fixture.runtime.ai.history(21), (error) => error.code === "SDK_INVALID_ARGUMENT");
  assert.throws(() => fixture.runtime.event.on("video.finish", null), (error) => error.code === "SDK_INVALID_ARGUMENT");
  assert.throws(() => fixture.runtime.event.on("internal.event", () => {}), (error) => error.code === "SDK_INVALID_ARGUMENT");
  assert.equal(fixture.calls.length, 0);
});

test("全部 SDK 运行时代码不引用 chrome 或内部 Service", () => {
  const source = sdkFiles.map((file) => fs.readFileSync(path.join(root, "sdk", file), "utf8")).join("\n");
  assert.equal(/\bchrome\s*\./.test(source), false);
  assert.equal(/WinSpeedBall(?:User|Ai|Video|Ocr|Book|Storage)Service/.test(source), false);
});
