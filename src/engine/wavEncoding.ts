/**
 * Encodes a stereo AudioBuffer into an uncompressed 16-bit, 24-bit PCM, or 32-bit Float RIFF WAVE (.wav) chunks.
 */
export async function* encodeAudioBufferToWavChunks(
  buffer: {
    numberOfChannels: number;
    sampleRate: number;
    length: number;
    getChannelData: (channel: number) => Float32Array;
    copyFromChannel?: (
      out: Float32Array<ArrayBuffer>,
      channel: number,
      start: number,
    ) => void;
  },
  bitDepth: 16 | 24 | 32 = 24,
  onProgress?: (progressPercent: number) => void,
  signal?: AbortSignal,
): AsyncGenerator<Uint8Array> {
  if (
    buffer.numberOfChannels !== 2 ||
    ![16, 24, 32].includes(bitDepth) ||
    !Number.isInteger(buffer.sampleRate) ||
    buffer.sampleRate < 1
  ) {
    throw new Error("ENCODE_FORMAT: stereo PCM16/24 or Float32 required");
  }
  const frames = buffer.length;
  const bytes = bitDepth / 8;
  const dataSize = frames * 2 * bytes;
  if (
    !Number.isSafeInteger(frames) ||
    !Number.isSafeInteger(dataSize) ||
    dataSize <= 0 ||
    dataSize > 0xffffffff - 36
  ) {
    throw new Error("ENCODE_SIZE: output exceeds RIFF limits");
  }
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const ascii = (at: number, str: string) =>
    [...str].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, bitDepth === 32 ? 3 : 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2 * bytes, true);
  view.setUint16(32, 2 * bytes, true);
  view.setUint16(34, bitDepth, true);
  ascii(36, "data");
  view.setUint32(40, dataSize, true);
  const checkCancelled = () => {
    if (signal?.aborted)
      throw new DOMException("Export cancelled", "AbortError");
  };
  checkCancelled();
  const blockFrames = Math.floor((192 * 1024) / (2 * bytes));
  const channels = buffer.copyFromChannel
    ? [new Float32Array(blockFrames), new Float32Array(blockFrames)]
    : [buffer.getChannelData(0), buffer.getChannelData(1)];
  yield new Uint8Array(header);
  let peak = 0;
  // Yield between bounded allocations so the Android UI and bridge remain responsive.
  for (let start = 0; start < frames; start += blockFrames) {
    const end = Math.min(frames, start + blockFrames);
    checkCancelled();
    if (buffer.copyFromChannel)
      channels.forEach((channel, index) =>
        buffer.copyFromChannel!(
          channel as Float32Array<ArrayBuffer>,
          index,
          start,
        ),
      );
    const block = new ArrayBuffer((end - start) * 2 * bytes);
    const out = new DataView(block);
    let offset = 0;
    for (let i = start; i < end; i++)
      for (const channel of channels) {
        const raw = channel[buffer.copyFromChannel ? i - start : i];
        if (!Number.isFinite(raw))
          throw new Error(`ENCODE_NONFINITE: frame ${i}`);
        peak = Math.max(peak, Math.abs(raw));
        const sample = Math.max(-1, Math.min(1, raw));
        if (bitDepth === 32) out.setFloat32(offset, sample, true);
        else if (bitDepth === 16)
          out.setInt16(
            offset,
            Math.round(sample * (sample < 0 ? 32768 : 32767)),
            true,
          );
        else {
          const value = Math.round(sample * (sample < 0 ? 8388608 : 8388607));
          out.setUint8(offset, value & 255);
          out.setUint8(offset + 1, (value >> 8) & 255);
          out.setUint8(offset + 2, (value >> 16) & 255);
        }
        offset += bytes;
      }
    yield new Uint8Array(block);
    onProgress?.((end / frames) * 100);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (peak <= 1e-8)
    throw new Error(
      "ENCODE_SILENT: no audible samples; check clips and mute/solo",
    );
  checkCancelled();
}

export async function encodeAudioBufferToWavBlob(
  buffer: {
    numberOfChannels: number;
    sampleRate: number;
    length: number;
    getChannelData: (channel: number) => Float32Array;
  },
  bitDepth: 16 | 24 | 32 = 24,
  onProgress?: (progressPercent: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const parts: BlobPart[] = [];
  for await (const block of encodeAudioBufferToWavChunks(
    buffer,
    bitDepth,
    onProgress,
    signal,
  ))
    parts.push(block as Uint8Array<ArrayBuffer>);
  return new Blob(parts, { type: "audio/wav" });
}
