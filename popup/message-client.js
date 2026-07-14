(function (global) {
  "use strict";

  var requestSequence = 0;

  function send(message) {
    return new Promise(function (resolve) {
      message = message || {};
      var payload = {};
      if (Object.prototype.hasOwnProperty.call(message, "payload")) {
        payload = message.payload && typeof message.payload === "object" ? message.payload : {};
      } else {
        Object.keys(message).forEach(function (key) {
          if (key !== "action") payload[key] = message[key];
        });
      }
      chrome.runtime.sendMessage({
        version: 1,
        action: String(message.action || ""),
        source: "popup",
        requestId: "popup-" + Date.now() + "-" + (++requestSequence),
        payload: payload
      }, function (response) {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        var result = response || { ok: false, error: "扩展后台无响应" };
        if (result.ok === false && (result.error === "Unknown action." || result.error === "Unsupported message version.")) {
          resolve({
            ok: false,
            code: "BACKGROUND_RELOAD_REQUIRED",
            error: "扩展后台仍是旧版本，请重新加载扩展后再打开弹窗。"
          });
          return;
        }
        resolve(result);
      });
    });
  }

  function getCurrentSiteAccess() {
    return send({ action: "getActiveSiteAccess" }).then(function (site) {
      if (!site || !site.ok || !site.originPattern) {
        return { ok: false, error: site && site.error || "当前页面不支持网站授权。" };
      }
      return site;
    });
  }

  function ensureSiteAccess(site) {
    if (!site || !site.ok) return Promise.resolve(site || { ok: false, error: "当前页面不支持网站授权。" });
    if (site.granted) return Promise.resolve(site);
    return new Promise(function (resolve) {
      chrome.permissions.contains({ origins: [site.originPattern] }, function (contains) {
        var containsError = chrome.runtime.lastError && chrome.runtime.lastError.message;
        if (containsError) { resolve({ ok: false, error: containsError }); return; }
        if (contains) { site.granted = true; resolve(site); return; }
        chrome.permissions.request({ origins: [site.originPattern] }, function (granted) {
          var error = chrome.runtime.lastError && chrome.runtime.lastError.message;
          if (!granted || error) {
            resolve({ ok: false, error: error || "用户未授权当前网站。" });
            return;
          }
          site.granted = true;
          resolve(site);
        });
      });
    });
  }

  function requestCurrentSiteAccess() {
    return getCurrentSiteAccess().then(ensureSiteAccess);
  }

  function originPatternFromUrl(url) {
    try {
      var parsed = new URL(String(url || ""));
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
      return parsed.protocol + "//" + parsed.hostname + "/*";
    } catch (error) { return ""; }
  }

  function discoverMediaFrameOrigins(tabId, currentOriginPattern) {
    return new Promise(function (resolve) {
      if (!chrome.scripting || typeof chrome.scripting.executeScript !== "function") { resolve([]); return; }
      try {
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: function () {
            return Array.prototype.slice.call(document.querySelectorAll("iframe,frame")).filter(function (frame) {
              var rect = frame.getBoundingClientRect ? frame.getBoundingClientRect() : { width: 0, height: 0 };
              var semantic = [frame.id, frame.className, frame.name, frame.title, frame.getAttribute("allow")].join(" ");
              return Math.max(0, rect.width) * Math.max(0, rect.height) >= 24000 || /(video|player|course|lesson|media|autoplay|fullscreen)/i.test(semantic);
            }).map(function (frame) { return String(frame.src || frame.getAttribute("src") || ""); }).filter(Boolean).slice(0, 12);
          }
        }, function (results) {
          if (chrome.runtime.lastError) { resolve([]); return; }
          var patterns = [];
          (results || []).forEach(function (entry) {
            (Array.isArray(entry && entry.result) ? entry.result : []).forEach(function (url) {
              var pattern = originPatternFromUrl(url);
              if (pattern && pattern !== currentOriginPattern && patterns.indexOf(pattern) < 0) patterns.push(pattern);
            });
          });
          resolve(patterns);
        });
      } catch (error) { resolve([]); }
    });
  }

  function registerMediaPreload(originPatterns) {
    return new Promise(function (resolve) {
      var scripting = chrome.scripting;
      if (!scripting || typeof scripting.getRegisteredContentScripts !== "function" || typeof scripting.registerContentScripts !== "function") {
        resolve(false);
        return;
      }
      var id = "winspeedball-media-preload";
      var matches = Array.from(new Set((originPatterns || []).filter(Boolean))).sort();
      if (!matches.length) { resolve(false); return; }
      var definition = {
        id: id,
        matches: matches,
        js: ["shadow_hook.js", "content/media-core-main.js"],
        runAt: "document_start",
        allFrames: true,
        persistAcrossSessions: true,
        world: "MAIN"
      };
      scripting.getRegisteredContentScripts({ ids: [id] }, function (scripts) {
        var readError = chrome.runtime.lastError && chrome.runtime.lastError.message;
        if (readError) { resolve(false); return; }
        var existing = scripts && scripts[0];
        var merged = existing && Array.isArray(existing.matches)
          ? Array.from(new Set(existing.matches.concat(matches))).sort()
          : matches;
        definition.matches = merged;
        var finish = function () { resolve(!(chrome.runtime.lastError && chrome.runtime.lastError.message)); };
        if (existing && typeof scripting.updateContentScripts === "function") scripting.updateContentScripts([definition], finish);
        else scripting.registerContentScripts([definition], finish);
      });
    });
  }

  function ensureMediaAccess(site) {
    if (!site || !site.ok) return Promise.resolve(site || { ok: false, error: "当前页面不可控制。" });
    return discoverMediaFrameOrigins(site.tabId, site.originPattern).then(function (frameOrigins) {
      var requested = [site.originPattern].concat(frameOrigins);
      return new Promise(function (resolve) {
        chrome.permissions.contains({ origins: requested }, function (contains) {
          var containsError = chrome.runtime.lastError && chrome.runtime.lastError.message;
          if (containsError || contains) {
            registerMediaPreload(contains ? requested : []).then(function (registered) {
              resolve(Object.assign({}, site, { ok: !containsError && contains, granted: contains, frameOrigins: frameOrigins, frameAccessGranted: contains, preloadRegistered: registered, error: containsError || "" }));
            });
            return;
          }
          chrome.permissions.request({ origins: requested }, function (granted) {
            var requestError = chrome.runtime.lastError && chrome.runtime.lastError.message;
            var allowed = !requestError && granted;
            registerMediaPreload(allowed ? requested : []).then(function (registered) {
              resolve(Object.assign({}, site, {
                ok: allowed,
                granted: allowed,
                frameOrigins: frameOrigins,
                frameAccessGranted: allowed,
                preloadRegistered: registered,
                error: allowed ? "" : requestError || "未授权访问当前视频页面。",
                mediaAccessWarning: allowed ? "" : "跨域视频框架未授权，部分视频仍可能无法控制。"
              }));
            });
          });
        });
      });
    });
  }

  function isLoopbackHostname(hostname) {
    var normalized = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
    return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
  }

  function getServiceOriginPattern(baseUrl) {
    var parsed;
    try {
      parsed = new URL(String(baseUrl || "").trim());
    } catch (error) {
      return { ok: false, error: "Base URL 格式不正确。" };
    }
    if (parsed.username || parsed.password) {
      return { ok: false, error: "Base URL 不能包含用户名或密码。" };
    }
    if (parsed.search || parsed.hash) {
      return { ok: false, error: "Base URL 不能包含查询参数或锚点。" };
    }
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname))) {
      return { ok: false, error: "Base URL 必须使用 HTTPS；只有本机服务可以使用 HTTP。" };
    }
    return {
      ok: true,
      origin: parsed.origin,
      originPattern: parsed.protocol + "//" + parsed.hostname + "/*"
    };
  }

  function ensureServiceOrigin(baseUrl) {
    var service = getServiceOriginPattern(baseUrl);
    if (!service.ok) return Promise.resolve(service);
    if (!chrome.permissions || typeof chrome.permissions.contains !== "function" || typeof chrome.permissions.request !== "function") {
      return Promise.resolve({ ok: false, error: "当前浏览器不支持 AI 服务地址授权。" });
    }
    return new Promise(function (resolve) {
      chrome.permissions.contains({ origins: [service.originPattern] }, function (contains) {
        var containsError = chrome.runtime.lastError && chrome.runtime.lastError.message;
        if (containsError) {
          resolve({ ok: false, error: containsError });
          return;
        }
        if (contains) {
          resolve({ ok: true, granted: true, origin: service.origin, originPattern: service.originPattern });
          return;
        }
        chrome.permissions.request({ origins: [service.originPattern] }, function (granted) {
          var requestError = chrome.runtime.lastError && chrome.runtime.lastError.message;
          if (!granted || requestError) {
            resolve({ ok: false, error: requestError || "未授权访问该 AI 服务地址。" });
            return;
          }
          resolve({ ok: true, granted: true, origin: service.origin, originPattern: service.originPattern });
        });
      });
    });
  }

  global.WinSpeedBallPopupMessageClient = {
    send: send,
    getCurrentSiteAccess: getCurrentSiteAccess,
    ensureSiteAccess: ensureSiteAccess,
    requestCurrentSiteAccess: requestCurrentSiteAccess,
    ensureMediaAccess: ensureMediaAccess,
    discoverMediaFrameOrigins: discoverMediaFrameOrigins,
    registerMediaPreload: registerMediaPreload,
    getServiceOriginPattern: getServiceOriginPattern,
    ensureServiceOrigin: ensureServiceOrigin
  };
})(self);
