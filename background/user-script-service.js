(function (global) {
  "use strict";

  var REGISTERED_PREFIX = "wsb-user-";
  var WORLD_PREFIX = "wsb_world_";
  var MAX_CODE_LENGTH = 200000;
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

  function safePart(value) {
    return String(value || "script").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 48) || "script";
  }

  function registrationId(script) {
    return REGISTERED_PREFIX + safePart(script && script.id);
  }

  function worldId(scriptId) {
    return WORLD_PREFIX + safePart(scriptId);
  }

  function prepareWorld(scriptId) {
    return chrome.userScripts.configureWorld({
      worldId: worldId(scriptId),
      messaging: true,
      csp: "script-src 'self'; object-src 'none'"
    });
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

  function publicWsbFacade(code) {
    if (declaredCapabilities(code).indexOf("video.read") < 0) return "";
    return [
      "var WSB=Object.freeze({",
      "version:'0.1.0-beta',",
      "video:Object.freeze({",
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
    return !!script && script.enabled !== false && script.permissionConfirmed === true && typeof script.code === "string" && script.code.length > 0 && script.code.length <= MAX_CODE_LENGTH && Array.isArray(script.grantedOrigins) && script.grantedOrigins.length > 0 && Array.isArray(permissions) && permissions.length > 0;
  }

  function buildRegistration(script) {
    return {
      id: registrationId(script),
      matches: script.grantedOrigins.slice(),
      js: [{ code: wrapCode(script.code, script.meta || {}, true) }],
      allFrames: true,
      runAt: normalizeRunAt(script.meta && script.meta.runAt),
      world: "USER_SCRIPT",
      worldId: worldId(script.id)
    };
  }

  function syncNow(scripts) {
    scripts = Array.isArray(scripts) ? scripts : [];
    return ensureAvailable().then(function (registered) {
      var existingIds = new Set((registered || []).map(function (script) { return script.id; }).filter(function (id) { return id.indexOf(REGISTERED_PREFIX) === 0; }));
      var eligible = scripts.filter(validStoredScript);
      var desired = eligible.map(buildRegistration);
      var desiredIds = new Set(desired.map(function (script) { return script.id; }));
      var removeIds = Array.from(existingIds).filter(function (id) { return !desiredIds.has(id); });
      var updateScripts = desired.filter(function (script) { return existingIds.has(script.id); });
      var newScripts = desired.filter(function (script) { return !existingIds.has(script.id); });
      return Promise.all(eligible.map(function (script) { return prepareWorld(script.id); })).then(function () {
        return removeIds.length ? chrome.userScripts.unregister({ ids: removeIds }) : undefined;
      }).then(function () {
        if (!updateScripts.length) return;
        if (typeof chrome.userScripts.update === "function") return chrome.userScripts.update(updateScripts);
        return chrome.userScripts.unregister({ ids: updateScripts.map(function (script) { return script.id; }) }).then(function () {
          return chrome.userScripts.register(updateScripts);
        });
      }).then(function () {
        return newScripts.length ? chrome.userScripts.register(newScripts) : undefined;
      }).then(function () {
        return { available: true, registered: eligible.length };
      });
    });
  }

  function sync(scripts) {
    var snapshot = JSON.parse(JSON.stringify(Array.isArray(scripts) ? scripts : []));
    var result = syncQueue.then(function () { return syncNow(snapshot); }, function () { return syncNow(snapshot); });
    syncQueue = result.then(function () {}, function () {});
    return result;
  }

  function execute(scriptId, code, tabId) {
    code = String(code || "");
    if (!code.trim() || code.length > MAX_CODE_LENGTH) return Promise.reject(new Error("脚本为空或超过大小限制。"));
    return ensureAvailable().then(function () {
      return prepareWorld(scriptId);
    }).then(function () {
      return chrome.userScripts.execute({
        target: { tabId: tabId, allFrames: false },
        js: [{ code: wrapCode(code, {}, false) }],
        world: "USER_SCRIPT",
        worldId: worldId(scriptId),
        injectImmediately: true
      });
    }).then(function (results) {
      var failed = (results || []).find(function (result) { return result && result.error; });
      if (failed) throw new Error(failed.error);
      return { ok: true };
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
