(function (global) {
  "use strict";

  function create(dependencies) {
    var byId = dependencies.byId;
    var sendMessage = dependencies.sendMessage;
    var storage = dependencies.storage;
    var historyByProvider = {};
    var MAX_AI_PROMPT_LENGTH = 50000;
    var MAX_EXPLICIT_REQUIREMENT_LENGTH = 24000;

    function getProviderId() {
      var providerId = typeof dependencies.getProviderId === "function" ? dependencies.getProviderId() : "deepseek";
      providerId = String(providerId || "deepseek").toLowerCase();
      return ["deepseek", "openai", "claude", "local"].indexOf(providerId) >= 0 ? providerId : "deepseek";
    }

    function getHistory(providerId) {
      providerId = providerId || getProviderId();
      if (!Array.isArray(historyByProvider[providerId])) historyByProvider[providerId] = [];
      return historyByProvider[providerId];
    }

    function updateProviderState(providerId, patch) {
      if (typeof dependencies.updateProviderWorkspace === "function") {
        dependencies.updateProviderWorkspace(providerId, patch || {});
        return;
      }
      if (providerId !== getProviderId()) return;
      if (Object.prototype.hasOwnProperty.call(patch || {}, "mode")) byId("aiMode").value = patch.mode;
      if (Object.prototype.hasOwnProperty.call(patch || {}, "question")) byId("aiQuestion").value = patch.question;
      if (Object.prototype.hasOwnProperty.call(patch || {}, "answer")) byId("aiAnswer").value = patch.answer;
    }
    function showReplyWindow(answer, options) {
      options = options || {};
      answer = String(answer || "").trim();
      if (!answer) return Promise.resolve({ ok: false, error: "AI 回复为空。" });
      var screenInfo = global.screen || {};
      return sendMessage({ action: "showAiReplyWindow", payload: {
        content: answer,
        truncated: options.truncated === true,
        windowLeft: Number(global.screenX || 0),
        windowTop: Number(global.screenY || 0),
        windowWidth: Number(global.outerWidth || 320),
        windowHeight: Number(global.outerHeight || 340),
        screenLeft: Number(screenInfo.availLeft || 0),
        screenTop: Number(screenInfo.availTop || 0),
        screenWidth: Number(screenInfo.availWidth || global.outerWidth || 320),
        screenHeight: Number(screenInfo.availHeight || global.outerHeight || 340)
      } });
    }

    function buildPrompt(sourceText) {
      var mode = byId("aiMode").value;
      var question = byId("aiQuestion").value.trim();
      var defaultInstruction = "";
      if (mode === "summary") defaultInstruction = "总结题目或材料，输出清晰的要点。";
      else if (mode === "explain") defaultInstruction = "解释题目或材料的重点和难点，使学习者容易理解。";
      else if (mode === "points") defaultInstruction = "提取题目或材料中的知识点，按条目输出。";
      else if (mode === "translate") defaultInstruction = "把题目或材料翻译成中文，并保留关键术语。";
      else defaultInstruction = "直接回答问题或完成题目要求；用户未明确要求过程时，只输出最简最终答案。";

      var explicitRequirement = question || (mode === "custom"
        ? "只输出最简最终答案，不要解析、不要复述题目、不要添加标题；题目明确要求过程时除外。"
        : "没有额外要求，执行默认任务。");
      if (explicitRequirement.length > MAX_EXPLICIT_REQUIREMENT_LENGTH) {
        explicitRequirement = explicitRequirement.slice(0, MAX_EXPLICIT_REQUIREMENT_LENGTH)
          + "\n【用户要求过长，已保留前 " + MAX_EXPLICIT_REQUIREMENT_LENGTH + " 字。】";
      }
      var finalRequirement = explicitRequirement.length <= 4000
        ? explicitRequirement
        : "严格执行上方“用户明确要求”中的全部内容。";
      var prefix = [
        "请处理下面的题目或材料。",
        "",
        "【默认任务】",
        defaultInstruction,
        "",
        "【用户明确要求】",
        explicitRequirement,
        "",
        "【题目或材料】",
        ""
      ].join("\n");
      var suffix = [
        "",
        "【执行规则】",
        "1. “用户明确要求”的优先级高于“默认任务”；两者冲突时以用户明确要求为准。",
        "2. 同时遵守题目本身写明的作答格式、范围、字数、步骤和精度要求。",
        "3. 用户要求只给答案、不要解析或限定格式时，不得增加解释、标题、复述或其他内容。",
        "4. 默认任务为直接回答且用户未明确要求解析时，只输出最简最终答案；只有用户明确要求过程时才提供过程。",
        "5. 回复前在内部逐项检查要求是否满足，不要输出检查过程。",
        "",
        "必须执行的用户要求：",
        finalRequirement
      ].join("\n");
      var source = String(sourceText || "");
      var sourceBudget = Math.max(0, MAX_AI_PROMPT_LENGTH - prefix.length - suffix.length);
      if (source.length > sourceBudget) {
        var marker = "【来源提示：题目或材料超过单次请求上限，已截取；如果指定内容不完整，请明确说明缺失信息，不要猜测。】\n";
        source = marker.slice(0, sourceBudget)
          + source.slice(0, Math.max(0, sourceBudget - marker.length));
      }
      return (prefix + source + suffix).slice(0, MAX_AI_PROMPT_LENGTH);
    }

    function buildAutoOcrPrompt(sourceText) {
      var template = String(dependencies.getAutoOcrPromptTemplate() || "").trim();
      if (!template) return sourceText;
      if (template.indexOf("{{OCR}}") >= 0) return template.split("{{OCR}}").join(sourceText);
      return template + "\n\n" + sourceText;
    }

    function combineFrameText(frameResults, maxLength) {
      maxLength = Math.max(1000, Math.min(45000, Number(maxLength || 38000)));
      var candidates = [];
      (Array.isArray(frameResults) ? frameResults : []).forEach(function (item, index) {
        var value = item && item.ok !== false ? String(item.text || "").trim() : "";
        if (!value || candidates.some(function (candidate) { return candidate.text === value; })) return;
        var questionSignals = value.match(/(?:第\s*\d+\s*题|[A-DＡ-Ｄ]\s*[.．、:：)）]|问题|题目|选择|填空|判断|证明|求解|计算|question|answer|option)/gi) || [];
        candidates.push({
          index: index,
          text: value,
          sourceLength: Math.max(value.length, Number(item && item.sourceLength || 0)),
          truncated: !!(item && item.truncated),
          score: Math.min(200, questionSignals.length * 20) + Math.min(40, value.length / 500)
        });
      });
      candidates.sort(function (left, right) {
        return right.score - left.score || left.index - right.index;
      });
      candidates = candidates.slice(0, 8);
      if (!candidates.length) return { text: "", truncated: false, frameCount: 0, sourceLength: 0 };

      var sourceLength = candidates.reduce(function (total, candidate) { return total + candidate.sourceLength; }, 0);
      var marker = "【来源提示：网页内容较长，已从多个页面区域截取；如果指定题目不完整，请明确说明缺少内容，不要猜测。】\n\n";
      var guaranteedBudget = Math.floor(maxLength * 0.5);
      var guaranteedPerFrame = Math.max(500, Math.floor(guaranteedBudget / candidates.length));
      var allocations = candidates.map(function (candidate) {
        return Math.min(candidate.text.length, guaranteedPerFrame);
      });
      var used = allocations.reduce(function (total, length) { return total + length; }, 0) + Math.max(0, candidates.length - 1) * 2;
      var remaining = Math.max(0, maxLength - used);
      candidates.forEach(function (candidate, index) {
        if (!remaining) return;
        var extra = Math.min(candidate.text.length - allocations[index], remaining);
        allocations[index] += extra;
        remaining -= extra;
      });

      var truncated = candidates.some(function (candidate, index) {
        return candidate.truncated || allocations[index] < candidate.text.length;
      }) || candidates.length < (Array.isArray(frameResults) ? frameResults.filter(function (item) {
        return item && item.ok !== false && String(item.text || "").trim();
      }).length : 0);
      if (truncated) {
        var markerSpace = marker.length;
        for (var allocationIndex = allocations.length - 1; allocationIndex >= 0 && markerSpace > 0; allocationIndex -= 1) {
          var removable = Math.min(allocations[allocationIndex], markerSpace);
          allocations[allocationIndex] -= removable;
          markerSpace -= removable;
        }
      }
      var text = candidates.map(function (candidate, index) {
        return candidate.text.slice(0, allocations[index]);
      }).filter(Boolean).join("\n\n");
      if (truncated) text = marker + text;
      return {
        text: text.slice(0, maxLength),
        truncated: truncated,
        frameCount: candidates.length,
        sourceLength: sourceLength
      };
    }

    function renderHistory() {
      var wrap = byId("aiHistoryList");
      var history = getHistory();
      if (!wrap) return;
      if (!history.length) {
        wrap.textContent = "暂无记录";
        return;
      }
      wrap.textContent = "";
      history.forEach(function (item, index) {
        var entry = document.createElement("button");
        var questionLine = document.createElement("strong");
        var answerLine = document.createElement("span");
        var answer = item.answer || "";
        entry.type = "button";
        entry.className = "btn";
        entry.style.cssText = "display:block;width:100%;height:auto;margin-bottom:6px;text-align:left;min-height:54px;padding:6px 7px;line-height:1.35;white-space:normal;";
        questionLine.textContent = "Q" + (index + 1) + ": " + (item.question || "");
        answerLine.textContent = "A: " + answer.slice(0, 80) + (answer.length > 80 ? "..." : "");
        answerLine.style.color = "var(--c-muted)";
        entry.appendChild(questionLine);
        entry.appendChild(document.createElement("br"));
        entry.appendChild(answerLine);
        entry.title = "问题：" + (item.question || "") + "\n\n回复：" + answer;
        entry.addEventListener("click", function () {
          var providerId = getProviderId();
          updateProviderState(providerId, {
            mode: item.mode || "custom",
            question: item.question || "",
            answer: item.answer || ""
          });
          if (item.answer) {
            showReplyWindow(item.answer, { truncated: item.truncated === true });
          }
        });
        wrap.appendChild(entry);
      });
    }

    function saveHistory(entry) {
      var providerId = String(entry.provider || getProviderId());
      var history = getHistory(providerId);
      history = history.filter(function (item) {
        return !(item.question === entry.question && item.mode === entry.mode);
      });
      history.unshift(entry);
      history = history.slice(0, 30);
      historyByProvider[providerId] = history;
      storage.set({ aiQuestionHistoryByProvider: historyByProvider }, renderHistory);
    }

    function loadHistory() {
      storage.get(["aiQuestionHistoryByProvider", "aiQuestionHistory"], function (data) {
        historyByProvider = {};
        var stored = data.aiQuestionHistoryByProvider;
        if (stored && typeof stored === "object" && !Array.isArray(stored)) {
          ["deepseek", "openai", "claude", "local"].forEach(function (providerId) {
            if (Array.isArray(stored[providerId])) historyByProvider[providerId] = stored[providerId].slice(0, 30);
          });
        }
        if (!Object.keys(historyByProvider).length && Array.isArray(data.aiQuestionHistory) && data.aiQuestionHistory.length) {
          historyByProvider[getProviderId()] = data.aiQuestionHistory.slice(0, 30);
          storage.set({ aiQuestionHistoryByProvider: historyByProvider }, function () {});
        }
        renderHistory();
      });
    }

    function clearHistory() {
      var providerId = getProviderId();
      historyByProvider[providerId] = [];
      storage.set({ aiQuestionHistoryByProvider: historyByProvider }, function (result) {
        renderHistory();
        dependencies.addDetailedLog("AI", result && result.ok === false ? "清空当前 AI 历史失败" : "清空当前 AI 历史成功", {
          AI: providerId,
          原因: result && result.error || "-"
        }, result && result.ok === false ? "error" : "success");
      });
    }

    function ask(sourceText, options) {
      options = options || {};
      var providerId = getProviderId();
      var typedQuestion = byId("aiQuestion").value.trim();
      sourceText = (sourceText || byId("ocrText").value || dependencies.getLatestPageText() || typedQuestion || "").trim();
      if (!sourceText) {
        updateProviderState(providerId, { answer: "没有可发送的文字。请输入问题、框选 OCR，或点击“读取页面”。" });
        return Promise.resolve({ ok: false, error: "没有可发送的文字。" });
      }

      var mode = byId("aiMode").value;
      var isAutoOcr = !!options.autoOcrSourceTime;
      var prompt = isAutoOcr ? buildAutoOcrPrompt(sourceText) : buildPrompt(sourceText);
      var question = isAutoOcr ? prompt : (typedQuestion || "请处理当前内容");
      if (isAutoOcr) {
        mode = "custom";
        updateProviderState(providerId, { mode: "custom", question: prompt });
      }
      updateProviderState(providerId, { answer: "正在请求 AI..." });
      var requestStartedAt = Date.now();
      dependencies.addDetailedLog("AI", "请求已发出", {
        类型: isAutoOcr ? "OCR 自动发送" : "手动请求",
        任务: isAutoOcr ? dependencies.captureLabel(options.autoOcrSourceTime) : "-",
        AI: providerId,
        模式: mode,
        提示词: isAutoOcr ? (dependencies.getAutoOcrPromptTemplate() ? "自定义模板" : "OCR 原文") : "AI 页面设置",
        输入字数: prompt.length
      });
      dependencies.setTopStatus("AI 请求中");
      var payload = { provider: providerId, prompt: prompt };
      if (options.autoOcrSourceTime) payload.autoOcrSourceTime = Number(options.autoOcrSourceTime);
      return sendMessage({ action: "askAI", payload: payload }).then(function (response) {
        var answer = response.ok ? response.content : "请求失败：" + (response.error || "未知错误");
        updateProviderState(providerId, { answer: answer });
        if (response.ok) {
          dependencies.addDetailedLog("AI", "请求完成", {
            类型: isAutoOcr ? "OCR 自动发送" : "手动请求",
            任务: isAutoOcr ? dependencies.captureLabel(options.autoOcrSourceTime) : "-",
            AI: providerId,
            耗时: (Date.now() - requestStartedAt) + "ms",
            模型: response.model || "未知",
            回复字数: answer.length
          });
          saveHistory({
            provider: providerId,
            model: String(response.model || ""),
            question: question,
            mode: mode,
            answer: answer,
            truncated: response.truncated === true,
            time: Date.now()
          });
        } else {
          dependencies.addDetailedLog("AI", "请求失败", {
            类型: isAutoOcr ? "OCR 自动发送" : "手动请求",
            任务: isAutoOcr ? dependencies.captureLabel(options.autoOcrSourceTime) : "-",
            AI: providerId,
            耗时: (Date.now() - requestStartedAt) + "ms",
            原因: response.error || "未知错误"
          });
        }
        dependencies.setTopStatus(response.ok ? (response.truncated ? "回复不完整" : "完成") : "失败");
        return response;
      });
    }

    return {
      ask: ask,
      loadHistory: loadHistory,
      clearHistory: clearHistory,
      renderHistory: renderHistory,
      showReplyWindow: showReplyWindow,
      buildPrompt: buildPrompt,
      buildAutoOcrPrompt: buildAutoOcrPrompt,
      combineFrameText: combineFrameText
    };
  }

  global.WinSpeedBallPopupAiController = { create: create };
})(self);
