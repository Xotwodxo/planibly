import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url);
const distPath = fileURLToPath(dist);
const index = await readFile(new URL('index.html', dist), 'utf8');
const manifestMatch = index.match(/<link rel="manifest" href="([^"]+)"/);

if (!manifestMatch?.[1]) {
  throw new Error('The production HTML does not link to a web app manifest.');
}

if (index.includes("'unsafe-inline'") || index.includes('__PLANIBLY_DEV_STYLE__')) {
  throw new Error('The production Content Security Policy contains a development style source.');
}

const manifestPath = manifestMatch[1].replace(/^\//, '');
const manifest = JSON.parse(await readFile(new URL(manifestPath, dist), 'utf8'));
const required = {
  name: 'Planibly',
  short_name: 'Planibly',
  display: 'standalone',
  start_url: '/',
};

for (const [key, expected] of Object.entries(required)) {
  if (manifest[key] !== expected) {
    throw new Error(`Manifest ${key} must be ${expected}; received ${String(manifest[key])}.`);
  }
}

const iconPurposes = new Set(manifest.icons?.map((icon) => icon.purpose));
if (!iconPurposes.has('any') || !iconPurposes.has('maskable')) {
  throw new Error('The manifest must include both standard and maskable icons.');
}

for (const icon of manifest.icons) {
  await access(join(distPath, icon.src));
}

await access(new URL('icons/apple-touch-icon.png', dist));
const serviceWorker = await readFile(new URL('sw.js', dist), 'utf8');
if (!serviceWorker.includes('index.html')) {
  throw new Error('The generated service worker does not precache the application shell.');
}

console.log(
  `PWA verification passed: ${manifest.icons.length} manifest icons, Apple touch icon, standalone manifest, and precached application shell.`,
);
