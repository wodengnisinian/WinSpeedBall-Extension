const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function loadSchema() {
  const context = { self: {}, Object, Array, String, Number, JSON };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "sdk/contracts.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "sdk/method-schema.js"), "utf8"), context);
  return context.self.WinSpeedBallSdkMethodSchema;
}

test("SDK 方法参数范围被严格校验", () => {
  const schema = loadSchema();
  assert.equal(schema.validate("video.setRate", [2]).ok, true);
  assert.equal(schema.validate("video.setRate", [20]).ok, false);
  assert.equal(schema.validate("video.setVolume", [0.5]).ok, true);
  assert.equal(schema.validate("video.mute", ["yes"]).ok, false);
  assert.equal(schema.validate("page.text", ["extra"]).ok, false);
  assert.equal(schema.validate("book.getStatus", []).ok, true);
  assert.equal(schema.validate("book.getStatus", ["extra"]).ok, false);
  assert.equal(schema.validate("qa.latest", []).ok, true);
  assert.equal(schema.validate("qa.voice", ["extra"]).ok, false);
});

test("AI、OCR、事件和存储参数被限制", () => {
  const schema = loadSchema();
  assert.equal(schema.validate("ai.translate", ["hello", "zh-CN"]).ok, true);
  assert.equal(schema.validate("ai.ask", [""]).ok, false);
  assert.equal(schema.validate("ai.latest", []).ok, true);
  assert.equal(schema.validate("ai.history", []).ok, true);
  assert.equal(schema.validate("ai.history", [20]).ok, true);
  assert.equal(schema.validate("ai.history", [21]).ok, false);
  assert.equal(schema.validate("ocr.recognize", [{ dataUrl: "data:image/png;base64,AA==" }]).ok, true);
  assert.equal(schema.validate("ocr.recognize", [{ dataUrl: "https://example.com/image.png" }]).ok, false);
  assert.equal(schema.validate("event.on", ["video.finish"]).ok, true);
  assert.equal(schema.validate("event.on", ["internal.event"]).ok, false);
  assert.equal(schema.validate("storage.set", ["safe.key", { value: 1 }]).ok, true);
  assert.equal(schema.validate("storage.get", ["__proto__"]).ok, false);
});
