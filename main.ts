// THE WORLD TODAY — Saturday 21 November 2026.
// A one-day newspaper front page, drawn from scratch by this program:
// its own rasterizer, its own 5x7 bitmap type, its own PNG writer.
// Node standard library only; no network, no dependencies, deterministic.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024;
const H = 1024;

type RGB = [number, number, number];
const PAPER: RGB = [246, 241, 227];
const INK: RGB = [18, 18, 18];
const RED: RGB = [168, 30, 30];
const NAVY: RGB = [28, 51, 92];
const SKY: RGB = [188, 215, 234];
const LAND: RGB = [143, 174, 110];
const SUN: RGB = [238, 196, 64];
const WHITE: RGB = [250, 250, 246];

// ---- pixel buffer -------------------------------------------------------
const px = new Uint8Array(W * H * 3);
for (let i = 0; i < W * H; i++) {
  px[i * 3] = PAPER[0];
  px[i * 3 + 1] = PAPER[1];
  px[i * 3 + 2] = PAPER[2];
}

function setPix(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 3;
  px[o] = c[0];
  px[o + 1] = c[1];
  px[o + 2] = c[2];
}

function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) setPix(xx, yy, c);
  }
}

function frame(x: number, y: number, w: number, h: number, c: RGB, t: number): void {
  fillRect(x, y, w, t, c);
  fillRect(x, y + h - t, w, t, c);
  fillRect(x, y, t, h, c);
  fillRect(x + w - t, y, t, h, c);
}

// Bresenham line, with square brush of side `t`.
function line(x0: number, y0: number, x1: number, y1: number, c: RGB, t = 1): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    fillRect(x - Math.floor(t / 2), y - Math.floor(t / 2), t, t, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

function fillCircle(cx: number, cy: number, r: number, c: RGB): void {
  for (let dy = -r; dy <= r; dy++) {
    const dx = Math.floor(Math.sqrt(r * r - dy * dy));
    for (let xx = cx - dx; xx <= cx + dx; xx++) setPix(xx, cy + dy, c);
  }
}

// Scanline polygon fill: collect edge crossings per row, fill between pairs.
function fillPoly(pts: Array<[number, number]>, c: RGB): void {
  let minY = H;
  let maxY = 0;
  for (const [, y] of pts) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  for (let y = minY; y <= maxY; y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        xs.push(Math.round(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0)));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = xs[k]; x <= xs[k + 1]; x++) setPix(x, y, c);
    }
  }
}

function polyOutline(pts: Array<[number, number]>, c: RGB, t = 2): void {
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    line(x0, y0, x1, y1, c, t);
  }
}

// ---- PNG writer ---------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    raw.set(px.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- 5x7 bitmap type ----------------------------------------------------
// Each glyph is 7 rows of 5 bits, drawn by hand for this page.
const FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  a: ['00000', '00000', '01110', '00001', '01111', '10001', '01111'],
  b: ['10000', '10000', '11110', '10001', '10001', '10001', '11110'],
  c: ['00000', '00000', '01110', '10000', '10000', '10001', '01110'],
  d: ['00001', '00001', '01111', '10001', '10001', '10001', '01111'],
  e: ['00000', '00000', '01110', '10001', '11111', '10000', '01110'],
  f: ['00110', '01001', '01000', '11110', '01000', '01000', '01000'],
  g: ['00000', '01111', '10001', '10001', '01111', '00001', '01110'],
  h: ['10000', '10000', '11110', '10001', '10001', '10001', '10001'],
  i: ['00100', '00000', '01100', '00100', '00100', '00100', '01110'],
  j: ['00010', '00000', '00110', '00010', '00010', '10010', '01100'],
  k: ['10000', '10000', '10010', '10100', '11000', '10100', '10010'],
  l: ['01100', '00100', '00100', '00100', '00100', '00100', '01110'],
  m: ['00000', '00000', '11010', '10101', '10101', '10101', '10101'],
  n: ['00000', '00000', '11110', '10001', '10001', '10001', '10001'],
  o: ['00000', '00000', '01110', '10001', '10001', '10001', '01110'],
  p: ['00000', '00000', '11110', '10001', '10001', '11110', '10000'],
  q: ['00000', '00000', '01111', '10001', '10001', '01111', '00001'],
  r: ['00000', '00000', '10110', '11001', '10000', '10000', '10000'],
  s: ['00000', '00000', '01111', '10000', '01110', '00001', '11110'],
  t: ['01000', '01000', '11100', '01000', '01000', '01001', '00110'],
  u: ['00000', '00000', '10001', '10001', '10001', '10011', '01101'],
  v: ['00000', '00000', '10001', '10001', '10001', '01010', '00100'],
  w: ['00000', '00000', '10001', '10101', '10101', '10101', '01010'],
  x: ['00000', '00000', '10001', '01010', '00100', '01010', '10001'],
  y: ['00000', '00000', '10001', '10001', '01111', '00001', '01110'],
  z: ['00000', '00000', '11111', '00010', '00100', '01000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '00000', '01100', '01000'],
  "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'],
  '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  ';': ['00000', '01100', '01100', '00000', '01100', '01000', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  $: ['00100', '01111', '10100', '01110', '00101', '11110', '00100'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
  '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00110', '00100', '00000', '00100'],
};

function textWidth(s: string, scale: number): number {
  return s.length === 0 ? 0 : s.length * 6 * scale - scale;
}

function drawText(x: number, y: number, s: string, scale: number, c: RGB): void {
  let cx = x;
  for (const ch of s) {
    const g = FONT[ch] ?? FONT['?'];
    for (let r = 0; r < 7; r++) {
      for (let col = 0; col < 5; col++) {
        if (g[r][col] === '1') fillRect(cx + col * scale, y + r * scale, scale, scale, c);
      }
    }
    cx += 6 * scale;
  }
}

function drawCentred(y: number, s: string, scale: number, c: RGB): void {
  drawText(Math.floor((W - textWidth(s, scale)) / 2), y, s, scale, c);
}

function wrapText(s: string, scale: number, maxW: number): string[] {
  const words = s.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (textWidth(t, scale) <= maxW) {
      cur = t;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Draws wrapped text, returns the y just below the last line.
function drawPara(x: number, y: number, s: string, scale: number, c: RGB, maxW: number, gap = 4): number {
  for (const ln of wrapText(s, scale, maxW)) {
    drawText(x, y, ln, scale, c);
    y += 7 * scale + gap;
  }
  return y;
}

function kicker(x: number, y: number, s: string, c: RGB): void {
  fillRect(x, y, 10, 14, c);
  drawText(x + 16, y, s, 2, c);
}

// ---- the front page -------------------------------------------------------
function drawPage(): void {
  // Double border.
  frame(12, 12, 1000, 1000, INK, 3);
  frame(20, 20, 984, 984, INK, 1);

  // Masthead.
  drawCentred(36, 'THE WORLD TODAY', 7, INK);
  fillRect(28, 96, 968, 3, INK);
  fillRect(28, 102, 968, 1, INK);
  drawCentred(112, 'SATURDAY 21 NOVEMBER 2026', 3, INK);
  fillRect(28, 140, 968, 4, INK);

  // ---- Lead story: missile lands in Poland -------------------------------
  kicker(28, 156, 'WAR IN EUROPE', RED);
  drawText(28, 180, 'RUSSIAN MISSILE', 6, INK);
  drawText(28, 226, 'LANDS IN POLAND', 6, INK);
  let y = drawPara(
    28,
    282,
    'A Russian Kh-101 cruise missile crashed in south-east Poland during a massive Russian air attack on Ukraine. NATO jets scrambled. No injuries reported.',
    2,
    INK,
    532,
  );
  drawPara(
    28,
    y + 6,
    'Same attack: Russia hit three Kyiv bridges, at least 9 dead. About 100 missiles fired.',
    2,
    INK,
    532,
  );

  // Lead picture: sky over Poland, missile trail, crash burst, NATO jets.
  fillRect(580, 160, 416, 242, SKY);
  frame(580, 160, 416, 242, INK, 2);
  const poland: Array<[number, number]> = [
    [660, 280], [700, 240], [770, 222], [830, 248],
    [848, 300], [810, 348], [730, 356], [668, 326],
  ];
  fillPoly(poland, LAND);
  polyOutline(poland, [52, 96, 52], 2);
  drawText(688, 332, 'POLAND', 2, NAVY);
  // Missile trail, dashed, from upper left to the crash point.
  for (let i = 0; i < 9; i++) {
    const t0 = i / 9;
    const t1 = (i + 0.55) / 9;
    line(
      Math.round(612 + t0 * 188), Math.round(176 + t0 * 124),
      Math.round(612 + t1 * 188), Math.round(176 + t1 * 124),
      RED, 3,
    );
  }
  // Crash burst.
  fillCircle(800, 300, 12, [232, 120, 40]);
  for (let a = 0; a < 8; a++) {
    const ang = (a * Math.PI) / 4;
    line(800, 300, Math.round(800 + Math.cos(ang) * 26), Math.round(300 + Math.sin(ang) * 26), RED, 2);
  }
  drawText(636, 186, 'KH-101', 2, RED);
  // Two NATO jets with contrails.
  const jet = (jx: number, jy: number): void => {
    fillPoly([[jx, jy], [jx + 26, jy + 7], [jx, jy + 14]], INK);
    line(jx - 34, jy + 7, jx, jy + 7, INK, 2);
  };
  jet(872, 196);
  jet(908, 238);
  drawText(748, 380, 'NATO JETS SCRAMBLED', 2, NAVY);

  fillRect(28, 418, 968, 2, INK);

  // ---- Second row: three panels ------------------------------------------
  const rowY = 434;
  const rowH = 266;
  const cols = [28, 356, 684];
  for (const cx of cols) frame(cx, rowY, 312, rowH, INK, 2);

  // Panel 1: UK and EU deal.
  kicker(42, rowY + 14, 'BRUSSELS', RED);
  drawPara(42, rowY + 40, 'UK AND EU SEAL LANDMARK POST-BREXIT DEAL', 3, INK, 284);
  drawPara(
    42,
    rowY + 148,
    'Most food and farm checks scrapped from March 2028. Carbon markets linked from January 2028. Youth mobility up to 100,000 aged 18-31.',
    2,
    INK,
    284,
    2,
  );

  // Panel 2: ICJ genocide ruling.
  kicker(370, rowY + 14, 'THE HAGUE', RED);
  drawPara(370, rowY + 40, 'ICJ: MYANMAR COMMITTED GENOCIDE', 3, INK, 284);
  drawPara(
    370,
    rowY + 122,
    'Court ruled 9-6 Myanmar committed genocide against the Rohingya in 2017. Ordered investigation and compensation. Rohingya rejoice. UK expels Myanmar diplomat.',
    2,
    INK,
    284,
  );

  // Panel 3: markets slide.
  kicker(698, rowY + 14, 'MARKETS', RED);
  drawPara(698, rowY + 40, 'WALL STREET SLIDES AS AI SELLS OFF', 3, INK, 284);
  // Falling chart.
  const chart: Array<[number, number]> = [
    [712, 552], [748, 566], [784, 558], [820, 580],
    [856, 574], [892, 592], [928, 588], [964, 604],
  ];
  line(706, 540, 706, 612, INK, 2);
  line(706, 612, 980, 612, INK, 2);
  for (let i = 0; i + 1 < chart.length; i++) {
    line(chart[i][0], chart[i][1], chart[i + 1][0], chart[i + 1][1], RED, 3);
  }
  for (const [pxx, pyy] of chart) fillCircle(pxx, pyy, 3, RED);
  drawPara(
    698,
    rowY + 186,
    'S&P 500 -3.70%. Nasdaq -5.28%. Dow -1.93%. Nvidia -13.8% as SEC examines accounting.',
    2,
    INK,
    284,
  );

  fillRect(28, 714, 968, 2, INK);

  // ---- Third row: Trump on Iran, COP31 -----------------------------------
  frame(28, 728, 474, 152, INK, 2);
  frame(522, 728, 474, 152, INK, 2);
  kicker(42, 742, 'WASHINGTON', RED);
  drawPara(42, 768, "TRUMP: 'WE'VE GOT TIME' ON IRAN", 3, INK, 446);
  drawPara(
    42,
    824,
    'Strike decision deferred into 2027, after the New Year. 14+ tankers mass at Kharg Island. War cost $48bn.',
    2,
    INK,
    446,
  );

  kicker(536, 742, 'ANTALYA', RED);
  drawText(536, 768, 'COP31 MISSES DEADLINE', 3, INK);
  // Small sun over the summit.
  fillCircle(948, 756, 15, SUN);
  for (let a = 0; a < 8; a++) {
    const ang = (a * Math.PI) / 4;
    line(
      Math.round(948 + Math.cos(ang) * 19), Math.round(756 + Math.sin(ang) * 19),
      Math.round(948 + Math.cos(ang) * 25), Math.round(756 + Math.sin(ang) * 25),
      SUN, 2,
    );
  }
  drawPara(
    536,
    800,
    'Climate summit in Antalya missed its deadline. Political draft dropped mention of fossil fuels.',
    2,
    INK,
    446,
  );

  fillRect(28, 894, 968, 2, INK);

  // ---- In brief -----------------------------------------------------------
  fillRect(28, 908, 968, 30, INK);
  drawText(40, 914, 'IN BRIEF', 3, WHITE);
  const briefLeft = [
    'Yemen: Saudi-Houthi fighting escalates.',
    'Mamdani: Rikers to close by 2032.',
    'UFOs: US declassifies Mideast footage.',
  ];
  const briefRight = [
    'Denmark: Russia plotted to kill rapper.',
    'EU agrees EUR 1bn for Ukraine drones.',
    'Bangladesh: PM blames India for unrest.',
  ];
  let by = 946;
  for (const ln of briefLeft) {
    drawText(28, by, ln, 2, INK);
    by += 19;
  }
  by = 946;
  for (const ln of briefRight) {
    drawText(528, by, ln, 2, INK);
    by += 19;
  }
}

// ---- run ------------------------------------------------------------------
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
drawPage();
writeFileSync(join(outDir, 'entry.png'), encodePng());
