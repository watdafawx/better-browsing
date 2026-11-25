// npm run release:firefox: builds Firefox MV3 extension, signs it unlisted on AMO via web-ext,
// writes Mozilla updates.json, and uploads both to the fixed GitHub release `extension` so
// installed Firefox copies auto-update.
//
// Credentials: AMO_JWT_ISSUER + AMO_JWT_SECRET env vars (or --issuer-file=<p> --secret-file=<p>).
// Flags: --no-upload (sign only, leave artifacts in dist/).
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);

const REPO = 'watdafawx/better-browsing';
const TAG = 'extension';
const args = process.argv.slice(2);
const NO_UPLOAD = args.includes('--no-upload');
const flag = name => {
  const hit = args.find(a => a.startsWith(name + '='));
  return hit ? hit.slice(name.length + 1) : '';
};

const fail = msg => { console.error(`release:firefox failed: ${msg}`); process.exit(1); };
const readSecret = (envKey, fileFlag) => {
  const f = flag(fileFlag);
  if (f) return fs.readFileSync(f, 'utf8').trim();
  return (process.env[envKey] || '').trim();
};

const issuer = readSecret('AMO_JWT_ISSUER', '--issuer-file');
const secret = readSecret('AMO_JWT_SECRET', '--secret-file');
if (!issuer || !secret) fail('set AMO_JWT_ISSUER and AMO_JWT_SECRET (or pass --issuer-file= --secret-file=).');

const base = JSON.parse(fs.readFileSync('ext/manifest.base.json', 'utf8'));
const version = base.version;
const addonId = base.gecko?.id;
const minVer = base.gecko?.strict_min_version || '128.0';
if (!version || !addonId) fail('ext/manifest.base.json missing version or gecko.id');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-ff-sign-'));
const srcDir = path.join(tmp, 'src');
const artDir = path.join(tmp, 'artifacts');
fs.mkdirSync(artDir, { recursive: true });

try {
  console.log(`1/4 building Firefox MV3 extension v${version} ...`);
  const b = spawnSync(process.execPath, ['ext/build.js', '--firefox', `--out=${srcDir}`], { stdio: 'inherit' });
  if (b.status !== 0) fail('ext/build.js --firefox failed.');

  console.log('2/4 signing unlisted on AMO via web-ext ...');
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const sign = spawnSync(npx, [
    '--yes', 'web-ext', 'sign',
    '--channel=unlisted',
    `--source-dir=${srcDir}`,
    `--artifacts-dir=${artDir}`,
    `--api-key=${issuer}`,
    `--api-secret=${secret}`
  ], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (sign.status !== 0) fail('web-ext sign failed.');

  const xpis = fs.readdirSync(artDir).filter(f => f.endsWith('.xpi'));
  if (!xpis.length) fail('web-ext finished without producing a signed .xpi');

  fs.mkdirSync('dist', { recursive: true });
  const xpiName = `better-browsing-${version}-firefox.xpi`;
  const xpiOut = path.join('dist', xpiName);
  fs.copyFileSync(path.join(artDir, xpis[0]), xpiOut);

  console.log(`3/4 writing dist/updates.json for ${addonId} v${version} ...`);
  const updates = {
    addons: {
      [addonId]: {
        updates: [
          {
            version,
            update_link: `https://github.com/${REPO}/releases/download/${TAG}/${xpiName}`,
            applications: { gecko: { strict_min_version: minVer } }
          }
        ]
      }
    }
  };
  const updatesOut = path.join('dist', 'updates.json');
  fs.writeFileSync(updatesOut, JSON.stringify(updates, null, 2) + '\n');

  if (NO_UPLOAD) {
    console.log(`signed locally (--no-upload): ${xpiOut} + ${updatesOut}`);
    process.exit(0);
  }

  console.log(`4/4 uploading to GitHub release ${REPO}@${TAG} ...`);
  const view = spawnSync('gh', ['release', 'view', TAG, '--repo', REPO], { stdio: 'ignore' });
  if (view.status !== 0) {
    const cr = spawnSync('gh', [
      'release', 'create', TAG, '--repo', REPO,
      '--title', 'Better Browsing Extension (Firefox)',
      '--notes', 'Signed unlisted Firefox MV3 extension and auto-update manifest (`updates.json`).'
    ], { stdio: 'inherit' });
    if (cr.status !== 0) fail('gh release create failed.');
  }
  // Upload .xpi BEFORE updates.json so Firefox never sees a version whose .xpi isn't live yet
  const u1 = spawnSync('gh', ['release', 'upload', TAG, '--repo', REPO, xpiOut, '--clobber'], { stdio: 'inherit' });
  if (u1.status !== 0) fail('gh release upload failed for .xpi.');
  const u2 = spawnSync('gh', ['release', 'upload', TAG, '--repo', REPO, updatesOut, '--clobber'], { stdio: 'inherit' });
  if (u2.status !== 0) fail('gh release upload failed for updates.json.');

  console.log(`published: https://github.com/${REPO}/releases/download/${TAG}/${xpiName}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
