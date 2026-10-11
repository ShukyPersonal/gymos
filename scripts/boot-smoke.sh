#!/usr/bin/env bash
# Boot-smoke gate — run BEFORE every `eas update` / `eas build`.
#
# Why this exists: on 2026-07-30 an OTA that passed 61 unit tests hung the app
# on the "Loading…" screen for three days. Unit tests asserted against a mock
# I wrote myself, so they could never catch it. This launches the real app on
# a real emulator and proves it actually reaches a usable screen.
#
# Usage:  ./scripts/boot-smoke.sh [avd_name]
# Exit 0 = safe to ship. Non-zero = DO NOT SHIP.
set -uo pipefail

AVD="${1:-gymos_api36}"
PKG="com.ashuky.gymcoachapp"
ACTIVITY="$PKG/.MainActivity"
APK="android/app/build/outputs/apk/debug/app-debug.apk"
BOOT_TIMEOUT=45   # seconds the app gets to reach a real screen

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

fail() { echo ""; echo "❌ BOOT SMOKE FAILED: $1"; echo "   DO NOT SHIP THIS BUNDLE."; exit 1; }
ok()   { echo "✅ $1"; }

echo "▶ Boot smoke on AVD: $AVD"

# ── 1. emulator up ───────────────────────────────────────────────────────────
if ! adb devices | grep -q "emulator-.*device$"; then
  echo "  starting emulator…"
  nohup emulator -avd "$AVD" -no-snapshot-save -no-audio -no-boot-anim >/tmp/boot-smoke-emu.log 2>&1 &
  for _ in $(seq 1 90); do
    adb shell getprop sys.boot_completed 2>/dev/null | grep -q 1 && break
    sleep 4
  done
fi
adb shell getprop sys.boot_completed 2>/dev/null | grep -q 1 || fail "emulator did not boot"
API=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
ok "emulator ready (API $API)"

# The bug we shipped was API-gated — testing below the user's API level is
# how it slipped through. Warn loudly rather than silently passing.
if [ "$API" -lt 35 ]; then
  echo "⚠️  WARNING: API $API is BELOW the target device (API 37)."
  echo "   Background-execution, foreground-service and edge-to-edge policies"
  echo "   are version-gated — this run can NOT clear those code paths."
fi

# ── 1b. Metro reachable (debug APK loads its JS bundle over adb reverse) ─────
if ! curl -sI http://localhost:8081/status 2>/dev/null | head -1 | grep -q 200; then
  echo "  starting Metro…"
  nohup npx expo start --no-dev --minify --port 8081 >/tmp/boot-smoke-metro.log 2>&1 &
  for _ in $(seq 1 40); do
    curl -sI http://localhost:8081/status 2>/dev/null | head -1 | grep -q 200 && break
    sleep 2
  done
fi
curl -sI http://localhost:8081/status 2>/dev/null | head -1 | grep -q 200 || fail "Metro did not start"
adb reverse tcp:8081 tcp:8081 >/dev/null 2>&1 || fail "adb reverse failed"
ok "Metro reachable"

# ── 2. install ───────────────────────────────────────────────────────────────
[ -f "$APK" ] || fail "no debug APK at $APK (run: cd android && ./gradlew assembleDebug)"
if ! adb install -r "$APK" >/dev/null 2>&1; then
  # versionCode downgrade / signature change after a clean prebuild
  echo "  reinstalling (uninstall first)…"
  adb uninstall "$PKG" >/dev/null 2>&1
  adb install "$APK" >/dev/null 2>&1 || fail "APK install failed"
fi
# Pre-grant runtime permissions. Without this the POST_NOTIFICATIONS dialog
# blocks requestPermissionsAsync() forever and the gate reports a false
# "stuck on Loading" (cost me a full debug cycle on 2026-08-02).
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS >/dev/null 2>&1
ok "APK installed (+ permissions pre-granted)"

# ── 3. launch cold ───────────────────────────────────────────────────────────
adb shell am force-stop "$PKG" >/dev/null 2>&1
adb logcat -c
adb shell am start -n "$ACTIVITY" >/dev/null 2>&1 || fail "could not launch activity"

# ── 4. must reach a real screen (not stuck on "Loading…") ────────────────────
# This is the exact assertion that would have caught the 2026-07-30 hang.
reached=""
for _ in $(seq 1 "$BOOT_TIMEOUT"); do
  # A screen was reached. `watchdog` counts as reached-but-degraded and is
  # reported separately below — it means startup stalled and we fell back.
  if adb logcat -d 2>/dev/null | grep -qE "gymos:(restore|session|watchdog)\]"; then
    reached=1; break
  fi
  if adb logcat -d 2>/dev/null | grep -qE "FATAL EXCEPTION|AndroidRuntime: Process: $PKG"; then
    echo ""; echo "── crash trace ──"
    adb logcat -d | grep -A25 "FATAL EXCEPTION" | head -35
    fail "app crashed during launch"
  fi
  sleep 1
done

adb shell pidof "$PKG" >/dev/null 2>&1 || fail "process died during launch"
[ -n "$reached" ] || {
  echo ""; echo "── last gymos logs ──"
  adb logcat -d | grep "gymos:" | tail -15
  fail "app never got past startup within ${BOOT_TIMEOUT}s (stuck on Loading — the 2026-07-30 regression)"
}
if adb logcat -d 2>/dev/null | grep -q "gymos:watchdog\]"; then
  ok "app reached a screen — but VIA THE WATCHDOG (startup stalled; investigate)"
else
  ok "app reached a usable screen normally"
fi

# ── 5. no JS errors / unhandled rejections ───────────────────────────────────
if adb logcat -d 2>/dev/null | grep -qE "ReactNativeJS.*(TypeError|ReferenceError|Unhandled|is not a function|undefined is not an object)"; then
  echo ""; echo "── JS errors ──"
  adb logcat -d | grep -E "ReactNativeJS.*(TypeError|ReferenceError|Unhandled)" | head -10
  fail "JS errors during startup"
fi
ok "no JS errors"

# ── 6. app-reported startup errors ───────────────────────────────────────────
if adb logcat -d 2>/dev/null | grep -qE "gymos:(crash|.*setup error)"; then
  adb logcat -d | grep -E "gymos:(crash|.*setup error)" | head -5
  fail "app logged a startup error"
fi
ok "clean startup"

echo ""
echo "✅ BOOT SMOKE PASSED (API $API) — safe to ship."
