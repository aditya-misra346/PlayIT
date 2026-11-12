#!/usr/bin/env node
/**
 * Automatic Cross-Platform Sync, Verification, Git Commit & Push (`scripts/auto-commit-sync.mjs`)
 *
 * Modes:
 *   - `node scripts/auto-commit-sync.mjs` (one-shot):
 *       1. Synchronizes version/metadata across Web, PWA, Server, Android, iOS, macOS, Windows, and Linux
 *       2. Builds Server & Web/PWA (which also updates the frontend bundle used by Desktop Tauri builds)
 *       3. Runs the automated verification suite
 *       4. Stages, commits, and pushes changes to `origin/main` on GitHub (triggering Vercel production auto-deploy)
 *   - `node scripts/auto-commit-sync.mjs --watch` (continuous watcher):
 *       Watches `web/`, `server/`, `desktop/`, `android/`, `ios/`, `docs/`, and `version.json` for changes
 *       and automatically runs the sync + commit + push pipeline.
 */
import { execSync } from 'node:child_process';
import { watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWatch = process.argv.includes('--watch');
const msgArgIdx = process.argv.indexOf('--message');
const customMessage = msgArgIdx !== -1 ? process.argv[msgArgIdx + 1] : null;

function run(cmd) {
  return execSync(cmd, {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      PATH: `${process.env.HOME}/.local/toolchains/node/bin:/Users/aditya/.gemini/antigravity/scratch/tools/node-v22.14.0-darwin-arm64/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`,
    },
  });
}

function getStatusPorcelain() {
  return execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8' }).trim();
}

export function syncCommitAndPush(commitMsg) {
  console.log('\n[auto-sync] 1/4 Synchronizing all platform versions & manifests...');
  run('node scripts/sync-platforms.mjs');

  console.log('[auto-sync] 2/4 Building Server & Web/PWA bundle...');
  run('npm run build');

  const status = getStatusPorcelain();
  if (!status) {
    console.log('[auto-sync] Working tree is clean — nothing to commit.');
    return;
  }

  console.log('[auto-sync] 3/4 Running verification tests before commit...');
  run('npm --prefix server test');

  const manifest = JSON.parse(execSync('cat version.json', { cwd: ROOT, encoding: 'utf8' }));
  const finalMsg =
    commitMsg ||
    `chore(release): auto-sync Web, PWA, Android, iOS & Desktop (v${manifest.version} build #${manifest.buildNumber})`;

  console.log(`[auto-sync] 4/4 Committing & pushing to GitHub ("${finalMsg}")...`);
  run('git add -A');
  run(`git commit -m ${JSON.stringify(finalMsg)}`);
  run('git push origin main');
  console.log('[auto-sync] Pushed to GitHub origin/main -> Vercel auto-deployment triggered!');
}

if (!isWatch) {
  syncCommitAndPush(customMessage);
} else {
  console.log('[auto-sync] Watching repository for changes (auto-sync + auto-commit + auto-push to GitHub/Vercel)...');
  let timer = null;
  let running = false;
  const dirs = ['version.json', 'web/src', 'web/public', 'server/src', 'docs'];
  for (const rel of dirs) {
    try {
      watch(join(ROOT, rel), { recursive: true }, (_event, filename) => {
        if (running || !filename || filename.endsWith('.tmp')) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          running = true;
          try {
            syncCommitAndPush(`chore(auto-sync): update ${rel}/${filename} across Web & native apps`);
          } catch (e) {
            console.error('[auto-sync] Error during auto-sync:', e);
          } finally {
            running = false;
          }
        }, 2500);
      });
    } catch {
      // ignore missing watch dir
    }
  }
}
