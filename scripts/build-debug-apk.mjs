import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filename = 'parametric-techno-daw-debug.apk';
const apk = path.join(root, 'android/app/build/outputs/apk/debug/app-debug.apk');
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status})`);
}

try {
  // Never leave a previous (or fabricated) download advertised after a failed build.
  for (const dir of ['public', 'dist']) {
    for (const name of [filename, 'android-apk.json']) {
      fs.rmSync(path.join(root, dir, name), { force: true });
    }
  }
  fs.rmSync(apk, { force: true });
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk || !fs.existsSync(path.join(sdk, 'platforms/android-36/android.jar'))) {
    throw new Error('Android SDK 36 is required. Set ANDROID_HOME to your SDK directory. See docs/ANDROID_BUILD.md.');
  }
  const javaCommand = process.env.JAVA_HOME
    ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
  const java = spawnSync(javaCommand, ['-version'], { encoding: 'utf8' });
  const major = Number(`${java.stderr}${java.stdout}`.match(/version "(\d+)/)?.[1]);
  if (java.error || major < 21 || !major) throw new Error('JDK 21 or newer is required by Capacitor 8.');
  run(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build']);
  run(process.execPath, [path.join(root, 'node_modules/@capacitor/cli/bin/capacitor'), 'sync', 'android']);
  const androidDir = path.join(root, 'android');
  if (process.platform === 'win32') {
    run('cmd.exe', ['/d', '/c', 'gradlew.bat', ':app:assembleDebug', ':app:assembleDebugAndroidTest', '--console=plain'], androidDir);
  } else {
    run('bash', ['gradlew', ':app:assembleDebug', ':app:assembleDebugAndroidTest', '--console=plain'], androidDir);
  }
  run(process.platform === 'win32' ? 'python' : 'python3', [path.join(root, 'scripts/verify-apk.py'), apk]);
  const data = fs.readFileSync(apk);
  const metadata = JSON.stringify({ filename, applicationId: 'com.parametricals.technodaw',
    sizeBytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }, null, 2) + '\n';
  // Publish only after Android's own verifier accepts the package.
  for (const dir of ['public', 'dist']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.copyFileSync(apk, path.join(root, dir, filename));
    fs.writeFileSync(path.join(root, dir, 'android-apk.json'), metadata);
  }
  console.log(`Verified debug APK: ${apk} (${data.length} bytes)`);
} catch (error) {
  console.error(`[APK build failed] ${error.message}`);
  process.exitCode = 1;
}
