/**
 * Generates the PWA icon set with no image dependencies:
 * raw RGBA -> zlib deflate -> hand-assembled PNG chunks.
 *
 *   node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../public/icons/', import.meta.url));
mkdirSync(OUT, { recursive: true });

/* ---------- PNG writer ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
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

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- drawing ---------- */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * clamp01(t);
/** Anti-aliased coverage for a signed distance (negative = inside). */
const cover = (d) => clamp01(0.5 - d);

function draw(size, { maskable }) {
  const px = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const safe = maskable ? 0.7 : 0.86; // maskable icons keep art inside the safe circle
  const R = (size / 2) * safe;

  // Waveform bar heights (fraction of R), symmetric, hand-tuned to read at 48px.
  const bars = [0.3, 0.55, 0.86, 0.42, 1.0, 0.68, 0.36];
  const barW = R * 0.15;
  const gap = R * 0.115;
  const totalW = bars.length * barW + (bars.length - 1) * gap;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x + 0.5;
      const fy = y + 0.5;
      const dx = fx - c;
      const dy = fy - c;
      const dist = Math.hypot(dx, dy);

      // Backdrop: deep space gradient, lifted toward the top-left.
      const g = clamp01((dist / (size * 0.72)) ** 0.9);
      const lift = clamp01(1 - (fx + fy) / (size * 1.9));
      let r = mix(mix(26, 8, g), 46, lift * 0.55);
      let gr = mix(mix(24, 8, g), 38, lift * 0.5);
      let b = mix(mix(58, 14, g), 96, lift * 0.7);
      let a = 255;

      if (!maskable) {
        // Rounded-square silhouette for the "any" icons.
        const rad = size * 0.23;
        const qx = Math.abs(dx) - (size / 2 - rad);
        const qy = Math.abs(dy) - (size / 2 - rad);
        const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
        a = Math.round(255 * cover(sd));
        if (a === 0) {
          px[(y * size + x) * 4 + 3] = 0;
          continue;
        }
      }

      // Halo ring.
      const ring = Math.abs(dist - R * 0.98) - R * 0.028;
      const ringA = cover(ring) * 0.85;

      // Soft inner glow behind the bars.
      const glow = Math.exp(-((dist / (R * 0.85)) ** 2)) * 0.5;
      r = mix(r, 96, glow);
      gr = mix(gr, 120, glow);
      b = mix(b, 255, glow);

      // Waveform bars.
      let barA = 0;
      const bx = fx - (c - totalW / 2);
      if (bx >= -barW && bx <= totalW + barW) {
        const idx = Math.floor(bx / (barW + gap));
        if (idx >= 0 && idx < bars.length) {
          const left = idx * (barW + gap);
          const dxb = Math.abs(bx - (left + barW / 2)) - barW / 2;
          const h = (R * 0.78 * bars[idx]) / 2;
          const dyb = Math.abs(dy) - h;
          const rr = barW / 2;
          const sx = Math.max(dxb + rr, 0);
          const sy = Math.max(dyb + rr, 0);
          const sd = Math.hypot(sx, sy) + Math.min(Math.max(dxb + rr, dyb + rr), 0) - rr;
          barA = cover(sd);
        }
      }

      // Composite: ring first (cyan), then bars (near-white with a cyan tint).
      r = mix(r, 88, ringA * 0.9);
      gr = mix(gr, 214, ringA * 0.9);
      b = mix(b, 255, ringA * 0.9);

      const tint = clamp01(Math.abs(dy) / (R * 0.5));
      r = mix(r, mix(240, 120, tint), barA);
      gr = mix(gr, mix(252, 226, tint), barA);
      b = mix(b, 255, barA);

      const o = (y * size + x) * 4;
      px[o] = Math.round(r);
      px[o + 1] = Math.round(gr);
      px[o + 2] = Math.round(b);
      px[o + 3] = a;
    }
  }
  return encodePng(size, size, px);
}

const files = [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: true }],
  ['favicon-32.png', 32, { maskable: false }],
];

for (const [name, size, opts] of files) {
  writeFileSync(OUT + name, draw(size, opts));
  console.log('wrote icons/' + name, size + 'px');
}
