import importlib.util
import pathlib
import sys
import unittest


MODULE_PATH = pathlib.Path(__file__).parents[1] / "cec_remote.py"
SPEC = importlib.util.spec_from_file_location("cec_remote", MODULE_PATH)
assert SPEC and SPEC.loader
cec_remote = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = cec_remote
SPEC.loader.exec_module(cec_remote)


class ParseCecKeyTests(unittest.TestCase):
    def test_parses_key_press_with_libcec_prefix(self):
        line = "DEBUG: [ 12345] key pressed: right (4) current(ff) duration(0)"
        self.assertEqual(cec_remote.parse_cec_key(line), "right")

    def test_ignores_release(self):
        line = "DEBUG: [ 12345] key released: right (4) current(ff) duration(350)"
        self.assertIsNone(cec_remote.parse_cec_key(line))

    def test_normalizes_common_variants(self):
        self.assertEqual(cec_remote.normalize_key(" fast-forward "), "fast forward")
        self.assertEqual(cec_remote.normalize_key("PLAY_PAUSE"), "play pause")

    def test_parses_kernel_cec_ctl_output(self):
        lines = [
            "Received from TV to Playback Device 1: USER_CONTROL_PRESSED (0x44):",
            "\tui-cmd: Right (0x04)",
            "Received from TV to Playback Device 1: USER_CONTROL_RELEASED (0x45)",
        ]
        self.assertEqual(list(cec_remote.iter_cec_keys(lines)), ["right"])

    def test_parses_verbose_kernel_cec_ctl_output(self):
        lines = [
            "User Control Pressed:",
            "  UI Command: Select (0x00)",
        ]
        self.assertEqual(list(cec_remote.iter_cec_keys(lines)), ["select"])

    def test_parses_raw_libcec_user_control_packets(self):
        lines = [
            "TRAFFIC: [  11994] >> 01:44:03\n",
            "TRAFFIC: [  12001] >> 01:44:00\n",
            "TRAFFIC: [  12010] >> 01:44:49\n",
        ]
        self.assertEqual(
            list(cec_remote.iter_cec_keys(lines)),
            ["left", "select", "fast forward"],
        )

    def test_parses_number_button_packets(self):
        lines = ["TRAFFIC: [ 12001] >> 01:44:21\n", "TRAFFIC: [ 12002] >> 01:44:29\n"]
        self.assertEqual(list(cec_remote.iter_cec_keys(lines)), ["1", "9"])

    def test_parses_lg_colored_button_packets(self):
        lines = [
            "TRAFFIC: [ 12001] >> 01:44:71\n",
            "TRAFFIC: [ 12002] >> 01:44:72\n",
            "TRAFFIC: [ 12003] >> 01:44:73\n",
            "TRAFFIC: [ 12004] >> 01:44:74\n",
        ]
        self.assertEqual(
            list(cec_remote.iter_cec_keys(lines)),
            ["blue", "red", "green", "yellow"],
        )

    def test_observer_receives_power_events_that_are_not_keys(self):
        observed = []
        lines = [
            "DEBUG: TV (0): power status changed from 'standby' to 'on'\n",
            "DEBUG: key pressed: right (4) duration(0)\n",
        ]

        self.assertEqual(
            list(cec_remote.iter_cec_keys(lines, observe=observed.append)),
            ["right"],
        )
        self.assertEqual(observed, lines)

    def test_detects_lg_tv_wake_transition(self):
        match = cec_remote.TV_POWER_CHANGE.search(
            "DEBUG: TV (0): power status changed from 'standby' to 'on'"
        )
        self.assertIsNotNone(match)
        self.assertEqual(match.groups(), ("standby", "on"))


class TranslationTests(unittest.TestCase):
    def test_deduplicates_raw_and_named_lg_color_events(self):
        lines = [
            "TRAFFIC: [ 12001] >> 01:44:72\n",
            "key pressed: f2 (114) duration(0)",
            "key pressed: f2 (114) duration(0)",
        ]
        ticks = iter([1.0, 1.01, 1.02])
        self.assertEqual(
            list(cec_remote.translate_lines(lines, now=lambda: next(ticks))),
            [("red", "F13")],
        )

    def test_maps_lg_colored_buttons_to_reserved_function_keys(self):
        lines = [
            "key pressed: f2 (114) duration(0)",
            "key pressed: f3 (115) duration(0)",
            "key pressed: f4 (116) duration(0)",
            "key pressed: f1 (113) duration(0)",
        ]
        ticks = iter([1.0, 2.0, 3.0, 4.0])
        self.assertEqual(
            list(cec_remote.translate_lines(lines, now=lambda: next(ticks))),
            [("f2", "F13"), ("f3", "F14"), ("f4", "F15"), ("f1", "F16")],
        )

    def test_maps_navigation_and_media_keys(self):
        lines = [
            "key pressed: left (3) duration(0)",
            "key pressed: select (0) duration(0)",
            "key pressed: pause (70) duration(0)",
            "key pressed: exit (13) duration(0)",
        ]
        ticks = iter([1.0, 2.0, 3.0, 4.0])
        self.assertEqual(
            list(cec_remote.translate_lines(lines, now=lambda: next(ticks))),
            [
                ("left", "Left"),
                ("select", "Return"),
                ("pause", "XF86AudioPause"),
                ("exit", "Escape"),
            ],
        )

    def test_suppresses_immediate_duplicate_press(self):
        lines = ["key pressed: right (4)", "key pressed: right (4)", "key pressed: right (4)"]
        ticks = iter([1.0, 1.1, 1.5])
        self.assertEqual(
            list(cec_remote.translate_lines(lines, now=lambda: next(ticks))),
            [("right", "Right"), ("right", "Right")],
        )

    def test_ignores_unmapped_keys(self):
        self.assertEqual(list(cec_remote.translate_lines(["key pressed: volume up (65)"])), [])


if __name__ == "__main__":
    unittest.main()
