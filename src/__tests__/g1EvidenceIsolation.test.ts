// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildStarterAbletonXml, parseAlsXmlString } from '../engine/alsXmlEngine';
import { validateAlsProjectCadence } from '../engine/compositionIntelligenceEngine';
import { StudioCommandBus } from '../services/commandBus';

const fixture = () => parseAlsXmlString(buildStarterAbletonXml('berghain-134', 777, 4).xml);
const simpleXml = (devices = '') => `<Ableton><LiveSet><Tracks><MidiTrack Id="1"><DeviceChain><Devices>${devices}</Devices></DeviceChain></MidiTrack></Tracks><MasterTrack Id="2"/></LiveSet></Ableton>`;

describe('G1 history isolation and evidence-scoped ALS validation', () => {
  it('history inspection cannot change a later redo', () => {
    const project = fixture(); const bus = new StudioCommandBus();
    bus.executeMutation('p', 'mute', 'mixer', project, draft => { draft.tracks[0].muted = true; return draft; });
    bus.getHistory('p')[0].afterState.tracks[0].clips = [];
    bus.undo('p');
    expect(bus.redo('p')!.tracks[0].clips).toEqual(project.tracks[0].clips);
  });

  it('a mutator returning caller-owned state does not let bookkeeping mutate the caller', () => {
    const project = fixture(); const original = JSON.stringify(project);
    const bus = new StudioCommandBus();
    const next = bus.executeMutation('p', 'same object', 'mixer', project, () => project);
    expect(JSON.stringify(project)).toBe(original);
    expect(next.projectRevision).toBeGreaterThan(project.projectRevision || project.revision || 1);
  });

  it('valid XML cannot certify a Live version, round trip or unknown-structure preservation', () => {
    const report = validateAlsProjectCadence(simpleXml());
    expect(report.isValid).toBe(true);
    expect(report.roundTripVerified).toBe(false);
    expect(report.unknownNodesPreserved).toBe(false);
    expect(report.compatibilityStatus).toBe('Inspect & Edit Supported');
    expect(report.diagnostics.join(' ')).toContain('NOT TESTED');
  });

  it('checks explicit Pointee IDs independently of track IDs', () => {
    const report = validateAlsProjectCadence(simpleXml('<Pointee Id="8"/><Pointee Id="8"/>'));
    expect(report.uniquePointeeIds).toBe(false);
    expect(report.isValid).toBe(false);
    expect(report.compatibilityStatus).toBe('Schema Warning');
  });

  it('does not call a nonempty dangling sidechain source verified', () => {
    const report = validateAlsProjectCadence(simpleXml('<Compressor2><Sidechain><SourceTrack Value="missing"/></Sidechain></Compressor2>'));
    expect(report.validSidechainRouting).toBe(false);
    expect(report.diagnostics.join(' ')).toContain('Unresolved sidechain');
  });
});
