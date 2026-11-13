# Related Immich frame projects

Research snapshot: 2026-08-29.

This is strictly an ideas-and-features review. Mantel is private, local software
with no current intention to publish it, but its implementation should still be
our own. No source code, templates, CSS, or assets from these projects should be
copied. We can study user-visible behavior and independently design adaptations
that fit Mantel's single-container, server-cached architecture.

The revisions are recorded only so we know which feature sets were evaluated.
ImmichFrame is GPL-3.0 and immich-kiosk is AGPL-3.0, but Mantel's no-copy rule
applies equally to all four reviewed projects regardless of license.

## Projects reviewed

| Project | Revision reviewed | Strongest ideas |
| --- | --- | --- |
| [ImmichFrame](https://github.com/immichFrame/ImmichFrame) | `c4011150408b` | Multiple accounts, broad metadata display, custom CSS, native apps, e-ink/Frameo clients, video streaming |
| [immich-kiosk](https://github.com/damongolding/immich-kiosk) | `5f57085744d2` | Configuration breadth, offline/cache controls, URL profiles, sleep and burn-in controls, layouts, filters, weather and iframe widgets |
| [immframe](https://github.com/JameZUK/immframe) | `d4bec719b34f` | Smart/scene/tag selectors, MQTT discovery, direct Pi rendering, graceful degradation, collages, runtime brightness and display power |
| [Immich HA Smart Mantel Controller](https://github.com/hyungyunlim/immich-ha-sa) | `e4c8c447cd45` | Device pairing, stable per-device URLs, Home Assistant entities/services, saved profiles, presence and screen-power automation |

## What Mantel already does well

Mantel already covers much of the common feature set without sending the API key
to browsers:

- persistent server-side image and face caches
- low-concurrency prefetch shared by every player
- every image exactly once per playback cycle
- random, newest-first, and oldest-first ordering
- albums, people, whole-library, and on-this-day sources
- multi-person any/all filtering, favorites, rating, orientation, and dates
- face-centering and age-at-photo overlays
- crossfade, Ken Burns, contain/cover, portrait pairing, frames, and rounded corners
- multiple display profiles with a live settings UI
- a separate controller port and real-time player commands
- clock, weather, messages, quotes, trivia, and school-meal widgets
- Raspberry Pi/browser delivery in one NAS container

Those should remain the core rather than replacing Mantel with one of the other
renderers.

## Recommended additions

### 1. Reliability and controller security

Highest priority:

- Persist a last-known-good candidate deck so slideshows continue after the
  playlist cache expires while Immich is unavailable.
- Add cache budgets, pinned assets, warm-up progress, and an LRU eviction policy.
- Replace implicit browser identity with a claim/pairing flow and durable device
  token, borrowing the interaction model (not code) from the HA controller.
- Require authentication for controller/settings mutation before exposing the
  controller beyond a trusted LAN.
- Add structured player health: last seen, current asset, cache readiness,
  Immich reachability, render resolution, and recent error.

### 2. More Immich-native sources

The best read-only additions from immframe are:

- Smart Search source: a user-entered CLIP query such as `family at the beach`.
- Scene sessions: choose a theme, show a bounded once-only mini-deck, then rotate
  to another theme.
- Tags picker and tag source.
- A `more like this` controller command using the current asset as the smart
  search seed.
- Camera body and lens filters.

Smart search and scene selection use the existing `asset.read` permission. Tags
would add only `tag.read`.

### 3. Home Assistant integration

Mantel already owns desired display state, so Home Assistant should control Mantel
directly rather than generating immich-kiosk URLs. Provide a small authenticated
controller API and a HACS integration exposing:

- active display profile and source
- pause, previous, next, and identify
- interval, transition, layout, fit, overlays, and screen-off hours
- player online/cache/health sensors
- brightness, screen power, and volume where the physical player exposes them
- automations for time, room presence, ambient light, and television power

MQTT auto-discovery is useful for simple installations, but the existing HTTP
controller plus SSE model should remain the primary protocol to avoid running
two competing state systems.

### 4. Rich display modes

Useful later additions:

- per-asset duration rules, for example longer for landscape photographs and
  shorter for screenshots
- collage slides with grid and golden-ratio layouts
- video and Live Photo playback with duration-aware progress
- saved style/source presets that can be switched without changing the player's
  stable URL
- profile-specific custom CSS classes, with server-side validation
- multiple Immich accounts, each with its own server-side key and independent
  cache namespace

Video should use Immich's encoded playback stream through Mantel with HTTP Range
support. It should not download originals into the browser or block the photo
prefetch queue.

## Features to avoid or constrain

- Do not copy implementation code, templates, CSS, artwork, or assets from any
  reviewed project. Reimplement selected behavior independently for Mantel.
- Do not put Immich API keys, controller tokens, or mutable configuration in
  player URLs.
- Do not enable Immich writes merely to add a favorite/like button; keep writes
  behind a separate opt-in key if ever implemented.
- Do not fetch original RAW/HEIF files as the normal 4K path. The generated 4K
  preview is predictable and browser-friendly.
- Do not rely on browser cache as the shared offline cache; the NAS cache remains
  authoritative for all players.
- Do not embed arbitrary remote iframes. Widgets need explicit provider
  allowlists and server-side fetching to avoid credential leaks and SSRF.
- Do not expose an unauthenticated controller or pairing/setup page through a
  public tunnel.

## Suggested implementation order

1. Last-known-good playlist persistence and bounded cache management.
2. Authenticated device claim/pairing and controller access.
3. Smart Search and tags as UI-selectable sources.
4. Home Assistant API/integration and player health sensors.
5. Scene sessions, collages, and per-asset duration rules.
6. Video/Live Photos after Range streaming and Pi browser behavior are tested.
7. Multiple accounts only after cache and identity namespaces are explicit.
