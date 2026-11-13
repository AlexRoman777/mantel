#!/bin/sh
set -eu

USER_ID=$(id -u)
RUNTIME_DIR="/run/user/$USER_ID"
WAYLAND_SOCKET=""

for candidate in "$RUNTIME_DIR"/wayland-*; do
    if [ -S "$candidate" ]; then
        WAYLAND_SOCKET=${candidate##*/}
        break
    fi
done

if [ -z "$WAYLAND_SOCKET" ]; then
    echo "mantel-cursor: no Wayland socket found" >&2
    exit 1
fi

export XDG_RUNTIME_DIR="$RUNTIME_DIR"
export WAYLAND_DISPLAY="$WAYLAND_SOCKET"

# Reassert the compositor shortcut after one, two, and three seconds. The web
# player also applies cursor:none continuously, so either layer is sufficient.
for delay in 1 1 1; do
    sleep "$delay"
    wtype -M alt -M logo h -m logo -m alt || true
done
