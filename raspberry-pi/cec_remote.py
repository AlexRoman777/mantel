#!/usr/bin/env python3
"""Translate HDMI-CEC remote presses into keys understood by Mantel.

The bridge intentionally has no network access and no Mantel/Immich credentials.
On the older LG/CasaOS combination it prefers libCEC and injects keys into
Chromium's Wayland session with wtype; cec-ctl and xdotool remain fallbacks.
"""

from __future__ import annotations

import logging
import os
import re
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from typing import Callable, Iterable


LOG = logging.getLogger("mantel-cec-remote")
KEY_PRESS = re.compile(r"key pressed:\s*([^([]+?)\s*(?:\([^)]*\))?(?:\s|$)", re.IGNORECASE)
UI_COMMAND = re.compile(
    r"(?:ui[-_ ]cmd|ui command)\s*:\s*([^([]+?)\s*(?:\([^)]*\))?(?:\s|$)",
    re.IGNORECASE,
)
RAW_USER_CONTROL = re.compile(
    r"[<>]{2}\s*[0-9a-f]{2}:44:([0-9a-f]{2})(?:\s|$)", re.IGNORECASE
)
TV_POWER_CHANGE = re.compile(
    r"TV\s*\(0\):\s*power status changed from '([^']+)' to '([^']+)'",
    re.IGNORECASE,
)

RAW_KEY_CODES: dict[int, str] = {
    0x00: "select",
    0x01: "up",
    0x02: "down",
    0x03: "left",
    0x04: "right",
    0x0D: "exit",
    0x20: "0",
    0x21: "1",
    0x22: "2",
    0x23: "3",
    0x24: "4",
    0x25: "5",
    0x26: "6",
    0x27: "7",
    0x28: "8",
	0x29: "9",
	0x71: "blue",
	0x72: "red",
	0x73: "green",
	0x74: "yellow",
    0x44: "play",
    0x45: "stop",
    0x46: "pause",
    0x48: "rewind",
    0x49: "fast forward",
    0x4B: "forward",
    0x4C: "backward",
    0x60: "play",
    0x61: "play pause",
}

# libCEC names -> X11 key names. Mantel's browser key handler accepts the
# corresponding Arrow/Enter/Escape and Media* KeyboardEvent values.
KEY_MAP: dict[str, str] = {
	"0": "0",
	"1": "1",
	"2": "2",
	"3": "3",
	"4": "4",
	"5": "5",
	"6": "6",
	"7": "7",
	"8": "8",
	"9": "9",
	"number 0": "0",
	"number 1": "1",
	"number 2": "2",
	"number 3": "3",
	"number 4": "4",
	"number 5": "5",
	"number 6": "6",
	"number 7": "7",
	"number 8": "8",
	"number 9": "9",
	"blue": "F16",
	"red": "F13",
	"green": "F14",
	"yellow": "F15",
	"f1": "F16",
	"f2": "F13",
	"f3": "F14",
	"f4": "F15",
    "up": "Up",
    "down": "Down",
    "left": "Left",
    "right": "Right",
    "select": "Return",
    "enter": "Return",
    "ok": "Return",
    "root menu": "Home",
    "exit": "Escape",
    "back": "Escape",
    "return": "Escape",
    "play": "XF86AudioPlay",
    "pause": "XF86AudioPause",
    "play pause": "XF86AudioPlay",
    "play/pause": "XF86AudioPlay",
    "stop": "XF86AudioStop",
    "forward": "XF86AudioNext",
    "fast forward": "XF86AudioNext",
    "skip forward": "XF86AudioNext",
    "backward": "XF86AudioPrev",
    "rewind": "XF86AudioPrev",
    "skip backward": "XF86AudioPrev",
}


def normalize_key(value: str) -> str:
    return " ".join(value.strip().lower().replace("_", " ").replace("-", " ").split())


def parse_cec_key(line: str) -> str | None:
    """Return a normalized libCEC key name for a press line, never a release."""
    match = KEY_PRESS.search(line)
    if not match:
        return None
    key = normalize_key(match.group(1))
    return key or None


def iter_cec_keys(
    lines: Iterable[str], observe: Callable[[str], None] | None = None
) -> Iterable[str]:
    """Read key presses from either libCEC or the kernel cec-ctl monitor."""
    waiting_for_ui_command = 0
    for line in lines:
        if observe is not None:
            observe(line)
        raw_command = RAW_USER_CONTROL.search(line)
        if raw_command:
            key = RAW_KEY_CODES.get(int(raw_command.group(1), 16))
            if key:
                yield key
            else:
                LOG.info(
                    "unmapped raw CEC user-control code: 0x%s",
                    raw_command.group(1).upper(),
                )
            continue

        libcec_key = parse_cec_key(line)
        if libcec_key is not None:
            yield libcec_key
            continue

        normalized_line = normalize_key(line)
        if "user control released" in normalized_line:
            waiting_for_ui_command = 0
            continue
        if "user control pressed" in normalized_line:
            waiting_for_ui_command = 5

        command = UI_COMMAND.search(line)
        if command and waiting_for_ui_command:
            key = normalize_key(command.group(1))
            if key:
                yield key
            waiting_for_ui_command = 0
        elif waiting_for_ui_command:
            waiting_for_ui_command -= 1


@dataclass
class Debouncer:
    interval_seconds: float = 0.30
    last_key: str | None = None
    last_at: float = 0.0

    def accepts(self, key: str, now: float) -> bool:
        if key == self.last_key and now - self.last_at < self.interval_seconds:
            return False
        self.last_key = key
        self.last_at = now
        return True


def translate_lines(
    lines: Iterable[str],
    now: Callable[[], float] = time.monotonic,
    observe: Callable[[str], None] | None = None,
) -> Iterable[tuple[str, str]]:
    """Yield (CEC key, X11 key) pairs; useful for both runtime and tests."""
    debounce = Debouncer(float(os.environ.get("MANTEL_CEC_DEBOUNCE_SECONDS", "0.30")))
    for cec_key in iter_cec_keys(lines, observe=observe):
        x_key = KEY_MAP.get(cec_key)
        if x_key is None:
            LOG.info("unmapped CEC key: %s", cec_key)
            continue
        # libCEC can describe one physical press twice: once as the raw 0x71-0x74
        # packet and again as F1-F4. Debounce the translated key so aliases do
        # not trigger two Mantel actions.
        if debounce.accepts(x_key, now()):
            yield cec_key, x_key


class Bridge:
    def __init__(self) -> None:
        self.source = os.environ.get("MANTEL_CEC_SOURCE", "auto").lower()
        self.injector = os.environ.get("MANTEL_CEC_INJECTOR", "auto").lower()
        self.cec_ctl = os.environ.get("MANTEL_CEC_CTL", "/usr/bin/cec-ctl")
        self.stdbuf = os.environ.get("MANTEL_CEC_STDBUF", "/usr/bin/stdbuf")
        self.cec_device = os.environ.get("MANTEL_CEC_DEVICE", "/dev/cec0")
        self.osd_name = os.environ.get("MANTEL_CEC_OSD_NAME", "Mantel")
        self.cec_client = os.environ.get("MANTEL_CEC_CLIENT", "/usr/bin/cec-client")
        self.wtype = os.environ.get("MANTEL_CEC_WTYPE", "/usr/bin/wtype")
        self.xdotool = os.environ.get("MANTEL_CEC_XDOTOOL", "/usr/bin/xdotool")
        self.device_type = os.environ.get("MANTEL_CEC_DEVICE_TYPE", "p")
        # 31 includes error, warning, notice, traffic and debug. The decoded
        # "key pressed:" lines used below are not guaranteed at traffic-only 8.
        self.log_level = os.environ.get("MANTEL_CEC_LIBCEC_LOG_LEVEL", "31")
        self.activate_source = os.environ.get("MANTEL_CEC_ACTIVATE_SOURCE", "true").lower() not in {
            "0",
            "false",
            "no",
            "off",
        }
        self.power_poll_seconds = max(
            0.0, float(os.environ.get("MANTEL_CEC_POWER_POLL_SECONDS", "30"))
        )
        self.focus_shortcut = os.environ.get("MANTEL_CEC_FOCUS_SHORTCUT", "F12")
        self.restart_seconds = max(1.0, float(os.environ.get("MANTEL_CEC_RESTART_SECONDS", "3")))
        self.child: subprocess.Popen[str] | None = None
        self.stopping = False
        self.stdin_lock = threading.Lock()

    def source_command(self) -> tuple[list[str], bool]:
        use_libcec = self.source == "libcec" or (
            self.source == "auto" and os.path.exists(self.cec_client)
        )
        if use_libcec:
            return [self.cec_client, "-t", self.device_type, "-d", self.log_level], True
        if self.source in {"auto", "cec-ctl"}:
            command = [
                self.cec_ctl,
                "-d",
                self.cec_device,
                "--playback",
                "-o",
                self.osd_name,
                    "--wait-for-msgs",
            ]
            if os.path.exists(self.stdbuf):
                command = [self.stdbuf, "-oL", "-eL", *command]
            return (
                command,
                False,
            )
        raise ValueError(f"unsupported MANTEL_CEC_SOURCE: {self.source}")

    def injector_command(self, key: str) -> tuple[list[str], str]:
        use_wayland = self.injector == "wtype" or (
            self.injector == "auto"
            and bool(os.environ.get("WAYLAND_DISPLAY"))
            and os.path.exists(self.wtype)
        )
        if use_wayland:
            if self.focus_shortcut:
                return [
                    self.wtype,
                    "-M",
                    "logo",
                    "-k",
                    self.focus_shortcut,
                    "-m",
                    "logo",
                    "-s",
                    "40",
                    "-k",
                    key,
                ], "wtype"
            return [self.wtype, "-k", key], "wtype"
        return [self.xdotool, "key", "--clearmodifiers", key], "xdotool"

    def send_cec_command(self, child: subprocess.Popen[str], command: str) -> bool:
        if child.poll() is not None or child.stdin is None:
            return False
        try:
            with self.stdin_lock:
                child.stdin.write(f"{command}\n")
                child.stdin.flush()
            return True
        except (BrokenPipeError, OSError, ValueError):
            return False

    def poll_tv_power(self, child: subprocess.Popen[str]) -> None:
        while not self.stopping and child.poll() is None and self.power_poll_seconds > 0:
            time.sleep(self.power_poll_seconds)
            if not self.stopping and child.poll() is None:
                self.send_cec_command(child, "pow 0")

    def stop(self, *_: object) -> None:
        self.stopping = True
        if self.child and self.child.poll() is None:
            self.child.terminate()

    def send_key(self, cec_key: str, x_key: str) -> None:
        env = os.environ.copy()
        command, injector = self.injector_command(x_key)
        result = subprocess.run(
            command,
            env=env,
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            LOG.info("CEC %s -> %s", cec_key, x_key)
        else:
            detail = (result.stderr or result.stdout).strip()
            LOG.error("%s failed for %s -> %s: %s", injector, cec_key, x_key, detail)

    def run_once(self) -> int:
        command, keep_stdin_open = self.source_command()
        LOG.info("starting %s", " ".join(command))
        self.child = subprocess.Popen(
            command,
            # cec-client treats EOF as a request to exit; cec-ctl does not.
            stdin=subprocess.PIPE if keep_stdin_open else subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert self.child.stdout is not None
        # LG televisions commonly identify the TV itself as the active CEC
        # source after a cold wake. In that state Magic Remote navigation is
        # not routed to the Pi even though libCEC is connected. cec-client
        # accepts commands before registration and processes them once ready.
        if keep_stdin_open and self.activate_source:
            self.send_cec_command(self.child, "as")
            LOG.info("requested Mantel as the active HDMI-CEC source")
        if keep_stdin_open and self.power_poll_seconds > 0:
            threading.Thread(
                target=self.poll_tv_power,
                args=(self.child,),
                name="mantel-cec-power-poll",
                daemon=True,
            ).start()

        def observe(line: str) -> None:
            match = TV_POWER_CHANGE.search(line)
            if not match:
                return
            previous_power, current_power = match.group(1).lower(), match.group(2).lower()
            LOG.info("TV power changed: %s -> %s", previous_power, current_power)
            if current_power == "on" and previous_power != "on" and self.activate_source:
                if self.send_cec_command(self.child, "as"):
                    LOG.info("TV woke; requested Mantel as the active HDMI-CEC source")

        for cec_key, x_key in translate_lines(self.child.stdout, observe=observe):
            if self.stopping:
                break
            self.send_key(cec_key, x_key)
        return self.child.wait()

    def run_forever(self) -> int:
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, self.stop)
        while not self.stopping:
            try:
                code = self.run_once()
                if not self.stopping:
                    LOG.warning("CEC monitor exited with status %s; restarting", code)
            except FileNotFoundError as error:
                LOG.error("required executable missing: %s", error.filename)
            except Exception:
                LOG.exception("CEC bridge failed")
            if not self.stopping:
                time.sleep(self.restart_seconds)
        return 0


def main() -> int:
    logging.basicConfig(
        level=os.environ.get("MANTEL_CEC_LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    return Bridge().run_forever()


if __name__ == "__main__":
    sys.exit(main())
