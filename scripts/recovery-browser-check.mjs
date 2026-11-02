#!/usr/bin/env node
/** Real Chromium audio and responsive settings regression; no Android certification. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { runTrackWorkflows, runSessionWorkflows } from './track-workflows-check.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let chromium;
let playwrightVersion;
try { ({ chromium } = require('playwright')); playwrightVersion = require('playwright/package.json').version; }
catch (error) {
  if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw error;
  ({ chromium } = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright')));
  playwrightVersion = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/package.json')).version;
}
const output = process.env.RECOVERY_BROWSER_OUTPUT || await fs.mkdtemp(path.join(os.tmpdir(), 'aidaw-browser-'));
await fs.mkdir(output, { recursive: true });
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: false } });
let browser;
const report = { engine: 'Chromium real Web Audio', scope: 'Browser; Android device qualification remains separate',
  audio: [], responsive: [], pageErrors: [], consoleErrors: [], warnings: [] };
try {
  await server.listen();
  const address = server.httpServer.address();
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}),
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  report.browserVersion = browser.version(); report.playwrightVersion = playwrightVersion;
  const context = await browser.newContext();
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await context.newPage();
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
    if (message.type() === 'warning') report.warnings.push(message.text());
    if (message.text().startsWith('RECOVERY_STAGE')) console.log(message.text());
  });
  page.setDefaultTimeout(20000);
  await page.goto(`${origin}/tests/recovery-browser.html`);
  await page.waitForFunction(() => typeof window.recovery?.runAudioCase === 'function');
  report.transport = await page.evaluate(() => window.recovery.runTransportCase());
  console.log(JSON.stringify({ transport: report.transport }));
  report.projectRecovery = await page.evaluate(() => window.recovery.runRecoveryCase());
  console.log(JSON.stringify({ projectRecovery: report.projectRecovery }));
  await page.evaluate(() => window.recovery.futureUiJournal('seed'));
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(origin);
  await page.getByRole('alert').filter({ hasText: /^Recovery blocked: RECOVERY_VERSION/ }).waitFor({ state: 'visible' });
  await page.goto(`${origin}/tests/recovery-browser.html`);
  await page.waitForFunction(() => typeof window.recovery?.futureUiJournal === 'function');
  report.futureRecoveryUi = await page.evaluate(() => window.recovery.futureUiJournal('verify'));
  console.log(JSON.stringify({ futureRecoveryUi: report.futureRecoveryUi }));
  for (const testCase of [...Array.from({ length: 20 }, () => ({ bars: 4 })), { bars: 64 }, { bars: 4, master: true }]) {
    console.log(`Rendering ${testCase.bars} bars${testCase.master ? ' / mastering' : ''} in Chromium...`);
    let timeout;
    const result = await Promise.race([
      page.evaluate((cfg) => window.recovery.runAudioCase(cfg), testCase),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Browser audio regression exceeded 180 seconds')), 180000); }),
    ]).finally(() => clearTimeout(timeout));
    report.audio.push(result);
    console.log(JSON.stringify(result));
  }
  for (const repeat of report.audio.slice(1, 20)) assert(repeat.repeatMaxAbsoluteError < 0.001 && repeat.repeatRmsError < 0.0001, 'Repeated native DSP output exceeded numeric tolerance');
  report.probabilityOffline = await page.evaluate(() => window.recovery.runProbabilityCase());
  console.log(JSON.stringify({ probabilityOffline: report.probabilityOffline }));
  report.trackWorkflows = await runTrackWorkflows(page, origin, output);
  console.log(JSON.stringify({ trackWorkflows: report.trackWorkflows }));
  report.sessionWorkflows = await runSessionWorkflows(page,origin,output);
  console.log(JSON.stringify({ sessionWorkflows: report.sessionWorkflows }));
  await page.goto(origin);
  const settings = page.getByTitle('Open DAW Workstation Settings');
  await settings.waitFor({ state: 'visible' });
  for (const viewport of [{ name: 'compact', width: 360, height: 640 },
    { name: 'unfolded', width: 900, height: 720 }, { name: 'landscape', width: 800, height: 360 }]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await settings.click();
    const close = page.getByRole('button', { name: 'Close settings', exact: true }).first();
    await close.waitFor({ state: 'visible' });
    for (const label of ['Audio Engine DSP', 'Mastering & Export', 'Appearance & Theme']) {
      await page.getByRole('button', { name: label, exact: true }).click();
    }
    const topClose = await close.boundingBox();
    assert(topClose && topClose.x >= 0 && topClose.y >= 0 &&
      topClose.x + topClose.width <= viewport.width + 1 && topClose.y + topClose.height <= viewport.height + 1,
    `${viewport.name}: settings close control is clipped`);
    const footerClose = page.getByRole('button', { name: 'Close settings', exact: true }).last();
    await footerClose.scrollIntoViewIfNeeded();
    const bottomClose = await footerClose.boundingBox();
    assert(bottomClose && bottomClose.y >= 0 && bottomClose.y + bottomClose.height <= viewport.height + 1,
      `${viewport.name}: settings footer is clipped`);
    const screenshot = path.join(output, `settings-${viewport.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    report.responsive.push({ ...viewport, topClose, bottomClose, screenshot });
    await close.click();
    console.log(`Settings reachable at ${viewport.width}×${viewport.height}`);
  }
  await page.goto(`${origin}/tests/recovery-browser.html`);
  await page.waitForFunction(() => typeof window.recovery?.runTimeoutGuardCase === 'function');
  report.timeoutGuard = await page.evaluate(() => window.recovery.runTimeoutGuardCase());

  assert.deepEqual(report.pageErrors, [], 'Uncaught browser runtime errors');
  assert.deepEqual(report.consoleErrors, [], 'Browser console errors');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.error = error.stack || String(error);
  process.exitCode = 1;
  console.error(report.error);
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (browser) await browser.close();
  await server.close();
  console.log(`Browser evidence: ${path.join(output, 'report.json')}`);
}
