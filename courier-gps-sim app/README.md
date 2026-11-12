# Courier GPS Simulator

Moves a **real Android phone's or iPhone's GPS** from point A to point B along real roads, so you can
test courier tracking in the courier app. The courier app keeps reading the phone's normal location;
this tool feeds the phone fake coordinates.

```
Browser map (Leaflet + OpenStreetMap + OSRM routing)
        │  coordinates every N seconds
        ▼
server.js  (localhost:3000, Node, no dependencies)
        │  adb shell am start-foreground-service ...
        ▼
Android phone ── "Appium Settings" mock-location provider ── courier app sees it as GPS

server.js ── ios_helper.py (pymobiledevice3, via tunneld) ──► iPhone location simulation
```

All free: OpenStreetMap tiles, OSRM public routing server, Appium Settings (Apache-2.0).

## Quick start (all systems)

```bash
bash setup.sh
```

`setup.sh` checks and installs what is missing, sets up a connected Android phone, and at the end offers to
open a **new terminal tab** with the simulator and your browser.

Prefer a normal installable app (no Terminal, no browser)? See [`desktop/README.md`](desktop/README.md): it builds a
`.dmg` (macOS, with iPhone support), a Windows installer and a Linux AppImage.

| System  | How to run `setup.sh`                                   | Android | iPhone |
|---------|---------------------------------------------------------|---------|--------|
| macOS   | Terminal: `bash setup.sh`                               | yes     | yes    |
| Linux   | Terminal: `bash setup.sh` (apt, dnf, pacman, zypper)    | yes     | no     |
| Windows | **Git Bash** (comes with Git for Windows): `bash setup.sh` | yes  | no     |

Options: `--android`, `--ios`, `--launch` (open tabs without asking), `--no-launch`, `--yes`,
`--dry-run` (preview only, changes nothing), `--skip-apk`, `--start`, `--help`. It is safe to run again.

Things no script can do for you (the script prints them at the end): turning on USB debugging on an Android
phone, and Developer Mode + Trust on an iPhone.

The sections below describe the same steps by hand.

## Requirements (on the computer, not the phone)

- Node.js 18+
- Android platform-tools (`adb`) — `brew install android-platform-tools` on macOS
- USB cable

## One-time phone setup

1. Settings → About phone → tap **Build number** 7 times (enables Developer options).
2. Developer options → enable **USB debugging**. (On Xiaomi/Redmi/Poco also enable
   **USB debugging (Security settings)** and **Install via USB**.)
3. Plug the phone in and accept the "Allow USB debugging?" prompt.
4. Download `io.appium.settings-*.apk` from <https://github.com/appium/io.appium.settings/releases>
   and save it as `apk/io.appium.settings.apk`.
5. Start the tool (below), then press **Setup phone** in the UI. It installs the APK and runs
   `appops set io.appium.settings android:mock_location allow`.
   - If your phone still refuses mock locations: Developer options → **Select mock location app** →
     **Appium Settings**.

## iPhone setup (instead of, or in addition to, Android)

Works on iOS 17 and newer (written against `pymobiledevice3` 11.x). Uses a Mac, a USB cable and
the free open-source `pymobiledevice3`. Nothing is installed on the iPhone.

1. Install: `brew install pipx && pipx ensurepath && pipx install pymobiledevice3`
2. iPhone: Settings → Privacy & Security → **Developer Mode** → on, then restart the phone.
3. Plug in the iPhone, unlock it, tap **Trust This Computer**.
4. Mount the developer image once: `pymobiledevice3 mounter auto-mount`
5. Usually no tunnel or `sudo` is needed: the simulator tries to open its own, and uses a running tunnel if there is one.
   If an iPhone will not connect, start a root tunnel as a fallback in a **separate Terminal window**:
   `sudo pymobiledevice3 remote tunneld`
6. Start the simulator (`node server.js`), open the page, pick the 🍎 iPhone in the list.
   The badge should say **iPhone ready**.

iPhone notes
- Only latitude/longitude are sent (iOS has no way to set speed/bearing; it derives them
  from movement).
- The fake location lasts only while the simulator is running. **Release GPS** (or stopping the
  server) puts the iPhone back on its real location.
- If your pipx/venv layout is unusual, set `IOS_PYTHON=/path/to/python` (the Python that has
  `pymobiledevice3`) before `node server.js`.
- Verify coordinate order once with **Put phone at A** and open Apple Maps: the blue dot must be at A.

## Run

```bash
cd courier-gps-sim
node server.js
# open http://localhost:3000
```

Then: click the map for **A**, click for **B** (or type `lat, long`), set speed, press **Start**.
Use **Dry run** to preview the movement on the map without a phone.

Tips
- Turn off **Wi-Fi/Network location accuracy** boosters if the real location keeps snapping back
  (Settings → Location → Google Location Accuracy), and use **High accuracy** mode.
- **Release GPS** stops mocking, so the phone goes back to its real location. Always do this
  after testing.
- Wireless debugging works too: `adb pair` / `adb connect <ip>:<port>`, then **Refresh**.

## What gets sent to the phone

Every update (default 1 s): latitude, longitude, speed (m/s), bearing (degrees, from the route
direction) and accuracy (5 m). Optional **GPS jitter** adds random noise to test how the app
and backend handle imprecise fixes.

## Security

The server listens on `127.0.0.1` only, rejects non-local `Host` headers and non-JSON POSTs, and calls
`adb` with argument arrays (no shell). Don't expose it to the network.

## Notes / limits

- OSRM public demo server is for light use. To use your own, change the `OSRM` constant in
  `public/index.html`.
- Some apps detect mock locations (`isMock` / `isFromMockProvider`). If your courier app blocks
  them, QA builds need that check disabled.
- Update interval below ~0.5 s isn't useful: each adb call takes 100–300 ms, and the mock service
  re-sends the last position every 2 s anyway.
