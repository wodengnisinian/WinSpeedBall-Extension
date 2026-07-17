import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

async function loadPlaywright() {
  const configured = process.env.WSB_PLAYWRIGHT_MODULE;
  const candidates = configured ? [configured] : ["playwright"];
  const dependencyRoot = path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules");
  candidates.push(pathToFileURL(path.join(dependencyRoot, "playwright", "index.mjs")).href);
  try {
    const entries = await fs.readdir(path.join(dependencyRoot, ".pnpm"));
    entries.filter((entry) => entry.startsWith("playwright@")).sort().reverse().forEach((entry) => {
      candidates.push(pathToFileURL(path.join(dependencyRoot, ".pnpm", entry, "node_modules", "playwright", "index.mjs")).href);
    });
  } catch (error) {}
  for (const candidate of candidates) {
    try { return await import(candidate); } catch (error) {}
  }
  throw new Error("Playwright is required. Install it or set WSB_PLAYWRIGHT_MODULE.");
}

async function resolveEdgeExecutable() {
  const candidates = [
    process.env.EDGE_EXECUTABLE_PATH,
    path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env.ProgramFiles || "", "Microsoft", "Edge", "Application", "msedge.exe")
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { await fs.access(candidate); return candidate; } catch (error) {}
  }
  throw new Error("Microsoft Edge was not found. Set EDGE_EXECUTABLE_PATH.");
}

const { chromium } = await loadPlaywright();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const edge = await resolveEdgeExecutable();
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "wsb-edge-e2e-"));
let context;
const server = http.createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end('<!doctype html><html><head><title>Private page title</title></head><body><video id="lesson" title="Local lesson"></video></body></html>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const localOrigin = `http://127.0.0.1:${server.address().port}`;

try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: edge,
    headless: true,
    args: [
      `--disable-extensions-except=${root}`,
      `--load-extension=${root}`,
      "--no-first-run",
      "--disable-default-apps"
    ]
  });

  let workers = context.serviceWorkers();
  const worker = workers[0] || await context.waitForEvent("serviceworker", { timeout: 20000 });
  const extensionId = new URL(worker.url()).host;
  assert.match(extensionId, /^[a-p]{32}$/);

  const page = await context.newPage();
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(`chrome-extension://${extensionId}/popup/index.html?pinned=1`);
  await page.locator("#developerModeToggle").waitFor({ state: "attached" });

  const enabled = await page.evaluate(async () => {
    return self.WinSpeedBallPopupMessageClient.send({
      action: "setDeveloperMode",
      payload: { enabled: true, confirmed: true }
    });
  });
  assert.equal(enabled.ok, true);
  assert.equal(enabled.enabled, true);
  const declaration = await page.evaluate(async () => self.WinSpeedBallPopupMessageClient.send({ action: "getUsageDeclaration" }));
  assert.equal(declaration.ok, true);
  const accepted = await page.evaluate(async (version) => self.WinSpeedBallPopupMessageClient.send({
    action: "acceptUsageDeclaration",
    payload: { version, accepted: true }
  }), declaration.version);
  assert.equal(accepted.ok, true);
  await page.reload();
  await page.locator("#developerPanel").waitFor({ state: "attached" });
  await page.waitForFunction(() => document.querySelectorAll("#aiProviderTabs [data-ai-provider]").length === 4);
  await page.locator('[data-panel="aiPanel"]').evaluate((button) => button.click());

  const interfaceProbe = {
    ocrNavCount: await page.locator('[data-panel="ocrPanel"]').count(),
    ocrNavLabel: await page.locator('[data-panel="ocrPanel"]').textContent(),
    ocrNavFits: await page.locator('[data-panel="ocrPanel"]').evaluate((button) => button.scrollWidth <= button.clientWidth),
    aiNavCount: await page.locator('[data-panel="aiPanel"]').count(),
    aiProviderTabCount: await page.locator("#aiProviderTabs [data-ai-provider]").count(),
    aiProviderLabels: await page.locator("#aiProviderTabs [data-ai-provider]").allTextContents(),
    aiProviderFullLabels: await page.locator("#aiProviderTabs [data-ai-provider]").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
    aiProviderSingleRow: await page.locator("#aiProviderTabs [data-ai-provider]").evaluateAll((buttons) => new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))).size === 1),
    aiProviderButtonHeight: await page.locator('[data-ai-provider="deepseek"]').evaluate((button) => Math.round(button.getBoundingClientRect().height)),
    ocrPanelCount: await page.locator("#ocrPanel").count(),
    aiPanelCount: await page.locator("#aiPanel").count(),
    combinedPanelCount: await page.locator("#assistantPanel").count(),
    ocrCaptureTabCount: await page.locator("#ocrCaptureTab").count(),
    ocrResultTabCount: await page.locator("#ocrResultTab").count(),
    voiceCaptureTabCount: await page.locator("#voiceCaptureTab").count(),
    voiceStartButtonCount: await page.locator("#startTabAudioBtn").count(),
    previewInCaptureCount: await page.locator("#ocrCaptureView > #capturePreview").count(),
    resultInCaptureCount: await page.locator("#ocrCaptureView > #ocrText").count(),
    combinedNavCount: await page.locator('[data-panel="assistantPanel"]').count()
  };
  assert.deepEqual(interfaceProbe, {
    ocrNavCount: 1,
    ocrNavLabel: "问题获取",
    ocrNavFits: true,
    aiNavCount: 1,
    aiProviderTabCount: 4,
    aiProviderLabels: ["DS", "OAI", "CLD", "LM"],
    aiProviderFullLabels: ["DeepSeek", "OpenAI", "Claude", "Local model"],
    aiProviderSingleRow: true,
    aiProviderButtonHeight: 24,
    ocrPanelCount: 1,
    aiPanelCount: 1,
    combinedPanelCount: 0,
    ocrCaptureTabCount: 1,
    ocrResultTabCount: 0,
    voiceCaptureTabCount: 1,
    voiceStartButtonCount: 1,
    previewInCaptureCount: 1,
    resultInCaptureCount: 1,
    combinedNavCount: 0
  });

  await page.locator('[data-ai-provider="openai"]').click();
  const aiConfigAlertProbe = {
    visible: await page.locator("#aiUnconfiguredDialog").isVisible(),
    title: await page.locator("#aiUnconfiguredTitle").textContent(),
    message: await page.locator("#aiUnconfiguredMessage").textContent(),
    selectedProvider: await page.locator('[data-ai-provider][aria-selected="true"]').getAttribute("data-ai-provider")
  };
  assert.deepEqual(aiConfigAlertProbe, {
    visible: true,
    title: "OpenAI 尚未配置",
    message: "该AI功能尚未配置，请先前往设置配置",
    selectedProvider: "deepseek"
  });
  await page.locator("#goToAiSettingsBtn").click();
  assert.equal(await page.locator("#settingsPanel").getAttribute("class"), "panel active");
  assert.equal(await page.locator("#providerInput").inputValue(), "openai");

  const configuredProviders = await page.evaluate(async () => {
    const results = [];
    for (const provider of ["deepseek", "openai", "claude"]) {
      results.push(await self.WinSpeedBallPopupMessageClient.send({
        action: "saveAiSettings",
        payload: { provider, apiKey: "edge-e2e-key" }
      }));
    }
    return results;
  });
  assert.equal(configuredProviders.every((result) => result.ok === true), true);
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll("#aiProviderTabs [data-ai-provider]").length === 4);
  await page.locator('[data-panel="aiPanel"]').evaluate((button) => button.click());

  await page.locator('[data-ai-provider="deepseek"]').click();
  await page.locator("#aiMode").selectOption("custom");
  await page.locator("#aiQuestion").fill("DeepSeek 独立问题");
  await page.locator('[data-ai-provider="openai"]').click();
  assert.equal(await page.locator("#aiQuestion").inputValue(), "");
  await page.locator("#aiQuestion").fill("OpenAI 独立问题");
  await page.locator('[data-ai-provider="deepseek"]').click();
  assert.equal(await page.locator("#aiQuestion").inputValue(), "DeepSeek 独立问题");
  assert.equal(await page.locator('[data-ai-provider="deepseek"]').getAttribute("aria-selected"), "true");
  await page.waitForTimeout(220);
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll("#aiProviderTabs [data-ai-provider]").length === 4);
  assert.equal(await page.locator('[data-ai-provider="deepseek"]').getAttribute("aria-selected"), "true");
  assert.equal(await page.locator("#aiQuestion").inputValue(), "DeepSeek 独立问题");
  await page.locator('[data-ai-provider="openai"]').click();
  assert.equal(await page.locator("#aiQuestion").inputValue(), "OpenAI 独立问题");
  await page.locator('[data-ai-provider="deepseek"]').click();

  const whisperPage = await context.newPage();
  const whisperPageErrors = [];
  whisperPage.on("pageerror", (error) => whisperPageErrors.push(error.message));
  await whisperPage.goto(`chrome-extension://${extensionId}/ocr/offscreen.html`);
  await whisperPage.waitForFunction(() => !!window.WinSpeedBallVoiceWorker, null, { timeout: 20000 });
  const whisperProbe = await whisperPage.evaluate(async () => window.WinSpeedBallVoiceWorker.prepare());
  assert.deepEqual(whisperProbe, { ok: true, model: "whisper-tiny", dtype: "q8", device: "wasm" });
  assert.deepEqual(whisperPageErrors, []);
  await whisperPage.close();

  const replyPage = await context.newPage();
  await replyPage.setViewportSize({ width: 320, height: 240 });
  await replyPage.goto(`chrome-extension://${extensionId}/popup/ai-reply.html`);
  const longReply = Array.from({ length: 40 }, (_, index) => `Line ${index + 1}: readable AI reply content.`).join("\n");
  await replyPage.evaluate(async (content) => chrome.storage.session.set({
    aiReplyWindowPayload: { content, updatedAt: Date.now() }
  }), longReply);
  await replyPage.waitForFunction(() => document.querySelector("#replyContent")?.textContent.includes("Line 40"));
  const aiReplyProbe = await replyPage.evaluate(() => {
    const content = document.querySelector("#replyContent");
    const copyButton = document.querySelector("#copyBtn");
    const style = getComputedStyle(content);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      scrollable: content.scrollHeight > content.clientHeight,
      contentHeight: Math.round(content.getBoundingClientRect().height),
      metaText: document.querySelector("#replyMeta")?.textContent || "",
      copyEnabled: !copyButton.disabled,
      copyVisible: copyButton.getBoundingClientRect().bottom <= innerHeight,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth
    };
  });
  assert.deepEqual(aiReplyProbe.viewport, { width: 320, height: 240 });
  assert.equal(aiReplyProbe.fontSize, "13px");
  assert.ok(Number.parseFloat(aiReplyProbe.lineHeight) >= 22);
  assert.equal(aiReplyProbe.scrollable, true);
  assert.ok(aiReplyProbe.contentHeight >= 110);
  assert.match(aiReplyProbe.metaText, /\d+ \u5b57$/);
  assert.equal(aiReplyProbe.copyEnabled, true);
  assert.equal(aiReplyProbe.copyVisible, true);
  assert.equal(aiReplyProbe.horizontalOverflow, false);
  await replyPage.close();

  const aiWindowDedupProbe = await page.evaluate(async () => {
    const replyUrl = chrome.runtime.getURL("popup/ai-reply.html");
    const createReplyWindow = () => new Promise((resolve, reject) => {
      chrome.windows.create({ url: replyUrl, type: "popup", width: 320, height: 240 }, (created) => {
        const error = chrome.runtime.lastError;
        if (error || !created) reject(new Error(error?.message || "Could not create duplicate reply window."));
        else resolve(created.id);
      });
    });
    await Promise.all([createReplyWindow(), createReplyWindow()]);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const before = await chrome.runtime.getContexts({ documentUrls: [replyUrl] });
    const previousWindowIds = [...new Set(before.map((context) => context.windowId))];
    const response = await self.WinSpeedBallPopupMessageClient.send({
      action: "showAiReplyWindow",
      payload: {
        content: "Deduplicated reply",
        windowLeft: screenX,
        windowTop: screenY,
        windowWidth: outerWidth,
        windowHeight: outerHeight
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const after = await chrome.runtime.getContexts({ documentUrls: [replyUrl] });
    const remainingWindowIds = [...new Set(after.map((context) => context.windowId))];
    return {
      responseOk: response.ok === true,
      beforeCount: previousWindowIds.length,
      afterCount: remainingWindowIds.length,
      remainingWindowId: remainingWindowIds[0] ?? null,
      replyWindowReplaced: remainingWindowIds.length === 1 && !previousWindowIds.includes(remainingWindowIds[0])
    };
  });
  assert.equal(aiWindowDedupProbe.responseOk, true);
  assert.equal(aiWindowDedupProbe.beforeCount, 2);
  assert.equal(aiWindowDedupProbe.afterCount, 1);
  assert.equal(aiWindowDedupProbe.replyWindowReplaced, true);
  const remainingReplyPage = context.pages().find((candidate) => candidate.url() === `chrome-extension://${extensionId}/popup/ai-reply.html`);
  assert.ok(remainingReplyPage);
  await remainingReplyPage.locator("#closeBtn").click();
  await page.waitForFunction(async (replyUrl) => {
    const contexts = await chrome.runtime.getContexts({ documentUrls: [replyUrl] });
    return contexts.length === 0;
  }, `chrome-extension://${extensionId}/popup/ai-reply.html`);
  const aiWindowCloseProbe = await page.evaluate(async (closedWindowId) => {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["popup"] });
    return {
      replyWindowClosed: !windows.some((windowInfo) => windowInfo.id === closedWindowId),
      newTabReplacementCount: windows.filter((windowInfo) => (windowInfo.tabs || []).some((tab) => tab.url === "edge://newtab/")).length
    };
  }, aiWindowDedupProbe.remainingWindowId);
  assert.equal(aiWindowCloseProbe.replyWindowClosed, true);
  assert.equal(aiWindowCloseProbe.newTabReplacementCount, 0);

  await page.evaluate(async () => chrome.storage.local.set({ popupLastPanel: "bookPanel" }));
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#bookPanel")?.classList.contains("active"));
  const bookInterfaceProbe = {
    detectButtonCount: await page.locator("#bookDetectBtn").count(),
    imageDetectButtonCount: await page.locator("#bookImageDetectBtn").count(),
    chaoxingDetectButtonCount: await page.locator("#bookChaoxingDetectBtn").count(),
    chaoxingIntervalMin: await page.locator("#bookChaoxingIntervalInput").getAttribute("min"),
    backCoverMonitorCount: await page.locator("#bookBackCoverMonitor").count(),
    backCoverSequence: await page.locator("#bookBackCoverMonitor .book-cover-sequence").textContent(),
    modeTabCount: await page.locator("#bookPanel .book-view-tab").count(),
    modeTabsSingleRow: await page.locator("#bookPanel .book-view-tab").evaluateAll((buttons) => new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))).size === 1),
    previousButtonCount: await page.locator("#bookPrevBtn").count(),
    nextButtonCount: await page.locator("#bookNextBtn").count(),
    actionsSingleRow: await page.locator("#bookPageView .book-actions .btn").evaluateAll((buttons) => new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))).size === 1),
    supportHint: await page.locator("#bookPageView .hint").textContent()
  };
  assert.deepEqual(bookInterfaceProbe, {
    detectButtonCount: 1,
    imageDetectButtonCount: 1,
    chaoxingDetectButtonCount: 1,
    chaoxingIntervalMin: "2",
    backCoverMonitorCount: 1,
    backCoverSequence: "400 → 300 → 250 → 150 → 50 秒",
    modeTabCount: 3,
    modeTabsSingleRow: true,
    previousButtonCount: 1,
    nextButtonCount: 1,
    actionsSingleRow: true,
    supportHint: "使用浏览器 MAIN 主环境原生强控，直接调用阅读器原生翻页接口；只控制已检测到的阅读器，不会点击课程的下一节。"
  });
  await page.locator("#bookImageTab").click();
  assert.equal(await page.locator("#bookPageView").isVisible(), false);
  assert.equal(await page.locator("#bookImageView").isVisible(), true);
  assert.equal(await page.locator("#bookImageTab").getAttribute("aria-selected"), "true");
  await page.locator("#bookChaoxingTab").click();
  assert.equal(await page.locator("#bookImageView").isVisible(), false);
  assert.equal(await page.locator("#bookChaoxingView").isVisible(), true);
  assert.equal(await page.locator("#bookChaoxingTab").getAttribute("aria-selected"), "true");
  assert.equal(await page.locator("#bookBackCoverMonitor").isVisible(), true);
  await page.locator("#bookChaoxingIntervalInput").fill("1");
  await page.locator("#bookChaoxingIntervalInput").dispatchEvent("change");
  await page.waitForFunction(() => document.querySelector("#bookChaoxingIntervalInput")?.value === "2");
  await page.evaluate(async () => chrome.storage.local.set({
    bookPanelState: {
      running: true,
      interval: 2,
      mode: "chaoxing",
      backCoverCheckIndex: 0,
      backCoverCheckDueAt: Date.now() + 60000,
      backCoverPageJumpLabel: "正文362页",
      backCoverReached: false
    }
  }));
  await page.waitForFunction(() => document.querySelector("#bookBackCoverState")?.textContent === "检测中");
  assert.equal(await page.locator("#bookBackCoverOption").textContent(), "正文362页");
  assert.match(await page.locator("#bookBackCoverNext").textContent() || "", /^\d+ 秒$/);
  await page.evaluate(async () => chrome.storage.local.set({
    bookPanelState: {
      running: false,
      interval: 2,
      mode: "chaoxing",
      backCoverCheckIndex: 0,
      backCoverCheckDueAt: 0,
      backCoverPageJumpLabel: "封底页",
      backCoverReached: true
    }
  }));
  await page.waitForFunction(() => document.querySelector("#bookBackCoverState")?.textContent === "已到封底");
  assert.equal(await page.locator("#bookBackCoverOption").textContent(), "封底页");
  assert.equal(await page.locator("#bookBackCoverNext").textContent(), "已自动停止");
  await page.locator('[data-panel="ocrPanel"]').evaluate((button) => button.click());
  await page.waitForFunction(async () => (await chrome.storage.local.get("popupLastPanel")).popupLastPanel === "ocrPanel");
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#ocrPanel")?.classList.contains("active"));
  assert.equal(await page.locator("#ocrCaptureView").isVisible(), true);
  assert.equal(await page.locator("#ocrText").isVisible(), true);
  await page.locator("#voiceCaptureTab").click();
  assert.equal(await page.locator("#ocrCaptureView").isVisible(), false);
  assert.equal(await page.locator("#voiceCaptureView").isVisible(), true);
  assert.equal(await page.locator("#voiceCaptureTab").getAttribute("aria-selected"), "true");
  assert.equal(await page.locator("#startTabAudioBtn").isEnabled(), true);
  assert.equal(await page.locator("#stopTabAudioBtn").isDisabled(), true);
  assert.match(await page.locator("#voiceStatus").textContent() || "", /网页声音|网页语音|Whisper/);
  await page.locator("#ocrCaptureTab").click();
  assert.equal(await page.locator("#ocrCaptureView").isVisible(), true);
  assert.equal(await page.locator("#voiceCaptureView").isVisible(), false);

  await page.evaluate(() => {
    document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === "developerPanel"));
    document.querySelectorAll("#developerPanel details").forEach((details) => { details.open = true; });
  });
  await page.locator("#developerScriptEditor").waitFor({ state: "visible" });

  const code = `// ==UserScript==
// @name Edge Sandbox Probe
// @version 1.0.0
// @wsb-capability storage
// ==/UserScript==

const escapedGlobal = ({}).constructor.constructor("return this")();
const probe = {
  chromeType: typeof escapedGlobal.chrome,
  fetchType: typeof escapedGlobal.fetch,
  webSocketType: typeof escapedGlobal.WebSocket,
  webTransportType: typeof escapedGlobal.WebTransport,
  workerType: typeof escapedGlobal.Worker,
  broadcastChannelType: typeof escapedGlobal.BroadcastChannel,
  postMessageType: typeof escapedGlobal.postMessage,
  networkSucceeded: false
};
try {
  if (typeof escapedGlobal.fetch === "function") {
    await escapedGlobal.fetch("https://example.com/");
    probe.networkSucceeded = true;
  }
} catch (error) {}
await WSB.storage.set("sandbox.probe", probe);
  return probe;`;

  await page.locator("#developerScriptEditor").fill(code);
  await page.waitForFunction(([lines, characters]) => {
    return document.querySelector("#developerLineCount")?.textContent === String(lines) &&
      document.querySelector("#developerCharacterCount")?.textContent === String(characters) &&
      document.querySelector("#developerDeclaredCapabilityCount")?.textContent === "1" &&
      document.querySelector("#developerSaveState")?.textContent === "未保存";
  }, [code.split(/\r?\n/).length, code.length]);
  await page.locator("#developerScriptEditor").press("Control+s");
  await page.waitForFunction(() => document.querySelector("#developerScriptOutput")?.textContent.includes("已保存"));
  assert.equal(await page.locator("#developerSaveState").textContent(), "已保存");
  await page.locator("#duplicateDeveloperDraftBtn").click();
  await page.waitForFunction(() => document.querySelector("#developerScriptOutput")?.textContent.includes("副本已创建"));
  const developerProbe = {
    sdkVersion: await page.locator("#developerSdkVersion").textContent(),
    draftCount: await page.locator("#developerDraftSelect option").count(),
    duplicateName: await page.locator("#developerDraftSelect option:checked").textContent(),
    lineCount: await page.locator("#developerLineCount").textContent(),
    characterCount: await page.locator("#developerCharacterCount").textContent(),
    capabilityCount: await page.locator("#developerDeclaredCapabilityCount").textContent(),
    saveState: await page.locator("#developerSaveState").textContent(),
    publicMethodLabels: await page.locator("#developerApiMethod option").allTextContents()
  };
  assert.equal(developerProbe.sdkVersion, "3.7.0-beta");
  assert.equal(developerProbe.draftCount, 2);
  assert.match(developerProbe.duplicateName || "", /副本/);
  assert.equal(developerProbe.capabilityCount, "1");
  assert.equal(developerProbe.saveState, "已保存");
  assert.equal(developerProbe.publicMethodLabels.includes("video.status"), true);
  assert.equal(developerProbe.publicMethodLabels.includes("book.status"), true);
  assert.equal(developerProbe.publicMethodLabels.includes("video.getStatus"), false);
  await page.locator("#startDeveloperSessionBtn").click();
  await page.waitForFunction(() => {
    const text = document.querySelector("#developerSessionStatus")?.textContent || "";
    return text.includes("执行完成") || text.includes("运行失败") || text.includes("启动失败");
  }, null, { timeout: 15000 });
  const sessionStatus = await page.locator("#developerSessionStatus").textContent();
  assert.match(sessionStatus || "", /执行完成/);

  await page.locator("#developerApiMethod").selectOption("storage.get");
  await page.locator("#developerApiArgs").fill('["sandbox.probe"]');
  assert.equal(await page.locator("#developerApiCapability").textContent(), "所需能力：storage");
  await page.locator("#runDeveloperApiTestBtn").click();
  await page.waitForFunction(() => document.querySelector("#developerApiOutput")?.textContent.includes("networkSucceeded"));
  const output = JSON.parse(await page.locator("#developerApiOutput").textContent());
  assert.equal(output.ok, true);
  assert.equal(output.contractOnly, false);
  assert.equal(output.value.chromeType, "undefined");
  assert.equal(output.value.fetchType, "undefined");
  assert.equal(output.value.webSocketType, "undefined");
  assert.equal(output.value.webTransportType, "undefined");
  assert.equal(output.value.workerType, "undefined");
  assert.equal(output.value.broadcastChannelType, "undefined");
  assert.equal(output.value.postMessageType, "undefined");
  assert.equal(output.value.networkSucceeded, false);

  await page.locator("#stopDeveloperSessionBtn").click();
  await page.waitForFunction(() => document.querySelector("#developerSessionStatus")?.textContent.includes("已停止"));
  const sessionState = await page.evaluate(async () => chrome.storage.session.get([
    "sdkRuntimeTokens", "sdkRuntimeSessions", "sdkContextIntents"
  ]));
  assert.equal(Object.keys(sessionState.sdkRuntimeTokens || {}).length, 0);
  assert.equal(Object.keys(sessionState.sdkRuntimeSessions || {}).length, 0);
  assert.equal(Object.keys(sessionState.sdkContextIntents || {}).length, 0);

  const localPage = await context.newPage();
  await localPage.addInitScript(() => {
    window.chrome = {
      runtime: {
        id: "edge-e2e",
        lastError: null,
        sendMessage(message, callback) { if (callback) callback({ ok: true }); },
        onMessage: { addListener() {} }
      }
    };
  });
  await localPage.goto(`${localOrigin}/course`);
  await localPage.evaluate(() => {
    const video = document.querySelector("video");
    window.__courseNativeRateDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "playbackRate");
    video.addEventListener("ratechange", () => {
      if (window.__courseNativeRateDescriptor.get.call(video) !== 1) {
        window.__courseNativeRateDescriptor.set.call(video, 1);
      }
    });
  });
  await localPage.addScriptTag({ path: path.join(root, "content/shadow-hook.js") });
  await localPage.addScriptTag({ path: path.join(root, "content/media-core-main.js") });
  const videoProbe = await localPage.evaluate(async () => {
    const video = document.querySelector("video");
    const before = window.WinSpeedBallMediaCore.handleCommand({ type: "GET_MEDIA_LIST" });
    const changed = window.WinSpeedBallMediaCore.handleCommand({ type: "SET_RATE", rate: 2 });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const resistedRate = video.playbackRate;
    window.__courseNativeRateDescriptor.set.call(video, 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const nativeSetterResisted = window.__courseNativeRateDescriptor.get.call(video);
    Object.defineProperty(video, "playbackRate", {
      configurable: false,
      get() { return 1; },
      set() {}
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const descriptorRecovered = !Object.prototype.hasOwnProperty.call(video, "playbackRate") && window.__courseNativeRateDescriptor.get.call(video) === 2;
    const prototypeDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "playbackRate");
    const reflectResult = Reflect.defineProperty(HTMLMediaElement.prototype, "playbackRate", {
      configurable: true,
      get() { return 1; },
      set() {}
    });
    const protectedDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "playbackRate");
    const prototypeProtected = reflectResult === true && protectedDescriptor.get === prototypeDescriptor.get && protectedDescriptor.set === prototypeDescriptor.set;
    const paused = await window.WinSpeedBallMediaCore.handleCommand({ type: "PAUSE" });
    const lock = window.WinSpeedBallMediaCore.handleCommand({ type: "LOCK_STATE" });
    window.WinSpeedBallMediaCore.handleCommand({ type: "ENABLE_AUTOPLAY" });
    const afterAutoplayOff = window.WinSpeedBallMediaCore.handleCommand({ type: "DISABLE_AUTOPLAY" });
    const stopped = window.WinSpeedBallMediaCore.handleCommand({ type: "STOP_LOCK" });
    video.playbackRate = 1;
    const unlockedRate = video.playbackRate;
    return { before, changed, resistedRate, nativeSetterResisted, descriptorRecovered, prototypeProtected, unlockedRate, paused, lock, afterAutoplayOff, stopped };
  });
  assert.equal(videoProbe.before.media[0].title, "Local lesson");
  assert.equal(Object.prototype.hasOwnProperty.call(videoProbe.before.media[0], "url"), false);
  assert.equal(videoProbe.changed.rate, 2);
  assert.equal(videoProbe.changed.rateLocked, true);
  assert.equal(videoProbe.resistedRate, 2);
  assert.equal(videoProbe.nativeSetterResisted, 2);
  assert.equal(videoProbe.descriptorRecovered, true);
  assert.equal(videoProbe.prototypeProtected, true);
  assert.equal(videoProbe.unlockedRate, 1);
  assert.equal(videoProbe.paused.paused, true);
  assert.equal(videoProbe.lock.controlMode, "lock");
  assert.equal(videoProbe.afterAutoplayOff.controlMode, "lock");
  assert.equal(videoProbe.stopped.controlMode, "stopped");

  await page.bringToFront();
  await page.evaluate(() => {
    document.body.classList.remove("script-workspace", "script-ui-active");
    document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === "ocrPanel"));
  });
  await page.locator("#voiceCaptureTab").click();
  await page.locator("#startTabAudioBtn").click();
  await page.waitForFunction(() => /插件弹窗|工具栏/.test(document.querySelector("#voiceStatus")?.textContent || ""), null, { timeout: 20000 });
  const handoffProbe = await page.evaluate(async () => chrome.storage.local.get(["voiceJobStatus", "voiceJobError", "voiceNeedsToolbarPopup"]));
  assert.equal(handoffProbe.voiceNeedsToolbarPopup, true, JSON.stringify(handoffProbe));
  assert.match(handoffProbe.voiceJobError || "", /Edge 安全限制[\s\S]*工具栏/);
  await page.evaluate(async () => self.WinSpeedBallPopupMessageClient.send({ action: "cancelTabAudioCapture" }));
  await page.waitForFunction(async () => (await chrome.storage.local.get("voiceJobStatus")).voiceJobStatus === "cancelled");
  await localPage.close();

  const disabled = await page.evaluate(async () => self.WinSpeedBallPopupMessageClient.send({
    action: "setDeveloperMode",
    payload: { enabled: false, confirmed: false }
  }));
  assert.equal(disabled.ok, true);
  assert.equal(disabled.enabled, false);

  process.stdout.write(JSON.stringify({
    ok: true,
    browser: await context.browser()?.version(),
    extensionId,
    interfaceProbe,
    aiConfigAlertProbe,
    whisperProbe,
    aiReplyProbe,
    aiWindowDedupProbe,
    aiWindowCloseProbe,
    developerProbe,
    sessionStatus,
    sandboxProbe: output.value,
    videoProbe: videoProbe.before.media[0],
    handoffProbe,
    lifecycle: { lock: videoProbe.lock.controlMode, afterAutoplayOff: videoProbe.afterAutoplayOff.controlMode, stopped: videoProbe.stopped.controlMode }
  }, null, 2));
} finally {
  if (context) await context.close();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(profile, { recursive: true, force: true });
}
