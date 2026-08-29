import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = new URL("../dist/", import.meta.url).pathname;
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
};

function pathFor(url) {
  const pathname = decodeURIComponent(url.split("?")[0]);
  const relative = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  return join(root, relative === "/" ? "index.html" : relative);
}

function serve(port, headers = {}) {
  createServer((request, response) => {
    const path = pathFor(request.url ?? "/");
    const send = () => {
      if (!existsSync(path) || !statSync(path).isFile()) {
        response.writeHead(404, headers);
        response.end("Not found");
        return;
      }
      response.writeHead(200, {
        ...headers,
        "Content-Type": types[extname(path)] ?? "application/octet-stream",
        "Content-Length": statSync(path).size,
      });
      createReadStream(path).pipe(response);
    };
    const delay = Number(
      new URL(request.url ?? "/", `http://localhost:${port}`)
        .searchParams.get("delay"),
    ) || 0;
    if (delay && path.endsWith("codeblocks-module.js")) setTimeout(send, delay);
    else send();
  }).listen(port, "127.0.0.1", () => {
    console.log(`Listening at http://localhost:${port}`);
  });
}

serve(4173);
serve(4174, {
  "Access-Control-Allow-Origin": "*",
  "Cross-Origin-Resource-Policy": "cross-origin",
});
serve(4175);
