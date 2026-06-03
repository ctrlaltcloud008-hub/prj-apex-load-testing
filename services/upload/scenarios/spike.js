import http from 'k6/http';
import { sleep } from 'k6';
import { target } from '../../../lib/config.js';
import { uploadPayload, uploadHeaders } from '../../../lib/payload.js';
import { classifyUpload } from '../../../lib/helpers.js';

export const options = {
  stages: [
    { duration: '10s', target: 0 },
    { duration: '5s', target: 100 },
    { duration: '2m', target: 100 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<5000'],
    http_req_failed: ['rate<0.10'],
  },
};

const URL = `${target()}/upload`;

export default function () {
  const res = http.post(URL, uploadPayload(), { headers: uploadHeaders() });
  classifyUpload(res);
  sleep(1);
}
