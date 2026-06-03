import http from 'k6/http';
import { target } from '../../../lib/config.js';
import { uploadPayload, uploadHeaders } from '../../../lib/payload.js';
import { classifyUpload } from '../../../lib/helpers.js';

const VUS = parseInt(__ENV.VUS) || 10;
const ITERATIONS = parseInt(__ENV.ITERATIONS) || 1000;

export const options = {
        vus: VUS,
        iterations: ITERATIONS,
        thresholds: {
                http_req_duration: ['p(95)<3000'],
                http_req_failed: ['rate<0.05'],
        },
};

const URL = `${target()}/upload`;

export default function () {
        const res = http.post(URL, uploadPayload(), { headers: uploadHeaders() });
        classifyUpload(res);
}
