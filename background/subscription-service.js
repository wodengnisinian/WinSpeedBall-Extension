(function (global) {
  "use strict";

  var userService = global.WinSpeedBallUserService;
  var DEFAULT_QUOTAS = {
    ocr: { daily: 10, enforced: false },
    ai: { daily: 5, enforced: false },
    video: { daily: null, enforced: false },
    sdk: { daily: null, enforced: false },
    cloud: { daily: null, enforced: false }
  };

  function getPlan() {
    return userService.getUser().then(function (session) {
      var user = session && session.user || {};
      var planId = String(user.plan || user.subscriptionLevel || "guest");
      return {
        ok: true,
        id: planId,
        label: planId === "free" ? "Free" : planId === "guest" ? "Guest" : planId,
        source: "user-provider",
        providerId: session && session.providerId || "local",
        commercialEnabled: false
      };
    });
  }

  function hasFeature(featureId) {
    return getPlan().then(function (plan) {
      return {
        ok: true,
        allowed: true,
        feature: String(featureId || ""),
        plan: plan.id,
        reason: "Current local plan enables all registered feature gates."
      };
    });
  }

  function getQuota(resource) {
    var key = String(resource || "").toLowerCase();
    var definition = DEFAULT_QUOTAS[key] || { daily: null, enforced: false };
    return getPlan().then(function (plan) {
      return {
        ok: true,
        resource: key,
        plan: plan.id,
        limit: definition.daily,
        remaining: definition.daily,
        enforced: false
      };
    });
  }

  global.WinSpeedBallSubscriptionService = {
    getPlan: getPlan,
    hasFeature: hasFeature,
    getQuota: getQuota
  };
})(self);
