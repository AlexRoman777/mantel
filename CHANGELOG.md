# Changelog

Mantel follows [semantic versioning](https://semver.org). A change that breaks an existing
installation or its saved configuration raises the first number.

## Unreleased

- Built on SvelteKit 3, which fixes the remaining framework security advisories.
- Deletes from another site are now refused. Behind an HTTPS proxy, the proxy must send
  `X-Forwarded-Proto` or `ORIGIN` must be set; see the installation guide.

## 1.0.0 (14 November 2026)

The first public release.

- A self-hosted photo frame for Immich: one container that serves the screens and the
  controller.
- Presentation modes: full screen, gallery framing, mosaic, instant table and world map.
- Read-only access to Immich by design. No account, no telemetry, no cloud service.
- Images for `linux/amd64` and `linux/arm64` at `ghcr.io/alexroman777/mantel`.
- Every change is checked for secrets, misconfiguration, vulnerable dependencies and insecure
  code patterns before it can reach `main`.
