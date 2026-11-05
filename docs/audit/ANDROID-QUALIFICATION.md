# Android qualification — BLOCKED

No physical device is available. `command -v adb` found none; ANDROID_HOME/ANDROID_SDK_ROOT are unset; /dev/bus/usb is absent. CI supplies Java21/Android36 for an unqualified debug build. It does not provide hardware qualification or trusted release lineage.

Use the exact final CI artifact/checksum recorded on the PR. Record device model, Android build, form factors, operator, start/end times, APK SHA256, certificate fingerprint, source commit and logs. Application ID is `com.parametricals.technodaw`.

Hardware procedure:

1. Verify APK SHA256, package/manifest and certificate against declared provenance. Use a designated lab device; retain existing project backups. Do not uninstall or clear real user data as a recovery shortcut.
2. Test fresh install on a clean lab profile and upgrade over the prior trusted signed version. `adb install -r <exact.apk>` must succeed without certificate replacement.
3. Capture `adb logcat -v threadtime` and memory snapshots (`adb shell dumpsys meminfo com.parametricals.technodaw`). Launch and create Sketch/Full Track; edit notes, clips, mixer, devices and Session operations; undo/redo; save/close/reopen.
4. Test portrait, landscape, folded/unfolded touch, keyboard/dialog insets, audio permission/focus, interruptions, background/foreground and long sessions.
5. Export short/long WAV through SAF, cancel before/while writing, simulate failed permissions/storage, verify cleanup and original file preservation. Independently decode and listen in an external player. Reopen project and compare canonical state.
6. Record peak/sustained CPU/RAM, elapsed render time and audio glitches under explicit hardware budgets. Retain failures and exact logs.

All steps above are pending. Signing identity/version policy was not changed. Debug artifacts must not be published as production-ready APKs.
