import { check } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

export const errorRate = new Rate('error_rate');
export const uploadDuration = new Trend('upload_duration_ms');
export const rateLimited = new Counter('rate_limited');
export const idempotent = new Counter('idempotent_replays');

export function classifyUpload(res) {
        const isCreated = res.status === 201;
        const isTooMany = res.status === 429;
        const isConflict = res.status === 409;

        const passed = check(res, {
                'expected status': () => isCreated || isTooMany || isConflict,
                'response under 3s': () => res.timings.duration < 3000,
        });

        if (isTooMany) rateLimited.add(1);
        if (isConflict) idempotent.add(1);
        if (!passed) errorRate.add(1);

        uploadDuration.add(res.timings.duration);

        return { status: res.status, isCreated, isTooMany, isConflict };
}
