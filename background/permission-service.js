(function (global) {
  "use strict";

  var GRANTS_KEY = "sdkPermissionGrants";
  var TOKENS_KEY = "sdkRuntimeTokens";
  var DEFAULT_TOKEN_TTL_MS = 5 * 60 * 1000;
  var MAX_TOKEN_TTL_MS = 10 * 60 * 1000;
  var MAX_CODE_LENGTH = 200000;
  var contracts = global.WinSpeedBallSdkContracts;
  var storage = global.WinSpeedBallStorageService;
  var mutationQueue = Promise.resolve();
  var tokenMutationQueue = Promise.resolve();
  var RESERVED_SCRIPT_IDS = Object.freeze(["__proto__", "prototype", "constructor"]);

  function failure(code, error, extra) {
    var result = { ok: false, code: code, error: error };
    Object.keys(extra || {}).forEach(function (key) { result[key] = extra[key]; });
    return result;
  }

  function success(extra) {
    var result = { ok: true };
    Object.keys(extra || {}).forEach(function (key) { result[key] = extra[key]; });
    return result;
  }

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function validScriptId(value) {
    return typeof value === "string" && value.length >= 1 && value.length <= 64 && /^[A-Za-z0-9_-]+$/.test(value) &&
      RESERVED_SCRIPT_IDS.indexOf(value) < 0;
  }

  function safeRecordMap(value, keyValidator) {
    var result = Object.create(null);
    if (!isObject(value)) return result;
    Object.keys(value).forEach(function (key) {
      if (keyValidator(key)) result[key] = value[key];
    });
    return result;
  }

  function serializableRecordMap(value) {
    var result = {};
    Object.keys(value || {}).forEach(function (key) {
      Object.defineProperty(result, key, {
        value: value[key],
        enumerable: true,
        configurable: true,
        writable: true
      });
    });
    return result;
  }

  function bytesToHex(bytes) {
    return Array.prototype.map.call(bytes, function (value) {
      return value.toString(16).padStart(2, "0");
    }).join("");
  }

  function digestText(value) {
    if (!global.crypto || !global.crypto.subtle || typeof global.TextEncoder !== "function") {
      return Promise.reject(failure("SDK_CRYPTO_UNAVAILABLE", "Secure hashing is unavailable."));
    }
    var data = new global.TextEncoder().encode(value);
    return global.crypto.subtle.digest("SHA-256", data).then(function (digest) {
      return bytesToHex(new Uint8Array(digest));
    });
  }

  function hashCode(code) {
    if (typeof code !== "string" || code.length < 1 || code.length > MAX_CODE_LENGTH) {
      return Promise.reject(failure("SDK_CODE_INVALID", "Script code is empty or exceeds the size limit."));
    }
    return digestText(code);
  }

  function validCodeHash(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  }

  function normalizeCapabilities(values) {
    if (!Array.isArray(values) || !values.length) {
      return failure("SDK_CAPABILITY_REQUIRED", "At least one SDK capability is required.");
    }
    var normalized = [];
    for (var index = 0; index < values.length; index += 1) {
      if (typeof values[index] !== "string") {
        return failure("SDK_CAPABILITY_UNKNOWN", "SDK capabilities must be strings.");
      }
      var capability = values[index].trim().toLowerCase();
      if (!contracts || typeof contracts.validCapability !== "function" || !contracts.validCapability(capability)) {
        return failure("SDK_CAPABILITY_UNKNOWN", "The script declares an unsupported SDK capability.", { capability: capability });
      }
      normalized.push(capability);
    }
    normalized = contracts.normalizeCapabilities(normalized).slice().sort();
    return success({ capabilities: normalized });
  }

  function validOriginPattern(value) {
    if (value === "<all_urls>") return true;
    if (typeof value !== "string" || value.length < 1 || value.length > 2048 || /\s/.test(value)) return false;
    return /^(?:\*|https?):\/\/(?:\*|\*\.[A-Za-z0-9.-]+|[A-Za-z0-9.-]+)\/.*$/.test(value);
  }

  function normalizeOriginScope(values) {
    if (!Array.isArray(values) || !values.length || values.length > 128) {
      return failure("SDK_ORIGIN_SCOPE_INVALID", "At least one valid origin scope is required.");
    }
    var normalized = [];
    for (var index = 0; index < values.length; index += 1) {
      if (typeof values[index] !== "string") {
        return failure("SDK_ORIGIN_SCOPE_INVALID", "Origin scopes must be strings.");
      }
      var pattern = values[index].trim();
      if (pattern !== "<all_urls>") {
        var pathIndex = pattern.indexOf("/", pattern.indexOf("://") + 3);
        if (pathIndex > 0) pattern = pattern.slice(0, pathIndex).toLowerCase() + pattern.slice(pathIndex);
      }
      if (!validOriginPattern(pattern)) {
        return failure("SDK_ORIGIN_SCOPE_INVALID", "The script declares an invalid origin scope.", { originScope: pattern });
      }
      if (normalized.indexOf(pattern) < 0) normalized.push(pattern);
    }
    normalized.sort();
    return success({ originScope: normalized });
  }

  function normalizeBinding(input) {
    if (!isObject(input)) return failure("SDK_GRANT_INVALID", "SDK grant data must be an object.");
    if (!validScriptId(input.scriptId)) return failure("SDK_SCRIPT_ID_INVALID", "The SDK script identifier is invalid.");
    var capabilities = normalizeCapabilities(input.capabilities);
    if (!capabilities.ok) return capabilities;
    var origins = normalizeOriginScope(input.originScope);
    if (!origins.ok) return origins;
    var sdkVersion = input.sdkVersion == null ? contracts && contracts.SDK_VERSION : input.sdkVersion;
    if (typeof sdkVersion !== "string" || !contracts || sdkVersion !== contracts.SDK_VERSION) {
      return failure("SDK_VERSION_MISMATCH", "The SDK version is not supported.");
    }
    var codeHash = typeof input.codeHash === "string" ? input.codeHash.trim().toLowerCase() : "";
    if (codeHash && !validCodeHash(codeHash)) return failure("SDK_CODE_HASH_INVALID", "The script code hash is invalid.");
    if (!codeHash && typeof input.code !== "string") return failure("SDK_CODE_REQUIRED", "Script code or a code hash is required.");
    return success({
      binding: {
        scriptId: input.scriptId,
        codeHash: codeHash,
        capabilities: capabilities.capabilities,
        originScope: origins.originScope,
        sdkVersion: sdkVersion
      },
      code: typeof input.code === "string" ? input.code : null
    });
  }

  function resolveBinding(input) {
    var normalized = normalizeBinding(input);
    if (!normalized.ok) return Promise.reject(normalized);
    if (normalized.code == null) return Promise.resolve(normalized.binding);
    return hashCode(normalized.code).then(function (calculatedHash) {
      if (normalized.binding.codeHash && normalized.binding.codeHash !== calculatedHash) {
        throw failure("SDK_CODE_HASH_MISMATCH", "The supplied code hash does not match the script code.");
      }
      normalized.binding.codeHash = calculatedHash;
      return normalized.binding;
    });
  }

  function canonicalBinding(binding) {
    return JSON.stringify({
      scriptId: binding.scriptId,
      codeHash: binding.codeHash,
      capabilities: binding.capabilities,
      originScope: binding.originScope,
      sdkVersion: binding.sdkVersion
    });
  }

  function fingerprintBinding(binding) {
    return digestText(canonicalBinding(binding));
  }

  function createGrantFingerprint(input) {
    return resolveBinding(input).then(fingerprintBinding);
  }

  function readGrantStore() {
    return new Promise(function (resolve) {
      storage.get([GRANTS_KEY], function (data) {
        resolve(safeRecordMap(data && data[GRANTS_KEY], validScriptId));
      });
    });
  }

  function writeGrantStore(grants) {
    return new Promise(function (resolve, reject) {
      var data = {};
      data[GRANTS_KEY] = serializableRecordMap(grants);
      storage.set(data, function (result) {
        if (result && result.ok === false) {
          reject(failure("SDK_GRANT_STORAGE_FAILED", result.error || "Could not save SDK permissions."));
          return;
        }
        resolve();
      });
    });
  }

  function validRuntimeTokenId(value) {
    return typeof value === "string" && /^wsb_rt_[a-f0-9]{64}$/.test(value);
  }

  function sessionStorageArea() {
    return global.chrome && global.chrome.storage && global.chrome.storage.session || null;
  }

  function sessionStorageError() {
    return global.chrome && global.chrome.runtime && global.chrome.runtime.lastError && global.chrome.runtime.lastError.message || "";
  }

  function readTokenStore() {
    return new Promise(function (resolve, reject) {
      var area = sessionStorageArea();
      if (!area || typeof area.get !== "function") {
        reject(failure("SDK_SESSION_STORAGE_UNAVAILABLE", "Session storage is unavailable."));
        return;
      }
      try {
        area.get([TOKENS_KEY], function (data) {
          var error = sessionStorageError();
          if (error) {
            reject(failure("SDK_SESSION_STORAGE_FAILED", error));
            return;
          }
          resolve(safeRecordMap(data && data[TOKENS_KEY], validRuntimeTokenId));
        });
      } catch (error) {
        reject(failure("SDK_SESSION_STORAGE_FAILED", error.message || String(error)));
      }
    });
  }

  function writeTokenStore(tokens) {
    return new Promise(function (resolve, reject) {
      var area = sessionStorageArea();
      if (!area || typeof area.set !== "function" || typeof area.remove !== "function") {
        reject(failure("SDK_SESSION_STORAGE_UNAVAILABLE", "Session storage is unavailable."));
        return;
      }
      var callback = function () {
        var error = sessionStorageError();
        if (error) {
          reject(failure("SDK_SESSION_STORAGE_FAILED", error));
          return;
        }
        resolve();
      };
      try {
        if (!Object.keys(tokens).length) {
          area.remove([TOKENS_KEY], callback);
          return;
        }
        var data = {};
        data[TOKENS_KEY] = serializableRecordMap(tokens);
        area.set(data, callback);
      } catch (error) {
        reject(failure("SDK_SESSION_STORAGE_FAILED", error.message || String(error)));
      }
    });
  }

  function enqueueMutation(task) {
    var next = mutationQueue.then(task, task);
    mutationQueue = next.then(function () {}, function () {});
    return next;
  }

  function enqueueTokenMutation(task) {
    var next = tokenMutationQueue.then(task, task);
    tokenMutationQueue = next.then(function () {}, function () {});
    return next;
  }

  function cloneGrant(grant) {
    return {
      scriptId: grant.scriptId,
      codeHash: grant.codeHash,
      capabilities: grant.capabilities.slice(),
      originScope: grant.originScope.slice(),
      sdkVersion: grant.sdkVersion,
      fingerprint: grant.fingerprint,
      grantedAt: grant.grantedAt,
      updatedAt: grant.updatedAt
    };
  }

  function constantTimeEqual(left, right) {
    left = String(left || "");
    right = String(right || "");
    var mismatch = left.length ^ right.length;
    var length = Math.max(left.length, right.length);
    for (var index = 0; index < length; index += 1) {
      mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
    }
    return mismatch === 0;
  }

  function validateStoredGrant(record) {
    if (!isObject(record) || !validCodeHash(record.fingerprint) || !Number.isFinite(record.grantedAt) || !Number.isFinite(record.updatedAt)) {
      return Promise.resolve(failure("SDK_GRANT_INVALID", "The stored SDK grant is invalid."));
    }
    return resolveBinding(record).then(function (binding) {
      return fingerprintBinding(binding).then(function (fingerprint) {
        if (!constantTimeEqual(fingerprint, record.fingerprint)) {
          return failure("SDK_GRANT_INVALID", "The stored SDK grant fingerprint is invalid.");
        }
        return success({ grant: cloneGrant({
          scriptId: binding.scriptId,
          codeHash: binding.codeHash,
          capabilities: binding.capabilities,
          originScope: binding.originScope,
          sdkVersion: binding.sdkVersion,
          fingerprint: fingerprint,
          grantedAt: record.grantedAt,
          updatedAt: record.updatedAt
        }) });
      });
    }).catch(function () {
      return failure("SDK_GRANT_INVALID", "The stored SDK grant is invalid.");
    });
  }

  function revokeScriptTokens(scriptId) {
    if (!validScriptId(scriptId)) return Promise.resolve(failure("SDK_SCRIPT_ID_INVALID", "The SDK script identifier is invalid."));
    return enqueueTokenMutation(function () {
      return readTokenStore().then(function (tokens) {
        var changed = purgeExpiredTokens(tokens, Date.now());
        var revoked = 0;
        Object.keys(tokens).forEach(function (token) {
          if (isObject(tokens[token]) && tokens[token].scriptId === scriptId) {
            delete tokens[token];
            revoked += 1;
          }
        });
        if (!changed && !revoked) return success({ revoked: 0 });
        return writeTokenStore(tokens).then(function () { return success({ revoked: revoked }); });
      });
    }).catch(function (error) {
      return error && error.ok === false ? error : failure("SDK_TOKEN_REVOKE_FAILED", error && error.message || String(error));
    });
  }

  function revokeAllRuntimeTokens() {
    return enqueueTokenMutation(function () {
      return readTokenStore().then(function (tokens) {
        var revoked = Object.keys(tokens).length;
        if (!revoked) return success({ revoked: 0 });
        return writeTokenStore(Object.create(null)).then(function () { return success({ revoked: revoked }); });
      });
    }).catch(function (error) {
      return error && error.ok === false ? error : failure("SDK_TOKEN_REVOKE_FAILED", error && error.message || String(error));
    });
  }

  function grant(input) {
    return resolveBinding(input).then(function (binding) {
      return fingerprintBinding(binding).then(function (fingerprint) {
        return enqueueMutation(function () {
          return readGrantStore().then(function (grants) {
            var previous = grants[binding.scriptId];
            var now = Date.now();
            var record = {
              scriptId: binding.scriptId,
              codeHash: binding.codeHash,
              capabilities: binding.capabilities.slice(),
              originScope: binding.originScope.slice(),
              sdkVersion: binding.sdkVersion,
              fingerprint: fingerprint,
              grantedAt: previous && previous.fingerprint === fingerprint && Number.isFinite(previous.grantedAt) ? previous.grantedAt : now,
              updatedAt: now
            };
            grants[binding.scriptId] = record;
            return writeGrantStore(grants).then(function () {
              return revokeScriptTokens(binding.scriptId);
            }).then(function (tokenResult) {
              if (!tokenResult.ok) return tokenResult;
              return success({ allowed: true, grant: cloneGrant(record) });
            });
          });
        });
      });
    }).catch(function (error) {
      return error && error.ok === false ? error : failure("SDK_GRANT_FAILED", error && error.message || String(error));
    });
  }

  function check(input) {
    return resolveBinding(input).then(function (binding) {
      return Promise.all([readGrantStore(), fingerprintBinding(binding)]).then(function (values) {
        var record = values[0][binding.scriptId];
        var expectedFingerprint = values[1];
        if (!record) return failure("SDK_GRANT_REQUIRED", "The script has not been granted SDK access.", { allowed: false });
        return validateStoredGrant(record).then(function (validated) {
          if (!validated.ok) return Object.assign(validated, { allowed: false });
          if (!constantTimeEqual(validated.grant.fingerprint, expectedFingerprint)) {
            return failure("SDK_GRANT_MISMATCH", "The stored grant does not match the script, capabilities, origin scope, or SDK version.", { allowed: false });
          }
          return success({ allowed: true, grant: validated.grant });
        });
      });
    }).catch(function (error) {
      var result = error && error.ok === false ? error : failure("SDK_GRANT_CHECK_FAILED", error && error.message || String(error));
      result.allowed = false;
      return result;
    });
  }

  function list() {
    return readGrantStore().then(function (grants) {
      var ids = Object.keys(grants).sort();
      return Promise.all(ids.map(function (scriptId) { return validateStoredGrant(grants[scriptId]); })).then(function (results) {
        var valid = results.filter(function (result) { return result.ok; }).map(function (result) { return result.grant; });
        return success({ grants: valid, invalidCount: results.length - valid.length });
      });
    }).catch(function (error) {
      return failure("SDK_GRANT_LIST_FAILED", error && error.message || String(error));
    });
  }

  function revoke(scriptId) {
    if (!validScriptId(scriptId)) return Promise.resolve(failure("SDK_SCRIPT_ID_INVALID", "The SDK script identifier is invalid."));
    return enqueueMutation(function () {
      return readGrantStore().then(function (grants) {
        var revoked = Object.prototype.hasOwnProperty.call(grants, scriptId);
        if (!revoked) {
          return revokeScriptTokens(scriptId).then(function (tokenResult) {
            if (!tokenResult.ok) return tokenResult;
            return success({ revoked: false, scriptId: scriptId });
          });
        }
        delete grants[scriptId];
        return writeGrantStore(grants).then(function () {
          return revokeScriptTokens(scriptId);
        }).then(function (tokenResult) {
          if (!tokenResult.ok) return tokenResult;
          return success({ revoked: true, scriptId: scriptId });
        });
      });
    }).catch(function (error) {
      return error && error.ok === false ? error : failure("SDK_GRANT_REVOKE_FAILED", error && error.message || String(error));
    });
  }

  function purgeExpiredTokens(tokens, now) {
    var removed = 0;
    Object.keys(tokens).forEach(function (token) {
      var record = tokens[token];
      if (!isObject(record) || !Number.isFinite(record.expiresAt) || record.expiresAt <= now) {
        delete tokens[token];
        removed += 1;
      }
    });
    return removed;
  }

  function randomToken(tokens) {
    if (!global.crypto || typeof global.crypto.getRandomValues !== "function") {
      throw failure("SDK_CRYPTO_UNAVAILABLE", "Secure random token generation is unavailable.");
    }
    var token;
    do {
      var bytes = new Uint8Array(32);
      global.crypto.getRandomValues(bytes);
      token = "wsb_rt_" + bytesToHex(bytes);
    } while (tokens[token]);
    return token;
  }

  function createRuntimeToken(input, ttlMs) {
    var lifetime = ttlMs == null ? DEFAULT_TOKEN_TTL_MS : Number(ttlMs);
    if (!Number.isInteger(lifetime) || lifetime < 1 || lifetime > MAX_TOKEN_TTL_MS) {
      return Promise.resolve(failure("SDK_TOKEN_TTL_INVALID", "The runtime token lifetime is invalid."));
    }
    return check(input).then(function (permission) {
      if (!permission.ok || permission.allowed !== true) return permission;
      return enqueueTokenMutation(function () {
        return readTokenStore().then(function (tokens) {
          purgeExpiredTokens(tokens, Date.now());
          var token;
          try { token = randomToken(tokens); }
          catch (error) { return error && error.ok === false ? error : failure("SDK_TOKEN_CREATE_FAILED", error && error.message || String(error)); }
          var issuedAt = Date.now();
          var grantRecord = permission.grant;
          tokens[token] = {
            scriptId: grantRecord.scriptId,
            codeHash: grantRecord.codeHash,
            capabilities: grantRecord.capabilities.slice(),
            originScope: grantRecord.originScope.slice(),
            sdkVersion: grantRecord.sdkVersion,
            fingerprint: grantRecord.fingerprint,
            issuedAt: issuedAt,
            expiresAt: issuedAt + lifetime
          };
          return writeTokenStore(tokens).then(function () {
            return success({
              token: token,
              scriptId: grantRecord.scriptId,
              grantFingerprint: grantRecord.fingerprint,
              issuedAt: issuedAt,
              expiresAt: issuedAt + lifetime
            });
          });
        });
      });
    }).catch(function (error) {
      return error && error.ok === false ? error : failure("SDK_TOKEN_CREATE_FAILED", error && error.message || String(error));
    });
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function originAllowed(origin, scopes) {
    var parsed;
    try { parsed = new global.URL(String(origin || "")); }
    catch (error) { return false; }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return scopes.some(function (scope) {
      if (scope === "<all_urls>") return true;
      var match = scope.match(/^(\*|https?):\/\/([^/]+)(\/.*)$/);
      if (!match) return false;
      if (match[1] !== "*" && match[1] + ":" !== parsed.protocol) return false;
      var host = match[2];
      var hostname = parsed.hostname.toLowerCase();
      if (host !== "*" && host.indexOf("*.") === 0) {
        var suffix = host.slice(2);
        if (hostname !== suffix && !hostname.endsWith("." + suffix)) return false;
      } else if (host !== "*" && hostname !== host) {
        return false;
      }
      var pathPattern = match[3].split("#")[0].split("?")[0];
      var pathRegex = "^" + pathPattern.split("*").map(escapeRegExp).join(".*") + "$";
      return new RegExp(pathRegex).test(parsed.pathname);
    });
  }

  function validateRuntimeContext(record, context) {
    if (!isObject(context) || !validScriptId(context.scriptId) || context.scriptId !== record.scriptId) {
      return failure("SDK_TOKEN_CONTEXT_MISMATCH", "The runtime token does not belong to this script.", { valid: false });
    }
    if (context.sdkVersion !== record.sdkVersion) {
      return failure("SDK_TOKEN_CONTEXT_MISMATCH", "The runtime token SDK version does not match.", { valid: false });
    }
    if (typeof context.capability !== "string") {
      return failure("SDK_CAPABILITY_UNKNOWN", "A valid SDK capability is required.", { valid: false });
    }
    var capability = context.capability.trim().toLowerCase();
    if (!contracts.validCapability(capability)) {
      return failure("SDK_CAPABILITY_UNKNOWN", "The requested SDK capability is unsupported.", { valid: false, capability: capability });
    }
    if (record.capabilities.indexOf(capability) < 0) {
      return failure("SDK_CAPABILITY_REQUIRED", "The runtime token does not grant the requested capability.", { valid: false, capability: capability });
    }
    if (!originAllowed(context.origin, record.originScope)) {
      return failure("SDK_ORIGIN_NOT_ALLOWED", "The runtime token cannot be used on this origin.", { valid: false });
    }
    if (context.codeHash != null && !constantTimeEqual(String(context.codeHash).toLowerCase(), record.codeHash)) {
      return failure("SDK_TOKEN_CONTEXT_MISMATCH", "The runtime token code hash does not match.", { valid: false });
    }
    if (context.fingerprint != null && !constantTimeEqual(context.fingerprint, record.fingerprint)) {
      return failure("SDK_TOKEN_CONTEXT_MISMATCH", "The runtime token grant fingerprint does not match.", { valid: false });
    }
    return success({ capability: capability });
  }

  function normalizeStoredToken(record) {
    if (!isObject(record) || !validCodeHash(record.fingerprint) || !Number.isFinite(record.issuedAt) || !Number.isFinite(record.expiresAt) ||
        record.issuedAt < 0 || record.expiresAt <= record.issuedAt || record.expiresAt - record.issuedAt > MAX_TOKEN_TTL_MS) {
      return failure("SDK_TOKEN_INVALID", "The stored runtime token is invalid.", { valid: false });
    }
    var normalized = normalizeBinding(record);
    if (!normalized.ok) return failure("SDK_TOKEN_INVALID", "The stored runtime token binding is invalid.", { valid: false });
    return success({
      record: {
        scriptId: normalized.binding.scriptId,
        codeHash: normalized.binding.codeHash,
        capabilities: normalized.binding.capabilities,
        originScope: normalized.binding.originScope,
        sdkVersion: normalized.binding.sdkVersion,
        fingerprint: record.fingerprint,
        issuedAt: record.issuedAt,
        expiresAt: record.expiresAt
      }
    });
  }

  function persistTokenCleanup(tokens, changed, result) {
    if (!changed) return Promise.resolve(result);
    return writeTokenStore(tokens).then(function () { return result; });
  }

  function validateRuntimeToken(token, context) {
    if (!validRuntimeTokenId(token)) {
      return Promise.resolve(failure("SDK_TOKEN_INVALID", "The runtime token is invalid.", { valid: false }));
    }
    return enqueueTokenMutation(function () {
      return readTokenStore().then(function (tokens) {
        var rawRecord = tokens[token];
        var changed = purgeExpiredTokens(tokens, Date.now());
        if (!rawRecord) {
          return persistTokenCleanup(tokens, changed, failure("SDK_TOKEN_INVALID", "The runtime token is invalid or was revoked.", { valid: false }));
        }
        var normalized = normalizeStoredToken(rawRecord);
        if (!normalized.ok) {
          if (Object.prototype.hasOwnProperty.call(tokens, token)) {
            delete tokens[token];
            changed += 1;
          }
          return persistTokenCleanup(tokens, changed, normalized);
        }
        var record = normalized.record;
        if (record.expiresAt <= Date.now()) {
          return persistTokenCleanup(tokens, changed, failure("SDK_TOKEN_EXPIRED", "The runtime token has expired.", { valid: false }));
        }
        return fingerprintBinding(record).then(function (calculatedFingerprint) {
          if (!constantTimeEqual(calculatedFingerprint, record.fingerprint)) {
            if (Object.prototype.hasOwnProperty.call(tokens, token)) {
              delete tokens[token];
              changed += 1;
            }
            return persistTokenCleanup(tokens, changed, failure("SDK_TOKEN_INVALID", "The runtime token binding was modified.", { valid: false }));
          }
          var contextResult = validateRuntimeContext(record, context);
          if (!contextResult.ok) return persistTokenCleanup(tokens, changed, contextResult);
          return readGrantStore().then(function (grants) {
          var stored = grants[record.scriptId];
          if (!stored) {
            if (Object.prototype.hasOwnProperty.call(tokens, token)) {
              delete tokens[token];
              changed += 1;
            }
            return persistTokenCleanup(tokens, changed, failure("SDK_GRANT_REVOKED", "The SDK grant was revoked.", { valid: false }));
          }
          return validateStoredGrant(stored).then(function (validated) {
            if (!validated.ok || !constantTimeEqual(validated.grant.fingerprint, record.fingerprint)) {
              if (Object.prototype.hasOwnProperty.call(tokens, token)) {
                delete tokens[token];
                changed += 1;
              }
              return persistTokenCleanup(tokens, changed, failure("SDK_GRANT_REVOKED", "The SDK grant changed or was revoked.", { valid: false }));
            }
            return persistTokenCleanup(tokens, changed, success({
              valid: true,
              scriptId: record.scriptId,
              capability: contextResult.capability,
              grantFingerprint: record.fingerprint,
              expiresAt: record.expiresAt
            }));
          });
          });
        });
      });
    }).catch(function (error) {
      return failure("SDK_TOKEN_CHECK_FAILED", error && error.message || String(error), { valid: false });
    });
  }

  function revokeRuntimeToken(token) {
    if (!validRuntimeTokenId(token)) return Promise.resolve(success({ revoked: false }));
    return enqueueTokenMutation(function () {
      return readTokenStore().then(function (tokens) {
        var changed = purgeExpiredTokens(tokens, Date.now());
        var revoked = Object.prototype.hasOwnProperty.call(tokens, token);
        if (revoked) {
          delete tokens[token];
          changed += 1;
        }
        return persistTokenCleanup(tokens, changed, success({ revoked: revoked }));
      });
    }).catch(function (error) {
      return error && error.ok === false ? error : failure("SDK_TOKEN_REVOKE_FAILED", error && error.message || String(error));
    });
  }

  global.WinSpeedBallPermissionService = Object.freeze({
    GRANTS_KEY: GRANTS_KEY,
    TOKENS_KEY: TOKENS_KEY,
    DEFAULT_TOKEN_TTL_MS: DEFAULT_TOKEN_TTL_MS,
    MAX_TOKEN_TTL_MS: MAX_TOKEN_TTL_MS,
    hashCode: hashCode,
    createGrantFingerprint: createGrantFingerprint,
    grant: grant,
    revoke: revoke,
    check: check,
    list: list,
    createRuntimeToken: createRuntimeToken,
    validateRuntimeToken: validateRuntimeToken,
    revokeRuntimeToken: revokeRuntimeToken,
    revokeScriptTokens: revokeScriptTokens,
    revokeAllRuntimeTokens: revokeAllRuntimeTokens
  });
})(self);
