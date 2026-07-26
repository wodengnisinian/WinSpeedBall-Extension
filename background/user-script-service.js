(function (global) {
  "use strict";

  var REGISTERED_PREFIX = "wsb-user-";
  var WORLD_PREFIX = "wsb_world_";
  var MAX_CODE_LENGTH = 200000;
  var ALLOWED_PERMISSIONS = ["dom", "network", "automation"];
  var syncQueue = Promise.resolve();

  function disabledError() {
    var error = new Error("请开启浏览器要求的用户脚本开关或开发者模式，然后重新加载扩展。");
    error.code = "USER_SCRIPTS_DISABLED";
    return error;
  }

  function ensureAvailable() {
    if (!chrome.userScripts || typeof chrome.userScripts.getScripts !== "function") return Promise.reject(disabledError());
    return chrome.userScripts.getScripts().catch(function () { throw disabledError(); });
  }

  function hashPart(value, seed) {
    var hash = seed >>> 0;
    var source = String(value || "");
    for (var index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return ("00000000" + (hash >>> 0).toString(16)).slice(-8);
  }

  function safePart(value) {
    var source = String(value || "script");
    var normalized = source.replace(/[^a-zA-Z0-9_-]/g, "-") || "script";
    if (normalized === source && normalized.length <= 48) return normalized;
    var suffix = hashPart(source, 2166136261) + hashPart(source, 2654435769);
    return normalized.slice(0, 31) + "-" + suffix;
  }

  function registrationId(script) {
    return REGISTERED_PREFIX + safePart(script && script.id);
  }

  function worldBoundary(code, permissions) {
    var normalized = normalizePermissions(permissions) || [];
    return {
      network: normalized.indexOf("network") >= 0,
      messaging: declaredCapabilities(code).indexOf("video.read") >= 0
    };
  }

  function worldId(scriptId, code, permissions) {
    var boundary = worldBoundary(code, permissions);
    return WORLD_PREFIX + safePart(scriptId) +
      "_n" + (boundary.network ? "1" : "0") +
      "_m" + (boundary.messaging ? "1" : "0") +
      "_c" + hashPart(code, 2166136261) + hashPart(code, 2654435769);
  }

  function registeredWorldId(registration) {
    if (registration && typeof registration.worldId === "string" && registration.worldId) {
      return registration.worldId;
    }
    var suffix = String(registration && registration.id || "").slice(REGISTERED_PREFIX.length);
    return suffix ? WORLD_PREFIX + suffix : "";
  }

  function declaredCapabilities(code) {
    var capabilities = [];
    String(code || "").split(/\r?\n/).forEach(function (line) {
      var match = line.match(/^\s*\/\/\s*@wsb-capability\s+([^\s]+)\s*$/i);
      if (!match) return;
      var capability = String(match[1] || "").trim().toLowerCase();
      if (capability && capabilities.indexOf(capability) < 0) capabilities.push(capability);
    });
    return capabilities;
  }

  function declaredPermissions(code) {
    var permissions = [];
    String(code || "").split(/\r?\n/).forEach(function (line) {
      var match = line.match(/^\s*\/\/\s*@permission\s+([^\s]+)\s*$/i);
      if (!match) return;
      var permission = String(match[1] || "").trim().toLowerCase();
      if (permission && permissions.indexOf(permission) < 0) permissions.push(permission);
    });
    return permissions;
  }

  function normalizePermissions(value) {
    if (!Array.isArray(value) || !value.length) return null;
    var permissions = [];
    for (var index = 0; index < value.length; index += 1) {
      if (typeof value[index] !== "string") return null;
      var permission = value[index].trim().toLowerCase();
      if (!permission || ALLOWED_PERMISSIONS.indexOf(permission) < 0 || permissions.indexOf(permission) >= 0) return null;
      permissions.push(permission);
    }
    if (permissions.indexOf("dom") < 0) return null;
    return permissions.sort();
  }

  function permissionSignature(value) {
    var permissions = normalizePermissions(value);
    return permissions ? permissions.join(",") : "";
  }

  function matchesDeclaredPermissions(code, permissions) {
    var storedSignature = permissionSignature(permissions);
    var declaredSignature = permissionSignature(declaredPermissions(code));
    return !!storedSignature && storedSignature === declaredSignature;
  }

  function permissionError() {
    var error = new Error("普通用户脚本必须声明 dom 基础权限，且只能按需叠加 network 或 automation。");
    error.code = "USER_SCRIPT_PERMISSION_INVALID";
    return error;
  }

  function prepareWorld(scriptId, code, permissions) {
    var normalized = normalizePermissions(permissions);
    if (!normalized || !matchesDeclaredPermissions(code, normalized)) return Promise.reject(permissionError());
    var boundary = worldBoundary(code, normalized);
    return chrome.userScripts.configureWorld({
      worldId: worldId(scriptId, code, normalized),
      messaging: boundary.messaging,
      csp: "script-src 'self'; object-src 'none'; connect-src " +
        (boundary.network ? "http: https: ws: wss:" : "'none'")
    });
  }

  function lockRegisteredWorld(registration) {
    var oldWorldId = registeredWorldId(registration);
    if (!oldWorldId) return Promise.resolve();
    return chrome.userScripts.configureWorld({
      worldId: oldWorldId,
      messaging: false,
      csp: "script-src 'self'; object-src 'none'; connect-src 'none'"
    });
  }

  function publicWsbFacade(code) {
    if (declaredCapabilities(code).indexOf("video.read") < 0) return "";
    return [
      "var WSB=Object.freeze({",
      "version:'3.7.0-beta',",
      "video:Object.freeze({",
      "status:function(){return chrome.runtime.sendMessage({channel:'WSB_USER_SCRIPT_BRIDGE',version:1,action:'GET_VIDEO_STATUS'});},",
      "getStatus:function(){return chrome.runtime.sendMessage({channel:'WSB_USER_SCRIPT_BRIDGE',version:1,action:'GET_VIDEO_STATUS'});}",
      "})",
      "});"
    ].join("");
  }

  function wrapCode(code, meta, guardUrl) {
    code = String(code || "");
    var guard = "";
    if (guardUrl) {
      var matches = (meta && meta.matches || []).concat(meta && meta.includes || []);
      var excludes = meta && meta.excludes || [];
      guard = [
        "var __wsbUrl=location.href;",
        "var __wsbMatches=" + JSON.stringify(matches) + ";",
        "var __wsbExcludes=" + JSON.stringify(excludes) + ";",
        "function __wsbMatch(pattern,url){if(pattern==='<all_urls>')return true;var escaped=String(pattern||'').replace(/[.+?^${}()|[\\]\\\\]/g,'\\\\$&').replace(/\\*/g,'.*');try{return new RegExp('^'+escaped+'$').test(url);}catch(e){return false;}}",
        "if(!__wsbMatches.length||__wsbExcludes.some(function(p){return __wsbMatch(p,__wsbUrl);})||!__wsbMatches.some(function(p){return __wsbMatch(p,__wsbUrl);}))return;"
      ].join("");
    }
    return "(function(){" + guard + publicWsbFacade(code) + "try{\n" + code + "\n}catch(error){console.error('WinSpeedBall user script failed',error);throw error;}})();";
  }

  function normalizeRunAt(value) {
    value = String(value || "").toLowerCase().replace(/-/g, "_");
    return ["document_start", "document_end", "document_idle"].indexOf(value) >= 0 ? value : "document_idle";
  }

  function validStoredScript(script) {
    var permissions = script && script.meta && script.meta.permissions;
    var signature = permissionSignature(permissions);
    return !!script &&
      script.enabled !== false &&
      script.permissionConfirmed === true &&
      typeof script.code === "string" &&
      script.code.length > 0 &&
      script.code.length <= MAX_CODE_LENGTH &&
      Array.isArray(script.grantedOrigins) &&
      script.grantedOrigins.length > 0 &&
      !!signature &&
      script.permissionSignature === signature &&
      matchesDeclaredPermissions(script.code, permissions);
  }

  function buildRegistration(script) {
    return {
      id: registrationId(script),
      matches: script.grantedOrigins.slice(),
      js: [{ code: wrapCode(script.code, script.meta || {}, true) }],
      allFrames: true,
      runAt: normalizeRunAt(script.meta && script.meta.runAt),
      world: "USER_SCRIPT",
      worldId: worldId(script.id, script.code, script.meta.permissions)
    };
  }

  function syncNow(scripts) {
    scripts = Array.isArray(scripts) ? scripts : [];
    return ensureAvailable().then(function (registered) {
      var existing = new Map((registered || []).filter(function (script) {
        return script && typeof script.id === "string" && script.id.indexOf(REGISTERED_PREFIX) === 0;
      }).map(function (script) {
        return [script.id, script];
      }));
      var existingIds = new Set(existing.keys());
      var eligible = scripts.filter(validStoredScript);
      var desired = eligible.map(buildRegistration);
      var desiredIds = new Set(desired.map(function (script) { return script.id; }));
      var removeIds = Array.from(existingIds).filter(function (id) { return !desiredIds.has(id); });
      var updateScripts = desired.filter(function (script) { return existingIds.has(script.id); });
      var newScripts = desired.filter(function (script) { return !existingIds.has(script.id); });
      var removedRegistrations = removeIds.map(function (id) { return existing.get(id); });
      var replacedWorlds = updateScripts.map(function (script) {
        return existing.get(script.id);
      }).filter(function (oldRegistration, index) {
        return registeredWorldId(oldRegistration) !== updateScripts[index].worldId;
      });
      return Promise.all(
        eligible.map(function (script) {
          return prepareWorld(script.id, script.code, script.meta.permissions);
        }).concat(removedRegistrations.map(lockRegisteredWorld))
      ).then(function () {
        return removeIds.length ? chrome.userScripts.unregister({ ids: removeIds }) : undefined;
      }).then(function () {
        if (!updateScripts.length) return;
        if (typeof chrome.userScripts.update === "function") return chrome.userScripts.update(updateScripts);
        return chrome.userScripts.unregister({ ids: updateScripts.map(function (script) { return script.id; }) }).then(function () {
          return chrome.userScripts.register(updateScripts);
        });
      }).then(function () {
        return Promise.all(replacedWorlds.map(lockRegisteredWorld));
      }).then(function () {
        return newScripts.length ? chrome.userScripts.register(newScripts) : undefined;
      }).then(function () {
        return { available: true, registered: eligible.length };
      });
    });
  }

  function enqueue(task) {
    var result = syncQueue.then(task, task);
    syncQueue = result.then(function () {}, function () {});
    return result;
  }

  function sync(scripts) {
    var snapshot = JSON.parse(JSON.stringify(Array.isArray(scripts) ? scripts : []));
    return enqueue(function () { return syncNow(snapshot); });
  }

  function executeNow(scriptId, code, permissions, tabId) {
    code = String(code || "");
    if (!code.trim() || code.length > MAX_CODE_LENGTH) return Promise.reject(new Error("脚本为空或超过大小限制。"));
    if (!matchesDeclaredPermissions(code, permissions)) return Promise.reject(permissionError());
    return ensureAvailable().then(function () {
      return prepareWorld(scriptId, code, permissions);
    }).then(function () {
      return chrome.userScripts.execute({
        target: { tabId: tabId, allFrames: false },
        js: [{ code: wrapCode(code, {}, false) }],
        world: "USER_SCRIPT",
        worldId: worldId(scriptId, code, permissions),
        injectImmediately: true
      });
    }).then(function (results) {
      var failed = (results || []).find(function (result) { return result && result.error; });
      if (failed) throw new Error(failed.error);
      return { ok: true };
    });
  }

  function execute(scriptId, code, permissions, tabId) {
    var codeSnapshot = String(code || "");
    var permissionSnapshot = Array.isArray(permissions) ? permissions.slice() : permissions;
    return enqueue(function () {
      return executeNow(scriptId, codeSnapshot, permissionSnapshot, tabId);
    });
  }

  function getStatus() {
    return ensureAvailable().then(function (scripts) {
      return { available: true, registered: (scripts || []).filter(function (script) { return script.id.indexOf(REGISTERED_PREFIX) === 0; }).length };
    }).catch(function (error) {
      return { available: false, registered: 0, code: error.code || "USER_SCRIPTS_DISABLED", error: error.message || String(error) };
    });
  }

  global.WinSpeedBallUserScriptService = {
    execute: execute,
    getStatus: getStatus,
    sync: sync
  };
})(self);
