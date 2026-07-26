const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("主弹窗不再加载 OCR 引擎，识别统一交给后台离屏任务", () => {
  const html = read("popup/index.html");
  const popup = read("popup/index.js");
  const background = read("background/service-worker.js");
  assert.doesNotMatch(html, /vendor\/tesseract\/tesseract\.min\.js/);
  assert.doesNotMatch(html, /<script src="ocr\.js"/);
  assert.doesNotMatch(popup, /winSpeedBallOcr\.recognize/);
  assert.match(popup, /action:\s*"retryManualOcr"/);
  assert.match(background, /retryManualOcr:\s*function/);
});

test("公式引擎在所有AI回复界面仅遇到公式时按需加载", () => {
  const html = read("popup/index.html");
  const replyHtml = read("popup/ai-reply.html");
  const replyScript = read("popup/ai-reply.js");
  const renderer = read("shared/math-renderer.js");
  assert.match(html, /<script src="\.\.\/shared\/math-renderer\.js"><\/script>/);
  assert.match(replyHtml, /<script src="\.\.\/shared\/math-renderer\.js"><\/script>/);
  assert.doesNotMatch(html, /<script[^>]+vendor\/mathjax\/tex-svg\.js/);
  assert.doesNotMatch(replyHtml, /<script[^>]+vendor\/mathjax\/tex-svg\.js/);
  assert.match(renderer, /var MATHJAX_PATH = "vendor\/mathjax\/tex-svg\.js"/);
  assert.match(renderer, /if \(!needsMathJax\) return Promise\.resolve/);
  assert.match(renderer, /script\.async = true/);
  assert.match(replyScript, /renderer\.render\(content, value\)/);
});

test("普通界面保持固定尺寸且只有AI教学使用大尺寸", () => {
  const html = read("popup/index.html");
  const windowService = read("background/window-service.js");
  assert.match(html, /--popup-width:320px/);
  assert.match(html, /--popup-height:340px/);
  assert.match(html, /body\.pinned-window\{--popup-width:100vw;--popup-height:100vh/);
  assert.match(html, /body\.ai-teaching-mode:not\(\.pinned-window\)\{--popup-width:720px;--popup-height:600px\}/);
  assert.match(windowService, /DEFAULT_BOUNDS = \{ width: 320, height: 340 \}/);
  assert.match(windowService, /TEACHING_BOUNDS = \{ width: 720, height: 600 \}/);
  assert.doesNotMatch(windowService, /MIN_BOUNDS/);
  assert.match(windowService, /width:\s*DEFAULT_BOUNDS\.width/);
  assert.match(windowService, /height:\s*DEFAULT_BOUNDS\.height/);
});

test("OCR 重试消息只允许受信弹窗且不接受额外参数", () => {
  const extensionId = "extension-id";
  const context = {
    self: {}, URL,
    chrome: { runtime: { id: extensionId, getURL: (file) => `chrome-extension://${extensionId}/${file}` } }
  };
  vm.createContext(context);
  vm.runInContext(read("background/message-schema.js"), context);
  const schema = context.self.WinSpeedBallMessageSchema;
  const message = { version: 1, action: "retryManualOcr", source: "popup", requestId: "ocr-retry-1", payload: {} };
  assert.equal(schema.parse(message, { id: extensionId, url: `chrome-extension://${extensionId}/popup/index.html` }).ok, true);
  assert.equal(schema.parse(message, { id: extensionId, url: `chrome-extension://${extensionId}/other.html` }).ok, false);
  assert.equal(schema.parse({ ...message, payload: { force: true } }, { id: extensionId, url: `chrome-extension://${extensionId}/popup/index.html` }).ok, false);
});
