const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".git") return [];
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(absolute) : [absolute];
  });
}

function localReferenceTarget(ownerFile, reference) {
  const clean = String(reference || "").split(/[?#]/, 1)[0];
  if (!clean || /^(?:[a-z]+:|\/\/|#)/i.test(clean)) return null;
  return path.resolve(path.dirname(ownerFile), clean);
}

test("项目根目录只保留清单和说明文件", () => {
  const rootFiles = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(rootFiles, [".gitignore", "CHANGELOG.md", "PRIVACY.md", "README.md", "manifest.json"]);
});

test("Manifest 声明的入口、沙箱和图标资源全部存在", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const declaredFiles = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.sandbox.pages,
    ...Object.values(manifest.action.default_icon),
    ...Object.values(manifest.icons)
  ];
  declaredFiles.forEach((file) => assert.equal(exists(file), true, `${file} 不存在`));
});

test("所有 HTML 本地脚本、图片和 iframe 引用均可解析", () => {
  const htmlFiles = filesUnder(root).filter((file) => file.endsWith(".html"));
  for (const htmlFile of htmlFiles) {
    const source = fs.readFileSync(htmlFile, "utf8");
    const references = Array.from(source.matchAll(/<(?:script|img|iframe)\b[^>]*\bsrc="([^"]+)"/gi), (match) => match[1]);
    references.forEach((reference) => {
      const target = localReferenceTarget(htmlFile, reference);
      if (target) assert.equal(fs.existsSync(target), true, `${path.relative(root, htmlFile)} -> ${reference} 不存在`);
    });
  }
});

test("后台加载和动态页面路径全部指向整理后的目录", () => {
  const workerFile = path.join(root, "background", "service-worker.js");
  const worker = fs.readFileSync(workerFile, "utf8");
  const imports = Array.from(worker.matchAll(/importScripts\("([^"]+)"\)/g), (match) => match[1]);
  assert.ok(imports.length > 20);
  imports.forEach((reference) => {
    assert.equal(fs.existsSync(path.resolve(path.dirname(workerFile), reference)), true, `importScripts(${reference}) 不存在`);
  });

  const runtimePaths = [
    ["background/window-service.js", "popup/index.html?pinned=1", "popup/index.html"],
    ["background/ai-window-service.js", "popup/ai-reply.html", "popup/ai-reply.html"],
    ["background/ocr-service.js", "ocr/offscreen.html", "ocr/offscreen.html"],
    ["popup/index.js", "workspace/index.html", "workspace/index.html"],
    ["background/video-service.js", "content/shadow-hook.js", "content/shadow-hook.js"],
    ["background/service-worker.js", "content/book-core-main.js", "content/book-core-main.js"],
    ["popup/message-client.js", "content/book-core-main.js", "content/book-core-main.js"],
    ["background/video-service.js", "content/index.js", "content/index.js"]
  ];
  runtimePaths.forEach(([owner, reference, target]) => {
    assert.match(read(owner), new RegExp(reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(exists(target), true, `${target} 不存在`);
  });
});
