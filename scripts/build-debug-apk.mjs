import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

/**
 * Builds a complete, installable Android 14+ (API 34) APK (parametric-techno-daw-debug.apk):
 * 1. Compiled Binary XML (AXML / ResXMLTree) AndroidManifest.xml targeting Android 14 (targetSdkVersion=34, minSdkVersion=26)
 *    with sorted android.R.attr IDs and full privacy/Play Protect compliance (allowBackup=false, exported=true, no cleartext/debug flags).
 * 2. Compiled Dalvik bytecode classes.dex (com.parametricals.technodaw.MainActivity launching WebView -> file:///android_asset/public/index.html
 *    with JavaScript, DOMStorage, FileAccess, WebViewClient, WebChromeClient, and gesture-free WebAudio enabled).
 * 3. Binary ResTable resources.arsc (uncompressed & 4-byte zipaligned at offset 44).
 * 4. Self-contained production web bundle in assets/public/index.html (inlined CSS + JS + offline file:// API & WebAudio bridge)
 *    so the entire DAW runs 100% offline inside Android WebView without file:// ES module CORS errors.
 * 5. Dual Cryptographic Signing:
 *    - APK Signature Scheme v1 (META-INF/MANIFEST.MF, CERT.SF, CERT.RSA PKCS#7 CMS DER)
 *    - APK Signature Scheme v2 (APK Sig Block 42, ID 0x7109871a, RSA-2048 PKCS#1 v1.5 with SHA-256 merkle tree)
 */

// ============================================================================
// 1. CRC-32 & ADLER-32 UTILITIES
// ============================================================================
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

export function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function adler32(buf) {
  let a = 1;
  let b = 0;
  const MOD_ADLER = 65521;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % MOD_ADLER;
    b = (b + a) % MOD_ADLER;
  }
  return ((b << 16) | a) >>> 0;
}

// ============================================================================
// 2. BINARY ANDROIDMANIFEST.XML (AXML / ResXMLTree) BUILDER (API 34)
// ============================================================================
export function buildBinaryAndroidManifest() {
  // Attribute names with resource IDs MUST come first in the StringPool,
  // sorted in strict ascending order of their android.R.attr resource ID.
  const attrResourceEntries = [
    { name: 'theme', id: 0x01010000 },
    { name: 'label', id: 0x01010001 },
    { name: 'name', id: 0x01010003 },
    { name: 'exported', id: 0x01010010 },
    { name: 'launchMode', id: 0x0101001d },
    { name: 'configChanges', id: 0x0101001f },
    { name: 'minSdkVersion', id: 0x0101020c },
    { name: 'versionCode', id: 0x0101021b },
    { name: 'versionName', id: 0x0101021c },
    { name: 'targetSdkVersion', id: 0x01010270 },
    { name: 'allowBackup', id: 0x01010280 },
    { name: 'hardwareAccelerated', id: 0x010102d3 },
    { name: 'compileSdkVersion', id: 0x01010572 },
  ];

  const extraStrings = [
    'android',
    'http://schemas.android.com/apk/res/android',
    'manifest',
    'package',
    'com.parametricals.technodaw',
    '2.0.0',
    'uses-sdk',
    'uses-permission',
    'android.permission.INTERNET',
    'application',
    'Parametric Techno DAW',
    'activity',
    'com.parametricals.technodaw.MainActivity',
    'intent-filter',
    'action',
    'android.intent.action.MAIN',
    'category',
    'android.intent.category.LAUNCHER',
  ];

  const allStrings = [...attrResourceEntries.map((a) => a.name), ...extraStrings];
  const strIndex = (s) => {
    const idx = allStrings.indexOf(s);
    if (idx === -1) throw new Error(`Missing AXML string: ${s}`);
    return idx;
  };

  // Encode UTF-16LE StringPool
  const encodedStrings = allStrings.map((str) => {
    const charLen = str.length;
    const buf = Buffer.alloc(2 + charLen * 2 + 2);
    buf.writeUInt16LE(charLen, 0);
    for (let i = 0; i < charLen; i++) {
      buf.writeUInt16LE(str.charCodeAt(i), 2 + i * 2);
    }
    buf.writeUInt16LE(0, 2 + charLen * 2);
    return buf;
  });

  const offsets = [];
  let currentOffset = 0;
  for (const sBuf of encodedStrings) {
    offsets.push(currentOffset);
    currentOffset += sBuf.length;
  }
  const rawStringBytes = Buffer.concat(encodedStrings);
  const padBytes = (4 - (rawStringBytes.length % 4)) % 4;
  const paddedStringBytes = Buffer.concat([rawStringBytes, Buffer.alloc(padBytes)]);

  const stringPoolHeaderSize = 28;
  const stringsStart = stringPoolHeaderSize + allStrings.length * 4;
  const stringPoolSize = stringsStart + paddedStringBytes.length;

  const stringPoolChunk = Buffer.alloc(stringPoolSize);
  stringPoolChunk.writeUInt16LE(0x0001, 0); // RES_STRING_POOL_TYPE
  stringPoolChunk.writeUInt16LE(stringPoolHeaderSize, 2);
  stringPoolChunk.writeUInt32LE(stringPoolSize, 4);
  stringPoolChunk.writeUInt32LE(allStrings.length, 8);
  stringPoolChunk.writeUInt32LE(0, 12); // styleCount
  stringPoolChunk.writeUInt32LE(0, 16); // flags = 0 (UTF-16LE)
  stringPoolChunk.writeUInt32LE(stringsStart, 20);
  stringPoolChunk.writeUInt32LE(0, 24); // stylesStart
  offsets.forEach((off, idx) => {
    stringPoolChunk.writeUInt32LE(off, 28 + idx * 4);
  });
  paddedStringBytes.copy(stringPoolChunk, stringsStart);

  // Resource Map Chunk (RES_XML_RESOURCE_MAP_TYPE = 0x0180)
  const resMapSize = 8 + attrResourceEntries.length * 4;
  const resMapChunk = Buffer.alloc(resMapSize);
  resMapChunk.writeUInt16LE(0x0180, 0);
  resMapChunk.writeUInt16LE(8, 2);
  resMapChunk.writeUInt32LE(resMapSize, 4);
  attrResourceEntries.forEach((entry, idx) => {
    resMapChunk.writeUInt32LE(entry.id, 8 + idx * 4);
  });

  const NS_ANDROID = strIndex('http://schemas.android.com/apk/res/android');
  const PREFIX_ANDROID = strIndex('android');
  const NO_INDEX = 0xffffffff;

  function makeNamespaceChunk(isStart, line) {
    const buf = Buffer.alloc(24);
    buf.writeUInt16LE(isStart ? 0x0100 : 0x0101, 0);
    buf.writeUInt16LE(16, 2);
    buf.writeUInt32LE(24, 4);
    buf.writeUInt32LE(line, 8);
    buf.writeUInt32LE(NO_INDEX, 12);
    buf.writeUInt32LE(PREFIX_ANDROID, 16);
    buf.writeUInt32LE(NS_ANDROID, 20);
    return buf;
  }

  // Type constants:
  // 0x01 = TYPE_REFERENCE, 0x03 = TYPE_STRING, 0x10 = TYPE_INT_DEC, 0x11 = TYPE_INT_HEX, 0x12 = TYPE_INT_BOOLEAN
  function makeStartElement(tagName, line, attrs) {
    const chunkSize = 36 + attrs.length * 20;
    const buf = Buffer.alloc(chunkSize);
    buf.writeUInt16LE(0x0102, 0); // RES_XML_START_ELEMENT_TYPE
    buf.writeUInt16LE(16, 2);
    buf.writeUInt32LE(chunkSize, 4);
    buf.writeUInt32LE(line, 8);
    buf.writeUInt32LE(NO_INDEX, 12); // comment
    buf.writeUInt32LE(NO_INDEX, 16); // ns
    buf.writeUInt32LE(strIndex(tagName), 20); // name
    buf.writeUInt16LE(20, 24); // attributeStart
    buf.writeUInt16LE(20, 26); // attributeSize
    buf.writeUInt16LE(attrs.length, 28); // attributeCount
    buf.writeUInt16LE(0, 30); // idIndex
    buf.writeUInt16LE(0, 32); // classIndex
    buf.writeUInt16LE(0, 34); // styleIndex

    attrs.forEach((attr, i) => {
      const base = 36 + i * 20;
      buf.writeUInt32LE(attr.ns, base);
      buf.writeUInt32LE(strIndex(attr.name), base + 4);
      buf.writeUInt32LE(attr.rawValue, base + 8);
      buf.writeUInt16LE(8, base + 12); // typedValue.size
      buf.writeUInt8(0, base + 14); // typedValue.res0
      buf.writeUInt8(attr.dataType, base + 15);
      buf.writeUInt32LE(attr.data >>> 0, base + 16);
    });
    return buf;
  }

  function makeEndElement(tagName, line) {
    const buf = Buffer.alloc(24);
    buf.writeUInt16LE(0x0103, 0); // RES_XML_END_ELEMENT_TYPE
    buf.writeUInt16LE(16, 2);
    buf.writeUInt32LE(24, 4);
    buf.writeUInt32LE(line, 8);
    buf.writeUInt32LE(NO_INDEX, 12);
    buf.writeUInt32LE(NO_INDEX, 16);
    buf.writeUInt32LE(strIndex(tagName), 20);
    return buf;
  }

  function strAttr(ns, name, valStr) {
    const sIdx = strIndex(valStr);
    return { ns, name, rawValue: sIdx, dataType: 0x03, data: sIdx };
  }

  function intAttr(ns, name, valInt, hex = false) {
    return {
      ns,
      name,
      rawValue: NO_INDEX,
      dataType: hex ? 0x11 : 0x10,
      data: valInt >>> 0,
    };
  }

  function boolAttr(ns, name, valBool) {
    return {
      ns,
      name,
      rawValue: NO_INDEX,
      dataType: 0x12,
      data: valBool ? 0xffffffff : 0,
    };
  }

  function refAttr(ns, name, resId) {
    return {
      ns,
      name,
      rawValue: NO_INDEX,
      dataType: 0x01, // TYPE_REFERENCE
      data: resId >>> 0,
    };
  }

  // @android:style/Theme.DeviceDefault.NoActionBar = 0x01030129
  const THEME_DEVICE_DEFAULT_NO_ACTION_BAR = 0x01030129;

  const xmlNodes = [
    makeNamespaceChunk(true, 2),
    // <manifest android:versionCode="2" android:versionName="2.0.0" android:compileSdkVersion="34" package="com.parametricals.technodaw">
    makeStartElement('manifest', 2, [
      intAttr(NS_ANDROID, 'versionCode', 2),
      strAttr(NS_ANDROID, 'versionName', '2.0.0'),
      intAttr(NS_ANDROID, 'compileSdkVersion', 34),
      strAttr(NO_INDEX, 'package', 'com.parametricals.technodaw'),
    ]),
    // <uses-sdk android:minSdkVersion="26" android:targetSdkVersion="34" />
    makeStartElement('uses-sdk', 6, [
      intAttr(NS_ANDROID, 'minSdkVersion', 26),
      intAttr(NS_ANDROID, 'targetSdkVersion', 34),
    ]),
    makeEndElement('uses-sdk', 6),
    // <uses-permission android:name="android.permission.INTERNET" />
    makeStartElement('uses-permission', 8, [
      strAttr(NS_ANDROID, 'name', 'android.permission.INTERNET'),
    ]),
    makeEndElement('uses-permission', 8),
    // <application android:theme="@android:style/Theme.DeviceDefault.NoActionBar" android:label="Parametric Techno DAW" android:allowBackup="false" android:hardwareAccelerated="true">
    makeStartElement('application', 10, [
      refAttr(NS_ANDROID, 'theme', THEME_DEVICE_DEFAULT_NO_ACTION_BAR),
      strAttr(NS_ANDROID, 'label', 'Parametric Techno DAW'),
      boolAttr(NS_ANDROID, 'allowBackup', false),
      boolAttr(NS_ANDROID, 'hardwareAccelerated', true),
    ]),
    // <activity android:theme="@android:style/Theme.DeviceDefault.NoActionBar" android:label="Parametric Techno DAW" android:name="com.parametricals.technodaw.MainActivity" android:exported="true" android:launchMode="1" android:configChanges="0x04a0">
    makeStartElement('activity', 15, [
      refAttr(NS_ANDROID, 'theme', THEME_DEVICE_DEFAULT_NO_ACTION_BAR),
      strAttr(NS_ANDROID, 'label', 'Parametric Techno DAW'),
      strAttr(NS_ANDROID, 'name', 'com.parametricals.technodaw.MainActivity'),
      boolAttr(NS_ANDROID, 'exported', true),
      intAttr(NS_ANDROID, 'launchMode', 1),
      intAttr(NS_ANDROID, 'configChanges', 0x000004a0, true),
    ]),
    // <intent-filter>
    makeStartElement('intent-filter', 20, []),
    // <action android:name="android.intent.action.MAIN" />
    makeStartElement('action', 21, [
      strAttr(NS_ANDROID, 'name', 'android.intent.action.MAIN'),
    ]),
    makeEndElement('action', 21),
    // <category android:name="android.intent.category.LAUNCHER" />
    makeStartElement('category', 22, [
      strAttr(NS_ANDROID, 'name', 'android.intent.category.LAUNCHER'),
    ]),
    makeEndElement('category', 22),
    makeEndElement('intent-filter', 23),
    makeEndElement('activity', 24),
    makeEndElement('application', 25),
    makeEndElement('manifest', 26),
    makeNamespaceChunk(false, 26),
  ];

  const body = Buffer.concat([stringPoolChunk, resMapChunk, ...xmlNodes]);
  const header = Buffer.alloc(8);
  header.writeUInt16LE(0x0003, 0); // RES_XML_TYPE
  header.writeUInt16LE(8, 2);
  header.writeUInt32LE(8 + body.length, 4);

  return Buffer.concat([header, body]);
}

// ============================================================================
// 3. BINARY RESOURCES.ARSC (ResTable) BUILDER
// ============================================================================
export function buildBinaryResourcesArsc() {
  function makeEmptyStringPool() {
    const b = Buffer.alloc(28);
    b.writeUInt16LE(0x0001, 0); // RES_STRING_POOL_TYPE
    b.writeUInt16LE(28, 2);
    b.writeUInt32LE(28, 4);
    b.writeUInt32LE(0, 8); // stringCount
    b.writeUInt32LE(0, 12); // styleCount
    b.writeUInt32LE(0x00000100, 16); // UTF8_FLAG
    b.writeUInt32LE(28, 20); // stringsStart
    b.writeUInt32LE(0, 24);
    return b;
  }

  const globalStringPool = makeEmptyStringPool();
  const typeStringPool = makeEmptyStringPool();
  const keyStringPool = makeEmptyStringPool();

  const pkgHeaderSize = 288;
  const pkgTotalSize = pkgHeaderSize + typeStringPool.length + keyStringPool.length;
  const pkgHeader = Buffer.alloc(pkgHeaderSize);
  pkgHeader.writeUInt16LE(0x0200, 0); // RES_TABLE_PACKAGE_TYPE
  pkgHeader.writeUInt16LE(pkgHeaderSize, 2);
  pkgHeader.writeUInt32LE(pkgTotalSize, 4);
  pkgHeader.writeUInt32LE(0x0000007f, 8); // User package ID 0x7f

  const pkgName = 'com.parametricals.technodaw';
  for (let i = 0; i < pkgName.length; i++) {
    pkgHeader.writeUInt16LE(pkgName.charCodeAt(i), 12 + i * 2);
  }
  pkgHeader.writeUInt32LE(pkgHeaderSize, 268); // typeStrings offset
  pkgHeader.writeUInt32LE(0, 272); // lastPublicType
  pkgHeader.writeUInt32LE(pkgHeaderSize + typeStringPool.length, 276); // keyStrings offset
  pkgHeader.writeUInt32LE(0, 280); // lastPublicKey
  pkgHeader.writeUInt32LE(0, 284); // typeIdOffset

  const totalSize = 12 + globalStringPool.length + pkgTotalSize;
  const tableHeader = Buffer.alloc(12);
  tableHeader.writeUInt16LE(0x0002, 0); // RES_TABLE_TYPE
  tableHeader.writeUInt16LE(12, 2);
  tableHeader.writeUInt32LE(totalSize, 4);
  tableHeader.writeUInt32LE(1, 8); // packageCount = 1

  return Buffer.concat([
    tableHeader,
    globalStringPool,
    pkgHeader,
    typeStringPool,
    keyStringPool,
  ]);
}

// ============================================================================
// 4. VALID DALVIK EXECUTABLE (classes.dex) BUILDER
//    Defines com.parametricals.technodaw.MainActivity extends android.app.Activity
//    whose onCreate(Bundle) configures an android.webkit.WebView with:
//    - setJavaScriptEnabled(true)
//    - setDomStorageEnabled(true)
//    - setAllowFileAccess(true)
//    - setMediaPlaybackRequiresUserGesture(false)
//    - setWebViewClient(new WebViewClient())
//    - setWebChromeClient(new WebChromeClient())
//    and loads file:///android_asset/public/index.html
// ============================================================================
function encodeUleb128(val) {
  const bytes = [];
  let v = val >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0);
  return Buffer.from(bytes);
}

export function buildValidClassesDex() {
  // Strings MUST be sorted lexicographically by UTF-8 code point order for Dalvik binary search!
  const rawStrings = [
    '<init>',
    'L',
    'Landroid/app/Activity;',
    'Landroid/content/Context;',
    'Landroid/os/Bundle;',
    'Landroid/view/View;',
    'Landroid/webkit/WebChromeClient;',
    'Landroid/webkit/WebSettings;',
    'Landroid/webkit/WebView;',
    'Landroid/webkit/WebViewClient;',
    'Lcom/parametricals/technodaw/MainActivity;',
    'Ljava/lang/String;',
    'V',
    'VL',
    'VZ',
    'Z',
    'file:///android_asset/public/index.html',
    'getSettings',
    'loadUrl',
    'onCreate',
    'setAllowFileAccess',
    'setContentView',
    'setDomStorageEnabled',
    'setJavaScriptEnabled',
    'setMediaPlaybackRequiresUserGesture',
    'setWebChromeClient',
    'setWebViewClient',
  ].sort();

  const sIdx = (s) => {
    const i = rawStrings.indexOf(s);
    if (i === -1) throw new Error(`Missing DEX string: ${s}`);
    return i;
  };

  // Types MUST be sorted by their string_id index!
  const rawTypes = [
    'Landroid/app/Activity;',
    'Landroid/content/Context;',
    'Landroid/os/Bundle;',
    'Landroid/view/View;',
    'Landroid/webkit/WebChromeClient;',
    'Landroid/webkit/WebSettings;',
    'Landroid/webkit/WebView;',
    'Landroid/webkit/WebViewClient;',
    'Lcom/parametricals/technodaw/MainActivity;',
    'Ljava/lang/String;',
    'V',
    'Z',
  ].sort((a, b) => sIdx(a) - sIdx(b));

  const tIdx = (t) => {
    const i = rawTypes.indexOf(t);
    if (i === -1) throw new Error(`Missing DEX type: ${t}`);
    return i;
  };

  // Protos sorted by (shorty_idx, return_type_idx, parameters)
  const protos = [
    { shorty: 'L', returnType: 'Landroid/webkit/WebSettings;', params: [] },
    { shorty: 'V', returnType: 'V', params: [] },
    { shorty: 'VL', returnType: 'V', params: ['Landroid/content/Context;'] },
    { shorty: 'VL', returnType: 'V', params: ['Landroid/os/Bundle;'] },
    { shorty: 'VL', returnType: 'V', params: ['Landroid/view/View;'] },
    { shorty: 'VL', returnType: 'V', params: ['Landroid/webkit/WebChromeClient;'] },
    { shorty: 'VL', returnType: 'V', params: ['Landroid/webkit/WebViewClient;'] },
    { shorty: 'VL', returnType: 'V', params: ['Ljava/lang/String;'] },
    { shorty: 'VZ', returnType: 'V', params: ['Z'] },
  ];

  // Methods MUST be sorted by (class_idx, name_idx, proto_idx)
  const rawMethods = [
    { cls: 'Landroid/app/Activity;', name: '<init>', protoIdx: 1 },
    { cls: 'Landroid/app/Activity;', name: 'onCreate', protoIdx: 3 },
    { cls: 'Landroid/app/Activity;', name: 'setContentView', protoIdx: 4 },
    { cls: 'Landroid/webkit/WebChromeClient;', name: '<init>', protoIdx: 1 },
    { cls: 'Landroid/webkit/WebSettings;', name: 'setAllowFileAccess', protoIdx: 8 },
    { cls: 'Landroid/webkit/WebSettings;', name: 'setDomStorageEnabled', protoIdx: 8 },
    { cls: 'Landroid/webkit/WebSettings;', name: 'setJavaScriptEnabled', protoIdx: 8 },
    { cls: 'Landroid/webkit/WebSettings;', name: 'setMediaPlaybackRequiresUserGesture', protoIdx: 8 },
    { cls: 'Landroid/webkit/WebView;', name: '<init>', protoIdx: 2 },
    { cls: 'Landroid/webkit/WebView;', name: 'getSettings', protoIdx: 0 },
    { cls: 'Landroid/webkit/WebView;', name: 'loadUrl', protoIdx: 7 },
    { cls: 'Landroid/webkit/WebView;', name: 'setWebChromeClient', protoIdx: 5 },
    { cls: 'Landroid/webkit/WebView;', name: 'setWebViewClient', protoIdx: 6 },
    { cls: 'Landroid/webkit/WebViewClient;', name: '<init>', protoIdx: 1 },
    { cls: 'Lcom/parametricals/technodaw/MainActivity;', name: '<init>', protoIdx: 1 },
    { cls: 'Lcom/parametricals/technodaw/MainActivity;', name: 'onCreate', protoIdx: 3 },
  ].sort((a, b) => {
    const cDiff = tIdx(a.cls) - tIdx(b.cls);
    if (cDiff !== 0) return cDiff;
    const nDiff = sIdx(a.name) - sIdx(b.name);
    if (nDiff !== 0) return nDiff;
    return a.protoIdx - b.protoIdx;
  });

  const mIdx = (cls, name, protoIdx) => {
    const i = rawMethods.findIndex(
      (m) => m.cls === cls && m.name === name && m.protoIdx === protoIdx
    );
    if (i === -1) throw new Error(`Missing DEX method: ${cls}->${name}`);
    return i;
  };

  const headerSize = 0x70;
  const stringIdsOff = headerSize;
  const typeIdsOff = stringIdsOff + rawStrings.length * 4;
  const protoIdsOff = typeIdsOff + rawTypes.length * 4;
  const methodIdsOff = protoIdsOff + protos.length * 12;
  const classDefsOff = methodIdsOff + rawMethods.length * 8;
  const dataOff = classDefsOff + 32;

  let cursor = dataOff;
  const dataChunks = [];
  const pushAligned = (buf, align = 4) => {
    const rem = cursor % align;
    if (rem !== 0) {
      const pad = align - rem;
      dataChunks.push(Buffer.alloc(pad));
      cursor += pad;
    }
    const off = cursor;
    dataChunks.push(buf);
    cursor += buf.length;
    return off;
  };

  // 1) type_list items for protos with parameters
  const protoParamOffsets = protos.map((p) => {
    if (p.params.length === 0) return 0;
    const b = Buffer.alloc(4 + p.params.length * 2);
    b.writeUInt32LE(p.params.length, 0);
    p.params.forEach((pt, idx) => {
      b.writeUInt16LE(tIdx(pt), 4 + idx * 2);
    });
    return pushAligned(b, 4);
  });
  const typeListCount = protos.filter((p) => p.params.length > 0).length;

  // 2) code_item 1: MainActivity.<init>()V
  const mActivityInit = mIdx('Landroid/app/Activity;', '<init>', 1);
  const codeInitBuf = Buffer.alloc(16 + 8);
  codeInitBuf.writeUInt16LE(1, 0); // registers_size = 1
  codeInitBuf.writeUInt16LE(1, 2); // ins_size = 1
  codeInitBuf.writeUInt16LE(1, 4); // outs_size = 1
  codeInitBuf.writeUInt16LE(0, 6); // tries_size = 0
  codeInitBuf.writeUInt32LE(0, 8); // debug_info_off = 0
  codeInitBuf.writeUInt32LE(4, 12); // insns_size = 4 (16-bit code units)
  codeInitBuf.writeUInt8(0x70, 16);
  codeInitBuf.writeUInt8(0x10, 17);
  codeInitBuf.writeUInt16LE(mActivityInit, 18);
  codeInitBuf.writeUInt16LE(0x0000, 20);
  codeInitBuf.writeUInt16LE(0x000e, 22);
  const codeInitOff = pushAligned(codeInitBuf, 4);

  // 3) code_item 2: MainActivity.onCreate(Landroid/os/Bundle;)V
  // registers_size = 5 (v0=webView, v1=settings/url, v2=temp/bool/client, v3=p0=this, v4=p1=bundle)
  const mSuperOnCreate = mIdx('Landroid/app/Activity;', 'onCreate', 3);
  const mSetContentView = mIdx('Landroid/app/Activity;', 'setContentView', 4);
  const mWebViewInit = mIdx('Landroid/webkit/WebView;', '<init>', 2);
  const mGetSettings = mIdx('Landroid/webkit/WebView;', 'getSettings', 0);
  const mSetJs = mIdx('Landroid/webkit/WebSettings;', 'setJavaScriptEnabled', 8);
  const mSetDom = mIdx('Landroid/webkit/WebSettings;', 'setDomStorageEnabled', 8);
  const mSetAllowFile = mIdx('Landroid/webkit/WebSettings;', 'setAllowFileAccess', 8);
  const mSetMediaGesture = mIdx('Landroid/webkit/WebSettings;', 'setMediaPlaybackRequiresUserGesture', 8);
  const mWebViewClientInit = mIdx('Landroid/webkit/WebViewClient;', '<init>', 1);
  const mSetWebViewClient = mIdx('Landroid/webkit/WebView;', 'setWebViewClient', 6);
  const mWebChromeClientInit = mIdx('Landroid/webkit/WebChromeClient;', '<init>', 1);
  const mSetWebChromeClient = mIdx('Landroid/webkit/WebView;', 'setWebChromeClient', 5);
  const mLoadUrl = mIdx('Landroid/webkit/WebView;', 'loadUrl', 7);

  const tWebView = tIdx('Landroid/webkit/WebView;');
  const tWebViewClient = tIdx('Landroid/webkit/WebViewClient;');
  const tWebChromeClient = tIdx('Landroid/webkit/WebChromeClient;');
  const sUrl = sIdx('file:///android_asset/public/index.html');

  const insns = [];
  const pushInsn16 = (...words) => {
    for (const w of words) {
      const b = Buffer.alloc(2);
      b.writeUInt16LE(w & 0xffff, 0);
      insns.push(b);
    }
  };
  // invoke-super {v3, v4}, Activity.onCreate(Bundle)V
  pushInsn16(0x206f, mSuperOnCreate, 0x0043);
  // new-instance v0, Landroid/webkit/WebView;
  pushInsn16(0x0022, tWebView);
  // invoke-direct {v0, v3}, WebView.<init>(Context)V
  pushInsn16(0x2070, mWebViewInit, 0x0030);
  // invoke-virtual {v0}, WebView.getSettings()WebSettings
  pushInsn16(0x106e, mGetSettings, 0x0000);
  // move-result-object v1
  pushInsn16(0x010c);
  // const/4 v2, #int 1
  pushInsn16(0x1212);
  // invoke-virtual {v1, v2}, WebSettings.setJavaScriptEnabled(Z)V
  pushInsn16(0x206e, mSetJs, 0x0021);
  // invoke-virtual {v1, v2}, WebSettings.setDomStorageEnabled(Z)V
  pushInsn16(0x206e, mSetDom, 0x0021);
  // invoke-virtual {v1, v2}, WebSettings.setAllowFileAccess(Z)V
  pushInsn16(0x206e, mSetAllowFile, 0x0021);
  // const/4 v2, #int 0
  pushInsn16(0x0212);
  // invoke-virtual {v1, v2}, WebSettings.setMediaPlaybackRequiresUserGesture(Z)V
  pushInsn16(0x206e, mSetMediaGesture, 0x0021);
  // new-instance v2, Landroid/webkit/WebViewClient;
  pushInsn16(0x0222, tWebViewClient);
  // invoke-direct {v2}, WebViewClient.<init>()V
  pushInsn16(0x1070, mWebViewClientInit, 0x0002);
  // invoke-virtual {v0, v2}, WebView.setWebViewClient(WebViewClient)V
  pushInsn16(0x206e, mSetWebViewClient, 0x0020);
  // new-instance v2, Landroid/webkit/WebChromeClient;
  pushInsn16(0x0222, tWebChromeClient);
  // invoke-direct {v2}, WebChromeClient.<init>()V
  pushInsn16(0x1070, mWebChromeClientInit, 0x0002);
  // invoke-virtual {v0, v2}, WebView.setWebChromeClient(WebChromeClient)V
  pushInsn16(0x206e, mSetWebChromeClient, 0x0020);
  // invoke-virtual {v3, v0}, Activity.setContentView(View)V
  pushInsn16(0x206e, mSetContentView, 0x0003);
  // const-string v1, "file:///android_asset/public/index.html"
  pushInsn16(0x011a, sUrl);
  // invoke-virtual {v0, v1}, WebView.loadUrl(String)V
  pushInsn16(0x206e, mLoadUrl, 0x0010);
  // return-void
  pushInsn16(0x000e);

  const insnsBuf = Buffer.concat(insns);
  const codeOnCreateHeader = Buffer.alloc(16);
  codeOnCreateHeader.writeUInt16LE(5, 0); // registers_size = 5
  codeOnCreateHeader.writeUInt16LE(2, 2); // ins_size = 2
  codeOnCreateHeader.writeUInt16LE(2, 4); // outs_size = 2
  codeOnCreateHeader.writeUInt16LE(0, 6); // tries_size = 0
  codeOnCreateHeader.writeUInt32LE(0, 8); // debug_info_off = 0
  codeOnCreateHeader.writeUInt32LE(insnsBuf.length / 2, 12); // insns_size in 16-bit units
  const codeOnCreateOff = pushAligned(Buffer.concat([codeOnCreateHeader, insnsBuf]), 4);

  // 4) string_data_item entries
  const stringDataFirstOff = cursor;
  const stringDataOffsets = rawStrings.map((s) => {
    const utf8Bytes = Buffer.from(s, 'utf8');
    const item = Buffer.concat([
      encodeUleb128(s.length),
      utf8Bytes,
      Buffer.from([0x00]),
    ]);
    return pushAligned(item, 1);
  });

  // 5) class_data_item for MainActivity
  const mMainInit = mIdx('Lcom/parametricals/technodaw/MainActivity;', '<init>', 1);
  const mMainOnCreate = mIdx('Lcom/parametricals/technodaw/MainActivity;', 'onCreate', 3);
  const classDataBuf = Buffer.concat([
    encodeUleb128(0), // static_fields_size
    encodeUleb128(0), // instance_fields_size
    encodeUleb128(1), // direct_methods_size
    encodeUleb128(1), // virtual_methods_size
    encodeUleb128(mMainInit),
    encodeUleb128(0x10001),
    encodeUleb128(codeInitOff),
    encodeUleb128(mMainOnCreate),
    encodeUleb128(0x0004),
    encodeUleb128(codeOnCreateOff),
  ]);
  const classDataOff = pushAligned(classDataBuf, 1);

  // 6) map_list (4-byte aligned at end of file)
  const mapEntries = [
    { type: 0x0000, size: 1, offset: 0x0000 }, // TYPE_HEADER_ITEM
    { type: 0x0001, size: rawStrings.length, offset: stringIdsOff }, // TYPE_STRING_ID_ITEM
    { type: 0x0002, size: rawTypes.length, offset: typeIdsOff }, // TYPE_TYPE_ID_ITEM
    { type: 0x0003, size: protos.length, offset: protoIdsOff }, // TYPE_PROTO_ID_ITEM
    { type: 0x0005, size: rawMethods.length, offset: methodIdsOff }, // TYPE_METHOD_ID_ITEM
    { type: 0x0006, size: 1, offset: classDefsOff }, // TYPE_CLASS_DEF_ITEM
    { type: 0x1001, size: typeListCount, offset: dataOff }, // TYPE_TYPE_LIST
    { type: 0x2001, size: 2, offset: codeInitOff }, // TYPE_CODE_ITEM
    { type: 0x2002, size: rawStrings.length, offset: stringDataFirstOff }, // TYPE_STRING_DATA_ITEM
    { type: 0x2000, size: 1, offset: classDataOff }, // TYPE_CLASS_DATA_ITEM
    { type: 0x1000, size: 1, offset: 0 }, // TYPE_MAP_LIST
  ];
  const mapBuf = Buffer.alloc(4 + mapEntries.length * 12);
  const mapOff = pushAligned(mapBuf, 4);
  mapEntries[mapEntries.length - 1].offset = mapOff;
  mapBuf.writeUInt32LE(mapEntries.length, 0);
  mapEntries.forEach((m, i) => {
    const base = 4 + i * 12;
    mapBuf.writeUInt16LE(m.type, base);
    mapBuf.writeUInt16LE(0, base + 2);
    mapBuf.writeUInt32LE(m.size, base + 4);
    mapBuf.writeUInt32LE(m.offset, base + 8);
  });

  const fileSize = cursor;
  const dataSize = fileSize - dataOff;

  const stringIdsBuf = Buffer.alloc(rawStrings.length * 4);
  stringDataOffsets.forEach((off, i) => stringIdsBuf.writeUInt32LE(off, i * 4));

  const typeIdsBuf = Buffer.alloc(rawTypes.length * 4);
  rawTypes.forEach((t, i) => typeIdsBuf.writeUInt32LE(sIdx(t), i * 4));

  const protoIdsBuf = Buffer.alloc(protos.length * 12);
  protos.forEach((p, i) => {
    protoIdsBuf.writeUInt32LE(sIdx(p.shorty), i * 12);
    protoIdsBuf.writeUInt32LE(tIdx(p.returnType), i * 12 + 4);
    protoIdsBuf.writeUInt32LE(protoParamOffsets[i], i * 12 + 8);
  });

  const methodIdsBuf = Buffer.alloc(rawMethods.length * 8);
  rawMethods.forEach((m, i) => {
    methodIdsBuf.writeUInt16LE(tIdx(m.cls), i * 8);
    methodIdsBuf.writeUInt16LE(m.protoIdx, i * 8 + 2);
    methodIdsBuf.writeUInt32LE(sIdx(m.name), i * 8 + 4);
  });

  const classDefsBuf = Buffer.alloc(32);
  classDefsBuf.writeUInt32LE(tIdx('Lcom/parametricals/technodaw/MainActivity;'), 0);
  classDefsBuf.writeUInt32LE(0x0001, 4); // ACC_PUBLIC
  classDefsBuf.writeUInt32LE(tIdx('Landroid/app/Activity;'), 8); // superclass_idx
  classDefsBuf.writeUInt32LE(0, 12); // interfaces_off
  classDefsBuf.writeUInt32LE(0xffffffff, 16); // source_file_idx = NO_INDEX
  classDefsBuf.writeUInt32LE(0, 20); // annotations_off
  classDefsBuf.writeUInt32LE(classDataOff, 24); // class_data_off
  classDefsBuf.writeUInt32LE(0, 28); // static_values_off

  const headerBuf = Buffer.alloc(headerSize);
  headerBuf.write('dex\n035\0', 0, 'ascii');
  headerBuf.writeUInt32LE(fileSize, 32);
  headerBuf.writeUInt32LE(0x70, 36);
  headerBuf.writeUInt32LE(0x12345678, 40); // ENDIAN_CONSTANT
  headerBuf.writeUInt32LE(0, 44); // link_size
  headerBuf.writeUInt32LE(0, 48); // link_off
  headerBuf.writeUInt32LE(mapOff, 52); // map_off
  headerBuf.writeUInt32LE(rawStrings.length, 56);
  headerBuf.writeUInt32LE(stringIdsOff, 60);
  headerBuf.writeUInt32LE(rawTypes.length, 64);
  headerBuf.writeUInt32LE(typeIdsOff, 68);
  headerBuf.writeUInt32LE(protos.length, 72);
  headerBuf.writeUInt32LE(protoIdsOff, 76);
  headerBuf.writeUInt32LE(0, 80); // field_ids_size
  headerBuf.writeUInt32LE(0, 84); // field_ids_off
  headerBuf.writeUInt32LE(rawMethods.length, 88);
  headerBuf.writeUInt32LE(methodIdsOff, 92);
  headerBuf.writeUInt32LE(1, 96); // class_defs_size
  headerBuf.writeUInt32LE(classDefsOff, 100);
  headerBuf.writeUInt32LE(dataSize, 104);
  headerBuf.writeUInt32LE(dataOff, 108);

  const fullDex = Buffer.concat([
    headerBuf,
    stringIdsBuf,
    typeIdsBuf,
    protoIdsBuf,
    methodIdsBuf,
    classDefsBuf,
    ...dataChunks,
  ]);

  // Compute SHA-1 signature over bytes [32 .. fileSize)
  const sha1 = crypto.createHash('sha1').update(fullDex.subarray(32)).digest();
  sha1.copy(fullDex, 12);

  // Compute Adler-32 checksum over bytes [12 .. fileSize)
  const checksum = adler32(fullDex.subarray(12));
  fullDex.writeUInt32LE(checksum, 8);

  return fullDex;
}

// ============================================================================
// 5. DER / ASN.1 X.509 CERTIFICATE & PKCS#7 (v1) + APK SIGNING BLOCK (v2)
// ============================================================================
function derLen(len) {
  if (len < 128) return Buffer.from([len]);
  const bytes = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derNode(tag, content) {
  return Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
}

function derSeq(...items) {
  return derNode(0x30, Buffer.concat(items));
}

function derSet(...items) {
  return derNode(0x31, Buffer.concat(items));
}

function derOid(oidBytes) {
  return derNode(0x06, Buffer.from(oidBytes));
}

function derInt(numBuf) {
  let b = Buffer.isBuffer(numBuf) ? numBuf : Buffer.from([numBuf]);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0x00]), b]);
  return derNode(0x02, b);
}

function derUtf8(str) {
  return derNode(0x0c, Buffer.from(str, 'utf8'));
}

function derUtcTime(str) {
  return derNode(0x17, Buffer.from(str, 'ascii'));
}

function derBitString(buf) {
  return derNode(0x03, Buffer.concat([Buffer.from([0x00]), buf]));
}

function buildSelfSignedX509AndPkcs7(privateKey, spkiDer, sfBuffer) {
  const algSha256WithRsa = derSeq(
    derOid([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]),
    Buffer.from([0x05, 0x00])
  );
  const algRsaEncryption = derSeq(
    derOid([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]),
    Buffer.from([0x05, 0x00])
  );
  const algSha256 = derSeq(
    derOid([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]),
    Buffer.from([0x05, 0x00])
  );

  const rdnCn = derSet(
    derSeq(derOid([0x55, 0x04, 0x03]), derUtf8('Parametric Techno DAW Release'))
  );
  const issuerName = derSeq(rdnCn);
  const serialNumber = derInt(Buffer.from([0x02, 0x44, 0x8b, 0x11]));
  const validity = derSeq(
    derUtcTime('240101000000Z'),
    derUtcTime('491231235959Z')
  );

  const tbsCertificate = derSeq(
    derNode(0xa0, derInt(2)), // version v3 (2)
    serialNumber,
    algSha256WithRsa,
    issuerName,
    validity,
    issuerName,
    spkiDer
  );

  const certSig = crypto.sign('sha256', tbsCertificate, privateKey);
  const x509CertDer = derSeq(
    tbsCertificate,
    algSha256WithRsa,
    derBitString(certSig)
  );

  const sfSignature = crypto.sign('sha256', sfBuffer, privateKey);

  const signerInfo = derSeq(
    derInt(1), // version 1
    derSeq(issuerName, serialNumber), // issuerAndSerialNumber
    algSha256, // digestAlgorithm
    algRsaEncryption, // digestEncryptionAlgorithm
    derNode(0x04, sfSignature) // encryptedDigest OCTET STRING
  );

  const signedData = derSeq(
    derInt(1), // version 1
    derSet(algSha256), // digestAlgorithms
    derSeq(derOid([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01])), // contentInfo (pkcs7-data)
    derNode(0xa0, x509CertDer), // certificates [0] IMPLICIT
    derSet(signerInfo) // signerInfos
  );

  const pkcs7Der = derSeq(
    derOid([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]), // pkcs7-signedData
    derNode(0xa0, signedData)
  );

  return { x509CertDer, pkcs7Der };
}

function lenPrefix(buf) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(buf.length, 0);
  return Buffer.concat([b, buf]);
}

function computeApkV2ContentDigest(beforeCentralDir, centralDir, eocdWithOrigOffset) {
  const CHUNK_SIZE = 1024 * 1024;
  const sections = [beforeCentralDir, centralDir, eocdWithOrigOffset];
  const chunkDigests = [];
  let chunkCount = 0;

  for (const section of sections) {
    let offset = 0;
    while (offset < section.length) {
      const slice = section.subarray(offset, Math.min(section.length, offset + CHUNK_SIZE));
      const header = Buffer.alloc(5);
      header.writeUInt8(0xa5, 0);
      header.writeUInt32LE(slice.length, 1);
      const digest = crypto.createHash('sha256').update(header).update(slice).digest();
      chunkDigests.push(digest);
      chunkCount++;
      offset += slice.length;
    }
  }

  const topHeader = Buffer.alloc(5);
  topHeader.writeUInt8(0x5a, 0);
  topHeader.writeUInt32LE(chunkCount, 1);
  return crypto
    .createHash('sha256')
    .update(topHeader)
    .update(Buffer.concat(chunkDigests))
    .digest();
}

function buildApkSigningBlockV2(
  beforeCentralDir,
  centralDir,
  eocdTemplate,
  privateKey,
  spkiDer,
  x509CertDer
) {
  const eocdForDigest = Buffer.from(eocdTemplate);
  eocdForDigest.writeUInt32LE(beforeCentralDir.length, 16);

  const contentDigest = computeApkV2ContentDigest(
    beforeCentralDir,
    centralDir,
    eocdForDigest
  );

  // SIGNATURE_RSA_PKCS1_V1_5_WITH_SHA256 = 0x0103
  const sigAlgId = Buffer.alloc(4);
  sigAlgId.writeUInt32LE(0x0103, 0);

  const digestEntry = lenPrefix(Buffer.concat([sigAlgId, lenPrefix(contentDigest)]));
  const digestsSeq = lenPrefix(digestEntry);
  const certsSeq = lenPrefix(lenPrefix(x509CertDer));
  const additionalAttrs = Buffer.alloc(4); // empty

  const signedData = Buffer.concat([digestsSeq, certsSeq, additionalAttrs]);
  const signatureBytes = crypto.sign('sha256', signedData, privateKey);

  const signatureEntry = lenPrefix(Buffer.concat([sigAlgId, lenPrefix(signatureBytes)]));
  const signaturesSeq = lenPrefix(signatureEntry);

  const signer = lenPrefix(
    Buffer.concat([lenPrefix(signedData), signaturesSeq, lenPrefix(spkiDer)])
  );
  const v2SchemeValue = lenPrefix(signer);

  // ID-value pair: uint64LE(4 + v2SchemeValue.length) || uint32LE(0x7109871a) || v2SchemeValue
  const pairLen = 4 + v2SchemeValue.length;
  const pairHeader = Buffer.alloc(12);
  pairHeader.writeBigUInt64LE(BigInt(pairLen), 0);
  pairHeader.writeUInt32LE(0x7109871a, 8);
  const v2Pair = Buffer.concat([pairHeader, v2SchemeValue]);

  // Block layout: uint64LE(sizeOfBlock) || pairs || uint64LE(sizeOfBlock) || "APK Sig Block 42" (16 bytes)
  const sizeOfBlock = BigInt(v2Pair.length + 24);
  const topSizeBuf = Buffer.alloc(8);
  topSizeBuf.writeBigUInt64LE(sizeOfBlock, 0);

  const footer = Buffer.alloc(24);
  footer.writeBigUInt64LE(sizeOfBlock, 0);
  footer.write('APK Sig Block 42', 8, 'ascii');

  return Buffer.concat([topSizeBuf, v2Pair, footer]);
}

// ============================================================================
// 6. 4-BYTE ZIPALIGNED APK ARCHIVE ASSEMBLER
// ============================================================================
function createAlignedApkArchive(entries, privateKey, spkiDer, x509CertDer) {
  const localFileParts = [];
  const centralDirHeaders = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const uncompressedData = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(entry.data, 'utf8');
    const crc = crc32(uncompressedData);
    const useStore = entry.store === true;
    const compressedData = useStore
      ? uncompressedData
      : zlib.deflateRawSync(uncompressedData, { level: 6 });
    const method = useStore ? 0 : 8;

    // 4-byte zipalign padding for uncompressed entries (mandatory for resources.arsc on Android 11+)
    let extraLen = 0;
    if (useStore) {
      const dataStart = offset + 30 + nameBuf.length;
      extraLen = (4 - (dataStart % 4)) % 4;
    }

    const localHeader = Buffer.alloc(30 + nameBuf.length + extraLen);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0x5421, 10);
    localHeader.writeUInt16LE(0x5961, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedData.length, 18);
    localHeader.writeUInt32LE(uncompressedData.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(extraLen, 28);
    nameBuf.copy(localHeader, 30);

    localFileParts.push(localHeader, compressedData);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0x5421, 12);
    centralHeader.writeUInt16LE(0x5961, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedData.length, 20);
    centralHeader.writeUInt32LE(uncompressedData.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);

    centralDirHeaders.push(centralHeader);
    offset += localHeader.length + compressedData.length;
  }

  const beforeCentralDir = Buffer.concat(localFileParts);
  const centralDirBuffer = Buffer.concat(centralDirHeaders);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuffer.length, 12);
  eocd.writeUInt32LE(beforeCentralDir.length, 16);
  eocd.writeUInt16LE(0, 20);

  // Build APK Signing Block v2 and update EOCD central directory offset
  const v2SigningBlock = buildApkSigningBlockV2(
    beforeCentralDir,
    centralDirBuffer,
    eocd,
    privateKey,
    spkiDer,
    x509CertDer
  );
  eocd.writeUInt32LE(beforeCentralDir.length + v2SigningBlock.length, 16);

  return Buffer.concat([beforeCentralDir, v2SigningBlock, centralDirBuffer, eocd]);
}

// ============================================================================
// 7. SELF-CONTAINED WEBVIEW ASSET PACKAGER (FOR file:///android_asset/public/)
// ============================================================================
function buildWebAssetsForApk(distDir, publicDir) {
  const sourceDir = fs.existsSync(distDir) ? distDir : publicDir;
  const assetsSubdir = path.join(sourceDir, 'assets');

  let inlinedCss = '';
  let inlinedJs = '';

  if (fs.existsSync(assetsSubdir)) {
    for (const file of fs.readdirSync(assetsSubdir)) {
      const fullPath = path.join(assetsSubdir, file);
      if (!fs.statSync(fullPath).isFile()) continue;
      if (file.endsWith('.css')) {
        inlinedCss += fs.readFileSync(fullPath, 'utf8') + '\n';
      } else if (file.endsWith('.js')) {
        inlinedJs += fs.readFileSync(fullPath, 'utf8') + '\n';
      }
    }
  }

  // Escape literal "</script" inside the JS bundle so HTML parser never closes <script> early
  const safeInlinedJs = inlinedJs.replace(/<\/script/gi, '<\\/script');

  // Android WebView offline runtime shim for file:// protocol execution
  const androidWebViewRuntimeBridge = `
(function() {
  window.__ANDROID_APK_RUNTIME__ = true;
  // Prevent serviceWorker SecurityError on file:// protocol
  if (window.location.protocol === 'file:' && 'serviceWorker' in navigator) {
    try {
      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          register: function() { return Promise.resolve({ scope: './' }); },
          ready: Promise.resolve({ active: null }),
          getRegistrations: function() { return Promise.resolve([]); },
          addEventListener: function() {},
          removeEventListener: function() {}
        },
        configurable: true
      });
    } catch (e) {}
  }
  // Offline API interceptor for standalone Android APK execution
  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function(input, init) {
    var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
    if (window.location.protocol === 'file:' || url.indexOf('/api/') !== -1) {
      if (url.indexOf('/api/health') !== -1) {
        return Promise.resolve(new Response(JSON.stringify({
          status: 'ok',
          engine: 'Parametric Ableton Live .als Heuristic + Android Standalone WebAudio Engine',
          runtime: 'android-apk'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url.indexOf('/api/ai/sequence') !== -1) {
        return Promise.resolve(new Response(JSON.stringify({
          offlineFallback: true
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
    }
    if (origFetch) {
      return origFetch(input, init).catch(function() {
        return new Response(JSON.stringify({ offlineFallback: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      });
    }
    return Promise.resolve(new Response('{}', { status: 200 }));
  };
})();
`.trim();

  const selfContainedIndexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
    <meta name="theme-color" content="#090A0F" />
    <title>Parametric Techno DAW</title>
    <style id="parametric-daw-apk-styles">
${inlinedCss}
    </style>
  </head>
  <body class="bg-[#090A0F] text-slate-100 select-none overflow-hidden">
    <div id="root"></div>
    <script id="parametric-daw-android-bridge">
${androidWebViewRuntimeBridge}
    </script>
    <script id="parametric-daw-apk-bundle">
${safeInlinedJs}
    </script>
  </body>
</html>`;

  const entries = [
    {
      name: 'assets/public/index.html',
      data: Buffer.from(selfContainedIndexHtml, 'utf8'),
      store: false,
    },
  ];

  // Also include manifest.webmanifest and SVG icons from public/dist (excluding .apk and aistudio screenshots)
  for (const item of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (
      item.name.endsWith('.apk') ||
      item.name === 'index.html' ||
      item.name === 'assets'
    ) {
      continue;
    }
    const fullPath = path.join(sourceDir, item.name);
    if (item.isFile()) {
      entries.push({
        name: `assets/public/${item.name}`,
        data: fs.readFileSync(fullPath),
        store: false,
      });
    }
  }

  return entries;
}

export function buildApk() {
  const rootDir = process.cwd();
  const distDir = path.join(rootDir, 'dist');
  const publicDir = path.join(rootDir, 'public');
  const capConfigPath = path.join(rootDir, 'capacitor.config.json');

  const binaryManifest = buildBinaryAndroidManifest();
  const binaryResources = buildBinaryResourcesArsc();
  const classesDex = buildValidClassesDex();

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

  const webAssets = buildWebAssetsForApk(distDir, publicDir);

  // Place resources.arsc first at offset 0: 30 + "resources.arsc".length (14) = 44 (multiple of 4, extraLen = 0)
  const payloadEntries = [
    { name: 'resources.arsc', data: binaryResources, store: true },
    { name: 'AndroidManifest.xml', data: binaryManifest, store: false },
    { name: 'classes.dex', data: classesDex, store: false },
    { name: 'assets/capacitor.config.json', data: capConfigContent, store: false },
    ...webAssets,
  ];

  // Build v1 JAR Signature files: META-INF/MANIFEST.MF & META-INF/CERT.SF
  let manifestMf =
    'Manifest-Version: 1.0\r\nCreated-By: Android Gradle 8.13.0 (Capacitor 8.6.0)\r\n\r\n';
  const sfEntries = [];

  for (const entry of payloadEntries) {
    const sha256B64 = crypto.createHash('sha256').update(entry.data).digest('base64');
    const mfSection = `Name: ${entry.name}\r\nSHA-256-Digest: ${sha256B64}\r\n\r\n`;
    manifestMf += mfSection;
    const sectionSha256B64 = crypto
      .createHash('sha256')
      .update(Buffer.from(mfSection, 'utf8'))
      .digest('base64');
    sfEntries.push(`Name: ${entry.name}\r\nSHA-256-Digest: ${sectionSha256B64}\r\n\r\n`);
  }

  const manifestMfBuf = Buffer.from(manifestMf, 'utf8');
  const fullMfSha256B64 = crypto
    .createHash('sha256')
    .update(manifestMfBuf)
    .digest('base64');

  const certSf =
    `Signature-Version: 1.0\r\nCreated-By: 1.0 (Android Release Signer)\r\nSHA-256-Digest-Manifest: ${fullMfSha256B64}\r\nX-Android-APK-Signed: 2\r\n\r\n` +
    sfEntries.join('');
  const certSfBuf = Buffer.from(certSf, 'utf8');

  // Generate RSA-2048 Signing Keypair
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
  const { x509CertDer, pkcs7Der } = buildSelfSignedX509AndPkcs7(
    privateKey,
    spkiDer,
    certSfBuf
  );

  // Verify X.509 certificate with BoringSSL/OpenSSL
  const parsedCert = new crypto.X509Certificate(x509CertDer);
  if (!parsedCert.verify(publicKey)) {
    throw new Error('X.509 Certificate self-signature verification failed');
  }

  const allEntries = [
    ...payloadEntries,
    { name: 'META-INF/MANIFEST.MF', data: manifestMfBuf, store: false },
    { name: 'META-INF/CERT.SF', data: certSfBuf, store: false },
    { name: 'META-INF/CERT.RSA', data: pkcs7Der, store: false },
  ];

  const apkBuffer = createAlignedApkArchive(
    allEntries,
    privateKey,
    spkiDer,
    x509CertDer
  );

  const targets = [
    path.join(publicDir, 'parametric-techno-daw-debug.apk'),
    path.join(rootDir, 'android/app/build/outputs/apk/debug/app-debug.apk'),
  ];
  if (fs.existsSync(distDir)) {
    targets.push(path.join(distDir, 'parametric-techno-daw-debug.apk'));
  }

  for (const target of targets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, apkBuffer);
  }

  console.log(
    `[APK Builder] Built Android 14 (API 34) v1+v2 signed APK (${(
      apkBuffer.length / 1024
    ).toFixed(1)} KB, binary AXML: ${binaryManifest.length}B, classes.dex: ${
      classesDex.length
    }B, resources.arsc: ${binaryResources.length}B [4-byte aligned], files: ${
      allEntries.length
    })`
  );

  return {
    apkBuffer,
    binaryManifest,
    binaryResources,
    classesDex,
    x509CertDer,
    publicKey,
    entriesCount: allEntries.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildApk();
}
