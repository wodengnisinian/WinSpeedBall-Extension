const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function buildServices(initialLocal) {
  const localData = clone(initialLocal || {});
  const sessionData = {};
  const storage = {
    get(keys, callback) {
      const result = {};
      (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(localData, key)) result[key] = clone(localData[key]);
      });
      callback(result);
    },
    set(data, callback) {
      Object.assign(localData, clone(data));
      (callback || (() => {}))({ ok: true });
    }
  };
  const session = {
    get(keys, callback) {
      const result = {};
      (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(sessionData, key)) result[key] = clone(sessionData[key]);
      });
      callback(result);
    },
    set(data, callback) {
      Object.assign(sessionData, clone(data));
      (callback || (() => {}))();
    },
    remove(keys, callback) {
      (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete sessionData[key]);
      (callback || (() => {}))();
    },
    setAccessLevel() { return Promise.resolve(); }
  };
  const context = {
    self: {},
    chrome: {
      runtime: {
        id: "extension-id",
        lastError: null,
        getManifest: () => ({ version: "3.4.0" }),
        getURL: (file) => `chrome-extension://extension-id/${file}`
      },
      storage: { session }
    },
    crypto: webcrypto,
    TextEncoder,
    Uint8Array,
    Date,
    URL,
    Promise,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("binary")
  };
  context.self.WinSpeedBallStorageService = storage;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/declaration-service.js"), "utf8"), context);
  context.self.WinSpeedBallDeclarationService = context.self.WinSpeedBallDeclarationService;
  vm.runInContext(fs.readFileSync(path.join(root, "background/user-service.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/user-provider.js"), "utf8"), context);
  return {
    declaration: context.self.WinSpeedBallDeclarationService,
    users: context.self.WinSpeedBallUserService,
    localData,
    sessionData
  };
}

test("声明首次读取为未确认并提供稳定摘要", async () => {
  const services = buildServices();
  const result = await services.declaration.get();
  assert.equal(result.ok, true);
  assert.equal(result.accepted, false);
  assert.match(result.version, /^2026-/);
  assert.match(result.contentHash, /^[a-f0-9]{64}$/);
  assert.ok(result.sections.length >= 5);
});

test("声明必须匹配当前版本并明确同意", async () => {
  const services = buildServices();
  const rejected = await services.declaration.accept({ version: "old", accepted: true });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, "DECLARATION_UPDATED");
  const policy = await services.declaration.get();
  const accepted = await services.declaration.accept({ version: policy.version, accepted: true });
  assert.equal(accepted.ok, true);
  const current = await services.declaration.get();
  assert.equal(current.accepted, true);
  assert.equal(services.localData.usageDeclarationHistory.length, 1);
  assert.equal(services.localData.usageDeclarationAcceptance.contentHash, current.contentHash);
});

test("未同意声明时不能注册", async () => {
  const services = buildServices();
  const result = await services.users.register({ username: "student01", password: "Study1234", displayName: "学习者" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "DECLARATION_REQUIRED");
  assert.equal(services.localData.localUserAccounts, undefined);
});

async function acceptedServices() {
  const services = buildServices();
  const policy = await services.declaration.get();
  await services.declaration.accept({ version: policy.version, accepted: true });
  return services;
}

test("注册后只保存加盐摘要且会话位于 session storage", async () => {
  const services = await acceptedServices();
  const result = await services.users.register({ username: "student01", password: "Study1234", displayName: "学习者" });
  assert.equal(result.ok, true);
  assert.equal(result.authenticated, true);
  assert.equal(result.user.plan, "free");
  assert.equal(result.user.quota.dailyOCR, 10);
  const account = services.localData.localUserAccounts[0];
  assert.notEqual(account.passwordHash, "Study1234");
  assert.ok(account.salt);
  assert.equal(JSON.stringify(services.localData).includes("Study1234"), false);
  assert.ok(services.sessionData.localUserSession);
  assert.equal(services.localData.localUserSession, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "nonce"), false);
});

test("用户名大小写不敏感且不能重复注册", async () => {
  const services = await acceptedServices();
  await services.users.register({ username: "Student01", password: "Study1234" });
  await services.users.logout();
  const duplicate = await services.users.register({ username: "student01", password: "Other1234" });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.error, /已存在/);
});

test("退出后可重新登录且错误密码不会建立会话", async () => {
  const services = await acceptedServices();
  await services.users.register({ username: "student01", password: "Study1234" });
  await services.users.logout();
  const failed = await services.users.login({ username: "student01", password: "Wrong1234" });
  assert.equal(failed.ok, false);
  assert.equal(services.sessionData.localUserSession, undefined);
  const success = await services.users.login({ username: "student01", password: "Study1234" });
  assert.equal(success.ok, true);
  assert.equal((await services.users.getSession()).authenticated, true);
});

test("连续登录失败会触发本地账户临时锁定", async () => {
  const services = await acceptedServices();
  await services.users.register({ username: "student01", password: "Study1234" });
  await services.users.logout();
  for (let index = 0; index < 5; index += 1) {
    assert.equal((await services.users.login({ username: "student01", password: "Wrong1234" })).ok, false);
  }
  const locked = await services.users.login({ username: "student01", password: "Study1234" });
  assert.equal(locked.ok, false);
  assert.equal(locked.code, "ACCOUNT_LOCKED");
  assert.ok(locked.retryAfterMs > 0);
});

test("可以更新资料并修改密码", async () => {
  const services = await acceptedServices();
  await services.users.register({ username: "student01", password: "Study1234" });
  const profile = await services.users.updateProfile({ displayName: "新名称" });
  assert.equal(profile.user.displayName, "新名称");
  const changed = await services.users.changePassword({ currentPassword: "Study1234", newPassword: "NewStudy5678" });
  assert.equal(changed.ok, true);
  await services.users.logout();
  assert.equal((await services.users.login({ username: "student01", password: "Study1234" })).ok, false);
  assert.equal((await services.users.login({ username: "student01", password: "NewStudy5678" })).ok, true);
});

test("删除账户需要密码和明确确认", async () => {
  const services = await acceptedServices();
  await services.users.register({ username: "student01", password: "Study1234" });
  const missing = await services.users.deleteAccount({ password: "Study1234", confirm: "delete" });
  assert.equal(missing.ok, false);
  const wrong = await services.users.deleteAccount({ password: "Wrong1234", confirm: "DELETE" });
  assert.equal(wrong.ok, false);
  const removed = await services.users.deleteAccount({ password: "Study1234", confirm: "DELETE" });
  assert.equal(removed.ok, true);
  assert.equal(services.localData.localUserAccounts.length, 0);
  assert.equal((await services.users.getSession()).authenticated, false);
});

test("消息 Schema 限制账户与声明动作只能来自弹窗", () => {
  const context = {
    self: {},
    URL,
    chrome: { runtime: { id: "extension-id", getURL: (file) => `chrome-extension://extension-id/${file}` } }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/message-schema.js"), "utf8"), context);
  const schema = context.self.WinSpeedBallMessageSchema;
  const sender = { id: "extension-id", url: "chrome-extension://extension-id/popup.html" };
  const valid = schema.parse({
    version: 1,
    action: "registerUser",
    source: "popup",
    requestId: "test-register-123456",
    payload: { username: "student01", password: "Study1234", displayName: "学习者" }
  }, sender);
  assert.equal(valid.ok, true);
  const weak = schema.parse({
    version: 1,
    action: "registerUser",
    source: "popup",
    requestId: "test-register-weak-123",
    payload: { username: "student01", password: "12345678" }
  }, sender);
  assert.equal(weak.ok, false);
  const wrongSource = schema.parse({
    version: 1,
    action: "getUserSession",
    source: "content",
    requestId: "test-session-source-123",
    payload: {}
  }, { id: "extension-id", url: "https://example.com", tab: { id: 1 } });
  assert.equal(wrongSource.ok, false);
});
