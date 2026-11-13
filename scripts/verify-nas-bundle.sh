#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
bundle="$root/mantel"

version=$(tr -d '\r\n' < "$bundle/VERSION")
case "$version" in
  ''|*[!0-9.]* )
    echo "Invalid Mantel VERSION: $version" >&2
    exit 1
    ;;
esac

files=$(find "$bundle" -maxdepth 1 -type f -exec basename {} \; | LC_ALL=C sort)
expected=$(printf '%s\n' README.txt VERSION compose.yaml mantel.tar.gz | LC_ALL=C sort)
if [ "$files" != "$expected" ]; then
  echo "Mantel bundle must contain exactly README.txt, VERSION, compose.yaml, and mantel.tar.gz." >&2
  printf '%s\n' "$files" >&2
  exit 1
fi

gzip -t "$bundle/mantel.tar.gz"
docker compose -f "$bundle/compose.yaml" config --quiet

expected_tag="mantel:v$version"
tar -xOzf "$bundle/mantel.tar.gz" manifest.json \
  | grep -qF "\"$expected_tag\""
grep -qF "image: $expected_tag" "$bundle/compose.yaml"

echo "Mantel NAS bundle verified: $expected_tag"
ls -lh "$bundle/mantel.tar.gz"
shasum -a 256 "$bundle/mantel.tar.gz" "$bundle/compose.yaml" "$bundle/VERSION"
