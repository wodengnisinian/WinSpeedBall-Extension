(function (global) {
  "use strict";

  function runInFrame(turnDirection) {
    turnDirection = String(turnDirection || "DETECT").toUpperCase();
    var nativeClick = typeof HTMLElement !== "undefined" && HTMLElement.prototype && HTMLElement.prototype.click;

    function safeText(value, maxLength) {
      return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength || 160);
    }

    function isVisible(element) {
      if (!element || element.hidden) return false;
      try {
        var style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
        var rect = element.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1;
      } catch (error) {
        return true;
      }
    }

    function isEnabled(element) {
      if (!element || element.disabled) return false;
      var ariaDisabled = safeText(element.getAttribute && element.getAttribute("aria-disabled"), 16).toLowerCase();
      var className = safeText(element.className, 240).toLowerCase();
      return ariaDisabled !== "true" && !/(^|\s)(disabled|disable|is-disabled)(\s|$)/.test(className);
    }

    function controlLabel(element) {
      var values = [
        element && element.innerText,
        element && element.textContent,
        element && element.value,
        element && element.title,
        element && element.getAttribute && element.getAttribute("aria-label")
      ];
      return safeText(values.filter(Boolean).join(" "), 120).replace(/[\s:：·|]/g, "").toLowerCase();
    }

    function queryUsable(selector) {
      var elements;
      try { elements = document.querySelectorAll(selector); } catch (error) { return null; }
      for (var index = 0; index < elements.length && index < 20; index += 1) {
        if (isVisible(elements[index]) && isEnabled(elements[index])) return elements[index];
      }
      return null;
    }

    function findControl(selectors, labels) {
      for (var index = 0; index < selectors.length; index += 1) {
        var selected = queryUsable(selectors[index]);
        if (selected) return { element: selected, selector: selectors[index], confidence: 2 };
      }
      var controls;
      try { controls = document.querySelectorAll("button,a,[role='button'],input[type='button'],input[type='submit']"); }
      catch (error) { controls = []; }
      for (var controlIndex = 0; controlIndex < controls.length && controlIndex < 240; controlIndex += 1) {
        if (!isVisible(controls[controlIndex]) || !isEnabled(controls[controlIndex])) continue;
        var label = controlLabel(controls[controlIndex]);
        if (labels.indexOf(label) >= 0) return { element: controls[controlIndex], selector: "text:" + label, confidence: 1 };
      }
      return null;
    }

    var prevSelectors = [
      "#pre-page-js", "#prevPage", "#prev_page", "#pagePrev", "#btnPrev", "#prevBtn", "#turnLeft",
      ".prevPage", ".prev_page", ".pre_page", ".page-prev", ".prev-page", ".reader-prev",
      ".book-prev", ".turn-prev", ".prevBtn", "[data-action='prev']", "[data-page='prev']",
      "[rel='prev']", "[onclick*='prevPage']", "[onclick*='prePage']",
      "button[aria-label*='上一页']", "a[aria-label*='上一页']", "button[title*='上一页']", "a[title*='上一页']"
    ];
    var nextSelectors = [
      "#next-page-js", "#nextPage", "#next_page", "#pageNext", "#btnNext", "#nextBtn", "#turnRight",
      ".nextPage", ".next_page", ".page-next", ".next-page", ".reader-next",
      ".book-next", ".turn-next", ".nextBtn", "[data-action='next']", "[data-page='next']",
      "[rel='next']", "[onclick*='nextPage']",
      "button[aria-label*='下一页']", "a[aria-label*='下一页']", "button[title*='下一页']", "a[title*='下一页']"
    ];
    var prevControl = findControl(prevSelectors, ["上一页", "上页", "前一页", "previous", "prev"]);
    var nextControl = findControl(nextSelectors, ["下一页", "下页", "后一页", "next"]);

    var url;
    try { url = new URL(location.href); } catch (error) { url = { hostname: "", pathname: "", href: "" }; }
    var hostname = safeText(url.hostname, 160).toLowerCase();
    var pathname = safeText(url.pathname, 240).toLowerCase();
    var fullUrl = safeText(url.href, 500).toLowerCase();
    var isChaoxing = /(^|\.)chaoxing\.com$/.test(hostname);
    var isSupportedBookHost = /(^|\.)sslibrary\.com$/.test(hostname);
    var isCourseShell = isChaoxing && /(\/mycourse\/studentstudy|\/nodedetailcontroller\/|\/ztnodedetailcontroller\/|\/knowledge\/cards)/.test(pathname);
    var urlLooksLikeReader = /(?:^|[\/._?=&-])(book|ebook|reader|readweb|pdz|pdzx|epub|bookview)(?:[\/._?=&-]|$)/i.test(fullUrl);

    var markerSelectors = [
      "#reader-js", "#zcontent-js", ".ztopage", "#reader", "#bookReader", "#book-reader", ".book-reader", ".bookReader", ".reader-container",
      ".reader-wrapper", ".book-viewer", ".bookViewer", ".readweb", "[data-book-id]", "[data-reader]",
      "canvas.page", ".page-container canvas", ".page-container img"
    ];
    var markerCount = 0;
    markerSelectors.forEach(function (selector) {
      if (markerCount >= 8) return;
      var marker = queryUsable(selector);
      if (!marker) return;
      markerCount += 1;
    });

    var pairedStrongControls = !!prevControl && !!nextControl && prevControl.confidence >= 2 && nextControl.confidence >= 2;
    var genericPairedControls = !isChaoxing && !!prevControl && !!nextControl;
    var detected = !isChaoxing && (urlLooksLikeReader || markerCount > 0 || pairedStrongControls || genericPairedControls);
    var score = 0;
    if (urlLooksLikeReader) score += 70;
    if (isSupportedBookHost) score += 15;
    score += Math.min(markerCount, 4) * 15;
    if (pairedStrongControls) score += 30;
    else if (prevControl || nextControl) score += 8;
    if (isChaoxing) score = -100;

    var pageText = "";
    var pageSelectors = ["#zcontent-js iframe[data-index]", "#currentPage", "#pageNow", ".current-page", ".page-current", "input[name='page']", "[data-current-page]"];
    for (var pageIndex = 0; pageIndex < pageSelectors.length && !pageText; pageIndex += 1) {
      var pageElement = queryUsable(pageSelectors[pageIndex]);
      if (!pageElement) continue;
      pageText = safeText(pageElement.value || pageElement.getAttribute("data-index") || pageElement.getAttribute("data-current-page") || pageElement.textContent, 40);
    }

    var requestedControl = turnDirection === "PREV" ? prevControl : nextControl;
    var baseResult = {
      ok: detected,
      detected: detected,
      score: score,
      reader: detected ? "web-book" : "",
      title: safeText(document.title, 120),
      frameUrl: hostname + pathname,
      page: pageText,
      canPrev: !!prevControl,
      canNext: !!nextControl,
      selector: requestedControl ? requestedControl.selector : "",
      method: requestedControl ? "browser-native-click" : "",
      isCourseShell: isCourseShell
    };

    if (turnDirection === "DETECT") return baseResult;
    if (!detected) {
      baseResult.ok = false;
      baseResult.error = "BOOK_READER_NOT_FOUND";
      return baseResult;
    }

    if (requestedControl) {
      try {
        if (typeof nativeClick !== "function") throw new Error("Native click is unavailable.");
        nativeClick.call(requestedControl.element);
        baseResult.ok = true;
        baseResult.method = "browser-native-click";
        return baseResult;
      } catch (error) {
        baseResult.nativeClickError = safeText(error && error.message || error, 160);
      }
    }
    baseResult.ok = false;
    baseResult.error = "BOOK_NATIVE_CONTROL_FAILED";
    return baseResult;
  }

  function selectFrame(injectionResults, direction) {
    direction = String(direction || "DETECT").toUpperCase();
    var candidates = (Array.isArray(injectionResults) ? injectionResults : []).filter(function (entry) {
      var result = entry && entry.result;
      if (!result || !result.detected) return false;
      if (direction === "DETECT") return true;
      return direction === "PREV" ? result.canPrev : result.canNext;
    });
    candidates.sort(function (left, right) {
      var scoreDifference = Number(right.result.score || 0) - Number(left.result.score || 0);
      if (scoreDifference) return scoreDifference;
      var leftChild = Number(left.frameId) === 0 ? 0 : 1;
      var rightChild = Number(right.frameId) === 0 ? 0 : 1;
      if (leftChild !== rightChild) return rightChild - leftChild;
      return Number(left.frameId || 0) - Number(right.frameId || 0);
    });
    return candidates[0] || null;
  }

  global.WinSpeedBallBookService = Object.freeze({
    runInFrame: runInFrame,
    selectFrame: selectFrame
  });
})(self);
