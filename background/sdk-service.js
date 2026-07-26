(function (global) {
  "use strict";

  function create(dependencies) {
    var contracts = dependencies.contracts;
    var methodSchema = dependencies.methodSchema;
    var permission = dependencies.permissionService;
    var featureGate = dependencies.featureGate;
    var developerMode = dependencies.developerModeService;
    var sdkStorage = dependencies.sdkStorageService;
    var consumeContext = dependencies.consumeContext;
    var validateContext = dependencies.validateContext;
    var controlTab = dependencies.controlTab;
    var controlBook = dependencies.controlBook;
    var getBookStatus = dependencies.getBookStatus;
    var releaseBookResources = dependencies.releaseBookResources;
    var callAi = dependencies.callAi;
    var getLatestOcr = dependencies.getLatestOcr;
    var getVoiceState = dependencies.getVoiceState;
    var getLatestAi = dependencies.getLatestAi;
    var getAiHistory = dependencies.getAiHistory;
    var readSessions = dependencies.readSessions;
    var writeSessions = dependencies.writeSessions;
    var sessionMutationQueue = Promise.resolve();
    var sessionPreparationQueue = Promise.resolve();
    var MAX_ACTIVE_SESSIONS = 50;
    var LIFECYCLE_CLEANUP_ATTEMPTS = 3;
    var MAX_LIFECYCLE_TOMBSTONES = 256;
    var lifecycleEpoch = createLifecycleEpoch();
    var revocationGeneration = 0;
    var lifecycleTombstones = [];

    function enqueueSessionMutation(task) {
      var result = sessionMutationQueue.then(task, task);
      sessionMutationQueue = result.then(function () {}, function () {});
      return result;
    }

    function enqueueSessionPreparation(task) {
      var result = sessionPreparationQueue.then(task, task);
      sessionPreparationQueue = result.then(function () {}, function () {});
      return result;
    }

    function failure(code, error, extra) {
      return Object.assign({ ok: false, code: code, error: error }, extra || {});
    }

    function createLifecycleEpoch() {
      try {
        if (global.crypto && typeof global.crypto.randomUUID === "function") {
          return "sdk_lifecycle_" + global.crypto.randomUUID().replace(/-/g, "");
        }
      } catch (error) {}
      return "sdk_lifecycle_" + Date.now().toString(36) + Math.random().toString(36).slice(2);
    }

    function storedLifecycleGeneration(session) {
      return Number.isInteger(session && session.lifecycleGeneration) && session.lifecycleGeneration >= 0
        ? session.lifecycleGeneration
        : 0;
    }

    function markLifecycleRevocation(matches) {
      revocationGeneration += 1;
      var tombstone = {
        epoch: lifecycleEpoch,
        generation: revocationGeneration,
        matches: matches,
        sticky: false
      };
      if (lifecycleTombstones.length >= MAX_LIFECYCLE_TOMBSTONES) {
        tombstone.matches = function () { return true; };
        tombstone.sticky = true;
        lifecycleTombstones = [tombstone];
        return tombstone;
      }
      lifecycleTombstones.push(tombstone);
      return tombstone;
    }

    function releaseLifecycleTombstone(tombstone, result) {
      if (!result || result.ok !== true || !tombstone || tombstone.sticky) return result;
      var index = lifecycleTombstones.indexOf(tombstone);
      if (index >= 0) lifecycleTombstones.splice(index, 1);
      return result;
    }

    function sessionPredatesTombstone(session, tombstone) {
      return String(session && session.lifecycleEpoch || "") !== tombstone.epoch
        || storedLifecycleGeneration(session) < tombstone.generation;
    }

    function lifecycleBlocksSession(session, token) {
      return lifecycleTombstones.some(function (tombstone) {
        return sessionPredatesTombstone(session, tombstone) && tombstone.matches(session, token);
      });
    }

    function lifecycleFailure() {
      return failure("SDK_SESSION_REVOKED", "SDK session was revoked because its page or permission context changed.");
    }

    function isSessionStorageFailure(result) {
      return !!(result && result.ok === false &&
        (result.code === "SDK_SESSION_STORAGE_FAILED" || result.code === "SDK_SESSION_STORAGE_UNAVAILABLE"));
    }

    function retryLifecycleCleanup(task, attempts) {
      return Promise.resolve().then(task).then(function (result) {
        if (attempts > 1 && isSessionStorageFailure(result)) {
          return retryLifecycleCleanup(task, attempts - 1);
        }
        return result;
      }, function (error) {
        var result = error && error.ok === false
          ? error
          : failure("SDK_SESSION_STORAGE_FAILED", error && error.message || String(error));
        if (attempts > 1 && isSessionStorageFailure(result)) {
          return retryLifecycleCleanup(task, attempts - 1);
        }
        return result;
      });
    }

    function bookCleanupFailure(result, error) {
      var message = error || "Book task cleanup failed.";
      var value = Object.assign({}, result || {}, {
        resourceCleanupOk: false,
        resourceCleanupError: message
      });
      if (!result || result.ok !== false) {
        value.ok = false;
        value.code = "SDK_BOOK_CLEANUP_FAILED";
        value.error = message;
      }
      return value;
    }

    function withBookCleanup(criteria, result) {
      if (typeof releaseBookResources !== "function") return Promise.resolve(result);
      var cleanup;
      try { cleanup = releaseBookResources(criteria); }
      catch (error) { cleanup = Promise.reject(error); }
      return Promise.resolve(cleanup).then(function (value) {
        if (value && value.ok === false) {
          return bookCleanupFailure(result, value.error || "Book task cleanup failed.");
        }
        return result;
      }, function (error) {
        return bookCleanupFailure(result, error && error.message || String(error));
      });
    }

    function validScriptId(value) {
      return typeof value === "string"
        && /^[A-Za-z0-9_-]{1,64}$/.test(value)
        && ["__proto__", "prototype", "constructor"].indexOf(value) < 0;
    }

    function validStoredSession(session) {
      return !!session
        && typeof session === "object"
        && !Array.isArray(session)
        && validScriptId(session.scriptId)
        && (session.tabId === null || (Number.isInteger(session.tabId) && session.tabId >= 0))
        && typeof session.origin === "string"
        && session.origin.length > 0
        && session.origin.length <= 2048
        && typeof session.originPattern === "string"
        && session.originPattern.length <= 2048
        && typeof session.url === "string"
        && session.url.length <= 2048
        && ["", "book", "image", "chaoxing"].indexOf(session.bookMode) >= 0
        && typeof session.ownerSessionId === "string"
        && /^sdk_owner_[A-Za-z0-9]+$/.test(session.ownerSessionId)
        && session.sdkVersion === contracts.SDK_VERSION
        && typeof session.codeHash === "string"
        && /^[a-f0-9]{64}$/.test(session.codeHash)
        && typeof session.grantFingerprint === "string"
        && /^[a-f0-9]{64}$/.test(session.grantFingerprint)
        && Number.isFinite(session.issuedAt)
        && session.issuedAt >= 0
        && (session.lifecycleEpoch == null ||
          (typeof session.lifecycleEpoch === "string" && /^sdk_lifecycle_[A-Za-z0-9]+$/.test(session.lifecycleEpoch)))
        && (session.lifecycleGeneration == null ||
          (Number.isInteger(session.lifecycleGeneration) && session.lifecycleGeneration >= 0))
        && session.persistent === true;
    }

    function resolveSessionBookMode(capabilities, value) {
      var hasBookCapability = capabilities.some(function (capability) {
        return String(capability || "").indexOf("book.") === 0;
      });
      if (!hasBookCapability) {
        return value == null || value === ""
          ? { ok: true, value: "" }
          : failure("SDK_BOOK_MODE_UNEXPECTED", "Book mode is only valid for book capabilities.");
      }
      var selectedMode = String(value || "").trim().toLowerCase();
      return ["book", "image", "chaoxing"].indexOf(selectedMode) >= 0
        ? { ok: true, value: selectedMode }
        : failure("SDK_BOOK_MODE_REQUIRED", "A valid book authorization mode is required.");
    }

    function sessionEntry(token, session) {
      return { token: token, session: session || {} };
    }

    function cleanupSessionEntries(entries) {
      return (entries || []).reduce(function (chain, entry) {
        return chain.then(function (state) {
          return Promise.resolve(permission.revokeRuntimeToken(entry.token)).then(function (revoked) {
            if (!revoked || revoked.ok === false) {
              state.tokenError = revoked && revoked.error || "SDK runtime token could not be revoked.";
              state.tokenErrorCode = revoked && revoked.code || "SDK_TOKEN_REVOKE_FAILED";
            } else if (revoked.revoked === true) {
              state.tokenRevoked += 1;
            }
            return withBookCleanup({
              scriptId: entry.session.scriptId,
              tabId: entry.session.tabId,
              ownerSessionId: entry.session.ownerSessionId
            }, { ok: true }).then(function (cleaned) {
              if (cleaned.resourceCleanupOk === false) state.bookError = cleaned.resourceCleanupError;
              return state;
            });
          }, function (error) {
            state.tokenError = error && error.message || String(error);
            state.tokenErrorCode = error && error.code || "SDK_TOKEN_REVOKE_FAILED";
            return withBookCleanup({
              scriptId: entry.session.scriptId,
              tabId: entry.session.tabId,
              ownerSessionId: entry.session.ownerSessionId
            }, { ok: true }).then(function (cleaned) {
              if (cleaned.resourceCleanupOk === false) state.bookError = cleaned.resourceCleanupError;
              return state;
            });
          });
        });
      }, Promise.resolve({ ok: true, tokenRevoked: 0 }));
    }

    function retireScriptSessions(scriptId) {
      return enqueueSessionMutation(function () {
        return readSessions().then(function (sessions) {
          var next = Object.assign({}, sessions || {});
          var retired = Object.keys(next).filter(function (token) {
            return next[token] && next[token].scriptId === scriptId;
          }).map(function (token) {
            var entry = sessionEntry(token, next[token]);
            delete next[token];
            return entry;
          });
          if (!retired.length) return { ok: true, replaced: 0 };
          return cleanupSessionEntries(retired).then(function (cleanup) {
            return writeSessions(next).then(function (saved) {
              if (saved && saved.ok === false) return saved;
              if (cleanup.bookError) return failure("SDK_BOOK_CLEANUP_FAILED", cleanup.bookError);
              if (cleanup.tokenError) return failure("SDK_TOKEN_REVOKE_FAILED", cleanup.tokenError);
              return { ok: true, replaced: retired.length };
            });
          });
        });
      }).catch(function (error) {
        return failure("SDK_SESSION_REPLACE_FAILED", error && error.message || String(error));
      });
    }

    function normalizeCapabilities(values) {
      return contracts.normalizeCapabilities(values).slice().sort();
    }

    function sameList(left, right) {
      return left.length === right.length && left.every(function (value, index) { return value === right[index]; });
    }

    function createOwnerSessionId() {
      try {
        if (global.crypto && typeof global.crypto.randomUUID === "function") {
          return "sdk_owner_" + global.crypto.randomUUID().replace(/-/g, "");
        }
      } catch (error) {}
      return "sdk_owner_" + Date.now().toString(36) + Math.random().toString(36).slice(2);
    }

    function featureFor(method, capability) {
      if (capability.indexOf("video.") === 0) return "video.basic";
      if (capability === "ocr.read") return "ocr.basic";
      if (capability === "qa.read") return "ocr.basic";
      if (capability === "ai.read" || capability === "ai.request") return method === "ai.summary" ? "ai.summary" : "ai.basic";
      return "sdk.developer";
    }

    function ensureDeveloperMode() {
      return developerMode.getStatus().then(function (status) {
        return status && status.ok && status.enabled
          ? { ok: true }
          : failure("DEVELOPER_MODE_REQUIRED", "Developer Mode is not enabled.");
      });
    }

    function saveSession(tokenResult, grantResult, context, sessionGeneration) {
      return enqueueSessionMutation(function () {
        return readSessions().then(function (sessions) {
          var next = Object.assign({}, sessions || {});
          var invalid = Object.keys(next).filter(function (token) {
            return !validStoredSession(next[token]);
          }).map(function (token) {
            var entry = sessionEntry(token, next[token]);
            delete next[token];
            return entry;
          });
          return cleanupSessionEntries(invalid).then(function () {
            if (Object.keys(next).length >= MAX_ACTIVE_SESSIONS) {
              return writeSessions(next).then(function (saved) {
                return saved && saved.ok === false
                  ? saved
                  : failure("SDK_SESSION_LIMIT_REACHED", "Too many SDK sessions are active. Close an existing session and try again.");
              });
            }
            next[tokenResult.token] = {
              scriptId: grantResult.grant.scriptId,
              tabId: Number.isInteger(context.tabId) ? context.tabId : null,
              origin: context.origin,
              originPattern: String(context.originPattern || ""),
              url: context.url || context.origin,
              bookMode: String(context.bookMode || ""),
              ownerSessionId: createOwnerSessionId(),
              sdkVersion: grantResult.grant.sdkVersion,
              codeHash: grantResult.grant.codeHash,
              grantFingerprint: grantResult.grant.fingerprint,
              issuedAt: tokenResult.issuedAt,
              lifecycleEpoch: lifecycleEpoch,
              lifecycleGeneration: sessionGeneration,
              persistent: true
            };
            return writeSessions(next).then(function (saved) {
              return saved && saved.ok === false ? saved : { ok: true, session: next[tokenResult.token] };
            });
          });
        });
      }).catch(function (error) {
        return failure("SDK_SESSION_STORAGE_FAILED", error && error.message || String(error));
      });
    }

    function prepareSession(input) {
      input = input || {};
      if (input.confirmed !== true) return Promise.resolve(failure("SDK_GRANT_CONFIRMATION_REQUIRED", "SDK capabilities must be explicitly confirmed."));
      var metadata = contracts.parseMetadata(input.code);
      var classification = contracts.classifyMetadata(metadata);
      if (!classification.ok || classification.mode !== "sdk") {
        return Promise.resolve(failure(classification.code || "SDK_SCRIPT_INVALID", classification.error || "The SDK script metadata is invalid."));
      }
      var declared = normalizeCapabilities(classification.capabilities);
      var requested = normalizeCapabilities(input.capabilities);
      if (!sameList(declared, requested)) return Promise.resolve(failure("SDK_CAPABILITY_MISMATCH", "Requested capabilities do not match the script declaration."));
      if (!validScriptId(input.scriptId)) return Promise.resolve(failure("SDK_SCRIPT_ID_INVALID", "The SDK script identifier is invalid."));
      var selectedBookMode = resolveSessionBookMode(requested, input.bookMode);
      if (!selectedBookMode.ok) return Promise.resolve(selectedBookMode);
      var preparationGeneration = 0;
      return enqueueSessionPreparation(function () {
        preparationGeneration = revocationGeneration;
        return ensureDeveloperMode().then(function (mode) {
          if (!mode.ok) return mode;
          return consumeContext(input.contextNonce, requested, selectedBookMode.value);
        }).then(function (context) {
          if (!context || context.ok === false) return context || failure("SDK_CONTEXT_UNAVAILABLE", "SDK context is unavailable.");
          if (String(context.bookMode || "") !== selectedBookMode.value) {
            return failure("SDK_CONTEXT_BOOK_MODE_MISMATCH", "SDK book authorization mode changed after confirmation.");
          }
          if (revocationGeneration !== preparationGeneration) {
            return failure("SDK_CONTEXT_CHANGED", "SDK page or permission context changed while the session was being prepared.");
          }
          var sessionGeneration = preparationGeneration;
          var replacementTombstone = null;
          var binding = {
            scriptId: input.scriptId,
            code: input.code,
            capabilities: requested,
            originScope: [context.originPattern],
            sdkVersion: contracts.SDK_VERSION
          };
          return ensureDeveloperMode().then(function (latestMode) {
            if (!latestMode.ok) return latestMode;
            if (revocationGeneration !== preparationGeneration) {
              return failure("SDK_CONTEXT_CHANGED", "SDK page or permission context changed while the session was being prepared.");
            }
            replacementTombstone = markLifecycleRevocation(function (session) {
              return !!session && session.scriptId === input.scriptId;
            });
            sessionGeneration = revocationGeneration;
            return retireScriptSessions(input.scriptId);
          }).then(function (retired) {
            if (!retired.ok) return retired;
            releaseLifecycleTombstone(replacementTombstone, retired);
            if (revocationGeneration !== sessionGeneration) {
              return failure("SDK_CONTEXT_CHANGED", "SDK page or permission context changed while the session was being prepared.");
            }
            return permission.grant(binding);
          }).then(function (granted) {
            if (!granted.ok) return granted;
            if (revocationGeneration !== sessionGeneration) {
              return failure("SDK_CONTEXT_CHANGED", "SDK page or permission context changed while the session was being prepared.");
            }
            return permission.createRuntimeToken(binding).then(function (tokenResult) {
              if (!tokenResult.ok) return tokenResult;
              if (revocationGeneration !== sessionGeneration) {
                return Promise.resolve(permission.revokeRuntimeToken(tokenResult.token)).then(function () {
                  return failure("SDK_CONTEXT_CHANGED", "SDK page or permission context changed while the session was being prepared.");
                });
              }
              return saveSession(tokenResult, granted, context, sessionGeneration).then(function (saved) {
                if (!saved.ok) {
                  return Promise.resolve(permission.revokeRuntimeToken(tokenResult.token)).then(function () { return saved; });
                }
                if (revocationGeneration !== sessionGeneration) {
                  return closeSessionNow(tokenResult.token).then(function () {
                    return failure("SDK_CONTEXT_CHANGED", "SDK page or permission context changed while the session was being prepared.");
                  });
                }
                return {
                  ok: true,
                  sessionToken: tokenResult.token,
                  scriptId: input.scriptId,
                  sdkVersion: contracts.SDK_VERSION,
                  grantFingerprint: granted.grant.fingerprint,
                  codeHash: granted.grant.codeHash,
                  capabilities: granted.grant.capabilities,
                  bookMode: saved.session.bookMode,
                  origin: context.origin,
                  originScope: granted.grant.originScope,
                  tabId: saved.session.tabId,
                  issuedAt: tokenResult.issuedAt,
                  persistent: true
                };
              });
            });
          });
        });
      }).catch(function (error) {
        return error && error.ok === false ? error : failure("SDK_SESSION_CREATE_FAILED", error && error.message || String(error));
      });
    }

    function getSession(token) {
      return readSessions().then(function (sessions) {
        var session = sessions && sessions[token];
        if (!session) return failure("SDK_SESSION_NOT_FOUND", "SDK session is missing or was closed.");
        if (!validStoredSession(session)) {
          return closeSession(token).then(function () {
            return failure("SDK_SESSION_INVALID", "SDK session data is invalid.");
          });
        }
        return { ok: true, session: session };
      });
    }

    function closeSessionNow(token) {
      return enqueueSessionMutation(function () {
        return readSessions().then(function (sessions) {
          var session = sessions && sessions[token];
          return Promise.resolve(permission.revokeRuntimeToken(token)).then(function (tokenResult) {
            if (!tokenResult || tokenResult.ok === false) {
              var revokeFailure = tokenResult || failure("SDK_TOKEN_REVOKE_FAILED", "SDK runtime token could not be revoked.");
              if (!session) return revokeFailure;
              return withBookCleanup({
                scriptId: session.scriptId,
                tabId: session.tabId,
                ownerSessionId: session.ownerSessionId
              }, revokeFailure);
            }
            var next = Object.assign({}, sessions || {});
            var revoked = Object.prototype.hasOwnProperty.call(next, token);
            delete next[token];
            return writeSessions(next).then(function (saved) {
              var result = saved && saved.ok === false
                ? saved
                : { ok: true, revoked: revoked || tokenResult.revoked === true };
              if (!session || typeof releaseBookResources !== "function") return result;
              return withBookCleanup({
                scriptId: session.scriptId,
                tabId: session.tabId,
                ownerSessionId: session.ownerSessionId
              }, result);
            });
          });
        });
      }).catch(function (error) {
        return failure("SDK_SESSION_CLOSE_FAILED", error && error.message || String(error));
      });
    }

    function closeSession(token) {
      var tombstone = markLifecycleRevocation(function (session, candidateToken) {
        return candidateToken === token;
      });
      return enqueueSessionPreparation(function () {
        return closeSessionNow(token).then(function (result) {
          return releaseLifecycleTombstone(tombstone, result);
        });
      });
    }

    function closeSessionBatchResult(metadata, entries, cleanup, saved) {
      var details = Object.assign({}, metadata || {}, {
        closed: saved && saved.ok === false ? 0 : entries.length,
        revoked: Number(cleanup && cleanup.tokenRevoked || 0)
      });
      if (cleanup && cleanup.bookError) {
        details.resourceCleanupOk = false;
        details.resourceCleanupError = cleanup.bookError;
      }
      if (saved && saved.ok === false) return Object.assign({}, saved, details);
      if (cleanup && cleanup.tokenError) {
        return failure(
          cleanup.tokenErrorCode || "SDK_TOKEN_REVOKE_FAILED",
          cleanup.tokenError,
          details
        );
      }
      if (cleanup && cleanup.bookError) {
        return failure("SDK_BOOK_CLEANUP_FAILED", cleanup.bookError, details);
      }
      return Object.assign({ ok: true }, details);
    }

    function closeMatchingSessionsNow(matches, metadata, errorCode) {
      return enqueueSessionMutation(function () {
        return readSessions().then(function (sessions) {
          var next = Object.assign({}, sessions || {});
          var entries = Object.keys(next).filter(function (token) {
            return matches(next[token], token);
          }).map(function (token) {
            var entry = sessionEntry(token, next[token]);
            delete next[token];
            return entry;
          });
          if (!entries.length) return Object.assign({ ok: true, closed: 0, revoked: 0 }, metadata || {});
          return writeSessions(next).then(function (saved) {
            return cleanupSessionEntries(entries).then(function (cleanup) {
              return closeSessionBatchResult(metadata, entries, cleanup, saved);
            });
          });
        });
      }).catch(function (error) {
        return error && error.ok === false
          ? error
          : failure(errorCode, error && error.message || String(error), Object.assign({ closed: 0, revoked: 0 }, metadata || {}));
      });
    }

    function closeSessionsForTabNow(tabId, preserveOrigin) {
      return closeMatchingSessionsNow(function (session) {
        return !!session
          && session.tabId === tabId
          && (!preserveOrigin || session.origin !== preserveOrigin);
      }, { tabId: tabId }, "SDK_TAB_SESSION_CLOSE_FAILED");
    }

    function closeSessionsForTab(tabId, preserveOrigin) {
      if (!Number.isInteger(tabId) || tabId < 0) {
        return Promise.resolve(failure("SDK_TAB_INVALID", "A valid tab identifier is required.", { closed: 0, revoked: 0 }));
      }
      if (preserveOrigin != null && preserveOrigin !== "" &&
          (typeof preserveOrigin !== "string" || preserveOrigin.length > 2048 || !/^https?:\/\/[^/?#]+$/i.test(preserveOrigin))) {
        return Promise.resolve(failure("SDK_ORIGIN_INVALID", "The preserved tab origin is invalid.", { tabId: tabId, closed: 0, revoked: 0 }));
      }
      var retainedOrigin = typeof preserveOrigin === "string" ? preserveOrigin : "";
      var tombstone = markLifecycleRevocation(function (session) {
        return !!session
          && session.tabId === tabId
          && (!retainedOrigin || session.origin !== retainedOrigin);
      });
      return enqueueSessionPreparation(function () {
        return retryLifecycleCleanup(function () {
          return closeSessionsForTabNow(tabId, retainedOrigin);
        }, LIFECYCLE_CLEANUP_ATTEMPTS).then(function (result) {
          return releaseLifecycleTombstone(tombstone, result);
        });
      });
    }

    function normalizeRemovedOrigins(values) {
      if (!Array.isArray(values) || !values.length || values.length > 128) {
        return failure("SDK_ORIGIN_SCOPE_INVALID", "At least one removed origin pattern is required.");
      }
      var normalized = [];
      for (var index = 0; index < values.length; index += 1) {
        var pattern = typeof values[index] === "string" ? values[index].trim().toLowerCase() : "";
        if (!pattern || pattern.length > 2048 ||
            (pattern !== "<all_urls>" && !/^(?:\*|https?):\/\/[^/\s]+\/.*$/i.test(pattern))) {
          return failure("SDK_ORIGIN_SCOPE_INVALID", "A removed origin pattern is invalid.");
        }
        if (normalized.indexOf(pattern) < 0) normalized.push(pattern);
      }
      return { ok: true, origins: normalized };
    }

    function hostWithoutPort(value) {
      value = String(value || "").toLowerCase();
      if (value.charAt(0) === "[") {
        var bracket = value.indexOf("]");
        return bracket >= 0 ? value.slice(0, bracket + 1) : value;
      }
      return value.replace(/:\d+$/, "");
    }

    function removedOriginMatchesSession(pattern, session) {
      if (!session || typeof session.origin !== "string") return false;
      if (pattern === "<all_urls>" || pattern === String(session.originPattern || "").toLowerCase()) return true;
      var patternMatch = pattern.match(/^(\*|https?):\/\/([^/]+)\//i);
      var originMatch = String(session.origin).toLowerCase().match(/^(https?):\/\/(\[[^\]]+\]|[^/:?#]+)(?::\d+)?$/i);
      if (!patternMatch || !originMatch) return false;
      if (patternMatch[1] !== "*" && patternMatch[1].toLowerCase() !== originMatch[1].toLowerCase()) return false;
      var patternHost = hostWithoutPort(patternMatch[2]);
      var sessionHost = hostWithoutPort(originMatch[2]);
      if (patternHost === "*") return true;
      if (patternHost.indexOf("*.") === 0) {
        var suffix = patternHost.slice(2);
        return sessionHost === suffix || sessionHost.endsWith("." + suffix);
      }
      return patternHost === sessionHost;
    }

    function closeSessionsForOriginsNow(originPatterns) {
      return closeMatchingSessionsNow(function (session) {
        return Number.isInteger(session && session.tabId) && originPatterns.some(function (pattern) {
          return removedOriginMatchesSession(pattern, session);
        });
      }, { originCount: originPatterns.length }, "SDK_ORIGIN_SESSION_CLOSE_FAILED");
    }

    function closeSessionsForOrigins(originPatterns) {
      var normalized = normalizeRemovedOrigins(originPatterns);
      if (!normalized.ok) return Promise.resolve(normalized);
      var tombstone = markLifecycleRevocation(function (session) {
        return Number.isInteger(session && session.tabId) && normalized.origins.some(function (pattern) {
          return removedOriginMatchesSession(pattern, session);
        });
      });
      return enqueueSessionPreparation(function () {
        return retryLifecycleCleanup(function () {
          return closeSessionsForOriginsNow(normalized.origins);
        }, LIFECYCLE_CLEANUP_ATTEMPTS).then(function (result) {
          return releaseLifecycleTombstone(tombstone, result);
        });
      });
    }

    function control(session, command) {
      if (!Number.isInteger(session.tabId)) return Promise.resolve(failure("SDK_TAB_REQUIRED", "This SDK method requires an authorized web page."));
      if (typeof controlTab !== "function" || controlTab.length < 4) {
        return Promise.resolve(failure("SDK_DEPENDENCY_NOT_READY", "Bound video access is unavailable."));
      }
      return validateContext(session).then(function (validated) {
        if (!validated || validated.ok === false) return validated || failure("SDK_CONTEXT_CLOSED", "The SDK page context is closed.");
        return new Promise(function (resolve) {
          controlTab(session.tabId, command, resolve, {
            origin: String(session.origin || ""),
            originPattern: String(session.originPattern || "")
          });
        });
      });
    }

    function normalizeVideo(status) {
      status = status || {};
      return {
        id: String(status.id || ""),
        frameId: status.frameId == null ? null : Number(status.frameId),
        title: status.title || "",
        duration: Number(status.duration || 0),
        currentTime: Number(status.currentTime || 0),
        progress: Number(status.duration || 0) > 0 ? Math.max(0, Math.min(1, Number(status.currentTime || 0) / Number(status.duration))) : 0,
        rate: Number(status.rate || 1),
        volume: Number(status.volume || 0),
        muted: status.muted === true,
        paused: status.paused !== false,
        mediaType: status.mediaType || status.mediaTag || "",
        controlMode: status.controlMode || "stopped"
      };
    }

    function normalizeVideoStatus(status) {
      status = status || {};
      var value = normalizeVideo(status);
      value.mediaCount = Math.max(0, Number(status.mediaCount || 0));
      value.frameCount = Math.max(0, Number(status.frameCount || 0));
      value.remainingTime = Math.max(0, Number(status.remainingTime || Math.max(0, value.duration - value.currentTime)));
      value.playing = status.paused === false;
      value.playbackState = value.playing ? "playing" : "paused";
      value.targetRate = Number(status.targetRate == null ? value.rate : status.targetRate);
      value.rateLocked = status.rateLocked === true;
      value.rateStable = status.rateStable !== false;
      value.autoplay = status.continuousPlayback === true;
      value.keepPlaying = status.keepPlaying === true;
      value.playerType = String(status.playerType || "");
      return value;
    }

    function normalizeVideoControlResult(status, method) {
      status = status || {};
      var actions = {
        "video.setRate": "rate",
        "video.setVolume": "volume",
        "video.mute": "mute",
        "video.play": "play",
        "video.pause": "pause",
        "video.setAutoplay": "auto",
        "video.setRateLock": "lock",
        "video.reset": "reset"
      };
      return {
        action: actions[method] || "",
        applied: Math.max(0, Math.floor(Number(status.applied) || 0)),
        rate: Number(status.rate || 1),
        volume: Number(status.volume || 0),
        muted: status.muted === true,
        autoplay: status.continuousPlayback === true,
        rateLocked: status.rateLocked === true
      };
    }

    function normalizeOperationFailure(result, fallbackCode, fallbackError) {
      var code = result && typeof result.code === "string" && /^[A-Z0-9_]{3,64}$/.test(result.code)
        ? result.code
        : fallbackCode;
      var error = result && typeof result.error === "string" && result.error
        ? result.error.slice(0, 300)
        : fallbackError;
      return failure(code, error);
    }

    function dispatchVideo(method, args, session) {
      var command = { type: "GET_STATUS" };
      if (method === "video.getAll" || method === "video.current") command = { type: "GET_MEDIA_LIST" };
      else if (method === "video.setRate") command = { type: "SET_RATE", rate: args[0] };
      else if (method === "video.setVolume") command = { type: "SET_VOLUME", volume: args[0] };
      else if (method === "video.mute") command = { type: "SET_MUTED", muted: args[0] };
      else if (method === "video.play") command = { type: "PLAY" };
      else if (method === "video.pause") command = { type: "PAUSE" };
      else if (method === "video.setAutoplay") command = { type: args[0] ? "ENABLE_AUTOPLAY" : "DISABLE_AUTOPLAY" };
      else if (method === "video.setRateLock") command = { type: args[0] ? "ENABLE_RATE_LOCK" : "DISABLE_RATE_LOCK" };
      else if (method === "video.reset") command = { type: "RESET" };
      return control(session, command).then(function (result) {
        if (!result || !result.ok) return normalizeOperationFailure(result, "SDK_VIDEO_FAILED", "Video operation failed.");
        if (method === "video.getAll") return { ok: true, value: (result.media || []).map(normalizeVideo) };
        if (method === "video.current") {
          var list = (result.media || []).slice().sort(function (left, right) {
            if (left.paused !== right.paused) return left.paused ? 1 : -1;
            return Number(right.duration || 0) - Number(left.duration || 0);
          });
          return { ok: true, value: list.length ? normalizeVideo(list[0]) : null };
        }
        return {
          ok: true,
          value: method === "video.getStatus"
            ? normalizeVideoStatus(result)
            : normalizeVideoControlResult(result, method)
        };
      });
    }

    function dispatchPage(method, session) {
      return control(session, { type: "EXTRACT_PAGE_TEXT" }).then(function (result) {
        if (!result || !result.ok) return result || failure("SDK_PAGE_FAILED", "Page read failed.");
        var page = (result.frameResults || []).find(function (frame) { return frame && frame.ok && typeof frame.text === "string"; }) || result;
        var info = { title: String(page.title || ""), url: String(page.url || session.url || ""), language: String(page.language || "") };
        if (method === "page.info") return { ok: true, value: info };
        if (method === "page.title") return { ok: true, value: info.title };
        if (method === "page.url") return { ok: true, value: info.url };
        return { ok: true, value: String(page.text || "") };
      });
    }

    function normalizeBookStatus(status, fallbackMode) {
      status = status || {};
      var selectedMode = ["book", "image", "chaoxing"].indexOf(status.mode) >= 0 ? status.mode : fallbackMode;
      if (["book", "image", "chaoxing"].indexOf(selectedMode) < 0) selectedMode = "book";
      var dueAtValue = Number(status.backCoverCheckDueAt);
      var dueAt = Number.isFinite(dueAtValue) && dueAtValue > 0 && dueAtValue <= 8640000000000000 ? dueAtValue : 0;
      var pageJumpLabel = String(status.pageJumpLabel || "");
      var interval = Number(status.interval);
      var nextCheckSeconds = Number(status.backCoverNextCheckSeconds);
      var checkIndex = Number(status.backCoverCheckIndex);
      var sequence = (Array.isArray(status.backCoverCheckSequence) ? status.backCoverCheckSequence : []).map(Number).filter(function (seconds) {
        return Number.isFinite(seconds) && seconds > 0;
      }).map(function (seconds) { return Math.floor(seconds); });
      return {
        mode: selectedMode,
        detected: status.detected === true,
        reader: String(status.reader || ""),
        readerEngine: String(status.readerEngine || ""),
        page: status.page == null ? "" : String(status.page),
        pageType: status.pageType == null ? "" : String(status.pageType),
        pageTypeLabel: String(status.pageTypeLabel || ""),
        imageIndex: Math.max(0, Math.floor(Number(status.imageIndex) || 0)),
        imageCount: Math.max(0, Math.floor(Number(status.imageCount) || 0)),
        canPrev: status.canPrev === true,
        canNext: status.canNext === true,
        method: String(status.method || ""),
        currentOption: {
          detected: status.pageJumpDetected === true || !!pageJumpLabel,
          value: status.pageJumpValue == null ? "" : String(status.pageJumpValue),
          label: pageJumpLabel
        },
        isBackCover: status.isBackCover === true,
        running: status.running === true,
        intervalSeconds: Number.isFinite(interval) && interval > 0 ? interval : 0,
        monitor: {
          enabled: status.backCoverCheckEnabled === true,
          reached: status.backCoverReached === true,
          checkIndex: Number.isFinite(checkIndex) && checkIndex > 0 ? Math.floor(checkIndex) : 0,
          nextCheckAt: dueAt > 0 ? new Date(dueAt).toISOString() : "",
          nextCheckSeconds: Number.isFinite(nextCheckSeconds) && nextCheckSeconds > 0 ? Math.ceil(nextCheckSeconds) : 0,
          sequenceSeconds: sequence
        }
      };
    }

    function normalizeBookControlResult(status, fallbackMode, command) {
      status = status || {};
      var selectedMode = ["book", "image", "chaoxing"].indexOf(status.mode) >= 0 ? status.mode : fallbackMode;
      if (["book", "image", "chaoxing"].indexOf(selectedMode) < 0) selectedMode = "book";
      var interval = Number(status.interval);
      var actions = { PREV: "prev", NEXT: "next", START: "start", STOP: "stop", SET_INTERVAL: "interval" };
      return {
        action: actions[command] || "",
        mode: selectedMode,
        running: status.running === true,
        intervalSeconds: Number.isFinite(interval) && interval > 0 ? interval : 0,
        method: String(status.method || "")
      };
    }

    function dispatchBook(method, args, session) {
      if (!Number.isInteger(session.tabId)) return Promise.resolve(failure("SDK_TAB_REQUIRED", "This SDK method requires an authorized web page."));
      var authorizedMode = String(session.bookMode || "");
      if (["book", "image", "chaoxing"].indexOf(authorizedMode) < 0) {
        return Promise.resolve(failure("SDK_BOOK_MODE_REQUIRED", "This SDK session has no book authorization mode."));
      }
      var request = { command: "GET_STATUS", mode: args.length ? args[0] : authorizedMode };
      if (method === "book.turnPrev") request = { command: "PREV", mode: args[0] };
      else if (method === "book.turnNext") request = { command: "NEXT", mode: args[0] };
      else if (method === "book.startAuto") request = { command: "START", mode: args[0].mode, interval: args[0].intervalSeconds };
      else if (method === "book.stopAuto") request = { command: "STOP", mode: authorizedMode };
      else if (method === "book.setInterval") request = { command: "SET_INTERVAL", interval: args[0], mode: args[1] };
      if (request.mode !== authorizedMode) {
        return Promise.resolve(failure("BOOK_MODE_NOT_AUTHORIZED", "The requested book mode was not approved for this SDK session."));
      }
      if (typeof controlBook !== "function" && (request.command !== "GET_STATUS" || typeof getBookStatus !== "function")) {
        return Promise.resolve(failure("SDK_DEPENDENCY_NOT_READY", "Book control service is unavailable."));
      }
      return validateContext(session).then(function (validated) {
        if (!validated || validated.ok === false) return validated || failure("SDK_CONTEXT_CLOSED", "The SDK page context is closed.");
        return new Promise(function (resolve) {
          function complete(result) {
            if (!result) { resolve(failure("SDK_BOOK_FAILED", "Book status could not be read.")); return; }
            if (result.ok === false && !(request.command === "GET_STATUS" && result.detected === false)) {
              resolve(failure(result.code || "SDK_BOOK_FAILED", result.error || "Book status could not be read."));
              return;
            }
            resolve({
              ok: true,
              value: request.command === "GET_STATUS"
                ? normalizeBookStatus(result, request.mode)
                : normalizeBookControlResult(result, request.mode, request.command)
            });
          }
          if (typeof controlBook === "function") {
            controlBook(session, request, complete);
          } else if (getBookStatus.length >= 4) {
            getBookStatus(session.tabId, request.mode, complete, {
              origin: String(session.origin || ""),
              originPattern: String(session.originPattern || "")
            });
          } else {
            complete(failure("SDK_DEPENDENCY_NOT_READY", "Bound book status access is unavailable."));
          }
        });
      });
    }

    function dispatchAi(method, args) {
      if (method === "ai.latest") {
        return new Promise(function (resolve) {
          getLatestAi(function (result) {
            if (!result || !result.ok) { resolve(result || failure("SDK_AI_READ_FAILED", "Latest AI answer could not be read.")); return; }
            resolve({ ok: true, value: result.record || null });
          });
        });
      }
      if (method === "ai.history") {
        return new Promise(function (resolve) {
          getAiHistory(args[0], function (result) {
            if (!result || !result.ok) { resolve(result || failure("SDK_AI_READ_FAILED", "AI history could not be read.")); return; }
            resolve({ ok: true, value: Array.isArray(result.records) ? result.records : [] });
          });
        });
      }
      var payload = { prompt: args[0] };
      if (method === "ai.summary") payload.task = "summary";
      if (method === "ai.translate") { payload.task = "translate"; payload.targetLanguage = args[1]; }
      return new Promise(function (resolve) {
        callAi(payload, function (result) {
          if (!result || !result.ok) { resolve(result || failure("SDK_AI_FAILED", "AI request failed.")); return; }
          resolve({ ok: true, value: { content: String(result.content || ""), model: String(result.model || "") } });
        });
      });
    }

    function dispatchOcr(method) {
      if (method !== "ocr.latest") return Promise.resolve(failure("SDK_DEPENDENCY_NOT_READY", "Interactive OCR capture and direct recognition are not connected yet."));
      return new Promise(function (resolve) {
        getLatestOcr(function (result) {
          if (!result || !result.ok) { resolve(result || failure("SDK_OCR_FAILED", "OCR record could not be read.")); return; }
          resolve({ ok: true, value: { text: String(result.ocrText || ""), time: result.time ? new Date(result.time).toISOString() : "", confidence: result.confidence == null ? null : Number(result.confidence) } });
        });
      });
    }

    function normalizeOcrQuestion(result) {
      result = result || {};
      var timestamp = Number(result.time || 0);
      return {
        source: "ocr",
        text: String(result.ocrText || ""),
        status: String(result.ocrStatus || (result.ocrText ? "completed" : "idle")),
        progress: Math.max(0, Math.min(1, Number(result.ocrProgress || 0))),
        time: timestamp > 0 ? new Date(timestamp).toISOString() : "",
        durationMs: 0,
        error: String(result.ocrError || "")
      };
    }

    function normalizeVoiceQuestion(result) {
      result = result || {};
      var timestamp = Number(result.updatedAt || result.startedAt || 0);
      return {
        source: "voice",
        text: String(result.transcript || ""),
        status: String(result.status || "idle"),
        progress: Math.max(0, Math.min(1, Number(result.progress || 0))),
        time: timestamp > 0 ? new Date(timestamp).toISOString() : "",
        durationMs: Math.max(0, Number(result.durationMs || 0)),
        error: String(result.error || "")
      };
    }

    function readQuestionSource(source) {
      return new Promise(function (resolve) {
        var reader = source === "voice" ? getVoiceState : getLatestOcr;
        reader(function (result) {
          if (!result || !result.ok) { resolve(result || failure("SDK_QA_READ_FAILED", "Question record could not be read.")); return; }
          resolve({ ok: true, value: source === "voice" ? normalizeVoiceQuestion(result) : normalizeOcrQuestion(result) });
        });
      });
    }

    function dispatchQa(method) {
      if (method === "qa.ocr") return readQuestionSource("ocr");
      if (method === "qa.voice") return readQuestionSource("voice");
      return Promise.all([readQuestionSource("ocr"), readQuestionSource("voice")]).then(function (results) {
        var available = results.filter(function (result) { return result && result.ok && result.value; });
        if (!available.length) return results[0] || failure("SDK_QA_READ_FAILED", "Question record could not be read.");
        available.sort(function (left, right) {
          var leftTime = Date.parse(left.value.time || "") || 0;
          var rightTime = Date.parse(right.value.time || "") || 0;
          return rightTime - leftTime || Number(!!right.value.text) - Number(!!left.value.text);
        });
        return { ok: true, value: available[0].value };
      });
    }

    function dispatch(method, args, session) {
      if (method.indexOf("video.") === 0) return dispatchVideo(method, args, session);
      if (method.indexOf("page.") === 0) return dispatchPage(method, session);
      if (method.indexOf("book.") === 0) return dispatchBook(method, args, session);
      if (method.indexOf("qa.") === 0) return dispatchQa(method);
      if (method.indexOf("ai.") === 0) return dispatchAi(method, args);
      if (method.indexOf("ocr.") === 0) return dispatchOcr(method);
      if (method === "storage.get") return sdkStorage.get(session.scriptId, args[0]).then(function (result) { return result.ok ? { ok: true, value: result.value } : result; });
      if (method === "storage.set") return sdkStorage.set(session.scriptId, args[0], args[1]).then(function (result) { return result.ok ? { ok: true, value: { key: result.key, bytesUsed: result.bytesUsed } } : result; });
      return Promise.resolve(failure("SDK_DEPENDENCY_NOT_READY", "SDK events are not connected yet."));
    }

    function validateInvocationLifecycle(session, token, invocationGeneration) {
      if (revocationGeneration !== invocationGeneration) return Promise.resolve(lifecycleFailure());
      if (lifecycleBlocksSession(session, token)) return Promise.resolve(lifecycleFailure());
      if (!Number.isInteger(session && session.tabId)) return Promise.resolve({ ok: true });
      if (typeof validateContext !== "function") {
        return Promise.resolve(failure("SDK_CONTEXT_CLOSED", "SDK page context validation is unavailable."));
      }
      return Promise.resolve().then(function () {
        return validateContext(session);
      }).then(function (validated) {
        if (revocationGeneration !== invocationGeneration) return lifecycleFailure();
        if (lifecycleBlocksSession(session, token)) return lifecycleFailure();
        return validated && validated.ok === true
          ? { ok: true }
          : (validated || failure("SDK_CONTEXT_CLOSED", "SDK page context is closed."));
      }, function (error) {
        return failure("SDK_CONTEXT_CLOSED", error && error.message || String(error));
      });
    }

    function invoke(token, request) {
      var invocationGeneration = revocationGeneration;
      var parsed = contracts.validateRequest(request);
      if (!parsed.ok) return Promise.resolve(parsed);
      var argsValidation = methodSchema.validate(request.method, request.args);
      if (!argsValidation.ok) return Promise.resolve(argsValidation);
      return ensureDeveloperMode().then(function (mode) {
        if (!mode.ok) return mode;
        return getSession(token);
      }).then(function (sessionResult) {
        if (!sessionResult || !sessionResult.ok) return sessionResult;
        var session = sessionResult.session;
        if (session.scriptId !== request.scriptId) return failure("SDK_SESSION_MISMATCH", "SDK request belongs to another script.");
        return validateInvocationLifecycle(session, token, invocationGeneration).then(function (context) {
          if (!context.ok) return context;
          return permission.validateRuntimeToken(token, {
            scriptId: session.scriptId,
            sdkVersion: session.sdkVersion,
            capability: parsed.capability,
            origin: session.origin,
            codeHash: session.codeHash,
            fingerprint: session.grantFingerprint
          }).then(function (authorized) {
            if (!authorized || !authorized.ok) return authorized;
            return featureGate.check(featureFor(request.method, parsed.capability)).then(function (gate) {
              if (!gate || gate.allowed !== true) return failure("FEATURE_NOT_AVAILABLE", gate && (gate.reason || gate.error) || "SDK feature is unavailable.");
              return validateInvocationLifecycle(session, token, invocationGeneration).then(function (latestContext) {
                if (!latestContext.ok) return latestContext;
                return dispatch(request.method, request.args, Object.assign({}, session, { runtimeToken: token }));
              });
            });
          });
        });
      }).catch(function (error) {
        return error && error.ok === false ? error : failure("SDK_INVOKE_FAILED", error && error.message || String(error));
      });
    }

    function getSessionStatus(token) {
      return getSession(token).then(function (result) {
        if (!result.ok) return result;
        if (lifecycleBlocksSession(result.session, token)) return lifecycleFailure();
        return { ok: true, active: true, scriptId: result.session.scriptId, origin: result.session.origin, tabId: result.session.tabId, persistent: true };
      });
    }

    function pruneSessionsNow() {
      return enqueueSessionMutation(function () {
        return readSessions().then(function (sessions) {
          var next = Object.assign({}, sessions || {});
          var keys = Object.keys(next);
          return Promise.all(keys.map(function (token) {
            var session = next[token];
            if (!validStoredSession(session)) return sessionEntry(token, session);
            if (lifecycleBlocksSession(session, token)) return sessionEntry(token, session);
            if (session.tabId === null) return null;
            if (typeof validateContext !== "function") return sessionEntry(token, session);
            return Promise.resolve().then(function () {
              return validateContext(session);
            }).then(function (validated) {
              return validated && validated.ok === true ? null : sessionEntry(token, session);
            }, function () {
              return sessionEntry(token, session);
            });
          })).then(function (candidates) {
            var invalid = candidates.filter(Boolean);
            invalid.forEach(function (entry) { delete next[entry.token]; });
            if (!invalid.length) return { ok: true, removed: 0, revoked: 0 };
            return writeSessions(next).then(function (saved) {
              return cleanupSessionEntries(invalid).then(function (cleanup) {
                var result = closeSessionBatchResult({}, invalid, cleanup, saved);
                result.removed = result.closed;
                delete result.closed;
                return result;
              });
            });
          });
        });
      }).catch(function (error) {
        return failure("SDK_SESSION_PRUNE_FAILED", error && error.message || String(error));
      });
    }

    function pruneSessions() {
      return enqueueSessionPreparation(pruneSessionsNow);
    }

    function closeAllSessionsNow() {
      return enqueueSessionMutation(function () {
        return Promise.resolve(permission.revokeAllRuntimeTokens()).then(function (tokenResult) {
          if (!tokenResult || tokenResult.ok === false) {
            return withBookCleanup({ all: true }, tokenResult || failure("SDK_TOKEN_REVOKE_FAILED", "SDK runtime tokens could not be revoked."));
          }
          return writeSessions({}).then(function (saved) {
            var result = saved && saved.ok === false ? saved : { ok: true, revoked: Number(tokenResult.revoked || 0) };
            return withBookCleanup({ all: true }, result);
          });
        });
      }).catch(function (error) {
        return failure("SDK_SESSION_CLOSE_FAILED", error && error.message || String(error));
      });
    }

    function closeAllSessions() {
      var tombstone = markLifecycleRevocation(function () { return true; });
      return enqueueSessionPreparation(function () {
        return closeAllSessionsNow().then(function (result) {
          return releaseLifecycleTombstone(tombstone, result);
        });
      });
    }

    function deleteScriptLifecycleNow(scriptId) {
      return enqueueSessionMutation(function () {
        return Promise.all([
          Promise.resolve(permission.revoke(scriptId)),
          Promise.resolve(sdkStorage.clearScript(scriptId))
        ]).then(function (results) {
          return readSessions().then(function (sessions) {
            var next = Object.assign({}, sessions || {});
            Object.keys(next).forEach(function (token) {
              if (next[token] && next[token].scriptId === scriptId) delete next[token];
            });
            return writeSessions(next).then(function (saved) {
              var failed = results.find(function (result) { return !result || result.ok === false; });
              var result = saved && saved.ok === false
                ? saved
                : (failed || { ok: true, scriptId: scriptId, deleted: true });
              return withBookCleanup({ scriptId: scriptId }, result);
            });
          });
        });
      }).catch(function (error) {
        return failure("SDK_SCRIPT_DELETE_FAILED", error && error.message || String(error));
      });
    }

    function deleteScriptLifecycle(scriptId) {
      var tombstone = markLifecycleRevocation(function (session) {
        return !!session && session.scriptId === scriptId;
      });
      return enqueueSessionPreparation(function () {
        return deleteScriptLifecycleNow(scriptId).then(function (result) {
          return releaseLifecycleTombstone(tombstone, result);
        });
      });
    }

    return Object.freeze({
      prepareSession: prepareSession,
      invoke: invoke,
      closeSession: closeSession,
      closeSessionsForTab: closeSessionsForTab,
      closeSessionsForOrigins: closeSessionsForOrigins,
      closeAllSessions: closeAllSessions,
      deleteScriptLifecycle: deleteScriptLifecycle,
      getSessionStatus: getSessionStatus,
      pruneSessions: pruneSessions
    });
  }

  global.WinSpeedBallSdkService = Object.freeze({ create: create });
})(self);
