const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "popup/window-mode-controller.js"), "utf8");

function loadApi() {
  const context = { self: {}, URLSearchParams, Object, Array, String, Promise };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.self.WinSpeedBallPopupWindowMode;
}

function createDocument() {
  const classes = new Set();
  const heading = { textContent: "" };
  return {
    title: "",
    documentElement: { dataset: {} },
    body: {
      dataset: {},
      classList: {
        toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
        contains(name) { return classes.has(name); }
      }
    },
    querySelector(selector) { return selector === "h1" ? heading : null; },
    heading
  };
}

test("浏览器弹窗和独立窗口使用不同状态键", () => {
  const api = loadApi();
  const storage = { get() {}, set() {} };
  const browser = api.create({ search: "", document: createDocument(), storage });
  const pinned = api.create({ search: "?pinned=1", document: createDocument(), storage });
  assert.equal(browser.mode, "browser");
  assert.equal(browser.stateKey, "popupStateBrowser");
  assert.equal(browser.panelKey, "popupLastPanelBrowser");
  assert.equal(pinned.mode, "pinned");
  assert.equal(pinned.stateKey, "popupStatePinned");
  assert.equal(pinned.panelKey, "popupLastPanelPinned");
});

test("浏览器弹窗不会恢复独立窗口的脚本工作区", async () => {
  const api = loadApi();
  const legacy = { lastPanelId: "scriptPanel", scriptWorkspaceActive: true, lastWorkspaceScript: { code: "x" } };
  const storage = {
    get(keys, callback) { callback({ popupState: legacy }); },
    set() {}
  };
  const browser = api.create({ search: "", document: createDocument(), storage });
  const pinned = api.create({ search: "?pinned=1", document: createDocument(), storage });
  const browserState = await new Promise((resolve) => browser.loadState(resolve));
  const pinnedState = await new Promise((resolve) => pinned.loadState(resolve));
  assert.equal(browserState.scriptWorkspaceActive, false);
  assert.equal(pinnedState.scriptWorkspaceActive, true);
});

test("窗口模式会更新标题、页面标识和独立窗口样式", () => {
  const api = loadApi();
  const document = createDocument();
  const controller = api.create({ search: "?pinned=1", document, storage: { get() {}, set() {} } });
  controller.applyMode();
  assert.equal(document.title, "学习助手 - 独立窗口");
  assert.equal(document.body.dataset.windowMode, "pinned");
  assert.equal(document.documentElement.dataset.windowMode, "pinned");
  assert.equal(document.body.classList.contains("pinned-window"), true);
  assert.equal(document.heading.textContent, "学习助手 · 独立");
});

test("保存状态时分别写入模式状态，独立窗口兼容旧状态键", async () => {
  const api = loadApi();
  const writes = [];
  const storage = {
    get() {},
    set(data, callback) { writes.push(data); if (callback) callback({ ok: true }); }
  };
  const browser = api.create({ search: "", document: createDocument(), storage });
  const pinned = api.create({ search: "?pinned=1", document: createDocument(), storage });
  browser.saveState({ lastPanelId: "aiPanel" });
  pinned.saveState({ lastPanelId: "videoPanel", scriptWorkspaceActive: true });
  assert.equal(writes[0].popupStateBrowser.lastPanelId, "aiPanel");
  assert.equal(writes[0].popupLastPanelBrowser, "aiPanel");
  assert.equal(writes[0].popupState, undefined);
  assert.equal(writes[1].popupStatePinned.scriptWorkspaceActive, true);
  assert.equal(writes[1].popupLastPanelPinned, "videoPanel");
  assert.equal(writes[1].popupState.scriptWorkspaceActive, true);
});

test("独立功能页键优先于旧的复合状态", async () => {
  const api = loadApi();
  const storage = {
    get(keys, callback) {
      callback({
        popupStateBrowser: { lastPanelId: "logPanel" },
        popupLastPanelBrowser: "videoPanel"
      });
    },
    set() {}
  };
  const controller = api.create({ search: "", document: createDocument(), storage });
  const state = await new Promise((resolve) => controller.loadState(resolve));
  assert.equal(state.lastPanelId, "videoPanel");
});

test("主页面只通过后台窗口服务打开独立窗口并分别记忆面板滚动位置", () => {
  const popup = fs.readFileSync(path.join(root, "popup.js"), "utf8");
  assert.doesNotMatch(popup, /openPinnedWindowDirectly/);
  assert.doesNotMatch(popup, /chrome\.windows\.create/);
  assert.match(popup, /sendMessage\(\{ action: "openPinnedWindow" \}\)/);
  assert.match(popup, /windowModeController\.bindPinButton/);
  assert.match(popup, /panelScrollPositions\[activePanel\.id\] = content\.scrollTop/);
  assert.match(popup, /content\.scrollTop = Number\(panelScrollPositions\[panelId\] \|\| 0\)/);
  assert.match(popup, /panelSelectedThisOpen = true/);
  assert.match(popup, /if \(!panelSelectedThisOpen && state\.lastPanelId\)/);
});
