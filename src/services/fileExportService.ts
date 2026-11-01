import { Capacitor, registerPlugin } from '@capacitor/core';

interface NativeFileExport {
  begin(options: { filename: string; mimeType: string }): Promise<void>;
  append(options: { base64: string }): Promise<void>;
  finish(options: { sizeBytes: number }): Promise<{ uri: string; sizeBytes: number; sha256: string }>;
  abort(): Promise<void>;
}
const nativeExport = registerPlugin<NativeFileExport>('FileExport');
let saving = false;

/** Native success means closed, reopened and SHA-256 verified. Browser success means download requested. */
export async function saveExportBlob(blob: Blob, filename: string): Promise<{ verified: boolean; uri?: string }> {
  if (saving) throw new Error('SAVE_BUSY: another save is in progress');
  if (!blob.size) throw new Error('SAVE_EMPTY: no output to save');
  saving = true;
  try {
    const safeName = filename.replace(/[\\/\x00-\x1f]/g, '_');
    if (Capacitor.isNativePlatform()) {
      if (Capacitor.getPlatform() !== 'android') throw new Error('SAVE_UNSUPPORTED: native file export requires Android');
      await nativeExport.begin({ filename: safeName, mimeType: blob.type || 'application/octet-stream' });
      try {
        for (let offset = 0; offset < blob.size; offset += 192 * 1024) {
          const bytes = new Uint8Array(await blob.slice(offset, offset + 192 * 1024).arrayBuffer());
          // No whole-file base64 string or argument stack overflow on full arrangements.
          let binary = '';
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          await nativeExport.append({ base64: btoa(binary) });
        }
        const result = await nativeExport.finish({ sizeBytes: blob.size });
        if (result.sizeBytes !== blob.size || !/^[a-f0-9]{64}$/i.test(result.sha256)) {
          throw new Error('SAVE_VERIFY: native read-back verification missing');
        }
        return { verified: true, uri: result.uri };
      } catch (error) {
        await nativeExport.abort().catch(() => {});
        throw error;
      }
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = safeName;
    document.body.appendChild(link);
    try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
    return { verified: false };
  } finally { saving = false; }
}
