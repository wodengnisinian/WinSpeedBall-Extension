const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function loadNormalizer() {
  const context = vm.createContext({ Object, String, Array });
  context.self = context;
  vm.runInContext(fs.readFileSync(path.join(root, "shared/structured-text-normalizer.js"), "utf8"), context);
  return context.WinSpeedBallStructuredTextNormalizer;
}

test("结构化文本清理保留 LaTeX、JSON、Markdown、表格和数学符号", () => {
  const normalizer = loadNormalizer();
  const source = [
    "繁體公式：\\(c^2=a^2+b^2\\)，且 x_1≤π、n∈N、c²=4。",
    "{\"answer\":\"B\",\"reason\":\"用 \\\\frac{a}{b}\"}",
    "```json",
    "{\"items\":[1,2]}",
    "```",
    "|選項|值|",
    "|---|---|",
    "|A|1|"
  ].join("\r\n");

  const result = normalizer.normalize(source);
  assert.match(result, /繁體公式：\\\(c\^2=a\^2\+b\^2\\\)/);
  assert.match(result, /x_1≤π、n∈N、c²=4/);
  assert.match(result, /\{"answer":"B","reason":"用 \\\\frac\{a\}\{b\}"\}/);
  assert.match(result, /```json\n\{"items":\[1,2\]\}\n```/);
  assert.match(result, /\|選項\|值\|\n\|---\|---\|\n\|A\|1\|/);
});

test("结构化文本清理仅移除控制字符并保留用户要求的其他语言", () => {
  const normalizer = loadNormalizer();
  assert.equal(
    normalizer.normalize("\u0000繁體 ＡＢＣ 𝕋𝕖𝕤𝕥\n한국어\n日本語"),
    "繁體 ＡＢＣ 𝕋𝕖𝕤𝕥\n한국어\n日本語"
  );
});
