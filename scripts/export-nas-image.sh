#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

if ! docker buildx version >/dev/null 2>&1; then
  echo "Docker Buildx is required." >&2
  exit 1
fi

version=$(sed -n 's/^[[:space:]]*"version": "\([^"]*\)",$/\1/p' package.json)
revision=${MANTEL_IMAGE_TAG:-v$version}
case "$revision" in
  *[!A-Za-z0-9_.-]*|'')
    echo "MANTEL_IMAGE_TAG contains unsupported characters." >&2
    exit 1
    ;;
esac

platform=${MANTEL_IMAGE_PLATFORM:-linux/amd64}

# The map layout's earth imagery is generated, not committed: build it once.
if [ ! -f "$ROOT/static/map/textures/night/earth-8k.jpg" ] || [ ! -f "$ROOT/static/map/textures/satellite-07/earth-8k.jpg" ]; then
  echo "Building map textures (first time only; downloads ≈430 MB of public-domain imagery)…"
  node "$ROOT/scripts/build-map-textures.mjs"
fi
destination="$ROOT/mantel"
work=$(mktemp -d "${TMPDIR:-/tmp}/mantel-nas.XXXXXX")
trap 'rm -rf "$work"' EXIT HUP INT TERM

archive_name="mantel.tar"
docker buildx build \
  --platform "$platform" \
  --file Dockerfile \
  --tag "mantel:$revision" \
  --tag "mantel:latest" \
  --build-arg "MANTEL_VERSION=$revision" \
  --output "type=docker,dest=$work/$archive_name" \
  .
gzip -9 "$work/$archive_name"

printf '%s\n' "$version" >"$work/VERSION"

# The copied NAS directory is intentionally self-contained and minimal.
# compose.yaml is tracked in the repository; everything else here is generated.
mkdir -p "$destination"
if [ ! -f "$destination/compose.yaml" ]; then
  printf 'export-nas-image: %s is missing from the checkout\n' "mantel/compose.yaml" >&2
  exit 1
fi
find "$destination" -maxdepth 1 -type f ! -name 'compose.yaml' -delete
cp "$work/mantel.tar.gz" "$work/VERSION" "$destination/"

gzip -t "$destination/mantel.tar.gz"
manifest_pattern='"RepoTags":["mantel:'"$revision"'"'
tar -xOzf "$destination/mantel.tar.gz" manifest.json \
  | tr ',' '\n' | grep -qF "$manifest_pattern"

# Map imagery lives in the NAS data volume, which survives replacing the bundle,
# so it is prepared in a sibling directory and never placed under mantel/. It is
# only refreshed when the built imagery actually changed, so a normal release
# does not ask for a 2.5 GB copy again.
# Staged as the data volume itself, so its contents drop straight onto the NAS:
#   cp -a mantel-data/map /volume1/docker/mantel-data/
# Point MANTEL_MAP_DIR at a mounted volume to write there directly.
map_root=${MANTEL_MAP_DIR:-"$ROOT/mantel-data"}
map_destination="$map_root/map"
map_state="unchanged"
map_signature=""
for set in sentinel textures/detail textures/relief; do
  if [ -d "$ROOT/static/map/$set" ]; then
    map_signature="$map_signature$(find "$ROOT/static/map/$set" -name '*.webp' -exec stat -f '%N %z %m' {} \; 2>/dev/null | LC_ALL=C sort | shasum | cut -d' ' -f1)"
  fi
done
if [ -n "$map_signature" ]; then
  previous=$(cat "$map_destination/.signature" 2>/dev/null || echo "")
  if [ "$map_signature" != "$previous" ]; then
    map_state="changed"
    mkdir -p "$map_destination/textures"
    for set in sentinel textures/detail textures/relief; do
      if [ -d "$ROOT/static/map/$set" ]; then
        mkdir -p "$map_destination/$set"
        rsync -a --delete "$ROOT/static/map/$set/" "$map_destination/$set/"
      fi
    done
    printf '%s\n' \
      "Mantel map imagery." \
      "" \
      "Copy it into the NAS data volume, which is never deleted when the bundle" \
      "is replaced:" \
      "    cp -a map /volume1/docker/mantel-data/" \
      "" \
      "The container reads it from /data/map. Copy it again only when a build" \
      "says the imagery changed; ordinary releases do not touch it." \
      "" \
      "  sentinel/         Sentinel-2 cloudless close-ups (EOX, modified Copernicus Sentinel data)" \
      "  textures/detail/  NASA Blue Marble Next Generation, full resolution" \
      "  textures/relief/  Natural Earth shaded relief" \
      "" \
      "Rebuild or extend with: node scripts/build-map-tiles.mjs and node scripts/build-map-textures.mjs" \
      >"$map_destination/README.txt"
    printf '%s' "$map_signature" >"$map_destination/.signature"
  fi
fi

printf '%s\n' \
  "Mantel $version - NAS handoff" \
  "" \
  "Deploy:" \
  "    docker load --input mantel.tar.gz" \
  "    docker compose -f compose.yaml config --quiet" \
  "    docker compose -f compose.yaml up -d --wait --wait-timeout 90" \
  "Persistent state stays at /volume1/docker/mantel-data and is never replaced." \
  "" \
  "Map imagery is never part of this bundle. It lives in the data volume at" \
  "/volume1/docker/mantel-data/map and is left untouched by a release. When a" \
  "build reports changed imagery, copy it there by hand:" \
  "    cp -a map/sentinel map/textures /volume1/docker/mantel-data/map/" \
  "" \
  "Ports: player 3830, controller 3831." \
  >"$destination/README.txt"

# The bundle is the image and nothing else: imagery is copied to the NAS by hand,
# once, and lives in the data volume from then on.
rm -rf "$destination/map"

files=$(find "$destination" -maxdepth 1 -type f -exec basename {} \; | LC_ALL=C sort)
expected=$(printf '%s\n' README.txt VERSION compose.yaml mantel.tar.gz | LC_ALL=C sort)
if [ "$files" != "$expected" ]; then
  echo "Unexpected files in $destination:" >&2
  printf '%s\n' "$files" >&2
  exit 1
fi

echo "Created single-container Intel NAS bundle: $destination"
if [ -n "$map_signature" ]; then
  blocks=$(find "$map_destination" -name '*.webp' | wc -l | tr -d ' ')
  size=$(du -sh "$map_destination" | cut -f1)
  if [ "$map_state" = "changed" ]; then
    echo "Map imagery CHANGED: $blocks blocks, $size in $map_destination - copy it into /volume1/docker/mantel-data/"
  else
    echo "Map imagery unchanged ($blocks blocks, $size) - copy only $destination this time"
  fi
fi
