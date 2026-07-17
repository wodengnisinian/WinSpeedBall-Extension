const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("Edge 扩展包含当前标签页音频权限和完整本地 Whisper 资源", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.ok(manifest.permissions.includes("tabCapture"));
  assert.match(manifest.content_security_policy.extension_pages, /'wasm-unsafe-eval'/);

  const requiredAssets = [
    ["vendor/whisper/transformers.min.js", 800000],
    ["vendor/whisper/ort-wasm-simd-threaded.jsep.mjs", 40000],
    ["vendor/whisper/ort-wasm-simd-threaded.jsep.wasm", 20000000],
    ["vendor/whisper/models/whisper-tiny/onnx/encoder_model_quantized.onnx", 10000000],
    ["vendor/whisper/models/whisper-tiny/onnx/decoder_model_merged_quantized.onnx", 30000000],
    ["vendor/whisper/models/whisper-tiny/tokenizer.json", 2000000],
    ["vendor/opencc/opencc-full-1.4.1.js", 1100000]
  ];
  for (const [file, minimumSize] of requiredAssets) {
    assert.ok(fs.statSync(path.join(root, file)).size >= minimumSize, `${file} is incomplete`);
  }
});

test("网页语音只捕获标签页声音并在浏览器内本地识别", () => {
  const worker = read("voice/worker.js");
  const offscreen = read("ocr/offscreen.html");
  const service = read("background/voice-service.js");
  const background = read("background/service-worker.js");
  assert.match(worker, /env\.allowRemoteModels = false/);
  assert.match(worker, /env\.allowLocalModels = true/);
  assert.match(worker, /env\.localModelPath = chrome\.runtime\.getURL\("vendor\/whisper\/models\/"\)/);
  assert.match(worker, /pipeline\("automatic-speech-recognition", MODEL_ID/);
  assert.match(worker, /WinSpeedBallVoiceTextFilter\.filter/);
  assert.match(worker, /dtype: "q8"/);
  assert.match(worker, /chromeMediaSource: "tab"/);
  assert.match(worker, /new MediaRecorder\(captureStream/);
  assert.match(worker, /playbackSource\.connect\(playbackContext\.destination\)/);
  assert.doesNotMatch(worker, /\bfetch\s*\(/);
  assert.match(offscreen, /vendor\/opencc\/opencc-full-1\.4\.1\.js/);
  assert.match(offscreen, /<script type="module" src="\.\.\/voice\/worker\.js"><\/script>/);
  assert.match(service, /chrome\.tabCapture\.getMediaStreamId/);
  assert.match(service, /Edge 安全限制：[\s\S]*工具栏中的 WinSpeedBall 图标/);
  assert.match(background, /gateAction\("ocr\.basic"[\s\S]*?voiceService\.start\(tab\)/);
});

test("语音结果统一为简体中文和正常英文并保留题目符号", () => {
  const context = { Object, String, Array };
  vm.createContext(context);
  vm.runInContext("self = globalThis;", context);
  vm.runInContext(read("vendor/opencc/opencc-full-1.4.1.js"), context);
  vm.runInContext(read("voice/text-filter.js"), context);
  const filter = context.WinSpeedBallVoiceTextFilter.filter;
  const normalize = context.WinSpeedBallTextNormalizer.normalize;
  assert.equal(filter("繁體漢字與軟體，ＡＢＣ 𝕋𝕖𝕤𝕥"), "繁体汉字与软件,ABC Test");
  assert.equal(filter("漢語學習與網路"), "汉语学习与网络");
  assert.equal(filter("企業 core 경쟁력 123，рынок! 技術🙂"), "企业 core 123,! 技术");
  assert.equal(filter("第 2 題：A + B = 10%"), "第 2 题:A + B = 10%");
  assert.equal(normalize("第一行繁體\nSecond 𝕃𝕚𝕟𝕖\n\n答案：Ａ"), "第一行繁体\nSecond Line\n\n答案:A");
});

test("语音消息校验任务编号并拒绝普通标签页伪装离屏工作页", () => {
  const context = {
    self: {},
    URL,
    chrome: { runtime: { id: "extension-id", getURL: (file) => `chrome-extension://extension-id/${file}` } }
  };
  vm.createContext(context);
  vm.runInContext(read("background/message-schema.js"), context);
  const schema = context.self.WinSpeedBallMessageSchema;
  const sender = { id: "extension-id", url: "chrome-extension://extension-id/ocr/offscreen.html" };
  const valid = schema.parse({
    version: 1,
    action: "voiceJobComplete",
    source: "offscreen-ocr",
    requestId: "voice-worker-1",
    payload: { jobId: "voice-100-abcdef", text: "题目文字", durationMs: 3000 }
  }, sender);
  assert.equal(valid.ok, true);

  const forged = schema.parse({
    version: 1,
    action: "voiceJobComplete",
    source: "offscreen-ocr",
    requestId: "voice-worker-2",
    payload: { jobId: "voice-100-abcdef", text: "伪造文字", durationMs: 3000 }
  }, { ...sender, tab: { id: 9 } });
  assert.equal(forged.ok, false);

  const missingJob = schema.parse({
    version: 1,
    action: "voiceJobFailed",
    source: "offscreen-ocr",
    requestId: "voice-worker-3",
    payload: { error: "failed" }
  }, sender);
  assert.equal(missingJob.ok, false);
});

function buildVoiceService() {
  const data = {};
  const alarms = [];
  let closeCount = 0;
  const storage = {
    get(keys, callback) {
      const result = {};
      for (const key of keys) if (Object.prototype.hasOwnProperty.call(data, key)) result[key] = data[key];
      callback(result);
    },
    set(patch, callback) {
      Object.assign(data, patch);
      if (callback) callback({ ok: true });
    },
    appendLog() {}
  };
  const chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        if (message.action === "startTabAudioRecording") callback({ ok: true, status: "recording" });
        else if (message.action === "stopTabAudioRecording") callback({ ok: true, durationMs: 2000 });
        else callback({ ok: true, status: "cancelled" });
      }
    },
    tabCapture: {
      getMediaStreamId(options, callback) {
        assert.equal(options.targetTabId, 7);
        callback("stream-id");
      }
    },
    alarms: {
      clear(name, callback) { if (callback) callback(true); },
      create(name, options) { alarms.push({ name, options }); }
    }
  };
  const context = {
    self: {
      WinSpeedBallStorageService: storage,
      WinSpeedBallVoiceTextFilter: { filter: (value) => String(value || "").trim() },
      WinSpeedBallOcrService: {
        ensureOffscreen() { return Promise.resolve(); },
        closeOffscreen() { closeCount += 1; return Promise.resolve({ ok: true }); }
      }
    },
    chrome,
    Promise,
    Object,
    Array,
    String,
    Number,
    Date,
    Math,
    Error
  };
  vm.createContext(context);
  vm.runInContext(read("background/voice-service.js"), context);
  return {
    service: context.self.WinSpeedBallVoiceService,
    data,
    alarms,
    getCloseCount: () => closeCount
  };
}

test("语音任务保留当前结果、忽略旧任务并在五分钟后释放模型", async () => {
  const fixture = buildVoiceService();
  const started = await fixture.service.start({ id: 7 });
  assert.equal(started.ok, true);
  assert.equal(started.status, "recording");
  const jobId = fixture.data.voiceJobId;
  assert.match(jobId, /^voice-/);

  await fixture.service.handleProgress({ jobId, status: "recording", progress: 0.2, durationMs: 2000 });
  assert.equal(fixture.data.voiceDurationMs, 2000);
  await fixture.service.handleComplete({ jobId: "voice-old-job", text: "旧结果", durationMs: 1000 });
  assert.equal(fixture.data.voiceTranscript, "");

  await fixture.service.handleComplete({ jobId, text: "人才", durationMs: 2500 });
  assert.equal(fixture.data.voiceJobStatus, "completed");
  assert.equal(fixture.data.voiceTranscript, "人才");
  assert.equal(fixture.getCloseCount(), 0);
  assert.equal(fixture.alarms.at(-1).name, fixture.service.modelIdleAlarm);
  assert.equal(fixture.alarms.at(-1).options.delayInMinutes, 5);

  assert.equal(fixture.service.handleAlarm({ name: fixture.service.modelIdleAlarm }), true);
  await flush();
  assert.equal(fixture.getCloseCount(), 1);
});

test("清理问题获取数据会同时停止 OCR 与网页语音", () => {
  const background = read("background/service-worker.js");
  const privacy = read("background/privacy-service.js");
  assert.match(background, /stopsOcr \? Promise\.resolve\(voiceService\.cancel\(\)\)/);
  assert.match(privacy, /"voiceTranscript"/);
  assert.match(privacy, /"voiceDurationMs"/);
});
