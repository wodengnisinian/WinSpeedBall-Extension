const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function cloudProvider(overrides) {
  return Object.assign({
    id: "cloud",
    label: "Cloud Account",
    mode: "placeholder",
    login() { return { ok: false, code: "CLOUD_NOT_CONFIGURED", error: "Cloud provider is not configured." }; },
    logout() { return { ok: true }; },
    getUser() { return { ok: true, authenticated: false, user: { plan: "guest" } }; },
    updateProfile() { return { ok: false, code: "CLOUD_NOT_CONFIGURED" }; }
  }, overrides || {});
}

function buildRegistry(localOverrides, persistedData, storageOptions) {
  const calls = [];
  const data = persistedData || {};
  const options = storageOptions || {};
  const local = Object.assign({
    id: "local",
    label: "Local Account",
    mode: "local-only",
    login(request) { calls.push(["login", request]); return { ok: true, authenticated: true, user: { userId: "local-1", plan: "free" } }; },
    logout() { calls.push(["logout"]); return { ok: true, authenticated: false }; },
    getUser() { calls.push(["getUser"]); return { ok: true, authenticated: false, user: { plan: "guest" } }; },
    updateProfile(request) { calls.push(["updateProfile", request]); return { ok: true, user: { displayName: request.displayName } }; },
    register(request) { calls.push(["register", request]); return { ok: true, user: { userId: "local-1" } }; },
    changePassword(request) { calls.push(["changePassword", request]); return { ok: true }; },
    deleteAccount(request) { calls.push(["deleteAccount", request]); return { ok: true }; }
  }, localOverrides || {});
  const storage = {
    get(keys, callback) {
      const result = {};
      keys.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(data, key)) result[key] = clone(data[key]);
      });
      callback(result);
    },
    set(values, callback) {
      if (options.failSet) {
        callback({ ok: false, error: "storage unavailable" });
        return;
      }
      Object.assign(data, clone(values));
      callback({ ok: true });
    }
  };
  const context = {
    self: {
      WinSpeedBallLocalUserProvider: local,
      WinSpeedBallStorageService: storage
    },
    Promise,
    Error
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/user-provider.js"), "utf8"), context);
  return {
    registry: context.self.WinSpeedBallUserProviderRegistry,
    service: context.self.WinSpeedBallUserService,
    calls,
    persistedData: data
  };
}

test("LocalUserProvider 满足核心契约并公开本地账户能力", async () => {
  const fixture = buildRegistry();
  await fixture.registry.ready;
  assert.deepEqual(Array.from(fixture.registry.REQUIRED_METHODS), ["login", "logout", "getUser", "updateProfile"]);
  assert.deepEqual(Array.from(fixture.registry.OPTIONAL_ACCOUNT_METHODS), ["register", "changePassword", "deleteAccount"]);
  assert.equal(fixture.registry.getActive().id, "local");
  assert.deepEqual(clone(fixture.service.getProvider()), {
    id: "local",
    label: "Local Account",
    mode: "local-only",
    capabilities: { register: true, changePassword: true, deleteAccount: true }
  });
  const user = await fixture.service.getUser();
  assert.equal(user.ok, true);
  assert.equal(user.providerId, "local");
});

test("UserService 通过 Provider 转发完整本地账户操作", async () => {
  const fixture = buildRegistry();
  await fixture.service.register({ username: "student" });
  await fixture.service.login({ username: "student" });
  await fixture.service.updateProfile({ displayName: "Student" });
  await fixture.service.changePassword({ currentPassword: "old", newPassword: "new" });
  await fixture.service.deleteAccount({ confirm: "DELETE" });
  await fixture.service.logout();
  assert.deepEqual(fixture.calls, [
    ["register", { username: "student" }],
    ["login", { username: "student" }],
    ["updateProfile", { displayName: "Student" }],
    ["changePassword", { currentPassword: "old", newPassword: "new" }],
    ["deleteAccount", { confirm: "DELETE" }],
    ["logout"]
  ]);
});

test("Provider 注册表拒绝缺少核心方法或错误声明可选能力的实现", () => {
  const fixture = buildRegistry();
  const missingCore = fixture.registry.register({ id: "broken", login() {} });
  assert.equal(missingCore.ok, false);
  assert.match(missingCore.error, /missing methods/);

  const invalidOptional = cloudProvider({ id: "invalid", register: true });
  const result = fixture.registry.register(invalidOptional);
  assert.equal(result.ok, false);
  assert.match(result.error, /invalid optional methods/);
});

test("不具备本地账户扩展能力的 Provider 会明确报告不支持", async () => {
  const fixture = buildRegistry();
  assert.equal(fixture.registry.register(cloudProvider()).ok, true);
  const switched = await fixture.registry.setActive("cloud");
  assert.equal(switched.ok, true);
  assert.deepEqual(clone(fixture.service.getProvider().capabilities), {
    register: false,
    changePassword: false,
    deleteAccount: false
  });
  assert.equal(fixture.registry.supports("register"), false);

  const login = await fixture.service.login({});
  assert.equal(login.code, "CLOUD_NOT_CONFIGURED");
  assert.equal(login.providerId, "cloud");
  const registration = await fixture.service.register({});
  assert.equal(registration.ok, false);
  assert.equal(registration.code, "USER_PROVIDER_UNSUPPORTED");
  assert.equal(registration.providerId, "cloud");
});

test("活动 Provider 持久化并可在 MV3 Worker 重启后恢复", async () => {
  const persistedData = {};
  const firstWorker = buildRegistry(null, persistedData);
  await firstWorker.registry.ready;
  firstWorker.registry.register(cloudProvider());
  const switched = await firstWorker.registry.setActive("cloud");
  assert.equal(switched.ok, true);
  assert.equal(switched.persisted, true);
  assert.equal(persistedData.activeUserProviderId, "cloud");

  const restartedWorker = buildRegistry(null, persistedData);
  await restartedWorker.registry.ready;
  assert.equal(restartedWorker.registry.getActive().id, "local");
  restartedWorker.registry.register(cloudProvider());
  assert.equal(restartedWorker.registry.getActive().id, "cloud");
  const result = await restartedWorker.service.login({});
  assert.equal(result.providerId, "cloud");
});

test("Provider 选择写入失败时不切换内存状态", async () => {
  const fixture = buildRegistry(null, {}, { failSet: true });
  await fixture.registry.ready;
  fixture.registry.register(cloudProvider());
  const result = await fixture.registry.setActive("cloud");
  assert.equal(result.ok, false);
  assert.equal(result.code, "USER_PROVIDER_PERSIST_FAILED");
  assert.equal(fixture.registry.getActive().id, "local");
});

test("Provider 异步异常被归一化为稳定错误响应", async () => {
  const fixture = buildRegistry({
    login() { return Promise.reject(new Error("provider failed")); }
  });
  const result = await fixture.service.login({});
  assert.equal(result.ok, false);
  assert.equal(result.code, "USER_PROVIDER_ERROR");
  assert.equal(result.providerId, "local");
  assert.match(result.error, /provider failed/);
});
