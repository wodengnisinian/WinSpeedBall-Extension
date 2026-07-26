(function (global) {
  "use strict";

  function workerMain(protocol) {
  "use strict";
  var nativePostMessage = self.postMessage.bind(self);
  var nativeClose = self.close.bind(self);
  var nativeAddEventListener = self.addEventListener.bind(self);
  var NativePromise = Promise;
  var nativeNow = Date.now.bind(Date);
  var nativeReflectApply = Reflect.apply;
  var nativeMapGet = Map.prototype.get;
  var nativeMapSet = Map.prototype.set;
  var nativeMapDelete = Map.prototype.delete;
  var nativeMapForEach = Map.prototype.forEach;
  var nativeMapClear = Map.prototype.clear;
  var AsyncFunctionConstructor = Object.getPrototypeOf(async function () {}).constructor;
  var MAX_PENDING_RPC = 64;
  var MAX_RPC_REQUESTS_PER_SECOND = 120;
  var initialized = false;
  var sessionId = "";
  var runId = "";
  var scriptId = "";
  var bookMode = "book";
  var requestSequence = 0;
  var pendingRequests = new Map();
  var pendingRequestCount = 0;
  var rpcTokens = MAX_RPC_REQUESTS_PER_SECOND;
  var rpcBudgetAt = nativeNow();
  var safetyStopped = false;
  var eventHandlers = new Map();
  var METHODS = Object.freeze({
    video: Object.freeze(["all", "current", "status", "rate", "volume", "mute", "play", "pause", "auto", "lock", "reset", "autoplay", "rateLock", "getAll", "getStatus", "setRate", "setVolume", "setAutoplay", "setRateLock"]),
    ocr: Object.freeze(["latest", "capture", "recognize"]),
    qa: Object.freeze(["latest", "ocr", "voice"]),
    ai: Object.freeze(["latest", "history", "ask", "summary", "translate"]),
    page: Object.freeze(["info", "text", "title", "url"]),
    book: Object.freeze(["status", "prev", "next", "start", "stop", "interval", "getStatus", "turnPrev", "turnNext", "startAuto", "stopAuto", "setInterval"]),
    storage: Object.freeze(["get", "set"])
  });
  var METHOD_ALIASES = Object.freeze({
    "video.all": "video.getAll",
    "video.status": "video.getStatus",
    "video.rate": "video.setRate",
    "video.volume": "video.setVolume",
    "video.auto": "video.setAutoplay",
    "video.autoplay": "video.setAutoplay",
    "video.setAutoplay": "video.setAutoplay",
    "video.lock": "video.setRateLock",
    "video.rateLock": "video.setRateLock",
    "video.setRateLock": "video.setRateLock",
    "book.status": "book.getStatus",
    "book.prev": "book.turnPrev",
    "book.next": "book.turnNext",
    "book.start": "book.startAuto",
    "book.stop": "book.stopAuto",
    "book.interval": "book.setInterval",
    "book.turnPrev": "book.turnPrev",
    "book.turnNext": "book.turnNext",
    "book.startAuto": "book.startAuto",
    "book.stopAuto": "book.stopAuto",
    "book.setInterval": "book.setInterval"
  });
  var EVENTS = Object.freeze([
    "video.play", "video.pause", "video.finish", "ocr.complete", "ai.complete", "page.change"
  ]);
  var BLOCKED_BINDINGS = Object.freeze([
    "chrome", "browser", "self", "globalThis", "window", "document", "parent", "top", "opener",
    "fetch", "fetchLater", "XMLHttpRequest", "WebSocket", "WebSocketStream", "EventSource",
    "WebTransport", "Worker", "SharedWorker", "importScripts", "Notification",
    "indexedDB", "caches", "cookieStore", "CookieStore", "navigator", "location",
    "postMessage", "close", "Function", "FontFace", "FontFaceSet", "fonts"
  ]);
  var BLOCKED_GLOBALS = Object.freeze([
    "fetch", "fetchLater", "XMLHttpRequest", "WebSocket", "WebSocketStream", "EventSource", "WebTransport",
    "RTCPeerConnection", "webkitRTCPeerConnection", "Worker", "SharedWorker",
    "BroadcastChannel", "MessageChannel", "importScripts", "Notification",
    "indexedDB", "caches", "cookieStore", "CookieStore", "navigator",
    "postMessage", "close", "onmessage", "Function", "eval", "FontFace", "FontFaceSet", "fonts"
  ]);

  function suppressProperty(root, name) {
    var current = root;
    while (current) {
      if (Object.prototype.hasOwnProperty.call(current, name)) {
        try {
          Object.defineProperty(current, name, {
            value: undefined,
            writable: false,
            enumerable: false,
            configurable: false
          });
        } catch (error) {
          try { current[name] = undefined; } catch (ignored) {}
        }
      }
      current = Object.getPrototypeOf(current);
    }
    if (!Object.prototype.hasOwnProperty.call(root, name)) {
      try {
        Object.defineProperty(root, name, {
          value: undefined,
          writable: false,
          enumerable: false,
          configurable: false
        });
      } catch (error) {}
    }
  }

  function lockDownGlobal() {
    try { if (self.navigator) suppressProperty(self.navigator, "sendBeacon"); } catch (error) {}
    BLOCKED_GLOBALS.forEach(function (name) { suppressProperty(self, name); });
  }

  function send(type, payload) {
    nativePostMessage(protocol.createEnvelope(sessionId, type, payload));
  }

  function nextRequestId() {
    requestSequence += 1;
    return "req_" + requestSequence + "_" + Date.now();
  }

  function pendingGet(requestId) {
    return nativeReflectApply(nativeMapGet, pendingRequests, [requestId]);
  }

  function pendingSet(requestId, value) {
    nativeReflectApply(nativeMapSet, pendingRequests, [requestId, value]);
  }

  function pendingDelete(requestId) {
    return nativeReflectApply(nativeMapDelete, pendingRequests, [requestId]);
  }

  function rejectedRpc(code, message) {
    var error = new Error(message);
    error.code = code;
    return new NativePromise(function (resolve, reject) { reject(error); });
  }

  function consumeRpcBudget() {
    var now = nativeNow();
    var elapsed = Math.max(0, now - rpcBudgetAt);
    rpcBudgetAt = now;
    rpcTokens = Math.min(
      MAX_RPC_REQUESTS_PER_SECOND,
      rpcTokens + elapsed * MAX_RPC_REQUESTS_PER_SECOND / 1000
    );
    if (rpcTokens < 1) return false;
    rpcTokens -= 1;
    return true;
  }

  function stopForRpcLimit(code, message) {
    if (!safetyStopped) {
      safetyStopped = true;
      rejectPending(code, message);
      try {
        send("ERROR", {
          runId: runId,
          error: { code: code, message: message }
        });
      } catch (error) {}
      nativeClose();
    }
    return rejectedRpc(code, message);
  }

  function invoke(method, args) {
    if (safetyStopped) return rejectedRpc("SDK_RUN_TERMINATED", "The SDK run was terminated by its safety guard.");
    if (pendingRequestCount >= MAX_PENDING_RPC) {
      return stopForRpcLimit("SDK_RPC_CONCURRENCY_LIMIT", "The SDK run exceeded the pending RPC concurrency limit.");
    }
    if (!consumeRpcBudget()) {
      return stopForRpcLimit("SDK_RPC_RATE_LIMIT", "The SDK run exceeded the RPC request rate limit.");
    }
    var requestId = nextRequestId();
    return new NativePromise(function (resolve, reject) {
      pendingSet(requestId, { resolve: resolve, reject: reject });
      pendingRequestCount += 1;
      try {
        send("SDK_REQUEST", {
          runId: runId,
          request: {
            channel: "WSB_SDK",
            protocolVersion: 1,
            scriptId: scriptId,
            requestId: requestId,
            method: method,
            args: Array.isArray(args) ? args : []
          }
        });
      } catch (error) {
        if (pendingDelete(requestId)) pendingRequestCount = Math.max(0, pendingRequestCount - 1);
        reject(Object.assign(new Error("SDK request could not be sent."), { code: "SDK_REQUEST_CLONE_FAILED" }));
      }
    });
  }

  function createMethodGroup(namespace, names) {
    var group = {};
    names.forEach(function (name) {
      group[name] = function () {
        var publicMethod = namespace + "." + name;
        var args = Array.prototype.slice.call(arguments);
        if (publicMethod === "video.mute" && (!args.length || args[0] == null)) args = [true];
        if (["video.auto", "video.autoplay", "video.setAutoplay", "video.lock", "video.rateLock", "video.setRateLock"].indexOf(publicMethod) >= 0 && (!args.length || args[0] == null)) args = [true];
        if (["book.status", "book.getStatus"].indexOf(publicMethod) >= 0) {
          if (args.length && (args[0] == null || args[0] === "")) args = [];
          else if (typeof args[0] === "string") args[0] = args[0].trim().toLowerCase();
        }
        if (["book.prev", "book.next", "book.turnPrev", "book.turnNext"].indexOf(publicMethod) >= 0) {
          if (!args.length || args[0] == null || args[0] === "") args = [bookMode];
          else if (typeof args[0] === "string") args[0] = args[0].trim().toLowerCase();
        }
        if (["book.start", "book.startAuto"].indexOf(publicMethod) >= 0) {
          if (!args.length || args[0] == null) args = [{ mode: bookMode, intervalSeconds: bookMode === "chaoxing" ? 2 : 30 }];
          else if (typeof args[0] === "object" && !Array.isArray(args[0])) {
            var startOptions = Object.assign({}, args[0]);
            startOptions.mode = startOptions.mode == null || startOptions.mode === "" ? bookMode : String(startOptions.mode).trim().toLowerCase();
            if (startOptions.intervalSeconds == null) startOptions.intervalSeconds = startOptions.mode === "chaoxing" ? 2 : 30;
            args = [startOptions];
          }
        }
        if (["book.interval", "book.setInterval"].indexOf(publicMethod) >= 0) {
          if (args.length === 1) args.push(bookMode);
          else if (args.length > 1 && (args[1] == null || args[1] === "")) args[1] = bookMode;
          else if (typeof args[1] === "string") args[1] = args[1].trim().toLowerCase();
        }
        if (publicMethod === "ai.history" && !args.length) args = [10];
        return invoke(METHOD_ALIASES[publicMethod] || publicMethod, args);
      };
    });
    return Object.freeze(group);
  }

  function createEventApi() {
    return Object.freeze({
      on: function (eventName, callback) {
        if (EVENTS.indexOf(eventName) < 0 || typeof callback !== "function") {
          var error = new TypeError("Unsupported SDK event subscription.");
          error.code = "SDK_INVALID_ARGUMENT";
          throw error;
        }
        var handlers = eventHandlers.get(eventName);
        if (!handlers) {
          handlers = new Set();
          eventHandlers.set(eventName, handlers);
          invoke("event.on", [eventName]).catch(function () {
            eventHandlers.delete(eventName);
          });
        }
        handlers.add(callback);
        var active = true;
        return function () {
          if (!active) return;
          active = false;
          handlers.delete(callback);
          if (!handlers.size) eventHandlers.delete(eventName);
        };
      }
    });
  }

  function createWsb() {
    return Object.freeze({
      version: "3.7.0-beta",
      video: createMethodGroup("video", METHODS.video),
      ocr: createMethodGroup("ocr", METHODS.ocr),
      qa: createMethodGroup("qa", METHODS.qa),
      ai: createMethodGroup("ai", METHODS.ai),
      page: createMethodGroup("page", METHODS.page),
      book: createMethodGroup("book", METHODS.book),
      event: createEventApi(),
      storage: createMethodGroup("storage", METHODS.storage)
    });
  }

  function resolveRpc(message) {
    if (!protocol.validIdentifier(message.requestId, 96) || typeof message.ok !== "boolean") return;
    var pending = pendingGet(message.requestId);
    if (!pending) return;
    if (pendingDelete(message.requestId)) pendingRequestCount = Math.max(0, pendingRequestCount - 1);
    if (message.ok) {
      pending.resolve(message.value);
      return;
    }
    var details = protocol.serializeError(message.error, "SDK_RPC_FAILED");
    var error = new Error(details.message);
    error.code = details.code;
    pending.reject(error);
  }

  function dispatchEvent(message) {
    if (EVENTS.indexOf(message.eventName) < 0) return;
    var handlers = eventHandlers.get(message.eventName);
    if (!handlers) return;
    Array.from(handlers).forEach(function (handler) {
      try { handler(message.payload); } catch (error) { /* Isolate user callbacks. */ }
    });
  }

  function rejectPending(code, message) {
    nativeReflectApply(nativeMapForEach, pendingRequests, [function (pending) {
      var error = new Error(message);
      error.code = code;
      pending.reject(error);
    }]);
    nativeReflectApply(nativeMapClear, pendingRequests, []);
    pendingRequestCount = 0;
  }

  function execute(code) {
    var wsb = createWsb();
    var parameters = ["WSB"].concat(BLOCKED_BINDINGS);
    var body = "\"use strict\";\n" + code + "\n//# sourceURL=wsb-sdk-" + scriptId + ".js";
    var executable;
    try {
      executable = AsyncFunctionConstructor.apply(null, parameters.concat(body));
    } catch (error) {
      send("ERROR", { runId: runId, error: protocol.serializeError(error, "SDK_SCRIPT_SYNTAX_ERROR") });
      nativeClose();
      return;
    }
    var values = [wsb].concat(BLOCKED_BINDINGS.map(function () { return undefined; }));
    Promise.resolve(executable.apply(undefined, values)).then(function (value) {
      try {
        send("RESULT", { runId: runId, value: value });
      } catch (error) {
        send("ERROR", {
          runId: runId,
          error: protocol.serializeError(error, "SDK_RESULT_CLONE_FAILED")
        });
      }
      nativeClose();
    }, function (error) {
      send("ERROR", { runId: runId, error: protocol.serializeError(error, "SDK_SCRIPT_RUNTIME_ERROR") });
      nativeClose();
    });
  }

  nativeAddEventListener("message", function (event) {
    var message = event.data;
    if (!initialized) {
      var initialValidation = protocol.validateEnvelope(message, { allowedTypes: ["WORKER_INIT"] });
      if (!initialValidation.ok || !protocol.validIdentifier(message.runId, 96) ||
          !protocol.validIdentifier(message.scriptId, 64) || typeof message.code !== "string") {
        nativeClose();
        return;
      }
      initialized = true;
      sessionId = message.sessionId;
      runId = message.runId;
      scriptId = message.scriptId;
      bookMode = ["book", "image", "chaoxing"].indexOf(message.bookMode) >= 0 ? message.bookMode : "book";
      lockDownGlobal();
      send("STARTED", { runId: runId, scriptId: scriptId });
      execute(message.code);
      return;
    }

    var validation = protocol.validateEnvelope(message, {
      sessionId: sessionId,
      allowedTypes: ["HEARTBEAT_PING", "RPC_RESULT", "EVENT", "TERMINATE"]
    });
    if (!validation.ok || message.runId !== runId) return;
    if (message.type === "HEARTBEAT_PING") {
      if (!Number.isInteger(message.heartbeatSequence) || message.heartbeatSequence < 1) {
        nativeClose();
        return;
      }
      send("HEARTBEAT_PONG", {
        runId: runId,
        heartbeatSequence: message.heartbeatSequence
      });
    } else if (message.type === "RPC_RESULT") resolveRpc(message);
    else if (message.type === "EVENT") dispatchEvent(message);
    else {
      rejectPending("SDK_RUN_TERMINATED", "SDK run was terminated by the host.");
      nativeClose();
    }
  });
  }

  function createObjectUrl() {
    var protocolFactory = global.WinSpeedBallSdkSessionProtocolFactory;
    if (typeof protocolFactory !== "function" || typeof Blob !== "function" || !global.URL || typeof global.URL.createObjectURL !== "function") {
      throw new Error("SDK Worker factory is unavailable.");
    }
    var source = "(" + workerMain.toString() + ")((" + protocolFactory.toString() + ")());";
    return global.URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  }

  global.WinSpeedBallSdkWorkerFactory = Object.freeze({
    createObjectUrl: createObjectUrl,
    revokeObjectUrl: function (url) { try { global.URL.revokeObjectURL(url); } catch (error) {} }
  });
})(self);
