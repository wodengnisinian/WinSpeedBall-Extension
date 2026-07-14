const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const validCode = (name = "Draft") => `// ==UserScript==\n// @name ${name}\n// @version 1.0.0\n// @wsb-capability video.read\n// ==/UserScript==\n`;

function buildStore(seed = {}) {
  const localData = Object.assign({}, seed);
  let sequence = 0;
  const context = { self: {}, Object, Array, String, Number, JSON, Promise, Error, Date, Math };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "sdk/contracts.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "popup/developer-draft-store.js"), "utf8"), context);
  const storage = {
    get(keys, callback) {
      const result = {};
      for (const key of keys) if (Object.prototype.hasOwnProperty.call(localData, key)) result[key] = localData[key];
      callback(result);
    },
    set(data, callback) { Object.assign(localData, JSON.parse(JSON.stringify(data))); callback({ ok: true }); },
    remove(keys, callback) { for (const key of keys) delete localData[key]; callback({ ok: true }); }
  };
  const store = context.self.WinSpeedBallDeveloperDraftStore.create({
    storage,
    contracts: context.self.WinSpeedBallSdkContracts,
    now: () => 1000 + sequence,
    idFactory: () => `draft_${++sequence}`
  });
  return { store, localData };
}

test("旧单草稿自动迁移为多草稿结构", async () => {
  const fixture = buildStore({ developerSdkDraft: { code: validCode("Legacy"), savedAt: 10 } });
  const result = await fixture.store.load();
  assert.equal(result.drafts.length, 1);
  assert.equal(result.drafts[0].name, "Legacy");
  assert.equal(fixture.localData.developerSdkDraft, undefined);
  assert.equal(fixture.localData.developerSdkDrafts.length, 1);
});

test("可以新增、选择、保存和删除多个 SDK 草稿", async () => {
  const fixture = buildStore();
  await fixture.store.load();
  const first = await fixture.store.createDraft(validCode("One"));
  const second = await fixture.store.createDraft(validCode("Two"));
  assert.equal(fixture.store.snapshot().drafts.length, 2);
  await fixture.store.selectDraft(first.id);
  await fixture.store.saveDraft(first.id, validCode("One Updated"));
  assert.equal(fixture.store.getActive().name, "One Updated");
  await fixture.store.removeDraft(first.id);
  assert.equal(fixture.store.getActive().id, second.id);
});

test("拒绝旧权限脚本和能力冲突脚本", async () => {
  const fixture = buildStore();
  await fixture.store.load();
  await assert.rejects(() => fixture.store.createDraft(`// ==UserScript==\n// @permission dom\n// ==/UserScript==`), (error) => error.code === "LEGACY_SCRIPT_ONLY");
  await assert.rejects(() => fixture.store.createDraft(`// ==UserScript==\n// @wsb-capability page.read\n// @permission dom\n// ==/UserScript==`), (error) => error.code === "SDK_METADATA_CONFLICT");
});

test("导出草稿会生成安全文件名且不改变代码", async () => {
  const fixture = buildStore();
  await fixture.store.load();
  const draft = await fixture.store.createDraft(validCode("A/B: Test"));
  const exported = fixture.store.exportDraft(draft.id);
  assert.equal(exported.fileName, "A-B- Test.js");
  assert.equal(exported.code, validCode("A/B: Test"));
});

test("SDK 草稿迁移会替换危险标识", async () => {
  const fixture = buildStore({
    developerSdkDrafts: [{ id: "__proto__", code: validCode("Unsafe") }],
    developerActiveDraftId: "__proto__"
  });
  const result = await fixture.store.load();
  assert.equal(result.drafts.length, 1);
  assert.equal(result.drafts[0].id, "draft_1");
  assert.equal(result.activeId, "draft_1");
});
