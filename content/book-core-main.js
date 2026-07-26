(function (global) {
  "use strict";

  var CORE_VERSION = "2026-07-17-main-book-core-v7.4";
  if (global.WinSpeedBallBookCoreV7 && global.WinSpeedBallBookCoreV7.version === CORE_VERSION) return;
  if (!global.document) return;

  var pristineRuntime = capturePristineRuntime();
  var nativeDefineProperty = pristineRuntime.defineProperty || Object.defineProperty;
  var nativeClick = pristineRuntime.click || (global.HTMLElement && global.HTMLElement.prototype.click);
  var nativeScrollIntoView = pristineRuntime.scrollIntoView || (global.Element && global.Element.prototype.scrollIntoView);
  var nativeScrollTopGetter = pristineRuntime.scrollTopGetter;
  var nativeScrollTopSetter = pristineRuntime.scrollTopSetter;

  function capturePristineRuntime() {
    var result = {};
    var frame = null;
    try {
      frame = global.document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText = "display:none!important;width:0!important;height:0!important;border:0!important";
      (global.document.documentElement || global.document.body).appendChild(frame);
      var cleanWindow = frame.contentWindow;
      if (cleanWindow && cleanWindow.Object && cleanWindow.HTMLElement) {
        result.defineProperty = cleanWindow.Object.defineProperty;
        result.click = cleanWindow.HTMLElement.prototype.click;
        if (cleanWindow.Element) {
          result.scrollIntoView = cleanWindow.Element.prototype.scrollIntoView;
          var scrollTopDescriptor = cleanWindow.Object.getOwnPropertyDescriptor(cleanWindow.Element.prototype, "scrollTop");
          result.scrollTopGetter = scrollTopDescriptor && scrollTopDescriptor.get;
          result.scrollTopSetter = scrollTopDescriptor && scrollTopDescriptor.set;
        }
      }
    } catch (error) {
      result = {};
    }
    try { if (frame && frame.parentNode) frame.parentNode.removeChild(frame); } catch (error) {}
    return result;
  }

  function safeText(value, maxLength) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength || 160);
  }

  function normalizeMode(mode) {
    return ["book", "image", "chaoxing"].indexOf(mode) >= 0 ? mode : "book";
  }

  function pageLocation() {
    try { return new URL(global.location.href); }
    catch (error) { return { hostname: "", pathname: "", href: "" }; }
  }

  function isEnabled(element) {
    if (!element || element.disabled) return false;
    var ariaDisabled = safeText(element.getAttribute && element.getAttribute("aria-disabled"), 16).toLowerCase();
    var className = safeText(element.className, 240).toLowerCase();
    return ariaDisabled !== "true" && !/(^|\s)(disabled|disable|is-disabled)(\s|$)/.test(className);
  }

  function isVisible(element) {
    if (!element || element.hidden) return false;
    try {
      var style = global.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      var rect = element.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    } catch (error) {
      return true;
    }
  }

  function queryFirst(selectors, requireVisible) {
    for (var index = 0; index < selectors.length; index += 1) {
      var elements;
      try { elements = global.document.querySelectorAll(selectors[index]); }
      catch (error) { elements = []; }
      for (var elementIndex = 0; elementIndex < elements.length && elementIndex < 20; elementIndex += 1) {
        var element = elements[elementIndex];
        if (!isEnabled(element)) continue;
        if (requireVisible && !isVisible(element)) continue;
        return { element: element, selector: selectors[index] };
      }
    }
    return null;
  }

  function controlLabel(element) {
    var values = [
      element && element.innerText,
      element && element.textContent,
      element && element.value,
      element && element.title,
      element && element.getAttribute && element.getAttribute("aria-label")
    ];
    return safeText(values.filter(Boolean).join(" "), 120).replace(/[\s:：]/g, "").toLowerCase();
  }

  function findControl(direction) {
    var isPrevious = direction === "PREV";
    var exactSelectors = isPrevious ? ["#pre-page-js", "#memu1"] : ["#next-page-js", "#memu2"];
    var genericSelectors = isPrevious ? [
      "#prevPage", "#prev_page", "#pagePrev", "#btnPrev", "#prevBtn", "#turnLeft",
      ".prevPage", ".prev_page", ".pre_page", ".page-prev", ".prev-page", ".reader-prev",
      ".book-prev", ".turn-prev", ".prevBtn", "[data-action='prev']", "[data-page='prev']", "[rel='prev']"
    ] : [
      "#nextPage", "#next_page", "#pageNext", "#btnNext", "#nextBtn", "#turnRight",
      ".nextPage", ".next_page", ".page-next", ".next-page", ".reader-next",
      ".book-next", ".turn-next", ".nextBtn", "[data-action='next']", "[data-page='next']", "[rel='next']"
    ];
    var exact = queryFirst(exactSelectors, false);
    if (exact) return { element: exact.element, selector: exact.selector, confidence: 3 };
    var generic = queryFirst(genericSelectors, true);
    if (generic) return { element: generic.element, selector: generic.selector, confidence: 2 };

    var accepted = isPrevious ? ["上一页", "上页", "前一页", "previous", "prev"] : ["下一页", "下页", "后一页", "next"];
    var controls;
    try { controls = global.document.querySelectorAll("button,a,[role='button'],input[type='button'],input[type='submit']"); }
    catch (error) { controls = []; }
    for (var index = 0; index < controls.length && index < 240; index += 1) {
      if (!isEnabled(controls[index]) || !isVisible(controls[index])) continue;
      if (accepted.indexOf(controlLabel(controls[index])) >= 0) {
        return { element: controls[index], selector: "text:" + controlLabel(controls[index]), confidence: 1 };
      }
    }
    return null;
  }

  function imageCandidates() {
    var selectorGroups = [
      "#Readweb .duxiuimg", ".reader-page[data-page]", ".page-container[data-page]",
      ".page-container img", ".reader-page img", ".book-page img",
      "img[data-page]", "canvas.page", ".page-container canvas"
    ];
    var candidates = [];
    selectorGroups.forEach(function (selector) {
      var elements;
      try { elements = global.document.querySelectorAll(selector); }
      catch (error) { elements = []; }
      for (var index = 0; index < elements.length && candidates.length < 1000; index += 1) {
        if (candidates.indexOf(elements[index]) < 0) candidates.push(elements[index]);
      }
    });
    if (!candidates.length) {
      try {
        Array.prototype.slice.call(global.document.querySelectorAll("#Readweb input.Jimg")).forEach(function (image) {
          var page = image.parentElement || image;
          if (candidates.indexOf(page) < 0) candidates.push(page);
        });
      } catch (error) {}
    }
    return candidates;
  }

  function currentJpathState(controller) {
    var state = { page: "", type: "", image: "" };
    if (!controller) return state;
    try {
      var parameters = typeof controller.getPrarm === "function" ? controller.getPrarm() : null;
      state.page = safeText(typeof controller.page === "function" ? controller.page() : parameters && parameters.page, 40);
      state.type = safeText(parameters && parameters.t, 40);
      var current = typeof controller.currentJimg === "function" ? controller.currentJimg() : parameters && parameters.currentJimg;
      var image = current && current.jimg ? (current.jimg[0] || current.jimg) : current;
      state.image = safeText(image && image.getAttribute && (image.getAttribute("jpgname") || image.getAttribute("src")), 160);
    } catch (error) {}
    return state;
  }

  function getJpathParameters(controller) {
    try {
      var parameters = controller && typeof controller.getPrarm === "function" ? controller.getPrarm() : null;
      if (parameters && Array.isArray(parameters.pages)) return parameters;
    } catch (error) {}
    return global.params && Array.isArray(global.params.pages) ? global.params : null;
  }

  function getJpathCoordinate(parameters) {
    if (!parameters) return null;
    var page = Number(parameters.page);
    var type = Number(parameters.t);
    try {
      if (global.cpageInfo) {
        if (Number.isFinite(Number(global.cpageInfo.cpage))) page = Number(global.cpageInfo.cpage);
        if (Number.isFinite(Number(global.cpageInfo.pageType))) type = Number(global.cpageInfo.pageType);
      }
    } catch (error) {}
    if (!Number.isFinite(page) || !Number.isFinite(type)) return null;
    return { page: page, type: type };
  }

  function coordinateFromJpathElement(element) {
    if (!element) return null;
    var wrapper = element;
    try {
      if (wrapper.closest) wrapper = wrapper.closest(".duxiuimg") || wrapper;
      else if (wrapper.parentElement) wrapper = wrapper.parentElement;
    } catch (error) {}
    var zIndex = Number(wrapper && wrapper.style && wrapper.style.zIndex);
    if (!Number.isFinite(zIndex)) {
      try { zIndex = Number(global.getComputedStyle(wrapper).zIndex); } catch (error) {}
    }
    if (!Number.isFinite(zIndex) || zIndex < 1000) return null;
    return { page: zIndex % 1000, type: Math.floor(zIndex / 1000) };
  }

  function currentJpathCoordinate(controller, parameters) {
    var parameterCoordinate = null;
    var callbackCoordinate = null;
    var visualCoordinate = null;
    if (parameters && Number.isFinite(Number(parameters.page)) && Number.isFinite(Number(parameters.t))) {
      parameterCoordinate = { page: Number(parameters.page), type: Number(parameters.t) };
    }
    try {
      if (global.cpageInfo && Number.isFinite(Number(global.cpageInfo.cpage)) && Number.isFinite(Number(global.cpageInfo.pageType))) {
        callbackCoordinate = { page: Number(global.cpageInfo.cpage), type: Number(global.cpageInfo.pageType) };
      }
    } catch (error) {}
    try {
      var current = controller && typeof controller.currentJimg === "function" ? controller.currentJimg() : null;
      var image = current && current.jimg ? (current.jimg[0] || current.jimg) : current;
      visualCoordinate = coordinateFromJpathElement(image);
    } catch (error) {}
    function same(left, right) {
      return !!left && !!right && left.page === right.page && left.type === right.type;
    }
    if (visualCoordinate && (same(visualCoordinate, parameterCoordinate) || same(visualCoordinate, callbackCoordinate))) return visualCoordinate;
    if (same(parameterCoordinate, callbackCoordinate)) return parameterCoordinate;
    return visualCoordinate || callbackCoordinate || parameterCoordinate || getJpathCoordinate(parameters);
  }

  function nextJpathCoordinate(parameters, direction, currentCoordinate) {
    var current = currentCoordinate || getJpathCoordinate(parameters);
    var pages = parameters && parameters.pages;
    if (!current || !Array.isArray(pages) || !pages.length) return null;
    var delta = direction === "PREV" ? -1 : 1;
    var type = current.type;
    var page = current.page + delta;
    for (var attempts = 0; attempts < pages.length + 2; attempts += 1) {
      var range = pages[type];
      var start = Number(range && range[0]);
      var end = Number(range && range[1]);
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end && page >= start && page <= end) {
        return { page: page, type: type };
      }
      type += delta;
      if (type < 0 || type >= pages.length) return null;
      range = pages[type];
      start = Number(range && range[0]);
      end = Number(range && range[1]);
      page = delta > 0 ? start : end;
    }
    return null;
  }

  function jpathPageTypeLabel(type) {
    return ({ 0: "封面", 1: "书名页", 2: "版权页", 3: "前言页", 4: "目录页", 5: "正文页", 6: "附录页", 7: "封底页" })[Number(type)] || "第 " + type + " 类页面";
  }

  function pageJumpSelection() {
    var select = null;
    try { select = global.document.querySelector && global.document.querySelector("#pagejump"); }
    catch (error) {}
    if (!select) return { detected: false, value: "", label: "", isBackCover: false };
    var selectedOption = null;
    try {
      if (select.options && Number(select.selectedIndex) >= 0) selectedOption = select.options[Number(select.selectedIndex)] || null;
      if (!selectedOption && select.selectedOptions && select.selectedOptions.length) selectedOption = select.selectedOptions[0];
    } catch (error) {}
    var label = safeText(selectedOption && (selectedOption.textContent || selectedOption.innerText || selectedOption.label), 80);
    return {
      detected: true,
      value: safeText(select.value, 24),
      label: label,
      isBackCover: label.replace(/\s+/g, "") === "封底页"
    };
  }

  function jpathPageImage(pageElement) {
    if (!pageElement || !pageElement.querySelector) return null;
    try { return pageElement.querySelector("input.Jimg,img.Jimg,img"); }
    catch (error) { return null; }
  }

  function ensureJpathImageLoaded(image, parameters) {
    if (!image || !image.getAttribute) return "";
    var lazySource = image.getAttribute("scr") || image.getAttribute("data-src") || "";
    var currentSource = image.getAttribute("src") || "";
    if (lazySource && (!currentSource || /(?:^|\/)dot\.gif(?:$|[?#])/i.test(currentSource))) {
      var zoom = Number(parameters && (parameters.zm != null ? parameters.zm : parameters.zoom));
      var suffix = "uf=ssr&zoom=" + (Number.isFinite(zoom) ? zoom : 0);
      currentSource = lazySource + (lazySource.indexOf("?") >= 0 ? "&" : "?") + suffix;
      image.setAttribute("src", currentSource);
    }
    return currentSource;
  }

  function chaoxingPdgSignature(parameters, hostname, isCourseShell) {
    if (isCourseShell || !parameters || !Array.isArray(parameters.pages)) return null;
    var readweb = null;
    var pages = [];
    var images = [];
    try {
      readweb = global.document.querySelector("#Readweb");
      pages = global.document.querySelectorAll("#Readweb .duxiuimg");
      images = global.document.querySelectorAll("#Readweb input.Jimg");
      if (!images.length) images = global.document.querySelectorAll("input.Jimg");
    } catch (error) {}
    if (!readweb || pages.length < 1 || images.length < 1) return null;
    var sourceImageCount = 0;
    for (var index = 0; index < images.length; index += 1) {
      if (images[index] && images[index].getAttribute && (images[index].getAttribute("jpgname") || images[index].getAttribute("scr"))) sourceImageCount += 1;
    }
    if (!sourceImageCount) return null;
    return {
      readweb: readweb,
      pages: pages,
      images: images,
      sourceImageCount: sourceImageCount,
      chaoxingHost: /(^|\.)chaoxing\.com$/.test(hostname),
      dynamicFrame: !hostname || /^(about:|data:|blob:)/i.test(safeText(global.location && global.location.href, 80))
    };
  }

  function jpathPageElement(coordinate) {
    if (!coordinate) return null;
    var expectedZIndex = String(coordinate.type * 1000 + coordinate.page);
    var pages;
    try { pages = global.document.querySelectorAll("#Readweb .duxiuimg"); }
    catch (error) { pages = []; }
    for (var index = 0; index < pages.length; index += 1) {
      var element = pages[index];
      var inlineZIndex = safeText(element.style && element.style.zIndex, 20);
      var computedZIndex = "";
      try { computedZIndex = safeText(global.getComputedStyle(element).zIndex, 20); } catch (error) {}
      if (inlineZIndex === expectedZIndex || computedZIndex === expectedZIndex) return element;
    }
    return null;
  }

  function forceJpathDomTurn(direction, result) {
    var controller = getJpathController();
    var parameters = getJpathParameters(controller);
    var currentCoordinate = currentJpathCoordinate(controller, parameters);
    var targetCoordinate = nextJpathCoordinate(parameters, direction, currentCoordinate);
    var targetPage = jpathPageElement(targetCoordinate);
    if (!parameters || !targetCoordinate || !targetPage) {
      result.jpathDomError = "JPATH_TARGET_IMAGE_NOT_FOUND";
      return false;
    }
    try {
      var currentPageElement = jpathPageElement(currentCoordinate);
      var targetImage = jpathPageImage(targetPage);
      ensureJpathImageLoaded(targetImage, parameters);
      if (parameters.showMode !== false) {
        if (currentPageElement && currentPageElement !== targetPage) currentPageElement.style.display = "none";
        targetPage.style.display = "block";
      } else if (typeof targetPage.scrollIntoView === "function") {
        targetPage.scrollIntoView({ block: "start", inline: "nearest", behavior: "auto" });
      }
      parameters.page = targetCoordinate.page;
      parameters.t = targetCoordinate.type;
      if (global.params) {
        global.params.page = targetCoordinate.page;
        global.params.t = targetCoordinate.type;
      }
      try {
        if (controller && typeof controller.setPrarm === "function") controller.setPrarm({ page: targetCoordinate.page, t: targetCoordinate.type });
      } catch (error) {
        result.jpathParameterError = safeText(error && error.message || error, 160);
      }
      if (typeof parameters.onchangepage === "function") {
        try { parameters.onchangepage(targetCoordinate.page, targetCoordinate.type, parameters.pages); }
        catch (error) {
          global.cpageInfo = { cpage: targetCoordinate.page, pageType: targetCoordinate.type };
          result.pageCallbackError = safeText(error && error.message || error, 160);
        }
      } else {
        global.cpageInfo = { cpage: targetCoordinate.page, pageType: targetCoordinate.type };
      }
      var pageInput = global.document.querySelector && global.document.querySelector("#goPageInput");
      var typeInput = global.document.querySelector && global.document.querySelector("#pagejump");
      var readweb = global.document.querySelector && global.document.querySelector("#Readweb");
      if (pageInput) pageInput.value = String(targetCoordinate.page);
      if (typeInput) typeInput.value = String(targetCoordinate.type);
      if (readweb) readweb.scrollTop = 0;
      result.method = "chaoxing-pdg-force";
      result.readerEngine = "chaoxing-pdg-jpath";
      result.page = String(targetCoordinate.page);
      result.pageType = String(targetCoordinate.type);
      result.pageTypeLabel = jpathPageTypeLabel(targetCoordinate.type);
      result.jpgName = safeText(targetImage && targetImage.getAttribute && targetImage.getAttribute("jpgname"), 80);
      result.verified = targetPage.style.display !== "none";
      return result.verified;
    } catch (error) {
      result.jpathDomError = safeText(error && error.message || error, 160);
      return false;
    }
  }

  function imagePosition(candidates) {
    candidates = candidates || imageCandidates();
    if (!candidates.length) return { index: -1, total: 0, element: null };
    var viewportCenter = Number(global.innerHeight || 0) / 2;
    var bestIndex = -1;
    var bestDistance = Infinity;
    for (var index = 0; index < candidates.length; index += 1) {
      try {
        var rect = candidates[index].getBoundingClientRect();
        if (rect.width <= 20 || rect.height <= 20) continue;
        var center = rect.top + Math.min(rect.height, Number(global.innerHeight || rect.height)) / 2;
        var distance = Math.abs(center - viewportCenter);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      } catch (error) {}
    }
    if (bestIndex < 0) bestIndex = 0;
    return { index: bestIndex, total: candidates.length, element: candidates[bestIndex] };
  }

  function markerCount() {
    var selectors = [
      "#reader-js", "#zcontent-js", ".ztopage", "#reader", "#bookReader", "#book-reader",
      ".book-reader", ".bookReader", ".reader-container", ".reader-wrapper", ".book-viewer",
      ".bookViewer", ".readweb", "#Readweb", ".duxiuimg", "input.Jimg", "#pagejump",
      "[data-book-id]", "[data-reader]", "canvas.page",
      ".page-container canvas", ".page-container img"
    ];
    var count = 0;
    selectors.forEach(function (selector) {
      if (count >= 8) return;
      if (queryFirst([selector], true)) count += 1;
    });
    return count;
  }

  function currentPage() {
    try {
      if (global.myReader && global.myReader.config && global.myReader.config.cpage != null) {
        return safeText(global.myReader.config.cpage, 40);
      }
    } catch (error) {}
    var selectors = ["#goPageInput", "#zcontent-js iframe[data-index]", "#currentPage", "#pageNow", ".current-page", ".page-current", "input[name='page']", "[data-current-page]"];
    var selected = queryFirst(selectors, true);
    if (!selected) return "";
    var element = selected.element;
    return safeText(element.value || element.getAttribute("data-index") || element.getAttribute("data-current-page") || element.textContent, 40);
  }

  function getJpathController() {
    var controller = global.readweb;
    if (!controller) return null;
    var hasPageMethods = typeof controller.nextPage === "function" && typeof controller.prevPage === "function";
    var hasGoto = typeof controller.goto === "function" && (typeof controller.page === "function" || typeof controller.getPrarm === "function");
    return hasPageMethods || hasGoto ? controller : null;
  }

  function invokeChaoxingPdgController(direction, result) {
    var controller = getJpathController();
    var parameters = getJpathParameters(controller);
    var currentCoordinate = currentJpathCoordinate(controller, parameters);
    var targetCoordinate = nextJpathCoordinate(parameters, direction, currentCoordinate);
    if (!controller || typeof controller.goto !== "function" || !targetCoordinate) {
      result.jpathControllerError = targetCoordinate ? "CHAOXING_GOTO_NOT_AVAILABLE" : "JPATH_TARGET_IMAGE_NOT_FOUND";
      return false;
    }
    try {
      global.isnext = direction !== "PREV";
      controller.goto.call(controller, targetCoordinate.page, targetCoordinate.type);
      var afterCoordinate = currentJpathCoordinate(controller, parameters);
      var targetPage = jpathPageElement(targetCoordinate);
      var targetImage = jpathPageImage(targetPage);
      var reached = !!afterCoordinate && afterCoordinate.page === targetCoordinate.page && afterCoordinate.type === targetCoordinate.type;
      if (!reached) {
        result.jpathControllerError = "JPATH_PAGE_DID_NOT_CHANGE";
        return false;
      }
      ensureJpathImageLoaded(targetImage, parameters);
      result.method = "chaoxing-pdg-native";
      result.readerEngine = "chaoxing-pdg-jpath";
      result.page = String(targetCoordinate.page);
      result.pageType = String(targetCoordinate.type);
      result.pageTypeLabel = jpathPageTypeLabel(targetCoordinate.type);
      result.jpgName = safeText(targetImage && targetImage.getAttribute && targetImage.getAttribute("jpgname"), 80);
      result.verified = true;
      return true;
    } catch (error) {
      result.jpathControllerError = safeText(error && error.message || error, 160);
      return false;
    }
  }

  function readNativeScrollTop(element) {
    if (!element) return 0;
    try {
      if (typeof nativeScrollTopGetter === "function") return Number(nativeScrollTopGetter.call(element) || 0);
    } catch (error) {}
    return Number(element.scrollTop || 0);
  }

  function writeNativeScrollTop(element, value) {
    if (!element) return false;
    try {
      if (typeof nativeScrollTopSetter === "function") nativeScrollTopSetter.call(element, value);
      else element.scrollTop = value;
      return true;
    } catch (error) {
      return false;
    }
  }

  function nativeScrollElementIntoView(element) {
    if (!element) return false;
    try {
      if (typeof nativeScrollIntoView === "function") nativeScrollIntoView.call(element, { block: "start", inline: "nearest", behavior: "auto" });
      else if (typeof element.scrollIntoView === "function") element.scrollIntoView({ block: "start", inline: "nearest", behavior: "auto" });
      else return false;
      return true;
    } catch (error) {
      return false;
    }
  }

  function findScrollableAncestor(element) {
    var current = element && element.parentElement;
    while (current && current !== global.document.body && current !== global.document.documentElement) {
      try {
        var style = global.getComputedStyle(current);
        if (current.scrollHeight > current.clientHeight + 4 && /(auto|scroll)/.test(style.overflowY || style.overflow || "")) return current;
      } catch (error) {}
      current = current.parentElement;
    }
    try {
      var readweb = global.document.querySelector("#Readweb");
      if (readweb && readweb.scrollHeight > readweb.clientHeight + 4) return readweb;
    } catch (error) {}
    return null;
  }

  function moveImageSequence(direction, result) {
    var candidates = imageCandidates();
    var position = imagePosition(candidates);
    var targetIndex = position.index + (direction === "PREV" ? -1 : 1);
    if (position.index < 0 || targetIndex < 0 || targetIndex >= candidates.length) return false;
    var current = position.element;
    var target = candidates[targetIndex];
    var container = findScrollableAncestor(current || target);
    try {
      var beforeScroll = container ? readNativeScrollTop(container) : Number(global.scrollY || global.pageYOffset || 0);
      if (container) {
        var containerRect = container.getBoundingClientRect();
        var targetRect = target.getBoundingClientRect();
        if (!writeNativeScrollTop(container, beforeScroll + targetRect.top - containerRect.top)) return false;
      } else if (nativeScrollElementIntoView(target)) {
      } else return false;
      var afterScroll = container ? readNativeScrollTop(container) : Number(global.scrollY || global.pageYOffset || 0);
      if (afterScroll === beforeScroll && target !== current) {
        nativeScrollElementIntoView(target);
        afterScroll = container ? readNativeScrollTop(container) : Number(global.scrollY || global.pageYOffset || 0);
      }
      if (afterScroll === beforeScroll) return false;
      result.method = "browser-native-scroll";
      result.readerEngine = "image-sequence";
      result.imageIndex = targetIndex + 1;
      result.imageCount = candidates.length;
      result.page = String(targetIndex + 1);
      result.verified = true;
      return true;
    } catch (error) {
      result.imageScrollError = safeText(error && error.message || error, 160);
      return false;
    }
  }

  function inspect(direction, mode) {
    direction = String(direction || "DETECT").toUpperCase();
    mode = normalizeMode(mode);
    var url = pageLocation();
    var hostname = safeText(url.hostname, 160).toLowerCase();
    var pathname = safeText(url.pathname, 240).toLowerCase();
    var fullUrl = safeText(url.href, 500).toLowerCase();
    var isChaoxing = /(^|\.)chaoxing\.com$/.test(hostname);
    var isBookHost = /(^|\.)sslibrary\.com$/.test(hostname);
    var isCourseShell = isChaoxing && /(\/mycourse\/studentstudy|\/nodedetailcontroller\/|\/ztnodedetailcontroller\/|\/knowledge\/cards)/.test(pathname);
    var urlLooksLikeReader = /(?:^|[\/._?=&-])(book|ebook|reader|readweb|readsvr|epub|bookview)(?:[\/._?=&-]|$)/i.test(fullUrl);
    var jpathController = getJpathController();
    var jpathParameters = getJpathParameters(jpathController);
    var currentCoordinate = currentJpathCoordinate(jpathController, jpathParameters);
    var jpathDomReady = !!jpathParameters && !!jpathPageElement(currentCoordinate);
    var chaoxingPdg = chaoxingPdgSignature(jpathParameters, hostname, isCourseShell);
    var chaoxingPdgReady = !!chaoxingPdg && (!!jpathController || jpathDomReady || !!currentCoordinate);
    var images = imageCandidates();
    var imageSequenceReady = images.length > 1;
    var previous = findControl("PREV");
    var next = findControl("NEXT");
    var markers = markerCount();
    var pairedStrongControls = !!previous && !!next && previous.confidence >= 2 && next.confidence >= 2;
    var genericPairedControls = !isChaoxing && !!previous && !!next;
    var hasChaoxingReader = isChaoxing || chaoxingPdgReady || !!jpathController || jpathDomReady || !!queryFirst(["#Readweb", ".duxiuimg", "input.Jimg", "#pagejump"], false);
    var detected = mode === "chaoxing"
      ? chaoxingPdgReady
      : (mode === "image"
        ? !hasChaoxingReader && imageSequenceReady && (urlLooksLikeReader || markers > 0)
        : !hasChaoxingReader && (urlLooksLikeReader || markers > 0 || pairedStrongControls || genericPairedControls));
    var score = 0;
    if (urlLooksLikeReader) score += 70;
    if (isBookHost) score += 15;
    score += Math.min(markers, 4) * 15;
    if (pairedStrongControls) score += 30;
    else if (previous || next) score += 8;
    if (mode === "chaoxing" && jpathController) score += 120;
    if (mode === "chaoxing" && jpathDomReady) score += 110;
    if (mode === "image" && imageSequenceReady) score += 100;
    if (mode === "chaoxing" && chaoxingPdgReady) score += 500;
    if (hostname === "epub.sslibrary.com" && pathname.indexOf("/epub/reader") >= 0) score += 60;
    if (hasChaoxingReader && mode !== "chaoxing") score = -100;
    if (isCourseShell) score = -100;
    var requested = direction === "PREV" ? previous : next;
    var imageInfo = imagePosition(images);
    var chaoxingPrevious = nextJpathCoordinate(jpathParameters, "PREV", currentCoordinate);
    var chaoxingNext = nextJpathCoordinate(jpathParameters, "NEXT", currentCoordinate);
    var pageJump = pageJumpSelection();
    return {
      ok: detected,
      detected: detected,
      score: score,
      reader: detected ? (mode === "chaoxing" ? "chaoxing-pdg" : "web-book") : "",
      readerEngine: mode === "chaoxing" ? "chaoxing-pdg-jpath" : (mode === "image" ? "image-sequence" : (hostname === "epub.sslibrary.com" ? "sslibrary-epub" : "dom-reader")),
      mode: mode,
      title: safeText(global.document && global.document.title, 120),
      frameUrl: hostname + pathname,
      page: mode === "chaoxing" && currentCoordinate ? String(currentCoordinate.page) : (currentPage() || (imageInfo.index >= 0 ? String(imageInfo.index + 1) : "")),
      pageType: mode === "chaoxing" && currentCoordinate ? String(currentCoordinate.type) : "",
      pageTypeLabel: mode === "chaoxing" && currentCoordinate ? jpathPageTypeLabel(currentCoordinate.type) : "",
      pageJumpDetected: mode === "chaoxing" && pageJump.detected,
      pageJumpValue: mode === "chaoxing" ? pageJump.value : "",
      pageJumpLabel: mode === "chaoxing" ? pageJump.label : "",
      isBackCover: mode === "chaoxing" && pageJump.isBackCover,
      imageIndex: imageInfo.index >= 0 ? imageInfo.index + 1 : 0,
      imageCount: imageInfo.total,
      canPrev: mode === "chaoxing" ? !!chaoxingPrevious : (mode === "image" ? imageInfo.index > 0 : !!previous),
      canNext: mode === "chaoxing" ? !!chaoxingNext : (mode === "image" ? (imageInfo.index >= 0 && imageInfo.index < imageInfo.total - 1) : !!next),
      selector: requested ? requested.selector : "",
      method: mode === "chaoxing"
        ? (jpathController ? "chaoxing-pdg-native" : "chaoxing-pdg-force")
        : (mode === "image" ? (detected ? "browser-native-scroll" : "") : (requested ? "browser-native-click" : "")),
      isCourseShell: isCourseShell,
      nativeController: true,
      controllerWorld: "MAIN",
      controllerVersion: CORE_VERSION,
      control: requested,
      jpathControllerReady: mode === "chaoxing" && !!jpathController,
      jpathDomReady: mode === "chaoxing" && jpathDomReady,
      chaoxingPdgReady: mode === "chaoxing" && chaoxingPdgReady,
      pdgPageCount: mode === "chaoxing" && chaoxingPdg ? chaoxingPdg.pages.length : 0,
      pdgImageCount: mode === "chaoxing" && chaoxingPdg ? chaoxingPdg.images.length : 0,
      pdgSourceImageCount: mode === "chaoxing" && chaoxingPdg ? chaoxingPdg.sourceImageCount : 0,
      dynamicReaderFrame: mode === "chaoxing" && !!(chaoxingPdg && chaoxingPdg.dynamicFrame),
      markerCount: markers,
      hostname: hostname
    };
  }

  function publicResult(result) {
    var copy = {};
    Object.keys(result).forEach(function (key) {
      if (key !== "control") copy[key] = result[key];
    });
    return copy;
  }

  function clickNative(control, result) {
    var element = control && control.element;
    if (!element) return false;
    try {
      if (typeof nativeClick === "function") nativeClick.call(element);
      else if (typeof element.click === "function") element.click();
      else return false;
      result.method = "browser-native-click";
      result.verified = true;
      return true;
    } catch (error) {
      result.nativeClickError = safeText(error && error.message || error, 160);
      return false;
    }
  }

  function handleCommand(command) {
    var direction = typeof command === "string" ? command : command && command.type;
    var mode = normalizeMode(command && typeof command === "object" ? command.mode : "book");
    direction = String(direction || "DETECT").toUpperCase();
    if (["DETECT", "PREV", "NEXT"].indexOf(direction) < 0) {
      return { ok: false, detected: false, error: "BOOK_COMMAND_NOT_SUPPORTED", nativeController: true, controllerWorld: "MAIN", controllerVersion: CORE_VERSION };
    }
    var result = inspect(direction, mode);
    if (direction === "DETECT") return publicResult(result);
    if (!result.detected) {
      result.ok = false;
      result.error = mode === "chaoxing" ? "CHAOXING_PDG_READER_NOT_FOUND" : "BOOK_READER_NOT_FOUND";
      return publicResult(result);
    }
    if (mode === "chaoxing") {
      if (invokeChaoxingPdgController(direction, result) || forceJpathDomTurn(direction, result)) {
        result.ok = true;
        return publicResult(result);
      }
      result.ok = false;
      result.error = "CHAOXING_PDG_TURN_FAILED";
      return publicResult(result);
    }
    if (mode === "image" && moveImageSequence(direction, result)) {
      result.ok = true;
      return publicResult(result);
    }
    if (result.control && clickNative(result.control, result)) {
      result.ok = true;
      return publicResult(result);
    }
    result.ok = false;
    result.error = "BOOK_NATIVE_CONTROL_FAILED";
    return publicResult(result);
  }

  var publicApi = Object.freeze({
    version: CORE_VERSION,
    world: "MAIN",
    handleCommand: handleCommand
  });
  nativeDefineProperty.call(Object, global, "WinSpeedBallBookCoreV7", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: publicApi
  });
  if (!global.WinSpeedBallBookCoreV6) {
    nativeDefineProperty.call(Object, global, "WinSpeedBallBookCoreV6", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: publicApi
    });
  }
})(window);
