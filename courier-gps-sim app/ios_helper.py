#!/usr/bin/env python3
"""
iPhone location helper for Courier GPS Simulator.

Modes
  ios_helper.py --list        print {"devices":[{"udid":...,"type":"USB"}]} and exit
  ios_helper.py --tunneld     run `pymobiledevice3 remote tunneld` (needs root; optional fallback)
  ios_helper.py <UDID>        keep ONE connection to that iPhone open and apply fake GPS
                              coordinates sent on stdin (used by server.js)

Connection to the iPhone (iOS 17+), first one that works wins:
  1. an already running tunneld   (sudo pymobiledevice3 remote tunneld)
  2. macOS native tunnel          (no root, piggybacks on the system's remoted)
  3. userspace tunnel             (no root, pure Python)

The fake location lasts only while this process is alive, so server.js keeps it running until
you press Release GPS or stop the server.

Protocol for <UDID> mode: one JSON object per line on stdin, one JSON reply per line on stdout.
    {"id": 1, "cmd": "set", "lat": 41.3, "lng": 69.2}  ->  {"id": 1, "ok": true}
    {"id": 2, "cmd": "clear"}                           ->  {"id": 2, "ok": true}
    {"id": 3, "cmd": "quit"}
The first line printed is {"ready": true, "via": "..."} or {"ready": false, "error": "..."}.
"""
import asyncio
import json
import sys


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


async def list_devices() -> None:
    try:
        from pymobiledevice3 import usbmux
        devices = await usbmux.list_devices()
        emit({"devices": [{"udid": d.serial, "type": getattr(d, "connection_type", "USB")} for d in devices]})
    except Exception as e:
        emit({"devices": [], "error": str(e)})


async def acquire_rsd(udid: str):
    """Return (rsd, how). Tries tunneld first, then the no-root tunnels."""
    errors = []

    # 1) tunneld (known to work when the user started it with sudo)
    try:
        from pymobiledevice3.exceptions import TunneldConnectionError
        from pymobiledevice3.tunneld.api import get_tunneld_device_by_udid
        try:
            rsd = await get_tunneld_device_by_udid(udid)
            if rsd is not None:
                return rsd, "tunneld"
        except TunneldConnectionError:
            pass  # not running: normal, go on
    except Exception as e:
        errors.append(f"tunneld: {e}")

    # 2) macOS native tunnel (no root)
    if sys.platform == "darwin":
        try:
            from pymobiledevice3.remote import native_tunnel
            return await native_tunnel.establish_native_rsd(serial=udid), "native"
        except Exception as e:
            errors.append(f"native: {e}")

    # 3) userspace tunnel (no root)
    try:
        from pymobiledevice3.remote import userspace_tunnel
        return await userspace_tunnel.establish_userspace_rsd(serial=udid, remotepairing_fallback=False), "userspace"
    except Exception as e:
        errors.append(f"userspace: {e}")

    raise RuntimeError("; ".join(errors) or "no tunnel available")


async def serve(udid: str) -> None:
    try:
        from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
        from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation
    except Exception as e:  # pymobiledevice3 missing or API changed
        emit({"ready": False, "error": f"pymobiledevice3 import failed: {e}"})
        return

    try:
        rsd, via = await acquire_rsd(udid)
    except Exception as e:
        emit({"ready": False, "error": (
            "Could not open a connection to the iPhone. Check: iOS 17 or newer, Developer Mode is on "
            "(Settings > Privacy & Security), the iPhone is unlocked and trusted, and the developer image is mounted. "
            f"Details: {e}. Fallback: start a root tunnel (sudo pymobiledevice3 remote tunneld)."
        )})
        return

    loop = asyncio.get_running_loop()
    try:
        async with DvtProvider(rsd) as dvt, LocationSimulation(dvt) as sim:
            emit({"ready": True, "via": via})
            while True:
                line = await loop.run_in_executor(None, sys.stdin.readline)
                if not line:  # server closed the pipe
                    break
                msg = None
                try:
                    msg = json.loads(line)
                    cmd = msg.get("cmd")
                    if cmd == "set":
                        # signature is set(latitude, longitude)
                        await sim.set(float(msg["lat"]), float(msg["lng"]))
                        emit({"id": msg.get("id"), "ok": True})
                    elif cmd == "clear":
                        await sim.clear()
                        emit({"id": msg.get("id"), "ok": True})
                    elif cmd == "ping":
                        emit({"id": msg.get("id"), "ok": True})
                    elif cmd == "quit":
                        break
                    else:
                        emit({"id": msg.get("id"), "ok": False, "error": "unknown cmd"})
                except Exception as e:
                    emit({"id": msg.get("id") if isinstance(msg, dict) else None, "ok": False, "error": str(e)})
    except Exception as e:
        emit({"ready": False, "error": f"DVT connection failed (is Developer Mode on and the developer image mounted?): {e}"})
    finally:
        try:
            await rsd.close()
        except Exception:
            pass


def run_tunneld() -> None:
    from pymobiledevice3.__main__ import main
    sys.argv = ["pymobiledevice3", "remote", "tunneld"]
    main()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: ios_helper.py --list | --tunneld | <UDID>", file=sys.stderr)
        sys.exit(2)
    arg = sys.argv[1]
    if arg == "--list":
        asyncio.run(list_devices())
    elif arg == "--tunneld":
        run_tunneld()
    else:
        asyncio.run(serve(arg))
