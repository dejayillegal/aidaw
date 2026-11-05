# Shared signal measurement — implementation and verification

Baseline: main `9dff77ab0789c8400abbe0893883dc52b65f0e79`, after owner-merged PR26. This milestone addresses named audio-measurement defects; it does not promote the full G0–G8 gates.

## Reproduced defects and implementation

Two initial regressions failed on the old meter: quiet inter-sample peaks were treated as sample peaks, and nonfinite PCM returned plausible-looking levels. The old implementation skipped interpolation below an amplitude threshold, used cubic interpolation and omitted boundary/tail processing. Unequal channels were silently truncated. Reference analysis separately estimated loudness from left-channel RMS and true peak from a fixed multiplier, ignored right-channel-only audio, and clamped readings to an arbitrary range.

The shared mono/stereo meter now scans every frame, applies K-weighting and 400ms gates with 75% overlap, corrects the RLB numerator gain, and reconstructs peaks with a windowed-sinc FIR. Oversampling is at least4x and reaches at least192kHz (8x at44.1kHz). History and zero-padded filter tails retain boundary peaks. Sample rate, channel layout, lengths and finite input validate explicitly. Float headroom is preserved. The RMS is the channel-mean energy; crest uses true peak minus RMS. Clipping counts frames with any channel at/above full scale, once per frame.

Auxiliary memory holds a400ms energy ring, small filter histories and one energy value per100ms gating step; it no longer allocates two full-track K-weighted PCM copies. The synchronous export API remains available. Reference analysis and Stage-B calibration use a cooperative path that preserves filter/gate state and yields every4096 frames, with cancellation support in the async meter.

Reference loudness/peak use this shared meter. Clips shorter than400ms and absolute-gated silence expose unavailable integrated loudness rather than advertising a fallback value as measured. Legacy reports are labeled estimates until reanalysis. The old dynamic-range number remains an explicitly labeled orchestration heuristic, not EBU LRA. Tempo/band/structure/layer/groove descriptors remain creative heuristics, and key/scale remains a suggested palette; this milestone does not claim their detection is implemented.

Two-pass mastering no longer claims loudness compliance when a requested target cannot be verified. A final measured peak guard attenuates inter-sample overshoot linearly; the sample-domain limiter is not described as lookahead. A target that conflicts with the resulting loudness remains noncompliant.

## Executed checks and limits

| Check | Result |
|---|---|
| Initial old-meter reproductions | FAIL as expected: quiet inter-sample peak; nonfinite rejection |
| Targeted meter/reference/master-ceiling regressions | PASS:2 files,11 tests |
| Independent FFmpeg ebur128 comparisons | PASS:25 cases; maximum loudness difference0.04 LU and peak difference0.22dB on the tested corpus |
| Native Chrome151 decoded12-second right-only Float32 WAV | PASS:−23.0 LUFS,−20.0dBTP;120 timer ticks, maximum gap62.9ms against100ms budget; cancellation/retry pass |
| Initial local default5-second full-suite watchdog | FAIL:10 timeouts;362 other tests passed at that checkpoint |
| Unchanged-main isolation check at the same default watchdog | FAIL:5 timeouts in the two sampled legacy recovery/workstation files, confirming the local baseline also exceeds that deadline |
| Full local serial regression with explicit20-second test watchdog | Pending at this checkpoint; not a performance budget or a changed repository/CI timeout |
| Final exact-source GitHub workflow | Required; PR run is authoritative |

The first native responsiveness attempt reported102ms under overlapping local load; chunk size was reduced from8192 to4096 and the subsequent run passed. The missing default local Chromium download could not be installed from its truncated archive; the executed run uses the available native Chrome151 executable explicitly. No physical Android result is inferred.

The FFmpeg checker records its executable version, raw numbers and timing in `evidence/signal-metrics/independent-ffmpeg.json`. It enforces0.1LU and0.35dB comparison budgets without widening them on failure. The corpus covers44.1/48/96kHz, mono/stereo/right-only/antiphase, quiet quarter-rate inter-sample tones, near-Nyquist tones, relative gating, over-unity PCM, deterministic noise, multitone audio, file-edge impulses, silence and short input. Both implementations receive explicit100ms zero guards because FFmpeg's resampler extrapolates unguarded file edges differently. This boundary convention is part of the comparison scope, not a claim that arbitrary external meters must agree at an unguarded file edge.

CI now requires both independent FFmpeg comparison and native decoded-reference responsiveness checks. Existing audio, recovery, editing, Session, authoring, export and APK checks remain required. Browser reports are synthetic fixtures, not original user data.

## Standards and remaining acceptance

Implementation reference: [ITU-R BS.1770-5, Annexes1–2](https://www.itu.int/rec/R-REC-BS.1770-5-202311-I). These tested mono/stereo results are not BS.2217/EBU conformance certification. Full EBU Loudness Range and momentary/short-term metering, multichannel weighting/layouts, the complete official conformance suite, decoded post-encode normalization targets, all wet/live/capture paths and hardware output remain open. Synchronous two-pass mastering and the other legacy reference heuristics still need their separate long-file responsiveness and correctness work.

Samplers/racks/warp/routing/assets, composition corpus/listening, sustained32-track performance, cross-version recovery and physical Android/licensed Live/signing acceptance remain open under G0-G8-TRACEABILITY.md. Release remains BLOCKED. Promote only the named measured subchecks after exact-source CI succeeds.
