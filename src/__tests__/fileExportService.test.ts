import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  begin: vi.fn(),
  append: vi.fn(),
  finish: vi.fn(),
  abort: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" },
  registerPlugin: () => native,
}));
import { saveExportBlob } from "../services/fileExportService";
beforeEach(() => {
  vi.resetAllMocks();
  native.begin.mockResolvedValue(undefined);
  native.append.mockResolvedValue(undefined);
  native.abort.mockResolvedValue(undefined);
  native.finish.mockResolvedValue({
    uri: "content://fixture/song.wav",
    sizeBytes: 500000,
    sha256: "a".repeat(64),
  });
});
afterEach(() => vi.restoreAllMocks());
describe("Android file export boundary", () => {
  it("streams bounded chunks and reports verified only after native read-back", async () => {
    const blob = new Blob([new Uint8Array(500000)], { type: "audio/wav" });
    const result = await saveExportBlob(blob, "song.wav");
    expect(native.append.mock.calls.length).toBe(3);
    expect(
      native.append.mock.calls.every(([arg]) => arg.base64.length <= 262144),
    ).toBe(true);
    expect(native.finish).toHaveBeenCalledWith({ sizeBytes: blob.size });
    expect(result).toEqual({
      verified: true,
      uri: "content://fixture/song.wav",
    });
  });
  it("cleans partial documents and propagates write errors", async () => {
    native.append.mockRejectedValueOnce(new Error("SAVE_WRITE"));
    await expect(
      saveExportBlob(new Blob(["audio"]), "song.wav"),
    ).rejects.toThrow("SAVE_WRITE");
    expect(native.abort).toHaveBeenCalledOnce();
    expect(native.finish).not.toHaveBeenCalled();
  });
  it("rejects failed native verification instead of claiming a saved file", async () => {
    native.finish.mockResolvedValueOnce({ sizeBytes: 0, sha256: "" });
    await expect(
      saveExportBlob(new Blob(["audio"]), "song.wav"),
    ).rejects.toThrow("SAVE_VERIFY");
    expect(native.abort).toHaveBeenCalledOnce();
  });
  it("propagates picker cancellation without writing", async () => {
    native.begin.mockRejectedValueOnce(new Error("SAVE_CANCELLED"));
    await expect(
      saveExportBlob(new Blob(["audio"]), "song.wav"),
    ).rejects.toThrow("SAVE_CANCELLED");
    expect(native.append).not.toHaveBeenCalled();
  });
  it("prevents concurrent destination writers", async () => {
    let release!: () => void;
    native.begin.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const saving = saveExportBlob(
      new Blob([new Uint8Array(500000)]),
      "one.wav",
    );
    await expect(saveExportBlob(new Blob(["two"]), "two.wav")).rejects.toThrow(
      "SAVE_BUSY",
    );
    release();
    await saving;
  });
});

import { saveExportStream } from "../services/fileExportService";
it("opens a native destination before producing data, then awaits each bounded write and verifies exactly once", async () => {
  const order: string[] = [];
  native.begin.mockImplementation(async () => {
    order.push("open");
  });
  native.append.mockImplementation(async () => {
    order.push("write");
  });
  native.finish.mockResolvedValue({
    uri: "content://fixture/stream.wav",
    sizeBytes: 500000,
    sha256: "b".repeat(64),
  });
  const result = await saveExportStream("stream.wav", 500000, async (write) => {
    order.push("render");
    await write(new Uint8Array(500000));
  });
  expect(order).toEqual(["open", "render", "write", "write", "write"]);
  expect(native.finish).toHaveBeenCalledWith({ sizeBytes: 500000 });
  expect(result.verified).toBe(true);
});
it("aborts a cancelled or truncated streaming export without accepting a partial file", async () => {
  const controller = new AbortController();
  await expect(
    saveExportStream(
      "cancel.wav",
      500000,
      async (write) => {
        await write(new Uint8Array(100));
        controller.abort();
        await write(new Uint8Array(50));
      },
      controller.signal,
    ),
  ).rejects.toThrow(/cancel/i);
  expect(native.abort).toHaveBeenCalledOnce();
  expect(native.finish).not.toHaveBeenCalled();
  native.abort.mockClear();
  await expect(
    saveExportStream("short.wav", 500000, async (write) => {
      await write(new Uint8Array(100));
    }),
  ).rejects.toThrow(/SAVE_SIZE/);
  expect(native.abort).toHaveBeenCalledOnce();
});
it("cleans up native output if synthesis fails and permits the next independent export", async () => {
  await expect(
    saveExportStream("bad.wav", 4, async () => {
      throw Error("RENDER_FAILURE");
    }),
  ).rejects.toThrow("RENDER_FAILURE");
  expect(native.abort).toHaveBeenCalledOnce();
  native.finish.mockResolvedValue({
    uri: "content://fixture/good.wav",
    sizeBytes: 4,
    sha256: "c".repeat(64),
  });
  await expect(
    saveExportStream("good.wav", 4, async (write) => write(new Uint8Array(4))),
  ).resolves.toMatchObject({ verified: true });
});

it('honors Blob cancellation before opening a destination and releases the reservation', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(saveExportBlob(new Blob(['audio']), 'cancel.wav', controller.signal)).rejects.toThrow(/cancel/i);
  expect(native.begin).not.toHaveBeenCalled();
  native.finish.mockResolvedValue({uri:'content://retry',sizeBytes:4,sha256:'d'.repeat(64)});
  await expect(saveExportBlob(new Blob(['next']), 'next.wav')).resolves.toMatchObject({verified:true});
});
it('discards a Blob destination cancelled while its native picker was pending', async () => {
  const controller = new AbortController();
  native.begin.mockImplementationOnce(async () => { controller.abort(); });
  await expect(saveExportBlob(new Blob(['audio']), 'cancel.wav', controller.signal)).rejects.toThrow(/cancel/i);
  expect(native.abort).toHaveBeenCalledOnce();
  expect(native.append).not.toHaveBeenCalled();
  expect(native.finish).not.toHaveBeenCalled();
});
it('cancels Blob writes between chunks without committing the destination', async () => {
  const controller = new AbortController();
  native.append.mockImplementationOnce(async () => { controller.abort(); });
  await expect(saveExportBlob(new Blob([new Uint8Array(500000)]), 'cancel.wav', controller.signal)).rejects.toThrow(/cancel/i);
  expect(native.append).toHaveBeenCalledOnce();
  expect(native.abort).toHaveBeenCalledOnce();
  expect(native.finish).not.toHaveBeenCalled();
});
