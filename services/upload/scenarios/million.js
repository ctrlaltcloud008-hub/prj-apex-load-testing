import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { target } from '../../../lib/config.js';

function intEnv(name, fallback) {
  const value = parseInt(__ENV[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function strEnv(name, fallback) {
  return __ENV[name] || fallback;
}

function requestCount(name, fraction) {
  return intEnv(`${name}_REQUESTS`, Math.floor(TOTAL * fraction));
}

function iterationsFor(requests, requestsPerIteration) {
  return Math.max(1, Math.floor(requests / requestsPerIteration));
}

const TOTAL = intEnv('TOTAL', 1000000);
const RUN_ID = strEnv('RUN_ID', `${Date.now()}`);
const USER_PREFIX = strEnv('USER_PREFIX', `loadtest_${RUN_ID}`);
const USER_POOL = intEnv('USER_POOL', Math.max(70000, Math.ceil(TOTAL / 15)));
const FILE_SIZE_BYTES = intEnv('FILE_SIZE_BYTES', 1);
const CONTENT_TYPE = strEnv('CONTENT_TYPE', 'video/mp4');
const MAX_DURATION = strEnv('MAX_DURATION', '90m');

const COUNTS = {
  success: requestCount('SUCCESS', 0.225),
  missingAuth: requestCount('MISSING_AUTH', 0.05),
  invalidAuth: requestCount('INVALID_AUTH', 0.05),
  missingClientRegion: requestCount('MISSING_CLIENT_REGION', 0.025),
  invalidRequestId: requestCount('INVALID_REQUEST_ID', 0.05),
  invalidJson: requestCount('INVALID_JSON', 0.05),
  unknownField: requestCount('UNKNOWN_FIELD', 0.05),
  invalidContentType: requestCount('INVALID_CONTENT_TYPE', 0.075),
  invalidFilename: requestCount('INVALID_FILENAME', 0.075),
  fileTooLarge: requestCount('FILE_TOO_LARGE', 0.075),
  idempotencyReplay: requestCount('IDEMPOTENCY_REPLAY', 0.075),
  idempotencyMismatch: requestCount('IDEMPOTENCY_MISMATCH', 0.075),
  quotaConcurrent: requestCount('QUOTA_CONCURRENT', 0.125),
};

export const expected = new Counter('upload_expected_response');
export const unexpected = new Counter('upload_unexpected_response');
export const pathRequests = new Counter('upload_path_requests');
export const pathFailures = new Rate('upload_path_failures');

export const options = {
  scenarios: {
    success_path: {
      executor: 'shared-iterations',
      exec: 'successPath',
      vus: intEnv('SUCCESS_VUS', 300),
      iterations: COUNTS.success,
      maxDuration: MAX_DURATION,
    },
    missing_auth_path: {
      executor: 'shared-iterations',
      exec: 'missingAuthPath',
      vus: intEnv('MISSING_AUTH_VUS', 50),
      iterations: COUNTS.missingAuth,
      maxDuration: MAX_DURATION,
    },
    invalid_auth_path: {
      executor: 'shared-iterations',
      exec: 'invalidAuthPath',
      vus: intEnv('INVALID_AUTH_VUS', 50),
      iterations: COUNTS.invalidAuth,
      maxDuration: MAX_DURATION,
    },
    invalid_request_id_path: {
      executor: 'shared-iterations',
      exec: 'invalidRequestIdPath',
      vus: intEnv('INVALID_REQUEST_ID_VUS', 50),
      iterations: COUNTS.invalidRequestId,
      maxDuration: MAX_DURATION,
    },
    missing_client_region_path: {
      executor: 'shared-iterations',
      exec: 'missingClientRegionPath',
      vus: intEnv('MISSING_CLIENT_REGION_VUS', 25),
      iterations: COUNTS.missingClientRegion,
      maxDuration: MAX_DURATION,
    },
    invalid_json_path: {
      executor: 'shared-iterations',
      exec: 'invalidJsonPath',
      vus: intEnv('INVALID_JSON_VUS', 50),
      iterations: COUNTS.invalidJson,
      maxDuration: MAX_DURATION,
    },
    unknown_field_path: {
      executor: 'shared-iterations',
      exec: 'unknownFieldPath',
      vus: intEnv('UNKNOWN_FIELD_VUS', 50),
      iterations: COUNTS.unknownField,
      maxDuration: MAX_DURATION,
    },
    invalid_content_type_path: {
      executor: 'shared-iterations',
      exec: 'invalidContentTypePath',
      vus: intEnv('INVALID_CONTENT_TYPE_VUS', 75),
      iterations: COUNTS.invalidContentType,
      maxDuration: MAX_DURATION,
    },
    invalid_filename_path: {
      executor: 'shared-iterations',
      exec: 'invalidFilenamePath',
      vus: intEnv('INVALID_FILENAME_VUS', 75),
      iterations: COUNTS.invalidFilename,
      maxDuration: MAX_DURATION,
    },
    file_too_large_path: {
      executor: 'shared-iterations',
      exec: 'fileTooLargePath',
      vus: intEnv('FILE_TOO_LARGE_VUS', 75),
      iterations: COUNTS.fileTooLarge,
      maxDuration: MAX_DURATION,
    },
    idempotency_replay_path: {
      executor: 'shared-iterations',
      exec: 'idempotencyReplayPath',
      vus: intEnv('IDEMPOTENCY_REPLAY_VUS', 100),
      iterations: iterationsFor(COUNTS.idempotencyReplay, 2),
      maxDuration: MAX_DURATION,
    },
    idempotency_mismatch_path: {
      executor: 'shared-iterations',
      exec: 'idempotencyMismatchPath',
      vus: intEnv('IDEMPOTENCY_MISMATCH_VUS', 100),
      iterations: iterationsFor(COUNTS.idempotencyMismatch, 2),
      maxDuration: MAX_DURATION,
    },
    quota_concurrent_path: {
      executor: 'shared-iterations',
      exec: 'quotaConcurrentPath',
      vus: intEnv('QUOTA_CONCURRENT_VUS', 100),
      iterations: iterationsFor(COUNTS.quotaConcurrent, 4),
      maxDuration: MAX_DURATION,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<5000'],
    upload_path_failures: ['rate<0.05'],
    'upload_path_failures{path:success}': ['rate<0.01'],
    'upload_path_failures{path:idempotency_replay_second}': ['rate<0.01'],
    'upload_path_failures{path:idempotency_mismatch_second}': ['rate<0.01'],
    'upload_path_failures{path:quota_concurrent_4}': ['rate<0.01'],
  },
};

const URL = `${target()}/upload`;

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function pooledUser(path) {
  const pathSalt = path.length * 1009;
  const index = (((__VU - 1) * 1000003) + __ITER + pathSalt) % USER_POOL;
  return `${USER_PREFIX}_${path}_${index}`;
}

function headersFor(path, requestID = uuidv4()) {
  const headers = headersForUser(pooledUser(path));
  headers['X-Request-ID'] = requestID;
  return headers;
}

function headersForUser(userID) {
  return {
    'Content-Type': 'application/json',
    'X-Request-ID': uuidv4(),
    'Authorization': `Bearer ${userID}`,
    'X-Client-Region': 'asia-south1',
  };
}

function payload(path, overrides = {}) {
  const values = {
    fileName: `${RUN_ID}_${path}_${__VU}_${__ITER}.mp4`,
    contentType: CONTENT_TYPE,
    fileSize: FILE_SIZE_BYTES,
    ...overrides,
  };

  return JSON.stringify({
    file_name: values.fileName,
    content_type: values.contentType,
    file_size_bytes: values.fileSize,
  });
}

function reason(res) {
  try {
    const parsed = res.json();
    return parsed && parsed.reason ? parsed.reason : '';
  } catch (e) {
    return '';
  }
}

function expectResponse(path, res, statuses, reasons = []) {
  const actualReason = reason(res);
  const statusOK = statuses.indexOf(res.status) !== -1;
  const reasonOK = reasons.length === 0 || reasons.indexOf(actualReason) !== -1;
  const ok = statusOK && reasonOK;

  pathRequests.add(1, { path });
  pathFailures.add(ok ? 0 : 1, { path });
  if (ok) {
    expected.add(1, { path, status: String(res.status), reason: actualReason || 'none' });
  } else {
    unexpected.add(1, { path, status: String(res.status), reason: actualReason || 'none' });
  }

  check(res, {
    [`${path}: expected status/reason`]: () => ok,
  });
}

function post(path, body, params, statuses, reasons) {
  const res = http.post(URL, body, { ...params, tags: { path } });
  expectResponse(path, res, statuses, reasons);
  return res;
}

export function successPath() {
  post('success', payload('success'), { headers: headersFor('success') }, [201]);
}

export function missingAuthPath() {
  post('missing_auth', payload('missing_auth'), {
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': uuidv4(),
      'X-Client-Region': 'asia-south1',
    },
  }, [401], ['MISSING_AUTHORIZATION_HEADER']);
}

export function invalidAuthPath() {
  post('invalid_auth', payload('invalid_auth'), {
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': uuidv4(),
      'Authorization': 'Token not-a-bearer-token',
      'X-Client-Region': 'asia-south1',
    },
  }, [401], ['INVALID_AUTHORIZATION_HEADER']);
}

export function invalidRequestIdPath() {
  post('invalid_request_id', payload('invalid_request_id'), {
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': 'not-a-uuid',
      'Authorization': `Bearer ${pooledUser('invalid_request_id')}`,
      'X-Client-Region': 'asia-south1',
    },
  }, [400], ['INVALID_REQUEST_ID']);
}

export function missingClientRegionPath() {
  post('missing_client_region', payload('missing_client_region'), {
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': uuidv4(),
      'Authorization': `Bearer ${pooledUser('missing_client_region')}`,
    },
  }, [500]);
}

export function invalidJsonPath() {
  post('invalid_json', '{"file_name":', {
    headers: headersFor('invalid_json'),
  }, [400]);
}

export function unknownFieldPath() {
  post('unknown_field', JSON.stringify({
    file_name: `${RUN_ID}_unknown_field_${__VU}_${__ITER}.mp4`,
    content_type: CONTENT_TYPE,
    file_size_bytes: FILE_SIZE_BYTES,
    unexpected_field: true,
  }), {
    headers: headersFor('unknown_field'),
  }, [400]);
}

export function invalidContentTypePath() {
  post('invalid_content_type', payload('invalid_content_type', {
    contentType: 'application/octet-stream',
  }), {
    headers: headersFor('invalid_content_type'),
  }, [400]);
}

export function invalidFilenamePath() {
  post('invalid_filename', payload('invalid_filename', {
    fileName: `bad/name/${__VU}_${__ITER}.mp4`,
  }), {
    headers: headersFor('invalid_filename'),
  }, [400]);
}

export function fileTooLargePath() {
  post('file_too_large', payload('file_too_large', {
    fileSize: 5 * 1024 * 1024 * 1024 + 1,
  }), {
    headers: headersFor('file_too_large'),
  }, [413], ['FILE_TOO_LARGE']);
}

export function idempotencyReplayPath() {
  const requestID = uuidv4();
  const path = 'idempotency_replay';
  const body = payload(path);
  const headers = headersFor(path, requestID);
  post(`${path}_first`, body, { headers }, [201]);
  post(`${path}_second`, body, { headers }, [201]);
}

export function idempotencyMismatchPath() {
  const requestID = uuidv4();
  const path = 'idempotency_mismatch';
  const headers = headersFor(path, requestID);
  post(`${path}_first`, payload(path, { fileSize: FILE_SIZE_BYTES }), { headers }, [201]);
  post(`${path}_second`, payload(path, { fileSize: FILE_SIZE_BYTES + 1 }), { headers }, [409], ['IDEMPOTENCY_MISMATCH']);
}

export function quotaConcurrentPath() {
  const user = `${USER_PREFIX}_quota_${__VU}_${__ITER}`;
  const path = 'quota_concurrent';

  for (let i = 0; i < 4; i += 1) {
    const headers = headersForUser(user);
    post(`${path}_${i + 1}`, payload(`${path}_${i + 1}`), { headers }, i < 3 ? [201] : [429], i < 3 ? [] : ['UPLOAD_LIMIT_EXCEEDED']);
  }
}
