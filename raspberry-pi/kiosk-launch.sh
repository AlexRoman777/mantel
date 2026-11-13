#!/bin/sh
set -eu

# Launch a command in the current service user's existing Wayland session.
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
    echo "mantel-kiosk: no Wayland socket found in $RUNTIME_DIR" >&2
    exit 1
fi

export XDG_RUNTIME_DIR="$RUNTIME_DIR"
export WAYLAND_DISPLAY="$WAYLAND_SOCKET"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$RUNTIME_DIR/bus"

echo "mantel-kiosk: using WAYLAND_DISPLAY=$WAYLAND_DISPLAY" >&2
exec "$@"
