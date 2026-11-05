#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "vite";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { chromium } = require(
  path.join(
    process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || ".",
    "playwright",
  ),
);
const output = process.env.SONG_QUALITY_OUTPUT || ".evidence/composition/audio";
await fs.mkdir(output, { recursive: true });
const server = await createServer({
  server: { host: "127.0.0.1", port: 0, watch: { ignored: ["**/*"] } },
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
let sourceSha = process.env.GITHUB_SHA || '1844666164b35a0a68b7ddb0ee31d1ab90765f23';
try {
  sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {}
const report = {
  source: sourceSha,
  browser: browser.version(),
  origin,
  calibration: null,
  cases: [],
  errors: [],
};
page.on("console", (m) => {
  if (m.text().startsWith("SONG_STAGE")) console.log(m.text());
});
page.on("pageerror", (e) => report.errors.push(e.message));
try {
  await page.goto(`${origin}/tests/song-quality-browser.html`);
  await page.waitForFunction(() => window.songQuality);
  report.calibration = await page.evaluate(() =>
    window.songQuality.calibrate(),
  );
  console.log(JSON.stringify(report.calibration));
  report.pitchContract = await page.evaluate(() =>
    window.songQuality.pitchContract(),
  );
  console.log(JSON.stringify(report.pitchContract));
  const cases = process.env.SONG_QUALITY_CASES
    ? JSON.parse(process.env.SONG_QUALITY_CASES)
    : [
        { before: true },
        {},
        { stem: "acid" },
        { stem: "rumble" },
        { style: "dub_space", seed: 913 },
        { style: "detroit_funk", seed: 1234 },
      ];
  for (const config of cases) {
    const name = config.before
      ? "before"
      : config.stem
        ? `stem-${config.stem}`
        : config.style || "after";
    console.log(`Rendering ${name}`);
    const result = await page.evaluate(
      (config) =>
        window.songQuality.generate({ bars: 64, seed: 777, ...config }),
      config,
    );
    const bytes = Buffer.from(result.base64, "base64");
    await fs.writeFile(path.join(output, `${name}.wav`), bytes);
    await fs.writeFile(
      path.join(output, `${name}.aidaw.json`),
      result.snapshot,
    );
    await fs.writeFile(
      path.join(output, `${name}-arrangement.json`),
      JSON.stringify(
        { plan: result.plan, arrangement: result.arrangement },
        null,
        2,
      ),
    );
    report.cases.push({
      ...result.metrics,
      file: `${name}.wav`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    console.log(JSON.stringify(report.cases.at(-1)));
    await fs.writeFile(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2),
    );
  }
} catch (e) {
  report.errors.push(e.message);
  throw e;
} finally {
  await fs.writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  await server.close();
}
