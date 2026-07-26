"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "ocr", "engine.js"), "utf8");

function loadEngine() {
  const pixels = new Uint8ClampedArray([
    184, 184, 184, 255,
    255, 255, 255, 255
  ]);
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return {
        fillStyle: "",
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low",
        fillRect() {},
        drawImage() {},
        getImageData() { return { data: pixels }; },
        putImageData() {},
      };
    },
    toDataURL() { return "data:image/png;base64,PROCESSED"; }
  };
  class FakeImage {
    constructor() {
      this.naturalWidth = 100;
      this.naturalHeight = 40;
    }
    set src(value) {
      this._src = value;
      Promise.resolve().then(() => this.onload());
    }
  }
  const parameters = [];
  const recognized = [];
  const worker = {
    setParameters(value) {
      parameters.push(value);
      return Promise.resolve();
    },
    recognize(value) {
      recognized.push(value);
      return Promise.resolve({ data: { text: "A. Alpha\nB. Beta\nC. Gamma\nD. Delta" } });
    }
  };
  const context = {
    chrome: { runtime: { getURL: (value) => `chrome-extension://test/${value}` } },
    console,
    document: { createElement: (name) => name === "canvas" ? canvas : null },
    Image: FakeImage,
    Math,
    Number,
    Promise,
    String,
    Uint8ClampedArray,
    window: {
      Tesseract: {
        PSM: { SINGLE_BLOCK: "6" },
        createWorker() { return Promise.resolve(worker); }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "ocr/engine.js" });
  return { api: context.window.winSpeedBallOcr, canvas, parameters, pixels, recognized };
}

test("OCR 预处理会放大截图并加深浅灰色选项文字", async () => {
  const fixture = loadEngine();
  const progress = [];
  const result = await fixture.api.preprocess("data:image/png;base64,ORIGINAL", (value) => progress.push(value));
  assert.equal(result, "data:image/png;base64,PROCESSED");
  assert.equal(fixture.canvas.width, 288);
  assert.equal(fixture.canvas.height, 144);
  assert.ok(fixture.pixels[0] < 100, `浅灰色像素未充分加深：${fixture.pixels[0]}`);
  assert.equal(fixture.pixels[4], 255);
  assert.deepEqual(progress.map((item) => item.status), ["preprocessing", "preprocessing"]);
});

test("OCR 使用增强图像和题目块参数识别中英文选项", async () => {
  const fixture = loadEngine();
  const text = await fixture.api.recognize("data:image/png;base64,ORIGINAL");
  assert.match(text, /A\. Alpha/);
  assert.equal(fixture.recognized[0], "data:image/png;base64,PROCESSED");
  assert.equal(fixture.parameters[0].tessedit_pageseg_mode, "6");
  assert.equal(fixture.parameters[0].preserve_interword_spaces, "1");
  assert.equal(fixture.parameters[0].user_defined_dpi, "300");
});
