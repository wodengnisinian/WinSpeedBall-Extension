const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "shared", "math-renderer.js"), "utf8");

function loadRenderer() {
  const context = {
    console,
    Promise,
    WeakMap,
    Object
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "shared/math-renderer.js" });
  return context.WSBMathRenderer;
}

test("公式渲染器识别标准行内和独立 LaTeX", () => {
  const renderer = loadRenderer();
  assert.equal(renderer.hasExplicitFormula("速度为 \\(v=s/t\\)。"), true);
  assert.equal(renderer.hasExplicitFormula("\\[c^2=a^2+b^2-2ab\\cos C\\]"), true);
  assert.equal(renderer.hasExplicitFormula("根式为 $x=\\sqrt{2}$。"), true);
  assert.equal(renderer.hasExplicitFormula("```latex\n\\frac{a}{b}\n```"), true);
  assert.equal(renderer.hasExplicitFormula("这里只有普通文字"), false);
});

test("公式渲染器兼容 Markdown 数学围栏", () => {
  const renderer = loadRenderer();
  assert.equal(
    renderer.normalizeFormulaMarkup("公式：\n```latex\nx=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}\n```"),
    "公式：\n\\[x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}\\]"
  );
});

test("公式渲染器兼容旧回复中的空格指数写法", () => {
  const renderer = loadRenderer();
  const formula = renderer.legacyFormulaForLine("余弦定理: (c 2 = a 2 + b 2 - 2ab cos C)");
  assert.equal(formula.label, "余弦定理:");
  assert.equal(formula.tex, "c^{2} = a^{2} + b^{2} - 2ab \\cos C");
  assert.equal(renderer.legacyFormulaForLine("题目对应：边长分别为 2 和 3。"), null);
});

test("公式渲染器把含长说明的公式安全拆成多行", () => {
  const renderer = loadRenderer();
  const mixed = renderer.splitLongMixedFormula(
    "-(\\cos C)\\text{ 是角 }C\\text{ 的余弦值，计算时角度应使用度数制或弧度制并保持一致；此处 }C=60^\\circ,\\ \\cos 60^\\circ=0.5。"
  );
  assert.ok(mixed.length >= 2);
  assert.equal(mixed.every((part) => part.length > 0), true);
  assert.deepEqual(
    Array.from(renderer.splitLongMixedFormula("x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}")),
    ["x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}"]
  );
  const nested = "\\frac{\\text{这是一段很长的分子说明，不能从分式内部拆开；否则结构会损坏。}}{x+1}";
  assert.deepEqual(Array.from(renderer.splitLongMixedFormula(nested)), [nested]);
});

test("公式渲染使用本地 MathJax SVG 且不加载远程资源", () => {
  assert.match(source, /vendor\/mathjax\/tex-svg\.js/);
  assert.match(source, /fonts:\s*extensionUrl\(MATHJAX_FONTS_PATH\)/);
  assert.match(source, /load:\s*\["\[tex\]\/mhchem", "\[tex\]\/physics"\]/);
  assert.match(source, /svg:\s*\{[\s\S]*fontCache:\s*"local"/);
  assert.match(source, /displayOverflow:\s*"linebreak"/);
  assert.match(source, /linebreaks:\s*\{[\s\S]*inline:\s*true[\s\S]*width:\s*"100%"[\s\S]*lineleading:\s*0\.28/);
  assert.match(source, /enableSpeech:\s*false/);
  assert.match(source, /enableBraille:\s*false/);
  assert.match(source, /role", "img"/);
  assert.doesNotMatch(source, /https?:\/\//);
  assert.equal(fs.existsSync(path.join(root, "vendor", "mathjax", "tex-svg.js")), true);
  assert.equal(fs.existsSync(path.join(root, "vendor", "mathjax", "input", "tex", "extensions", "mhchem.js")), true);
  assert.equal(fs.existsSync(path.join(root, "vendor", "mathjax", "input", "tex", "extensions", "physics.js")), true);
  assert.equal(fs.existsSync(path.join(root, "vendor", "mathjax", "fonts", "mathjax-mhchem-font-extension", "svg.js")), true);
  assert.equal(fs.existsSync(path.join(root, "vendor", "mathjax", "LICENSE")), true);
  assert.match(fs.readFileSync(path.join(root, "vendor", "mathjax", "README.md"), "utf8"), /版本：`4\.1\.3`/);
});
