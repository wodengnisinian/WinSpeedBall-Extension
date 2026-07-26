const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function element(value = "") {
  const classes = new Set();
  return {
    value,
    textContent: "",
    disabled: false,
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    offsetWidth: 320,
    listeners: {},
    attributes: {},
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
      contains(name) { return classes.has(name); }
    },
    scrollTo(options) { this.scrollTop = Number(options && options.top || 0); },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(type, listener) { this.listeners[type] = listener; }
  };
}

function buildController(responses) {
  const elements = {
    aiTeachingProvider: element("deepseek"),
    aiTeachingMethodHint: element(""),
    aiTeachingProblem: element("2 + 3 等于多少？"),
    aiTeachingAttemptTitle: element(""),
    aiTeachingAttempt: element(""),
    aiTeachingGuidance: element(""),
    aiTeachingProgress: element(""),
    aiTeachingScrollProgress: element(""),
    aiTeachingScrollTopBtn: element(""),
    aiTeachingScrollUpBtn: element(""),
    aiTeachingScrollDownBtn: element(""),
    aiTeachingScrollBottomBtn: element(""),
    aiTeachingStatus: element(""),
    readPageForTeachingBtn: element(""),
    startAiTeachingBtn: element(""),
    continueAiTeachingBtn: element(""),
    explainAiTeachingBtn: element(""),
    resetAiTeachingBtn: element("")
  };
  const writes = [];
  const calls = [];
  const storage = {
    get(keys, callback) { callback({}); },
    set(data, callback) { writes.push(data); if (callback) callback({ ok: true }); },
    remove() {}
  };
  const context = {
    self: { addEventListener() {} },
    Promise,
    Object,
    Array,
    String,
    Number,
    Date,
    Math,
    RegExp,
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "popup/ai-teaching-controller.js"), "utf8"), context);
  const controller = context.self.WinSpeedBallAiTeachingController.create({
    byId: (id) => elements[id],
    sendMessage(message) {
      calls.push(message);
      return Promise.resolve(responses.shift());
    },
    storage,
    isProviderConfigured: () => true,
    addDetailedLog() {},
    setTopStatus() {}
  });
  return { api: context.self.WinSpeedBallAiTeachingController, controller, elements, writes, calls };
}

test("AI 教学从公式解析、原题对应和辅助例子开始且只提出一个问题", async () => {
  const fixture = buildController([{
    ok: true,
    content: "第 1 步｜公式解析\n本步公式：总量 = 原有量 + 增加量。\n符号与条件：三个量使用相同单位。\n题目对应：原有量是 2，增加量是 3。\n顺带举例：1 + 2 = 3。\n回到原题：2 + 3 应怎样代入公式？请说明理由。",
    model: "test-model"
  }]);
  const result = await fixture.controller.start();
  assert.equal(result.ok, true);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].action, "askAiTeaching");
  assert.equal(fixture.calls[0].payload.provider, "deepseek");
  assert.equal(fixture.calls[0].payload.temperature, 0.3);
  assert.match(fixture.calls[0].payload.messages[0].content, /公式解析式教学/);
  assert.match(fixture.calls[0].payload.messages[0].content, /指出公式或规律→解释符号与条件→对应原题条件→顺带举例→回到原题提问/);
  assert.match(fixture.calls[0].payload.messages[0].content, /每次回复只能提出一个核心问题/);
  assert.match(fixture.calls[0].payload.messages[0].content, /本步公式.*符号与条件.*题目对应.*顺带举例.*回到原题/s);
  assert.match(fixture.calls[0].payload.messages[0].content, /没有适用公式时写“本步规律”，严禁编造公式/);
  assert.match(fixture.calls[0].payload.messages[0].content, /所有数学公式必须使用标准 LaTeX/);
  assert.match(fixture.calls[0].payload.messages[0].content, /禁止把 c\^2 输出成 c 2/);
  assert.match(fixture.calls[0].payload.messages[0].content, /不能复制原题，不能代入原题数据/);
  assert.match(fixture.calls[0].payload.messages[0].content, /不能把复述题意、判断题型、机械抄写已知条件作为单独步骤/);
  assert.match(fixture.calls[0].payload.messages[0].content, /迁移答对且能说明依据/);
  assert.match(fixture.calls[0].payload.messages[1].content, /2 \+ 3 等于多少/);
  assert.match(fixture.calls[0].payload.messages.at(-1).content, /第 1 步｜公式解析/);
  assert.match(fixture.calls[0].payload.messages.at(-1).content, /本步公式、符号与条件、题目对应、顺带举例、回到原题/);
  assert.match(fixture.calls[0].payload.messages.at(-1).content, /所有公式使用标准 LaTeX/);
  assert.match(fixture.calls[0].payload.messages.at(-1).content, /没有现成公式时使用定理、定义或规律，不能编造公式/);
  assert.match(fixture.calls[0].payload.messages.at(-1).content, /不能复制或代入原题数据/);
  assert.equal(fixture.controller.getSession().step, 1);
  assert.equal(fixture.controller.getSession().method, "adaptive");
  assert.equal(fixture.controller.getSession().supportLevel, 0);
  assert.equal(fixture.controller.getSession().phase, "active");
  assert.match(fixture.elements.aiTeachingGuidance.textContent, /本步公式/);
  assert.equal(fixture.elements.aiTeachingProgress.textContent, "公式解析 · 第 1 步");
  assert.equal(fixture.elements.aiTeachingAttemptTitle.textContent, "我的回答与思路");
  assert.equal(fixture.elements.continueAiTeachingBtn.textContent, "提交回答");
  assert.equal(fixture.elements.explainAiTeachingBtn.textContent, "公式与例题");
  assert.equal(Object.prototype.hasOwnProperty.call(fixture.writes.at(-1), "aiQuestionHistoryByProvider"), false);
});

test("AI教学为普通 Provider 保留教学温度且不添加额外采样参数", async () => {
  const fixture = buildController([{
    ok: true,
    content: "第 1 步｜公式解析\n本步规律：等式两边同时进行相同运算。\n顺带举例：y + 2 = 6。\n回到原题：你准备先消去哪一项？"
  }]);
  fixture.elements.aiTeachingProvider.value = "openai";

  const result = await fixture.controller.start();
  const payload = fixture.calls[0].payload;

  assert.equal(result.ok, true);
  assert.equal(payload.provider, "openai");
  assert.equal(payload.temperature, 0.3);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "top_p"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "top_k"), false);
});

test("AI 教学完成原题后先做迁移检验，通过后才给最终总结", async () => {
  const fixture = buildController([
    { ok: true, content: "第 1 步｜公式解析\n本步公式：总量 = 原有量 + 增加量。\n题目对应：原有量为 2，增加量为 3。\n顺带举例：1 + 2 = 3。\n回到原题：2 + 3 表示怎样的数量变化？请给出结果和依据。", model: "test-model" },
    { ok: true, content: "第 2 步｜迁移检验\n原题结论是 5。迁移题：4 + 3 等于多少？请说明你沿用了什么方法。", model: "test-model" },
    { ok: true, content: "已完成\n最终答案：2 + 3 = 5。\n方法链：确定增加关系→完成相加。\n关键依据：加 3 表示增加 3。\n易错点：漏数起点。\n自检清单：检查方向；检查次数。", model: "test-model" }
  ]);
  await fixture.controller.start();
  fixture.elements.aiTeachingAttempt.value = "结果是 5，因为从 2 开始增加 3 个单位。";
  const transferResult = await fixture.controller.continueTeaching();
  assert.equal(transferResult.ok, true);
  assert.equal(fixture.controller.getSession().phase, "transfer");
  assert.equal(fixture.elements.aiTeachingProgress.textContent, "迁移检验");
  assert.equal(fixture.elements.aiTeachingAttemptTitle.textContent, "我的迁移回答");
  assert.equal(fixture.elements.continueAiTeachingBtn.textContent, "提交迁移回答");
  assert.match(fixture.calls[1].payload.messages.at(-1).content, /若原题已由我完成，则进入“迁移检验”/);
  fixture.elements.aiTeachingAttempt.value = "结果是 7，仍然从 4 开始增加 3 个单位。";
  const result = await fixture.controller.continueTeaching();
  assert.equal(result.ok, true);
  assert.equal(fixture.controller.getSession().phase, "completed");
  assert.equal(fixture.elements.aiTeachingAttempt.value, "");
  assert.equal(fixture.elements.aiTeachingProgress.textContent, "已完成");
  assert.match(fixture.calls[2].payload.messages.at(-1).content, /这是我对迁移检验的回答/);
  assert.match(fixture.calls[2].payload.messages.at(-1).content, /最终答案、公式链或方法链、关键依据、易错点、自检清单/);
  assert.match(fixture.elements.aiTeachingGuidance.textContent, /已完成/);
});

test("模型不能跳过迁移检验提前结束教学", async () => {
  const fixture = buildController([
    { ok: true, content: "第 1 步｜公式解析\n本步公式：总量 = 原有量 + 增加量。\n顺带举例：1 + 2 = 3。\n回到原题：2 + 3 的结果是什么？请说明依据。", model: "test-model" },
    { ok: true, content: "已完成\n最终答案：2 + 3 = 5。", model: "test-model" }
  ]);
  await fixture.controller.start();
  fixture.elements.aiTeachingAttempt.value = "结果是 5，因为增加了 3。";
  await fixture.controller.continueTeaching();
  assert.equal(fixture.controller.getSession().phase, "active");
  assert.notEqual(fixture.elements.aiTeachingProgress.textContent, "已完成");
});

test("迁移检验请求提示后仍停留在迁移阶段", async () => {
  const fixture = buildController([
    { ok: true, content: "第 1 步｜公式解析\n本步公式：总量 = 原有量 + 增加量。\n顺带举例：1 + 2 = 3。\n回到原题：2 + 3 的结果是什么？请说明依据。", model: "test-model" },
    { ok: true, content: "第 2 步｜迁移检验\n4 + 3 的结果是什么？请说明方法。", model: "test-model" },
    { ok: true, content: "第 2 步｜公式提示\n本步公式：总量 = 原有量 + 增加量。\n回到原题：现在应从 4 向哪个方向移动？", model: "test-model" }
  ]);
  await fixture.controller.start();
  fixture.elements.aiTeachingAttempt.value = "原题结果是 5，因为从 2 增加 3。";
  await fixture.controller.continueTeaching();
  assert.equal(fixture.controller.getSession().phase, "transfer");
  await fixture.controller.explain();
  assert.equal(fixture.controller.getSession().phase, "transfer");
  assert.equal(fixture.elements.aiTeachingProgress.textContent, "迁移检验");
  assert.equal(fixture.elements.aiTeachingAttemptTitle.textContent, "我的迁移回答");
});

test("公式解析式教学要求公式依据，达标后进入下一公式步骤", async () => {
  const fixture = buildController([
    { ok: true, content: "第 1 步｜公式解析\n本步规律：等式两边同时进行相同运算，等式仍成立。\n题目对应：要消去左边的 3，两边需要同步处理。\n顺带举例：y + 2 = 6 时，两边同时减 2。\n回到原题：要消去等式左边的 3，两边应进行什么运算？请说明依据。", model: "test-model" },
    { ok: true, content: "第 1 步｜公式提示\n本步规律：等式两边必须进行相同运算。\n题目对应：左边减 3 时右边也要减 3。\n回到原题：等式两边应怎样保持相同运算？", model: "test-model" },
    { ok: true, content: "第 2 步｜公式解析\n本步公式：x = b ÷ a（ax = b，a ≠ 0）。\n顺带举例：3y = 9 时两边除以 3。\n回到原题：2x = 4 的两边接下来应进行什么相同运算？", model: "test-model" }
  ]);
  fixture.elements.aiTeachingProblem.value = "解方程：2x + 3 = 7";
  await fixture.controller.start();
  await fixture.controller.explain();
  assert.equal(fixture.controller.getSession().supportLevel, 1);
  fixture.elements.aiTeachingAttempt.value = "";
  const emptyResult = await fixture.controller.continueTeaching();
  assert.equal(emptyResult.ok, false);
  assert.match(fixture.elements.aiTeachingStatus.textContent, /请先根据公式解析在回答框中/);
  fixture.elements.aiTeachingAttempt.value = "等式两边同时减 3，得到 2x = 4";
  const result = await fixture.controller.continueTeaching();
  assert.equal(result.ok, true);
  assert.equal(fixture.controller.getSession().step, 2);
  assert.equal(fixture.controller.getSession().supportLevel, 0);
  assert.match(fixture.calls[2].payload.messages.at(-1).content, /第 2 步｜公式解析/);
  assert.match(fixture.calls[2].payload.messages.at(-1).content, /下一步的一条公式或规律/);
  assert.match(fixture.elements.aiTeachingGuidance.textContent, /2x = 4.*什么相同运算/s);
  assert.equal(fixture.elements.continueAiTeachingBtn.textContent, "提交回答");
  assert.equal(fixture.elements.aiTeachingAttemptTitle.textContent, "我的回答与思路");
  assert.equal(fixture.elements.aiTeachingProgress.textContent, "公式解析 · 第 2 步");
});

test("学生在公式帮助后恢复思考时会撤掉支架并回到公式解析", async () => {
  const fixture = buildController([
    { ok: true, content: "第 1 步｜公式解析\n本步规律：等式两边同加减同一个数仍相等。\n顺带举例：天平两侧同步增加 1。\n回到原题：等式两边为什么必须做相同运算？", model: "test-model" },
    { ok: true, content: "第 1 步｜公式提示\n本步规律：等式两边必须同步变化。\n回到原题：怎样操作才能保持相等？", model: "test-model" },
    { ok: true, content: "第 1 步｜公式解析\n本步规律：等式两边同步变化保持相等。\n回到原题：这个原则为什么能保证解不被改变？", model: "test-model" }
  ]);
  await fixture.controller.start();
  await fixture.controller.explain();
  assert.equal(fixture.controller.getSession().supportLevel, 1);
  fixture.elements.aiTeachingAttempt.value = "两边一起变化才能保持相等。";
  await fixture.controller.continueTeaching();
  assert.equal(fixture.controller.getSession().step, 1);
  assert.equal(fixture.controller.getSession().supportLevel, 0);
  assert.equal(fixture.elements.aiTeachingProgress.textContent, "公式解析 · 第 1 步");
  assert.equal(fixture.api.replyReturnsToQuestioning("第 1 步｜公式解析"), true);
});

test("公式与例题会按公式提示、代入示范和完整例题逐级升级", async () => {
  const fixture = buildController([
    { ok: true, content: "第 1 步｜公式解析\n本步规律：等式两边同步运算。\n题目对应：要消去左边的 3。\n顺带举例：y + 2 = 6 时两边减 2。\n回到原题：消去左边的 3 时两边应做什么？", model: "test-model" },
    { ok: true, content: "第 1 步｜公式提示\n本步规律：等式两边做相同运算仍相等。\n题目对应：原题两边都应减 3。\n回到原题：两边应做什么？", model: "test-model" },
    { ok: true, content: "第 1 步｜代入示范\n本步规律：等式两边同步减去同一个数。\n例题：y + 2 = 6，两边减 2 得 y = __。\n回到原题：两边减 3 后得到什么？", model: "test-model" },
    { ok: true, content: "第 1 步｜完整例题\n公式选择：等式两边同步运算。\n条件检查：两边减去相同数。\n量的对应：需要消去加数 2。\n代入计算：y + 2 - 2 = 6 - 2。\n结果检验：y = 4。\n回到原题：2x + 3 = 7 的两边同时减 3 后得到什么？", model: "test-model" }
  ]);
  fixture.elements.aiTeachingProblem.value = "解方程：2x + 3 = 7";
  await fixture.controller.start();
  await fixture.controller.explain();
  assert.equal(fixture.controller.getSession().supportLevel, 1);
  assert.match(fixture.calls[1].payload.messages.at(-1).content, /第 1 级“公式提示”/);
  assert.match(fixture.calls[1].payload.messages.at(-1).content, /符号、单位和适用条件/);
  assert.equal(fixture.elements.aiTeachingProgress.textContent, "公式提示 · 第 1 步");
  await fixture.controller.explain();
  assert.equal(fixture.controller.getSession().supportLevel, 2);
  assert.match(fixture.calls[2].payload.messages.at(-1).content, /第 2 级“代入示范”/);
  assert.match(fixture.calls[2].payload.messages.at(-1).content, /把最关键计算留空/);
  assert.equal(fixture.elements.aiTeachingProgress.textContent, "代入示范 · 第 1 步");
  const result = await fixture.controller.explain();
  assert.equal(result.ok, true);
  assert.equal(fixture.controller.getSession().supportLevel, 3);
  assert.equal(fixture.controller.getSession().step, 1);
  assert.match(fixture.calls[3].payload.messages.at(-1).content, /第 3 级“完整例题”/);
  assert.match(fixture.calls[3].payload.messages.at(-1).content, /公式选择、条件检查、量的对应、代入计算、结果检验、回到原题/);
  assert.match(fixture.calls[3].payload.messages.at(-1).content, /不能解答原题当前步骤/);
  assert.equal(fixture.elements.aiTeachingProgress.textContent, "完整例题 · 第 1 步");
});

test("理解检查答错且回复未给新步骤号时保持当前步骤", async () => {
  const fixture = buildController([
    { ok: true, content: "第 1 步｜公式解析\n本步规律：等式两边同步运算。\n顺带举例：y + 2 = 6 时两边同步处理。\n回到原题：消去等式左边的 3 时，两边应做什么？", model: "test-model" },
    { ok: true, content: "反馈：关键错误是只改变了等式左边。等式右边应进行什么相同运算？", model: "test-model" }
  ]);
  fixture.elements.aiTeachingProblem.value = "解方程：2x + 3 = 7";
  await fixture.controller.start();
  fixture.elements.aiTeachingAttempt.value = "只需要左边减 3";
  const result = await fixture.controller.continueTeaching();
  assert.equal(result.ok, true);
  assert.equal(fixture.controller.getSession().step, 1);
  assert.equal(fixture.controller.getSession().supportLevel, 0);
  assert.equal(fixture.elements.aiTeachingProgress.textContent, "公式解析 · 第 1 步");
});

test("分步指导支持平滑翻屏、阅读进度和滚动位置记忆", () => {
  const fixture = buildController([]);
  const guidance = fixture.elements.aiTeachingGuidance;
  guidance.scrollHeight = 1000;
  guidance.clientHeight = 250;
  fixture.controller.bind();

  fixture.elements.aiTeachingScrollDownBtn.listeners.click();
  assert.equal(guidance.scrollTop, 205);
  assert.equal(fixture.controller.getSession().guidanceScrollTop, 205);
  assert.equal(fixture.elements.aiTeachingScrollProgress.textContent, "阅读 27%");

  fixture.elements.aiTeachingScrollBottomBtn.listeners.click();
  assert.equal(guidance.scrollTop, 750);
  assert.equal(fixture.elements.aiTeachingScrollProgress.textContent, "阅读 100%");
  assert.equal(fixture.elements.aiTeachingScrollDownBtn.disabled, true);

  let prevented = false;
  guidance.listeners.keydown({ key: "Home", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(guidance.scrollTop, 0);
  assert.equal(fixture.elements.aiTeachingScrollProgress.textContent, "阅读 0%");

  guidance.scrollTop = 375;
  guidance.listeners.scroll();
  assert.equal(fixture.controller.getSession().guidanceScrollTop, 375);
  assert.equal(fixture.elements.aiTeachingScrollProgress.textContent, "阅读 50%");
});

test("旧版引导和撞墙教学记录会迁移到自适应机制", () => {
  const fixture = buildController([]);
  for (const method of ["guided", "wall"]) {
    const migrated = fixture.api.normalizeSession({
      version: 2,
      provider: "openai",
      method,
      problem: "保留的题目",
      attempt: "保留的尝试",
      guidance: "保留的指导",
      guidanceScrollTop: 120,
      step: 4,
      phase: "active",
      messages: [{ role: "assistant", content: "第 4 步" }]
    });
    assert.equal(migrated.version, 4);
    assert.equal(migrated.method, "adaptive");
    assert.equal(migrated.problem, "保留的题目");
    assert.equal(migrated.guidance, "保留的指导");
    assert.equal(migrated.step, 4);
    assert.equal(migrated.guidanceScrollTop, 120);
  }
  assert.equal(fixture.api.normalizeMethod("guided"), "adaptive");
  assert.equal(fixture.api.normalizeMethod("wall"), "adaptive");
  assert.equal(fixture.api.normalizeSession({ phase: "transfer" }).phase, "transfer");
  assert.equal(fixture.api.replyTransferCheck("第 5 步｜迁移检验\n请完成变式题。"), true);
  assert.equal(fixture.api.replyTransferCheck("第 5 步｜引导提问"), false);
});

test("AI 教学拒绝空题目，空尝试时引导用户请求公式帮助", async () => {
  const fixture = buildController([
    { ok: true, content: "第 1 步｜公式解析\n本步规律：先处理限制范围最小的条件。\n题目对应：先找原题中限制最强的条件。\n顺带举例：边界条件可先排除不可能情况。\n回到原题：你认为应先处理哪个条件？请说明依据。" },
    { ok: true, content: "第 1 步｜公式提示\n本步规律：边界条件可以先排除不可能情况。\n回到原题：哪个边界条件最先限制答案？" }
  ]);
  fixture.elements.aiTeachingProblem.value = "";
  const emptyProblem = await fixture.controller.start();
  assert.equal(emptyProblem.ok, false);
  assert.match(fixture.elements.aiTeachingStatus.textContent, /请先输入/);
  fixture.elements.aiTeachingProblem.value = "测试题";
  await fixture.controller.start();
  fixture.elements.aiTeachingAttempt.value = "";
  const emptyAttempt = await fixture.controller.continueTeaching();
  assert.equal(emptyAttempt.ok, false);
  assert.match(fixture.elements.aiTeachingStatus.textContent, /请先根据公式解析在回答框中/);
  assert.match(fixture.elements.aiTeachingStatus.textContent, /公式与例题/);
  const hint = await fixture.controller.explain();
  assert.equal(hint.ok, true);
  assert.equal(fixture.controller.getSession().supportLevel, 1);
});

test("清理 AI 数据后会丢弃尚未返回的教学回复", async () => {
  let resolveRequest;
  const pending = new Promise((resolve) => { resolveRequest = resolve; });
  const fixture = buildController([]);
  fixture.controller = fixture.api.create({
    byId: (id) => fixture.elements[id],
    sendMessage() { return pending; },
    storage: {
      get(keys, callback) { callback({}); },
      set(data, callback) { if (callback) callback({ ok: true }); },
      remove() {}
    },
    isProviderConfigured: () => true,
    addDetailedLog() {},
    setTopStatus() {}
  });
  const request = fixture.controller.start();
  fixture.controller.clear();
  resolveRequest({ ok: true, content: "第 1 步\n这条迟到回复不应恢复。", model: "test-model" });
  const result = await request;
  assert.equal(result.discarded, true);
  assert.equal(fixture.controller.getSession().phase, "idle");
  assert.equal(fixture.controller.getSession().guidance, "");
});
