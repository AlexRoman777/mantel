# Configuration

Almost everything is configured visually in the Controller at
`http://<host>:3831`, saved per presentation, with a live preview. There are no
YAML files to write and no widget config file.

The environment variables below only cover deployment: ports, identity, limits.

## Environment variables

None are required.

| Variable | Description |
| --- | --- |
| `IMMICH_URL` | Developer/migration fallback; normally saved from the Controller |
| `IMMICH_API_KEY` | Developer/migration fallback; normally saved from the Controller |
| `PORT` | Private in-container player port (default `8780`) |
| `CONTROL_PORT` | Private in-container controller port (default `8781`) |
| `MANTEL_BIND_ADDRESS` | Interface receiving published ports (default `0.0.0.0`; set one IP to restrict) |
| `MANTEL_PLAYER_PORT` | Published player host port (default `3830`) |
| `MANTEL_CONTROLLER_PORT` | Published controller host port (default `3831`) |
| `MANTEL_PUID` | Runtime UID (default `10001`) |
| `MANTEL_PGID` | Runtime GID (default `10001`) |
| `DATA_DIR` | Config directory (default `/data` in Docker, `./data` in dev) |
| `MANTEL_DATA_DIR` | Compose host path for persistent data (default `./mantel-data`) |
| `TZ` | Timezone, used for memories and screen-off hours |
| `ORIGIN` | Public address when behind a proxy that does not send `X-Forwarded-Proto`, for example `https://photos.example.com` |
| `PROTOCOL_HEADER` | Header that carries the original protocol (default `x-forwarded-proto`) |
| `PLAYLIST_REFRESH_MINUTES` | How often source membership is refreshed from Immich (default `60`) |
| `IMMICH_UPDATE_POLL_MINUTES` | Shared album-metadata check interval across all players (default `5`, minimum `1`) |
| `CACHE_CONCURRENCY` | Parallel downloads for a confirmed album cache, clamped 1–8 (default `4`) |
| `IMAGE_CACHE_MAX_GB` | Ceiling for the image cache; least-recently-shown photos evicted first (default `20`, `0` = unlimited) |
| `MANTEL_MEMORY_LIMIT` | Compose memory ceiling (default `2g`) |
| `MANTEL_MEMORY_RESERVATION` | Compose soft memory reservation (default `512m`) |
| `MANTEL_CPU_LIMIT` | Compose CPU ceiling (default `2.0`) |

## Players and presentations

A **player** is one connected browser or kiosk. A **presentation** is a saved
profile: sources, filters, playback, layout, framing, overlays, widgets, remote
shortcuts and off-hours behaviour.

Several players may deliberately share a presentation. But choosing **Edit this
player live** automatically clones a shared presentation and assigns the copy to
that player alone before opening the editor — so editing the hallway tablet can
never silently change the living-room TV.

The live editor follows the exact asset IDs, composition, pause state and
countdown that the browser reports. It does not start a second slideshow
alongside the one you are watching.

Before you give it a friendly name, a player is identified by its browser,
platform, screen resolution and a stable short ID. That fingerprint contains no
Immich data and survives ordinary reconnects through the browser's local
storage.

Players post a small Mantel-only heartbeat every 20 seconds, which keeps
embedded browsers (Home Assistant panels, for instance) visible with their
current photo even when the long-lived command channel is unavailable. Such
cards are marked **Online · embedded** until it reconnects. Heartbeats never
call Immich.

## Caching and playback cycles

Image files live in `DATA_DIR/image-cache`. **Normal playback caches only the
photos it actually shows** — it never silently warms a whole account.

For a presentation whose sources are all explicit albums, **Review offline
cache** enumerates the exact filtered selection and reports total, cached and
missing assets plus the estimated additional disk use, *without downloading
image bytes*. The slow two-download job starts only after a second confirmation,
and only if the asset count still matches.

Clearing the cache or applying new albums also resets player queues, so an old
collection cannot keep playing on the television.

### Polling, not webhooks

Album-only players ask Mantel for updates every five minutes by default. Mantel
shares and throttles that result globally per presentation, so ten screens do
not become ten Immich checks. A changed count or update timestamp triggers one
re-enumeration, and newly discovered images go to the front of each active
queue.

This is deliberately gentle polling, not a claimed Immich webhook. The interval
can be lowered to one minute, never below.

### Once-per-cycle playback

Each active cycle is persisted in `DATA_DIR/playback-decks`. Album changes
therefore cannot shift page offsets or repeat and skip photos inside an existing
cycle, and a container restart resumes the same deck. The next cycle is rebuilt
from the updated album. At most 32 recent deck snapshots are kept.

Within a cycle, assets are deduplicated and shown exactly once. The next cycle
gets a new deterministic shuffle. The random source enumerates the library
rather than taking a random sample, so "random" really does reach everything.

Selecting one person as the only source and choosing **Oldest first** gives a
chronological slideshow of photos Immich associates with that person.

## Face timeline

Enable **Face timeline**, select one person, and choose **Oldest first** for a
chronological, face-centred sequence.

Face responses are persisted in `DATA_DIR/face-cache`, so each asset's metadata
is normally requested from Immich only once. If Immich has a birth date, Mantel
can show the person's age when each photo was taken.

This live mode does not run eye-alignment, pose, blink or blur ML filters, and
does not compile an MP4. Those remain an optional offline production pipeline
rather than work suitable for every slide.

## Multiple Immich accounts

Start with **one** key, from the account that can see the shared family album
and has the most useful person names.

Add a second named connection only when you need its private albums or its
owner-specific face catalogue. Do not add every family account by default.

Immich recognition belongs to the asset owner: another account's face names do
not become available merely because it shares an album, and Mantel never guesses
those identities. Each named connection uses its own nine-permission read-only
key and its own cache namespace.

## Home Assistant weather

Weather can come from Mantel's own location provider or from a Home Assistant
`weather.*` entity. Location search accepts local names such as Täby or
Näsbypark.

In the presentation editor choose **Home Assistant**, enter its URL and a
long-lived access token. Mantel discovers the available `weather.*` entities and
offers them as a dropdown.

The token is saved server-side in `/data/home-assistant.json` with mode 0600.
Players never receive it. Mantel only issues authenticated `GET` requests to
`/api/`, `/api/states` and the selected entity's `/api/states/<entity_id>`.

**Prefer a dedicated non-administrator Home Assistant user**, because tokens
inherit their user's authority.

## Planned: video playback

Video assets are deliberately excluded from image playlists in version 1.0, so a
shared clip cannot become a blank slide.

The planned video path will add server-cached range streaming, poster frames,
duration-aware scheduling, muted/autoplay controls, optional audio, transcoding
compatibility reporting, and the same once-per-cycle accounting used for
photographs.

## See also

- [INSTALL.md](INSTALL.md) — requirements and first run
- [WIDGETS.md](WIDGETS.md) — overlays, dashboard cards and tickers
- [WORLD_MAP.md](WORLD_MAP.md) — the globe, and building its offline data
- [REMOTE_CONTROL.md](REMOTE_CONTROL.md) — the controller, kiosks and TV remotes
- [ARCHITECTURE.md](ARCHITECTURE.md) — how it is put together inside
