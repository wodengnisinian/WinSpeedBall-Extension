const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "popup/message-client.js"), "utf8");

function createFixture(permissionGranted) {
  const requested = [];
  const registered = [];
  const context = {
    self: {}, URL, Promise, Object, Array, String, Set,
    chrome: {
      runtime: { lastError: null, sendMessage(message, callback) { callback({ ok: true }); } },
      permissions: {
        contains(options, callback) { callback(false); },
        request(options, callback) { requested.push(options); callback(permissionGranted !== false); }
      },
      scripting: {
        executeScript(options, callback) { callback([{ result: ["https://media.cdn.test/embed/player"] }]); },
        getRegisteredContentScripts(options, callback) { callback([]); },
        registerContentScripts(definitions, callback) { registered.push(...definitions); callback(); },
        updateContentScripts(definitions, callback) { registered.push(...definitions); callback(); }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { api: context.self.WinSpeedBallPopupMessageClient, requested, registered };
}

test("视频授权同时包含当前页面和跨域播放器来源", async () => {
  const fixture = createFixture(true);
  const result = await fixture.api.ensureMediaAccess({
    ok: true,
    granted: false,
    tabId: 7,
    originPattern: "https://course.example.test/*"
  });

  assert.equal(result.ok, true);
  assert.equal(result.frameAccessGranted, true);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.requested[0].origins)), [
    "https://course.example.test/*",
    "https://media.cdn.test/*"
  ]);
  assert.equal(fixture.registered.length, 1);
  assert.equal(fixture.registered[0].runAt, "document_start");
  assert.equal(fixture.registered[0].allFrames, true);
  assert.equal(fixture.registered[0].world, "MAIN");
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.registered[0].js)), ["shadow_hook.js", "content/media-core-main.js"]);
});

test("拒绝跨域视频授权时不会注册深度强控", async () => {
  const fixture = createFixture(false);
  const result = await fixture.api.ensureMediaAccess({
    ok: true,
    granted: false,
    tabId: 7,
    originPattern: "https://course.example.test/*"
  });
  assert.equal(result.ok, false);
  assert.equal(result.preloadRegistered, false);
  assert.equal(fixture.registered.length, 0);
});
