(function (global) {
  "use strict";

  var STORAGE_KEY = "aiTeachingSession";
  var PROVIDER_IDS = ["deepseek", "openai", "claude", "local"];
  var MAX_PROBLEM_LENGTH = 30000;
  var MAX_ATTEMPT_LENGTH = 12000;
  var MAX_TURN_LENGTH = 20000;
  var MAX_CONTEXT_LENGTH = 95000;
  var SYSTEM_PROMPT = [
    "你是一名采用“公式解析式教学”的耐心、严谨的 AI 解题老师。面对数学、物理、化学、生物、地理计算、信息技术等理科题时，主线必须是“指出公式或规律→解释符号与条件→对应原题条件→顺带举例→回到原题提问”，例子只能用于辅助理解。",
    "必须使用简体中文，并在每一步直接引用原题中的具体数字、条件、表达式、选项、证据或结论。",
    "除“已完成”总结外，每次回复只能提出一个核心问题，然后立即停下来等待学习者回答；不能连续堆叠问题、不能自问自答，也不能询问“懂了吗”“会了吗”等无法诊断理解的问题。",
    "每次只处理一个实质性解题步骤，不能一次给出完整过程或最终答案，也不能把复述题意、判断题型、机械抄写已知条件作为单独步骤。",
    "理科题除迁移检验外，每个教学回复必须按“第 N 步｜公式解析、本步公式、符号与条件、题目对应、顺带举例、回到原题”组织。“本步公式”只写当前步骤真正需要的一条公式、定理、定律、反应关系或算法关系，不能堆砌多个公式。",
    "“符号与条件”要用通俗语言逐个解释本步出现的符号、单位、方向、正负号和公式成立条件；“题目对应”要把原题的已知量、未知量与公式中的量逐项对应，并说明为什么使用这条公式。不能只报公式名称，也不能跳过条件直接代数。",
    "所有数学公式必须使用标准 LaTeX：独立公式单独写在“\\[”与“\\]”之间，行内公式写在“\\(”与“\\)”之间；指数必须写成“^{...}”，分式使用“\\frac{...}{...}”，根式使用“\\sqrt{...}”，三角函数使用“\\sin、\\cos、\\tan”。化学方程式可使用“\\ce{...}”。禁止把 c^2 输出成 c 2，也不要把 Markdown 的星号当作公式排版。",
    "数学题没有现成计算公式时，使用定义、定理、恒等关系或通法；化学题可使用化学方程式、守恒关系、物质的量关系或反应条件；生物和地理题可使用规律、机制链或统计关系；信息技术题可使用算法、逻辑关系或复杂度表达。确实没有适用公式时写“本步规律”，严禁编造公式。",
    "“顺带举例”必须使用与原题同一公式或规律、但数字、对象或情境不同的极短例子，只演示本步的一次公式选择、量的对应或代入动作。不能复制原题，不能代入原题数据，不能泄露原题当前步骤或最终答案。",
    "非理科题保留同样的单步提问机制，把“本步公式”替换为“本步规则”或“证据关系”，先说明规则和适用条件，再对应原题证据，顺带给一个不同情境的短例子。",
    "开场必须使用“第 1 步｜公式解析”。先识别原题第一步需要求什么和已知什么，指出本步公式或规律并解释适用条件，再对应原题，最后顺带给一个不同数据的小例子；回到原题后提出一个最能判断学习者是否会选公式、对应量或完成当前运算的问题。",
    "收到回答后先在内部判断属于“正确且依据充分、方向正确但依据不足、关键误解、没有思路”中的哪一种。对外回复最多包含一句精准观察、一个核心问题和一句作答要求，不要输出冗长评价。",
    "回答正确但依据不足时，沿用当前步骤号，明确指出缺少的是公式选择、适用条件、量的对应、单位还是计算依据；可顺带给一个针对该缺口的对比例子，再回到原题只追问一个问题。只有答案与依据都达到当前要求，才进入下一步。",
    "回答正确且依据充分时，简短指出公式使用正确的原因，并使用“第 N 步｜公式解析”进入下一步；继续先讲下一步所需公式或规律，再对应原题并只问一个需要学习者动手完成的问题。",
    "回答错误时，先保留回答中确实有效的部分，再只指出一个最关键缺口；优先纠正公式、适用条件、量的对应、单位或符号中的一个问题，随后顺带给一个不同数据的纠错例子，并回到原题提出一个让学习者自行修正的问题。禁止泛泛鼓励、罗列多个错误或直接泄露答案。",
    "学习者点击“公式与例题”时按固定阶梯增加帮助：第 1 级“公式提示”只重述本步公式、符号含义和适用条件；第 2 级“代入示范”用另一道同构小题展示如何把已知量对应并代入公式，但把关键计算留给学习者；第 3 级“完整例题”才完整解答另一道同构小题，并按“公式选择、条件检查、量的对应、代入计算、结果检验”思考出声。",
    "无论帮助提升到哪一级，都不能解答原题当前步骤。每次示范结束后必须回到原题，只问一个公式应用问题；进入新步骤后帮助等级归零，随着学习者表现改善要减少示例，只保留必要的公式与原题对应。",
    "当原题全部推理已经由学习者完成时，不要立即宣布掌握。先输出“第 N 步｜迁移检验”，简短确认原题结论，再给一道只改变表面条件、仍使用同一核心方法的短题，并只问一个迁移问题。",
    "迁移检验用于检查能否独立选择并使用公式或规律，因此首次迁移提问不再提供公式提示或新例子。迁移答错后可以指出一项公式使用缺口并给一个不直接代答的对比例子，再只问一个修正问题；迁移答对且能说明依据时，才以“已完成”开头，依次给出“最终答案：”“公式链：”“关键依据：”“易错点：”“自检清单：”。",
    "最终总结要短而具体，自检清单最多三项；不要再附加新题，也不要声称看过未提供的页面、图片或资料。"
  ].join("\n");
  var GUIDED_SYSTEM_PROMPT = SYSTEM_PROMPT;
  var WALL_SYSTEM_PROMPT = SYSTEM_PROMPT;

  function normalizeProviderId(value) {
    value = String(value || "").toLowerCase();
    return PROVIDER_IDS.indexOf(value) >= 0 ? value : "deepseek";
  }

  function normalizeMethod(value) {
    return "adaptive";
  }

  function systemPromptForMethod(method) {
    return SYSTEM_PROMPT;
  }

  function normalizePhase(value) {
    return ["idle", "active", "transfer", "completed"].indexOf(value) >= 0 ? value : "idle";
  }

  function normalizeMessages(value) {
    var messages = [];
    var total = 0;
    (Array.isArray(value) ? value : []).slice(-16).reverse().some(function (item) {
      if (!item || ["user", "assistant"].indexOf(item.role) < 0) return false;
      var content = String(item.content || "").slice(0, MAX_TURN_LENGTH);
      if (!content) return false;
      if (total + content.length > 60000) return true;
      total += content.length;
      messages.unshift({ role: item.role, content: content });
      return false;
    });
    return messages;
  }

  function emptySession(providerId) {
    return {
      version: 4,
      provider: normalizeProviderId(providerId),
      method: "adaptive",
      problem: "",
      attempt: "",
      guidance: "",
      guidanceScrollTop: 0,
      supportLevel: 0,
      step: 0,
      phase: "idle",
      messages: [],
      updatedAt: 0
    };
  }

  function normalizeSession(value) {
    value = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    var step = Math.max(0, Math.min(999, Math.floor(Number(value.step || 0))));
    return {
      version: 4,
      provider: normalizeProviderId(value.provider),
      method: "adaptive",
      problem: String(value.problem || "").slice(0, MAX_PROBLEM_LENGTH),
      attempt: String(value.attempt || "").slice(0, MAX_ATTEMPT_LENGTH),
      guidance: String(value.guidance || "").slice(0, MAX_TURN_LENGTH),
      guidanceScrollTop: Math.max(0, Math.min(10000000, Math.round(Number(value.guidanceScrollTop || 0)) || 0)),
      supportLevel: Math.max(0, Math.min(3, Math.floor(Number(value.supportLevel || 0)) || 0)),
      step: step,
      phase: normalizePhase(value.phase),
      messages: normalizeMessages(value.messages),
      updatedAt: Math.max(0, Number(value.updatedAt || 0))
    };
  }

  function parseStep(content, fallback) {
    var match = String(content || "").match(/第\s*([0-9]{1,3})\s*步/);
    if (!match) return fallback;
    return Math.max(1, Math.min(999, Number(match[1])));
  }

  function replyCompleted(content) {
    return /(?:^|\n)\s*(?:【)?已完成(?:】)?(?:[：:。\s]|$)/.test(String(content || ""));
  }

  function replyTransferCheck(content) {
    return /(?:^|\n)\s*(?:第\s*[0-9]{1,3}\s*步\s*(?:｜|\|)\s*)?迁移检验(?:[：:。\s]|$)/.test(String(content || ""));
  }

  function replyReturnsToQuestioning(content) {
    return /(?:公式解析|题目对应|示例提问|对比例问|追问引导|引导提问|理解检查|回到原题)/.test(String(content || ""));
  }

  function create(dependencies) {
    dependencies = dependencies || {};
    var byId = dependencies.byId;
    var sendMessage = dependencies.sendMessage;
    var storage = dependencies.storage;
    var session = emptySession("deepseek");
    var busy = false;
    var saveTimer = null;
    var loadedStoredSession = false;
    var defaultProviderId = "deepseek";
    var persistenceEnabled = false;
    var requestGeneration = 0;
    var renderedGuidanceText = "";

    function element(id) {
      return typeof byId === "function" ? byId(id) : null;
    }

    function setStatus(message) {
      var status = element("aiTeachingStatus");
      if (status) status.textContent = String(message || "");
    }

    function renderGuidanceContent(guidance, value) {
      renderedGuidanceText = String(value || "");
      var renderer = dependencies.mathRenderer || global.WSBMathRenderer;
      if (!renderer || typeof renderer.render !== "function") {
        guidance.textContent = renderedGuidanceText;
        return;
      }
      var renderResult;
      try {
        renderResult = renderer.render(guidance, renderedGuidanceText);
      } catch (error) {
        guidance.textContent = renderedGuidanceText;
        return;
      }
      Promise.resolve(renderResult).then(function () {
        if (renderedGuidanceText === String(value || "")) {
          restoreGuidanceScrollPosition();
          updateGuidanceScrollUi();
        }
      }).catch(function () {
        if (renderedGuidanceText === String(value || "")) guidance.textContent = renderedGuidanceText;
      });
    }

    function guidanceMaxScroll(guidance) {
      return Math.max(0, Number(guidance && guidance.scrollHeight || 0) - Number(guidance && guidance.clientHeight || 0));
    }

    function updateGuidanceScrollUi() {
      var guidance = element("aiTeachingGuidance");
      var progress = element("aiTeachingScrollProgress");
      var topButton = element("aiTeachingScrollTopBtn");
      var upButton = element("aiTeachingScrollUpBtn");
      var downButton = element("aiTeachingScrollDownBtn");
      var bottomButton = element("aiTeachingScrollBottomBtn");
      var max = guidanceMaxScroll(guidance);
      var top = Math.max(0, Math.min(max, Number(guidance && guidance.scrollTop || 0)));
      var percentage = max > 0 ? Math.round((top / max) * 100) : (session.guidance ? 100 : 0);
      var atTop = top <= 1;
      var atBottom = max <= 0 || max - top <= 2;
      if (progress) progress.textContent = "阅读 " + percentage + "%";
      if (topButton) topButton.disabled = busy || atTop;
      if (upButton) upButton.disabled = busy || atTop;
      if (downButton) downButton.disabled = busy || atBottom;
      if (bottomButton) bottomButton.disabled = busy || atBottom;
    }

    function setGuidanceScrollTop(nextTop, smooth, remember) {
      var guidance = element("aiTeachingGuidance");
      if (!guidance) return;
      var max = guidanceMaxScroll(guidance);
      var target = Math.max(0, Math.min(max, Math.round(Number(nextTop || 0))));
      session.guidanceScrollTop = target;
      if (typeof guidance.scrollTo === "function") {
        guidance.scrollTo({ top: target, behavior: smooth === true ? "smooth" : "auto" });
      } else {
        guidance.scrollTop = target;
      }
      updateGuidanceScrollUi();
      if (remember === true) schedulePersist();
    }

    function scrollGuidance(command) {
      var guidance = element("aiTeachingGuidance");
      if (!guidance) return;
      var max = guidanceMaxScroll(guidance);
      var current = Math.max(0, Number(guidance.scrollTop || 0));
      var pageSize = Math.max(80, Math.round(Number(guidance.clientHeight || 0) * 0.82));
      var target = current;
      if (command === "top") target = 0;
      if (command === "up") target = current - pageSize;
      if (command === "down") target = current + pageSize;
      if (command === "bottom") target = max;
      setGuidanceScrollTop(target, true, true);
    }

    function restoreGuidanceScrollPosition() {
      setTimeout(function () {
        setGuidanceScrollTop(session.guidanceScrollTop, false, false);
      }, 0);
    }

    function animateGuidanceUpdate() {
      var guidance = element("aiTeachingGuidance");
      if (!guidance || !guidance.classList) return;
      if (typeof guidance.classList.remove === "function") guidance.classList.remove("step-arriving");
      if (typeof guidance.offsetWidth === "number") void guidance.offsetWidth;
      if (typeof guidance.classList.add === "function") guidance.classList.add("step-arriving");
      setTimeout(function () {
        if (guidance.classList && typeof guidance.classList.remove === "function") guidance.classList.remove("step-arriving");
      }, 420);
    }

    function captureInputs() {
      var provider = element("aiTeachingProvider");
      var problem = element("aiTeachingProblem");
      var attempt = element("aiTeachingAttempt");
      if (provider) session.provider = normalizeProviderId(provider.value);
      session.method = "adaptive";
      if (problem) session.problem = String(problem.value || "").slice(0, MAX_PROBLEM_LENGTH);
      if (attempt) session.attempt = String(attempt.value || "").slice(0, MAX_ATTEMPT_LENGTH);
    }

    function persist(callback) {
      callback = typeof callback === "function" ? callback : function () {};
      if (!persistenceEnabled) {
        callback({ ok: true });
        return;
      }
      captureInputs();
      session.updatedAt = Date.now();
      storage.set((function () {
        var payload = {};
        payload[STORAGE_KEY] = normalizeSession(session);
        return payload;
      })(), callback);
    }

    function schedulePersist() {
      captureInputs();
      persistenceEnabled = true;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        saveTimer = null;
        persist();
      }, 160);
    }

    function render() {
      var provider = element("aiTeachingProvider");
      var methodHint = element("aiTeachingMethodHint");
      var problem = element("aiTeachingProblem");
      var attempt = element("aiTeachingAttempt");
      var attemptTitle = element("aiTeachingAttemptTitle");
      var guidance = element("aiTeachingGuidance");
      var progress = element("aiTeachingProgress");
      var startButton = element("startAiTeachingBtn");
      var continueButton = element("continueAiTeachingBtn");
      var explainButton = element("explainAiTeachingBtn");
      var resetButton = element("resetAiTeachingBtn");
      var guidanceTextChanged = false;

      if (provider) provider.value = session.provider;
      if (methodHint) {
        methodHint.textContent = "公式解析式教学：理科题先指出本步公式或规律，解释符号和适用条件，再对应原题条件，顺带举例并只留下一个问题。";
      }
      if (problem) problem.value = session.problem;
      if (attempt) {
        attempt.value = session.attempt;
        attempt.placeholder = session.phase === "transfer"
          ? "写下迁移题答案，并说明依据或检查方法"
          : "回答当前问题，并写下简短依据、计算过程或具体卡点";
      }
      if (attemptTitle) attemptTitle.textContent = session.phase === "transfer" ? "我的迁移回答" : "我的回答与思路";
      if (guidance) {
        var nextGuidance = session.guidance || "输入题目后点击“开始教学”，AI老师会先指出公式或规律并对应原题条件，再顺带举例并提出一个问题。";
        guidanceTextChanged = renderedGuidanceText !== nextGuidance;
        if (guidanceTextChanged) renderGuidanceContent(guidance, nextGuidance);
      }
      if (progress) {
        progress.textContent = busy
          ? "思考中"
          : (session.phase === "completed"
            ? "已完成"
            : (session.phase === "transfer"
              ? "迁移检验"
              : (session.step > 0
              ? (session.supportLevel === 0
                ? "公式解析"
                : (session.supportLevel === 1 ? "公式提示" : (session.supportLevel === 2 ? "代入示范" : "完整例题"))) + " · 第 " + session.step + " 步"
              : "未开始")));
      }
      if (continueButton) continueButton.textContent = session.phase === "transfer" ? "提交迁移回答" : "提交回答";
      if (explainButton) explainButton.textContent = "公式与例题";
      if (startButton) startButton.disabled = busy;
      if (provider) provider.disabled = busy;
      if (continueButton) continueButton.disabled = busy || session.phase === "idle";
      if (explainButton) explainButton.disabled = busy || session.phase === "idle";
      if (resetButton) resetButton.disabled = busy;
      if (guidanceTextChanged) restoreGuidanceScrollPosition();
      else updateGuidanceScrollUi();
    }

    function setBusy(value) {
      busy = value === true;
      render();
    }

    function providerAvailable(providerId) {
      if (typeof dependencies.isProviderConfigured !== "function") return true;
      if (dependencies.isProviderConfigured(providerId)) return true;
      if (typeof dependencies.onProviderUnconfigured === "function") dependencies.onProviderUnconfigured(providerId);
      setStatus("当前 AI 服务尚未配置，请先前往设置页面完成配置。");
      return false;
    }

    function buildRequestMessages(pendingMessage) {
      var systemPrompt = systemPromptForMethod(session.method);
      var problemMessage = {
        role: "user",
        content: "原题：\n" + session.problem
      };
      var fixedLength = systemPrompt.length + problemMessage.content.length;
      var available = Math.max(0, MAX_CONTEXT_LENGTH - fixedLength);
      var candidates = session.messages.concat([pendingMessage]).map(function (item) {
        return { role: item.role, content: String(item.content || "").slice(0, MAX_TURN_LENGTH) };
      });
      var selected = [];
      var used = 0;
      candidates.slice().reverse().some(function (item) {
        if (used + item.content.length > available) return selected.length > 0;
        used += item.content.length;
        selected.unshift(item);
        return false;
      });
      return [
        { role: "system", content: systemPrompt },
        problemMessage
      ].concat(selected);
    }

    function log(message, details, level) {
      if (typeof dependencies.addDetailedLog === "function") {
        dependencies.addDetailedLog("AI教学", message, details || {}, level || "info");
      }
    }

    function runTurn(userContent, fallbackStep, kind) {
      captureInputs();
      if (!providerAvailable(session.provider)) return Promise.resolve({ ok: false, error: "AI 服务尚未配置。" });
      var pendingMessage = { role: "user", content: String(userContent || "").slice(0, MAX_TURN_LENGTH) };
      var requestMessages = buildRequestMessages(pendingMessage);
      var previousMessages = session.messages.slice();
      var previousStep = session.step;
      var previousPhase = session.phase;
      var startedAt = Date.now();
      var generation = ++requestGeneration;
      setBusy(true);
      setStatus(kind === "start"
        ? "AI老师正在分析本步公式、原题条件和辅助例子..."
        : (kind === "explain"
          ? "AI老师正在提供第 " + session.supportLevel + " 级公式帮助..."
          : (session.phase === "transfer" ? "AI老师正在检查你的迁移回答..." : "AI老师正在诊断你的回答与依据...")));
      if (typeof dependencies.setTopStatus === "function") dependencies.setTopStatus("AI 教学中");
      log("教学请求已发出", {
        AI: session.provider,
        教学机制: "公式解析式教学",
        类型: kind === "start" ? "开始教学" : (kind === "explain" ? "公式与例题" : (session.phase === "transfer" ? "迁移检验" : "提交回答")),
        当前步骤: session.step || 0,
        提示等级: session.supportLevel,
        输入字数: pendingMessage.content.length
      });

      return sendMessage({
        action: "askAiTeaching",
        payload: {
          provider: session.provider,
          messages: requestMessages,
          temperature: 0.3
        }
      }).then(function (response) {
        if (generation !== requestGeneration) {
          return { ok: false, discarded: true, error: "教学请求已失效。" };
        }
        if (!response || !response.ok) {
          session.messages = previousMessages;
          setStatus("教学请求失败：" + (response && response.error || "未知错误"));
          log("教学请求失败", {
            AI: session.provider,
            耗时: (Date.now() - startedAt) + "ms",
            原因: response && response.error || "未知错误"
          }, "error");
          if (typeof dependencies.setTopStatus === "function") dependencies.setTopStatus("失败");
          return response || { ok: false, error: "未知错误" };
        }

        var answer = String(response.content || "").trim().slice(0, MAX_TURN_LENGTH);
        session.messages = normalizeMessages(previousMessages.concat([pendingMessage, { role: "assistant", content: answer }]));
        session.guidance = answer;
        session.guidanceScrollTop = 0;
        session.step = parseStep(answer, fallbackStep);
        var answerCompleted = replyCompleted(answer);
        var nextPhase = answerCompleted && previousPhase === "transfer"
          ? "completed"
          : ((previousPhase === "transfer" || replyTransferCheck(answer)) ? "transfer" : "active");
        if (kind === "start" || session.step > previousStep || (previousPhase !== "transfer" && nextPhase === "transfer") ||
          (kind === "continue" && replyReturnsToQuestioning(answer))) {
          session.supportLevel = 0;
        }
        session.phase = nextPhase;
        session.attempt = "";
        if (element("aiTeachingAttempt")) element("aiTeachingAttempt").value = "";
        persistenceEnabled = true;
        persist();
        setStatus(session.phase === "completed"
          ? "原题与迁移检验均已完成。你可以复盘公式链或方法链，或点击“重新开始”练习。"
          : (session.phase === "transfer"
            ? "请独立完成迁移检验并说明依据；卡住时可以点击“公式与例题”。"
            : "请根据本步公式、原题对应和辅助例子回答唯一问题；卡住时可以点击“公式与例题”。"));
        log("教学请求完成", {
          AI: session.provider,
          耗时: (Date.now() - startedAt) + "ms",
          当前步骤: session.step,
          模型: response.model || "未知",
          回复字数: answer.length
        }, "success");
        if (typeof dependencies.setTopStatus === "function") dependencies.setTopStatus("完成");
        return response;
      }).catch(function (error) {
        if (generation !== requestGeneration) return { ok: false, discarded: true, error: "教学请求已失效。" };
        session.messages = previousMessages;
        var message = error && error.message || String(error || "未知错误");
        setStatus("教学请求失败：" + message);
        log("教学请求失败", { AI: session.provider, 原因: message }, "error");
        if (typeof dependencies.setTopStatus === "function") dependencies.setTopStatus("失败");
        return { ok: false, error: message };
      }).then(function (response) {
        if (generation === requestGeneration) {
          setBusy(false);
          if (response && response.ok) {
            setGuidanceScrollTop(0, true, false);
            animateGuidanceUpdate();
          }
        }
        return response;
      });
    }

    function start() {
      captureInputs();
      if (!session.problem.trim()) {
        setStatus("请先输入需要讲解的题目，或者点击“读取页面”。");
        return Promise.resolve({ ok: false, error: "题目为空。" });
      }
      session.problem = session.problem.trim();
      session.attempt = "";
      if (element("aiTeachingProblem")) element("aiTeachingProblem").value = session.problem;
      if (element("aiTeachingAttempt")) element("aiTeachingAttempt").value = "";
      session.guidance = "";
      session.guidanceScrollTop = 0;
      session.supportLevel = 0;
      session.step = 0;
      session.phase = "idle";
      session.messages = [];
      persistenceEnabled = true;
      persist();
      return runTurn(
        "请开始公式解析式教学。对于理科题，输出“第 1 步｜公式解析”，按“本步公式、符号与条件、题目对应、顺带举例、回到原题”组织：先指出当前真正需要的一条公式或规律，解释符号、单位和适用条件，再把原题已知量与未知量逐项对应；之后用不同数据或情境顺带给一个极短例子，最后只问一个让我选择公式、对应量、代入、计算或检验的问题。所有公式使用标准 LaTeX，独立公式必须放在“\\[”和“\\]”之间，不能使用 c 2 代替 c^{2}。没有现成公式时使用定理、定义或规律，不能编造公式。例子不能复制或代入原题数据，不能泄露原题当前步骤或最终答案。",
        1,
        "start"
      );
    }

    function continueTeaching() {
      captureInputs();
      if (session.phase === "idle") {
        setStatus("请先点击“开始教学”。");
        return Promise.resolve({ ok: false, error: "教学尚未开始。" });
      }
      if (!session.attempt.trim()) {
        setStatus("请先根据公式解析在回答框中写下答案与简短依据；如果暂时没有思路，请点击“公式与例题”。");
        return Promise.resolve({ ok: false, error: "当前步骤回答为空。" });
      }
      if (session.phase === "transfer") {
        return runTurn([
          "这是我对迁移检验的回答：",
          session.attempt.trim(),
          "请检查我是否真正迁移了原题的核心公式或方法。正确且依据充分时，以“已完成”开头并按“最终答案、公式链或方法链、关键依据、易错点、自检清单”简短总结；不正确或依据不足时，继续使用“第 " + Math.max(1, session.step) + " 步｜迁移检验”，只指出一个关键缺口并提出一个让我自行修正的问题。一次只问一个问题，不要直接代答。"
        ].join("\n"), Math.max(1, session.step), "continue");
      }
      var content = [
        "这是我对第 " + Math.max(1, session.step) + " 步问题的回答与依据：",
        session.attempt.trim(),
        "请按公式解析式教学诊断：理科题优先检查公式选择、适用条件、原题各量与符号的对应、单位、正负号和计算。若答案正确但依据不足，明确指出缺少的一个公式依据或条件，可顺带给一个不同数据的对比例子，再回到原题只追问一个问题；若答案与依据都充分，再以“第 " + Math.max(1, session.step + 1) + " 步｜公式解析”进入下一步，先指出下一步的一条公式或规律，再对应原题并顺带给一个极短例子；若原题已由我完成，则进入“迁移检验”；若答错，只保留有效部分、纠正一个公式使用缺口，并给一个不同数据的纠错例子，再问一个让我自行修正的问题。所有例子都不能复制原题或泄露原题答案。"
      ].join("\n");
      return runTurn(content, Math.max(1, session.step), "continue");
    }

    function explain() {
      captureInputs();
      if (session.phase === "idle") {
        setStatus("请先点击“开始教学”。");
        return Promise.resolve({ ok: false, error: "教学尚未开始。" });
      }
      var previousSupportLevel = session.supportLevel;
      session.supportLevel = Math.min(3, session.supportLevel + 1);
      var attemptHint = session.attempt.trim() ? "\n我目前的回答、依据或卡点是：" + session.attempt.trim() : "";
      var currentStage = session.phase === "transfer" ? "迁移检验中" : "第 " + Math.max(1, session.step) + " 步";
      var prompts = {
        1: "我在" + currentStage + "卡住了。请提供第 1 级“公式提示”：只重述当前需要的一条公式或规律，解释符号、单位和适用条件，并指出原题已知量与未知量应对应哪些符号；然后只问一个让我继续动手的问题，不能代答原题。",
        2: "我在" + currentStage + "仍然卡住。请提供第 2 级“代入示范”：先重述公式和适用条件，再用另一道同构小题展示如何把已知量对应并代入公式，但把最关键计算留空让我完成；随后回到原题只问一个公式应用问题，不能代答原题。",
        3: "我在" + currentStage + "经过两级帮助后仍未解决。请提供第 3 级“完整例题”：完整解答另一道同构小题，并按“公式选择、条件检查、量的对应、代入计算、结果检验、回到原题”思考出声地说明；最后回到原题只问一个应用问题，不能解答原题当前步骤。"
      };
      return runTurn(
        prompts[session.supportLevel] + attemptHint,
        Math.max(1, session.step),
        "explain"
      ).then(function (response) {
        if ((!response || !response.ok) && !(response && response.discarded)) {
          session.supportLevel = previousSupportLevel;
          render();
          persist();
        }
        return response;
      });
    }

    function readPage() {
      if (typeof dependencies.readPageText !== "function") return Promise.resolve("");
      setStatus("正在读取当前网页文字...");
      return Promise.resolve(dependencies.readPageText()).then(function (pageText) {
        pageText = String(pageText || "").trim().slice(0, MAX_PROBLEM_LENGTH);
        if (!pageText) {
          setStatus("当前网页没有读取到可用文字，请手动输入题目。");
          return "";
        }
        session.problem = pageText;
        var problem = element("aiTeachingProblem");
        if (problem) problem.value = pageText;
        schedulePersist();
        setStatus("已读取当前网页文字，请确认题目后点击“开始教学”。");
        return pageText;
      }).catch(function (error) {
        setStatus("读取页面失败：" + (error && error.message || String(error)));
        return "";
      });
    }

    function reset(options) {
      options = options || {};
      requestGeneration += 1;
      busy = false;
      var providerId = element("aiTeachingProvider") ? element("aiTeachingProvider").value : session.provider;
      session = emptySession(providerId);
      persistenceEnabled = false;
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      storage.remove(STORAGE_KEY, function () {});
      render();
      setStatus(options.privacyClear ? "AI 教学记录已删除。" : "教学已重置，请输入新题目。");
    }

    function load() {
      storage.get([STORAGE_KEY], function (data) {
        loadedStoredSession = !!(data && data[STORAGE_KEY]);
        persistenceEnabled = loadedStoredSession;
        session = loadedStoredSession ? normalizeSession(data[STORAGE_KEY]) : emptySession(defaultProviderId);
        render();
        if (loadedStoredSession && (Number(data[STORAGE_KEY].version) !== 4 || data[STORAGE_KEY].method !== "adaptive")) persist();
        setStatus(session.phase === "idle"
          ? "公式解析式教学已启用：理科题先指出公式并对应原题条件，再顺带举例并只问一个问题。"
          : (session.phase === "completed"
            ? "已恢复上次完成的教学记录。"
            : (session.phase === "transfer" ? "已恢复迁移检验，请继续完成并说明依据。" : "已恢复上次教学进度，请继续回答当前问题。")));
      });
    }

    function setDefaultProvider(providerId) {
      defaultProviderId = normalizeProviderId(providerId);
      if (loadedStoredSession || session.phase !== "idle" || session.problem) return;
      session.provider = defaultProviderId;
      render();
    }

    function bind() {
      var provider = element("aiTeachingProvider");
      var problem = element("aiTeachingProblem");
      var attempt = element("aiTeachingAttempt");
      var guidance = element("aiTeachingGuidance");
      if (provider) provider.addEventListener("change", schedulePersist);
      if (problem) problem.addEventListener("input", schedulePersist);
      if (attempt) attempt.addEventListener("input", schedulePersist);
      if (guidance) {
        guidance.addEventListener("scroll", function () {
          session.guidanceScrollTop = Math.max(0, Math.round(Number(guidance.scrollTop || 0)));
          updateGuidanceScrollUi();
          schedulePersist();
        });
        guidance.addEventListener("keydown", function (event) {
          var command = {
            Home: "top",
            PageUp: "up",
            PageDown: "down",
            End: "bottom"
          }[event && event.key];
          if (!command) return;
          if (event && typeof event.preventDefault === "function") event.preventDefault();
          scrollGuidance(command);
        });
      }
      [
        ["aiTeachingScrollTopBtn", "top"],
        ["aiTeachingScrollUpBtn", "up"],
        ["aiTeachingScrollDownBtn", "down"],
        ["aiTeachingScrollBottomBtn", "bottom"]
      ].forEach(function (entry) {
        var button = element(entry[0]);
        if (button) button.addEventListener("click", function () { scrollGuidance(entry[1]); });
      });
      if (element("readPageForTeachingBtn")) element("readPageForTeachingBtn").addEventListener("click", readPage);
      if (element("startAiTeachingBtn")) element("startAiTeachingBtn").addEventListener("click", start);
      if (element("continueAiTeachingBtn")) element("continueAiTeachingBtn").addEventListener("click", continueTeaching);
      if (element("explainAiTeachingBtn")) element("explainAiTeachingBtn").addEventListener("click", explain);
      if (element("resetAiTeachingBtn")) element("resetAiTeachingBtn").addEventListener("click", function () { reset(); });
      global.addEventListener("pagehide", function () {
        if (saveTimer) {
          clearTimeout(saveTimer);
          saveTimer = null;
        }
        persist();
      });
      render();
      load();
    }

    return {
      bind: bind,
      load: load,
      start: start,
      continueTeaching: continueTeaching,
      explain: explain,
      readPage: readPage,
      reset: reset,
      clear: function () { reset({ privacyClear: true }); },
      setDefaultProvider: setDefaultProvider,
      scrollGuidance: scrollGuidance,
      getSession: function () { captureInputs(); return normalizeSession(session); },
      buildRequestMessages: buildRequestMessages
    };
  }

  global.WinSpeedBallAiTeachingController = {
    STORAGE_KEY: STORAGE_KEY,
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    ADAPTIVE_SYSTEM_PROMPT: SYSTEM_PROMPT,
    GUIDED_SYSTEM_PROMPT: GUIDED_SYSTEM_PROMPT,
    WALL_SYSTEM_PROMPT: WALL_SYSTEM_PROMPT,
    create: create,
    normalizeSession: normalizeSession,
    normalizeMethod: normalizeMethod,
    parseStep: parseStep,
    replyCompleted: replyCompleted,
    replyTransferCheck: replyTransferCheck,
    replyReturnsToQuestioning: replyReturnsToQuestioning
  };
})(self);
