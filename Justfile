TARGET := ""

upload-ramp TARGET:
  k6 run services/upload/scenarios/ramp.js -e TARGET={{TARGET}}

upload-spike TARGET:
  k6 run services/upload/scenarios/spike.js -e TARGET={{TARGET}}

upload-sustained TARGET:
  k6 run services/upload/scenarios/sustained.js -e TARGET={{TARGET}}

upload-iterations TARGET VUS ITERATIONS:
  k6 run services/upload/scenarios/iterations.js -e TARGET={{TARGET}} -e VUS={{VUS}} -e ITERATIONS={{ITERATIONS}}

upload-all TARGET:
  k6 run services/upload/scenarios/ramp.js -e TARGET={{TARGET}}
  k6 run services/upload/scenarios/spike.js -e TARGET={{TARGET}}
  k6 run services/upload/scenarios/sustained.js -e TARGET={{TARGET}}

# Upload-service path matrix. This only calls POST /upload; it does not upload bytes.
# Defaults to about 1,000,000 requests across success and failure paths.
upload-million TARGET TOTAL="1000000" USER_POOL="70000" FILE_SIZE_BYTES="1" MAX_DURATION="90m":
  k6 run services/upload/scenarios/million.js -e TARGET={{TARGET}} -e TOTAL={{TOTAL}} -e USER_POOL={{USER_POOL}} -e FILE_SIZE_BYTES={{FILE_SIZE_BYTES}} -e MAX_DURATION={{MAX_DURATION}}

# Small dry run for the million-request path matrix.
upload-million-smoke TARGET:
  k6 run services/upload/scenarios/million.js -e TARGET={{TARGET}} -e TOTAL=1000 -e USER_POOL=100 -e FILE_SIZE_BYTES=1 -e MAX_DURATION=5m -e SUCCESS_VUS=10 -e MISSING_AUTH_VUS=5 -e INVALID_AUTH_VUS=5 -e INVALID_REQUEST_ID_VUS=5 -e MISSING_CLIENT_REGION_VUS=5 -e INVALID_JSON_VUS=5 -e UNKNOWN_FIELD_VUS=5 -e INVALID_CONTENT_TYPE_VUS=5 -e INVALID_FILENAME_VUS=5 -e FILE_TOO_LARGE_VUS=5 -e IDEMPOTENCY_REPLAY_VUS=5 -e IDEMPOTENCY_MISMATCH_VUS=5 -e QUOTA_CONCURRENT_VUS=5

# ---- full pipeline (real 3-step uploads that trigger transcoding) ----

# Generate the small seed video (run once).
seed:
  ./scripts/make-seed.sh

# Batch/burst: exactly BATCH_SIZE real uploads, then capture video_ids.
# Example: just pipeline-batch https://upload-api-xxx.run.app 10 5
pipeline-batch TARGET BATCH_SIZE="10" VUS="5":
  TARGET={{TARGET}} ./scripts/run.sh batch -e BATCH_SIZE={{BATCH_SIZE}} -e VUS={{VUS}}

# Spike: baseline -> sharp jump -> hold -> drain. Mind the budget on SPIKE_VUS.
# Example: just pipeline-spike https://upload-api-xxx.run.app 10 30s
pipeline-spike TARGET SPIKE_VUS="10" HOLD="30s":
  TARGET={{TARGET}} ./scripts/run.sh spike -e SPIKE_VUS={{SPIKE_VUS}} -e HOLD={{HOLD}}

# Delete load-test artifacts. Pass run CSVs to also purge derived buckets by video_id.
cleanup +CSVS="":
  ./scripts/cleanup.sh {{CSVS}}
