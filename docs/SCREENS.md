# Putting it on a screen

A Mantel screen is **a browser on `http://<host>:3830`**. That is the whole
requirement.

Open the page and it registers itself, picks up a presentation and starts
playing. It then appears in the controller, where you can name it, change what
it shows, and control it from your phone.

This page is about the part Mantel cannot do for you: persuading a browser and
the device under it to behave like a photo frame instead of a computer.

## What people actually use

| | Works well because | Watch out for |
|---|---|---|
| **A tablet in a stand** | Always charged, right shape, silent | Screen timeout; auto-brightness; it will try to sleep |
| **An old phone** | You already have one | Small, but perfect on a shelf |
| **A computer wired to a TV** | Full-size browser, full control | Screensaver and power settings |
| **A smart TV's own browser** | No extra hardware | Often old, often slow; try it before relying on it |
| **A small single-board computer** | Cheap, quiet, runs all day | You set up the kiosk yourself |
| **A dashboard panel that embeds a web page** | Already on the wall | Embedded browsers vary; Mantel handles them specially |

Mantel runs happily in a modest browser: the client JavaScript is small,
animations are compositor-only, and images are prefetched with decoding kept off
the main thread.

**A device without WebGL still works.** The world map falls back to dissolves
instead of flights; everything else is unaffected.

## Making a browser behave

Four things turn a browser into a frame. All of them are browser or OS
settings, not Mantel settings.

1. **Full screen.** `F11` on a desktop; "Add to Home Screen" on iOS and Android
   gives you a chrome-free window.
2. **Stop it sleeping.** Mantel requests a wake lock where the browser supports
   one, but an OS screen timeout will still win. Turn it off on the device.
3. **Stop it dimming.** Auto-brightness makes a slideshow look broken.
4. **Hide the pointer.** Only matters where there is a mouse.

### What Mantel does for you

- **Screen-off hours** — blank the display overnight, set per presentation
- **Burn-in mitigation** — overlays hide and shift on a cycle; an OLED-safe
  blackout is available from the controller
- **Wake lock** — requested automatically where available
- **Touch and remote controls** — pause, next and previous work with a
  touchscreen or a keyboard-like remote
- **It never shows an error page.** No album configured? The screen stays black
  and reports itself to the controller instead of displaying a setup wizard to
  your living room.

## Dedicated kiosks

If you want a screen that boots straight into photos and never shows anything
else, you are building a kiosk. In outline:

```sh
chromium --kiosk --noerrdialogs --disable-session-crashed-bubble \
  http://<host>:3830/display/auto
```

`/display/auto` restores a known assignment or safely creates a new one, so a
kiosk never stops at a launcher or a missing-profile page.

From there it is your platform's problem: start that command on boot, disable
the screensaver, hide the cursor.

Mantel deliberately ships no setup for any particular device. Kiosk tooling
differs across operating systems and desktops, it dates quickly, and a photo
frame should not pretend to be a Linux distribution. Use whatever your platform
already provides for autostart and screen blanking.

## Several screens

Each browser keeps a private ID and reports a non-secret device, platform and
screen fingerprint, so friendly names and assignments survive reconnects.

Screens can share one presentation, or have their own. Choosing **Edit this
player live** clones a shared presentation first, so adjusting the kitchen
tablet cannot change the living-room television.

Composition is screen-aware: on a landscape television Mantel pairs unused
portraits side by side, and on a portrait phone it pairs unused landscapes — so
the same album looks right on both without you configuring anything.

## See also

- [REMOTE_CONTROL.md](REMOTE_CONTROL.md) — the controller, and TV remotes
- [CONFIGURATION.md](CONFIGURATION.md) — presentations, players and caching
