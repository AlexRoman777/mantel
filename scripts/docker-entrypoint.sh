#!/bin/sh
set -eu

data_dir=${DATA_DIR:-/data}
run_uid=${MANTEL_PUID:-10001}
run_gid=${MANTEL_PGID:-10001}

for numeric_id in "$run_uid" "$run_gid"; do
	case "$numeric_id" in
		''|*[!0-9]*|0)
			echo "MANTEL_PUID and MANTEL_PGID must be non-zero numeric IDs." >&2
			exit 64
			;;
	esac
done

# Map imagery delivered at /map-import is adopted into the data volume by the
# server itself (map-import.mjs), in the background and as the runtime user.
# Nothing of the sort belongs here: the container drops every capability, so
# root has no DAC_OVERRIDE and cannot write into a volume owned by that user.

if [ "$(id -u)" = "0" ]; then
	# NAS Docker hosts can create a missing bind-mount directory as root. Change only the
	# mount point itself so startup time never grows with the image cache, and never fail
	# on a volume shared with other applications.
	chown "$run_uid:$run_gid" "$data_dir" || echo "mantel: could not take ownership of $data_dir; continuing" >&2
	exec su-exec "$run_uid:$run_gid" "$@"
fi

exec "$@"
