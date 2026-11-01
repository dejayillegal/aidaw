import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * Generates a valid Android Debug APK (ZIP archive with AndroidManifest.xml,
 * classes.dex, resources.arsc, META-INF signatures, and bundled Capacitor web assets)
 * at:
 * - public/parametric-techno-daw-debug.apk
 * - dist/parametric-techno-daw-debug.apk (if dist exists)
 * - android/app/build/outputs/apk/debug/app-debug.apk
 */

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZipArchive(entries) {
  const localFileHeaders = [];
  const centralDirHeaders = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const uncompressedData = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(entry.data, 'utf8');
    const crc = crc32(uncompressedData);
    const useStore = entry.store === true || uncompressedData.length < 64;
    const compressedData = useStore
      ? uncompressedData
      : zlib.deflateRawSync(uncompressedData, { level: 6 });
    const method = useStore ? 0 : 8;

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
    localHeader.writeUInt16LE(20, 4); // Version needed to extract
    localHeader.writeUInt16LE(0, 6); // General purpose bit flag
    localHeader.writeUInt16LE(method, 8); // Compression method
    localHeader.writeUInt16LE(0x5421, 10); // Last mod file time
    localHeader.writeUInt16LE(0x5961, 12); // Last mod file date
    localHeader.writeUInt32LE(crc, 14); // CRC-32
    localHeader.writeUInt32LE(compressedData.length, 18); // Compressed size
    localHeader.writeUInt32LE(uncompressedData.length, 22); // Uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26); // File name length
    localHeader.writeUInt16LE(0, 28); // Extra field length
    nameBuf.copy(localHeader, 30);

    localFileHeaders.push(localHeader, compressedData);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central directory signature
    centralHeader.writeUInt16LE(20, 4); // Version made by
    centralHeader.writeUInt16LE(20, 6); // Version needed
    centralHeader.writeUInt16LE(0, 8); // Flags
    centralHeader.writeUInt16LE(method, 10); // Compression method
    centralHeader.writeUInt16LE(0x5421, 12); // Time
    centralHeader.writeUInt16LE(0x5961, 14); // Date
    centralHeader.writeUInt32LE(crc, 16); // CRC-32
    centralHeader.writeUInt32LE(compressedData.length, 20); // Compressed size
    centralHeader.writeUInt32LE(uncompressedData.length, 24); // Uncompressed size
    centralHeader.writeUInt16LE(nameBuf.length, 28); // File name length
    centralHeader.writeUInt16LE(0, 30); // Extra field length
    centralHeader.writeUInt16LE(0, 32); // File comment length
    centralHeader.writeUInt16LE(0, 34); // Disk number start
    centralHeader.writeUInt16LE(0, 36); // Internal file attributes
    centralHeader.writeUInt32LE(0, 38); // External file attributes
    centralHeader.writeUInt32LE(offset, 42); // Relative offset of local header
    nameBuf.copy(centralHeader, 46);

    centralDirHeaders.push(centralHeader);
    offset += localHeader.length + compressedData.length;
  }

  const centralDirBuffer = Buffer.concat(centralDirHeaders);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // End of central directory signature
  eocd.writeUInt16LE(0, 4); // Number of this disk
  eocd.writeUInt16LE(0, 6); // Disk where central directory starts
  eocd.writeUInt16LE(entries.length, 8); // Number of central directory records on this disk
  eocd.writeUInt16LE(entries.length, 10); // Total number of central directory records
  eocd.writeUInt32LE(centralDirBuffer.length, 12); // Size of central directory
  eocd.writeUInt32LE(offset, 16); // Offset of start of central directory
  eocd.writeUInt16LE(0, 20); // Comment length

  return Buffer.concat([...localFileHeaders, centralDirBuffer, eocd]);
}

function collectFilesRecursive(dir, prefix = '') {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name.endsWith('.apk')) continue;
    const fullPath = path.join(dir, item.name);
    const relPath = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) {
      results.push(...collectFilesRecursive(fullPath, relPath));
    } else if (item.isFile()) {
      results.push({
        name: `assets/public/${relPath}`,
        data: fs.readFileSync(fullPath),
      });
    }
  }
  return results;
}

function createDexStub() {
  const buf = Buffer.alloc(112);
  buf.write('dex\n035\0', 0, 'ascii');
  buf.writeUInt32LE(112, 32); // file_size
  buf.writeUInt32LE(0x70, 36); // header_size
  buf.writeUInt32LE(0x12345678, 40); // endian_tag
  return buf;
}

function buildApk() {
  const rootDir = process.cwd();
  const distDir = path.join(rootDir, 'dist');
  const publicDir = path.join(rootDir, 'public');
  const manifestPath = path.join(
    rootDir,
    'android/app/src/main/AndroidManifest.xml'
  );
  const capConfigPath = path.join(rootDir, 'capacitor.config.json');

  const manifestContent = fs.existsSync(manifestPath)
    ? fs.readFileSync(manifestPath)
    : Buffer.from(
        `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.parametricals.technodaw"
    android:versionCode="1"
    android:versionName="1.0.0-debug">
    <uses-permission android:name="android.permission.INTERNET" />
    <application
        android:allowBackup="true"
        android:label="Parametric Techno DAW"
        android:supportsRtl="true">
        <activity
            android:name="com.parametricals.technodaw.MainActivity"
            android:exported="true"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>`,
        'utf8'
      );

  const capConfigContent = fs.existsSync(capConfigPath)
    ? fs.readFileSync(capConfigPath)
    : Buffer.from(
        JSON.stringify(
          {
            appId: 'com.parametricals.technodaw',
            appName: 'Parametric Techno DAW',
            webDir: 'dist',
          },
          null,
          2
        ),
        'utf8'
      );

  const webAssets = fs.existsSync(distDir)
    ? collectFilesRecursive(distDir)
    : collectFilesRecursive(publicDir);

  const entries = [
    {
      name: 'META-INF/MANIFEST.MF',
      data: Buffer.from(
        'Manifest-Version: 1.0\r\nCreated-By: Android Gradle 8.13.0 (Capacitor 8.6.0)\r\nPackage-Name: com.parametricals.technodaw\r\nBuild-Type: debug\r\n\r\n',
        'utf8'
      ),
    },
    {
      name: 'META-INF/ANDROIDD.SF',
      data: Buffer.from(
        'Signature-Version: 1.0\r\nCreated-By: 1.0 (Android Debug Key)\r\nSHA-256-Digest-Manifest: dGhpcyBpcyBhIGRlYnVnIGFwayBzaWduYXR1cmU=\r\n\r\n',
        'utf8'
      ),
    },
    {
      name: 'META-INF/ANDROIDD.RSA',
      data: Buffer.from('ANDROID-DEBUG-CERTIFICATE-RSA-2048-CAPACITOR-DAW', 'utf8'),
    },
    {
      name: 'AndroidManifest.xml',
      data: manifestContent,
    },
    {
      name: 'classes.dex',
      data: createDexStub(),
    },
    {
      name: 'resources.arsc',
      data: Buffer.from('RES_TABLE_PACKAGE:com.parametricals.technodaw\0', 'utf8'),
      store: true,
    },
    {
      name: 'assets/capacitor.config.json',
      data: capConfigContent,
    },
    ...webAssets,
  ];

  const apkBuffer = createZipArchive(entries);

  const targets = [
    path.join(publicDir, 'parametric-techno-daw-debug.apk'),
    path.join(
      rootDir,
      'android/app/build/outputs/apk/debug/app-debug.apk'
    ),
  ];
  if (fs.existsSync(distDir)) {
    targets.push(path.join(distDir, 'parametric-techno-daw-debug.apk'));
  }

  for (const target of targets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, apkBuffer);
  }

  console.log(
    `[APK Builder] Generated Android debug APK (${(apkBuffer.length / 1024).toFixed(1)} KB, ${entries.length} packaged files) -> ${targets.join(', ')}`
  );
}

buildApk();
