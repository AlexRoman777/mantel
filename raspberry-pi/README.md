# Raspberry Pi and LG OLED player

One worked example of a dedicated kiosk screen: a Raspberry Pi driving a 4K LG
OLED television. It records a known-good configuration, start to finish.

**Nothing in Mantel requires any of this.** A screen is just a browser — see
[docs/SCREENS.md](../docs/SCREENS.md). Use this as a reference if you are
building something similar, on this hardware or any other.

## URLs

The television opens a player URL, never the controller:

```text
http://mantel.local:3830/display/auto
```

The controller remains available from another phone or computer at:

```text
http://mantel.local:3831
```

Replace `mantel.local` if the NAS hostname is not resolvable from the Pi. The
`auto` route restores this browser's saved assignment or creates its own copy
of a configured presentation. It stays black and retries if the NAS starts
later; it never shows a launcher or missing-display error.

## Known television

Home Assistant identifies the living-room display as `LG OLED65C7V-Z` with
firmware `06.10.65`. This is an LG C7-generation OLED, even if it was purchased
or installed in 2019.

On the LG input used by the Pi:

1. Enable **HDMI Ultra HD Deep Colour**.
2. Enable **Simplink (HDMI-CEC)** if the TV remote should control Mantel.
3. Use the original/just-scan aspect mode so the TV does not overscan.
4. Disable unwanted energy-saving and automatic screen-off timers.
5. Keep OLED screen-shift/panel-protection features enabled.

Mantel should avoid permanent static UI, but OLED care remains the responsibility
of both the player profile and television settings.

## Confirmed CasaOS player

The player was inspected on 2026-08-29:

- host `mantel-pi`, address `mantel-pi.local`, login user `admin`
- Debian 13 (trixie), 64-bit ARM, CasaOS
- Chromium in a native Wayland/labwc kiosk session
- `DISPLAY=:1`, `WAYLAND_DISPLAY=wayland-0`, runtime directory
  `/run/user/1000`
- HDMI0 exposed as `/dev/cec0` through the kernel `cec-ctl` interface

The Pi now runs only Mantel's kiosk service and opens
`http://mantel.local:3830/display/auto`. The legacy Immich Kiosk units and old
launcher were removed on 2026-08-29. Until Mantel is started on the NAS, Chromium
will show its normal connection error and retry the URL.

The current setup is captured as [kiosk-launch.sh](kiosk-launch.sh) and
[mantel-kiosk-4k.service](mantel-kiosk-4k.service). On a fresh installation, copy
this directory to the Pi and run one command:

```sh
sudo ./install-mantel-player.sh
```

That installs the Wayland kiosk and CEC bridge, disables known legacy kiosk
units, and enables both Mantel services at boot.

For manual maintenance from a trusted machine:

```sh
ssh -i ~/.ssh/mantel-pi pi@mantel-pi.local
sudo systemctl status mantel-kiosk-4k.service
sudo systemctl status mantel-cec-remote@admin.service
sudo systemctl restart mantel-player.target
```

The target restart is the normal one-command refresh: it restarts Chromium,
the CEC bridge, and the cursor-hiding helper together. The helper asks labwc to
hide and park its pointer three times during the first three seconds; the Mantel
web player also continuously enforces `cursor: none`. The SSH key is deliberately
outside this repository.

## Raspberry Pi packages

The current Wayland installation uses libCEC for compatibility with the LG Magic
Remote, plus `wtype` and Python 3. Kernel `cec-ctl` remains the fallback:

```sh
sudo apt update
sudo apt install -y chromium cec-utils v4l-utils wtype python3
```

If a Raspberry Pi OS Lite installation does not already provide X, install its
X server and `xinit` packages as well. Package names vary between Raspberry Pi
OS releases, so verify them before changing a working image.

Copy the tracked launcher to the Pi user's home directory:

```sh
install -m 0755 raspberry-pi/.xinitrc /home/admin/.xinitrc
```

If the Pi user is not `admin`, use that user's home directory instead. Edit the
last line of `.xinitrc` when the NAS hostname or display slug differs.

Test it manually from the Pi console:

```sh
DISPLAY=:0 startx
```

The historical setup only documented this manual start. Automatic console login
and `startx` at boot should be added only after the manual command is confirmed
on the installed Raspberry Pi OS version; it was not part of the verified old
configuration.

The tracked `.xinitrc` below is retained as an X11 fallback and as historical
documentation. It is not the launcher currently used by CasaOS.

## LG remote through HDMI-CEC

Chromium does not reliably translate raw HDMI-CEC traffic into keyboard events.
Mantel therefore includes its own native bridge:

```text
LG remote -> Simplink/CEC -> /dev/cec0 -> libCEC -> Mantel bridge -> wtype -> Chromium
```

Install it after the manual Chromium session works:

```sh
cd raspberry-pi
sudo ./install-cec-remote.sh admin
sudo systemctl start mantel-cec-remote@admin.service
sudo journalctl -u mantel-cec-remote@admin.service -f
```

Replace `admin` with the Linux user that owns the Chromium/Wayland session. The
installer copies the bridge into `/usr/local/lib/mantel`, installs a templated
systemd unit, preserves an existing `/etc/default/mantel-cec-remote`, adds the
user to the `video` group when present, and enables the service. On a kernel CEC
device it installs `v4l-utils` and `wtype`; `cec-utils` and `xdotool` are only
the fallback for an older X11 system. It deliberately does not start the service
automatically during installation, so the session can be inspected first.
The hardened unit gives `wtype` a private writable `/tmp` for its temporary
Wayland keymap while keeping the rest of the filesystem read-only.

Default mappings:

| LG/CEC key | Mantel action |
| --- | --- |
| Left / Right | Previous / next photograph |
| OK / Select | Pause/resume, or run the selected command when the command ribbon is open |
| Play | Resume |
| Pause / Stop | Pause |
| Up | Show the control bar; it never pauses (a paused player shows a corner badge and resumes by itself after the profile's auto-resume minutes) |
| Down | Open the command ribbon; then use Left/Right and OK |
| Back / Exit | Hide the control bar |
| Rewind / Fast-forward | Previous / next photograph |

The enlarged command ribbon also provides temporary hide-text, photo-info,
fit/fill, still-motion, monochrome, current-person-only and random-everything
shortcuts. **Restore saved setup** returns to the exact Controller profile;
these remote choices never overwrite saved presentation settings.

The web controller on port 3831 remains available at the same time for display
selection and advanced settings.

### Test and debug CEC

First prove that the Pi sees the TV and remote without the bridge:

```sh
cec-ctl -d /dev/cec0 --playback -o Mantel --wait-for-msgs
```

Press LG remote buttons while that command runs. Look for
`USER_CONTROL_PRESSED` followed by a `ui-cmd`. Stop it before starting the
service because only one process should claim the CEC logical address.

Then inspect the service:

```sh
sudo systemctl status mantel-cec-remote@admin.service
sudo journalctl -u mantel-cec-remote@admin.service -f
```

The journal records mappings without logging Mantel URLs, photos, or secrets.
`unmapped CEC key` messages are safe input for extending our own mapping table.
The bridge uses libCEC log level `31` so decoded key names are visible; the old
traffic-only level `8` can receive CEC packets without emitting `key pressed`
lines, which made working remote presses appear absent.

The bridge also polls the TV power state every 30 seconds. When LG changes from
standby to on, Mantel reclaims the active HDMI-CEC source without restarting the
slideshow. Before forwarding each button, it invokes the private `Super+F12`
labwc binding to focus and raise Chromium; the navigation key then reaches the
kiosk even if HDMI sleep caused Wayland to drop focus. These intervals and the
focus shortcut can be changed with `MANTEL_CEC_POWER_POLL_SECONDS` and
`MANTEL_CEC_FOCUS_SHORTCUT` in `/etc/default/mantel-cec-remote`.

For the installed AN-MR650A-era Magic Remote, test these once in order while the
journal follows: Left, Right, Up, Down, Wheel/OK, Back, Play, Pause, Stop,
Fast-forward, Rewind, Red, Green, Yellow, Blue. Mantel maps the first eleven when
the TV actually forwards them over CEC; the journal gives the exact answer for
this TV/input and records any forwarded colour button as unmapped. Pointer
motion, voice, Home, Settings, Input, volume, channel and branded app buttons are
normally handled by webOS/the TV and are not claimed as Mantel controls.

If CEC events appear but Chromium does not react, verify the Wayland session:

```sh
sudo -u admin XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 wtype -k Right
```

If that command does not advance Mantel, verify the user manager environment with
`systemctl --user show-environment`. The service unit records the confirmed
CasaOS session values. `/etc/default/mantel-cec-remote` can override the CEC
device or force `MANTEL_CEC_SOURCE`/`MANTEL_CEC_INJECTOR` for another system.

To stop or remove the bridge without affecting Mantel or CasaOS:

```sh
sudo systemctl disable --now mantel-cec-remote@admin.service
sudo rm /etc/systemd/system/mantel-cec-remote@.service
sudo rm /usr/local/lib/mantel/cec_remote.py
sudo systemctl daemon-reload
```

## Original Pi 4 HDMI configuration

The tracked [config.txt.example](config.txt.example) contains the known working
`/boot/firmware/config.txt` additions:

```ini
hdmi_enable_4kp60=1
hdmi_group=1
hdmi_mode=97
hdmi_drive=2
framebuffer_width=3840
framebuffer_height=2160
disable_overscan=1
```

They request CEA 3840x2160 at 60 Hz, normal HDMI output, a 4K framebuffer, and
no overscan. On a Raspberry Pi 4, 4K60 requires the television to be connected
to HDMI0. Shut the Pi down before moving HDMI cables.

This is a legacy Pi 4 configuration, not a universal prescription:

- Raspberry Pi 5 supports 4K60 without `hdmi_enable_4kp60`.
- Modern KMS/Wayland releases may derive the mode from EDID and ignore some
  legacy framebuffer/HDMI settings.
- Preserve a backup of the working boot configuration before editing it.

## Chromium launcher behavior

The tracked Wayland systemd kiosk service does the following:

- disables X11 screensaver and DPMS blanking
- hides the mouse cursor
- opens Chromium in kiosk mode at 3840x2160
- enables GPU rasterization, zero-copy, and accelerated video decode
- keeps slideshow timers active when HDMI sleep temporarily marks Chromium as
  occluded or backgrounded
- disables smooth scrolling and crash/infobar prompts
- opens Mantel's player on port 3830

The Immich API key remains on the Mantel server. It is never stored on the Pi or
included in the player URL.

## Verify the display

After Chromium starts, confirm:

- the TV reports 3840x2160 at 60 Hz for the HDMI input
- Mantel fills the intended area without overscan
- `http://mantel.local:3830/healthz` is reachable from the Pi
- `http://mantel.local:3830/display/auto` loads and advances
- the controller on port 3831 sees the Pi as a connected player
- the slideshow resumes after a browser restart
- the CEC bridge journal receives arrow and OK/play-pause presses
- those presses control Mantel without changing the LG input unexpectedly

On X11, `xrandr --current` can show the negotiated mode. On KMS/Wayland, use the
display tools provided by that Raspberry Pi OS release.

## Color limitations

This setup verifies a 4K60 browser frame; it does not establish a 10-bit or HDR
pipeline. Mantel's recommended **Preview** setting uses Immich's generated 4K
preview. Wide-gamut metadata, Chromium color management, HDMI pixel format,
bit depth, and TV HDR mode must all agree before an end-to-end HDR claim can be
made.

## Troubleshooting

- Blank display: confirm the TV is on the correct input and the Pi uses HDMI0.
- Chromium command missing: run `command -v chromium`; some older images called
  it `chromium-browser`, in which case update `.xinitrc`.
- Black screen after idle: re-check the three `xset` commands and LG sleep/eco
  settings.
- No TV remote keys: enable Simplink, stop the Mantel bridge temporarily, and run
  `cec-ctl -d /dev/cec0 --playback -o Mantel --wait-for-msgs` to distinguish CEC
  reception from Wayland injection.
- Player loads but has no images: check Mantel's controller/cache status and the
  server-side Immich key; do not put the key on the Pi.
