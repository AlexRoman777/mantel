# Disable X11 screen blanking and power management. Mantel controls its own
# off-hours, while the TV's power can be managed separately through LG/CEC/HA.
xset s off
xset -dpms
xset s noblank

# Hide the pointer when the TV is not being controlled.
unclutter &

# Mantel player. Change the hostname or display slug when required.
exec chromium --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --window-size=3840,2160 \
    --enable-gpu-rasterization \
    --enable-zero-copy \
    --num-raster-threads=4 \
    --enable-accelerated-video-decode \
    --disable-smooth-scrolling \
    --disable-features=UseChromeOSDirectVideoDecoder \
    http://mantel.local:3000/display/default

