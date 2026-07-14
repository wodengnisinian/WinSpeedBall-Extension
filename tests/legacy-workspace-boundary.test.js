const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const popup = fs.readFileSync(path.join(root, "popup.js"), "utf8");
const workspace = fs.readFileSync(path.join(root, "script_workspace.js"), "utf8");

function loadSchema() {
  const context = {
    self: {}, URL, Object, Array, String, Number, JSON,
    chrome: {
      runtime: {
        id: "extension-id",
        getURL: (file) => `chrome-extension://extension-id/${file}`
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "sdk/contracts.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/message-schema.js"), "utf8"), context);
  return context.self.WinSpeedBallMessageSchema;
}

test("旧脚本工作区每次运行先重载页面，再建立私有 MessageChannel", () => {
  assert.match(popup, /closeScriptWorkspaceChannel\(\);[\s\S]*pendingWorkspaceScript\s*=\s*\{/);
  assert.match(popup, /frame\.src\s*=\s*chrome\.runtime\.getURL\("script_workspace\.html"\)/);
  assert.match(popup, /var channel\s*=\s*new MessageChannel\(\)/);
  assert.match(popup, /workspaceFrame\.contentWindow\.postMessage\([\s\S]*type:\s*"INIT"[\s\S]*\[channel\.port2\]\)/);
  assert.match(popup, /data\.type\s*===\s*"READY"[\s\S]*postToScriptWorkspace\("RUN_SCRIPT_UI"/);
  assert.match(popup, /workspaceFrame\.addEventListener\("load"[\s\S]*closeScriptWorkspaceChannel\(\)[\s\S]*if \(!pendingWorkspaceScript\) return/);
});

test("弹窗不再接收脚本伪造的 raw window.postMessage", () => {
  assert.doesNotMatch(popup, /window\.addEventListener\("message"/);
  assert.doesNotMatch(popup, /data\.source\s*===\s*"DouyinPanelScript"/);
  assert.match(popup, /port\.onmessage\s*=\s*function/);
  assert.match(popup, /scriptWorkspacePort\s*!==\s*port\s*\|\|\s*scriptWorkspaceRunId\s*!==\s*runId/);
});

test("工作区严格拒绝错误 runId、协议版本和额外协议字段", () => {
  assert.match(popup, /data\.protocolVersion\s*===\s*SCRIPT_WORKSPACE_PROTOCOL_VERSION/);
  assert.match(popup, /data\.runId\s*===\s*runId/);
  assert.match(popup, /var keys\s*=\s*Object\.keys\(data\)[\s\S]*keys\.some[\s\S]*"channel", "protocolVersion", "runId", "type", "payload"/);
  assert.match(workspace, /data\.protocolVersion\s*===\s*SCRIPT_WORKSPACE_PROTOCOL_VERSION/);
  assert.match(workspace, /data\.runId\s*===\s*workspaceRunId/);
  assert.match(workspace, /event\.ports\.length\s*!==\s*1/);
});

test("parent.postMessage 兼容调用只通过工作区受控 facade 转发", () => {
  assert.match(workspace, /Object\.freeze\(\{ postMessage:\s*forwardLegacyPostMessage \}\)/);
  assert.match(workspace, /new Function\("window", "parent", "top", "self", "globalThis"/);
  assert.match(workspace, /message\.source\s*!==\s*"DouyinPanelScript"/);
  assert.match(workspace, /sendWorkspaceMessage\("BRIDGE_REQUEST"/);
  assert.doesNotMatch(workspace, /window\.parent\.postMessage\(/);
});

test("START、NEXT、SET_INTERVAL 必须声明并确认 automation 权限", () => {
  const gate = popup.indexOf("if (!scriptWorkspaceAutomationAllowed)");
  const confirm = popup.indexOf("douyinBridgeDecision = window.confirm", gate);
  assert.ok(gate >= 0 && confirm > gate, "权限门应先于额外风险确认");
  assert.match(popup, /parsedMeta\.permissions\.indexOf\("automation"\)\s*>=\s*0/);
  assert.match(popup, /script\.permissionConfirmed\s*===\s*true/);
  assert.match(popup, /script\.permissionSignature\s*===\s*declaredSignature/);
  assert.match(popup, /\["START",\s*"NEXT",\s*"SET_INTERVAL"\]/);
});

test("消息 schema 接受已确认 automation，拒绝未知权限和未确认权限", () => {
  const schema = loadSchema();
  const sender = { id: "extension-id", url: "chrome-extension://extension-id/popup.html" };
  const base = {
    version: 1,
    source: "popup",
    action: "executeUserScript",
    requestId: "legacy-automation-test",
    payload: {
      scriptId: "legacy_script",
      code: "// @permission automation",
      permissions: ["dom", "automation"],
      permissionConfirmed: true
    }
  };
  assert.equal(schema.parse(base, sender).ok, true);
  assert.equal(schema.parse({ ...base, payload: { ...base.payload, permissions: ["internal"] } }, sender).ok, false);
  assert.equal(schema.parse({ ...base, payload: { ...base.payload, permissionConfirmed: false } }, sender).ok, false);
});
