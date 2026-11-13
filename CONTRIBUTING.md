# Contributing

Thanks for looking. Mantel is maintained by one person in their spare time, so
the most useful thing you can do is make your contribution easy to evaluate.

## Before you write code

**Open an issue first for anything beyond a bug fix.** A pull request that adds
a feature nobody agreed on is the most common way for everyone's time to get
wasted — including yours. A short issue describing the problem you hit, before
the solution you have in mind, is usually enough.

Bug fixes with a test need no discussion. Send them.

## Getting it running

```sh
npm install
npm run dev
```

Open `http://localhost:5173`. The settings UI is at `/settings`, a player at
`/display/default`. You need an Immich server with at least one album, and a
read-only API key as described in [docs/IMMICH_API_KEY.md](docs/IMMICH_API_KEY.md).
Use a test album rather than your real library.

Before opening a pull request:

```sh
npm test
npm run check
npm run build
```

All three must pass. `npm run check` is `svelte-check`, and new type errors are
treated the same as test failures.

## How the project is shaped

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is the real explanation. The parts
worth knowing before your first change:

- **The Immich API key is server-side and stays there.** Anything that would put
  it, or a direct Immich URL, in front of the browser will be rejected. Players
  talk only to Mantel.
- **Mantel never writes to Immich.** No shares, no favourites, no deletions. If
  a feature needs a write, it needs a discussion first.
- **Nothing is selected by default.** A fresh install shows nothing until
  someone explicitly allows an album. Please keep that true.
- **The player has to survive being a kiosk.** It runs for months on a Raspberry
  Pi behind a television with nobody watching the console. Prefer recovering
  over throwing, and never leave a screen stuck on an error page.
- **Client JavaScript stays small and animations stay on the compositor.** The
  target is a Raspberry Pi browser, not a desktop.

## Style

There is no linter to argue with. Match the file you are editing: tabs,
single quotes, and no semicolon-free experiments.

Comments should say *why*, not *what*. The existing code does this fairly
consistently and it is the main reason it is navigable.

## Commits and pull requests

- One logical change per pull request. Two unrelated fixes are two pull requests.
- Write commit subjects in the imperative: "Fix face box scaling on portrait
  screens", not "fixed" or "fixes".
- Say in the description what you changed, why, and how you checked it. If it
  changes something visible, a screenshot earns its place.
- Keep generated assets (map tiles, textures, image archives) out of commits.
  `.gitignore` already covers the usual ones.

## Licensing, and why it matters here

Mantel is **AGPL-3.0-or-later**. By contributing you agree your contribution is
licensed under those terms.

One thing to be aware of, stated honestly rather than buried: the maintainer
retains the right to offer Mantel under other licence terms, including
commercial ones. If a change makes that impossible without your agreement, you
will be asked before it is merged. If that arrangement is not for you, that is a
completely reasonable position — say so in the issue and nobody will be annoyed.

## Things that will probably be declined

- Adding authentication as a half-measure. Mantel's answer to remote access is a
  VPN or a reverse proxy; a homegrown login would give a false sense of safety.
- Writing to Immich.
- Telemetry, analytics, or update checks, in any form.
- Cloud dependencies for something that can be done on the server. The world map
  is self-hosted on purpose.
- Big dependency additions. The runtime dependency list is four packages and it
  is kept that way deliberately.

## Code of conduct

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
