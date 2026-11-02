#!/usr/bin/env node
/** Gradle is the only APK producer/signing authority. Verify before any distribution write. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const releaseMetadata = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'public/apk-metadata.json'), 'utf8'));
export const APP_ID = 'com.parametricals.technodaw';
export const APP_NAME = 'Parametric ALS DAW';
export const VERSION_NAME = releaseMetadata.versionName;
export const VERSION_CODE = releaseMetadata.versionCode;
export const TARGET_SDK = releaseMetadata.targetSdk;
export const MIN_SDK = releaseMetadata.minSdk;
const artifactRelativePath = 'android/app/build/outputs/apk/debug/app-debug.apk';
export function computeSha256(input) {
  return crypto.createHash('sha256').update(typeof input === 'string' ? fs.readFileSync(input) : input).digest('hex');
}
export function validatePrerequisites() {
  let hasJava = false;
  try { execFileSync('javac', ['-version'], { stdio: 'ignore', timeout: 2000 }); hasJava = true; } catch { /* reported below */ }
  return { hasGradleWrapper: fs.existsSync(path.join(ROOT_DIR, 'android/gradlew')),
    hasPackageJson: fs.existsSync(path.join(ROOT_DIR, 'package.json')),
    hasCapacitorConfig: fs.existsSync(path.join(ROOT_DIR, 'capacitor.config.ts')), hasJava };
}
export function buildWebAssets() { execFileSync('npm', ['run', 'build'], { cwd: ROOT_DIR, stdio: 'inherit' }); }
export function syncCapacitor() {
  // Never copy a previously distributed APK back into a new APK or PWA cache.
  for (const folder of ['dist', 'android/app/src/main/assets/public']) {
    for (const name of ['parametric-techno-daw-debug.apk', 'parametric-techno-daw-debug.apk.sha256']) {
      fs.rmSync(path.join(ROOT_DIR, folder, name), { force: true });
    }
  }
  execFileSync(process.execPath, [path.join(ROOT_DIR, 'node_modules/@capacitor/cli/bin/capacitor'), 'sync', 'android'], { cwd: ROOT_DIR, stdio: 'inherit' });
}
export function runGradleAssemble() {
  const prereqs = validatePrerequisites();
  if (!prereqs.hasJava || !prereqs.hasGradleWrapper) throw new Error('JDK 21 and Gradle wrapper required; no stale APK fallback');
  // Remove previous output before Gradle, even when its prior mtime looks recent.
  fs.rmSync(path.join(ROOT_DIR, 'android/app/build/outputs/apk/debug'), { recursive: true, force: true });
  if (process.platform !== 'win32') fs.chmodSync(path.join(ROOT_DIR, 'android/gradlew'), 0o755);
  execFileSync(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', ['assembleDebug', '--stacktrace'], { cwd: path.join(ROOT_DIR, 'android'), stdio: 'inherit' });
}
export function verifyApkArtifact(apkPath = path.join(ROOT_DIR, artifactRelativePath), rootDir = ROOT_DIR) {
  const args = [path.join(rootDir, 'scripts/verify-apk.py'), apkPath, '--metadata', path.join(rootDir, 'public/apk-metadata.json')];
  if (process.env.ANDROID_DEBUG_CERT_SHA256) args.push('--certificate-sha256', process.env.ANDROID_DEBUG_CERT_SHA256);
  return JSON.parse(execFileSync('python3', args, { cwd: rootDir, encoding: 'utf8' }));
}
export function publishArtifacts(rootDir = ROOT_DIR) {
  const sourceApk = path.join(rootDir, artifactRelativePath);
  if (!fs.existsSync(sourceApk)) throw new Error('Fresh Gradle artifact missing');
  // Verification runs on staging source. A failure cannot overwrite an existing download.
  const report = verifyApkArtifact(sourceApk, rootDir);
  if (!report.certificatePinned) throw new Error('Distribution blocked: ANDROID_DEBUG_CERT_SHA256 trusted baseline required');
  const metadata = { ...JSON.parse(fs.readFileSync(path.join(rootDir, 'public/apk-metadata.json'), 'utf8')),
    ...report, verificationStatus: 'artifact-verified', buildSystem: 'Gradle/Capacitor', buildTimestamp: new Date().toISOString() };
  const apk = fs.readFileSync(sourceApk);
  if (computeSha256(apk) !== report.sha256 || apk.length !== report.sizeBytes) throw new Error('Artifact changed after verification');
  for (const dir of ['public', 'dist']) {
    const target = path.join(rootDir, dir); fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'parametric-techno-daw-debug.apk'), apk);
    fs.writeFileSync(path.join(target, 'parametric-techno-daw-debug.apk.sha256'), `${report.sha256}  parametric-techno-daw-debug.apk\n`);
    // Metadata is written last. Concurrent readers reject inconsistent checksum/size pairs.
    fs.writeFileSync(path.join(target, 'apk-metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
  }
  return { sourceApk, sha256: report.sha256, sizeBytes: report.sizeBytes, metadata };
}
export function orchestrateGradleBuild({ skipWebBuild = false, skipCapSync = false } = {}) {
  if (!skipWebBuild) buildWebAssets();
  if (!skipCapSync) syncCapacitor();
  runGradleAssemble();
  return publishArtifacts();
}
export const buildApk = orchestrateGradleBuild;
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { orchestrateGradleBuild(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
