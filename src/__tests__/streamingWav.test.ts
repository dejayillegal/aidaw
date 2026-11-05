import { Buffer } from 'node:buffer';
import { describe, it, expect } from "vitest";
import {
  encodeAudioBufferToWavBlob,
  encodeAudioBufferToWavChunks,
  estimateContinuousExportMemory,
} from "../engine/webAudioSynth";
import { DEFAULT_MASTER_BUS } from "../engine/projectDefaults";
const source = (frames = 130001) => {
  const left = Float32Array.from(
      { length: frames },
      (_, i) => Math.sin(i * 0.07) * 0.5,
    ),
    right = Float32Array.from(
      { length: frames },
      (_, i) => Math.cos(i * 0.11) * 0.25,
    );
  return {
    numberOfChannels: 2,
    sampleRate: 48000,
    length: frames,
    getChannelData: (channel: number) => (channel ? right : left),
    copyFromChannel: (out: Float32Array, channel: number, start: number) =>
      out.set((channel ? right : left).subarray(start, start + out.length)),
  };
};
describe("bounded continuous WAV export", () => {
  it.each([16, 24, 32] as const)(
    "streams %s-bit WAV exactly like the existing Blob encoder without reading full channels",
    async (bits) => {
      const input = source();
      const reference = new Uint8Array(
        await (await encodeAudioBufferToWavBlob(input, bits)).arrayBuffer(),
      );
      const blocks: Uint8Array[] = [];
      let fullReads = 0;
      for await (const block of encodeAudioBufferToWavChunks(
        {
          ...input,
          getChannelData: () => {
            fullReads++;
            throw Error("full channel copy");
          },
        },
        bits,
      )) {
        expect(block.byteLength).toBeLessThanOrEqual(192 * 1024);
        blocks.push(block);
      }
      const combined = new Uint8Array(
        blocks.reduce((sum, b) => sum + b.length, 0),
      );
      let at = 0;
      for (const block of blocks) {
        combined.set(block, at);
        at += block.length;
      }
      // Compare every byte in native code; recursive million-element matcher traversal
      // consumed the default test deadline under CI contention.
      expect(Buffer.from(combined).equals(Buffer.from(reference))).toBe(true);
      expect(fullReads).toBe(0);
      expect(new DataView(combined.buffer).getUint32(40, true)).toBe(
        (input.length * 2 * bits) / 8,
      );
    },
  );
  it("cancels between bounded blocks and rejects nonfinite/silent outputs", async () => {
    const control = new AbortController(),
      iterator = encodeAudioBufferToWavChunks(
        source(),
        24,
        undefined,
        control.signal,
      );
    await iterator.next();
    control.abort();
    await expect(iterator.next()).rejects.toThrow(/cancel/i);
    for (const value of [0, NaN]) {
      const input = {
        numberOfChannels: 2,
        sampleRate: 48000,
        length: 1,
        getChannelData: () => new Float32Array([value]),
      };
      await expect(
        (async () => {
          for await (const block of encodeAudioBufferToWavChunks(input, 24))
            void block;
        })(),
      ).rejects.toThrow(value === 0 ? /SILENT/ : /NONFINITE/);
    }
  });
  it("keeps a real working-set guard while allowing a ten-minute 48k continuous native stream without whole WAV copies", () => {
    const project = { tempo: 144, tracks: [] } as any;
    const plan = estimateContinuousExportMemory(
      project,
      DEFAULT_MASTER_BUS,
      48000,
      Math.ceil(608 * 48000),
    );
    expect(plan.outputPcmBytes).toBe(608 * 48000 * 8);
    expect(plan.totalBytes).toBeLessThanOrEqual(256 * 1024 * 1024);
    expect(plan.encodedWholeFileBytes).toBe(0);
    expect(plan.fixedReserveBytes).toBeGreaterThan(0);
    expect(() =>
      estimateContinuousExportMemory(
        project,
        DEFAULT_MASTER_BUS,
        96000,
        Math.ceil(608 * 96000),
      ),
    ).toThrow(/RENDER_MEMORY/);
  });
});

import { estimateArrangementTailSeconds } from "../engine/webAudioSynth";
it("retains the existing minimum tail and extends it for long actual feedback/decay settings", () => {
  const project = {
    tempo: 144,
    tracks: [
      {
        muted: false,
        soloed: false,
        devices: [],
        mixer: { reverbSend: 0, delaySend: 1, volumeDb: 0 },
      },
    ],
  } as any;
  expect(estimateArrangementTailSeconds(project, DEFAULT_MASTER_BUS)).toBe(8);
  expect(
    estimateArrangementTailSeconds(project, {
      ...DEFAULT_MASTER_BUS,
      delayFeedback: 0.82,
    }),
  ).toBeGreaterThan(29);
  project.tracks[0].devices = [
    {
      id: "long",
      xmlTag: "Reverb",
      parameters: [
        { name: "DecayTime", value: 15000, unit: "ms" },
        { name: "DryWet", value: 50 },
      ],
    },
  ];
  expect(
    estimateArrangementTailSeconds(project, DEFAULT_MASTER_BUS),
  ).toBeGreaterThan(20);
});

it("rejects fractional frame counts and invalid sample rates before emitting a header", async () => {
  for (const invalid of [
    { length: 1.5 },
    { sampleRate: NaN },
    { sampleRate: 0 },
  ]) {
    const iterator = encodeAudioBufferToWavChunks(
      { ...source(2), ...invalid },
      24,
    );
    await expect(iterator.next()).rejects.toThrow(/ENCODE_(SIZE|FORMAT)/);
  }
});

import { inspectWavBinaryHeader } from "../engine/masteringEngine";
it("reports the exact encoded duration rather than rounding away more than one sample", async () => {
  const wav = await (
    await encodeAudioBufferToWavBlob(source(1001), 24)
  ).arrayBuffer();
  expect(inspectWavBinaryHeader(wav).durationSeconds).toBe(1001 / 48000);
});

it('retains positive and negative Float32 headroom while integer PCM saturates at full scale', async () => {
  const values = new Float32Array([1.5, -2, .25]);
  const input = {numberOfChannels:2,sampleRate:48000,length:3,getChannelData:()=>values};
  const float = new DataView(await (await encodeAudioBufferToWavBlob(input,32)).arrayBuffer());
  expect(float.getUint16(20,true)).toBe(3);
  expect(float.getFloat32(44,true)).toBe(1.5);
  expect(float.getFloat32(52,true)).toBe(-2);
  const pcm16 = new DataView(await (await encodeAudioBufferToWavBlob(input,16)).arrayBuffer());
  expect(pcm16.getInt16(44,true)).toBe(32767);
  expect(pcm16.getInt16(48,true)).toBe(-32768);
});
