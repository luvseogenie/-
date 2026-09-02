/**
 * 확장 프로그램 번들러.
 *   node build.mjs           1회 빌드
 *   node build.mjs --watch   변경 감지 빌드
 *
 * 결과물은 dist/ 에 생성된다. chrome://extensions → "압축해제된 확장 프로그램을 로드" → dist 선택.
 *
 * content script는 MV3에서 ES module로 주입할 수 없으므로 IIFE로 번들한다.
 * service worker와 popup은 module로 번들한다.
 */
import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const watch = process.argv.includes("--watch");
const outdir = "dist";
const alias = { "@": path.resolve("src") };

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

/** content script: IIFE (MV3 제약) */
const contentOptions = {
  entryPoints: { content: "src/content/content.ts", bridge: "src/content/bridge.ts" },
  bundle: true,
  format: "iife",
  target: "chrome110",
  outdir,
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  logLevel: "info",
  alias,
};

/** service worker + popup: ESM */
const moduleOptions = {
  ...contentOptions,
  entryPoints: {
    service_worker: "src/background/service_worker.ts",
    popup: "src/popup/popup.ts",
  },
  format: "esm",
};

/**
 * DevTools 콘솔에 붙여넣는 진단 스크립트.
 * 확장을 설치하지 않아도 쓸 수 있도록 별도 파일로 만든다.
 * minify하지 않아야 사용자가 내용을 확인하고 붙여넣기 편하다.
 */
const consoleOptions = {
  ...contentOptions,
  entryPoints: { "selector-dump": "src/console/selector_dump.ts" },
  format: "iife",
  minify: false,
  sourcemap: false,
};

async function copyStatic() {
  await cp("manifest.json", path.join(outdir, "manifest.json"));
  await cp("src/popup/popup.html", path.join(outdir, "popup.html"));
  await cp("src/popup/popup.css", path.join(outdir, "popup.css"));
  await cp("public", outdir, { recursive: true });
}

if (watch) {
  const contexts = await Promise.all([
    esbuild.context(contentOptions),
    esbuild.context(moduleOptions),
    esbuild.context(consoleOptions),
  ]);
  await Promise.all(contexts.map((c) => c.watch()));
  await copyStatic();
  console.log("watching...");
} else {
  await Promise.all([
    esbuild.build(contentOptions),
    esbuild.build(moduleOptions),
    esbuild.build(consoleOptions),
  ]);
  await copyStatic();
  console.log("빌드 완료 → dist/  (chrome://extensions 에서 dist 폴더를 로드하세요)");
}
