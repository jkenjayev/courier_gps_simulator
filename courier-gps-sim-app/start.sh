#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Courier GPS Simulator - one command that does everything
#
#   bash start.sh
#
#   1. installs whatever is missing (Node.js, adb, the Appium Settings APK, iPhone tools on macOS)
#   2. prepares every phone that is plugged in
#   3. starts the simulator and opens it in your browser
#
# Stop it with Ctrl+C. The phone then gets its real location back.
# Safe to run again and again: it only installs what is missing.
#
# Works on macOS, Linux and Windows (run it in Git Bash). Extra options go to setup.sh,
# for example:  bash start.sh --android      (see: bash setup.sh --help)
# ---------------------------------------------------------------------------
set -u

cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
ROOT="$(pwd)"
PORT="${PORT:-3000}"
URL="http://localhost:$PORT"

# 1 + 2: install what is missing and prepare the phones (asks no questions)
export SETUP_FROM_START=1
if ! bash "$ROOT/setup.sh" --yes --no-launch "$@"; then
  echo
  echo "Setup did not finish. Fix the items above, then run:  bash start.sh"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Node.js was just installed but this terminal cannot see it yet."
  echo "Open a NEW terminal window and run:  bash start.sh"
  exit 1
fi

is_up() {
  node -e "fetch('$URL/api/status').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" >/dev/null 2>&1
}

open_url() {
  case "$(uname -s 2>/dev/null)" in
    Darwin) open "$1" ;;
    Linux)
      if command -v xdg-open >/dev/null 2>&1; then xdg-open "$1"
      elif command -v wslview >/dev/null 2>&1; then wslview "$1"
      else return 1; fi ;;
    MINGW*|MSYS*|CYGWIN*) MSYS2_ARG_CONV_EXCL='*' cmd.exe /c start "" "$1" ;;
    *) return 1 ;;
  esac >/dev/null 2>&1
}

# Already running (second start.sh in another window)? Just open it.
# But an OLD copy that is still running cannot save routes, so tell the user to close it first.
is_current() {
  node -e "fetch('$URL/api/status').then((r) => r.json()).then((j) => process.exit(j.api >= 2 ? 0 : 1), () => process.exit(1))" >/dev/null 2>&1
}
if is_up; then
  if ! is_current; then
    echo
    echo "An OLD version of the simulator is still running at $URL (it cannot save routes)."
    echo "Close it first: go to the terminal window where it runs and press Ctrl+C (or quit the desktop app),"
    echo "then run:  bash start.sh"
    exit 1
  fi
  echo "The simulator is already running at $URL"
  open_url "$URL" || echo "Open $URL in your browser."
  exit 0
fi

# 3: open the browser as soon as the simulator answers, and run the simulator in THIS window.
(
  for _ in $(seq 1 30); do
    if is_up; then open_url "$URL" || echo "Open $URL in your browser."; break; fi
    sleep 1
  done
) &

echo
echo "Starting the simulator at $URL"
echo "Press Ctrl+C here to stop it. The phone then gets its real location back."
echo
exec node "$ROOT/server.js"
