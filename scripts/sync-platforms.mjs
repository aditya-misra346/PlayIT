#!/usr/bin/env node
/**
 * PlayIT Version Synchronization Script (`scripts/sync-platforms.mjs`)
 *
 * Ensures every update made to `version.json` is automatically propagated across:
 *   1. Web (`web/package.json`, `web/src/version.ts`, `web/public/sw.js`)
 *   2. Recognition Backend (`server/package.json`, `server/src/version.ts`)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const bumpIdx = args.indexOf('--bump');

const versionFile = join(ROOT, 'version.json');
const manifest = JSON.parse(readFileSync(versionFile, 'utf8'));

if (bumpIdx !== -1) {
  const kind = args[bumpIdx + 1] || 'patch';
  const [maj, min, pat] = String(manifest.version).split('.').map(Number);
  if (kind === 'major') manifest.version = `${maj + 1}.0.0`;
  else if (kind === 'minor') manifest.version = `${maj}.${min + 1}.0`;
  else manifest.version = `${maj}.${min}.${pat + 1}`;
  manifest.buildNumber = Number(manifest.buildNumber || 1) + 1;
  manifest.releaseDate = new Date().toISOString().slice(0, 10);
  for (const key of Object.keys(manifest.platforms || {})) {
    manifest.platforms[key].version = manifest.version;
    if ('buildNumber' in manifest.platforms[key]) manifest.platforms[key].buildNumber = manifest.buildNumber;
  }
  writeFileSync(versionFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

const { version, buildNumber, releaseDate, channel, minCompatibleVersion, notes } = manifest;
const driftFiles = [];

function updateFile(relPath, transformFn) {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) return;
  const current = readFileSync(abs, 'utf8');
  const next = transformFn(current);
  if (current !== next) {
    if (checkOnly) {
      driftFiles.push(relPath);
    } else {
      writeFileSync(abs, next, 'utf8');
      console.log(`[sync-platforms] Updated ${relPath} -> v${version} (build ${buildNumber})`);
    }
  }
}

// 1. Root, Server, and Web package.json
for (const pkgPath of ['package.json', 'server/package.json', 'web/package.json']) {
  updateFile(pkgPath, (raw) => {
    const obj = JSON.parse(raw);
    obj.version = version;
    return `${JSON.stringify(obj, null, 2)}\n`;
  });
}

// 2. Server version.ts
updateFile('server/src/version.ts', () => {
  return `export const RELEASE_MANIFEST = {
  version: '${version}',
  buildNumber: ${buildNumber},
  releaseDate: '${releaseDate}',
  channel: '${channel}',
  minCompatibleVersion: '${minCompatibleVersion}',
  notes: ${JSON.stringify(notes)},
  platforms: {
    web: { version: '${version}', buildNumber: ${buildNumber}, target: 'Vercel Production Web Application' },
  },
} as const;
`;
});

// 3. Web version.ts & Service Worker cache key
updateFile('web/src/version.ts', () => {
  return `export const APP_VERSION = '${version}';
export const APP_BUILD_NUMBER = ${buildNumber};
export const APP_RELEASE_DATE = '${releaseDate}';
export const SUPPORTED_PLATFORMS = [
  { id: 'web', name: 'Web Application', version: '${version}', status: 'synchronized' },
] as const;
`;
});

updateFile('web/public/sw.js', (raw) =>
  raw.replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = 'playit-shell-v${version}-${buildNumber}';`),
);

if (checkOnly) {
  if (driftFiles.length > 0) {
    console.error(`[sync-platforms] Version drift detected in: ${driftFiles.join(', ')}`);
    process.exit(1);
  }
  console.log(`[sync-platforms] Web & server verified in sync at v${version} (build #${buildNumber}).`);
} else {
  console.log(`[sync-platforms] Synchronized web & server to v${version} (build #${buildNumber}).`);
}
