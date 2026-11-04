import type {
  AbletonProjectState,
  AbletonTrack,
  AbletonMidiClip,
  MidiNoteEvent,
  TechnoArchetype,
  CompositionStrategyId,
  AutomationPoint,
} from "../types/ableton";

export interface HarmonicEvent {
  fromBeat: number;
  toBeat: number;
  rootMidi: number;
  quality: "minor7" | "major7" | "dominant7" | "half-diminished7";
  voicing: number[];
  register: [number, number];
  extensions: number[];
  omissions: number[];
  permittedTension: number[];
  intent: "modal-anchor" | "development" | "resolution";
}
export interface SongTransition {
  id: string;
  sourceSection: string;
  destinationSection: string;
  anchorBeat: number;
  roles: TechnoArchetype[];
  preparationBeats: number;
  recoveryBeats: number;
  kind:
    | "fill"
    | "bass-withdrawal"
    | "chord-anticipation"
    | "filter-rise"
    | "silence"
    | "texture-swell"
    | "rhythmic-subtraction";
  purpose: "anticipation" | "contrast" | "arrival";
  intensity: number;
  tailPolicy: "preserve";
}
export interface SongGroove {
  bassSteps: number[];
  percussionSteps: number[];
  chordSteps: number[];
  hatGhostProbability: number;
  densityScale: number;
  supportingAcidProbability: number;
}
const STYLE_GROOVES: Partial<Record<CompositionStrategyId, SongGroove>> = {
  hypnotic_evolving: {
    bassSteps: [2, 5, 6, 10, 13, 14],
    percussionSteps: [3, 6, 7, 11, 15],
    chordSteps: [0, 6, 11],
    hatGhostProbability: 0.55,
    densityScale: 1,
    supportingAcidProbability: 0.63,
  },
  asymmetric_industrial: {
    bassSteps: [2, 5, 9, 12, 15],
    percussionSteps: [0, 3, 6, 9, 12, 14],
    chordSteps: [1, 7, 13],
    hatGhostProbability: 0.32,
    densityScale: 1.1,
    supportingAcidProbability: 0.52,
  },
  minimal_groove: {
    bassSteps: [2, 6, 11, 14],
    percussionSteps: [3, 11],
    chordSteps: [3, 10],
    hatGhostProbability: 0.18,
    densityScale: 0.65,
    supportingAcidProbability: 0.4,
  },
  dub_space: {
    bassSteps: [2, 6, 10, 14],
    percussionSteps: [3, 10, 15],
    chordSteps: [0, 3, 6, 10],
    hatGhostProbability: 0.28,
    densityScale: 0.82,
    supportingAcidProbability: 0,
  },
  detroit_funk: {
    bassSteps: [2, 5, 7, 10, 14],
    percussionSteps: [3, 6, 11, 14],
    chordSteps: [2, 6, 11],
    hatGhostProbability: 0.48,
    densityScale: 1,
    supportingAcidProbability: 0.5,
  },
  raw_warehouse: {
    bassSteps: [2, 3, 6, 7, 10, 11, 14, 15],
    percussionSteps: [3, 6, 7, 11, 14, 15],
    chordSteps: [0, 7, 14],
    hatGhostProbability: 0.84,
    densityScale: 1.2,
    supportingAcidProbability: 0.58,
  },
  acid_modulation: {
    bassSteps: [2, 6, 10, 14],
    percussionSteps: [3, 7, 10, 15],
    chordSteps: [3, 11],
    hatGhostProbability: 0.4,
    densityScale: 0.95,
    supportingAcidProbability: 0.82,
  },
  peak_rolling: {
    bassSteps: [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15],
    percussionSteps: [2, 3, 6, 7, 11, 14, 15],
    chordSteps: [0, 6, 14],
    hatGhostProbability: 0.72,
    densityScale: 1.16,
    supportingAcidProbability: 0.6,
  },
};
export interface SongPlan {
  groove?: SongGroove;
  version: number;
  generatorVersion: string;
  seed: number;
  style: CompositionStrategyId;
  durationBars: number;
  tempo: number;
  meter: [number, number];
  rootMidi: number;
  scale: number[];
  tonalIntent: "modal" | "evolving";
  sections: {
    id: string;
    name: string;
    fromBeat: number;
    toBeat: number;
    energy: number;
    focalRole: TechnoArchetype;
  }[];
  phrases: {
    fromBeat: number;
    toBeat: number;
    sectionId: string;
    variation: number;
  }[];
  harmony: HarmonicEvent[];
  motifs: {
    role: TechnoArchetype;
    degrees: number[];
    steps: number[];
    transforms: ("rotate" | "subtract" | "octave" | "answer")[];
  }[];
  roles: {
    role: TechnoArchetype;
    required: boolean;
    seed: number;
    gainDb: number;
    spans: {
      fromBeat: number;
      toBeat: number;
      density: number;
      featured: boolean;
    }[];
  }[];
  transitions: SongTransition[];
}
const roles: TechnoArchetype[] = [
  "kick",
  "rumble",
  "hats",
  "percussion",
  "synth",
  "acid",
  "pad",
  "ride",
];
const random = (seed: number, index: number) => {
  let x = (seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x21f0aaad);
  x ^= x >>> 15;
  x = Math.imul(x, 0x735a2d97);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
};
const rootOf = (key: string) => {
  const keys: Record<string, number> = {
    C: 0,
    "C#": 1,
    Db: 1,
    D: 2,
    "D#": 3,
    Eb: 3,
    E: 4,
    F: 5,
    "F#": 6,
    Gb: 6,
    G: 7,
    "G#": 8,
    Ab: 8,
    A: 9,
    "A#": 10,
    Bb: 10,
    B: 11,
  };
  return 24 + (keys[key] ?? 5);
};

/** Pure, persisted intention. No audio nodes, history, XML, or global random state. */
export function createSongPlan(
  project: AbletonProjectState,
  seed: number,
  style: CompositionStrategyId = "hypnotic_evolving",
): SongPlan {
  const grooveProfile = STYLE_GROOVES[style];
  if (!grooveProfile)
    throw new Error(
      "SONG_PLAN_STYLE: select one of the eight composition strategies",
    );
  const bars = project.arrangementLengthBars ?? 64;
  if (
    !Number.isSafeInteger(seed) ||
    !Number.isSafeInteger(bars) ||
    bars < 1 ||
    bars > 4096
  )
    throw new Error(
      "SONG_PLAN_INPUT: finite integer seed and 1–4096 bars required",
    );
  if (project.meterMap?.some((m) => m.numerator !== 4 || m.denominator !== 4))
    throw new Error(
      "SONG_PLAN_METER: composition currently supports constant 4/4",
    );
  const total = bars * 4,
    root = rootOf(project.rootKey);
  const scale =
    style === "dub_space" || style === "detroit_funk"
      ? [0, 2, 3, 5, 7, 9, 10]
      : style === "minimal_groove" || style === "peak_rolling"
        ? [0, 2, 3, 5, 7, 8, 10]
        : [0, 1, 3, 5, 7, 8, 10];
  const evolving = style === "detroit_funk" || style === "peak_rolling";
  const names =
    bars >= 32
      ? ["Intro", "Groove", "Development", "Breakdown", "Peak", "Outro"]
      : ["Intro", "Peak", "Outro"].slice(0, Math.min(bars, 3));
  const weights = names.length === 6 ? [1, 2, 2, 1, 3, 1] : names.map(() => 1);
  // Whole phrases where length permits; preserve the exact requested final boundary.
  const unit = bars >= 64 ? 8 : bars >= 16 ? 4 : 1;
  let cursor = 0;
  const sections = names.map((name, i) => {
    const remaining = names.length - i - 1;
    const target =
      i === names.length - 1
        ? total
        : Math.max(
            cursor + 4,
            Math.min(
              total - remaining * 4,
              Math.round(
                ((weights.slice(0, i + 1).reduce((a, b) => a + b, 0) /
                  weights.reduce((a, b) => a + b, 0)) *
                  bars) /
                  unit,
              ) *
                unit *
                4,
            ),
          );
    const result = {
      id: `section_${i}`,
      name,
      fromBeat: cursor,
      toBeat: target,
      energy:
        name === "Peak"
          ? 0.9
          : name === "Breakdown"
            ? 0.25
            : name === "Intro" || name === "Outro"
              ? 0.35
              : 0.65,
      focalRole: (name === "Peak" &&
      (style === "acid_modulation" || random(seed, 1) > 0.55)
        ? "acid"
        : name === "Breakdown"
          ? "pad"
          : style === "dub_space"
            ? "synth"
            : "rumble") as TechnoArchetype,
    };
    cursor = target;
    return result;
  });
  const phrases: SongPlan["phrases"] = [];
  for (const s of sections)
    for (let at = s.fromBeat; at < s.toBeat; at += 16)
      phrases.push({
        fromBeat: at,
        toBeat: Math.min(s.toBeat, at + 16),
        sectionId: s.id,
        variation: Math.floor(random(seed, at + 9) * 4),
      });
  let previous: number[] = [];
  const harmony: HarmonicEvent[] = phrases.map((phrase, i) => {
    const section = sections.find((s) => s.id === phrase.sectionId)!;
    const degree =
      evolving && section.name !== "Outro"
        ? [0, 5, 3, 0][Math.floor(i / 2) % 4]
        : 0;
    const chordRoot = root + scale[degree];
    const chordDegrees = [degree, degree + 2, degree + 4, degree + 6];
    const tones = chordDegrees.map(
      (d) => root + scale[d % 7] + 12 * Math.floor(d / 7),
    );
    const pitchClasses = tones.map((t) => t % 12);
    const candidates: number[][] = [];
    for (let inversion = 0; inversion < 4; inversion++)
      for (let octave = 48; octave <= 60; octave += 12) {
        let v = pitchClasses.map((_, j) => pitchClasses[(j + inversion) % 4]);
        v = v.map((pc, j) => {
          let p = octave + pc;
          while (j && p <= v[j - 1]) p += 12;
          v[j] = p;
          return p;
        });
        if (v[v.length - 1] <= 84 && v.every((n, j) => !j || n - v[j - 1] >= 3))
          candidates.push(v);
      }
    const score = (v: number[]) =>
      v.reduce(
        (n, p, j) =>
          n +
          Math.abs(p - (previous[j] ?? [53, 60, 65, 70][j])) +
          (previous.includes(p) ? -2 : 0),
        0,
      );
    candidates.sort((a, b) => score(a) - score(b));
    const voicing = candidates[0] ?? [
      root + 24,
      root + 31,
      root + 34,
      root + 39,
    ];
    previous = voicing;
    return {
      fromBeat: phrase.fromBeat,
      toBeat: phrase.toBeat,
      rootMidi: chordRoot,
      quality:
        (tones[2] - chordRoot) % 12 === 6
          ? "half-diminished7"
          : (tones[1] - chordRoot) % 12 === 4
            ? (tones[3] - chordRoot) % 12 === 11
              ? "major7"
              : "dominant7"
            : "minor7",
      voicing,
      register: [48, 84],
      extensions: [(tones[3] - chordRoot) % 12],
      omissions: [],
      permittedTension: [scale[1], scale[5]],
      intent:
        section.name === "Outro"
          ? "resolution"
          : evolving
            ? "development"
            : "modal-anchor",
    };
  });
  const rolePlans: SongPlan["roles"] = roles.map((role, index) => {
    const spans: SongPlan["roles"][number]["spans"] = [];
    for (const [i, p] of phrases.entries()) {
      const s = sections.find((s) => s.id === p.sectionId)!;
      let active = true;
      if (s.name === "Intro")
        active =
          ["kick", "hats", "percussion"].includes(role) ||
          (style === "dub_space" && role === "pad");
      if (s.name === "Breakdown")
        active =
          ["pad", "synth"].includes(role) ||
          (role === "percussion" && i % 2 === 0);
      if (s.name === "Outro")
        active = ["kick", "hats", "percussion", "rumble"].includes(role);
      if (role === "ride") active = s.name === "Peak" && i % 2 === 1;
      if (role === "pad")
        active = active && (i % 3 !== 1 || s.name === "Breakdown");
      if (role === "acid")
        active =
          active &&
          style !== "dub_space" &&
          (s.name === "Development" || s.name === "Peak") &&
          i % 3 !== 0;
      if (role === "synth" && s.focalRole === "acid") active = i % 2 === 0;
      if (role === "synth" && s.name === "Groove") active = i % 2 === 1;
      if (!active) continue;
      const stagger = ["pad", "synth", "acid", "percussion"].includes(role)
        ? [0, 1, 2, 4][Math.floor(random(seed, index * 401 + i) * 4)]
        : 0;
      const from = p.fromBeat + Math.min(stagger, (p.toBeat - p.fromBeat) / 2);
      const end = p.toBeat - (role === "pad" ? 2 : role === "synth" ? 1 : 0);
      if (end > from)
        spans.push({
          fromBeat: from,
          toBeat: end,
          density: Math.min(
            1,
            s.energy *
              grooveProfile.densityScale *
              (role === "pad" ? 0.45 : role === "synth" ? 0.7 : 1) +
              random(seed, i + index * 77) * 0.12,
          ),
          featured: s.focalRole === role,
        });
    }
    return {
      role,
      required: ["kick", "rumble", "hats"].includes(role),
      seed: seed + index * 997,
      gainDb: {
        kick: -7,
        rumble: -15,
        hats: -19,
        percussion: -17,
        synth: -19,
        acid: -23,
        pad: -24,
        ride: -24,
        existing: -18,
      }[role],
      spans,
    };
  });
  const transitions: SongTransition[] = sections.slice(1).map((s, i) => ({
    id: `transition_${i}`,
    sourceSection: sections[i].id,
    destinationSection: s.id,
    anchorBeat: s.fromBeat,
    roles: (s.name === "Peak"
      ? ["rumble", "percussion", "acid"]
      : s.name === "Breakdown"
        ? ["rumble", "kick"]
        : ["percussion", "synth"]) as TechnoArchetype[],
    preparationBeats: s.name === "Peak" ? 4 : 2,
    recoveryBeats: 4,
    kind:
      s.name === "Peak"
        ? "bass-withdrawal"
        : s.name === "Breakdown"
          ? "rhythmic-subtraction"
          : s.name === "Development"
            ? "filter-rise"
            : i % 2
              ? "chord-anticipation"
              : "fill",
    purpose: s.name === "Peak" ? "arrival" : "contrast",
    intensity: s.name === "Peak" ? 0.85 : 0.45,
    tailPolicy: "preserve",
  }));
  return {
    version: 2,
    generatorVersion: "song-plan-2",
    groove: structuredClone(grooveProfile),
    seed,
    style,
    durationBars: bars,
    tempo: project.tempo,
    meter: [4, 4],
    rootMidi: root,
    scale,
    tonalIntent: evolving ? "evolving" : "modal",
    sections,
    phrases,
    harmony,
    roles: rolePlans,
    transitions,
    motifs: roles.map((role, i) => ({
      role,
      degrees: [0, 0, 4, 2, 0, 6, 4, 1].map(
        (d, j) => (d + (random(seed, i * 99 + j) > 0.8 ? 2 : 0)) % 7,
      ),
      steps:
        role === "acid"
          ? [0, 2, 3, 6, 8, 10, 11, 14]
          : role === "rumble"
            ? [2, 5, 6, 10, 13, 14]
            : [0, 3, 6, 10],
      transforms: ["rotate", "subtract", "octave", "answer"],
    })),
  };
}

export function assertSongPlan(plan: SongPlan): void {
  if (
    !plan ||
    !(
      (plan.version === 1 && plan.generatorVersion === "song-plan-1") ||
      (plan.version === 2 && plan.generatorVersion === "song-plan-2")
    )
  )
    throw new Error("SONG_PLAN_VERSION: unsupported plan; original preserved");
  if (
    !Number.isSafeInteger(plan.seed) ||
    !Number.isSafeInteger(plan.durationBars) ||
    plan.durationBars < 1 ||
    plan.durationBars > 4096 ||
    !Number.isFinite(plan.tempo) ||
    plan.tempo <= 0
  )
    throw new Error("SONG_PLAN_INPUT: invalid identity/duration");
  if (plan.version === 2) {
    const g = plan.groove;
    if (
      !g ||
      ![
        g.hatGhostProbability,
        g.densityScale,
        g.supportingAcidProbability,
      ].every(Number.isFinite) ||
      g.hatGhostProbability < 0 ||
      g.hatGhostProbability > 1 ||
      g.supportingAcidProbability < 0 ||
      g.supportingAcidProbability > 1 ||
      g.densityScale <= 0 ||
      g.densityScale > 2 ||
      [g.bassSteps, g.percussionSteps, g.chordSteps].some(
        (steps) =>
          !Array.isArray(steps) ||
          steps.some((n) => !Number.isInteger(n) || n < 0 || n > 15),
      )
    )
      throw new Error("SONG_PLAN_GROOVE: invalid persisted rhythm");
  }
  const total = plan.durationBars * 4;
  for (const key of ["sections", "phrases", "harmony"] as const) {
    if (!Array.isArray(plan[key]) || !plan[key].length)
      throw new Error("SONG_PLAN_STRUCTURE");
    let at = 0;
    for (const p of plan[key]) {
      if (
        p.fromBeat !== at ||
        !Number.isFinite(p.toBeat) ||
        p.toBeat <= at ||
        p.toBeat > total
      )
        throw new Error("SONG_PLAN_STRUCTURE: discontinuous form");
      at = p.toBeat;
    }
    if (at !== total) throw new Error("SONG_PLAN_STRUCTURE: incomplete form");
  }
  if (
    !Array.isArray(plan.roles) ||
    !Array.isArray(plan.transitions) ||
    !Array.isArray(plan.motifs)
  )
    throw new Error("SONG_PLAN_STRUCTURE");
  for (const h of plan.harmony)
    if (
      !Array.isArray(h.voicing) ||
      h.voicing.some((n) => !Number.isInteger(n) || n < 0 || n > 127) ||
      !Number.isInteger(h.rootMidi)
    )
      throw new Error("SONG_PLAN_HARMONY");
  for (const r of plan.roles)
    for (const s of r.spans)
      if (
        ![s.fromBeat, s.toBeat, s.density].every(Number.isFinite) ||
        s.fromBeat < 0 ||
        s.toBeat > total ||
        s.toBeat <= s.fromBeat ||
        s.density < 0 ||
        s.density > 1
      )
        throw new Error("SONG_PLAN_SPAN");
}

/** Materialize actual independent MIDI phrases; never stretch a short starter. */
export function materializeSongPlanTrack(
  plan: SongPlan,
  track: AbletonTrack,
): AbletonMidiClip[] {
  assertSongPlan(plan);
  const role = track.archetype;
  const groove = plan.groove ?? STYLE_GROOVES.hypnotic_evolving!;
  const r = plan.roles.find((r) => r.role === role);
  if (!r || track.type !== "midi") return track.clips;
  const motif = plan.motifs.find((m) => m.role === role)!;
  const clips: AbletonMidiClip[] = [];
  for (const [index, span] of r.spans.entries()) {
    const notes: MidiNoteEvent[] = [];
    const phrase = plan.phrases.find(
      (p) => span.fromBeat >= p.fromBeat && span.fromBeat < p.toBeat,
    )!;
    const add = (
      time: number,
      pitch: number,
      duration: number,
      velocity: number,
      fill = false,
      slide = false,
    ) => {
      if (time < span.fromBeat || time >= span.toBeat) return;
      notes.push({
        id: `sp_${track.id}_${plan.seed}_${index}_${notes.length}`,
        time,
        quantizedTime: time,
        duration: Math.min(duration, span.toBeat - time),
        pitch,
        velocity,
        ...(plan.version >= 2 && ["synth", "pad"].includes(role)
          ? { harmonicOwner: "voiced-midi" as const }
          : {}),
        isGhost: velocity < 45,
        probability: 1,
        isSlide: slide,
        isAccent: role === "acid" && velocity >= 100,
        motifRole: fill ? "fill" : "anchor",
      });
    };
    for (
      let bar = Math.floor(span.fromBeat / 4);
      bar * 4 < span.toBeat;
      bar++
    ) {
      const base = bar * 4;
      const h = plan.harmony.find(
        (h) => base >= h.fromBeat && base < h.toBeat,
      )!;
      const degree = (j: number) => {
        const rootDegree = plan.scale.indexOf(
          (((h.rootMidi - plan.rootMidi) % 12) + 12) % 12,
        );
        const degreeIndex =
          Math.max(0, rootDegree) +
          motif.degrees[(j + phrase.variation) % motif.degrees.length];
        return (
          plan.rootMidi +
          12 +
          plan.scale[degreeIndex % 7] +
          12 * Math.floor(degreeIndex / 7)
        );
      };
      for (let step = 0; step < 16; step++) {
        const at = base + step / 4;
        const hash = random(r.seed, bar * 32 + step);
        const transition = plan.transitions.find(
          (t) => at >= t.anchorBeat - t.preparationBeats && at < t.anchorBeat,
        );
        if (
          transition &&
          ["bass-withdrawal", "rhythmic-subtraction", "silence"].includes(
            transition.kind,
          ) &&
          ["rumble", "kick"].includes(role)
        )
          continue;
        if (role === "kick") {
          if (step % 4 === 0) add(at, 36, 0.22, 100 + (bar % 4 === 0 ? 7 : 0));
        } else if (role === "rumble") {
          if (
            (plan.groove ? groove.bassSteps : motif.steps).includes(step) &&
            step % 4 !== 0
          )
            add(
              at,
              h.rootMidi + (step === 14 && bar % 4 === 3 ? 12 : 0),
              0.18,
              78 + Math.round(hash * 15),
            );
        } else if (role === "hats") {
          if (
            step % 4 === 2 ||
            (span.density > 0.6 &&
              step % 2 === 1 &&
              hash < groove.hatGhostProbability)
          )
            add(
              at,
              step % 4 === 2 ? 46 : 42,
              step % 4 === 2 ? 0.22 : 0.09,
              step % 4 === 2 ? 76 : 46 + Math.round(hash * 15),
            );
        } else if (role === "percussion" || role === "ride") {
          const fill = !!transition && step >= 12;
          if (
            (role === "ride"
              ? step % 4 === 2
              : groove.percussionSteps.includes(step) ||
                (fill && step >= 12)) &&
            (hash < span.density || fill)
          )
            add(
              at,
              role === "ride" ? 51 : 37 + (bar % 3) * 2,
              0.13,
              fill ? 83 : 56 + Math.round(hash * 24),
              fill,
            );
        } else if (role === "acid") {
          if (
            motif.steps.includes(
              (step + (phrase.variation === 3 ? 2 : 0)) % 16,
            ) &&
            hash < (span.featured ? 0.9 : groove.supportingAcidProbability)
          ) {
            const v = span.featured ? 87 : 68;
            const previous = notes.at(-1);
            if (
              (step === 3 || step === 11) &&
              previous &&
              at - previous.time <= 0.5
            )
              previous.duration = at - previous.time + 0.025;
            add(
              at,
              (degree(step) % 12) +
                48 +
                (step === 14 && phrase.variation === 2 ? 12 : 0),
              0.21,
              v + Math.round(hash * 18),
              false,
              step === 3 || step === 11,
            );
          }
        } else if (role === "synth") {
          if (
            groove.chordSteps.includes(step) &&
            (bar % 2 === 0 || step === 6) &&
            hash < span.density
          ) {
            for (const pitch of h.voicing)
              add(
                at,
                pitch,
                plan.style === "dub_space" ? 0.48 : 0.24,
                58 + Math.round(hash * 18),
              );
          }
        } else if (role === "pad" && step === 0 && bar % 2 === 0) {
          for (const pitch of h.voicing.slice(1))
            add(
              at,
              pitch,
              Math.min(5.5, span.toBeat - at),
              44 + Math.round(hash * 12),
            );
        }
      }
    }
    if (notes.length)
      clips.push({
        id: `sp_clip_${track.id}_${plan.seed}_${index}`,
        name: `${role} · ${plan.sections.find((s) => s.id === phrase.sectionId)!.name} · ${index + 1}`,
        startTime: span.fromBeat,
        endTime: span.toBeat,
        length: span.toBeat - span.fromBeat,
        notes: notes.sort((a, b) => a.time - b.time || a.pitch - b.pitch),
        sectionRole: phrase.sectionId,
      });
  }
  if (role === "synth")
    for (const t of plan.transitions.filter(
      (t) => t.kind === "chord-anticipation",
    )) {
      const h = plan.harmony.find(
        (h) => t.anchorBeat >= h.fromBeat && t.anchorBeat < h.toBeat,
      );
      const at = t.anchorBeat - 0.5;
      if (h && at >= 0)
        clips.push({
          id: `sp_pickup_${track.id}_${t.id}`,
          name: "Chord anticipation",
          startTime: at,
          length: 0.5,
          endTime: t.anchorBeat,
          notes: h.voicing.map((pitch, i) => ({
            id: `pickup_${track.id}_${t.id}_${i}`,
            time: at,
            quantizedTime: at,
            pitch,
            duration: 0.4,
            velocity: 68,
            isGhost: false,
            harmonicOwner:
              plan.version >= 2 ? ("voiced-midi" as const) : undefined,
            motifRole: "fill",
          })),
        });
    }
  return clips.sort((a, b) => a.startTime - b.startTime);
}
export function songPlanAutomation(
  plan: SongPlan,
  role: TechnoArchetype,
): AutomationPoint[] {
  const points: AutomationPoint[] = [];
  for (const p of plan.phrases) {
    const s = plan.sections.find((s) => s.id === p.sectionId)!;
    const featured = s.focalRole === role;
    points.push(
      {
        beat: p.fromBeat,
        value:
          role === "acid"
            ? featured
              ? 0.6
              : 0.22
            : Math.min(0.85, s.energy * 0.7 + 0.12),
      },
      {
        beat: Math.max(p.fromBeat, p.toBeat - 0.25),
        value:
          role === "acid"
            ? featured
              ? 0.82
              : 0.36
            : Math.min(0.9, s.energy * 0.75 + 0.15),
      },
    );
  }
  for (const t of plan.transitions)
    if (
      t.roles.includes(role) &&
      ["filter-rise", "texture-swell", "bass-withdrawal"].includes(t.kind)
    ) {
      points.push(
        { beat: Math.max(0, t.anchorBeat - t.preparationBeats), value: 0.25 },
        { beat: t.anchorBeat - 0.125, value: role === "acid" ? 0.7 : 0.85 },
        { beat: t.anchorBeat + t.recoveryBeats, value: 0.45 },
      );
    }
  return [
    ...new Map(
      points.sort((a, b) => a.beat - b.beat).map((p) => [p.beat, p]),
    ).values(),
  ];
}
export function composeSongPlan(
  project: AbletonProjectState,
  plan: SongPlan,
  scope?: {
    fromBeat: number;
    toBeat: number;
    trackId?: string;
    roleOverride?: TechnoArchetype;
  },
): AbletonProjectState {
  assertSongPlan(plan);
  if (
    scope &&
    (![scope.fromBeat, scope.toBeat].every(Number.isFinite) ||
      scope.fromBeat < 0 ||
      scope.toBeat <= scope.fromBeat ||
      scope.toBeat > plan.durationBars * 4)
  )
    throw new Error("SONG_PLAN_RANGE");
  const tracks = project.tracks.map((track) => {
    if (
      track.locked ||
      track.type !== "midi" ||
      !roles.includes(track.archetype) ||
      (scope?.trackId && track.id !== scope.trackId)
    )
      return track;
    const generated = materializeSongPlanTrack(
      plan,
      scope?.roleOverride ? { ...track, archetype: scope.roleOverride } : track,
    );
    if (scope) {
      const clips = track.clips
        .map((c) => ({
          ...c,
          notes: c.notes.filter(
            (n) => n.time < scope.fromBeat || n.time >= scope.toBeat,
          ),
        }))
        .filter(
          (c) =>
            c.notes.length ||
            c.startTime + c.length <= scope.fromBeat ||
            c.startTime >= scope.toBeat,
        );
      for (const c of generated) {
        const notes = c.notes
          .filter((n) => n.time >= scope.fromBeat && n.time < scope.toBeat)
          .map((n) => ({
            ...n,
            duration: Math.min(n.duration, scope.toBeat - n.time),
          }));
        if (notes.length) {
          const start = Math.max(c.startTime, scope.fromBeat),
            end = Math.min(c.startTime + c.length, scope.toBeat);
          clips.push({
            ...c,
            id: `${c.id}_range_${scope.fromBeat}_${scope.toBeat}`,
            startTime: start,
            length: end - start,
            endTime: end,
            notes,
          });
        }
      }
      return { ...track, clips };
    }
    const role = plan.roles.find((r) => r.role === track.archetype)!;
    return {
      ...track,
      clips: generated,
      automationPoints: songPlanAutomation(plan, track.archetype),
      mixer: {
        ...track.mixer,
        volumeDb: role.gainDb,
        reverbSend:
          track.archetype === "pad"
            ? 0.25
            : track.archetype === "acid"
              ? 0.08
              : 0.12,
        delaySend:
          track.archetype === "synth"
            ? 0.24
            : track.archetype === "acid"
              ? 0.1
              : 0.06,
      },
    };
  });
  return {
    ...project,
    songPlan: plan,
    generationSeed: plan.seed,
    tracks,
    ...(!scope
      ? {
          creationMode: "full-track" as const,
          requestedDurationBars: plan.durationBars,
          arrangementLengthBars: plan.durationBars,
        }
      : {}),
  };
}
