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
  await page.goto(`chrome-extension://${extensionId}/popup.html?pinned=1`);
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
  await page.locator("#saveDeveloperDraftBtn").click();
  await page.waitForFunction(() => document.querySelector("#developerScriptOutput")?.textContent.includes("已保存"));
  await page.locator("#startDeveloperSessionBtn").click();
  await page.waitForFunction(() => {
    const text = document.querySelector("#developerSessionStatus")?.textContent || "";
    return text.includes("执行完成") || text.includes("运行失败") || text.includes("启动失败");
  }, null, { timeout: 15000 });
  const sessionStatus = await page.locator("#developerSessionStatus").textContent();
  assert.match(sessionStatus || "", /执行完成/);

  await page.locator("#developerApiMethod").selectOption("storage.get");
  await page.locator("#developerApiArgs").fill('["sandbox.probe"]');
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
  await localPage.addScriptTag({ path: path.join(root, "shadow_hook.js") });
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
    sessionStatus,
    sandboxProbe: output.value,
    videoProbe: videoProbe.before.media[0],
    lifecycle: { lock: videoProbe.lock.controlMode, afterAutoplayOff: videoProbe.afterAutoplayOff.controlMode, stopped: videoProbe.stopped.controlMode }
  }, null, 2));
} finally {
  if (context) await context.close();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(profile, { recursive: true, force: true });
}
