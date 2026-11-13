#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo "Run with sudo: sudo ./install-cec-remote.sh [pi-user]" >&2
    exit 1
fi

PI_USER="${1:-admin}"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if ! id "$PI_USER" >/dev/null 2>&1; then
    echo "Pi user does not exist: $PI_USER" >&2
    exit 1
fi

apt-get update
if [ -e /dev/cec0 ]; then
    apt-get install -y cec-utils python3 v4l-utils wtype
else
    apt-get install -y cec-utils python3 xdotool
fi

install -d -m 0755 /usr/local/lib/mantel
install -m 0755 "$SCRIPT_DIR/cec_remote.py" /usr/local/lib/mantel/cec_remote.py
install -m 0755 "$SCRIPT_DIR/cec-launch.sh" /usr/local/lib/mantel/cec-launch.sh
install -d -m 0755 /usr/local/share/doc/mantel/raspberry-pi
install -m 0644 "$SCRIPT_DIR/README.md" /usr/local/share/doc/mantel/raspberry-pi/README.md
install -m 0644 "$SCRIPT_DIR/mantel-cec-remote@.service" /etc/systemd/system/mantel-cec-remote@.service

if [ ! -e /etc/default/mantel-cec-remote ]; then
    install -m 0644 "$SCRIPT_DIR/mantel-cec-remote.default" /etc/default/mantel-cec-remote
fi

if getent group video >/dev/null 2>&1; then
    usermod -a -G video "$PI_USER"
fi

systemctl daemon-reload
systemctl enable "mantel-cec-remote@$PI_USER.service"

echo "Installed Mantel CEC bridge for user $PI_USER."
echo "The service is enabled but has not been started. Start Chromium first, then run:"
echo "  sudo systemctl start mantel-cec-remote@$PI_USER.service"
echo "  sudo journalctl -u mantel-cec-remote@$PI_USER.service -f"
