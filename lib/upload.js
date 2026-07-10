import http from 'k6/http';
import { check } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// Client-side timing for each leg of the real resumable upload.
export const uploadApiMs = new Trend('upload_api_ms');      // POST /upload
export const sessionInitMs = new Trend('session_init_ms');  // POST signed init URL
export const bytesPutMs = new Trend('bytes_put_ms');        // PUT bytes to session
export const e2eClientMs = new Trend('e2e_client_ms');      // sum of the three legs

export const uploadFail = new Rate('upload_fail');          // any leg failed
export const pipelineStarted = new Counter('pipeline_started'); // PUT succeeded -> finalize will fire
export const rateLimited = new Counter('rate_limited');     // 429 on /upload
export const idempotent = new Counter('idempotent_replays');// 409 on /upload
export const sigMismatch = new Counter('gcs_signature_mismatch'); // 403 on signed URL

const CONTENT_TYPE = 'video/mp4'; // must be consistent across all three legs (it is signed)

// Performs the full 3-step resumable upload that the real client does:
//   1) POST {target}/upload                -> {video_id, upload_url}
//   2) POST upload_url (x-goog-resumable)  -> Location: session_uri
//   3) PUT  session_uri (the bytes)        -> GCS fires OBJECT_FINALIZE
// Returns { videoId, ok } and logs a VIDEOID line on success for the recorder.
export function resumableUpload(targetUrl, token, seedBytes, seedSize) {
  const started = Date.now();

  // ---- leg 1: create the upload + get signed init URL ----
  const createRes = http.post(`${targetUrl}/upload`, JSON.stringify({
    file_name: `loadtest_${__VU}_${__ITER}_${Date.now()}.mp4`,
    content_type: CONTENT_TYPE,
    file_size_bytes: seedSize,
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Request-ID': uuidv4(),
      'X-Client-Region': 'asia-south1',
    },
    tags: { leg: 'upload_api' },
  });
  uploadApiMs.add(createRes.timings.duration);

  if (createRes.status === 429) { rateLimited.add(1); uploadFail.add(1); return { ok: false }; }
  if (createRes.status === 409) { idempotent.add(1); uploadFail.add(1); return { ok: false }; }
  if (createRes.status !== 201) {
    check(createRes, { 'leg1 /upload == 201': false });
    uploadFail.add(1);
    return { ok: false };
  }

  let body;
  try { body = createRes.json(); } catch (e) { uploadFail.add(1); return { ok: false }; }
  const videoId = body.video_id;
  const uploadUrl = body.upload_url;
  if (!videoId || !uploadUrl) { uploadFail.add(1); return { ok: false }; }

  // ---- leg 2: initiate the resumable session (headers MUST match the signature) ----
  const initRes = http.post(uploadUrl, null, {
    headers: {
      'x-goog-resumable': 'start',
      'Content-Type': CONTENT_TYPE,
      // Content-Length: 0 is sent automatically for an empty body.
    },
    tags: { leg: 'session_init' },
  });
  sessionInitMs.add(initRes.timings.duration);

  if (initRes.status === 403) { sigMismatch.add(1); uploadFail.add(1); return { ok: false, videoId }; }
  const sessionUri = initRes.headers['Location'] || initRes.headers['location'];
  if (!sessionUri || (initRes.status !== 201 && initRes.status !== 200)) {
    check(initRes, { 'leg2 session init ok': false });
    uploadFail.add(1);
    return { ok: false, videoId };
  }

  // ---- leg 3: upload the bytes -> triggers the pipeline ----
  const putRes = http.put(sessionUri, seedBytes, {
    headers: { 'Content-Type': CONTENT_TYPE },
    tags: { leg: 'bytes_put' },
  });
  bytesPutMs.add(putRes.timings.duration);

  const putOk = putRes.status === 200 || putRes.status === 201;
  check(putRes, { 'leg3 bytes uploaded': () => putOk });
  if (!putOk) { uploadFail.add(1); return { ok: false, videoId }; }

  uploadFail.add(0);
  pipelineStarted.add(1);
  e2eClientMs.add(Date.now() - started);

  // Recorder line: scripts/run.sh extracts these into out/videos-<run>.csv
  console.log(`VIDEOID ${videoId} ${Date.now()}`);
  return { ok: true, videoId };
}
