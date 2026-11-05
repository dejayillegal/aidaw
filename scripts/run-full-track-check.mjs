import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { runFullTrackWorkflow } from './full-track-workflow-check.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const output = process.env.FULL_TRACK_OUTPUT || '/tmp/aidaw-full-track-check';
await fs.mkdir(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
let page;
const report = { pageErrors: [], scope: 'Visible creation and persistence workflow; musical listening and Android qualification remain separate' };
try {
  await server.listen();
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}),
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  report.browserVersion = browser.version();
  const context = await browser.newContext({ acceptDownloads: true });
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, r => r.fulfill({ status: 200, body: '' }));
  page = await context.newPage();
  page.on('pageerror', e => report.pageErrors.push(e.message));
  report.workflow = await runFullTrackWorkflow(page, `http://127.0.0.1:${server.httpServer.address().port}`, output);
  if (report.pageErrors.length) throw new Error('Uncaught browser exceptions');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.error = String(error); process.exitCode = 1;
  if (page) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    await fs.writeFile(path.join(output, 'failure-body.txt'), await page.locator('body').innerText()).catch(() => {}); }
}
finally { await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); await browser?.close(); await server.close(); }
console.log(JSON.stringify(report));
