# ADR-011 — Reuse canonical musical-time conversions in the runtime

Status: implemented candidate; complete transport/audio gate remains PARTIAL.
Baseline: ac0a140802446993119df92cde8ae1eabd8198a7.

Confirmed deficiency: timelineCoordinates already represented validated tempo/meter maps and offline events used mapped seconds, but assertRuntimeTimingMapSupport rejected nonconstant/non4/4 projects. Live scheduling, voice durations and master-point timing still used scalar beat/second arithmetic. Baseline integration tests reproduced four failures because valid maps could not be installed; no unsupported baseline audio is claimed.

Decision: retain AbletonProjectState, 960 PPQ, existing MusicalTimeService converters, indexed arrangement scheduler, AudioContext anchors, command bus and continuous renderer. runtimeTiming.ts is a stateless adapter over those converters: it integrates elapsed seconds and repeated-loop time, maps existing source scheduling coordinates, places meter clicks and schedules native tempo-return parameters. It stores no authoritative musical state and creates no independent clock or timeline. This strengthens the existing engine rather than replacing it. Reviewed timing-only changes from preserved2169093 were ported selectively; unrelated work was not merged.

Changes: validate maps instead of blanket rejection; preflight candidate state before installation; capture the old clock before a map/meter edit, retire queued sources and reanchor; use mapped note durations/onsets/master point times; account for multiple skipped loops in seconds; register metronome sources for transport cleanup. Preserve existing probability and repeated-PCM assertions. Delay-tail preflight uses the slowest mapped BPM. Approximate waveform previews are labeled honestly and mapped/keyed by musical timing.

Scope limits: continuous automation-curve semantics, wet DSP captured-output parity, Session UI launch prediction and variable-tempo performance capture need further qualification. The existing arrangement query supports at most one upcoming wrap inside its120ms lookahead; shorter loop durations now reject explicitly rather than miss events. Timer stalls still cannot recover audio already missed. No zero-latency, production fidelity, physical Android or complete G7 claim.

Migration: none; no file/schema change. Existing native/ALS preservation and command history remain authoritative.
Rollback: revert this milestone as a unit to restore the prior runtime guard and scalar implementation while retaining all stored tempo/meter data. Do not remove maps from projects to force playback. Regression evidence and user recovery records remain preserved.

Evidence: RUNTIME-TIMING-EVIDENCE.md, evidence/runtime-timing/, runtimeTiming.test.ts and verify-p0-audio.mjs. Final commit/tree and immutable CI artifacts are attached to the PR; local runs identify their baseline and candidate scope.
