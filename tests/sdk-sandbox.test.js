const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const sdkPath = (file) => path.join(root, "sdk", file);

function loadProtocol() {
  const context = { self: {}, Object, Array, String, Number, TypeError };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(sdkPath("session-protocol.js"), "utf8"), context);
  return context.self.WinSpeedBallSdkSessionProtocol;
}

test("SDK 沙箱协议创建不可被负载覆盖的结构化信封", () => {
  const protocol = loadProtocol();
  const envelope = protocol.createEnvelope("session_12345678", "RUN", {
    channel: "spoofed",
    protocolVersion: 999,
    sessionId: "another_session",
    type: "READY",
    runId: "run-1"
  });
  assert.deepEqual(JSON.parse(JSON.stringify(envelope)), {
    runId: "run-1",
    channel: "WSB_SDK_SANDBOX",
    protocolVersion: 1,
    sessionId: "session_12345678",
    type: "RUN"
  });
});

test("SDK 沙箱协议拒绝错误版本、串会话和非预期消息类型", () => {
  const protocol = loadProtocol();
  const base = protocol.createEnvelope("session_12345678", "RUN", { runId: "run-1" });
  assert.equal(protocol.validateEnvelope(base, {
    sessionId: "session_12345678",
    allowedTypes: ["RUN"]
  }).ok, true);
  assert.equal(protocol.validateEnvelope(Object.assign({}, base, { protocolVersion: 2 })).code, "SDK_SESSION_PROTOCOL_MISMATCH");
  assert.equal(protocol.validateEnvelope(base, { sessionId: "session_87654321" }).code, "SDK_SESSION_MISMATCH");
  assert.equal(protocol.validateEnvelope(base, { allowedTypes: ["TERMINATE"] }).code, "SDK_SESSION_UNEXPECTED_TYPE");
});

test("SDK 沙箱协议只允许受控心跳消息", () => {
  const protocol = loadProtocol();
  const ping = protocol.createEnvelope("session_12345678", "HEARTBEAT_PING", {
    runId: "run-1",
    heartbeatSequence: 1
  });
  assert.equal(protocol.validateEnvelope(ping, {
    sessionId: "session_12345678",
    allowedTypes: ["HEARTBEAT_PING"]
  }).ok, true);
  assert.equal(protocol.validateEnvelope(Object.assign({}, ping, {
    type: "HEARTBEAT_PONG"
  }), {
    sessionId: "session_12345678",
    allowedTypes: ["HEARTBEAT_PING"]
  }).code, "SDK_SESSION_UNEXPECTED_TYPE");
});

test("SDK 沙箱默认允许长期运行，并兼容显式的故障保护超时", () => {
  const protocol = loadProtocol();
  assert.equal(protocol.normalizeTimeout(undefined), 0);
  assert.equal(protocol.normalizeTimeout(0), 0);
  assert.equal(protocol.normalizeTimeout(1), 100);
  assert.equal(protocol.normalizeTimeout(60000), 30000);
  assert.equal(protocol.normalizeTimeout(1500.4), 1500);
});

test("沙箱页面仅加载本地可信脚本并禁止网络连接", () => {
  const html = fs.readFileSync(sdkPath("script-runner.html"), "utf8");
  assert.match(html, /default-src 'none'/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /font-src 'none'/);
  assert.match(html, /worker-src blob:/);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.match(manifest.content_security_policy.sandbox, /font-src 'none'/);
  assert.deepEqual(Array.from(html.matchAll(/<script\s+src="([^"]+)"/g), (match) => match[1]), [
    "session-protocol.js",
    "script-worker.js",
    "script-runner.js"
  ]);
  assert.equal(/https?:\/\//i.test(html), false);
  assert.equal(/<(?:iframe|object|embed|form)\b/i.test(html), false);
});

test("iframe 只接受父页面首次传入的唯一 MessagePort", () => {
  const source = fs.readFileSync(sdkPath("script-runner.js"), "utf8");
  assert.match(source, /event\.source\s*!==\s*parent/);
  assert.match(source, /event\.ports\.length\s*!==\s*1/);
  assert.match(source, /initialized\s*=\s*true/);
  assert.match(source, /removeEventListener\("message",\s*handleInitialMessage\)/);
  assert.match(source, /controlPort\.start\(\)/);
});

test("runner 为每次运行创建独立 Worker，默认长期运行并支持主动终止", () => {
  const source = fs.readFileSync(sdkPath("script-runner.js"), "utf8");
  assert.match(source, /WinSpeedBallSdkWorkerFactory\.createObjectUrl\(\)/);
  assert.match(source, /new Worker\(workerUrl/);
  assert.match(source, /revokeObjectUrl\(workerUrl\)/);
  assert.match(source, /activeRun\.worker\.terminate\(\)/);
  assert.match(source, /if \(timeoutMs > 0\)/);
  assert.match(source, /SDK_EXECUTION_TIMEOUT/);
  assert.match(source, /allowedTypes:\s*\["RUN",\s*"RPC_RESULT",\s*"EVENT",\s*"TERMINATE"\]/);
  assert.match(source, /MAX_RESULT_BYTES\s*=\s*65536/);
  assert.match(source, /SDK_RESULT_TOO_LARGE/);
  assert.match(source, /SDK_RESULT_NOT_SERIALIZABLE/);
  assert.match(source, /worker\.postMessage\(protocol\.createEnvelope\(sessionId,\s*"WORKER_INIT",[\s\S]*?bookMode:\s*activeRun\.bookMode/);
  assert.match(source, /HEARTBEAT_INTERVAL_MS\s*=\s*1000/);
  assert.match(source, /HEARTBEAT_MAX_MISSED\s*=\s*5/);
  assert.match(source, /"HEARTBEAT_PING"/);
  assert.match(source, /"HEARTBEAT_PONG"/);
  assert.match(source, /SDK_WORKER_UNRESPONSIVE/);
  assert.match(source, /MAX_PENDING_RPC\s*=\s*64/);
  assert.match(source, /MAX_RPC_REQUESTS_PER_SECOND\s*=\s*120/);
  assert.match(source, /SDK_RPC_CONCURRENCY_LIMIT/);
  assert.match(source, /SDK_RPC_RATE_LIMIT/);
});

test("Worker 构造冻结 WSB，并屏蔽常见浏览器与扩展全局绑定", () => {
  const source = fs.readFileSync(sdkPath("script-worker.js"), "utf8");
  assert.match(source, /return Object\.freeze\(\{[\s\S]*video:[\s\S]*ocr:[\s\S]*qa:[\s\S]*ai:[\s\S]*page:[\s\S]*book:[\s\S]*event:[\s\S]*storage:/);
  assert.match(source, /qa:\s*Object\.freeze\(\["latest",\s*"ocr",\s*"voice"\]\)/);
  assert.match(source, /qa:\s*createMethodGroup\("qa",\s*METHODS\.qa\)/);
  assert.match(source, /video:\s*Object\.freeze\(\[[^\]]*"auto",\s*"lock",\s*"reset"[^\]]*\]\)/);
  assert.match(source, /book:\s*Object\.freeze\(\["status",\s*"prev",\s*"next",\s*"start",\s*"stop",\s*"interval",[\s\S]*?"setInterval"\]\)/);
  assert.match(source, /book:\s*createMethodGroup\("book",\s*METHODS\.book\)/);
  assert.match(source, /"video\.status":\s*"video\.getStatus"/);
  assert.match(source, /"video\.auto":\s*"video\.setAutoplay"/);
  assert.match(source, /"video\.lock":\s*"video\.setRateLock"/);
  assert.match(source, /"book\.status":\s*"book\.getStatus"/);
  assert.match(source, /"book\.prev":\s*"book\.turnPrev"/);
  assert.match(source, /"book\.next":\s*"book\.turnNext"/);
  assert.match(source, /"book\.start":\s*"book\.startAuto"/);
  assert.match(source, /"book\.stop":\s*"book\.stopAuto"/);
  assert.match(source, /"book\.interval":\s*"book\.setInterval"/);
  assert.match(source, /METHOD_ALIASES\[publicMethod\]\s*\|\|\s*publicMethod/);
  assert.match(source, /publicMethod === "ai\.history" && !args\.length/);
  assert.match(source, /publicMethod === "video\.mute" && \(!args\.length \|\| args\[0\] == null\)/);
  assert.match(source, /\["video\.auto",\s*"video\.autoplay",\s*"video\.setAutoplay",\s*"video\.lock",\s*"video\.rateLock",\s*"video\.setRateLock"\][\s\S]*?args = \[true\]/);
  assert.match(source, /\["book\.prev",\s*"book\.next",\s*"book\.turnPrev",\s*"book\.turnNext"\][\s\S]*?args = \[bookMode\]/);
  assert.match(source, /\["book\.start",\s*"book\.startAuto"\][\s\S]*?args = \[\{ mode: bookMode, intervalSeconds: bookMode === "chaoxing" \? 2 : 30 \}\]/);
  assert.match(source, /startOptions\.mode === "chaoxing" \? 2 : 30/);
  assert.match(source, /\["book\.interval",\s*"book\.setInterval"\][\s\S]*?args\.push\(bookMode\)/);
  assert.match(source, /bookMode = \["book",\s*"image",\s*"chaoxing"\]\.indexOf\(message\.bookMode\) >= 0 \? message\.bookMode : "book"/);
  for (const binding of [
    "chrome", "browser", "globalThis", "fetch", "fetchLater", "XMLHttpRequest",
    "WebSocket", "WebSocketStream", "WebTransport", "Worker", "SharedWorker",
    "Notification", "importScripts", "indexedDB", "caches", "cookieStore",
    "navigator", "FontFace", "FontFaceSet", "fonts"
  ]) {
    assert.match(source, new RegExp(`"${binding}"`));
  }
  assert.match(source, /executable\.apply\(undefined,\s*values\)/);
  assert.match(source, /lockDownGlobal\(\)/);
  assert.match(source, /nativePostMessage/);
  assert.match(source, /nativeAddEventListener\("message"/);
  for (const binding of [
    "WebTransport", "WebSocketStream", "Notification", "RTCPeerConnection",
    "BroadcastChannel", "MessageChannel", "postMessage"
  ]) {
    assert.match(source, new RegExp(`"${binding}"`));
  }
  assert.match(source, /self\.navigator[\s\S]*suppressProperty\(self\.navigator,\s*"sendBeacon"\)/);
  assert.match(source, /MAX_PENDING_RPC\s*=\s*64/);
  assert.match(source, /MAX_RPC_REQUESTS_PER_SECOND\s*=\s*120/);
  assert.match(source, /stopForRpcLimit/);
  assert.match(source, /allowedTypes:\s*\["HEARTBEAT_PING",\s*"RPC_RESULT",\s*"EVENT",\s*"TERMINATE"\]/);
  assert.match(source, /send\("HEARTBEAT_PONG"/);
});

test("SDK 沙箱代码不直接访问扩展 API、内部 Service 或远程代码", () => {
  const files = ["session-protocol.js", "script-runner.js", "script-worker.js"];
  const source = files.map((file) => fs.readFileSync(sdkPath(file), "utf8")).join("\n");
  assert.equal(/\bchrome\s*\./.test(source), false);
  assert.equal(/WinSpeedBall(?:User|Ai|Video|Ocr|Storage|Permission|Script)Service/.test(source), false);
  assert.equal(/https?:\/\//i.test(source), false);
  assert.equal(/\bfetch\s*\(/.test(source), false);
});
