# Immich API key for Mantel

Mantel is a read-only Immich client. Create a dedicated key instead of using an
administrator key or selecting every permission.

## Key to create

In Immich, open **Account Settings -> API Keys -> New API Key**.

- **Name:** `Mantel read-only`
- **Select exactly these permissions:**

```text
album.read
album.statistics
asset.read
asset.statistics
asset.view
asset.download
face.read
memory.read
person.read
```

Do not select the parent category checkboxes such as `asset`, `album`, or
`person`; those select write and delete permissions as well. Do not use
**Select all**.

Create the key from the Immich user whose library Mantel should display. An API
key has the data access of its owning Immich account; these permissions do not
make another user's private albums or assets visible.

After Mantel starts, enter the URL, generated key, and at least one allowed album
ID or full Immich album URL in the controller's **Settings -> Immich connection**
panel. For example, Mantel extracts `3dc23322-27fa-4039-9746-f7d3551f8d47`
from `http://immich.local:2283/albums/3dc23322-27fa-4039-9746-f7d3551f8d47`.
Mantel tests every required read operation against the allowed album before
saving it. The key is stored server-side in
`/data/immich-connection.json` with owner-only permissions and is never returned
to browsers. It is not meaningfully encryptable without a second external
secret, so protect the NAS volume and keep the controller on the trusted LAN.
Never put it in a player URL, browser storage, screenshots, or Git.

Immich permissions are capability-based and cannot scope an API key to one
album. Mantel therefore treats the configured album IDs as an application-level
allowlist: album discovery and playlist metadata searches are restricted to
those IDs, and person/random/memory modes are intersected with the same album
set. For hard isolation even if Mantel itself were compromised, create a
dedicated Immich account and share only the intended album with that account.

## Why each permission is required

| Permission | Mantel operation | Immich endpoint |
| --- | --- | --- |
| `album.read` | List albums and enumerate assets selected from albums | `GET /api/albums`, album-filtered `POST /api/search/metadata` |
| `album.statistics` | Show owned/shared album totals when testing an account | `GET /api/albums/statistics` |
| `asset.read` | Enumerate and filter image metadata for playlists | `POST /api/search/metadata`, `POST /api/search/random` |
| `asset.statistics` | Show account-wide photo and video totals after connection | `GET /api/assets/statistics` |
| `asset.view` | Fetch generated thumbnails and previews through Mantel's cache | `GET /api/assets/{id}/thumbnail` |
| `asset.download` | Follow Immich full-size redirects when a presentation requests original-quality media | `GET /api/assets/{id}/original` |
| `face.read` | Read face boxes for face-centering and people/age overlays | `GET /api/faces?id={assetId}` |
| `memory.read` | Read Immich's on-this-day memories | `GET /api/memories` |
| `person.read` | List recognized people and fetch person thumbnails | `GET /api/people`, `GET /api/people/{id}/thumbnail` |

`GET /api/server/ping`, used by the smoke test, is a public Immich endpoint and
does not require `server.about` or another server permission.

## Full-size mode

The recommended Mantel setting for this installation is **Preview**. Immich is
configured to generate 4K previews, so this provides the television's native
resolution while keeping the API key read-only and avoiding browser-incompatible
RAW originals.

Immich's full-size thumbnail request can redirect to the original asset when no
generated full-size derivative applies. That redirect requires `asset.download`.
Mantel includes it in the normal read-only key so displays can switch between
**Preview** and **Full size** from the controller without replacing the key.

## Permissions not required

Mantel currently does not need any of the following:

- `person.statistics`
- any `create`, `update`, `delete`, `upload`, `share`, `copy`, `derive`, or
  `edit` permission
- `activity.*`, `apiKey.*`, `job.*`, `queue.*`, `systemConfig.*`,
  `systemMetadata.*`, `user.*`, or any administrator permission

Future read-only sources can remain narrow:

| Possible feature | Additional permission |
| --- | --- |
| Smart/CLIP search or scene mode | none; already covered by `asset.read` |
| Video playback of Immich's encoded stream | none; already covered by `asset.view` |
| Tags as a selectable source | `tag.read` |
| Multiple Immich accounts | no extra permission; add a separate nine-permission key only for each owner-specific library/face catalogue you actually use |
| Mark current photo as favorite | `asset.update` -- intentionally not planned for the read-only key |

If a future feature needs a write permission, create a separate opt-in key for
that feature instead of expanding the normal Mantel key silently.

## Verify the key

The normal verification is the controller's **Test and save** action. Developers
can alternatively put `IMMICH_URL` and `IMMICH_API_KEY` in a local `.env`, then run:

```sh
npm run smoke
```

The smoke check exercises server connectivity, each allowed album, people,
memories, account statistics, album-filtered asset search, and generated image
viewing. A `401`
means the key or URL is invalid. A `403` normally means the corresponding
permission was not selected or the key's Immich account cannot access that
resource.
