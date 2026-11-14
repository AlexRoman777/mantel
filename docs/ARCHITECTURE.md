# Mantel architecture

Mantel is a private, LAN-only Immich presentation system. One container owns
the photo-library integration and any sensitive state; browsers are disposable
players that receive only presentation data and cached media URLs.

## Runtime map

```text
Immich
  ^ read-only API key, server-side only
  |
Mantel container
  |- player HTTP :8780 -> host :3830
  |- controller HTTP :8781 -> host :3831
  |- /data/config.json
  |- /data/immich-connection.json (0600)
  |- /data/home-assistant.json (0600)
  |- /data/image-cache
  |- /data/face-cache
  `- /data/playback-decks
       |
       |- a browser in kiosk mode on a television
       |- phones and tablets
       |- Home Assistant browser panels
       `- ordinary desktop browsers
```

The player and controller listeners are served by the same Node process but are
deliberately exposed on different ports. A player must never need an Immich key.

### Globe location accuracy

The camera and primary pin use the selected photo asset's exact Immich EXIF
latitude and longitude. Nearby-place, region, country, timezone, and online
reverse-geocoding data annotate that coordinate; they never replace it. The
`/places` response clusters nearby assets only for world-view summary markers
and statistics. Individual map-deck slides retain their own coordinates,
so a coastal photo is not moved to a nearby inland town centre.

Map startup never queues Sentinel, OpenStreetMap, or online trivia work for the
whole gallery. Blue Marble provides the immediate flight layer; the active
stop's fine Sentinel and OSM data are requested with priority and cached. Once
that photograph is already playing, the client sends a bounded lookahead of at
most two distinct locations from its real playback queue. That follows random,
chronological, and restored ordering while preventing hundreds of background
jobs from competing with the current stop. If Sentinel is not ready, Blue
Marble remains visible and the photograph still appears on schedule.

## Presentation and player identity

A presentation is a saved profile: sources, filters, playback, layout, framing,
overlays, widgets, remote shortcuts, and off-hours behavior. A player is a
physical or browser client with a stable local ID and a non-secret fingerprint.
Their identities are separate so one presentation can be shared or cloned for
independent editing.

`/display/auto` restores a known assignment or creates a safe independent
profile. A new player registers even before it has photos; it must not display a
launcher, configuration error, or implicit whole-library slideshow.

The controller receives current composition, pause/blackout state, timing, and
diagnostics. Its preview uses the asset IDs reported by that client rather than
running a second unrelated slideshow.

## Photo selection and no-repeat decks

All Immich discovery is constrained by each connection's album-ID allowlist.
The server resolves candidate metadata, freezes a playback deck, and persists
the remaining order. Random, newest-first, and oldest-first change ordering but
not the once-only guarantee.

Layouts consume assets as one unit:

- adaptive: one image or an unused portrait pair on landscape screens; two
  unused landscapes on portrait screens
- portrait stack: one portrait plus two landscapes
- mosaic: up to six assets
- filmstrip: up to five assets
- Instant: one to five assets

An asset consumed by a composition is shown once for that cycle. Portrait reuse
is permitted only when the final unique portrait has no remaining partner.
Newly added album assets can be inserted at the playback head without reshuffling
the frozen remainder.

## Caching and Immich load

Browsers request `/api/image/{assetId}` from Mantel. Mantel fetches the selected
Immich derivative once, stores it in its local cache, and serves all clients
from that shared copy. Responses use immutable cache headers because an asset ID
and size identify stable content.

Normal playback warms only requested playlist pages. A complete album-cache job
is allowed only for album-only presentations after the controller presents the
count and estimated size and the user confirms the same plan. Never warm an
entire account.

Album metadata polling is globally throttled and defaults to five minutes.
Mantel prioritizes newly detected assets but does not claim webhook support.

## Face metadata

Immich performs face detection and recognition. Mantel caches read-only face
boxes and identity metadata, calculates age at capture time, and uses normalized
coordinates for overlays, face-aware cover crops, Ken Burns focus, and Instant
centering. Mantel does not train a model or write recognition data back.

Recognition is account-specific. Prefer the Immich connection whose owner has
the useful family face catalogue; add another account only when its private
assets or owner-specific recognition is required.

## Security boundaries

- Controller access is trusted-LAN only until authentication is implemented.
- Immich and Home Assistant tokens remain server-side in `/data` with mode 0600.
- The ordinary Immich key is strictly read-only and documented in
  `docs/IMMICH_API_KEY.md`.
- Player URLs contain presentation slugs, never secrets.

## Known limits

- Full HDR/10-bit HDMI output is not proven end to end.
- Videos and Live Photos need a separate Range-aware cache and duration model.
- Controller authentication and formal device pairing are future hardening.
- Browser blackout is not physical TV power control.
