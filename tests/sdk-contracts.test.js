const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function loadContracts() {
  const context = { self: {}, Object, Array, String, Number, JSON };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "sdk/contracts.js"), "utf8"), context);
  return context.self.WinSpeedBallSdkContracts;
}

test("SDK Beta 登记全部公开方法并映射能力", () => {
  const contracts = loadContracts();
  const methods = Object.keys(contracts.METHOD_CAPABILITIES);
  assert.deepEqual(methods, [
    "video.getAll", "video.current", "video.getStatus", "video.setRate", "video.setVolume", "video.mute", "video.play", "video.pause",
    "ocr.latest", "ocr.capture", "ocr.recognize",
    "qa.latest", "qa.ocr", "qa.voice",
    "ai.latest", "ai.history",
    "ai.ask", "ai.summary", "ai.translate",
    "page.info", "page.text", "page.title", "page.url",
    "book.getStatus",
    "event.on", "storage.get", "storage.set"
  ]);
  assert.equal(methods.every((method) => !!contracts.METHOD_CAPABILITIES[method]), true);
  assert.deepEqual(Array.from(contracts.CAPABILITIES), [
    "video.read", "video.control", "ocr.read", "qa.read", "ai.read", "ai.request", "page.read", "book.read", "storage"
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(contracts.PUBLIC_METHODS)), {
    "video.all": "video.getAll", "video.current": "video.current", "video.status": "video.getStatus",
    "video.rate": "video.setRate", "video.volume": "video.setVolume", "video.mute": "video.mute",
    "video.play": "video.play", "video.pause": "video.pause", "ocr.latest": "ocr.latest",
    "ocr.capture": "ocr.capture", "ocr.recognize": "ocr.recognize", "qa.latest": "qa.latest",
    "qa.ocr": "qa.ocr", "qa.voice": "qa.voice", "ai.latest": "ai.latest", "ai.history": "ai.history", "ai.ask": "ai.ask",
    "ai.summary": "ai.summary", "ai.translate": "ai.translate", "page.info": "page.info",
    "page.text": "page.text", "page.title": "page.title", "page.url": "page.url",
    "book.status": "book.getStatus", "event.on": "event.on", "storage.get": "storage.get",
    "storage.set": "storage.set"
  });
  assert.equal(Object.keys(contracts.PUBLIC_METHODS).every((method) => method.length <= 13), true);
  assert.equal(Object.values(contracts.PUBLIC_METHODS).every((method) => Object.prototype.hasOwnProperty.call(contracts.METHOD_CAPABILITIES, method)), true);
});

test("解析 @wsb-capability 并标记旧 @permission", () => {
  const contracts = loadContracts();
  const metadata = contracts.parseMetadata(`
// ==UserScript==
// @name Test
// @version 1.0.0
// @wsb-capability video.read
// @wsb-capability storage
// @wsb-capability video.read
// @permission dom
// ==/UserScript==
`);
  assert.deepEqual(Array.from(metadata.capabilities), ["video.read", "storage"]);
  assert.deepEqual(Array.from(metadata.legacyPermissions), ["dom"]);
  assert.deepEqual(Array.from(metadata.unsupportedCapabilities), []);
});

test("不支持的能力不会进入授权列表", () => {
  const contracts = loadContracts();
  const metadata = contracts.parseMetadata(`// ==UserScript==\n// @wsb-capability cloud.admin\n// ==/UserScript==`);
  assert.deepEqual(Array.from(metadata.capabilities), []);
  assert.deepEqual(Array.from(metadata.unsupportedCapabilities), ["cloud.admin"]);
  assert.equal(contracts.classifyMetadata(metadata).code, "SDK_CAPABILITY_UNKNOWN");
});

test("SDK 能力与旧权限不能混用", () => {
  const contracts = loadContracts();
  const mixed = contracts.parseMetadata(`// ==UserScript==\n// @wsb-capability page.read\n// @permission dom\n// ==/UserScript==`);
  assert.equal(contracts.classifyMetadata(mixed).code, "SDK_METADATA_CONFLICT");
  const legacy = contracts.parseMetadata(`// ==UserScript==\n// @permission dom\n// ==/UserScript==`);
  assert.equal(contracts.classifyMetadata(legacy).mode, "legacy");
});

test("API 授权只接受已确认能力", () => {
  const contracts = loadContracts();
  assert.equal(contracts.authorize("video.current", [], ["video.read"]).ok, true);
  assert.equal(contracts.authorize("book.getStatus", [], ["book.read"]).ok, true);
  assert.equal(contracts.authorize("qa.latest", [], ["qa.read"]).ok, true);
  assert.equal(contracts.authorize("ai.latest", [], ["ai.read"]).ok, true);
  const bookDenied = contracts.authorize("book.getStatus", [], ["page.read"]);
  assert.equal(bookDenied.ok, false);
  assert.equal(bookDenied.capability, "book.read");
  const denied = contracts.authorize("video.setRate", [2], ["video.read"]);
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "SDK_CAPABILITY_REQUIRED");
  assert.equal(denied.capability, "video.control");
});

test("事件订阅按事件内容校验能力", () => {
  const contracts = loadContracts();
  assert.equal(contracts.requiredCapability("event.on", ["video.finish"]), "video.read");
  assert.equal(contracts.requiredCapability("event.on", ["page.change"]), "page.read");
  assert.equal(contracts.requiredCapability("event.on", ["unknown.event"]), "");
});

test("SDK 请求协议拒绝未知方法和未登记事件", () => {
  const contracts = loadContracts();
  const base = {
    channel: "WSB_SDK",
    protocolVersion: 1,
    scriptId: "script-1",
    requestId: "request-1",
    method: "video.current",
    args: []
  };
  assert.equal(contracts.validateRequest(base).ok, true);
  assert.equal(contracts.validateRequest(Object.assign({}, base, { method: "book.getStatus" })).ok, true);
  assert.equal(contracts.validateRequest(Object.assign({}, base, { method: "internal.userService" })).code, "SDK_METHOD_NOT_ALLOWED");
  assert.equal(contracts.validateRequest(Object.assign({}, base, { method: "event.on", args: ["internal.event"] })).code, "SDK_EVENT_NOT_ALLOWED");
});

test("SDK 公开契约不依赖浏览器扩展全局对象", () => {
  const source = fs.readFileSync(path.join(root, "sdk/contracts.js"), "utf8");
  assert.equal(/\bchrome\s*\./.test(source), false);
  assert.equal(/WinSpeedBall(?:User|Ai|Video|Ocr|Storage)Service/.test(source), false);
});
