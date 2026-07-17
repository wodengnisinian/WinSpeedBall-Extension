"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function runScript(context, relativePath) {
  const filename = path.join(ROOT, relativePath);
  vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
}

function createContext(extra) {
  const context = vm.createContext(Object.assign({
    AbortController,
    TextDecoder,
    URL,
    clearTimeout,
    console,
    setTimeout
  }, extra || {}));
  context.self = context;
  return context;
}

function response(options) {
  options = options || {};
  const status = options.status == null ? 200 : options.status;
  const rawHeaders = Object.create(null);
  Object.keys(options.headers || {}).forEach((name) => {
    rawHeaders[name.toLowerCase()] = String(options.headers[name]);
  });
  const text = Object.prototype.hasOwnProperty.call(options, "text")
    ? String(options.text)
    : JSON.stringify(options.body == null ? {} : options.body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return rawHeaders[String(name).toLowerCase()] || null;
      }
    },
    text: async () => text
  };
}

function openAiSuccess(content, extra) {
  return response({
    body: Object.assign({
      model: "response-model",
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
    }, extra || {}),
    headers: { "x-request-id": "openai-request" }
  });
}

function claudeSuccess(content, extra) {
  return response({
    body: Object.assign({
      model: "response-model",
      content,
      stop_reason: "end_turn",
      usage: { input_tokens: 4, output_tokens: 3 }
    }, extra || {}),
    headers: { "request-id": "claude-request" }
  });
}

function loadProviders(fetchImpl) {
  const context = createContext({ fetch: fetchImpl || (async () => openAiSuccess("ok")) });
  runScript(context, "background/ai-providers.js");
  return context;
}

function createStorage(initial) {
  const data = Object.assign({}, initial || {});
  const writes = [];
  return {
    data,
    writes,
    service: {
      get(keys, callback) {
        const result = {};
        (keys || []).forEach((key) => {
          if (Object.prototype.hasOwnProperty.call(data, key)) result[key] = data[key];
        });
        callback(result);
      },
      set(values, callback) {
        writes.push(JSON.parse(JSON.stringify(values)));
        Object.assign(data, JSON.parse(JSON.stringify(values)));
        callback({ ok: true });
      }
    }
  };
}

function loadAiService(initial, options) {
  options = options || {};
  const storage = createStorage(initial);
  const context = createContext({
    fetch: options.fetch || (async () => openAiSuccess("ok")),
    WinSpeedBallStorageService: storage.service
  });
  runScript(context, "background/ai-providers.js");
  if (options.realTextNormalizer) {
    runScript(context, "vendor/opencc/opencc-full-1.4.1.js");
    runScript(context, "voice/text-filter.js");
  }
  runScript(context, "background/ai-service.js");
  return { context, service: context.WinSpeedBallAiService, storage };
}

function callbackResult(invoke) {
  return new Promise((resolve) => invoke(resolve));
}

function popupEnvelope(action, payload) {
  return {
    version: 1,
    action,
    source: "popup",
    requestId: "provider-test",
    payload: payload || {}
  };
}

test("四类 Provider 使用各自的默认端点", async () => {
  const calls = [];
  const context = loadProviders(async (url, options) => {
    calls.push({ url, options });
    return url.includes("anthropic.com")
      ? claudeSuccess([{ type: "text", text: "ok" }])
      : openAiSuccess("ok");
  });
  const providers = context.WinSpeedBallAiProviders;
  const cases = [
    ["deepseek", "key", "https://api.deepseek.com/chat/completions"],
    ["openai", "key", "https://api.openai.com/v1/chat/completions"],
    ["claude", "key", "https://api.anthropic.com/v1/messages"],
    ["local", "", "http://localhost:11434/v1/chat/completions"]
  ];

  for (const [provider, apiKey, expectedUrl] of cases) {
    const result = await providers.create({ provider, apiKey }).chat({
      messages: [{ role: "user", content: "hello" }]
    });
    assert.equal(result.ok, true, `${provider} 应成功归一化响应`);
    assert.equal(calls.at(-1).url, expectedUrl);
  }
});

test("完整 endpoint 不会被重复追加", () => {
  const providers = loadProviders().WinSpeedBallAiProviders;
  const result = providers.buildEndpoint(
    "https://gateway.example/v1/chat/completions/",
    "chat/completions",
    "openai"
  );
  assert.equal(result.ok, true);
  assert.equal(result.url, "https://gateway.example/v1/chat/completions");
});

test("Base URL 仅允许 HTTPS 或受控回环地址", () => {
  const providers = loadProviders().WinSpeedBallAiProviders;

  assert.equal(providers.validateBaseUrl("https://gateway.example/v1", "openai").ok, true);
  assert.equal(providers.validateBaseUrl("http://gateway.example/v1", "openai").ok, false);
  assert.equal(providers.validateBaseUrl("http://localhost:11434/v1", "local").ok, true);
  assert.equal(providers.validateBaseUrl("http://127.0.0.1:11434/v1", "local").ok, true);
  assert.equal(providers.validateBaseUrl("http://[::1]:11434/v1", "local").ok, true);
  assert.equal(providers.validateBaseUrl("ftp://localhost/model", "local").ok, false);
});

test("Base URL 拒绝凭据、查询参数和 fragment", () => {
  const providers = loadProviders().WinSpeedBallAiProviders;
  assert.equal(providers.validateBaseUrl("https://user:pass@gateway.example/v1", "openai").ok, false);
  assert.equal(providers.validateBaseUrl("https://gateway.example/v1?token=secret", "openai").ok, false);
  assert.equal(providers.validateBaseUrl("https://gateway.example/v1#secret", "openai").ok, false);
});

test("本地 Provider 强制使用回环地址", () => {
  const providers = loadProviders().WinSpeedBallAiProviders;
  assert.equal(providers.validateBaseUrl("https://gateway.example/v1", "local").ok, false);
  assert.equal(providers.validateBaseUrl("http://192.168.1.8:11434/v1", "local").ok, false);
  assert.equal(providers.validateBaseUrl("https://localhost:11434/v1", "local").ok, true);
});

test("本地 Provider 无 Key 时不发送 Authorization", async () => {
  let requestOptions;
  const providers = loadProviders(async (_url, options) => {
    requestOptions = options;
    return openAiSuccess("local response");
  }).WinSpeedBallAiProviders;

  const result = await providers.create({ provider: "local" }).chat({
    messages: [{ role: "user", content: "hello" }]
  });
  assert.equal(result.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(requestOptions.headers, "Authorization"), false);
});

test("Claude 将 system 提升为顶层字段并发送必需 headers", async () => {
  let captured;
  const providers = loadProviders(async (url, options) => {
    captured = { url, options };
    return claudeSuccess([{ type: "text", text: "answer" }]);
  }).WinSpeedBallAiProviders;

  const result = await providers.create({ provider: "claude", apiKey: "claude-key" }).chat({
    messages: [
      { role: "system", content: "rule one" },
      { role: "system", content: "rule two" },
      { role: "user", content: "question" },
      { role: "assistant", content: "prior answer" }
    ]
  });
  const body = JSON.parse(captured.options.body);

  assert.equal(result.ok, true);
  assert.equal(captured.options.headers["x-api-key"], "claude-key");
  assert.equal(captured.options.headers["anthropic-version"], "2023-06-01");
  assert.equal(body.system, "rule one\n\nrule two");
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages.some((message) => message.role === "system"), false);
  assert.equal(body.max_tokens, 2048);
});

test("OpenAI 兼容响应被归一化", async () => {
  const providers = loadProviders(async () => openAiSuccess([
    { type: "text", text: "part one" },
    { type: "image", text: "ignored" },
    { type: "text", text: "part two" }
  ])).WinSpeedBallAiProviders;

  const result = await providers.create({ provider: "openai", apiKey: "key" }).chat({
    messages: [{ role: "user", content: "hello" }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.content, "part one\npart two");
  assert.equal(result.model, "response-model");
  assert.equal(result.requestId, "openai-request");
  assert.equal(result.usage.totalTokens, 5);
});

test("Claude 响应被归一化", async () => {
  const providers = loadProviders(async () => claudeSuccess([
    { type: "text", text: "part one" },
    { type: "tool_use", name: "ignored" },
    { type: "text", text: "part two" }
  ])).WinSpeedBallAiProviders;

  const result = await providers.create({ provider: "claude", apiKey: "key" }).chat({
    messages: [{ role: "user", content: "hello" }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.content, "part one\npart two");
  assert.equal(result.requestId, "claude-request");
  assert.equal(result.usage.inputTokens, 4);
  assert.equal(result.usage.outputTokens, 3);
  assert.equal(result.usage.totalTokens, 7);
});

test("401、429、529 被映射为稳定错误", async (t) => {
  const cases = [
    [401, "AUTH_ERROR", false],
    [429, "RATE_LIMITED", true],
    [529, "PROVIDER_UNAVAILABLE", true]
  ];
  for (const [status, code, retryable] of cases) {
    await t.test(String(status), async () => {
      const providers = loadProviders(async () => response({
        status,
        body: { error: { message: `status-${status}` } },
        headers: status === 429 ? { "retry-after": "2" } : {}
      })).WinSpeedBallAiProviders;
      const result = await providers.create({ provider: "openai", apiKey: "key" }).chat({
        messages: [{ role: "user", content: "hello" }]
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, code);
      assert.equal(result.retryable, retryable);
      if (status === 429) assert.equal(result.retryAfterMs, 2000);
    });
  }
});

test("非 JSON 成功响应被拒绝", async () => {
  const providers = loadProviders(async () => response({ text: "not-json" })).WinSpeedBallAiProviders;
  const result = await providers.create({ provider: "openai", apiKey: "key" }).chat({
    messages: [{ role: "user", content: "hello" }]
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_RESPONSE");
});

test("空文本成功响应被拒绝", async () => {
  const providers = loadProviders(async () => openAiSuccess("   ")).WinSpeedBallAiProviders;
  const result = await providers.create({ provider: "openai", apiKey: "key" }).chat({
    messages: [{ role: "user", content: "hello" }]
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "EMPTY_RESPONSE");
});

test("超大 AI 响应在流式读取阶段被取消", async () => {
  let cancelled = false;
  const chunks = [new Uint8Array(1024 * 1024 + 1), new Uint8Array(1024 * 1024 + 1)];
  const context = loadProviders(async () => ({
    ok: true,
    status: 200,
    headers: { get() { return null; } },
    body: {
      getReader() {
        return {
          read() {
            return Promise.resolve(chunks.length ? { done: false, value: chunks.shift() } : { done: true });
          },
          cancel() {
            cancelled = true;
            return Promise.resolve();
          }
        };
      }
    },
    text() { throw new Error("streaming reader should be used"); }
  }));
  const result = await context.WinSpeedBallAiProviders.create({
    provider: "openai",
    apiKey: "key"
  }).chat({ messages: [{ role: "user", content: "hello" }] });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_RESPONSE");
  assert.equal(result.error, "AI response is too large.");
  assert.equal(cancelled, true);
});

test("AI 回复在返回和保存前统一为简体中文或正常英文", async () => {
  const { service } = loadAiService({ deepseekApiKey: "key" }, {
    realTextNormalizer: true,
    fetch: async () => openAiSuccess("繁體回答\nEnglish 𝕋𝕖𝕤𝕥\n한국어")
  });
  const result = await callbackResult((done) => service.call({ prompt: "question" }, done));
  assert.equal(result.ok, true);
  assert.equal(result.content, "繁体回答\nEnglish Test");
});

test("单次 AI 请求可以指定 Provider 且不改动默认服务", async () => {
  let requestedUrl = "";
  const { service, storage } = loadAiService({
    aiProvider: "deepseek",
    aiSettingsVersion: 1,
    aiProviderConfigs: {
      deepseek: { apiKey: "deepseek-key", baseUrl: "https://api.deepseek.com", model: "deepseek-model" },
      openai: { apiKey: "openai-key", baseUrl: "https://api.openai.com/v1", model: "openai-model" },
      claude: { apiKey: "", baseUrl: "https://api.anthropic.com/v1", model: "claude-model" },
      local: { apiKey: "", baseUrl: "http://localhost:11434/v1", model: "local-model" }
    }
  }, {
    fetch: async (url) => {
      requestedUrl = url;
      return openAiSuccess("OpenAI answer");
    }
  });
  const result = await callbackResult((done) => service.call({ provider: "openai", prompt: "question" }, done));
  assert.equal(result.ok, true);
  assert.equal(result.provider, "openai");
  assert.equal(requestedUrl, "https://api.openai.com/v1/chat/completions");
  assert.equal(storage.data.aiProvider, "deepseek");
});

test("旧 deepseek 配置迁移到新版配置且保留旧键", async () => {
  const { service, storage } = loadAiService({
    deepseekApiKey: "legacy-key",
    deepseekBaseUrl: "https://legacy.example/v1",
    deepseekModel: "legacy-model"
  });
  const config = await callbackResult((done) => service.getConfig(done));

  assert.equal(config.aiProvider, "deepseek");
  assert.equal(config.aiBaseUrl, "https://legacy.example/v1");
  assert.equal(config.aiModel, "legacy-model");
  assert.equal(config.hasApiKey, true);
  assert.equal(storage.data.aiProviderConfigs.deepseek.apiKey, "legacy-key");
  assert.equal(storage.data.deepseekApiKey, "legacy-key");
  assert.equal(storage.data.deepseekBaseUrl, "https://legacy.example/v1");
  assert.equal(storage.data.deepseekModel, "legacy-model");
  assert.ok(storage.writes.length >= 1);
});

test("各 Provider 保存独立配置", async () => {
  const { service, storage } = loadAiService();

  await callbackResult((done) => service.saveSettings({
    provider: "openai",
    apiKey: "openai-key",
    baseUrl: "https://openai-gateway.example/v1",
    model: "openai-model"
  }, done));
  await callbackResult((done) => service.saveSettings({
    provider: "claude",
    apiKey: "claude-key",
    baseUrl: "https://claude-gateway.example/v1",
    model: "claude-model"
  }, done));
  await callbackResult((done) => service.saveSettings({
    provider: "local",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "local-model"
  }, done));

  const configs = storage.data.aiProviderConfigs;
  assert.equal(configs.openai.apiKey, "openai-key");
  assert.equal(configs.openai.model, "openai-model");
  assert.equal(configs.claude.apiKey, "claude-key");
  assert.equal(configs.claude.model, "claude-model");
  assert.equal(configs.local.apiKey, "");
  assert.equal(configs.local.model, "local-model");
  assert.equal(configs.deepseek.model, "deepseek-v4-flash");

  const publicConfig = await callbackResult((done) => service.getConfig(done));
  assert.equal(publicConfig.aiProvider, "local");
  assert.equal(publicConfig.providerOptions.length, 4);
  assert.equal(Object.prototype.hasOwnProperty.call(publicConfig.providerOptions[0], "apiKey"), false);
});

test("空 apiKey 保留已有密钥", async () => {
  const { service, storage } = loadAiService();
  await callbackResult((done) => service.saveSettings({ provider: "openai", apiKey: "existing-key" }, done));
  await callbackResult((done) => service.saveSettings({ provider: "openai", apiKey: "   ", model: "new-model" }, done));
  assert.equal(storage.data.aiProviderConfigs.openai.apiKey, "existing-key");
  assert.equal(storage.data.aiProviderConfigs.openai.model, "new-model");
});

test("clearApiKey 显式清除已有密钥", async () => {
  const { service, storage } = loadAiService();
  await callbackResult((done) => service.saveSettings({ provider: "claude", apiKey: "existing-key" }, done));
  const result = await callbackResult((done) => service.saveSettings({ provider: "claude", clearApiKey: true }, done));
  assert.equal(result.ok, true);
  assert.equal(result.hasApiKey, false);
  assert.equal(storage.data.aiProviderConfigs.claude.apiKey, "");
});

test("消息 Schema 同时支持通用和旧版 AI 动作", () => {
  const extensionId = "extension-id";
  const context = createContext({
    chrome: {
      runtime: {
        id: extensionId,
        getURL: (file) => `chrome-extension://${extensionId}/${file}`
      }
    }
  });
  runScript(context, "background/message-schema.js");
  const schema = context.WinSpeedBallMessageSchema;
  const sender = { id: extensionId, url: `chrome-extension://${extensionId}/popup/index.html` };
  const validCases = [
    ["saveAiSettings", { provider: "openai", apiKey: "key", baseUrl: "https://api.openai.com/v1", model: "gpt-test" }],
    ["testAI", {}],
    ["askAI", { provider: "openai", prompt: "hello", task: "summary" }],
    ["saveApiKey", { provider: "deepseek", apiKey: "key" }],
    ["testDeepSeek", {}],
    ["askDeepSeek", { prompt: "hello" }]
  ];

  validCases.forEach(([action, payload]) => {
    const result = schema.parse(popupEnvelope(action, payload), sender);
    assert.equal(result.ok, true, `${action} 应通过校验：${result.error || ""}`);
  });

  assert.equal(schema.parse(popupEnvelope("saveAiSettings", {
    provider: "unknown",
    baseUrl: "http://remote.example/v1"
  }), sender).ok, false);
  assert.equal(schema.parse(popupEnvelope("askAI", { task: "auto-answer" }), sender).ok, false);
  assert.equal(schema.parse(popupEnvelope("askAI", { provider: "unknown", prompt: "hello" }), sender).ok, false);
});
