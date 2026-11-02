import React, { useState } from 'react';
import {
  AbletonProjectState,
  AbletonTrack,
  CompositionStrategyId,
  MacroArrangementFormId,
  MidiToolTransformationId,
  NoteGridDivision,
  PolyrhythmConfig,
  TechnoArchetype,
  VoicingSpreadStyle,
} from '../types/ableton';
import {
  analyzeProjectMusicalProfile,
  COMPOSITION_STRATEGIES,
  generateEuclideanSteps,
  generateSectionArrangementPlan,
  MACRO_ARRANGEMENT_FORMS,
  validateAlsProjectCadence,
} from '../engine/compositionIntelligenceEngine';
import {
  getDefaultPolyrhythmConfig,
  gridDivisionToStepBeats,
} from '../engine/alsXmlEngine';
import {
  CheckCircle2,
  Cpu,
  Dices,
  GitBranch,
  Layers,
  Lock,
  Music,
  Play,
  Repeat,
  ShieldCheck,
  Sliders,
  Sparkles,
  Unlock,
  Wand2,
} from 'lucide-react';

interface AiComposerIntelligencePanelProps {
  project: AbletonProjectState;
  selectedTrack?: AbletonTrack;
  activeStrategyId: CompositionStrategyId;
  activeFormId: MacroArrangementFormId;
  compositionSeed: number;
  onSelectStrategy: (strategyId: CompositionStrategyId) => void;
  onSelectForm: (formId: MacroArrangementFormId) => void;
  onComposeSingleLayer: (archetype: TechnoArchetype) => void;
  onComposeAllUnlockedLayers: () => void;
  onApplyMidiTool: (trackId: string, toolId: MidiToolTransformationId) => void;
  onInjectPolyrhythmClip?: (trackId: string, config: PolyrhythmConfig) => void;
  onApplyChordGridTransform?: (
    trackId: string,
    gridDivision: NoteGridDivision,
    voicingSpread: VoicingSpreadStyle,
    customRootKey?: string,
    customScale?: string,
    stylePrompt?: string
  ) => void;
  onLaunchSessionScene: (sceneIdx: number, trackId?: string) => void;
  onToggleTrackLock: (trackId: string) => void;
  onSelectTrack: (trackId: string) => void;
  onSeekBeat: (beat: number) => void;
  onRandomizeTrackVelocities?: (
    trackId: string,
    config: {
      minVelocity: number;
      maxVelocity: number;
      blendPct: number;
      accentLock: boolean;
      downbeatLock: boolean;
      seed: number;
    }
  ) => void;
  onApplyMidiQuantizeStrength?: (
    trackId: string,
    gridDivision: NoteGridDivision,
    strengthPct: 50 | 75 | 100
  ) => void;
}

export type { TrackVelocityRandomizerConfig } from '../types/ableton';

const MIDI_TOOLS: { id: MidiToolTransformationId; label: string; desc: string }[] = [
  { id: 'euclidean', label: 'Euclidean E(k,16)', desc: 'Bjorklund polymetric step distribution' },
  { id: 'rotate', label: 'Rotate +3/16', desc: 'Displace phrase onsets while protecting kick' },
  { id: 'invert', label: 'Invert Pitch', desc: 'Mirror melodic contour around pitch axis' },
  { id: 'retrograde', label: 'Retrograde', desc: 'Reverse intra-bar rhythmic & pitch sequence' },
  { id: 'ornament', label: 'Ornament (Ratchet)', desc: 'Inject 32nd-note flam ratchets before accents' },
  { id: 'recombine', label: 'Recombine', desc: 'Permute pitch & velocity across fixed onsets' },
  { id: 'span', label: 'Span Gate', desc: 'Toggle staccato / legato note gate lengths' },
  { id: 'quantize', label: 'Quantize 16th', desc: 'Snap notes to exact 16th-note grid' },
];

const POLYRHYTHM_PRESETS: { label: string; steps: number; pulses: number; rotation: number }[] = [
  { label: '7/16 Polymeter', steps: 7, pulses: 4, rotation: 0 },
  { label: '11/16 Hypnotic', steps: 11, pulses: 5, rotation: 1 },
  { label: '13/16 Warehouse', steps: 13, pulses: 6, rotation: 2 },
  { label: '15/16 Rolling', steps: 15, pulses: 7, rotation: 0 },
  { label: '5/16 Industrial', steps: 5, pulses: 3, rotation: 1 },
  { label: '16/16 Euclidean', steps: 16, pulses: 7, rotation: 2 },
];

export const AiComposerIntelligencePanel: React.FC<AiComposerIntelligencePanelProps> = ({
  project,
  selectedTrack,
  activeStrategyId,
  activeFormId,
  compositionSeed,
  onSelectStrategy,
  onSelectForm,
  onComposeSingleLayer,
  onComposeAllUnlockedLayers,
  onApplyMidiTool,
  onInjectPolyrhythmClip,
  onApplyChordGridTransform,
  onLaunchSessionScene,
  onToggleTrackLock,
  onSelectTrack,
  onSeekBeat,
  onRandomizeTrackVelocities,
  onApplyMidiQuantizeStrength,
}) => {
  const totalBars = project.arrangementLengthBars || 16;
  const profile = project.musicalProfile || analyzeProjectMusicalProfile(project);
  const sections =
    project.arrangementSections || generateSectionArrangementPlan(activeFormId, totalBars);
  const alsReport = project.alsValidation || validateAlsProjectCadence(project.rawXmlModified);
  const genIdentity = project.lastGenerationIdentity;

  const [velMin, setVelMin] = useState<number>(40);
  const [velMax, setVelMax] = useState<number>(115);
  const [velBlendPct, setVelBlendPct] = useState<number>(100);
  const [velAccentLock, setVelAccentLock] = useState<boolean>(true);
  const [velDownbeatLock, setVelDownbeatLock] = useState<boolean>(false);
  const [velSeed, setVelSeed] = useState<number>(42);

  const defaultPoly = getDefaultPolyrhythmConfig(selectedTrack?.archetype || 'percussion');
  const [polySteps, setPolySteps] = useState<number>(
    selectedTrack?.polyrhythm?.steps || defaultPoly.steps
  );
  const [polyPulses, setPolyPulses] = useState<number>(
    selectedTrack?.polyrhythm?.pulses || defaultPoly.pulses
  );
  const [polyRotation, setPolyRotation] = useState<number>(
    selectedTrack?.polyrhythm?.rotation || defaultPoly.rotation
  );
  const [gridDivision, setGridDivision] = useState<NoteGridDivision>(
    selectedTrack?.polyrhythm?.stepDivision || '1/16'
  );
  const [voicingSpread, setVoicingSpread] = useState<VoicingSpreadStyle>(
    selectedTrack?.polyrhythm?.voicingSpread || 'close'
  );
  const [customKey, setCustomKey] = useState<string>(project.rootKey || 'F');
  const [customScale, setCustomScale] = useState<string>(project.scale || 'Phrygian');
  const [quantizeStrengthPct, setQuantizeStrengthPct] = useState<50 | 75 | 100>(75);
  const [quantizeGridDivision, setQuantizeGridDivision] = useState<NoteGridDivision>('1/16');
  const [stylePrompt, setStylePrompt] = useState<string>(
    'Hypnotic Berghain dark chord stabs with 3/16 dub tension'
  );

  const activeEuclideanHits = new Set(
    generateEuclideanSteps(Math.min(polySteps, polyPulses), polySteps, polyRotation)
  );
  const loopEndBeats = Number((polySteps * gridDivisionToStepBeats(gridDivision)).toFixed(3));

  const handleInjectPolyClip = () => {
    if (!selectedTrack || !onInjectPolyrhythmClip) return;
    onInjectPolyrhythmClip(selectedTrack.id, {
      enabled: true,
      steps: polySteps,
      pulses: Math.min(polySteps, polyPulses),
      rotation: polyRotation,
      stepDivision: gridDivision,
      voicingSpread,
      pitchIntervalSemitones: 7,
    });
  };

  return (
    <div className="ai-composer-panel min-w-0 w-full p-3.5 bg-[#0D1017] text-slate-200 space-y-4 font-mono text-xs">
      {/* Row 1: Project Musical Profile & Novelty Telemetry */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* Project Analysis Profile (5 cols) */}
        <div className="lg:col-span-5 p-3 bg-[#121722] border border-[#232C3D] rounded space-y-2">
          <div className="flex items-center justify-between border-b border-[#202838] pb-1.5">
            <div className="flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-semibold text-slate-100">PROJECT MUSICAL PROFILE (MIR)</span>
            </div>
            <span className="text-[10px] text-emerald-400 tabular-nums">
              Confidence: {Math.round(profile.harmonicConfidence * 100)}%
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] tabular-nums">
            <div className="p-1.5 bg-[#0B0E15] border border-[#1D2432] rounded">
              <div className="text-[10px] text-slate-400">TONAL CENTER</div>
              <div className="text-amber-400 font-semibold">
                {profile.detectedRootKey} {profile.detectedScale}
              </div>
            </div>
            <div className="p-1.5 bg-[#0B0E15] border border-[#1D2432] rounded">
              <div className="text-[10px] text-slate-400">LOW-END OCC.</div>
              <div className="text-sky-300 font-semibold">
                {Math.round(profile.lowEndOccupancyRatio * 100)}% (&lt;45Hz)
              </div>
            </div>
            <div className="p-1.5 bg-[#0B0E15] border border-[#1D2432] rounded">
              <div className="text-[10px] text-slate-400">SYNCOPATION</div>
              <div className="text-purple-300 font-semibold">
                {Math.round(profile.syncopationIndex * 100)}% Off-Grid
              </div>
            </div>
            <div className="p-1.5 bg-[#0B0E15] border border-[#1D2432] rounded">
              <div className="text-[10px] text-slate-400">KICK STEPS</div>
              <div className="text-emerald-400 font-semibold truncate">
                [{profile.kickOnsetSteps.join(', ')}]
              </div>
            </div>
          </div>

          <div className="space-y-1 text-[11px]">
            {profile.conflictWarnings.map((warn, i) => (
              <div
                key={i}
                className="text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-1 rounded"
              >
                {warn}
              </div>
            ))}
            {profile.complementRecommendations.map((rec, i) => (
              <div
                key={i}
                className="text-slate-300 bg-[#0B0E15] border border-[#1E2636] px-2 py-1 rounded"
              >
                {rec}
              </div>
            ))}
          </div>
        </div>

        {/* Composition Strategy & Macroform Selector (4 cols) */}
        <div className="lg:col-span-4 p-3 bg-[#121722] border border-[#232C3D] rounded space-y-2.5 flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center justify-between border-b border-[#202838] pb-1.5">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                <span className="font-semibold text-slate-100">HIERARCHICAL STRATEGY 3.0</span>
              </div>
              <span className="text-[10px] text-slate-400 tabular-nums">
                Seed #{compositionSeed % 10000} · {totalBars} Bars
              </span>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-slate-400 block">Composition Strategy:</label>
              <select
                value={activeStrategyId}
                onChange={(e) => onSelectStrategy(e.target.value as CompositionStrategyId)}
                className="w-full px-2 py-1.5 bg-[#0B0E15] border border-[#283246] rounded text-amber-300 font-semibold text-xs"
              >
                {COMPOSITION_STRATEGIES.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name} — {st.subtitle}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-slate-400 block">Arrangement Macroform:</label>
              <select
                value={activeFormId}
                onChange={(e) => onSelectForm(e.target.value as MacroArrangementFormId)}
                className="w-full px-2 py-1.5 bg-[#0B0E15] border border-[#283246] rounded text-sky-300 font-semibold text-xs"
              >
                {MACRO_ARRANGEMENT_FORMS.map((fm) => (
                  <option key={fm.id} value={fm.id}>
                    {fm.name} — {fm.description}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="button"
            onClick={onComposeAllUnlockedLayers}
            className="w-full py-2 px-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded flex items-center justify-center gap-1.5 transition-colors shadow-sm"
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>Compose Full 8-Track Suite ({totalBars} Bars · Unlocked)</span>
          </button>
        </div>

        {/* Novelty Validator & ALS Cadence Safety (3 cols) */}
        <div className="lg:col-span-3 p-3 bg-[#121722] border border-[#232C3D] rounded space-y-2 flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center justify-between border-b border-[#202838] pb-1.5">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-semibold text-slate-100">NOVELTY &amp; ALS SAFETY</span>
              </div>
              <span className="text-[10px] text-emerald-400">
                {alsReport.isValid ? 'CADENCE PASS' : 'CHECK XML'}
              </span>
            </div>

            {genIdentity ? (
              <div className="grid grid-cols-2 gap-1.5 text-[11px] tabular-nums">
                <div className="p-1.5 bg-[#0B0E15] rounded border border-[#1E2636]">
                  <span className="text-[10px] text-slate-400 block">RHYTHM NOVELTY</span>
                  <span className="text-amber-400 font-semibold">
                    {Math.round(genIdentity.noveltyMetrics.rhythmicNovelty * 100)}%
                  </span>
                </div>
                <div className="p-1.5 bg-[#0B0E15] rounded border border-[#1E2636]">
                  <span className="text-[10px] text-slate-400 block">MOTIF EVOLUTION</span>
                  <span className="text-sky-300 font-semibold">
                    {Math.round(genIdentity.noveltyMetrics.arrangementNovelty * 100)}%
                  </span>
                </div>
                <div className="p-1.5 bg-[#0B0E15] rounded border border-[#1E2636]">
                  <span className="text-[10px] text-slate-400 block">COMPATIBILITY</span>
                  <span className="text-emerald-400 font-semibold">
                    {Math.round(genIdentity.noveltyMetrics.sourceCompatibility * 100)}%
                  </span>
                </div>
                <div className="p-1.5 bg-[#0B0E15] rounded border border-[#1E2636]">
                  <span className="text-[10px] text-slate-400 block">KICK PHASE</span>
                  <span className="text-emerald-400 font-semibold">
                    {genIdentity.noveltyMetrics.kickCollisionFree ? 'Zero Clash' : 'Guarded'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-slate-400 p-2 bg-[#0B0E15] rounded border border-[#1E2636]">
                Click Compose or Regenerate on any layer to compute multi-candidate novelty &amp; Jaccard distance metrics.
              </div>
            )}
          </div>

          <div className="text-[10px] text-slate-400 bg-[#0B0E15] px-2 py-1.5 rounded border border-[#1E2636] flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="truncate">{alsReport.compatibilityStatus}</span>
          </div>
        </div>
      </div>

      {/* Row 2: ADVANCED EUCLIDEAN POLYRHYTHM & CHORD VOICING / GRID STUDIO */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* Euclidean Polyrhythm Generator (7 cols) */}
        <div className="lg:col-span-7 p-3 bg-[#121722] border border-[#232C3D] rounded space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#202838] pb-1.5">
            <div className="flex items-center gap-1.5">
              <Repeat className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-semibold text-slate-100">
                ADVANCED EUCLIDEAN POLYRHYTHM &amp; POLYMETER XML GENERATOR —{' '}
                <span className="text-amber-300">{selectedTrack?.name || 'SELECT TRACK'}</span>
              </span>
            </div>
            <span className="text-[10px] text-emerald-400 font-semibold tabular-nums">
              E({Math.min(polySteps, polyPulses)}, {polySteps}, rot={polyRotation}) · &lt;LoopEnd Value=&quot;{loopEndBeats}&quot; /&gt;
            </span>
          </div>

          {/* Quick Polymeter Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-slate-400">Presets:</span>
            {POLYRHYTHM_PRESETS.map((p) => {
              const isAct = polySteps === p.steps && polyPulses === p.pulses;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setPolySteps(p.steps);
                    setPolyPulses(p.pulses);
                    setPolyRotation(p.rotation);
                  }}
                  className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                    isAct
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/60 font-semibold'
                      : 'bg-[#0B0E15] text-slate-400 border-[#222B3C] hover:text-slate-200'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Interactive Step / Pulse / Rotation / Grid Sliders */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="p-2 bg-[#0B0E15] border border-[#1E2636] rounded">
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-slate-400">STEPS (N)</span>
                <span className="text-amber-400 font-semibold">{polySteps} steps</span>
              </div>
              <input
                type="range"
                min={3}
                max={32}
                step={1}
                value={polySteps}
                onChange={(e) => {
                  const nextSteps = parseInt(e.target.value, 10);
                  setPolySteps(nextSteps);
                  if (polyPulses > nextSteps) setPolyPulses(nextSteps);
                }}
                className="w-full studio-slider"
              />
            </div>

            <div className="p-2 bg-[#0B0E15] border border-[#1E2636] rounded">
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-slate-400">PULSES (K)</span>
                <span className="text-sky-400 font-semibold">{Math.min(polySteps, polyPulses)} hits</span>
              </div>
              <input
                type="range"
                min={1}
                max={polySteps}
                step={1}
                value={Math.min(polySteps, polyPulses)}
                onChange={(e) => setPolyPulses(parseInt(e.target.value, 10))}
                className="w-full studio-slider"
              />
            </div>

            <div className="p-2 bg-[#0B0E15] border border-[#1E2636] rounded">
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-slate-400">ROTATION</span>
                <span className="text-emerald-400 font-semibold">+{polyRotation} stp</span>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, polySteps - 1)}
                step={1}
                value={Math.min(polySteps - 1, polyRotation)}
                onChange={(e) => setPolyRotation(parseInt(e.target.value, 10))}
                className="w-full studio-slider"
              />
            </div>

            <div className="p-2 bg-[#0B0E15] border border-[#1E2636] rounded flex flex-col justify-between">
              <div className="text-[10px] text-slate-400">STEP GRID</div>
              <div className="grid grid-cols-4 gap-1 mt-1">
                {(['1/4', '1/8', '1/16', '1/32'] as const).map((div) => (
                  <button
                    key={div}
                    type="button"
                    onClick={() => setGridDivision(div)}
                    className={`py-0.5 text-[9px] rounded border transition-colors ${
                      gridDivision === div
                        ? 'bg-sky-500/25 text-sky-300 border-sky-500/50 font-semibold'
                        : 'bg-[#121722] text-slate-400 border-[#222B3C]'
                    }`}
                  >
                    {div}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Visual Euclidean Polymeter Step Matrix */}
          <div className="flex items-center gap-1 overflow-x-auto py-1">
            {Array.from({ length: polySteps }).map((_, stepIdx) => {
              const isHit = activeEuclideanHits.has(stepIdx);
              return (
                <div
                  key={stepIdx}
                  className={`h-6 min-w-[20px] flex-1 rounded-xs border flex items-center justify-center text-[9px] font-semibold transition-colors ${
                    isHit
                      ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-xs'
                      : 'bg-[#090C12] text-slate-500 border-[#1E2636]'
                  }`}
                >
                  {stepIdx + 1}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 pt-0.5">
            <span className="text-[10px] text-slate-400">
              Unrolls {polySteps}/{gridDivision.split('/')[1]} polymeter across {totalBars} bars ({totalBars * 4} beats) + writes &lt;LoopEnd Value=&quot;{loopEndBeats}&quot; /&gt;
            </span>
            <button
              type="button"
              disabled={!selectedTrack || selectedTrack.locked}
              onClick={handleInjectPolyClip}
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-semibold rounded flex items-center gap-1.5 transition-colors shrink-0 shadow-xs"
            >
              <Repeat className="w-3.5 h-3.5" />
              <span>Inject Polymeter Clip into Ableton XML</span>
            </button>
          </div>
        </div>

        {/* Chord Voicing Spread, Key/Scale & AI Layer Prompt Studio (5 cols) */}
        <div className="lg:col-span-5 p-3 bg-[#121722] border border-[#232C3D] rounded space-y-2.5 flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center justify-between border-b border-[#202838] pb-1.5">
              <div className="flex items-center gap-1.5">
                <Music className="w-3.5 h-3.5 text-purple-400" />
                <span className="font-semibold text-slate-100">
                  CHORD VOICING, KEY &amp; AI PROMPT STUDIO
                </span>
              </div>
              <span className="text-[10px] text-purple-300">
                {gridDivision} · {voicingSpread.toUpperCase()}
              </span>
            </div>

            {/* Key, Scale & Voicing Spread Selectors */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Root Key:</label>
                <select
                  value={customKey}
                  onChange={(e) => setCustomKey(e.target.value)}
                  className="w-full px-2 py-1 bg-[#0B0E15] border border-[#283246] rounded text-amber-300 font-semibold text-xs"
                >
                  {['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map((k) => (
                    <option key={k} value={k}>
                      Key of {k}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Scale Mode:</label>
                <select
                  value={customScale}
                  onChange={(e) => setCustomScale(e.target.value)}
                  className="w-full px-2 py-1 bg-[#0B0E15] border border-[#283246] rounded text-sky-300 font-semibold text-xs"
                >
                  {['Phrygian', 'Minor', 'Dorian', 'Locrian', 'Harmonic Minor'].map((sc) => (
                    <option key={sc} value={sc}>
                      {sc}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-2 sm:col-span-1">
                <label className="text-[10px] text-slate-400 block mb-0.5">Voicing Width:</label>
                <div className="grid grid-cols-4 sm:grid-cols-2 gap-1">
                  {(['narrow', 'close', 'wide', 'octave'] as const).map((sp) => (
                    <button
                      key={sp}
                      type="button"
                      onClick={() => setVoicingSpread(sp)}
                      className={`py-0.5 px-1 text-[9px] rounded border uppercase transition-colors ${
                        voicingSpread === sp
                          ? 'bg-purple-500/25 text-purple-300 border-purple-500/50 font-semibold'
                          : 'bg-[#0B0E15] text-slate-400 border-[#222B3C]'
                      }`}
                    >
                      {sp}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* AI Style & Chord Prompt Input */}
            <div>
              <label className="text-[10px] text-slate-400 block mb-0.5">
                AI Layer &amp; Chord Direction Prompt:
              </label>
              <input
                type="text"
                value={stylePrompt}
                onChange={(e) => setStylePrompt(e.target.value)}
                placeholder="e.g. Dark Detroit minor 9th wide dub chords on 1/16 offbeats..."
                className="w-full px-2.5 py-1.5 bg-[#0B0E15] border border-[#283246] rounded text-slate-100 text-xs focus:border-amber-400 outline-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!selectedTrack || selectedTrack.locked}
              onClick={() =>
                selectedTrack &&
                onApplyChordGridTransform &&
                onApplyChordGridTransform(
                  selectedTrack.id,
                  gridDivision,
                  voicingSpread,
                  customKey,
                  customScale,
                  stylePrompt
                )
              }
              className="flex-1 py-1.5 px-2.5 bg-purple-500 hover:bg-purple-400 disabled:opacity-40 text-slate-950 font-semibold rounded flex items-center justify-center gap-1.5 transition-colors shadow-xs"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Apply {gridDivision} Grid &amp; {voicingSpread.toUpperCase()} Chords</span>
            </button>
          </div>
        </div>
      </div>

      {/* Row 3: Dynamic Section Graph & Ableton Live 12 MIDI Transformation Tools */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* Section Architecture Planner (6 cols) */}
        <div className="lg:col-span-6 p-3 bg-[#121722] border border-[#232C3D] rounded space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <GitBranch className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-semibold text-slate-100">
                DYNAMIC {totalBars}-BAR SECTION PLANNER (CLICK TO AUDITION BAR)
              </span>
            </div>
            <span className="text-[10px] text-slate-400">{sections.length} Structural Sections</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            {sections.map((sec) => (
              <button
                key={sec.id}
                type="button"
                onClick={() => onSeekBeat((sec.startBar - 1) * 4)}
                className="p-2 text-left bg-[#0B0E15] hover:bg-[#161D2B] border border-[#222B3C] hover:border-amber-500/50 rounded transition-colors flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between text-[10px] text-amber-400 font-semibold">
                    <span>
                      B{sec.startBar}–B{sec.endBar}
                    </span>
                    <span>E:{Math.round(sec.targetEnergy * 100)}%</span>
                  </div>
                  <div className="text-[11px] font-semibold text-slate-100 truncate mt-0.5">
                    {sec.role.replace(/_/g, ' ')}
                  </div>
                  <div className="text-[10px] text-slate-400 line-clamp-2 mt-0.5 leading-tight">
                    {sec.sectionEvent}
                  </div>
                </div>
                <div className="w-full h-1 bg-[#1A2232] rounded-full overflow-hidden mt-2">
                  <div
                    className="h-full bg-amber-500"
                    style={{ width: `${Math.round(sec.targetEnergy * 100)}%` }}
                  />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Ableton Live 12 MIDI Transformation Tools (6 cols) */}
        <div className="lg:col-span-6 p-3 bg-[#121722] border border-[#232C3D] rounded space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-sky-400" />
              <span className="font-semibold text-slate-100">
                ABLETON LIVE 12 MIDI TOOLS — TARGET: {selectedTrack?.name || 'SELECT TRACK'}
              </span>
            </div>
            {selectedTrack && (
              <button
                type="button"
                onClick={() => onToggleTrackLock(selectedTrack.id)}
                className={`px-2 py-0.5 rounded text-[10px] flex items-center gap-1 border transition-colors ${
                  selectedTrack.locked
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                    : 'bg-[#0B0E15] text-slate-400 border-[#242E42] hover:text-slate-200'
                }`}
              >
                {selectedTrack.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                <span>{selectedTrack.locked ? 'Track Locked' : 'Unlocked'}</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {MIDI_TOOLS.map((tool) => (
              <button
                key={tool.id}
                type="button"
                disabled={!selectedTrack || selectedTrack.locked}
                onClick={() => selectedTrack && onApplyMidiTool(selectedTrack.id, tool.id)}
                title={tool.desc}
                className="p-2 text-left bg-[#0B0E15] hover:bg-[#182132] disabled:opacity-40 border border-[#222B3C] hover:border-sky-500/50 rounded transition-colors"
              >
                <div className="text-[11px] font-semibold text-sky-300 truncate">{tool.label}</div>
                <div className="text-[9px] text-slate-400 truncate mt-0.5">{tool.desc}</div>
              </button>
            ))}
          </div>

          {/* AI Composer Note Velocity Randomizer with Min/Max, Blend %, Accent Lock & Live Distribution */}
          {(() => {
            const selectedTrackNotes = selectedTrack?.clips?.flatMap(clip => clip.notes) || [];
            const noteCount = selectedTrackNotes.length;
            const lockedCount = selectedTrackNotes.filter((n) => {
              if (velAccentLock && (n.isAccent || n.velocity >= 110)) return true;
              if (velDownbeatLock && n.time % 4 === 0) return true;
              return false;
            }).length;
            const randomizedCount = Math.max(0, noteCount - lockedCount);

            return (
              <div className="mt-2.5 p-2.5 bg-[#0D1118] border border-[#232D3F] rounded space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                    <Sliders className="w-3.5 h-3.5 text-amber-400" />
                    <span>NOTE VELOCITY RANDOMIZER</span>
                  </div>
                  <span className="text-[9.5px] font-mono text-zinc-400">
                    {selectedTrack ? `${randomizedCount}/${noteCount} notes active` : 'Select a track'}
                  </span>
                </div>

                {/* Min & Max Inputs + Blend Slider */}
                <div className="grid grid-cols-3 gap-2 text-[10px] font-mono">
                  <div className="space-y-1">
                    <div className="flex justify-between text-zinc-400">
                      <span>MIN VEL:</span>
                      <span className="text-amber-300 font-bold">{velMin}</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={Math.min(126, velMax - 1)}
                      value={velMin}
                      onChange={(e) => setVelMin(Number(e.target.value))}
                      className="w-full accent-amber-500 h-1.5 cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-zinc-400">
                      <span>MAX VEL:</span>
                      <span className="text-amber-300 font-bold">{velMax}</span>
                    </div>
                    <input
                      type="range"
                      min={Math.max(2, velMin + 1)}
                      max={127}
                      value={velMax}
                      onChange={(e) => setVelMax(Number(e.target.value))}
                      className="w-full accent-amber-500 h-1.5 cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-zinc-400">
                      <span>BLEND:</span>
                      <span className="text-sky-300 font-bold">{velBlendPct}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={velBlendPct}
                      onChange={(e) => setVelBlendPct(Number(e.target.value))}
                      className="w-full accent-sky-500 h-1.5 cursor-pointer"
                    />
                  </div>
                </div>

                {/* Accent Lock, Downbeat Lock, Seed Generator */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono pt-1 border-t border-[#1C2433]">
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={velAccentLock}
                        onChange={(e) => setVelAccentLock(e.target.checked)}
                        className="accent-amber-500 rounded"
                      />
                      <span>Accent Lock (≥110)</span>
                    </label>

                    <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={velDownbeatLock}
                        onChange={(e) => setVelDownbeatLock(e.target.checked)}
                        className="accent-amber-500 rounded"
                      />
                      <span>Downbeat Lock (1.1)</span>
                    </label>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-zinc-500 text-[9px]">SEED: {velSeed}</span>
                    <button
                      type="button"
                      onClick={() => setVelSeed(Math.floor(Math.random() * 9000 + 1000))}
                      className="p-1 rounded bg-[#151B26] hover:bg-[#1E2736] text-amber-300 border border-[#263145]"
                      title="Generate new random seed"
                    >
                      <Dices className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Live Distribution Mini-Histogram Preview */}
                <div className="p-1.5 bg-[#080B0F] border border-[#192230] rounded flex items-center justify-between gap-1 text-[8.5px] font-mono">
                  <span className="text-zinc-500 shrink-0">DIST:</span>
                  <div className="flex-1 flex items-end gap-0.5 h-5 px-1">
                    {[20, 35, 50, 65, 80, 95, 110, 125].map((binThreshold, bIdx) => {
                      const inBin = selectedTrackNotes.filter(
                        (n) => n.velocity >= binThreshold - 15 && n.velocity < binThreshold
                      ).length;
                      const normH = Math.min(100, (inBin / Math.max(1, noteCount)) * 100);
                      const isTargetRange = binThreshold >= velMin && binThreshold <= velMax + 15;
                      return (
                        <div
                          key={bIdx}
                          className="flex-1 rounded-xs transition-all"
                          style={{
                            height: `${Math.max(15, normH)}%`,
                            backgroundColor: isTargetRange ? '#F59E0B' : '#334155',
                            opacity: isTargetRange ? 0.9 : 0.4,
                          }}
                          title={`Velocity bin ${binThreshold - 15}-${binThreshold}: ${inBin} notes`}
                        />
                      );
                    })}
                  </div>
                  <span className="text-amber-400 font-bold shrink-0">
                    [{velMin}–{velMax}]
                  </span>
                </div>

                {/* Apply Button */}
                <button
                  type="button"
                  disabled={!selectedTrack || selectedTrack.locked || noteCount === 0}
                  onClick={() => {
                    if (!selectedTrack || !onRandomizeTrackVelocities) return;
                    onRandomizeTrackVelocities(selectedTrack.id, {
                      minVelocity: velMin,
                      maxVelocity: velMax,
                      blendPct: velBlendPct,
                      accentLock: velAccentLock,
                      downbeatLock: velDownbeatLock,
                      seed: velSeed,
                    });
                  }}
                  className="w-full py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold rounded flex items-center justify-center gap-1.5 transition-colors shadow-xs text-xs"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>
                    Randomize Velocities on {selectedTrack?.name || 'Selected Track'} ({randomizedCount} notes)
                  </span>
                </button>

                {/* MIDI Quantize Grid Strength Transformation Tool (50%, 75%, 100%) */}
                <div className="mt-2.5 pt-2 border-t border-[#1F2837] space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-300">
                      <Wand2 className="w-3.5 h-3.5 text-sky-400" />
                      <span>MIDI QUANTIZE GRID STRENGTH</span>
                    </div>
                    <span className="text-[9.5px] font-mono text-zinc-400">
                      {selectedTrack ? `${noteCount} notes in clip` : 'Select a track'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                    <div>
                      <label className="text-zinc-400 block mb-1">Grid Division:</label>
                      <div className="grid grid-cols-4 gap-1">
                        {(['1/4', '1/8', '1/16', '1/32'] as NoteGridDivision[]).map((g) => (
                          <button
                            key={g}
                            type="button"
                            onClick={() => setQuantizeGridDivision(g)}
                            className={`py-1 text-[9.5px] font-bold rounded border transition-colors ${
                              quantizeGridDivision === g
                                ? 'bg-sky-500/25 text-sky-300 border-sky-500/60'
                                : 'bg-[#0B0E14] text-zinc-400 border-[#222B3C] hover:text-zinc-200'
                            }`}
                          >
                            {g}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-zinc-400 block mb-1">Quantize Strength:</label>
                      <div className="grid grid-cols-3 gap-1">
                        {([50, 75, 100] as const).map((str) => (
                          <button
                            key={str}
                            type="button"
                            onClick={() => setQuantizeStrengthPct(str)}
                            className={`py-1 text-[9.5px] font-bold rounded border transition-colors ${
                              quantizeStrengthPct === str
                                ? 'bg-amber-500/25 text-amber-300 border-amber-500/60'
                                : 'bg-[#0B0E14] text-zinc-400 border-[#222B3C] hover:text-zinc-200'
                            }`}
                          >
                            {str}%
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={!selectedTrack || selectedTrack.locked || noteCount === 0}
                    onClick={() => {
                      if (!selectedTrack || !onApplyMidiQuantizeStrength) return;
                      onApplyMidiQuantizeStrength(
                        selectedTrack.id,
                        quantizeGridDivision,
                        quantizeStrengthPct
                      );
                    }}
                    className="w-full py-1.5 bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-slate-950 font-bold rounded flex items-center justify-center gap-1.5 transition-colors shadow-xs text-xs"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    <span>
                      Apply {quantizeStrengthPct}% Quantize ({quantizeGridDivision}) on {selectedTrack?.name || 'Selected Track'}
                    </span>
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Row 4: Scene Arrangement Replacement & Track Lock Manager */}
      <div className="p-3 bg-[#121722] border border-[#232C3D] rounded space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-semibold text-slate-100">
              SESSION LAUNCHES &amp; TRACK LOCKS ({project.tracks.length} TRACKS)
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {[0, 1, 2, 3].map((sceneIdx) => (
              <button
                key={sceneIdx}
                type="button"
                onClick={() => onLaunchSessionScene(sceneIdx)}
                className="px-2.5 py-1 bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded text-[10px] font-semibold flex items-center gap-1 transition-colors"
              >
                <Play className="w-2.5 h-2.5 fill-current" />
                <span>Launch Scene {String.fromCharCode(65 + sceneIdx)}</span>
              </button>
            ))}
          </div>
        </div>

        <p className="text-[10px] text-slate-400">Launch queues independent Session clips on the launch grid. Arrangement clips are preserved. Capture performance explicitly in the Session workspace.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-2">
          {project.tracks.map((track) => {
            const isSelected = track.id === selectedTrack?.id;
            return (
              <div
                key={track.id}
                onClick={() => onSelectTrack(track.id)}
                className={`p-2 rounded border cursor-pointer transition-colors space-y-1.5 ${
                  isSelected
                    ? 'bg-[#182030] border-amber-500/60'
                    : 'bg-[#0B0E15] border-[#1F2737] hover:border-[#2F3B52]'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className="font-semibold text-slate-100 truncate text-[11px]"
                    style={{ color: track.hexColor }}
                  >
                    {track.name}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleTrackLock(track.id);
                      }}
                      title={track.locked ? 'Unlock track' : 'Lock track to protect from regeneration'}
                      className={`p-1 rounded border ${
                        track.locked
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                          : 'bg-[#131824] text-slate-400 border-[#252F42]'
                      }`}
                    >
                      {track.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                    </button>
                    {track.archetype !== 'kick' && track.archetype !== 'existing' && (
                      <button
                        type="button"
                        disabled={track.locked}
                        onClick={(e) => {
                          e.stopPropagation();
                          onComposeSingleLayer(track.archetype);
                        }}
                        title="Compose fresh variation for this track"
                        className="p-1 rounded bg-[#1B2436] hover:bg-[#25324A] text-amber-300 border border-[#2E3C56] disabled:opacity-40"
                      >
                        <Dices className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-1">
                  {['Scene A', 'Scene B', 'Scene C', 'Scene D'].map((sceneLabel, sIdx) => {
                    const requested=project.session?.events.filter(event=>event.trackId===track.id).at(-1);
                    const isActiveSlot = !!requested?.clipId && requested.clipId===track.sessionClips?.[sIdx]?.id;
                    return (
                      <button
                        key={sIdx}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onLaunchSessionScene(sIdx, track.id);
                        }}
                        className={`px-1.5 py-1 rounded text-[10px] truncate flex items-center gap-1 border transition-colors ${
                          isActiveSlot
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 font-semibold'
                            : 'bg-[#121722] text-slate-400 border-[#202838] hover:text-slate-200'
                        }`}
                      >
                        <Play className="w-2.5 h-2.5 shrink-0 fill-current" />
                        <span className="truncate">{sceneLabel}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
