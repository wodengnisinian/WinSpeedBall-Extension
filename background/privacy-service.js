(function (global) {
  "use strict";

  var storage = global.WinSpeedBallStorageService;
  var CATEGORIES = ["screenshots", "ocr", "ai", "logs", "scripts", "account"];
  var LOCAL_KEYS = [
    "manualCaptureDataUrl", "manualCaptureTime",
    "manualOcrText", "manualOcrSourceTime", "ocrJobSourceTime", "ocrJobStatus", "ocrJobProgress", "ocrJobStage", "ocrJobError", "ocrJobUpdatedAt",
    "aiQuestionHistory", "manualAiSourceTime", "manualAiPrompt", "manualAiResponse", "aiJobSourceTime", "aiJobStatus", "aiJobError", "aiJobUpdatedAt",
    "popupLogs", "userScripts", "developerSdkDraft", "developerSdkDrafts", "developerActiveDraftId", "sdkScriptStorage", "sdkPermissionGrants", "lastWorkspaceScript", "scriptWorkspaceActive", "popupState",
    "localUserAccounts", "activeUserProviderId", "usageDeclarationAcceptance", "usageDeclarationHistory"
  ];
  var OCR_KEYS = ["manualOcrText", "manualOcrSourceTime", "ocrJobSourceTime", "ocrJobStatus", "ocrJobProgress", "ocrJobStage", "ocrJobError", "ocrJobUpdatedAt"];
  var AI_KEYS = ["aiQuestionHistory", "manualAiSourceTime", "manualAiPrompt", "manualAiResponse", "aiJobSourceTime", "aiJobStatus", "aiJobError", "aiJobUpdatedAt"];

  function getLocal() {
    return new Promise(function (resolve) { storage.get(LOCAL_KEYS, resolve); });
  }

  function removeLocal(keys) {
    return new Promise(function (resolve, reject) {
      storage.remove(keys, function (result) {
        if (result && result.ok === false) {
          reject(new Error(result.error || "Could not clear local data."));
          return;
        }
        resolve();
      });
    });
  }

  function setLocal(data) {
    return new Promise(function (resolve, reject) {
      storage.set(data, function (result) {
        if (result && result.ok === false) {
          reject(new Error(result.error || "Could not update local data."));
          return;
        }
        resolve();
      });
    });
  }

  function clearScriptData() {
    return getLocal().then(function (data) {
      var popupState = data && data.popupState;
      var updateState = Promise.resolve();
      if (popupState && typeof popupState === "object") {
        var sanitized = Object.assign({}, popupState, { scriptWorkspaceActive: false });
        delete sanitized.lastWorkspaceScript;
        updateState = setLocal({ popupState: sanitized });
      }
      return updateState.then(function () {
        return removeLocal(["userScripts", "developerSdkDraft", "developerSdkDrafts", "developerActiveDraftId", "sdkScriptStorage", "sdkPermissionGrants", "lastWorkspaceScript", "scriptWorkspaceActive"]);
      }).then(clearSdkSessionData);
    });
  }

  function clearSdkSessionData() {
    return new Promise(function (resolve, reject) {
      var area = chrome.storage && chrome.storage.session;
      if (!area) { resolve(); return; }
      try {
        area.remove(["sdkRuntimeTokens", "sdkRuntimeSessions", "sdkContextIntents"], function () {
          var error = chrome.runtime.lastError && chrome.runtime.lastError.message;
          if (error) reject(new Error(error));
          else resolve();
        });
      } catch (error) { reject(error); }
      });
  }

  function clearCaptureSessionData() {
    return new Promise(function (resolve, reject) {
      var area = chrome.storage && chrome.storage.session;
      if (!area) { resolve(); return; }
      try {
        area.remove(["pendingCaptureAuthorization"], function () {
          var error = chrome.runtime.lastError && chrome.runtime.lastError.message;
          if (error) reject(new Error(error));
          else resolve();
        });
      } catch (error) { reject(error); }
    });
  }

  function clearSession() {
    return new Promise(function (resolve, reject) {
      var area = chrome.storage && chrome.storage.session;
      if (!area) { resolve(); return; }
      try {
        area.remove(["localUserSession"], function () {
          var error = chrome.runtime.lastError && chrome.runtime.lastError.message;
          if (error) reject(new Error(error));
          else resolve();
        });
      } catch (error) { reject(error); }
    });
  }

  function captureCount() {
    return storage.getLatestCapture().then(function (record) {
      return record && record.dataUrl ? 1 : 0;
    }).catch(function () { return 0; });
  }

  function getSummary() {
    return Promise.all([getLocal(), captureCount()]).then(function (values) {
      var data = values[0] || {};
      var ocrCount = String(data.manualOcrText || "").trim() || data.ocrJobSourceTime ? 1 : 0;
      var aiHistory = Array.isArray(data.aiQuestionHistory) ? data.aiQuestionHistory.length : 0;
      var latestAiCount = String(data.manualAiPrompt || "").trim() || String(data.manualAiResponse || "").trim() ? 1 : 0;
      var scriptCount = Array.isArray(data.userScripts) ? data.userScripts.length : 0;
      var sdkDraftCount = Array.isArray(data.developerSdkDrafts) ? data.developerSdkDrafts.filter(function (draft) { return draft && String(draft.code || "").trim(); }).length : 0;
      if (!sdkDraftCount && data.developerSdkDraft && String(data.developerSdkDraft.code || "").trim()) sdkDraftCount = 1;
      scriptCount += sdkDraftCount;
      if (!scriptCount && data.sdkScriptStorage && typeof data.sdkScriptStorage === "object") scriptCount = Object.keys(data.sdkScriptStorage).length;
      if (!scriptCount && data.sdkPermissionGrants && typeof data.sdkPermissionGrants === "object") scriptCount = Object.keys(data.sdkPermissionGrants).length;
      if (!scriptCount && (data.lastWorkspaceScript && data.lastWorkspaceScript.code || data.popupState && data.popupState.lastWorkspaceScript && data.popupState.lastWorkspaceScript.code)) scriptCount = 1;
      return {
        ok: true,
        localOnly: true,
        categories: [
          { id: "screenshots", label: "Screenshots", count: values[1] },
          { id: "ocr", label: "OCR records", count: ocrCount },
          { id: "ai", label: "AI history", count: aiHistory + latestAiCount },
          { id: "logs", label: "Logs", count: Array.isArray(data.popupLogs) ? data.popupLogs.length : 0 },
          { id: "scripts", label: "User scripts", count: scriptCount },
          { id: "account", label: "Account data", count: Array.isArray(data.localUserAccounts) ? data.localUserAccounts.length : 0 }
        ]
      };
    });
  }

  function clearCategory(category) {
    if (category === "screenshots") return storage.deleteCaptureRecord().then(clearCaptureSessionData);
    if (category === "ocr") return removeLocal(OCR_KEYS);
    if (category === "ai") return removeLocal(AI_KEYS);
    if (category === "logs") return removeLocal(["popupLogs"]);
    if (category === "scripts") return clearScriptData();
    if (category === "account") {
      return removeLocal(["localUserAccounts", "activeUserProviderId", "usageDeclarationAcceptance", "usageDeclarationHistory"]).then(clearSession);
    }
    return Promise.reject(new Error("Unknown privacy category."));
  }

  function clear(category) {
    var targets = category === "all" ? CATEGORIES.slice() : [category];
    if (category !== "all" && CATEGORIES.indexOf(category) < 0) {
      return Promise.resolve({ ok: false, code: "UNKNOWN_PRIVACY_CATEGORY", error: "Unknown privacy category." });
    }
    var cleared = [];
    return targets.reduce(function (chain, item) {
      return chain.then(function () {
        return clearCategory(item).then(function () { cleared.push(item); });
      });
    }, Promise.resolve()).then(function () {
      return getSummary().then(function (summary) {
        summary.cleared = cleared;
        return summary;
      });
    }).catch(function (error) {
      return { ok: false, code: "PRIVACY_CLEAR_FAILED", cleared: cleared, error: error && error.message || String(error) };
    });
  }

  global.WinSpeedBallPrivacyService = {
    categories: CATEGORIES.slice(),
    getSummary: getSummary,
    clear: clear
  };
})(self);
