# Apex Pipeline Load Test — Plan

Status: **DRAFT for review** · Author: load-testing · Target project: `apex-494315`

## 1. Goal

Load-test the **full ingestion → transcode pipeline** under batched and spiky traffic, and
observe how the infrastructure reacts. Concretely we want to answer:

1. **Autoscaling response** — does KEDA scale transcode-workers on queue depth fast enough?
   Does the probe node pool scale? How big is the cold-start lag on a spike?
2. **Queue depth / backpressure** — do Pub/Sub subscriptions buffer gracefully or fall behind?
   What is the outbox-relay lag under write bursts?
3. **End-to-end latency** — time from `upload` to `READY` (and intermediate transitions)
   across a batch, at p50/p90/p99.
4. **Failures / DLQ / stalls** — DLQ messages, `FAILED` videos, stalled transcode jobs from
   spot preemption, error-classification behavior under stress.

## 2. Why the current test is not enough

Today's scenarios (`ramp/spike/sustained/iterations`) do **one HTTP call**:

```
POST /upload  →  201 {video_id, upload_url}     ← and then they STOP
```

They never PUT the video bytes. The pipeline is triggered **only** by the GCS
`OBJECT_FINALIZE` event (see `ingestion-service.md`), which fires after bytes land. So the
current suite tests the upload-service API surface (auth, quota, Redis, signed-URL gen) and
**nothing downstream**. To load-test the transcoder flow we must complete real uploads.

## 3. The real end-to-end upload flow (verified against upload-service source)

Per `internal/storage/storage.go`, the returned `upload_url` is a **V4-signed POST
initiation URL**, signed over a fixed header set. The client flow is three steps:

```
(1) POST {TARGET}/upload
    headers: Authorization: Bearer <token>, X-Request-ID: <uuid>,
             X-Client-Region: asia-south1, Content-Type: application/json
    body:    {"file_name","content_type","file_size_bytes"}
    → 201 {"video_id","upload_url","expires_at",...}

(2) POST <upload_url>            (initiate resumable session)
    headers (MUST match the signature exactly):
             Content-Length: 0
             x-goog-resumable: start
             Content-Type: <same content_type sent in step 1>
    body:    (empty)
    → 201, response header  Location: <session_uri>

(3) PUT <session_uri>           (upload the bytes)
    headers: Content-Type: <same content_type>
    body:    <seed video bytes>
    → 200/201  → GCS fires OBJECT_FINALIZE → pipeline starts
```

**Gotchas baked into the plan:**
- Step 2 headers must be replayed verbatim — any mismatch → `403 SignatureDoesNotMatch`.
- `content_type` must be consistent across steps 1–3 (it is part of the signature). The seed
  is an `.mp4`, so we send `video/mp4` for the pipeline suite (probe reads real bytes, so the
  declared type only needs to be internally consistent, not match a cycled list).
- `file_size_bytes` should equal the actual seed size — the upload-service validates declared
  size against tier limits and feeds the Spanner storage-quota aggregate.

## 4. Harness architecture

Two cooperating halves; k6 generates load, the MCP layer observes (k6 cannot read Spanner).

```
┌────────────────────────────┐         ┌─────────────────────────────────────┐
│ LOAD GENERATION (k6)        │         │ OBSERVATION (apex MCP servers + me)   │
│                             │         │                                       │
│ batch.js / spike.js         │  video  │ apex-spanner:  get_video_status,      │
│  step1 POST /upload         │  _ids   │   get_lifecycle_events,               │
│  step2 POST init session    ├────────▶│   get_pipeline_stages, get_stuck_…,   │
│  step3 PUT seed bytes       │ (json   │   get_stalled_transcode_jobs,         │
│                             │  out)   │   get_recent_failures                 │
│ metrics: upload/init/put    │         │ apex-pubsub:  get_subscription_stats, │
│   durations, 4xx/5xx, 403   │         │   get_oldest_unacked_age,             │
│ handleSummary → videos.json │         │   get_dlq_messages                    │
└────────────────────────────┘         │ apex-logs:    get_error_logs          │
                                        └─────────────────────────────────────┘
```

- **k6** owns request generation + client-side metrics, and writes the list of created
  `video_id`s (with `created_at`) to `out/videos-<run>.json` via `handleSummary`.
- **Observation** is driven from this session via the `apex-spanner` / `apex-pubsub` /
  `apex-logs` MCP tools, keyed off the captured `video_id`s. E2E latency = Spanner lifecycle
  timestamps (`UPLOADING → … → READY/FAILED`) minus the k6 upload time. This reuses the same
  data plane the investigator system reads; we are not building a new poller.

## 5. Seed video

Small/short/fast (per decision): one ~5 s 720p clip, a few hundred KB, generated locally so
we never commit a binary.

```bash
# scripts/make-seed.sh
ffmpeg -f lavfi -i testsrc=duration=5:size=1280x720:rate=30 \
       -f lavfi -i sine=frequency=440:duration=5 \
       -c:v libx264 -pix_fmt yuv420p -c:a aac -shortarg \
       out/seed_720p.mp4
```

- 720p source → probe selects a `[360p, 480p, 720p]` ladder = 3 transcode jobs/video — enough
  fan-out to exercise worker autoscaling without heavy per-encode cost.
- Has an audio track → transcription stage also fans out (exercises the non-required path).
- k6 loads it once per VU with `open('out/seed_720p.mp4','b')`.

## 6. Scenarios (the two the user asked for)

New service dir `services/pipeline/`. Reuse `lib/` thresholds where sensible.

| File | Shape | Purpose |
|------|-------|---------|
| `batch.js` | `per-vu-iterations` / shared-iterations in waves: N videos, settle, N videos | "Send requests in batches" — discrete bursts; measure how a fixed batch drains. |
| `spike.js` | `ramping-vus`: low baseline → sharp jump (e.g. 5→150 in 10s) → hold → drop | "Test spikes" — KEDA/node cold-start reaction and recovery. |

Both run the full 3-step flow. Parameterized via env: `BATCH_SIZE`, `WAVES`, `SETTLE`,
`SPIKE_VUS`, `HOLD`. Defaults tuned small for a first safe run.

**User model:** the current `user_<vu>_<iter>` token mints a brand-new user every iteration,
so per-user quota gates never engage. For the pipeline suite that's what we want (no 429s
masking pipeline load). We'll use a bounded pool (`USER_POOL`, default ~50) so traffic is
realistic but still clears quotas. A separate note covers a future quota-stress variant.

## 7. Metrics → signal mapping

| Signal (chosen) | Where measured | Specific metric |
|---|---|---|
| Autoscaling response | MCP during run | worker replica count vs `transcode.job.requested` backlog; time-to-scale after spike onset |
| Queue depth / backpressure | `apex-pubsub` | `get_subscription_stats` (num_undelivered), `get_oldest_unacked_age`; outbox `get_outbox_pending_count` |
| End-to-end latency | `apex-spanner` lifecycle | per-video `UPLOADING→READY` duration, p50/p90/p99 over the batch |
| Failures / DLQ / stalls | `apex-pubsub` + `apex-spanner` | `get_dlq_messages`, `get_recent_failures`, `get_stuck_videos`, `get_stalled_transcode_jobs` |
| Client-side (k6) | k6 metrics | `upload_api_ms`, `session_init_ms`, `bytes_put_ms` trends; `http_req_failed`; counters for 403/429/409 |

## 8. File layout & Justfile targets

```
prj-apex-load-testing/
  docs/PIPELINE_LOAD_TEST_PLAN.md      ← this file
  scripts/make-seed.sh                 ← generate seed video
  lib/upload.js                        ← NEW: resumableUpload() 3-step helper + metrics
  lib/recorder.js                      ← NEW: collect video_ids → handleSummary file
  services/pipeline/scenarios/batch.js ← NEW
  services/pipeline/scenarios/spike.js ← NEW
  out/                                 ← seed + videos-<run>.json (gitignored)
```

New Justfile targets:
```
seed:                         scripts/make-seed.sh
pipeline-batch TARGET TOKEN:  k6 run services/pipeline/scenarios/batch.js -e TARGET=.. -e TOKEN=..
pipeline-spike TARGET TOKEN:  k6 run services/pipeline/scenarios/spike.js  -e TARGET=.. -e TOKEN=..
```

## 9. Observation playbook (run alongside k6)

1. Before run: snapshot baseline — subscription stats, worker replicas, outbox pending.
2. During run: poll `get_subscription_stats` + `get_oldest_unacked_age` for the transcode and
   probe subscriptions every ~30–60 s; watch backlog rise and drain.
3. After drain: for each `video_id` in `out/videos-*.json`, pull `get_lifecycle_events` →
   compute E2E latency distribution; run `get_recent_failures` / `get_dlq_messages` /
   `get_stalled_transcode_jobs` for the failure picture.
4. Summarize into a run report (latency percentiles, peak backlog, scale-up lag, failures).

## 10. Cost & safety guardrails

Real uploads = real transcode jobs on spot nodes + real GCS storage. So:
- Start tiny (`BATCH_SIZE=10`) to validate the 3-step flow end-to-end before any spike.
- Each run tags objects (`file_name = loadtest_<run>_<vu>_<iter>.mp4`) so cleanup is scriptable.
- Add `scripts/cleanup.sh` (gsutil) to delete load-test objects + a note on whether to also
  purge Spanner rows (TBD — depends on whether a TTL/janitor already exists).
- Confirm we are pointed at a **non-prod** project/bucket before any spike-scale run.

## 11. Prerequisites / open questions (need from you before building step 4+)

1. **TARGET** — deployed upload-service URL (Cloud Run / GKE ingress).
2. **TOKEN** — does upload-service auth accept the existing `Bearer user_<vu>_<iter>` style in
   the test env, or do we need a real signed JWT? (Current suite implies the former works.)
3. **MCP scope** — do `apex-spanner` / `apex-pubsub` MCP servers point at `apex-494315`
   (the same env we'll load)? Needed for the observation half.
4. **Cleanup policy** — OK to delete load-test GCS objects + Spanner rows after each run?
5. **Spike ceiling** — max VUs / batch size you're comfortable spending transcode $ on.

## 12. Build phases (after this plan is approved)

- **P0** — `scripts/make-seed.sh` + `lib/upload.js` (3-step helper) + a 10-video `batch.js`;
  validate one real video reaches `READY` (smoke).
- **P1** — `recorder.js` (videos.json) + full `batch.js` waves + Justfile + README.
- **P2** — `spike.js` + observation playbook dry-run via MCP.
- **P3** — cleanup script + first real spike run + run report.
```
