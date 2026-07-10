# Apex Load Testing

k6-based load tests for Apex microservices.

## Prerequisites

```bash
brew install k6
```

## Usage

```bash
export TARGET=https://upload-api-xxxxx-uc.a.run.app
export TOKEN=$(gcloud auth print-identity-token)

# Run upload service scenarios
just upload-ramp TARGET=$TARGET TOKEN=$TOKEN
just upload-spike TARGET=$TARGET TOKEN=$TOKEN
just upload-sustained TARGET=$TARGET TOKEN=$TOKEN

# Or run all three sequentially
just upload-all TARGET=$TARGET TOKEN=$TOKEN
```

## Full pipeline load tests (real uploads)

The `upload-*` scenarios above only hit `POST /upload` and stop — they never upload bytes,
so they do **not** trigger transcoding. To load-test the whole pipeline (ingestion → probe →
transcode → fan-out → publish) the test must complete the real 3-step resumable upload, which
fires the GCS `OBJECT_FINALIZE` event. See `docs/PIPELINE_LOAD_TEST_PLAN.md` for the design.

```bash
# 1. Build the small seed video once (5s 720p, ffmpeg required)
just seed

# 2. Fire a small batch of real uploads (exactly N videos)
export TARGET=https://upload-api-28030170607.asia-south1.run.app
just pipeline-batch $TARGET 10 5     # 10 uploads, 5 concurrent VUs

# 3. Or a spike
just pipeline-spike $TARGET 10 30s   # baseline -> 10 VUs hold 30s -> drain

# 4. Clean up afterwards (free-tier budget is tight)
just cleanup out/videos-batch-*.csv
```

Each run writes `out/videos-<scenario>-<ts>.csv` (`video_id,client_ms`). Feed those video_ids
to the **apex-spanner / apex-pubsub** MCP tools to measure end-to-end latency, queue depth,
autoscaling, and failures (the observation half of the harness).

Auth in the test env accepts any `Authorization: Bearer <anything>` (TOKEN defaults to `apex`).

## Upload-service million-request path matrix

Use this when the goal is to load `prj-apex-upload-service` itself, not the downstream
transcode pipeline. It only calls `POST /upload`, so it creates upload records and signed URLs
but does not upload file bytes to GCS.

```bash
export TARGET=https://upload-api-28030170607.asia-south1.run.app

# First prove the shape with about 1,000 requests.
just upload-million-smoke $TARGET

# Then run roughly 1M requests across success and failure paths.
just upload-million $TARGET 1000000 70000 1
```

The default suite spreads requests across success, missing/invalid auth, missing client region,
invalid request ID, invalid JSON, unknown JSON fields, invalid content type, invalid filename,
file too large, idempotency replay, idempotency mismatch, and concurrent quota paths.
`USER_POOL=70000` keeps the success path from accidentally becoming an hourly-quota test.
`FILE_SIZE_BYTES=1` keeps normal success records from turning the storage-quota check into the
dominant limit.

Some upload-service branches require prepared backend state rather than just request shape:
hourly quota is masked by the lower concurrent-upload limit in this create-only flow, storage
quota needs pre-seeded per-user storage, request-ID-consumed needs an existing non-UPLOADING
video for the same `(user_id, request_id)`, and signed-URL/service-unavailable paths require
infrastructure faults.

## Adding a new service

1. Create `services/<name>/scenarios/`
2. Write scenario files importing from `lib/`
3. Add `Justfile` targets
