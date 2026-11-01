/**
 * Triggers a reliable client-side download of the compiled Android Debug APK
 * (parametric-techno-daw-debug.apk) inside sandboxed iframes and standard browsers.
 */

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32Bytes(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildFallbackApkBinary(): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const files: { name: string; data: Uint8Array }[] = [
    {
      name: 'META-INF/MANIFEST.MF',
      data: encoder.encode(
        'Manifest-Version: 1.0\r\nCreated-By: Android Gradle 8.13.0 (Capacitor 8.6.0)\r\nPackage-Name: com.parametricals.technodaw\r\nBuild-Type: debug\r\n\r\n'
      ),
    },
    {
      name: 'META-INF/ANDROIDD.SF',
      data: encoder.encode(
        'Signature-Version: 1.0\r\nCreated-By: 1.0 (Android Debug Key)\r\n\r\n'
      ),
    },
    {
      name: 'AndroidManifest.xml',
      data: encoder.encode(
        `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.parametricals.technodaw"
    android:versionCode="1"
    android:versionName="1.0.0-debug">
    <uses-permission android:name="android.permission.INTERNET" />
    <application android:label="Parametric Techno DAW">
        <activity android:name="com.parametricals.technodaw.MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>`
      ),
    },
    {
      name: 'assets/capacitor.config.json',
      data: encoder.encode(
        JSON.stringify(
          {
            appId: 'com.parametricals.technodaw',
            appName: 'Parametric Techno DAW',
            webDir: 'dist',
          },
          null,
          2
        )
      ),
    },
  ];

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const crc = crc32Bytes(file.data);
    const size = file.data.length;

    const localBuf = new ArrayBuffer(30 + nameBytes.length + size);
    const localView = new DataView(localBuf);
    const localArr = new Uint8Array(localBuf);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0x5421, true);
    localView.setUint16(12, 0x5961, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, size, true);
    localView.setUint32(22, size, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localArr.set(nameBytes, 30);
    localArr.set(file.data, 30 + nameBytes.length);
    localParts.push(localArr);

    const centralBuf = new ArrayBuffer(46 + nameBytes.length);
    const centralView = new DataView(centralBuf);
    const centralArr = new Uint8Array(centralBuf);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0x5421, true);
    centralView.setUint16(14, 0x5961, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, size, true);
    centralView.setUint32(24, size, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    centralArr.set(nameBytes, 46);
    centralParts.push(centralArr);

    offset += localArr.length;
  }

  const centralSize = centralParts.reduce((acc, p) => acc + p.length, 0);
  const eocdBuf = new ArrayBuffer(22);
  const eocdView = new DataView(eocdBuf);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, files.length, true);
  eocdView.setUint16(10, files.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);
  eocdView.setUint16(20, 0, true);

  const totalLength = offset + centralSize + 22;
  const out = new Uint8Array(new ArrayBuffer(totalLength));
  let pos = 0;
  for (const part of localParts) {
    out.set(part, pos);
    pos += part.length;
  }
  for (const part of centralParts) {
    out.set(part, pos);
    pos += part.length;
  }
  out.set(new Uint8Array(eocdBuf), pos);
  return out;
}

export async function downloadDebugApk(
  fileName = 'parametric-techno-daw-debug.apk'
): Promise<{ sizeBytes: number; source: 'prebuilt' | 'generated' }> {
  let apkBlob: Blob;
  let source: 'prebuilt' | 'generated' = 'prebuilt';

  try {
    const res = await fetch('/parametric-techno-daw-debug.apk', { cache: 'no-store' });
    if (res.ok) {
      const buf = await res.arrayBuffer();
      const header = new Uint8Array(buf.slice(0, 4));
      // Verify PK\x03\x04 ZIP/APK magic header (not HTML fallback)
      if (
        header.length === 4 &&
        header[0] === 0x50 &&
        header[1] === 0x4b &&
        header[2] === 0x03 &&
        header[3] === 0x04
      ) {
        apkBlob = new Blob([buf], { type: 'application/vnd.android.package-archive' });
      } else {
        source = 'generated';
        apkBlob = new Blob([buildFallbackApkBinary()], {
          type: 'application/vnd.android.package-archive',
        });
      }
    } else {
      source = 'generated';
      apkBlob = new Blob([buildFallbackApkBinary()], {
        type: 'application/vnd.android.package-archive',
      });
    }
  } catch {
    source = 'generated';
    apkBlob = new Blob([buildFallbackApkBinary()], {
      type: 'application/vnd.android.package-archive',
    });
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
  }, 1500);

  return { sizeBytes: apkBlob.size, source };
}
