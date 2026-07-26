(function (global) {
  "use strict";

  function finiteNumber(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function maxScroll(element) {
    if (!element) return 0;
    return Math.max(0, finiteNumber(element.scrollHeight, 0) - finiteNumber(element.clientHeight, 0));
  }

  function prefersReducedMotion() {
    try {
      return typeof global.matchMedia === "function" &&
        global.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (error) {
      return false;
    }
  }

  function isEditableTarget(target) {
    if (!target || target.nodeType !== 1) return false;
    var tagName = String(target.tagName || "").toLowerCase();
    return tagName === "input" || tagName === "textarea" || tagName === "select" ||
      target.isContentEditable === true;
  }

  function create(options) {
    options = options || {};
    var element = options.element;
    if (!element) throw new Error("Scroll surface element is required.");

    var progress = options.progress || null;
    var progressText = options.progressText || null;
    var topButton = options.topButton || null;
    var keyboardTarget = options.keyboardTarget || element;
    var onUpdate = typeof options.onUpdate === "function" ? options.onUpdate : function () {};
    var observeMutations = options.observeMutations === true;
    var destroyed = false;
    var frameId = 0;
    var resizeObserver = null;
    var mutationObserver = null;

    function behavior(smooth) {
      return smooth === true && !prefersReducedMotion() ? "smooth" : "auto";
    }

    function state() {
      var max = maxScroll(element);
      var top = Math.max(0, Math.min(max, finiteNumber(element.scrollTop, 0)));
      var overflowing = max > 2;
      var percent = overflowing ? Math.max(0, Math.min(100, Math.round(top / max * 100))) : 100;
      return {
        top: top,
        max: max,
        percent: percent,
        overflowing: overflowing,
        atTop: !overflowing || top <= 2,
        atBottom: !overflowing || max - top <= 2
      };
    }

    function render() {
      if (destroyed) return state();
      var current = state();
      if (element.classList) {
        element.classList.add("scroll-surface");
        element.classList.toggle("scroll-overflowing", current.overflowing);
        element.classList.toggle("scroll-at-top", current.atTop);
        element.classList.toggle("scroll-at-bottom", current.atBottom);
      }
      if (element.dataset) {
        element.dataset.scrollPercent = String(current.percent);
        element.dataset.scrollOverflow = current.overflowing ? "true" : "false";
      }
      if (progress) {
        progress.hidden = !current.overflowing;
        progress.setAttribute("aria-valuemin", "0");
        progress.setAttribute("aria-valuemax", "100");
        progress.setAttribute("aria-valuenow", String(current.percent));
        var bar = progress.firstElementChild || progress;
        if (bar.style) bar.style.transform = "scaleX(" + (current.percent / 100) + ")";
      }
      if (progressText) {
        progressText.textContent = current.overflowing ? "阅读 " + current.percent + "%" : "内容已完整显示";
      }
      if (topButton) {
        topButton.hidden = !current.overflowing || current.atTop;
        topButton.disabled = current.atTop;
      }
      onUpdate(current);
      return current;
    }

    function scheduleRender() {
      if (destroyed || frameId) return;
      var requestFrame = typeof global.requestAnimationFrame === "function"
        ? global.requestAnimationFrame.bind(global)
        : function (callback) { return global.setTimeout(callback, 0); };
      frameId = requestFrame(function () {
        frameId = 0;
        render();
      });
    }

    function setPosition(top, smooth) {
      var target = Math.max(0, Math.min(maxScroll(element), finiteNumber(top, 0)));
      if (typeof element.scrollTo === "function") {
        element.scrollTo({ top: target, behavior: behavior(smooth) });
      } else {
        element.scrollTop = target;
      }
      scheduleRender();
      return target;
    }

    function runCommand(command, smooth) {
      var current = state();
      var page = Math.max(48, finiteNumber(element.clientHeight, 0) * 0.85);
      if (command === "top") return setPosition(0, smooth);
      if (command === "bottom") return setPosition(current.max, smooth);
      if (command === "up") return setPosition(current.top - page, smooth);
      if (command === "down") return setPosition(current.top + page, smooth);
      if (command === "line-up") return setPosition(current.top - 40, smooth);
      if (command === "line-down") return setPosition(current.top + 40, smooth);
      return current.top;
    }

    function handleKeydown(event) {
      if (!event || event.defaultPrevented || isEditableTarget(event.target)) return;
      var commands = {
        Home: "top",
        End: "bottom",
        PageUp: "up",
        PageDown: "down",
        ArrowUp: "line-up",
        ArrowDown: "line-down"
      };
      var command = commands[event.key];
      if (!command || !state().overflowing) return;
      event.preventDefault();
      runCommand(command, true);
    }

    function handleTopClick() {
      runCommand("top", true);
      if (typeof element.focus === "function") {
        try { element.focus({ preventScroll: true }); } catch (error) { element.focus(); }
      }
    }

    element.addEventListener("scroll", scheduleRender, { passive: true });
    if (keyboardTarget && typeof keyboardTarget.addEventListener === "function") {
      keyboardTarget.addEventListener("keydown", handleKeydown);
    }
    if (topButton) topButton.addEventListener("click", handleTopClick);

    if (typeof global.ResizeObserver === "function") {
      resizeObserver = new global.ResizeObserver(scheduleRender);
      resizeObserver.observe(element);
    }
    if (observeMutations && typeof global.MutationObserver === "function") {
      mutationObserver = new global.MutationObserver(scheduleRender);
      mutationObserver.observe(element, { childList: true, subtree: true, characterData: true });
    }

    render();

    return Object.freeze({
      update: render,
      scheduleUpdate: scheduleRender,
      state: state,
      setPosition: setPosition,
      runCommand: runCommand,
      destroy: function () {
        destroyed = true;
        element.removeEventListener("scroll", scheduleRender);
        if (keyboardTarget) keyboardTarget.removeEventListener("keydown", handleKeydown);
        if (topButton) topButton.removeEventListener("click", handleTopClick);
        if (resizeObserver) resizeObserver.disconnect();
        if (mutationObserver) mutationObserver.disconnect();
      }
    });
  }

  global.WinSpeedBallScrollSurface = Object.freeze({
    create: create,
    maxScroll: maxScroll
  });
})(self);
