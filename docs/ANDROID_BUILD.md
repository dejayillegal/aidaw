# Parametric ALS DAW — Android Build & Release Engineering Guide

## 1. Architecture Overview
The Android application is built using Capacitor 8 with a native Android Gradle wrapper (`android/gradlew`) targeting Android 14 (API level 34) with minimum SDK level 26 (Android 8.0 Oreo).

- **Application ID:** `com.parametricals.technodaw`
- **Application Name:** Parametric ALS Techno DAW
- **Default Package:** `com.parametricals.technodaw`
- **Launcher Activity:** `com.parametricals.technodaw.MainActivity`
- **Web Runtime:** Self-contained offline Chromium WebView with Web Audio, Web MIDI, and DOM Storage.

## 2. Prerequisites for Local Build
- **Node.js:** 20.x or higher
- **JDK:** OpenJDK 17 (Eclipse Temurin 17 recommended)
- **Android SDK:** Command-line tools, platform API 34, build-tools 34.0.0
- **Python:** 3.10+ (for `scripts/verify-apk.py`)

## 3. Step-by-Step Build Commands

### Step 3.1: Build Production Web Bundle
```bash
npm run build
```
This compiles TypeScript and React components with Tailwind CSS v4 into `dist/`.

### Step 3.2: Synchronize with Capacitor
```bash
npx cap sync android
```
This copies production assets from `dist/` into `android/app/src/main/assets/public/` and updates native plugin configurations.

### Step 3.3: Compile Android Debug APK
```bash
cd android
./gradlew assembleDebug
```
On Windows:
```cmd
gradlew.bat assembleDebug
```
The compiled APK will be output to:
`android/app/build/outputs/apk/debug/app-debug.apk`

### Step 3.4: Verify APK Structure and Signatures
```bash
python3 scripts/verify-apk.py android/app/build/outputs/apk/debug/app-debug.apk
```
This verifies:
- Valid ZIP magic bytes (`0x50 0x4b 0x03 0x04`)
- Compiled `AndroidManifest.xml` (AXML binary)
- Dalvik bytecode `classes.dex`
- `resources.arsc`
- Offline web bundle in `assets/public/`
- Valid APK v1 (JAR) and v2 (APK Sig Block 42) cryptographic signatures

## 4. One-Command Build Script
```bash
npm run build:apk
```
This script executes steps 3.1–3.4 sequentially and publishes the verified artifact to `public/parametric-techno-daw-debug.apk`.

## 5. Automated CI Pipeline
A GitHub Actions workflow is provided in `.github/workflows/android-debug.yml`. Every commit or pull request automatically provisions JDK 17, Android SDK API 34, builds `assembleDebug`, runs `scripts/verify-apk.py`, and uploads the signed APK as an artifact.
