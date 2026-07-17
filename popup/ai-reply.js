(function () {
  "use strict";

  var STORAGE_KEY = "aiReplyWindowPayload";
  var latestText = "";
  var content = document.getElementById("replyContent");
  var status = document.getElementById("copyStatus");
  var meta = document.getElementById("replyMeta");
  var copyButton = document.getElementById("copyBtn");
  var statusTimer = null;

  function countCharacters(text) {
    return Array.from(String(text || "")).length;
  }

  function formatUpdatedAt(value) {
    var date = new Date(Number(value) || Date.now());
    var hours = String(date.getHours()).padStart(2, "0");
    var minutes = String(date.getMinutes()).padStart(2, "0");
    return hours + ":" + minutes + " 更新";
  }

  function defaultStatus() {
    return latestText ? "可选择文字，或一键复制完整回复" : "暂无回复";
  }

  function showTemporaryStatus(message) {
    if (statusTimer) clearTimeout(statusTimer);
    status.textContent = message;
    statusTimer = setTimeout(function () {
      statusTimer = null;
      status.textContent = defaultStatus();
    }, 1800);
  }

  function render(payload) {
    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    latestText = String(payload && payload.content || "").trim();
    content.textContent = latestText || "没有可显示的 AI 回复。";
    content.scrollTop = 0;
    copyButton.disabled = !latestText;
    document.body.dataset.hasReply = latestText ? "true" : "false";
    meta.textContent = latestText
      ? formatUpdatedAt(payload && payload.updatedAt) + " · " + countCharacters(latestText) + " 字"
      : "等待有效回复";
    status.textContent = defaultStatus();
    document.title = latestText ? "AI 回复 · " + countCharacters(latestText) + " 字" : "AI 回复";
  }

  function load() {
    chrome.storage.session.get([STORAGE_KEY], function (data) {
      if (chrome.runtime.lastError) {
        render(null);
        status.textContent = "回复读取失败";
        return;
      }
      render(data && data[STORAGE_KEY]);
    });
  }

  function fallbackCopy() {
    content.focus();
    var selection = window.getSelection();
    var range = document.createRange();
    range.selectNodeContents(content);
    selection.removeAllRanges();
    selection.addRange(range);
    var copied = false;
    try { copied = document.execCommand("copy"); } catch (error) {}
    selection.removeAllRanges();
    return copied;
  }

  function copyReply() {
    if (!latestText) return Promise.resolve(false);
    var copy = navigator.clipboard && typeof navigator.clipboard.writeText === "function"
      ? navigator.clipboard.writeText(latestText).then(function () { return true; }).catch(fallbackCopy)
      : Promise.resolve(fallbackCopy());
    return copy.then(function (copied) {
      showTemporaryStatus(copied ? "回复已复制" : "复制失败，请手动选择文字");
      return copied;
    });
  }

  function closeReplyWindow() {
    if (document.body.dataset.closing === "true") return;
    document.body.dataset.closing = "true";

    function fallbackClose() {
      try { window.close(); } catch (error) {}
    }

    try {
      if (!chrome.windows || typeof chrome.windows.getCurrent !== "function" || typeof chrome.windows.remove !== "function") {
        fallbackClose();
        return;
      }
      chrome.windows.getCurrent(function (windowInfo) {
        var error = chrome.runtime.lastError;
        if (error || !windowInfo || !Number.isInteger(windowInfo.id)) {
          fallbackClose();
          return;
        }
        chrome.windows.remove(windowInfo.id, function () {
          if (chrome.runtime.lastError) fallbackClose();
        });
      });
    } catch (error) {
      fallbackClose();
    }
  }

  copyButton.addEventListener("click", copyReply);
  document.getElementById("closeBtn").addEventListener("click", closeReplyWindow);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeReplyWindow();
      return;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && String(event.key || "").toLowerCase() === "m") {
      event.preventDefault();
      copyReply();
    }
  });
  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName === "session" && changes[STORAGE_KEY]) render(changes[STORAGE_KEY].newValue);
  });
  load();
})();
