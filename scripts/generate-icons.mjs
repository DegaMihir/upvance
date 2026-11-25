// Generates favicon + PWA icons from public/brand/icon.svg.
// Run: npm run icons
import sharp from "sharp";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const svg = await readFile(path.join(root, "public/brand/icon.svg"));
const outDir = path.join(root, "public/icons");
await mkdir(outDir, { recursive: true });

const png = (size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();

for (const size of [192, 512]) await writeFile(path.join(outDir, `icon-${size}.png`), await png(size));
await writeFile(path.join(root, "public/apple-touch-icon.png"), await png(180));

// Maskable icon: same artwork on a full-bleed background with safe-zone padding
const inner = await png(360);
const maskable = await sharp({ create: { width: 512, height: 512, channels: 4, background: "#5B32E0" } })
  .composite([{ input: inner, top: 76, left: 76 }])
  .png()
  .toBuffer();
await writeFile(path.join(outDir, "maskable-512.png"), maskable);

// favicon.ico containing 16/32/48 PNGs
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(png));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(s, 0);
  e.writeUInt8(s, 1);
  e.writeUInt8(0, 2);
  e.writeUInt8(0, 3);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(images[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += images[i].length;
  return e;
});
await writeFile(path.join(root, "src/app/favicon.ico"), Buffer.concat([header, ...entries, ...images]));

// Extension icons
const extDir = path.join(root, "extension/icons");
await mkdir(extDir, { recursive: true });
for (const s of [16, 32, 48, 128]) await writeFile(path.join(extDir, `icon-${s}.png`), await png(s));

console.log("Icons generated: public/icons, public/apple-touch-icon.png, src/app/favicon.ico, extension/icons");
