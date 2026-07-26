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
let sandboxFontRequestCount = 0;
const server = http.createServer((request, response) => {
  if (new URL(request.url || "/", "http://127.0.0.1").pathname === "/sandbox-font-probe.woff2") {
    sandboxFontRequestCount += 1;
    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "font/woff2"
    });
    response.end(Buffer.from([0, 1, 0, 0]));
    return;
  }
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

  const sandboxCspPage = await context.newPage();
  await sandboxCspPage.goto(`chrome-extension://${extensionId}/sdk/script-runner.html`);
  const sandboxCspFontProbe = await sandboxCspPage.evaluate(async (fontUrl) => {
    const result = {
      fontFaceType: typeof FontFace,
      attempted: false,
      loaded: false
    };
    if (typeof FontFace !== "function") return result;
    result.attempted = true;
    try {
      const font = new FontFace("SandboxCspProbe", `url("${fontUrl}")`);
      await font.load();
      result.loaded = font.status === "loaded";
    } catch (error) {}
    return result;
  }, `${localOrigin}/sandbox-font-probe.woff2`);
  await sandboxCspPage.waitForTimeout(100);
  assert.equal(sandboxCspFontProbe.fontFaceType, "function");
  assert.equal(sandboxCspFontProbe.attempted, true);
  assert.equal(sandboxCspFontProbe.loaded, false);
  assert.equal(sandboxFontRequestCount, 0);
  await sandboxCspPage.close();

  const page = await context.newPage();
  const pageErrors = [];
  const failedRequests = [];
  page.on("dialog", (dialog) => dialog.accept());
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push(`${request.url()}：${request.failure()?.errorText || "失败"}`));
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
    aiNavLabel: await page.locator('[data-panel="aiPanel"]').textContent(),
    aiNavFits: await page.locator('[data-panel="aiPanel"]').evaluate((button) => button.scrollWidth <= button.clientWidth),
    aiTeachingNavCount: await page.locator('[data-panel="aiTeachingPanel"]').count(),
    aiTeachingHeaderButtonCount: await page.locator("#openAiTeachingBtn").count(),
    aiTeachingHeaderButtonLabel: await page.locator("#openAiTeachingBtn").textContent(),
    aiTeachingHeaderButtonFits: await page.locator("#openAiTeachingBtn").evaluate((button) => button.scrollWidth <= button.clientWidth),
    mainScrollTopInHeader: await page.locator(".header-actions > #mainScrollTopBtn").count(),
    mainScrollTopPosition: await page.locator("#mainScrollTopBtn").evaluate((button) => getComputedStyle(button).position),
    aiTeachingBackButtonCount: await page.locator("#closeAiTeachingBtn").count(),
    aiProviderTabCount: await page.locator("#aiProviderTabs [data-ai-provider]").count(),
    aiProviderLabels: await page.locator("#aiProviderTabs [data-ai-provider]").allTextContents(),
    aiProviderFullLabels: await page.locator("#aiProviderTabs [data-ai-provider]").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
    aiProviderSingleRow: await page.locator("#aiProviderTabs [data-ai-provider]").evaluateAll((buttons) => new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))).size === 1),
    aiProviderButtonHeight: await page.locator('[data-ai-provider="deepseek"]').evaluate((button) => Math.round(button.getBoundingClientRect().height)),
    ocrPanelCount: await page.locator("#ocrPanel").count(),
    aiPanelCount: await page.locator("#aiPanel").count(),
    aiTeachingPanelCount: await page.locator("#aiTeachingPanel").count(),
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
    aiNavLabel: "AI答题",
    aiNavFits: true,
    aiTeachingNavCount: 0,
    aiTeachingHeaderButtonCount: 1,
    aiTeachingHeaderButtonLabel: "AI教学",
    aiTeachingHeaderButtonFits: true,
    mainScrollTopInHeader: 1,
    mainScrollTopPosition: "static",
    aiTeachingBackButtonCount: 1,
    aiProviderTabCount: 4,
    aiProviderLabels: ["DS", "OAI", "CLD", "LM"],
    aiProviderFullLabels: ["DeepSeek", "OpenAI", "Claude", "Local model"],
    aiProviderSingleRow: true,
    aiProviderButtonHeight: 24,
    ocrPanelCount: 1,
    aiPanelCount: 1,
    aiTeachingPanelCount: 1,
    combinedPanelCount: 0,
    ocrCaptureTabCount: 1,
    ocrResultTabCount: 0,
    voiceCaptureTabCount: 1,
    voiceStartButtonCount: 1,
    previewInCaptureCount: 1,
    resultInCaptureCount: 1,
    combinedNavCount: 0
  });

  const paletteProbe = await page.evaluate(() => {
    const color = (selector, property) => getComputedStyle(document.querySelector(selector))[property];
    return {
      background: color("body", "backgroundColor"),
      text: color("body", "color"),
      panel: color("details.fold", "backgroundColor"),
      card: color(".message", "backgroundColor"),
      input: color("textarea", "backgroundColor"),
      title: color("h1", "color"),
      muted: color(".header-account", "color"),
      hint: color(".hint", "color"),
      primary: color(".btn.primary", "backgroundColor"),
      danger: color(".btn.danger", "backgroundColor"),
      activeNavigation: color('[data-panel="aiPanel"]', "backgroundColor"),
      mainScrollbar: color(".content", "scrollbarWidth")
    };
  });
  assert.deepEqual(paletteProbe, {
    background: "rgb(255, 255, 255)",
    text: "rgb(23, 23, 23)",
    panel: "rgb(255, 255, 255)",
    card: "rgb(255, 255, 255)",
    input: "rgb(255, 255, 255)",
    title: "rgb(23, 23, 23)",
    muted: "rgb(112, 112, 112)",
    hint: "rgb(112, 112, 112)",
    primary: "rgb(155, 220, 255)",
    danger: "rgb(255, 255, 255)",
    activeNavigation: "rgb(155, 220, 255)",
    mainScrollbar: "none"
  });
  const themeAuditProbe = await page.evaluate(() => {
    const allowedBackgrounds = new Set([
      "rgba(0, 0, 0, 0)",
      "rgb(0, 0, 0)",
      "rgb(255, 255, 255)",
      "rgb(155, 220, 255)",
      "rgb(112, 112, 112)",
      "rgba(112, 112, 112, 0.48)",
      "rgba(255, 255, 255, 0.96)",
      "rgba(255, 255, 255, 0.97)",
      "rgba(96, 96, 96, 0.14)"
    ]);
    const allowedText = new Set([
      "rgb(0, 0, 0)",
      "rgb(23, 23, 23)",
      "rgb(112, 112, 112)",
      "rgb(155, 220, 255)"
    ]);
    return Array.from(document.body.querySelectorAll("*")).flatMap((node) => {
      if (["SCRIPT", "STYLE"].includes(node.tagName)) return [];
      const style = getComputedStyle(node);
      const problems = [];
      if (!allowedBackgrounds.has(style.backgroundColor)) problems.push(`background=${style.backgroundColor}`);
      if (!allowedText.has(style.color)) problems.push(`color=${style.color}`);
      return problems.length ? [{
        node: node.id ? `#${node.id}` : `${node.tagName.toLowerCase()}.${String(node.className || "").trim().replace(/\s+/g, ".")}`,
        problems
      }] : [];
    }).slice(0, 30);
  });
  assert.deepEqual(themeAuditProbe, []);
  await page.locator("#authorNavBtn").evaluate((button) => button.click());
  await page.locator("#authorPanel .account-card").first().hover();
  const workAreaCardHoverProbe = await page.locator("#authorPanel .account-card").first().evaluate((card) => ({
    background: getComputedStyle(card).backgroundColor,
    border: getComputedStyle(card).borderTopColor
  }));
  assert.deepEqual(workAreaCardHoverProbe, {
    background: "rgb(255, 255, 255)",
    border: "rgb(155, 220, 255)"
  });
  await page.locator('[data-panel="aiPanel"]').evaluate((button) => button.click());

  await page.locator("#openAiTeachingBtn").evaluate((button) => button.click());
  await page.waitForFunction(() => document.body.classList.contains("ai-teaching-mode"));
  assert.equal(await page.locator("#aiTeachingPanel").isVisible(), true);
  assert.equal(await page.locator(".layout").isVisible(), false);
  assert.equal(await page.locator("#closeAiTeachingBtn").isVisible(), true);
  assert.equal(await page.locator("#aiTeachingMethod").count(), 0);
  assert.equal(await page.locator("#aiTeachingGuidedMethodBtn").count(), 0);
  assert.equal(await page.locator("#aiTeachingWallMethodBtn").count(), 0);
  assert.equal(await page.locator(".ai-teaching-method-summary strong").textContent(), "公式解析式教学");
  assert.match(await page.locator(".ai-teaching-method-summary").textContent() || "", /本步公式→符号与条件→题目对应→顺带举例→单步提问→迁移检验/);
  assert.match(await page.locator("#aiTeachingMethodHint").textContent() || "", /先指出本步公式或规律/);
  assert.equal(await page.locator("#aiTeachingAttemptTitle").textContent(), "我的回答与思路");
  assert.equal(await page.locator("#continueAiTeachingBtn").textContent(), "提交回答");
  assert.equal(await page.locator("#explainAiTeachingBtn").textContent(), "公式与例题");
  const formulaRenderResult = await page.locator("#aiTeachingGuidance").evaluate((guidance) => Promise.race([
    window.WSBMathRenderer.render(
      guidance,
      "**本步公式**\n余弦定理: (c 2 = a 2 + b 2 - 2ab cos C)\n" +
        "求根公式：\n$$x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}$$\n" +
        "化学方程式：\n```latex\n\\ce{2H2 + O2 -> 2H2O}\n```"
    ),
    new Promise((resolve) => setTimeout(() => resolve({
      ok: false,
      timeout: true,
      mathJaxReady: typeof window.MathJax?.typesetPromise === "function",
      startupState: window.MathJax?.startup?.document?.state?.() || 0,
      scriptSource: document.querySelector('script[src*="mathjax"]')?.src || "",
      resources: performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => name.includes("mathjax"))
    }), 12000))
  ]));
  assert.equal(
    formulaRenderResult?.ok,
    true,
    formulaRenderResult?.error || (formulaRenderResult?.timeout
      ? `公式渲染超时；页面错误：${pageErrors.join(" | ") || "无"}；失败请求：${failedRequests.join(" | ") || "无"}；资源：${(formulaRenderResult.resources || []).join(", ") || "无"}`
      : "公式渲染未返回有效状态")
  );
  assert.equal(formulaRenderResult.formulas, true);
  await page.waitForFunction(() => document.querySelectorAll("#aiTeachingGuidance mjx-container svg").length === 3);
  const formulaImageProbe = await page.locator("#aiTeachingGuidance").evaluate((guidance) => {
    const math = guidance.querySelector("mjx-container");
    const svg = guidance.querySelector("mjx-container svg");
    const glyph = svg?.querySelector("use, path");
    const mathStyle = math ? getComputedStyle(math) : null;
    const parentStyle = math?.parentElement ? getComputedStyle(math.parentElement) : null;
    const glyphStyle = glyph ? getComputedStyle(glyph) : null;
    return {
      svgCount: guidance.querySelectorAll("mjx-container svg").length,
      title: guidance.querySelector("strong")?.textContent || "",
      rawMarkdownVisible: guidance.textContent.includes("**"),
      role: svg?.getAttribute("role") || "",
      display: math?.getAttribute("display") || "",
      formulaLarger: Number.parseFloat(mathStyle?.fontSize || "0") > Number.parseFloat(parentStyle?.fontSize || "0"),
      formulaBlack: mathStyle?.color === "rgb(0, 0, 0)",
      formulaBold: Number.parseFloat(glyphStyle?.strokeWidth || "0") > 0 && glyphStyle?.stroke === "rgb(0, 0, 0)",
      remoteFormulaResources: performance.getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((name) => /^https?:/i.test(name) && /mathjax|mhchem/i.test(name)),
      fits: Array.from(guidance.querySelectorAll("mjx-container svg")).every((formula) =>
        formula.getBoundingClientRect().width <= guidance.getBoundingClientRect().width)
    };
  });
  assert.deepEqual(formulaImageProbe, {
    svgCount: 3,
    title: "本步公式",
    rawMarkdownVisible: false,
    role: "img",
    display: "true",
    formulaLarger: true,
    formulaBlack: true,
    formulaBold: true,
    remoteFormulaResources: [],
    fits: true
  });
  const longFormulaWrapProbe = await page.locator("#aiTeachingGuidance").evaluate(async (guidance) => {
    const value = "\\[-(\\cos C)\\text{ 是角 }C\\text{ 的余弦值，计算时角度应使用度数制或弧度制并保持一致；此处 }C=60^\\circ,\\ \\cos 60^\\circ=0.5。\\]";
    const result = await window.WSBMathRenderer.render(guidance, value);
    const math = guidance.querySelector("mjx-container");
    const lineBoxes = math?.querySelectorAll("[data-mjx-linebox]") || [];
    const group = guidance.querySelector("[data-formula-wrapped='true']");
    const formulas = Array.from(guidance.querySelectorAll("mjx-container svg"));
    return {
      ok: result?.ok === true,
      overflow: math?.getAttribute("overflow") || "",
      lineBoxCount: lineBoxes.length,
      wrapped: !!group,
      rowCount: group?.querySelectorAll(".ai-teaching-formula-row").length || 0,
      fits: formulas.length >= 2 && formulas.every((svg) =>
        svg.getBoundingClientRect().width <= guidance.getBoundingClientRect().width),
      horizontalOverflow: guidance.scrollWidth > guidance.clientWidth + 1
    };
  });
  assert.equal(longFormulaWrapProbe.ok, true);
  assert.equal(longFormulaWrapProbe.overflow, "linebreak");
  assert.equal(longFormulaWrapProbe.wrapped, true);
  assert.ok(longFormulaWrapProbe.rowCount >= 2, `长公式说明应按语义拆成多行：${JSON.stringify(longFormulaWrapProbe)}`);
  assert.equal(longFormulaWrapProbe.fits, true);
  assert.equal(longFormulaWrapProbe.horizontalOverflow, false);
  await page.locator("#closeAiTeachingBtn").click();
  await page.waitForFunction(() => !document.body.classList.contains("ai-teaching-mode"));
  assert.equal(await page.locator("#aiTeachingPanel").isVisible(), false);
  assert.equal(await page.locator(".layout").isVisible(), true);
  await page.reload();
  await page.locator("#openAiTeachingBtn").evaluate((button) => button.click());
  await page.waitForFunction(() => document.body.classList.contains("ai-teaching-mode"));
  assert.equal(await page.locator(".ai-teaching-method-summary strong").textContent(), "公式解析式教学");
  assert.equal(await page.locator("#continueAiTeachingBtn").textContent(), "提交回答");
  await page.locator("#closeAiTeachingBtn").click();

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

  await page.locator('[data-panel="aiPanel"]').evaluate((button) => button.click());
  const mainAiFormula = "**公式说明**\n余弦定理: (c 2 = a 2 + b 2 - 2ab cos C)\n求根公式：\n\\[x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}\\]";
  await page.locator("#aiAnswer").evaluate((answer, value) => {
    answer.value = value;
    answer.dispatchEvent(new Event("input", { bubbles: true }));
  }, mainAiFormula);
  await page.waitForFunction(() => document.querySelectorAll("#aiAnswerFormulaPreview mjx-container svg").length === 2);
  const aiAnswerFormulaProbe = await page.evaluate(() => {
    const source = document.querySelector("#aiAnswer");
    const preview = document.querySelector("#aiAnswerFormulaPreview");
    const math = preview.querySelector("mjx-container");
    const glyph = math?.querySelector("use, path");
    const mathStyle = math ? getComputedStyle(math) : null;
    const parentStyle = math?.parentElement ? getComputedStyle(math.parentElement) : null;
    const glyphStyle = glyph ? getComputedStyle(glyph) : null;
    return {
      sourceHidden: source.hidden,
      previewHidden: preview.hidden,
      svgCount: preview.querySelectorAll("mjx-container svg").length,
      rawMarkdownVisible: preview.textContent.includes("**"),
      formulaLarger: Number.parseFloat(mathStyle?.fontSize || "0") > Number.parseFloat(parentStyle?.fontSize || "0"),
      formulaBlack: mathStyle?.color === "rgb(0, 0, 0)",
      formulaBold: Number.parseFloat(glyphStyle?.strokeWidth || "0") > 0 && glyphStyle?.stroke === "rgb(0, 0, 0)",
      remoteFormulaResources: performance.getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((name) => /^https?:/i.test(name) && /mathjax|mhchem/i.test(name)),
      fits: Array.from(preview.querySelectorAll("mjx-container svg")).every((formula) =>
        formula.getBoundingClientRect().width <= preview.getBoundingClientRect().width)
    };
  });
  assert.deepEqual(aiAnswerFormulaProbe, {
    sourceHidden: true,
    previewHidden: false,
    svgCount: 2,
    rawMarkdownVisible: false,
    formulaLarger: true,
    formulaBlack: true,
    formulaBold: true,
    remoteFormulaResources: [],
    fits: true
  });

  const whisperPage = await context.newPage();
  const whisperPageErrors = [];
  whisperPage.on("pageerror", (error) => whisperPageErrors.push(error.message));
  await whisperPage.goto(`chrome-extension://${extensionId}/ocr/offscreen.html`);
  await whisperPage.waitForFunction(() => !!window.WinSpeedBallVoiceWorker, null, { timeout: 20000 });
  const whisperProbe = await whisperPage.evaluate(async () => window.WinSpeedBallVoiceWorker.prepare());
  assert.deepEqual(whisperProbe, { ok: true, model: "whisper-tiny", dtype: "q8", device: "wasm" });
  assert.deepEqual(whisperPageErrors, []);
  await whisperPage.close();

  const ocrRuntimePage = await context.newPage();
  const ocrRuntimeErrors = [];
  ocrRuntimePage.on("pageerror", (error) => ocrRuntimeErrors.push(error.message));
  await ocrRuntimePage.goto(`chrome-extension://${extensionId}/docs/ocr-runtime-test.html`);
  await ocrRuntimePage.waitForFunction(() => /^(?:PASS|FAIL|ERROR):/.test(document.querySelector("#result")?.textContent || ""), null, { timeout: 120000 });
  const grayOptionOcrText = await ocrRuntimePage.locator("#result").textContent();
  assert.match(grayOptionOcrText, /^PASS:/, grayOptionOcrText);
  const grayOptionOcrProbe = {
    passed: true,
    labels: ["A", "B", "C", "D"].filter((label) =>
      new RegExp(`(?:^|\\n)\\s*${label}[.、:：)）\\s]`, "i").test(grayOptionOcrText.replace(/^PASS:\s*/, ""))),
    errors: ocrRuntimeErrors
  };
  assert.deepEqual(grayOptionOcrProbe, { passed: true, labels: ["A", "B", "C", "D"], errors: [] });
  await ocrRuntimePage.close();

  const replyPage = await context.newPage();
  const replyPageErrors = [];
  const replyFailedRequests = [];
  replyPage.on("pageerror", (error) => replyPageErrors.push(error.message));
  replyPage.on("requestfailed", (request) => replyFailedRequests.push(`${request.url()}：${request.failure()?.errorText || "失败"}`));
  await replyPage.setViewportSize({ width: 320, height: 240 });
  await replyPage.goto(`chrome-extension://${extensionId}/popup/ai-reply.html`);
  const longReply = Array.from({ length: 40 }, (_, index) => `Line ${index + 1}: readable AI reply content.`).join("\n");
  await replyPage.evaluate(async (content) => chrome.storage.session.set({
    aiReplyWindowPayload: { content, updatedAt: Date.now() }
  }), longReply);
  await replyPage.waitForFunction(() => document.querySelector("#replyContent")?.textContent.includes("Line 40"));
  await replyPage.waitForFunction(() => {
    const content = document.querySelector("#replyContent");
    const progress = document.querySelector("#replyScrollProgress");
    return content && progress && content.scrollHeight > content.clientHeight && !progress.hidden && progress.getAttribute("aria-valuenow") === "0";
  });
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
      progressVisible: !document.querySelector("#replyScrollProgress").hidden,
      progressValue: document.querySelector("#replyScrollProgress").getAttribute("aria-valuenow"),
      topButtonHidden: document.querySelector("#replyScrollTopBtn").hidden,
      copyEnabled: !copyButton.disabled,
      copyVisible: copyButton.getBoundingClientRect().bottom <= innerHeight,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth,
      background: getComputedStyle(document.body).backgroundColor,
      panel: getComputedStyle(document.querySelector(".reply-card")).backgroundColor,
      card: style.backgroundColor,
      title: getComputedStyle(document.querySelector(".reply-title")).color,
      copyButton: getComputedStyle(copyButton).backgroundColor,
      scrollbarWidth: style.scrollbarWidth,
      scrollbarGutter: style.scrollbarGutter
    };
  });
  assert.deepEqual(aiReplyProbe.viewport, { width: 320, height: 240 });
  assert.equal(aiReplyProbe.fontSize, "13px");
  assert.ok(Number.parseFloat(aiReplyProbe.lineHeight) >= 22);
  assert.equal(aiReplyProbe.scrollable, true);
  assert.ok(aiReplyProbe.contentHeight >= 110);
  assert.match(aiReplyProbe.metaText, /\d+ \u5b57 · 阅读 \d+%$/);
  assert.equal(aiReplyProbe.progressVisible, true);
  assert.equal(aiReplyProbe.progressValue, "0");
  assert.equal(aiReplyProbe.topButtonHidden, true);
  assert.equal(aiReplyProbe.copyEnabled, true);
  assert.equal(aiReplyProbe.copyVisible, true);
  assert.equal(aiReplyProbe.horizontalOverflow, false);
  assert.equal(aiReplyProbe.background, "rgb(255, 255, 255)");
  assert.equal(aiReplyProbe.panel, "rgb(255, 255, 255)");
  assert.equal(aiReplyProbe.card, "rgb(255, 255, 255)");
  assert.equal(aiReplyProbe.title, "rgb(23, 23, 23)");
  assert.equal(aiReplyProbe.copyButton, "rgb(155, 220, 255)");
  assert.equal(aiReplyProbe.scrollbarWidth, "none");
  assert.equal(aiReplyProbe.scrollbarGutter, "auto");
  await replyPage.locator("#replyContent").press("End");
  await replyPage.waitForFunction(() => {
    const content = document.querySelector("#replyContent");
    return Math.abs(content.scrollTop - (content.scrollHeight - content.clientHeight)) <= 2;
  });
  assert.equal(await replyPage.locator("#replyScrollProgress").getAttribute("aria-valuenow"), "100");
  assert.equal(await replyPage.locator("#replyScrollTopBtn").isVisible(), true);
  await replyPage.locator("#replyScrollTopBtn").click();
  await replyPage.waitForFunction(() => document.querySelector("#replyContent")?.scrollTop === 0);
  const replyFormula = "**公式说明**\n余弦定理: (c 2 = a 2 + b 2 - 2ab cos C)\n" +
    "求根公式：\n\\[x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}\\]\n" +
    "化学方程式：\n\\[\\ce{2H2 + O2 -> 2H2O}\\]";
  await replyPage.evaluate(async (content) => chrome.storage.session.set({
    aiReplyWindowPayload: { content, updatedAt: Date.now() }
  }), replyFormula);
  await replyPage.waitForFunction(() => document.querySelectorAll("#replyContent mjx-container svg").length === 3);
  const aiReplyFormulaProbe = await replyPage.evaluate(() => {
    const content = document.querySelector("#replyContent");
    const math = content.querySelector("mjx-container");
    const glyph = math?.querySelector("use, path");
    const mathStyle = math ? getComputedStyle(math) : null;
    const parentStyle = math?.parentElement ? getComputedStyle(math.parentElement) : null;
    const glyphStyle = glyph ? getComputedStyle(glyph) : null;
    return {
      svgCount: content.querySelectorAll("mjx-container svg").length,
      rawMarkdownVisible: content.textContent.includes("**"),
      roles: Array.from(content.querySelectorAll("mjx-container svg")).map((svg) => svg.getAttribute("role")),
      formulaLarger: Number.parseFloat(mathStyle?.fontSize || "0") > Number.parseFloat(parentStyle?.fontSize || "0"),
      formulaBlack: mathStyle?.color === "rgb(0, 0, 0)",
      formulaBold: Number.parseFloat(glyphStyle?.strokeWidth || "0") > 0 && glyphStyle?.stroke === "rgb(0, 0, 0)",
      remoteFormulaResources: performance.getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((name) => /^https?:/i.test(name) && /mathjax|mhchem/i.test(name)),
      fits: Array.from(content.querySelectorAll("mjx-container svg")).every((formula) =>
        formula.getBoundingClientRect().width <= content.getBoundingClientRect().width)
    };
  });
  assert.deepEqual(aiReplyFormulaProbe, {
    svgCount: 3,
    rawMarkdownVisible: false,
    roles: ["img", "img", "img"],
    formulaLarger: true,
    formulaBlack: true,
    formulaBold: true,
    remoteFormulaResources: [],
    fits: true
  });
  assert.deepEqual(replyPageErrors, []);
  assert.deepEqual(replyFailedRequests, []);
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
      responseError: response.error || "",
      beforeCount: previousWindowIds.length,
      afterCount: remainingWindowIds.length,
      remainingWindowId: remainingWindowIds[0] ?? null,
      replyWindowReplaced: remainingWindowIds.length === 1 && !previousWindowIds.includes(remainingWindowIds[0])
    };
  });
  assert.equal(aiWindowDedupProbe.responseOk, true, aiWindowDedupProbe.responseError);
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

  await page.locator('[data-panel="bookPanel"]').evaluate((button) => button.click());
  await page.waitForFunction(async () => (await chrome.storage.local.get("popupLastView")).popupLastView?.lastPanelId === "bookPanel");
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
    supportHint: "适用于普通网页图书阅读器。仅使用浏览器原生方式点击阅读器翻页按钮。"
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
  await page.waitForFunction(async () => (await chrome.storage.local.get("popupLastQuestionView")).popupLastQuestionView === "voice");
  assert.equal(await page.locator("#ocrCaptureView").isVisible(), false);
  assert.equal(await page.locator("#voiceCaptureView").isVisible(), true);
  assert.equal(await page.locator("#voiceCaptureTab").getAttribute("aria-selected"), "true");
  assert.equal(await page.locator("#startTabAudioBtn").isEnabled(), true);
  assert.equal(await page.locator("#stopTabAudioBtn").isDisabled(), true);
  assert.match(await page.locator("#voiceStatus").textContent() || "", /网页声音|网页语音|Whisper/);
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#ocrPanel")?.classList.contains("active"));
  await page.waitForFunction(() => document.querySelector("#voiceCaptureTab")?.getAttribute("aria-selected") === "true");
  assert.equal(await page.locator("#ocrCaptureView").isVisible(), false);
  assert.equal(await page.locator("#voiceCaptureView").isVisible(), true);
  await page.locator("#ocrCaptureTab").click();
  await page.waitForFunction(async () => (await chrome.storage.local.get("popupLastQuestionView")).popupLastQuestionView === "capture");
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
  webSocketStreamType: typeof escapedGlobal.WebSocketStream,
  webTransportType: typeof escapedGlobal.WebTransport,
  workerType: typeof escapedGlobal.Worker,
  broadcastChannelType: typeof escapedGlobal.BroadcastChannel,
  notificationType: typeof escapedGlobal.Notification,
  navigatorType: typeof escapedGlobal.navigator,
  sendBeaconType: typeof (escapedGlobal.navigator && escapedGlobal.navigator.sendBeacon),
  postMessageType: typeof escapedGlobal.postMessage,
  fontFaceType: typeof escapedGlobal.FontFace,
  fontSetType: typeof escapedGlobal.fonts,
  networkSucceeded: false,
  fontNetworkSucceeded: false
};
try {
  if (typeof escapedGlobal.fetch === "function") {
    await escapedGlobal.fetch("https://example.com/");
    probe.networkSucceeded = true;
  }
} catch (error) {}
try {
  if (typeof escapedGlobal.FontFace === "function") {
    const remoteFont = new escapedGlobal.FontFace(
      "SandboxNetworkProbe",
      "url(${localOrigin}/sandbox-font-probe.woff2)"
    );
    await remoteFont.load();
    probe.fontNetworkSucceeded = remoteFont.status === "loaded";
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
  for (const method of [
    "video.auto", "video.lock", "video.reset",
    "book.prev", "book.next", "book.start", "book.stop", "book.interval"
  ]) {
    assert.equal(developerProbe.publicMethodLabels.includes(method), true, method);
  }
  assert.equal(developerProbe.publicMethodLabels.includes("video.getStatus"), false);
  for (const alias of [
    "video.autoplay", "video.rateLock", "video.setAutoplay", "video.setRateLock",
    "book.turnPrev", "book.turnNext", "book.startAuto", "book.stopAuto", "book.setInterval"
  ]) {
    assert.equal(developerProbe.publicMethodLabels.includes(alias), false, alias);
  }
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
  assert.equal(output.value.webSocketStreamType, "undefined");
  assert.equal(output.value.webTransportType, "undefined");
  assert.equal(output.value.workerType, "undefined");
  assert.equal(output.value.broadcastChannelType, "undefined");
  assert.equal(output.value.notificationType, "undefined");
  assert.equal(output.value.navigatorType, "undefined");
  assert.equal(output.value.sendBeaconType, "undefined");
  assert.equal(output.value.postMessageType, "undefined");
  assert.equal(output.value.fontFaceType, "undefined");
  assert.equal(output.value.fontSetType, "undefined");
  assert.equal(output.value.networkSucceeded, false);
  assert.equal(output.value.fontNetworkSucceeded, false);
  assert.equal(sandboxFontRequestCount, 0);

  const activeSessionState = await page.evaluate(async () => chrome.storage.session.get([
    "sdkRuntimeTokens", "sdkRuntimeSessions"
  ]));
  const activeRuntimeTokens = Object.values(activeSessionState.sdkRuntimeTokens || {});
  const activeRuntimeSessions = Object.values(activeSessionState.sdkRuntimeSessions || {});
  assert.equal(activeRuntimeTokens.length, 1);
  assert.equal(activeRuntimeSessions.length, 1);
  assert.equal(activeRuntimeTokens[0].persistent, true);
  assert.equal(activeRuntimeSessions[0].persistent, true);
  assert.equal(Object.prototype.hasOwnProperty.call(activeRuntimeTokens[0], "expiresAt"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(activeRuntimeSessions[0], "expiresAt"), false);

  await page.locator("#stopDeveloperSessionBtn").click();
  await page.waitForFunction(() => document.querySelector("#developerSessionStatus")?.textContent.includes("已停止"));
  const sessionState = await page.evaluate(async () => chrome.storage.session.get([
    "sdkRuntimeTokens", "sdkRuntimeSessions", "sdkContextIntents"
  ]));
  assert.equal(Object.keys(sessionState.sdkRuntimeTokens || {}).length, 0);
  assert.equal(Object.keys(sessionState.sdkRuntimeSessions || {}).length, 0);
  assert.equal(Object.keys(sessionState.sdkContextIntents || {}).length, 0);

  const watchdogCode = `// ==UserScript==
// @name Edge Sandbox Heartbeat Watchdog
// @version 1.0.0
// @wsb-capability storage
// ==/UserScript==

while (true) {}`;
  await page.locator("#developerScriptEditor").fill(watchdogCode);
  await page.locator("#startDeveloperSessionBtn").click();
  await page.waitForFunction(() => {
    return (document.querySelector("#developerSessionStatus")?.textContent || "").includes("worker-unresponsive");
  }, null, { timeout: 15000 });
  assert.match(await page.locator("#developerSessionStatus").textContent() || "", /worker-unresponsive/);
  await page.locator("#stopDeveloperSessionBtn").click();
  await page.waitForFunction(() => document.querySelector("#stopDeveloperSessionBtn")?.disabled === true);

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
    const autoplay = window.WinSpeedBallMediaCore.handleCommand({ type: "ENABLE_AUTOPLAY" });
    const lock = window.WinSpeedBallMediaCore.handleCommand({ type: "ENABLE_RATE_LOCK" });
    const unlocked = window.WinSpeedBallMediaCore.handleCommand({ type: "DISABLE_RATE_LOCK" });
    video.playbackRate = 1;
    const unlockedRate = video.playbackRate;
    const afterAutoplayOff = window.WinSpeedBallMediaCore.handleCommand({ type: "DISABLE_AUTOPLAY" });
    return { before, changed, resistedRate, nativeSetterResisted, descriptorRecovered, prototypeProtected, unlockedRate, paused, autoplay, lock, unlocked, afterAutoplayOff };
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
  assert.equal(videoProbe.autoplay.continuousPlayback, true);
  assert.equal(videoProbe.lock.rateLocked, true);
  assert.equal(videoProbe.lock.continuousPlayback, true);
  assert.equal(videoProbe.unlocked.rateLocked, false);
  assert.equal(videoProbe.unlocked.continuousPlayback, true);
  assert.equal(videoProbe.afterAutoplayOff.continuousPlayback, false);
  assert.equal(videoProbe.afterAutoplayOff.controlMode, "stopped");

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

  let memoryPage = await context.newPage();
  const openMemoryPage = async () => {
    await memoryPage.goto(`chrome-extension://${extensionId}/popup/index.html`);
    await memoryPage.locator("#developerPanel").waitFor({ state: "attached" });
    await memoryPage.waitForFunction(() => document.querySelectorAll("#aiProviderTabs [data-ai-provider]").length === 4);
  };
  const reopenMemoryPage = async () => {
    await memoryPage.close();
    memoryPage = await context.newPage();
    await openMemoryPage();
  };
  await openMemoryPage();
  const readPopupBodySize = () => memoryPage.evaluate(() => {
    const body = document.body.getBoundingClientRect();
    const root = document.documentElement.getBoundingClientRect();
    const cards = Array.from(document.querySelectorAll("#aiTeachingPanel > details")).map((item) => item.getBoundingClientRect());
    return {
      width: Math.round(body.width),
      height: Math.round(body.height),
      rootWidth: Math.round(root.width),
      rootHeight: Math.round(root.height),
      twoColumnTeaching: cards.length >= 2 && Math.round(cards[0].top) === Math.round(cards[1].top) && cards[1].left > cards[0].left
    };
  });
  const normalPopupSize = await readPopupBodySize();
  const memoryViewport = memoryPage.viewportSize();
  await memoryPage.mouse.move((memoryViewport?.width || 1280) - 1, 100);
  await memoryPage.locator("#openAiTeachingBtn").evaluate((button) => button.click());
  await memoryPage.waitForFunction(() => document.body.classList.contains("ai-teaching-mode"));
  const teachingPopupSize = await readPopupBodySize();
  await memoryPage.mouse.move(Math.round((memoryViewport?.width || 1280) / 2), 100);
  await memoryPage.mouse.move((memoryViewport?.width || 1280) - 1, 100);
  await memoryPage.waitForTimeout(950);
  const teachingNavigationIsolation = await memoryPage.evaluate(() => ({
    navOpen: document.body.classList.contains("nav-open"),
    rightOpen: document.body.classList.contains("right-open"),
    topOpen: document.body.classList.contains("top-open")
  }));
  assert.deepEqual(teachingNavigationIsolation, { navOpen: false, rightOpen: false, topOpen: false });
  await memoryPage.locator("#aiTeachingGuidance").evaluate((guidance) => {
    guidance.textContent = Array.from({ length: 80 }, (_, index) => `分步指导滚动测试第 ${index + 1} 行`).join("\n");
    guidance.dispatchEvent(new Event("scroll"));
  });
  await memoryPage.waitForFunction(() => {
    const guidance = document.querySelector("#aiTeachingGuidance");
    return guidance && guidance.scrollHeight > guidance.clientHeight;
  });
  await memoryPage.locator("#aiTeachingScrollBottomBtn").click();
  await memoryPage.waitForFunction(() => {
    const guidance = document.querySelector("#aiTeachingGuidance");
    return guidance && Math.abs(guidance.scrollTop - (guidance.scrollHeight - guidance.clientHeight)) <= 2;
  });
  const bottomScrollState = {
    progress: await memoryPage.locator("#aiTeachingScrollProgress").textContent(),
    downDisabled: await memoryPage.locator("#aiTeachingScrollDownBtn").isDisabled(),
    bottomDisabled: await memoryPage.locator("#aiTeachingScrollBottomBtn").isDisabled(),
    scrollbarWidth: await memoryPage.locator("#aiTeachingGuidance").evaluate((guidance) => getComputedStyle(guidance).scrollbarWidth)
  };
  await memoryPage.locator("#aiTeachingGuidance").press("Home");
  await memoryPage.waitForFunction(() => document.querySelector("#aiTeachingGuidance")?.scrollTop === 0);
  const topScrollState = {
    progress: await memoryPage.locator("#aiTeachingScrollProgress").textContent(),
    topDisabled: await memoryPage.locator("#aiTeachingScrollTopBtn").isDisabled(),
    upDisabled: await memoryPage.locator("#aiTeachingScrollUpBtn").isDisabled()
  };
  const guidanceScrollProbe = { bottomScrollState, topScrollState };
  assert.deepEqual(guidanceScrollProbe, {
    bottomScrollState: { progress: "阅读 100%", downDisabled: true, bottomDisabled: true, scrollbarWidth: "none" },
    topScrollState: { progress: "阅读 0%", topDisabled: true, upDisabled: true }
  });
  await memoryPage.locator("#aiTeachingContent").evaluate((content) => {
    const filler = document.createElement("div");
    filler.id = "aiTeachingOuterScrollProbe";
    filler.style.height = "900px";
    filler.setAttribute("aria-hidden", "true");
    content.appendChild(filler);
  });
  await memoryPage.waitForFunction(() => {
    const content = document.querySelector("#aiTeachingContent");
    return content.scrollHeight > content.clientHeight && !document.querySelector("#aiTeachingPageScrollProgress").hidden;
  });
  await memoryPage.locator("#aiTeachingContent").press("PageDown");
  await memoryPage.waitForFunction(() => document.querySelector("#aiTeachingContent")?.scrollTop > 0 &&
    Number(document.querySelector("#aiTeachingPageScrollProgress")?.getAttribute("aria-valuenow") || 0) > 0);
  const teachingOuterScrollProbe = {
    progress: Number(await memoryPage.locator("#aiTeachingPageScrollProgress").getAttribute("aria-valuenow")),
    topVisible: await memoryPage.locator("#aiTeachingPageScrollTopBtn").isVisible()
  };
  assert.ok(teachingOuterScrollProbe.progress > 0);
  assert.equal(teachingOuterScrollProbe.topVisible, true);
  await memoryPage.locator("#aiTeachingPageScrollTopBtn").click();
  await memoryPage.waitForFunction(() => document.querySelector("#aiTeachingContent")?.scrollTop === 0);
  await memoryPage.locator("#aiTeachingOuterScrollProbe").evaluate((element) => element.remove());
  await memoryPage.locator("#closeAiTeachingBtn").click();
  await memoryPage.waitForFunction(() => !document.body.classList.contains("ai-teaching-mode"));
  const restoredPopupSize = await readPopupBodySize();
  const teachingReturnIsolationProbe = await memoryPage.evaluate(() => ({
    rootTeachingMode: document.documentElement.classList.contains("ai-teaching-mode"),
    bodyTeachingMode: document.body.classList.contains("ai-teaching-mode"),
    navOpen: document.body.classList.contains("nav-open"),
    rightOpen: document.body.classList.contains("right-open"),
    topOpen: document.body.classList.contains("top-open"),
    normalLayoutVisible: getComputedStyle(document.querySelector(".layout")).display === "grid",
    teachingWorkspaceVisible: getComputedStyle(document.querySelector("#aiTeachingWorkspace")).display !== "none"
  }));
  assert.deepEqual(teachingReturnIsolationProbe, {
    rootTeachingMode: false,
    bodyTeachingMode: false,
    navOpen: false,
    rightOpen: false,
    topOpen: false,
    normalLayoutVisible: true,
    teachingWorkspaceVisible: false
  });
  const teachingSizeProbe = { normalPopupSize, teachingPopupSize, restoredPopupSize };
  assert.deepEqual(teachingSizeProbe, {
    normalPopupSize: { width: 320, height: 340, rootWidth: 320, rootHeight: 340, twoColumnTeaching: false },
    teachingPopupSize: { width: 720, height: 600, rootWidth: 720, rootHeight: 600, twoColumnTeaching: true },
    restoredPopupSize: { width: 320, height: 340, rootWidth: 320, rootHeight: 340, twoColumnTeaching: false }
  });

  await memoryPage.locator('[data-panel="settingsPanel"]').evaluate((button) => button.click());
  await memoryPage.waitForFunction(() => {
    const content = document.querySelector("#mainContent");
    return content.scrollHeight > content.clientHeight;
  });
  await memoryPage.locator("#mainContent").evaluate((content) => {
    content.scrollTo({ top: content.scrollHeight - content.clientHeight, behavior: "auto" });
  });
  await memoryPage.waitForFunction(() => !document.querySelector("#mainScrollProgress").hidden &&
    Number(document.querySelector("#mainScrollProgress").getAttribute("aria-valuenow")) === 100);
  await memoryPage.waitForFunction(async () => {
    const state = (await chrome.storage.local.get("popupLastView")).popupLastView;
    return Number(state?.scrollPositions?.settingsPanel || 0) > 0;
  });
  const savedSettingsScroll = await memoryPage.locator("#mainContent").evaluate((content) => Math.round(content.scrollTop));
  await reopenMemoryPage();
  await memoryPage.waitForFunction((expected) => document.querySelector("#settingsPanel")?.classList.contains("active") &&
    Math.abs((document.querySelector("#mainContent")?.scrollTop || 0) - expected) <= 2, savedSettingsScroll);
  await memoryPage.mouse.move(160, 1);
  await memoryPage.waitForFunction(() => document.body.classList.contains("top-open"));
  const mainScrollMemoryProbe = {
    saved: savedSettingsScroll,
    restored: await memoryPage.locator("#mainContent").evaluate((content) => Math.round(content.scrollTop)),
    progress: await memoryPage.locator("#mainScrollProgress").getAttribute("aria-valuenow"),
    topVisible: await memoryPage.locator("#mainScrollTopBtn").isVisible(),
    inHeader: await memoryPage.locator("#mainScrollTopBtn").evaluate((button) => Boolean(button.closest(".header-actions"))),
    fitsHeader: await memoryPage.locator("#mainScrollTopBtn").evaluate((button) => {
      const buttonRect = button.getBoundingClientRect();
      const headerRect = button.closest(".header").getBoundingClientRect();
      return buttonRect.left >= headerRect.left && buttonRect.right <= headerRect.right &&
        buttonRect.top >= headerRect.top && buttonRect.bottom <= headerRect.bottom;
    })
  };
  assert.ok(Math.abs(mainScrollMemoryProbe.restored - mainScrollMemoryProbe.saved) <= 2);
  assert.equal(mainScrollMemoryProbe.progress, "100");
  assert.equal(mainScrollMemoryProbe.topVisible, true);
  assert.equal(mainScrollMemoryProbe.inHeader, true);
  assert.equal(mainScrollMemoryProbe.fitsHeader, true);
  await memoryPage.locator("#mainScrollTopBtn").click();
  await memoryPage.waitForFunction(() => document.querySelector("#mainContent")?.scrollTop === 0);

  await memoryPage.locator('[data-panel="ocrPanel"]').evaluate((button) => button.click());
  await memoryPage.locator("#voiceCaptureTab").click();
  await memoryPage.waitForFunction(async () => {
    const state = (await chrome.storage.local.get("popupLastView")).popupLastView;
    return state?.lastPanelId === "ocrPanel" && state?.questionView === "voice";
  });
  await reopenMemoryPage();
  const questionMemory = {
    panel: await memoryPage.locator("#ocrPanel").getAttribute("class"),
    voiceSelected: await memoryPage.locator("#voiceCaptureTab").getAttribute("aria-selected")
  };

  await memoryPage.locator('[data-panel="bookPanel"]').evaluate((button) => button.click());
  await memoryPage.locator("#bookImageTab").click();
  await memoryPage.waitForFunction(async () => {
    const state = (await chrome.storage.local.get("popupLastView")).popupLastView;
    return state?.lastPanelId === "bookPanel" && state?.bookView === "image";
  });
  await reopenMemoryPage();
  const bookMemory = {
    panel: await memoryPage.locator("#bookPanel").getAttribute("class"),
    imageSelected: await memoryPage.locator("#bookImageTab").getAttribute("aria-selected")
  };

  await memoryPage.locator('[data-panel="logPanel"]').evaluate((button) => button.click());
  await memoryPage.locator('[data-log-view="updates"]').click();
  await memoryPage.waitForFunction(async () => {
    const state = (await chrome.storage.local.get("popupLastView")).popupLastView;
    return state?.lastPanelId === "logPanel" && state?.logView === "updates";
  });
  await reopenMemoryPage();
  const logMemory = {
    panel: await memoryPage.locator("#logPanel").getAttribute("class"),
    updatesSelected: await memoryPage.locator('[data-log-view="updates"]').getAttribute("aria-selected")
  };

  await memoryPage.locator("#openAiTeachingBtn").evaluate((button) => button.click());
  await memoryPage.waitForFunction(async () => (await chrome.storage.local.get("popupLastView")).popupLastView?.viewMode === "aiTeaching");
  await reopenMemoryPage();
  const teachingMemory = {
    active: await memoryPage.evaluate(() => document.body.classList.contains("ai-teaching-mode")),
    visible: await memoryPage.locator("#aiTeachingPanel").isVisible()
  };
  await memoryPage.locator("#closeAiTeachingBtn").click();
  await memoryPage.waitForFunction(async () => (await chrome.storage.local.get("popupLastView")).popupLastView?.viewMode === "main");
  await reopenMemoryPage();
  const returnMemory = {
    teachingActive: await memoryPage.evaluate(() => document.body.classList.contains("ai-teaching-mode")),
    panel: await memoryPage.locator("#logPanel").getAttribute("class"),
    updatesSelected: await memoryPage.locator('[data-log-view="updates"]').getAttribute("aria-selected")
  };
  const interfaceMemoryProbe = { questionMemory, bookMemory, logMemory, teachingMemory, returnMemory };
  assert.deepEqual(interfaceMemoryProbe, {
    questionMemory: { panel: "panel active", voiceSelected: "true" },
    bookMemory: { panel: "panel active", imageSelected: "true" },
    logMemory: { panel: "panel log-panel active", updatesSelected: "true" },
    teachingMemory: { active: true, visible: true },
    returnMemory: { teachingActive: false, panel: "panel log-panel active", updatesSelected: "true" }
  });

  const disabled = await memoryPage.evaluate(async () => self.WinSpeedBallPopupMessageClient.send({
    action: "setDeveloperMode",
    payload: { enabled: false, confirmed: false }
  }));
  assert.equal(disabled.ok, true);
  assert.equal(disabled.enabled, false);
  await memoryPage.close();

  const workspacePage = await context.newPage();
  await workspacePage.goto(`chrome-extension://${extensionId}/workspace/index.html`);
  const workspacePaletteProbe = await workspacePage.evaluate(() => ({
    background: getComputedStyle(document.body).backgroundColor,
    text: getComputedStyle(document.body).color,
    emptyText: getComputedStyle(document.querySelector(".ws-empty")).color,
    scrollbarWidth: getComputedStyle(document.querySelector("#root")).scrollbarWidth,
    scrollbarGutter: getComputedStyle(document.querySelector("#root")).scrollbarGutter
  }));
  assert.deepEqual(workspacePaletteProbe, {
    background: "rgb(255, 255, 255)",
    text: "rgb(23, 23, 23)",
    emptyText: "rgb(112, 112, 112)",
    scrollbarWidth: "none",
    scrollbarGutter: "auto"
  });
  await workspacePage.locator("#root").evaluate((rootElement) => {
    rootElement.innerHTML = '<div class="ws-menu"><button class="ws-menu-btn" type="button">工作区卡片</button></div>';
  });
  await workspacePage.locator(".ws-menu-btn").hover();
  const workspaceCardHoverProbe = await workspacePage.locator(".ws-menu-btn").evaluate((card) => ({
    background: getComputedStyle(card).backgroundColor,
    border: getComputedStyle(card).borderTopColor
  }));
  assert.deepEqual(workspaceCardHoverProbe, {
    background: "rgb(255, 255, 255)",
    border: "rgb(155, 220, 255)"
  });
  await workspacePage.locator("#root").evaluate((rootElement) => {
    rootElement.innerHTML = Array.from({ length: 80 }, (_, index) => `<div style="min-height:24px">脚本滚动测试 ${index + 1}</div>`).join("");
  });
  await workspacePage.waitForFunction(() => {
    const rootElement = document.querySelector("#root");
    return rootElement.scrollHeight > rootElement.clientHeight && !document.querySelector("#workspaceScrollProgress").hidden;
  });
  await workspacePage.locator("#root").press("End");
  await workspacePage.waitForFunction(() => {
    const rootElement = document.querySelector("#root");
    return Math.abs(rootElement.scrollTop - (rootElement.scrollHeight - rootElement.clientHeight)) <= 2;
  });
  const workspaceScrollProbe = {
    progress: await workspacePage.locator("#workspaceScrollProgress").getAttribute("aria-valuenow"),
    topVisible: await workspacePage.locator("#workspaceScrollTopBtn").isVisible()
  };
  assert.deepEqual(workspaceScrollProbe, { progress: "100", topVisible: true });
  await workspacePage.locator("#workspaceScrollTopBtn").click();
  await workspacePage.waitForFunction(() => document.querySelector("#root")?.scrollTop === 0);
  await workspacePage.close();

  process.stdout.write(JSON.stringify({
    ok: true,
    browser: await context.browser()?.version(),
    extensionId,
    sandboxCspFontProbe,
    interfaceProbe,
    paletteProbe,
    themeAuditProbe,
    workAreaCardHoverProbe,
    formulaImageProbe,
    longFormulaWrapProbe,
    aiAnswerFormulaProbe,
    aiConfigAlertProbe,
    whisperProbe,
    grayOptionOcrProbe,
    aiReplyProbe,
    aiReplyFormulaProbe,
    workspacePaletteProbe,
    workspaceCardHoverProbe,
    workspaceScrollProbe,
    teachingSizeProbe,
    teachingReturnIsolationProbe,
    guidanceScrollProbe,
    teachingOuterScrollProbe,
    mainScrollMemoryProbe,
    interfaceMemoryProbe,
    aiWindowDedupProbe,
    aiWindowCloseProbe,
    developerProbe,
    sessionStatus,
    sandboxProbe: output.value,
    videoProbe: videoProbe.before.media[0],
    handoffProbe,
    lifecycle: {
      autoplay: videoProbe.autoplay.continuousPlayback,
      rateLock: videoProbe.lock.rateLocked,
      unlockedKeepsAutoplay: videoProbe.unlocked.continuousPlayback,
      afterAutoplayOff: videoProbe.afterAutoplayOff.controlMode
    }
  }, null, 2));
} finally {
  if (context) await context.close();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(profile, { recursive: true, force: true });
}
