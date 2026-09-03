/* Enabled only when the host opts in with data-coi-serviceworker. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (event) => {
  if (new URL(event.request.url).origin !== self.location.origin) return;
  // COOP and COEP are document policies. Same-origin subresources already
  // satisfy COEP, so leaving them alone also avoids reload-time cancellation
  // noise for stylesheets and modules.
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    (async () => {
      let response;
      try {
        response = await fetch(event.request);
      } catch (_) {
        // A navigation/reload can cancel in-flight subresource requests. Resolve
        // respondWith instead of turning that ordinary cancellation into an
        // unhandled service-worker rejection in the browser console.
        return Response.error();
      }
      if (response.status === 0) return response;
      const headers = new Headers(response.headers);
      headers.set("Cross-Origin-Embedder-Policy", "require-corp");
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    })(),
  );
});
