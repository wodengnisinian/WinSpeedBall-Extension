(function (global) {
  "use strict";

  var storage = global.WinSpeedBallStorageService;
  var ACCEPTANCE_KEY = "usageDeclarationAcceptance";
  var HISTORY_KEY = "usageDeclarationHistory";
  var POLICY = {
    version: "2026-07-11.2",
    title: "WinSpeedBall 使用声明与数据告知",
    summary: "WinSpeedBall 是用于视频学习、网页阅读、OCR、AI 总结与用户主动配置自动化的学习效率工具，不提供违法违规用途授权。",
    sections: [
      {
        title: "一、产品用途",
        items: [
          "用于用户有权访问内容的视频控制、文字识别、学习笔记、翻译、总结和页面辅助。",
          "插件不会替用户判断特定网站、课程、考试或资料是否允许使用辅助工具。"
        ]
      },
      {
        title: "二、禁止用途",
        items: [
          "不得用于考试作弊、代答代交、伪造学习记录或绕过学校、平台和用人单位的规则。",
          "不得用于未授权访问、破解、绕过付费或访问控制、恶意自动化、欺诈、骚扰、监控他人或侵犯知识产权。",
          "不得导入来源不明或带有恶意行为的用户脚本，不得利用插件处理无权处理的个人信息或机密内容。"
        ]
      },
      {
        title: "三、数据处理",
        items: [
          "本地账户信息、设置、日志、截图和 OCR 结果默认保存在当前浏览器配置中。账户密码只保存加盐摘要，不保存明文。",
          "Developer Mode 的 SDK 草稿、隔离存储和能力授权保存在本地；短期运行令牌、页面确认和会话只保存在浏览器会话存储中。SDK 脚本在受限沙箱中运行，只能调用用户明确确认的 WSB 能力。",
          "只有用户主动发送或开启自动发送时，相关文字才会传输到用户选择的 AI 服务；第三方服务按其自身条款和隐私规则处理数据。",
          "本地存储记录可被设备使用者清除或修改，不构成不可篡改的司法存证。"
        ]
      },
      {
        title: "四、用户责任与风险",
        items: [
          "用户应确认自己对网页、视频、截图、文字和脚本拥有必要权限，并遵守适用法律、网站规则、课程与考试纪律。",
          "用户对自己的输入、配置、脚本、发送行为及其结果承担相应责任；插件开发者不授权或鼓励任何违法违规行为。",
          "用户应在启动 SDK 或旧兼容脚本前核对代码来源、能力、运行网站和数据发送范围。旧脚本兼容层能力更宽，只应运行可信脚本。",
          "插件按现状提供，不保证所有网站、播放器、OCR 或第三方 AI 始终可用；依法不能排除或限制的责任不因本声明而排除。"
        ]
      },
      {
        title: "五、声明更新",
        items: [
          "产品功能或数据处理方式发生重要变化时会更新声明版本，并要求用户重新确认。",
          "继续使用前请阅读完整内容；不同意时可以关闭插件并停止使用。"
        ]
      }
    ]
  };

  function getAsync(keys) {
    return new Promise(function (resolve) { storage.get(keys, resolve); });
  }

  function setAsync(data) {
    return new Promise(function (resolve) { storage.set(data, resolve); });
  }

  function canonicalText() {
    return JSON.stringify({
      version: POLICY.version,
      title: POLICY.title,
      summary: POLICY.summary,
      sections: POLICY.sections
    });
  }

  function toHex(buffer) {
    return Array.prototype.map.call(new Uint8Array(buffer), function (value) {
      return value.toString(16).padStart(2, "0");
    }).join("");
  }

  function contentHash() {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalText())).then(toHex);
  }

  function productVersion() {
    try { return chrome.runtime.getManifest().version || ""; } catch (error) { return ""; }
  }

  function get() {
    return Promise.all([contentHash(), getAsync([ACCEPTANCE_KEY])]).then(function (values) {
      var hash = values[0];
      var acceptance = values[1][ACCEPTANCE_KEY] || null;
      var accepted = !!acceptance && acceptance.version === POLICY.version && acceptance.contentHash === hash;
      return {
        ok: true,
        version: POLICY.version,
        title: POLICY.title,
        summary: POLICY.summary,
        sections: POLICY.sections,
        contentHash: hash,
        accepted: accepted,
        acceptance: accepted ? {
          acceptedAt: acceptance.acceptedAt,
          actorUserId: acceptance.actorUserId || "guest",
          productVersion: acceptance.productVersion || ""
        } : null
      };
    });
  }

  function accept(request) {
    request = request || {};
    if (request.accepted !== true) return Promise.resolve({ ok: false, error: "必须明确勾选并同意使用声明。" });
    if (request.version !== POLICY.version) return Promise.resolve({ ok: false, error: "使用声明已更新，请重新阅读后确认。", code: "DECLARATION_UPDATED" });
    return Promise.all([contentHash(), getAsync([HISTORY_KEY])]).then(function (values) {
      var now = new Date().toISOString();
      var record = {
        version: POLICY.version,
        contentHash: values[0],
        acceptedAt: now,
        actorUserId: String(request.actorUserId || "guest").slice(0, 80),
        productVersion: productVersion(),
        locale: "zh-CN"
      };
      var history = Array.isArray(values[1][HISTORY_KEY]) ? values[1][HISTORY_KEY] : [];
      history.push(record);
      var data = {};
      data[ACCEPTANCE_KEY] = record;
      data[HISTORY_KEY] = history.slice(-10);
      return setAsync(data).then(function (result) {
        return result && result.ok === false ? result : { ok: true, accepted: true, acceptance: record };
      });
    });
  }

  function associateUser(userId) {
    userId = String(userId || "").slice(0, 80);
    if (!userId) return Promise.resolve({ ok: false, error: "用户标识无效。" });
    return getAsync([ACCEPTANCE_KEY, HISTORY_KEY]).then(function (data) {
      var acceptance = data[ACCEPTANCE_KEY];
      if (!acceptance || acceptance.version !== POLICY.version) return { ok: false, error: "尚未确认当前使用声明。" };
      acceptance = Object.assign({}, acceptance, { actorUserId: userId });
      var history = Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY].slice() : [];
      for (var index = history.length - 1; index >= 0; index -= 1) {
        if (history[index] && history[index].version === acceptance.version && history[index].contentHash === acceptance.contentHash) {
          history[index] = Object.assign({}, history[index], { actorUserId: userId });
          break;
        }
      }
      var update = {};
      update[ACCEPTANCE_KEY] = acceptance;
      update[HISTORY_KEY] = history.slice(-10);
      return setAsync(update);
    });
  }

  global.WinSpeedBallDeclarationService = {
    POLICY_VERSION: POLICY.version,
    get: get,
    accept: accept,
    associateUser: associateUser
  };
})(self);
