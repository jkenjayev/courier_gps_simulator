#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Courier GPS Simulator - first-time setup
#
#   macOS    : Android + iPhone
#   Linux    : Android            (apt, dnf, pacman, zypper)
#   Windows  : Android            (run this in Git Bash, which comes with Git for Windows)
#
# Safe to run again: it only installs what is missing.
#
# Usage:  bash setup.sh [options]
#   --android    set up Android only
#   --ios        set up iPhone only (macOS only)
#   --all        set up both (iPhone part is skipped on non-macOS)
#   -y, --yes    do not ask questions, answer "yes" to every install prompt
#   --launch     when finished, open NEW terminal tabs and start everything
#                (the simulator) and open the browser,
#                without asking. Without this flag you are asked at the end.
#   --no-launch  never open terminal tabs / browser
#   --dry-run    show what would be done (installs, tabs, commands), change nothing
#   --skip-apk   do not download the Appium Settings APK
#   --start      run the simulator in THIS terminal when setup is finished
#   -h, --help   show this help
# ---------------------------------------------------------------------------
set -u

cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
ROOT="$(pwd)"
APK_DIR="$ROOT/apk"
APK_FILE="$APK_DIR/io.appium.settings.apk"
RELEASE_API="${APPIUM_RELEASE_API:-https://api.github.com/repos/appium/io.appium.settings/releases/latest}"

WANT_ANDROID=""
WANT_IOS=""
ASSUME_YES=0
DRY=0
SKIP_APK=0
START=0
LAUNCH=""   # "" = ask at the end, 1 = launch, 0 = never
PORT="${PORT:-3000}"

# ---------- output helpers ----------
if [ -t 1 ]; then
  B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'
else
  B=""; G=""; Y=""; R=""; N=""
fi
WARNS=()
FAILS=()
step()  { printf '\n%s== %s ==%s\n' "$B" "$*" "$N"; }
info()  { printf '   %s\n' "$*"; }
ok()    { printf ' %s✔%s %s\n' "$G" "$N" "$*"; }
warn()  { printf ' %s!%s %s\n' "$Y" "$N" "$*"; WARNS+=("$*"); }
fail()  { printf ' %s✘%s %s\n' "$R" "$N" "$*"; FAILS+=("$*"); }

usage() { sed -n '2,/^set -u/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; }

# ---------- arguments ----------
while [ $# -gt 0 ]; do
  case "$1" in
    --android)  WANT_ANDROID=1; [ -z "$WANT_IOS" ] && WANT_IOS=0 ;;
    --ios)      WANT_IOS=1;     [ -z "$WANT_ANDROID" ] && WANT_ANDROID=0 ;;
    --all)      WANT_ANDROID=1; WANT_IOS=1 ;;
    -y|--yes)   ASSUME_YES=1 ;;
    --dry-run)  DRY=1 ;;
    --skip-apk) SKIP_APK=1 ;;
    --start)    START=1 ;;
    --launch)   LAUNCH=1 ;;
    --no-launch) LAUNCH=0 ;;
    -h|--help)  usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 2 ;;
  esac
  shift
done

# ---------- environment ----------
have() { command -v "$1" >/dev/null 2>&1; }

detect_os() {
  if [ -n "${SETUP_OS_OVERRIDE:-}" ]; then OS="$SETUP_OS_OVERRIDE"; return; fi   # used for testing
  case "$(uname -s 2>/dev/null)" in
    Darwin) OS=macos ;;
    Linux)  if grep -qi microsoft /proc/version 2>/dev/null; then OS=wsl; else OS=linux; fi ;;
    MINGW*|MSYS*|CYGWIN*) OS=windows ;;
    *) OS=unknown ;;
  esac
}
detect_os

# Default targets: Android everywhere, iPhone only on macOS.
if [ -z "$WANT_ANDROID" ]; then WANT_ANDROID=1; fi
if [ -z "$WANT_IOS" ]; then if [ "$OS" = macos ]; then WANT_IOS=1; else WANT_IOS=0; fi; fi

SUDO=""
if [ "$(id -u 2>/dev/null || echo 1)" != 0 ] && have sudo; then SUDO="sudo"; fi

run() {   # run a command, or just print it in --dry-run mode
  if [ "$DRY" = 1 ]; then printf '   [dry-run] %s\n' "$*"; return 0; fi
  "$@"
}

confirm() {   # confirm "question"  -> 0 = yes
  if [ "$ASSUME_YES" = 1 ] || [ "$DRY" = 1 ]; then return 0; fi
  if [ ! -t 0 ]; then return 1; fi    # no terminal and no --yes: never install silently
  local a; read -r -p "   $1 [Y/n] " a
  case "${a:-y}" in [Yy]*) return 0 ;; *) return 1 ;; esac
}

# On Windows, tools installed by winget are not on PATH until a new terminal is opened.
# Add the usual locations for this session so a re-run is not needed.
windows_refresh_path() {
  [ "$OS" = windows ] || return 0
  have cygpath || return 0
  local d
  for d in "${LOCALAPPDATA:-}/Microsoft/WinGet/Links" "${ProgramFiles:-}/nodejs"; do
    [ -n "$d" ] || continue
    d="$(cygpath -u "$d" 2>/dev/null)" || continue
    [ -d "$d" ] && PATH="$d:$PATH"
  done
  export PATH
}

# Install packages with whichever Linux package manager exists.
# usage: linux_install "apt packages" "dnf packages" "pacman packages" "zypper packages"
linux_install() {
  if   have apt-get; then run $SUDO apt-get update && run $SUDO apt-get install -y $1
  elif have dnf;     then run $SUDO dnf install -y $2
  elif have pacman;  then run $SUDO pacman -S --noconfirm --needed $3
  elif have zypper;  then run $SUDO zypper --non-interactive install $4
  else return 1; fi
}

version_ge() {   # version_ge <have> <min>  (major numbers)
  [ "${1:-0}" -ge "$2" ] 2>/dev/null
}

# ---------- step 1: Node.js ----------
ensure_node() {
  step "Node.js (needs 18 or newer)"
  local major
  major="$(node -v 2>/dev/null | sed 's/^v//; s/\..*//')"
  if have node && version_ge "$major" 18; then ok "Node.js $(node -v)"; return 0; fi
  [ -n "$major" ] && warn "Node.js $(node -v) is too old"
  case "$OS" in
    macos)
      if have brew; then
        confirm "Install Node.js with Homebrew?" && run brew install node
      else
        fail "Homebrew is missing. Install it from https://brew.sh then run this script again."; return 1
      fi ;;
    linux|wsl)
      confirm "Install Node.js with your package manager?" && { linux_install "nodejs npm" "nodejs npm" "nodejs npm" "nodejs npm" || warn "No supported package manager found"; } ;;
    windows)
      if have winget; then
        confirm "Install Node.js LTS with winget?" && run winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
      else
        fail "winget not found. Install Node.js LTS from https://nodejs.org then run this script again."; return 1
      fi ;;
    *) warn "Unknown OS: install Node.js 18+ from https://nodejs.org" ;;
  esac
  windows_refresh_path
  if [ "$DRY" = 1 ]; then return 0; fi
  major="$(node -v 2>/dev/null | sed 's/^v//; s/\..*//')"
  if have node && version_ge "$major" 18; then
    ok "Node.js $(node -v)"
  elif have node; then
    fail "Node.js $(node -v) is still older than 18. Install a current one from https://nodejs.org (or use nvm), then run this script again."; return 1
  else
    fail "Node.js is not available yet. Close and reopen your terminal, then run: bash setup.sh"; return 1
  fi
}

# ---------- step 2: Android (adb + Appium Settings APK) ----------
ensure_adb() {
  if have adb; then ok "adb: $(adb version 2>/dev/null | head -1)"; return 0; fi
  warn "adb is not installed"
  case "$OS" in
    macos)
      if have brew; then confirm "Install Android platform-tools (adb) with Homebrew?" && run brew install android-platform-tools
      else fail "Homebrew is missing (https://brew.sh). Install it, then run this script again."; return 1; fi ;;
    linux|wsl)
      confirm "Install adb with your package manager?" && { linux_install "adb android-sdk-platform-tools-common" "android-tools" "android-tools" "android-tools" || warn "No supported package manager found"; } ;;
    windows)
      if have winget; then confirm "Install Android platform-tools (adb) with winget?" && run winget install -e --id Google.PlatformTools --accept-package-agreements --accept-source-agreements
      else fail "winget not found. Download platform-tools from https://developer.android.com/tools/releases/platform-tools and add it to PATH."; return 1; fi ;;
  esac
  windows_refresh_path
  if [ "$DRY" = 1 ]; then return 0; fi
  if have adb; then ok "adb installed"; else fail "adb is not on PATH yet. Close and reopen your terminal, then run: bash setup.sh"; return 1; fi
}

download_apk() {
  if [ "$SKIP_APK" = 1 ]; then info "Skipping APK download (--skip-apk)"; return 0; fi
  mkdir -p "$APK_DIR"
  if [ -s "$APK_FILE" ]; then ok "Appium Settings APK already in apk/ ($(wc -c < "$APK_FILE" | tr -d ' ') bytes)"; return 0; fi
  # Also accept the file name GitHub uses, if the user already downloaded it by hand.
  local manual="$APK_DIR/settings_apk-debug.apk"
  if [ -s "$manual" ]; then
    run mv "$manual" "$APK_FILE" && ok "Renamed settings_apk-debug.apk to io.appium.settings.apk"; return 0
  fi
  info "Downloading Appium Settings (open source, Apache-2.0) from GitHub releases..."
  if [ "$DRY" = 1 ]; then info "[dry-run] would download the latest .apk to apk/io.appium.settings.apk"; return 0; fi
  local js
  read -r -d '' js <<'EOF' || true
const fs = require('fs'), crypto = require('crypto');
const [api, out] = process.argv.slice(1);
const H = { 'User-Agent': 'courier-gps-sim-setup', Accept: 'application/vnd.github+json' };
(async () => {
  const res = await fetch(api, { headers: H });
  if (!res.ok) throw new Error('GitHub API answered HTTP ' + res.status);
  const rel = await res.json();
  const apks = (rel.assets || []).filter((a) => /\.apk$/i.test(a.name));
  const a = apks.find((x) => /debug/i.test(x.name)) || apks[0];
  if (!a) throw new Error('no .apk file in the latest release (' + (rel.tag_name || rel.message || 'unknown') + ')');
  const r = await fetch(a.browser_download_url, { headers: { 'User-Agent': H['User-Agent'] }, redirect: 'follow' });
  if (!r.ok) throw new Error('download failed: HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 500000 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('the downloaded file does not look like an APK');
  if (a.digest && /^sha256:/.test(a.digest)) {
    const h = crypto.createHash('sha256').update(buf).digest('hex');
    if (h !== a.digest.slice(7)) throw new Error('SHA-256 mismatch, refusing to keep the file');
    console.log('   SHA-256 verified');
  } else {
    console.log('   (release publishes no checksum, skipped verification)');
  }
  fs.writeFileSync(out, buf);
  console.log('   ' + (rel.tag_name || '') + ' ' + a.name + ' (' + buf.length + ' bytes)');
})().catch((e) => { console.error('   ' + e.message); process.exit(1); });
EOF
  if node -e "$js" "$RELEASE_API" "$APK_FILE"; then
    ok "Saved apk/io.appium.settings.apk"
  else
    rm -f "$APK_FILE"
    fail "Could not download the APK automatically. Download io.appium.settings-*.apk from https://github.com/appium/io.appium.settings/releases and save it as apk/io.appium.settings.apk"
    return 1
  fi
}

setup_android() {
  step "Android"
  ensure_adb && download_apk
  if [ "$OS" = wsl ]; then
    warn "WSL usually cannot see USB phones. For Android on Windows, run this script in Git Bash instead."
  fi
  if [ "$DRY" = 0 ] && have adb; then
    local out; out="$(adb devices 2>/dev/null | sed 1d | sed '/^$/d')"
    if [ -z "$out" ]; then
      info "No Android phone detected right now (that is fine, see the checklist below)."
    elif echo "$out" | grep -q "no permissions"; then
      warn "Phone found but Linux denies access. Run: sudo usermod -aG plugdev \$USER  then log out and in (or install your phone vendor's udev rules)."
    elif echo "$out" | grep -q unauthorized; then
      warn "Phone found but not authorized: unlock it and tap Allow on the USB debugging prompt."
    else
      ok "Android phone detected: $(echo "$out" | awk '{print $1}' | head -3 | tr '\n' ' ')"
      setup_phones "$out"
    fi
  fi
}

# Install Appium Settings on every authorized phone and allow it to mock the location.
# (Same thing as the "Setup phone" button in the page, so you do not have to click it.)
setup_phones() {
  local serial serials pkg="io.appium.settings"
  serials="$(echo "$1" | awk '$2=="device"{print $1}')"
  for serial in $serials; do
    if adb -s "$serial" shell pm list packages "$pkg" 2>/dev/null | grep -q "$pkg"; then
      ok "[$serial] Appium Settings already installed"
    elif [ -s "$APK_FILE" ]; then
      if confirm "Install Appium Settings on phone $serial now? (watch the phone screen and tap Install/Allow if asked)"; then
        if adb -s "$serial" install -r -g "$APK_FILE" 2>&1 | grep -q Success; then
          ok "[$serial] Appium Settings installed"
        else
          printf ' %s!%s [%s] install failed. On Samsung/Xiaomi, accept the install prompt on the phone and run setup again.\n' "$Y" "$N" "$serial"
          continue
        fi
      else
        continue
      fi
    else
      printf ' %s!%s [%s] no APK in apk/, skipping phone install\n' "$Y" "$N" "$serial"; continue
    fi
    if adb -s "$serial" shell appops set "$pkg" android:mock_location allow >/dev/null 2>&1; then
      ok "[$serial] mock location allowed for Appium Settings"
    else
      printf ' %s!%s [%s] could not allow mock location. Do it by hand: Developer options > Select mock location app > Appium Settings.\n' "$Y" "$N" "$serial"
    fi
    for p in android.permission.ACCESS_FINE_LOCATION android.permission.ACCESS_COARSE_LOCATION android.permission.POST_NOTIFICATIONS; do
      adb -s "$serial" shell pm grant "$pkg" "$p" >/dev/null 2>&1
    done
  done
}

# ---------- step 3: iPhone (macOS only) ----------
setup_ios() {
  step "iPhone (macOS only)"
  if [ "$OS" != macos ]; then
    info "Skipped: iPhone support needs macOS."
    return 0
  fi
  export PATH="$HOME/.local/bin:$PATH"
  if ! have pipx; then
    if have brew; then
      confirm "Install pipx with Homebrew?" && { run brew install pipx; run pipx ensurepath; }
    else
      fail "Homebrew is missing (https://brew.sh). Install it, then run this script again."; return 1
    fi
  fi
  if [ "$DRY" = 0 ] && ! have pipx; then fail "pipx is not available."; return 1; fi
  ok "pipx available"

  if have pymobiledevice3; then
    ok "pymobiledevice3 $(pymobiledevice3 version 2>/dev/null | tail -1)"
  else
    confirm "Install pymobiledevice3 (free, open source) with pipx?" && run pipx install pymobiledevice3
    if [ "$DRY" = 0 ]; then
      if have pymobiledevice3; then ok "pymobiledevice3 installed"; else fail "pymobiledevice3 install failed. Try: pipx install pymobiledevice3"; return 1; fi
    fi
  fi

  if [ "$DRY" = 0 ] && have pymobiledevice3; then
    if pymobiledevice3 usbmux list 2>/dev/null | grep -q UniqueDeviceID; then
      ok "iPhone detected"
      if confirm "Mount the developer image now (needs Developer Mode on, iPhone unlocked)?"; then
        pymobiledevice3 mounter auto-mount && ok "Developer image mounted" || warn "auto-mount failed: turn on Developer Mode, unlock the iPhone and run: pymobiledevice3 mounter auto-mount"
      fi
    else
      info "No iPhone detected right now (that is fine, see the checklist below)."
    fi
  fi
}

# ---------- launching: new terminal tabs + browser ----------
url_up() {   # url_up <url>  -> 0 if something answers there
  node -e 'fetch(process.argv[1],{signal:AbortSignal.timeout(1500)}).then(()=>process.exit(0),()=>process.exit(1))' "$1" >/dev/null 2>&1
}

# Write a tiny launcher script for a tab and print its path.
# (A script file avoids every quoting problem with spaces in folder names.)
make_tab_script() {   # make_tab_script <name> <command...>
  local name="$1"; shift
  local f="$ROOT/.launch/$name.sh"
  if [ "$DRY" = 0 ]; then
    mkdir -p "$ROOT/.launch"
    {
      echo '#!/usr/bin/env bash'
      printf 'cd %q\n' "$ROOT"
      echo 'export PATH="$HOME/.local/bin:$PATH"'
      printf 'echo "== %s =="\n' "$name"
      echo "$*"
      echo 'echo'
      echo 'read -r -p "[stopped] Press Enter to close this tab " _'
    } > "$f"
    chmod +x "$f"
  fi
  printf '%s' "$f"
}

as_escape() { local s=${1//\\/\\\\}; printf '%s' "${s//\"/\\\"}"; }

open_tab_macos() {   # open_tab_macos <script>
  local esc; esc="$(as_escape "bash $(printf '%q' "$1")")"
  if [ "${TERM_PROGRAM:-}" = iTerm.app ]; then
    osascript -e 'tell application "iTerm"' -e 'tell current window' -e 'set t to (create tab with default profile)' \
      -e "tell current session of t to write text \"$esc\"" -e 'end tell' -e 'end tell' >/dev/null 2>&1 && return 0
  fi
  # Terminal.app: a real new tab (macOS asks once to let Terminal control System Events)
  osascript -e 'tell application "Terminal" to activate' \
    -e 'tell application "System Events" to keystroke "t" using command down' \
    -e 'delay 0.5' \
    -e "tell application \"Terminal\" to do script \"$esc\" in front window" >/dev/null 2>&1 && return 0
  # Fallback without any permission: a new Terminal window
  osascript -e "tell application \"Terminal\" to do script \"$esc\"" -e 'tell application "Terminal" to activate' >/dev/null 2>&1
}

open_tab_linux() {   # open_tab_linux <title> <script>
  [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] || return 1
  if   have gnome-terminal;      then gnome-terminal --tab --title="$1" -- bash "$2" >/dev/null 2>&1 &
  elif have konsole;             then konsole --new-tab -p "tabtitle=$1" -e bash "$2" >/dev/null 2>&1 &
  elif have xfce4-terminal;      then xfce4-terminal --tab --title="$1" --command="bash $(printf '%q' "$2")" >/dev/null 2>&1 &
  elif have x-terminal-emulator; then x-terminal-emulator -e bash "$2" >/dev/null 2>&1 &
  elif have xterm;               then xterm -T "$1" -e bash "$2" >/dev/null 2>&1 &
  else return 1; fi
  return 0
}

open_tab_windows() {   # open_tab_windows <title> <script>
  local winbash script_win
  winbash="$(cygpath -w "$(command -v bash)" 2>/dev/null)"
  script_win="$(cygpath -m "$2" 2>/dev/null)"
  [ -n "$winbash" ] && [ -n "$script_win" ] || return 1
  if have wt.exe; then   # Windows Terminal: a real new tab in the current window
    MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' wt.exe -w 0 new-tab --title "$1" "$winbash" -l "$script_win" >/dev/null 2>&1 && return 0
  fi
  if have mintty; then mintty -t "$1" -e bash -l "$2" >/dev/null 2>&1 & return 0; fi
  return 1
}

open_tab() {   # open_tab <title> <script>
  if [ "$DRY" = 1 ]; then info "[dry-run] new terminal tab \"$1\" running: bash $2"; return 0; fi
  case "$OS" in
    macos)       open_tab_macos "$2" ;;
    linux|wsl)   open_tab_linux "$1" "$2" ;;
    windows)     open_tab_windows "$1" "$2" ;;
    *)           return 1 ;;
  esac
}

open_browser() {   # open_browser <url>
  if [ "$DRY" = 1 ]; then info "[dry-run] open $1 in your browser"; return 0; fi
  case "$OS" in
    macos)     open "$1" ;;
    linux|wsl) if have xdg-open; then xdg-open "$1" >/dev/null 2>&1 & elif have wslview; then wslview "$1" >/dev/null 2>&1 & else return 1; fi ;;
    windows)   MSYS2_ARG_CONV_EXCL='*' cmd.exe /c start "" "$1" >/dev/null 2>&1 ;;
    *)         return 1 ;;
  esac
}

launch_all() {
  step "Launching"
  local f manual=() url="http://localhost:$PORT"

  if [ "$DRY" = 0 ] && url_up "$url/api/status"; then
    ok "Simulator is already running"
  else
    f="$(make_tab_script simulator "PORT=$PORT node server.js")"
    if open_tab "Courier GPS Simulator" "$f"; then ok "Opened a new terminal tab: Courier GPS Simulator"
    else manual+=("cd \"$ROOT\" && node server.js    (the simulator)"); fi
  fi

  if [ ${#manual[@]} -gt 0 ]; then
    warn "Could not open a terminal tab automatically. Open new terminal tabs yourself and run:"
    for m in "${manual[@]}"; do printf '       %s\n' "$m"; done
    return 1
  fi

  if [ "$DRY" = 0 ]; then
    for _ in $(seq 1 20); do url_up "$url/api/status" && break; sleep 1; done
    url_up "$url/api/status" || { warn "The simulator did not answer on $url yet. Check the new tab for errors."; return 1; }
  fi
  open_browser "$url" && ok "Opened $url in your browser" || info "Open $url in your browser."
  return 0
}

# ---------- run ----------
echo "${B}Courier GPS Simulator setup${N}  (OS: $OS$([ "$DRY" = 1 ] && echo ', dry run'))"
[ "$OS" = unknown ] && warn "Unrecognised operating system; continuing, but things may need manual steps."
[ "$WANT_IOS" = 1 ] && [ "$OS" != macos ] && warn "iPhone is only supported on macOS, so it will be skipped."

if ensure_node; then
  [ "$DRY" = 1 ] || { node --check "$ROOT/server.js" 2>/dev/null && ok "server.js is valid" || fail "server.js did not pass a syntax check"; }
  [ "$WANT_ANDROID" = 1 ] && setup_android
  [ "$WANT_IOS" = 1 ] && setup_ios
fi

# ---------- summary ----------
step "Summary"
if [ ${#FAILS[@]} -gt 0 ]; then
  printf '%sSetup is NOT complete:%s\n' "$R" "$N"
  for m in "${FAILS[@]}"; do printf '   - %s\n' "$m"; done
fi
if [ ${#WARNS[@]} -gt 0 ]; then
  printf '%sNotes:%s\n' "$Y" "$N"
  for m in "${WARNS[@]}"; do printf '   - %s\n' "$m"; done
fi

if [ "$WANT_ANDROID" = 1 ]; then
cat <<'EOF'

Android phone checklist (once per phone; cannot be done by a script):
   1. Settings > About phone > tap "Build number" 7 times.
   2. Developer options > turn on "USB debugging" (Xiaomi/Redmi/Poco: also "USB debugging (Security settings)").
   3. Plug in the USB cable and tap Allow on the phone.
   4. Run  bash setup.sh  again so the script installs Appium Settings on the phone
      (or click "Setup phone" once in the page).
EOF
fi
if [ "$WANT_IOS" = 1 ] && [ "$OS" = macos ]; then
cat <<'EOF'

iPhone checklist (once per phone, iOS 17 or newer; cannot be done by a script):
   1. Settings > Privacy & Security > Developer Mode > on, then restart the iPhone.
   2. Plug in the iPhone, unlock it, tap "Trust This Computer".
   3. Run  bash setup.sh  again so the script mounts the developer image.
   Usually no tunnel or sudo is needed: the simulator tries to open its own. If an iPhone will not connect,
   start a root tunnel as a fallback, in another tab:  sudo pymobiledevice3 remote tunneld
EOF
fi

if [ ${#FAILS[@]} -gt 0 ]; then
  printf '\nFix the items above, then run  bash setup.sh  again.\n'
  exit 1
fi

# ---------- launch ----------
if [ "$START" = 1 ] && [ "$DRY" = 0 ]; then
  echo; exec node "$ROOT/server.js"
fi
if [ -z "$LAUNCH" ]; then
  if [ "$ASSUME_YES" = 1 ]; then LAUNCH=0                       # --yes alone never opens windows
  elif confirm "Open new terminal tab(s) now, start the simulator and open the browser?"; then LAUNCH=1
  else LAUNCH=0; fi
fi
if [ "$LAUNCH" = 1 ]; then
  if launch_all; then
    printf '\n%sAll set.%s Courier GPS Simulator: http://localhost:%s\n' "$B" "$N" "$PORT"
    exit 0
  fi
fi
printf '\n%sStart the simulator:%s  node server.js   then open http://localhost:%s\n' "$B" "$N" "$PORT"
exit 0
