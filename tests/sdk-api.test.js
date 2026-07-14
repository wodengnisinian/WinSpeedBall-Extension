const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const sdkFiles = [
  "contracts.js", "api-utils.js", "video-api.js", "ocr-api.js", "ai-api.js",
  "page-api.js", "event-api.js", "storage-api.js", "runtime.js"
];

function buildRuntime() {
  const calls = [];
  const subscriptions = [];
  const context = { self: {}, Object, Array, String, Number, JSON, Promise, TypeError };
  vm.createContext(context);
  for (const file of sdkFiles) vm.runInContext(fs.readFileSync(path.join(root, "sdk", file), "utf8"), context);
  const runtime = context.self.WinSpeedBallSdkRuntime.create({
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

test("SDK Runtime 暴露六组冻结 API", () => {
  const fixture = buildRuntime();
  assert.equal(fixture.runtime.version, "0.1.0-beta");
  assert.deepEqual(Object.keys(fixture.runtime), ["version", "video", "ocr", "ai", "page", "event", "storage"]);
  assert.equal(Object.isFrozen(fixture.runtime), true);
  assert.equal(Object.isFrozen(fixture.runtime.video), true);
  assert.equal(Object.isFrozen(fixture.runtime.storage), true);
});

test("Video API 转换为稳定方法名和参数", async () => {
  const fixture = buildRuntime();
  await fixture.runtime.video.current();
  await fixture.runtime.video.setRate(2);
  await fixture.runtime.video.setVolume(0.5);
  await fixture.runtime.video.mute();
  await fixture.runtime.video.play();
  await fixture.runtime.video.pause();
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.calls)), [
    { method: "video.current", args: [] },
    { method: "video.setRate", args: [2] },
    { method: "video.setVolume", args: [0.5] },
    { method: "video.mute", args: [true] },
    { method: "video.play", args: [] },
    { method: "video.pause", args: [] }
  ]);
});

test("OCR、AI 和 Page API 使用统一异步调用", async () => {
  const fixture = buildRuntime();
  await fixture.runtime.ocr.latest();
  await fixture.runtime.ocr.capture();
  await fixture.runtime.ocr.recognize({ dataUrl: "data:image/png;base64,AA==" });
  await fixture.runtime.ai.ask("question");
  await fixture.runtime.ai.summary("source");
  await fixture.runtime.ai.translate("hello", "zh-CN");
  await fixture.runtime.page.info();
  assert.deepEqual(fixture.calls.map((item) => item.method), [
    "ocr.latest", "ocr.capture", "ocr.recognize", "ai.ask", "ai.summary", "ai.translate", "page.info"
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
  assert.throws(() => fixture.runtime.storage.get("__proto__"), (error) => error.code === "SDK_INVALID_ARGUMENT");
  assert.throws(() => fixture.runtime.storage.set("large", "x".repeat(65537)), (error) => error.code === "SDK_INVALID_ARGUMENT");
});

test("SDK API 在发送前拒绝明显错误参数", () => {
  const fixture = buildRuntime();
  assert.throws(() => fixture.runtime.video.setRate(0), (error) => error.code === "SDK_INVALID_ARGUMENT");
  assert.throws(() => fixture.runtime.video.setVolume(2), (error) => error.code === "SDK_INVALID_ARGUMENT");
  assert.throws(() => fixture.runtime.ai.ask(""), (error) => error.code === "SDK_INVALID_ARGUMENT");
  assert.throws(() => fixture.runtime.event.on("video.finish", null), (error) => error.code === "SDK_INVALID_ARGUMENT");
  assert.throws(() => fixture.runtime.event.on("internal.event", () => {}), (error) => error.code === "SDK_INVALID_ARGUMENT");
  assert.equal(fixture.calls.length, 0);
});

test("全部 SDK 运行时代码不引用 chrome 或内部 Service", () => {
  const source = sdkFiles.map((file) => fs.readFileSync(path.join(root, "sdk", file), "utf8")).join("\n");
  assert.equal(/\bchrome\s*\./.test(source), false);
  assert.equal(/WinSpeedBall(?:User|Ai|Video|Ocr|Storage)Service/.test(source), false);
});
