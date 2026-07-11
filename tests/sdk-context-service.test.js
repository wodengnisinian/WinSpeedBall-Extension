const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function buildService() {
  let intents = {};
  let sequence = 0;
  let now = 1700000000000;
  let current = { tabId: 8, origin: "https://study.example", originPattern: "https://study.example/*", url: "https://study.example/course" };
  const context = { self: { crypto: { getRandomValues() {} } }, Object, Array, String, Number, Date, Promise, Uint8Array };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "sdk/contracts.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/sdk-context-service.js"), "utf8"), context);
  const service = context.self.WinSpeedBallSdkContextService.create({
    contracts: context.self.WinSpeedBallSdkContracts,
    resolveCurrent() { return Promise.resolve({ ok: true, ...current }); },
    validateContext(record) {
      return Promise.resolve(record.tabId === current.tabId && record.origin === current.origin
        ? { ok: true }
        : { ok: false, code: "SDK_CONTEXT_CHANGED", error: "context changed" });
    },
    readIntents() { return Promise.resolve(JSON.parse(JSON.stringify(intents))); },
    writeIntents(value) { intents = JSON.parse(JSON.stringify(value)); return Promise.resolve({ ok: true }); },
    now: () => now,
    createNonce: () => `wsb_ctx_${(++sequence).toString(16).padStart(64, "0")}`
  });
  return {
    service,
    getIntents: () => JSON.parse(JSON.stringify(intents)),
    setCurrent(value) { current = { ...value }; },
    advance(value) { now += value; }
  };
}

test("SDK 上下文确认绑定标签页、来源和能力且只能消费一次", async () => {
  const fixture = buildService();
  const prepared = await fixture.service.prepare(["video.read", "page.read"]);
  assert.equal(prepared.ok, true);
  assert.equal(prepared.tabId, 8);
  assert.equal(prepared.origin, "https://study.example");
  const consumed = await fixture.service.consume(prepared.contextNonce, ["page.read", "video.read"]);
  assert.equal(consumed.ok, true);
  assert.equal(Object.keys(fixture.getIntents()).length, 0);
  assert.equal((await fixture.service.consume(prepared.contextNonce, ["video.read", "page.read"])).code, "SDK_CONTEXT_NONCE_INVALID");
});

test("确认后页面来源变化会拒绝创建 SDK 会话", async () => {
  const fixture = buildService();
  const prepared = await fixture.service.prepare(["video.read"]);
  fixture.setCurrent({ tabId: 8, origin: "https://attacker.example", originPattern: "https://attacker.example/*", url: "https://attacker.example/" });
  const result = await fixture.service.consume(prepared.contextNonce, ["video.read"]);
  assert.equal(result.code, "SDK_CONTEXT_CHANGED");
});

test("上下文能力变化或确认过期都会被拒绝", async () => {
  const mismatchFixture = buildService();
  const mismatch = await mismatchFixture.service.prepare(["video.read"]);
  assert.equal((await mismatchFixture.service.consume(mismatch.contextNonce, ["video.control"])).code, "SDK_CONTEXT_CAPABILITY_MISMATCH");

  const expiredFixture = buildService();
  const expired = await expiredFixture.service.prepare(["storage"]);
  expiredFixture.advance(120001);
  assert.equal((await expiredFixture.service.consume(expired.contextNonce, ["storage"])).code, "SDK_CONTEXT_NONCE_EXPIRED");
});

test("并发预备多个 SDK 上下文不会覆盖", async () => {
  const fixture = buildService();
  const prepared = await Promise.all(Array.from({ length: 20 }, () => fixture.service.prepare(["storage"])));
  assert.equal(prepared.every((result) => result.ok), true);
  assert.equal(Object.keys(fixture.getIntents()).length, 20);
});
