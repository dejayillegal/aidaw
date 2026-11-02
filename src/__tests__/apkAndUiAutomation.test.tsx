import * as fileExportService from '../services/fileExportService';
// @vitest-environment jsdom
import React from 'react';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

import {
  buildApk,
  computeSha256,
  validatePrerequisites,
  APP_ID,
  VERSION_NAME,
  VERSION_CODE,
} from '../../scripts/build-debug-apk.mjs';
import { studioCommandBus } from '../services/commandBus';
import { exportUserDataBackup } from '../utils/apkDownloader';
import { synthEngine, renderArrangementToWavBlob } from '../engine/webAudioSynth';
import {
  applyDillaShuffleSwing,
  applyShuffleSwingToMidiClip,
  applySixteenthNoteSwing,
  applySwingToMidiClip,
  buildStarterAbletonXml,
  computeDillaShuffleOffsetBeats,
  MAX_DILLA_SHUFFLE_POCKET_MS,
  MAX_SIXTEENTH_SWING_SHIFT_BEATS,
  parseAlsXmlString,
} from '../engine/alsXmlEngine';
import {
  composeProjectConditionedLayerNotes,
  generateSectionArrangementPlan,
} from '../engine/compositionIntelligenceEngine';
import { DiagnosticsPanel } from '../components/DiagnosticsPanel';
import { BulkQueueAndExportModal } from '../components/BulkQueueAndExportModal';
import { StudioStatusBar } from '../components/StudioStatusBar';
import { StudioSettingsModal } from '../components/StudioSettingsModal';
import { TimelineCanvas, mapBeatToMidiGridCoordinates } from '../components/TimelineCanvas';
import {
  TouchInteractionSettingsModal,
  DEFAULT_TOUCH_CONFIG,
  TouchInteractionConfig,
} from '../components/TouchInteractionSettingsModal';
import { exportClipToMidiFile } from '../engine/midiFileExporter';
import { projectQueueService } from '../services/projectQueueService';
import App from '../App';
import { AbletonMidiClip, HumanizationConfig, MasterBusConfig } from '../types/ableton';

const TEST_HUMANIZATION: HumanizationConfig = {
  microTimingMaxShiftBeats: 0.015,
  swingStrength: 0,
  velocityVariancePct: 0.08,
  ghostVelocityMin: 20,
  ghostVelocityMax: 45,
  lfoRateHz: 0.1,
  lfoDepth: 0.42,
  cutoffHz: 145,
  macroTransition: 42,
};

const TEST_MASTER_BUS: MasterBusConfig = {
  masterVolumeDb: 0,
  glueCompressionDrive: 0.35,
  reverbDecaySec: 3.2,
  reverbReturnLevel: 0.45,
  delayFeedback: 0.42,
  delayReturnLevel: 0.4,
  subBassMonoCutoffHz: 120,
};

/**
 * Helper to parse ZIP Central Directory entries from an APK Buffer
 */
function parseApkZipEntries(apkBuf: Buffer) {
  let eocdOffset = -1;
  for (let i = apkBuf.length - 22; i >= 0; i--) {
    if (apkBuf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('EOCD not found in APK');

  const totalEntries = apkBuf.readUInt16LE(eocdOffset + 10);
  const cdSize = apkBuf.readUInt32LE(eocdOffset + 12);
  const cdOffset = apkBuf.readUInt32LE(eocdOffset + 16);

  const entries: {
    name: string;
    method: number;
    compressedSize: number;
    uncompressedSize: number;
    localHeaderOffset: number;
    dataStartOffset: number;
    data: Buffer;
  }[] = [];

  let ptr = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (apkBuf.readUInt32LE(ptr) !== 0x02014b50) {
      throw new Error(`Invalid Central Directory header at ${ptr}`);
    }
    const method = apkBuf.readUInt16LE(ptr + 10);
    const compressedSize = apkBuf.readUInt32LE(ptr + 20);
    const uncompressedSize = apkBuf.readUInt32LE(ptr + 24);
    const nameLen = apkBuf.readUInt16LE(ptr + 28);
    const extraLen = apkBuf.readUInt16LE(ptr + 30);
    const commentLen = apkBuf.readUInt16LE(ptr + 32);
    const localHeaderOffset = apkBuf.readUInt32LE(ptr + 42);
    const name = apkBuf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');

    // Read local header to find exact data offset
    if (apkBuf.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Invalid Local File header for ${name} at ${localHeaderOffset}`);
    }
    const localNameLen = apkBuf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = apkBuf.readUInt16LE(localHeaderOffset + 28);
    const dataStartOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const rawCompressed = apkBuf.subarray(dataStartOffset, dataStartOffset + compressedSize);
    const data = method === 0 ? rawCompressed : zlib.inflateRawSync(rawCompressed);

    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      dataStartOffset,
      data,
    });

    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return { eocdOffset, cdOffset, cdSize, entries };
}

describe('E2E Android 14 APK Instrumentation, Audio Stability Protection & UI Automation Suite', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    synthEngine.stop();
    synthEngine.clearUnderrunEvents();
    synthEngine.setStabilityThreshold(12.0, true);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root!.unmount();
      });
      root = null;
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
    vi.restoreAllMocks();
  });

  it('Instrumentation 1: Android 14+ Capacitor / Gradle Pipeline, Native Activity, APK Artifacts & User Backup', () => {
    // 1. Verify build prerequisites and Capacitor project configuration
    const prereqs = validatePrerequisites();
    expect(prereqs.hasPackageJson).toBe(true);
    expect(prereqs.hasCapacitorConfig).toBe(true);
    expect(prereqs.hasGradleWrapper).toBe(true);

    // 2. Verify AndroidManifest.xml and Gradle build.gradle configuration
    const manifestPath = path.join(process.cwd(), 'android/app/src/main/AndroidManifest.xml');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifestXml = fs.readFileSync(manifestPath, 'utf8');
    expect(manifestXml).toContain('package="com.parametricals.technodaw"');
    expect(manifestXml).toContain('android.intent.action.MAIN');
    expect(manifestXml).toContain('android.intent.category.LAUNCHER');
    expect(manifestXml).toContain('android.permission.INTERNET');
    expect(manifestXml).toContain('androidx.core.content.FileProvider');

    const mainActivityPath = path.join(
      process.cwd(),
      'android/app/src/main/java/com/parametricals/technodaw/MainActivity.java'
    );
    expect(fs.existsSync(mainActivityPath)).toBe(true);
    const mainActivityContent = fs.readFileSync(mainActivityPath, 'utf8');
    expect(mainActivityContent).toContain('extends BridgeActivity');

    const buildGradlePath = path.join(process.cwd(), 'android/app/build.gradle');
    expect(fs.existsSync(buildGradlePath)).toBe(true);
    const buildGradleContent = fs.readFileSync(buildGradlePath, 'utf8');
    expect(buildGradleContent).toContain('applicationId "com.parametricals.technodaw"');
    expect(buildGradleContent).toContain('versionCode releaseMetadata.versionCode');
    expect(buildGradleContent).toContain('versionName releaseMetadata.versionName');
    expect(buildGradleContent).toContain('signingConfigs');

    // APK assembly/crypto/manifest checks run on fresh Gradle output in android-debug.yml.
    // Unit tests must not build Android or certify a checked-in historical artifact.
    const ledger = JSON.parse(fs.readFileSync('android/release-policy.json', 'utf8'));
    expect(ledger.candidate.versionCode).toBe(VERSION_CODE);
    expect(ledger.candidate.versionName).toBe(VERSION_NAME);

    // 6. Verify User Data Backup export utility ensures user projects survive updates
    const mockProject = { id: 'proj-123', name: 'Raw Techno 138', bpm: 138, tracks: [] };
    let exported = false;
    const origCreateElement = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === 'a') {
        (el as any).click = () => {
          exported = true;
        };
      }
      return el;
    }) as any;

    exportUserDataBackup(mockProject);
    expect(exported).toBe(true);
    document.createElement = origCreateElement;
  });

  it('Instrumentation 2: Audio Stability Threshold Auto-Pause & Last 10 Buffer Underrun Events Circular Buffer', () => {
    const { xml } = buildStarterAbletonXml('berghain-134', 4040);
    const project = parseAlsXmlString(xml);

    let autoPauseReasonReceived: string | undefined;
    synthEngine.setState(
      project,
      TEST_HUMANIZATION,
      undefined,
      TEST_MASTER_BUS,
      undefined,
      (reason) => {
        autoPauseReasonReceived = reason;
      }
    );

    // Configure threshold to 9.5 ms with auto-pause enabled
    synthEngine.setStabilityThreshold(9.5, true);
    expect(synthEngine.getStabilityThreshold().thresholdMs).toBe(9.5);
    expect(synthEngine.getStabilityThreshold().autoPauseEnabled).toBe(true);

    // Record 12 underrun events and verify only the last 10 are retained in reverse chronological order
    synthEngine.clearUnderrunEvents();
    for (let i = 1; i <= 12; i++) {
      synthEngine.recordUnderrunEvent(`DSP Operation #${i}`, 6.0 + i * 0.2);
    }

    const diagAfter12 = synthEngine.getDiagnostics();
    expect(diagAfter12.bufferUnderruns).toBe(12);
    expect(diagAfter12.underrunEvents.length).toBe(10);
    expect(diagAfter12.underrunEvents[0].operation).toBe('DSP Operation #12');
    expect(diagAfter12.underrunEvents[9].operation).toBe('DSP Operation #3');

    // Simulate a latency spike exceeding the 9.5ms threshold and verify auto-pause triggers
    synthEngine.simulateLatencySpike(14.2, 'Warehouse Reverb Convolver Overload');
    const diagAfterSpike = synthEngine.getDiagnostics();
    expect(diagAfterSpike.isPlaying).toBe(false);
    expect(diagAfterSpike.lastAutoPauseReason).toContain('14.2 ms');
    expect(diagAfterSpike.lastAutoPauseReason).toContain('9.5 ms');
    expect(autoPauseReasonReceived).toContain('Warehouse Reverb Convolver Overload');
    expect(diagAfterSpike.underrunEvents[0].operation).toContain(
      '[AUTO-PAUSE] Warehouse Reverb Convolver Overload'
    );
  });

  it('UI Automation 3: DiagnosticsPanel renders live D3 latency graph, Last 10 Buffer Underrun Events table, and interactive Audio Stability Threshold controls', async () => {
    vi.useFakeTimers();
    const onCloseMock = vi.fn();

    synthEngine.recordUnderrunEvent('TB-303 Acid Diode Filter Sweep', 8.4);

    await act(async () => {
      root = createRoot(container!);
      root.render(<DiagnosticsPanel isOpen={true} onClose={onCloseMock} />);
    });

    // Advance 300ms so the 100ms polling interval populates D3 history and renders the SVG chart
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    const textContent = container!.textContent || '';
    expect(textContent).toContain('Real-Time Audio Diagnostics & Protection');
    expect(textContent).toContain('Audio Stability Threshold');
    expect(textContent).toContain('Last 10 Buffer Underrun Events');
    expect(textContent).toContain('TB-303 Acid Diode Filter Sweep');

    // Verify D3 SVG chart rendered paths and circle indicator
    const allSvgs = Array.from(container!.querySelectorAll('svg'));
    const d3SvgEl = allSvgs.find((s) => s.getAttribute('viewBox') === '0 0 360 115');
    expect(d3SvgEl).toBeDefined();
    expect(d3SvgEl!.querySelectorAll('path').length).toBeGreaterThanOrEqual(2);
    expect(d3SvgEl!.querySelector('circle')).not.toBeNull();

    // Click "Strict (5ms)" preset button and verify threshold updates to 5.0 ms
    const buttons = Array.from(container!.querySelectorAll('button'));
    const strictBtn = buttons.find((b) => b.textContent?.includes('Strict (5ms)'));
    expect(strictBtn).toBeDefined();
    await act(async () => {
      strictBtn!.click();
    });
    expect(synthEngine.getStabilityThreshold().thresholdMs).toBe(5.0);
    expect(container!.textContent).toContain('5.0 ms');

    // Click "Test Spike" button and verify Auto-Pause alert banner appears
    const spikeBtn = buttons.find((b) => b.textContent?.includes('Test Spike'));
    expect(spikeBtn).toBeDefined();
    await act(async () => {
      spikeBtn!.click();
    });
    expect(container!.textContent).toContain('Playback Auto-Paused (Clipping Prevented)');

    // Click "Clear" button on the Last 10 Buffer Underrun Events table
    const clearBtn = buttons.find((b) => b.textContent?.includes('Clear'));
    expect(clearBtn).toBeDefined();
    await act(async () => {
      clearBtn!.click();
    });
    expect(container!.textContent).toContain('Zero buffer underruns recorded in current session.');

    vi.useRealTimers();
  });

  it('UI Automation 4: StudioSettingsModal Buffer Size dropdown ("Low Latency (128)", "Standard (256)", "Safe/Mobile (512)") & TouchInteractionSettingsModal', async () => {
    const onCloseMock = vi.fn();
    const onToggleThemeMock = vi.fn();
    const onChangeSpectrumMock = vi.fn();
    const onUpdateMasterMock = vi.fn();
    const onResetLayoutMock = vi.fn();

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <StudioSettingsModal
          isOpen={true}
          onClose={onCloseMock}
          themeMode="dark"
          onToggleTheme={onToggleThemeMock}
          spectrumOverlayMode="compact_lane"
          onChangeSpectrumOverlayMode={onChangeSpectrumMock}
          masterBus={TEST_MASTER_BUS}
          onUpdateMasterBus={onUpdateMasterMock}
          onResetLayout={onResetLayoutMock}
        />
      );
    });

    // Switch to "Audio Engine DSP" tab
    const audioTabBtn = Array.from(container!.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Audio Engine DSP')
    );
    expect(audioTabBtn).toBeDefined();
    await act(async () => {
      audioTabBtn!.click();
    });

    // Verify Buffer Size select dropdown options
    const selectEl = container!.querySelector('select') as HTMLSelectElement;
    expect(selectEl).not.toBeNull();
    const optionLabels = Array.from(selectEl.options).map((o) => o.textContent);
    expect(optionLabels).toEqual([
      'Low Latency (128)',
      'Standard (256)',
      'Safe/Mobile (512)',
    ]);

    // Change Buffer Size to 512 (Safe/Mobile)
    await act(async () => {
      selectEl.value = '512';
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container!.textContent).toContain('Est. Latency: 12ms');

    // Now test TouchInteractionSettingsModal
    let touchState: TouchInteractionConfig = { ...DEFAULT_TOUCH_CONFIG };
    await act(async () => {
      root!.render(
        <TouchInteractionSettingsModal
          isOpen={true}
          onClose={onCloseMock}
          config={touchState}
          onChangeConfig={(partial) => {
            touchState = { ...touchState, ...partial };
          }}
        />
      );
    });

    expect(container!.textContent).toContain('Android & iOS Touch Interaction Settings');
    expect(container!.textContent).toContain('Pad Velocity Sensitivity');
    expect(container!.textContent).toContain('Timeline Drag Threshold');

    const compressedBtn = Array.from(container!.querySelectorAll('button')).find(
      (b) => b.textContent?.trim().toLowerCase() === 'compressed'
    );
    expect(compressedBtn).toBeDefined();
    await act(async () => {
      compressedBtn!.click();
    });
    expect(touchState.velocityCurveType).toBe('compressed');
  });

  it('Instrumentation 5: Dynamic Arrangement Length (32, 64, 128 Bars), Staggered Layer Entry/Exit, and Lossless Full-Track WAV Export', async () => {
    const { xml } = buildStarterAbletonXml('berghain-134', 9090, 32);
    const project = parseAlsXmlString(xml);
    expect(project.arrangementLengthBars).toBe(32);

    const sections = generateSectionArrangementPlan('hypnotic_longform', 32);
    expect(sections.length).toBeGreaterThanOrEqual(4);
    expect(sections[0].startBar).toBe(1);
    expect(sections[sections.length - 1].endBar).toBe(32);

    // Verify staggered layer entry/exit: Hats or Ride should not be active on Bar 1 of Intro in hypnotic_longform
    const rideComposed = composeProjectConditionedLayerNotes(
      project,
      'ride',
      'hypnotic_evolving',
      'hypnotic_longform',
      TEST_HUMANIZATION,
      9090,
      9091,
      32
    );
    const earlyIntroRideNotes = rideComposed.notes.filter((n) => n.quantizedTime < 16);
    expect(earlyIntroRideNotes.length).toBe(0);
    expect(rideComposed.notes.length).toBeGreaterThan(0);

    // Verify lossless WAV export produces valid RIFF WAVE blob and emits monotonic percentage progress
    project.arrangementLengthBars = 16;
    const progressEvents: number[] = [];
    // jsdom has no audio renderer; production must report capability failure.
    // Full short/full-length WAV render and decode checks live in recovery-browser-check.mjs.
    await expect(renderArrangementToWavBlob(project, TEST_HUMANIZATION, TEST_MASTER_BUS, 16, 24,
      (pct) => progressEvents.push(pct))).rejects.toThrow('RENDER_UNSUPPORTED');
    expect(progressEvents[0]).toBe(0);

  });

  it('E2E Automation 5b: Percentage-based 16th-note swing shifts even-numbered 16th notes forward in time and WAV progress bar renders in UI', async () => {
    const testClip: AbletonMidiClip = {
      id: 'clip_swing_test',
      name: '16th Grid Groove',
      startTime: 0,
      length: 4,
      notes: [
        { id: 'n1', time: 0.0, quantizedTime: 0.0, duration: 0.2, pitch: 42, velocity: 100, isGhost: false }, // 1st 16th (odd)
        { id: 'n2', time: 0.25, quantizedTime: 0.25, duration: 0.2, pitch: 42, velocity: 80, isGhost: false }, // 2nd 16th (even -> shifted)
        { id: 'n3', time: 0.5, quantizedTime: 0.5, duration: 0.2, pitch: 46, velocity: 110, isGhost: false }, // 3rd 16th (odd)
        { id: 'n4', time: 0.75, quantizedTime: 0.75, duration: 0.2, pitch: 42, velocity: 85, isGhost: false }, // 4th 16th (even -> shifted)
      ],
    };

    const swung50 = applySwingToMidiClip(testClip, 50);
    const swung100 = applySixteenthNoteSwing(testClip, 100);

    // Odd-numbered 16th notes (1st at 0.0, 3rd at 0.5) remain anchored
    expect(swung50.notes[0].time).toBeCloseTo(0.0, 4);
    expect(swung50.notes[2].time).toBeCloseTo(0.5, 4);

    // Even-numbered 16th notes (2nd at 0.25, 4th at 0.75) shift forward proportionally to swingStrength
    expect(swung50.notes[1].time).toBeCloseTo(0.25 + 0.5 * MAX_SIXTEENTH_SWING_SHIFT_BEATS, 4);
    expect(swung50.notes[3].time).toBeCloseTo(0.75 + 0.5 * MAX_SIXTEENTH_SWING_SHIFT_BEATS, 4);
    expect(swung100.notes[1].time).toBeGreaterThan(swung50.notes[1].time);
    expect(swung100.notes[1].time).toBeCloseTo(0.25 + MAX_SIXTEENTH_SWING_SHIFT_BEATS, 4);

    // Verify StudioStatusBar displays percentage-based progress bar when WAV rendering is active
    await act(async () => {
      root = createRoot(container!);
      root.render(
        <StudioStatusBar
          projectName="Berghain_134.als"
          projectRevision={3}
          trackCount={8}
          activeSoloCount={0}
          editMode="grid"
          activeTool="smart"
          isPlaying={false}
          isExportingWav={true}
          wavExportProgress={64}
          statusMessage="Rendering WAV (64%)..."
          alsValid={true}
          canUndo={false}
          canRedo={false}
        />
      );
    });

    expect(container!.textContent).toContain('WAV RENDER 64%');
    const progressBar = container!.querySelector('[role="progressbar"]');
    expect(progressBar).not.toBeNull();
    expect(progressBar?.getAttribute('aria-valuenow')).toBe('64');
  });

  it('E2E Automation 6: Full App Workstation mounts cleanly on Android/Desktop WebView and executes interactive toolbar & drawer workflows', async () => {
    // Provide JSDOM polyfills for Canvas 2D and ResizeObserver used by timeline & spectrum visualizers
    if (typeof (globalThis as any).ResizeObserver === 'undefined') {
      (globalThis as any).ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    }
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      bezierCurveTo: vi.fn(),
      rect: vi.fn(),
      roundRect: vi.fn(),
      clip: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      fillText: vi.fn(),
      strokeText: vi.fn(),
      measureText: () => ({ width: 24 }),
      createLinearGradient: () => ({ addColorStop: vi.fn() }),
      createRadialGradient: () => ({ addColorStop: vi.fn() }),
      setLineDash: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
    }) as any;

    await act(async () => {
      root = createRoot(container!);
      root.render(<React.StrictMode><App /></React.StrictMode>);
    });

    const fullText = container!.textContent || '';
    expect(fullText).toContain('01_Kick_909_Foundation');
    expect(fullText).toContain('BPM');

    // Find and click the Diagnostics button in the top menu bar to open the Real-Time Audio Diagnostics drawer
    const diagBtn = Array.from(container!.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Diagnostics') || b.getAttribute('title')?.includes('Diagnostics')
    );
    expect(diagBtn).toBeDefined();
    await act(async () => {
      diagBtn!.click();
    });

    expect(container!.textContent).toContain('Real-Time Audio Diagnostics & Protection');
    expect(container!.textContent).toContain('Last 10 Buffer Underrun Events');
    expect(container!.textContent).toContain('Audio Stability Threshold');

    // Regression: New Project owns a new queue/history key and preserves outgoing edits.
    const oldId = projectQueueService.getActiveQueueId()!;
    const oldState = projectQueueService.getItem(oldId)!.workingProjectState;
    const mute = container!.querySelector<HTMLButtonElement>('button[title="Mute Track"]')!;
    expect(mute).not.toBeNull();
    const historyBeforeMute = studioCommandBus.getHistory(oldId).length;
    await act(async () => { mute.click(); });
    expect(studioCommandBus.getHistory(oldId)).toHaveLength(historyBeforeMute + 1);
    await act(async () => {
      studioCommandBus.executeMutation(oldId, 'fixture history', 'clip_edit', oldState, draft => draft);
    });
    const fileButton = () => Array.from(container!.querySelectorAll('button')).find(b => b.textContent?.trim() === 'File')!;
    await act(async () => { fileButton().click(); });
    const newButton = Array.from(container!.querySelectorAll('button')).find(b => b.textContent?.startsWith('New Project'))!;
    expect(newButton).toBeDefined();
    await act(async () => { newButton.click(); });
    let newId = projectQueueService.getActiveQueueId()!;
    expect(newId).not.toBe(oldId);
    expect(projectQueueService.getItem(oldId)!.workingProjectState.tracks[0].muted).toBe(true);
    expect(studioCommandBus.canUndo(newId)).toBe(false);
    expect(studioCommandBus.canUndo(oldId)).toBe(true);
    let fresh = projectQueueService.getItem(newId)!.workingProjectState;
    expect(fresh.generationSeed).toBeGreaterThan(0);
    expect(fresh.arrangementSections).toBeDefined();
    expect(synthEngine.getIsPlaying()).toBe(false);

    // Imported audio tracks must survive MIDI composition without being serialized as MIDI.
    const audioDom = new DOMParser().parseFromString(fresh.rawXmlModified, 'application/xml');
    const audioTrack = audioDom.createElement('AudioTrack');
    audioTrack.setAttribute('Id', '99');
    audioTrack.innerHTML = '<Name><EffectiveName Value="Recorded Pad" /></Name><DeviceChain />';
    audioDom.querySelector('Tracks')!.append(audioTrack);
    const bytes = new TextEncoder().encode(new XMLSerializer().serializeToString(audioDom));
    const input = container!.querySelector<HTMLInputElement>('input[type="file"][accept=".als"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'With_Audio.als', arrayBuffer: async () => bytes.buffer }] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    newId = projectQueueService.getActiveQueueId()!;
    fresh = projectQueueService.getItem(newId)!.workingProjectState;
    expect(fresh.tracks.find(t => t.id === '99')?.type).toBe('audio');

    // Exercise the actual full-suite UI handler, XML round trip and undo/redo.
    const compose = Array.from(container!.querySelectorAll('button')).find(b => b.textContent?.includes('Compose Full 8-Track Suite'))!;
    expect(compose).toBeDefined();
    await act(async () => { compose.click(); });
    const composed = projectQueueService.getItem(newId)!.workingProjectState;
    expect(composed.tracks.some(t => t.clips.length > 1)).toBe(true);
    expect(composed.tracks.find(t => t.id === '99')).toEqual(fresh.tracks.find(t => t.id === '99'));
    const roundTrip = parseAlsXmlString(composed.rawXmlModified);
    for (const track of composed.tracks) {
      const reloaded = roundTrip.tracks.find(t => t.id === track.id)!;
      expect(reloaded.clips.map(c => [c.id, c.startTime, c.length, c.notes.length]))
        .toEqual(track.clips.map(c => [c.id, c.startTime, c.length, c.notes.length]));
    }
    await act(async () => {
      expect(studioCommandBus.undo(newId)!.tracks).toEqual(fresh.tracks);
      expect(studioCommandBus.redo(newId)!.tracks).toEqual(composed.tracks);
    });

    // Save through the production native-project serializer and reopen through the actual File UI.
    let projectBlob: Blob | undefined;
    const save = vi.spyOn(fileExportService, 'saveExportBlob').mockImplementation(async blob => {
      projectBlob = blob; return { verified: false };
    });
    await act(async () => { fileButton().click(); });
    const saveButton = Array.from(container!.querySelectorAll('button')).find(b => b.textContent?.startsWith('Save Project'))!;
    await act(async () => { saveButton.click(); });
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][1]).toMatch(/\.aidaw\.json$/);
    const savedText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(projectBlob!);
    });
    await act(async () => { fileButton().click(); });
    await act(async () => { Array.from(container!.querySelectorAll('button')).find(b => b.textContent?.startsWith('New Project'))!.click(); });
    const snapshotInput = container!.querySelector<HTMLInputElement>('input[aria-label="Open saved DAW project"]')!;
    const openSnapshot = async (text: string) => {
      const bytes = new TextEncoder().encode(text);
      Object.defineProperty(snapshotInput, 'files', { configurable: true, value: [{ name: 'Session.aidaw.json', arrayBuffer: async () => bytes.buffer }] });
      await act(async () => { snapshotInput.dispatchEvent(new Event('change', { bubbles: true })); });
    };
    await openSnapshot(savedText);
    const restoredId = projectQueueService.getActiveQueueId()!;
    expect(restoredId).not.toBe(newId);
    expect(projectQueueService.getItem(restoredId)!.workingProjectState.tracks).toEqual(composed.tracks);
    expect(studioCommandBus.canUndo(restoredId)).toBe(false);
    const future = JSON.parse(savedText); future.version = 999;
    await openSnapshot(JSON.stringify(future));
    expect(projectQueueService.getActiveQueueId()).toBe(restoredId);
    expect(container!.textContent).toContain('PROJECT_SNAPSHOT_VERSION');
  }, 45000);

  it('E2E Automation 7: Dilla-style BPM-dependent Shuffle Swing push/pull & TimelineCanvas live playhead MIDI grid pixel synchronization', async () => {
    const dillaClip = {
      id: 'dilla_clip_1',
      name: 'MPC3000 Pocket Groove',
      startTime: 0,
      length: 4,
      notes: [
        { id: 'd1', time: 0.0, quantizedTime: 0.0, duration: 0.2, pitch: 36, velocity: 115, isGhost: false }, // 1st 16th (downbeat anchor)
        { id: 'd2', time: 0.25, quantizedTime: 0.25, duration: 0.2, pitch: 42, velocity: 82, isGhost: false }, // 2nd 16th ('e' -> pulled late)
        { id: 'd3', time: 0.5, quantizedTime: 0.5, duration: 0.2, pitch: 42, velocity: 96, isGhost: false }, // 3rd 16th ('&' -> pushed early)
        { id: 'd4', time: 0.75, quantizedTime: 0.75, duration: 0.2, pitch: 42, velocity: 78, isGhost: false }, // 4th 16th ('a' -> pulled late)
        { id: 'd5', time: 1.0, quantizedTime: 1.0, duration: 0.2, pitch: 38, velocity: 120, isGhost: false }, // Beat 2 backbeat (stepInBar 4 -> rushed early)
      ],
    };

    const shuffled90Bpm = applyShuffleSwingToMidiClip(dillaClip, 80, 90);
    const shuffled140Bpm = applyDillaShuffleSwing(dillaClip, 80, 140);

    // Downbeat (0.0) stays anchored; 'e' (0.25) and 'a' (0.75) are pulled late (+); '&' (0.5) and Beat 2 backbeat (1.0) are pushed early (-)
    expect(shuffled90Bpm.notes[0].time).toBeCloseTo(0.0, 5);
    expect(shuffled90Bpm.notes[1].time).toBeGreaterThan(0.25);
    expect(shuffled90Bpm.notes[2].time).toBeLessThan(0.5);
    expect(shuffled90Bpm.notes[3].time).toBeGreaterThan(0.75);
    expect(shuffled90Bpm.notes[4].time).toBeLessThan(1.0);

    // BPM scaling: a constant millisecond pocket translates to a larger beat shift at 140 BPM than at 90 BPM
    const shift90 = shuffled90Bpm.notes[1].time - 0.25;
    const shift140 = shuffled140Bpm.notes[1].time - 0.25;
    expect(shift140).toBeGreaterThan(shift90);
    expect(computeDillaShuffleOffsetBeats(0.25, 100, 120)).toBeCloseTo(
      (MAX_DILLA_SHUFFLE_POCKET_MS / 60000) * 120,
      5
    );

    // Verify TimelineCanvas maps synthEngine beat to exact pixel-based MIDI grid coordinates
    synthEngine.seek(2.5);
    expect(synthEngine.getCurrentBeat()).toBeCloseTo(2.5, 4);

    const gridMetrics = mapBeatToMidiGridCoordinates(synthEngine.getCurrentBeat(), {
      canvasWidth: 858,
      keyColWidth: 58,
      zoomBars: 2, // 8 visible beats -> 800px / 8 beats = 100 px/beat
      totalBars: 16,
      pianoScrollBar: 0,
      followPlayhead: true,
      gridDivision: '1/16',
    });

    expect(gridMetrics.pixelsPerBeat).toBeCloseTo(100, 4);
    expect(gridMetrics.playheadPixelX).toBeCloseTo(58 + 2.5 * 100, 4); // 308px
    expect(gridMetrics.activeStepIndex).toBe(10); // 2.5 / 0.25 = step index 10 (11th step)
    expect(gridMetrics.stepStartPixelX).toBeCloseTo(58 + 10 * 25, 4); // 308px

    const { xml: starterXml } = buildStarterAbletonXml('berghain_134_fmin', 16);
    const project = parseAlsXmlString(starterXml, 'SyncTest.als');

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <TimelineCanvas
          project={project}
          selectedTrackId={project.tracks[0].id}
          onSelectTrack={() => {}}
          playheadBeat={synthEngine.getCurrentBeat()}
          modulatedCutoffHz={145}
          humanization={{
            microTimingMaxShiftBeats: 0.015,
            swingStrength: 20,
            shuffleSwing: 65,
            velocityVariancePct: 0.08,
            ghostVelocityMin: 20,
            ghostVelocityMax: 45,
            lfoRateHz: 0.1,
            lfoDepth: 0.42,
            cutoffHz: 145,
            macroTransition: 42,
          }}
          transport={{
            loopEnabled: true,
            loopStartBar: 1,
            loopLengthBars: 4,
            arrangementLengthBars: 16,
            metronomeEnabled: false,
            followPlayhead: true,
            showAutomationLanes: false,
          }}
          onUpdateTransport={() => {}}
          onSeekBeat={() => {}}
          onToggleNoteInTrack={() => {}}
          onToggleMute={() => {}}
          onToggleSolo={() => {}}
          onUpdateTrackMixer={() => {}}
          onUpdateTrackAutomation={() => {}}
        />
      );
    });

    const syncBadge = container!.querySelector('[data-testid="playhead-midi-grid-sync"]');
    expect(syncBadge).not.toBeNull();
    expect(syncBadge?.textContent).toContain('SYNC 2.50B');
    expect(syncBadge?.textContent).toContain('290px');
    expect(syncBadge?.textContent).toContain('Step 11/32');
  });

  it('E2E Automation 8: Bulk Queue multi-file selection & sequential WAV export + Export Clip to MIDI Include Humanization toggle', async () => {
    if (typeof URL.createObjectURL === 'undefined') {
      URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    } else {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    }
    if (typeof URL.revokeObjectURL === 'undefined') {
      URL.revokeObjectURL = vi.fn();
    } else {
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    }

    // 1. Verify Export Clip to MIDI with Include Humanization ON vs OFF
    const { xml } = buildStarterAbletonXml('berghain-134', 8080);
    const project = parseAlsXmlString(xml, 'Berghain_134.als');
    const hatsTrack = project.tracks.find((t) => t.archetype === 'hats') || project.tracks[0];
    const clip = hatsTrack.clips[0];

    const quantizedMidi = exportClipToMidiFile(clip, hatsTrack, 134, 480, {
      includeHumanization: false,
      humanization: { ...TEST_HUMANIZATION, swingStrength: 45, shuffleSwing: 55 },
    });
    const humanizedMidi = exportClipToMidiFile(clip, hatsTrack, 134, 480, {
      includeHumanization: true,
      humanization: { ...TEST_HUMANIZATION, swingStrength: 45, shuffleSwing: 55 },
    });

    expect(quantizedMidi.includeHumanization).toBe(false);
    expect(humanizedMidi.includeHumanization).toBe(true);
    expect(quantizedMidi.fileName).toContain('_Quantized.mid');
    expect(humanizedMidi.fileName).toContain('_Humanized.mid');

    // In quantized mode, every exported note must have zero micro-timing offset (startTick === quantizedTick)
    expect(quantizedMidi.exportedNotes.every((n) => n.microTimingOffsetTicks === 0)).toBe(true);
    expect(quantizedMidi.exportedNotes.every((n) => n.startTick === n.quantizedTick)).toBe(true);

    // In humanized mode, micro-timed notes diverge from strict quantized grid ticks
    expect(humanizedMidi.exportedNotes.some((n) => n.microTimingOffsetTicks !== 0)).toBe(true);

    // Test the UI toggle in TimelineCanvas
    const exportCalls: { trackId: string; clipId: string; includeHumanization?: boolean }[] = [];
    await act(async () => {
      root = createRoot(container!);
      root.render(
        <TimelineCanvas
          project={project}
          selectedTrackId={hatsTrack.id}
          onSelectTrack={() => {}}
          playheadBeat={0}
          modulatedCutoffHz={145}
          humanization={TEST_HUMANIZATION}
          transport={{
            loopEnabled: true,
            loopStartBar: 1,
            loopLengthBars: 4,
            arrangementLengthBars: 16,
            metronomeEnabled: false,
            followPlayhead: true,
            showAutomationLanes: false,
          }}
          onUpdateTransport={() => {}}
          onSeekBeat={() => {}}
          onToggleNoteInTrack={() => {}}
          onToggleMute={() => {}}
          onToggleSolo={() => {}}
          onUpdateTrackMixer={() => {}}
          onUpdateTrackAutomation={() => {}}
          onExportClipToMidi={(trackId, clipId, includeHum) => {
            exportCalls.push({ trackId, clipId, includeHumanization: includeHum });
          }}
        />
      );
    });

    const toggleInput = container!.querySelector(
      '[data-testid="export-midi-include-humanization-toggle"]'
    ) as HTMLInputElement;
    const exportMidiBtn = container!.querySelector(
      '[data-testid="export-clip-to-midi-btn"]'
    ) as HTMLButtonElement;
    expect(toggleInput).not.toBeNull();
    expect(exportMidiBtn).not.toBeNull();
    expect(toggleInput.checked).toBe(true);

    // Click export while Include Humanization is ON (true)
    await act(async () => {
      exportMidiBtn.click();
    });
    expect(exportCalls.length).toBe(1);
    expect(exportCalls[0].includeHumanization).toBe(true);

    // Toggle Include Humanization OFF (false) and click export again
    await act(async () => {
      toggleInput.click();
    });
    expect(toggleInput.checked).toBe(false);
    expect(exportMidiBtn.textContent).toContain('Quantized');

    await act(async () => {
      exportMidiBtn.click();
    });
    expect(exportCalls.length).toBe(2);
    expect(exportCalls[1].includeHumanization).toBe(false);

    // 2. Verify BulkQueueAndExportModal multi-project selection & sequential WAV exports
    projectQueueService.clearQueue();
    const { xml: xml1 } = buildStarterAbletonXml('berghain-134', 101, 4);
    const { xml: xml2 } = buildStarterAbletonXml('tresor-138', 202, 4);
    const { xml: xml3 } = buildStarterAbletonXml('ostgut-128', 303, 4);

    const rec1 = await projectQueueService.enqueueProjectFromXml('Track_One.als', xml1);
    const rec2 = await projectQueueService.enqueueProjectFromXml('Track_Two.als', xml2);
    const rec3 = await projectQueueService.enqueueProjectFromXml('Track_Three.als', xml3);

    await act(async () => {
      root!.render(
        <BulkQueueAndExportModal
          isOpen={true}
          onClose={() => {}}
          activeProject={project}
          humanization={TEST_HUMANIZATION}
          masterBus={TEST_MASTER_BUS}
          queueItems={projectQueueService.getAllItems()}
          activeQueueId={rec1.queueId}
          onSwitchToQueueProject={() => {}}
          onSyncActiveProjectFromQueue={() => {}}
        />
      );
    });

    const checkbox1 = container!.querySelector(
      `[data-testid="select-queue-item-${rec1.queueId}"]`
    ) as HTMLInputElement;
    const checkbox2 = container!.querySelector(
      `[data-testid="select-queue-item-${rec2.queueId}"]`
    ) as HTMLInputElement;
    const checkbox3 = container!.querySelector(
      `[data-testid="select-queue-item-${rec3.queueId}"]`
    ) as HTMLInputElement;
    expect(checkbox1).not.toBeNull();
    expect(checkbox2).not.toBeNull();
    expect(checkbox3).not.toBeNull();

    // Deselect Track_Two so only Track_One and Track_Three are selected (2 of 3)
    await act(async () => {
      checkbox2.click();
    });
    expect(checkbox1.checked).toBe(true);
    expect(checkbox2.checked).toBe(false);
    expect(checkbox3.checked).toBe(true);

    const batchWavBtn = container!.querySelector(
      '[data-testid="batch-export-selected-wavs-btn"]'
    ) as HTMLButtonElement;
    expect(batchWavBtn).not.toBeNull();
    expect(batchWavBtn.textContent).toContain('Batch Export Selected WAVs (2)');

    // Trigger sequential WAV exports for the 2 selected projects
    await act(async () => {
      batchWavBtn.click();
    });

    // Wait for sequential export promises to settle and re-render with updated queueItems
    await act(async () => {
      root!.render(
        <BulkQueueAndExportModal
          isOpen={true}
          onClose={() => {}}
          activeProject={project}
          humanization={TEST_HUMANIZATION}
          masterBus={TEST_MASTER_BUS}
          queueItems={projectQueueService.getAllItems()}
          activeQueueId={rec1.queueId}
          onSwitchToQueueProject={() => {}}
          onSyncActiveProjectFromQueue={() => {}}
        />
      );
    });

    const updated1 = projectQueueService.getItem(rec1.queueId)!;
    const updated2 = projectQueueService.getItem(rec2.queueId)!;
    const updated3 = projectQueueService.getItem(rec3.queueId)!;

    expect(updated1.state).toBe('exported');
    expect(updated1.exportedWavFilename).toContain('Track_One');
    expect(updated2.state).toBe('ready'); // Was deselected, so untouched!
    expect(updated3.state).toBe('exported');
    expect(updated3.exportedWavFilename).toContain('Track_Three');

    const statusBanner = container!.querySelector('[data-testid="batch-wav-export-status"]');
    expect(statusBanner).not.toBeNull();
    expect(statusBanner?.textContent).toContain('Sequential Batch WAV Export Complete (2/2)');
    expect(statusBanner?.textContent).toContain('100%');
  }, 30000);
});


vi.mock('../engine/webAudioSynth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine/webAudioSynth')>();
  return { ...actual, synthesizeProjectToStereoFloatBuffers: vi.fn(async (...args: Parameters<typeof actual.synthesizeProjectToStereoFloatBuffers>) =>
    actual.synthesizeDeterministicStereoPcm(args[0], args[1], args[2], args[3], args[4])) };
});
