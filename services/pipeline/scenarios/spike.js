import { target } from '../../../lib/config.js';
import { resumableUpload } from '../../../lib/upload.js';

// Spike: low baseline -> sharp jump -> hold -> drop. Each VU does real uploads back to
// back, so concurrent VUs ~= concurrent in-flight uploads driving the pipeline.
// NOTE: this can create a lot of transcode jobs fast. Keep SPIKE_VUS modest on a tight
// budget; total uploads is roughly (VUs x iterations-per-VU over the hold window).
const BASELINE = parseInt(__ENV.BASELINE) || 2;
const SPIKE_VUS = parseInt(__ENV.SPIKE_VUS) || 10;
const HOLD = __ENV.HOLD || '30s';
const TOKEN = __ENV.TOKEN || 'apex';

const SEED = open(__ENV.SEED || '../../../out/seed_720p.mp4', 'b');
const SEED_SIZE = parseInt(__ENV.SEED_SIZE) || SEED.byteLength;

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: BASELINE,
      stages: [
        { duration: '30s', target: BASELINE },   // warm baseline
        { duration: '10s', target: SPIKE_VUS },   // sharp spike
        { duration: HOLD, target: SPIKE_VUS },     // hold at peak
        { duration: '20s', target: BASELINE },     // recover
        { duration: '10s', target: 0 },            // drain
      ],
    },
  },
  thresholds: {
    upload_fail: ['rate<0.10'],
  },
};

const URL = target();

export default function () {
  resumableUpload(URL, TOKEN, SEED, SEED_SIZE);
}
