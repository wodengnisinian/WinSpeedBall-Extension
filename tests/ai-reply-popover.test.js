const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

test("主插件弹窗把 AI 回复和自身窗口位置发送到后台", async () => {
  const calls = [];
  const context = {
    self: {
      screenX: 800, screenY: 100, outerWidth: 440, outerHeight: 560,
      screen: { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1040 }
    },
    Promise, String, Number, Array, Object, Date
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "popup/ai-controller.js"), "utf8"), context);
  const controller = context.self.WinSpeedBallPopupAiController.create({
    byId() { return { value: "", textContent: "", appendChild() {} }; },
    sendMessage(message) { calls.push(message); return Promise.resolve({ ok: true }); },
    storage: { get(keys, callback) { callback({}); }, set() {} },
    addDetailedLog() {}, captureLabel() { return "#1"; }, setTopStatus() {},
    getLatestPageText() { return ""; }, getAutoOcrPromptTemplate() { return ""; }
  });
  await controller.showReplyWindow("回复内容");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {
    action: "showAiReplyWindow",
    payload: {
      content: "回复内容", windowLeft: 800, windowTop: 100, windowWidth: 440, windowHeight: 560,
      screenLeft: 0, screenTop: 0, screenWidth: 1920, screenHeight: 1040
    }
  });
});

test("AI 标签把请求发送到对应 Provider 并隔离回复状态", async () => {
  const calls = [];
  const updates = [];
  const writes = [];
  const elements = {
    aiMode: { value: "custom" },
    aiQuestion: { value: "问题" },
    aiAnswer: { value: "" },
    ocrText: { value: "题目内容" },
    aiHistoryList: { textContent: "", appendChild() {} }
  };
  const context = { self: {}, Promise, String, Number, Array, Object, Date };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "popup/ai-controller.js"), "utf8"), context);
  const controller = context.self.WinSpeedBallPopupAiController.create({
    byId(id) { return elements[id]; },
    sendMessage(message) { calls.push(message); return Promise.resolve({ ok: true, content: "OpenAI 回复", model: "test" }); },
    storage: { get(keys, callback) { callback({}); }, set(data) { writes.push(data); } },
    getProviderId() { return "openai"; },
    updateProviderWorkspace(providerId, patch) { updates.push({ providerId, patch }); },
    addDetailedLog() {}, captureLabel() { return "#1"; }, setTopStatus() {},
    getLatestPageText() { return ""; }, getAutoOcrPromptTemplate() { return ""; }
  });
  const result = await controller.ask("题目内容");
  assert.equal(result.ok, true);
  assert.equal(calls[0].action, "askAI");
  assert.equal(calls[0].payload.provider, "openai");
  assert.equal(updates.every((item) => item.providerId === "openai"), true);
  assert.equal(updates.at(-1).patch.answer, "OpenAI 回复");
  assert.equal(writes.at(-1).aiQuestionHistoryByProvider.openai[0].provider, "openai");
});

test("AI 回复使用独立窗口，不进入主插件或网页 DOM", () => {
  const popup = fs.readFileSync(path.join(root, "popup/index.html"), "utf8");
  const content = fs.readFileSync(path.join(root, "content/index.js"), "utf8");
  const background = fs.readFileSync(path.join(root, "background/service-worker.js"), "utf8");
  const aiWindow = fs.readFileSync(path.join(root, "background/ai-window-service.js"), "utf8");
  assert.equal(popup.includes("aiReplyPopover"), false);
  assert.equal(content.includes("winspeedball-ai-reply-overlay"), false);
  assert.match(background, /importScripts\("ai-window-service\.js"\)/);
  assert.match(aiWindow, /chrome\.windows\.create\(Object\.assign\(\{/);
  assert.match(aiWindow, /chrome\.runtime\.getURL\("popup\/ai-reply\.html"\)/);
  assert.match(aiWindow, /type:\s*"popup"/);
  assert.match(background, /AI_REPLY_BOUNDS = \{ width: 320, height: 240 \}/);
  assert.match(background, /WinSpeedBallAiWindowService\.create\(\{ storageKey: AI_REPLY_KEY, bounds: AI_REPLY_BOUNDS \}\)/);
});

test("后台 AI 与 OCR 自动回复不依赖主插件窗口", () => {
  const background = fs.readFileSync(path.join(root, "background/service-worker.js"), "utf8");
  const ocr = fs.readFileSync(path.join(root, "background/ocr-service.js"), "utf8");
  const aiWindow = fs.readFileSync(path.join(root, "background/ai-window-service.js"), "utf8");
  assert.match(background, /askAI:[\s\S]*?result\s*&&\s*result\.ok\)\s*showAiReplyWindow\(\{\s*content:\s*result\.content/);
  assert.match(aiWindow, /chrome\.windows\.getLastFocused\(\{\s*populate:\s*false\s*\}/);
  assert.match(ocr, /result\s*&&\s*result\.ok\s*&&\s*typeof global\.WinSpeedBallShowAiReplyWindow/);
});

test("恢复历史回复不会抢占主插件，新回复才获得显示优先级", () => {
  const popup = fs.readFileSync(path.join(root, "popup/index.js"), "utf8");
  const aiWindow = fs.readFileSync(path.join(root, "background/ai-window-service.js"), "utf8");
  const restoreStart = popup.indexOf("function loadManualCapture()");
  const restoreEnd = popup.indexOf("function requestBackgroundOcrRetry()", restoreStart);
  const restoreBlock = popup.slice(restoreStart, restoreEnd);
  assert.doesNotMatch(restoreBlock, /showReplyWindow/);
  assert.match(aiWindow, /focused:\s*true/);
  assert.match(aiWindow, /positionNextToCompactWindow/);
  assert.match(aiWindow, /browserWindow\.type === "popup"/);
});

test("下一次 AI 回复会关闭旧窗口、创建新窗口并串行处理并发请求", () => {
  const aiWindow = fs.readFileSync(path.join(root, "background/ai-window-service.js"), "utf8");
  assert.match(aiWindow, /chrome\.windows\.update\(windowInfo\.id, windowBounds/);
  assert.match(aiWindow, /reused:\s*true/);
  assert.match(aiWindow, /var queue = Promise\.resolve\(\)/);
  assert.match(aiWindow, /var task = queue\.catch/);
  assert.match(aiWindow, /chrome\.windows\.remove\(windowId/);
  assert.match(aiWindow, /duplicates\.map/);
  assert.match(aiWindow, /function replaceWindow\(position\)/);
  assert.match(aiWindow, /closeReplyWindow\(previousId\)/);
  assert.match(aiWindow, /\.then\(replaceWindow\)/);
});

test("AI 次窗口被调整后会恢复固定尺寸", () => {
  const background = fs.readFileSync(path.join(root, "background/service-worker.js"), "utf8");
  const aiWindow = fs.readFileSync(path.join(root, "background/ai-window-service.js"), "utf8");
  assert.match(background, /chrome\.windows\.onBoundsChanged\.addListener/);
  assert.match(background, /aiWindowService\.handleBoundsChanged\(windowInfo\)/);
  assert.match(aiWindow, /windowInfo\.id !== replyWindowId/);
  assert.match(aiWindow, /width:\s*bounds\.width/);
  assert.match(aiWindow, /height:\s*bounds\.height/);
});

test("独立回复窗口支持复制按钮、上尖角和 Alt+M", () => {
  const html = fs.readFileSync(path.join(root, "popup/ai-reply.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "popup/ai-reply.js"), "utf8");
  assert.match(html, /class="reply-tail"/);
  assert.match(html, /top:-8px/);
  assert.match(html, /transform:rotate\(45deg\)/);
  assert.match(html, /id="replyMeta"/);
  assert.match(html, /id="replyContent"[^>]*role="document"/);
  assert.match(html, /id="copyBtn"[^>]*>复制回复/);
  assert.match(script, /countCharacters/);
  assert.match(script, /formatUpdatedAt/);
  assert.match(script, /showTemporaryStatus/);
  assert.match(script, /event\.altKey && !event\.ctrlKey && !event\.metaKey && !event\.shiftKey/);
  assert.match(script, /toLowerCase\(\) === "m"/);
  assert.match(script, /navigator\.clipboard\.writeText/);
  assert.match(script, /function closeReplyWindow\(\)/);
  assert.match(script, /chrome\.windows\.getCurrent/);
  assert.match(script, /chrome\.windows\.remove\(windowInfo\.id/);
  assert.match(script, /addEventListener\("click", closeReplyWindow\)/);
  assert.match(script, /event\.key === "Escape"[\s\S]*?closeReplyWindow\(\)/);
});

test("独立回复窗口消息只允许受信 popup 并限制内容大小", () => {
  const extensionId = "extension-id";
  const context = {
    self: {}, URL,
    chrome: { runtime: { id: extensionId, getURL: (file) => `chrome-extension://${extensionId}/${file}` } }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/message-schema.js"), "utf8"), context);
  const schema = context.self.WinSpeedBallMessageSchema;
  const sender = { id: extensionId, url: `chrome-extension://${extensionId}/popup/index.html` };
  const valid = schema.parse({
    version: 1, action: "showAiReplyWindow", source: "popup", requestId: "reply-1",
    payload: {
      content: "回答", windowLeft: 800, windowTop: 100, windowWidth: 440, windowHeight: 560,
      screenLeft: 0, screenTop: 0, screenWidth: 1920, screenHeight: 1040
    }
  }, sender);
  assert.equal(valid.ok, true);
  const oversized = schema.parse({
    version: 1, action: "showAiReplyWindow", source: "popup", requestId: "reply-2",
    payload: {
      content: "x".repeat(2 * 1024 * 1024 + 1), windowLeft: 800, windowTop: 100, windowWidth: 440, windowHeight: 560,
      screenLeft: 0, screenTop: 0, screenWidth: 1920, screenHeight: 1040
    }
  }, sender);
  assert.equal(oversized.ok, false);

  const incompleteBounds = schema.parse({
    version: 1, action: "showAiReplyWindow", source: "popup", requestId: "reply-3",
    payload: { content: "回答", windowLeft: 800, windowTop: 100, windowWidth: 440, windowHeight: 560, screenWidth: 1920 }
  }, sender);
  assert.equal(incompleteBounds.ok, false);
});
