import { createServer } from "vite";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url),
  { chromium } = require(
    path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "playwright"),
  );
const root = process.env.REFERENCE_BASELINE_DIR;
if (!root)
  throw Error(
    "Set REFERENCE_BASELINE_DIR to the detached baseline checkout with its dependencies installed",
  );
const output =
  process.env.REFERENCE_BASELINE_OUTPUT ||
  ".evidence/reference-core/baseline-tail";
await fs.mkdir(output, { recursive: true });
const beforePath = path.join(output, "before-high-feedback.wav");
const server = await createServer({
  root,
  server: { host: "127.0.0.1", port: 0, watch: null, hmr: false },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
const file = await fs.open(beforePath, "w"),
  hash = crypto.createHash("sha256");
await page.exposeFunction("saveBlock", async (b) => {
  const bytes = Buffer.from(b, "base64");
  await file.write(bytes);
  hash.update(bytes);
});
try {
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/tests/recovery-browser.html`,
  );
  const result = await page.evaluate(async () => {
    const { buildStarterAbletonXml, parseAlsXmlString } = await import(
      "/src/engine/alsXmlEngine.ts"
    );
    const { DEFAULT_HUMANIZATION: h, DEFAULT_MASTER_BUS: defaults } =
      await import("/src/engine/projectDefaults.ts");
    const { renderArrangementToWavBlob } = await import(
      "/src/engine/webAudioSynth.ts"
    );
    const p = parseAlsXmlString(
      buildStarterAbletonXml("berghain-134", 777, 4).xml,
    );
    p.tempo = 144;
    p.arrangementLengthBars = 4;
    for (const t of p.tracks) t.mixer.delaySend = 0.7;
    const m = { ...defaults, delayFeedback: 0.82 };
    const { blob, durationSeconds } = await renderArrangementToWavBlob(
      p,
      structuredClone(h),
      m,
      4,
      24,
    );
    for (let at = 0; at < blob.size; at += 192 * 1024) {
      const bytes = new Uint8Array(
        await blob.slice(at, at + 192 * 1024).arrayBuffer(),
      );
      let b = "";
      for (const value of bytes) b += String.fromCharCode(value);
      await window.saveBlock(btoa(b));
    }
    return { size: blob.size, durationSeconds };
  });
  await file.close();
  const before = await fs.readFile(beforePath),
    after = await fs.readFile(
      process.env.REFERENCE_TAIL_CANDIDATE ||
        ".evidence/reference-core/stream-browser/high-feedback-tail.wav",
    );
  const report = {
    baseline: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    ...result,
    sha256: hash.digest("hex"),
    prefixPcmIdentical: before
      .subarray(44)
      .equals(after.subarray(44, before.length)),
    afterTailSource:
      process.env.REFERENCE_TAIL_CANDIDATE ||
      ".evidence/reference-core/stream-browser/high-feedback-tail.wav",
  };
  if (!report.prefixPcmIdentical) throw Error("Baseline prefix differs");
  await fs.writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(report);
} finally {
  await file.close().catch(() => {});
  await browser.close();
  await server.close();
}
