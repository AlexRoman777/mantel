#!/bin/sh
set -eu

# A system service does not inherit the graphical login's Wayland variables.
# Resolve the socket for the configured service user at launch time.
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
    echo "mantel-cec: no Wayland socket found in $RUNTIME_DIR" >&2
    exit 1
fi

export XDG_RUNTIME_DIR="$RUNTIME_DIR"
export WAYLAND_DISPLAY="$WAYLAND_SOCKET"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$RUNTIME_DIR/bus"
export DISPLAY="${DISPLAY:-:1}"

exec /usr/bin/python3 /usr/local/lib/mantel/cec_remote.py
