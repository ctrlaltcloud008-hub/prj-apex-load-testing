import http from 'k6/http';
import { sleep } from 'k6';
import { target, thresholds } from '../../../lib/config.js';
import { uploadPayload, uploadHeaders } from '../../../lib/payload.js';
import { classifyUpload } from '../../../lib/helpers.js';

export const options = {
        stages: [
                { duration: '2m', target: 10 },
                { duration: '3m', target: 10 },
                { duration: '2m', target: 25 },
                { duration: '3m', target: 25 },
                { duration: '2m', target: 50 },
                { duration: '3m', target: 50 },
                { duration: '1m', target: 0 },
        ],
        thresholds,
};

const URL = `${target()}/upload`;

export default function () {
        const res = http.post(URL, uploadPayload(), { headers: uploadHeaders() });
        classifyUpload(res);
        sleep(1);
}
