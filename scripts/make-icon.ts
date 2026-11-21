// Draws the Tezgah icon (the same picture as src/web/icon.svg) as a 256x256 PNG for the
// Electron build: electron/build/icon.png. Run again only when the icon changes.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

const SIZE = 256;
const SAMPLES = 4; // 4x4 samples per pixel for smooth edges
const BLUE = [0x1d, 0x4e, 0xd8];

/** Icon shape in the 64x64 units of icon.svg: 0 = outside, 1 = blue, 2 = white. */
function shape(x: number, y: number): number {
  const r = 14;
  const cx = Math.min(Math.max(x, r), 64 - r);
  const cy = Math.min(Math.max(y, r), 64 - r);
  if (x < 0 || y < 0 || x > 64 || y > 64 || (x - cx) ** 2 + (y - cy) ** 2 > r * r) return 0;
  const bar = x >= 16 && x <= 48 && y >= 18 && y <= 26;
  const stem = x >= 28 && x <= 36 && y >= 26 && y <= 50;
  return bar || stem ? 2 : 1;
}

const rows: Buffer[] = [];
for (let py = 0; py < SIZE; py++) {
  const row = Buffer.alloc(1 + SIZE * 4); // filter byte 0, then RGBA
  for (let px = 0; px < SIZE; px++) {
    let blue = 0;
    let white = 0;
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const s = shape(((px + (sx + 0.5) / SAMPLES) * 64) / SIZE, ((py + (sy + 0.5) / SAMPLES) * 64) / SIZE);
        if (s === 1) blue++;
        else if (s === 2) white++;
      }
    }
    const covered = blue + white;
    const alpha = covered / (SAMPLES * SAMPLES);
    const mix = (c: number) => (covered ? Math.round((blue * c + white * 255) / covered) : 0);
    row.set([mix(BLUE[0]!), mix(BLUE[1]!), mix(BLUE[2]!), Math.round(alpha * 255)], 1 + px * 4);
  }
  rows.push(row);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(Buffer.concat(rows))),
  chunk("IEND", Buffer.alloc(0)),
]);
const out = path.resolve(import.meta.dir, "../electron/build/icon.png");
writeFileSync(out, png);
console.log(`${out} (${png.length} bytes)`);
