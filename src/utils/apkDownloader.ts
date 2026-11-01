/**
 * Parametric ALS DAW — Verified Android Debug APK Downloader & Project Data Backup
 *
 * Replaces synthetic APK generation with authenticated artifact distribution:
 * 1. Queries published build metadata (/api/apk-metadata or /apk-metadata.json).
 * 2. Fetches the Gradle-built Android Debug APK.
 * 3. Verifies cryptographic SHA-256 checksum and package size.
 * 4. Rejects corrupt or mismatched binaries.
 * 5. Provides safe project data backup export to preserve user work before updates.
 */

export interface ApkMetadata {
  applicationId: string;
  appName: string;
  versionName: string;
  versionCode: number;
  buildVariant: string;
  sha256: string;
  sizeBytes: number;
  targetSdk: number;
  minSdk: number;
  buildTimestamp: string;
  buildSystem: string;
  verificationStatus?: string;
  certificatePinned?: boolean;
}

/**
 * Fetches verified APK metadata from the server or static assets.
 */
export async function fetchApkMetadata(): Promise<ApkMetadata | null> {
  const endpoints = ['/api/apk-metadata', '/apk-metadata.json'];
  for (const ep of endpoints) {
    try {
      const res = await fetch(`${ep}?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        return (await res.json()) as ApkMetadata;
      }
    } catch {
      // Continue to next endpoint
    }
  }
  return null;
}

/**
 * Computes client-side SHA-256 hex digest using Web Crypto API.
 */
export async function computeBufferSha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return '';
}

/**
 * Downloads the pre-built, verified Gradle Android Debug APK.
 */
export async function downloadDebugApk(
  fileName = 'parametric-techno-daw-debug.apk'
): Promise<{
  sizeBytes: number;
  source: 'verified-artifact';
  sha256: string;
  metadata?: ApkMetadata;
}> {
  // 1. Fetch verified build metadata
  const metadata = await fetchApkMetadata();

  if (!metadata || !['artifact-verified', 'verified'].includes(metadata.verificationStatus || '') || !metadata.certificatePinned || !/^[a-f0-9]{64}$/i.test(metadata.sha256)) {
    throw new Error('No certificate-pinned, verified Android artifact is available. Build qualification is pending.');
  }

  // 2. Fetch the APK binary from server endpoints
  const endpoints = [
    `/api/download/apk?t=${Date.now()}`,
    `/parametric-techno-daw-debug.apk?t=${Date.now()}`,
  ];

  let apkBuffer: ArrayBuffer | null = null;
  let serverSha256 = '';

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, { cache: 'no-store' });
      if (res.ok) {
        serverSha256 = res.headers.get('x-apk-sha256') || '';
        const buf = await res.arrayBuffer();
        const header = new Uint8Array(buf.slice(0, 4));
        // Verify standard ZIP magic header 0x50 0x4B 0x03 0x04
        if (
          header.length === 4 &&
          header[0] === 0x50 &&
          header[1] === 0x4b &&
          header[2] === 0x03 &&
          header[3] === 0x04
        ) {
          apkBuffer = buf;
          break;
        }
      }
    } catch {
      // Continue to next endpoint
    }
  }

  if (!apkBuffer) {
    throw new Error('Failed to fetch verified Android Debug APK binary.');
  }

  // 3. Compute client-side SHA-256 checksum
  const computedSha256 = await computeBufferSha256Hex(apkBuffer);

  // 4. Verify against metadata if available
  const expectedSha256 = metadata.sha256;
  if (!computedSha256 || apkBuffer.byteLength !== metadata.sizeBytes) {
    throw new Error('APK checksum capability missing or published size mismatch');
  }
  if (
    expectedSha256 &&
    computedSha256 &&
    expectedSha256.toLowerCase() !== computedSha256.toLowerCase()
  ) {
    throw new Error(
      `APK SHA-256 checksum mismatch! Expected: ${expectedSha256}, Computed: ${computedSha256}. Download aborted for security.`
    );
  }

  // 5. Trigger download of verified binary
  const apkBlob = new Blob([apkBuffer], {
    type: 'application/vnd.android.package-archive',
  });

  const url = URL.createObjectURL(apkBlob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 2000);

  return {
    sizeBytes: apkBlob.size,
    source: 'verified-artifact',
    sha256: computedSha256,
    metadata: metadata || undefined,
  };
}

/**
 * Exports a full JSON backup of the user's projects, MIDI recordings, and settings
 * to protect user data from being lost when updating or reinstalling the application.
 */
export function exportUserDataBackup(
  projectState: any,
  fileName = 'parametric-daw-user-backup.json'
): void {
  const backupPayload = {
    appId: 'com.parametricals.technodaw',
    appName: 'Parametric ALS DAW',
    version: '7.2.0',
    exportTimestamp: new Date().toISOString(),
    project: projectState,
  };

  const blob = new Blob([JSON.stringify(backupPayload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 2000);
}

