(function () {
  "use strict";

  var script = document.currentScript;
  if (!script || !script.src)
    throw new Error("codeblocks.js requires a script URL");
  var debug = script.hasAttribute("data-debug");
  var serviceWorker = script.getAttribute("data-coi-serviceworker");
  var localHost = /^(localhost|127(?:\.\d+){3}|\[::1\])$/.test(
    location.hostname,
  );
  function log(message) {
    if (debug) console.info("[CodeBlocks] " + message);
  }
  function fail(message, error) {
    console.error("[CodeBlocks] " + message, error || "");
  }

  log("Loader started at " + location.href);
  if (serviceWorker !== null && location.protocol === "http:" && !localHost) {
    var secureUrl = new URL(location.href);
    secureUrl.protocol = "https:";
    log("HTTPS is required for clangd; redirecting to " + secureUrl.href);
    location.replace(secureUrl.href);
    return;
  }
  var queuedConfigurations = [];
  var loadedModule;
  var api = {
    configure: function (options) {
      if (loadedModule) loadedModule.configureCodeBlocks(options);
      else queuedConfigurations.push(options);
    },
  };
  globalThis.CodeBlocks = api;
  // Start fetching the UI module immediately. Service-worker setup can happen in
  // parallel; waiting for it first caused a conspicuous unstyled-source flash.
  var modulePromise = import(
    new URL("./codeblocks-module.js", script.src).href
  );

  api.ready = (async function () {
    try {
      if (serviceWorker !== null && !globalThis.crossOriginIsolated) {
        if (!("serviceWorker" in navigator)) {
          fail(
            "Service workers are unavailable; clangd cannot enable cross-origin isolation",
          );
        } else {
          // An explicitly configured worker belongs to the host page, so its
          // relative URL follows normal HTML attribute semantics. The bundled
          // fallback remains relative to this loader script.
          var workerUrl = serviceWorker
            ? new URL(serviceWorker, document.baseURI)
            : new URL("./coi-serviceworker.js", script.src);
          log("Registering isolation service worker at " + workerUrl.href);
          await navigator.serviceWorker.register(workerUrl, { scope: "./" });
          await navigator.serviceWorker.ready;
          log("Isolation service worker activated");
          var reloadKey = "codeblocks.isolation-reload-attempted";
          var alreadyReloaded = Boolean(
            navigator.serviceWorker.controller ||
            (history.state && history.state[reloadKey]),
          );
          try {
            alreadyReloaded =
              alreadyReloaded || sessionStorage.getItem(reloadKey) === "true";
          } catch (_) {}
          if (!globalThis.crossOriginIsolated && !alreadyReloaded) {
            log("Reloading once to enable cross-origin isolation");
            try {
              var reloadState = Object.assign({}, history.state);
              reloadState[reloadKey] = true;
              history.replaceState(reloadState, "");
            } catch (_) {}
            try {
              sessionStorage.setItem(reloadKey, "true");
            } catch (_) {}
            location.reload();
            await new Promise(function () {});
          } else if (!globalThis.crossOriginIsolated) {
            fail(
              "Cross-origin isolation was not enabled after reloading; continuing without clangd",
            );
          }
        }
      }

      if (globalThis.crossOriginIsolated) {
        try {
          sessionStorage.removeItem("codeblocks.isolation-reload-attempted");
        } catch (_) {}
      }
      log("Cross-origin isolation: " + globalThis.crossOriginIsolated);
      loadedModule = await modulePromise;
      log("Code block module loaded");
      queuedConfigurations.forEach(loadedModule.configureCodeBlocks);
      api.configure = loadedModule.configureCodeBlocks;
      api.create = loadedModule.createCodeBlock;
      api.get = loadedModule.getCodeBlock;
      api.start = loadedModule.startCodeBlocks;
      api.setEditorMode = loadedModule.setCodeBlocksEditorMode;
      api.setTheme = loadedModule.setCodeBlocksTheme;
      loadedModule.startCodeBlocks();
      log("Code block scan started");
      return api;
    } catch (error) {
      fail(
        "Loader failed: " +
          (error instanceof Error ? error.message : String(error)),
        error,
      );
      throw error;
    }
  })();
})();
