#!/usr/bin/env bash
# Generate a small, short seed video for pipeline load testing.
# 5s, 720p, ~few hundred KB. Has an audio track so the transcription stage also fans out.
set -euo pipefail

OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/out"
OUT="$OUT_DIR/seed_720p.mp4"
mkdir -p "$OUT_DIR"

ffmpeg -y \
  -f lavfi -i "testsrc=duration=5:size=1280x720:rate=30" \
  -f lavfi -i "sine=frequency=440:duration=5" \
  -c:v libx264 -pix_fmt yuv420p -preset veryfast \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  "$OUT"

SIZE=$(stat -f%z "$OUT" 2>/dev/null || stat -c%s "$OUT")
echo "seed written: $OUT (${SIZE} bytes)"
echo "set SEED_SIZE=${SIZE} when running k6 scenarios"
