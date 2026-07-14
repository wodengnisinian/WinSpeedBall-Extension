(function (global) {
  "use strict";

  function workerMain(protocol) {
  "use strict";
  var nativePostMessage = self.postMessage.bind(self);
  var nativeClose = self.close.bind(self);
  var nativeAddEventListener = self.addEventListener.bind(self);
  var AsyncFunctionConstructor = Object.getPrototypeOf(async function () {}).constructor;
  var initialized = false;
  var sessionId = "";
  var runId = "";
  var scriptId = "";
  var requestSequence = 0;
  var pendingRequests = new Map();
  var eventHandlers = new Map();
  var METHODS = Object.freeze({
    video: Object.freeze(["getAll", "current", "getStatus", "setRate", "setVolume", "mute", "play", "pause"]),
    ocr: Object.freeze(["latest", "capture", "recognize"]),
    ai: Object.freeze(["ask", "summary", "translate"]),
    page: Object.freeze(["info", "text", "title", "url"]),
    storage: Object.freeze(["get", "set"])
  });
  var EVENTS = Object.freeze([
    "video.play", "video.pause", "video.finish", "ocr.complete", "ai.complete", "page.change"
  ]);
  var BLOCKED_BINDINGS = Object.freeze([
    "chrome", "browser", "self", "globalThis", "window", "document", "parent", "top", "opener",
    "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "Worker", "SharedWorker", "importScripts",
    "indexedDB", "caches", "navigator", "location", "postMessage", "close", "Function"
  ]);
  var BLOCKED_GLOBALS = Object.freeze([
    "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "WebTransport",
    "RTCPeerConnection", "webkitRTCPeerConnection", "Worker", "SharedWorker",
    "BroadcastChannel", "MessageChannel", "importScripts", "indexedDB", "caches",
    "postMessage", "close", "onmessage", "Function", "eval"
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

  function invoke(method, args) {
    var requestId = nextRequestId();
    return new Promise(function (resolve, reject) {
      pendingRequests.set(requestId, { resolve: resolve, reject: reject });
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
        pendingRequests.delete(requestId);
        reject(Object.assign(new Error("SDK request could not be sent."), { code: "SDK_REQUEST_CLONE_FAILED" }));
      }
    });
  }

  function createMethodGroup(namespace, names) {
    var group = {};
    names.forEach(function (name) {
      group[name] = function () {
        return invoke(namespace + "." + name, Array.prototype.slice.call(arguments));
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
      version: "0.1.0-beta",
      video: createMethodGroup("video", METHODS.video),
      ocr: createMethodGroup("ocr", METHODS.ocr),
      ai: createMethodGroup("ai", METHODS.ai),
      page: createMethodGroup("page", METHODS.page),
      event: createEventApi(),
      storage: createMethodGroup("storage", METHODS.storage)
    });
  }

  function resolveRpc(message) {
    if (!protocol.validIdentifier(message.requestId, 96) || typeof message.ok !== "boolean") return;
    var pending = pendingRequests.get(message.requestId);
    if (!pending) return;
    pendingRequests.delete(message.requestId);
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
    pendingRequests.forEach(function (pending) {
      var error = new Error(message);
      error.code = code;
      pending.reject(error);
    });
    pendingRequests.clear();
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
      lockDownGlobal();
      send("STARTED", { runId: runId, scriptId: scriptId });
      execute(message.code);
      return;
    }

    var validation = protocol.validateEnvelope(message, {
      sessionId: sessionId,
      allowedTypes: ["RPC_RESULT", "EVENT", "TERMINATE"]
    });
    if (!validation.ok || message.runId !== runId) return;
    if (message.type === "RPC_RESULT") resolveRpc(message);
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
