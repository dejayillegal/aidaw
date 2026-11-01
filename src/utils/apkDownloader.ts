/**
 * Triggers a reliable client-side download of the compiled v1+v2 signed Android Debug APK
 * (parametric-techno-daw-debug.apk) with cache-busting to bypass stale Service Worker caches.
 */

export async function downloadDebugApk(
  fileName = 'parametric-techno-daw-debug.apk'
): Promise<{ sizeBytes: number; source: 'prebuilt' }> {
  const endpoints = [
    `/api/download/apk?t=${Date.now()}`,
    `/parametric-techno-daw-debug.apk?t=${Date.now()}`,
  ];

  let apkBlob: Blob | null = null;

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, { cache: 'no-store' });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const header = new Uint8Array(buf.slice(0, 4));
        if (
          header.length === 4 &&
          header[0] === 0x50 &&
          header[1] === 0x4b &&
          header[2] === 0x03 &&
          header[3] === 0x04
        ) {
          apkBlob = new Blob([buf], {
            type: 'application/vnd.android.package-archive',
          });
          break;
        }
      }
    } catch {
      // Try next endpoint
    }
  }

  if (!apkBlob) {
    throw new Error('Failed to fetch compiled Android Debug APK binary.');
  }

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

  return { sizeBytes: apkBlob.size, source: 'prebuilt' };
}
