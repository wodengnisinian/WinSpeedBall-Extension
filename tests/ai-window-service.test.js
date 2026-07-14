const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "background/ai-window-service.js"), "utf8");

function createFixture() {
  const extensionId = "extension-id";
  const replyUrl = `chrome-extension://${extensionId}/ai_reply.html`;
  const windows = new Map();
  const writes = [];
  const created = [];
  const updates = [];
  let nextId = 10;
  let contexts = [];

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
      getLastFocused(info, callback) { callback({ id: 1, left: 100, top: 50, width: 1200, height: 800 }); },
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
      }
    }
  };
  const context = { self: {}, chrome, Promise, Object, Array, String, Number, Math, Date, setTimeout, clearTimeout };
  vm.createContext(context);
  vm.runInContext(source, context);

  return {
    replyUrl, windows, writes, created, updates,
    createService() {
      return context.self.WinSpeedBallAiWindowService.create({
        storageKey: "aiReplyWindowPayload",
        bounds: { width: 280, height: 180 }
      });
    }
  };
}

test("AI 窗口首次创建后复用同一窗口并更新回复", async () => {
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
  assert.equal(second.reused, true);
  assert.equal(fixture.created.length, 1);
  assert.equal(fixture.created[0].width, 280);
  assert.equal(fixture.created[0].height, 180);
  assert.equal(fixture.writes.at(-1).aiReplyWindowPayload.content, "第二条");
});
test("后台服务重启后找回已有 AI 窗口而不重复创建", async () => {
  const fixture = createFixture();
  const firstService = fixture.createService();
  const first = await firstService.show({ content: "旧回复" });
  const restartedService = fixture.createService();
  const recovered = await restartedService.show({ content: "新回复" });

  assert.equal(fixture.created.length, 1);
  assert.equal(recovered.windowId, first.windowId);
  assert.equal(recovered.reused, true);
  assert.equal(recovered.recovered, true);
});

test("AI 窗口尺寸变化会被延迟恢复到固定值", async () => {
  const fixture = createFixture();
  const service = fixture.createService();
  const opened = await service.show({ content: "回复" });
  service.handleBoundsChanged({ id: opened.windowId, width: 500, height: 400 });
  await new Promise((resolve) => setTimeout(resolve, 160));
  const update = fixture.updates.at(-1);
  assert.deepEqual(update, { id: opened.windowId, patch: { width: 280, height: 180 } });
});
