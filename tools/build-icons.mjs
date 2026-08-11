#!/usr/bin/env node
// Generates the PWA icon PNGs. Node stdlib only — rasterises into an RGBA
// buffer and encodes the PNG by hand with node:zlib, so there is no image
// dependency to install. Run: node tools/build-icons.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'icons');

const EC = [233, 162, 59];   // amber, matching --ec
const SE = [95, 188, 216];   // blue,  matching --se
const INK = [15, 18, 22];    // matching --bg dark

/* ---------- PNG encoding ---------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // truecolour with alpha
  // 10..12 stay 0: deflate, adaptive filtering, no interlace

  // One filter byte (0 = None) per scanline.
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const at = y * (width * 4 + 1);
    raw[at] = 0;
    rgba.copy(raw, at + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- drawing ---------- */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Signed distance to a rounded rectangle centred on the origin. */
function sdRoundRect(px, py, halfW, halfH, radius) {
  const qx = Math.abs(px) - (halfW - radius);
  const qy = Math.abs(py) - (halfH - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Signed distance to a line segment. */
function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = clamp01((wx * vx + wy * vy) / (vx * vx + vy * vy));
  return Math.hypot(wx - vx * t, wy - vy * t);
}

/**
 * The mark: a gradient rounded square (or full bleed, for maskable) with a
 * tick cut through it. `inset` is the fraction of the canvas the art occupies,
 * which is how the maskable variant keeps clear of the safe-zone crop.
 */
function drawIcon(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const artHalf = maskable ? size / 2 : size * 0.46;
  const radius = maskable ? 0 : size * 0.22;
  const tickScale = maskable ? size * 0.30 : size * 0.36;
  const stroke = size * (maskable ? 0.085 : 0.10);

  // Tick geometry, in units of tickScale from centre.
  const ax = c - tickScale * 0.85, ay = c + tickScale * 0.02;
  const bx = c - tickScale * 0.22, by = c + tickScale * 0.62;
  const dx = c + tickScale * 0.85, dy = c - tickScale * 0.60;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;

      // Diagonal gradient across the plate.
      const t = clamp01((px + py) / (size * 2));
      const plate = mix(EC, SE, t);

      const dPlate = sdRoundRect(px - c, py - c, artHalf, artHalf, radius);
      const plateAlpha = clamp01(0.5 - dPlate);

      const dTick = Math.min(
        sdSegment(px, py, ax, ay, bx, by),
        sdSegment(px, py, bx, by, dx, dy),
      ) - stroke / 2;
      const tickAlpha = clamp01(0.5 - dTick) * plateAlpha;

      const colour = mix(plate, INK, tickAlpha);
      const at = (y * size + x) * 4;
      rgba[at] = Math.round(colour[0]);
      rgba[at + 1] = Math.round(colour[1]);
      rgba[at + 2] = Math.round(colour[2]);
      rgba[at + 3] = Math.round(plateAlpha * 255);
    }
  }
  return encodePNG(size, size, rgba);
}

mkdirSync(OUT, { recursive: true });

const files = [
  ['icon-192.png', drawIcon(192)],
  ['icon-512.png', drawIcon(512)],
  ['icon-maskable-512.png', drawIcon(512, { maskable: true })],
];

for (const [name, buf] of files) {
  writeFileSync(join(OUT, name), buf);
  console.log(`  icons/${name}  ${(buf.length / 1024).toFixed(1)} KB`);
}

// Matching favicon, as vector so it stays crisp in the tab.
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="rgb(${EC})"/><stop offset="1" stop-color="rgb(${SE})"/>
  </linearGradient></defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <path d="M17 33 l10 10 l20 -21" fill="none" stroke="rgb(${INK})" stroke-width="7"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
writeFileSync(join(OUT, 'favicon.svg'), favicon, 'utf8');
console.log('  icons/favicon.svg');
