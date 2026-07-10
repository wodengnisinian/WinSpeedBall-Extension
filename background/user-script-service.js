(function (global) {
  "use strict";

  var REGISTERED_PREFIX = "wsb-user-";
  var WORLD_PREFIX = "wsb_world_";
  var MAX_CODE_LENGTH = 200000;

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
      messaging: false,
      csp: "script-src 'self'; object-src 'none'"
    });
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
    return "(function(){" + guard + "try{\n" + code + "\n}catch(error){console.error('WinSpeedBall user script failed',error);throw error;}})();";
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

  function sync(scripts) {
    scripts = Array.isArray(scripts) ? scripts : [];
    return ensureAvailable().then(function (registered) {
      var oldIds = (registered || []).map(function (script) { return script.id; }).filter(function (id) { return id.indexOf(REGISTERED_PREFIX) === 0; });
      var remove = oldIds.length ? chrome.userScripts.unregister({ ids: oldIds }) : Promise.resolve();
      return remove.then(function () {
        var eligible = scripts.filter(validStoredScript);
        if (!eligible.length) return { available: true, registered: 0 };
        return Promise.all(eligible.map(function (script) { return prepareWorld(script.id); })).then(function () {
          return chrome.userScripts.register(eligible.map(buildRegistration));
        }).then(function () {
          return { available: true, registered: eligible.length };
        });
      });
    });
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
