import { env, pipeline } from "../vendor/whisper/transformers.min.js";

const MODEL_ID = "whisper-tiny";
const SAMPLE_RATE = 16000;
let recorder = null;
let captureStream = null;
let playbackContext = null;
let playbackSource = null;
let chunks = [];
let startedAt = 0;
let maxDurationTimer = null;
let progressTimer = null;
let cancelled = false;
let transcriberPromise = null;
let reportSequence = 0;
let currentJobId = "";
let currentStatus = "idle";
let captureSequence = 0;

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = chrome.runtime.getURL("vendor/whisper/models/");
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("vendor/whisper/");
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

function report(action, payload) {
  try {
    chrome.runtime.sendMessage({
      version: 1,
      action,
      source: "offscreen-ocr",
      requestId: "voice-offscreen-" + Date.now() + "-" + (++reportSequence),
      payload: payload || {}
    }, function () { void chrome.runtime.lastError; });
  } catch (error) {}
}

function durationMs() {
  return startedAt ? Math.max(0, Date.now() - startedAt) : 0;
}

function clearTimers() {
  if (maxDurationTimer) clearTimeout(maxDurationTimer);
  if (progressTimer) clearInterval(progressTimer);
  maxDurationTimer = null;
  progressTimer = null;
}

async function releaseCapture() {
  clearTimers();
  if (playbackSource) {
    try { playbackSource.disconnect(); } catch (error) {}
  }
  playbackSource = null;
  if (captureStream) {
    captureStream.getTracks().forEach(function (track) { try { track.stop(); } catch (error) {} });
  }
  captureStream = null;
  if (playbackContext) {
    try { await playbackContext.close(); } catch (error) {}
  }
  playbackContext = null;
  recorder = null;
}

function monoSamples(audioBuffer) {
  const length = audioBuffer.length;
  const channels = audioBuffer.numberOfChannels;
  const mono = new Float32Array(length);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = audioBuffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) mono[index] += data[index] / channels;
  }
  return mono;
}

async function decodeAudio(blob) {
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const audioBuffer = await context.decodeAudioData(await blob.arrayBuffer());
    if (audioBuffer.sampleRate === SAMPLE_RATE) return monoSamples(audioBuffer);
    const targetLength = Math.max(1, Math.ceil(audioBuffer.duration * SAMPLE_RATE));
    const offline = new OfflineAudioContext(1, targetLength, SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offline.destination);
    source.start(0);
    return monoSamples(await offline.startRendering());
  } finally {
    try { await context.close(); } catch (error) {}
  }
}

function modelProgress(update) {
  if (currentStatus !== "loading") return;
  const raw = Number(update && update.progress);
  const progress = Number.isFinite(raw) ? Math.max(0, Math.min(0.85, raw / 100 * 0.85)) : 0;
  if (currentJobId) report("voiceJobProgress", { jobId: currentJobId, status: "loading", progress, durationMs: durationMs() });
}

function getTranscriber() {
  if (!transcriberPromise) {
    currentStatus = "loading";
    transcriberPromise = pipeline("automatic-speech-recognition", MODEL_ID, {
      device: "wasm",
      dtype: "q8",
      progress_callback: modelProgress
    }).catch(function (error) {
      transcriberPromise = null;
      throw error;
    });
  }
  return transcriberPromise;
}

async function transcribe(blob, recordedDurationMs, sequence, jobId) {
  try {
    if (cancelled || sequence !== captureSequence) return;
    currentStatus = "loading";
    report("voiceJobProgress", { jobId, status: "loading", progress: 0, durationMs: recordedDurationMs });
    const samples = await decodeAudio(blob);
    if (cancelled || sequence !== captureSequence) return;
    if (!samples.length) throw new Error("录音中没有可识别的声音。");
    const transcriber = await getTranscriber();
    if (cancelled || sequence !== captureSequence) return;
    currentStatus = "transcribing";
    report("voiceJobProgress", { jobId, status: "transcribing", progress: 0.9, durationMs: recordedDurationMs });
    const output = await transcriber(samples, {
      language: "chinese",
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5
    });
    if (cancelled || sequence !== captureSequence) return;
    const text = window.WinSpeedBallVoiceTextFilter.filter(output && output.text || "");
    currentStatus = text ? "completed" : "empty";
    report("voiceJobComplete", { jobId, text, durationMs: recordedDurationMs });
  } catch (error) {
    if (cancelled || sequence !== captureSequence) return;
    currentStatus = "failed";
    report("voiceJobFailed", { jobId, error: error && error.message || String(error || "本地 Whisper 识别失败。") });
  } finally {
    if (currentJobId === jobId) {
      chunks = [];
      currentJobId = "";
    }
  }
}

async function start(payload) {
  if (recorder && recorder.state !== "inactive") return { ok: false, error: "网页语音正在录制中。" };
  const streamId = String(payload && payload.streamId || "");
  const jobId = String(payload && payload.jobId || "");
  const maxDurationMs = Math.max(5000, Math.min(60000, Number(payload && payload.maxDurationMs || 60000)));
  if (!streamId || !jobId) return { ok: false, error: "网页音频流无效。" };

  cancelled = false;
  const sequence = ++captureSequence;
  chunks = [];
  currentJobId = jobId;
  currentStatus = "starting";
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
    video: false
  });
  if (cancelled || sequence !== captureSequence) {
    stream.getTracks().forEach(function (track) { try { track.stop(); } catch (error) {} });
    currentStatus = "cancelled";
    return { ok: true, status: "cancelled", jobId };
  }
  captureStream = stream;
  playbackContext = new AudioContext();
  playbackSource = playbackContext.createMediaStreamSource(captureStream);
  playbackSource.connect(playbackContext.destination);
  await playbackContext.resume();
  if (cancelled || sequence !== captureSequence) {
    await releaseCapture();
    currentStatus = "cancelled";
    return { ok: true, status: "cancelled", jobId };
  }

  const mimeTypes = ["audio/webm;codecs=opus", "audio/webm"];
  const mimeType = mimeTypes.find(function (type) { return MediaRecorder.isTypeSupported(type); }) || "";
  recorder = mimeType ? new MediaRecorder(captureStream, { mimeType }) : new MediaRecorder(captureStream);
  recorder.addEventListener("dataavailable", function (event) {
    if (event.data && event.data.size) chunks.push(event.data);
  });
  recorder.addEventListener("stop", async function () {
    const recordedDurationMs = durationMs();
    const recordedJobId = currentJobId;
    const type = recorder && recorder.mimeType || mimeType || "audio/webm";
    const blob = new Blob(chunks, { type });
    await releaseCapture();
    if (cancelled) {
      chunks = [];
      currentJobId = "";
      currentStatus = "cancelled";
      return;
    }
    await transcribe(blob, recordedDurationMs, sequence, recordedJobId);
  }, { once: true });

  recorder.start(1000);
  startedAt = Date.now();
  currentStatus = "recording";
  progressTimer = setInterval(function () {
    report("voiceJobProgress", {
      jobId: currentJobId,
      status: "recording",
      progress: Math.min(0.99, durationMs() / maxDurationMs),
      durationMs: durationMs()
    });
  }, 1000);
  maxDurationTimer = setTimeout(function () {
    if (recorder && recorder.state === "recording") recorder.stop();
  }, maxDurationMs);
  return { ok: true, status: "recording", jobId };
}

function stop() {
  if (!recorder || recorder.state !== "recording") return Promise.resolve({ ok: false, error: "当前没有正在录制的网页语音。" });
  const recordedDurationMs = durationMs();
  currentStatus = "loading";
  recorder.stop();
  return Promise.resolve({ ok: true, accepted: true, durationMs: recordedDurationMs });
}

function cancel() {
  cancelled = true;
  captureSequence += 1;
  currentStatus = "cancelled";
  if (recorder && recorder.state === "recording") recorder.stop();
  else releaseCapture();
  currentJobId = "";
  return Promise.resolve({ ok: true, status: "cancelled" });
}

function getState() {
  return {
    status: currentStatus,
    jobId: currentJobId,
    durationMs: durationMs(),
    recording: !!(recorder && recorder.state === "recording")
  };
}

async function prepare() {
  await getTranscriber();
  if (!currentJobId) currentStatus = "idle";
  return { ok: true, model: MODEL_ID, dtype: "q8", device: "wasm" };
}

window.WinSpeedBallVoiceWorker = Object.freeze({ start, stop, cancel, getState, prepare });
window.dispatchEvent(new Event("winspeedball-voice-worker-ready"));
