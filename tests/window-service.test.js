const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function buildWindowService() {
  const sessionData = {};
  const localData = {};
  const windows = new Map();
  const removedListeners = [];
  const boundsListeners = [];
  let nextId = 10;
  let createCount = 0;
  let updateCount = 0;
  const runtime = {
    id: "extension-id",
    lastError: null,
    getURL: (file) => `chrome-extension://extension-id/${file}`,
    getContexts() {
      return Promise.resolve(Array.from(windows.values()).map((windowInfo) => ({
        windowId: windowInfo.id,
        documentUrl: windowInfo.url
      })));
    }
  };
  const context = {
    self: {},
    Promise,
    Number,
    setTimeout,
    clearTimeout,
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
        },
        local: {
          get(keys, callback) {
            const result = {};
            for (const key of keys) if (Object.prototype.hasOwnProperty.call(localData, key)) result[key] = localData[key];
            callback(result);
          },
          set(data, callback) { Object.assign(localData, data); callback(); }
        }
      },
      windows: {
        create(data, callback) {
          createCount += 1;
          const created = {
            id: nextId++, type: data.type, url: data.url, focused: data.focused,
            width: data.width, height: data.height, left: data.left, top: data.top,
            tabs: [{ url: data.url }]
          };
          windows.set(created.id, created);
          callback(created);
        },
        get(id, options, callback) {
          if (typeof options === "function") { callback = options; options = {}; }
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
        getAll(options, callback) { callback(Array.from(windows.values())); },
        onRemoved: { addListener(listener) { removedListeners.push(listener); } },
        onBoundsChanged: { addListener(listener) { boundsListeners.push(listener); } }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/window-service.js"), "utf8"), context);
  return {
    service: context.self.WinSpeedBallWindowService,
    sessionData,
    localData,
    windows,
    removedListeners,
    boundsListeners,
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
  assert.equal(created.width, 320);
  assert.equal(created.height, 340);
  assert.equal(fixture.sessionData.pinnedPopupWindowId, result.windowId);
  assert.equal(fixture.localData.pinnedPopupWindowState.open, true);
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
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(fixture.sessionData.pinnedPopupWindowId, undefined);
  assert.equal(fixture.localData.pinnedPopupWindowState.open, false);
  const second = await fixture.service.openPinnedWindow();
  assert.notEqual(second.windowId, first.windowId);
  assert.equal(fixture.counts().createCount, 2);
});

test("窗口关闭后重新打开只恢复位置并保持固定大小", async () => {
  const fixture = buildWindowService();
  const first = await fixture.service.openPinnedWindow();
  const current = fixture.windows.get(first.windowId);
  Object.assign(current, { left: 120, top: 80, width: 640, height: 560 });
  fixture.boundsListeners[0](current);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(
    {
      left: fixture.localData.pinnedPopupWindowState.left,
      top: fixture.localData.pinnedPopupWindowState.top,
      width: fixture.localData.pinnedPopupWindowState.width,
      height: fixture.localData.pinnedPopupWindowState.height
    },
    { left: 120, top: 80, width: 320, height: 340 }
  );
  fixture.windows.delete(first.windowId);
  fixture.removedListeners[0](first.windowId);
  await new Promise((resolve) => setImmediate(resolve));
  const reopened = await fixture.service.openPinnedWindow();
  const restored = fixture.windows.get(reopened.windowId);
  assert.equal(reopened.restored, true);
  assert.deepEqual(
    { left: restored.left, top: restored.top, width: restored.width, height: restored.height },
    { left: 120, top: 80, width: 320, height: 340 }
  );
});

test("服务工作线程丢失窗口编号后会找回现有固定窗口", async () => {
  const fixture = buildWindowService();
  const first = await fixture.service.openPinnedWindow();
  delete fixture.sessionData.pinnedPopupWindowId;
  const recovered = await fixture.service.openPinnedWindow();
  assert.equal(recovered.ok, true);
  assert.equal(recovered.reused, true);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.windowId, first.windowId);
  assert.deepEqual(fixture.counts(), { createCount: 1, updateCount: 1 });
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

test("并发固定请求只创建一个窗口", async () => {
  const fixture = buildWindowService();
  const [first, second, third] = await Promise.all([
    fixture.service.openPinnedWindow(),
    fixture.service.openPinnedWindow(),
    fixture.service.openPinnedWindow()
  ]);
  assert.equal(fixture.counts().createCount, 1);
  assert.equal(first.windowId, second.windowId);
  assert.equal(second.windowId, third.windowId);
});

test("保存的窗口编号指向其他窗口时不会误复用", async () => {
  const fixture = buildWindowService();
  fixture.windows.set(99, { id: 99, type: "popup", tabs: [{ url: "https://example.com/" }] });
  fixture.sessionData.pinnedPopupWindowId = 99;
  const result = await fixture.service.openPinnedWindow();
  assert.equal(result.ok, true);
  assert.notEqual(result.windowId, 99);
  assert.equal(fixture.counts().createCount, 1);
});

test("连续窗口尺寸变化只保存最后一次状态", async () => {
  const fixture = buildWindowService();
  const opened = await fixture.service.openPinnedWindow();
  const windowInfo = fixture.windows.get(opened.windowId);
  for (let index = 0; index < 20; index += 1) {
    fixture.boundsListeners[0](Object.assign({}, windowInfo, { left: index, top: index, width: 500 + index, height: 400 + index }));
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(fixture.localData.pinnedPopupWindowState.left, 19);
  assert.equal(fixture.localData.pinnedPopupWindowState.width, 320);
  assert.equal(fixture.localData.pinnedPopupWindowState.height, 340);
});

test("固定窗口忽略外部传入的其他尺寸", () => {
  const fixture = buildWindowService();
  const small = fixture.service.normalizeBounds({ width: 120, height: 90 });
  const large = fixture.service.normalizeBounds({ width: 1920, height: 1080 });
  assert.deepEqual(JSON.parse(JSON.stringify(small)), { width: 320, height: 340 });
  assert.deepEqual(JSON.parse(JSON.stringify(large)), { width: 320, height: 340 });
});
