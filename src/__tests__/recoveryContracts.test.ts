// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decomposeNotesIntoSectionClips,
  composeProjectConditionedLayerNotes,
  generateSectionArrangementPlan,
  generateSectionArrangementProposal,
} from '../engine/compositionIntelligenceEngine';
import { buildStarterAbletonXml, parseAlsXmlString } from '../engine/alsXmlEngine';
import { encodeAudioBufferToWavBlob, renderArrangementToWavBlob, shouldPlayNote } from '../engine/webAudioSynth';
import type { ArrangementSectionNode, HumanizationConfig, MasterBusConfig, MidiNoteEvent } from '../types/ableton';

const humanization: HumanizationConfig = {
  microTimingMaxShiftBeats: 0.015, swingStrength: 0, velocityVariancePct: 0.08,
  ghostVelocityMin: 20, ghostVelocityMax: 45, lfoRateHz: 0.1, lfoDepth: 0.4,
  cutoffHz: 145, macroTransition: 42,
};
const master: MasterBusConfig = {
  masterVolumeDb: 0, glueCompressionDrive: 0.35, reverbDecaySec: 3.2,
  reverbReturnLevel: 0.45, delayFeedback: 0.42, delayReturnLevel: 0.4, subBassMonoCutoffHz: 120,
};
const readBlob = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as ArrayBuffer);
  reader.onerror = () => reject(reader.error);
  reader.readAsArrayBuffer(blob);
});
const note: MidiNoteEvent = { id: 'intro-note', time: 0, quantizedTime: 0, duration: 0.5, pitch: 36, velocity: 100, isGhost: false };

afterEach(() => vi.unstubAllGlobals());

describe('Recovery contract: musical form and editable sections', () => {
  for (const bars of [24, 48, 96, 192]) {
    it(`covers exactly ${bars} bars without gaps, overlaps or overshoot`, () => {
      const sections = generateSectionArrangementPlan('hypnotic_longform', bars);
      expect(sections[0].startBar).toBe(1);
      expect(sections.at(-1)!.endBar).toBe(bars);
      sections.forEach((section, i) => {
        expect(section.endBar).toBeGreaterThanOrEqual(section.startBar);
        expect(section.endBar).toBeLessThanOrEqual(bars);
        if (i > 0) expect(section.startBar).toBe(sections[i - 1].endBar + 1);
      });
    });
  }
  it('repeats the same seeded form and varies opening orchestration or duration over 100 seeds', () => {
    const plan = (seed: number): ArrangementSectionNode[] => Reflect.apply(
      generateSectionArrangementPlan, undefined, ['hypnotic_longform', 128, seed]
    );
    const openings = new Set<string>();
    for (let seed = 1; seed <= 100; seed++) {
      const first = plan(seed);
      expect(plan(seed)).toEqual(first);
      openings.add(JSON.stringify({ endBar: first[0].endBar, active: first[0].activeArchetypes }));
      expect(first.at(-1)!.endBar).toBe(128);
    }
    expect(openings.size).toBeGreaterThan(1);
  });
  it('32-bar proposals expose only valid sections and clip roles agree with those sections', () => {
    const { xml } = buildStarterAbletonXml('berghain-134', 777, 32);
    const project = parseAlsXmlString(xml);
    const original = JSON.stringify(project);
    const proposal = generateSectionArrangementProposal(project, { targetBars: 32 });
    expect(JSON.stringify(project)).toBe(original);
    expect(proposal.totalSections).toBe(proposal.sections.length);
    for (const section of proposal.sections) {
      expect(section.startBar).toBeGreaterThanOrEqual(1);
      expect(section.endBar).toBeGreaterThanOrEqual(section.startBar);
      expect(section.endBar).toBeLessThanOrEqual(32);
    }
    for (const track of proposal.proposedTracks) for (const clip of track.clips) {
      const section = proposal.sections.find((s) => clip.startTime >= (s.startBar - 1) * 4 && clip.startTime < s.endBar * 4);
      expect(section).toBeDefined();
      expect(clip.sectionRole).toBe(section!.role);
    }
  });
  it('honors inactive archetypes in the intro and never resurrects excluded notes via a fallback clip', () => {
    const sections: ArrangementSectionNode[] = [{
      id: 'intro', name: 'Atmosphere', role: 'Intro', startBar: 1, endBar: 4,
      targetEnergy: 0.2, activeArchetypes: ['pad'], sectionEvent: 'Pad only',
    }, {
      id: 'groove', name: 'Groove', role: 'Groove_Establish', startBar: 5, endBar: 8,
      targetEnergy: 0.5, activeArchetypes: ['kick'], sectionEvent: 'Kick enters',
    }];
    const clips = decomposeNotesIntoSectionClips('Kick', 'kick', [note], 8, sections);
    expect(clips.flatMap((c) => c.notes)).toEqual([]);
  });
});

describe('Recovery contract: WAV validation and honest render capability', () => {
  for (const bitDepth of [16, 24, 32] as const) {
    it(`encodes finite stereo ${bitDepth}-bit samples with correct RIFF fields`, async () => {
      const left = new Float32Array([0, 0.5, -0.5, 1]);
      const right = new Float32Array([0, -0.25, 0.25, -1]);
      const progress: number[] = [];
      const blob = await encodeAudioBufferToWavBlob({ numberOfChannels: 2, sampleRate: 48000,
        length: left.length, getChannelData: (channel) => channel === 0 ? left : right }, bitDepth, (pct) => progress.push(pct));
      const bytes = await readBlob(blob);
      const view = new DataView(bytes);
      const ascii = (offset: number, length: number) => String.fromCharCode(...new Uint8Array(bytes, offset, length));
      expect(ascii(0, 4)).toBe('RIFF'); expect(ascii(8, 4)).toBe('WAVE');
      expect(view.getUint32(4, true)).toBe(bytes.byteLength - 8);
      expect(view.getUint16(20, true)).toBe(bitDepth === 32 ? 3 : 1);
      expect(view.getUint16(22, true)).toBe(2); expect(view.getUint32(24, true)).toBe(48000);
      expect(view.getUint16(34, true)).toBe(bitDepth);
      expect(view.getUint32(40, true)).toBe(4 * 2 * bitDepth / 8);
      expect(progress.at(-1)).toBe(100);
      if (bitDepth === 16) {
        expect(view.getInt16(48, true)).toBe(16384);
        expect(view.getInt16(50, true)).toBe(-8192);
      } else if (bitDepth === 24) {
        const int24 = (offset: number) => {
          const value = view.getUint8(offset) | view.getUint8(offset + 1) << 8 | view.getUint8(offset + 2) << 16;
          return value & 0x800000 ? value - 0x1000000 : value;
        };
        expect(int24(50)).toBe(4194304);
        expect(int24(53)).toBe(-2097152);
      } else if (bitDepth === 32) {
        expect(view.getFloat32(52, true)).toBe(0.5);
        expect(view.getFloat32(56, true)).toBe(-0.25);
      }
    });
  }
  it('rejects NaN samples rather than silently producing invalid audio', async () => {
    await expect(encodeAudioBufferToWavBlob({ numberOfChannels: 2, sampleRate: 44100,
      length: 2, getChannelData: () => new Float32Array([0.5, NaN]) })).rejects.toThrow(/NONFINITE/);
  });
  it('rejects a silent output rather than claiming a successful musical export', async () => {
    await expect(encodeAudioBufferToWavBlob({ numberOfChannels: 2, sampleRate: 44100,
      length: 4, getChannelData: () => new Float32Array(4) })).rejects.toThrow(/SILENT/);
  });
  it('reports unsupported rendering rather than exporting with a different synthesizer', async () => {
    vi.stubGlobal('OfflineAudioContext', undefined);
    const { xml } = buildStarterAbletonXml('berghain-134', 777, 16);
    const project = parseAlsXmlString(xml);
    await expect(renderArrangementToWavBlob(project, humanization, master, 16, 24)).rejects.toThrow(/UNSUPPORTED/);
  });
});

describe('Recovery review: imported durations and canonical composition plans', () => {
  for (const bars of [24, 192, 512, 1024]) it(`preserves ${bars}-bar ALS duration without planner truncation`, () => {
    const { xml } = buildStarterAbletonXml('berghain-134', 777, 4);
    const dom = new DOMParser().parseFromString(xml, 'application/xml');
    dom.querySelectorAll('MidiClip > CurrentEnd').forEach(node => node.setAttribute('Value', String(bars * 4)));
    const project = parseAlsXmlString(new XMLSerializer().serializeToString(dom));
    expect(project.arrangementLengthBars).toBe(bars);
    expect(generateSectionArrangementPlan('hypnotic_longform', bars).at(-1)?.endBar).toBe(bars);
  });
});

it('composition follows the requested seed/form instead of stale project sections', () => {
  const { xml } = buildStarterAbletonXml('berghain-134', 777, 32);
  const project = parseAlsXmlString(xml);
  project.arrangementSections = generateSectionArrangementPlan('deep_dub_evolution', 32, 1);
  const stale = composeProjectConditionedLayerNotes(project, 'rumble', 'hypnotic_evolving', 'industrial_assault', humanization, 123, 456, 32);
  const fresh = composeProjectConditionedLayerNotes({ ...project, arrangementSections: undefined }, 'rumble', 'hypnotic_evolving', 'industrial_assault', humanization, 123, 456, 32);
  expect(stale.notes).toEqual(fresh.notes);
});

it('zero-probability notes are excluded and first-pass eligibility is reproducible', () => {
  expect(shouldPlayNote({ ...note, probability: 0 })).toBe(false);
  expect(shouldPlayNote({ ...note, probability: 1 })).toBe(true);
  const candidate = { ...note, probability: 0.5 };
  expect(shouldPlayNote(candidate)).toBe(shouldPlayNote(candidate));
});
