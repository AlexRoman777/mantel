# Instant mode

Instant mode is a separate composition system inside the normal Mantel player.
It uses the same album-restricted, once-only deck and cached media pipeline as
other layouts.

## Authentic geometry

The preset models classic instant film:

- card: 3.5 x 4.25 inches
- square image opening: 3.125 inches
- side border: 5.38% of card width
- bottom border: 29.33% of card height

`src/lib/instant.ts` owns these calculations. `Slide.svelte` renders an
explicit card aspect ratio and an absolutely positioned opening. Percentage
padding must not be used for card geometry because CSS resolves it against the
containing width and can produce giant, unusually tall cards on 4K screens.

Card size changes actual layout width. It is not a transform that leaves stale
space behind. The authentic-paper action restores material geometry only; it
must not overwrite card count, arrangement, angle, transition, or color choices.

## Face-aware centering

No separate Pillow script or recognition model runs in Mantel:

1. The server requests Immich's existing face boxes for an asset.
2. Mantel normalizes and caches the boxes.
3. The player calculates the combined rectangle containing detected faces.
4. That rectangle determines CSS `object-position` for the square opening.
5. With no faces, the crop falls back to the photo center.

The operation is immediate, non-destructive, and never changes the cached or
original image. One face becomes the focus; multiple faces use a group focus.
Very wide groups may still require compromise because a square opening cannot
contain every extreme composition without empty space.

## Angles and arrangements

- outward V: two cards have a wider gap at the top than at the bottom
- inward V: two cards have a wider gap at the bottom
- random: bounded deterministic-looking variation

Classic, hero stack, scattered, and gallery arrangements share the authentic
card geometry. `nth-of-type` selectors are used because a live-memory backdrop
may be inserted before the cards.

## Timing

The presentation's **Playback -> Time per slide** controls how long the entire
Instant composition stays on screen. Instant **Development time** controls
only how long the photograph takes to develop from soft/pale to clear.

These are intentionally different timings. If the slide-duration control is
also shown in Instant Studio for clarity, it must edit the same
`slideshow.intervalSec` value rather than add a second timer.

## Captions and fonts

Fonts are bundled under `static/fonts/instant`; no CDN or Google Fonts request
is allowed. The default is Mantel Caveat. Captions start immediately beneath the
image opening and can include capture date/time, location, camera, rating, and
people with age at capture.

Capture timestamps are formatted from the stored photo components without
silently converting them to the viewer's current timezone.

## Backgrounds and OLED care

`original` means Mantel's plain dark background. Material textures are locally
bundled; the red velvet, patinated bronze, ivory travertine, Calacatta marble,
Azuli blue onyx, black metal mesh, midnight indigo, and dark terrazzo surfaces
are original image-generator artwork exported at exactly 3840 x 2160. Live
Memories adds already-shown photos gradually. Saved Memories uses
a prebuilt 4K mosaic generated on the server from album thumbnails after a
review of count and estimated cache cost.

Patterned backgrounds periodically rest to plain black for OLED protection.
Normal clock, weather, calendar, and metadata overlays are hidden in Instant
mode; the card captions carry the photo information.

## Remote controls

When the command ribbon is open, colored LG buttons become Instant-specific:

- red: next arrangement
- green: next background
- yellow: change card count
- blue: show or hide captions

The ribbon is temporary and must auto-hide. It must render human-readable
labels, never serialized objects such as `[object Object]`.
