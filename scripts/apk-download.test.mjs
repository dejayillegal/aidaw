import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { downloadDebugApk } from '../src/utils/apkDownloader.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

// A document stub lets the old fabricated-download path complete, exposing the bug.
globalThis.document = {
  createElement: () => ({ style: {}, click() {} }),
  body: { appendChild() {}, removeChild() {} },
};

for (const status of [404, 500]) {
  test(`HTTP ${status} must fail without creating an APK`, async () => {
    globalThis.fetch = async () => ({ ok: false, status });
    await assert.rejects(downloadDebugApk());
  });
}
test('an HTML fallback must fail instead of being saved as an APK', async () => {
  globalThis.fetch = async () => ({ ok: true,
    arrayBuffer: async () => new TextEncoder().encode('<!DOCTYPE html>').buffer });
  await assert.rejects(downloadDebugApk());
});
test('network failure must fail without creating an APK', async () => {
  globalThis.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(downloadDebugApk());
});

test('checksum mismatch rejects a truncated or substituted ZIP', async () => {
  const bytes = new Uint8Array([0x50, 0x4b, 3, 4]);
  let request = 0;
  globalThis.fetch = async () => ++request === 1
    ? { ok: true, arrayBuffer: async () => bytes.buffer }
    : { ok: true, json: async () => ({ applicationId: 'com.parametricals.technodaw', sizeBytes: 4, sha256: '0'.repeat(64) }) };
  await assert.rejects(downloadDebugApk(), /checksum/);
});

test('a published package with matching metadata triggers the download', async () => {
  const bytes = new Uint8Array([0x50, 0x4b, 3, 4]);
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  let request = 0;
  let clicked = false;
  globalThis.document.createElement = () => ({ style: {}, click() { clicked = true; }, remove() {} });
  globalThis.fetch = async () => ++request === 1
    ? { ok: true, arrayBuffer: async () => bytes.buffer }
    : { ok: true, json: async () => ({ applicationId: 'com.parametricals.technodaw', sizeBytes: 4, sha256: hash }) };
  assert.deepEqual(await downloadDebugApk(), { sizeBytes: 4, source: 'prebuilt' });
  assert.equal(clicked, true);
});
