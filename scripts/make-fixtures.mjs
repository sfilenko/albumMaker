// Generates test photos in tests/fixtures. Each photo has a distinct colour, a large
// label, and a magenta arrow that points up when the photo is shown upright.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import piexif from 'piexifjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');

const PHOTOS = [
  ...[1, 2, 3, 4, 5, 6].map((n, i) => ({ file: `land-${n}.jpg`, w: 1800, h: 1200, hue: i * 50, label: `L${n}` })),
  ...[1, 2, 3].map((n, i) => ({ file: `port-${n}.jpg`, w: 1200, h: 1800, hue: 20 + i * 70, label: `P${n}` })),
  // Stored landscape; EXIF orientation 6 makes it an upright 1200×1800 portrait.
  { file: 'rot6.jpg', w: 1200, h: 1800, hue: 200, label: 'R6', orientation: 6 },
  { file: 'dup-a/IMG_0001.jpg', w: 1800, h: 1200, hue: 120, label: 'A' },
  { file: 'dup-b/IMG_0001.jpg', w: 1600, h: 1200, hue: 300, label: 'B' },
];

function draw({ w, h, hue, label, orientation }) {
  const rotate = orientation === 6;
  const c = document.createElement('canvas');
  c.width = rotate ? h : w;
  c.height = rotate ? w : h;
  const ctx = c.getContext('2d');
  if (rotate) {
    // Store the upright scene rotated 90° counter-clockwise.
    ctx.translate(0, c.height);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.fillStyle = `hsl(${hue} 55% 55%)`;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ff00ff';
  ctx.beginPath();
  ctx.moveTo(w / 2, h * 0.05);
  ctx.lineTo(w / 2 - w * 0.08, h * 0.2);
  ctx.lineTo(w / 2 + w * 0.08, h * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(w / 2 - w * 0.02, h * 0.2, w * 0.04, h * 0.2);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(Math.min(w, h) * 0.3)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, w / 2, h * 0.65);
  return c.toDataURL('image/jpeg', 0.9);
}

const browser = await chromium.launch();
const page = await browser.newPage();
for (const p of PHOTOS) {
  let dataUrl = await page.evaluate(draw, p);
  if (p.orientation) {
    const exif = piexif.dump({
      '0th': { [piexif.ImageIFD.Orientation]: p.orientation },
      Exif: { [piexif.ExifIFD.DateTimeOriginal]: '2026:06:14 15:30:00' },
    });
    dataUrl = piexif.insert(exif, dataUrl);
  }
  const path = join(OUT, p.file);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
}
await writeFile(join(OUT, 'notes.txt'), 'not a photo\n');
await browser.close();
console.log(`wrote ${PHOTOS.length + 1} fixtures to ${OUT}`);
