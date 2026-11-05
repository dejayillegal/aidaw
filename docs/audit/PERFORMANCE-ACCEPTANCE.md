# Performance acceptance

Targets: ordinary feedback p95≤100ms; timeline/roll frame p95≤16.7ms on a declared60Hz reference device; no recurring editing frames above50ms; no detected application-induced playback dropouts in supported stress fixtures; no unexplained resource growth. No global no-lag claim is qualified.

Clear dialog probe: scripts/clear-arrangement-check.mjs measures pointerdown on the visible File→Clear action until the next animation frame after native dialog opening. It excludes automation transport latency.21 observations per viewport; desktop1440×900 and phone360×640; native Chromium153.0.8010.0 in this container. This is cloud UI evidence, not physical60Hz Android or output-latency qualification.

Initial App-owned dialog state produced p95≈133.6ms desktop/117.3ms phone: FAIL against100ms. The correction isolates transient dialog state so opening it does not rerender the entire workstation. Retain both raw reports; do not discard the initial failed result or loosen the target. Functional tests and timing status are reported separately.

Still required: declared physical hardware/OS/WebView/audio buffers and thermal conditions; 8/16/32-track fixtures; pointer-to-paint and frame distributions; React commits/long tasks; scheduling drift/dropouts; heap plus whole-browser/native RSS; import/save/reopen/export latency; sustained sessions and lifecycle transitions. The earlier short-stream desktop RSS near629MB means the256MiB preflight estimate is not a process-memory guarantee.
