(function () {
  "use strict";

  var protocol = self.WinSpeedBallSdkSessionProtocol;
  var MAX_CODE_BYTES = 262144;
  var MAX_RESULT_BYTES = 65536;
  var initialized = false;
  var sessionId = "";
  var controlPort = null;
  var activeRun = null;

  function sendToHost(type, payload) {
    if (!controlPort || !sessionId) return false;
    try {
      controlPort.postMessage(protocol.createEnvelope(sessionId, type, payload));
      return true;
    } catch (error) {
      terminateActive("port-error", protocol.serializeError(error, "SDK_SANDBOX_PORT_ERROR"), false);
      return false;
    }
  }

  function codeByteLength(code) {
    if (typeof TextEncoder === "function") return new TextEncoder().encode(code).byteLength;
    return code.length * 2;
  }

  function resultByteLength(value) {
    var serialized;
    try { serialized = JSON.stringify(value); }
    catch (error) { return -1; }
    if (serialized === undefined) return -1;
    return codeByteLength(serialized);
  }

  function validRunPayload(message) {
    return protocol.validIdentifier(message.runId, 96) &&
      protocol.validIdentifier(message.scriptId, 64) &&
      typeof message.code === "string" &&
      codeByteLength(message.code) <= MAX_CODE_BYTES;
  }

  function clearActiveRun() {
    if (!activeRun) return;
    if (activeRun.timer) clearTimeout(activeRun.timer);
    if (activeRun.worker) activeRun.worker.terminate();
    activeRun = null;
  }

  function terminateActive(reason, error, notifyHost) {
    if (!activeRun) return false;
    var runId = activeRun.runId;
    clearActiveRun();
    if (notifyHost !== false) {
      sendToHost("TERMINATED", {
        runId: runId,
        reason: String(reason || "terminated").slice(0, 64),
        error: error || null
      });
    }
    return true;
  }

  function validSdkRequest(message) {
    var request = message && message.request;
    if (!protocol.isRecord(request) || !activeRun) return false;
    if (request.channel !== "WSB_SDK" || request.protocolVersion !== 1) return false;
    if (request.scriptId !== activeRun.scriptId || !protocol.validIdentifier(request.requestId, 96)) return false;
    if (typeof request.method !== "string" || request.method.length < 1 || request.method.length > 64) return false;
    if (!Array.isArray(request.args) || request.args.length > 16) return false;
    try {
      return JSON.stringify(request.args).length <= 65536;
    } catch (error) {
      return false;
    }
  }

  function handleWorkerMessage(event) {
    if (!activeRun) return;
    var message = event.data;
    var validation = protocol.validateEnvelope(message, {
      sessionId: sessionId,
      allowedTypes: ["STARTED", "SDK_REQUEST", "RESULT", "ERROR"]
    });
    if (!validation.ok || message.runId !== activeRun.runId) {
      terminateActive("worker-protocol-error", {
        code: validation.code || "SDK_WORKER_RUN_MISMATCH",
        message: validation.error || "Worker message belongs to another run."
      });
      return;
    }
    if (message.type === "SDK_REQUEST") {
      if (!validSdkRequest(message)) {
        terminateActive("worker-protocol-error", {
          code: "SDK_WORKER_INVALID_REQUEST",
          message: "Worker produced an invalid SDK request."
        });
        return;
      }
      sendToHost("SDK_REQUEST", { runId: activeRun.runId, request: message.request });
      return;
    }
    if (message.type === "STARTED") {
      sendToHost("STARTED", { runId: activeRun.runId, scriptId: activeRun.scriptId });
      return;
    }
    var completedRunId = activeRun.runId;
    if (message.type === "RESULT") {
      var resultBytes = resultByteLength(message.value);
      if (resultBytes < 0 || resultBytes > MAX_RESULT_BYTES) {
        sendToHost("ERROR", {
          runId: completedRunId,
          error: {
            code: resultBytes < 0 ? "SDK_RESULT_NOT_SERIALIZABLE" : "SDK_RESULT_TOO_LARGE",
            message: resultBytes < 0 ? "SDK script result must be serializable." : "SDK script result exceeds 64 KB."
          }
        });
      } else {
        sendToHost("RESULT", { runId: completedRunId, value: message.value });
      }
    } else {
      sendToHost("ERROR", {
        runId: completedRunId,
        error: protocol.serializeError(message.error, "SDK_SCRIPT_RUNTIME_ERROR")
      });
    }
    clearActiveRun();
  }

  function startRun(message) {
    if (activeRun) {
      sendToHost("ERROR", {
        runId: message.runId || "",
        error: { code: "SDK_SANDBOX_BUSY", message: "Another SDK script is already running." }
      });
      return;
    }
    if (!validRunPayload(message)) {
      sendToHost("ERROR", {
        runId: typeof message.runId === "string" ? message.runId : "",
        error: { code: "SDK_SANDBOX_INVALID_RUN", message: "SDK run parameters are invalid or too large." }
      });
      return;
    }

    var timeoutMs = protocol.normalizeTimeout(message.timeoutMs);
    var worker;
    var workerUrl = "";
    try {
      workerUrl = self.WinSpeedBallSdkWorkerFactory.createObjectUrl();
      worker = new Worker(workerUrl, { name: "wsb-sdk-worker" });
      self.WinSpeedBallSdkWorkerFactory.revokeObjectUrl(workerUrl);
    } catch (error) {
      if (workerUrl) self.WinSpeedBallSdkWorkerFactory.revokeObjectUrl(workerUrl);
      sendToHost("ERROR", {
        runId: message.runId,
        error: protocol.serializeError(error, "SDK_WORKER_CREATE_FAILED")
      });
      return;
    }

    activeRun = {
      runId: message.runId,
      scriptId: message.scriptId,
      worker: worker,
      timer: null
    };
    worker.onmessage = handleWorkerMessage;
    worker.onmessageerror = function () {
      terminateActive("worker-message-error", {
        code: "SDK_WORKER_MESSAGE_ERROR",
        message: "Worker sent a message that could not be cloned."
      });
    };
    worker.onerror = function (event) {
      var error = {
        code: "SDK_SCRIPT_RUNTIME_ERROR",
        message: String(event && event.message || "SDK script worker failed.").slice(0, 1000)
      };
      sendToHost("ERROR", { runId: activeRun ? activeRun.runId : message.runId, error: error });
      clearActiveRun();
    };
    activeRun.timer = setTimeout(function () {
      terminateActive("timeout", {
        code: "SDK_EXECUTION_TIMEOUT",
        message: "SDK script exceeded the allowed execution time."
      });
    }, timeoutMs);
    worker.postMessage(protocol.createEnvelope(sessionId, "WORKER_INIT", {
      runId: message.runId,
      scriptId: message.scriptId,
      code: message.code
    }));
  }

  function forwardToWorker(message) {
    if (!activeRun || message.runId !== activeRun.runId) {
      sendToHost("ERROR", {
        runId: typeof message.runId === "string" ? message.runId : "",
        error: { code: "SDK_RUN_NOT_ACTIVE", message: "The target SDK run is not active." }
      });
      return;
    }
    activeRun.worker.postMessage(message);
  }

  function handleControlMessage(event) {
    var message = event.data;
    var validation = protocol.validateEnvelope(message, {
      sessionId: sessionId,
      allowedTypes: ["RUN", "RPC_RESULT", "EVENT", "TERMINATE"]
    });
    if (!validation.ok) {
      if (validation.code !== "SDK_SESSION_MISMATCH") {
        sendToHost("ERROR", { runId: "", error: { code: validation.code, message: validation.error } });
      }
      return;
    }
    if (message.type === "RUN") {
      startRun(message);
      return;
    }
    if (message.type === "TERMINATE") {
      if (!activeRun || message.runId !== activeRun.runId) {
        sendToHost("ERROR", {
          runId: typeof message.runId === "string" ? message.runId : "",
          error: { code: "SDK_RUN_NOT_ACTIVE", message: "The target SDK run is not active." }
        });
        return;
      }
      terminateActive("host-request");
      return;
    }
    forwardToWorker(message);
  }

  function handleInitialMessage(event) {
    if (initialized || event.source !== parent || !event.ports || event.ports.length !== 1) return;
    var validation = protocol.validateEnvelope(event.data, { allowedTypes: ["INIT"] });
    if (!validation.ok) return;

    initialized = true;
    sessionId = event.data.sessionId;
    controlPort = event.ports[0];
    self.removeEventListener("message", handleInitialMessage);
    controlPort.onmessage = handleControlMessage;
    controlPort.onmessageerror = function () {
      terminateActive("port-message-error", {
        code: "SDK_SANDBOX_PORT_MESSAGE_ERROR",
        message: "Sandbox control message could not be cloned."
      }, false);
      controlPort.close();
      controlPort = null;
    };
    controlPort.start();
    sendToHost("READY", { runnerVersion: 1 });
  }

  self.addEventListener("message", handleInitialMessage);
})();
