import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const CONTENT_TYPES = [
        'video/mp4',
        'video/webm',
        'video/x-matroska',
        'video/x-msvideo',
        'video/x-flv',
];

export function uploadPayload(overrides = {}) {
        const idx = (__VU + __ITER) % CONTENT_TYPES.length;
        return JSON.stringify({
                file_name: overrides.fileName || `loadtest_${__VU}_${__ITER}.mp4`,
                content_type: overrides.contentType || CONTENT_TYPES[idx],
                file_size_bytes: overrides.fileSize || 104857600,
        });
}

export function uploadHeaders(prefix) {
        const token = prefix ? `${prefix}_${__VU}_${__ITER}` : `user_${__VU}_${__ITER}`;
        return {
                'Content-Type': 'application/json',
                'X-Request-ID': uuidv4(),
                'Authorization': `Bearer ${token}`,
                'X-Client-Region': 'asia-south1',
        };
}
