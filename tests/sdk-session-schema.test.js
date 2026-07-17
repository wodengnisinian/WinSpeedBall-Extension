const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function loadSchema() {
  const context = {
    self: {},
    URL,
    Object,
    Array,
    String,
    Number,
    JSON,
    chrome: {
      runtime: {
        id: "extension-id",
        getURL: (file) => `chrome-extension://extension-id/${file}`
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "sdk/contracts.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/message-schema.js"), "utf8"), context);
  return context.self.WinSpeedBallMessageSchema;
}

const sender = { id: "extension-id", url: "chrome-extension://extension-id/popup/index.html" };
const token = `wsb_rt_${"a".repeat(64)}`;
const contextNonce = `wsb_ctx_${"b".repeat(64)}`;

function envelope(action, payload, requestId = "sdk-schema-request") {
  return { version: 1, source: "popup", action, requestId, payload };
}

test("SDK 会话创建消息要求受信弹窗、能力确认和安全脚本标识", () => {
  const schema = loadSchema();
  const payload = {
    scriptId: "draft_one",
    code: "// ==UserScript==\n// @wsb-capability storage\n// ==/UserScript==",
    capabilities: ["storage"],
    contextNonce,
    confirmed: true
  };
  assert.equal(schema.parse(envelope("prepareSdkSession", payload), sender).ok, true);
  assert.equal(schema.parse(envelope("prepareSdkSession", { ...payload, confirmed: false }), sender).ok, false);
  assert.equal(schema.parse(envelope("prepareSdkSession", { ...payload, scriptId: "__proto__" }), sender).ok, false);
  assert.equal(schema.parse(envelope("prepareSdkSession", payload), { id: "extension-id", url: "chrome-extension://extension-id/other.html" }).ok, false);
});

test("SDK 上下文预备消息只接受已登记能力", () => {
  const schema = loadSchema();
  assert.equal(schema.parse(envelope("prepareSdkContext", { capabilities: ["video.read"] }), sender).ok, true);
  assert.equal(schema.parse(envelope("prepareSdkContext", { capabilities: ["book.read"] }), sender).ok, true);
  const allCapabilities = ["video.read", "video.control", "ocr.read", "qa.read", "ai.read", "ai.request", "page.read", "book.read", "storage"];
  assert.equal(schema.parse(envelope("prepareSdkContext", { capabilities: allCapabilities }), sender).ok, true);
  assert.equal(schema.parse(envelope("prepareSdkContext", { capabilities: allCapabilities.concat("book.read") }), sender).ok, false);
  assert.equal(schema.parse(envelope("prepareSdkContext", { capabilities: ["internal.service"] }), sender).ok, false);
  assert.equal(schema.parse(envelope("prepareSdkContext", { capabilities: [] }), sender).ok, false);
});

test("SDK 调用消息严格校验令牌、请求字段和方法", () => {
  const schema = loadSchema();
  const request = {
    channel: "WSB_SDK",
    protocolVersion: 1,
    scriptId: "draft_one",
    requestId: "sdk-call-one",
    method: "storage.get",
    args: ["progress"]
  };
  assert.equal(schema.parse(envelope("invokeSdkSession", { sessionToken: token, request }), sender).ok, true);
  assert.equal(schema.parse(envelope("invokeSdkSession", { sessionToken: token, request: { ...request, method: "book.getStatus", args: [] } }), sender).ok, true);
  assert.equal(schema.parse(envelope("invokeSdkSession", { sessionToken: "bad", request }), sender).ok, false);
  assert.equal(schema.parse(envelope("invokeSdkSession", { sessionToken: token, request: { ...request, extra: true } }), sender).ok, false);
  assert.equal(schema.parse(envelope("invokeSdkSession", { sessionToken: token, request: { ...request, method: "internal.call" } }), sender).ok, false);
  assert.equal(schema.parse(envelope("invokeSdkSession", { sessionToken: token, request: { ...request, scriptId: "constructor" } }), sender).ok, false);
});

test("SDK 状态和关闭消息只接受固定格式运行令牌", () => {
  const schema = loadSchema();
  assert.equal(schema.parse(envelope("getSdkSessionStatus", { sessionToken: token }), sender).ok, true);
  assert.equal(schema.parse(envelope("closeSdkSession", { sessionToken: token }), sender).ok, true);
  assert.equal(schema.parse(envelope("closeSdkSession", { sessionToken: token, extra: true }), sender).ok, false);
});

test("删除 SDK 脚本数据必须确认并使用安全标识", () => {
  const schema = loadSchema();
  assert.equal(schema.parse(envelope("deleteSdkScriptData", { scriptId: "draft_one", confirmed: true }), sender).ok, true);
  assert.equal(schema.parse(envelope("deleteSdkScriptData", { scriptId: "draft_one", confirmed: false }), sender).ok, false);
  assert.equal(schema.parse(envelope("deleteSdkScriptData", { scriptId: "__proto__", confirmed: true }), sender).ok, false);
});
