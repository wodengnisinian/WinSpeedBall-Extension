const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Developer Mode 页面完整接入草稿、会话和真实 API 测试", () => {
  const html = read("popup/index.html");
  for (const id of [
    "developerDraftSelect", "newDeveloperDraftBtn", "duplicateDeveloperDraftBtn", "importDeveloperDraftBtn",
    "exportDeveloperDraftBtn", "deleteDeveloperDraftBtn", "developerScriptEditor",
    "startDeveloperSessionBtn", "stopDeveloperSessionBtn", "developerApiMethod",
    "runDeveloperApiTestBtn", "developerSessionStatus", "developerLineCount",
    "developerCharacterCount", "developerDeclaredCapabilityCount", "developerSaveState",
    "developerApiCapability"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "popup/index.html 不应出现重复 ID");
  assert.doesNotMatch(html, /当前不会执行 SDK 脚本/);
  assert.match(html, /脚本只在受限沙箱中运行/);
  assert.match(html, /Ctrl\+S 保存当前草稿/);
  const controller = read("popup/developer-controller.js");
  assert.match(controller, /function updateEditorStats\(\)/);
  assert.match(controller, /draftStore\.duplicateDraft\(draftId\)/);
  assert.match(controller, /event\.preventDefault\(\);\s*saveDraft\(\);/);
  assert.match(controller, /function updateApiCapabilityPreview\(\)/);
  assert.match(controller, /contracts\.PUBLIC_METHODS/);
  assert.match(controller, /title\.textContent = "WSB\." \+ publicMethod/);
  assert.match(controller, /option\.textContent = publicMethod/);
});

test("SDK 运行依赖按顺序加载且后台动作均已注册", () => {
  const html = read("popup/index.html");
  const protocolIndex = html.indexOf('src="../sdk/session-protocol.js"');
  const storeIndex = html.indexOf('src="developer-draft-store.js"');
  const sessionIndex = html.indexOf('src="sdk-session-controller.js"');
  const controllerIndex = html.indexOf('src="developer-controller.js"');
  const popupIndex = html.indexOf('src="index.js"');
  assert.ok(protocolIndex >= 0 && protocolIndex < sessionIndex);
  assert.ok(storeIndex >= 0 && storeIndex < sessionIndex);
  assert.ok(sessionIndex < controllerIndex && controllerIndex < popupIndex);

  const background = read("background/service-worker.js");
  for (const action of ["prepareSdkSession", "invokeSdkSession", "getSdkSessionStatus", "closeSdkSession"]) {
    assert.match(background, new RegExp(`${action}:\\s*function`));
  }
  assert.match(background, /chrome\.storage\.session\.get/);
  assert.match(background, /chrome\.storage\.session\.set/);
});

test("Manifest 声明 SDK 沙箱且运行器本身禁止外部连接", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.ok(manifest.sandbox.pages.includes("sdk/script-runner.html"));
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.match(manifest.content_security_policy.extension_pages, /worker-src 'self'/);
  const runner = read("sdk/script-runner.html");
  assert.match(runner, /default-src 'none'/);
  assert.match(runner, /connect-src 'none'/);
  assert.match(runner, /worker-src blob:/);
});

test("会话启动失败会撤销已创建令牌，关闭失败可以重试", () => {
  const controller = read("popup/sdk-session-controller.js");
  assert.match(controller, /function revokeCreatedSession\(/);
  assert.match(controller, /action:\s*"closeSdkSession"/);
  assert.match(controller, /session\s*=\s*current;[\s\S]*SDK_SESSION_CLOSE_FAILED/);
  assert.match(controller, /后台会话清理失败，请点击“停止会话”重试/);
  assert.match(controller, /session\s*=\s*current;[\s\S]*resetSessionButtons\(\)/);
  assert.match(controller, /timeoutMs:\s*0/);
  assert.match(controller, /会话不会按时间到期/);
});

test("视频和图书 SDK 会话按能力申请当前页面及跨域框架权限", () => {
  const controller = read("popup/sdk-session-controller.js");
  const popup = read("popup/index.js");
  const html = read("popup/index.html");
  assert.match(controller, /function authorizeSite\(context,\s*capabilities\)/);
  assert.match(controller, /function selectedBookAccessMode\(\)/);
  assert.match(controller, /hasCapabilityPrefix\(capabilities,\s*"book\."\)[\s\S]*?ensureBookAccess\(context,\s*context\.bookMode\)/);
  assert.match(controller, /hasCapabilityPrefix\(capabilities,\s*"video\."\)[\s\S]*?ensureMediaAccess\(context\)/);
  assert.match(controller, /var bookMode = hasCapabilityPrefix\(draft\.capabilities,\s*"book\."\) \? selectedBookAccessMode\(\) : ""/);
  assert.match(controller, /var contextPayload = \{ capabilities: draft\.capabilities \};[\s\S]*?if \(bookMode\) contextPayload\.bookMode = bookMode/);
  assert.match(controller, /var sessionPayload = \{ scriptId: draft\.id,[\s\S]*?contextNonce: context\.contextNonce,[\s\S]*?confirmed: true \};[\s\S]*?if \(context\.bookMode\) sessionPayload\.bookMode = context\.bookMode/);
  assert.match(popup, /ensureMediaAccess:\s*ensureMediaAccess/);
  assert.match(popup, /ensureBookAccess:\s*ensureBookAccess/);
  assert.match(html, /id="developerBookAccessMode"/);
  for (const mode of ["book", "image", "chaoxing"]) assert.match(html, new RegExp(`<option value="${mode}"(?:\\s[^>]*)?>`));

  const background = read("background/service-worker.js");
  assert.match(background, /sdkContextService\.prepare\(request\.capabilities,\s*request\.bookMode\)/);
  assert.match(background, /sdkContextService\.consume\(nonce,\s*capabilities,\s*bookMode\)/);
});

test("长期 SDK 会话跟随标签页、顶层来源和网站权限生命周期清理", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const background = read("background/service-worker.js");
  const sdkService = read("background/sdk-service.js");

  assert.equal(manifest.permissions.includes("webNavigation"), true);
  assert.match(sdkService, /function closeSessionsForTab\(tabId,\s*preserveOrigin\)/);
  assert.match(sdkService, /function closeSessionsForOrigins\(originPatterns\)/);
  assert.match(sdkService, /closeSessionsForTab:\s*closeSessionsForTab/);
  assert.match(sdkService, /closeSessionsForOrigins:\s*closeSessionsForOrigins/);
  assert.match(sdkService, /return enqueueSessionPreparation\(function \(\) \{[\s\S]*?closeSessionsForTabNow/);
  assert.match(sdkService, /function pruneSessionsNow\(\)[\s\S]*?session\.tabId === null[\s\S]*?validateContext\(session\)/);
  assert.match(sdkService, /function markLifecycleRevocation\(matches\)[\s\S]*?revocationGeneration \+= 1/);
  assert.match(sdkService, /function validateInvocationLifecycle\(session,\s*token,\s*invocationGeneration\)/);
  assert.match(sdkService, /function validateInvocationLifecycle\(session,\s*token,\s*invocationGeneration\)[\s\S]*?revocationGeneration !== invocationGeneration[\s\S]*?lifecycleFailure\(\)/);
  assert.match(sdkService, /validateInvocationLifecycle\(session,\s*token,\s*invocationGeneration\)[\s\S]*?validateRuntimeToken[\s\S]*?validateInvocationLifecycle\(session,\s*token,\s*invocationGeneration\)[\s\S]*?dispatch/);

  assert.match(background, /function readSdkSessions\(\)[\s\S]*?new Promise\(function \(resolve,\s*reject\)[\s\S]*?reject\(\{ ok: false,\s*code: "SDK_SESSION_STORAGE_FAILED"/);
  assert.match(background, /chrome\.tabs\.onRemoved\.addListener\(function \(tabId\)[\s\S]*?releaseSdkTabSessions\(tabId,\s*""\)/);
  assert.match(background, /chrome\.webNavigation\.onCommitted\.addListener\(function \(details\)[\s\S]*?details\.frameId !== 0[\s\S]*?releaseSdkTabSessions\(details\.tabId,\s*sdkOrigin\(details\.url\)\)/);
  assert.match(background, /chrome\.permissions\.onRemoved\.addListener\(function \(permissions\)[\s\S]*?releaseSdkOriginSessions\(removed\)/);
  assert.match(background, /SDK_LIFECYCLE_MAINTENANCE_ALARM[\s\S]*?scheduleSdkLifecycleMaintenance[\s\S]*?chrome\.alarms\.create/);
  assert.match(background, /alarm\.name === SDK_LIFECYCLE_MAINTENANCE_ALARM[\s\S]*?sdkService\.pruneSessions\(\)/);
});
