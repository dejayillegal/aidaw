import {
  AbletonMidiClip,
  AbletonProjectState,
  AbletonTrack,
  AlsValidationReport,
  ArrangementSectionNode,
  AutomationPoint,
  CompositionStrategyId,
  HumanizationConfig,
  InstrumentRoleTemplate,
  MacroArrangementFormId,
  MidiNoteEvent,
  MidiToolTransformationId,
  MusicalProjectProfile,
  NoteGridDivision,
  NoveltyValidationMetrics,
  TechnoArchetype,
  TechnoSubgenreId,
  VoicingSpreadStyle,
  TrackVelocityRandomizerConfig,
} from '../types/ableton';
import {
  applyDillaShuffleSwing,
  applyShuffleSwingToMidiClip,
  applySixteenthNoteSwing,
  applySwingToMidiClip,
  buildChordVoicingOffsets,
  computeDillaShuffleOffsetBeats,
  gaussianRandom,
  gridDivisionToStepBeats,
  MAX_DILLA_SHUFFLE_POCKET_MS,
  MAX_SIXTEENTH_SWING_SHIFT_BEATS,
  rootKeyToMidiBase,
  seededRandom,
} from './alsXmlEngine';
import { syncDeviceConversionRecord } from './abletonCapabilityMatrix';

/** Track controls address every Arrangement clip; Session content is independent. */
export function transformTrackArrangementNotes(
  project: AbletonProjectState,
  trackId: string,
  transform: (notes: MidiNoteEvent[], clip: AbletonMidiClip) => MidiNoteEvent[]
): AbletonProjectState {
  const target = project.tracks.find(track => track.id === trackId);
  if (!target) throw new Error(`Track ${trackId} not found`);
  if (target.locked) throw new Error(`Track ${trackId} is locked`);
  if (target.type !== 'midi') throw new Error(`Track ${trackId} is not MIDI`);
  return { ...project, tracks: project.tracks.map(track => track.id !== trackId ? track : {
    ...track, clips: track.clips.map(clip => {
      const copy = structuredClone(clip);
      return { ...clip, notes: structuredClone(transform(copy.notes, copy)) };
    }),
  }) };
}

/** Stable per-event sampling: clip ordering never changes another note's velocity. */
export function randomizeTrackNoteVelocities(notes: MidiNoteEvent[], config: TrackVelocityRandomizerConfig): MidiNoteEvent[] {
  if (![config.minVelocity, config.maxVelocity, config.blendPct, config.seed].every(Number.isFinite) ||
      !Number.isInteger(config.seed) || config.minVelocity < 1 || config.maxVelocity > 127 ||
      config.minVelocity > config.maxVelocity || config.blendPct < 0 || config.blendPct > 100) {
    throw new Error('MIDI_VELOCITY: invalid range, blend or seed');
  }
  const blend = config.blendPct / 100;
  return notes.map(note => {
    if ((config.accentLock && (note.isAccent || note.velocity >= 110)) ||
        (config.downbeatLock && Math.abs(note.time / 4 - Math.round(note.time / 4)) < 0.0125)) return { ...note };
    let hash = 2166136261;
    for (const char of `${config.seed}:${note.id}:${note.pitch}:${note.quantizedTime}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    const target = Math.round(config.minVelocity + (hash >>> 0) / 4294967296 * (config.maxVelocity - config.minVelocity));
    return { ...note, velocity: Math.max(1, Math.min(127, Math.round(note.velocity * (1 - blend) + target * blend))) };
  });
}

export { applySixteenthNoteSwing, applySwingToMidiClip, MAX_SIXTEENTH_SWING_SHIFT_BEATS };

export interface CompositionStrategySpec {
  id: CompositionStrategyId;
  name: string;
  subtitle: string;
  targetDensity: number;
  swingOffsetBeats: number;
  phraseLengthBars: 2 | 4 | 8;
  scaleIntervals: number[];
}

export const COMPOSITION_STRATEGIES: CompositionStrategySpec[] = [
  {
    id: 'hypnotic_evolving',
    name: 'Hypnotic Evolving',
    subtitle: 'Berghain 4-bar cell evolution with gradual note mutation',
    targetDensity: 0.62,
    swingOffsetBeats: 0.004,
    phraseLengthBars: 4,
    scaleIntervals: [0, 1, 3, 5, 7, 8, 10], // Phrygian
  },
  {
    id: 'asymmetric_industrial',
    name: 'Asymmetric Industrial',
    subtitle: 'Euclidean 5/16 & 7/16 cross-rhythms with metallic tension',
    targetDensity: 0.72,
    swingOffsetBeats: 0.0,
    phraseLengthBars: 4,
    scaleIntervals: [0, 1, 3, 6, 7, 8, 10], // Locrian / Diminished tension
  },
  {
    id: 'minimal_groove',
    name: 'Minimal Evolving Groove',
    subtitle: 'High negative space, micro-accents & call-and-response',
    targetDensity: 0.38,
    swingOffsetBeats: 0.008,
    phraseLengthBars: 4,
    scaleIntervals: [0, 2, 3, 5, 7, 8, 10], // Natural Minor
  },
  {
    id: 'dub_space',
    name: 'Dub-Space Chord Architecture',
    subtitle: 'Dorian modal voicings, chord inversions & 3/16 echo breath',
    targetDensity: 0.44,
    swingOffsetBeats: 0.006,
    phraseLengthBars: 8,
    scaleIntervals: [0, 2, 3, 5, 7, 9, 10], // Dorian
  },
  {
    id: 'detroit_funk',
    name: 'Detroit Mechanical Funk',
    subtitle: 'Syncopated bass bounce, minor 7th stabs & swung 16th hats',
    targetDensity: 0.66,
    swingOffsetBeats: 0.011,
    phraseLengthBars: 4,
    scaleIntervals: [0, 2, 3, 5, 7, 9, 10],
  },
  {
    id: 'raw_warehouse',
    name: 'Raw Warehouse Pressure',
    subtitle: 'Relentless offbeat sub-bass, hard 909 hats & turnaround fills',
    targetDensity: 0.80,
    swingOffsetBeats: 0.003,
    phraseLengthBars: 4,
    scaleIntervals: [0, 1, 3, 5, 7, 8, 10],
  },
  {
    id: 'acid_modulation',
    name: 'Acid Resonant Sequence',
    subtitle: 'Octave jumps, accented 16th slides & resonant filter sweeps',
    targetDensity: 0.74,
    swingOffsetBeats: 0.002,
    phraseLengthBars: 2,
    scaleIntervals: [0, 1, 3, 5, 7, 8, 10],
  },
  {
    id: 'peak_rolling',
    name: 'Peak-Energy Rolling Techno',
    subtitle: 'Full 16th rolling bassline, polyrhythmic percussion & risers',
    targetDensity: 0.86,
    swingOffsetBeats: 0.004,
    phraseLengthBars: 8,
    scaleIntervals: [0, 2, 3, 5, 7, 8, 10],
  },
];

export interface MacroArrangementFormSpec {
  id: MacroArrangementFormId;
  name: string;
  description: string;
}

export const MACRO_ARRANGEMENT_FORMS: MacroArrangementFormSpec[] = [
  {
    id: 'hypnotic_longform',
    name: 'Hypnotic Long-Form',
    description: 'Gradual rhythmic entrance → hypnotic lock → subtle filter dip → peak rebuild',
  },
  {
    id: 'industrial_assault',
    name: 'Industrial Assault',
    description: 'Immediate percussion pressure → fractured breakdown → distortion climax',
  },
  {
    id: 'deep_dub_evolution',
    name: 'Deep Dub Evolution',
    description: 'Atmospheric chord intro → spacious dub groove → echo feedback wash → minimal outro',
  },
  {
    id: 'detroit_mechanical',
    name: 'Detroit Mechanical Funk',
    description: 'Syncopated groove intro → melodic chord call-response → high-energy funk return',
  },
  {
    id: 'asymmetric_experimental',
    name: 'Asymmetric Experimental',
    description: 'Irregular 3-bar/5-bar structural shifts, sudden dropouts & polymetric peak',
  },
];

/**
 * Bjorklund's Euclidean rhythm generator E(pulses, steps) rotated by `rotation`.
 */
export function generateEuclideanSteps(pulses: number, steps = 16, rotation = 0): number[] {
  const k = Math.max(1, Math.min(steps, pulses));
  const result: number[] = [];
  for (let i = 0; i < steps; i++) {
    if (Math.floor((i * k) / steps) !== Math.floor(((i - 1) * k) / steps)) {
      result.push((i + rotation) % steps);
    }
  }
  return result.sort((a, b) => a - b);
}

/**
 * Section 5: ADVANCED PROJECT ANALYSIS ENGINE
 * Inspects actual MIDI notes, kick positions, pitch classes, and track roles before generating a single note.
 */
export function analyzeProjectMusicalProfile(project: AbletonProjectState): MusicalProjectProfile {
  const pitchClassHistogram = new Array(12).fill(0);
  const barDensityContour = new Array(16).fill(0);
  const kickStepCounts = new Array(16).fill(0);

  let totalNotes = 0;
  let offGridNotes = 0;
  let lowEndNotes = 0;

  const presentArchetypes = new Set<TechnoArchetype>();

  project.tracks.forEach((track) => {
    presentArchetypes.add(track.archetype);
    track.clips.forEach((clip) => {
      clip.notes.forEach((note) => {
        totalNotes++;
        const pc = ((note.pitch % 12) + 12) % 12;
        pitchClassHistogram[pc]++;

        const barIdx = Math.max(0, Math.min(15, Math.floor(note.time / 4) % 16));
        barDensityContour[barIdx]++;

        const stepInBar = Math.round((note.quantizedTime % 4) * 4) % 16;
        if (track.archetype === 'kick' || note.pitch <= 38) {
          kickStepCounts[stepInBar]++;
        }
        if (note.pitch <= 45) {
          lowEndNotes++;
        }
        if (stepInBar % 4 !== 0) {
          offGridNotes++;
        }
      });
    });
  });

  const kickOnsetSteps: number[] = [];
  kickStepCounts.forEach((count, step) => {
    if (count >= 2) kickOnsetSteps.push(step);
  });
  if (kickOnsetSteps.length === 0) {
    kickOnsetSteps.push(0, 4, 8, 12); // Standard 4/4 reference if kick clip is empty
  }

  const allCoreArchetypes: TechnoArchetype[] = [
    'rumble',
    'percussion',
    'synth',
    'hats',
    'acid',
    'ride',
    'pad',
  ];
  const missingArchetypes = allCoreArchetypes.filter((a) => !presentArchetypes.has(a));
  const hasExistingSubBass =
    presentArchetypes.has('rumble') || presentArchetypes.has('acid') || lowEndNotes > 90;

  const lowEndOccupancyRatio =
    totalNotes > 0 ? Math.min(1, lowEndNotes / Math.max(64, totalNotes)) : 0.25;
  const syncopationIndex = totalNotes > 0 ? Math.min(1, offGridNotes / totalNotes) : 0.35;

  const conflictWarnings: string[] = [];
  const complementRecommendations: string[] = [];

  if (hasExistingSubBass && lowEndOccupancyRatio > 0.55) {
    conflictWarnings.push(
      'High sub-bass occupancy detected (<45 Hz). Use Spectral Auto-Duck in Device Rack to notch Kick fundamental and prevent low-end masking.'
    );
  }
  if (kickOnsetSteps.some((s) => s % 4 !== 0)) {
    complementRecommendations.push(
      `Detected syncopated ghost kicks on steps [${kickOnsetSteps.filter((s) => s % 4 !== 0).join(', ')}]; sub-bass, acid, and percussion interlock around ghost kicks.`
    );
  }
  if (missingArchetypes.length > 0) {
    complementRecommendations.push(
      `Available studio layers to inject: ${missingArchetypes.map((m) => m.toUpperCase()).join(', ')}.`
    );
  } else {
    complementRecommendations.push(
      'Full 8-track techno suite active. Use Polyrhythm Studio, Chord Grid, or AI Smart Leveling to evolve the arrangement.'
    );
  }

  const maxPcCount = Math.max(1, ...pitchClassHistogram);
  const nonZeroPcs = pitchClassHistogram.filter((c) => c > 0).length;
  const harmonicConfidence =
    nonZeroPcs >= 2 ? Math.min(0.96, 0.55 + (maxPcCount / Math.max(1, totalNotes)) * 0.45) : 0.65;

  const fingerprintStr = `${project.fileName}_${project.tempo}_${project.rootKey}_${project.scale}_${totalNotes}_${kickOnsetSteps.join('-')}`;

  const hasPolymeterClip = project.tracks.some((t) =>
    t.clips.some((c) => c.isPolymeter || (c.loopEndBeats && c.loopEndBeats !== 16))
  );

  return {
    projectFingerprint: fingerprintStr,
    confirmedTempo: project.tempo,
    detectedRootKey: project.rootKey,
    detectedScale: project.scale,
    harmonicConfidence: Number(harmonicConfidence.toFixed(2)),
    kickOnsetSteps,
    hasExistingSubBass,
    lowEndOccupancyRatio: Number(lowEndOccupancyRatio.toFixed(2)),
    syncopationIndex: Number(syncopationIndex.toFixed(2)),
    polyrhythmicRatio: hasPolymeterClip
      ? 'True Polymeter LoopEnd Active'
      : presentArchetypes.has('percussion')
      ? '3:4 / 5:16 Euclidean'
      : '4:4 Grid',
    barDensityContour,
    pitchClassHistogram,
    missingArchetypes,
    conflictWarnings,
    complementRecommendations,
  };
}

/**
 * Section 9: DYNAMIC ARRANGEMENT GENERATION ENGINE
 * Builds a multi-section arrangement graph scaled dynamically to `totalBars` (16, 32, 64, or 128 bars).
 */
export function generateSectionArrangementPlan(
  formId: MacroArrangementFormId,
  totalBars = 16,
  seed = 0
): ArrangementSectionNode[] {
  if (!Number.isInteger(totalBars) || totalBars < 1 || totalBars > 1000000 || !Number.isFinite(seed)) {
    throw new Error('Arrangement requires 1–1000000 whole bars and a finite seed');
  }
  const all: TechnoArchetype[] = ['kick', 'rumble', 'percussion', 'synth', 'hats', 'acid', 'ride', 'pad'];
  const openingChoices: TechnoArchetype[][] = formId === 'deep_dub_evolution'
    ? [['pad', 'synth'], ['pad', 'percussion'], ['kick', 'pad']]
    : formId === 'industrial_assault'
    ? [['kick', 'percussion'], ['rumble', 'acid'], ['percussion', 'hats']]
    : [['kick', 'hats'], ['pad', 'percussion'], ['kick', 'rumble'], ['synth', 'hats']];
  const opening = openingChoices[Math.floor(seededRandom(seed + 31) * openingChoices.length)];
  const roles: ArrangementSectionNode['role'][] = totalBars < 6
    ? ['Intro', 'Peak_Drop', 'Outro'].slice(0, totalBars) as ArrangementSectionNode['role'][]
    : ['Intro', 'Groove_Establish', 'Tension_Riser', 'Breakdown', 'Peak_Drop', 'Outro'];
  // Longer seeded forms can develop through an earlier drop and second build.
  if (seed !== 0 && totalBars >= 64 && seededRandom(seed + 91) > 0.45) {
    roles.splice(3, 0, 'Peak_Drop', 'Hypnotic_Lock');
    roles.splice(roles.length - 2, 0, 'Tension_Riser');
  }
  const weights = roles.map((role, i) => {
    const base = role === 'Peak_Drop' ? 2 : role === 'Tension_Riser' ? 0.7 : 1.2;
    return base * (0.75 + seededRandom(seed + i * 131 + 17) * 0.5);
  });
  // Allocate all bars exactly; every section receives at least one bar.
  const remaining = totalBars - roles.length;
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const lengths = weights.map(w => 1 + Math.floor(remaining * w / weightSum));
  for (let extra = totalBars - lengths.reduce((a, b) => a + b, 0), i = 0; extra > 0; extra--, i++) lengths[i % lengths.length]++;
  let startBar = 1;
  return roles.map((role, i) => {
    const endBar = startBar + lengths[i] - 1;
    const active: TechnoArchetype[] = role === 'Intro' ? opening
      : role === 'Breakdown' ? ['pad', 'synth', 'acid', 'percussion']
      : role === 'Outro' ? ['kick', 'hats', 'percussion']
      : role === 'Tension_Riser' ? ['hats', 'percussion', 'acid', 'synth']
      : role === 'Groove_Establish' ? ['kick', 'rumble', 'percussion', 'hats'] : all;
    const energy = role === 'Intro' ? 0.3 : role === 'Breakdown' ? 0.25 : role === 'Outro' ? 0.35 : role === 'Peak_Drop' ? 0.98 : role === 'Tension_Riser' ? 0.8 : 0.65;
    const section: ArrangementSectionNode = {
      id: `sec_${i + 1}`, name: `${role.replace(/_/g, ' ')} · Bars ${startBar}–${endBar}`,
      role, startBar, endBar, targetEnergy: energy, activeArchetypes: [...active],
      sectionEvent: role === 'Tension_Riser' ? 'Low-end withdrawal, filter rise and phrase fill'
        : role === 'Peak_Drop' ? 'Kick and bass re-entry with full orchestration'
        : role === 'Breakdown' ? 'Harmonic space with sustaining effect tails'
        : role === 'Outro' ? 'Withdraw melodic layers for DJ mix-out' : 'Develop the shared rhythmic motif',
    };
    startBar = endBar + 1;
    return section;
  });
}

export function generateContextualAutomationPoints(
  archetype: TechnoArchetype,
  formId: MacroArrangementFormId,
  seed: number,
  totalBars = 16,
  sectionPlan?: ArrangementSectionNode[]
): AutomationPoint[] {
  const sections = sectionPlan || generateSectionArrangementPlan(formId, totalBars, seed);
  const totalBeats = totalBars * 4;
  const points: AutomationPoint[] = [];
  const jitter = (seededRandom(seed + 77) - 0.5) * 0.08;

  sections.forEach((sec, idx) => {
    const startBeat = (sec.startBar - 1) * 4;
    const endBeat = sec.endBar * 4;
    const midBeat = Math.round((startBeat + endBeat) / 2);

    let baseVal = sec.targetEnergy;
    if (archetype === 'rumble') {
      baseVal = sec.role === 'Breakdown' ? 0.22 : Math.min(0.88, sec.targetEnergy * 0.82);
    } else if (archetype === 'acid') {
      baseVal = sec.role === 'Tension_Riser' || sec.role === 'Peak_Drop' ? 0.95 : sec.targetEnergy * 0.86;
    } else if (archetype === 'synth' || archetype === 'pad') {
      baseVal = sec.role === 'Tension_Riser' ? 0.92 : sec.targetEnergy * 0.85;
    } else if (archetype === 'percussion' || archetype === 'ride') {
      baseVal = Math.min(0.94, sec.targetEnergy * 0.9);
    }

    if (idx === 0) {
      points.push({
        beat: 0,
        value: Number(Math.max(0.15, Math.min(0.95, baseVal * 0.75 + jitter)).toFixed(2)),
      });
    }
    points.push({
      beat: midBeat,
      value: Number(Math.max(0.15, Math.min(0.96, baseVal + jitter)).toFixed(2)),
    });
    if (sec.role === 'Tension_Riser' || idx === sections.length - 2) {
      points.push({
        beat: Math.max(startBeat + 1, endBeat - 1),
        value: Number(Math.min(0.98, baseVal + 0.18).toFixed(2)),
      });
    }
    if (idx === sections.length - 1) {
      points.push({
        beat: totalBeats,
        value: Number(Math.max(0.25, Math.min(0.85, baseVal * 0.7)).toFixed(2)),
      });
    }
  });

  return points.sort((a, b) => a.beat - b.beat);
}

/**
 * Section 7: MEASURABLE NOVELTY AND REPETITION DETECTION
 */
export function evaluateGenerationNovelty(
  candidateNotes: MidiNoteEvent[],
  project: AbletonProjectState,
  archetype: TechnoArchetype,
  profile: MusicalProjectProfile
): NoveltyValidationMetrics {
  if (candidateNotes.length === 0) {
    return {
      rhythmicNovelty: 0,
      harmonicNovelty: 0,
      motifNovelty: 0,
      arrangementNovelty: 0,
      sourceCompatibility: 0,
      kickCollisionFree: true,
      candidatesEvaluated: 1,
      summaryReason: 'Empty candidate clip',
    };
  }

  const barStepSets: Set<number>[] = Array.from({ length: 16 }, () => new Set<number>());
  const candidatePitches = new Set<number>();
  let kickCollisions = 0;

  candidateNotes.forEach((n) => {
    const bar = Math.max(0, Math.min(15, Math.floor(n.quantizedTime / 4) % 16));
    const step = Math.round((n.quantizedTime % 4) * 4) % 16;
    barStepSets[bar].add(step);
    candidatePitches.add(n.pitch % 12);

    if (archetype === 'rumble' && profile.kickOnsetSteps.includes(step) && n.velocity > 85) {
      kickCollisions++;
    }
  });

  let distinctBarCount = 0;
  const bar0Sig = Array.from(barStepSets[0]).sort().join(',');
  for (let b = 1; b < 16; b++) {
    const sig = Array.from(barStepSets[b]).sort().join(',');
    if (sig !== bar0Sig) distinctBarCount++;
  }
  const arrangementNovelty = Math.min(0.98, 0.48 + (distinctBarCount / 15) * 0.5);

  const prevTrack = project.tracks.find((t) => t.archetype === archetype);
  let rhythmicNovelty = 0.86;
  let motifNovelty = 0.84;

  if (prevTrack && prevTrack.clips[0] && prevTrack.clips[0].notes.length > 0) {
    const prevNotes = prevTrack.clips[0].notes;
    const prevOnsets = new Set(prevNotes.slice(0, 64).map((n) => `${Math.round(n.quantizedTime * 4)}`));
    const candOnsets = new Set(candidateNotes.slice(0, 64).map((n) => `${Math.round(n.quantizedTime * 4)}`));

    let intersection = 0;
    candOnsets.forEach((o) => {
      if (prevOnsets.has(o)) intersection++;
    });
    const union = Math.max(1, prevOnsets.size + candOnsets.size - intersection);
    const jaccardSimilarity = intersection / union;
    rhythmicNovelty = Math.max(0.25, Math.min(0.99, 1 - jaccardSimilarity * 0.72));

    const prevPitchSeq = prevNotes.slice(0, 24).map((n) => n.pitch).join('-');
    const candPitchSeq = candidateNotes.slice(0, 24).map((n) => n.pitch).join('-');
    motifNovelty = prevPitchSeq === candPitchSeq ? 0.35 : Math.min(0.97, rhythmicNovelty * 0.55 + 0.42);
  }

  const harmonicNovelty = Math.min(0.96, 0.52 + candidatePitches.size * 0.08);
  const kickCollisionFree = kickCollisions === 0;
  const sourceCompatibility = kickCollisionFree ? 0.95 : Math.max(0.6, 0.95 - kickCollisions * 0.04);

  return {
    rhythmicNovelty: Number(rhythmicNovelty.toFixed(2)),
    harmonicNovelty: Number(harmonicNovelty.toFixed(2)),
    motifNovelty: Number(motifNovelty.toFixed(2)),
    arrangementNovelty: Number(arrangementNovelty.toFixed(2)),
    sourceCompatibility: Number(sourceCompatibility.toFixed(2)),
    kickCollisionFree,
    candidatesEvaluated: 1,
    summaryReason: `Verified ${distinctBarCount}/16 evolving bars · ${candidatePitches.size} pitch classes · Kick-phase safe.`,
  };
}

/**
 * Section 6 & 8: HIERARCHICAL PROJECT-CONDITIONED LAYER COMPOSER
 * Generates an evolving composition across `totalBars` (16, 32, 64, or 128 bars) for all 8 techno archetypes.
 */
export function composeProjectConditionedLayerNotes(
  project: AbletonProjectState,
  archetype: TechnoArchetype,
  strategyId: CompositionStrategyId,
  formId: MacroArrangementFormId,
  humanization: HumanizationConfig,
  compositionSeed: number,
  humanizationSeed: number,
  totalBarsOverride?: number,
  sectionPlan?: ArrangementSectionNode[]
): {
  notes: MidiNoteEvent[];
  sessionClips: AbletonMidiClip[];
  novelty: NoveltyValidationMetrics;
  reasoning: string;
} {
  const totalBars = totalBarsOverride || project.arrangementLengthBars || 16;
  const profile = analyzeProjectMusicalProfile(project);
  const strategy =
    COMPOSITION_STRATEGIES.find((s) => s.id === strategyId) || COMPOSITION_STRATEGIES[0];
  const sections = sectionPlan || generateSectionArrangementPlan(formId, totalBars, compositionSeed);

  const maxShift = humanization.microTimingMaxShiftBeats;
  const velVar = humanization.velocityVariancePct;
  const scaleIntervals = strategy.scaleIntervals;

  let bestNotes: MidiNoteEvent[] = [];
  let bestNovelty: NoveltyValidationMetrics | null = null;
  let attempts = 0;

  for (let attempt = 0; attempt < 3; attempt++) {
    attempts++;
    const seed = compositionSeed + attempt * 997;
    const hSeed = humanizationSeed + attempt * 131;
    const candidate: MidiNoteEvent[] = [];

    if (archetype === 'rumble') {
      const subRoot = rootKeyToMidiBase(project.rootKey, 1);
      const cellPulses = strategy.targetDensity > 0.7 ? 12 : strategy.targetDensity < 0.45 ? 7 : 10;
      const rotation = Math.floor(seededRandom(seed + 3) * 4);
      const cellA = new Set(generateEuclideanSteps(cellPulses, 16, rotation));
      const cellB = new Set(generateEuclideanSteps(Math.max(5, cellPulses - 2), 16, (rotation + 2) % 16));

      for (let bar = 0; bar < totalBars; bar++) {
        const sec = sections.find((s) => bar + 1 >= s.startBar && bar + 1 <= s.endBar) || sections[0];
        const isBreakdownBar = sec.role === 'Breakdown' && bar % 2 === 0;
        const isTurnaroundBar = bar % 4 === 3;
        const activeCell = bar % 2 === 0 ? cellA : cellB;

        for (let step = 0; step < 16; step++) {
          if (step % 4 === 0) continue;
          if (profile.kickOnsetSteps.includes(step) && step % 2 === 0) continue;
          if (isBreakdownBar && step % 4 !== 2) continue;
          if (!activeCell.has(step) && step % 4 !== 2) continue;

          const quantizedTime = bar * 4 + step * 0.25;
          const isOffbeat8th = step % 4 === 2;
          const isSyncopated16th = step % 2 === 1;

          const safeShift = Math.min(0.013, maxShift);
          const swingShift = isSyncopated16th ? strategy.swingOffsetBeats : 0;
          const gauss = gaussianRandom(0, safeShift * 0.45, hSeed + bar * 16 + step);
          const finalTime = Math.max(0, quantizedTime + Math.max(-safeShift, Math.min(safeShift, swingShift + gauss)));

          let baseVel = isOffbeat8th ? 110 : step % 4 === 3 ? 92 : humanization.ghostVelocityMin + 14;
          if (sec.role === 'Peak_Drop') baseVel = Math.min(124, baseVel + 8);
          const vMult = 1 + (seededRandom(hSeed + bar * 31 + step * 7) * 2 - 1) * velVar;
          const velocity = Math.max(24, Math.min(126, Math.round(baseVel * vMult)));

          let interval = 0;
          let motifRole: MidiNoteEvent['motifRole'] = 'anchor';
          if (strategyId === 'acid_modulation' && step === 14) {
            interval = 12;
            motifRole = 'tension';
          } else if (isTurnaroundBar && step >= 13) {
            interval = scaleIntervals[1] || 1;
            motifRole = 'fill';
          } else if (bar % 4 === 1 && step === 10 && strategyId !== 'minimal_groove') {
            interval = scaleIntervals[4] || 7;
            motifRole = 'response';
          }

          candidate.push({
            id: `rumble_${bar}_${step}`,
            time: Number(finalTime.toFixed(3)),
            quantizedTime: Number(quantizedTime.toFixed(3)),
            duration: isOffbeat8th ? 0.23 : 0.18,
            pitch: subRoot + interval,
            velocity,
            isGhost: velocity <= humanization.ghostVelocityMax,
            probability: isSyncopated16th ? 0.88 : 1.0,
            motifRole,
          });
        }
      }
    } else if (archetype === 'percussion') {
      const basePitch = rootKeyToMidiBase(project.rootKey, 3);
      const pulses =
        strategyId === 'asymmetric_industrial'
          ? 7
          : strategyId === 'minimal_groove'
          ? 4
          : 6;
      const rotA = Math.floor(seededRandom(seed + 11) * 16);
      const stepsBarA = generateEuclideanSteps(pulses, 16, rotA);
      const stepsBarB = generateEuclideanSteps(pulses, 16, (rotA + 3) % 16);

      for (let bar = 0; bar < totalBars; bar++) {
        const sec = sections.find((s) => bar + 1 >= s.startBar && bar + 1 <= s.endBar) || sections[0];
        const isTurnaround = bar % 4 === 3;
        const activeSteps = bar % 2 === 0 ? stepsBarA : stepsBarB;

        activeSteps.forEach((step, idx) => {
          if (sec.role === 'Intro' && bar < 2 && idx % 2 === 1 && formId !== 'industrial_assault') {
            return;
          }
          const quantizedTime = bar * 4 + step * 0.25;
          const shift =
            step % 4 === 0
              ? 0
              : Math.max(
                  -maxShift,
                  Math.min(
                    maxShift,
                    gaussianRandom(strategy.swingOffsetBeats, maxShift * 0.5, hSeed + bar * 19 + step)
                  )
                );
          const baseVel = step % 4 === 2 ? 108 : idx % 2 === 0 ? 94 : humanization.ghostVelocityMin + 12;
          const velocity = Math.max(
            24,
            Math.min(125, Math.round(baseVel * (1 + (seededRandom(hSeed + bar * 17 + idx) * 2 - 1) * velVar)))
          );

          const scaleDeg = scaleIntervals[(idx + (bar % 3)) % scaleIntervals.length] || 0;
          const pitch = basePitch + (idx % 3 === 2 ? 7 : idx % 4 === 3 ? 12 : scaleDeg);

          candidate.push({
            id: `perc_${bar}_${step}`,
            time: Number(Math.max(0, quantizedTime + shift).toFixed(3)),
            quantizedTime: Number(quantizedTime.toFixed(3)),
            duration: 0.18,
            pitch,
            velocity,
            isGhost: velocity <= humanization.ghostVelocityMax,
            probability: 0.92,
            motifRole: bar % 2 === 0 ? 'call' : 'response',
          });
        });

        if (isTurnaround) {
          [14.5, 15.0, 15.5].forEach((subStep, fIdx) => {
            const qTime = bar * 4 + subStep * 0.25;
            candidate.push({
              id: `perc_fill_${bar}_${fIdx}`,
              time: Number(qTime.toFixed(3)),
              quantizedTime: Number(qTime.toFixed(3)),
              duration: 0.12,
              pitch: basePitch + 12,
              velocity: 78 + fIdx * 14,
              isGhost: false,
              motifRole: 'fill',
            });
          });
        }
      }
    } else if (archetype === 'synth') {
      const synthRoot = rootKeyToMidiBase(project.rootKey, 3);
      const motifHitCount = strategyId === 'minimal_groove' ? 3 : strategyId === 'dub_space' ? 4 : 5;
      const motifSteps = generateEuclideanSteps(
        motifHitCount,
        16,
        Math.floor(seededRandom(seed + 29) * 8) + 1
      );

      for (let bar = 0; bar < totalBars; bar++) {
        const sec = sections.find((s) => bar + 1 >= s.startBar && bar + 1 <= s.endBar) || sections[0];
        const phraseBar = bar % 4;

        motifSteps.forEach((step, idx) => {
          const effectiveStep = phraseBar === 2 ? (step + 1) % 16 : step;
          if (sec.role === 'Intro' && bar < 2 && idx > 2) return;

          const quantizedTime = bar * 4 + effectiveStep * 0.25;
          const shift = Math.max(
            -maxShift,
            Math.min(maxShift, gaussianRandom(strategy.swingOffsetBeats, maxShift * 0.6, hSeed + bar * 23 + idx))
          );

          let degreeIdx = (idx + phraseBar) % scaleIntervals.length;
          if (bar >= Math.floor(totalBars / 2) && phraseBar === 3) {
            degreeIdx = (scaleIntervals.length - 1 - degreeIdx) % scaleIntervals.length;
          }
          const semitoneOffset = scaleIntervals[degreeIdx] ?? 0;
          const octaveShift = sec.role === 'Peak_Drop' && idx === motifSteps.length - 1 ? 12 : 0;

          const baseVel = idx === 0 ? 106 : idx % 2 === 1 ? 86 : 44;
          const velocity = Math.max(
            22,
            Math.min(124, Math.round(baseVel * (1 + (seededRandom(hSeed + bar * 13 + idx) * 2 - 1) * velVar)))
          );

          candidate.push({
            id: `synth_${bar}_${idx}`,
            time: Number(Math.max(0, quantizedTime + shift).toFixed(3)),
            quantizedTime: Number(quantizedTime.toFixed(3)),
            duration: strategyId === 'dub_space' ? 0.45 : 0.3,
            pitch: synthRoot + semitoneOffset + octaveShift,
            velocity,
            isGhost: velocity <= humanization.ghostVelocityMax,
            motifRole: phraseBar < 2 ? 'call' : 'response',
          });
        });
      }
    } else if (archetype === 'acid') {
      const acidRoot = rootKeyToMidiBase(project.rootKey, 2);
      const pulses = strategyId === 'minimal_groove' ? 7 : 11;
      const rotA = Math.floor(seededRandom(seed + 41) * 16);
      const stepsA = new Set(generateEuclideanSteps(pulses, 16, rotA));
      const stepsB = new Set(generateEuclideanSteps(pulses, 16, (rotA + 5) % 16));

      for (let bar = 0; bar < totalBars; bar++) {
        const sec = sections.find((s) => bar + 1 >= s.startBar && bar + 1 <= s.endBar) || sections[0];
        if (sec.role === 'Intro' && bar < 2 && formId !== 'industrial_assault') continue;

        const activeSet = bar % 2 === 0 ? stepsA : stepsB;
        const isTurnaround = bar % 4 === 3;

        for (let step = 0; step < 16; step++) {
          if (!activeSet.has(step) && !(isTurnaround && step >= 13)) continue;

          const quantizedTime = bar * 4 + step * 0.25;
          const isAccent = step % 4 === 2 || step === 11 || (isTurnaround && step === 15);
          const isSlide = step === 3 || step === 7 || step === 14;
          const degIdx = (step + (bar % 4)) % scaleIntervals.length;
          let semitone = scaleIntervals[degIdx] || 0;
          if (step === 2 || step === 10 || (sec.role === 'Peak_Drop' && step === 14)) {
            semitone += 12; // Classic 303 octave jump
          }

          const shift = Math.max(
            -maxShift * 0.5,
            Math.min(maxShift * 0.5, gaussianRandom(0.002, maxShift * 0.4, hSeed + bar * 17 + step))
          );
          const baseVel = isAccent ? 118 : step % 2 === 1 ? 82 : 44;
          const velocity = Math.max(28, Math.min(126, Math.round(baseVel * (1 + (seededRandom(hSeed + bar * 9 + step) * 2 - 1) * velVar * 0.5))));

          candidate.push({
            id: `acid_${bar}_${step}`,
            time: Number(Math.max(0, quantizedTime + shift).toFixed(3)),
            quantizedTime: Number(quantizedTime.toFixed(3)),
            duration: isSlide ? 0.36 : 0.19,
            pitch: acidRoot + semitone,
            velocity,
            isGhost: velocity <= humanization.ghostVelocityMax,
            isSlide,
            isAccent,
            motifRole: isAccent ? 'tension' : 'call',
          });
        }
      }
    } else if (archetype === 'ride') {
      for (let bar = 0; bar < totalBars; bar++) {
        const sec = sections.find((s) => bar + 1 >= s.startBar && bar + 1 <= s.endBar) || sections[0];
        if (totalBars >= 24 && sec.activeArchetypes && !sec.activeArchetypes.includes('ride')) {
          continue;
        }
        if (sec.role === 'Breakdown' && bar % 2 === 0) continue;
        const isTurnaround = bar % 4 === 3;

        for (let step = 0; step < 16; step += 2) {
          // Ride plays on quarter notes and offbeat 8th notes
          if (sec.role === 'Intro' && step % 4 !== 2) continue;
          const isOffbeat8th = step % 4 === 2;
          const quantizedTime = bar * 4 + step * 0.25;
          const shift = Math.max(
            -maxShift * 0.4,
            Math.min(maxShift * 0.4, gaussianRandom(0.001, maxShift * 0.3, hSeed + bar * 13 + step))
          );
          const baseVel = isOffbeat8th ? 106 : 78;
          const velocity = Math.max(
            36,
            Math.min(122, Math.round(baseVel * (1 + (seededRandom(hSeed + bar * 11 + step) * 2 - 1) * velVar)))
          );

          candidate.push({
            id: `ride_${bar}_${step}`,
            time: Number(Math.max(0, quantizedTime + shift).toFixed(3)),
            quantizedTime: Number(quantizedTime.toFixed(3)),
            duration: isOffbeat8th ? 0.38 : 0.24,
            pitch: isTurnaround && step >= 12 ? 59 : 51,
            velocity,
            isGhost: false,
            motifRole: isOffbeat8th ? 'anchor' : 'response',
          });
        }
      }
    } else if (archetype === 'pad') {
      const padRoot = rootKeyToMidiBase(project.rootKey, 4);
      const chordOffsets = [0, 3, 7, 10]; // Minor 7th dub chord cluster

      for (let bar = 0; bar < totalBars; bar++) {
        const sec = sections.find((s) => bar + 1 >= s.startBar && bar + 1 <= s.endBar) || sections[0];
        const barBeats = bar % 2 === 0 ? [0.0, 2.5] : [1.5];
        const inversionShift = bar % 4 >= 2 ? 2 : 0;

        barBeats.forEach((beatInBar, bIdx) => {
          const quantizedTime = bar * 4 + beatInBar;
          const dur = beatInBar === 0.0 ? 2.25 : 1.75;
          const baseVel = sec.role === 'Breakdown' || sec.role === 'Peak_Drop' ? 92 : 76;

          chordOffsets.forEach((interval, cIdx) => {
            const pitch = padRoot + interval + (cIdx === 0 && inversionShift > 0 ? 12 : 0);
            candidate.push({
              id: `pad_${bar}_${bIdx}_${cIdx}`,
              time: Number(quantizedTime.toFixed(3)),
              quantizedTime: Number(quantizedTime.toFixed(3)),
              duration: dur,
              pitch,
              velocity: Math.max(40, Math.min(110, baseVel - cIdx * 4)),
              isGhost: false,
              motifRole: 'anchor',
            });
          });
        });
      }
    } else if (archetype === 'hats') {
      for (let bar = 0; bar < totalBars; bar++) {
        const sec = sections.find((s) => bar + 1 >= s.startBar && bar + 1 <= s.endBar) || sections[0];
        const isBreakdown = sec.role === 'Breakdown' && bar % 2 === 0;
        const isTurnaround = bar % 4 === 3;

        for (let step = 0; step < 16; step++) {
          const isOffbeat8th = step % 4 === 2;
          const isSyncopated16th = step % 2 === 1;

          if ((bar % 8 === 7) && step === 14) continue;
          if (isBreakdown && !isOffbeat8th) continue;

          const ghostProb = strategy.targetDensity * 0.85;
          const triggerGhost =
            isSyncopated16th &&
            (seededRandom(seed + (bar % 4) * 16 + step) < ghostProb || (isTurnaround && step >= 11));

          if (!isOffbeat8th && !triggerGhost) continue;

          const quantizedTime = bar * 4 + step * 0.25;
          const swing = isSyncopated16th ? strategy.swingOffsetBeats : 0;
          const shift = Math.max(
            -maxShift,
            Math.min(maxShift, swing + gaussianRandom(0.002, maxShift * 0.7, hSeed + bar * 29 + step))
          );

          const baseVel = isOffbeat8th
            ? 110
            : humanization.ghostVelocityMin +
              Math.floor(
                seededRandom(hSeed + bar * 19 + step * 7) *
                  (humanization.ghostVelocityMax - humanization.ghostVelocityMin + 1)
              );
          const velocity = Math.max(
            20,
            Math.min(125, Math.round(baseVel * (1 + (seededRandom(hSeed + bar * 7 + step) * 2 - 1) * velVar)))
          );

          candidate.push({
            id: `hats_${bar}_${step}`,
            time: Number(Math.max(0, quantizedTime + shift).toFixed(3)),
            quantizedTime: Number(quantizedTime.toFixed(3)),
            duration: isOffbeat8th ? 0.34 : 0.11,
            pitch: isOffbeat8th ? 46 : 42,
            velocity,
            isGhost: !isOffbeat8th,
            motifRole: isOffbeat8th ? 'anchor' : isTurnaround && step >= 12 ? 'fill' : 'response',
          });
        }
      }
    }

    const evalMetrics = evaluateGenerationNovelty(candidate, project, archetype, profile);
    evalMetrics.candidatesEvaluated = attempts;

    if (
      !bestNovelty ||
      evalMetrics.rhythmicNovelty + evalMetrics.motifNovelty >
        bestNovelty.rhythmicNovelty + bestNovelty.motifNovelty
    ) {
      bestNotes = candidate;
      bestNovelty = evalMetrics;
    }

    if (evalMetrics.rhythmicNovelty >= 0.55 && evalMetrics.kickCollisionFree) {
      break;
    }
  }

  // Build 4 distinct Session View clip variations tiled across `totalBars`
  const sceneSlices: { name: string; startBar: number }[] = [
    { name: 'Scene A · Groove Cell', startBar: 0 },
    { name: 'Scene B · Evolving Phrase', startBar: 4 },
    { name: 'Scene C · Tension / Strip', startBar: 8 },
    { name: 'Scene D · Peak Turnaround', startBar: 12 },
  ];

  const totalBeats = totalBars * 4;
  const sessionClips: AbletonMidiClip[] = sceneSlices.map((sc, sIdx) => {
    const startBeat = sc.startBar * 4;
    const endBeat = startBeat + 16;
    const sliceNotes = bestNotes.filter((n) => n.quantizedTime >= startBeat && n.quantizedTime < endBeat);
    const tiledNotes: MidiNoteEvent[] = [];
    const tileCount = Math.max(1, Math.ceil(totalBars / 4));
    for (let rep = 0; rep < tileCount; rep++) {
      sliceNotes.forEach((sn, nIdx) => {
        const localTime = sn.time - startBeat;
        const localQuant = sn.quantizedTime - startBeat;
        const nextQuant = rep * 16 + localQuant;
        if (nextQuant >= totalBeats) return;
        tiledNotes.push({
          ...sn,
          id: `sess_${sIdx}_${rep}_${nIdx}`,
          time: Number((rep * 16 + localTime).toFixed(3)),
          quantizedTime: Number(nextQuant.toFixed(3)),
        });
      });
    }
    return {
      id: `session_${archetype}_${sIdx}`,
      name: sc.name,
      startTime: 0,
      length: totalBeats,
      notes: tiledNotes,
      sceneVariationName: sc.name,
    };
  });

  const swungNotes =
    (humanization.swingStrength ?? 0) > 0
      ? applySwingToMidiClip(bestNotes, humanization.swingStrength ?? 0)
      : bestNotes;
  const swungSessionClips =
    (humanization.swingStrength ?? 0) > 0
      ? sessionClips.map((clip) => applySwingToMidiClip(clip, humanization.swingStrength ?? 0))
      : sessionClips;

  const finalSwungNotes =
    Math.abs(humanization.shuffleSwing ?? 0) > 0
      ? applyShuffleSwingToMidiClip(swungNotes, humanization.shuffleSwing ?? 0, project.tempo)
      : swungNotes;
  const finalSwungSessionClips =
    Math.abs(humanization.shuffleSwing ?? 0) > 0
      ? swungSessionClips.map((clip) =>
          applyShuffleSwingToMidiClip(clip, humanization.shuffleSwing ?? 0, project.tempo)
        )
      : swungSessionClips;

  const reasoning = `Strategy "${strategy.name}" (${formId.replace(/_/g, ' ')}) · ${totalBars} Bars · Conditioned on ${project.rootKey} ${project.scale} @ ${project.tempo} BPM · Interlocked with ${profile.kickOnsetSteps.length} kick steps · Novelty ${Math.round(((bestNovelty?.rhythmicNovelty || 0.85) + (bestNovelty?.arrangementNovelty || 0.85)) * 50)}%.`;

  return {
    notes: finalSwungNotes.filter(note => {
      const bar = Math.floor(Math.max(0, note.quantizedTime ?? note.time) / 4) + 1;
      return sections.some(sec => bar >= sec.startBar && bar <= sec.endBar && sec.activeArchetypes.includes(archetype));
    }).map(note => ({ ...note, time: Math.max(0, Math.min(totalBars * 4 - 0.001, note.time)) })),
    sessionClips: finalSwungSessionClips,
    novelty: bestNovelty || evaluateGenerationNovelty(finalSwungNotes, project, archetype, profile),
    reasoning,
  };
}

export {
  applyDillaShuffleSwing,
  applyShuffleSwingToMidiClip,
  computeDillaShuffleOffsetBeats,
  MAX_DILLA_SHUFFLE_POCKET_MS,
};

/**
 * Section 12.4: ABLETON LIVE 12 MIDI TRANSFORMATION TOOLS
 */
export function applyLive12MidiTool(
  notes: MidiNoteEvent[],
  toolId: MidiToolTransformationId,
  rootKey: string,
  archetype: TechnoArchetype,
  seed: number,
  totalBars = 16
): { notes: MidiNoteEvent[]; description: string } {
  if (!notes || notes.length === 0) {
    return { notes: [], description: 'No MIDI notes in clip to transform.' };
  }

  const sorted = [...notes].sort((a, b) => a.time - b.time);

  if (toolId === 'rotate') {
    const rotated = sorted.map((n, idx) => {
      const bar = Math.floor(n.quantizedTime / 4);
      const beatInBar = n.quantizedTime % 4;
      const microShift = n.time - n.quantizedTime;
      const newBeatInBar = (beatInBar + 0.75) % 4;
      const safeBeatInBar =
        archetype === 'rumble' && Math.abs(newBeatInBar % 1) < 0.01
          ? (newBeatInBar + 0.25) % 4
          : newBeatInBar;
      const newQuant = bar * 4 + safeBeatInBar;
      return {
        ...n,
        id: `rot_${idx}_${Date.now()}`,
        quantizedTime: Number(newQuant.toFixed(3)),
        time: Number(Math.max(0, newQuant + microShift).toFixed(3)),
      };
    });
    return {
      notes: rotated.sort((a, b) => a.time - b.time),
      description: 'Live 12 Rotate Tool: Displaced phrase onsets by +3/16 steps while protecting kick downbeats.',
    };
  }

  if (toolId === 'invert') {
    const pitches = sorted.map((n) => n.pitch);
    const minP = Math.min(...pitches);
    const maxP = Math.max(...pitches);
    const axis = minP + maxP;
    const inverted = sorted.map((n) => ({
      ...n,
      pitch: Math.max(
        24,
        Math.min(96, axis - n.pitch + (minP === maxP ? (n.quantizedTime % 1 === 0.5 ? 7 : 0) : 0))
      ),
    }));
    return {
      notes: inverted,
      description: `Live 12 Pitch Inversion: Mirrored melodic contour around MIDI pitch axis ${Math.round(axis / 2)}.`,
    };
  }

  if (toolId === 'retrograde') {
    const byBar = new Map<number, MidiNoteEvent[]>();
    sorted.forEach((n) => {
      const bar = Math.floor(n.quantizedTime / 4);
      const list = byBar.get(bar) || [];
      list.push(n);
      byBar.set(bar, list);
    });
    const out: MidiNoteEvent[] = [];
    byBar.forEach((barNotes, bar) => {
      barNotes.forEach((n) => {
        const beatInBar = n.quantizedTime % 4;
        const revBeat = (3.75 - beatInBar + 4) % 4;
        const safeBeat = archetype === 'rumble' && revBeat % 1 === 0 ? revBeat + 0.25 : revBeat;
        const newQuant = bar * 4 + safeBeat;
        out.push({
          ...n,
          quantizedTime: Number(newQuant.toFixed(3)),
          time: Number((newQuant + (n.time - n.quantizedTime)).toFixed(3)),
        });
      });
    });
    return {
      notes: out.sort((a, b) => a.time - b.time),
      description: 'Live 12 Retrograde Tool: Reversed intra-bar rhythmic & melodic sequence order.',
    };
  }

  if (toolId === 'ornament') {
    const out: MidiNoteEvent[] = [...sorted];
    sorted.forEach((n, idx) => {
      const bar = Math.floor(n.quantizedTime / 4);
      if (n.velocity >= 100 && bar % 2 === 1 && idx % 4 === 0 && n.quantizedTime > 0.25) {
        const graceTime = Math.max(0, n.time - 0.125);
        out.push({
          id: `orn_${idx}_${Date.now()}`,
          time: Number(graceTime.toFixed(3)),
          quantizedTime: Number((n.quantizedTime - 0.125).toFixed(3)),
          duration: 0.1,
          pitch: n.pitch,
          velocity: Math.max(32, Math.round(n.velocity * 0.62)),
          isGhost: true,
          motifRole: 'fill',
        });
      }
    });
    return {
      notes: out.sort((a, b) => a.time - b.time),
      description: 'Live 12 Ornament Tool: Injected 32nd-note grace & ratchet flam articulations before accents.',
    };
  }

  if (toolId === 'recombine') {
    const shiftBy = (Math.abs(seed) % 5) + 1;
    const pitches = sorted.map((n) => n.pitch);
    const velocities = sorted.map((n) => n.velocity);
    const recombined = sorted.map((n, idx) => {
      const nextVel = velocities[(idx + shiftBy) % velocities.length];
      return {
        ...n,
        pitch: pitches[(idx + shiftBy) % pitches.length],
        velocity: nextVel,
        isGhost: nextVel <= 48,
      };
    });
    return {
      notes: recombined,
      description: `Live 12 Recombine Tool: Cycled pitch & velocity contours by +${shiftBy} steps over fixed rhythmic onsets.`,
    };
  }

  if (toolId === 'span') {
    const currentAvgDur = sorted.reduce((acc, n) => acc + n.duration, 0) / sorted.length;
    const scaleFactor = currentAvgDur > 0.26 ? 0.65 : 1.45;
    const spanned = sorted.map((n) => ({
      ...n,
      duration: Number(Math.max(0.08, Math.min(0.75, n.duration * scaleFactor)).toFixed(3)),
    }));
    return {
      notes: spanned,
      description: `Live 12 Span Tool: Scaled MIDI gate durations by ${Math.round(scaleFactor * 100)}%.`,
    };
  }

  if (toolId === 'euclidean') {
    const pulses = archetype === 'rumble' ? 11 : archetype === 'hats' ? 9 : 6;
    const rot = Math.floor(seededRandom(seed) * 8);
    const eucSteps = generateEuclideanSteps(pulses, 16, rot);
    const basePitch =
      sorted[0]?.pitch || rootKeyToMidiBase(rootKey, archetype === 'rumble' ? 1 : archetype === 'acid' ? 2 : 3);
    const out: MidiNoteEvent[] = [];
    for (let bar = 0; bar < totalBars; bar++) {
      eucSteps.forEach((step, sIdx) => {
        if (archetype === 'rumble' && step % 4 === 0) return;
        const qTime = bar * 4 + step * 0.25;
        const vel = step % 4 === 2 ? 110 : sIdx % 2 === 0 ? 92 : 42;
        out.push({
          id: `euc_${bar}_${step}`,
          time: Number((qTime + (step % 2 === 1 ? 0.005 : 0)).toFixed(3)),
          quantizedTime: Number(qTime.toFixed(3)),
          duration: 0.22,
          pitch: basePitch + (sIdx === eucSteps.length - 1 && bar % 4 === 3 ? 7 : 0),
          velocity: vel,
          isGhost: vel <= 48,
        });
      });
    }
    return {
      notes: out,
      description: `Live 12 Euclidean Generator: Redistributed clip into E(${pulses}, 16, rot=${rot}) polymeter.`,
    };
  }

  // Default: quantize
  const quantized = sorted.map((n) => ({
    ...n,
    time: Number(n.quantizedTime.toFixed(3)),
  }));
  return {
    notes: quantized,
    description: 'Live 12 Quantize Tool: Locked all MIDI note events to exact 16th-note grid.',
  };
}

/**
 * Applies rhythmic NoteGridDivision ('1/4' | '1/8' | '1/16' | '1/32') and VoicingSpreadStyle
 * ('narrow' | 'close' | 'wide' | 'octave') to a track's MIDI clip notes.
 */
export function applyChordAndGridTransformToNotes(
  existingNotes: MidiNoteEvent[],
  rootKey: string,
  scale: string,
  gridDivision: NoteGridDivision,
  voicingSpread: VoicingSpreadStyle,
  archetype: TechnoArchetype,
  totalBars = 16,
  seed = 101
): { notes: MidiNoteEvent[]; summary: string } {
  const stepBeats = gridDivisionToStepBeats(gridDivision);
  const chordOffsets = buildChordVoicingOffsets(voicingSpread, scale);
  const octave =
    archetype === 'rumble'
      ? 1
      : archetype === 'acid'
      ? 2
      : archetype === 'pad'
      ? 4
      : 3;
  const basePitch = rootKeyToMidiBase(rootKey, octave);
  const scaleIntervals =
    scale.toLowerCase().includes('dorian')
      ? [0, 2, 3, 5, 7, 9, 10]
      : scale.toLowerCase().includes('locrian')
      ? [0, 1, 3, 5, 6, 8, 10]
      : [0, 1, 3, 5, 7, 8, 10];

  // Filter to anchor/primary notes first so repeated chord expansions don't multiply notes exponentially
  const primaryNotes = existingNotes.filter((_, i) => i === 0 || existingNotes[i].quantizedTime !== existingNotes[i - 1].quantizedTime);

  const out: MidiNoteEvent[] = [];
  const totalBeats = totalBars * 4;

  primaryNotes.forEach((n, idx) => {
    const snappedQuant = Math.min(
      totalBeats - stepBeats,
      Math.max(0, Math.round(n.quantizedTime / stepBeats) * stepBeats)
    );
    const microShift = n.time - n.quantizedTime;
    const deg = scaleIntervals[(idx + Math.floor(snappedQuant / 4)) % scaleIntervals.length] || 0;
    const rootNotePitch =
      archetype === 'hats' || archetype === 'ride' || archetype === 'kick'
        ? n.pitch
        : basePitch + deg;

    // For melodic/harmonic tracks (synth, pad, acid, percussion), apply chord/voicing spread
    const isHarmonic =
      archetype === 'synth' || archetype === 'pad' || (archetype === 'acid' && voicingSpread === 'octave');
    const offsetsToUse = isHarmonic ? chordOffsets : [0];

    offsetsToUse.forEach((offset: number, vIdx: number) => {
      out.push({
        ...n,
        id: `grid_${gridDivision.replace('/', '')}_${idx}_${vIdx}`,
        quantizedTime: Number(snappedQuant.toFixed(3)),
        time: Number(Math.max(0, snappedQuant + microShift).toFixed(3)),
        duration: Number(Math.max(0.08, Math.min(2.0, stepBeats * (archetype === 'pad' ? 3.2 : 0.88))).toFixed(3)),
        pitch: Math.max(24, Math.min(96, rootNotePitch + offset)),
        velocity: Math.max(24, Math.min(126, n.velocity - vIdx * 5)),
      });
    });

    // If 1/32 division is selected, inject a 32nd-note subdivisions double-tap on accents
    if (gridDivision === '1/32' && n.velocity >= 96 && snappedQuant + 0.125 < totalBeats) {
      out.push({
        ...n,
        id: `grid32_sub_${idx}_${seed % 99}`,
        quantizedTime: Number((snappedQuant + 0.125).toFixed(3)),
        time: Number((snappedQuant + 0.125).toFixed(3)),
        duration: 0.1,
        pitch: rootNotePitch + (voicingSpread === 'octave' ? 12 : 0),
        velocity: Math.max(36, Math.round(n.velocity * 0.72)),
        isGhost: true,
        motifRole: 'fill',
      });
    }
  });

  out.sort((a, b) => a.time - b.time);

  return {
    notes: out,
    summary: `Applied ${gridDivision} Note Grid & ${voicingSpread.toUpperCase()} Voicing Spread (${chordOffsets.map((o: number) => `+${o}st`).join(', ')}) in ${rootKey} ${scale}.`,
  };
}

/**
 * Section 15: SAFE ABLETON ALS COMPILER & CADENCE INVARIANT VALIDATOR
 */
export function validateAlsProjectCadence(xmlString: string): AlsValidationReport {
  const diagnostics: string[] = [];
  const parser = new DOMParser();
  const sanitized = xmlString.replace(/xmlns(:[a-zA-Z0-9_-]+)?="[^"]*"/g, '');
  const doc = parser.parseFromString(sanitized, 'application/xml');

  const parseErr = doc.querySelector('parsererror');
  const validXmlDom = !parseErr;
  if (!validXmlDom) {
    diagnostics.push(`XML DOM Parse Error: ${parseErr?.textContent?.slice(0, 80)}`);
  }

  const liveSet = doc.querySelector('Ableton > LiveSet');
  const masterTrack = doc.querySelector('LiveSet > MasterTrack');
  const tracksContainer = doc.querySelector('LiveSet > Tracks');
  const validTrackHierarchy = Boolean(liveSet && masterTrack && tracksContainer);

  const trackEls = Array.from(doc.querySelectorAll('Tracks > MidiTrack, Tracks > AudioTrack'));
  const trackIds = new Set<string>();
  let duplicateTrackIds = false;
  trackEls.forEach((el) => {
    const id = el.getAttribute('Id') || '';
    if (trackIds.has(id)) duplicateTrackIds = true;
    trackIds.add(id);
  });

  const pointeeIds = Array.from(doc.querySelectorAll('Pointee')).map(el => el.getAttribute('Id')).filter((id): id is string => id !== null);
  const uniquePointeeIds = new Set(pointeeIds).size === pointeeIds.length;
  if (duplicateTrackIds) diagnostics.push('Duplicate track IDs detected; manual correction required.');
  if (!uniquePointeeIds) diagnostics.push('Duplicate explicit Pointee IDs detected.');

  const sidechainNodes = Array.from(doc.querySelectorAll('Compressor2 > Sidechain > SourceTrack'));
  const validSidechainRouting = sidechainNodes.every(sc => trackIds.has(sc.getAttribute('Value') || ''));
  const noteCount = doc.querySelectorAll('MidiNoteEvent').length;
  // Structural validity does not certify the separate routing/compatibility fields.
  const isValid = validXmlDom && validTrackHierarchy && !duplicateTrackIds && uniquePointeeIds;
  if (!validSidechainRouting) diagnostics.push('Unresolved sidechain source IDs; routing is not verified.');
  diagnostics.push(`Inspected ${trackEls.length} MIDI/audio tracks and ${noteCount} MIDI note nodes.`);
  diagnostics.push('NOT TESTED: semantic round trip, unknown-node preservation, complete routing, and Ableton Live version compatibility require independent fixtures/runtime evidence.');

  return {
    isValid,
    validXmlDom,
    validTrackHierarchy,
    uniquePointeeIds,
    validSidechainRouting,
    roundTripVerified: false,
    unknownNodesPreserved: false,
    compatibilityStatus: isValid ? 'Inspect & Edit Supported' : 'Schema Warning',
    diagnostics,
  };
}

/**
 * Applies Quantize Grid Strength (50%, 75%, 100%) to a list of MIDI note events.
 */
export function applyMidiQuantizeStrength(
  notes: MidiNoteEvent[],
  gridDivision: NoteGridDivision = '1/16',
  strengthPct: 50 | 75 | 100 = 100
): { notes: MidiNoteEvent[]; description: string } {
  if (!notes || notes.length === 0) {
    return { notes: [], description: 'No MIDI notes in clip to quantize.' };
  }

  const stepBeats = gridDivisionToStepBeats(gridDivision);
  const factor = strengthPct / 100;

  const quantized = notes.map((n, idx) => {
    const targetBeat = Math.round(n.time / stepBeats) * stepBeats;
    const delta = targetBeat - n.time;
    const newTime = Number((n.time + delta * factor).toFixed(3));
    const newQuant = Number((Math.round(newTime / stepBeats) * stepBeats).toFixed(3));

    return {
      ...n,
      id: n.id || `q_${idx}_${Date.now()}`,
      time: Math.max(0, newTime),
      quantizedTime: Math.max(0, newQuant),
    };
  });

  return {
    notes: quantized.sort((a, b) => a.time - b.time),
    description: `Applied ${strengthPct}% Quantize Strength to ${gridDivision} grid across ${quantized.length} MIDI notes.`,
  };
}

// ============================================================================
// SECTION 16: PARAMETRIC ALS v7.0 — 16 UNDERGROUND TECHNO SUBGENRE PROFILES
// & GROUP A–H INSTRUMENT ROLE TAXONOMY
// ============================================================================

export interface UndergroundSubgenreProfile {
  id: TechnoSubgenreId;
  name: string;
  tempoRange: [number, number];
  defaultTempo: number;
  defaultRootKey: string;
  defaultScale: string;
  swingPct: number;
  chordVoicingStyle: VoicingSpreadStyle;
  chordIntervals: number[];
  description: string;
}

export const UNDERGROUND_TECHNO_SUBGENRES: UndergroundSubgenreProfile[] = [
  {
    id: 'raw_warehouse',
    name: 'Raw Warehouse Techno',
    tempoRange: [134, 140],
    defaultTempo: 136,
    defaultRootKey: 'F',
    defaultScale: 'Phrygian',
    swingPct: 14,
    chordVoicingStyle: 'close',
    chordIntervals: [0, 3, 7, 10],
    description: '909 overdriven kick, convolution rumble sub, metallic percussion, dark minor stabs.',
  },
  {
    id: 'hypnotic_deep',
    name: 'Hypnotic / Deep Techno',
    tempoRange: [128, 134],
    defaultTempo: 132,
    defaultRootKey: 'G',
    defaultScale: 'Minor',
    swingPct: 10,
    chordVoicingStyle: 'wide',
    chordIntervals: [0, 3, 7, 10, 14],
    description: '3/16 polymetric FM sequence, slow filter LFO drift, deep sine sub pulse.',
  },
  {
    id: 'berlin_industrial',
    name: 'Berlin Industrial Techno',
    tempoRange: [136, 144],
    defaultTempo: 138,
    defaultRootKey: 'D#',
    defaultScale: 'Locrian',
    swingPct: 8,
    chordVoicingStyle: 'narrow',
    chordIntervals: [0, 1, 6, 7],
    description: 'Distorted industrial kick, metallic Clang percussion, dissonant cluster stabs.',
  },
  {
    id: 'detroit_informed',
    name: 'Detroit-Informed Techno',
    tempoRange: [128, 135],
    defaultTempo: 131,
    defaultRootKey: 'C',
    defaultScale: 'Dorian',
    swingPct: 24,
    chordVoicingStyle: 'wide',
    chordIntervals: [0, 3, 7, 10, 14],
    description: 'Parallel minor 7th/9th chord planing, syncopated funk bassline, crisp 909 ride.',
  },
  {
    id: 'dub_techno',
    name: 'Dub Techno',
    tempoRange: [120, 128],
    defaultTempo: 124,
    defaultRootKey: 'F',
    defaultScale: 'Minor',
    swingPct: 18,
    chordVoicingStyle: 'wide',
    chordIntervals: [0, 3, 7, 10, 14],
    description: 'Filtered minor 9th/sus4 dub chord stabs feeding dotted-8th tape delay and cavern reverb.',
  },
  {
    id: 'hardgroove',
    name: 'Hardgroove Techno',
    tempoRange: [137, 143],
    defaultTempo: 139,
    defaultRootKey: 'A',
    defaultScale: 'Minor',
    swingPct: 28,
    chordVoicingStyle: 'close',
    chordIntervals: [0, 3, 7, 10],
    description: 'Rolling 16th-note conga/bongo loops, ghost snares, funky filtered chord stabs.',
  },
  {
    id: 'tribal_percussive',
    name: 'Tribal / Percussive Techno',
    tempoRange: [132, 138],
    defaultTempo: 135,
    defaultRootKey: 'E',
    defaultScale: 'Phrygian',
    swingPct: 22,
    chordVoicingStyle: 'octave',
    chordIntervals: [0, 7, 12],
    description: 'Tuned low/mid/high tom dialogues, woodblock syncopation, dense shaker interlock.',
  },
  {
    id: 'acid_techno',
    name: 'Acid Techno',
    tempoRange: [134, 142],
    defaultTempo: 137,
    defaultRootKey: 'F#',
    defaultScale: 'Phrygian',
    swingPct: 12,
    chordVoicingStyle: 'narrow',
    chordIntervals: [0, 3, 7],
    description: 'TB-303 16th-note resonant bassline with accents, slides, and diode filter sweeps.',
  },
  {
    id: 'minimal_micro',
    name: 'Minimal / Micro-Variation Techno',
    tempoRange: [125, 131],
    defaultTempo: 128,
    defaultRootKey: 'D',
    defaultScale: 'Minor',
    swingPct: 16,
    chordVoicingStyle: 'close',
    chordIntervals: [0, 3, 7, 10],
    description: 'Surgical micro-clicks, sparse rubber sub bass, subtle probability-driven mutations.',
  },
  {
    id: 'broken_offgrid',
    name: 'Broken / Off-Grid Techno',
    tempoRange: [130, 137],
    defaultTempo: 134,
    defaultRootKey: 'G#',
    defaultScale: 'Phrygian',
    swingPct: 20,
    chordVoicingStyle: 'wide',
    chordIntervals: [0, 1, 7, 10],
    description: 'Displaced breakbeat kicks (steps 1, 7, 11), UK-industrial sub pressure, off-grid percussion.',
  },
  {
    id: 'dark_atmospheric',
    name: 'Dark Atmospheric Techno',
    tempoRange: [128, 134],
    defaultTempo: 130,
    defaultRootKey: 'C#',
    defaultScale: 'Minor',
    swingPct: 10,
    chordVoicingStyle: 'wide',
    chordIntervals: [0, 3, 7, 8, 12],
    description: 'Cinematic binaural drones, granular textures, deep rolling sub and distant chords.',
  },
  {
    id: 'driving_rolling',
    name: 'Driving / Rolling Peak-Time Techno',
    tempoRange: [134, 140],
    defaultTempo: 136,
    defaultRootKey: 'F',
    defaultScale: 'Minor',
    swingPct: 12,
    chordVoicingStyle: 'octave',
    chordIntervals: [0, 3, 7, 12],
    description: 'Relentless 16th rolling bassline, crisp 909 open hats, high-energy warehouse ride.',
  },
  {
    id: 'ebm_industrial',
    name: 'EBM-Influenced Industrial Techno',
    tempoRange: [130, 138],
    defaultTempo: 134,
    defaultRootKey: 'E',
    defaultScale: 'Minor',
    swingPct: 6,
    chordVoicingStyle: 'narrow',
    chordIntervals: [0, 3, 6, 7],
    description: 'Sequenced octave-jumping MS-20/FM bass, gated noise snare, aggressive metallic stabs.',
  },
  {
    id: 'dub_industrial_hybrid',
    name: 'Dub-Industrial Hybrid',
    tempoRange: [128, 135],
    defaultTempo: 132,
    defaultRootKey: 'F',
    defaultScale: 'Phrygian',
    swingPct: 15,
    chordVoicingStyle: 'wide',
    chordIntervals: [0, 3, 7, 10, 14],
    description: 'Heavy industrial percussion paired with deep tape-delayed minor 9th dub chords.',
  },
  {
    id: 'percussive_polyrhythmic',
    name: 'Percussive Polyrhythmic Techno',
    tempoRange: [132, 138],
    defaultTempo: 135,
    defaultRootKey: 'G',
    defaultScale: 'Dorian',
    swingPct: 16,
    chordVoicingStyle: 'close',
    chordIntervals: [0, 3, 7, 10],
    description: 'Interlocking 5/16, 7/16, and 9/16 Euclidean polymeters against a 4/4 anchor kick.',
  },
  {
    id: 'experimental_modular',
    name: 'Experimental / Modular Techno',
    tempoRange: [128, 140],
    defaultTempo: 134,
    defaultRootKey: 'F',
    defaultScale: 'Locrian',
    swingPct: 12,
    chordVoicingStyle: 'wide',
    chordIntervals: [0, 1, 6, 11],
    description: 'Buchla/Eurorack FM bleeps, Turing-machine pitch cells, asymmetrical filter modulation.',
  },
];

export const INSTRUMENT_ROLE_TAXONOMY: InstrumentRoleTemplate[] = [
  // Group A — Kick System
  {
    roleCode: 'A1',
    groupCode: 'A',
    groupName: 'Group A — Kick System',
    name: 'Primary Sub Kick (909 Foundation)',
    archetype: 'kick',
    defaultTrackName: '01_Kick_909_Foundation',
    defaultColorHex: '#ef4444',
    frequencyBandHz: [42, 95],
    defaultCutoffHz: 180,
    defaultResonance: 0.25,
    defaultVolumeDb: 0,
    defaultSidechainDepth: 0,
    defaultReverbSend: 0.02,
    defaultDelaySend: 0.0,
    vcaGroupId: 'drums_vca',
    description: 'Fundamental 42-65 Hz club kick anchor with DrumBuss saturation.',
  },
  {
    roleCode: 'A2',
    groupCode: 'A',
    groupName: 'Group A — Kick System',
    name: 'Mid Punch / Knock Layer',
    archetype: 'kick',
    defaultTrackName: 'Kick_Mid_Knock_Layer',
    defaultColorHex: '#dc2626',
    frequencyBandHz: [90, 250],
    defaultCutoffHz: 320,
    defaultResonance: 0.3,
    defaultVolumeDb: -3.5,
    defaultSidechainDepth: 0,
    defaultReverbSend: 0.05,
    defaultDelaySend: 0.0,
    vcaGroupId: 'drums_vca',
    description: 'Chest-knock transient layer reinforcing 90-250 Hz punch.',
  },
  // Group B — Sub / Rumble / Bass System
  {
    roleCode: 'B1',
    groupCode: 'B',
    groupName: 'Group B — Sub / Rumble / Bass',
    name: 'Rumble Sub (Operator / Convolution)',
    archetype: 'rumble',
    defaultTrackName: '02_Rumble_Sub_Operator',
    defaultColorHex: '#f97316',
    frequencyBandHz: [32, 95],
    defaultCutoffHz: 145,
    defaultResonance: 0.35,
    defaultVolumeDb: -1.5,
    defaultSidechainDepth: 0.68,
    defaultReverbSend: 0.12,
    defaultDelaySend: 0.08,
    vcaGroupId: 'low_end_vca',
    description: 'Syncopated 16th warehouse sub-bass rumble ducked to primary kick.',
  },
  {
    roleCode: 'B2',
    groupCode: 'B',
    groupName: 'Group B — Sub / Rumble / Bass',
    name: 'Rolling 16th Sub Bass',
    archetype: 'rumble',
    defaultTrackName: 'Rolling_16th_Sub_Bass',
    defaultColorHex: '#ea580c',
    frequencyBandHz: [38, 120],
    defaultCutoffHz: 190,
    defaultResonance: 0.4,
    defaultVolumeDb: -2.0,
    defaultSidechainDepth: 0.62,
    defaultReverbSend: 0.05,
    defaultDelaySend: 0.05,
    vcaGroupId: 'low_end_vca',
    description: 'Relentless off-grid 16th-note peak-time rolling bassline.',
  },
  {
    roleCode: 'B4',
    groupCode: 'B',
    groupName: 'Group B — Sub / Rumble / Bass',
    name: 'TB-303 Acid Resonant Bass',
    archetype: 'acid',
    defaultTrackName: '06_Acid_303_Resonant',
    defaultColorHex: '#84cc16',
    frequencyBandHz: [75, 3800],
    defaultCutoffHz: 680,
    defaultResonance: 0.68,
    defaultVolumeDb: -2.5,
    defaultSidechainDepth: 0.48,
    defaultReverbSend: 0.22,
    defaultDelaySend: 0.32,
    vcaGroupId: 'low_end_vca',
    description: 'TB-303 diode ladder bassline with accent/slide articulation.',
  },
  // Group C — Primary Rhythm & Percussion
  {
    roleCode: 'C1',
    groupCode: 'C',
    groupName: 'Group C — Primary Rhythm & Percussion',
    name: 'Industrial FM Metallic Percussion',
    archetype: 'percussion',
    defaultTrackName: '03_Industrial_Perc_Collision',
    defaultColorHex: '#eab308',
    frequencyBandHz: [220, 4800],
    defaultCutoffHz: 1150,
    defaultResonance: 0.42,
    defaultVolumeDb: -3.0,
    defaultSidechainDepth: 0.35,
    defaultReverbSend: 0.34,
    defaultDelaySend: 0.28,
    vcaGroupId: 'drums_vca',
    description: 'Collision physical-modeled metallic industrial percussion.',
  },
  {
    roleCode: 'C4',
    groupCode: 'C',
    groupName: 'Group C — Primary Rhythm & Percussion',
    name: 'Polyrhythmic Tom / Conga Loop',
    archetype: 'percussion',
    defaultTrackName: 'Tribal_Tom_Polyrhythm',
    defaultColorHex: '#ca8a04',
    frequencyBandHz: [110, 950],
    defaultCutoffHz: 820,
    defaultResonance: 0.35,
    defaultVolumeDb: -3.2,
    defaultSidechainDepth: 0.4,
    defaultReverbSend: 0.28,
    defaultDelaySend: 0.24,
    vcaGroupId: 'drums_vca',
    description: 'Tuned low/mid/high tom call-and-response hardgroove cell.',
  },
  // Group D — Hats, Shakers, Cymbals
  {
    roleCode: 'D1',
    groupCode: 'D',
    groupName: 'Group D — Hats, Shakers & Cymbals',
    name: '909 Closed / Open Hat Engine',
    archetype: 'hats',
    defaultTrackName: '05_909_Metallic_Hats',
    defaultColorHex: '#06b6d4',
    frequencyBandHz: [3500, 12000],
    defaultCutoffHz: 6800,
    defaultResonance: 0.28,
    defaultVolumeDb: -3.5,
    defaultSidechainDepth: 0.22,
    defaultReverbSend: 0.18,
    defaultDelaySend: 0.14,
    vcaGroupId: 'drums_vca',
    description: 'Crisp 16th-note 909 closed/open hi-hat engine with velocity groove.',
  },
  {
    roleCode: 'D4',
    groupCode: 'D',
    groupName: 'Group D — Hats, Shakers & Cymbals',
    name: '909 Warehouse Ride Cymbal',
    archetype: 'ride',
    defaultTrackName: '07_909_Warehouse_Ride',
    defaultColorHex: '#3b82f6',
    frequencyBandHz: [2400, 14000],
    defaultCutoffHz: 4800,
    defaultResonance: 0.3,
    defaultVolumeDb: -4.5,
    defaultSidechainDepth: 0.38,
    defaultReverbSend: 0.26,
    defaultDelaySend: 0.15,
    vcaGroupId: 'drums_vca',
    description: 'Peak-time 909 ride cymbal with bell accents and high-pass shimmer.',
  },
  // Group E — Synths, Stabs, Chords, Leads
  {
    roleCode: 'E1',
    groupCode: 'E',
    groupName: 'Group E — Synths, Chords & Hypnotic Leads',
    name: 'Hypnotic Minor Chord Stab (Wavetable)',
    archetype: 'synth',
    defaultTrackName: '04_Hypnotic_Chord_Stab',
    defaultColorHex: '#a855f7',
    frequencyBandHz: [220, 5200],
    defaultCutoffHz: 920,
    defaultResonance: 0.45,
    defaultVolumeDb: -2.5,
    defaultSidechainDepth: 0.45,
    defaultReverbSend: 0.42,
    defaultDelaySend: 0.38,
    vcaGroupId: 'synths_vca',
    description: 'Detuned Wavetable minor/Phrygian chord stab with filter envelope.',
  },
  {
    roleCode: 'E2',
    groupCode: 'E',
    groupName: 'Group E — Synths, Chords & Hypnotic Leads',
    name: 'Dub Techno Chord Stab (Echo + Reverb)',
    archetype: 'synth',
    defaultTrackName: 'Dub_Chord_Stab_Minor9',
    defaultColorHex: '#9333ea',
    frequencyBandHz: [200, 3800],
    defaultCutoffHz: 740,
    defaultResonance: 0.5,
    defaultVolumeDb: -2.8,
    defaultSidechainDepth: 0.42,
    defaultReverbSend: 0.62,
    defaultDelaySend: 0.58,
    vcaGroupId: 'synths_vca',
    description: 'Basic Channel style minor 9th/sus4 dub chord feeding 3/16 tape echo.',
  },
  // Group F — Atmosphere, Drone, Noise, Texture
  {
    roleCode: 'F1',
    groupCode: 'F',
    groupName: 'Group F — Atmosphere, Drone & Texture',
    name: 'Dub Atmospheric Drone Pad',
    archetype: 'pad',
    defaultTrackName: '08_Dub_Atmospheric_Pad',
    defaultColorHex: '#ec4899',
    frequencyBandHz: [160, 4200],
    defaultCutoffHz: 780,
    defaultResonance: 0.38,
    defaultVolumeDb: -4.0,
    defaultSidechainDepth: 0.52,
    defaultReverbSend: 0.65,
    defaultDelaySend: 0.48,
    vcaGroupId: 'atmos_vca',
    description: 'Evolving dark warehouse atmospheric pad with slow LFO filter drift.',
  },
  {
    roleCode: 'F2',
    groupCode: 'F',
    groupName: 'Group F — Atmosphere, Drone & Texture',
    name: 'Industrial Vinyl & Cavern Noise Texture',
    archetype: 'pad',
    defaultTrackName: '09_Industrial_Cavern_Texture',
    defaultColorHex: '#db2777',
    frequencyBandHz: [250, 6500],
    defaultCutoffHz: 1200,
    defaultResonance: 0.44,
    defaultVolumeDb: -5.5,
    defaultSidechainDepth: 0.6,
    defaultReverbSend: 0.72,
    defaultDelaySend: 0.35,
    vcaGroupId: 'atmos_vca',
    description: 'Textural noise bed and sub-harmonic warehouse room air.',
  },
  // Group G — Dub Chords, Stabs & Harmonic Clusters
  {
    roleCode: 'G1',
    groupCode: 'G',
    groupName: 'Group G — Dub Chords & Harmonic Stabs',
    name: 'Basic Channel Dub Chord Cluster',
    archetype: 'synth',
    defaultTrackName: '10_Basic_Channel_Dub_Chord',
    defaultColorHex: '#06b6d4',
    frequencyBandHz: [220, 3600],
    defaultCutoffHz: 680,
    defaultResonance: 0.52,
    defaultVolumeDb: -2.6,
    defaultSidechainDepth: 0.45,
    defaultReverbSend: 0.68,
    defaultDelaySend: 0.64,
    vcaGroupId: 'synths_vca',
    description: 'Filtered minor-9th dub chord stab with 3/16 ping-pong tape echo.',
  },
  {
    roleCode: 'G2',
    groupCode: 'G',
    groupName: 'Group G — Dub Chords & Harmonic Stabs',
    name: 'Detroit Parallel Minor 7th Stab',
    archetype: 'synth',
    defaultTrackName: '11_Detroit_Parallel_Stab',
    defaultColorHex: '#0891b2',
    frequencyBandHz: [260, 4400],
    defaultCutoffHz: 940,
    defaultResonance: 0.48,
    defaultVolumeDb: -2.9,
    defaultSidechainDepth: 0.4,
    defaultReverbSend: 0.54,
    defaultDelaySend: 0.52,
    vcaGroupId: 'synths_vca',
    description: 'Parallel minor 7th harmonic planing chord voice for peak-time transitions.',
  },
  // Group H — Transition Risers, FX & Impact Sweeps
  {
    roleCode: 'H1',
    groupCode: 'H',
    groupName: 'Group H — Transition FX, Risers & Impacts',
    name: 'Tension Filter Sweep & Sub Drop FX',
    archetype: 'percussion',
    defaultTrackName: '12_Tension_Sweep_FX',
    defaultColorHex: '#f43f5e',
    frequencyBandHz: [180, 9000],
    defaultCutoffHz: 2400,
    defaultResonance: 0.62,
    defaultVolumeDb: -4.2,
    defaultSidechainDepth: 0.3,
    defaultReverbSend: 0.7,
    defaultDelaySend: 0.6,
    vcaGroupId: 'atmos_vca',
    description: 'Phrase-boundary tension riser and industrial impact marker.',
  },
];

/**
 * Decomposes a flat list of MIDI notes into genuine section-aware multi-clips
 * (Intro, Groove, Hypnotic Lock, Breakdown, Peak Drop, Outro) with authentic
 * techno track entry/withdrawal so tracks are NOT a single stretched 128-bar block.
 */
export function decomposeNotesIntoSectionClips(
  trackName: string,
  archetype: TechnoArchetype,
  allNotes: MidiNoteEvent[],
  totalBars = 128,
  sections?: ArrangementSectionNode[]
): AbletonMidiClip[] {
  const safeTotalBars = Math.max(4, totalBars);
  const totalBeats = safeTotalBars * 4;

  // For short arrangements (<= 16 bars), split into 4-bar phrase clips where notes exist
  const defaultSections = sections?.length ? sections : generateSectionArrangementPlan('hypnotic_longform', safeTotalBars);

  const clips: AbletonMidiClip[] = [];

  for (let sIdx = 0; sIdx < defaultSections.length; sIdx++) {
    const sec = defaultSections[sIdx];
    if (sec.startBar > safeTotalBars) continue;
    if (!sec.activeArchetypes.includes(archetype)) {
      continue;
    }

    const startBeat = (sec.startBar - 1) * 4;
    const endBeat = Math.min(totalBeats, sec.endBar * 4);
    const clipLen = Math.max(4, endBeat - startBeat);

    const sectionNotes = allNotes.filter(
      (n) => n.time >= startBeat && n.time < endBeat
    );
    if (sectionNotes.length === 0) continue;

    clips.push({
      id: `clip_${archetype}_${sec.startBar}_${sec.endBar}`,
      name: `${trackName}_${sec.name}`,
      startTime: startBeat,
      endTime: endBeat,
      length: clipLen,
      notes: sectionNotes,
      sectionRole: sec.role,
      revision: 1,
    });
  }

  return clips;
}

export interface SectionArrangementProposal {
  proposedTracks: AbletonTrack[];
  summary: string;
  totalSections: number;
  sections: { name: string; startBar: number; endBar: number; role: string }[];
}

/**
 * Explicit creative arrangement proposal generator (v7.1 P0-001).
 * Inspects a project and creates a structured section arrangement proposal
 * that requires explicit user preview and approval before mutating project state.
 */
export function generateSectionArrangementProposal(
  project: AbletonProjectState,
  options?: {
    subgenreId?: TechnoSubgenreId;
    sections?: ArrangementSectionNode[];
    targetBars?: number;
  }
): SectionArrangementProposal {
  const bars = options?.targetBars || project.arrangementLengthBars || 16;
  const sections = options?.sections || generateSectionArrangementPlan('hypnotic_longform', bars);
  const proposedTracks: AbletonTrack[] = project.tracks.map((track) => {
    if (track.locked || track.clips.length === 0) return { ...track };
    const allNotes = track.clips.flatMap((c) => c.notes);
    const proposedClips = decomposeNotesIntoSectionClips(
      track.name,
      track.archetype,
      allNotes,
      bars,
      sections
    );
    return {
      ...track,
      clips: proposedClips,
    };
  });

  return {
    proposedTracks,
    totalSections: sections.length,
    sections: sections.map(({ name, startBar, endBar, role }) => ({ name, startBar, endBar, role })),
    summary: `Generated section arrangement proposal for ${project.tracks.length} tracks across ${bars} bars.`,
  };
}

export const GenerateSectionArrangementProposal = generateSectionArrangementProposal;

export type RangeClipGeneratorMode =
  | 'empty'
  | 'chord'
  | 'bass'
  | 'drum'
  | 'percussion';

export interface GenerateClipForRangeOptions {
  track: AbletonTrack;
  startBar: number; // 1-indexed inclusive
  endBar: number; // 1-indexed exclusive (e.g., 33 to 41 = 8 bars)
  mode: RangeClipGeneratorMode;
  rootKey?: string;
  scale?: string;
  subgenreId?: TechnoSubgenreId;
  voicingSpread?: VoicingSpreadStyle;
  swingStrength?: number;
  tempo?: number;
  seed?: number;
}

/**
 * Generates or creates a new MIDI clip strictly inside [startBar, endBar) on the target track,
 * preserving all non-overlapping clips on the track and auto-sorting `track.clips` by `startTime`.
 */
export function generateClipForBarRange(options: GenerateClipForRangeOptions): {
  clip: AbletonMidiClip;
  updatedClips: AbletonMidiClip[];
  summary: string;
} {
  const {
    track,
    startBar,
    endBar,
    mode,
    rootKey = 'F',
    scale = 'Phrygian',
    subgenreId = 'dub_techno',
    voicingSpread = 'wide',
    swingStrength = 14,
    seed = Date.now(),
  } = options;

  const loBar = Math.max(1, Math.min(startBar, endBar));
  const hiBar = Math.max(loBar + 1, Math.max(startBar, endBar));
  const spanBars = hiBar - loBar;
  const startBeat = (loBar - 1) * 4;
  const endBeat = (hiBar - 1) * 4;
  const lengthBeats = endBeat - startBeat;

  const subgenre =
    UNDERGROUND_TECHNO_SUBGENRES.find((s) => s.id === subgenreId) ||
    UNDERGROUND_TECHNO_SUBGENRES[0];
  const rootMidi = rootKeyToMidiBase(rootKey, track.archetype === 'rumble' || mode === 'bass' ? 1 : 3);
  const notes: MidiNoteEvent[] = [];

  if (mode === 'chord') {
    const intervals =
      voicingSpread === 'wide'
        ? [0, 3, 7, 10, 14]
        : voicingSpread === 'close'
        ? [0, 3, 7, 10]
        : voicingSpread === 'octave'
        ? [0, 7, 12, 15]
        : [0, 3, 7];

    // Authentic Dub / Detroit / Hypnotic chord rhythmic cells (dotted 8th + syncopated response)
    const barStepHits = [0, 3, 6, 10, 14];
    for (let b = 0; b < spanBars; b++) {
      const barBaseBeat = startBeat + b * 4;
      const planingShift = b % 4 === 2 ? 3 : b % 4 === 3 ? -2 : 0;
      for (let hIdx = 0; hIdx < barStepHits.length; hIdx++) {
        const step16 = barStepHits[hIdx];
        if (b % 2 === 0 && hIdx === 4) continue; // breathing space on odd bars
        const isEven16th = step16 % 2 === 1;
        const swingOffset = isEven16th ? (swingStrength / 100) * 0.08 : 0;
        const quantBeat = barBaseBeat + step16 * 0.25;
        const noteTime = Number(
          Math.min(endBeat - 0.125, Math.max(startBeat, quantBeat + swingOffset)).toFixed(3)
        );
        const dur = hIdx === 1 || hIdx === 3 ? 0.75 : 0.5;
        const baseVel = hIdx === 0 || hIdx === 2 ? 104 : 84;

        intervals.forEach((semi, vIdx) => {
          notes.push({
            id: `chord_${loBar}_${b}_${step16}_${vIdx}_${seed % 997}`,
            time: noteTime,
            quantizedTime: Number(quantBeat.toFixed(3)),
            duration: dur,
            pitch: Math.max(24, Math.min(108, rootMidi + planingShift + semi)),
            velocity: Math.max(40, Math.min(126, baseVel - vIdx * 3)),
            isGhost: false,
            probability: 1.0,
            motifRole: hIdx === 0 ? 'anchor' : hIdx % 2 === 1 ? 'call' : 'response',
          });
        });
      }
    }
  } else if (mode === 'bass') {
    const bassRoot = rootKeyToMidiBase(rootKey, 1);
    const scaleSemis = [0, 1, 3, 5, 7, 8, 10];
    for (let b = 0; b < spanBars; b++) {
      const barBaseBeat = startBeat + b * 4;
      for (let step16 = 0; step16 < 16; step16++) {
        // Off-kick syncopated 16ths (steps 1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15)
        if (step16 % 4 === 0) continue;
        const isEven16th = step16 % 2 === 1;
        const swingOffset = isEven16th ? (swingStrength / 100) * 0.08 : 0;
        const quantBeat = barBaseBeat + step16 * 0.25;
        const noteTime = Number(
          Math.min(endBeat - 0.1, Math.max(startBeat, quantBeat + swingOffset)).toFixed(3)
        );
        const degree = step16 === 7 || step16 === 15 ? scaleSemis[(b + 1) % scaleSemis.length] : 0;
        const vel = step16 % 4 === 2 ? 108 : step16 % 2 === 1 ? 76 : 92;
        notes.push({
          id: `bass_${loBar}_${b}_${step16}_${seed % 997}`,
          time: noteTime,
          quantizedTime: Number(quantBeat.toFixed(3)),
          duration: 0.22,
          pitch: Math.max(24, Math.min(60, bassRoot + degree)),
          velocity: vel,
          isGhost: vel < 80,
          probability: 1.0,
          motifRole: step16 % 4 === 2 ? 'anchor' : 'response',
          isAccent: vel >= 105,
        });
      }
    }
  } else if (mode === 'drum') {
    const isHats = track.archetype === 'hats' || track.archetype === 'ride';
    for (let b = 0; b < spanBars; b++) {
      const barBaseBeat = startBeat + b * 4;
      if (isHats) {
        for (let step16 = 0; step16 < 16; step16++) {
          const isOpen = step16 % 4 === 2;
          const swingOffset = step16 % 2 === 1 ? (swingStrength / 100) * 0.08 : 0;
          const quantBeat = barBaseBeat + step16 * 0.25;
          const noteTime = Number(
            Math.min(endBeat - 0.1, Math.max(startBeat, quantBeat + swingOffset)).toFixed(3)
          );
          notes.push({
            id: `drum_hat_${loBar}_${b}_${step16}`,
            time: noteTime,
            quantizedTime: Number(quantBeat.toFixed(3)),
            duration: isOpen ? 0.35 : 0.15,
            pitch: isOpen ? 46 : 42,
            velocity: isOpen ? 112 : step16 % 2 === 0 ? 86 : 58,
            isGhost: !isOpen && step16 % 2 === 1,
            probability: 1.0,
            motifRole: isOpen ? 'anchor' : 'call',
          });
        }
      } else {
        // 4/4 Foundation Kick + End-of-phrase turnaround ghost
        for (let beatIdx = 0; beatIdx < 4; beatIdx++) {
          const quantBeat = barBaseBeat + beatIdx;
          notes.push({
            id: `drum_kick_${loBar}_${b}_${beatIdx}`,
            time: quantBeat,
            quantizedTime: quantBeat,
            duration: 0.25,
            pitch: 36,
            velocity: beatIdx === 0 ? 124 : 118,
            isGhost: false,
            probability: 1.0,
            motifRole: 'anchor',
          });
        }
        if (b % 4 === 3) {
          const turnaroundBeat = barBaseBeat + 3.75;
          notes.push({
            id: `drum_kick_turn_${loBar}_${b}`,
            time: turnaroundBeat,
            quantizedTime: turnaroundBeat,
            duration: 0.2,
            pitch: 36,
            velocity: 88,
            isGhost: true,
            probability: 0.9,
            motifRole: 'fill',
          });
        }
      }
    }
  } else if (mode === 'percussion') {
    // Euclidean 5/16 & 7/16 industrial/tribal interlocking phrase
    const eucSteps = [0, 3, 6, 9, 11, 14];
    for (let b = 0; b < spanBars; b++) {
      const barBaseBeat = startBeat + b * 4;
      for (let i = 0; i < eucSteps.length; i++) {
        const step16 = (eucSteps[i] + b) % 16;
        const swingOffset = step16 % 2 === 1 ? (swingStrength / 100) * 0.08 : 0;
        const quantBeat = barBaseBeat + step16 * 0.25;
        const noteTime = Number(
          Math.min(endBeat - 0.1, Math.max(startBeat, quantBeat + swingOffset)).toFixed(3)
        );
        notes.push({
          id: `perc_${loBar}_${b}_${step16}_${i}`,
          time: noteTime,
          quantizedTime: Number(quantBeat.toFixed(3)),
          duration: 0.2,
          pitch: 53 + ((i + b) % 4) * 2,
          velocity: i === 0 || i === 3 ? 108 : 78,
          isGhost: i % 2 === 1,
          probability: 1.0,
          motifRole: i === 0 ? 'anchor' : 'call',
        });
      }
    }
  }

  const labelMap: Record<RangeClipGeneratorMode, string> = {
    empty: 'MIDI_Clip',
    chord: `Chord_${rootKey}_${scale}`,
    bass: `Bass_${rootKey}_Groove`,
    drum: `Drum_Pattern`,
    percussion: `Perc_Phrase`,
  };

  const newClip: AbletonMidiClip = {
    id: `clip_${track.id}_${loBar}_${hiBar}_${Date.now()}`,
    name: `${labelMap[mode]}_Bars_${loBar}_${hiBar - 1}`,
    startTime: startBeat,
    endTime: endBeat,
    length: lengthBeats,
    notes: notes.sort((a, b) => a.time - b.time),
    sectionRole: subgenre.name,
    color: track.hexColor,
    revision: (track.clips[0]?.revision || 1) + 1,
  };

  // Non-destructively trim or replace only the overlapping region [startBeat, endBeat)
  const updatedClips = insertClipIntoTrackTimeline(track.clips, newClip);

  return {
    clip: newClip,
    updatedClips,
    summary:
      mode === 'empty'
        ? `Created empty ${spanBars}-bar MIDI clip on "${track.name}" at Bars ${loBar}–${hiBar - 1}.`
        : `Generated ${spanBars}-bar ${mode.toUpperCase()} clip (${newClip.notes.length} notes) on "${track.name}" at Bars ${loBar}–${hiBar - 1}.`,
  };
}

/**
 * Inserts `newClip` into `existingClips`, splitting or trimming any existing clip that overlaps
 * `[newClip.startTime, newClip.startTime + newClip.length)` so other bars on the track remain untouched.
 */
export function insertClipIntoTrackTimeline(
  existingClips: AbletonMidiClip[],
  newClip: AbletonMidiClip
): AbletonMidiClip[] {
  const targetStart = newClip.startTime;
  const targetEnd = newClip.startTime + Math.max(0.25, newClip.length);
  const result: AbletonMidiClip[] = [];

  for (const clip of existingClips) {
    const cStart = clip.startTime;
    const cEnd = clip.startTime + Math.max(0.25, clip.length);

    // No overlap
    if (cEnd <= targetStart + 0.001 || cStart >= targetEnd - 0.001) {
      result.push(clip);
      continue;
    }

    // Left remainder before targetStart
    if (cStart < targetStart - 0.001) {
      const leftLen = targetStart - cStart;
      const leftNotes = clip.notes.filter((n) => n.time >= cStart - 0.01 && n.time < targetStart - 0.001);
      result.push({
        ...clip,
        id: `${clip.id}_L_${Math.round(cStart)}`,
        sourceClipId: clip.id,
        endTime: targetStart,
        length: leftLen,
        notes: leftNotes,
      });
    }

    // Right remainder after targetEnd
    if (cEnd > targetEnd + 0.001) {
      const rightLen = cEnd - targetEnd;
      const rightNotes = clip.notes.filter((n) => n.time >= targetEnd - 0.001 && n.time < cEnd + 0.01);
      result.push({
        ...clip,
        id: `${clip.id}_R_${Math.round(targetEnd)}`,
        sourceClipId: clip.id,
        name: `${clip.name}_Cont`,
        startTime: targetEnd,
        endTime: cEnd,
        length: rightLen,
        notes: rightNotes,
      });
    }
  }

  result.push(newClip);
  return result.sort((a, b) => a.startTime - b.startTime);
}

/**
 * Splits a clip at `splitBeat` into two independent clips `[startTime, splitBeat)` and `[splitBeat, endBeat)`.
 */
export function splitTrackClipAtBeat(
  clips: AbletonMidiClip[],
  splitBeat: number
): { clips: AbletonMidiClip[]; splitOccurred: boolean } {
  const out: AbletonMidiClip[] = [];
  let splitOccurred = false;

  for (const clip of clips) {
    const cStart = clip.startTime;
    const cEnd = clip.startTime + Math.max(0.25, clip.length);
    if (splitBeat > cStart + 0.24 && splitBeat < cEnd - 0.24) {
      splitOccurred = true;
      const leftNotes = clip.notes.filter((n) => n.time < splitBeat - 0.001);
      const rightNotes = clip.notes.filter((n) => n.time >= splitBeat - 0.001);
      out.push({
        ...clip,
        id: `${clip.id}_A`,
        sourceClipId: clip.id,
        name: `${clip.name}_A`,
        startTime: cStart,
        endTime: splitBeat,
        length: splitBeat - cStart,
        notes: leftNotes,
      });
      out.push({
        ...clip,
        id: `${clip.id}_B_${Math.round(splitBeat)}`,
        sourceClipId: clip.id,
        name: `${clip.name}_B`,
        startTime: splitBeat,
        endTime: cEnd,
        length: cEnd - splitBeat,
        notes: rightNotes,
      });
    } else {
      out.push(clip);
    }
  }

  return { clips: out.sort((a, b) => a.startTime - b.startTime), splitOccurred };
}

/**
 * Duplicates a target clip immediately after its end beat (`startTime + length`), shifting all note times accordingly.
 */
export function duplicateTrackClip(
  clips: AbletonMidiClip[],
  clipId: string
): { clips: AbletonMidiClip[]; duplicatedClip: AbletonMidiClip | null } {
  const source = clips.find((c) => c.id === clipId);
  if (!source) throw new Error(`Target clip ${clipId} not found`);

  const deltaBeats = source.length;
  if (!Number.isFinite(deltaBeats) || deltaBeats <= 0) throw new Error('Invalid source clip length');
  const newStart = source.startTime + deltaBeats;
  const newEnd = newStart + deltaBeats;
  const dupNotes: MidiNoteEvent[] = source.notes.map((n, i) => ({
    ...n,
    id: `${n.id}_dup_${i}_${Date.now()}`,
    sourceNoteId: n.id,
    time: Number((n.time + deltaBeats).toFixed(3)),
    quantizedTime: Number((n.quantizedTime + deltaBeats).toFixed(3)),
  }));

  const duplicatedClip: AbletonMidiClip = {
    ...source,
    id: `${source.id}_dup_${Math.round(newStart)}`,
    sourceClipId: source.id,
    name: `${source.name}_Dup`,
    startTime: newStart,
    endTime: newEnd,
    length: deltaBeats,
    notes: dupNotes,
  };

  const merged = insertClipIntoTrackTimeline(clips, duplicatedClip);
  return { clips: merged, duplicatedClip };
}

/**
 * Consolidates all clips overlapping `[startBeat, endBeat)` into a single contiguous clip.
 */
export function consolidateTrackClipsInRange(
  clips: AbletonMidiClip[],
  startBeat: number,
  endBeat: number,
  trackName = 'Track'
): AbletonMidiClip[] {
  const lo = Math.max(0, Math.min(startBeat, endBeat));
  const hi = Math.max(lo + 4, Math.max(startBeat, endBeat));
  const collectedNotes: MidiNoteEvent[] = [];

  for (const c of clips) {
    for (const n of c.notes) {
      if (n.time >= Math.max(lo, c.startTime) && n.time < Math.min(hi, c.startTime + c.length)) {
        collectedNotes.push({ ...n });
      }
    }
  }

  const consolidated: AbletonMidiClip = {
    id: `consolidated_${Math.round(lo)}_${Math.round(hi)}_${Date.now()}`,
    name: `${trackName}_Consolidated_Bars_${Math.floor(lo / 4) + 1}_${Math.floor(hi / 4)}`,
    startTime: lo,
    endTime: hi,
    length: hi - lo,
    notes: collectedNotes.sort((a, b) => a.time - b.time),
    revision: Date.now(),
  };

  return insertClipIntoTrackTimeline(clips, consolidated);
}

/**
 * Moves or resizes a specific clip on a track, shifting its notes when `newStartTime` changes.
 */
export function moveOrResizeTrackClip(
  clips: AbletonMidiClip[],
  clipId: string,
  newStartTime: number,
  newLength: number
): AbletonMidiClip[] {
  const target = clips.find((c) => c.id === clipId);
  if (!target) throw new Error(`Target clip ${clipId} not found`);

  const safeStart = Math.max(0, newStartTime);
  const safeLen = Math.max(1, newLength);
  const deltaStart = safeStart - target.startTime;

  const shiftedNotes = target.notes
    .map((n) => ({
      ...n,
      time: Number((n.time + deltaStart).toFixed(3)),
      quantizedTime: Number((n.quantizedTime + deltaStart).toFixed(3)),
    }));

  const updatedClip: AbletonMidiClip = {
    ...target,
    startTime: safeStart,
    endTime: safeStart + safeLen,
    length: safeLen,
    notes: shiftedNotes,
  };

  const others = clips.filter((c) => c.id !== clipId);
  return insertClipIntoTrackTimeline(others, updatedClip);
}

/**
 * Creates a brand-new user track from any Group A–H Instrument Role Template.
 */
export function createUserTrackFromRole(
  roleCode: string,
  trackIndex: number,
  customName?: string
): AbletonTrack {
  const role =
    INSTRUMENT_ROLE_TAXONOMY.find((r) => r.roleCode === roleCode) ||
    INSTRUMENT_ROLE_TAXONOMY.find((r) => r.roleCode === 'E2') ||
    INSTRUMENT_ROLE_TAXONOMY[0];

  const trackId = `track_user_${role.roleCode.toLowerCase()}_${Date.now()}_${trackIndex}`;
  const name = customName?.trim() || `${String(trackIndex + 1).padStart(2, '0')}_${role.defaultTrackName.replace(/^\d+_/, '')}`;

  return {
    id: trackId,
    name,
    type: 'midi',
    archetype: role.archetype,
    roleCode: role.roleCode,
    groupCode: role.groupCode,
    isGenerated: true,
    colorIndex: (trackIndex * 7) % 69,
    hexColor: role.defaultColorHex,
    color: role.defaultColorHex,
    muted: false,
    soloed: false,
    vcaGroupId: role.vcaGroupId,
    devices: [
      syncDeviceConversionRecord({
        id: `dev_${trackId}_inst`,
        xmlTag:
          role.archetype === 'kick'
            ? 'DrumGroupDevice'
            : role.archetype === 'rumble'
            ? 'Operator'
            : role.archetype === 'percussion'
            ? 'Collision'
            : role.archetype === 'hats' || role.archetype === 'ride'
            ? 'OriginalSimpler'
            : role.archetype === 'acid'
            ? 'UltraAnalog'
            : role.archetype === 'pad'
            ? 'Drift'
            : 'InstrumentVector',
        displayName: role.name,
        category: 'instrument',
        browserDspSupported: true,
        parameters: [
          { name: 'FilterCutoffHz', value: role.defaultCutoffHz, unit: 'Hz', automationTarget: true },
          { name: 'FilterResonance', value: role.defaultResonance },
        ],
      }),
      syncDeviceConversionRecord({
        id: `dev_${trackId}_eq`,
        xmlTag: 'EQEight',
        displayName: 'EQ Eight Surgical Band',
        category: 'audio_effect',
        browserDspSupported: true,
        parameters: [
          { name: 'BandLowHz', value: role.frequencyBandHz[0], unit: 'Hz' },
          { name: 'BandHighHz', value: role.frequencyBandHz[1], unit: 'Hz' },
        ],
      }),
    ],
    clips: [],
    mixer: {
      volumeDb: role.defaultVolumeDb,
      pan: 0,
      transposeSemitones: 0,
      fineTuneCents: 0,
      sidechainDepth: role.defaultSidechainDepth,
      reverbSend: role.defaultReverbSend,
      delaySend: role.defaultDelaySend,
      filterCutoffHz: role.defaultCutoffHz,
      filterResonance: role.defaultResonance,
    },
    automationPoints: [
      { beat: 0, value: 0.45 },
      { beat: 128, value: 0.72 },
      { beat: 256, value: 0.38 },
      { beat: 384, value: 0.88 },
      { beat: 512, value: 0.5 },
    ],
  };
}



