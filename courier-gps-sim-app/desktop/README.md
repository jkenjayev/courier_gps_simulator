# Courier GPS Simulator: desktop app

A normal installable app for macOS, Windows and Linux. No Terminal, no browser, no `setup.sh` for testers.

| Installer | Built on | Includes |
|-----------|----------|----------|
| `.dmg` (macOS) | a Mac | adb, Appium Settings APK, **iPhone support** |
| `.exe` installer (Windows) | a Windows PC | adb, Appium Settings APK (Android only) |
| `.AppImage` (Linux) | a Linux PC | adb, Appium Settings APK (Android only) |

An installer can only be built on its own operating system (a Mac builds the .dmg, and so on).

## Build the installer (the person who builds it, once)

Needs [Node.js](https://nodejs.org) **22.12 or newer** (Electron 45 and its build tools refuse older versions) and internet access. For the Mac build with iPhone support
you also need Python 3.9+ (`brew install python@3.12`).

```bash
cd desktop
npm install          # downloads Electron and the packager (a few hundred MB, one time)
npm run dist         # builds the installer for THIS computer into desktop/dist/
```

`npm run dist` does everything: copies the simulator in, downloads adb and the Appium Settings APK,
(on a Mac) builds the iPhone helper into a single program, then builds the installer.
Use `npm run dist:no-ios` on a Mac to leave iPhone support out (smaller, no Python needed).

Try it without building an installer: `npm start`.

## Install and first start (testers)

**macOS**: open the `.dmg`, drag *Courier GPS Simulator* to Applications. The app is not signed with a paid Apple
certificate, so macOS blocks the first start. Do either:
- right-click the app > **Open** > **Open**, or
- run once in Terminal: `xattr -cr "/Applications/Courier GPS Simulator.app"`

**Windows**: run the installer. If SmartScreen says "Windows protected your PC", click **More info** > **Run anyway**.
For Android, install your phone maker's USB driver if the phone does not show up (Samsung needs the Samsung USB driver).

**Linux**: `chmod +x "Courier GPS Simulator-*.AppImage"` and run it. If the phone shows "no permissions", add your user to the
`plugdev` group or install your phone maker's udev rules.

## Using the app

1. Phone preparation, once per phone (nothing can do this for you):
   - Android: Settings > About phone > tap *Build number* 7 times; Developer options > **USB debugging** on; plug in; tap **Allow**.
   - iPhone (iOS 17+, Mac only): Settings > Privacy & Security > **Developer Mode** on and restart; plug in; unlock; **Trust**.
2. Open the app. Pick the phone in the list, click **Setup phone** once (installs the mock-location helper on Android, and checks the
   connection on iPhone).
3. Click the map for A and B (or type an address in **Search an address**), set the speed, press **Start**.
   - **Stop and use real GPS** (red bar at the bottom of the window, always visible): stops the movement and hands the phone back to
     its own GPS. The bar also shows whether the phone GPS is currently *real* or *FAKE*.
   - **Round trip** repeats A → B → A a set number of times, or until you press Stop.
   - **Single point** puts the phone on one point and keeps it there.
   - **Saved routes** and **Saved places** (collapsed sections at the bottom of the panel, click the title to open): type a title and
     press Save (or press **Save…** next to the points). Press **Use** to draw a saved route on the map (it also restores speed, interval, jitter and round-trip settings), or
     to put a saved place on the map (first Use fills A, the next fills B). You can also rename or delete them. They are stored in
     `~/.courier-gps-sim/data.json` (shared with the browser version, so copy that file to move them to another computer).
   - Every section (Phone, Points, Movement, Saved routes, Saved places, Log) can be collapsed; the app remembers which ones.
   - The small **i** buttons show help texts on hover or click.
4. When you close the app, the phone gets its real location back automatically. If the app is force-quit or crashes, a small
   helper process does the same within a second or two.

If an iPhone will not connect, use the menu **iPhone > Start admin tunnel**. It asks for your Mac password once and starts the
fallback tunnel, then press **Refresh**.

## Where things are

- `main.js` is the app window; `tools.js` finds the bundled adb/APK/helper.
- The map page, server and watchdog are the same files as the browser version (`../public`, `../server.js`, `../watchdog.js`), copied by `npm run prepare-app`.
- `scripts/fetch-tools.js` downloads adb and the APK; `scripts/build-ios-helper.sh` freezes the iPhone helper (macOS only).
- Licenses of bundled parts: `THIRD-PARTY-NOTICES.md` (note: pymobiledevice3 is GPL-3.0).

## Limits

- The macOS iPhone helper is built for the CPU of the Mac that builds it (Apple Silicon or Intel).
- Not signed or notarized (by choice, to avoid paid certificates). The warnings above are expected.
- Windows and Linux have no iPhone support (Apple's tooling for this is macOS only in this app).
