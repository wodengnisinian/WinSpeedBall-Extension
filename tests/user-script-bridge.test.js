const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function loadBridge() {
  const context = { self: {}, URL, Object, Array, String, Number, Promise };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/user-script-bridge.js"), "utf8"), context);
  return context.self.WinSpeedBallUserScriptBridge;
}

test("用户脚本桥只允许顶层网页读取插件视频状态", async () => {
  const api = loadBridge();
  const calls = [];
  const bridge = api.create({
    canUseFeature() { return Promise.resolve({ allowed: true }); },
    controlTab(tabId, command, callback) {
      calls.push({ tabId, command });
      callback({
        ok: true,
        duration: 506,
        currentTime: 98,
        mediaCount: 1,
        paused: false,
        rate: 5,
        durationSource: "media-element",
        privateUrl: "https://private.example/video.mp4"
      });
    }
  });
  const message = { channel: "WSB_USER_SCRIPT_BRIDGE", version: 1, action: "GET_VIDEO_STATUS" };
  const sender = { frameId: 0, url: "https://mooc1.chaoxing.com/course", tab: { id: 9, url: "https://mooc1.chaoxing.com/course" } };
  const response = await new Promise((resolve) => {
    assert.equal(bridge.handle(message, sender, resolve), true);
  });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ tabId: 9, command: { type: "GET_STATUS" } }]);
  assert.equal(response.ok, true);
  assert.equal(response.duration, 506);
  assert.equal(response.currentTime, 98);
  assert.equal(Object.prototype.hasOwnProperty.call(response, "privateUrl"), false);

  let denied;
  assert.equal(bridge.handle(message, { ...sender, frameId: 2 }, (value) => { denied = value; }), false);
  assert.equal(denied.code, "USER_SCRIPT_BRIDGE_DENIED");
});

test("用户脚本桥拒绝未知动作和额外字段", () => {
  const bridge = loadBridge().create({ controlTab() {} });
  const sender = { frameId: 0, url: "https://example.com/", tab: { id: 1, url: "https://example.com/" } };
  let unknown;
  bridge.handle({ channel: "WSB_USER_SCRIPT_BRIDGE", version: 1, action: "CLICK", extra: true }, sender, (value) => { unknown = value; });
  assert.equal(unknown.code, "USER_SCRIPT_BRIDGE_INVALID");
});
