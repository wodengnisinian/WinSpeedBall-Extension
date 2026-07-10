(function (global) {
  "use strict";

  var SETTINGS_VERSION = 1;
  var storage = global.WinSpeedBallStorageService;
  var providers = global.WinSpeedBallAiProviders;
  var STORAGE_KEYS = [
    "aiProvider",
    "aiProviderConfigs",
    "aiSettingsVersion",
    "deepseekApiKey",
    "deepseekBaseUrl",
    "deepseekModel"
  ];

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
  }

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function normalizeConfig(definition, value) {
    value = isObject(value) ? value : {};
    return {
      apiKey: String(value.apiKey || "").trim(),
      baseUrl: providers.normalizeBaseUrl(value.baseUrl, definition.defaultBaseUrl),
      model: String(value.model || definition.defaultModel).trim() || definition.defaultModel
    };
  }

  function serializeState(state) {
    var configs = {};
    providers.list().forEach(function (option) {
      var config = state.configs[option.id];
      configs[option.id] = {
        apiKey: String(config.apiKey || ""),
        baseUrl: String(config.baseUrl || option.defaultBaseUrl),
        model: String(config.model || option.defaultModel)
      };
    });
    return {
      aiProvider: state.provider,
      aiProviderConfigs: configs,
      aiSettingsVersion: SETTINGS_VERSION
    };
  }

  function persistState(state, includeLegacy, callback) {
    var data = serializeState(state);
    if (includeLegacy) {
      var deepseek = state.configs.deepseek;
      data.deepseekApiKey = deepseek.apiKey;
      data.deepseekBaseUrl = deepseek.baseUrl;
      data.deepseekModel = deepseek.model;
    }
    storage.set(data, callback);
  }

  function readState(callback) {
    storage.get(STORAGE_KEYS, function (data) {
      var storedConfigs = isObject(data.aiProviderConfigs) ? data.aiProviderConfigs : {};
      var providerId = providers.has(data.aiProvider) ? String(data.aiProvider).toLowerCase() : "deepseek";
      var configs = {};
      var migratedLegacy = false;

      providers.list().forEach(function (option) {
        var definition = providers.getDefinition(option.id);
        var stored = isObject(storedConfigs[option.id]) ? storedConfigs[option.id] : null;
        if (option.id === "deepseek" && !stored) {
          stored = {
            apiKey: data.deepseekApiKey,
            baseUrl: data.deepseekBaseUrl,
            model: data.deepseekModel
          };
          migratedLegacy = hasOwn(data, "deepseekApiKey") || hasOwn(data, "deepseekBaseUrl") || hasOwn(data, "deepseekModel");
        }
        configs[option.id] = normalizeConfig(definition, stored);
      });

      var state = { provider: providerId, configs: configs };
      var needsMigration = !isObject(data.aiProviderConfigs) || !providers.has(data.aiProvider) || data.aiSettingsVersion !== SETTINGS_VERSION || migratedLegacy;
      if (!needsMigration) {
        callback(state);
        return;
      }
      persistState(state, migratedLegacy, function () { callback(state); });
    });
  }

  function publicConfig(state) {
    var currentDefinition = providers.getDefinition(state.provider);
    var current = state.configs[state.provider];
    var options = providers.list().map(function (option) {
      var config = state.configs[option.id];
      var hasApiKey = !!config.apiKey;
      return {
        id: option.id,
        label: option.label,
        baseUrl: config.baseUrl,
        model: config.model,
        hasApiKey: hasApiKey,
        requiresApiKey: option.requiresApiKey,
        configured: !option.requiresApiKey || hasApiKey
      };
    });
    var deepseek = state.configs.deepseek;
    return {
      ok: true,
      aiProvider: state.provider,
      aiProviderLabel: currentDefinition.label,
      aiBaseUrl: current.baseUrl,
      aiModel: current.model,
      hasApiKey: !!current.apiKey,
      requiresApiKey: currentDefinition.requiresApiKey,
      configured: !currentDefinition.requiresApiKey || !!current.apiKey,
      providerOptions: options,
      deepseekBaseUrl: deepseek.baseUrl,
      deepseekModel: deepseek.model
    };
  }

  function buildMessages(payload) {
    if (Array.isArray(payload.messages)) return payload.messages;
    return [
      { role: "system", content: providers.SYSTEM_PROMPT },
      { role: "user", content: String(payload.prompt || "") }
    ];
  }

  function saveAutoOcrResult(payload, result, callback) {
    var sourceTime = Number(payload.autoOcrSourceTime || 0);
    if (!sourceTime || !result.ok) {
      callback(result);
      return;
    }
    storage.set({
      manualAiSourceTime: sourceTime,
      manualAiPrompt: String(payload.prompt || ""),
      manualAiResponse: result.content
    }, function () { callback(result); });
  }

  function call(payload, callback) {
    payload = payload || {};
    readState(function (state) {
      var config = state.configs[state.provider];
      var provider = providers.create({
        provider: state.provider,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model
      });
      var options = {};
      if (hasOwn(payload, "temperature")) options.temperature = payload.temperature;
      var request;
      if (payload.task === "summary") request = provider.summary(String(payload.prompt || ""), options);
      else if (payload.task === "translate") request = provider.translate(String(payload.prompt || ""), payload.targetLanguage, options);
      else request = provider.chat({ messages: buildMessages(payload), temperature: options.temperature });

      Promise.resolve(request).then(function (result) {
        if (!result.providerLabel) result.providerLabel = provider.label;
        saveAutoOcrResult(payload, result, callback);
      }).catch(function (error) {
        callback({
          ok: false,
          provider: provider.id,
          providerLabel: provider.label,
          model: provider.model,
          code: "INTERNAL_ERROR",
          error: String(error && error.message || error || "AI request failed.").slice(0, 500),
          retryable: false
        });
      });
    });
  }

  function saveSettings(request, callback) {
    request = request || {};
    readState(function (state) {
      if (hasOwn(request, "provider") && !providers.has(request.provider)) {
        callback({ ok: false, error: "AI provider is invalid." });
        return;
      }
      var providerId = hasOwn(request, "provider") ? String(request.provider).toLowerCase() : state.provider;
      var definition = providers.getDefinition(providerId);
      var config = state.configs[providerId];

      if (hasOwn(request, "baseUrl")) {
        var baseUrl = providers.normalizeBaseUrl(request.baseUrl, definition.defaultBaseUrl);
        var baseUrlValidation = providers.validateBaseUrl(baseUrl, providerId);
        if (!baseUrlValidation.ok) {
          callback({ ok: false, error: baseUrlValidation.error });
          return;
        }
        config.baseUrl = baseUrl;
      }
      if (hasOwn(request, "model")) {
        var modelValidation = providers.validateModel(request.model);
        if (!modelValidation.ok) {
          callback({ ok: false, error: modelValidation.error });
          return;
        }
        config.model = modelValidation.value;
      }
      if (request.clearApiKey === true) {
        config.apiKey = "";
      } else if (hasOwn(request, "apiKey") && String(request.apiKey || "").trim()) {
        var keyValidation = providers.validateApiKey(request.apiKey, false);
        if (!keyValidation.ok) {
          callback({ ok: false, error: keyValidation.error });
          return;
        }
        config.apiKey = keyValidation.value;
      }

      state.provider = providerId;
      state.configs[providerId] = config;
      persistState(state, providerId === "deepseek", function (result) {
        if (!result || result.ok !== false) callback(publicConfig(state));
        else callback(result);
      });
    });
  }

  function getConfig(callback) {
    readState(function (state) { callback(publicConfig(state)); });
  }

  function buildChatCompletionsUrl(baseUrl) {
    return providers.buildEndpoint(providers.normalizeBaseUrl(baseUrl, providers.getDefinition("deepseek").defaultBaseUrl), "chat/completions", "deepseek");
  }

  global.WinSpeedBallAiService = {
    call: call,
    saveSettings: saveSettings,
    getConfig: getConfig,
    buildChatCompletionsUrl: buildChatCompletionsUrl
  };
})(self);
