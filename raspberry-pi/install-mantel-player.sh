#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo "Run with sudo: sudo ./install-mantel-player.sh" >&2
    exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

"$SCRIPT_DIR/install-cec-remote.sh" admin
install -m 0755 "$SCRIPT_DIR/kiosk-launch.sh" /usr/local/bin/mantel-kiosk-launch.sh
install -m 0755 "$SCRIPT_DIR/hide-cursor.sh" /usr/local/lib/mantel/hide-cursor.sh
install -m 0644 "$SCRIPT_DIR/mantel-kiosk-4k.service" /etc/systemd/system/mantel-kiosk-4k.service
install -m 0644 "$SCRIPT_DIR/mantel-hide-cursor@.service" /etc/systemd/system/mantel-hide-cursor@.service
install -m 0644 "$SCRIPT_DIR/mantel-player.target" /etc/systemd/system/mantel-player.target

install -d -m 0755 -o admin -g admin /home/admin/.config/labwc
if [ ! -e /home/admin/.config/labwc/rc.xml ]; then
    install -m 0644 -o admin -g admin "$SCRIPT_DIR/mantel-labwc-rc.xml" /home/admin/.config/labwc/rc.xml
elif ! grep -q 'W-F12' /home/admin/.config/labwc/rc.xml; then
    cp -p /home/admin/.config/labwc/rc.xml /home/admin/.config/labwc/rc.xml.pre-mantel-focus
    install -m 0644 -o admin -g admin "$SCRIPT_DIR/mantel-labwc-rc.xml" /home/admin/.config/labwc/rc.xml
    echo "Updated labwc for Mantel focus recovery; previous config saved as rc.xml.pre-mantel-focus."
fi

# Known historical Immich Kiosk units must not compete for Chromium.
for legacy in \
    immich-kiosk.service \
    immich-kiosk-1080p.service \
    immich-kiosk-1440p.service \
    immich-kiosk-4k.service
do
    systemctl disable --now "$legacy" 2>/dev/null || true
done

systemctl daemon-reload
systemctl enable mantel-kiosk-4k.service mantel-cec-remote@admin.service mantel-hide-cursor@admin.service mantel-player.target
PI_UID=$(id -u admin)
LABWC_PROCESS=$(pgrep -u admin -x labwc | head -1 || true)
if [ -n "$LABWC_PROCESS" ]; then
    sudo -u admin env XDG_RUNTIME_DIR="/run/user/$PI_UID" WAYLAND_DISPLAY=wayland-0 LABWC_PID="$LABWC_PROCESS" labwc --reconfigure || true
fi
systemctl restart mantel-player.target

echo "Mantel player installed."
echo "Player: http://mantel.local:3830/display/auto"
echo "Restart both kiosk and remote: systemctl restart mantel-player.target"
echo "Status: systemctl status mantel-player.target mantel-kiosk-4k mantel-cec-remote@admin"
