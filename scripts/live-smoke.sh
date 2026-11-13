#!/bin/sh
set -eu

host=${1:-mantel.local}
display=${2:-auto}
player_port=${MANTEL_PLAYER_PORT:-3830}
controller_port=${MANTEL_CONTROLLER_PORT:-3831}
player="http://$host:$player_port"
controller="http://$host:$controller_port"

get() {
  curl -sS --fail --connect-timeout 3 --max-time 15 "$1"
}

get "$player/healthz" >/dev/null
get "$controller/settings" >/dev/null
get "$player/display/$display" >/dev/null

clients=$(get "$controller/api/control/clients")
if command -v jq >/dev/null 2>&1; then
  online=$(printf '%s' "$clients" | jq 'length')
  controllable=$(printf '%s' "$clients" | jq '[.[] | select(.controlAvailable == true)] | length')
  echo "Mantel live smoke passed: $online online, $controllable controllable"
else
  echo "Mantel live smoke passed; install jq to summarize connected players."
fi
