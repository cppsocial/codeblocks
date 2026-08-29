import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
};

function safePath(directory, requestPath) {
  const decoded = decodeURIComponent(requestPath.split("?")[0]);
  const relative = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
  return join(directory, relative === "/" ? "index.html" : relative);
}

function staticServer(port, resolvePath, headers) {
  return createServer((request, response) => {
    const path = resolvePath(request.url ?? "/");
    const send = () => {
      if (!path || !existsSync(path) || !statSync(path).isFile()) {
        response.writeHead(404, headers);
        response.end("Not found");
        return;
      }
      response.writeHead(200, {
        ...headers,
        "Content-Type": mime[extname(path)] ?? "application/octet-stream",
        "Content-Length": statSync(path).size,
      });
      createReadStream(path).pipe(response);
    };
    const delay = Number(new URL(request.url ?? "/", `http://localhost:${port}`).searchParams.get("delay")) || 0;
    if (delay && path?.endsWith("editor.js")) setTimeout(send, delay);
    else send();
  }).listen(port, "127.0.0.1", () =>
    console.log(`Listening at http://localhost:${port}`),
  );
}

const hostHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};
const runtimeHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

staticServer(4173, (url) => safePath(join(root, "demo"), url), hostHeaders);
staticServer(4174, (url) => safePath(join(root, "dist"), url), runtimeHeaders);
staticServer(4175, (url) => {
  if (url.startsWith("/assets/clangd/")) {
    return safePath(join(root, "dist"), url.slice("/assets/clangd".length));
  }
  return safePath(join(root, "demo"), url);
}, hostHeaders);
staticServer(4176, (url) => safePath(join(root, "demo"), url), {});
