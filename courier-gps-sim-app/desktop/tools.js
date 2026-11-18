'use strict';
/**
 * Finds the tools that ship inside the app (adb, Appium Settings APK, iPhone helper)
 * and returns the environment variables server.js uses to find them.
 *
 * Packaged app : <resources>/tools/...
 * Development  : desktop/build-resources/<mac|win|linux>/...   (filled by `npm run tools`)
 *
 * Pure Node (no Electron imports) so it can be tested without Electron.
 */
const path = require('path');
const fs = require('fs');

const PLATFORM_DIR = { darwin: 'mac', win32: 'win', linux: 'linux' };

function resolveTools({ platform = process.platform, packaged = false, resourcesPath = '', devRoot = __dirname, exists = fs.existsSync } = {}) {
  const base = packaged
    ? path.join(resourcesPath, 'tools')
    : path.join(devRoot, 'build-resources', PLATFORM_DIR[platform] || platform);
  const env = {};
  const found = { adb: false, apk: false, iosHelper: false };

  const adb = path.join(base, platform === 'win32' ? 'adb.exe' : 'adb');
  if (exists(adb)) { env.ADB_PATH = adb; found.adb = true; }

  const apk = path.join(base, 'io.appium.settings.apk');
  if (exists(apk)) { env.APK_PATH = apk; found.apk = true; }

  if (platform === 'darwin') {
    const helper = path.join(base, 'ios-helper');
    if (exists(helper)) { env.IOS_HELPER_BIN = helper; found.iosHelper = true; }
  }
  return { base, env, found };
}

module.exports = { resolveTools, PLATFORM_DIR };
