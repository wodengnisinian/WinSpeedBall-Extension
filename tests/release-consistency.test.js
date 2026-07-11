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

test("release metadata identifies the 3.6.0 Developer Beta", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "3.6.0");
  assert.equal(manifest.version_name, "3.6.0 Developer Beta");
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

  assert.equal(context.self.WinSpeedBallDeclarationService.POLICY_VERSION, "2026-07-11.2");
  assert.match(read("docs/usage-declaration.md"), /2026-07-11\.2/);
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
  const background = read("background.js");
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
