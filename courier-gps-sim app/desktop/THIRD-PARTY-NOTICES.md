# Third-party software bundled in Courier GPS Simulator

| Component | Used for | License |
|-----------|----------|---------|
| Electron | App shell | MIT |
| Leaflet | Map display | BSD-2-Clause |
| OpenStreetMap data and tiles | Map | ODbL (data), see https://www.openstreetmap.org/copyright |
| OSRM public demo server | Road routing (online service, light use) | see https://project-osrm.org |
| Android SDK Platform-Tools (`adb`) | Talking to Android phones | Apache-2.0 (Google), NOTICE.txt ships alongside adb |
| Appium Settings (`io.appium.settings`) | Mock-location provider on the Android phone | Apache-2.0 |
| pymobiledevice3 (macOS build only) | Talking to iPhones | GPL-3.0 |
| PyInstaller (build tool, macOS only) | Packaging the iPhone helper | GPL-2.0 with exception for bundled programs |

pymobiledevice3 is GPL-3.0. Keep the source link https://github.com/doronz88/pymobiledevice3 with any
copy you share, and check the license terms with your company before distributing the macOS app outside
your own team.
