# Changelog

Mantel follows [semantic versioning](https://semver.org). A change that breaks an existing
installation or its saved configuration raises the first number.

## 1.0.1 (14 November 2026)

- Built on SvelteKit 3, which fixes the remaining framework security advisories.
- Deletes sent from another site are now refused.
- The documentation and the controller no longer assume a NAS: the NAS handoff bundle is
  replaced by a plain `docker save` / `docker load` guide for machines without internet access.

**Upgrade note.** If Mantel sits behind a reverse proxy that serves it over HTTPS, the proxy must
send `X-Forwarded-Proto` (most do by default), or set `ORIGIN` to the public address, for
example `ORIGIN=https://photos.example.com`. Otherwise deletes from the controller are refused.
Direct connections on your network need no change.

## 1.0.0 (14 November 2026)

The first public release.

- A self-hosted photo frame for Immich: one container that serves the screens and the
  controller.
- Presentation modes: full screen, gallery framing, mosaic, instant table and world map.
- Read-only access to Immich by design. No account, no telemetry, no cloud service.
- Images for `linux/amd64` and `linux/arm64` at `ghcr.io/alexroman777/mantel`.
- Every change is checked for secrets, misconfiguration, vulnerable dependencies and insecure
  code patterns before it can reach `main`.
