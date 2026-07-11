(function (global) {
  "use strict";

  var storage = global.WinSpeedBallStorageService;
  var declaration = global.WinSpeedBallDeclarationService;
  var ACCOUNTS_KEY = "localUserAccounts";
  var SESSION_KEY = "localUserSession";
  var PBKDF2_ITERATIONS = 210000;
  var SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
  var MAX_ACCOUNTS = 5;
  var MAX_FAILED_ATTEMPTS = 5;
  var LOCK_DURATION_MS = 15 * 60 * 1000;

  function getLocal(keys) {
    return new Promise(function (resolve) { storage.get(keys, resolve); });
  }

  function setLocal(data) {
    return new Promise(function (resolve) { storage.set(data, resolve); });
  }

  function sessionArea() {
    return chrome.storage && chrome.storage.session;
  }

  function getSessionStorage() {
    return new Promise(function (resolve) {
      var area = sessionArea();
      if (!area) { resolve({}); return; }
      try {
        area.get([SESSION_KEY], function (data) {
          resolve(chrome.runtime.lastError ? {} : data || {});
        });
      } catch (error) { resolve({}); }
    });
  }

  function setSessionStorage(session) {
    return new Promise(function (resolve) {
      var area = sessionArea();
      if (!area) { resolve({ ok: false, error: "当前浏览器不支持安全会话存储。" }); return; }
      var data = {};
      data[SESSION_KEY] = session;
      try {
        area.set(data, function () {
          var error = chrome.runtime.lastError && chrome.runtime.lastError.message;
          resolve(error ? { ok: false, error: error } : { ok: true });
        });
      } catch (error) { resolve({ ok: false, error: error.message || String(error) }); }
    });
  }

  function clearSessionStorage() {
    return new Promise(function (resolve) {
      var area = sessionArea();
      if (!area) { resolve({ ok: true }); return; }
      try {
        area.remove([SESSION_KEY], function () {
          var error = chrome.runtime.lastError && chrome.runtime.lastError.message;
          resolve(error ? { ok: false, error: error } : { ok: true });
        });
      } catch (error) { resolve({ ok: false, error: error.message || String(error) }); }
    });
  }

  function bytesToBase64(bytes) {
    var binary = "";
    bytes.forEach(function (value) { binary += String.fromCharCode(value); });
    return btoa(binary);
  }

  function base64ToBytes(value) {
    var binary = atob(String(value || ""));
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function randomBase64(length) {
    var bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytesToBase64(bytes);
  }

  function randomId() {
    try { return "usr_" + crypto.randomUUID().replace(/-/g, ""); }
    catch (error) { return "usr_" + randomBase64(18).replace(/[^A-Za-z0-9]/g, ""); }
  }

  function normalizeUsername(value) {
    return String(value || "").trim().toLocaleLowerCase("zh-CN");
  }

  function validateUsername(value) {
    var username = String(value || "").trim();
    return /^[A-Za-z0-9\u4e00-\u9fff_.-]{3,32}$/.test(username)
      ? { ok: true, value: username }
      : { ok: false, error: "用户名须为 3-32 位中文、字母、数字、下划线、点或短横线。" };
  }

  function validateDisplayName(value) {
    var displayName = String(value || "").trim();
    if (!displayName) return { ok: true, value: "" };
    return displayName.length <= 40 && !/[\u0000-\u001f\u007f]/.test(displayName)
      ? { ok: true, value: displayName }
      : { ok: false, error: "显示名称不能超过 40 个字符。" };
  }

  function validatePassword(value) {
    var password = String(value || "");
    return password.length >= 8 && password.length <= 128 && /[A-Za-z]/.test(password) && /[0-9]/.test(password) && !/[\u0000-\u001f\u007f]/.test(password)
      ? { ok: true, value: password }
      : { ok: false, error: "密码须为 8-128 位，并同时包含字母和数字。" };
  }

  function deriveHash(password, salt, iterations) {
    return crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]).then(function (key) {
      return crypto.subtle.deriveBits({ name: "PBKDF2", salt: salt, iterations: iterations, hash: "SHA-256" }, key, 256);
    }).then(function (buffer) { return new Uint8Array(buffer); });
  }

  function hashPassword(password, saltBase64, iterations) {
    var salt = saltBase64 ? base64ToBytes(saltBase64) : crypto.getRandomValues(new Uint8Array(16));
    return deriveHash(password, salt, iterations || PBKDF2_ITERATIONS).then(function (hash) {
      return { salt: bytesToBase64(salt), passwordHash: bytesToBase64(hash), iterations: iterations || PBKDF2_ITERATIONS };
    });
  }

  function constantTimeEqual(left, right) {
    if (left.length !== right.length) return false;
    var difference = 0;
    for (var index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
    return difference === 0;
  }

  function verifyPassword(password, account) {
    return deriveHash(password, base64ToBytes(account.salt), Number(account.iterations || PBKDF2_ITERATIONS)).then(function (hash) {
      return constantTimeEqual(hash, base64ToBytes(account.passwordHash));
    });
  }

  function getAccounts() {
    return getLocal([ACCOUNTS_KEY]).then(function (data) {
      return Array.isArray(data[ACCOUNTS_KEY]) ? data[ACCOUNTS_KEY] : [];
    });
  }

  function saveAccounts(accounts) {
    var data = {};
    data[ACCOUNTS_KEY] = accounts;
    return setLocal(data);
  }

  function publicUser(account) {
    return {
      userId: account.id,
      username: account.username,
      displayName: account.displayName || account.username,
      plan: account.plan || "free",
      subscriptionLevel: account.plan || "free",
      quota: { dailyOCR: 10, dailyAI: 5, enforced: false },
      createdAt: account.createdAt,
      updatedAt: account.updatedAt
    };
  }

  function guestUser() {
    return {
      userId: "",
      username: "",
      displayName: "游客",
      plan: "guest",
      subscriptionLevel: "guest",
      quota: { dailyOCR: 10, dailyAI: 5, enforced: false }
    };
  }

  function createSession(account) {
    var now = Date.now();
    var session = {
      accountId: account.id,
      issuedAt: now,
      expiresAt: now + SESSION_DURATION_MS,
      nonce: randomBase64(24)
    };
    return setSessionStorage(session).then(function (result) {
      return result && result.ok === false ? result : { ok: true, authenticated: true, user: publicUser(account), expiresAt: session.expiresAt };
    });
  }

  function getSessionAccount() {
    return Promise.all([getSessionStorage(), getAccounts()]).then(function (values) {
      var session = values[0][SESSION_KEY];
      if (!session || !session.accountId || Number(session.expiresAt || 0) <= Date.now()) {
        return clearSessionStorage().then(function () { return null; });
      }
      var account = values[1].find(function (item) { return item && item.id === session.accountId; });
      if (!account) return clearSessionStorage().then(function () { return null; });
      return { account: account, accounts: values[1], session: session };
    });
  }

  function getSession() {
    return getSessionAccount().then(function (record) {
      return record
        ? { ok: true, authenticated: true, user: publicUser(record.account), expiresAt: record.session.expiresAt, storage: "local-only" }
        : { ok: true, authenticated: false, user: guestUser(), storage: "local-only" };
    });
  }

  function register(request) {
    request = request || {};
    var usernameCheck = validateUsername(request.username);
    var passwordCheck = validatePassword(request.password);
    var displayNameCheck = validateDisplayName(request.displayName);
    if (!usernameCheck.ok) return Promise.resolve(usernameCheck);
    if (!passwordCheck.ok) return Promise.resolve(passwordCheck);
    if (!displayNameCheck.ok) return Promise.resolve(displayNameCheck);
    return declaration.get().then(function (policy) {
      if (!policy.accepted) return { ok: false, error: "注册前必须阅读并同意当前使用声明。", code: "DECLARATION_REQUIRED" };
      return getAccounts().then(function (accounts) {
        if (accounts.length >= MAX_ACCOUNTS) return { ok: false, error: "当前浏览器最多可创建 5 个本地账户。" };
        var normalized = normalizeUsername(usernameCheck.value);
        if (accounts.some(function (item) { return item && item.usernameNormalized === normalized; })) return { ok: false, error: "该用户名已存在。" };
        return hashPassword(passwordCheck.value).then(function (credentials) {
          var now = new Date().toISOString();
          var account = {
            id: randomId(),
            username: usernameCheck.value,
            usernameNormalized: normalized,
            displayName: displayNameCheck.value,
            plan: "free",
            passwordHash: credentials.passwordHash,
            salt: credentials.salt,
            iterations: credentials.iterations,
            failedAttempts: 0,
            lockedUntil: 0,
            createdAt: now,
            updatedAt: now
          };
          accounts.push(account);
          return saveAccounts(accounts).then(function (saved) {
            if (saved && saved.ok === false) return saved;
            return declaration.associateUser(account.id).then(function () { return createSession(account); });
          });
        });
      });
    });
  }

  function login(request) {
    request = request || {};
    var usernameCheck = validateUsername(request.username);
    var password = String(request.password || "");
    if (!usernameCheck.ok || !password) return Promise.resolve({ ok: false, error: "用户名或密码错误。" });
    return getAccounts().then(function (accounts) {
      var normalized = normalizeUsername(usernameCheck.value);
      var account = accounts.find(function (item) { return item && item.usernameNormalized === normalized; });
      if (!account) {
        return hashPassword(password, randomBase64(16), PBKDF2_ITERATIONS).then(function () { return { ok: false, error: "用户名或密码错误。" }; });
      }
      if (Number(account.lockedUntil || 0) > Date.now()) {
        return { ok: false, error: "登录尝试过多，请稍后再试。", code: "ACCOUNT_LOCKED", retryAfterMs: account.lockedUntil - Date.now() };
      }
      return verifyPassword(password, account).then(function (matches) {
        if (!matches) {
          account.failedAttempts = Number(account.failedAttempts || 0) + 1;
          if (account.failedAttempts >= MAX_FAILED_ATTEMPTS) {
            account.failedAttempts = 0;
            account.lockedUntil = Date.now() + LOCK_DURATION_MS;
          }
          account.updatedAt = new Date().toISOString();
          return saveAccounts(accounts).then(function () { return { ok: false, error: "用户名或密码错误。" }; });
        }
        account.failedAttempts = 0;
        account.lockedUntil = 0;
        account.updatedAt = new Date().toISOString();
        return saveAccounts(accounts).then(function (saved) {
          return saved && saved.ok === false ? saved : createSession(account);
        });
      });
    });
  }

  function logout() {
    return clearSessionStorage().then(function (result) {
      return result && result.ok === false ? result : { ok: true, authenticated: false, user: guestUser() };
    });
  }

  function updateProfile(request) {
    var displayNameCheck = validateDisplayName(request && request.displayName);
    if (!displayNameCheck.ok || !displayNameCheck.value) return Promise.resolve(displayNameCheck.ok ? { ok: false, error: "显示名称不能为空。" } : displayNameCheck);
    return getSessionAccount().then(function (record) {
      if (!record) return { ok: false, error: "请先登录。", code: "AUTH_REQUIRED" };
      record.account.displayName = displayNameCheck.value;
      record.account.updatedAt = new Date().toISOString();
      return saveAccounts(record.accounts).then(function (saved) {
        return saved && saved.ok === false ? saved : { ok: true, authenticated: true, user: publicUser(record.account) };
      });
    });
  }

  function changePassword(request) {
    var nextCheck = validatePassword(request && request.newPassword);
    if (!nextCheck.ok) return Promise.resolve(nextCheck);
    return getSessionAccount().then(function (record) {
      if (!record) return { ok: false, error: "请先登录。", code: "AUTH_REQUIRED" };
      return verifyPassword(String(request.currentPassword || ""), record.account).then(function (matches) {
        if (!matches) return { ok: false, error: "当前密码错误。" };
        return hashPassword(nextCheck.value).then(function (credentials) {
          record.account.passwordHash = credentials.passwordHash;
          record.account.salt = credentials.salt;
          record.account.iterations = credentials.iterations;
          record.account.updatedAt = new Date().toISOString();
          return saveAccounts(record.accounts).then(function (saved) {
            return saved && saved.ok === false ? saved : createSession(record.account);
          });
        });
      });
    });
  }

  function deleteAccount(request) {
    if (!request || request.confirm !== "DELETE") return Promise.resolve({ ok: false, error: "请输入 DELETE 确认删除账户。" });
    return getSessionAccount().then(function (record) {
      if (!record) return { ok: false, error: "请先登录。", code: "AUTH_REQUIRED" };
      return verifyPassword(String(request.password || ""), record.account).then(function (matches) {
        if (!matches) return { ok: false, error: "密码错误，未删除账户。" };
        var accounts = record.accounts.filter(function (item) { return item && item.id !== record.account.id; });
        return saveAccounts(accounts).then(function (saved) {
          if (saved && saved.ok === false) return saved;
          return clearSessionStorage().then(function () { return { ok: true, deleted: true, authenticated: false, user: guestUser() }; });
        });
      });
    });
  }

  try {
    var area = sessionArea();
    if (area && typeof area.setAccessLevel === "function") area.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(function () {});
  } catch (error) {}

  var localUserProvider = {
    id: "local",
    label: "Local Account",
    mode: "local-only",
    getUser: getSession,
    getSession: getSession,
    register: register,
    login: login,
    logout: logout,
    updateProfile: updateProfile,
    changePassword: changePassword,
    deleteAccount: deleteAccount,
    validateUsername: validateUsername,
    validatePassword: validatePassword
  };

  global.WinSpeedBallLocalUserProvider = localUserProvider;
  global.WinSpeedBallUserService = localUserProvider;
})(self);
