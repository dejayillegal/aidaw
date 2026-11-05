import { Capacitor, registerPlugin } from "@capacitor/core";

interface NativeFileExport {
  begin(options: { filename: string; mimeType: string }): Promise<void>;
  append(options: { base64: string }): Promise<void>;
  finish(options: {
    sizeBytes: number;
  }): Promise<{ uri: string; sizeBytes: number; sha256: string }>;
  abort(): Promise<void>;
}
const nativeExport = registerPlugin<NativeFileExport>("FileExport");
let saving = false;
// File destinations must reject path separators and ASCII control bytes.
// eslint-disable-next-line no-control-regex -- This range deliberately sanitizes control bytes in filenames.
const unsafeFilenameCharacters = /[\\/\x00-\x1f]/g;

/** Native success means closed, reopened and SHA-256 verified. Browser success means download requested. */
export async function saveExportBlob(
  blob: Blob,
  filename: string,
): Promise<{ verified: boolean; uri?: string }> {
  if (saving) throw new Error("SAVE_BUSY: another save is in progress");
  if (!blob.size) throw new Error("SAVE_EMPTY: no output to save");
  saving = true;
  try {
    const safeName = filename.replace(unsafeFilenameCharacters, "_");
    if (Capacitor.isNativePlatform()) {
      if (Capacitor.getPlatform() !== "android")
        throw new Error(
          "SAVE_UNSUPPORTED: native file export requires Android",
        );
      await nativeExport.begin({
        filename: safeName,
        mimeType: blob.type || "application/octet-stream",
      });
      try {
        for (let offset = 0; offset < blob.size; offset += 192 * 1024) {
          const bytes = new Uint8Array(
            await blob.slice(offset, offset + 192 * 1024).arrayBuffer(),
          );
          // No whole-file base64 string or argument stack overflow on full arrangements.
          let binary = "";
          for (let i = 0; i < bytes.length; i++)
            binary += String.fromCharCode(bytes[i]);
          await nativeExport.append({ base64: btoa(binary) });
        }
        const result = await nativeExport.finish({ sizeBytes: blob.size });
        if (
          result.sizeBytes !== blob.size ||
          !/^[a-f0-9]{64}$/i.test(result.sha256)
        ) {
          throw new Error("SAVE_VERIFY: native read-back verification missing");
        }
        return { verified: true, uri: result.uri };
      } catch (error) {
        await nativeExport.abort().catch(() => {});
        throw error;
      }
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = safeName;
    document.body.appendChild(link);
    try {
      link.click();
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    return { verified: false };
  } finally {
    saving = false;
  }
}

export type ExportByteWriter = (block: Uint8Array) => Promise<void>;
interface BrowserSaveHandle {
  createWritable(): Promise<{
    write: (bytes: Uint8Array) => Promise<void>;
    close: () => Promise<void>;
    abort: () => Promise<void>;
  }>;
  getFile(): Promise<{ size: number }>;
}
const browserPicker = () =>
  typeof window === "undefined"
    ? undefined
    : (
        window as unknown as {
          showSaveFilePicker?: (options: unknown) => Promise<BrowserSaveHandle>;
        }
      ).showSaveFilePicker;
export function supportsStreamingFileExport(): boolean {
  return Capacitor.isNativePlatform()
    ? Capacitor.getPlatform() === "android"
    : typeof browserPicker() === "function";
}
/** A backpressured file destination: never retains a whole encoded WAV or base64 string. */
export async function saveExportStream(
  filename: string,
  sizeBytes: number,
  produce: (write: ExportByteWriter) => Promise<unknown>,
  signal?: AbortSignal,
  onPhase?: (
    phase: "selecting" | "rendering" | "writing" | "verifying",
  ) => void,
): Promise<{
  verified: boolean;
  uri?: string;
  method: "native" | "file-system";
}> {
  if (saving) throw new Error("SAVE_BUSY: another save is in progress");
  if (
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > 0x7fffffff
  )
    throw new Error("SAVE_SIZE: invalid output byte count");
  const check = () => {
    if (signal?.aborted)
      throw new DOMException("Export cancelled", "AbortError");
  };
  const safeName = filename.replace(unsafeFilenameCharacters, "_");
  saving = true;
  let opened = false,
    written = 0;
  let append: (block: Uint8Array) => Promise<void>,
    close: () => Promise<{
      verified: boolean;
      uri?: string;
      method: "native" | "file-system";
    }>,
    abort: () => Promise<void>;
  let pending = Promise.resolve();
  let acceptingWrites = true;
  try {
    check();
    onPhase?.("selecting");
    if (Capacitor.isNativePlatform()) {
      if (Capacitor.getPlatform() !== "android")
        throw new Error(
          "SAVE_UNSUPPORTED: native file export requires Android",
        );
      await nativeExport.begin({ filename: safeName, mimeType: "audio/wav" });
      opened = true;
      append = async (bytes) => {
        let binary = "";
        for (let i = 0; i < bytes.length; i++)
          binary += String.fromCharCode(bytes[i]);
        await nativeExport.append({ base64: btoa(binary) });
      };
      abort = () => nativeExport.abort();
      close = async () => {
        const result = await nativeExport.finish({ sizeBytes });
        if (
          result.sizeBytes !== sizeBytes ||
          !/^[a-f0-9]{64}$/i.test(result.sha256)
        )
          throw new Error("SAVE_VERIFY: native read-back verification missing");
        return { verified: true, uri: result.uri, method: "native" };
      };
    } else {
      const picker = browserPicker();
      if (!picker)
        throw new Error(
          "SAVE_STREAM_UNSUPPORTED: this browser needs the bounded Blob download path",
        );
      const handle = await picker.call(window, {
        suggestedName: safeName,
        types: [
          { description: "Wave audio", accept: { "audio/wav": [".wav"] } },
        ],
      });
      const destination = await handle.createWritable();
      opened = true;
      append = (bytes) => destination.write(bytes);
      abort = () => destination.abort();
      close = async () => {
        await destination.close();
        if ((await handle.getFile()).size !== sizeBytes)
          throw new Error("SAVE_VERIFY: browser file size mismatch");
        return { verified: false, method: "file-system" };
      };
    }
    check();
    const write: ExportByteWriter = (block) => {
      if (!acceptingWrites)
        return Promise.reject(
          new Error("SAVE_CLOSED: producer already finished"),
        );
      pending = pending.then(async () => {
        check();
        if (written === 0) onPhase?.("writing");
        if (written + block.byteLength > sizeBytes)
          throw new Error("SAVE_SIZE: producer exceeded declared output");
        for (let start = 0; start < block.byteLength; start += 192 * 1024) {
          check();
          const chunk = block.subarray(
            start,
            Math.min(block.byteLength, start + 192 * 1024),
          );
          await append(chunk);
          written += chunk.byteLength;
        }
      });
      return pending;
    };
    onPhase?.("rendering");
    await produce(write);
    acceptingWrites = false;
    await pending;
    check();
    if (written !== sizeBytes) throw new Error("SAVE_SIZE: incomplete output");
    onPhase?.("verifying");
    const result = await close();
    opened = false;
    return result;
  } catch (error) {
    acceptingWrites = false;
    await pending.catch(() => {});
    if (opened) await abort!().catch(() => {});
    throw error;
  } finally {
    acceptingWrites = false;
    saving = false;
  }
}

export const usesNativeStreamingFileExport = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
