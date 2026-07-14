(function () {
  "use strict";

  var STORAGE_KEY = "aiReplyWindowPayload";
  var latestText = "";
  var content = document.getElementById("replyContent");
  var status = document.getElementById("copyStatus");
  var copyButton = document.getElementById("copyBtn");

  function render(payload) {
    latestText = String(payload && payload.content || "").trim();
    content.textContent = latestText || "没有可显示的 AI 回复。";
    content.scrollTop = 0;
    copyButton.disabled = !latestText;
    document.body.dataset.hasReply = latestText ? "true" : "false";
    status.textContent = latestText ? "已更新 · Alt+M 复制" : "暂无回复";
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
      status.textContent = copied ? "回复已复制" : "复制失败";
      return copied;
    });
  }

  copyButton.addEventListener("click", copyReply);
  document.getElementById("closeBtn").addEventListener("click", function () { window.close(); });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      window.close();
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
