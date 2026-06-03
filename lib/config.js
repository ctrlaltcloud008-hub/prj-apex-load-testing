const TARGET = __ENV.TARGET;
const TOKEN = __ENV.TOKEN;

export function target() {
  if (!TARGET) {
    throw new Error('TARGET env var required (e.g., https://upload-api-xxx.run.app)');
  }
  return TARGET.replace(/\/+$/, '');
}

export function token() {
  return TOKEN || 'stress-test-token';
}

export const thresholds = {
  http_req_duration: ['p(95)<3000'],
  http_req_failed: ['rate<0.05'],
};
