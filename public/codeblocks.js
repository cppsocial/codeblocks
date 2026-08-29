(function () {
  "use strict";

  var script = document.currentScript;
  if (!script || !script.src) throw new Error("codeblocks.js requires a script URL");
  var debug = script.hasAttribute("data-debug");
  var serviceWorker = script.getAttribute("data-coi-serviceworker");
  var localHost = /^(localhost|127(?:\.\d+){3}|\[::1\])$/.test(location.hostname);
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

  api.ready = (async function () {
    try {
      if (serviceWorker !== null && !globalThis.crossOriginIsolated) {
        if (!("serviceWorker" in navigator)) {
          fail("Service workers are unavailable; clangd cannot enable cross-origin isolation");
        } else {
          var workerUrl = new URL(serviceWorker || "./coi-serviceworker.js", script.src);
          log("Registering isolation service worker at " + workerUrl.href);
          await navigator.serviceWorker.register(workerUrl, { scope: "./" });
          await navigator.serviceWorker.ready;
          log("Isolation service worker activated");
          if (!globalThis.crossOriginIsolated) {
            log("Reloading once to enable cross-origin isolation");
            location.reload();
            await new Promise(function () {});
          }
        }
      }

      log("Cross-origin isolation: " + globalThis.crossOriginIsolated);
      loadedModule = await import(new URL("./codeblocks-module.js", script.src).href);
      log("Code block module loaded");
      queuedConfigurations.forEach(loadedModule.configureCodeBlocks);
      api.configure = loadedModule.configureCodeBlocks;
      api.create = loadedModule.createCodeBlock;
      api.get = loadedModule.getCodeBlock;
      api.start = loadedModule.startCodeBlocks;
      loadedModule.startCodeBlocks();
      log("Code block scan started");
      return api;
    } catch (error) {
      fail("Loader failed: " + (error instanceof Error ? error.message : String(error)), error);
      throw error;
    }
  })();
})();
