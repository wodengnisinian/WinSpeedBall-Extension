(function (global) {
  "use strict";

  var sequence = 0;
  var LEVELS = ["error", "warn", "success", "info"];

  function clean(value, limit) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, limit || 500);
  }

  function inferLevel(message) {
    var value = clean(message, 1000).toLowerCase();
    if (/(失败|错误|异常|拒绝|error|failed|denied|blocked)/.test(value)) return "error";
    if (/(警告|取消|跳过|过期|未找到|不可用|warning|warn|cancel|skip|expired)/.test(value)) return "warn";
    if (/(成功|完成|已保存|已启动|已停止|已清空|success|complete|saved|started|stopped)/.test(value)) return "success";
    return "info";
  }

  function normalizeDetails(details) {
    var result = {};
    if (!details || typeof details !== "object" || Array.isArray(details)) return result;
    Object.keys(details).slice(0, 30).forEach(function (key) {
      var safeKey = clean(key, 40);
      var safeValue = clean(details[key], 500);
      if (safeKey && safeValue) result[safeKey] = safeValue;
    });
    return result;
  }

  function hash(value) {
    var number = 2166136261;
    var source = String(value || "");
    for (var index = 0; index < source.length; index += 1) {
      number ^= source.charCodeAt(index);
      number = Math.imul(number, 16777619);
    }
    return (number >>> 0).toString(36);
  }

  function nextId(timestamp, source) {
    sequence = (sequence + 1) % 1000000;
    return "log-" + String(timestamp).replace(/\D/g, "").slice(-14) + "-" + hash(source) + "-" + sequence.toString(36);
  }

  function create(category, message, details, level, timestamp) {
    var now = timestamp ? new Date(timestamp) : new Date();
    if (Number.isNaN(now.getTime())) now = new Date();
    var safeCategory = clean(category, 40) || "系统";
    var safeMessage = clean(message, 500) || "未提供日志内容";
    var safeLevel = LEVELS.indexOf(level) >= 0 ? level : inferLevel(safeMessage);
    var isoTime = now.toISOString();
    return {
      id: nextId(isoTime, safeCategory + safeMessage),
      timestamp: isoTime,
      level: safeLevel,
      category: safeCategory,
      message: safeMessage,
      details: normalizeDetails(details)
    };
  }

  function parseLegacy(value) {
    var source = clean(value, 4000);
    var timeMatch = source.match(/^\[([^\]]+)\]\s*/);
    var legacyTime = timeMatch ? clean(timeMatch[1], 40) : "";
    if (timeMatch) source = source.slice(timeMatch[0].length);
    var categoryMatch = source.match(/^\[([^\]]+)\]\s*/);
    var category = categoryMatch ? clean(categoryMatch[1], 40) : "历史";
    if (categoryMatch) source = source.slice(categoryMatch[0].length);
    var parts = source.split(/\s+\|\s+/);
    var message = clean(parts.shift(), 500) || "历史日志";
    var details = {};
    parts.forEach(function (part) {
      var separator = part.indexOf("=");
      if (separator < 1) return;
      details[clean(part.slice(0, separator), 40)] = clean(part.slice(separator + 1), 500);
    });
    if (legacyTime) details["原记录时间"] = legacyTime;
    var record = create(category, message, details, inferLevel(message));
    record.id = "legacy-" + hash(value);
    return record;
  }

  function normalize(value) {
    if (typeof value === "string") return parseLegacy(value);
    if (!value || typeof value !== "object") return null;
    var record = create(value.category, value.message, value.details, value.level, value.timestamp);
    record.id = clean(value.id, 120) || record.id;
    return record;
  }

  function normalizeList(values, limit) {
    var seen = Object.create(null);
    var result = [];
    (Array.isArray(values) ? values : []).forEach(function (value) {
      var record = normalize(value);
      if (!record || seen[record.id]) return;
      seen[record.id] = true;
      result.push(record);
    });
    result.sort(function (a, b) { return String(b.timestamp).localeCompare(String(a.timestamp)); });
    return result.slice(0, Number(limit || 500));
  }

  function searchableText(record) {
    var details = Object.keys(record.details || {}).map(function (key) {
      return key + " " + record.details[key];
    }).join(" ");
    return [record.category, record.message, record.level, details].join(" ").toLowerCase();
  }

  function matches(record, query, level) {
    if (level && level !== "all" && record.level !== level) return false;
    var needle = clean(query, 200).toLowerCase();
    return !needle || searchableText(record).indexOf(needle) >= 0;
  }

  function format(record) {
    var time = new Date(record.timestamp);
    var displayTime = Number.isNaN(time.getTime()) ? record.timestamp : time.toLocaleString();
    var details = Object.keys(record.details || {}).map(function (key) {
      return key + "=" + record.details[key];
    });
    return "[" + displayTime + "] [" + record.level.toUpperCase() + "] [" + record.category + "] " + record.message + (details.length ? " | " + details.join(" | ") : "");
  }

  global.WinSpeedBallLogRecord = {
    LEVELS: LEVELS.slice(),
    create: create,
    inferLevel: inferLevel,
    normalize: normalize,
    normalizeList: normalizeList,
    matches: matches,
    format: format
  };
})(typeof self !== "undefined" ? self : this);
