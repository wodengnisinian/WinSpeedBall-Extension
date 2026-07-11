(function (global) {
  "use strict";

  var DEFAULT_TTL_MS = 2 * 60 * 1000;
  var MAX_INTENTS = 20;

  function create(options) {
    options = options || {};
    var contracts = options.contracts;
    var resolveCurrent = options.resolveCurrent;
    var validateContext = options.validateContext;
    var readIntents = options.readIntents;
    var writeIntents = options.writeIntents;
    var now = options.now || Date.now;
    var createNonce = options.createNonce || function () {
      var bytes = new Uint8Array(32);
      global.crypto.getRandomValues(bytes);
      return "wsb_ctx_" + Array.prototype.map.call(bytes, function (value) { return value.toString(16).padStart(2, "0"); }).join("");
    };
    var mutationQueue = Promise.resolve();

    function failure(code, error) {
      return { ok: false, code: code, error: error };
    }

    function enqueue(task) {
      var result = mutationQueue.then(task, task);
      mutationQueue = result.then(function () {}, function () {});
      return result;
    }

    function validNonce(value) {
      return typeof value === "string" && /^wsb_ctx_[a-f0-9]{64}$/.test(value);
    }

    function normalizedCapabilities(values) {
      return contracts.normalizeCapabilities(values).slice().sort();
    }

    function sameCapabilities(left, right) {
      return left.length === right.length && left.every(function (value, index) { return value === right[index]; });
    }

    function purge(intents, timestamp) {
      Object.keys(intents).forEach(function (nonce) {
        var record = intents[nonce];
        if (!validNonce(nonce) || !record || typeof record !== "object" || Number(record.expiresAt || 0) <= timestamp) delete intents[nonce];
      });
    }

    function safeIntentMap(value) {
      var result = {};
      if (!value || typeof value !== "object" || Array.isArray(value)) return result;
      Object.keys(value).forEach(function (nonce) {
        if (validNonce(nonce)) result[nonce] = value[nonce];
      });
      return result;
    }

    function prepare(capabilities) {
      var normalized = normalizedCapabilities(capabilities);
      if (!normalized.length) return Promise.resolve(failure("SDK_CAPABILITY_REQUIRED", "At least one SDK capability is required."));
      return resolveCurrent(normalized).then(function (context) {
        if (!context || context.ok === false) return context || failure("SDK_CONTEXT_UNAVAILABLE", "SDK context is unavailable.");
        var nonce;
        try { nonce = createNonce(); }
        catch (error) { return failure("SDK_CONTEXT_NONCE_FAILED", error && error.message || String(error)); }
        if (!validNonce(nonce)) return failure("SDK_CONTEXT_NONCE_FAILED", "SDK context nonce is invalid.");
        var issuedAt = now();
        var record = {
          tabId: Number.isInteger(context.tabId) ? context.tabId : null,
          origin: String(context.origin || ""),
          originPattern: String(context.originPattern || ""),
          url: String(context.url || context.origin || ""),
          capabilities: normalized,
          issuedAt: issuedAt,
          expiresAt: issuedAt + DEFAULT_TTL_MS
        };
        return enqueue(function () {
          return readIntents().then(function (intents) {
            intents = safeIntentMap(intents);
            purge(intents, issuedAt);
            var keys = Object.keys(intents).sort(function (left, right) { return Number(intents[left].issuedAt || 0) - Number(intents[right].issuedAt || 0); });
            while (keys.length >= MAX_INTENTS) delete intents[keys.shift()];
            intents[nonce] = record;
            return writeIntents(intents).then(function (saved) {
              if (saved && saved.ok === false) return saved;
              return {
                ok: true,
                contextNonce: nonce,
                tabId: record.tabId,
                origin: record.origin,
                originPattern: record.originPattern,
                url: record.url,
                capabilities: record.capabilities.slice(),
                issuedAt: record.issuedAt,
                expiresAt: record.expiresAt
              };
            });
          });
        });
      }).catch(function (error) {
        return error && error.ok === false ? error : failure("SDK_CONTEXT_PREPARE_FAILED", error && error.message || String(error));
      });
    }

    function consume(nonce, capabilities) {
      if (!validNonce(nonce)) return Promise.resolve(failure("SDK_CONTEXT_NONCE_INVALID", "SDK context confirmation is invalid."));
      var requested = normalizedCapabilities(capabilities);
      return enqueue(function () {
        return readIntents().then(function (intents) {
          intents = safeIntentMap(intents);
          var record = intents[nonce];
          delete intents[nonce];
          purge(intents, now());
          return writeIntents(intents).then(function (saved) {
            if (saved && saved.ok === false) return saved;
            if (!record) return failure("SDK_CONTEXT_NONCE_INVALID", "SDK context confirmation is missing or expired.");
            if (Number(record.expiresAt || 0) <= now()) return failure("SDK_CONTEXT_NONCE_EXPIRED", "SDK context confirmation expired.");
            var declared = normalizedCapabilities(record.capabilities);
            if (!sameCapabilities(declared, requested)) return failure("SDK_CONTEXT_CAPABILITY_MISMATCH", "SDK context capabilities changed after confirmation.");
            return validateContext(record).then(function (validated) {
              if (!validated || validated.ok === false) return validated || failure("SDK_CONTEXT_CHANGED", "SDK context changed after confirmation.");
              return Object.assign({ ok: true }, record);
            });
          });
        });
      }).catch(function (error) {
        return error && error.ok === false ? error : failure("SDK_CONTEXT_CONSUME_FAILED", error && error.message || String(error));
      });
    }

    function clear() {
      return enqueue(function () { return writeIntents({}); });
    }

    return Object.freeze({
      prepare: prepare,
      consume: consume,
      clear: clear,
      validNonce: validNonce
    });
  }

  global.WinSpeedBallSdkContextService = Object.freeze({ create: create });
})(self);
