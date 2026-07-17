(function (global) {
  "use strict";

  var SYSTEM_PROMPT = "You are a study assistant. Help with understanding, summary, explanation, key point extraction, and translation only. Do not help with cheating, auto answering, or auto submitting forms.";
  var MAX_REQUEST_LENGTH = 512 * 1024;
  var MAX_RESPONSE_LENGTH = 2 * 1024 * 1024;
  var REQUEST_TIMEOUT_MS = 45000;

  var definitions = {
    deepseek: {
      id: "deepseek",
      label: "DeepSeek",
      protocol: "openai-chat",
      defaultBaseUrl: "https://api.deepseek.com",
      defaultModel: "deepseek-v4-flash",
      endpoint: "chat/completions",
      requiresApiKey: true
    },
    openai: {
      id: "openai",
      label: "OpenAI",
      protocol: "openai-chat",
      defaultBaseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5.4-mini",
      endpoint: "chat/completions",
      requiresApiKey: true
    },
    claude: {
      id: "claude",
      label: "Claude",
      protocol: "anthropic-messages",
      defaultBaseUrl: "https://api.anthropic.com/v1",
      defaultModel: "claude-sonnet-5",
      endpoint: "messages",
      requiresApiKey: true
    },
    local: {
      id: "local",
      label: "Local model",
      protocol: "openai-chat",
      defaultBaseUrl: "http://localhost:11434/v1",
      defaultModel: "gpt-oss:20b",
      endpoint: "chat/completions",
      requiresApiKey: false,
      loopbackOnly: true
    }
  };

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
  }

  function has(providerId) {
    return hasOwn(definitions, String(providerId || "").toLowerCase());
  }

  function getDefinition(providerId) {
    return definitions[String(providerId || "").toLowerCase()] || definitions.deepseek;
  }

  function normalizeProviderId(providerId) {
    return getDefinition(providerId).id;
  }

  function list() {
    return Object.keys(definitions).map(function (id) {
      var definition = definitions[id];
      return {
        id: definition.id,
        label: definition.label,
        defaultBaseUrl: definition.defaultBaseUrl,
        defaultModel: definition.defaultModel,
        requiresApiKey: definition.requiresApiKey
      };
    });
  }

  function normalizeBaseUrl(baseUrl, fallback) {
    return String(baseUrl || fallback || "").trim().replace(/\/+$/, "");
  }

  function isLoopback(hostname) {
    return ["localhost", "127.0.0.1", "[::1]"].indexOf(String(hostname || "").toLowerCase()) >= 0;
  }

  function validateBaseUrl(baseUrl, providerId) {
    try {
      var definition = providerId ? getDefinition(providerId) : null;
      var parsed = new URL(String(baseUrl || ""));
      if (parsed.username || parsed.password) return { ok: false, error: "Base URL must not contain credentials." };
      if (parsed.search || parsed.hash) return { ok: false, error: "Base URL must not contain a query string or fragment." };
      if (definition && definition.loopbackOnly) {
        if (!isLoopback(parsed.hostname)) return { ok: false, error: "Local model URL must use localhost, 127.0.0.1, or [::1]." };
        if (["http:", "https:"].indexOf(parsed.protocol) < 0) return { ok: false, error: "Local model URL must use HTTP or HTTPS." };
        return { ok: true, url: parsed };
      }
      if (parsed.protocol === "https:") return { ok: true, url: parsed };
      if (!definition && parsed.protocol === "http:" && isLoopback(parsed.hostname)) return { ok: true, url: parsed };
      return { ok: false, error: "Base URL must use HTTPS. HTTP is allowed only for a local model." };
    } catch (error) {
      return { ok: false, error: "Base URL is invalid." };
    }
  }

  function validateApiKey(apiKey, required) {
    var value = String(apiKey || "").trim();
    if (required && !value) return { ok: false, error: "API Key is required." };
    if (value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) return { ok: false, error: "API Key is invalid." };
    return { ok: true, value: value };
  }

  function validateModel(model) {
    var value = String(model || "").trim();
    if (!value || value.length > 128 || !/^[A-Za-z0-9._:/-]+$/.test(value)) return { ok: false, error: "Model is invalid." };
    return { ok: true, value: value };
  }

  function validateMessages(messages) {
    if (!Array.isArray(messages) || !messages.length || messages.length > 50) return { ok: false, error: "AI messages are invalid." };
    var totalLength = 0;
    var invalid = messages.some(function (message) {
      if (!message || typeof message !== "object" || ["system", "user", "assistant"].indexOf(message.role) < 0 || typeof message.content !== "string") return true;
      totalLength += message.content.length;
      return message.content.length > 50000;
    });
    if (invalid || totalLength > 100000) return { ok: false, error: "AI messages are invalid or too large." };
    return { ok: true };
  }

  function buildEndpoint(baseUrl, endpoint, providerId) {
    var validation = validateBaseUrl(baseUrl, providerId);
    if (!validation.ok) return validation;
    var parsed = validation.url;
    var normalizedEndpoint = String(endpoint || "").replace(/^\/+|\/+$/g, "");
    var escapedEndpoint = normalizedEndpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var path = parsed.pathname.replace(/\/+$/, "");
    if (!new RegExp("/" + escapedEndpoint + "$").test(path)) path += "/" + normalizedEndpoint;
    parsed.pathname = path.replace(/^\/?/, "/");
    return { ok: true, url: parsed.toString() };
  }

  function parseJson(text) {
    try { return JSON.parse(text); } catch (error) { return null; }
  }

  function headerValue(response, name) {
    return response && response.headers && typeof response.headers.get === "function" ? String(response.headers.get(name) || "") : "";
  }

  function readResponseText(response, limit) {
    var contentLength = Number(headerValue(response, "content-length"));
    if (Number.isFinite(contentLength) && contentLength > limit) {
      return Promise.resolve({ text: "", tooLarge: true });
    }

    var body = response && response.body;
    if (!body || typeof body.getReader !== "function" || typeof global.TextDecoder !== "function") {
      return Promise.resolve(response.text()).then(function (text) {
        text = String(text || "");
        return { text: text, tooLarge: text.length > limit };
      });
    }

    var reader = body.getReader();
    var decoder = new global.TextDecoder("utf-8");
    var chunks = [];
    var received = 0;

    function stopReading() {
      try {
        var cancellation = reader.cancel();
        if (cancellation && typeof cancellation.catch === "function") cancellation.catch(function () {});
      } catch (error) {}
      return { text: "", tooLarge: true };
    }

    function readNext() {
      return reader.read().then(function (result) {
        if (result.done) {
          chunks.push(decoder.decode());
          var text = chunks.join("");
          return text.length > limit ? { text: "", tooLarge: true } : { text: text, tooLarge: false };
        }
        var value = result.value;
        received += value && Number(value.byteLength || 0);
        if (received > limit) return stopReading();
        chunks.push(decoder.decode(value, { stream: true }));
        return readNext();
      });
    }

    return readNext();
  }

  function retryAfterMs(response) {
    var value = headerValue(response, "retry-after").trim();
    if (!value) return 0;
    if (/^\d+(\.\d+)?$/.test(value)) return Math.max(0, Math.round(Number(value) * 1000));
    var timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : 0;
  }

  function classifyStatus(status) {
    if (status === 400 || status === 422) return { code: "INVALID_REQUEST", retryable: false };
    if (status === 401) return { code: "AUTH_ERROR", retryable: false };
    if (status === 403) return { code: "PERMISSION_ERROR", retryable: false };
    if (status === 404) return { code: "ENDPOINT_OR_MODEL_NOT_FOUND", retryable: false };
    if (status === 408) return { code: "TIMEOUT", retryable: true };
    if (status === 413) return { code: "REQUEST_TOO_LARGE", retryable: false };
    if (status === 429) return { code: "RATE_LIMITED", retryable: true };
    if ([500, 502, 503, 504, 529].indexOf(status) >= 0) return { code: "PROVIDER_UNAVAILABLE", retryable: true };
    return { code: "HTTP_ERROR", retryable: status >= 500 };
  }

  function errorResult(provider, response, data, bodyText) {
    var status = Number(response && response.status || 0);
    var classification = classifyStatus(status);
    var message = data && data.error && data.error.message || data && data.message || String(bodyText || "HTTP " + status).slice(0, 500);
    return {
      ok: false,
      provider: provider.id,
      model: provider.model,
      status: status,
      code: classification.code,
      error: String(message || "Request failed.").slice(0, 500),
      retryable: classification.retryable,
      retryAfterMs: retryAfterMs(response),
      requestId: headerValue(response, provider.definition.protocol === "anthropic-messages" ? "request-id" : "x-request-id")
    };
  }

  function openAiContent(data) {
    var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.map(function (part) {
      if (typeof part === "string") return part;
      return part && (!part.type || part.type === "text") ? String(part.text || "") : "";
    }).filter(Boolean).join("\n");
  }

  function anthropicContent(data) {
    return (data && Array.isArray(data.content) ? data.content : []).map(function (part) {
      return part && part.type === "text" ? String(part.text || "") : "";
    }).filter(Boolean).join("\n");
  }

  function usageResult(data, protocol) {
    var usage = data && data.usage || {};
    var input = Number(protocol === "anthropic-messages" ? usage.input_tokens : usage.prompt_tokens) || 0;
    var output = Number(protocol === "anthropic-messages" ? usage.output_tokens : usage.completion_tokens) || 0;
    var total = Number(usage.total_tokens) || input + output;
    return { inputTokens: input, outputTokens: output, totalTokens: total };
  }

  function splitAnthropicMessages(messages) {
    var system = [];
    var conversation = [];
    (messages || []).forEach(function (message) {
      if (message.role === "system") system.push(String(message.content || ""));
      else conversation.push({ role: message.role === "assistant" ? "assistant" : "user", content: String(message.content || "") });
    });
    return { system: system.join("\n\n"), messages: conversation };
  }

  function AIProvider(definition, config) {
    this.definition = definition;
    this.id = definition.id;
    this.label = definition.label;
    this.baseUrl = normalizeBaseUrl(config.baseUrl, definition.defaultBaseUrl);
    this.model = String(config.model || definition.defaultModel).trim() || definition.defaultModel;
    this.apiKey = String(config.apiKey || "").trim();
  }

  AIProvider.prototype.chat = function (request) {
    request = request || {};
    var definition = this.definition;
    var endpoint = buildEndpoint(this.baseUrl, definition.endpoint, definition.id);
    var keyValidation = validateApiKey(this.apiKey, definition.requiresApiKey);
    var modelValidation = validateModel(this.model);
    var messagesValidation = validateMessages(request.messages);
    if (!endpoint.ok) return Promise.resolve({ ok: false, provider: this.id, model: this.model, code: "INVALID_CONFIG", error: endpoint.error, retryable: false });
    if (!keyValidation.ok) return Promise.resolve({ ok: false, provider: this.id, model: this.model, code: "INVALID_CONFIG", error: keyValidation.error, retryable: false });
    if (!modelValidation.ok) return Promise.resolve({ ok: false, provider: this.id, model: this.model, code: "INVALID_CONFIG", error: modelValidation.error, retryable: false });
    if (!messagesValidation.ok) return Promise.resolve({ ok: false, provider: this.id, model: this.model, code: "INVALID_REQUEST", error: messagesValidation.error, retryable: false });

    var headers = { "Content-Type": "application/json" };
    var body;
    if (definition.protocol === "anthropic-messages") {
      var converted = splitAnthropicMessages(request.messages);
      if (!converted.messages.some(function (message) { return message.role === "user"; })) {
        return Promise.resolve({ ok: false, provider: this.id, model: this.model, code: "INVALID_REQUEST", error: "Claude requires at least one user message.", retryable: false });
      }
      headers["x-api-key"] = this.apiKey;
      headers["anthropic-version"] = "2023-06-01";
      body = { model: this.model, max_tokens: Number(request.maxTokens || 2048), messages: converted.messages };
      if (converted.system) body.system = converted.system;
    } else {
      if (this.apiKey) headers.Authorization = "Bearer " + this.apiKey;
      body = { model: this.model, messages: request.messages, stream: false };
    }
    if (request.temperature != null) body.temperature = request.temperature;

    var bodyText = JSON.stringify(body);
    if (bodyText.length > MAX_REQUEST_LENGTH) {
      return Promise.resolve({ ok: false, provider: this.id, model: this.model, code: "REQUEST_TOO_LARGE", error: "AI request is too large.", retryable: false });
    }

    var provider = this;
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timeout = controller ? setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS) : null;
    var fetchOptions = {
      method: "POST",
      headers: headers,
      body: bodyText,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer"
    };
    if (controller) fetchOptions.signal = controller.signal;

    return fetch(endpoint.url, fetchOptions).then(function (response) {
      return readResponseText(response, MAX_RESPONSE_LENGTH).then(function (responseBody) {
        if (responseBody.tooLarge) {
          return { ok: false, provider: provider.id, model: provider.model, code: "INVALID_RESPONSE", error: "AI response is too large.", retryable: false };
        }
        var responseText = responseBody.text;
        var data = parseJson(responseText);
        if (!response.ok) return errorResult(provider, response, data, responseText);
        if (!data) return { ok: false, provider: provider.id, model: provider.model, code: "INVALID_RESPONSE", error: "AI response is not valid JSON.", retryable: false };
        var anthropic = definition.protocol === "anthropic-messages";
        var content = anthropic ? anthropicContent(data) : openAiContent(data);
        if (!content.trim()) return { ok: false, provider: provider.id, model: provider.model, code: "EMPTY_RESPONSE", error: "AI response did not contain text.", retryable: false };
        var finishReason = anthropic ? data.stop_reason : data.choices && data.choices[0] && data.choices[0].finish_reason;
        return {
          ok: true,
          content: content,
          provider: provider.id,
          providerLabel: provider.label,
          model: String(data.model || provider.model),
          finishReason: finishReason || "",
          truncated: finishReason === "length" || finishReason === "max_tokens",
          usage: usageResult(data, definition.protocol),
          requestId: headerValue(response, anthropic ? "request-id" : "x-request-id")
        };
      });
    }).catch(function (error) {
      var timedOut = error && error.name === "AbortError";
      return {
        ok: false,
        provider: provider.id,
        model: provider.model,
        code: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
        error: timedOut ? "AI request timed out." : String(error && error.message || error || "Network request failed.").slice(0, 500),
        retryable: true
      };
    }).then(function (result) {
      if (timeout) clearTimeout(timeout);
      return result;
    });
  };

  AIProvider.prototype.summary = function (text, options) {
    options = options || {};
    return this.chat({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: "Summarize the following content into clear study notes:\n\n" + String(text || "") }
      ],
      temperature: options.temperature,
      maxTokens: options.maxTokens
    });
  };

  AIProvider.prototype.translate = function (text, targetLanguage, options) {
    options = options || {};
    return this.chat({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: "Translate the following content into " + String(targetLanguage || "Chinese") + ", preserving key terminology:\n\n" + String(text || "") }
      ],
      temperature: options.temperature,
      maxTokens: options.maxTokens
    });
  };

  function create(config) {
    config = config || {};
    var definition = getDefinition(config.provider);
    return new AIProvider(definition, config);
  }

  global.WinSpeedBallAiProviders = {
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    create: create,
    has: has,
    getDefinition: getDefinition,
    normalizeProviderId: normalizeProviderId,
    normalizeBaseUrl: normalizeBaseUrl,
    validateBaseUrl: validateBaseUrl,
    validateApiKey: validateApiKey,
    validateModel: validateModel,
    buildEndpoint: buildEndpoint,
    list: list
  };
})(self);
