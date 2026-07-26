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
  assert.equal(schema.validate("video.setAutoplay", [true]).ok, true);
  assert.equal(schema.validate("video.setAutoplay", [1]).ok, false);
  assert.equal(schema.validate("video.setRateLock", [false]).ok, true);
  assert.equal(schema.validate("video.setRateLock", []).ok, false);
  assert.equal(schema.validate("video.reset", []).ok, true);
  assert.equal(schema.validate("video.reset", [true]).ok, false);
  assert.equal(schema.validate("page.text", ["extra"]).ok, false);
  assert.equal(schema.validate("book.getStatus", []).ok, true);
  assert.equal(schema.validate("book.getStatus", ["book"]).ok, true);
  assert.equal(schema.validate("book.getStatus", ["image"]).ok, true);
  assert.equal(schema.validate("book.getStatus", ["chaoxing"]).ok, true);
  assert.equal(schema.validate("book.getStatus", ["extra"]).ok, false);
  assert.equal(schema.validate("book.turnPrev", ["book"]).ok, true);
  assert.equal(schema.validate("book.turnNext", ["image"]).ok, true);
  assert.equal(schema.validate("book.turnNext", []).ok, false);
  assert.equal(schema.validate("book.startAuto", [{ mode: "book", intervalSeconds: 30 }]).ok, true);
  assert.equal(schema.validate("book.startAuto", [{ mode: "image", intervalSeconds: 240 }]).ok, true);
  assert.equal(schema.validate("book.startAuto", [{ mode: "image", intervalSeconds: 241 }]).ok, false);
  assert.equal(schema.validate("book.startAuto", [{ mode: "chaoxing", intervalSeconds: 2 }]).ok, true);
  assert.equal(schema.validate("book.startAuto", [{ mode: "book", intervalSeconds: 29 }]).ok, false);
  assert.equal(schema.validate("book.startAuto", [{ mode: "chaoxing", intervalSeconds: 1 }]).ok, false);
  assert.equal(schema.validate("book.startAuto", [{ mode: "book", intervalSeconds: 30, extra: true }]).ok, false);
  assert.equal(schema.validate("book.stopAuto", []).ok, true);
  assert.equal(schema.validate("book.stopAuto", ["book"]).ok, false);
  assert.equal(schema.validate("book.setInterval", [45, "book"]).ok, true);
  assert.equal(schema.validate("book.setInterval", [2, "chaoxing"]).ok, true);
  assert.equal(schema.validate("book.setInterval", [29, "image"]).ok, false);
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
