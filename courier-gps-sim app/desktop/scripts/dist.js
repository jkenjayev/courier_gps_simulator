'use strict';
/**
 * Builds the installer for the computer you run it on:
 *   macOS   -> dist/Courier GPS Simulator-<version>-<arch>.dmg
 *   Windows -> dist/Courier GPS Simulator Setup <version>.exe
 *   Linux   -> dist/Courier GPS Simulator-<version>.AppImage
 *
 * Usage: node scripts/dist.js [--skip-ios]
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const skipIos = process.argv.includes('--skip-ios');

function run(cmd, args, label) {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: false });
  if (r.status !== 0) { console.error(`\nStep failed: ${label}`); process.exit(r.status || 1); }
}

run(process.execPath, ['scripts/prepare.js'], 'Copy simulator files');
run(process.execPath, ['scripts/fetch-tools.js'], 'Fetch adb and Appium Settings APK');

if (process.platform === 'darwin' && !skipIos) {
  run('bash', ['scripts/build-ios-helper.sh'], 'Build iPhone helper (macOS)');
} else if (process.platform === 'darwin') {
  console.log('\n(skipping the iPhone helper: the app will not include iPhone support)');
}

const platformArgs = { darwin: ['--mac', 'dmg'], win32: ['--win', 'nsis'], linux: ['--linux', 'AppImage'] }[process.platform];
const builderCli = require.resolve('electron-builder/cli.js');
run(process.execPath, [builderCli, ...platformArgs, '--publish', 'never'], 'Build installer');

console.log('\nDone. The installer is in desktop/dist/');
