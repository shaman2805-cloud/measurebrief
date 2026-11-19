import { createHash } from "node:crypto";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "measurebrief-offline-worksheet",
      enforce: "post",
      generateBundle(_, files) {
        const paths = Object.keys(files)
          .filter((path) => /\.(?:js|css|html|woff2?)$/.test(path))
          .sort();
        if (!paths.includes("index.html")) paths.push("index.html");
        const hash = createHash("sha256");
        for (const path of paths) {
          const entry = files[path];
          hash.update(path);
          if (entry)
            hash.update(entry.type === "chunk" ? entry.code : entry.source);
        }
        const revision = hash.digest("hex").slice(0, 16);
        this.emitFile({
          type: "asset",
          fileName: "sw.js",
          source: `
const scope = self.registration.scope;
const prefix = 'measurebrief:' + scope + ':';
const key = prefix + '${revision}';
const paths = ${JSON.stringify(paths)}.map(path => new URL(path, scope).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(key).then(cache => cache.addAll(paths)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(old => old.startsWith(prefix) && old !== key).map(old => caches.delete(old)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const base = new URL(scope);
  const index = new URL('index.html', scope);
  const appNavigation = event.request.mode === 'navigate' && (url.pathname === base.pathname || url.pathname === index.pathname);
  const target = appNavigation ? index.href : url.href;
  if (!paths.includes(target)) return;
  event.respondWith(caches.open(key).then(cache => cache.match(target)).then(hit => hit || fetch(event.request)));
});`,
        });
      },
    },
  ],
});
