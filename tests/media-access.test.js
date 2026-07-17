const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "popup/message-client.js"), "utf8");

function createFixture(permissionGranted, frameUrl = "https://media.cdn.test/embed/player") {
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
      webNavigation: {
        getAllFrames(options, callback) {
          callback([
            { frameId: 0, parentFrameId: -1, url: "https://mooc1.chaoxing.com/mycourse/studentstudy" },
            { frameId: 7, parentFrameId: 0, url: frameUrl }
          ]);
        }
      },
      scripting: {
        executeScript(options, callback) { callback([{ result: [frameUrl] }]); },
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
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.registered[0].js)), ["content/shadow-hook.js", "content/media-core-main.js"]);
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

test("图书授权同时包含学习通课程页和内嵌阅读器来源", async () => {
  const fixture = createFixture(true, "https://resapi.chaoxing.com/realReadNew?gcebook=1");
  const result = await fixture.api.ensureBookAccess({
    ok: true,
    granted: false,
    tabId: 9,
    originPattern: "https://mooc1.chaoxing.com/*"
  });

  assert.equal(result.ok, true);
  assert.equal(result.frameAccessGranted, true);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.requested[0].origins)), [
    "https://mooc1.chaoxing.com/*",
    "*://*.chaoxing.com/*",
    "*://*.sslibrary.com/*"
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.bookFrameOrigins)), [
    "*://*.chaoxing.com/*",
    "*://*.sslibrary.com/*"
  ]);
  assert.equal(result.preloadRegistered, true);
  assert.equal(fixture.registered.length, 1);
  assert.equal(fixture.registered[0].id, "winspeedball-book-preload");
  assert.equal(fixture.registered[0].runAt, "document_start");
  assert.equal(fixture.registered[0].allFrames, true);
  assert.equal(fixture.registered[0].world, "MAIN");
  assert.equal(fixture.registered[0].matchOriginAsFallback, true);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.registered[0].js)), ["content/book-core-main.js"]);
});
