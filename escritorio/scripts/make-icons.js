'use strict';
// Genera el icono de la app (PNG de varios tamaños + .ico) sin dependencias: dibuja la misma forma que
// public/img/logo.svg con un rasterizador pequeño (suavizado 4x4) y escribe los PNG con zlib.
//   npm run icons
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const ACCENT = [0xb8, 0x28, 0x3f], WHITE = [255, 255, 255];

const inRound = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const distSeg = (x, y, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
};
const star = (cx, cy, R, r) => [[cx, cy - R], [cx + r, cy - r], [cx + R, cy], [cx + r, cy + r], [cx, cy + R], [cx - r, cy + r], [cx - R, cy], [cx - r, cy - r]];
const inPoly = (x, y, p) => {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  return c;
};
const STAR1 = star(384, 78, 26, 8), STAR2 = star(440, 140, 16, 5);

// color del punto (x, y) en el espacio de 512x512, o null si es transparente
function sample(x, y) {
  if (!inRound(x, y, 0, 0, 512, 512, 112)) return null;
  let c = ACCENT;
  if (inRound(x, y, 88, 136, 424, 376, 40)) {
    c = WHITE;
    if (Math.min(distSeg(x, y, 104, 170, 256, 282), distSeg(x, y, 256, 282, 408, 170)) <= 14) c = ACCENT;
  }
  if (inPoly(x, y, STAR1) || inPoly(x, y, STAR2)) c = WHITE;
  return c;
}

function render(size) {
  const S = 4, px = Buffer.alloc(size * size * 4), k = 512 / size;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const c = sample((i + (sx + .5) / S) * k, (j + (sy + .5) / S) * k);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
    }
    const o = (j * size + i) * 4, n = S * S;
    px[o] = a ? Math.round(r / a) : 0; px[o + 1] = a ? Math.round(g / a) : 0; px[o + 2] = a ? Math.round(b / a) : 0; px[o + 3] = Math.round(255 * a / n);
  }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const px = render(size), raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
// .ico con imágenes PNG (válido desde Windows Vista)
function ico(sizes) {
  const imgs = sizes.map(s => ({ s, data: png(s) }));
  const head = Buffer.alloc(6 + 16 * imgs.length); head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
  let off = head.length;
  imgs.forEach((im, i) => {
    const o = 6 + 16 * i;
    head[o] = im.s >= 256 ? 0 : im.s; head[o + 1] = im.s >= 256 ? 0 : im.s; head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(im.data.length, o + 8); head.writeUInt32LE(off, o + 12); off += im.data.length;
  });
  return Buffer.concat([head, ...imgs.map(i => i.data)]);
}

const out = (...p) => { const f = path.join(ROOT, ...p); fs.mkdirSync(path.dirname(f), { recursive: true }); return f; };
for (const s of [16, 24, 32, 48, 64, 128, 256, 512]) fs.writeFileSync(out('build', 'icons', `${s}x${s}.png`), png(s));
fs.writeFileSync(out('build', 'icon.png'), png(512));
fs.writeFileSync(out('build', 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256]));
fs.writeFileSync(out('electron', 'icon.png'), png(256));
fs.writeFileSync(out('public', 'img', 'icon-192.png'), png(192));
console.log('iconos generados en build/, electron/ y public/img/');
