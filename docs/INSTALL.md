# Installing Mantel

Mantel is a **web app**. You run one small server; everything else is a browser
pointed at it.

There are two pieces, and they are the same process on two ports:

- the **controller** — where you pick albums and manage screens, on `:3831`
- the **player** — the page a screen actually displays, on `:3830`

A "screen" is any browser. Mantel does not care what it runs on.

## Before you start

**Mantel is self-hosted software, not an app.** There is no installer, no
account, no hosted version. You run it on a machine you own.

You will have a good time with this if you are comfortable:

- running `docker compose up -d`
- finding a machine's IP address on your own network
- reading a container's logs when something does not start

You do **not** need to know SvelteKit, Node, or anything about how Mantel is
built, and you do not need any particular hardware.

If that list looks unfamiliar, Mantel is probably not the right first
self-hosted project — set Immich up first and come back.

Budget about **fifteen minutes**, plus however long you spend choosing albums,
which is the enjoyable part.

## What you need

### An Immich server

Mantel reads from it. It does not replace, bundle or install Immich.

### Somewhere to run one container

Anywhere Docker runs and your screens can reach over the network:

a laptop · a mini PC · a NAS · a home server · a small VM

|  | Minimum | Comfortable |
|---|---|---|
| CPU | 2 cores, ARM or x86-64 | 4 cores |
| RAM | 512 MB free | 1–2 GB |
| Disk | 1 GB | 20 GB if you cache albums for offline playback |

It is one Node process. It is not heavy.

**Disk is the only thing to think about.** Mantel caches only the photos it
actually shows, capped at 20 GB by default. If you ask it to pre-cache a whole
album, it tells you the exact size first and waits for a second confirmation.
The optional world-map imagery is separate and much larger — see
[WORLD_MAP.md](WORLD_MAP.md).

Images are built for `linux/amd64` and `linux/arm64`. A 32-bit OS will not work.

### Something with a browser

Whatever you want to look at. A tablet, an old phone, a smart TV, a desktop, a
dashboard panel, a computer wired to a television.

See [SCREENS.md](SCREENS.md) for what works well and what to watch out for.

## Install

### 1. Make a read-only Immich key

In Immich, create a dedicated API key with **nine specific permissions**.

**Do not use Select all.** [IMMICH_API_KEY.md](IMMICH_API_KEY.md) lists exactly
which to tick and why each is needed. A key made this way cannot modify or
delete anything, even if Mantel is somehow compromised.

### 2. Start the server

```sh
cp docker-compose.example.yml docker-compose.yml
docker compose up -d
```

There is no deployment `.env` to fill in. Immich is configured from the web UI
once the container is running.

<details>
<summary>Running it without Docker</summary>

Mantel is a SvelteKit app and needs only Node 22 or newer:

```sh
npm ci
npm run build
node build/index.js
```

Set `DATA_DIR` to a directory it may write to. Docker is recommended because it
pins the Node version and the data directory for you, not because anything
requires it.
</details>

### 3. Connect Immich

Open **`http://<your-host>:3831`** — the **controller**.

Add a named Immich account, paste the API key, and paste one or more album IDs
or `/albums/...` URLs copied from Immich. Choose **Test and save**.

Mantel only ever reads albums you have explicitly listed. There is no "show me
everything" default, by design.

### 4. Open a screen

On whatever you want to display photos, open **`http://<your-host>:3830`**.

The browser registers itself, clones the best configured presentation, and
starts playing. You do not create a profile for it first — it appears in the
controller, where you can name it and change it.

If no album has been configured yet, the page stays black on purpose rather than
showing a setup screen. A television should never display an error message. It
still appears in the controller so you can fix it from your phone.

## Where your data lives

Everything persistent lives in one host directory, set by `MANTEL_DATA_DIR`
(default `./mantel-data`).

```
mantel-data/
├── config.json                 presentations and settings
├── immich-connection.json      your API key          (mode 0600)
├── home-assistant.json         HA token, if used     (mode 0600)
├── image-cache/                photos actually shown
├── face-cache/                 face boxes from Immich
├── playback-decks/             where each screen is in its cycle
└── map/, map-cache/            map imagery, if enabled
```

**Back up `config.json`.** Everything else rebuilds itself.

### File ownership

The container drops to `MANTEL_PUID:MANTEL_PGID` (default `10001:10001`) after
fixing only the `/data` mount point. It never recursively chowns a large cache
at startup, so a redeploy cannot stall while walking thousands of cached images.

A fresh data directory just works. If you **copy an older one in by hand**, make
sure the files are owned by or writable for those IDs first.

## Installing without internet access

If the machine cannot pull images, save the image on a machine that can and copy
the file across:

```sh
docker pull ghcr.io/alexroman777/mantel:1.0.0
docker save ghcr.io/alexroman777/mantel:1.0.0 | gzip > mantel.tar.gz
```

Then, on the target machine, next to your `docker-compose.yml`:

```sh
docker load --input mantel.tar.gz
docker compose up -d --wait --wait-timeout 90
```

The last command exits once Mantel passes its health check, or fails after 90
seconds rather than hanging.

## Before you expose it

**Mantel has no authentication, on purpose** — in the same way a printer's admin
page does not. It is designed for a network you control.

Do not port-forward it. Reach it from outside through a VPN or an
authenticating reverse proxy. See [SECURITY.md](../SECURITY.md).

A proxy that serves Mantel over HTTPS must pass `X-Forwarded-Proto` (most do by
default), or set `ORIGIN` to the public address, for example
`ORIGIN=https://photos.example.com`. Otherwise Mantel refuses deletes from the
controller, because the request looks as if it came from another site.

## If something does not work

| Symptom | Usually |
|---|---|
| Controller will not load | Container not running — `docker compose logs mantel` |
| "Test and save" fails | Wrong URL (include `http://` or `https://`), or a key missing permissions |
| Album rejected | Mantel wants the album **UUID** or a full `/albums/...` URL |
| Screen stays black | No album configured yet — check the controller |
| Photos look soft | Raise image quality under Playback, at the cost of bandwidth |
| Screen sleeps or shows UI | Browser or OS setting, not Mantel — see [SCREENS.md](SCREENS.md) |

Still stuck? Open a [discussion](https://github.com/AlexRoman777/mantel/discussions)
with your logs. Please don't paste your API key.

## Next

- [SCREENS.md](SCREENS.md) — getting a browser to behave like a photo frame
- [CONFIGURATION.md](CONFIGURATION.md) — every setting and environment variable
- [WORLD_MAP.md](WORLD_MAP.md) — building the offline map data
