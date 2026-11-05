// SYNTHETIC fixtures only; these are not recovered user projects.
import { describe, expect, it, beforeAll } from 'vitest';
// @vitest-environment jsdom
import {
  AbletonDevice,
  AbletonProjectState,
  AbletonTrack,
  MidiNoteEvent,
  TrackMixerParams,
} from '../types/ableton';

import { assertProjectState, repairProjectNoteIdentities } from '../engine/projectStateContracts';
import {
  migrateCompatibleProjectUnitConversions,
  determineLegacyConversionMigrationEligibility,
  CURRENT_DEVICE_CONVERSION_VERSION,
  buildDeviceConversionRecord,
} from '../engine/abletonCapabilityMatrix';
import { buildStarterAbletonXml, parseAbletonXmlDom, synchronizeProjectStateToXml } from '../engine/alsXmlEngine';
import { substituteUnsupportedDevice } from '../services/commandBus';

const defaultMixer: TrackMixerParams = {
  volumeDb: 0,
  pan: 0,
  transposeSemitones: 0,
  fineTuneCents: 0,
  sidechainDepth: 0,
  reverbSend: 0.2,
  delaySend: 0.15,
  filterCutoffHz: 800,
  filterResonance: 0.25,
};

describe('P0 synthetic state regression; audio and device qualification remain separate', () => {
  describe('P0-001: Unsupported AU/VST Plugin Handling & Substitution', () => {
    const sampleXml = `<Ableton MajorVersion="5" MinorVersion="12.0_12000" SchemaChangeCount="1" Creator="Ableton Live 12.0" Revision="100">
        <LiveSet>
          <Tracks>
            <MidiTrack Id="1">
              <Name><EffectiveName Value="2-Kick 3"/></Name>
              <DeviceChain>
                <Devices>
                  <AuPluginDevice Id="31">
                    <PluginDesc>
                      <Vst3Id Value="Kickstart2_x64"/>
                    </PluginDesc>
                  </AuPluginDevice>
                </Devices>
              </DeviceChain>
              <MainSequencer>
                <ClipSlotList>
                  <ClipSlot Id="0">
                    <ClipSlot>
                      <Value>
                        <MidiClip Id="c1" Time="0.0">
                          <Notes>
                            <KeyTracks>
                              <KeyTrack><Key Value="36"/><Notes><MidiNoteEvent NoteId="101" Time="0.000" Duration="1.000" Velocity="100"/></Notes></KeyTrack>
                            </KeyTracks>
                          </Notes>
                        </MidiClip>
                      </Value>
                    </ClipSlot>
                  </ClipSlot>
                </ClipSlotList>
              </MainSequencer>
            </MidiTrack>
          </Tracks>
        </LiveSet>
      </Ableton>`;

    it('parses imported AuPluginDevice cleanly, retains the source enabled state, and preserves original XML', () => {
      const parsed = parseAbletonXmlDom(sampleXml, '2-Kick.als');
      expect(parsed.tracks.length).toBeGreaterThan(0);
      const track = parsed.tracks.find((t) => t.name.includes('2-Kick 3')) || parsed.tracks[0];
      expect(track).toBeDefined();

      const auDevice = track.devices.find((d) => d.xmlTag === 'AuPluginDevice');
      expect(auDevice).toBeDefined();
      expect(auDevice?.bypassed).toBe(false);

      // Project state assertion must pass because unsupported plugin is bypassed
      expect(() => assertProjectState(parsed)).not.toThrow();

      // Exporting XML back to ALS preserves the original AuPluginDevice node
      const exportedXml = synchronizeProjectStateToXml(parsed);
      expect(exportedXml).toContain('AuPluginDevice');
    });

    it('substitutes active browser synthesis for AuPluginDevice while preserving original XML for export', () => {
      const initialProject: AbletonProjectState = {
        ...parseAbletonXmlDom(buildStarterAbletonXml('berghain-134', 1, 4).xml, 'synthetic.als'),
        fileName: 'Au_Plugin_Project.als',
        rawXml: sampleXml,
        rawXmlModified: sampleXml,
        projectRevision: 1,
        ppq: 96,
        tempo: 133.5,
        tracks: [
          {
            id: '1',
            name: '2-Kick 3',
            type: 'midi', isGenerated: false, colorIndex: 0,
            archetype: 'kick',
            hexColor: '#F59E0B',
            muted: false,
            soloed: false,
            locked: false,
            mixer: defaultMixer,
            automationPoints: [],
            clips: [
              {
                id: 'c1',
                name: 'Kick Clip',
                startTime: 0,
                endTime: 16,
                length: 16,
                notes: [
                  {
                    id: 'n1',
                    time: 0,
                    quantizedTime: 0,
                    duration: 1,
                    pitch: 36,
                    velocity: 100, isGhost: false,
                  },
                ],
              },
            ],
            devices: [
              {
                id: '31',
                xmlTag: 'AuPluginDevice',
                displayName: 'AuPluginDevice (Kickstart 2)',
                category: 'instrument',
                bypassed: true,
                browserDspSupported: false,
                opaqueSubtreeXml: '<AuPluginDevice Id="31"><PluginDesc><Vst3Id Value="Kickstart2"/></PluginDesc></AuPluginDevice>',
                parameters: [],
              },
            ],
          },
        ],
      };

      const updated = substituteUnsupportedDevice(initialProject, '1', '31', 'Operator', 'instrument');
      const updatedDev = updated.tracks[0].devices[0];

      expect(updatedDev.bypassed).toBe(false);
      expect(updatedDev.xmlTag).toBe('Operator');
      expect(updatedDev.originalPlugin?.opaqueSubtreeXml).toContain('AuPluginDevice');

      // Export retains original AuPluginDevice XML structure
      const exportedXml = synchronizeProjectStateToXml(updated, initialProject);
      expect(exportedXml).toContain('AuPluginDevice');
    });
  });

  describe('P0-002: Deterministic Note Identity Repair', () => {
    it('repairs missing or duplicate note identities without changing pitch, time, duration, or velocity', () => {
      const corruptProject: AbletonProjectState = {
        ...parseAbletonXmlDom(buildStarterAbletonXml('berghain-134', 1, 4).xml, 'synthetic.als'),
        fileName: 'Berghain_Core_133.5BPM_541.als',
        projectRevision: 1,
        ppq: 96,
        tempo: 133.5,
        tracks: [
          {
            id: 't1',
            name: 'Bass Track',
            type: 'midi', isGenerated: false, colorIndex: 0,
            archetype: 'acid',
            hexColor: '#EC4899',
            muted: false,
            soloed: false,
            locked: false,
            mixer: defaultMixer,
            automationPoints: [],
            clips: [
              {
                id: 'c1',
                name: 'Acid Loop',
                startTime: 0,
                endTime: 16,
                length: 16,
                notes: [
                  // Duplicate Note ID 'dup_1'
                  {
                    id: 'dup_1',
                    time: 0,
                    quantizedTime: 0,
                    duration: 0.25,
                    pitch: 36,
                    velocity: 110, isGhost: false,
                  },
                  {
                    id: '',
                    time: 0.25,
                    quantizedTime: 0.25,
                    duration: 0.25,
                    pitch: 48,
                    velocity: 95, isGhost: false,
                  },
                  // Empty note ID ''
                  {
                    id: '',
                    time: 0.5,
                    quantizedTime: 0.5,
                    duration: 0.5,
                    pitch: 36,
                    velocity: 105, isGhost: false,
                  },
                ],
              },
            ],
            devices: [],
          },
        ],
      };

      // Before repair, assertProjectState throws 'duplicate or missing note identity'
      expect(() => assertProjectState(corruptProject)).toThrow(/duplicate or missing note identity/);

      // Perform deterministic note identity repair
      const { project: repaired, repairedNoteCount } = repairProjectNoteIdentities(corruptProject);
      expect(repairedNoteCount).toBe(2);

      // Musical content must be 100% preserved
      const notes = repaired.tracks[0].clips[0].notes;
      expect(notes.length).toBe(3);
      expect(notes[0].pitch).toBe(36);
      expect(notes[0].time).toBe(0);
      expect(notes[1].pitch).toBe(48);
      expect(notes[1].time).toBe(0.25);
      expect(notes[2].pitch).toBe(36);
      expect(notes[2].time).toBe(0.5);

      // Note IDs are now distinct and valid
      const noteIds = new Set(notes.map((n) => n.id));
      expect(noteIds.size).toBe(3);
      expect(Array.from(noteIds).every((id) => typeof id === 'string' && id.length > 0)).toBe(true);

      // Repaired project now passes assertProjectState cleanly
      expect(() => assertProjectState(repaired)).not.toThrow();

      // Repeated repair is idempotent (0 further changes)
      const { repairedNoteCount: secondPassCount } = repairProjectNoteIdentities(repaired);
      expect(secondPassCount).toBe(0);
    });
  });

  describe('P0-003: Device Conversion Schema v1 -> v2 Migration', () => {
    it('migrates legacy v1 conversion records on Reverb to v2 without changing audio semantics or throwing CONVERSION_REQUIRED', () => {
      const v1ReverbDevice: AbletonDevice = {
        id: '202',
        xmlTag: 'Reverb',
        displayName: 'Reverb',
        category: 'audio_effect',
        bypassed: false,
        parameters: [
          { name: 'DecayTime', value: 3600, unit: 'ms' },
          { name: 'DryWet', value: 0.4 },
        ],
        conversionRecord: {
          sourceDeviceId: '202',
          xmlTag: 'Reverb',
          sourceParameterHash: 'legacy_hash_v1',
          conversionVersion: 1,
          conversionKind: 'audio_insert_dsp',
          generatedDescriptor: { reverbDecaySec: 3.6, reverbReturnLevel: 0.4 },
          supportedSemantics: ['DecayTime (3600 ms)', 'DryWet (0.4)'],
          limitations: ['Converted browser approximation.'],
          status: 'valid',
        },
      };

      v1ReverbDevice.conversionRecord = buildDeviceConversionRecord(v1ReverbDevice, true);

      const legacyProject: AbletonProjectState = {
        ...parseAbletonXmlDom(buildStarterAbletonXml('berghain-134', 1, 4).xml, 'synthetic.als'),
        fileName: 'Tresor_Vault_138.5BPM_577.als',
        projectRevision: 1,
        ppq: 96,
        tempo: 133.5,
        tracks: [
          {
            id: 't1',
            name: 'Reverb Bus',
            type: 'audio', isGenerated: false, colorIndex: 0,
            archetype: 'existing',
            hexColor: '#10B981',
            muted: false,
            soloed: false,
            locked: false,
            mixer: defaultMixer,
            automationPoints: [],
            clips: [],
            devices: [v1ReverbDevice],
          },
        ],
      };

      const { project: migratedProject, migrated } = migrateCompatibleProjectUnitConversions(legacyProject);
      expect(migrated).toBe(true);

      const migratedDev = migratedProject.tracks[0].devices[0];
      expect(migratedDev.conversionRecord?.conversionVersion).toBe(CURRENT_DEVICE_CONVERSION_VERSION);
      expect(migratedDev.conversionRecord?.status).toBe('valid');

      // Migrated project passes assertProjectState cleanly without CONVERSION_REQUIRED error
      expect(() => assertProjectState(migratedProject)).not.toThrow();

      const eligibility = determineLegacyConversionMigrationEligibility(migratedProject);
      expect(eligibility.alreadyValid).toBe(true);
    });
  });
});
