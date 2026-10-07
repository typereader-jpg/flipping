// Generates source icon/splash PNGs for @capacitor/assets from hand-drawn SVG.
// Run once with: node scripts/make-icons.js
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const BG = "#0f172a";
const BG_GRADIENT_INNER = "#1c2c42";

function pizzaSlice(scale, cx, cy) {
  // Slice drawn in a 100x100 local box, then scaled/translated.
  return `
  <g transform="translate(${cx} ${cy}) scale(${scale}) translate(-50 -50)">
    <path d="M15,33 Q50,21 85,33 L85,25 Q50,13 15,25 Z" fill="#e3a857"/>
    <path d="M15,33 Q50,21 85,33 L50,92 Z" fill="#f7c948"/>
    <circle cx="41" cy="46" r="6.2" fill="#c0392b"/>
    <circle cx="60" cy="50" r="6.2" fill="#c0392b"/>
    <circle cx="47" cy="64" r="6.2" fill="#c0392b"/>
    <circle cx="41" cy="46" r="2.3" fill="#8e2d20"/>
    <circle cx="60" cy="50" r="2.3" fill="#8e2d20"/>
    <circle cx="47" cy="64" r="2.3" fill="#8e2d20"/>
  </g>`;
}

function bgRect(size) {
  return `<rect width="${size}" height="${size}" fill="url(#g)"/>`;
}

function gradientDef(size) {
  return `
  <defs>
    <radialGradient id="g" cx="50%" cy="30%" r="75%">
      <stop offset="0%" stop-color="${BG_GRADIENT_INNER}"/>
      <stop offset="70%" stop-color="${BG}"/>
    </radialGradient>
  </defs>`;
}

function svg(size, { withBg, sliceScale, flatBg }) {
  const bg = flatBg
    ? `<rect width="${size}" height="${size}" fill="${BG}"/>`
    : `${gradientDef(size)}${bgRect(size)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${withBg ? bg : ""}
    ${sliceScale ? pizzaSlice((sliceScale * size) / 10000, size / 2, size / 2) : ""}
  </svg>`;
}

const outDir = path.join(__dirname, "..", "assets");
fs.mkdirSync(outDir, { recursive: true });

const jobs = [
  // Legacy/full icon: background + large slice, full bleed.
  { file: "icon.png", size: 1024, opts: { withBg: true, sliceScale: 80, flatBg: false } },
  // Adaptive icon foreground: flat bg matching background layer (no true alpha needed,
  // since the mask only ever reveals pixels that match the background layer anyway)
  // + slice sized to fit Android's ~66% safe zone.
  { file: "icon-foreground.png", size: 1024, opts: { withBg: true, sliceScale: 52, flatBg: true } },
  // Adaptive icon background layer: flat color only.
  { file: "icon-background.png", size: 1024, opts: { withBg: true, sliceScale: 0, flatBg: true } },
  // Splash screen: gradient bg + modest centered slice.
  { file: "splash.png", size: 2732, opts: { withBg: true, sliceScale: 34, flatBg: false } },
];

(async () => {
  for (const job of jobs) {
    const svgStr = svg(job.size, job.opts);
    await sharp(Buffer.from(svgStr)).png().toFile(path.join(outDir, job.file));
    console.log("wrote", job.file);
  }
})();
