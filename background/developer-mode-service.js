(function (global) {
  "use strict";

  var SETTINGS_KEY = "developerModeSettings";
  var storage = global.WinSpeedBallStorageService;
  var featureGate = global.WinSpeedBallFeatureGate;
  var contracts = global.WinSpeedBallSdkContracts;

  function readSettings() {
    return new Promise(function (resolve) {
      storage.get([SETTINGS_KEY], function (data) {
        var stored = data && data[SETTINGS_KEY];
        resolve(stored && typeof stored === "object" ? stored : {});
      });
    });
  }

  function writeSettings(settings) {
    return new Promise(function (resolve) {
      var data = {};
      data[SETTINGS_KEY] = settings;
      storage.set(data, resolve);
    });
  }

  function getStatus() {
    return Promise.all([readSettings(), featureGate.check("sdk.developer")]).then(function (values) {
      var settings = values[0];
      var gate = values[1] || {};
      var available = gate.allowed === true;
      return {
        ok: true,
        enabled: available && settings.enabled === true,
        available: available,
        sdkVersion: contracts.SDK_VERSION,
        runtimeReady: true,
        runtimeStage: "beta",
        capabilities: contracts.CAPABILITIES.slice(),
        updatedAt: Number(settings.updatedAt || 0),
        reason: available ? "Developer Mode is available." : gate.reason || gate.error || "Developer Mode is unavailable."
      };
    });
  }

  function setEnabled(enabled, confirmed) {
    if (typeof enabled !== "boolean") return Promise.resolve({ ok: false, code: "INVALID_DEVELOPER_MODE", error: "Developer Mode state is invalid." });
    if (enabled && confirmed !== true) {
      return Promise.resolve({ ok: false, code: "DEVELOPER_CONFIRMATION_REQUIRED", error: "Developer Mode must be explicitly confirmed." });
    }
    if (!enabled) {
      return readSettings().then(function (current) {
        return writeSettings({
          enabled: false,
          enabledAt: Number(current.enabledAt || 0),
          updatedAt: Date.now(),
          sdkVersion: contracts.SDK_VERSION
        }).then(function (saved) {
          if (saved && saved.ok === false) return saved;
          return getStatus();
        });
      });
    }
    return featureGate.check("sdk.developer").then(function (gate) {
      if (!gate || gate.allowed !== true) {
        return { ok: false, code: "FEATURE_NOT_AVAILABLE", error: gate && (gate.reason || gate.error) || "Developer Mode is unavailable." };
      }
      return readSettings().then(function (current) {
        var next = {
          enabled: enabled,
          enabledAt: enabled ? Number(current.enabledAt || Date.now()) : Number(current.enabledAt || 0),
          updatedAt: Date.now(),
          sdkVersion: contracts.SDK_VERSION
        };
        return writeSettings(next).then(function (saved) {
          if (saved && saved.ok === false) return saved;
          return getStatus();
        });
      });
    });
  }

  global.WinSpeedBallDeveloperModeService = Object.freeze({
    getStatus: getStatus,
    setEnabled: setEnabled
  });
})(self);
