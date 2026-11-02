// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildStarterAbletonXml, parseAlsXmlString } from '../engine/alsXmlEngine';
import { encodeProjectSnapshot, decodeProjectSnapshot } from '../services/projectSnapshotService';
import type { HumanizationConfig, MasterBusConfig, TransportConfig } from '../types/ableton';
const humanization: HumanizationConfig = { cutoffHz: 145, microTimingMaxShiftBeats: 0.01, velocityVariancePct: 0.08,
  ghostVelocityMin: 20, ghostVelocityMax: 45, lfoRateHz: 0.1, lfoDepth: 0.4, macroTransition: 42 };
const master: MasterBusConfig = { masterVolumeDb: -2, glueCompressionDrive: 0.3, reverbDecaySec: 3,
  reverbReturnLevel: 0.3, delayFeedback: 0.4, delayReturnLevel: 0.2, subBassMonoCutoffHz: 120 };
const transport: TransportConfig = { loopEnabled: false, loopStartBar: 1, loopLengthBars: 4,
  metronomeEnabled: false, followPlayhead: true, showAutomationLanes: true, arrangementLengthBars: 4 };
function fixture() { return parseAlsXmlString(buildStarterAbletonXml('berghain-134', 777, 4).xml); }

describe('G1 portable project persistence', () => {
  it('reopens canonical events, devices, takes, automation, source XML and audio settings without humanization or regeneration', () => {
    const p = fixture(); p.tracks[0].muted = true;
    p.tracks[0].clips[0].notes[0].time = 0.375;
    p.tracks[0].automationPoints = [{ beat: 0, value: 0.2 }, { beat: 15.75, value: 0.9 }];
    const before = JSON.stringify(p);
    const text = encodeProjectSnapshot(p, humanization, master, transport);
    const reopened = decodeProjectSnapshot(text);
    expect(JSON.stringify(p)).toBe(before);
    expect(reopened.project.tracks).toEqual(p.tracks);
    expect(reopened.project.rawXmlOriginal).toBe(p.rawXmlOriginal);
    expect(reopened.audioSettings).toEqual({ humanization, masterBus: master, transport });
    const reimport = parseAlsXmlString(reopened.project.rawXmlModified);
    expect(reimport.tracks[0].clips[0].notes.find(n => n.id === p.tracks[0].clips[0].notes[0].id)?.time).toBe(0.375);
    expect(decodeProjectSnapshot(encodeProjectSnapshot(reopened.project, humanization, master, transport)).project.tracks).toEqual(p.tracks);
  });
  it('rejects future versions, corrupted files and non-finite state without touching the input', () => {
    const p = fixture();
    const text = encodeProjectSnapshot(p, humanization, master, transport);
    const future = JSON.parse(text); future.version = 999;
    expect(() => decodeProjectSnapshot(JSON.stringify(future))).toThrow(/VERSION/);
    expect(() => decodeProjectSnapshot('{broken')).toThrow(/JSON/);
    const duplicate = JSON.parse(text); duplicate.project.tracks.push(duplicate.project.tracks[0]);
    expect(() => decodeProjectSnapshot(JSON.stringify(duplicate))).toThrow(/identity/);
    expect(() => encodeProjectSnapshot(p, humanization, { ...master, delayFeedback: Infinity }, transport)).toThrow(/non-finite/);
  });
  it('persists a deliberately extended sparse song rather than shrinking it to the last clip', () => {
    const p = fixture(); p.arrangementLengthBars = 1024;
    const loaded = decodeProjectSnapshot(encodeProjectSnapshot(p, humanization, master, transport));
    expect(loaded.project.arrangementLengthBars).toBe(1024);
    expect(loaded.audioSettings.transport.arrangementLengthBars).toBe(1024);
    expect(parseAlsXmlString(loaded.project.rawXmlModified).arrangementLengthBars).toBe(1024);
  });
});
