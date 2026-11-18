'use strict';
/**
 * Safety net for Android phones. Started by server.js as a tiny child process.
 *
 * The mock-location service lives on the PHONE and keeps re-sending the last position until somebody stops
 * it. So if the simulator is closed, crashes, or is killed, the phone would stay "stuck" at the last point.
 * This process notices that the simulator is gone (its link to it closes) and stops the mock GPS on every
 * Android phone that was still being faked, so the phone returns to its real location.
 */
const { execFile } = require('child_process');

const PKG = 'io.appium.settings';
const SERIAL_RE = /^[A-Za-z0-9._:\-]{0,64}$/;   // empty = "the only connected phone"
let adb = 'adb';
const tracked = new Set();

// A Ctrl+C in the terminal reaches this process too. It must outlive the simulator to do its cleanup.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => {});

process.on('message', (m) => {
  if (!m || typeof m !== 'object') return;
  if (m.type === 'track' && typeof m.serial === 'string' && SERIAL_RE.test(m.serial)) {
    if (typeof m.adb === 'string' && m.adb) adb = m.adb;
    tracked.add(m.serial);
  } else if (m.type === 'untrack' && typeof m.serial === 'string') {
    tracked.delete(m.serial);
  } else if (m.type === 'clear') {
    tracked.clear();
  }
});

process.on('disconnect', async () => {
  const jobs = [...tracked].map((serial) => new Promise((resolve) => {
    const args = [...(serial ? ['-s', serial] : []), 'shell', 'am', 'stopservice', `${PKG}/.LocationService`];
    execFile(adb, args, { timeout: 5000 }, () => resolve());
  }));
  await Promise.all(jobs);
  process.exit(0);
});
