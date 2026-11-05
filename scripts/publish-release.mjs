#!/usr/bin/env node
// One command that publishes a release and then PROVES it worked.
//
// This exists because publishing failed the same three ways over and over:
//
//   1. electron-builder never saw GH_TOKEN. It does not read .env, and setting the
//      variable in one shell then running the build in another does not carry it
//      across. The upload step then silently did nothing and still exited 0.
//
//   2. electron-builder spawns one publisher per artifact (.exe and .blockmap) and
//      they race to create the GitHub release. The loser gets HTTP 422
//      "already_exists" and aborts mid-upload, leaving a half-populated release —
//      or, when the release already existed as a non-draft, every file was silently
//      "skipped" with only a log line. Creating the release up front removes the
//      race entirely: with the release already there, nobody tries to create it.
//
//   3. A stale latest.yml from a previous version got published, so the updater
//      compared the wrong version and reported "up to date" forever. The final
//      verification step below refuses to pass unless the published latest.yml
//      names this exact version and points at an asset that is actually present.
//
// Usage:  npm run release
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const tag = `v${version}`;

const publishCfg = (Array.isArray(pkg.build?.publish) ? pkg.build.publish : [pkg.build?.publish])
  .find(p => p && p.provider === 'github');
if (!publishCfg) fail('No github publish config found in package.json "build.publish".');
const { owner, repo } = publishCfg;

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

// ─── Load .env so GH_TOKEN is present for BOTH this script and electron-builder ──
if (existsSync(path.join(root, '.env'))) {
  for (const line of readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const token = process.env.GH_TOKEN;
if (!token) fail('GH_TOKEN is not set and was not found in .env');

const api = `https://api.github.com/repos/${owner}/${repo}/releases`;
const headers = {
  Authorization: `token ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'dineovo-release-script'
};

// GitHub calls are retried: a transient network blip during VERIFICATION once made a
// perfectly good release look like a failed one, which is exactly the sort of false
// signal this script exists to eliminate.
async function ghFetch(url, options = {}, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
    } catch (err) {
      lastErr = err;
      const detail = err?.cause?.code || err.message;
      if (i < attempts) {
        console.log(`  (network error talking to GitHub: ${detail} — retry ${i}/${attempts - 1})`);
        await new Promise(r => setTimeout(r, 2000 * i));
      }
    }
  }
  throw lastErr;
}

async function getRelease() {
  const res = await ghFetch(`${api}/tags/${tag}`);
  if (res.status === 404) return null;
  if (!res.ok) fail(`GitHub API error ${res.status} looking up ${tag}: ${await res.text()}`);
  return res.json();
}

console.log(`\n▶ Releasing ${pkg.name} ${version} to ${owner}/${repo}\n`);

// ─── Step 1: make sure the release exists BEFORE electron-builder runs ───────────
let release = await getRelease();
if (release) {
  console.log(`• Release ${tag} already exists (id ${release.id}) — will upload into it.`);
  if (release.draft) {
    fail(`Release ${tag} is a DRAFT but package.json publishes releaseType "release". ` +
         `Publish or delete the draft on GitHub, then re-run.`);
  }
} else {
  const res = await ghFetch(api, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: tag, name: version, draft: false, prerelease: false })
  });
  if (!res.ok) fail(`Could not create release ${tag}: ${res.status} ${await res.text()}`);
  release = await res.json();
  console.log(`• Created release ${tag} (id ${release.id}).`);
}

// ─── Step 2: build + publish ────────────────────────────────────────────────────
console.log('• Running build and upload...\n');
const build = spawnSync(
  'npm',
  ['run', 'electron:build', '--', '--publish', 'always'],
  { stdio: 'inherit', env: process.env, shell: true, cwd: root }
);
if (build.status !== 0) fail(`electron-builder exited with code ${build.status}.`);

// ─── Step 3: verify what actually landed on GitHub ──────────────────────────────
// electron-builder can exit 0 having skipped every upload, so trusting it is not
// enough — read the release back and check it is genuinely usable by the updater.
console.log('\n• Verifying the published release...');
release = await getRelease();
if (!release) fail(`Release ${tag} vanished after publishing.`);

const assets = release.assets || [];
const names = assets.map(a => a.name);
const yml = assets.find(a => a.name === 'latest.yml');
if (!yml) fail(`latest.yml was NOT uploaded. Assets present: ${names.join(', ') || '(none)'}`);

const ymlBody = await (await ghFetch(yml.browser_download_url)).text();
const ymlVersion = ymlBody.match(/^version:\s*(.+)$/m)?.[1]?.trim();
const ymlFile = ymlBody.match(/^path:\s*(.+)$/m)?.[1]?.trim();
const ymlSize = Number(ymlBody.match(/^\s*size:\s*(\d+)$/m)?.[1]);

if (ymlVersion !== version) {
  fail(`Published latest.yml says version ${ymlVersion}, expected ${version}. ` +
       `A stale latest.yml was uploaded — installed apps will NOT see this update.`);
}
const installer = assets.find(a => a.name === ymlFile);
if (!installer) {
  fail(`latest.yml points at "${ymlFile}" but that asset is missing. ` +
       `Assets present: ${names.join(', ')}. The updater would 404.`);
}
if (Number.isFinite(ymlSize) && installer.size !== ymlSize) {
  fail(`Size mismatch: latest.yml says ${ymlSize} bytes but "${ymlFile}" is ${installer.size}. ` +
       `The updater's integrity check would fail.`);
}

console.log(`\n✓ ${tag} published and verified`);
console.log(`  version:   ${ymlVersion}`);
console.log(`  installer: ${ymlFile} (${(installer.size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`  assets:    ${names.join(', ')}`);
console.log(`  url:       ${release.html_url}\n`);
