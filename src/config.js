import path from 'node:path';

function toInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value, fallback) {
  if (value == null) return fallback;
  const normalized = String(value).toLowerCase().trim();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function toFloat(value, fallback) {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function toIntList(value) {
  return toList(value)
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isFinite(item));
}

const cwd = process.cwd();

const defaultHuginBins = [
  '/Applications/Hugin/Hugin.app/Contents/MacOS',
  '/Applications/Hugin/HuginStitchProject.app/Contents/MacOS',
  '/Applications/Hugin/PTBatcherGUI.app/Contents/MacOS'
];

export const config = {
  port: toInt(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3000',
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  maxUploadBytes: toInt(process.env.MAX_UPLOAD_BYTES, 2 * 1024 * 1024 * 1024),
  maxUnzippedBytes: toInt(process.env.MAX_UNZIPPED_BYTES, 4 * 1024 * 1024 * 1024),
  maxJobMs: toInt(process.env.MAX_JOB_MS, 10 * 60 * 1000),
  maxConcurrentJobs: toInt(process.env.MAX_CONCURRENT_JOBS, 2),
  workRoot: path.resolve(cwd, process.env.WORK_ROOT || './temp'),
  uploadRoot: path.resolve(cwd, process.env.UPLOAD_ROOT || './storage/uploads'),
  artifactRoot: path.resolve(cwd, process.env.ARTIFACT_ROOT || './storage/artifacts'),
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  enablePreview: toBool(process.env.ENABLE_PREVIEW, true),
  allowFallbackStitch: toBool(process.env.ALLOW_FALLBACK_STITCH, false),
  keepFailedTemp: toBool(process.env.KEEP_FAILED_TEMP, false),
  skipTargetIndexes: toIntList(process.env.SKIP_TARGET_INDEXES),
  skipImageFiles: toList(process.env.SKIP_IMAGE_FILES),
  skipExtremePitchAbsDeg: toFloat(process.env.SKIP_EXTREME_PITCH_ABS_DEG, -1),
  outputWidth: toInt(process.env.OUTPUT_WIDTH, 6000),
  outputHeight: toInt(process.env.OUTPUT_HEIGHT, 3000),
  huginStepTimeoutMs: toInt(process.env.HUGIN_STEP_TIMEOUT_MS, 15 * 60 * 1000),
  huginBinPaths: (process.env.HUGIN_BIN_PATHS || defaultHuginBins.join(path.delimiter))
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean)
};

export const queueNames = {
  stitch: 'pano-stitch'
};
