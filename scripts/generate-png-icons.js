import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');

// A pure Node.js PNG encoder without external native dependencies
function createPng(width, height, isMaskable = false) {
  // RGBA buffer with filter byte per scanline
  const rowBytes = width * 4;
  const rawData = Buffer.alloc(height * (rowBytes + 1));

  // Center & icon dimensions
  const cx = width / 2;
  const cy = height / 2;
  const scale = width / 512;

  // Background colors
  const bgR = 0x0e, bgG = 0x12, bgB = 0x1a;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (rowBytes + 1);
    rawData[rowOffset] = 0; // Filter type 0 (None)

    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;

      // Default background
      let r = bgR;
      let g = bgG;
      let b = bgB;
      let a = 255;

      // Distance from center
      const dx = x - cx;
      const dy = y - cy;

      // If not maskable, round corner squircle
      if (!isMaskable) {
        const cornerRadius = width * 0.22;
        const qx = Math.max(0, Math.abs(dx) - (cx - cornerRadius));
        const qy = Math.max(0, Math.abs(dy) - (cy - cornerRadius));
        const dist = Math.sqrt(qx * qx + qy * qy);
        if (dist > cornerRadius) {
          a = 0; // Transparent outside rounded squircle
        }
      }

      if (a > 0) {
        // Ableton 4 Vertical bars (amber)
        // [110, 150, 190, 230] relative to 512 canvas
        const barW = 20 * scale;
        const barR = 6 * scale;

        // Vertical bar 1
        const b1x = 110 * scale;
        const b1y = 170 * scale;
        const b1h = 172 * scale;
        if (x >= b1x && x <= b1x + barW && y >= b1y && y <= b1y + b1h) {
          r = 0xf5; g = 0x9e; b = 0x0b;
        }

        // Vertical bar 2
        const b2x = 150 * scale;
        const b2y = 130 * scale;
        const b2h = 252 * scale;
        if (x >= b2x && x <= b2x + barW && y >= b2y && y <= b2y + b2h) {
          r = 0xfb; g = 0xbf; b = 0x24;
        }

        // Vertical bar 3
        const b3x = 190 * scale;
        const b3y = 200 * scale;
        const b3h = 112 * scale;
        if (x >= b3x && x <= b3x + barW && y >= b3y && y <= b3y + b3h) {
          r = 0xf5; g = 0x9e; b = 0x0b;
        }

        // Vertical bar 4
        const b4x = 230 * scale;
        const b4y = 150 * scale;
        const b4h = 212 * scale;
        if (x >= b4x && x <= b4x + barW && y >= b4y && y <= b4y + b4h) {
          r = 0xfb; g = 0xbf; b = 0x24;
        }

        // Horizontal bars (cyan & emerald)
        const hx = 280 * scale;
        const hh = 20 * scale;

        // Horiz 1 (cyan)
        if (x >= hx && x <= hx + 122 * scale && y >= 150 * scale && y <= 150 * scale + hh) {
          r = 0x38; g = 0xbd; b = 0xf8;
        }
        // Horiz 2 (emerald)
        if (x >= hx && x <= hx + 92 * scale && y >= 210 * scale && y <= 210 * scale + hh) {
          r = 0x10; g = 0xb9; b = 0x81;
        }
        // Horiz 3 (cyan)
        if (x >= hx && x <= hx + 122 * scale && y >= 270 * scale && y <= 270 * scale + hh) {
          r = 0x38; g = 0xbd; b = 0xf8;
        }
        // Horiz 4 (emerald)
        if (x >= hx && x <= hx + 72 * scale && y >= 330 * scale && y <= 330 * scale + hh) {
          r = 0x10; g = 0xb9; b = 0x81;
        }

        // Subtle waveform wave at bottom
        const waveY = (420 + Math.sin(x * 0.04) * 15) * scale;
        if (x >= 110 * scale && x <= 400 * scale && Math.abs(y - waveY) <= 3 * scale) {
          r = 0xf5; g = 0x9e; b = 0x0b;
        }
      }

      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  // Compress IDAT with zlib
  const compressed = zlib.deflateSync(rawData);

  // PNG Header
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // 8 bits per channel
  ihdr.writeUInt8(6, 9); // RGBA
  ihdr.writeUInt8(0, 10); // Deflate
  ihdr.writeUInt8(0, 11); // Filter 0
  ihdr.writeUInt8(0, 12); // Interlace 0

  function makeChunk(type, data) {
    const len = data.length;
    const buf = Buffer.alloc(8 + len + 4);
    buf.writeUInt32BE(len, 0);
    buf.write(type, 4, 4, 'ascii');
    data.copy(buf, 8);

    // CRC32 of type + data
    let crc = 0xffffffff;
    const crcTable = [];
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[i] = c;
    }

    for (let i = 4; i < 8 + len; i++) {
      crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    buf.writeUInt32BE(crc, 8 + len);
    return buf;
  }

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createIcoFromPng(pngBuf, width, height) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type 1 = ICO
  header.writeUInt16LE(1, 4); // 1 image
  header.writeUInt8(width >= 256 ? 0 : width, 6);
  header.writeUInt8(height >= 256 ? 0 : height, 7);
  header.writeUInt8(0, 8); // Colors
  header.writeUInt8(0, 9); // Reserved
  header.writeUInt16LE(1, 10); // Color planes
  header.writeUInt16LE(32, 12); // Bits per pixel
  header.writeUInt32LE(pngBuf.length, 14); // Image byte size
  header.writeUInt32LE(22, 18); // Image data offset
  return Buffer.concat([header, pngBuf]);
}

// Generate Web / PWA icons
const icons = [
  { file: 'pwa-192x192.png', size: 192, maskable: false },
  { file: 'pwa-512x512.png', size: 512, maskable: false },
  { file: 'pwa-maskable-512x512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
  { file: 'icon.png', size: 512, maskable: false },
];

for (const { file, size, maskable } of icons) {
  const png = createPng(size, size, maskable);
  fs.writeFileSync(path.join(publicDir, file), png);
  console.log(`Generated ${file} (${size}x${size})`);
}

// Generate valid binary ICO format favicon.ico
const faviconPng = createPng(64, 64, false);
const faviconIco = createIcoFromPng(faviconPng, 64, 64);
fs.writeFileSync(path.join(publicDir, 'favicon.ico'), faviconIco);
console.log('Generated favicon.ico (64x64 valid binary ICO format)');

// Generate Android Mipmap launcher icons
const mipmapTargets = [
  { dir: 'mipmap-mdpi', size: 48 },
  { dir: 'mipmap-hdpi', size: 72 },
  { dir: 'mipmap-xhdpi', size: 96 },
  { dir: 'mipmap-xxhdpi', size: 144 },
  { dir: 'mipmap-xxxhdpi', size: 192 },
];

const resDir = path.resolve(__dirname, '../android/app/src/main/res');
if (fs.existsSync(resDir)) {
  for (const { dir, size } of mipmapTargets) {
    const targetFolder = path.join(resDir, dir);
    if (!fs.existsSync(targetFolder)) fs.mkdirSync(targetFolder, { recursive: true });

    const launcherPng = createPng(size, size, false);
    const roundPng = createPng(size, size, false);
    const fgPng = createPng(size, size, true);

    fs.writeFileSync(path.join(targetFolder, 'ic_launcher.png'), launcherPng);
    fs.writeFileSync(path.join(targetFolder, 'ic_launcher_round.png'), roundPng);
    fs.writeFileSync(path.join(targetFolder, 'ic_launcher_foreground.png'), fgPng);
    console.log(`Generated Android ${dir} launcher icons (${size}x${size})`);
  }
}
