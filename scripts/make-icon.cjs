// Generates desktop/src-tauri/icons/source.png (1024×1024 app icon):
// dark rounded square + white "V" mark + orange accent bar. Pure Node (zlib PNG).
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const S = 1024;
const px = new Uint8Array(S * S * 4); // RGBA

const inRounded = (x, y, r) => {
  // rounded-rect signed distance
  const rad = 190, half = S / 2;
  const dx = Math.abs(x - half) - (half - rad);
  const dy = Math.abs(y - half) - (half - rad);
  const ox = Math.max(dx, 0), oy = Math.max(dy, 0);
  return Math.hypot(ox, oy) <= rad || (dx < 0 && dy < 0);
};

const distToSeg = (px_, py_, ax, ay, bx, by) => {
  const abx = bx - ax, aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px_ - ax) * abx + (py_ - ay) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(px_ - (ax + abx * t), py_ - (ay + aby * t));
};

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    if (!inRounded(x, y)) { px[i + 3] = 0; continue; }
    // background #09090b
    let r = 9, g = 9, b = 11, a = 255;
    // white V: (300,300)->(512,740)->(724,300), stroke ~86
    const d1 = distToSeg(x + 0.5, y + 0.5, 300, 300, 512, 740);
    const d2 = distToSeg(x + 0.5, y + 0.5, 512, 740, 724, 300);
    if (Math.min(d1, d2) < 43) { r = g = b = 250; }
    // orange accent bar
    if (x >= 300 && x <= 724 && y >= 820 && y <= 862) { r = 252; g = 82; b = 0; }
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  }
}

// --- encode PNG ---
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0; // filter none
  Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'desktop', 'src-tauri', 'icons', 'source.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('wrote', out, png.length, 'bytes');
