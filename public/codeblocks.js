(function () {
  "use strict";

  var script = document.currentScript;
  if (!script || !script.src) throw new Error("codeblocks.js requires a script URL");
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
    var serviceWorker = script.getAttribute("data-coi-serviceworker");
    if (serviceWorker !== null && !globalThis.crossOriginIsolated && "serviceWorker" in navigator) {
      await navigator.serviceWorker.register(
        new URL(serviceWorker || "./coi-serviceworker.js", script.src),
        { scope: "./" },
      );
      await navigator.serviceWorker.ready;
      if (!globalThis.crossOriginIsolated) {
        location.reload();
        await new Promise(function () {});
      }
    }

    loadedModule = await import(new URL("./codeblocks-module.js", script.src).href);
    queuedConfigurations.forEach(loadedModule.configureCodeBlocks);
    api.configure = loadedModule.configureCodeBlocks;
    api.create = loadedModule.createCodeBlock;
    api.get = loadedModule.getCodeBlock;
    api.start = loadedModule.startCodeBlocks;
    loadedModule.startCodeBlocks();
    return api;
  })();
})();
