#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "vite";
import crypto from "node:crypto";
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require(
    path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "playwright"),
  ));
}
const output =
  process.env.REFERENCE_EXPORT_OUTPUT ||
  ".evidence/reference-core/stream-browser";
await fs.mkdir(output, { recursive: true });
const server = await createServer({
  server: { host: "127.0.0.1", port: 0, watch: null, hmr: false },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: [
    "--no-sandbox",
    "--autoplay-policy=no-user-gesture-required",
    "--enable-precise-memory-info",
  ],
});
const page = await browser.newPage();
const cdp = await page.context().newCDPSession(page);
const browserCdp = await browser.newBrowserCDPSession();
const report = {
  browser: browser.version(),
  cases: [],
  errors: [],
  scope:
    "Native browser continuous graph and streamed files; not physical Android or listening approval",
};
page.on("pageerror", (e) => report.errors.push(e.message));
let file, hash;
await page.exposeFunction("writeExportBlock", async (encoded) => {
  const block = Buffer.from(encoded, "base64");
  await file.write(block);
  hash.update(block);
});
let currentProgress = 0;
await page.exposeFunction("exportProgress", (v) => {
  currentProgress = v;
});
async function memory() {
  const heap = await cdp.send("Runtime.getHeapUsage");
  let rss = 0;
  for (const p of (await browserCdp.send("SystemInfo.getProcessInfo"))
    .processInfo) {
    try {
      const stat = await fs.readFile(`/proc/${p.id}/status`, "utf8");
      rss += Number(stat.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0) * 1024;
    } catch {}
  }
  return {
    heapUsed: heap.usedSize,
    backingStorage: heap.backingStorageSize ?? null,
    rssBytes: rss,
  };
}
let loaded = false;
async function run(name, options) {
  if (!loaded)
    await page.goto(
      `http://127.0.0.1:${server.httpServer.address().port}/tests/reference-export-browser.html`,
    );
  await page.waitForFunction(() => window.ready);
  loaded = true;
  file = await fs.open(path.join(output, name + ".wav"), "w");
  hash = crypto.createHash("sha256");
  let busy = false,
    lastLogged = -10,
    peak = { heapUsed: 0, backingStorage: 0, rssBytes: 0 };
  const before = await memory();
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const m = await memory();
      if (currentProgress - lastLogged >= 10) {
        console.log(
          JSON.stringify({ name, progress: Math.floor(currentProgress) }),
        );
        lastLogged = currentProgress;
      }
      for (const k of Object.keys(peak)) peak[k] = Math.max(peak[k], m[k] || 0);
    } finally {
      busy = false;
    }
  }, 1000);
  const started = Date.now();
  currentProgress = 0;
  try {
    const result = await page.evaluate(
      (options) => window.runContinuousExport(options),
      options,
    );
    await file.close();
    if (!result.cancelled)
      assert.equal(
        (await fs.stat(path.join(output, name + ".wav"))).size,
        result.expectedSize,
      );
    report.cases.push({
      name,
      ...result,
      wallTimeMs: Date.now() - started,
      sha256: hash.digest("hex"),
      memoryBefore: before,
      memoryPeak: peak,
      memoryAfter: await memory(),
    });
    console.log(JSON.stringify(report.cases.at(-1)));
  } finally {
    clearInterval(timer);
    await file.close().catch(() => {});
    await fs.writeFile(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2),
    );
  }
}
try {
  await run("short-blob", { mode: "blob" });
  await run("short-stream", { mode: "stream" });
  assert.equal(
    report.cases[0].sha256,
    report.cases[1].sha256,
    "Stream must preserve exact existing PCM/header bytes",
  );
  await run("cancel", { mode: "cancel", bars: 32 });
  await run("retry", { mode: "stream" });
  assert.equal(
    report.cases[1].sha256,
    report.cases[3].sha256,
    "Cancellation must release the render guard and preserve later output",
  );
  await run("high-feedback-tail", { highFeedback: true });
  const tailCase = report.cases.at(-1);
  assert.ok(
    tailCase.tailSeconds > 29,
    "High feedback must extend the export tail",
  );
  const tailWav = await fs.readFile(
    path.join(output, "high-feedback-tail.wav"),
  );
  let latePeak = 0;
  const lateFrame = Math.ceil(
    (tailCase.durationSeconds - tailCase.tailSeconds + 8) * tailCase.sampleRate,
  );
  for (let at = 44 + lateFrame * 6; at + 2 < tailWav.length; at += 3) {
    const raw = tailWav[at] | (tailWav[at + 1] << 8) | (tailWav[at + 2] << 16);
    latePeak = Math.max(
      latePeak,
      Math.abs(raw & 0x800000 ? raw - 0x1000000 : raw) / 8388608,
    );
  }
  tailCase.peakAfterOldEightSecondTail = latePeak;
  assert.ok(
    latePeak > 0.0001,
    "Native late tail must contain actual rendered signal beyond the old cut",
  );
  if (process.env.LONG_EXPORT === "1") {
    await run("five-min-48k", {
      bars: 180,
      sampleRate: 48000,
      probeLegacy: true,
    });
    await run("ten-min-48k", {
      bars: 360,
      sampleRate: 48000,
      probeLegacy: true,
    });
  }
  assert.deepEqual(report.errors, []);
  report.status = "PASS";
} catch (e) {
  report.status = "FAIL";
  report.error = e.message;
  throw e;
} finally {
  await fs.writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  await server.close();
}
