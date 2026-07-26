const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "shared/scroll-surface.js"), "utf8");

function createClassList() {
  const values = new Set();
  return {
    add(name) { values.add(name); },
    toggle(name, enabled) { if (enabled) values.add(name); else values.delete(name); },
    contains(name) { return values.has(name); }
  };
}

function createElement() {
  const listeners = {};
  return {
    nodeType: 1,
    tagName: "DIV",
    isContentEditable: false,
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 200,
    classList: createClassList(),
    dataset: {},
    listeners,
    addEventListener(type, listener) { listeners[type] = listener; },
    removeEventListener(type) { delete listeners[type]; },
    scrollTo(options) { this.scrollTop = Number(options.top || 0); this.lastBehavior = options.behavior; },
    focus() { this.focused = true; }
  };
}

function loadApi(reducedMotion = false) {
  const frames = [];
  const self = {
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
    setTimeout,
    matchMedia() { return { matches: reducedMotion }; }
  };
  const context = { self, Number, Math, Object, String, Error };
  vm.createContext(context);
  vm.runInContext(source, context);
  return {
    api: self.WinSpeedBallScrollSurface,
    flush() {
      while (frames.length) frames.shift()();
    }
  };
}

test("统一滚动区域提供进度、原生平滑翻屏、键盘导航和回顶", () => {
  const runtime = loadApi();
  const element = createElement();
  const progressBar = { style: {} };
  const progress = {
    hidden: true,
    firstElementChild: progressBar,
    values: {},
    setAttribute(name, value) { this.values[name] = value; }
  };
  const topButton = {
    hidden: true,
    disabled: true,
    listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    removeEventListener(type) { delete this.listeners[type]; }
  };
  const states = [];
  const controller = runtime.api.create({
    element,
    progress,
    topButton,
    onUpdate(state) { states.push(state); }
  });

  assert.equal(progress.hidden, false);
  assert.equal(topButton.hidden, true);
  assert.equal(element.classList.contains("scroll-overflowing"), true);

  controller.runCommand("down", true);
  runtime.flush();
  assert.equal(element.scrollTop, 170);
  assert.equal(element.lastBehavior, "smooth");
  assert.equal(progress.values["aria-valuenow"], "21");
  assert.equal(progressBar.style.transform, "scaleX(0.21)");
  assert.equal(topButton.hidden, false);

  let prevented = false;
  element.listeners.keydown({
    key: "End",
    target: element,
    defaultPrevented: false,
    preventDefault() { prevented = true; }
  });
  runtime.flush();
  assert.equal(prevented, true);
  assert.equal(element.scrollTop, 800);

  topButton.listeners.click();
  runtime.flush();
  assert.equal(element.scrollTop, 0);
  assert.equal(element.focused, true);
  assert.equal(states.at(-1).percent, 0);
});

test("减少动态效果偏好会关闭平滑滚动，短内容不显示多余控件", () => {
  const runtime = loadApi(true);
  const element = createElement();
  element.scrollHeight = 160;
  const progress = {
    hidden: false,
    firstElementChild: { style: {} },
    setAttribute() {}
  };
  const topButton = {
    hidden: false,
    disabled: false,
    addEventListener() {},
    removeEventListener() {}
  };
  const controller = runtime.api.create({ element, progress, topButton });

  assert.equal(controller.state().overflowing, false);
  assert.equal(progress.hidden, true);
  assert.equal(topButton.hidden, true);

  element.scrollHeight = 600;
  controller.runCommand("bottom", true);
  assert.equal(element.lastBehavior, "auto");
  assert.equal(element.scrollTop, 400);
});
