#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "vite";
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
  process.env.REFERENCE_UI_OUTPUT || ".evidence/reference-core/stream-ui";
await fs.mkdir(output, { recursive: true });
const server = await createServer({
  server: { host: "127.0.0.1", port: 0, watch: null, hmr: false },
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
page.setDefaultTimeout(30000);
const report = {
  browser: browser.version(),
  steps: [],
  errors: [],
  scope:
    "Visible browser workflow with real file bytes and a simulated destination picker; Android SAF itself remains a hardware gate",
};
page.on("pageerror", (e) => report.errors.push(e.message));
let counter = 0,
  verificationRelease;
const files = new Map();
await page.exposeFunction("openTestDestination", async () => {
  const id = ++counter,
    filename = path.join(output, `save-${id}.wav`),
    handle = await fs.open(filename, "w");
  files.set(id, { handle, filename, aborted: false, closed: false });
  return id;
});
await page.exposeFunction("appendTestDestination", async (id, base64) => {
  await files.get(id).handle.write(Buffer.from(base64, "base64"));
});
await page.exposeFunction("closeTestDestination", async (id) => {
  await files.get(id).handle.close();
  files.get(id).closed = true;
});
await page.exposeFunction("abortTestDestination", async (id) => {
  const f = files.get(id);
  await f.handle.close().catch(() => {});
  await fs.unlink(f.filename).catch(() => {});
  f.aborted = true;
});
await page.exposeFunction("inspectTestDestination", async (id) => {
  if (id === 2) await new Promise((resolve) => {(verificationRelease = resolve)});
  return { size: (await fs.stat(files.get(id).filename)).size };
});
await page.addInitScript(() => {
  window.showSaveFilePicker = async () => {
    const id = await window.openTestDestination();
    return {
      createWritable: async () => ({
        write: async (bytes) => {
          let binary = "";
          for (let i = 0; i < bytes.length; i++)
            binary += String.fromCharCode(bytes[i]);
          await window.appendTestDestination(id, btoa(binary));
        },
        close: () => window.closeTestDestination(id),
        abort: () => window.abortTestDestination(id),
      }),
      getFile: () => window.inspectTestDestination(id),
    };
  };
});
const stage = async (step) => {
  report.steps.push(step);
  console.log(step);
};
try {
  await page.goto(origin + "/tests/reference-export-browser.html");
  await page.waitForFunction(() => window.ready);
  const fixture = await page.evaluate(async () => {
    const { buildStarterAbletonXml, parseAlsXmlString } = await import(
      "/src/engine/alsXmlEngine.ts"
    );
    const { createSongPlan, composeSongPlan } = await import(
      "/src/engine/songPlanEngine.ts"
    );
    const { encodeProjectSnapshot } = await import(
      "/src/services/projectSnapshotService.ts"
    );
    const {
      DEFAULT_HUMANIZATION: h,
      DEFAULT_MASTER_BUS: m,
      DEFAULT_TRANSPORT: t,
    } = await import("/src/engine/projectDefaults.ts");
    let p = parseAlsXmlString(
      buildStarterAbletonXml("berghain-134", 777, 4).xml,
    );
    p.tempo = 144;
    p.arrangementLengthBars = 32;
    p = composeSongPlan(p, createSongPlan(p, 777, "hypnotic_evolving"));
    return encodeProjectSnapshot(p, h, m, t);
  });
  await page.goto(origin);
  await page
    .getByLabel("Open saved DAW project", { exact: true })
    .setInputFiles({
      name: "stream-ui.aidaw.json",
      mimeType: "application/json",
      buffer: Buffer.from(fixture),
    });
  await page
    .getByText(/^Opened stream-ui/)
    .filter({ visible: true })
    .waitFor();
  const snapshot = async () =>
    page.evaluate(async () => {
      const { projectQueueService: q } = await import(
        "/src/services/projectQueueService.ts"
      );
      return q.getItem(q.getActiveQueueId()).workingProjectState;
    });
  const original = await snapshot();
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("button", { name: /Save WAV to File/ }).click();
  const cancel = page.getByRole("button", {
    name: "Cancel export",
    exact: true,
  });
  await cancel.waitFor();
  const box = await cancel.boundingBox();
  assert(
    box &&
      box.height >= 48 &&
      box.x >= 0 &&
      box.x + box.width <= 360 &&
      box.y >= 0 &&
      box.y + box.height <= 640,
    "Phone Cancel export is clipped or too small",
  );
  await cancel.click();
  await page
    .getByText("WAV export cancelled; partial destination discarded.", {
      exact: true,
    })
    .filter({ visible: true })
    .waitFor();
  assert(files.get(1).aborted);
  await stage(
    "Phone export cancels, removes its partial destination and leaves the score unchanged",
  );
  assert.deepEqual((await snapshot()).tracks, original.tracks);
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("button", { name: /Save WAV to File/ }).click();
  await page
    .getByText("Verifying the saved file; please wait...", { exact: true })
    .filter({ visible: true })
    .waitFor({ timeout: 90000 });
  assert(
    await cancel.isDisabled(),
    "Final read-back verification must not expose a misleading cancellation action",
  );
  assert(verificationRelease);
  verificationRelease();
  await page
    .getByText(/^Saved \(file size checked\):/)
    .filter({ visible: true })
    .waitFor();
  assert(files.get(2).closed && !files.get(2).aborted);
  const wave = await fs.readFile(files.get(2).filename);
  assert.equal(wave.subarray(0, 4).toString(), "RIFF");
  assert.equal(wave.readUInt32LE(24), 48000);
  assert.deepEqual((await snapshot()).tracks, original.tracks);
  await stage(
    "Retry completes a real 48k WAV, with final verification and no project/history mutation",
  );
  await page.screenshot({
    path: path.join(output, "phone-export-complete.png"),
  });
  assert.deepEqual(report.errors, []);
  report.status = "PASS";
  report.savedFile = files.get(2).filename;
  report.savedBytes = wave.length;
} catch (e) {
  report.status = "FAIL";
  report.error = e.message;
  await page.screenshot({
    path: path.join(output, "failure.png"),
    fullPage: true,
  });
  throw e;
} finally {
  await fs.writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  await server.close();
}
