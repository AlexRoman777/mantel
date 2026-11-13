# Security policy

## Reporting a vulnerability

Please report security problems **privately**, not in a public issue.

Use GitHub's private vulnerability reporting: open the
[Security tab](https://github.com/AlexRoman777/mantel/security) and choose
**Report a vulnerability**. That opens a private thread visible only to you and
the maintainers.

Please include what you can:

- what the problem allows an attacker to do,
- the steps or request that triggers it,
- the Mantel version (`package.json` version, or the image tag you run),
- whether your instance is reachable from outside your own network.

You can expect a first reply within **7 days**. If a report is confirmed, the
fix and a GitHub Security Advisory are published together, and you are credited
unless you ask not to be.

## Supported versions

Mantel is a single-maintainer project with no long-term support branches. Fixes
land on the latest release. Please update before reporting.

## What is in scope

- Access to photos, album contents, or the Immich API key by someone who should
  not have it
- Anything that makes the browser able to read the Immich API key, which is
  meant to stay on the server
- Path traversal or injection through profile names, album IDs, or uploaded
  configuration
- A player or controller endpoint doing something a read-only photo frame
  should not do, such as writing to Immich

## What is out of scope

These are known, documented properties of the design rather than defects:

- **There is no authentication.** Mantel is built to run on a trusted home
  network, in the same way a printer or a NAS admin page is. Anyone who can
  reach the controller port can change what the screens show. Do not expose
  Mantel to the internet; if you need remote access, put it behind a VPN or an
  authenticating reverse proxy.
- **Players are deliberately anonymous.** Any browser that can reach the player
  port can become a screen. That is the point of a photo frame.
- Vulnerabilities in Immich itself. Please report those to the
  [Immich project](https://github.com/immich-app/immich/security).
- Findings from an automated scanner with no demonstrated impact.

## Handling your Immich key

Mantel asks for a **read-only** Immich API key, and
[docs/IMMICH_API_KEY.md](docs/IMMICH_API_KEY.md) lists the exact permissions to
tick. The key is stored inside the data volume with owner-only permissions, is
never returned to a browser, and never leaves your server: players request
images from Mantel, and Mantel requests them from Immich.

If you believe a key has been exposed, revoke it in Immich first — that takes
effect immediately — and then report the problem here.
