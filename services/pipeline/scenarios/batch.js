import { target } from '../../../lib/config.js';
import { resumableUpload } from '../../../lib/upload.js';

// Batch / burst: fire exactly BATCH_SIZE real uploads across VUS workers as fast as
// possible, then exit. Re-run for another wave. Exact iteration count = exact cost.
const BATCH_SIZE = parseInt(__ENV.BATCH_SIZE) || 10;
const VUS = parseInt(__ENV.VUS) || 5;
const TOKEN = __ENV.TOKEN || 'apex';

// open() resolves relative to this script's directory.
const SEED = open(__ENV.SEED || '../../../out/seed_720p.mp4', 'b');
const SEED_SIZE = parseInt(__ENV.SEED_SIZE) || SEED.byteLength;

export const options = {
  scenarios: {
    batch: {
      executor: 'shared-iterations',
      vus: VUS,
      iterations: BATCH_SIZE,
      maxDuration: '10m',
    },
  },
  thresholds: {
    upload_fail: ['rate<0.05'],
    bytes_put_ms: ['p(95)<10000'],
  },
};

const URL = target();

export default function () {
  resumableUpload(URL, TOKEN, SEED, SEED_SIZE);
}
