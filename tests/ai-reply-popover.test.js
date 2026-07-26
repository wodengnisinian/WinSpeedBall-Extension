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
      content: "回复内容", truncated: false, windowLeft: 800, windowTop: 100, windowWidth: 440, windowHeight: 560,
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
  assert.match(calls[0].payload.prompt, /【用户明确要求】\s*问题/);
  assert.match(calls[0].payload.prompt, /【题目或材料】\s*题目内容/);
  assert.match(calls[0].payload.prompt, /“用户明确要求”的优先级高于“默认任务”/);
  assert.equal(updates.every((item) => item.providerId === "openai"), true);
  assert.equal(updates.at(-1).patch.answer, "OpenAI 回复");
  assert.equal(writes.at(-1).aiQuestionHistoryByProvider.openai[0].provider, "openai");
});

test("AI答题提示词让用户格式要求覆盖默认模式并在结尾再次确认", () => {
  const elements = {
    aiMode: { value: "explain" },
    aiQuestion: { value: "只输出选项字母，不要解释。" }
  };
  const context = { self: {}, Promise, String, Number, Array, Object, Date };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "popup/ai-controller.js"), "utf8"), context);
  const controller = context.self.WinSpeedBallPopupAiController.create({
    byId(id) { return elements[id]; },
    sendMessage() { return Promise.resolve({ ok: true }); },
    storage: { get() {}, set() {} },
    addDetailedLog() {}, captureLabel() { return "#1"; }, setTopStatus() {},
    getLatestPageText() { return ""; }, getAutoOcrPromptTemplate() { return ""; }
  });

  const prompt = controller.buildPrompt("1 + 1 等于多少？A.1 B.2 C.3 D.4");
  const firstRequirement = prompt.indexOf("【用户明确要求】");
  const sourceMaterial = prompt.indexOf("【题目或材料】");
  const finalRequirement = prompt.lastIndexOf("必须执行的用户要求：");

  assert.match(prompt, /【默认任务】\s*解释题目或材料的重点和难点/);
  assert.ok(firstRequirement >= 0 && firstRequirement < sourceMaterial);
  assert.ok(finalRequirement > sourceMaterial);
  assert.equal(prompt.match(/只输出选项字母，不要解释。/g).length, 2);
  assert.match(prompt, /用户要求只给答案、不要解析或限定格式时，不得增加解释/);

  elements.aiMode.value = "custom";
  elements.aiQuestion.value = "";
  const directPrompt = controller.buildPrompt("1+1=？");
  assert.match(directPrompt, /【用户明确要求】\s*只输出最简最终答案，不要解析、不要复述题目、不要添加标题/);
  assert.match(directPrompt, /【题目或材料】\s*1\+1=？/);
  assert.match(directPrompt, /默认任务为直接回答且用户未明确要求解析时，只输出最简最终答案/);
});

test("AI答题长页面和长要求会在消息上限内保留要求并标记来源截取", () => {
  const elements = {
    aiMode: { value: "custom" },
    aiQuestion: { value: "只回答指定范围。".repeat(2000) }
  };
  const context = { self: {}, Promise, String, Number, Array, Object, Date };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "popup/ai-controller.js"), "utf8"), context);
  const controller = context.self.WinSpeedBallPopupAiController.create({
    byId(id) { return elements[id]; },
    sendMessage() { return Promise.resolve({ ok: true }); },
    storage: { get() {}, set() {} },
    addDetailedLog() {}, captureLabel() { return "#1"; }, setTopStatus() {},
    getLatestPageText() { return ""; }, getAutoOcrPromptTemplate() { return ""; }
  });
  const prompt = controller.buildPrompt("题目正文。".repeat(12000));
  assert.ok(prompt.length <= 50000);
  assert.match(prompt, /【用户明确要求】\s*只回答指定范围/);
  assert.match(prompt, /【来源提示：题目或材料超过单次请求上限，已截取/);
  assert.match(prompt, /必须执行的用户要求：\s*严格执行上方“用户明确要求”中的全部内容/);
});

test("AI答题读取网页时合并多个框架并优先保留题目区域", () => {
  const context = { self: {}, Promise, String, Number, Array, Object, Date };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "popup/ai-controller.js"), "utf8"), context);
  const controller = context.self.WinSpeedBallPopupAiController.create({
    byId() { return { value: "" }; },
    sendMessage() { return Promise.resolve({ ok: true }); },
    storage: { get() {}, set() {} },
    addDetailedLog() {}, captureLabel() { return "#1"; }, setTopStatus() {},
    getLatestPageText() { return ""; }, getAutoOcrPromptTemplate() { return ""; }
  });
  const result = controller.combineFrameText([
    { ok: true, text: "导航内容".repeat(5000), sourceLength: 50000, truncated: true },
    { ok: true, text: "第 5 题：若 x∈[0,π]，求 \\frac{a}{b}。A.1 B.2 C.3 D.4" },
    { ok: true, text: "课程说明" }
  ], 5000);

  assert.equal(result.truncated, true);
  assert.equal(result.frameCount, 3);
  assert.ok(result.text.length <= 5000);
  assert.match(result.text, /来源提示：网页内容较长/);
  assert.match(result.text, /第 5 题：若 x∈\[0,π\]/);
  assert.match(result.text, /\\frac\{a\}\{b\}/);
  assert.match(result.text, /A\.1 B\.2 C\.3 D\.4/);
});

test("AI答题在模型回复达到上限时保留原文并显示不完整状态", async () => {
  const calls = [];
  const statuses = [];
  const writes = [];
  const elements = {
    aiMode: { value: "custom" },
    aiQuestion: { value: "回答第1至20题" },
    aiAnswer: { value: "" },
    ocrText: { value: "题目内容" },
    aiHistoryList: { textContent: "", appendChild() {} }
  };
  const context = { self: {}, Promise, String, Number, Array, Object, Date };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "popup/ai-controller.js"), "utf8"), context);
  const controller = context.self.WinSpeedBallPopupAiController.create({
    byId(id) { return elements[id]; },
    sendMessage(message) {
      calls.push(message);
      return Promise.resolve({ ok: true, content: "第1至10题答案", model: "test", truncated: true });
    },
    storage: { get(keys, callback) { callback({}); }, set(data) { writes.push(data); } },
    updateProviderWorkspace(_providerId, patch) {
      if (Object.prototype.hasOwnProperty.call(patch, "answer")) elements.aiAnswer.value = patch.answer;
    },
    addDetailedLog() {}, captureLabel() { return "#1"; },
    setTopStatus(value) { statuses.push(value); },
    getLatestPageText() { return ""; }, getAutoOcrPromptTemplate() { return ""; }
  });

  const result = await controller.ask("题目内容");
  assert.equal(result.truncated, true);
  assert.equal(elements.aiAnswer.value, "第1至10题答案");
  assert.equal(statuses.at(-1), "回复不完整");
  assert.equal(writes.at(-1).aiQuestionHistoryByProvider.deepseek[0].truncated, true);
  assert.equal(calls[0].payload.prompt.includes("回答第1至20题"), true);
});

test("AI答题可以只输入独立问题并按默认规则请求最简答案", async () => {
  const calls = [];
  const elements = {
    aiMode: { value: "custom" },
    aiQuestion: { value: "1+1=？" },
    aiAnswer: { value: "" },
    ocrText: { value: "" },
    aiHistoryList: { textContent: "", appendChild() {} }
  };
  const context = { self: {}, Promise, String, Number, Array, Object, Date };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "popup/ai-controller.js"), "utf8"), context);
  const controller = context.self.WinSpeedBallPopupAiController.create({
    byId(id) { return elements[id]; },
    sendMessage(message) {
      calls.push(message);
      return Promise.resolve({ ok: true, content: "2", model: "test" });
    },
    storage: { get(keys, callback) { callback({}); }, set() {} },
    addDetailedLog() {}, captureLabel() { return "#1"; }, setTopStatus() {},
    getLatestPageText() { return ""; }, getAutoOcrPromptTemplate() { return ""; }
  });

  const result = await controller.ask("");
  assert.equal(result.content, "2");
  assert.equal(calls[0].action, "askAI");
  assert.match(calls[0].payload.prompt, /【题目或材料】\s*1\+1=？/);
  assert.match(calls[0].payload.prompt, /只输出最简最终答案/);
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
  assert.match(html, /<div(?=[^>]*id="replyContent")(?=[^>]*class="[^"]*math-render-surface)[^>]*>/);
  assert.match(html, /<link rel="stylesheet" href="\.\.\/shared\/math-renderer\.css">/);
  assert.ok(html.indexOf("../shared/math-renderer.js") < html.indexOf('src="ai-reply.js"'));
  assert.match(html, /id="copyBtn"[^>]*>复制回复/);
  assert.match(script, /countCharacters/);
  assert.match(script, /formatUpdatedAt/);
  assert.match(script, /showTemporaryStatus/);
  assert.match(script, /回复达到模型输出上限，内容可能不完整/);
  assert.match(script, /latestTruncated \? " · 可能不完整" : ""/);
  assert.match(script, /WSBMathRenderer/);
  assert.match(script, /renderer\.render\(content, value\)/);
  assert.match(script, /event\.altKey && !event\.ctrlKey && !event\.metaKey && !event\.shiftKey/);
  assert.match(script, /toLowerCase\(\) === "m"/);
  assert.match(script, /navigator\.clipboard\.writeText/);
  assert.match(script, /function closeReplyWindow\(\)/);
  assert.match(script, /chrome\.windows\.getCurrent/);
  assert.match(script, /chrome\.windows\.remove\(windowInfo\.id/);
  assert.match(script, /addEventListener\("click", closeReplyWindow\)/);
  assert.match(script, /event\.key === "Escape"[\s\S]*?closeReplyWindow\(\)/);
});

test("AI答题主界面仅在回复包含公式时切换到 SVG 公式预览", () => {
  const html = fs.readFileSync(path.join(root, "popup/index.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "popup/index.js"), "utf8");
  assert.match(html, /id="aiAnswer"[^>]*>.*?<div(?=[^>]*id="aiAnswerFormulaPreview")(?=[^>]*class="[^"]*math-render-surface)[^>]*>/s);
  assert.match(script, /function aiAnswerContainsFormula\(value\)/);
  assert.match(script, /renderer\.hasExplicitFormula\(value\)/);
  assert.match(script, /renderer\.legacyFormulaForLine\(line\)/);
  assert.match(script, /source\.hidden = hasFormula/);
  assert.match(script, /preview\.hidden = !hasFormula/);
  assert.match(script, /renderer\.render\(preview, hasFormula \? answer : ""\)/);
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

  const invalidTruncation = schema.parse({
    version: 1, action: "showAiReplyWindow", source: "popup", requestId: "reply-4",
    payload: {
      content: "回答", truncated: "yes", windowLeft: 800, windowTop: 100, windowWidth: 440, windowHeight: 560
    }
  }, sender);
  assert.equal(invalidTruncation.ok, false);
});
