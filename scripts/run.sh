#!/usr/bin/env bash
# Run a pipeline scenario and capture the created video_ids for the observation step.
# Usage: scripts/run.sh <batch|spike> [extra k6 -e flags...]
#   TARGET and TOKEN are read from env (TOKEN defaults to "apex" inside the scenarios).
set -euo pipefail

SCEN="${1:?usage: run.sh <batch|spike> [k6 flags...]}"; shift || true
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$ROOT/out"
LOG="$ROOT/out/k6-$SCEN-$RUN.log"
CSV="$ROOT/out/videos-$SCEN-$RUN.csv"

if [[ ! -f "$ROOT/out/seed_720p.mp4" ]]; then
  echo "seed missing — run: just seed" >&2; exit 1
fi
: "${TARGET:?set TARGET to the upload-service URL}"

echo "run=$RUN scenario=$SCEN target=$TARGET"
k6 run "$ROOT/services/pipeline/scenarios/$SCEN.js" \
  -e TARGET="$TARGET" ${TOKEN:+-e TOKEN="$TOKEN"} "$@" 2>&1 | tee "$LOG"

# k6 console.log lines look like:  INFO[0005] VIDEOID <id> <client_ms>  source=console
grep -oE 'VIDEOID [^ ]+ [0-9]+' "$LOG" | awk '{print $2","$3}' > "$CSV" || true
echo "captured $(wc -l < "$CSV" | tr -d ' ') video_ids -> $CSV"
