#!/usr/bin/env bash
# Delete load-test artifacts to avoid spending free-tier credit on stored objects.
# Deletes all loadtest_* uploads from the upload bucket. Optionally deletes derived
# artifacts (segments/thumbnails/captions/manifests) by video_id from a run CSV.
#
# Usage:
#   scripts/cleanup.sh                       # purge loadtest_* from the upload bucket
#   scripts/cleanup.sh out/videos-batch-*.csv  # also purge derived buckets by video_id
#
# Spanner rows are NOT deleted here — do that via the apex-spanner MCP / a DML statement
# (videos, transcode_jobs, video_pipeline_stages, outbox, lifecycle_events by video_id).
set -euo pipefail

UPLOAD_BUCKET="${UPLOAD_BUCKET:-prj-apex-upload-bucket}"
# Space-separated derived buckets, override as needed once their names are confirmed.
DERIVED_BUCKETS="${DERIVED_BUCKETS:-}"

echo "purging loadtest_* uploads from gs://$UPLOAD_BUCKET ..."
gsutil -m rm "gs://$UPLOAD_BUCKET/**/loadtest_*" 2>/dev/null || echo "  (nothing to delete)"

for CSV in "$@"; do
  [[ -f "$CSV" ]] || continue
  echo "purging derived artifacts for video_ids in $CSV ..."
  while IFS=, read -r VID _; do
    [[ -z "$VID" ]] && continue
    for B in $DERIVED_BUCKETS; do
      gsutil -m rm -r "gs://$B/$VID" 2>/dev/null || true
    done
  done < "$CSV"
done

echo "done. Remember to clean Spanner rows by video_id if needed."
