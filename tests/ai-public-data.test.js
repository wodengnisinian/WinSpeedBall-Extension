const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function buildService(data) {
  const context = {
    self: {
      WinSpeedBallStorageService: {
        get(keys, callback) {
          const result = {};
          keys.forEach((key) => { if (Object.prototype.hasOwnProperty.call(data, key)) result[key] = data[key]; });
          callback(result);
        }
      },
      WinSpeedBallAiProviders: {}
    },
    Object, Array, Number, String, JSON, Promise, Date, Math
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "background/ai-service.js"), "utf8"), context);
  return context.self.WinSpeedBallAiService;
}

function latest(service) {
  return new Promise((resolve) => service.getLatest(resolve));
}

function history(service, limit) {
  return new Promise((resolve) => service.getHistory(limit, resolve));
}

test("AI 公开读取按时间返回最新答案且不暴露配置密钥", async () => {
  const service = buildService({
    aiProvider: "deepseek",
    aiSelectedProvider: "openai",
    aiProviderWorkspaces: { openai: { mode: "custom", question: "workspace", answer: "workspace answer" } },
    aiQuestionHistoryByProvider: {
      openai: [{ provider: "openai", model: "gpt-test", question: "new", answer: "new answer", time: 300 }],
      deepseek: [{ provider: "deepseek", question: "old", answer: "old answer", time: 100 }]
    },
    manualAiSourceTime: 200,
    manualAiPrompt: "ocr",
    manualAiResponse: "ocr answer",
    aiProviderConfigs: { openai: { apiKey: "secret" } }
  });
  const result = await latest(service);
  assert.equal(result.ok, true);
  assert.equal(result.record.provider, "openai");
  assert.equal(result.record.question, "new");
  assert.equal(result.record.answer, "new answer");
  assert.equal(Object.prototype.hasOwnProperty.call(result.record, "apiKey"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.record, "baseUrl"), false);
});

test("AI 历史限制条数并标记过长答案截断", async () => {
  const service = buildService({
    aiQuestionHistoryByProvider: {
      openai: [
        { question: "large", answer: "x".repeat(200001), time: 300 },
        { question: "second", answer: "answer", time: 200 }
      ]
    }
  });
  const result = await history(service, 1);
  assert.equal(result.ok, true);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].answer.length, 200000);
  assert.equal(result.records[0].truncated, true);
});
