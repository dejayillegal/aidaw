/** Download only the Gradle-built package published with its checksum metadata. */
export async function downloadDebugApk(
  fileName = 'parametric-techno-daw-debug.apk'
): Promise<{ sizeBytes: number; source: 'prebuilt' }> {
  const unavailable = 'Android APK is unavailable. Download a successful Android Debug APK build from GitHub Actions.';
  let data: ArrayBuffer;
  try {
    const response = await fetch('/parametric-techno-daw-debug.apk', { cache: 'no-store' });
    if (!response.ok) throw new Error(unavailable);
    data = await response.arrayBuffer();
    const header = new Uint8Array(data, 0, Math.min(4, data.byteLength));
    if (header.length !== 4 || header[0] !== 0x50 || header[1] !== 0x4b || header[2] !== 3 || header[3] !== 4) {
      throw new Error('Invalid APK response. No file was downloaded.');
    }
    const metadataResponse = await fetch('/android-apk.json', { cache: 'no-store' });
    if (!metadataResponse.ok) throw new Error(unavailable);
    const metadata = await metadataResponse.json();
    if (metadata.applicationId !== 'com.parametricals.technodaw' || metadata.sizeBytes !== data.byteLength ||
        !/^[a-f0-9]{64}$/.test(metadata.sha256)) throw new Error('APK metadata is invalid.');
    const digest = await crypto.subtle.digest('SHA-256', data);
    const actual = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    if (actual !== metadata.sha256) throw new Error('APK checksum failed. No file was downloaded.');
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : unavailable);
  }
  const blob = new Blob([data], { type: 'application/vnd.android.package-archive' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => { anchor.remove(); URL.revokeObjectURL(url); }, 1500);
  return { sizeBytes: blob.size, source: 'prebuilt' };
}
