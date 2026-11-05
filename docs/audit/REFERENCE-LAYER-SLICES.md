# Approved vertical-slice programme — first integrated implementation

Baseline: main `5f58adaaa343d7feebe1b2ec15d68150588b55e6`. Authority: owner-approved `AIDAW_Research_and_Vertical_Slice_Plan_v3.md`, 6 November 2026 IST. This implements a connected increment across the six slices. **The complete programme and G0–G8 qualification are not complete.** Do not promote the gates from these scoped results.

## Implemented behavior

| Slice | Delivered in this increment | Still required by the approved programme |
|---|---|---|
| 1 — identities/commands/persistence | Optional versioned per-track layer descriptors; stable per-layer seeds; SongPlan v3 addressing track/layer identity rather than only family; typed mixer/note/clip/automation/sidechain command adapters using existing history; actor attribution; existing snapshots/journal/XML projection; version-2 track metadata and original preservation | Convert remaining mutator callers; comprehensive serializable intent/replay coverage; byte-bounded history/checkpoints and gesture coalescing; all section/parameter locks; cross-version/quota/interruption matrix |
| 2 — automation/transport | Five bounded channel parameter targets; linear/exponential/smooth/step curves; native audio-time ramps shared live/offline; seek/loop windows; inspect/apply/disable/remove; actual curves drawn on the timeline | Arbitrary device parameter targets, modulation precedence/racks, full point/handle gesture editing, all wet/session/load cases and tighter curve approximation qualification |
| 3 — DSP/sidechain/atoms | Original two-input stereo-linked signal detector worklet; threshold/ratio/knee/attack/release/hold/key HPF/mix; measured GR; key-cycle rejection; async preparation, explicit load failures and processor-error stop; legacy volume ducking disabled on signal-compressed destinations; procedural noise riser/impact/downlifter voices through the shared graph | Complete sampler/multisampler/rack/modulation/expression and built-in device suite; all parameter/DSP fixtures; bus/return sidechain destinations, latency compensation and physical-device CPU/latency qualification |
| 4 — composition | Eight style palettes with separate layer duties beyond eight tracks; hardgroove percussion inventory; independent phrase periods/entrances/seeds; style/form-specific multi-arrival/plateau/dub sections; actual transition MIDI and synthesized atoms; generated editable channel sweeps; explicit key/mode/form/seed; style-ensemble expansion through preview without discarding existing layers | Larger reference-conditioned distributions and role-confidence review; complete 200 saved/reopened/rendered project corpus; independent producer listening; broader groove/articulation/production-mode coverage |
| 5 — workspace | Editor stays mounted beneath adaptive Browser/Mixer/Session/Devices/Compose panels; shared selection/history; inspect controls; actual proposal geometry with before/proposed clip spans; existing stale-proposal/audition/apply/cancel guards retained | Full contextual section/device UI, dock persistence/resize ergonomics, complete multi-lane gestures/accessibility, natural-language Assist interpretation, phone/tablet/fold hardware qualification |
| 6 — export | Shared-graph selected-track or selected-track-set stem API with explicit returns/master policy; selected-layer UI; full timeline/tail alignment; non-output key-source processing retained; existing Blob/streaming/SAF cancellation and verification reused; required native audio check in CI | Complete batch stem delivery, bus stems and range workflows; official loudness conformance/post-encode target qualification; exhaustive cancellation/resource matrix; trusted signing, licensed Live and physical Android acceptance |

## Compatibility and reference scope

The six source ALS structures were inspected before implementation. Their musical track inventories range from 13 to 19 MIDI/audio tracks, plus separate groups and returns. The generated palettes are original, manually authored structural interpretations; they are not a trained audio model and do not reproduce missing external samples/plugins. The hard-techno source is a short arrangement, not a universal full-song blueprint. Purposeful kick/motif repetition remains valid.

Legacy SongPlan versions 1/2 remain readable; they are not regenerated during open. New v3 plans carry layer ownership. New track metadata writes version 2, while this reader accepts versions 1/2 and rejects future versions. Older application builds that reject version 2 must preserve the source rather than write it back. Explicit absence of optional velocity/polyrhythm/spectral-ducking state is serialized so import defaults cannot change sound after reopen. Original source XML/opaque subtrees remain owned by the existing projection and journal mechanisms.

Musical key/mode intent, channel lanes and signal-sidechain configuration are application metadata. This is not native Ableton device/envelope/sidechain equivalence or a licensed Live reopen claim. MIDI remains editable/exportable within the existing supported projection. Native host interoperability remains a separate acceptance requirement.

Channel volume automation is an offset after the track/VCA fader; pan and sends override their base controls; cutoff is an additional channel low-pass. Native ramp segmentation is at most 10ms and includes exact knots; this is not an arbitrary curve solved analytically at every output sample. Signal compression runs sample-by-sample in the worklet, with k-rate control parameters. Main-thread scheduled event ducking remains a separately controlled legacy mode; it is not relabeled as a signal detector.

Stem exports evaluate the complete source project so external keys remain active, then select output tracks. Returns contain only the selected tracks' sends. The tail/frame policy stays shared with the original full-project render. Master processing is optional; nonlinear master processing means independently rendered stems do not necessarily sum to the original mix. This increment does not implement group-bus stem processing or constant-total-memory rendering.

## Executed evidence and limitations

- Two reproduction tests failed on the baseline: same-family percussion tracks had identical musical content, and Full Track stopped at eight tracks.
- A native browser run measured 14.8158dB gain reduction on the declared key fixture; no-key output retained unity. A sustained gain sweep changed decoded PCM.
- A native hardgroove fixture produced 17 actual musical layers, including three procedural atom layers and three signal-key destinations. Its decoded mix and two selected-layer stems were finite/nonzero and exactly 949,082 frames each at 44.1kHz. Those figures describe that seeded eight-bar technical fixture, not a release-quality composition.
- Authoring browser flow passed generated-layer preview/cancel/apply/undo, real-audio instrument audition, selected-phrase edits, stale proposals, phone/landscape reachability and save/reopen. Console error collection was strengthened; intentionally external font requests are fulfilled with an empty stylesheet so offline fallback fonts are used without network-abort console noise.
- Native workspace flow passed at 390×844, 800×360, 900×720 and 1440×1000, including canonical device insertion/undo/reopen and tempo-map editing. Screenshots were inspected locally.
- One native audition run exposed a React update-depth warning from a playhead effect that immediately resubscribed on every beat update. Its effect now follows playback state, while RAF reads the current audio clock. Subsequent authoring run had zero recorded page/console errors.
- An initial new-project history test exceeded the existing five-second deadline after layer expansion. XML clip and mixer projection now share one document and indexed track lookup. Deadlines/tolerances were not increased. Later focused creation tests passed.
- The existing metronome/loop-boundary fixtures exposed an unnecessary unconditional sidechain-channel scan on projects without a sidechain. The production scan is now conditional on active signal compression; the original fixture assertions remain intact.
- Local full regression reached 385/385 across 48 files at the pre-final metadata checkpoint. Later focused persistence/identity/song-plan checks passed after the final ownership changes. Exact-final-source CI/full-regression results are required; the PR/workflow provides the final source identity and outcome.
- Strict TypeScript, correctness ESLint (including public worklet sources), 16 Python verifier tests and production/PWA build passed at their recorded checkpoints. The worklet and kernel are bundled/pre-cached as offline assets.

Reproduction:

```sh
npm ci
npm run lint
npm test -- --maxWorkers=1
python3 -m unittest discover -s scripts -p 'test_*.py'
npm run build
node scripts/slices-browser-check.mjs
node scripts/authoring-review-check.mjs
node scripts/workspace-flow-check.mjs
```

Browser runners require the existing isolated Playwright runtime and a compatible native browser; CI installs it. This session used the official Chrome Headless Shell 151.0.7922.34 after the system Chromium singleton socket was unavailable and the default CDN download was truncated. The official Google-hosted browser archive succeeded. No security boundary or test tolerance was relaxed.

External review tooling was unavailable locally; source/fixture review and regression testing do not substitute for independent review. Physical Android install/upgrade/SAF/focus/fold/lifecycle/load, original missing recovery inputs, licensed Live reopening and independent listening remain unverified. Release remains blocked under the existing authoritative gate ledger.
