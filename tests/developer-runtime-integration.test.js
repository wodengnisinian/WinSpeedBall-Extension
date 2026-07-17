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
  assert.match(controller, /session\s*=\s*current;[\s\S]*resetSessionButtons\(\)/);
});
