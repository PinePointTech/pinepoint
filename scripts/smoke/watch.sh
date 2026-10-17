#!/usr/bin/env bash
# Regression watch: runs the smoke check every INTERVAL seconds (default 300)
# until UNTIL (epoch seconds, default: run forever). Exits 3 as soon as a check
# that passed in an earlier run fails, printing the failing lines, so a caller
# can report it and restart the watch. State lives in STATE_DIR.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
INTERVAL="${INTERVAL:-300}"
UNTIL="${UNTIL:-0}"
STATE_DIR="${STATE_DIR:-${TMPDIR:-/tmp}/pinepoint-smoke}"
mkdir -p "$STATE_DIR"
touch "$STATE_DIR/passed.txt"
export NODE_USE_ENV_PROXY="${NODE_USE_ENV_PROXY:-1}" NODE_NO_WARNINGS=1

while :; do
  out="$(node "$DIR/run.mjs" 2>&1)"
  printf '%s\n' "$out" > "$STATE_DIR/last.txt"
  printf '%s\n' "$out" >> "$STATE_DIR/history.log"
  # Check names are the text between the group column and the two-space detail gap.
  names() { sed -E 's/^(PASS|FAIL)  [a-z]+ +//; s/  .*$//'; }
  regressed=""
  while IFS= read -r line; do
    name="$(printf '%s\n' "$line" | names)"
    grep -qxF "$name" "$STATE_DIR/passed.txt" && regressed+="$line"$'\n'
  done < <(printf '%s\n' "$out" | grep '^FAIL ')
  printf '%s\n' "$out" | grep '^PASS ' | names >> "$STATE_DIR/passed.txt"
  sort -u -o "$STATE_DIR/passed.txt" "$STATE_DIR/passed.txt"
  if [ -n "$regressed" ]; then
    echo "REGRESSION $(date -u +%FT%TZ)"
    printf '%s' "$regressed"
    # Forget the regressed checks so a restarted watch reports them again only after they recover.
    while IFS= read -r line; do
      [ -n "$line" ] || continue
      name="$(printf '%s\n' "$line" | names)"
      grep -vxF "$name" "$STATE_DIR/passed.txt" > "$STATE_DIR/passed.tmp"; mv "$STATE_DIR/passed.tmp" "$STATE_DIR/passed.txt"
    done <<< "$regressed"
    exit 3
  fi
  echo "$(date -u +%FT%TZ) $(printf '%s\n' "$out" | tail -1)"
  now="$(date +%s)"
  if [ "$UNTIL" -gt 0 ] && [ $((now + INTERVAL)) -gt "$UNTIL" ]; then exit 0; fi
  sleep "$INTERVAL"
done
