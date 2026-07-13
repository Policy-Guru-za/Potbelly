import { injectManifest } from "workbox-build";

const result = await injectManifest({
  swSrc: ".sw-build/sw-template.js",
  swDest: "dist/sw.js",
  globDirectory: "dist",
  globPatterns: ["**/*.{html,js,css,json,webmanifest,svg,png,ttf}"],
  globIgnores: ["sw.js", "pdfs/**", "build-report.json"],
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
});

if (result.warnings.length) {
  throw new Error(result.warnings.join("\n"));
}
console.log(JSON.stringify({ event: "service_worker_built", precached: result.count, bytes: result.size }));
