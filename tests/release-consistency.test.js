const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function markdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(absolute);
    return entry.isFile() && entry.name.endsWith(".md") ? [absolute] : [];
  });
}

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing section start: ${start}`);
  assert.ok(endIndex > startIndex, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("release metadata identifies the 3.8.5 Developer Beta", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "3.8.5");
  assert.equal(manifest.version_name, "3.8.5 Developer Beta");
  assert.equal(manifest.permissions.includes("unlimitedStorage"), true);
  assert.match(read("README.md"), /当前发布版本：WinSpeedBall `3\.8\.5 Developer Beta`/);
  assert.match(read("README.md"), /内置 SDK 版本：`3\.7\.0-beta`/);
  assert.match(read("README.md"), /## 3\.8\.5 主要更新/);
  assert.match(read("README.md"), /### 长期会话规则/);
  assert.match(read("docs/user-guide-and-script-api.md"), /3\.8\.5 Developer Beta/);
  assert.match(read("PRIVACY.md"), /3\.8\.5 Developer Beta/);
  assert.match(read("docs/usage-declaration.md"), /3\.8\.5 Developer Beta/);
  assert.match(read("CHANGELOG.md"), /## 3\.8\.5 Developer Beta - 2026-07-26/);
});

test("插件内更新日志同步展示 3.8.5 发布内容", () => {
  const popup = read("popup/index.html");
  const changelog = read("CHANGELOG.md");
  const currentRelease = section(changelog, "## 3.8.5 Developer Beta", "## 3.7.1 Developer Beta");
  const releaseItems = Array.from(currentRelease.matchAll(/^- (.+)$/gm), (match) => match[1].replace(/`/g, ""));
  assert.ok(releaseItems.length >= 4);
  releaseItems.forEach((item) => assert.match(popup, new RegExp(`<li>${item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</li>`)));
});

test("插件图标集中存放在 assets 且全部引用有效", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const declaredIcons = [
    ...Object.values(manifest.action.default_icon),
    ...Object.values(manifest.icons)
  ];
  declaredIcons.forEach((iconPath) => {
    assert.match(iconPath, /^assets\/icons\/icon-blue-(?:16|32|48|128)\.png$/);
    assert.equal(fs.existsSync(path.join(root, iconPath)), true, `${iconPath} 不存在`);
  });

  const background = read("background/service-worker.js");
  ["16", "32", "48", "128"].forEach((size) => {
    assert.match(background, new RegExp(`assets/icons/icon-blue-${size}\\.png`));
    assert.match(background, new RegExp(`assets/icons/icon-gray-${size}\\.png`));
  });
  assert.equal(fs.existsSync(path.join(root, "icons")), false);
  assert.doesNotMatch(manifest.action.default_icon[16], /^icons\//);
});

test("Developer Mode reports a ready beta runtime", async () => {
  const context = {
    self: {
      WinSpeedBallStorageService: {
        get(keys, callback) { callback({}); },
        set(data, callback) { callback({ ok: true }); }
      },
      WinSpeedBallFeatureGate: {
        check() { return Promise.resolve({ ok: true, allowed: true }); }
      }
    },
    Promise,
    Object,
    Array,
    Number,
    Date,
    String,
    JSON
  };
  vm.createContext(context);
  vm.runInContext(read("sdk/contracts.js"), context);
  vm.runInContext(read("background/developer-mode-service.js"), context);

  const status = await context.self.WinSpeedBallDeveloperModeService.getStatus();
  assert.equal(status.ok, true);
  assert.equal(status.available, true);
  assert.equal(status.runtimeReady, true);
  assert.equal(status.runtimeStage, "beta");
  assert.equal(status.sdkVersion, "3.7.0-beta");
});

test("3.7 SDK 版本在契约、Worker、兼容桥和文档中保持一致", () => {
  assert.match(read("sdk/contracts.js"), /SDK_VERSION = "3\.7\.0-beta"/);
  assert.match(read("sdk/script-worker.js"), /version: "3\.7\.0-beta"/);
  assert.match(read("background/user-script-service.js"), /version:'3\.7\.0-beta'/);
  assert.match(read("docs/user-guide-and-script-api.md"), /SDK 版本：`3\.7\.0-beta`/);
});

test("runtime declaration and published declaration use the same policy version", () => {
  const context = {
    self: { WinSpeedBallStorageService: {} },
    Promise,
    Object,
    Array,
    Number,
    Date,
    String,
    JSON
  };
  vm.createContext(context);
  vm.runInContext(read("background/declaration-service.js"), context);

  assert.equal(context.self.WinSpeedBallDeclarationService.POLICY_VERSION, "2026-07-26.2");
  assert.match(read("docs/usage-declaration.md"), /2026-07-26\.2/);
  assert.match(read("background/declaration-service.js"), /网页语音功能只在用户主动开始后获取当前 Edge 标签页播放的声音/);
  assert.match(read("docs/usage-declaration.md"), /网页语音功能只在用户主动开始后获取当前 Edge 标签页播放的声音/);
  assert.match(read("background/declaration-service.js"), /运行令牌和会话不按固定时间到期/);
  assert.match(read("docs/usage-declaration.md"), /运行令牌和会话不按固定时间到期/);
});

test("SDK 5 MiB 隔离存储权限及公开说明保持一致", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.permissions.includes("storage"), true);
  assert.equal(manifest.permissions.includes("unlimitedStorage"), true);

  [
    "README.md",
    "PRIVACY.md",
    "docs/user-guide-and-script-api.md",
    "docs/usage-declaration.md",
    "background/declaration-service.js"
  ].forEach((file) => {
    const content = read(file);
    assert.match(content, /unlimitedStorage/, `${file} 缺少 unlimitedStorage 用途说明`);
    assert.match(content, /5 MiB/, `${file} 缺少单脚本隔离存储配额说明`);
    assert.match(content, /固定总配额/, `${file} 缺少浏览器总配额用途说明`);
  });
});

test("release documentation contains no superseded runtime wording", () => {
  const files = [
    path.join(root, "README.md"),
    path.join(root, "PRIVACY.md"),
    ...markdownFiles(path.join(root, "docs")),
    ...markdownFiles(path.join(root, "sdk"))
  ];
  const stalePatterns = [
    /未接入\s*Manifest/i,
    /不会执行.{0,20}SDK|SDK.{0,20}不会执行/i,
    /运行时尚未接入正式扩展/i,
    /未接入\s*Manifest/i,
    /不会执行.{0,20}SDK|SDK.{0,20}不会执行/i,
    /contractOnly\s*:\s*true/i,
    /3\.4\.1\s+stability\s+mode/i
  ];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    for (const pattern of stalePatterns) {
      assert.doesNotMatch(content, pattern, `${path.relative(root, file)} contains stale wording: ${pattern}`);
    }
  }

  const currentReleaseDocuments = [
    read("README.md"),
    read("PRIVACY.md"),
    read("docs/user-guide-and-script-api.md"),
    read("docs/usage-declaration.md")
  ].join("\n");
  assert.doesNotMatch(currentReleaseDocuments, /默认运行令牌有效期为 5 分钟|最长 10 分钟/);
  assert.doesNotMatch(currentReleaseDocuments, /SDK_BOOK_INTERVAL_EXCEEDS_SESSION|SDK_TOKEN_EXPIRED/);
  assert.match(currentReleaseDocuments, /不按固定时间到期|没有固定到期时间|没有固定分钟数到期/);
});

test("普通用户脚本的 dom、network 与 automation 主动 API 防护保持一致", () => {
  const service = read("background/user-script-service.js");
  const popup = read("popup/index.js");
  const workspace = read("workspace/index.js");
  const published = [
    read("README.md"),
    read("PRIVACY.md"),
    read("docs/user-guide-and-script-api.md"),
    read("docs/usage-declaration.md")
  ].join("\n");

  assert.match(service, /permissions\.indexOf\("dom"\)\s*<\s*0/);
  assert.match(service, /boundary\.network \? "http: https: ws: wss:" : "'none'"/);
  assert.match(service, /messaging:\s*boundary\.messaging/);
  assert.match(service, /"_c" \+ hashPart\(code,[\s\S]*hashPart\(code,/);
  assert.match(popup, /permissions\.indexOf\("dom"\)\s*<\s*0/);
  assert.match(workspace, /connect-src 'none'/);
  assert.match(workspace, /hasWorkspacePermission\("automation"\)/);
  assert.match(published, /@permission dom/);
  assert.match(published, /connect-src 'none'/);
  assert.match(published, /Developer SDK 级强沙箱/);
  assert.match(published, /主环境/);
});

test("完整使用说明覆盖普通脚本、SDK 能力和全部公开方法", () => {
  const guide = read("docs/user-guide-and-script-api.md");
  [
    "普通用户脚本编写要求",
    "Developer SDK 脚本要求",
    "WSB.video.status()",
    "WSB.video.auto(",
    "WSB.video.lock(",
    "WSB.video.reset()",
    "WSB.ocr.latest()",
    "WSB.qa.latest()",
    "WSB.qa.voice()",
    "WSB.ai.latest()",
    "WSB.ai.history(limit = 10)",
    "WSB.ai.summary(sourceText)",
    "WSB.page.text()",
    "WSB.book.status()",
    "WSB.book.prev(",
    "WSB.book.next(",
    "WSB.book.start(",
    "WSB.book.stop()",
    "WSB.book.interval(",
    "WSB.storage.set(key, value)",
    "WSB.event.on"
  ].forEach((text) => assert.match(guide, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))));
  assert.match(guide, /SDK_DEPENDENCY_NOT_READY/);
  assert.match(guide, /截图预览和 OCR 文字结果合并显示在“文字问题”标签中/);
  assert.doesNotMatch(guide, /切换到“OCR 结果”/);
  assert.match(guide, /`DS`：DeepSeek/);
  assert.match(guide, /`OAI`：OpenAI/);
  assert.match(guide, /`CLD`：Claude/);
  assert.match(guide, /`LM`：本地 OpenAI 兼容模型/);
  assert.match(read("README.md"), /docs\/user-guide-and-script-api\.md/);
});

test("README 完整列出当前 SDK 能力和短公开接口", () => {
  const context = { self: {}, Object, Array, String, Number, JSON };
  vm.createContext(context);
  vm.runInContext(read("sdk/contracts.js"), context);
  const contracts = context.self.WinSpeedBallSdkContracts;
  const readme = read("README.md");

  Array.from(contracts.CAPABILITIES).forEach((capability) => {
    assert.ok(readme.includes(`\`${capability}\``), `README 缺少能力：${capability}`);
  });
  Object.keys(contracts.PUBLIC_METHODS).forEach((method) => {
    assert.ok(readme.includes(`WSB.${method}(`), `README 缺少公开方法：${method}`);
  });
  assert.equal(Object.keys(contracts.PUBLIC_METHODS).length, 35);
  assert.match(readme, /全部推荐公开方法名均不超过 13 个字符/);
});

test("SDK sandbox permits only Blob-backed workers", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.ok(manifest.sandbox.pages.includes("sdk/script-runner.html"));
  assert.match(manifest.content_security_policy.sandbox, /worker-src\s+blob:/);
  assert.doesNotMatch(manifest.content_security_policy.sandbox, /worker-src[^;]*\bhttps?:/);

  const runner = read("sdk/script-runner.html");
  assert.match(runner, /worker-src\s+blob:/);
  assert.match(runner, /connect-src\s+'none'/);
});

test("capture authorization survives MV3 worker restarts in session storage", () => {
  const background = read("background/service-worker.js");
  assert.match(background, /CAPTURE_AUTH_KEY\s*=\s*"pendingCaptureAuthorization"/);

  const write = section(background, "function writeCaptureAuthorization", "function readCaptureAuthorization");
  assert.match(write, /chrome\.storage\s*&&\s*chrome\.storage\.session/);
  assert.match(write, /area\.set\(/);
  assert.match(write, /area\.remove\(/);
  assert.doesNotMatch(write, /chrome\.storage\.local/);

  const readAuthorization = section(background, "function readCaptureAuthorization", "function clearCaptureAuthorization");
  assert.match(readAuthorization, /chrome\.storage\s*&&\s*chrome\.storage\.session/);
  assert.match(readAuthorization, /area\.get\(\[CAPTURE_AUTH_KEY\]/);
  assert.doesNotMatch(readAuthorization, /chrome\.storage\.local/);
});

test("图书读取公开接口在模块 Runtime、Worker 和契约中保持一致", () => {
  assert.match(read("sdk/contracts.js"), /"book\.getStatus":\s*"book\.read"/);
  assert.match(read("sdk/contracts.js"), /"book\.turnPrev":\s*"book\.control"/);
  assert.match(read("sdk/contracts.js"), /"book\.turnNext":\s*"book\.control"/);
  assert.match(read("sdk/contracts.js"), /"book\.startAuto":\s*"book\.control"/);
  assert.match(read("sdk/contracts.js"), /"book\.stopAuto":\s*"book\.control"/);
  assert.match(read("sdk/contracts.js"), /"book\.setInterval":\s*"book\.control"/);
  assert.match(read("sdk/contracts.js"), /"book\.status":\s*"book\.getStatus"/);
  assert.match(read("sdk/contracts.js"), /"book\.prev":\s*"book\.turnPrev"/);
  assert.match(read("sdk/contracts.js"), /"book\.next":\s*"book\.turnNext"/);
  assert.match(read("sdk/contracts.js"), /"book\.start":\s*"book\.startAuto"/);
  assert.match(read("sdk/contracts.js"), /"book\.stop":\s*"book\.stopAuto"/);
  assert.match(read("sdk/contracts.js"), /"book\.interval":\s*"book\.setInterval"/);
  assert.match(read("sdk/book-api.js"), /status:\s*status[\s\S]*prev:\s*prev[\s\S]*next:\s*next[\s\S]*start:\s*start[\s\S]*stop:\s*stop[\s\S]*interval:\s*interval/);
  assert.match(read("sdk/runtime.js"), /book:\s*asPromiseApi\(global\.WinSpeedBallSdkBookApi\.create\(options\.invoke,\s*options\.bookMode\)\)/);
  assert.match(read("sdk/script-worker.js"), /book:\s*Object\.freeze\(\["status",\s*"prev",\s*"next",\s*"start",\s*"stop",\s*"interval"/);
  assert.match(read("sdk/script-worker.js"), /book:\s*createMethodGroup\("book",\s*METHODS\.book\)/);
});
