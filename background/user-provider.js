(function (global) {
  "use strict";

  var ACTIVE_PROVIDER_KEY = "activeUserProviderId";
  var DEFAULT_PROVIDER_ID = "local";
  var REQUIRED_METHODS = ["login", "logout", "getUser", "updateProfile"];
  var OPTIONAL_ACCOUNT_METHODS = ["register", "changePassword", "deleteAccount"];
  var providers = Object.create(null);
  var activeProviderId = DEFAULT_PROVIDER_ID;
  var preferredProviderId = DEFAULT_PROVIDER_ID;
  var hydrationComplete = false;
  var mutationQueue = Promise.resolve();

  function validProviderId(providerId) {
    return typeof providerId === "string" && /^[a-z][a-z0-9-]{1,31}$/.test(providerId);
  }

  function capabilitiesFor(provider) {
    var capabilities = {};
    OPTIONAL_ACCOUNT_METHODS.forEach(function (method) {
      capabilities[method] = !!provider && typeof provider[method] === "function";
    });
    return capabilities;
  }

  function validateProvider(provider) {
    if (!provider || typeof provider !== "object") return { ok: false, error: "UserProvider must be an object." };
    if (!validProviderId(provider.id)) return { ok: false, error: "UserProvider ID is invalid." };
    var missing = REQUIRED_METHODS.filter(function (method) { return typeof provider[method] !== "function"; });
    if (missing.length) return { ok: false, error: "UserProvider is missing methods: " + missing.join(", ") };
    var invalidOptional = OPTIONAL_ACCOUNT_METHODS.filter(function (method) {
      return method in provider && typeof provider[method] !== "function";
    });
    return invalidOptional.length
      ? { ok: false, error: "UserProvider has invalid optional methods: " + invalidOptional.join(", ") }
      : { ok: true, capabilities: capabilitiesFor(provider) };
  }

  function register(provider) {
    var validation = validateProvider(provider);
    if (!validation.ok) return validation;
    if (providers[provider.id]) return { ok: false, error: "UserProvider is already registered." };
    providers[provider.id] = provider;
    if (hydrationComplete && provider.id === preferredProviderId) activeProviderId = provider.id;
    return { ok: true, providerId: provider.id, capabilities: capabilitiesFor(provider) };
  }

  function get(providerId) {
    return providers[String(providerId || "")] || null;
  }

  function getActive() {
    return get(activeProviderId) || get(DEFAULT_PROVIDER_ID);
  }

  function readPersistedProviderId() {
    var storage = global.WinSpeedBallStorageService;
    if (!storage || typeof storage.get !== "function") return Promise.resolve(DEFAULT_PROVIDER_ID);
    return new Promise(function (resolve) {
      try {
        storage.get([ACTIVE_PROVIDER_KEY], function (data) {
          var providerId = data && data[ACTIVE_PROVIDER_KEY];
          resolve(validProviderId(providerId) ? providerId : DEFAULT_PROVIDER_ID);
        });
      } catch (error) {
        resolve(DEFAULT_PROVIDER_ID);
      }
    });
  }

  function persistProviderId(providerId) {
    var storage = global.WinSpeedBallStorageService;
    if (!storage || typeof storage.set !== "function") return Promise.resolve({ ok: true, persisted: false });
    var data = {};
    data[ACTIVE_PROVIDER_KEY] = providerId;
    return new Promise(function (resolve) {
      try {
        storage.set(data, function (result) {
          if (result && result.ok === false) {
            resolve({ ok: false, code: "USER_PROVIDER_PERSIST_FAILED", error: result.error || "Could not persist active UserProvider." });
            return;
          }
          resolve({ ok: true, persisted: true });
        });
      } catch (error) {
        resolve({ ok: false, code: "USER_PROVIDER_PERSIST_FAILED", error: error.message || String(error) });
      }
    });
  }

  var ready = readPersistedProviderId().then(function (providerId) {
    preferredProviderId = providerId;
    activeProviderId = get(providerId) ? providerId : DEFAULT_PROVIDER_ID;
    hydrationComplete = true;
    return { ok: true, providerId: activeProviderId, preferredProviderId: preferredProviderId };
  });

  function setActive(providerId) {
    var requestedId = String(providerId || "");
    var operation = mutationQueue.then(function () { return ready; }).then(function () {
      if (!get(requestedId)) return { ok: false, code: "USER_PROVIDER_NOT_REGISTERED", error: "UserProvider is not registered." };
      return persistProviderId(requestedId).then(function (persisted) {
        if (!persisted.ok) return persisted;
        preferredProviderId = requestedId;
        activeProviderId = requestedId;
        return { ok: true, providerId: activeProviderId, persisted: persisted.persisted };
      });
    });
    mutationQueue = operation.then(function () {}, function () {});
    return operation;
  }

  function supports(method, providerId) {
    var provider = providerId ? get(providerId) : getActive();
    return !!provider && typeof provider[method] === "function";
  }

  function providerDescriptor(provider) {
    if (!provider) return null;
    return {
      id: provider.id,
      label: provider.label || provider.id,
      mode: provider.mode || "unknown",
      capabilities: capabilitiesFor(provider)
    };
  }

  function invoke(method, args) {
    var selectedProvider = null;
    return ready.then(function () {
      selectedProvider = getActive();
      if (!selectedProvider) return { ok: false, code: "USER_PROVIDER_UNAVAILABLE", error: "UserProvider is unavailable." };
      if (typeof selectedProvider[method] !== "function") {
        return {
          ok: false,
          code: "USER_PROVIDER_UNSUPPORTED",
          error: "Current UserProvider does not support " + method + ".",
          providerId: selectedProvider.id
        };
      }
      return Promise.resolve(selectedProvider[method].apply(selectedProvider, args || [])).then(function (result) {
        if (!result || typeof result !== "object" || result.providerId) return result;
        var response = {};
        Object.keys(result).forEach(function (key) { response[key] = result[key]; });
        response.providerId = selectedProvider.id;
        return response;
      });
    }).catch(function (error) {
      return {
        ok: false,
        code: "USER_PROVIDER_ERROR",
        error: error && error.message || String(error),
        providerId: selectedProvider && selectedProvider.id || activeProviderId
      };
    });
  }

  var localProvider = global.WinSpeedBallLocalUserProvider;
  var localRegistration = register(localProvider);
  if (!localRegistration.ok) throw new Error(localRegistration.error);

  var userService = {
    getProvider: function () { return providerDescriptor(getActive()); },
    getUser: function () { return invoke("getUser"); },
    getSession: function () { return invoke("getUser"); },
    register: function (request) { return invoke("register", [request]); },
    login: function (request) { return invoke("login", [request]); },
    logout: function () { return invoke("logout"); },
    updateProfile: function (request) { return invoke("updateProfile", [request]); },
    changePassword: function (request) { return invoke("changePassword", [request]); },
    deleteAccount: function (request) { return invoke("deleteAccount", [request]); }
  };

  global.WinSpeedBallUserProviderRegistry = {
    ACTIVE_PROVIDER_KEY: ACTIVE_PROVIDER_KEY,
    REQUIRED_METHODS: REQUIRED_METHODS.slice(),
    OPTIONAL_ACCOUNT_METHODS: OPTIONAL_ACCOUNT_METHODS.slice(),
    ready: ready,
    register: register,
    get: get,
    getActive: getActive,
    getDescriptor: function (providerId) { return providerDescriptor(providerId ? get(providerId) : getActive()); },
    supports: supports,
    setActive: setActive,
    validate: validateProvider
  };
  global.WinSpeedBallUserService = userService;
})(self);
