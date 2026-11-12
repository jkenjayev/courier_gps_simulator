#!/usr/bin/env node
/**
 * Courier GPS Simulator - local bridge
 *
 * Zero dependencies. Serves the map UI and forwards coordinates to a real
 * Android phone over adb using the open-source "Appium Settings" mock-location
 * service (io.appium.settings).
 *
 * Listens on 127.0.0.1 only. Run:  node server.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const PORT = Number(process.env.PORT || 3000);
const ADB = process.env.ADB_PATH || 'adb';
const PKG = 'io.appium.settings';
const PUBLIC_DIR = path.join(__dirname, 'public');
// The desktop app points these at the tools bundled inside the installer.
const APK_PATH = process.env.APK_PATH || path.join(__dirname, 'apk', 'io.appium.settings.apk');
const IOS_HELPER_BIN = process.env.IOS_HELPER_BIN || '';   // frozen ios_helper (no Python needed)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** Run adb with an argument array (no shell, so no injection). */
function adb(args, timeout = 15000) {
  return new Promise((resolve) => {
    execFile(ADB, args, { timeout }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: String(stdout || '').trim(),
        stderr: String(stderr || (err && err.message) || '').trim(),
      });
    });
  });
}

function withSerial(serial, args) {
  return serial ? ['-s', serial, ...args] : args;
}

const SERIAL_RE = /^[A-Za-z0-9._:\-]{1,64}$/;
function cleanSerial(s) {
  return typeof s === 'string' && SERIAL_RE.test(s) ? s : '';
}

function num(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/* ------------------------------------------------------------------ */
/* iPhone support (via pymobiledevice3 + a long-lived Python helper)   */
/* ------------------------------------------------------------------ */
const IOS_HELPER = path.join(__dirname, 'ios_helper.py');
const UDID_RE = /^[A-Za-z0-9\-]{8,64}$/;

/** Target strings from the UI look like "ios:<UDID>" or "android:<serial>" (plain serial also accepted). */
function parseTarget(s) {
  if (typeof s !== 'string') return { platform: 'android', id: '' };
  if (s.startsWith('ios:')) {
    const id = s.slice(4);
    return { platform: 'ios', id: UDID_RE.test(id) ? id : '' };
  }
  return { platform: 'android', id: cleanSerial(s.replace(/^android:/, '')) };
}

/** Find the Python interpreter that has pymobiledevice3 (works for pipx, venv and pip installs). */
async function findIosPython() {
  if (process.env.IOS_PYTHON) return process.env.IOS_PYTHON;
  const exe = await new Promise((resolve) => {
    execFile(process.platform === 'win32' ? 'where' : 'which', ['pymobiledevice3'], (err, out) =>
      resolve(err ? null : String(out).split('\n')[0].trim() || null)
    );
  });
  if (!exe) return null;
  // 1) A python sitting next to the real pymobiledevice3 script (pipx / venv / uv installs).
  try {
    const dir = path.dirname(fs.realpathSync(exe));
    for (const name of ['python3', 'python', 'python.exe']) {
      const cand = path.join(dir, name);
      if (fs.existsSync(cand)) return cand;
    }
  } catch (_) { /* ignore */ }
  // 2) The script's shebang, but never a shell (newer launchers use "#!/bin/sh" + an exec trick).
  try {
    const text = fs.readFileSync(exe, 'utf8').split('\n', 3);
    if (text[0].startsWith('#!')) {
      const parts = text[0].slice(2).trim().split(/\s+/);
      const py = parts[0].endsWith('/env') ? parts[1] : parts[0];
      if (py && /python/i.test(path.basename(py))) return py;
      // "#!/bin/sh" launchers: the real interpreter is on the next line:  '''exec' "/path/python" "$0" "$@"
      const m = (text[1] || '').match(/exec'?\s+"?([^"\s]+python[^"\s]*)"?/i);
      if (m) return m[1];
    }
  } catch (_) { /* binary launcher (Windows): fall through */ }
  return process.platform === 'win32' ? 'python' : 'python3';
}

/** How to run the iPhone helper: the bundled binary (desktop app) or python + ios_helper.py. */
async function iosHelperCommand(args) {
  if (IOS_HELPER_BIN) return fs.existsSync(IOS_HELPER_BIN) ? { cmd: IOS_HELPER_BIN, args } : null;
  const py = await findIosPython();
  return py ? { cmd: py, args: [IOS_HELPER, ...args] } : null;
}

let iosListCache = { t: 0, v: null };

/** iPhones visible over USB/Wi-Fi (no tunnel needed just to list them). */
async function listIosDevices() {
  const hc = await iosHelperCommand(['--list']);
  if (!hc) return { installed: false, devices: [] };
  if (iosListCache.v && Date.now() - iosListCache.t < 2500) return iosListCache.v;
  const out = await new Promise((resolve) =>
    execFile(hc.cmd, hc.args, { timeout: 15000 }, (err, stdout) => resolve(err ? '' : String(stdout)))
  );
  let devices = [];
  try {
    const j = JSON.parse(out.trim().split('\n').pop());
    devices = (j.devices || [])
      .filter((d) => UDID_RE.test(String(d.udid)))
      .map((d) => ({
        serial: d.udid, platform: 'ios', state: 'device',
        model: `iPhone ${d.udid.slice(0, 8)}${d.type && d.type !== 'USB' ? ' (' + d.type + ')' : ''}`,
      }));
  } catch (_) { /* helper printed nothing useful: treat as no devices */ }
  iosListCache = { t: Date.now(), v: { installed: true, devices } };
  return iosListCache.v;
}

const iosHelpers = new Map(); // udid -> helper

async function getIosHelper(udid) {
  const existing = iosHelpers.get(udid);
  if (existing && !existing.dead) return existing;
  const hc = await iosHelperCommand([udid]);
  if (!hc) throw new Error('iPhone support is not available: pymobiledevice3 not found. Install it: pipx install pymobiledevice3');
  const h = { dead: false, nextId: 1, pending: new Map(), buf: '', failure: null };
  h.proc = spawn(hc.cmd, hc.args, { stdio: ['pipe', 'pipe', 'pipe'] });
  h.ready = new Promise((resolve) => { h.resolveReady = resolve; });
  let stderr = '';
  h.proc.stderr.on('data', (c) => { stderr = (stderr + c).slice(-2000); });
  h.proc.stdout.on('data', (chunk) => {
    h.buf += chunk;
    let i;
    while ((i = h.buf.indexOf('\n')) >= 0) {
      const line = h.buf.slice(0, i).trim();
      h.buf = h.buf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch (_) { continue; }
      if ('ready' in msg) { h.resolveReady(msg); if (!msg.ready) h.failure = msg.error; }
      else if (h.pending.has(msg.id)) { h.pending.get(msg.id)(msg); h.pending.delete(msg.id); }
    }
  });
  const onEnd = (err) => {
    h.dead = true;
    if (iosHelpers.get(udid) === h) iosHelpers.delete(udid);
    h.resolveReady({ ready: false, error: h.failure || (err && err.message) || stderr.trim() || 'iPhone helper exited' });
    for (const cb of h.pending.values()) cb({ ok: false, error: 'iPhone helper exited' });
    h.pending.clear();
  };
  h.proc.on('exit', () => onEnd());
  h.proc.on('error', onEnd);
  iosHelpers.set(udid, h);
  return h;
}

function withTimeout(p, ms, msg) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(t));
}

async function iosCall(udid, msg) {
  if (!udid) return { ok: false, error: 'invalid iPhone id' };
  let h;
  try {
    h = await getIosHelper(udid);
    const ready = await withTimeout(h.ready, 25000, 'timed out connecting to the iPhone');
    if (!ready.ready) return { ok: false, error: ready.error || 'iPhone helper failed' };
    const id = h.nextId++;
    const reply = new Promise((resolve) => h.pending.set(id, resolve));
    h.proc.stdin.write(JSON.stringify({ ...msg, id }) + '\n');
    const r = await withTimeout(reply, 10000, 'iPhone did not answer in time');
    return r.ok ? { ok: true } : { ok: false, error: r.error || 'iPhone error' };
  } catch (e) {
    if (h) { h.dead = true; try { h.proc.kill(); } catch (_) {} iosHelpers.delete(udid); }
    return { ok: false, error: String(e.message || e) };
  }
}

function closeAllIosHelpers() {
  for (const h of iosHelpers.values()) { try { h.proc.kill(); } catch (_) {} }
}
process.on('exit', closeAllIosHelpers);
if (require.main === module) {   // only when run as `node server.js` (the desktop app handles its own signals)
  process.on('SIGINT', () => { closeAllIosHelpers(); process.exit(0); });
  process.on('SIGTERM', () => { closeAllIosHelpers(); process.exit(0); });
}

/* ------------------------------------------------------------------ */
/* Android (adb)                                                       */
/* ------------------------------------------------------------------ */
async function listDevices() {
  const r = await adb(['devices', '-l']);
  if (!r.ok) {
    return { adbFound: false, error: r.stderr, devices: [] };
  }
  const devices = r.stdout
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const parts = l.split(/\s+/);
      const model = (l.match(/model:(\S+)/) || [])[1] || '';
      return { serial: parts[0], state: parts[1], model };
    });
  return { adbFound: true, devices };
}

async function helperInstalled(serial) {
  const r = await adb(withSerial(serial, ['shell', 'pm', 'list', 'packages', PKG]));
  return r.ok && r.stdout.includes(PKG);
}

async function handleStatus(url) {
  const target = parseTarget(url.searchParams.get('serial') || '');
  const [d, ios] = await Promise.all([listDevices(), listIosDevices()]);
  d.devices = [...d.devices.map((x) => ({ ...x, platform: 'android' })), ...ios.devices];
  d.ios = { installed: ios.installed };
  if (target.platform === 'android' && d.adbFound && target.id) {
    d.helperInstalled = await helperInstalled(target.id);
  } else if (target.platform === 'ios' && target.id) {
    d.helperInstalled = ios.devices.some((x) => x.serial === target.id);
  }
  d.apkBundled = fs.existsSync(APK_PATH);
  return d;
}

async function handleSetup(body) {
  const target = parseTarget(body.serial);
  if (target.platform === 'ios') {
    const ios = await listIosDevices();
    const log = [];
    log.push(ios.installed ? 'iPhone helper: found' : 'iPhone helper: NOT found (pipx install pymobiledevice3)');
    const seen = ios.devices.some((x) => x.serial === target.id);
    log.push(seen ? 'iPhone visible over USB: yes' : 'iPhone visible over USB: no (plug it in, unlock it, tap Trust)');
    // Try the real connection now, so problems show up here and not in the middle of a route.
    let ok = ios.installed && seen;
    if (ok) {
      const r = await iosCall(target.id, { cmd: 'ping' });
      log.push(r.ok ? 'Connection to the iPhone: ok' : 'Connection to the iPhone failed: ' + r.error);
      ok = r.ok;
    }
    return { ok, log, error: ok ? undefined : 'iPhone is not ready, see the log lines above. Nothing is installed on the iPhone itself.' };
  }
  const serial = target.id;
  const log = [];
  if (!(await helperInstalled(serial))) {
    if (!fs.existsSync(APK_PATH)) {
      return {
        ok: false,
        error:
          'Appium Settings is not installed on the phone and the APK file was not found (' + APK_PATH + '). ' +
          'Download it from https://github.com/appium/io.appium.settings/releases and save it there.',
      };
    }
    const inst = await adb(withSerial(serial, ['install', '-r', '-g', APK_PATH]), 90000);
    log.push('install: ' + (inst.stdout || inst.stderr));
    if (!inst.ok) return { ok: false, error: 'APK install failed', log };
  } else {
    log.push('Appium Settings already installed');
  }
  const perm = await adb(
    withSerial(serial, ['shell', 'appops', 'set', PKG, 'android:mock_location', 'allow'])
  );
  log.push('mock_location allow: ' + (perm.ok ? 'ok' : perm.stderr));
  // Best effort: location + notification permissions (foreground service)
  for (const p of [
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.POST_NOTIFICATIONS',
  ]) {
    await adb(withSerial(serial, ['shell', 'pm', 'grant', PKG, p]));
  }
  return { ok: perm.ok, log, error: perm.ok ? undefined : perm.stderr };
}

async function handleLocation(body) {
  const target = parseTarget(body.serial);
  const serial = target.id;
  const lat = num(body.lat, -90, 90);
  const lng = num(body.lng, -180, 180);
  if (lat === null || lng === null) return { ok: false, error: 'invalid lat/lng' };
  // iPhone: only latitude/longitude can be set (speed/bearing are derived by iOS)
  if (target.platform === 'ios') return iosCall(serial, { cmd: 'set', lat, lng });
  const args = [
    'shell', 'am', 'start-foreground-service', '--user', '0',
    '-n', `${PKG}/.LocationService`,
    '--es', 'longitude', String(lng),
    '--es', 'latitude', String(lat),
  ];
  const speed = num(body.speed, 0, 100); // m/s
  if (speed !== null && speed > 0) args.push('--es', 'speed', speed.toFixed(2));
  const bearing = num(body.bearing, 0, 360);
  if (bearing !== null) args.push('--es', 'bearing', bearing.toFixed(1));
  const accuracy = num(body.accuracy, 0, 1000);
  if (accuracy !== null) args.push('--es', 'accuracy', String(accuracy));
  const r = await adb(withSerial(serial, args));
  const failed = !r.ok || /error|exception|not found/i.test(r.stdout + r.stderr);
  return failed ? { ok: false, error: r.stderr || r.stdout } : { ok: true };
}

async function handleStop(body) {
  const target = parseTarget(body.serial);
  if (target.platform === 'ios') {
    const r = await iosCall(target.id, { cmd: 'clear' });
    const h = iosHelpers.get(target.id);
    if (h) { try { h.proc.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n'); } catch (_) {} iosHelpers.delete(target.id); }
    return r;
  }
  const serial = target.id;
  const r = await adb(withSerial(serial, ['shell', 'am', 'stopservice', `${PKG}/.LocationService`]));
  return { ok: r.ok, error: r.ok ? undefined : r.stderr };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e5) req.destroy();
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Basic DNS-rebinding / cross-site protection: only accept local hosts.
    const host = (req.headers.host || '').split(':')[0];
    if (!['localhost', '127.0.0.1'].includes(host)) return send(res, 403, { error: 'forbidden' });

    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, await handleStatus(url));
      if (req.method === 'POST') {
        // Require JSON content type: blocks simple cross-site form posts.
        if (!String(req.headers['content-type'] || '').includes('application/json'))
          return send(res, 415, { error: 'json only' });
        const body = await readJson(req);
        if (url.pathname === '/api/location') return send(res, 200, await handleLocation(body));
        if (url.pathname === '/api/setup') return send(res, 200, await handleSetup(body));
        if (url.pathname === '/api/stop') return send(res, 200, await handleStop(body));
      }
      return send(res, 404, { error: 'not found' });
    }

    // static files
    let rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: 'forbidden' });
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  } catch (e) {
    send(res, 500, { error: String(e && e.message || e) });
  }
});

/** Start listening. port 0 = any free port (used by the desktop app). Resolves with the real port. */
function start(port = PORT) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      console.log(`Courier GPS Simulator running: http://localhost:${actual}`);
      console.log(`Using adb: ${ADB}`);
      resolve({ server, port: actual });
    });
  });
}

function stop() {
  closeAllIosHelpers();
  return new Promise((resolve) => server.close(() => resolve()));
}

module.exports = { start, stop, closeAllIosHelpers };

if (require.main === module) {
  start().catch((e) => { console.error('Could not start: ' + e.message); process.exit(1); });
}
