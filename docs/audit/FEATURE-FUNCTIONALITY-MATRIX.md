# Functional capability and active-flow inventory

Baseline: e6de7f3. Status is complete capability qualification, not compilation. The generated `ui-controls.json` CI artifact inventories every JSX control/handler edge found by scripts/inventory-ui-controls.mjs. An inventory entry is NOT runtime proof. Current workstation styling is retained as the implementation baseline; no separate approved redesign specification or product-owner UX acceptance is available.

| Capability / entry | Dependency chain / expected result | Actual / coverage / status |
|---|---|---|
| Full Track creation / File | dialog → creation service → existing song planner → canonical queue → workstation | Configured seed/tempo/duration and6/7/8 tracks, new identity and persistence verified by targeted unit/browser checks; musical quality corpus incomplete: PARTIAL |
| Sketch creation / File | existing starter → queue/history → editable timeline | Existing path retained; complete workflow/asset qualification: PARTIAL |
| Note velocity/quantization / AI panels | track transforms → command bus → XML → queue/audio | Existing real-browser track workflow retained: PARTIAL complete instrument/per-note coverage |
| Arrange tools / Edit | pointer/grid → canonical edit → history → playback | Existing arrangement editing tests required; all tools/multitouch/layers/tempo cases not proven: PARTIAL |
| Mixer / Mix Console | faders/inserts/VCA → command bus + live preview → graph | Registered browser DSP subset; all parameters/routing not audio-qualified: PARTIAL |
| Devices / Rack | parameter/replace/bypass/restore → validated conversion → factory | Plugin-host runtime absent; explicit replacements required: PARTIAL |
| Scene launch / Session | quantized event decisions → shared scheduler → capture to Arrangement | Existing browser Session checks retained; follow/load/mixed-tempo qualification incomplete: PARTIAL |
| Save/open / File | snapshot validation → canonical state / queue | Real native score/plan/settings round trip; no embedded assets: PARTIAL |
| ALS import/export | gzip/XML → preserved/projected structures | Musical event regression strengthened; native Live runtime absent: PARTIAL |
| WAV download / File | canonical score → shared renderer → download → FFmpeg | Short/64-bar fixtures and new visible export checked; full audio qualification incomplete: PARTIAL |
| File streaming / File | shared renderer → bounded encoder → browser FSA or Android SAF | Existing continuous render/UI checks required; device and sustained memory incomplete: PARTIAL |
| Batch/stems | queue snapshots → mastering/export adapters | Per-project settings tests exist; full stems/failure/cancellation matrix incomplete: PARTIAL |
| Assets / audio tracks | reference resolution → decode → routing/render | Unsupported/missing media may block; portable asset manifests/relink workflow incomplete: PARTIAL |
| AI assistant | model response → validated command and persistence | Requires service availability, reproducible scoped preview and complete supported-device constraints: PARTIAL |
| Reference analysis / mastering | measured audio → suggested settings → render | No independent producer/standards certification: PARTIAL |
| Clear Arrangement / File and sidebar | isolated accessible dialog → command bus → preserved XML/history/queue | Repaired in PR19; cancel, locked tracks, device/source preservation, undo/redo and native reopen checked at desktop/phone sizes; broader media/Session/device coverage: PARTIAL |
| PWA offline/update | service worker → versioned app/assets → recovery | Multiple-tab/cache/schema compatibility not fully exercised: PARTIAL |
| Physical Android | Gradle artifact → install → real touch/audio/lifecycle/export | No attached hardware: BLOCKED |

Legacy-flow decisions in this correction: MIGRATE the modal's direct replacement of the active project to canonical project installation; MIGRATE initial XML queue reparse to native state journaling; REMOVE the unsupported independent form selector and misleading14–19-layer descriptions; RETAIN sketch/template and existing generation engines; RETAIN prior recovery evidence and original plugin XML. No core engine was deleted. Full obsolete-navigation removal remains incomplete.

Timing update (baseline ac0a140): runtime map validation now permits supported step/beat-linear tempo and meter maps. Existing AudioContext anchors remain authoritative. Native synthetic ramp onset/duration checks supplement mathematical integration tests. Session UI launch prediction, continuous automation curve/captured-output parity and all audible device paths remain PARTIAL. Procedural waveform analysis is now explicitly approximate and keyed by timing maps.
