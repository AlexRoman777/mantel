# Self-hosted container registry

Research refreshed 2026-09-01.

## Recommendation for this home network

Use **zot** as the first private image registry. It is an OCI-native registry
published as one multi-architecture container, runs unprivileged, includes a web
interface and search in its full image, and supports authentication, garbage
collection, deduplication, integrity checking, scanning, and image signing.
That is a better fit for one Ugreen NAS and a few household computers than a
large multi-service registry platform.

Keep it separate from Mantel, for example:

```text
/volume1/docker/zot/
  config/
  registry/
```

Use a stable LAN name such as `registry.home.arpa`, TLS, authentication, and a
non-conflicting port. Do not expose it directly to the internet. Back up both
its configuration and registry content.

The planned image workflow is:

```sh
docker login registry.home.arpa
docker tag mantel:v0.0.33 registry.home.arpa/mantel/mantel:v0.0.33
docker push registry.home.arpa/mantel/mantel:v0.0.33
docker pull registry.home.arpa/mantel/mantel:v0.0.33
```

After that, Mantel's NAS Compose can use the registry tag and `pull_policy` can
change from `never` to an intentional pull policy. Keep immutable version tags;
do not deploy only `latest`, because rollback and verification become ambiguous.

## TLS matters even on the LAN

Docker assumes private registries are secure. A plain-HTTP registry requires an
`insecure-registries` exception on every Docker daemon. That weakens the setup
and is unsuitable with basic authentication because credentials can be exposed.
Prefer one of:

1. a certificate for a real internal DNS name from a trusted private CA, with
   that CA installed on the Mac, NAS, and other Docker hosts; or
2. TLS termination through an existing trusted reverse proxy.

Test the certificate from every machine that will push or pull before changing
Mantel deployment. CasaOS normally does not need registry access because it only
runs the browser player.

## Alternatives

| Registry | Use it when | Trade-off |
| --- | --- | --- |
| zot | One NAS, few users, web UI, efficient single service | Best default here |
| CNCF Distribution `registry:3` | You want the smallest official storage/API service | No useful management UI by itself; TLS/auth need configuration |
| Harbor | You need projects, RBAC, robot accounts, audit logs, replication, signing policy, and scheduled Trivy scanning | Much heavier multi-service installation and upgrade surface |

Harbor is excellent if this grows into a shared infrastructure platform. For
Mantel, PhotoPilot, Football, and a few private household images, zot should be
enough initially.

## Before deploying a registry

- choose the LAN DNS name and TLS issuer
- decide who can push and who is pull-only
- place registry blobs on backed-up NAS storage
- define retention/garbage-collection policy
- verify the NAS container runtime trusts the certificate
- push and pull a harmless test image from the laptop and NAS
- only then change an application Compose file away from imported tar archives

Do not remove the existing `mantel.tar.gz` release path immediately. Keep one
tested archive as a recovery method until registry push, NAS pull, restart, and
rollback have all been proven.

## Primary references

- [zot project and feature overview](https://zotregistry.dev/)
- [zot administration and published container images](https://zotregistry.dev/v2.1.11/admin-guide/admin-getting-started/)
- [CNCF Distribution deployment and TLS/authentication](https://distribution.github.io/distribution/about/deploying/)
- [Docker daemon private-registry trust](https://docs.docker.com/reference/cli/dockerd/#insecure-registries)
- [Harbor features and installation](https://github.com/goharbor/harbor#readme)
