(function (global) {
  "use strict";

  var MAX_DRAFTS = 20;
  var MAX_CODE_LENGTH = 200000;
  var DRAFTS_KEY = "developerSdkDrafts";
  var ACTIVE_KEY = "developerActiveDraftId";
  var LEGACY_KEY = "developerSdkDraft";

  function validDraftId(value) {
    return /^[A-Za-z0-9_-]{1,64}$/.test(String(value || "")) &&
      ["__proto__", "prototype", "constructor"].indexOf(String(value)) < 0;
  }

  function create(options) {
    options = options || {};
    var storage = options.storage;
    var contracts = options.contracts;
    var now = options.now || Date.now;
    var idFactory = options.idFactory || function () {
      try { return "sdk_" + crypto.randomUUID().replace(/-/g, ""); }
      catch (error) { return "sdk_" + now().toString(36) + Math.random().toString(36).slice(2); }
    };
    var drafts = [];
    var activeId = "";

    function getStorage(keys) {
      return new Promise(function (resolve) { storage.get(keys, resolve); });
    }

    function setStorage(data) {
      return new Promise(function (resolve, reject) {
        storage.set(data, function (result) {
          if (result && result.ok === false) reject(new Error(result.error || "Could not save SDK drafts."));
          else resolve();
        });
      });
    }

    function removeStorage(keys) {
      return new Promise(function (resolve) { storage.remove(keys, resolve); });
    }

    function normalizeDraft(value) {
      if (!value || typeof value !== "object" || typeof value.code !== "string" || value.code.length > MAX_CODE_LENGTH) return null;
      var metadata = contracts.parseMetadata(value.code);
      return {
        id: validDraftId(value.id) ? String(value.id) : idFactory(),
        name: String(value.name || metadata.name || "未命名 SDK 脚本").trim().slice(0, 80) || "未命名 SDK 脚本",
        code: value.code,
        savedAt: Number(value.savedAt || now()),
        sdkVersion: String(value.sdkVersion || contracts.SDK_VERSION),
        capabilities: contracts.normalizeCapabilities(value.capabilities || metadata.capabilities)
      };
    }

    function snapshot() {
      return {
        activeId: activeId,
        drafts: drafts.map(function (draft) { return Object.assign({}, draft, { capabilities: draft.capabilities.slice() }); })
      };
    }

    function persist() {
      var data = {};
      data[DRAFTS_KEY] = drafts;
      data[ACTIVE_KEY] = activeId;
      return setStorage(data).then(snapshot);
    }

    function load() {
      return getStorage([DRAFTS_KEY, ACTIVE_KEY, LEGACY_KEY]).then(function (data) {
        drafts = (Array.isArray(data[DRAFTS_KEY]) ? data[DRAFTS_KEY] : []).map(normalizeDraft).filter(Boolean).slice(0, MAX_DRAFTS);
        if (!drafts.length && data[LEGACY_KEY] && data[LEGACY_KEY].code) {
          var migrated = normalizeDraft(data[LEGACY_KEY]);
          if (migrated) drafts.push(migrated);
        }
        activeId = String(data[ACTIVE_KEY] || "");
        if (!drafts.some(function (draft) { return draft.id === activeId; })) activeId = drafts[0] ? drafts[0].id : "";
        return persist().then(function (result) {
          return removeStorage([LEGACY_KEY]).then(function () { return result; });
        });
      });
    }

    function analyze(code) {
      code = String(code || "");
      if (code.length > MAX_CODE_LENGTH) return { ok: false, code: "SCRIPT_TOO_LARGE", error: "脚本超过 200000 字符。" };
      var metadata = contracts.parseMetadata(code);
      var classification = contracts.classifyMetadata(metadata);
      if (!classification.ok) return Object.assign({ metadata: metadata }, classification);
      if (classification.mode !== "sdk") return { ok: false, mode: classification.mode, code: "LEGACY_SCRIPT_ONLY", error: "旧脚本不能保存为 SDK 草稿。", metadata: metadata };
      return { ok: true, mode: "sdk", metadata: metadata, capabilities: classification.capabilities };
    }

    function createDraft(code) {
      if (drafts.length >= MAX_DRAFTS) return Promise.reject(new Error("SDK 草稿最多保存 20 个。"));
      var validation = analyze(code);
      if (!validation.ok) return Promise.reject(Object.assign(new Error(validation.error), { code: validation.code }));
      var draft = normalizeDraft({ id: idFactory(), code: String(code), capabilities: validation.capabilities, savedAt: now() });
      drafts.push(draft);
      activeId = draft.id;
      return persist().then(function () { return Object.assign({}, draft); });
    }

    function saveDraft(id, code) {
      var draft = drafts.find(function (item) { return item.id === id; });
      if (!draft) return createDraft(code);
      var validation = analyze(code);
      if (!validation.ok) return Promise.reject(Object.assign(new Error(validation.error), { code: validation.code }));
      draft.code = String(code);
      draft.name = String(validation.metadata.name || draft.name || "未命名 SDK 脚本").trim().slice(0, 80);
      draft.savedAt = now();
      draft.sdkVersion = contracts.SDK_VERSION;
      draft.capabilities = validation.capabilities.slice();
      activeId = draft.id;
      return persist().then(function () { return Object.assign({}, draft); });
    }

    function selectDraft(id) {
      if (!drafts.some(function (draft) { return draft.id === id; })) return Promise.reject(new Error("SDK 草稿不存在。"));
      activeId = id;
      return persist().then(function () { return getActive(); });
    }

    function removeDraft(id) {
      drafts = drafts.filter(function (draft) { return draft.id !== id; });
      if (activeId === id) activeId = drafts[0] ? drafts[0].id : "";
      return persist();
    }

    function getActive() {
      var draft = drafts.find(function (item) { return item.id === activeId; });
      return draft ? Object.assign({}, draft, { capabilities: draft.capabilities.slice() }) : null;
    }

    function getDraft(id) {
      var draft = drafts.find(function (item) { return item.id === id; });
      return draft ? Object.assign({}, draft, { capabilities: draft.capabilities.slice() }) : null;
    }

    function exportDraft(id) {
      var draft = getDraft(id);
      if (!draft) throw new Error("SDK 草稿不存在。");
      return {
        fileName: draft.name.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 60) + ".js",
        code: draft.code
      };
    }

    return {
      load: load,
      snapshot: snapshot,
      analyze: analyze,
      createDraft: createDraft,
      saveDraft: saveDraft,
      selectDraft: selectDraft,
      removeDraft: removeDraft,
      getActive: getActive,
      getDraft: getDraft,
      exportDraft: exportDraft
    };
  }

  global.WinSpeedBallDeveloperDraftStore = Object.freeze({ create: create });
})(self);
