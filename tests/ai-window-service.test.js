const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "background/ai-window-service.js"), "utf8");

function createFixture(options = {}) {
  const extensionId = "extension-id";
  const replyUrl = `chrome-extension://${extensionId}/popup/ai-reply.html`;
  const windows = new Map();
  const writes = [];
  const created = [];
  const updates = [];
  const removed = [];
  let nextId = 10;
  let contexts = [];
  const lastFocusedWindow = options.lastFocusedWindow || { id: 1, type: "normal", left: 100, top: 50, width: 1200, height: 800 };

  const chrome = {
    runtime: {
      lastError: null,
      getURL(file) { return `chrome-extension://${extensionId}/${file}`; },
      getContexts() { return Promise.resolve(contexts); }
    },
    storage: {
      session: {
        set(data, callback) { writes.push(JSON.parse(JSON.stringify(data))); callback(); }
      }
    },
    windows: {
      get(id, info, callback) {
        if (typeof info === "function") { callback = info; }
        callback(windows.get(id) || null);
      },
      getAll(info, callback) { callback([...windows.values()]); },
      getLastFocused(info, callback) { callback({ ...lastFocusedWindow }); },
      create(options, callback) {
        const record = { id: nextId++, type: options.type, tabs: [{ url: options.url }], ...options };
        windows.set(record.id, record);
        created.push(record);
        contexts = [{ windowId: record.id }];
        callback(record);
      },
      update(id, patch, callback) {
        const current = windows.get(id);
        if (!current) { callback(null); return; }
        Object.assign(current, patch);
        updates.push({ id, patch: { ...patch } });
        callback(current);
      },
      remove(id, callback) {
        windows.delete(id);
        removed.push(id);
        callback();
      }
    }
  };
  const context = {
    self: options.normalizeText ? { WinSpeedBallTextNormalizer: { normalize: options.normalizeText } } : {},
    chrome, Promise, Object, Array, String, Number, Math, Date, setTimeout, clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  return {
    replyUrl, windows, writes, created, updates, removed,
    createService() {
      return context.self.WinSpeedBallAiWindowService.create({
        storageKey: "aiReplyWindowPayload",
        bounds: { width: 320, height: 240 }
      });
    }
  };
}

test("第二次 AI 回复会完整关闭第一次窗口并创建新的置前窗口", async () => {
  const fixture = createFixture();
  const service = fixture.createService();
  const first = await service.show({
    content: "第一条",
    windowLeft: 800, windowTop: 100, windowWidth: 340, windowHeight: 340,
    screenLeft: 0, screenTop: 0, screenWidth: 1920, screenHeight: 1040
  });
  const second = await service.show({
    content: "第二条",
    windowLeft: 800, windowTop: 100, windowWidth: 340, windowHeight: 340,
    screenLeft: 0, screenTop: 0, screenWidth: 1920, screenHeight: 1040
  });

  assert.equal(first.reused, false);
  assert.equal(second.reused, false);
  assert.notEqual(second.windowId, first.windowId);
  assert.equal(fixture.created.length, 2);
  assert.equal(fixture.created[1].width, 320);
  assert.equal(fixture.created[1].height, 240);
  assert.equal(fixture.created[1].focused, true);
  assert.deepEqual(fixture.removed, [first.windowId]);
  assert.equal(fixture.writes.at(-1).aiReplyWindowPayload.content, "第二条");
});

test("AI 回复窗口保存前再次执行中英文正规化", async () => {
  const fixture = createFixture({ normalizeText: (value) => String(value).replace(/繁體/g, "繁体") });
  const service = fixture.createService();
  await service.show({ content: "繁體回答" });
  assert.equal(fixture.writes.at(-1).aiReplyWindowPayload.content, "繁体回答");
});

test("新 AI 回复置前并与紧凑插件窗口相邻显示", async () => {
  const pluginWindow = { id: 2, type: "popup", left: 1500, top: 100, width: 320, height: 340 };
  const fixture = createFixture({ lastFocusedWindow: pluginWindow });
  const service = fixture.createService();
  await service.show({ content: "新回复" });
  const reply = fixture.created[0];
  assert.equal(reply.focused, true);
  assert.equal(reply.left, 1172);
  assert.equal(reply.top, 150);
  assert.ok(reply.left + reply.width <= pluginWindow.left);
});
test("后台服务重启后会找到并替换旧 AI 回复窗口", async () => {
  const fixture = createFixture();
  const firstService = fixture.createService();
  const first = await firstService.show({ content: "旧回复" });
  const restartedService = fixture.createService();
  const replaced = await restartedService.show({ content: "新回复" });

  assert.equal(fixture.created.length, 2);
  assert.notEqual(replaced.windowId, first.windowId);
  assert.equal(replaced.reused, false);
  assert.deepEqual(fixture.removed, [first.windowId]);
});

test("多次询问前会清理全部旧 AI 回复窗口并只创建一个新窗口", async () => {
  const fixture = createFixture();
  const firstService = fixture.createService();
  const first = await firstService.show({ content: "第一次回复" });
  fixture.windows.set(99, {
    id: 99,
    type: "popup",
    tabs: [{ url: fixture.replyUrl }],
    left: 100,
    top: 100,
    width: 320,
    height: 240
  });
  const restartedService = fixture.createService();
  const next = await restartedService.show({ content: "第二次回复" });
  assert.notEqual(next.windowId, first.windowId);
  assert.equal(fixture.created.length, 2);
  assert.deepEqual(fixture.removed, [99, first.windowId]);
  assert.equal(fixture.windows.size, 1);
});

test("AI 窗口尺寸变化会被延迟恢复到固定值", async () => {
  const fixture = createFixture();
  const service = fixture.createService();
  const opened = await service.show({ content: "回复" });
  service.handleBoundsChanged({ id: opened.windowId, width: 500, height: 400 });
  await new Promise((resolve) => setTimeout(resolve, 160));
  const update = fixture.updates.at(-1);
  assert.deepEqual(update, { id: opened.windowId, patch: { width: 320, height: 240 } });
});
