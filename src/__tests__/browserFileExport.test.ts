// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" },
  registerPlugin: () => ({}),
}));
import {
  saveExportStream,
  supportsStreamingFileExport,
} from "../services/fileExportService";

const write = vi.fn(),
  close = vi.fn(),
  abort = vi.fn(),
  getFile = vi.fn();
const picker = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  write.mockResolvedValue(undefined);
  close.mockResolvedValue(undefined);
  abort.mockResolvedValue(undefined);
  getFile.mockResolvedValue({ size: 8 });
  picker.mockResolvedValue({
    createWritable: async () => ({ write, close, abort }),
    getFile,
  });
  vi.stubGlobal("showSaveFilePicker", picker);
});
afterEach(() => vi.unstubAllGlobals());

it("reports browser size checking honestly and keeps phase ordering", async () => {
  const phases: string[] = [];
  expect(supportsStreamingFileExport()).toBe(true);
  const result = await saveExportStream(
    "safe/name.wav",
    8,
    async (sink) => {
      expect(picker).toHaveBeenCalled();
      await sink(new Uint8Array(8));
    },
    undefined,
    (p) => phases.push(p),
  );
  expect(result).toEqual({ verified: false, method: "file-system" });
  expect(phases).toEqual(["selecting", "rendering", "writing", "verifying"]);
  expect(picker.mock.calls[0][0].suggestedName).toBe("safe_name.wav");
  expect(close).toHaveBeenCalledOnce();
  expect(abort).not.toHaveBeenCalled();
});

it("cleans up write failures and rejects a closed file whose size is wrong", async () => {
  write.mockRejectedValueOnce(Error("disk full"));
  await expect(
    saveExportStream("failed.wav", 8, async (sink) => sink(new Uint8Array(8))),
  ).rejects.toThrow("disk full");
  expect(abort).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
  getFile.mockResolvedValueOnce({ size: 7 });
  await expect(
    saveExportStream("truncated.wav", 8, async (sink) =>
      sink(new Uint8Array(8)),
    ),
  ).rejects.toThrow("SAVE_VERIFY");
  expect(abort).toHaveBeenCalledTimes(2);
});

it("retains the writer reservation while a cancelled picker is pending and aborts its eventual destination", async () => {
  let release!: (handle: unknown) => void;
  picker.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const controller = new AbortController(),
    producer = vi.fn();
  const saving = saveExportStream("cancel.wav", 8, producer, controller.signal);
  const cancelled = expect(saving).rejects.toThrow(/cancel/i);
  controller.abort();
  await expect(saveExportStream("other.wav", 8, producer)).rejects.toThrow(
    "SAVE_BUSY",
  );
  release({ createWritable: async () => ({ write, close, abort }), getFile });
  await cancelled;
  expect(producer).not.toHaveBeenCalled();
  expect(abort).toHaveBeenCalledOnce();
  await expect(
    saveExportStream("retry.wav", 8, async (sink) => sink(new Uint8Array(8))),
  ).resolves.toMatchObject({ method: "file-system" });
});

it("rejects escaped writes after completion so they cannot corrupt a later save", async () => {
  let escaped!: (block: Uint8Array) => Promise<void>;
  await saveExportStream("first.wav", 8, async (sink) => {
    escaped = sink;
    await sink(new Uint8Array(8));
  });
  await expect(escaped(new Uint8Array(8))).rejects.toThrow("SAVE_CLOSED");
  expect(write).toHaveBeenCalledOnce();
  await saveExportStream("next.wav", 8, async (sink) => {
    await expect(escaped(new Uint8Array(8))).rejects.toThrow("SAVE_CLOSED");
    await sink(new Uint8Array(8));
  });
  expect(write).toHaveBeenCalledTimes(2);
});
