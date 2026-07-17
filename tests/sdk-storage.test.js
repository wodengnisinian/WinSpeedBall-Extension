const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function buildService() {
  const data = {};
  const context = {
    self: {
      WinSpeedBallStorageService: {
        get(keys, callback) {
          const result = {};
          for (const key of keys) if (Object.prototype.hasOwnProperty.call(data, key)) result[key] = data[key];
          callback(result);
        },
        set(value, callback) { Object.assign(data, JSON.parse(JSON.stringify(value))); callback({ ok: true }); }
      }
    },
    Promise, Object, Array, String, JSON
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/sdk-storage-service.js"), "utf8"), context);
  return { service: context.self.WinSpeedBallSdkStorageService, data };
}

test("SDK Storage 按脚本隔离键值", async () => {
  const fixture = buildService();
  await fixture.service.set("script_one", "progress", { value: 50 });
  await fixture.service.set("script_two", "progress", { value: 80 });
  assert.deepEqual(JSON.parse(JSON.stringify(await fixture.service.get("script_one", "progress"))), { ok: true, found: true, value: { value: 50 } });
  assert.deepEqual(JSON.parse(JSON.stringify(await fixture.service.get("script_two", "progress"))), { ok: true, found: true, value: { value: 80 } });
});

test("SDK Storage 拒绝危险键和不可序列化值", async () => {
  const fixture = buildService();
  assert.equal((await fixture.service.set("script", "__proto__", 1)).code, "SDK_INVALID_ARGUMENT");
  for (const scriptId of ["__proto__", "prototype", "constructor"]) {
    assert.equal((await fixture.service.set(scriptId, "value", 1)).code, "SDK_INVALID_ARGUMENT");
  }
  const circular = {}; circular.self = circular;
  assert.equal((await fixture.service.set("script", "value", circular)).code, "SDK_INVALID_ARGUMENT");
});

test("SDK Storage 执行单值和键数量配额", async () => {
  const fixture = buildService();
  assert.equal((await fixture.service.set("script", "large", "x".repeat(65537))).code, "SDK_QUOTA_EXCEEDED");
  for (let index = 0; index < 100; index += 1) assert.equal((await fixture.service.set("script", `key_${index}`, index)).ok, true);
  assert.equal((await fixture.service.set("script", "overflow", true)).code, "SDK_QUOTA_EXCEEDED");
});

test("SDK Storage 单个高级脚本总容量上限为 5 MiB", async () => {
  const fixture = buildService();
  fixture.data.sdkScriptStorage = { advanced: {} };
  for (let index = 0; index < 79; index += 1) {
    fixture.data.sdkScriptStorage.advanced[`part_${String(index).padStart(2, "0")}`] = "x".repeat(65500);
  }
  const within = await fixture.service.set("advanced", "part_79", "x".repeat(65500));
  assert.equal(within.ok, true);
  assert.ok(within.bytesUsed > 4 * 1024 * 1024);
  assert.ok(within.bytesUsed <= 5 * 1024 * 1024);
  const overflow = await fixture.service.set("advanced", "overflow", "x".repeat(2000));
  assert.equal(overflow.code, "SDK_QUOTA_EXCEEDED");
  assert.equal(overflow.error, "Script storage exceeds 5 MiB.");
});

test("SDK Storage 可以清理单个脚本并统计", async () => {
  const fixture = buildService();
  await fixture.service.set("one", "a", 1);
  await fixture.service.set("two", "b", 2);
  assert.deepEqual(JSON.parse(JSON.stringify(await fixture.service.getSummary())), { ok: true, scripts: 2, keys: 2, bytes: JSON.stringify(fixture.data.sdkScriptStorage).length });
  await fixture.service.clearScript("one");
  assert.equal((await fixture.service.get("one", "a")).found, false);
  assert.equal((await fixture.service.get("two", "b")).found, true);
});

test("SDK Storage 并发写入不会相互覆盖", async () => {
  const fixture = buildService();
  const results = await Promise.all(Array.from({ length: 100 }, (_, index) => fixture.service.set("parallel", `key_${index}`, index)));
  assert.equal(results.every((result) => result.ok), true);
  const summary = await fixture.service.getSummary();
  assert.equal(summary.scripts, 1);
  assert.equal(summary.keys, 100);
  for (let index = 0; index < 100; index += 1) {
    assert.equal((await fixture.service.get("parallel", `key_${index}`)).value, index);
  }
});

test("SDK Storage 配额按 UTF-8 字节计算", async () => {
  const fixture = buildService();
  assert.equal(fixture.service.utf8ByteLength("中文"), 6);
  assert.equal(fixture.service.utf8ByteLength("学习"), 6);
  assert.equal((await fixture.service.set("unicode", "within", "中".repeat(21844))).ok, true);
  assert.equal((await fixture.service.set("unicode", "overflow", "中".repeat(21845))).code, "SDK_QUOTA_EXCEEDED");
});
