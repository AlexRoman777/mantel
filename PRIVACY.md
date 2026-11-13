# Privacy

Mantel shows your family photographs on screens around your home. That is about
as sensitive as self-hosted software gets, so this document states plainly what
the software does with your data, what leaves your network, and how to turn each
of those off.

**Short version:** Mantel has no backend, no account, no telemetry and no
analytics. The project operates no server. Your photos, your Immich key and
your configuration stay on the machine you run it on. A few optional widgets
fetch public data from third parties, every one of them is listed below, and
every one can be switched off.

## What Mantel stores, and where

Everything lives in one directory on your own machine — the one named by
`MANTEL_DATA_DIR`, which defaults to `./mantel-data`:

| What | Why it exists |
|---|---|
| `config.json` | Your presentations, overlays and screen settings |
| Your Immich connection | Server URL and API key, written with owner-only permissions |
| Cached images | So playback does not re-download the same photo endlessly |
| Map and place caches | So the world map works without calling anyone while a screen is running |

Deleting that directory removes everything Mantel knows.

**The Immich API key never reaches a browser.** Players ask Mantel for an image;
Mantel asks Immich. The key stays server-side, and the key Mantel asks for is
read-only — see [docs/IMMICH_API_KEY.md](docs/IMMICH_API_KEY.md).

**Mantel never writes to Immich.** It does not create shares, albums, or
favourites, and it does not delete anything. It reads.

## What each player reports

A player is just a browser. It keeps a random identifier in its own
`localStorage` so the controller can show it as the same screen after a reload,
and it reports what it can see about itself: viewport size, pixel density, an
estimated refresh rate, CPU core count, and browser-exposed memory. This goes to
**your** controller and nowhere else. It is how the "Live players" page works.

Clearing that browser's site data makes it a new, unrecognised screen.

## What leaves your network

Nothing, until you enable a feature that needs it. Each item below is off unless
you turn it on, and each one is the only thing that talks to that host.

| Feature | Host contacted | What is sent |
|---|---|---|
| Photos | Your own Immich server | Your API key, album and asset IDs |
| Home Assistant weather | Your own Home Assistant | Your token (stays server-side) |
| Weather, without Home Assistant | `api.open-meteo.com`, `geocoding-api.open-meteo.com` | A coarse location |
| Place descriptions on the map | `en.wikipedia.org` | The place name being shown |
| Map detail around photo locations | `nominatim.openstreetmap.org`, `overpass-api.de` or `overpass.kumi.systems`, `tiles.maps.eox.at` | Coordinates near your photos |
| SL departures (Stockholm) | `transport.integration.sl.se` | Your own Trafiklab key and a stop ID |
| School meals (Sweden) | `skolmaten.se` | The school you chose |
| Swedish calendar | `sholiday.faboul.se` | A date |

Two notes worth reading twice:

- **Map detail sends photo coordinates to third parties.** If a photo was taken
  at your home, enabling map detail asks a public service about that area. The
  result is cached locally, so it is asked once rather than on every playback —
  but if that trade is not one you want, leave the map layout off or use the
  vector globe without detail layers. Everything the vector globe needs
  (Natural Earth, public domain) is already in this repository and needs no
  network at all.
- **Build scripts download from `eoimages.gsfc.nasa.gov`, `naturalearth.s3.amazonaws.com`
  and `download.geonames.org`.** Those run when *you* build map assets, not while
  a screen is playing.

## What Mantel never does

- No analytics, telemetry, crash reporting or usage statistics
- No update check, licence check or phone-home of any kind
- No account, no sign-up, no cloud component — the project runs no server
- No advertising identifiers, cookies for tracking, or third-party scripts
- Nothing is sent to the author of this software, who has no way to learn that
  you run it

## Access control, honestly stated

Mantel has **no authentication**, by design, like a printer's admin page. Anyone
who can reach the controller port on your network can see thumbnails of the
photos in your allowed albums and change what the screens show.

So: keep it on your home network. Do not port-forward it. If you want it from
outside, use a VPN such as WireGuard or Tailscale, or put an authenticating
reverse proxy in front of it. This is stated again in
[SECURITY.md](SECURITY.md).

## If you are in the EU

Running Mantel for your own household is covered by the GDPR's household
exemption, so none of this is a compliance obligation for you. It is simply
what the software does. If you deploy it somewhere that is not a private home,
note that photographs of identifiable people are personal data and that Immich's
face recognition, which Mantel reads, produces biometric data.

## Questions

Open an issue. If the question is about a weakness rather than a behaviour,
follow [SECURITY.md](SECURITY.md) instead.
