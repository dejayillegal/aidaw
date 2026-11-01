# Android debug build

The old APK generator packaged text placeholders in a ZIP. Those files could not
be installed. APKs now come only from Android Gradle Plugin's `assembleDebug`.
The application ID remains `com.parametricals.technodaw` (Android 7 / API 24+).

## Build

Install Node 24, JDK 21, Python 3 and Android SDK Platform 36 / Build Tools 36.0.0.
Set `JAVA_HOME` and `ANDROID_HOME`. Do not commit `android/local.properties`.

```sh
npm ci
npm run test:apk
npm run build:apk
```

`npm run build` builds only the website and needs no Android SDK.
`npm run build:apk` builds fresh web assets, runs Capacitor sync, compiles the
launcher/Capacitor runtime/resources, debug-signs via Gradle, then checks the
signature with `apksigner`, alignment with `zipalign`, launcher with `aapt`, and
bundled web assets. Failure exits nonzero; it never fabricates a fallback APK.
The checksum is an integrity check, not a substitute for Android signature validation.

Outputs after successful verification:

- `android/app/build/outputs/apk/debug/app-debug.apk`
- `public/parametric-techno-daw-debug.apk` and `public/android-apk.json`
- matching files in `dist/` for website deployment

The APK is copied after Capacitor sync, so it is never bundled inside itself.
Build and deploy the APK and its JSON together to enable the web download button.
Web-only deployment without them reports unavailable instead of downloading a fake.

## GitHub Actions

Open Actions → Android Debug APK. Each successful run provides the
`parametric-techno-daw-debug` artifact. Download and extract the ZIP, then install
its `.apk` file. An Actions artifact ZIP is not itself an APK.
The workflow tests a real emulator installation, offline React startup, Web Audio
rendering and gzip roundtrip. These checks do not certify every DAW workflow or
physical-device audio latency. AI generation retains the existing local fallback;
server-only features still need a separately hosted backend.

```sh
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -W -n com.parametricals.technodaw/.MainActivity
```

Gradle creates a development signing key on the build machine. A build from a
different machine may use a different key: Android will reject an in-place update
with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. To retain app data, use the same key.
Uninstalling the old package permits a fresh install but deletes its app data.
No uninstall or app-data reset is performed by the build script.
