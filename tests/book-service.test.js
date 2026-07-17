const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function element(options = {}) {
  const attributes = Object.assign({}, options.attributes);
  return {
    hidden: false,
    disabled: false,
    className: options.className || "",
    innerText: options.text || "",
    textContent: options.text || "",
    value: options.value || "",
    title: options.title || "",
    clicked: 0,
    focused: 0,
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null; },
    setAttribute(name, value) { attributes[name] = String(value); },
    scrollTop: options.scrollTop || 0,
    scrollHeight: options.scrollHeight || options.height || 28,
    clientHeight: options.clientHeight || options.height || 28,
    parentElement: options.parentElement || null,
    getBoundingClientRect() { return { top: options.top || 0, left: 0, width: options.width || 80, height: options.height || 28 }; },
    click() { this.clicked += 1; },
    focus() { this.focused += 1; },
    dispatchEvent() { return true; }
  };
}

function createFixture(url) {
  const previous = element({ text: "上一页" });
  const next = element({ text: "下一页" });
  const reader = element({ className: "book-reader", width: 800, height: 600 });
  const body = element({ width: 1024, height: 768 });
  const documentElement = element({ width: 1024, height: 768 });
  const document = {
    title: "学习通图书",
    body,
    documentElement,
    activeElement: body,
    querySelectorAll(selector) {
      if (selector === "#pre-page-js" || selector === "#prevPage") return [previous];
      if (selector === "#next-page-js" || selector === "#nextPage") return [next];
      if (selector === ".book-reader") return [reader];
      if (selector === "button,a,[role='button'],input[type='button'],input[type='submit']") return [previous, next];
      return [];
    },
    dispatchEvent() { return true; }
  };
  const context = {
    self: {},
    document,
    location: { href: url },
    getComputedStyle() { return { display: "block", visibility: "visible", opacity: "1" }; },
    KeyboardEvent: function KeyboardEvent(type, init) { this.type = type; Object.assign(this, init); },
    URL,
    Object,
    Array,
    String,
    Number,
    RegExp,
    Math
  };
  vm.createContext(context);
  vm.runInContext(read("background/book-service.js"), context);
  return { service: context.self.WinSpeedBallBookService, context, previous, next };
}

test("学习通 SSLibrary 图书框架可以被识别并只点击目标翻页按钮", () => {
  const fixture = createFixture("https://epub.sslibrary.com/epub/reader?gcebook=1");
  const detection = fixture.service.runInFrame("DETECT");
  assert.equal(detection.ok, true);
  assert.equal(detection.reader, "chaoxing-book");
  assert.equal(detection.canPrev, true);
  assert.equal(detection.canNext, true);

  const result = fixture.service.runInFrame("NEXT");
  assert.equal(result.ok, true);
  assert.equal(result.method, "button");
  assert.equal(result.selector, "#next-page-js");
  assert.equal(fixture.next.clicked, 1);
  assert.equal(fixture.previous.clicked, 0);
});

test("MAIN 图书核心使用浏览器原生方法控制 SSLibrary 翻页", () => {
  function HTMLElement() {}
  HTMLElement.prototype.click = function () { this.clicked += 1; };
  function EventTarget() {}
  EventTarget.prototype.dispatchEvent = function () { return true; };
  const previous = Object.assign(new HTMLElement(), element({ text: "上一页" }));
  const next = Object.assign(new HTMLElement(), element({ text: "下一页" }));
  const reader = Object.assign(new HTMLElement(), element({ className: "book-reader", width: 800, height: 600 }));
  const body = Object.assign(new HTMLElement(), element({ width: 1024, height: 768 }));
  const document = {
    title: "SSLibrary EPUB",
    body,
    documentElement: body,
    activeElement: body,
    querySelectorAll(selector) {
      if (selector === "#pre-page-js") return [previous];
      if (selector === "#next-page-js") return [next];
      if (selector === ".book-reader") return [reader];
      return [];
    }
  };
  const window = {
    document,
    location: { href: "https://epub.sslibrary.com/epub/reader?gcebook=1" },
    HTMLElement,
    EventTarget,
    KeyboardEvent: function KeyboardEvent(type, init) { this.type = type; Object.assign(this, init); },
    getComputedStyle() { return { display: "block", visibility: "visible", opacity: "1" }; }
  };
  const context = { window, URL, Object, Array, String, Number, RegExp, Math };
  vm.createContext(context);
  vm.runInContext(read("content/book-core-main.js"), context);

  const detection = window.WinSpeedBallBookCoreV6.handleCommand("DETECT");
  assert.equal(detection.ok, true);
  assert.equal(detection.nativeController, true);
  assert.equal(detection.controllerWorld, "MAIN");
  assert.equal(window.WinSpeedBallBookCoreV7, window.WinSpeedBallBookCoreV6);
  assert.equal(Object.isFrozen(window.WinSpeedBallBookCoreV6), true);
  assert.equal(Object.getOwnPropertyDescriptor(window, "WinSpeedBallBookCoreV6").writable, false);

  const result = window.WinSpeedBallBookCoreV6.handleCommand("NEXT");
  assert.equal(result.ok, true);
  assert.equal(result.method, "browser-native-click");
  assert.equal(result.selector, "#next-page-js");
  assert.equal(next.clicked, 1);
  assert.equal(previous.clicked, 0);
});

test("MAIN 图书核心直接调用旧版超星 JPath Readweb 原生翻页接口", () => {
  function HTMLElement() {}
  HTMLElement.prototype.click = function () { this.clicked += 1; };
  function EventTarget() {}
  EventTarget.prototype.dispatchEvent = function () { return true; };
  const readwebElement = Object.assign(new HTMLElement(), element({ className: "readweb", width: 790, height: 545 }));
  const pageImage = Object.assign(new HTMLElement(), element({ className: "Jimg", width: 790, height: 956 }));
  const body = Object.assign(new HTMLElement(), element({ width: 1024, height: 768 }));
  const state = { page: 1, t: 5 };
  const readweb = {
    getPrarm() { return state; },
    page() { return state.page; },
    goto(page, type) { state.page = page; if (type != null) state.t = type; },
    nextPage() { this.goto(state.page + 1, state.t); },
    prevPage() { this.goto(state.page - 1, state.t); }
  };
  const document = {
    title: "互联网+时代中国大学生创业案例",
    body,
    documentElement: body,
    activeElement: body,
    querySelectorAll(selector) {
      if (selector === "#Readweb" || selector === ".duxiuimg") return [readwebElement];
      if (selector === "input.Jimg") return [pageImage];
      return [];
    }
  };
  const window = {
    document,
    readweb,
    params: { pages: [[1, 0], [1, 1], [1, 1], [1, 2], [1, 2], [1, 362]], page: 1, t: 5 },
    location: { href: "https://readsvr.chaoxing.com/n/moocreadsvr/read?ssid=14357895" },
    HTMLElement,
    EventTarget,
    KeyboardEvent: function KeyboardEvent(type, init) { this.type = type; Object.assign(this, init); },
    getComputedStyle() { return { display: "block", visibility: "visible", opacity: "1" }; }
  };
  const context = { window, URL, Object, Array, String, Number, RegExp, Math };
  vm.createContext(context);
  vm.runInContext(read("content/book-core-main.js"), context);

  const detection = window.WinSpeedBallBookCoreV6.handleCommand("DETECT");
  assert.equal(detection.ok, true);
  assert.equal(detection.reader, "chaoxing-book");
  assert.equal(detection.readerEngine, "jpath-readweb");
  assert.equal(detection.canPrev, true);
  assert.equal(detection.canNext, true);

  const nextResult = window.WinSpeedBallBookCoreV6.handleCommand("NEXT");
  assert.equal(nextResult.ok, true);
  assert.equal(nextResult.method, "jpath-native-controller");
  assert.equal(nextResult.verified, true);
  assert.equal(nextResult.page, "2");
  assert.equal(state.page, 2);

  const previousResult = window.WinSpeedBallBookCoreV6.handleCommand("PREV");
  assert.equal(previousResult.ok, true);
  assert.equal(previousResult.method, "jpath-native-controller");
  assert.equal(state.page, 1);
});

test("学习通版本严格识别 PDG/JPath 图像书并跨页类型调用原生 goto", () => {
  function HTMLElement() {}
  HTMLElement.prototype.click = function () {};
  function EventTarget() {}
  EventTarget.prototype.dispatchEvent = function () { return true; };
  const body = Object.assign(new HTMLElement(), element({ width: 1024, height: 768 }));
  const readwebElement = Object.assign(new HTMLElement(), element({ width: 790, height: 545 }));
  const directoryPage = Object.assign(new HTMLElement(), element({ width: 790, height: 956 }));
  const bodyPage = Object.assign(new HTMLElement(), element({ width: 790, height: 956 }));
  directoryPage.style = { zIndex: "4002", display: "block" };
  bodyPage.style = { zIndex: "5001", display: "none" };
  const directoryImage = Object.assign(new HTMLElement(), element({ attributes: { jpgname: "!00002", src: "/reader/!00002" }, parentElement: directoryPage, width: 790, height: 956 }));
  const bodyImage = Object.assign(new HTMLElement(), element({ attributes: { jpgname: "000001", src: "/images/dot.gif", scr: "/reader/000001?." }, parentElement: bodyPage, width: 790, height: 956 }));
  directoryPage.querySelector = () => directoryImage;
  bodyPage.querySelector = () => bodyImage;
  const params = {
    pages: [[1, 0], [1, 1], [1, 1], [1, 2], [1, 2], [1, 362], [1, 0], [2, 2]],
    page: 2,
    t: 4,
    showMode: true,
    zm: 0
  };
  const gotoCalls = [];
  const readweb = {
    getPrarm() { return params; },
    page() { return params.page; },
    currentJimg() { return { jimg: [params.t === 4 ? directoryImage : bodyImage] }; },
    goto(page, type) { gotoCalls.push([page, type]); params.page = page; params.t = type; },
    nextPage() {},
    prevPage() {}
  };
  const pageJumpOption = { textContent: "目录页", innerText: "目录页", label: "目录页" };
  const pageJump = { value: "4", selectedIndex: 0, options: [pageJumpOption], selectedOptions: [pageJumpOption] };
  const document = {
    title: "学习通 PDG 图像书",
    body,
    documentElement: body,
    activeElement: body,
    querySelector(selector) {
      if (selector === "#Readweb") return readwebElement;
      if (selector === "#pagejump") return pageJump;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "#Readweb .duxiuimg") return [directoryPage, bodyPage];
      if (selector === "#Readweb input.Jimg" || selector === "input.Jimg") return [directoryImage, bodyImage];
      if (selector === "#Readweb") return [readwebElement];
      if (selector === ".duxiuimg") return [directoryPage, bodyPage];
      return [];
    }
  };
  const window = {
    document,
    readweb,
    params,
    cpageInfo: { cpage: 2, pageType: 4 },
    location: { href: "about:blank" },
    HTMLElement,
    EventTarget,
    KeyboardEvent: function KeyboardEvent(type, init) { this.type = type; Object.assign(this, init); },
    getComputedStyle(target) { return { display: target.style && target.style.display || "block", visibility: "visible", opacity: "1", zIndex: target.style && target.style.zIndex || "auto" }; }
  };
  const context = { window, URL, Object, Array, String, Number, RegExp, Math };
  vm.createContext(context);
  vm.runInContext(read("content/book-core-main.js"), context);

  const detection = window.WinSpeedBallBookCoreV6.handleCommand({ type: "DETECT", mode: "chaoxing" });
  assert.equal(detection.ok, true);
  assert.equal(detection.reader, "chaoxing-pdg");
  assert.equal(detection.readerEngine, "chaoxing-pdg-jpath");
  assert.equal(detection.page, "2");
  assert.equal(detection.pageTypeLabel, "目录页");
  assert.equal(detection.dynamicReaderFrame, true);
  assert.equal(detection.pageJumpLabel, "目录页");
  assert.equal(detection.isBackCover, false);

  pageJump.value = "7";
  pageJumpOption.textContent = "封底页";
  pageJumpOption.innerText = "封底页";
  pageJumpOption.label = "封底页";
  const coverDetection = window.WinSpeedBallBookCoreV6.handleCommand({ type: "DETECT", mode: "chaoxing" });
  assert.equal(coverDetection.pageJumpDetected, true);
  assert.equal(coverDetection.pageJumpValue, "7");
  assert.equal(coverDetection.pageJumpLabel, "封底页");
  assert.equal(coverDetection.isBackCover, true);
  pageJump.value = "4";
  pageJumpOption.textContent = "目录页";
  pageJumpOption.innerText = "目录页";
  pageJumpOption.label = "目录页";

  const result = window.WinSpeedBallBookCoreV6.handleCommand({ type: "NEXT", mode: "chaoxing" });
  assert.equal(result.ok, true);
  assert.equal(result.method, "chaoxing-pdg-native");
  assert.equal(result.page, "1");
  assert.equal(result.pageType, "5");
  assert.equal(result.pageTypeLabel, "正文页");
  assert.equal(result.jpgName, "000001");
  assert.deepEqual(gotoCalls, [[1, 5]]);
});

test("MAIN JPath fallback forces the source image node when goto does not change the page", () => {
  function HTMLElement() {}
  HTMLElement.prototype.click = function () {};
  function EventTarget() {}
  EventTarget.prototype.dispatchEvent = function () { return true; };
  const body = Object.assign(new HTMLElement(), element({ width: 1024, height: 768 }));
  const readwebElement = Object.assign(new HTMLElement(), element({ width: 790, height: 545, clientHeight: 545, scrollHeight: 956 }));
  const image1 = Object.assign(new HTMLElement(), element({ width: 790, height: 956, attributes: { jpgname: "000001", src: "/loaded/000001" } }));
  const image2 = Object.assign(new HTMLElement(), element({ width: 790, height: 956, attributes: { jpgname: "000002", src: "/images/dot.gif", scr: "/reader/000002?." } }));
  const image3 = Object.assign(new HTMLElement(), element({ width: 790, height: 956, attributes: { jpgname: "000003", src: "/images/dot.gif", scr: "/reader/000003?." } }));
  const page1 = Object.assign(new HTMLElement(), element({ width: 790, height: 956 }));
  const page2 = Object.assign(new HTMLElement(), element({ width: 790, height: 956 }));
  const page3 = Object.assign(new HTMLElement(), element({ width: 790, height: 956 }));
  page1.style = { zIndex: "5001", display: "block" };
  page2.style = { zIndex: "5002", display: "none" };
  page3.style = { zIndex: "5003", display: "none" };
  page1.querySelector = () => image1;
  page2.querySelector = () => image2;
  page3.querySelector = () => image3;
  const params = {
    pages: [[1, 0], [1, 1], [1, 1], [1, 2], [1, 2], [1, 362], [1, 0], [2, 2]],
    page: 1,
    t: 5,
    showMode: true,
    zm: 0,
    onchangepage(page, type) { window.cpageInfo = { cpage: page, pageType: type }; }
  };
  const readweb = {
    getPrarm() { return params; },
    page() { return params.page; },
    currentJimg() { return { jimg: [image1] }; },
    goto() {},
    nextPage() {},
    prevPage() {}
  };
  const document = {
    title: "JPath source fallback",
    body,
    documentElement: body,
    activeElement: body,
    querySelector(selector) { return selector === "#Readweb" ? readwebElement : null; },
    querySelectorAll(selector) {
      if (selector === "#Readweb .duxiuimg") return [page1, page2, page3];
      if (selector === "#Readweb input.Jimg" || selector === "input.Jimg") return [image1, image2, image3];
      if (selector === "#Readweb" || selector === ".duxiuimg") return [readwebElement];
      return [];
    }
  };
  const window = {
    document,
    readweb,
    params,
    cpageInfo: { cpage: 1, pageType: 5 },
    location: { href: "https://readsvr.chaoxing.com/n/moocreadsvr/read?ssid=1" },
    innerHeight: 545,
    HTMLElement,
    EventTarget,
    KeyboardEvent: function KeyboardEvent(type, init) { this.type = type; Object.assign(this, init); },
    getComputedStyle(target) { return { display: target.style && target.style.display || "block", visibility: "visible", opacity: "1", zIndex: target.style && target.style.zIndex || "auto", overflowY: "auto" }; }
  };
  const context = { window, URL, Object, Array, String, Number, RegExp, Math };
  vm.createContext(context);
  vm.runInContext(read("content/book-core-main.js"), context);

  const result = window.WinSpeedBallBookCoreV6.handleCommand({ type: "NEXT", mode: "book" });
  assert.equal(result.ok, true);
  assert.equal(result.method, "jpath-dom-force");
  assert.equal(result.page, "2");
  assert.equal(result.verified, true);
  assert.equal(page1.style.display, "none");
  assert.equal(page2.style.display, "block");
  assert.match(image2.getAttribute("src"), /\/reader\/000002\?\.&uf=ssr&zoom=0/);

  params.page = 1;
  params.t = 5;
  window.cpageInfo = { cpage: 1, pageType: 5 };
  page1.style.display = "block";
  page2.style.display = "none";
  image2.setAttribute("src", "/images/dot.gif");
  const chaoxingResult = window.WinSpeedBallBookCoreV6.handleCommand({ type: "NEXT", mode: "chaoxing" });
  assert.equal(chaoxingResult.ok, true);
  assert.equal(chaoxingResult.method, "chaoxing-pdg-force");
  assert.equal(chaoxingResult.page, "2");
  assert.equal(chaoxingResult.pageTypeLabel, "正文页");
  const consecutiveResult = window.WinSpeedBallBookCoreV6.handleCommand({ type: "NEXT", mode: "chaoxing" });
  assert.equal(consecutiveResult.ok, true);
  assert.equal(consecutiveResult.method, "chaoxing-pdg-force");
  assert.equal(consecutiveResult.page, "3");
  assert.equal(page2.style.display, "none");
  assert.equal(page3.style.display, "block");
});

test("MAIN image mode scrolls the actual image sequence and verifies movement", () => {
  function HTMLElement() {}
  HTMLElement.prototype.click = function () {};
  function EventTarget() {}
  EventTarget.prototype.dispatchEvent = function () { return true; };
  const body = Object.assign(new HTMLElement(), element({ width: 1024, height: 768 }));
  const container = Object.assign(new HTMLElement(), element({ width: 790, height: 545, clientHeight: 545, scrollHeight: 2868 }));
  container.parentElement = body;
  const pages = [0, 956, 1912].map((top) => {
    const page = Object.assign(new HTMLElement(), element({ width: 790, height: 956, top, parentElement: container }));
    page.scrollIntoView = function () { container.scrollTop = top; };
    return page;
  });
  const document = {
    title: "Image book",
    body,
    documentElement: body,
    activeElement: body,
    querySelector(selector) { return selector === "#Readweb" ? container : null; },
    querySelectorAll(selector) {
      if (selector === "#Readweb" || selector === ".duxiuimg") return [container];
      if (selector === "#Readweb .duxiuimg") return pages;
      return [];
    }
  };
  const window = {
    document,
    location: { href: "https://readsvr.chaoxing.com/n/moocreadsvr/read?ssid=1" },
    innerHeight: 545,
    scrollY: 0,
    HTMLElement,
    EventTarget,
    KeyboardEvent: function KeyboardEvent(type, init) { this.type = type; Object.assign(this, init); },
    getComputedStyle(target) { return { display: "block", visibility: "visible", opacity: "1", overflowY: target === container ? "auto" : "visible" }; }
  };
  const context = { window, URL, Object, Array, String, Number, RegExp, Math };
  vm.createContext(context);
  vm.runInContext(read("content/book-core-main.js"), context);

  const detection = window.WinSpeedBallBookCoreV6.handleCommand({ type: "DETECT", mode: "image" });
  assert.equal(detection.ok, true);
  assert.equal(detection.mode, "image");
  assert.equal(detection.imageCount, 3);

  const result = window.WinSpeedBallBookCoreV6.handleCommand({ type: "NEXT", mode: "image" });
  assert.equal(result.ok, true);
  assert.equal(result.method, "image-native-scroll");
  assert.equal(result.verified, true);
  assert.equal(result.imageIndex, 2);
  assert.equal(container.scrollTop, 956);
});

test("学习通 innerbook 外层壳不会被普通图书模式误选", () => {
  function HTMLElement() {}
  HTMLElement.prototype.click = function () {};
  function EventTarget() {}
  EventTarget.prototype.dispatchEvent = function () { return true; };
  const body = Object.assign(new HTMLElement(), element({ width: 1024, height: 768 }));
  const wrapper = Object.assign(new HTMLElement(), element({ className: "reader-container", width: 800, height: 600 }));
  const document = {
    title: "学习通图书加载外层",
    body,
    documentElement: body,
    activeElement: body,
    querySelectorAll(selector) { return selector === ".reader-container" ? [wrapper] : []; }
  };
  const window = {
    document,
    location: { href: "https://resapi.chaoxing.com/ananas/innerbook/index.html" },
    HTMLElement,
    EventTarget,
    KeyboardEvent: function KeyboardEvent(type, init) { this.type = type; Object.assign(this, init); },
    getComputedStyle() { return { display: "block", visibility: "visible", opacity: "1" }; }
  };
  const context = { window, URL, Object, Array, String, Number, RegExp, Math };
  vm.createContext(context);
  vm.runInContext(read("content/book-core-main.js"), context);

  const detection = window.WinSpeedBallBookCoreV6.handleCommand({ type: "DETECT", mode: "book" });
  assert.equal(detection.ok, false);
  assert.equal(detection.detected, false);
  assert.equal(detection.markerCount, 1);
});

test("学习通 studentstudy 课程外壳不会被误判为图书阅读器", () => {
  const fixture = createFixture("https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1");
  const detection = fixture.service.runInFrame("DETECT");
  assert.equal(detection.ok, false);
  assert.equal(detection.detected, false);
  assert.equal(detection.isCourseShell, true);
  assert.equal(fixture.next.clicked, 0);
});

test("多框架扫描优先选择评分最高的内嵌阅读器", () => {
  const fixture = createFixture("https://example.test/book");
  const selected = fixture.service.selectFrame([
    { frameId: 0, result: { detected: false, score: -100 } },
    { frameId: 4, result: { detected: true, score: 60, canNext: true, keyboardReady: true } },
    { frameId: 9, result: { detected: true, score: 130, canNext: true, keyboardReady: true } }
  ], "NEXT");
  assert.equal(selected.frameId, 9);
});

test("图书控制先扫描全部框架再只控制选中的框架", () => {
  const background = read("background/service-worker.js");
  const client = read("popup/message-client.js");
  const popup = read("popup/index.js");
  const html = read("popup/index.html");
  const schema = read("background/message-schema.js");
  const manifest = read("manifest.json");

  assert.match(background, /importScripts\("book-service\.js"\)/);
  assert.match(background, /callMainWorldBookCore\(\{ tabId: tab\.id, allFrames: true \}, \{ type: "DETECT", mode: mode \}/);
  assert.match(background, /callMainWorldBookCore\(\{ tabId: tab\.id, frameIds: \[selected\.frameId\] \}, \{ type: direction, mode: mode \}/);
  assert.match(background, /world: "MAIN"/);
  assert.match(background, /files: \["content\/book-core-main\.js"\]/);
  assert.match(background, /window\.WinSpeedBallBookCoreV7\.handleCommand/);
  assert.match(background, /CHAOXING_BACK_COVER_CHECK_DELAYS_SECONDS = \[400, 300, 250, 150, 50\]/);
  assert.match(background, /BOOK_BACK_COVER_ALARM = "book-panel-chaoxing-back-cover-check"/);
  assert.match(background, /runBookTurn\("DETECT", bookState\.tabId, bookState\.originPattern, "chaoxing"/);
  assert.match(background, /res\.pageJumpDetected && res\.isBackCover/);
  assert.match(background, /function bookBackCoverMonitorState\(\)/);
  assert.match(popup, /function renderBookBackCoverMonitor\(\)/);
  assert.match(popup, /changes\.bookPanelState/);
  assert.match(background, /bookService\.selectFrame\(results, direction\)/);
  assert.match(client, /function discoverBookFrameOrigins\(tabId, currentOriginPattern\)/);
  assert.match(client, /chrome\.webNavigation\.getAllFrames\(\{ tabId: tabId \}/);
  assert.match(client, /function ensureBookAccess\(site\)/);
  assert.match(client, /target: \{ tabId: tabId, allFrames: true \}/);
  assert.match(client, /frame\.getAttribute\("module"\)/);
  assert.match(client, /parsed && parsed\.readurl/);
  assert.match(client, /parsed && parsed\.pdgurl/);
  assert.match(client, /id = "winspeedball-book-preload"/);
  assert.match(client, /js: \["content\/book-core-main\.js"\]/);
  assert.match(client, /runAt: "document_start"/);
  assert.match(client, /world: "MAIN"/);
  assert.match(client, /matchOriginAsFallback: true/);
  assert.match(client, /\*:\/\/\*\.chaoxing\.com\/\*/);
  assert.match(client, /\*:\/\/\*\.sslibrary\.com\/\*/);
  assert.match(popup, /sendBookTargetCommand\("DETECT"/);
  assert.match(popup, /sendBookTargetCommand\("PREV"/);
  assert.match(popup, /sendBookTargetCommand\("NEXT"/);
  assert.match(html, /id="bookDetectBtn">检测图书</);
  assert.match(html, /MAIN 主环境原生强控/);
  assert.match(html, /只控制已检测到的阅读器，不会点击课程的下一节/);
  assert.match(schema, /"DETECT", "NEXT", "PREV"/);
  assert.match(schema, /\["book", "image", "chaoxing"\]/);
  assert.match(html, /data-book-view="book">&#22270;&#20070;&#33258;&#21160;&#32763;&#38405;/);
  assert.match(html, /data-book-view="image">&#22270;&#29255;&#33258;&#21160;&#32763;&#38405;/);
  assert.match(html, /id="bookImageDetectBtn">/);
  assert.match(html, /data-book-view="chaoxing">&#23398;&#20064;&#36890;&#29256;&#26412;/);
  assert.match(html, /id="bookChaoxingDetectBtn">检测学习通/);
  assert.match(html, /id="bookChaoxingIntervalInput" type="number" min="2"/);
  assert.match(html, /id="bookBackCoverMonitor"/);
  assert.match(html, /id="bookBackCoverState">待启动/);
  assert.match(html, /id="bookBackCoverOption">-/);
  assert.match(html, /id="bookBackCoverNext">启动后 400 秒/);
  assert.match(popup, /MIN_CHAOXING_INTERVAL_SECONDS = 2/);
  assert.match(background, /MIN_CHAOXING_INTERVAL_SECONDS = 2/);
  assert.match(background, /bookFastTimer = setTimeout/);
  assert.match(background, /normalizeBookInterval\(req\.interval \|\| bookState\.interval, requestedMode\)/);
  assert.match(manifest, /"webNavigation"/);
  assert.match(manifest, /"\*:\/\/\*\.chaoxing\.com\/\*"/);
  assert.match(manifest, /"\*:\/\/\*\.sslibrary\.com\/\*"/);
});

test("图书检测消息允许绑定当前学习通标签页和网站权限", () => {
  const context = {
    self: {},
    chrome: {
      runtime: {
        id: "extension-id",
        getURL(file) { return `chrome-extension://extension-id/${file}`; }
      }
    },
    Object,
    Array,
    String,
    Number,
    Date,
    RegExp
  };
  vm.createContext(context);
  vm.runInContext(read("background/message-schema.js"), context);
  const result = context.self.WinSpeedBallMessageSchema.parse({
    version: 1,
    action: "bookPanel",
    source: "popup",
    requestId: "book-detect-1",
    payload: {
      command: "DETECT",
      mode: "image",
      tabId: 9,
      originPattern: "https://mooc1.chaoxing.com/*"
    }
  }, {
    id: "extension-id",
    url: "chrome-extension://extension-id/popup/index.html"
  });
  assert.equal(result.ok, true);
  const chaoxingResult = context.self.WinSpeedBallMessageSchema.parse({
    version: 1,
    action: "bookPanel",
    source: "popup",
    requestId: "book-chaoxing-detect-1",
    payload: {
      command: "DETECT",
      mode: "chaoxing",
      tabId: 9,
      originPattern: "https://mooc1.chaoxing.com/*"
    }
  }, {
    id: "extension-id",
    url: "chrome-extension://extension-id/popup/index.html"
  });
  assert.equal(chaoxingResult.ok, true);
  const fastChaoxingResult = context.self.WinSpeedBallMessageSchema.parse({
    version: 1,
    action: "bookPanel",
    source: "popup",
    requestId: "book-chaoxing-interval-2",
    payload: { command: "SET_INTERVAL", mode: "chaoxing", interval: 2 }
  }, {
    id: "extension-id",
    url: "chrome-extension://extension-id/popup/index.html"
  });
  assert.equal(fastChaoxingResult.ok, true);
  const tooFastRegularBookResult = context.self.WinSpeedBallMessageSchema.parse({
    version: 1,
    action: "bookPanel",
    source: "popup",
    requestId: "book-interval-2",
    payload: { command: "SET_INTERVAL", mode: "book", interval: 2 }
  }, {
    id: "extension-id",
    url: "chrome-extension://extension-id/popup/index.html"
  });
  assert.equal(tooFastRegularBookResult.ok, false);
});
