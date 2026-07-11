const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHash, webcrypto } = require("node:crypto");
const { TextEncoder } = require("node:util");

const root = path.resolve(__dirname, "..");

function buildService(sharedState = {}) {
  const localData = sharedState.localData || (sharedState.localData = {});
  const sessionData = sharedState.sessionData || (sharedState.sessionData = {});
  const clock = sharedState.clock || (sharedState.clock = { now: 1700000000000 });
  const self = {
    crypto: webcrypto,
    TextEncoder,
    URL,
    WinSpeedBallStorageService: {
      get(keys, callback) {
        const result = {};
        for (const key of keys) {
          if (Object.prototype.hasOwnProperty.call(localData, key)) result[key] = localData[key];
        }
        callback(result);
      },
      set(data, callback) {
        Object.assign(localData, data);
        callback({ ok: true });
      }
    },
    chrome: {
      runtime: { lastError: null },
      storage: {
        session: {
          get(keys, callback) {
            const result = {};
            for (const key of keys) {
              if (Object.prototype.hasOwnProperty.call(sessionData, key)) result[key] = sessionData[key];
            }
            callback(result);
          },
          set(data, callback) {
            Object.assign(sessionData, data);
            callback();
          },
          remove(keys, callback) {
            for (const key of keys) delete sessionData[key];
            callback();
          }
        }
      }
    }
  };
  const context = {
    self,
    Promise,
    Object,
    Array,
    String,
    Number,
    JSON,
    Uint8Array,
    Date: { now: () => clock.now }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "sdk/contracts.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/permission-service.js"), "utf8"), context);
  return {
    service: self.WinSpeedBallPermissionService,
    localData,
    sessionData,
    sharedState,
    advance(milliseconds) { clock.now += milliseconds; }
  };
}

function binding(overrides = {}) {
  return Object.assign({
    scriptId: "study-helper",
    code: "await WSB.video.current();",
    capabilities: ["video.read", "page.read"],
    originScope: ["https://example.com/*", "https://study.example.org/*"],
    sdkVersion: "0.1.0-beta"
  }, overrides);
}

test("code hash uses deterministic SHA-256", async () => {
  const { service } = buildService();
  const code = "await WSB.page.title();";
  const expected = createHash("sha256").update(code, "utf8").digest("hex");
  assert.equal(await service.hashCode(code), expected);
  await assert.rejects(service.hashCode(""), (error) => error.code === "SDK_CODE_INVALID");
});

test("grant fingerprint binds normalized capabilities and origin scope", async () => {
  const { service } = buildService();
  const first = await service.createGrantFingerprint(binding({
    capabilities: ["video.read", "page.read", "video.read"],
    originScope: ["https://study.example.org/*", "https://example.com/*"]
  }));
  const reordered = await service.createGrantFingerprint(binding({
    capabilities: ["page.read", "video.read"],
    originScope: ["https://example.com/*", "https://study.example.org/*"]
  }));
  const changedCode = await service.createGrantFingerprint(binding({ code: "await WSB.page.url();" }));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, reordered);
  assert.notEqual(first, changedCode);
});

test("grant persists only the bound record and check requires an exact match", async () => {
  const { service, localData } = buildService();
  const granted = await service.grant(binding({
    capabilities: ["video.read", "page.read", "video.read"],
    originScope: ["https://study.example.org/*", "https://example.com/*"]
  }));
  assert.equal(granted.ok, true);
  assert.equal(granted.allowed, true);
  assert.deepEqual(Array.from(granted.grant.capabilities), ["page.read", "video.read"]);
  assert.deepEqual(Array.from(granted.grant.originScope), ["https://example.com/*", "https://study.example.org/*"]);
  assert.match(granted.grant.codeHash, /^[a-f0-9]{64}$/);
  assert.match(granted.grant.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(Object.prototype.hasOwnProperty.call(localData.sdkPermissionGrants["study-helper"], "code"), false);

  const exact = await service.check(binding());
  assert.equal(exact.ok, true);
  assert.equal(exact.allowed, true);

  const changedCode = await service.check(binding({ code: "await WSB.video.pause();" }));
  assert.equal(changedCode.ok, false);
  assert.equal(changedCode.allowed, false);
  assert.equal(changedCode.code, "SDK_GRANT_MISMATCH");

  const changedScope = await service.check(binding({ originScope: ["https://example.com/*"] }));
  assert.equal(changedScope.code, "SDK_GRANT_MISMATCH");
});

test("strict validation rejects unknown capabilities, reserved identities, and stale SDK versions", async () => {
  const { service, localData } = buildService();
  const unknown = await service.grant(binding({ capabilities: ["video.read", "internal.service"] }));
  assert.equal(unknown.code, "SDK_CAPABILITY_UNKNOWN");
  for (const scriptId of ["__proto__", "prototype", "constructor"]) {
    const reserved = await service.grant(binding({ scriptId }));
    assert.equal(reserved.code, "SDK_SCRIPT_ID_INVALID");
  }
  const stale = await service.grant(binding({ sdkVersion: "0.0.1" }));
  assert.equal(stale.code, "SDK_VERSION_MISMATCH");
  const invalidOrigin = await service.grant(binding({ originScope: ["javascript://example.com/*"] }));
  assert.equal(invalidOrigin.code, "SDK_ORIGIN_SCOPE_INVALID");
  assert.equal(localData.sdkPermissionGrants, undefined);
});

test("grant store safely supports non-reserved Object property names", async () => {
  const { service, localData } = buildService();
  const granted = await service.grant(binding({ scriptId: "toString" }));
  assert.equal(granted.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(localData.sdkPermissionGrants, "toString"), true);
  const checked = await service.check(binding({ scriptId: "toString" }));
  assert.equal(checked.allowed, true);
});

test("list returns verified grants and excludes tampered records", async () => {
  const { service, localData } = buildService();
  await service.grant(binding());
  await service.grant(binding({
    scriptId: "ocr-helper",
    code: "await WSB.ocr.latest();",
    capabilities: ["ocr.read"],
    originScope: ["https://example.com/*"]
  }));
  localData.sdkPermissionGrants["ocr-helper"].capabilities = ["ai.request"];
  const result = await service.list();
  assert.equal(result.ok, true);
  assert.equal(result.invalidCount, 1);
  assert.deepEqual(result.grants.map((grant) => grant.scriptId), ["study-helper"]);
});

test("revoke removes a persistent grant", async () => {
  const { service, localData } = buildService();
  await service.grant(binding());
  const revoked = await service.revoke("study-helper");
  assert.equal(revoked.ok, true);
  assert.equal(revoked.revoked, true);
  assert.equal(Object.prototype.hasOwnProperty.call(localData.sdkPermissionGrants, "study-helper"), false);
  const denied = await service.check(binding());
  assert.equal(denied.code, "SDK_GRANT_REQUIRED");
});

test("runtime token is short-lived, capability-scoped, origin-scoped, and session-only", async () => {
  const { service, localData, sessionData } = buildService();
  await service.grant(binding());
  const created = await service.createRuntimeToken(binding(), 5000);
  assert.equal(created.ok, true);
  assert.match(created.token, /^wsb_rt_[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(localData).includes(created.token), false);
  assert.deepEqual(Object.keys(localData), ["sdkPermissionGrants"]);
  assert.equal(Object.prototype.hasOwnProperty.call(sessionData.sdkRuntimeTokens, created.token), true);

  const valid = await service.validateRuntimeToken(created.token, {
    scriptId: "study-helper",
    sdkVersion: "0.1.0-beta",
    capability: "video.read",
    origin: "https://example.com/course/1"
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.valid, true);

  const deniedCapability = await service.validateRuntimeToken(created.token, {
    scriptId: "study-helper",
    sdkVersion: "0.1.0-beta",
    capability: "video.control",
    origin: "https://example.com/course/1"
  });
  assert.equal(deniedCapability.code, "SDK_CAPABILITY_REQUIRED");

  const deniedOrigin = await service.validateRuntimeToken(created.token, {
    scriptId: "study-helper",
    sdkVersion: "0.1.0-beta",
    capability: "video.read",
    origin: "https://attacker.example/course/1"
  });
  assert.equal(deniedOrigin.code, "SDK_ORIGIN_NOT_ALLOWED");

  const wrongScript = await service.validateRuntimeToken(created.token, {
    scriptId: "other-script",
    sdkVersion: "0.1.0-beta",
    capability: "video.read",
    origin: "https://example.com/course/1"
  });
  assert.equal(wrongScript.code, "SDK_TOKEN_CONTEXT_MISMATCH");

  const revoked = await service.revokeRuntimeToken(created.token);
  assert.equal(revoked.revoked, true);
  assert.equal(sessionData.sdkRuntimeTokens, undefined);
  const afterRevoke = await service.validateRuntimeToken(created.token, {
    scriptId: "study-helper",
    sdkVersion: "0.1.0-beta",
    capability: "video.read",
    origin: "https://example.com/"
  });
  assert.equal(afterRevoke.code, "SDK_TOKEN_INVALID");
});

test("runtime token expires and rejects excessive lifetime", async () => {
  const fixture = buildService();
  await fixture.service.grant(binding());
  const tooLong = await fixture.service.createRuntimeToken(binding(), fixture.service.MAX_TOKEN_TTL_MS + 1);
  assert.equal(tooLong.code, "SDK_TOKEN_TTL_INVALID");
  const created = await fixture.service.createRuntimeToken(binding(), 1000);
  fixture.advance(1001);
  const expired = await fixture.service.validateRuntimeToken(created.token, {
    scriptId: "study-helper",
    sdkVersion: "0.1.0-beta",
    capability: "video.read",
    origin: "https://example.com/"
  });
  assert.equal(expired.code, "SDK_TOKEN_EXPIRED");
  assert.equal(fixture.sessionData.sdkRuntimeTokens, undefined);
});

test("runtime token survives service worker reconstruction in the same browser session", async () => {
  const sharedState = {};
  const firstWorker = buildService(sharedState);
  await firstWorker.service.grant(binding());
  const created = await firstWorker.service.createRuntimeToken(binding());
  assert.equal(created.ok, true);

  const restartedWorker = buildService(sharedState);
  const valid = await restartedWorker.service.validateRuntimeToken(created.token, {
    scriptId: "study-helper",
    sdkVersion: "0.1.0-beta",
    capability: "page.read",
    origin: "https://study.example.org/lesson/1"
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.valid, true);
});

test("grant changes, grant revocation, and external deletion invalidate runtime tokens", async () => {
  const { service, localData } = buildService();
  await service.grant(binding());
  const first = await service.createRuntimeToken(binding());
  await service.grant(binding());
  const invalidatedByGrant = await service.validateRuntimeToken(first.token, {
    scriptId: "study-helper",
    sdkVersion: "0.1.0-beta",
    capability: "video.read",
    origin: "https://example.com/"
  });
  assert.equal(invalidatedByGrant.code, "SDK_TOKEN_INVALID");

  const second = await service.createRuntimeToken(binding());
  delete localData.sdkPermissionGrants["study-helper"];
  const invalidatedByStorage = await service.validateRuntimeToken(second.token, {
    scriptId: "study-helper",
    sdkVersion: "0.1.0-beta",
    capability: "video.read",
    origin: "https://example.com/"
  });
  assert.equal(invalidatedByStorage.code, "SDK_GRANT_REVOKED");
});

test("可以统一撤销当前浏览器会话内的全部 SDK 运行令牌", async () => {
  const fixture = buildService();
  await fixture.service.grant(binding());
  const first = await fixture.service.createRuntimeToken(binding());
  const second = await fixture.service.createRuntimeToken(binding());
  assert.notEqual(first.token, second.token);
  assert.equal(Object.keys(fixture.sessionData.sdkRuntimeTokens).length, 2);
  const result = await fixture.service.revokeAllRuntimeTokens();
  assert.equal(result.ok, true);
  assert.equal(result.revoked, 2);
  assert.equal(fixture.sessionData.sdkRuntimeTokens, undefined);
});

test("篡改 Session Storage 中的 Token 绑定后会永久失效", async () => {
  const fixture = buildService();
  await fixture.service.grant(binding());
  const created = await fixture.service.createRuntimeToken(binding());
  fixture.sessionData.sdkRuntimeTokens[created.token].capabilities.push("video.control");
  const result = await fixture.service.validateRuntimeToken(created.token, {
    scriptId: "study-helper",
    sdkVersion: "0.1.0-beta",
    capability: "video.control",
    origin: "https://example.com/"
  });
  assert.equal(result.code, "SDK_TOKEN_INVALID");
  assert.equal(fixture.sessionData.sdkRuntimeTokens, undefined);
});
