import { redis } from './redis.js';

const keyFor = (jobId) => `job:${jobId}`;

export async function createJobState(payload) {
  const now = new Date().toISOString();
  const base = {
    job_id: payload.job_id,
    scene_id: payload.scene_id || '',
    status: 'pending',
    progress: '0',
    message: '',
    result_url: '',
    preview_url: '',
    width: '0',
    height: '0',
    input_zip_bytes: '0',
    started_at: '',
    completed_at: '',
    duration_ms: '0',
    created_at: now,
    updated_at: now
  };

  await redis.hset(keyFor(payload.job_id), { ...base, ...payload });
}

export async function updateJobState(jobId, patch) {
  const next = { ...patch, updated_at: new Date().toISOString() };
  await redis.hset(keyFor(jobId), next);
}

export async function getJobState(jobId) {
  const data = await redis.hgetall(keyFor(jobId));
  if (!data || Object.keys(data).length === 0) return null;

  return {
    job_id: data.job_id,
    scene_id: data.scene_id || undefined,
    status: data.status,
    progress: Number(data.progress || 0),
    message: data.message || undefined,
    result_url: data.result_url || undefined,
    preview_url: data.preview_url || undefined,
    width: Number(data.width || 0) || undefined,
    height: Number(data.height || 0) || undefined,
    input_zip_bytes: Number(data.input_zip_bytes || 0) || undefined,
    started_at: data.started_at || undefined,
    completed_at: data.completed_at || undefined,
    duration_ms: Number(data.duration_ms || 0) || undefined,
    created_at: data.created_at,
    updated_at: data.updated_at
  };
}

export async function getMetricsSnapshot() {
  const keys = await redis.keys('job:*');
  const summary = {
    total: keys.length,
    pending: 0,
    processing: 0,
    done: 0,
    failed: 0,
    failed_percent: 0,
    avg_duration_ms: 0,
    p95_duration_ms: 0,
    avg_input_zip_bytes: 0
  };

  if (keys.length === 0) return summary;

  const raw = await Promise.all(keys.map((key) => redis.hgetall(key)));
  const durations = [];
  const zipSizes = [];
  for (const item of raw) {
    const status = item.status || 'pending';
    if (summary[status] !== undefined) summary[status] += 1;

    const duration = Number(item.duration_ms || 0);
    if (duration > 0) durations.push(duration);

    const size = Number(item.input_zip_bytes || 0);
    if (size > 0) zipSizes.push(size);
  }

  summary.failed_percent = Number(((summary.failed / summary.total) * 100).toFixed(2));

  if (durations.length > 0) {
    durations.sort((a, b) => a - b);
    const avg = durations.reduce((acc, n) => acc + n, 0) / durations.length;
    const p95Index = Math.min(durations.length - 1, Math.floor(0.95 * durations.length));
    summary.avg_duration_ms = Math.round(avg);
    summary.p95_duration_ms = durations[p95Index];
  }

  if (zipSizes.length > 0) {
    summary.avg_input_zip_bytes = Math.round(zipSizes.reduce((acc, n) => acc + n, 0) / zipSizes.length);
  }

  return summary;
}
