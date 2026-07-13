/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { ExpirationPlugin } from "workbox-expiration";
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst, NetworkOnly } from "workbox-strategies";

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision?: string }> };

precacheAndRoute(self.__WB_MANIFEST, { cleanURLs: true });
cleanupOutdatedCaches();
clientsClaim();

registerRoute(({ url }) => url.pathname.startsWith("/api/"), new NetworkOnly());
registerRoute(
  ({ url }) => url.pathname.startsWith("/pdfs/") && url.pathname.endsWith(".pdf"),
  new CacheFirst({
    cacheName: "potbelly-pdfs-v1",
    plugins: [new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 90, purgeOnQuotaError: true }) as never],
  }),
);
registerRoute(
  ({ request }) => request.mode === "navigate",
  async ({ request, event }) => {
    try {
      return await new NetworkFirst({ cacheName: "potbelly-pages-v1", networkTimeoutSeconds: 3 }).handle({ request, event });
    } catch {
      const url = new URL(request.url);
      const recipe = url.pathname.match(/^\/recipe\/([a-z0-9-]+)\/?$/)?.[1];
      if (recipe) {
        const response = await matchPrecache(`/recipe/${recipe}.html`);
        if (response) return response;
      }
      return await matchPrecache("/offline.html") ?? Response.error();
    }
  },
);

self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | null)?.type === "SKIP_WAITING") void self.skipWaiting();
});
