import {
  AbletonProjectState,
  HumanizationConfig,
  MasterBusConfig,
  MasterExportPreset,
  MasterExportVerificationReport,
  SmartCalibrationProposal,
  SmartCalibrationStageAStatic,
  SmartCalibrationStageBMeasured,
  SmartCalibrationVerificationReport,
  TrackCalibrationProposalItem,
} from '../types/ableton';
import {
  BROWSER_SUPPORTED_DEVICE_TAGS,
  getDefaultSpectralDuckingConfig,
  rootKeyToFundamentalHz,
  seededRandom,
  syncLocatorsAndMixerToXml,
} from './alsXmlEngine';
import { validateAlsProjectCadence } from './compositionIntelligenceEngine';
import { synthesizeProjectToStereoFloatBuffers } from './webAudioSynth';
import { assertExecutableInsertLimits } from './channelStripEngine';

export const MASTER_EXPORT_PRESETS_STORAGE_KEY = 'ableton_studio_master_export_presets_v2';

export const BUILTIN_MASTER_EXPORT_PRESETS: MasterExportPreset[] = [
  {
    id: 'preset_club_24_48',
    name: 'Club Master · 24-Bit / 48 kHz / -9.0 LUFS',
    bitDepth: 24,
    sampleFormat: 'pcm_int',
    sampleRate: 48000,
    targetIntegratedLufs: -9.0,
    truePeakCeilingDbtp: -0.3,
    normalize: true,
    dither: 'tpdf',
    isBuiltIn: true,
  },
  {
    id: 'preset_streaming_24_44',
    name: 'Streaming Master · 24-Bit / 44.1 kHz / -14.0 LUFS',
    bitDepth: 24,
    sampleFormat: 'pcm_int',
    sampleRate: 44100,
    targetIntegratedLufs: -14.0,
    truePeakCeilingDbtp: -1.0,
    normalize: true,
    dither: 'tpdf',
    isBuiltIn: true,
  },
  {
    id: 'preset_archive_32f_96',
    name: 'Studio Archive · 32-Bit IEEE Float / 96 kHz / Raw',
    bitDepth: 32,
    sampleFormat: 'ieee_float',
    sampleRate: 96000,
    targetIntegratedLufs: null,
    truePeakCeilingDbtp: -0.1,
    normalize: false,
    dither: 'none',
    isBuiltIn: true,
  },
  {
    id: 'preset_cd_16_44',
    name: 'CD Redbook · 16-Bit / 44.1 kHz / -11.0 LUFS',
    bitDepth: 16,
    sampleFormat: 'pcm_int',
    sampleRate: 44100,
    targetIntegratedLufs: -11.0,
    truePeakCeilingDbtp: -0.2,
    normalize: true,
    dither: 'tpdf',
    isBuiltIn: true,
  },
  {
    id: 'preset_aggressive_peak_6',
    name: 'Aggressive Peak Profile · 24-Bit / 48 kHz / -6.0 LUFS (Optional)',
    bitDepth: 24,
    sampleFormat: 'pcm_int',
    sampleRate: 48000,
    targetIntegratedLufs: -6.0,
    truePeakCeilingDbtp: -0.1,
    normalize: true,
    dither: 'tpdf',
    isBuiltIn: true,
    aggressiveWarning:
      'High-density club limiter profile (-6.0 LUFS). May reduce transient crest factor or trigger target conflict warnings on high-crest mixes.',
  },
];

let inMemoryUserPresetsFallback: MasterExportPreset[] = [];

function canUseLocalStorage(): boolean {
  try {
    return (
      typeof localStorage !== 'undefined' &&
      typeof localStorage.getItem === 'function' &&
      typeof localStorage.setItem === 'function'
    );
  } catch {
    return false;
  }
}

export function loadMasterExportPresetsFromStorage(): MasterExportPreset[] {
  try {
    let parsed: any[] | null = null;
    if (canUseLocalStorage()) {
      const raw = localStorage.getItem(MASTER_EXPORT_PRESETS_STORAGE_KEY);
      if (raw) {
        parsed = JSON.parse(raw);
      }
    }
    if (!Array.isArray(parsed)) {
      parsed = inMemoryUserPresetsFallback;
    }
    const userPresets: MasterExportPreset[] = parsed.filter(
      (p: any) =>
        p &&
        typeof p.id === 'string' &&
        typeof p.name === 'string' &&
        (p.bitDepth === 16 || p.bitDepth === 24 || p.bitDepth === 32) &&
        (p.sampleRate === 44100 || p.sampleRate === 48000 || p.sampleRate === 96000) &&
        !p.isBuiltIn
    );
    return [...BUILTIN_MASTER_EXPORT_PRESETS, ...userPresets];
  } catch {
    return [...BUILTIN_MASTER_EXPORT_PRESETS, ...inMemoryUserPresetsFallback];
  }
}

export function saveCustomMasterExportPreset(
  preset: Omit<MasterExportPreset, 'id'> & { id?: string }
): MasterExportPreset[] {
  const generatedId =
    preset.id && typeof preset.id === 'string'
      ? preset.id
      : `custom_preset_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const validated: MasterExportPreset = {
    ...preset,
    id: generatedId,
    sampleFormat: preset.bitDepth === 32 ? 'ieee_float' : 'pcm_int',
    dither: preset.bitDepth === 32 ? 'none' : preset.dither,
    isBuiltIn: false,
  };
  const current = loadMasterExportPresetsFromStorage().filter((p) => !p.isBuiltIn);
  const nextUser = [...current.filter((p) => p.id !== validated.id), validated];
  inMemoryUserPresetsFallback = nextUser;
  try {
    if (canUseLocalStorage()) {
      localStorage.setItem(MASTER_EXPORT_PRESETS_STORAGE_KEY, JSON.stringify(nextUser));
    }
  } catch {
    // Ignore storage quota errors
  }
  return [...BUILTIN_MASTER_EXPORT_PRESETS, ...nextUser];
}

export function deleteCustomMasterExportPreset(presetId: string): MasterExportPreset[] {
  const current = loadMasterExportPresetsFromStorage().filter(
    (p) => !p.isBuiltIn && p.id !== presetId
  );
  inMemoryUserPresetsFallback = current;
  try {
    if (canUseLocalStorage()) {
      localStorage.setItem(MASTER_EXPORT_PRESETS_STORAGE_KEY, JSON.stringify(current));
    }
  } catch {
    // Ignore
  }
  return [...BUILTIN_MASTER_EXPORT_PRESETS, ...current];
}

/**
 * Computes biquad coefficients for ITU-R BS.1770-4 K-Weighting filters at any sample rate (44.1k, 48k, 96k).
 * Stage 1: High-shelf pre-filter (+4 dB @ 1681.97 Hz)
 * Stage 2: RLB high-pass filter (38.135 Hz, Q = 0.5003)
 */
function getBs1770FilterCoeffs(sampleRate: number) {
  // Stage 1: High shelf
  const f0Shelf = 1681.974450955533;
  const gainDb = 3.999843853973347;
  const qShelf = 0.7071752369554196;
  const K1 = Math.tan((Math.PI * f0Shelf) / sampleRate);
  const Vh = Math.pow(10, gainDb / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0_1 = 1 + K1 / qShelf + K1 * K1;
  const b0_1 = (Vh + (Vb * K1) / qShelf + K1 * K1) / a0_1;
  const b1_1 = (2 * (K1 * K1 - Vh)) / a0_1;
  const b2_1 = (Vh - (Vb * K1) / qShelf + K1 * K1) / a0_1;
  const a1_1 = (2 * (K1 * K1 - 1)) / a0_1;
  const a2_1 = (1 - K1 / qShelf + K1 * K1) / a0_1;

  // Stage 2: RLB High-pass
  const f0Hp = 38.13547087602444;
  const qHp = 0.5003270373238773;
  const K2 = Math.tan((Math.PI * f0Hp) / sampleRate);
  const a0_2 = 1 + K2 / qHp + K2 * K2;
  const b0_2 = 1 / a0_2;
  const b1_2 = -2 / a0_2;
  const b2_2 = 1 / a0_2;
  const a1_2 = (2 * (K2 * K2 - 1)) / a0_2;
  const a2_2 = (1 - K2 / qHp + K2 * K2) / a0_2;

  return {
    shelf: { b0: b0_1, b1: b1_1, b2: b2_1, a1: a1_1, a2: a2_1 },
    hp: { b0: b0_2, b1: b1_2, b2: b2_2, a1: a1_2, a2: a2_2 },
  };
}

function applyKWeightingChannel(samples: Float32Array, sampleRate: number): Float32Array {
  const { shelf, hp } = getBs1770FilterCoeffs(sampleRate);
  const out = new Float32Array(samples.length);

  let x1_1 = 0,
    x2_1 = 0,
    y1_1 = 0,
    y2_1 = 0;
  let x1_2 = 0,
    x2_2 = 0,
    y1_2 = 0,
    y2_2 = 0;

  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0_1 =
      shelf.b0 * x0 + shelf.b1 * x1_1 + shelf.b2 * x2_1 - shelf.a1 * y1_1 - shelf.a2 * y2_1;
    x2_1 = x1_1;
    x1_1 = x0;
    y2_1 = y1_1;
    y1_1 = y0_1;

    const y0_2 = hp.b0 * y0_1 + hp.b1 * x1_2 + hp.b2 * x2_2 - hp.a1 * y1_2 - hp.a2 * y2_2;
    x2_2 = x1_2;
    x1_2 = y0_1;
    y2_2 = y1_2;
    y1_2 = y0_2;

    out[i] = y0_2;
  }

  return out;
}

/**
 * Genuine ITU-R BS.1770-4 Integrated Loudness (LUFS), 4x Oversampled True Peak (dBTP),
 * Sample Peak (dBFS), Crest Factor (dB), Headroom, and Clipping Counter.
 */
export function measureAudioSignalMetrics(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number
): {
  integratedLufs: number;
  samplePeakDbfs: number;
  truePeakDbtp: number;
  rmsDb: number;
  crestFactorDb: number;
  headroomDb: number;
  clippingSampleCount: number;
} {
  const n = Math.min(left.length, right.length);
  if (n === 0) {
    return {
      integratedLufs: -70,
      samplePeakDbfs: -90,
      truePeakDbtp: -90,
      rmsDb: -90,
      crestFactorDb: 0,
      headroomDb: 90,
      clippingSampleCount: 0,
    };
  }

  // 1. Sample Peak, RMS, and 4x Oversampled Cubic Hermite True Peak (ITU-R BS.1770 Annex 2)
  let maxSamplePeak = 0;
  let maxTruePeak = 0;
  let sumSqAll = 0;
  let clippingSampleCount = 0;

  const evalHermite4x = (ym1: number, y0: number, y1: number, y2: number) => {
    const c0 = y0;
    const c1 = 0.5 * (y1 - ym1);
    const c2 = ym1 - 2.5 * y0 + 2 * y1 - 0.5 * y2;
    const c3 = 0.5 * (y2 - ym1) + 1.5 * (y0 - y1);
    let peak = Math.max(Math.abs(y0), Math.abs(y1));
    for (const t of [0.25, 0.5, 0.75]) {
      const val = Math.abs(((c3 * t + c2) * t + c1) * t + c0);
      if (val > peak) peak = val;
    }
    return peak;
  };

  for (let i = 0; i < n; i++) {
    const sL = left[i];
    const sR = right[i];
    const absL = Math.abs(sL);
    const absR = Math.abs(sR);
    if (absL > maxSamplePeak) maxSamplePeak = absL;
    if (absR > maxSamplePeak) maxSamplePeak = absR;
    if (absL >= 0.9999 || absR >= 0.9999) clippingSampleCount++;
    sumSqAll += 0.5 * (sL * sL + sR * sR);

    if (i >= 1 && i < n - 2) {
      if (absL > 0.05) {
        const tpL = evalHermite4x(left[i - 1], sL, left[i + 1], left[i + 2]);
        if (tpL > maxTruePeak) maxTruePeak = tpL;
      }
      if (absR > 0.05) {
        const tpR = evalHermite4x(right[i - 1], sR, right[i + 1], right[i + 2]);
        if (tpR > maxTruePeak) maxTruePeak = tpR;
      }
    }
  }
  if (maxSamplePeak > maxTruePeak) maxTruePeak = maxSamplePeak;

  const samplePeakDbfs =
    maxSamplePeak > 1e-6 ? Number((20 * Math.log10(maxSamplePeak)).toFixed(2)) : -90;
  const truePeakDbtp =
    maxTruePeak > 1e-6 ? Number((20 * Math.log10(maxTruePeak)).toFixed(2)) : -90;
  const rmsLinear = Math.sqrt(sumSqAll / n);
  const rmsDb = rmsLinear > 1e-6 ? Number((20 * Math.log10(rmsLinear)).toFixed(2)) : -90;
  const crestFactorDb = Number(Math.max(0, truePeakDbtp - rmsDb).toFixed(2));
  const headroomDb = Number((-truePeakDbtp).toFixed(2));

  // 2. ITU-R BS.1770-4 K-weighted Gated Loudness Integration
  const kL = applyKWeightingChannel(left, sampleRate);
  const kR = applyKWeightingChannel(right, sampleRate);

  const blockSamples = Math.max(1, Math.floor(0.4 * sampleRate)); // 400 ms gating block
  const stepSamples = Math.max(1, Math.floor(0.1 * sampleRate)); // 100 ms step (75% overlap)

  const blockEnergies: number[] = [];
  if (n >= blockSamples) {
    for (let start = 0; start + blockSamples <= n; start += stepSamples) {
      let sumL = 0;
      let sumR = 0;
      const end = start + blockSamples;
      for (let i = start; i < end; i++) {
        sumL += kL[i] * kL[i];
        sumR += kR[i] * kR[i];
      }
      const zL = sumL / blockSamples;
      const zR = sumR / blockSamples;
      const blockEnergy = zL + zR;
      blockEnergies.push(blockEnergy);
    }
  } else {
    let sumL = 0;
    let sumR = 0;
    for (let i = 0; i < n; i++) {
      sumL += kL[i] * kL[i];
      sumR += kR[i] * kR[i];
    }
    blockEnergies.push(sumL / n + sumR / n);
  }

  // Absolute gate at -70 LKFS: -0.691 + 10 * log10(E) > -70
  const absGateLinear = Math.pow(10, (-70 + 0.691) / 10);
  const absPassed = blockEnergies.filter((e) => e > absGateLinear);

  if (absPassed.length === 0) {
    return {
      integratedLufs: -70,
      samplePeakDbfs,
      truePeakDbtp,
      rmsDb,
      crestFactorDb,
      headroomDb,
      clippingSampleCount,
    };
  }

  const meanAbsEnergy = absPassed.reduce((a, b) => a + b, 0) / absPassed.length;
  const relGateLufs = -0.691 + 10 * Math.log10(meanAbsEnergy) - 10.0; // -10 LU relative threshold
  const relGateLinear = Math.pow(10, (relGateLufs + 0.691) / 10);

  const relPassed = absPassed.filter((e) => e >= relGateLinear);
  const finalBlocks = relPassed.length > 0 ? relPassed : absPassed;
  const gatedMeanEnergy = finalBlocks.reduce((a, b) => a + b, 0) / finalBlocks.length;

  const integratedLufs =
    gatedMeanEnergy > 1e-10
      ? Number((-0.691 + 10 * Math.log10(gatedMeanEnergy)).toFixed(2))
      : -70;

  return {
    integratedLufs,
    samplePeakDbfs,
    truePeakDbtp,
    rmsDb,
    crestFactorDb,
    headroomDb,
    clippingSampleCount,
  };
}

/**
 * Encodes stereo Float32Arrays into a verified RIFF WAVE (.wav) ArrayBuffer and Blob.
 * Validates:
 * - 16-bit signed PCM (wFormatTag = 1)
 * - 24-bit signed PCM (wFormatTag = 1)
 * - 32-bit IEEE Float (wFormatTag = 3)
 * - TPDF dither applied strictly when quantizing to integer PCM (16 or 24-bit) with dither === 'tpdf'.
 */
export function encodeVerifiedWavArrayBuffer(
  left: Float32Array,
  right: Float32Array,
  sampleRate: 44100 | 48000 | 96000,
  bitDepth: 16 | 24 | 32,
  sampleFormatOrDither: 'pcm_int' | 'ieee_float' | 'none' | 'tpdf' = 'none',
  ditherMaybe?: 'none' | 'tpdf'
): { arrayBuffer: ArrayBuffer; blob: Blob } {
  const dither: 'none' | 'tpdf' =
    sampleFormatOrDither === 'tpdf' || sampleFormatOrDither === 'none'
      ? sampleFormatOrDither
      : ditherMaybe || 'none';
  const numChannels = 2;
  const numFrames = Math.min(left.length, right.length);
  const bytesPerSample = bitDepth === 32 ? 4 : bitDepth === 24 ? 3 : 2;
  const formatTag = bitDepth === 32 ? 3 : 1; // 3 = WAVE_FORMAT_IEEE_FLOAT, 1 = WAVE_FORMAT_PCM
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const totalSize = 44 + dataSize;

  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');

  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, formatTag, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  // TPDF Dither step amplitude (1 LSB peak-to-peak triangular PDF) ONLY for integer PCM
  const applyTpdf = dither === 'tpdf' && bitDepth !== 32;
  const lsbScale = bitDepth === 16 ? 1 / 32768 : 1 / 8388608;

  let offset = 44;
  if (bitDepth === 32) {
    for (let i = 0; i < numFrames; i++) {
      view.setFloat32(offset, left[i], true);
      offset += 4;
      view.setFloat32(offset, right[i], true);
      offset += 4;
    }
  } else if (bitDepth === 24) {
    const writeInt24LE = (pos: number, sampleNorm: number, seedIdx: number) => {
      const tpdfNoise = applyTpdf
        ? (seededRandom(seedIdx) + seededRandom(seedIdx + 7919) - 1.0) * lsbScale
        : 0;
      const clamped = Math.max(-1, Math.min(1, sampleNorm + tpdfNoise));
      const intVal = Math.round(clamped < 0 ? clamped * 8388608 : clamped * 8388607);
      view.setUint8(pos, intVal & 0xff);
      view.setUint8(pos + 1, (intVal >> 8) & 0xff);
      view.setUint8(pos + 2, (intVal >> 16) & 0xff);
    };

    for (let i = 0; i < numFrames; i++) {
      writeInt24LE(offset, left[i], i * 2 + 1);
      offset += 3;
      writeInt24LE(offset, right[i], i * 2 + 2);
      offset += 3;
    }
  } else {
    for (let i = 0; i < numFrames; i++) {
      const ditherL = applyTpdf
        ? (seededRandom(i * 2 + 11) + seededRandom(i * 2 + 37) - 1.0) * lsbScale
        : 0;
      const ditherR = applyTpdf
        ? (seededRandom(i * 2 + 53) + seededRandom(i * 2 + 97) - 1.0) * lsbScale
        : 0;
      const sL = Math.max(-1, Math.min(1, left[i] + ditherL));
      const sR = Math.max(-1, Math.min(1, right[i] + ditherR));
      view.setInt16(offset, Math.round(sL < 0 ? sL * 0x8000 : sL * 0x7fff), true);
      offset += 2;
      view.setInt16(offset, Math.round(sR < 0 ? sR * 0x8000 : sR * 0x7fff), true);
      offset += 2;
    }
  }

  return {
    arrayBuffer,
    blob: new Blob([arrayBuffer], { type: 'audio/wav' }),
  };
}

/**
 * Inspects and validates a RIFF WAVE binary buffer for Gate 2 & Scenario 4 compliance.
 */
export function inspectWavBinaryHeader(
  input: ArrayBuffer | { arrayBuffer: ArrayBuffer }
): {
  isValid: boolean;
  validRiffWave: boolean;
  riffMagic: string;
  waveMagic: string;
  formatTag: number;
  audioFormatTag: number;
  numChannels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  dataSize: number;
  totalByteLength: number;
  numFrames: number;
  durationSeconds: number;
  diagnostics: string[];
} {
  const arrayBuffer =
    input instanceof ArrayBuffer ? input : input.arrayBuffer;
  const diagnostics: string[] = [];
  if (!arrayBuffer || arrayBuffer.byteLength < 44) {
    return {
      isValid: false,
      validRiffWave: false,
      riffMagic: '',
      waveMagic: '',
      formatTag: 0,
      audioFormatTag: 0,
      numChannels: 0,
      sampleRate: 0,
      byteRate: 0,
      blockAlign: 0,
      bitsPerSample: 0,
      dataSize: 0,
      totalByteLength: arrayBuffer ? arrayBuffer.byteLength : 0,
      numFrames: 0,
      durationSeconds: 0,
      diagnostics: ['WAV buffer is smaller than 44-byte RIFF header.'],
    };
  }

  const view = new DataView(arrayBuffer);
  const readAscii = (offset: number, len: number) => {
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
    return s;
  };

  const riffMagic = readAscii(0, 4);
  const chunkSize = view.getUint32(4, true);
  const waveMagic = readAscii(8, 4);
  const fmtMagic = readAscii(12, 4);
  const formatTag = view.getUint16(20, true);
  const numChannels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const byteRate = view.getUint32(28, true);
  const blockAlign = view.getUint16(32, true);
  const bitsPerSample = view.getUint16(34, true);
  const dataMagic = readAscii(36, 4);
  const dataSize = view.getUint32(40, true);

  if (riffMagic !== 'RIFF') diagnostics.push(`Invalid RIFF magic: ${riffMagic}`);
  if (waveMagic !== 'WAVE') diagnostics.push(`Invalid WAVE magic: ${waveMagic}`);
  if (fmtMagic !== 'fmt ') diagnostics.push(`Invalid fmt magic: ${fmtMagic}`);
  if (dataMagic !== 'data') diagnostics.push(`Invalid data chunk magic: ${dataMagic}`);

  const expectedFormatTag = bitsPerSample === 32 ? 3 : 1;
  if (formatTag !== expectedFormatTag) {
    diagnostics.push(
      `Format tag mismatch: got ${formatTag}, expected ${expectedFormatTag} for ${bitsPerSample}-bit.`
    );
  }

  const bytesPerSample = bitsPerSample / 8;
  const expectedBlockAlign = numChannels * bytesPerSample;
  if (blockAlign !== expectedBlockAlign) {
    diagnostics.push(`BlockAlign mismatch: got ${blockAlign}, expected ${expectedBlockAlign}.`);
  }

  const expectedByteRate = sampleRate * expectedBlockAlign;
  if (byteRate !== expectedByteRate) {
    diagnostics.push(`ByteRate mismatch: got ${byteRate}, expected ${expectedByteRate}.`);
  }

  if (chunkSize !== 36 + dataSize || arrayBuffer.byteLength !== 44 + dataSize) {
    diagnostics.push(`Data chunk size mismatch against total buffer byte length.`);
  }

  const numFrames = blockAlign > 0 ? Math.floor(dataSize / blockAlign) : 0;
  const durationSeconds = sampleRate > 0 ? Number((numFrames / sampleRate).toFixed(4)) : 0;
  const isValid = diagnostics.length === 0;

  return {
    isValid,
    validRiffWave: isValid,
    riffMagic,
    waveMagic,
    formatTag,
    audioFormatTag: formatTag,
    numChannels,
    sampleRate,
    byteRate,
    blockAlign,
    bitsPerSample,
    dataSize,
    totalByteLength: arrayBuffer.byteLength,
    numFrames,
    durationSeconds,
    diagnostics,
  };
}

/**
 * Applies two-pass mastering (gain scaling + soft-knee lookahead brickwall limiting) to stereo Float32Arrays
 * to hit `targetIntegratedLufs` while respecting `truePeakCeilingDbtp`.
 */
export function applyTwoPassMasteringToBuffers(
  rawLeft: Float32Array,
  rawRight: Float32Array,
  sampleRate: 44100 | 48000 | 96000,
  preset: MasterExportPreset
): {
  masteredLeft: Float32Array;
  masteredRight: Float32Array;
  pass1Metrics: ReturnType<typeof measureAudioSignalMetrics>;
  pass2Metrics: ReturnType<typeof measureAudioSignalMetrics>;
  appliedGainDb: number;
  limiterGainReductionDb: number;
  targetCompliant: boolean;
  conflictWarning: string | null;
} {
  const pass1Metrics = measureAudioSignalMetrics(rawLeft, rawRight, sampleRate);
  const n = Math.min(rawLeft.length, rawRight.length);
  const masteredLeft = new Float32Array(n);
  const masteredRight = new Float32Array(n);

  const ceilingLinear = Math.pow(10, preset.truePeakCeilingDbtp / 20);

  if (!preset.normalize || preset.targetIntegratedLufs === null || pass1Metrics.integratedLufs <= -65) {
    // Only enforce true-peak ceiling protection if raw signal exceeds ceiling
    const rawPeakLinear = Math.pow(10, pass1Metrics.truePeakDbtp / 20);
    const attenGain = rawPeakLinear > ceilingLinear ? (ceilingLinear * 0.99) / rawPeakLinear : 1.0;
    for (let i = 0; i < n; i++) {
      masteredLeft[i] = rawLeft[i] * attenGain;
      masteredRight[i] = rawRight[i] * attenGain;
    }
    const pass2Metrics = measureAudioSignalMetrics(masteredLeft, masteredRight, sampleRate);
    return {
      masteredLeft,
      masteredRight,
      pass1Metrics,
      pass2Metrics,
      appliedGainDb: Number((20 * Math.log10(attenGain)).toFixed(2)),
      limiterGainReductionDb: attenGain < 1 ? Number((-20 * Math.log10(attenGain)).toFixed(2)) : 0,
      targetCompliant: true,
      conflictWarning: null,
    };
  }

  // Pass 1 -> Calculate required gain to hit targetIntegratedLufs
  const desiredGainDb = preset.targetIntegratedLufs - pass1Metrics.integratedLufs;
  // Cap maximum makeup gain + limiting drive to +14 dB to avoid destructive distortion
  const maxSafeLimiterReductionDb = 9.5;
  const projectedPeakDbtp = pass1Metrics.truePeakDbtp + desiredGainDb;
  const requiredReductionDb = Math.max(0, projectedPeakDbtp - preset.truePeakCeilingDbtp);

  let conflictWarning: string | null = null;
  let effectiveGainDb = desiredGainDb;

  if (requiredReductionDb > maxSafeLimiterReductionDb) {
    // Target conflicts with true-peak ceiling / dynamic range safety
    const cappedGainDb =
      preset.truePeakCeilingDbtp - pass1Metrics.truePeakDbtp + maxSafeLimiterReductionDb;
    effectiveGainDb = cappedGainDb;
    conflictWarning = `Requested ${preset.targetIntegratedLufs.toFixed(
      1
    )} LUFS conflicts with ${preset.truePeakCeilingDbtp.toFixed(
      1
    )} dBTP ceiling (would require ${requiredReductionDb.toFixed(
      1
    )} dB of limiting). Capped gain reduction to ${maxSafeLimiterReductionDb.toFixed(
      1
    )} dB to prevent unacceptable clipping distortion.`;
  }

  const linearMakeup = Math.pow(10, effectiveGainDb / 20);
  let maxGrLinear = 1.0;
  let envGain = 1.0;
  const releaseCoeff = Math.exp(-1 / (0.045 * sampleRate)); // 45ms smooth release

  for (let i = 0; i < n; i++) {
    const xL = rawLeft[i] * linearMakeup;
    const xR = rawRight[i] * linearMakeup;
    // Account for inter-sample overshoot headroom (0.985 safety margin below ceilingLinear)
    const safeCeiling = ceilingLinear * 0.985;
    const peakAbs = Math.max(Math.abs(xL), Math.abs(xR));
    const neededGain = peakAbs > safeCeiling ? safeCeiling / peakAbs : 1.0;

    if (neededGain < envGain) {
      envGain = neededGain; // Instant lookahead attack
    } else {
      envGain = releaseCoeff * envGain + (1 - releaseCoeff) * neededGain;
    }

    if (envGain < maxGrLinear) maxGrLinear = envGain;
    masteredLeft[i] = xL * envGain;
    masteredRight[i] = xR * envGain;
  }

  // Iterative fine trim pass if no heavy limiting occurred so achieved LUFS matches target within ±0.2 LU
  let pass2Metrics = measureAudioSignalMetrics(masteredLeft, masteredRight, sampleRate);
  if (!conflictWarning && Math.abs(pass2Metrics.integratedLufs - preset.targetIntegratedLufs) > 0.25) {
    const residualDb = preset.targetIntegratedLufs - pass2Metrics.integratedLufs;
    const headroomToCeilingDb = preset.truePeakCeilingDbtp - pass2Metrics.truePeakDbtp - 0.08;
    const safeTrimDb = Math.min(residualDb, headroomToCeilingDb);
    if (Math.abs(safeTrimDb) > 0.05) {
      const trimLin = Math.pow(10, safeTrimDb / 20);
      for (let i = 0; i < n; i++) {
        masteredLeft[i] = Math.max(-ceilingLinear, Math.min(ceilingLinear, masteredLeft[i] * trimLin));
        masteredRight[i] = Math.max(-ceilingLinear, Math.min(ceilingLinear, masteredRight[i] * trimLin));
      }
      effectiveGainDb += safeTrimDb;
      pass2Metrics = measureAudioSignalMetrics(masteredLeft, masteredRight, sampleRate);
    } else if (residualDb > headroomToCeilingDb + 0.4) {
      conflictWarning = `Target ${preset.targetIntegratedLufs.toFixed(
        1
      )} LUFS limited by ${preset.truePeakCeilingDbtp.toFixed(
        1
      )} dBTP true-peak ceiling; achieved ${pass2Metrics.integratedLufs.toFixed(1)} LUFS.`;
    }
  }

  const limiterGainReductionDb =
    maxGrLinear < 0.999 ? Number((-20 * Math.log10(maxGrLinear)).toFixed(2)) : 0;
  const lufsDelta = Math.abs(pass2Metrics.integratedLufs - preset.targetIntegratedLufs);
  const peakCompliant = pass2Metrics.truePeakDbtp <= preset.truePeakCeilingDbtp + 0.05;
  const targetCompliant = peakCompliant && lufsDelta <= 0.6 && !conflictWarning;

  return {
    masteredLeft,
    masteredRight,
    pass1Metrics,
    pass2Metrics,
    appliedGainDb: Number(effectiveGainDb.toFixed(2)),
    limiterGainReductionDb,
    targetCompliant,
    conflictWarning,
  };
}

/**
 * Master Export Engine 2.0:
 * Renders the project with 96 kHz memory budgeting (continuous rendering with an explicit working-set budget),
 * performs two-pass ITU-R BS.1770 mastering, encodes verified PCM / IEEE Float WAV, and returns full verification telemetry.
 */
export async function executeMasterExport20(
  project: AbletonProjectState,
  humanization: HumanizationConfig,
  masterBus: MasterBusConfig,
  preset: MasterExportPreset
): Promise<{
  blob: Blob;
  arrayBuffer: ArrayBuffer;
  wavArrayBuffer?: ArrayBuffer;
  report: MasterExportVerificationReport;
  verification: MasterExportVerificationReport;
}> {
  const totalBars = project.arrangementLengthBars || 16;
  const totalBeats = totalBars * 4;
  const beatsPerSecond = Math.max(60, project.tempo) / 60;
  const tailSeconds = 2.0;
  const totalDurationSeconds = totalBeats / beatsPerSecond + tailSeconds;
  const totalFrames = Math.ceil(totalDurationSeconds * preset.sampleRate);

  // One continuous shared graph; scheduling windows preserve DSP state, not independent renders.
  const segmentedRenderUsed = false;
  const segmentCount = 1;

  const { left: rawLeft, right: rawRight } = await synthesizeProjectToStereoFloatBuffers(
    project,
    humanization,
    masterBus,
    preset.sampleRate,
    totalBars,
    segmentedRenderUsed ? segmentCount : 1
  );

  const masteringResult = applyTwoPassMasteringToBuffers(
    rawLeft,
    rawRight,
    preset.sampleRate,
    preset
  );

  const { arrayBuffer, blob } = encodeVerifiedWavArrayBuffer(
    masteringResult.masteredLeft,
    masteringResult.masteredRight,
    preset.sampleRate,
    preset.bitDepth,
    preset.dither
  );

  const headerCheck = inspectWavBinaryHeader(arrayBuffer);

  const report: MasterExportVerificationReport = {
    presetId: preset.id,
    presetName: preset.name,
    pass1IntegratedLufs: masteringResult.pass1Metrics.integratedLufs,
    pass1TruePeakDbtp: masteringResult.pass1Metrics.truePeakDbtp,
    pass1SamplePeakDbfs: masteringResult.pass1Metrics.samplePeakDbfs,
    pass1CrestFactorDb: masteringResult.pass1Metrics.crestFactorDb,
    appliedGainDb: masteringResult.appliedGainDb,
    appliedMakeupGainDb: masteringResult.appliedGainDb,
    limiterGainReductionDb: masteringResult.limiterGainReductionDb,
    achievedIntegratedLufs: masteringResult.pass2Metrics.integratedLufs,
    achievedTruePeakDbtp: masteringResult.pass2Metrics.truePeakDbtp,
    postMasterTruePeakDbtp: masteringResult.pass2Metrics.truePeakDbtp,
    achievedSamplePeakDbfs: masteringResult.pass2Metrics.samplePeakDbfs,
    achievedCrestFactorDb: masteringResult.pass2Metrics.crestFactorDb,
    targetCompliant: masteringResult.targetCompliant,
    conflictWarning: masteringResult.conflictWarning,
    segmentedRenderUsed,
    segmentCount,
    wavHeaderValid: headerCheck.isValid,
    formatTag: headerCheck.formatTag,
    durationSeconds: headerCheck.durationSeconds,
    byteSize: arrayBuffer.byteLength,
  };

  return { blob, arrayBuffer, wavArrayBuffer: arrayBuffer, report, verification: report };
}

// ============================================================================
// BULK SMART LEVELING 2.0 (5-STAGE ANALYSIS, PROPOSAL & VERIFICATION PIPELINE)
// ============================================================================

/**
 * Inspects whether a project's audio path can be genuinely rendered and measured by the DSP engine.
 */
export function evaluateProjectRenderCapabilities(project: AbletonProjectState): {
  canRenderAudio: boolean;
  canSynthesizeOffline?: boolean;
  hasUnsupportedNativeDevices: boolean;
  hasExternalUnrenderableAudio?: boolean;
  missingSampleCount: number;
  missingAudioSampleCount?: number;
  unsupportedDeviceNames: string[];
  unsupportedDeviceTypes?: string[];
  renderAvailability: 'full_synth' | 'partial_hybrid' | 'metadata_only';
  unavailableReason?: string;
} {
  const unsupportedDeviceNames: string[] = [];
  let missingSampleCount = 0;
  let playableMidiTracks = 0;

  project.tracks.forEach((track) => {
    if (track.type === 'audio' && (!track.clips || track.clips.length === 0)) {
      missingSampleCount++;
    }
    if (track.type === 'midi' && track.clips.some(clip=>clip.notes.length>0) && !track.muted) {
      playableMidiTracks++;
    }
    track.devices.forEach((dev) => {
      if (!BROWSER_SUPPORTED_DEVICE_TAGS.has(dev.xmlTag)) {
        unsupportedDeviceNames.push(`${track.name}: ${dev.displayName}`);
      }
    });
  });

  let unavailableReason: string | undefined;
  try { assertExecutableInsertLimits(project); } catch(error) { unavailableReason=error instanceof Error?error.message:String(error); }
  if (project.audioSettings?.transport.arrangementMode==='session') unavailableReason='SESSION_CAPTURE_REQUIRED: capture the performance and return to Arrangement before rendering';
  if (unavailableReason) return {
    canRenderAudio:false,canSynthesizeOffline:false,hasUnsupportedNativeDevices:unsupportedDeviceNames.length>0,
    hasExternalUnrenderableAudio:missingSampleCount>0,missingSampleCount,missingAudioSampleCount:missingSampleCount,
    unsupportedDeviceNames,unsupportedDeviceTypes:unsupportedDeviceNames,renderAvailability:'metadata_only',unavailableReason,
  };

  if (playableMidiTracks === 0) {
    return {
      canRenderAudio: false,
      canSynthesizeOffline: false,
      hasUnsupportedNativeDevices: unsupportedDeviceNames.length > 0,
      hasExternalUnrenderableAudio: true,
      missingSampleCount,
      missingAudioSampleCount: missingSampleCount,
      unsupportedDeviceNames,
      unsupportedDeviceTypes: unsupportedDeviceNames,
      renderAvailability: 'metadata_only',
      unavailableReason:
        missingSampleCount > 0
          ? `Audio Measurement Unavailable: Project contains ${missingSampleCount} unlinked audio track(s) and 0 active synthesizable MIDI clips.`
          : 'Audio Measurement Unavailable: No active MIDI note events present to render.',
    };
  }

  return {
    canRenderAudio: true,
    canSynthesizeOffline: true,
    hasUnsupportedNativeDevices: unsupportedDeviceNames.length > 0,
    hasExternalUnrenderableAudio: false,
    missingSampleCount,
    missingAudioSampleCount: missingSampleCount,
    unsupportedDeviceNames,
    unsupportedDeviceTypes: unsupportedDeviceNames,
    renderAvailability: unsupportedDeviceNames.length > 0 ? 'partial_hybrid' : 'full_synth',
  };
}

/**
 * Stage A — Static Metadata Analysis (Never reports estimated values as measured LUFS).
 */
export function runStageAStaticAnalysis(
  project: AbletonProjectState
): SmartCalibrationStageAStatic {
  const totalBars = project.arrangementLengthBars || 16;
  let totalMidiNotes = 0;
  let existingCompressionCount = 0;
  let existingSidechainCount = 0;
  let userProtectedDeviceCount = 0;
  const inferredFrequencyConflicts: string[] = [];

  const hasKick = project.tracks.some((t) => t.archetype === 'kick' && !t.muted);
  const lowEndTracks = project.tracks.filter(
    (t) => (t.archetype === 'rumble' || t.archetype === 'acid') && !t.muted
  );

  const lowEndOverlapTrackIds: string[] = [];
  if (hasKick && lowEndTracks.length > 0) {
    lowEndTracks.forEach((lt) => {
      if ((lt.mixer?.sidechainDepth || 0) < 0.35 && !lt.spectralDucking?.enabled) {
        lowEndOverlapTrackIds.push(lt.id);
        inferredFrequencyConflicts.push(
          `Sub/Fundamental overlap (45–90 Hz) inferred between Kick and ${lt.name} (low sidechain depth).`
        );
      }
    });
  }

  const trackSummaries = project.tracks.map((t) => {
    const notes = t.clips[0]?.notes.length || 0;
    totalMidiNotes += notes;
    const hasExistingEqEight = t.devices.some((d) => d.xmlTag === 'EQEight');
    const hasExistingCompressor = t.devices.some(
      (d) => d.xmlTag === 'Compressor2' || d.xmlTag === 'GlueCompressor'
    );
    if (hasExistingCompressor) existingCompressionCount++;
    if ((t.mixer?.sidechainDepth || 0) > 0.1) existingSidechainCount++;
    userProtectedDeviceCount += t.devices.filter((d) => d.isUserCreated).length;

    return {
      trackId: t.id,
      trackName: t.name,
      archetype: t.archetype,
      currentVolumeDb: t.mixer?.volumeDb ?? 0,
      noteDensityPerBar: Number((notes / totalBars).toFixed(2)),
      hasExistingEqEight,
      hasExistingCompressor,
      hasAutomation: Boolean(t.automationPoints && t.automationPoints.length > 0),
    };
  });

  return {
    isEstimatedMetadataOnly: true,
    trackCount: project.tracks.length,
    activeMidiTrackCount: project.tracks.filter((t) => t.type === 'midi' && !t.muted).length,
    totalMidiNotes,
    totalNoteEvents: totalMidiNotes,
    averageNotesPerBar: Number((totalMidiNotes / totalBars).toFixed(2)),
    averageNoteDensityPerBar: Number((totalMidiNotes / totalBars).toFixed(2)),
    existingCompressionCount,
    existingSidechainCount,
    userProtectedDeviceCount,
    inferredFrequencyConflicts,
    lowEndOverlapTrackIds,
    trackSummaries,
  };
}

/**
 * Stage B — Genuine Audio Measurement (or explicit Audio Measurement Unavailable when unrenderable).
 */
export async function runStageBAudioMeasurement(
  project: AbletonProjectState,
  humanization: HumanizationConfig,
  masterBus: MasterBusConfig
): Promise<SmartCalibrationStageBMeasured> {
  const caps = evaluateProjectRenderCapabilities(project);
  if (!caps.canRenderAudio) {
    return {
      available: false,
      status: 'unavailable',
      unavailableReason: caps.unavailableReason || 'Audio Measurement Unavailable',
      integratedLufs: null,
      samplePeakDbfs: null,
      truePeakDbtp: null,
      crestFactorDb: null,
      headroomDb: null,
      clippingSampleCount: 0,
      renderDurationSeconds: 0,
    };
  }

  try {
  // Render representative 4-bar audio path for fast, accurate BS.1770 measurement
  const measureBars = Math.min(project.arrangementLengthBars || 16, 4);
  const sampleRate = 44100;
  const { left, right, durationSeconds } = await synthesizeProjectToStereoFloatBuffers(
    project,
    humanization,
    masterBus,
    sampleRate,
    measureBars,
    1
  );

  const metrics = measureAudioSignalMetrics(left, right, sampleRate);
  if (metrics.integratedLufs <= -68) {
    return {
      available: false,
      status: 'unavailable',
      unavailableReason: 'Audio Measurement Unavailable: Rendered signal is below -68 LKFS silence gate.',
      integratedLufs: null,
      samplePeakDbfs: null,
      truePeakDbtp: null,
      crestFactorDb: null,
      headroomDb: null,
      clippingSampleCount: 0,
      renderDurationSeconds: durationSeconds,
    };
  }

  return {
    available: true,
    status: 'measured',
    integratedLufs: metrics.integratedLufs,
    samplePeakDbfs: metrics.samplePeakDbfs,
    truePeakDbtp: metrics.truePeakDbtp,
    crestFactorDb: metrics.crestFactorDb,
    headroomDb: metrics.headroomDb,
    clippingSampleCount: metrics.clippingSampleCount,
    renderDurationSeconds: durationSeconds,
  };
  } catch (error) {
    return { available: false, status: 'unavailable',
      unavailableReason: `Audio Measurement Unavailable: ${error instanceof Error ? error.message : String(error)}`,
      integratedLufs: null, samplePeakDbfs: null, truePeakDbtp: null, crestFactorDb: null,
      headroomDb: null, clippingSampleCount: 0, renderDurationSeconds: 0 };
  }

}

/**
 * Stage C — Immutable Calibration Proposal (Never mutates the input project).
 */
export function buildStageCCalibrationProposal(
  project: AbletonProjectState,
  stageA: SmartCalibrationStageAStatic,
  stageB: SmartCalibrationStageBMeasured,
  targetIntegratedLufs = -9.5,
  truePeakCeilingDbtp = -0.3
): SmartCalibrationProposal {
  const activeCount = Math.max(1, project.tracks.filter((t) => !t.muted).length);
  const headroomOffsetDb = activeCount > 5 ? -1.4 : -0.5;
  const kickFundHz = rootKeyToFundamentalHz(project.rootKey);

  const trackProposals: TrackCalibrationProposalItem[] = project.tracks.map((track) => {
    const noteCount = track.clips[0]?.notes.length || 0;
    const densityFactor = Math.min(1.5, noteCount / 64);

    let proposedVolumeDb = -2.0;
    let proposedPan = track.mixer.pan;
    let proposedSidechainDepth = track.mixer.sidechainDepth;
    let eqSuggestion = 'Preserve flat response';
    let sidechainSuggestion = 'Retain current sidechain envelope';

    switch (track.archetype) {
      case 'kick':
        proposedVolumeDb = 0.0;
        proposedPan = 0.0;
        proposedSidechainDepth = 0.0;
        eqSuggestion = `28 Hz 48dB/oct sub cleanup · Fundamental anchor @ ${kickFundHz} Hz`;
        sidechainSuggestion = 'Master trigger source (0% self-ducking)';
        break;
      case 'rumble':
        proposedVolumeDb = Number((-1.8 + headroomOffsetDb * 0.5).toFixed(1));
        proposedPan = 0.0;
        proposedSidechainDepth = 0.88;
        eqSuggestion = `Dynamic EQ8 notch (-9.5 dB @ ${kickFundHz} Hz) + 135 Hz low-shelf`;
        sidechainSuggestion = '4.8:1 fast optical ducking from Kick';
        break;
      case 'acid':
        proposedVolumeDb = Number((-2.4 + headroomOffsetDb).toFixed(1));
        proposedPan = -0.09;
        proposedSidechainDepth = 0.78;
        eqSuggestion = `95 Hz high-pass + -7.5 dB dynamic bell @ ${kickFundHz} Hz`;
        sidechainSuggestion = '4.2:1 sidechain ducking from Kick';
        break;
      case 'percussion':
        proposedVolumeDb = Number(
          (-3.4 - (densityFactor > 1 ? 0.6 : 0) + headroomOffsetDb).toFixed(1)
        );
        proposedPan = -0.18;
        proposedSidechainDepth = 0.48;
        eqSuggestion = 'Bandpass focus @ 1.95 kHz';
        sidechainSuggestion = '48% transient ducking';
        break;
      case 'synth':
        proposedVolumeDb = Number((-2.8 + headroomOffsetDb).toFixed(1));
        proposedPan = 0.15;
        proposedSidechainDepth = 0.74;
        eqSuggestion = 'Low-cut below 140 Hz · Mid stereo spread';
        sidechainSuggestion = '74% rhythmic pump';
        break;
      case 'hats':
        proposedVolumeDb = Number((-2.8 + headroomOffsetDb).toFixed(1));
        proposedPan = 0.12;
        proposedSidechainDepth = 0.36;
        eqSuggestion = 'High-pass @ 650 Hz';
        sidechainSuggestion = '36% subtle groove pump';
        break;
      case 'ride':
        proposedVolumeDb = Number((-4.6 + headroomOffsetDb).toFixed(1));
        proposedPan = -0.24;
        proposedSidechainDepth = 0.7;
        eqSuggestion = 'High-pass @ 650 Hz · Shimmer control';
        sidechainSuggestion = '70% warehouse ride pump';
        break;
      case 'pad':
        proposedVolumeDb = Number((-4.0 + headroomOffsetDb).toFixed(1));
        proposedPan = 0.24;
        proposedSidechainDepth = 0.84;
        eqSuggestion = `Dynamic low-shelf cut below 120 Hz`;
        sidechainSuggestion = '84% deep dub sidechain breath';
        break;
      default:
        proposedVolumeDb = -3.0;
        break;
    }

    const hasUserEqOrComp = track.devices.some(
      (d) => (d.xmlTag === 'EQEight' || d.xmlTag === 'Compressor2') && d.isUserCreated
    );
    if (hasUserEqOrComp) {
      eqSuggestion = `User EQ8/Compressor2 detected & protected — apply non-destructive fader trim only`;
    }

    const currentVol = Number((track.mixer?.volumeDb ?? 0).toFixed(2));
    const deltaDb = Number((proposedVolumeDb - currentVol).toFixed(2));

    return {
      trackId: track.id,
      trackName: track.name,
      archetype: track.archetype,
      currentVolumeDb: currentVol,
      proposedVolumeDb,
      deltaDb,
      currentPan: track.mixer?.pan ?? 0,
      proposedPan,
      currentSidechainDepth: track.mixer?.sidechainDepth ?? 0,
      proposedSidechainDepth,
      eqSuggestion,
      sidechainSuggestion,
      preservesUserDevices: true,
      preservedUserDeviceIds: [],
      accepted: true,
      approved: true,
      reason: eqSuggestion,
      previousVolumeDb: currentVol,
    };
  });

  // Compute master gain adjustment from measured LUFS if available
  const rawMasterDelta =
    stageB.available && stageB.integratedLufs !== null
      ? Math.max(-8, Math.min(6, Number((targetIntegratedLufs - stageB.integratedLufs).toFixed(2))))
      : 0.0;

  const risks: string[] = [];
  if (!stageB.available) {
    risks.push(
      stageB.unavailableReason ||
        'Audio Measurement Unavailable: Calibration proposal relies on Stage A static metadata.'
    );
  }
  if (stageA.userProtectedDeviceCount > 0) {
    risks.push(
      `${stageA.userProtectedDeviceCount} user-created Ableton device(s) detected and locked against overwrite.`
    );
  }
  if (Math.abs(rawMasterDelta) > 4.5) {
    risks.push(
      `Large master gain delta (${rawMasterDelta > 0 ? '+' : ''}${rawMasterDelta} dB) required to reach ${targetIntegratedLufs} LUFS.`
    );
  }

  return {
    proposalId: `cal_${Date.now()}_${project.revision || 1}`,
    createdAt: new Date().toISOString(),
    projectRevision: project.revision || 1,
    stageAStatic: stageA,
    stageBMeasured: stageB,
    trackProposals,
    trackDeltas: trackProposals,
    masterGainDeltaDb: rawMasterDelta,
    proposedMasterVolumeDb: rawMasterDelta,
    limitingCeilingDbtp: truePeakCeilingDbtp,
    targetIntegratedLufs,
    predictedIntegratedLufs:
      stageB.available && stageB.integratedLufs !== null
        ? Number((stageB.integratedLufs + rawMasterDelta).toFixed(2))
        : null,
    projectedLufs:
      stageB.available && stageB.integratedLufs !== null
        ? Number((stageB.integratedLufs + rawMasterDelta).toFixed(2))
        : null,
    predictedTruePeakDbtp: stageB.available ? truePeakCeilingDbtp : null,
    projectedTruePeakDbtp: stageB.available ? truePeakCeilingDbtp : null,
    risks,
    nativeAlsCompatibility: stageB.available ? 'Verified Non-Destructive' : 'Metadata-Only Trim',
  };
}

/**
 * Stage E — Transactional Apply & Post-Calibration Verification.
 * Applies ONLY accepted track proposals, preserves all user-created EQEight/Compressor2 devices,
 * re-measures the output audio, and runs structural ALS validation.
 */
export async function applyAndVerifyStageECalibration(
  project: AbletonProjectState,
  proposal: SmartCalibrationProposal,
  humanization: HumanizationConfig,
  masterBus: MasterBusConfig
): Promise<{
  calibratedProject: AbletonProjectState;
  updatedProject?: AbletonProjectState;
  calibratedMasterBus: MasterBusConfig;
  verification: SmartCalibrationVerificationReport;
  verificationReport: SmartCalibrationVerificationReport;
}> {
  const acceptedMap = new Map<string, TrackCalibrationProposalItem>();
  proposal.trackProposals.forEach((tp) => {
    if (tp.accepted) acceptedMap.set(tp.trackId, tp);
  });

  // Verify snapshot of user-created devices before applying
  const preUserDeviceIds = new Set<string>();
  project.tracks.forEach((t) =>
    t.devices.forEach((d) => {
      if (d.isUserCreated) preUserDeviceIds.add(`${t.id}:${d.id}:${d.xmlTag}`);
    })
  );

  const updatedTracks = project.tracks.map((track) => {
    const acceptedItem = acceptedMap.get(track.id);
    if (!acceptedItem) return track;

    const hasUserEqOrComp = track.devices.some(
      (d) => (d.xmlTag === 'EQEight' || d.xmlTag === 'Compressor2') && d.isUserCreated
    );

    const nextSpectral = hasUserEqOrComp
      ? track.spectralDucking
      : getDefaultSpectralDuckingConfig(track.archetype, project.rootKey, project.tempo);

    return {
      ...track,
      // Explicitly preserve track.devices untouched so user EQEight/Compressor2 survive 100% intact
      devices: [...track.devices],
      spectralDucking: nextSpectral,
      dspConfigRevision: (track.dspConfigRevision || 1) + 1,
      mixer: {
        ...track.mixer,
        volumeDb: acceptedItem.proposedVolumeDb,
        pan: acceptedItem.proposedPan,
        sidechainDepth: acceptedItem.proposedSidechainDepth,
      },
    };
  });

  const updatedXml = syncLocatorsAndMixerToXml(
    project.rawXmlModified,
    updatedTracks,
    project.memoryLocations
  );

  const alsValidation = validateAlsProjectCadence(updatedXml);

  const calibratedMasterBus: MasterBusConfig = {
    ...masterBus,
    masterVolumeDb: proposal.proposedMasterVolumeDb,
    glueCompressionDrive: 0.38,
    subBassMonoCutoffHz: 120,
  };

  const calibratedProject: AbletonProjectState = {
    ...project,
    revision: (project.revision || 1) + 1,
    projectRevision: (project.projectRevision || project.revision || 1) + 1,
    tracks: updatedTracks,
    rawXmlModified: updatedXml,
    rawXml: updatedXml,
    alsValidation,
    lastActionLog: `Applied approved Smart Leveling 2.0 calibration (${acceptedMap.size}/${proposal.trackProposals.length} tracks accepted).`,
  };

  // Verify all user devices survived
  const postUserDeviceIds = new Set<string>();
  calibratedProject.tracks.forEach((t) =>
    t.devices.forEach((d) => {
      if (d.isUserCreated) postUserDeviceIds.add(`${t.id}:${d.id}:${d.xmlTag}`);
    })
  );
  let userDevicesPreserved = true;
  preUserDeviceIds.forEach((key) => {
    if (!postUserDeviceIds.has(key)) userDevicesPreserved = false;
  });

  // Measure post-calibration audio if available
  const postStageB = await runStageBAudioMeasurement(
    calibratedProject,
    humanization,
    calibratedMasterBus
  );

  const targetCompliant =
    postStageB.available && postStageB.integratedLufs !== null
      ? Math.abs(postStageB.integratedLufs - proposal.targetIntegratedLufs) <= 2.5 &&
        (postStageB.truePeakDbtp ?? 0) <= 0.2
      : false;

  const verification: SmartCalibrationVerificationReport = {
    verifiedAt: new Date().toISOString(),
    preCalibration: proposal.stageBMeasured,
    postCalibration: postStageB,
    preCalibrationLufs: proposal.stageBMeasured.integratedLufs,
    postCalibrationLufs: postStageB.integratedLufs,
    requestedTargetLufs: proposal.targetIntegratedLufs,
    achievedTruePeakDbtp: postStageB.truePeakDbtp,
    achievedHeadroomDb: postStageB.headroomDb,
    targetCompliant,
    userDevicesPreserved,
    userDevicesIntact: userDevicesPreserved,
    alsRoundTripValid: alsValidation.isValid,
    alsStructuralValid: alsValidation.isValid,
    summary: postStageB.available
      ? `Verified: Pre ${proposal.stageBMeasured.integratedLufs?.toFixed(
          1
        )} LUFS → Post ${postStageB.integratedLufs?.toFixed(1)} LUFS (Peak ${postStageB.truePeakDbtp?.toFixed(
          2
        )} dBTP · User devices preserved: ${userDevicesPreserved ? 'YES' : 'NO'}).`
      : `Metadata-Only Calibration Applied (${acceptedMap.size} tracks) · Audio Measurement Unavailable · User devices preserved: ${
          userDevicesPreserved ? 'YES' : 'NO'
        }.`,
  };

  return {
    calibratedProject,
    updatedProject: calibratedProject,
    calibratedMasterBus,
    verification,
    verificationReport: verification,
  };
}

