const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const sharedSource = fs.readFileSync(path.join(root, "shared/log-record.js"), "utf8");
const popupSource = fs.readFileSync(path.join(root, "popup.js"), "utf8");
const popupHtml = fs.readFileSync(path.join(root, "popup.html"), "utf8");
const storageSource = fs.readFileSync(path.join(root, "background/storage-service.js"), "utf8");
const schemaSource = fs.readFileSync(path.join(root, "background/message-schema.js"), "utf8");
const backgroundSource = fs.readFileSync(path.join(root, "background.js"), "utf8");
const privacySource = fs.readFileSync(path.join(root, "background/privacy-service.js"), "utf8");

function createApi() {
  const context = { self: {}, Date, String, Object, Array, Number, Math, RegExp };
  vm.createContext(context);
  vm.runInContext(sharedSource, context);
  return context.self.WinSpeedBallLogRecord;
}

function createStorageService() {
  const data = {};
  const chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys, callback) {
          setTimeout(() => {
            const result = {};
            (Array.isArray(keys) ? keys : Object.keys(keys || {})).forEach((key) => {
              if (Object.prototype.hasOwnProperty.call(data, key)) result[key] = data[key];
            });
            callback(result);
          }, 1);
        },
        set(value, callback) {
          setTimeout(() => {
            Object.assign(data, JSON.parse(JSON.stringify(value)));
            callback();
          }, 1);
        },
        remove(keys, callback) {
          (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete data[key]);
          if (callback) callback();
        }
      }
    }
  };
  const context = { self: {}, chrome, Date, String, Object, Array, Number, Math, RegExp, Promise, setTimeout };
  vm.createContext(context);
  vm.runInContext(sharedSource, context);
  vm.runInContext(storageSource, context);
  return { service: context.self.WinSpeedBallStorageService, data };
}

test("结构化日志保留分类、级别和执行细节", () => {
  const api = createApi();
  const record = api.create("视频", "控制失败", { 命令: "SET_RATE", 原因: "blocked" });

  assert.equal(record.category, "视频");
  assert.equal(record.level, "error");
  assert.equal(record.details.命令, "SET_RATE");
  assert.match(api.format(record), /\[ERROR\].*\[视频\].*控制失败.*命令=SET_RATE/);
});

test("旧版文本日志会迁移且支持搜索筛选", () => {
  const api = createApi();
  const records = api.normalizeList([
    "[10:20:30] [AI] 连接测试成功 | 模型=demo",
    "[10:20:31] [视频] 控制失败 | 原因=blocked"
  ]);

  assert.equal(records.length, 2);
  assert.equal(records.find((item) => item.category === "AI").details.模型, "demo");
  assert.equal(records.filter((item) => api.matches(item, "blocked", "error")).length, 1);
  assert.equal(records.filter((item) => api.matches(item, "视频", "success")).length, 0);
});

test("日志面板提供运行日志、更新日志以及完整操作", () => {
  [
    "logSearchInput",
    "logLevelFilter",
    "refreshLogBtn",
    "copyLogBtn",
    "exportLogBtn",
    "clearLogBtn",
    "logList",
    "runtimeLogView",
    "updateLogView"
  ].forEach((id) => assert.match(popupHtml, new RegExp(`id=["']${id}["']`)));
  assert.match(popupSource, /window\.confirm\("确定清空全部运行日志吗/);
  assert.match(popupSource, /new Blob\(\[JSON\.stringify\(payload/);
  assert.match(popupSource, /visible\.map\(logApi\.format\)/);
  assert.match(popupHtml, /\.log-list\{[^}]*overflow-y:auto!important/);
  assert.match(popupHtml, /\.log-list\{[^}]*scrollbar-width:none/);
  assert.match(popupHtml, /\.log-list::-webkit-scrollbar\{display:none/);
  assert.match(popupHtml, /#logPanel>details>\.fold-body\{[^}]*height:100%[^}]*max-height:100%[^}]*grid-template-rows:27px minmax\(0,1fr\)/);
  assert.match(popupHtml, /#logPanel \.runtime-log-view\{[^}]*grid-template-rows:30px 28px minmax\(0,1fr\) 14px 27px/);
  assert.match(popupHtml, /#logPanel \.log-list\{[^}]*height:auto[^}]*overflow-y:auto!important/);
  assert.match(popupHtml, /data-log-view="runtime">运行日志<\/button>/);
  assert.match(popupHtml, /data-log-view="updates">更新日志<\/button>/);
  assert.match(popupHtml, /v3\.6\.0 · 最新更新/);
  assert.match(popupHtml, /v3\.6\.0 · 界面与窗口/);
  assert.match(popupHtml, /v3\.6\.0 · 视频控制/);
  assert.match(popupHtml, /v3\.6\.0 · 脚本与公开接口/);
  assert.match(popupHtml, /v3\.6\.0 · 日志与诊断/);
  assert.match(popupHtml, /v3\.6\.0 · AI、OCR 与基础能力/);
  assert.match(popupSource, /function selectLogView\(view\)/);
  assert.match(popupHtml, /id="logList"[^>]*tabindex="0"/);
  assert.match(popupSource, /logList\.addEventListener\("wheel"/);
  assert.match(popupSource, /logList\.addEventListener\("keydown"/);
  assert.match(popupSource, /updateLogView\.addEventListener\("wheel"/);
  assert.match(popupSource, /updateLogView\.addEventListener\("keydown"/);
  assert.match(popupHtml, /#logPanel \.update-log-view\{[^}]*height:100%[^}]*max-height:100%[^}]*overflow-y:auto[^}]*touch-action:pan-y[^}]*scrollbar-width:none/);
  assert.match(popupSource, /chrome\.storage\.onChanged\.addListener/);
  assert.match(popupSource, /previousTop \+ list\.scrollHeight - previousHeight/);
});

test("多个窗口并发写日志时不会相互覆盖", async () => {
  const { service, data } = createStorageService();
  await Promise.all(Array.from({ length: 20 }, (_, index) => service.appendLog("并发", `记录${index}`, { 序号: index })));

  assert.equal(data.popupLogs.length, 20);
  assert.equal(new Set(data.popupLogs.map((item) => item.id)).size, 20);

  await Promise.all([
    service.appendLog("并发", "清空前记录", {}),
    service.clearLogs()
  ]);
  assert.deepEqual(data.popupLogs, []);
});

test("弹窗日志写入消息经过严格校验", () => {
  const extensionId = "logging-extension";
  const chrome = {
    runtime: {
      id: extensionId,
      getURL(file) { return `chrome-extension://${extensionId}/${file}`; }
    }
  };
  const context = { self: {}, chrome, URL, Date, String, Object, Array, Number, Math, RegExp, Set };
  vm.createContext(context);
  vm.runInContext(schemaSource, context);
  const sender = { id: extensionId, url: chrome.runtime.getURL("popup.html") };
  const record = createApi().create("视频", "控制成功", { 命令: "PLAY" });
  const valid = context.self.WinSpeedBallMessageSchema.parse({
    version: 1,
    action: "appendPopupLog",
    source: "popup",
    requestId: "log-1",
    payload: { record }
  }, sender);
  const leakedSecret = context.self.WinSpeedBallMessageSchema.parse({
    version: 1,
    action: "appendPopupLog",
    source: "popup",
    requestId: "log-2",
    payload: { record: Object.assign({}, record, { apiKey: "secret" }) }
  }, sender);

  assert.equal(valid.ok, true);
  assert.equal(leakedSecret.ok, false);
});

test("全部界面操作和后台自动任务接入统一日志", () => {
  assert.match(popupSource, /bindComprehensiveActionLogging\(\)/);
  assert.match(popupSource, /rawSendMessage\(\{ action: "appendPopupLog", record: entry \}\)/);
  assert.match(popupSource, /rawSendMessage\(\{ action: "clearPopupLogs" \}\)/);
  assert.match(popupSource, /action === "douyinPanel" && payload\.command !== "GET_STATE"/);
  assert.match(popupSource, /element\.closest\("#aiHistoryList"\).*打开 AI 历史记录/);
  assert.match(backgroundSource, /快捷键框选已启动/);
  assert.match(backgroundSource, /自动下一条执行成功/);
  assert.match(backgroundSource, /自动翻页执行成功/);
  assert.match(backgroundSource, /网站权限已移除/);
  assert.match(backgroundSource, /同步用户脚本成功/);
  assert.match(privacySource, /category === "logs"\)[^\n]*storage\.clearLogs\(\)/);
});
