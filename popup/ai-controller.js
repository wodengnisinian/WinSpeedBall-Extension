(function (global) {
  "use strict";

  function create(dependencies) {
    var byId = dependencies.byId;
    var sendMessage = dependencies.sendMessage;
    var storage = dependencies.storage;
    var historyByProvider = {};

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
    function showReplyWindow(answer) {
      answer = String(answer || "").trim();
      if (!answer) return Promise.resolve({ ok: false, error: "AI 回复为空。" });
      var screenInfo = global.screen || {};
      return sendMessage({ action: "showAiReplyWindow", payload: {
        content: answer,
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
      var instruction = "";
      if (mode === "summary") instruction = "请总结下面内容，输出清晰的要点。";
      else if (mode === "explain") instruction = "请解释下面内容的重点和难点，适合学习者理解。";
      else if (mode === "points") instruction = "请从下面内容中提取知识点，按条目输出。";
      else if (mode === "translate") instruction = "请把下面内容翻译成中文，并保留关键术语。";
      else instruction = question || "请根据下面内容回答我的问题。";
      if (mode !== "custom" && question) instruction += "\n我的补充问题：" + question;
      return instruction + "\n\n内容：\n" + sourceText;
    }

    function buildAutoOcrPrompt(sourceText) {
      var template = String(dependencies.getAutoOcrPromptTemplate() || "").trim();
      if (!template) return sourceText;
      if (template.indexOf("{{OCR}}") >= 0) return template.split("{{OCR}}").join(sourceText);
      return template + "\n\n" + sourceText;
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
        answerLine.style.color = "#8fa8bf";
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
            showReplyWindow(item.answer);
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
      sourceText = (sourceText || byId("ocrText").value || dependencies.getLatestPageText() || "").trim();
      if (!sourceText) {
        updateProviderState(providerId, { answer: "没有可发送的文字。请先框选 OCR，或点击“读取页面”。" });
        return Promise.resolve({ ok: false, error: "没有可发送的文字。" });
      }

      var mode = byId("aiMode").value;
      var isAutoOcr = !!options.autoOcrSourceTime;
      var prompt = isAutoOcr ? buildAutoOcrPrompt(sourceText) : buildPrompt(sourceText);
      var question = isAutoOcr ? prompt : (byId("aiQuestion").value.trim() || "请处理当前内容");
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
          saveHistory({ provider: providerId, model: String(response.model || ""), question: question, mode: mode, answer: answer, time: Date.now() });
        } else {
          dependencies.addDetailedLog("AI", "请求失败", {
            类型: isAutoOcr ? "OCR 自动发送" : "手动请求",
            任务: isAutoOcr ? dependencies.captureLabel(options.autoOcrSourceTime) : "-",
            AI: providerId,
            耗时: (Date.now() - requestStartedAt) + "ms",
            原因: response.error || "未知错误"
          });
        }
        dependencies.setTopStatus(response.ok ? "完成" : "失败");
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
      buildAutoOcrPrompt: buildAutoOcrPrompt
    };
  }

  global.WinSpeedBallPopupAiController = { create: create };
})(self);
