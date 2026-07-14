const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function storedScript(id, code = `console.log("${id}")`) {
  return {
    id,
    code,
    enabled: true,
    permissionConfirmed: true,
    grantedOrigins: ["https://example.com/*"],
    meta: { permissions: ["dom"], matches: ["https://example.com/*"], includes: [], excludes: [], runAt: "document_idle" }
  };
}

function buildService(initial = []) {
  const registry = new Map(initial.map((item) => [item.id, item]));
  const calls = { unregister: [], update: [], register: [], configure: [] };
  let activeMutations = 0;
  let maxActiveMutations = 0;
  const mutate = (task) => new Promise((resolve, reject) => {
    activeMutations += 1;
    maxActiveMutations = Math.max(maxActiveMutations, activeMutations);
    setTimeout(() => {
      try { task(); resolve(); } catch (error) { reject(error); }
      activeMutations -= 1;
    }, 1);
  });
  const chrome = {
    userScripts: {
      getScripts() { return Promise.resolve(Array.from(registry.values())); },
      configureWorld(value) { calls.configure.push(value); return Promise.resolve(); },
      unregister({ ids }) {
        calls.unregister.push(ids.slice());
        return mutate(() => ids.forEach((id) => registry.delete(id)));
      },
      update(scripts) {
        calls.update.push(scripts.map((item) => item.id));
        return mutate(() => scripts.forEach((item) => registry.set(item.id, item)));
      },
      register(scripts) {
        calls.register.push(scripts.map((item) => item.id));
        return mutate(() => scripts.forEach((item) => {
          if (registry.has(item.id)) throw new Error(`duplicate ${item.id}`);
          registry.set(item.id, item);
        }));
      },
      execute() { return Promise.resolve([]); }
    }
  };
  const context = { self: {}, chrome, Promise, Object, Array, String, JSON, Error, Set, Map };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/user-script-service.js"), "utf8"), context);
  return {
    service: context.self.WinSpeedBallUserScriptService,
    calls,
    registry,
    getMaxActiveMutations: () => maxActiveMutations
  };
}

test("用户脚本同步按差异更新，不再全部注销", async () => {
  const fixture = buildService([
    { id: "wsb-user-one", js: [{ code: "old" }] },
    { id: "wsb-user-obsolete", js: [{ code: "old" }] }
  ]);
  const result = await fixture.service.sync([storedScript("one", "new code"), storedScript("two")]);
  assert.equal(result.registered, 2);
  assert.deepEqual(fixture.calls.unregister, [["wsb-user-obsolete"]]);
  assert.deepEqual(fixture.calls.update, [["wsb-user-one"]]);
  assert.deepEqual(fixture.calls.register, [["wsb-user-two"]]);
  assert.deepEqual(Array.from(fixture.registry.keys()).sort(), ["wsb-user-one", "wsb-user-two"]);
  assert.equal(fixture.calls.configure.length, 2);
  assert.equal(fixture.calls.configure.every((item) => item.messaging === true), true);
});

test("并发用户脚本同步被串行化且最终状态采用最后请求", async () => {
  const fixture = buildService();
  const first = fixture.service.sync([storedScript("one")]);
  const second = fixture.service.sync([storedScript("two")]);
  const third = fixture.service.sync([storedScript("three")]);
  await Promise.all([first, second, third]);
  assert.equal(fixture.getMaxActiveMutations(), 1);
  assert.deepEqual(Array.from(fixture.registry.keys()), ["wsb-user-three"]);
});

test("声明 video.read 的普通用户脚本可以调用公开 WSB.video.getStatus", async () => {
  const fixture = buildService();
  const code = [
    "// ==UserScript==",
    "// @wsb-capability video.read",
    "// ==/UserScript==",
    "WSB.video.getStatus();"
  ].join("\n");
  await fixture.service.sync([storedScript("video-status", code)]);
  const registered = fixture.registry.get("wsb-user-video-status");
  assert.ok(registered);
  assert.match(registered.js[0].code, /var WSB=Object\.freeze/);
  assert.match(registered.js[0].code, /getStatus:function\(\)/);
  assert.match(registered.js[0].code, /WSB_USER_SCRIPT_BRIDGE/);
  assert.equal(fixture.calls.configure[0].messaging, true);
});
