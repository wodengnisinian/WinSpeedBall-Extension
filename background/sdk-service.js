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
    var callAi = dependencies.callAi;
    var getLatestOcr = dependencies.getLatestOcr;
    var readSessions = dependencies.readSessions;
    var writeSessions = dependencies.writeSessions;
    var sessionMutationQueue = Promise.resolve();

    function enqueueSessionMutation(task) {
      var result = sessionMutationQueue.then(task, task);
      sessionMutationQueue = result.then(function () {}, function () {});
      return result;
    }

    function failure(code, error, extra) {
      return Object.assign({ ok: false, code: code, error: error }, extra || {});
    }

    function normalizeCapabilities(values) {
      return contracts.normalizeCapabilities(values).slice().sort();
    }

    function sameList(left, right) {
      return left.length === right.length && left.every(function (value, index) { return value === right[index]; });
    }

    function featureFor(method, capability) {
      if (capability.indexOf("video.") === 0) return "video.basic";
      if (capability === "ocr.read") return "ocr.basic";
      if (capability === "ai.request") return method === "ai.summary" ? "ai.summary" : "ai.basic";
      return "sdk.developer";
    }

    function ensureDeveloperMode() {
      return developerMode.getStatus().then(function (status) {
        return status && status.ok && status.enabled
          ? { ok: true }
          : failure("DEVELOPER_MODE_REQUIRED", "Developer Mode is not enabled.");
      });
    }

    function saveSession(tokenResult, grantResult, context) {
      return enqueueSessionMutation(function () { return readSessions().then(function (sessions) {
        var next = Object.assign({}, sessions || {});
        next[tokenResult.token] = {
          scriptId: grantResult.grant.scriptId,
          tabId: Number.isInteger(context.tabId) ? context.tabId : null,
          origin: context.origin,
          url: context.url || context.origin,
          sdkVersion: grantResult.grant.sdkVersion,
          codeHash: grantResult.grant.codeHash,
          grantFingerprint: grantResult.grant.fingerprint,
          issuedAt: tokenResult.issuedAt,
          expiresAt: tokenResult.expiresAt
        };
        return writeSessions(next).then(function (saved) {
          return saved && saved.ok === false ? saved : { ok: true, session: next[tokenResult.token] };
        });
      }); }).catch(function (error) {
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
      return ensureDeveloperMode().then(function (mode) {
        if (!mode.ok) return mode;
        return consumeContext(input.contextNonce, requested);
      }).then(function (context) {
        if (!context || context.ok === false) return context || failure("SDK_CONTEXT_UNAVAILABLE", "SDK context is unavailable.");
        var binding = {
          scriptId: input.scriptId,
          code: input.code,
          capabilities: requested,
          originScope: [context.originPattern],
          sdkVersion: contracts.SDK_VERSION
        };
        return permission.grant(binding).then(function (granted) {
          if (!granted.ok) return granted;
          return permission.createRuntimeToken(binding).then(function (tokenResult) {
            if (!tokenResult.ok) return tokenResult;
            return saveSession(tokenResult, granted, context).then(function (saved) {
              if (!saved.ok) {
                return Promise.resolve(permission.revokeRuntimeToken(tokenResult.token)).then(function () { return saved; });
              }
              return {
                ok: true,
                sessionToken: tokenResult.token,
                scriptId: input.scriptId,
                sdkVersion: contracts.SDK_VERSION,
                grantFingerprint: granted.grant.fingerprint,
                codeHash: granted.grant.codeHash,
                capabilities: granted.grant.capabilities,
                origin: context.origin,
                originScope: granted.grant.originScope,
                tabId: saved.session.tabId,
                issuedAt: tokenResult.issuedAt,
                expiresAt: tokenResult.expiresAt
              };
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
        if (!session) return failure("SDK_SESSION_NOT_FOUND", "SDK session is missing or expired.");
        if (session.expiresAt <= Date.now()) return closeSession(token).then(function () { return failure("SDK_TOKEN_EXPIRED", "SDK session has expired."); });
        return { ok: true, session: session };
      });
    }

    function closeSession(token) {
      return enqueueSessionMutation(function () { return Promise.resolve(permission.revokeRuntimeToken(token)).then(function (tokenResult) {
        if (!tokenResult || tokenResult.ok === false) return tokenResult || failure("SDK_TOKEN_REVOKE_FAILED", "SDK runtime token could not be revoked.");
        return readSessions().then(function (sessions) {
          var next = Object.assign({}, sessions || {});
          var revoked = Object.prototype.hasOwnProperty.call(next, token);
          delete next[token];
          return writeSessions(next).then(function (saved) {
            return saved && saved.ok === false ? saved : { ok: true, revoked: revoked || tokenResult.revoked === true };
          });
        });
      }); }).catch(function (error) {
        return failure("SDK_SESSION_CLOSE_FAILED", error && error.message || String(error));
      });
    }

    function control(session, command) {
      if (!Number.isInteger(session.tabId)) return Promise.resolve(failure("SDK_TAB_REQUIRED", "This SDK method requires an authorized web page."));
      return validateContext(session).then(function (validated) {
        if (!validated || validated.ok === false) return validated || failure("SDK_CONTEXT_CLOSED", "The SDK page context is closed.");
        return new Promise(function (resolve) { controlTab(session.tabId, command, resolve); });
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

    function dispatchVideo(method, args, session) {
      var command = { type: "GET_STATUS" };
      if (method === "video.getAll" || method === "video.current") command = { type: "GET_MEDIA_LIST" };
      else if (method === "video.setRate") command = { type: "SET_RATE", rate: args[0] };
      else if (method === "video.setVolume") command = { type: "SET_VOLUME", volume: args[0] };
      else if (method === "video.mute") command = { type: "SET_MUTED", muted: args[0] };
      else if (method === "video.play") command = { type: "PLAY" };
      else if (method === "video.pause") command = { type: "PAUSE" };
      return control(session, command).then(function (result) {
        if (!result || !result.ok) return result || failure("SDK_VIDEO_FAILED", "Video operation failed.");
        if (method === "video.getAll") return { ok: true, value: (result.media || []).map(normalizeVideo) };
        if (method === "video.current") {
          var list = (result.media || []).slice().sort(function (left, right) {
            if (left.paused !== right.paused) return left.paused ? 1 : -1;
            return Number(right.duration || 0) - Number(left.duration || 0);
          });
          return { ok: true, value: list.length ? normalizeVideo(list[0]) : null };
        }
        return { ok: true, value: normalizeVideo(result) };
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

    function dispatchAi(method, args) {
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

    function dispatch(method, args, session) {
      if (method.indexOf("video.") === 0) return dispatchVideo(method, args, session);
      if (method.indexOf("page.") === 0) return dispatchPage(method, session);
      if (method.indexOf("ai.") === 0) return dispatchAi(method, args);
      if (method.indexOf("ocr.") === 0) return dispatchOcr(method);
      if (method === "storage.get") return sdkStorage.get(session.scriptId, args[0]).then(function (result) { return result.ok ? { ok: true, value: result.value } : result; });
      if (method === "storage.set") return sdkStorage.set(session.scriptId, args[0], args[1]).then(function (result) { return result.ok ? { ok: true, value: { key: result.key, bytesUsed: result.bytesUsed } } : result; });
      return Promise.resolve(failure("SDK_DEPENDENCY_NOT_READY", "SDK events are not connected yet."));
    }

    function invoke(token, request) {
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
            return dispatch(request.method, request.args, session);
          });
        });
      }).catch(function (error) {
        return error && error.ok === false ? error : failure("SDK_INVOKE_FAILED", error && error.message || String(error));
      });
    }

    function getSessionStatus(token) {
      return getSession(token).then(function (result) {
        if (!result.ok) return result;
        return { ok: true, active: true, scriptId: result.session.scriptId, origin: result.session.origin, tabId: result.session.tabId, expiresAt: result.session.expiresAt };
      });
    }

    function closeAllSessions() {
      return enqueueSessionMutation(function () {
        return Promise.resolve(permission.revokeAllRuntimeTokens()).then(function (tokenResult) {
          if (!tokenResult || tokenResult.ok === false) return tokenResult || failure("SDK_TOKEN_REVOKE_FAILED", "SDK runtime tokens could not be revoked.");
          return writeSessions({}).then(function (saved) {
            return saved && saved.ok === false ? saved : { ok: true, revoked: Number(tokenResult.revoked || 0) };
          });
        });
      }).catch(function (error) {
        return failure("SDK_SESSION_CLOSE_FAILED", error && error.message || String(error));
      });
    }

    function deleteScriptLifecycle(scriptId) {
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
              if (saved && saved.ok === false) return saved;
              var failed = results.find(function (result) { return !result || result.ok === false; });
              return failed || { ok: true, scriptId: scriptId, deleted: true };
            });
          });
        });
      }).catch(function (error) {
        return failure("SDK_SCRIPT_DELETE_FAILED", error && error.message || String(error));
      });
    }

    return Object.freeze({
      prepareSession: prepareSession,
      invoke: invoke,
      closeSession: closeSession,
      closeAllSessions: closeAllSessions,
      deleteScriptLifecycle: deleteScriptLifecycle,
      getSessionStatus: getSessionStatus
    });
  }

  global.WinSpeedBallSdkService = Object.freeze({ create: create });
})(self);
