'use strict';
/**
 * Downloads the tools that get bundled into the app, into build-resources/<mac|win|linux>/ :
 *   - Android platform-tools (adb) from Google
 *   - the Appium Settings APK (open source, Apache-2.0) from its GitHub release, SHA-256 verified
 *
 * Usage: node scripts/fetch-tools.js [--platform mac|win|linux] [--force]
 * Test overrides: PLATFORM_TOOLS_URL, APPIUM_RELEASE_API
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const force = args.includes('--force');
const pIdx = args.indexOf('--platform');
const HOST = { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform];
const PLAT = pIdx >= 0 ? args[pIdx + 1] : HOST;
if (!['mac', 'win', 'linux'].includes(PLAT)) { console.error('--platform must be mac, win or linux'); process.exit(2); }

const GOOGLE_NAME = { mac: 'darwin', win: 'windows', linux: 'linux' }[PLAT];
const TOOLS_URL = process.env.PLATFORM_TOOLS_URL || `https://dl.google.com/android/repository/platform-tools-latest-${GOOGLE_NAME}.zip`;
const RELEASE_API = process.env.APPIUM_RELEASE_API || 'https://api.github.com/repos/appium/io.appium.settings/releases/latest';
const OUT = path.join(__dirname, '..', 'build-resources', PLAT);
const UA = { 'User-Agent': 'courier-gps-sim-build' };

// Files of platform-tools we do not need (fastboot, filesystem tools, ...). adb and its libraries stay.
const SKIP = /^(fastboot|mke2fs|make_f2fs|sload_f2fs|e2fsdroid|sqlite3|etc1tool|hprof-conv|dmtracedump|make_f2fs_casefold|systrace)(\.exe|\.conf|\.1)?$/i;

async function download(url, headers = UA) {
  const r = await fetch(url, { headers, redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

async function getPlatformTools() {
  const adbName = PLAT === 'win' ? 'adb.exe' : 'adb';
  if (!force && fs.existsSync(path.join(OUT, adbName))) { console.log(`✔ adb already present (${PLAT})`); return; }
  console.log(`Downloading Android platform-tools for ${PLAT} ...`);
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(await download(TOOLS_URL));
  let count = 0;
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    const rel = e.entryName.replace(/^platform-tools\//, '');
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;   // zip-slip guard
    if (SKIP.test(path.basename(rel))) continue;
    const dest = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, e.getData());
    const mode = (e.attr >>> 16) & 0o777;
    if (PLAT !== 'win') fs.chmodSync(dest, path.basename(rel) === 'adb' ? 0o755 : (mode || 0o644));
    count++;
  }
  if (!fs.existsSync(path.join(OUT, adbName))) throw new Error('adb was not found inside the platform-tools zip');
  console.log(`✔ platform-tools: ${count} files`);
  if (PLAT === HOST) {
    try { console.log('   ' + String(execFileSync(path.join(OUT, adbName), ['version'])).split('\n')[0]); }
    catch (e) { console.warn('   (could not run the downloaded adb: ' + e.message + ')'); }
  }
}

async function getApk() {
  const dest = path.join(OUT, 'io.appium.settings.apk');
  if (!force && fs.existsSync(dest) && fs.statSync(dest).size > 500000) { console.log('✔ Appium Settings APK already present'); return; }
  console.log('Downloading Appium Settings APK ...');
  const rel = JSON.parse((await download(RELEASE_API, { ...UA, Accept: 'application/vnd.github+json' })).toString());
  const apks = (rel.assets || []).filter((a) => /\.apk$/i.test(a.name));
  const a = apks.find((x) => /debug/i.test(x.name)) || apks[0];
  if (!a) throw new Error('no .apk in the latest Appium Settings release');
  const buf = await download(a.browser_download_url, UA);
  if (buf.length < 500000 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('the downloaded file does not look like an APK');
  if (a.digest && /^sha256:/.test(a.digest)) {
    if (crypto.createHash('sha256').update(buf).digest('hex') !== a.digest.slice(7)) throw new Error('SHA-256 mismatch for the APK');
    console.log('   SHA-256 verified');
  } else console.log('   (release publishes no checksum; skipped verification)');
  fs.writeFileSync(dest, buf);
  console.log(`✔ APK ${rel.tag_name || ''} ${a.name} (${buf.length} bytes)`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await getPlatformTools();
  await getApk();
  const notice = path.join(__dirname, '..', 'THIRD-PARTY-NOTICES.md');
  if (fs.existsSync(notice)) fs.copyFileSync(notice, path.join(OUT, 'THIRD-PARTY-NOTICES.md'));
  console.log(`Tools ready in build-resources/${PLAT}`);
})().catch((e) => { console.error('✘ ' + e.message); process.exit(1); });
