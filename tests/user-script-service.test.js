const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function storedScript(id, code = `console.log("${id}")`, permissions = ["dom"]) {
  const source = /@permission\s+/i.test(code)
    ? code
    : [
        "// ==UserScript==",
        ...permissions.map((permission) => `// @permission ${permission}`),
        "// ==/UserScript==",
        code
      ].join("\n");
  const signature = permissions.slice().sort().join(",");
  return {
    id,
    code: source,
    enabled: true,
    permissionConfirmed: true,
    permissionSignature: signature,
    grantedOrigins: ["https://example.com/*"],
    meta: { permissions: permissions.slice(), matches: ["https://example.com/*"], includes: [], excludes: [], runAt: "document_idle" }
  };
}

function buildService(initial = [], options = {}) {
  const registry = new Map(initial.map((item) => [item.id, item]));
  const calls = { unregister: [], update: [], register: [], configure: [], execute: [], events: [] };
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
      configureWorld(value) {
        calls.configure.push(value);
        calls.events.push({ type: "configure", worldId: value.worldId });
        return Promise.resolve();
      },
      unregister({ ids }) {
        calls.unregister.push(ids.slice());
        calls.events.push({ type: "unregister", ids: ids.slice() });
        return mutate(() => ids.forEach((id) => registry.delete(id)));
      },
      update(scripts) {
        calls.update.push(scripts.map((item) => item.id));
        calls.events.push({ type: "update", ids: scripts.map((item) => item.id) });
        return mutate(() => scripts.forEach((item) => registry.set(item.id, item)));
      },
      register(scripts) {
        calls.register.push(scripts.map((item) => item.id));
        calls.events.push({ type: "register", ids: scripts.map((item) => item.id) });
        return mutate(() => scripts.forEach((item) => {
          if (registry.has(item.id)) throw new Error(`duplicate ${item.id}`);
          registry.set(item.id, item);
        }));
      },
      execute(value) {
        calls.execute.push(value);
        calls.events.push({ type: "execute", worldId: value.worldId });
        return options.executeImpl ? options.executeImpl(value) : Promise.resolve([]);
      }
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
  assert.equal(fixture.calls.configure.length, 4);
  assert.equal(fixture.calls.configure.every((item) => item.messaging === false), true);
  assert.equal(fixture.calls.configure.every((item) => /connect-src 'none'/.test(item.csp)), true);
  assert.equal(fixture.calls.configure.some((item) => item.worldId === "wsb_world_obsolete"), true);
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

test("长脚本 ID 不会因截断而共享注册 ID 或隔离世界", async () => {
  const fixture = buildService();
  const sharedPrefix = "a".repeat(48);
  await fixture.service.sync([
    storedScript(sharedPrefix + "-one"),
    storedScript(sharedPrefix + "-two")
  ]);
  const registrationIds = Array.from(fixture.registry.keys());
  const worldIds = fixture.calls.configure.map((item) => item.worldId);
  assert.equal(registrationIds.length, 2);
  assert.equal(new Set(registrationIds).size, 2);
  assert.equal(new Set(worldIds).size, 2);
  assert.equal(registrationIds.every((id) => id.length <= 57), true);
  assert.equal(worldIds.every((id) => id.length <= 82), true);
});

test("声明 video.read 的普通用户脚本可以调用精简 status 接口", async () => {
  const fixture = buildService();
  const code = [
    "// ==UserScript==",
    "// @permission dom",
    "// @wsb-capability video.read",
    "// ==/UserScript==",
    "WSB.video.status();"
  ].join("\n");
  await fixture.service.sync([storedScript("video-status", code)]);
  const registered = fixture.registry.get("wsb-user-video-status");
  assert.ok(registered);
  assert.match(registered.js[0].code, /var WSB=Object\.freeze/);
  assert.match(registered.js[0].code, /status:function\(\)/);
  assert.match(registered.js[0].code, /getStatus:function\(\)/);
  assert.match(registered.js[0].code, /WSB_USER_SCRIPT_BRIDGE/);
  assert.equal(fixture.calls.configure[0].messaging, true);
});

test("普通脚本按独立 worldId 实施 network 最小权限，automation 不会自动开放联网或消息 API", async () => {
  const fixture = buildService();
  await fixture.service.sync([
    storedScript("dom-only"),
    storedScript("network", "fetch('https://example.com/data')", ["dom", "network"]),
    storedScript("automation", "console.log('automation')", ["dom", "automation"])
  ]);
  const policies = new Map(fixture.calls.configure.map((item) => [item.worldId, item]));
  const domPolicy = Array.from(policies.entries()).find(([id]) => id.startsWith("wsb_world_dom-only_n0_m0_c"))?.[1];
  const networkPolicy = Array.from(policies.entries()).find(([id]) => id.startsWith("wsb_world_network_n1_m0_c"))?.[1];
  const automationPolicy = Array.from(policies.entries()).find(([id]) => id.startsWith("wsb_world_automation_n0_m0_c"))?.[1];
  assert.match(domPolicy.csp, /connect-src 'none'/);
  assert.equal(domPolicy.messaging, false);
  assert.match(networkPolicy.csp, /connect-src http: https: ws: wss:/);
  assert.equal(networkPolicy.messaging, false);
  assert.match(automationPolicy.csp, /connect-src 'none'/);
  assert.equal(automationPolicy.messaging, false);
});

test("普通脚本拒绝缺少 dom、声明与保存权限不一致或未绑定确认签名的注册", async () => {
  const fixture = buildService();
  const networkOnly = storedScript("network-only", "fetch('https://example.com')", ["network"]);
  const mismatched = storedScript("mismatched");
  mismatched.meta.permissions = ["dom", "network"];
  mismatched.permissionSignature = "dom,network";
  const unsigned = storedScript("unsigned");
  unsigned.permissionSignature = "";
  const result = await fixture.service.sync([networkOnly, mismatched, unsigned]);
  assert.equal(result.registered, 0);
  assert.equal(fixture.calls.configure.length, 0);
  assert.equal(fixture.registry.size, 0);
});

test("手动执行重新核对代码声明，并使用同一最小权限 world 配置", async () => {
  const fixture = buildService();
  const script = storedScript("manual", "console.log('manual')", ["dom"]);
  await fixture.service.execute(script.id, script.code, script.meta.permissions, 7);
  assert.equal(fixture.calls.configure.length, 1);
  assert.match(fixture.calls.configure[0].csp, /connect-src 'none'/);
  assert.equal(fixture.calls.execute.length, 1);
  assert.equal(fixture.calls.execute[0].target.tabId, 7);
  assert.equal(fixture.calls.execute[0].worldId, fixture.calls.configure[0].worldId);
  await assert.rejects(
    fixture.service.execute(script.id, script.code, ["dom", "network"], 7),
    (error) => error && error.code === "USER_SCRIPT_PERMISSION_INVALID"
  );
});

test("权限或代码变化先配置新 world、再切换注册，并在切换后锁定旧 world", async () => {
  const oldWorldId = "wsb_world_upgrade_n0_m0_c0000000000000000";
  const fixture = buildService([{
    id: "wsb-user-upgrade",
    worldId: oldWorldId,
    js: [{ code: "old" }]
  }]);
  const upgraded = storedScript(
    "upgrade",
    "fetch('https://example.com/data')",
    ["dom", "network"]
  );

  await fixture.service.sync([upgraded]);

  const registered = fixture.registry.get("wsb-user-upgrade");
  assert.match(registered.worldId, /^wsb_world_upgrade_n1_m0_c[0-9a-f]{16}$/);
  assert.notEqual(registered.worldId, oldWorldId);
  const configureNewIndex = fixture.calls.events.findIndex((event) =>
    event.type === "configure" && event.worldId === registered.worldId
  );
  const updateIndex = fixture.calls.events.findIndex((event) => event.type === "update");
  const lockOldIndex = fixture.calls.events.findIndex((event) =>
    event.type === "configure" && event.worldId === oldWorldId
  );
  assert.ok(configureNewIndex >= 0 && configureNewIndex < updateIndex);
  assert.ok(lockOldIndex > updateIndex);
  const oldPolicy = fixture.calls.configure.find((item) => item.worldId === oldWorldId);
  assert.equal(oldPolicy.messaging, false);
  assert.match(oldPolicy.csp, /connect-src 'none'/);
});

test("相同权限下修改代码也更换 world，防止旧页面代码重新继承权限", async () => {
  const oldCode = storedScript("edited", "console.log('old')").code;
  const oldWorldId = "wsb_world_edited_n0_m0_c" +
    "0000000000000000";
  const fixture = buildService([{
    id: "wsb-user-edited",
    worldId: oldWorldId,
    js: [{ code: oldCode }]
  }]);

  await fixture.service.sync([storedScript("edited", "console.log('new')")]);

  const registered = fixture.registry.get("wsb-user-edited");
  assert.notEqual(registered.worldId, oldWorldId);
  assert.match(registered.worldId, /^wsb_world_edited_n0_m0_c[0-9a-f]{16}$/);
  const oldPolicy = fixture.calls.configure.find((item) => item.worldId === oldWorldId);
  assert.equal(oldPolicy.messaging, false);
  assert.match(oldPolicy.csp, /connect-src 'none'/);
});

test("手动执行与注册同步共用队列，不会穿插权限世界切换", async () => {
  const fixture = buildService();
  const registeredScript = storedScript("registered");
  const manualScript = storedScript("manual-queued");

  const syncing = fixture.service.sync([registeredScript]);
  const executing = fixture.service.execute(
    manualScript.id,
    manualScript.code,
    manualScript.meta.permissions,
    9
  );
  await Promise.all([syncing, executing]);

  const registerIndex = fixture.calls.events.findIndex((event) => event.type === "register");
  const executeIndex = fixture.calls.events.findIndex((event) => event.type === "execute");
  assert.ok(registerIndex >= 0 && executeIndex > registerIndex);
});
