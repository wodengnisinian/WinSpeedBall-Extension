const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function buildWindowService() {
  const sessionData = {};
  const windows = new Map();
  const removedListeners = [];
  let nextId = 10;
  let createCount = 0;
  let updateCount = 0;
  const runtime = {
    id: "extension-id",
    lastError: null,
    getURL: (file) => `chrome-extension://extension-id/${file}`
  };
  const context = {
    self: {},
    Promise,
    Number,
    chrome: {
      runtime,
      storage: {
        session: {
          get(keys, callback) {
            const result = {};
            for (const key of keys) if (Object.prototype.hasOwnProperty.call(sessionData, key)) result[key] = sessionData[key];
            callback(result);
          },
          set(data, callback) { Object.assign(sessionData, data); callback(); },
          remove(keys, callback) { for (const key of keys) delete sessionData[key]; callback(); }
        }
      },
      windows: {
        create(data, callback) {
          createCount += 1;
          const created = { id: nextId++, type: data.type, url: data.url, focused: data.focused };
          windows.set(created.id, created);
          callback(created);
        },
        get(id, callback) {
          runtime.lastError = windows.has(id) ? null : { message: "No window" };
          callback(windows.get(id));
          runtime.lastError = null;
        },
        update(id, data, callback) {
          updateCount += 1;
          const current = windows.get(id);
          if (current) Object.assign(current, data);
          callback(current);
        },
        onRemoved: { addListener(listener) { removedListeners.push(listener); } }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/window-service.js"), "utf8"), context);
  return {
    service: context.self.WinSpeedBallWindowService,
    sessionData,
    windows,
    removedListeners,
    counts: () => ({ createCount, updateCount })
  };
}

test("固定按钮首次创建独立 popup 窗口", async () => {
  const fixture = buildWindowService();
  const result = await fixture.service.openPinnedWindow();
  assert.equal(result.ok, true);
  assert.equal(result.reused, false);
  assert.equal(fixture.counts().createCount, 1);
  const created = fixture.windows.get(result.windowId);
  assert.equal(created.type, "popup");
  assert.equal(created.url, "chrome-extension://extension-id/popup.html?pinned=1");
  assert.equal(fixture.sessionData.pinnedPopupWindowId, result.windowId);
});

test("重复固定会聚焦已有窗口而不重复创建", async () => {
  const fixture = buildWindowService();
  const first = await fixture.service.openPinnedWindow();
  const second = await fixture.service.openPinnedWindow();
  assert.equal(second.ok, true);
  assert.equal(second.reused, true);
  assert.equal(second.windowId, first.windowId);
  assert.deepEqual(fixture.counts(), { createCount: 1, updateCount: 1 });
});

test("固定窗口关闭后会清除会话记录", async () => {
  const fixture = buildWindowService();
  const first = await fixture.service.openPinnedWindow();
  fixture.windows.delete(first.windowId);
  fixture.removedListeners[0](first.windowId);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.sessionData.pinnedPopupWindowId, undefined);
  const second = await fixture.service.openPinnedWindow();
  assert.notEqual(second.windowId, first.windowId);
  assert.equal(fixture.counts().createCount, 2);
});

test("消息 Schema 允许固定窗口页面但拒绝其他扩展页面", () => {
  const context = {
    self: {},
    URL,
    chrome: { runtime: { id: "extension-id", getURL: (file) => `chrome-extension://extension-id/${file}` } }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/message-schema.js"), "utf8"), context);
  const message = {
    version: 1,
    action: "openPinnedWindow",
    source: "popup",
    requestId: "pin-window-test-123",
    payload: {}
  };
  const pinned = context.self.WinSpeedBallMessageSchema.parse(message, {
    id: "extension-id",
    url: "chrome-extension://extension-id/popup.html?pinned=1"
  });
  assert.equal(pinned.ok, true);
  const other = context.self.WinSpeedBallMessageSchema.parse(message, {
    id: "extension-id",
    url: "chrome-extension://extension-id/script_workspace.html"
  });
  assert.equal(other.ok, false);
});
