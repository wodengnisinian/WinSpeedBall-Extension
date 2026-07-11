(function (global) {
  "use strict";

  var subscription = global.WinSpeedBallSubscriptionService;
  var definitions = Object.create(null);
  var initialFeatures = [
    ["video.basic", "Basic video controls"],
    ["ocr.basic", "Local OCR"],
    ["ai.basic", "Basic AI requests"],
    ["ai.summary", "AI summary"],
    ["sdk.developer", "Developer SDK"],
    ["cloud.sync", "Cloud synchronization"]
  ];

  function validFeatureId(featureId) {
    return typeof featureId === "string" && /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(featureId) && featureId.length <= 64;
  }

  function register(feature) {
    if (!feature || !validFeatureId(feature.id)) return { ok: false, error: "Feature ID is invalid." };
    if (definitions[feature.id]) return { ok: false, error: "Feature is already registered." };
    definitions[feature.id] = {
      id: feature.id,
      label: String(feature.label || feature.id).slice(0, 120),
      defaultEnabled: feature.defaultEnabled !== false
    };
    return { ok: true, featureId: feature.id };
  }

  initialFeatures.forEach(function (item) {
    register({ id: item[0], label: item[1], defaultEnabled: true });
  });

  function check(featureId) {
    var definition = definitions[String(featureId || "")];
    if (!definition) {
      return Promise.resolve({ ok: false, allowed: false, feature: String(featureId || ""), code: "UNKNOWN_FEATURE", error: "Feature is not registered." });
    }
    return Promise.resolve().then(function () {
      return subscription.hasFeature(definition.id);
    }).then(function (result) {
      result = result || {};
      return {
        ok: true,
        allowed: result.allowed === true && definition.defaultEnabled,
        feature: definition.id,
        label: definition.label,
        plan: result.plan,
        reason: result.reason
      };
    }).catch(function (error) {
      return {
        ok: false,
        allowed: false,
        feature: definition.id,
        label: definition.label,
        code: "FEATURE_GATE_CHECK_FAILED",
        error: String(error && error.message || error || "Feature availability could not be checked.").slice(0, 300)
      };
    });
  }

  function canUse(featureId) {
    return check(featureId).then(function (result) { return result.allowed === true; });
  }

  function list() {
    return Promise.all(Object.keys(definitions).map(check)).then(function (features) {
      return { ok: true, features: features };
    });
  }

  global.WinSpeedBallFeatureGate = {
    register: register,
    check: check,
    canUse: canUse,
    list: list,
    validFeatureId: validFeatureId
  };
})(self);
