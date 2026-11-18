#!/usr/bin/env bash
# Builds the iPhone helper into ONE self-contained program (no Python needed on the tester's Mac).
# macOS only. Output: build-resources/mac/ios-helper
# The result is for the CPU of the Mac that builds it (Apple Silicon -> arm64, Intel -> x86_64).
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "The iPhone helper can only be built on macOS (iPhone support is macOS only)." >&2
  exit 1
fi

cd "$(dirname "$0")/.."
OUT="build-resources/mac"
mkdir -p "$OUT"

# Pick the newest Python 3.9+ we can find.
PY=""
for c in "${PYTHON:-}" python3.13 python3.12 python3.11 python3.10 python3.9 python3; do
  [ -n "$c" ] || continue
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  echo "Python 3.9 or newer is needed to build the iPhone helper. Install it with:  brew install python@3.12" >&2
  exit 1
fi
echo "Using $($PY --version) ($PY)"

# Build inside a throw-away virtual environment.
rm -rf .ios-venv .ios-build
"$PY" -m venv .ios-venv
# shellcheck disable=SC1091
. .ios-venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet pymobiledevice3 pyinstaller
echo "pymobiledevice3 $(pip show pymobiledevice3 | awk '/^Version:/{print $2}')"

pyinstaller --onefile --noconfirm --clean --log-level WARN \
  --name ios-helper \
  --distpath "$OUT" --workpath .ios-build --specpath .ios-build \
  --collect-all pymobiledevice3 --collect-all pmd_pytcp \
  --hidden-import pymobiledevice3.remote.native_tunnel \
  --hidden-import pymobiledevice3.remote.userspace_tunnel \
  ../ios_helper.py

deactivate
rm -rf .ios-venv .ios-build

# Smoke test: the program must start and answer.
echo "Smoke test:"
"$OUT/ios-helper" --list || { echo "ios-helper did not run" >&2; exit 1; }
echo "OK: $OUT/ios-helper ($(du -h "$OUT/ios-helper" | cut -f1))"
