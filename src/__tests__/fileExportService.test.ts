import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ begin: vi.fn(), append: vi.fn(), finish: vi.fn(), abort: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' }, registerPlugin: () => native }));
import { saveExportBlob } from '../services/fileExportService';
beforeEach(() => { vi.resetAllMocks(); native.begin.mockResolvedValue(undefined); native.append.mockResolvedValue(undefined); native.abort.mockResolvedValue(undefined); native.finish.mockResolvedValue({ uri: 'content://fixture/song.wav', sizeBytes: 500000, sha256: 'a'.repeat(64) }); });
afterEach(() => vi.restoreAllMocks());
describe('Android file export boundary', () => {
  it('streams bounded chunks and reports verified only after native read-back', async () => {
    const blob = new Blob([new Uint8Array(500000)], { type: 'audio/wav' });
    const result = await saveExportBlob(blob, 'song.wav');
    expect(native.append.mock.calls.length).toBe(3);
    expect(native.append.mock.calls.every(([arg]) => arg.base64.length <= 262144)).toBe(true);
    expect(native.finish).toHaveBeenCalledWith({ sizeBytes: blob.size });
    expect(result).toEqual({ verified: true, uri: 'content://fixture/song.wav' });
  });
  it('cleans partial documents and propagates write errors', async () => {
    native.append.mockRejectedValueOnce(new Error('SAVE_WRITE'));
    await expect(saveExportBlob(new Blob(['audio']), 'song.wav')).rejects.toThrow('SAVE_WRITE');
    expect(native.abort).toHaveBeenCalledOnce();
    expect(native.finish).not.toHaveBeenCalled();
  });
  it('rejects failed native verification instead of claiming a saved file', async () => {
    native.finish.mockResolvedValueOnce({ sizeBytes: 0, sha256: '' });
    await expect(saveExportBlob(new Blob(['audio']), 'song.wav')).rejects.toThrow('SAVE_VERIFY');
    expect(native.abort).toHaveBeenCalledOnce();
  });
  it('propagates picker cancellation without writing', async () => {
    native.begin.mockRejectedValueOnce(new Error('SAVE_CANCELLED'));
    await expect(saveExportBlob(new Blob(['audio']), 'song.wav')).rejects.toThrow('SAVE_CANCELLED');
    expect(native.append).not.toHaveBeenCalled();
  });
  it('prevents concurrent destination writers', async () => {
    let release!: () => void;
    native.begin.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const saving = saveExportBlob(new Blob([new Uint8Array(500000)]), 'one.wav');
    await expect(saveExportBlob(new Blob(['two']), 'two.wav')).rejects.toThrow('SAVE_BUSY');
    release(); await saving;
  });
});
