import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const processMock = vi.hoisted(() => ({ execFileSync: vi.fn() }));
vi.mock('node:child_process', () => processMock);
import { computeSha256, publishArtifacts } from '../../scripts/build-debug-apk.mjs';
const roots: string[] = [];
afterEach(() => { vi.resetAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidaw-publication-')); roots.push(root);
  fs.mkdirSync(path.join(root, 'public')); fs.mkdirSync(path.join(root, 'android/app/build/outputs/apk/debug'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public/apk-metadata.json'), JSON.stringify({ applicationId: 'com.parametricals.technodaw', versionCode: 2, versionName: '7.2.0' }));
  fs.writeFileSync(path.join(root, 'public/parametric-techno-daw-debug.apk'), 'existing published artifact');
  fs.writeFileSync(path.join(root, 'android/app/build/outputs/apk/debug/app-debug.apk'), 'fresh fixture');
  return root;
}
describe('Release publication safety', () => {
  it('does not overwrite distribution when verification fails', () => {
    const root = fixture(); const before = fs.readFileSync(path.join(root, 'public/apk-metadata.json'), 'utf8');
    processMock.execFileSync.mockImplementation(() => { throw new Error('Signature invalid'); });
    expect(() => publishArtifacts(root)).toThrow('Signature invalid');
    expect(fs.readFileSync(path.join(root, 'public/parametric-techno-daw-debug.apk'), 'utf8')).toBe('existing published artifact');
    expect(fs.readFileSync(path.join(root, 'public/apk-metadata.json'), 'utf8')).toBe(before);
  });
  it('blocks an unpinned signing identity', () => {
    const root = fixture(); processMock.execFileSync.mockReturnValue(JSON.stringify({ certificatePinned: false }));
    expect(() => publishArtifacts(root)).toThrow('trusted baseline');
  });
  it('publishes only the verified bytes and does not imply install/launch qualification', () => {
    const root = fixture(); const apk = Buffer.from('fresh fixture');
    processMock.execFileSync.mockReturnValue(JSON.stringify({ status: 'artifact-verified', certificatePinned: true,
      sha256: computeSha256(apk), sizeBytes: apk.length, installLaunchVerified: false }));
    const result = publishArtifacts(root);
    expect(result.metadata.verificationStatus).toBe('artifact-verified');
    expect(result.metadata.installLaunchVerified).toBe(false);
    expect(fs.readFileSync(path.join(root, 'public/parametric-techno-daw-debug.apk'))).toEqual(apk);
  });
});
