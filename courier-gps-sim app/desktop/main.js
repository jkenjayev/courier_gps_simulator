'use strict';
/**
 * Courier GPS Simulator - Electron main process.
 * Starts the same local server as `node server.js` (on a free port, localhost only)
 * and shows the map UI in a normal app window.
 */
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { resolveTools } = require('./tools');

// Some Linux setups (AppArmor, AppImage) block Chromium's sandbox helper. The app only ever loads
// its own localhost page, so running without that sandbox is acceptable here.
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox');

const tools = resolveTools({
  platform: process.platform,
  packaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  devRoot: __dirname,
});
Object.assign(process.env, tools.env);   // must happen before server.js is loaded

let sim = null;
let win = null;
let localOrigin = '';

function fail(message) {
  dialog.showErrorBox('Courier GPS Simulator', message);
  app.quit();
}

function createWindow(port) {
  localOrigin = `http://127.0.0.1:${port}`;
  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    title: 'Courier GPS Simulator',
    backgroundColor: '#14171c',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const ua = win.webContents.getUserAgent();
  win.webContents.setUserAgent(`${ua} CourierGPSSimulator/${app.getVersion()}`);

  // Links such as the OpenStreetMap attribution open in the normal browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(localOrigin)) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  win.loadURL(localOrigin);
  win.on('closed', () => { win = null; });
}

/* ---- optional macOS fallback: root tunnel for iPhones, started through the system password dialog ---- */
function asEscape(s) { return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
function runAsAdmin(shellCommand, done) {
  const script = `do shell script "${asEscape(shellCommand)}" with administrator privileges`;
  execFile('osascript', ['-e', script], (err) => done(err));
}
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [];
  if (isMac) template.push({ role: 'appMenu' });
  template.push({ role: 'editMenu' });
  template.push({
    label: 'View',
    submenu: [
      { role: 'reload' }, { role: 'forceReload' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
      { role: 'togglefullscreen' }, { role: 'toggleDevTools' },
    ],
  });
  if (isMac && tools.found.iosHelper) {
    const bin = tools.env.IOS_HELPER_BIN;
    template.push({
      label: 'iPhone',
      submenu: [
        {
          label: 'Start admin tunnel (only if iPhone will not connect)…',
          click: () => runAsAdmin(`"${bin}" --tunneld > /tmp/courier-gps-tunneld.log 2>&1 &`, (err) => {
            dialog.showMessageBox({ message: err ? 'The admin tunnel could not be started.' : 'Admin tunnel started. Press Refresh in the app.' });
          }),
        },
        {
          label: 'Stop admin tunnel…',
          click: () => runAsAdmin('pkill -f "ios-helper --tunneld" || true', () => {}),
        },
      ],
    });
  }
  template.push({ role: 'windowMenu' });
  template.push({
    role: 'help',
    submenu: [
      { label: 'OpenStreetMap', click: () => shell.openExternal('https://www.openstreetmap.org/copyright') },
      { label: 'Appium Settings (Android mock location)', click: () => shell.openExternal('https://github.com/appium/io.appium.settings') },
    ],
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

  app.whenReady().then(async () => {
    const serverFile = path.join(__dirname, 'app', 'server.js');
    if (!fs.existsSync(serverFile)) return fail('app/server.js is missing. Run "npm run prepare-app" first.');
    try {
      sim = require(serverFile);
      const { port } = await sim.start(0);   // 0 = any free port
      buildMenu();
      createWindow(port);
    } catch (e) {
      fail('Could not start the simulator: ' + (e && e.message ? e.message : e));
    }
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { if (sim) sim.closeAllIosHelpers(); });
}
