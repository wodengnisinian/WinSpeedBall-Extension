const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function loadVideoService() {
  const context = {
    self: {
      WinSpeedBallStorageService: {
        get(keys, callback) { callback({}); },
        set(data, callback) { if (callback) callback({ ok: true }); }
      }
    },
    Promise, Object, Array, String, Number, Set
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/video-service.js"), "utf8"), context);
  return context.self.WinSpeedBallVideoService.create();
}

function loadContentScript(mediaDefinitions) {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const timeouts = [];
  const intervals = new Map();
  let timerSequence = 0;
  let media = [];
  const document = {
    title: "页面私密标题",
    body: { innerText: "页面私密正文" },
    documentElement: {},
    addEventListener(name, handler) { documentListeners.set(name, handler); },
    removeEventListener() {},
    querySelectorAll(selector) { return selector === "*" ? media : []; }
  };

  function createMedia(definition, index) {
    const attributes = Object.assign({}, definition.attributes || {});
    const listeners = new Map();
    return {
      tagName: definition.tagName || "VIDEO",
      isConnected: true,
      ownerDocument: document,
      paused: definition.paused !== false,
      duration: definition.duration || 0,
      currentTime: definition.currentTime || 0,
      playbackRate: 1,
      defaultPlaybackRate: 1,
      volume: 0.8,
      muted: false,
      readyState: 4,
      score: definition.score == null ? 100 - index : definition.score,
      playCalls: 0,
      pauseCalls: 0,
      addEventListener(name, handler) { listeners.set(name, handler); },
      getAttribute(name) { return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null; },
      getBoundingClientRect() { return { width: 640, height: 360 }; },
      play() {
        this.playCalls++;
        this.paused = false;
        const handler = documentListeners.get("play");
        if (handler) handler({ target: this });
        return Promise.resolve();
      },
      pause() {
        this.pauseCalls++;
        this.paused = true;
        const handler = documentListeners.get("pause");
        if (handler) handler({ target: this });
      }
    };
  }

  media = mediaDefinitions.map(createMedia);
  const html5 = {
    isMedia(element) { return media.includes(element); },
    apply(element, state) {
      element.playbackRate = state.rate;
      element.defaultPlaybackRate = state.rate;
      element.muted = state.muted;
      element.volume = state.muted ? 0 : state.volume;
    },
    needsSync() { return false; },
    tryPlay(element) { if (element.paused && element.readyState >= 2) element.play(); },
    getInfo(element) {
      if (!element) return { duration: 0, currentTime: 0, remainingTime: 0, paused: true, tag: "" };
      return {
        duration: element.duration,
        currentTime: element.currentTime,
        remainingTime: Math.max(0, element.duration - element.currentTime),
        paused: element.paused,
        tag: element.tagName.toLowerCase()
      };
    },
    score(element) { return element.score; }
  };
  const context = {
    document,
    location: { href: "https://example.test/private-course", hostname: "example.test" },
    console,
    Promise,
    Date,
    URL,
    MutationObserver: class { observe() {} },
    setTimeout(callback, delay) {
      const id = ++timerSequence;
      timeouts.push({ id, callback, delay });
      return id;
    },
    clearTimeout(id) {
      const item = timeouts.find((entry) => entry.id === id);
      if (item) item.cancelled = true;
    },
    setInterval(callback, delay) {
      const id = ++timerSequence;
      intervals.set(id, { callback, delay });
      return id;
    },
    clearInterval(id) { intervals.delete(id); },
    chrome: {
      runtime: {
        id: "extension-id",
        lastError: null,
        sendMessage(message, callback) { callback({ ok: true }); },
        onMessage: { addListener() {} }
      }
    },
    WinSpeedBallPlayerAdapters: {
      html5,
      identify() { return { id: "html5", label: "HTML5" }; },
      detectSpecial() { return { type: "" }; }
    },
    addEventListener(name, handler) { windowListeners.set(name, handler); },
    removeEventListener() {}
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "content_script.js"), "utf8"), context);
  return {
    api: context.winSpeedBall,
    media,
    intervals,
    runTimeouts() {
      while (timeouts.length) {
        const item = timeouts.shift();
        if (!item.cancelled) item.callback();
      }
    }
  };
}

test("VideoService 聚合稳定媒体 ID、帧和控制模式", () => {
  const service = loadVideoService();
  const result = service.aggregateFrameResults([
    { frameId: 0, result: { ok: true, rate: 2, volume: 0.8, muted: false, controlMode: "apply", mediaCount: 1, applied: 0, media: [{ id: "media-1", title: "Main", duration: 100, currentTime: 25 }] } },
    { frameId: 7, result: { ok: true, rate: 2, volume: 0.8, muted: false, controlMode: "apply", mediaCount: 1, applied: 0, media: [{ id: "media-1", title: "Frame", duration: 50, currentTime: 10 }] } }
  ], { type: "GET_MEDIA_LIST" });
  assert.equal(result.controlMode, "apply");
  assert.deepEqual(Array.from(result.media, (item) => item.id), ["frame-0-media-1", "frame-7-media-1"]);
  assert.deepEqual(Array.from(result.media, (item) => item.frameId), [0, 7]);
});

test("VideoService 将媒体控制发送到页面主环境", () => {
  const source = fs.readFileSync(path.join(root, "background/video-service.js"), "utf8");
  assert.match(source, /world:\s*"MAIN"/);
  assert.match(source, /files:\s*\["shadow_hook\.js",\s*"content\/media-core-main\.js"\]/);
  assert.match(source, /WinSpeedBallMediaCoreV6\.handleCommand/);
  assert.match(source, /command\.type === "EXTRACT_PAGE_TEXT"[\s\S]*?sendIsolatedCommandToAllFrames/);
  assert.match(source, /authoritative = mediaInfo \|\| firstOk/);
  assert.match(source, /rateLocked:\s*authoritative \? authoritative\.rateLocked === true : false/);
  assert.match(source, /verifiedAfterMs:\s*700/);
  assert.match(source, /ok:\s*rateStable/);
  assert.match(source, /main media core upgrade required/);
  assert.match(source, /legacy\.handleCommand\(\{ type: "STOP_LOCK" \}\)/);
});

test("VideoService 使用实际含视频的 iframe 状态并延迟确认强控", () => {
  const service = loadVideoService();
  const result = service.aggregateFrameResults([
    { frameId: 0, result: { ok: true, rate: 1, targetRate: 1, rateLocked: false, rateStable: false, volume: 0.8, muted: false, mediaCount: 0, applied: 0 } },
    { frameId: 9, result: { ok: true, rate: 5, targetRate: 5, rateLocked: true, rateStable: true, volume: 0.8, muted: false, mediaCount: 1, applied: 1 } }
  ], { type: "SET_RATE", rate: 5 });

  assert.equal(result.rate, 5);
  assert.equal(result.targetRate, 5);
  assert.equal(result.rateLocked, true);
  assert.equal(result.rateStable, true);
  assert.equal(result.mediaCount, 1);
});

test("VideoService 会采用其他 iframe 已显示的 Video.js 总时长", () => {
  const service = loadVideoService();
  const result = service.aggregateFrameResults([
    { frameId: 0, result: { ok: true, rate: 1, volume: 0.8, muted: false, mediaCount: 1, duration: 0, currentTime: 0, applied: 0 } },
    { frameId: 6, result: { ok: true, rate: 1, volume: 0.8, muted: false, mediaCount: 0, duration: 506, currentTime: 98, durationSource: "videojs-dom", applied: 0 } }
  ], { type: "GET_STATUS" });
  assert.equal(result.duration, 506);
  assert.equal(result.currentTime, 98);
  assert.equal(result.durationSource, "videojs-dom");
  assert.equal(result.mediaCount, 1);
});

test("主环境媒体核心具备属性锁、反覆盖和分阶段修复", () => {
  const source = fs.readFileSync(path.join(root, "content/media-core-main.js"), "utf8");
  assert.match(source, /nativeGetOwnPropertyDescriptor\(nativeMediaPrototype, "playbackRate"\)/);
  assert.match(source, /capturePristineRuntime\(\)/);
  assert.match(source, /document\.createElement\("iframe"\)/);
  assert.match(source, /installPropertyGuard\("playbackRate"\)/);
  assert.match(source, /installDefinePropertyGuard\(\)/);
  assert.match(source, /Object\.defineProperties = function/);
  assert.match(source, /Reflect\.defineProperty = function/);
  assert.match(source, /target === mediaPrototype && controlled/);
  assert.match(source, /\[0, 120, 600, 1200\]\.forEach/);
  assert.match(source, /state\.transientLockUntil = Date\.now\(\) \+ 1500/);
  assert.match(source, /shadowRoots\.add/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /now - lastIntegrityScan >= 30000/);
});

test("倍速强控可阻止原生 setter 绕过并按需逐帧恢复", () => {
  const source = fs.readFileSync(path.join(root, "content/media-core-main.js"), "utf8");
  assert.match(source, /rateLocked:\s*false/);
  assert.match(source, /if \(isRateProperty\(property\) && state\.rateLocked\) return true/);
  assert.match(source, /if \(isRateProperty\(property\) && isGuarded\(property\)\) return state\.externalRateMasked \? 1 : state\.rate/);
  assert.match(source, /nativeMethods\.addEventListener\.call\(document, "ratechange", interceptRateChange, true\)/);
  assert.match(source, /function runRateDefenseFrame\(\)/);
  assert.match(source, /global\.requestAnimationFrame/);
  assert.match(source, /state\.rateDefenseUntil = Math\.max/);
  assert.match(source, /if \(!state\.rateLocked && !state\.lockRequested && !state\.keepPlaying\) return/);
  assert.match(source, /setInterval\(function \(\) \{[\s\S]*?synchronizeAll\(\);[\s\S]*?\}, 250\)/);
  assert.match(source, /rateStable:\s*rateStable/);
  assert.match(source, /return state\.externalRateMasked \? 1 : state\.rate/);
  assert.match(source, /state\.externalRateMasked = true/);
  assert.match(source, /chaoxing\\\.com/);
  assert.match(source, /function videoJsPlayer\(media\)/);
  assert.match(source, /videojs\.getPlayer/);
  assert.match(source, /timedRangeEnd\(media\.seekable\)/);
  assert.match(source, /function parseClockTime\(value\)/);
  assert.match(source, /videoJsDomTime\(media, "\.vjs-duration-display"\)/);
  assert.match(source, /videoJsDomTime\(media, "\.vjs-current-time-display"\)/);
  assert.match(source, /videoJsDomTime\(null, "\.vjs-duration-display"\)/);
  assert.match(source, /videoJsDomTime\(null, "\.vjs-current-time-display"\)/);
  assert.match(source, /durationSource = "videojs-dom"/);
  assert.match(source, /durationSource:\s*info\.durationSource/);
  assert.match(source, /WinSpeedBallMediaCoreV6/);
  assert.match(source, /function resumeAfterRateChange\(media\)/);
  assert.match(source, /function resumeAfterRateChange\(media\)[\s\S]*?playMedia\(target\);[\s\S]*?\[120, 600, 1200\]\.forEach/);
  assert.match(source, /SESSION_STATE_KEY = "__winspeedball_media_state_v6"/);
  assert.match(source, /function restoreContinuousState\(\)/);
  assert.match(source, /function persistContinuousState\(\)/);
  assert.match(source, /\["loadstart", "loadedmetadata", "loadeddata", "canplay"/);
  assert.match(source, /attributeFilter: \["src"\]/);
  assert.match(source, /continuousPlayback:\s*state\.continuousPlayback/);
  const setRateBlock = source.slice(source.indexOf('case "SET_RATE":'), source.indexOf('case "STEP_UP":'));
  assert.doesNotMatch(setRateBlock, /continuousPlayback = true|resumeAfterRateChange/);
  assert.match(source, /case "ENABLE_AUTOPLAY":[\s\S]*?state\.continuousPlayback = true[\s\S]*?resumeAfterRateChange\(media\)/);
  assert.match(source, /case "STOP_LOCK":[\s\S]*?state\.rateLocked = false[\s\S]*?stopRateDefense\(\)/);
});

test("视频控制会发现跨域播放器并注册页面早期强控", () => {
  const client = fs.readFileSync(path.join(root, "popup/message-client.js"), "utf8");
  const popup = fs.readFileSync(path.join(root, "popup.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "popup.html"), "utf8");
  assert.match(client, /document\.querySelectorAll\("iframe,frame"\)/);
  assert.match(client, /chrome\.permissions\.request\(\{ origins: requested \}/);
  assert.match(client, /id = "winspeedball-media-preload"/);
  assert.match(client, /js: \["shadow_hook\.js", "content\/media-core-main\.js"\]/);
  assert.match(client, /runAt: "document_start"/);
  assert.match(client, /allFrames: true/);
  assert.match(client, /world: "MAIN"/);
  assert.match(popup, /getCurrentSiteAccess\(\)\.then\(ensureMediaAccess\)/);
  assert.equal(popup.includes("\\u5df2\\u542f\\u7528\\u6df1\\u5ea6\\u5f3a\\u63a7"), true);
  assert.match(popup, /videoDurationRetryCount < 4/);
  for (const id of ["playVideoBtn", "pauseVideoBtn", "enableAutoplayBtn", "disableAutoplayBtn"]) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(popup, new RegExp(`\\$\\("${id}"\\)\\.addEventListener`));
  }
});

test("一次应用命令不再隐式启动锁定定时器", () => {
  const source = fs.readFileSync(path.join(root, "content_script.js"), "utf8");
  for (const command of ["SET_RATE", "STEP_UP", "STEP_DOWN", "SET_MUTED", "TOGGLE_MUTED", "SET_VOLUME"]) {
    const start = source.indexOf(`case "${command}":`);
    const end = source.indexOf("case ", start + 6);
    const block = source.slice(start, end);
    assert.ok(start >= 0, command);
    assert.equal(block.includes("startLock()"), false, command);
    assert.equal(block.includes("markApplied()"), true, command);
  }
  assert.match(source, /case "LOCK_STATE":[\s\S]*?startLock\(true\)/);
  assert.match(source, /function stopLock\(\)[\s\S]*?clearInterval\(lockTimer\)/);
  assert.equal((source.match(/setInterval\(/g) || []).length, 1);
});

test("消息 Schema 支持显式锁定、停止、媒体列表、播放和暂停", () => {
  const context = {
    self: {}, URL,
    chrome: { runtime: { id: "extension-id", getURL: (file) => `chrome-extension://extension-id/${file}` } }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/message-schema.js"), "utf8"), context);
  const schema = context.self.WinSpeedBallMessageSchema;
  const sender = { id: "extension-id", url: "chrome-extension://extension-id/popup.html" };
  for (const type of ["LOCK_STATE", "STOP_LOCK", "GET_MEDIA_LIST", "PLAY", "PAUSE"]) {
    const parsed = schema.parse({ version: 1, action: "controlActiveTab", source: "popup", requestId: `video-${type}`, payload: { command: { type } } }, sender);
    assert.equal(parsed.ok, true, type);
  }
});

test("区域截图按能力探测内容脚本，不依赖过期版本字符串", () => {
  const source = fs.readFileSync(path.join(root, "background.js"), "utf8");
  assert.match(source, /typeof window\.winSpeedBall\.startRegionCapture === "function"/);
  assert.equal(source.includes("2026-07-11-player-adapters-v1"), false);
});

test("重复启动区域截图会先清理旧框选再重新开始", () => {
  const source = fs.readFileSync(path.join(root, "content_script.js"), "utf8");
  assert.match(source, /var regionCaptureCleanup = null/);
  assert.match(source, /if \(regionCaptureActive && typeof regionCaptureCleanup === "function"\)\s*\{\s*regionCaptureCleanup\(false\)/);
  assert.doesNotMatch(source, /Region capture is already active/);
  assert.match(source, /overlay\.id = "winspeedball-region-overlay"/);
  assert.match(source, /selection\.id = "winspeedball-region-selection"/);
});

test("区域截图遮罩接管 iframe 上方的鼠标事件", () => {
  const source = fs.readFileSync(path.join(root, "content_script.js"), "utf8");
  const capture = source.slice(source.indexOf("function startRegionCapture"), source.indexOf("function handleCommand"));
  const overlayStyle = capture.slice(capture.indexOf("overlay.style.cssText"), capture.indexOf("selection.style.cssText"));
  assert.match(overlayStyle, /"pointer-events:auto"/);
  assert.match(overlayStyle, /"cursor:default!important"/);
  assert.doesNotMatch(overlayStyle, /crosshair/);
  assert.doesNotMatch(overlayStyle, /"pointer-events:none"/);
});

test("显式暂停只控制当前媒体，并且不会被自动续播恢复", async () => {
  const runtime = loadContentScript([
    { paused: false, duration: 120, currentTime: 30, score: 100 },
    { paused: false, duration: 60, currentTime: 10, score: 10 }
  ]);

  const locked = runtime.api.handleCommand({ type: "ENABLE_AUTOPLAY" });
  assert.equal(locked.keepPlaying, true);
  assert.equal(locked.controlMode, "lock");
  assert.equal(runtime.intervals.size, 1);

  const paused = runtime.api.handleCommand({ type: "PAUSE" });
  assert.equal(paused.ok, true);
  assert.equal(runtime.media[0].pauseCalls, 1);
  assert.equal(runtime.media[1].pauseCalls, 0);
  runtime.runTimeouts();
  assert.equal(runtime.media[0].paused, true);
  assert.equal(runtime.media[0].playCalls, 0);
  assert.equal(paused.keepPlaying, true);
  assert.equal(paused.controlMode, "lock");

  runtime.media[0].score = -10;
  runtime.media[1].score = 1000;
  const played = await runtime.api.handleCommand({ type: "PLAY" });
  assert.equal(played.ok, true);
  assert.equal(runtime.media[0].playCalls, 1);
  assert.equal(runtime.media[1].playCalls, 0);

  runtime.media[0].pause();
  const playCallsBeforeStop = runtime.media[0].playCalls;
  const stopped = runtime.api.handleCommand({ type: "STOP_LOCK" });
  runtime.runTimeouts();
  assert.equal(stopped.keepPlaying, false);
  assert.equal(stopped.controlMode, "stopped");
  assert.equal(runtime.intervals.size, 0);
  assert.equal(runtime.media[0].playCalls, playCallsBeforeStop);
  const applied = runtime.api.handleCommand({ type: "SET_RATE", rate: 2 });
  assert.equal(applied.controlMode, "apply");
  assert.equal(runtime.intervals.size, 0);
});

test("video.read 仅返回媒体自身标题，不返回页面标题、URL 或正文", () => {
  const runtime = loadContentScript([
    { attributes: { title: "  课程视频  " }, duration: 120 },
    { attributes: { "aria-label": "音频讲解" }, tagName: "AUDIO", duration: 60 },
    { duration: 30 }
  ]);
  const result = runtime.api.handleCommand({ type: "GET_MEDIA_LIST" });
  assert.deepEqual(Array.from(result.media, (item) => item.title), ["课程视频", "音频讲解", ""]);
  for (const item of result.media) {
    assert.equal(Object.prototype.hasOwnProperty.call(item, "url"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(item, "text"), false);
    assert.notEqual(item.title, "页面私密标题");
  }
});

test("VideoService 对 video.read 媒体模型执行字段白名单过滤", () => {
  const service = loadVideoService();
  const result = service.aggregateFrameResults([{
    frameId: 0,
    result: {
      ok: true,
      rate: 1,
      volume: 0.8,
      muted: false,
      mediaCount: 1,
      applied: 0,
      media: [{
        id: "media-1",
        title: "媒体标题",
        duration: 100,
        currentTime: 25,
        url: "https://example.test/private-course",
        text: "页面私密正文",
        currentSrc: "https://cdn.example.test/private.mp4"
      }]
    }
  }], { type: "GET_MEDIA_LIST" });
  assert.equal(result.media[0].title, "媒体标题");
  assert.equal(Object.prototype.hasOwnProperty.call(result.media[0], "url"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.media[0], "text"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.media[0], "currentSrc"), false);
});

test("关闭自动续播不会关闭用户显式开启的速度锁定", () => {
  const runtime = loadContentScript([{ paused: true, duration: 120, currentTime: 0 }]);
  const locked = runtime.api.handleCommand({ type: "LOCK_STATE" });
  assert.equal(locked.controlMode, "lock");
  runtime.api.handleCommand({ type: "ENABLE_AUTOPLAY" });
  const disabled = runtime.api.handleCommand({ type: "DISABLE_AUTOPLAY" });
  assert.equal(disabled.controlMode, "lock");
  assert.equal(disabled.keepPlaying, false);
  const stopped = runtime.api.handleCommand({ type: "STOP_LOCK" });
  assert.equal(stopped.controlMode, "stopped");
});
