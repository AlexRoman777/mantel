# Overlays, widgets and messages

Everything here is configured in the presentation editor and saved with the
presentation. **There is no widget config file.**

Every service can be shown either as a normal information card or flattened into
a top or bottom ticker.

## Overlays

| | |
|---|---|
| **Clock and date** | Optional Swedish holidays, name days and week number |
| **Place** | Where the photo was taken |
| **People** | Recognized names, with compact ages |
| **Photo info** | Camera, date, album |
| **Weather** | From Mantel's location provider or a Home Assistant entity |

Each item has independent typography: size, and white, black, custom, or
photo-opposite colour. Nine placements, from the four corners through the side
centres to top centre.

Text overlays use bold type and layered shadows rather than fixed translucent
panels, and they still take part in the OLED hide/shift cycle.

## Dashboard widgets

### Custom messages and ticker

A persistent message, or a scrolling reminder/news ticker.

### Quotes and trivia

Rotates every 15–60 minutes.

### Weather

Location-based, or a Home Assistant `weather.*` entity — see
[CONFIGURATION.md](CONFIGURATION.md#home-assistant-weather).

### Swedish school lunches

Accepts the school segment from `skolmaten.se/<school>`.

Uses Skolmaten's current read API, caches results for one hour, shows today plus
next week on weekdays (the coming week at weekends), deduplicates identical
dishes, and scrolls a compact fixed-height card. Mantel contacts only that one
host.

### SL departures (Stockholm)

Includes Roslagsbanan at Galoppfältet and nearby buses from Kemistvägen by
default. Polls Mantel once per minute and shows the required Trafiklab/SL
attribution.

SL Transport's public departures endpoint does not require a key. Mantel caches
and shares the result, so multiple screens do not multiply requests.

> The Swedish widgets are there because this was built for a house in Sweden.
> They are entirely optional, and the rest of Mantel has no opinion about where
> you live.

## Live messages

The **Messages** tab in the Controller is live-only. It can target every online
player or a chosen few with:

- a **centred popup**, 5–60 seconds
- a **fast ticker** along the top or bottom

Nothing is saved to the presentation — it appears, then it is gone.

Players also report an animation-frame-derived refresh-rate estimate and
browser-available device metrics in that tab. Ticker motion is composited and
naturally synchronised to the player's refresh cycle; the configured
seconds-per-pass sets the speed.

## What this costs you in privacy

The weather, lunch, transit and online place-detail widgets each contact exactly
one external host, and only when you switch them on. Every one is listed, with
what it sends, in [PRIVACY.md](../PRIVACY.md).

With all of them off, Mantel talks to nothing but your Immich server.
