import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import probe from 'probe-image-size';
import { config } from '../config.js';

const extraPath = config.huginBinPaths.join(':');
const processPath = process.env.PATH || '';
const mergedPath = extraPath ? `${extraPath}:${processPath}` : processPath;

function normalizeFileRef(file) {
  return String(file || '').replace(/^\.\//, '').replace(/^images\//, '');
}

function parseLines(buffer, carry = '') {
  const text = carry + buffer.toString();
  const lines = text.split(/\r?\n/);
  const rest = lines.pop() || '';
  return { lines, rest };
}

function execCmd(cmd, args, options = {}) {
  const {
    cwd,
    timeoutMs = config.huginStepTimeoutMs,
    onLog,
    env,
    stepName
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: mergedPath, ...(env || {}) },
      cwd
    });

    let stderrAll = '';
    let stdoutCarry = '';
    let stderrCarry = '';

    const emit = (stream, line) => {
      if (!line) return;
      onLog?.(`[${stepName || cmd}] ${stream}: ${line}`);
    };

    child.stdout.on('data', (chunk) => {
      const parsed = parseLines(chunk, stdoutCarry);
      stdoutCarry = parsed.rest;
      for (const line of parsed.lines) emit('stdout', line);
    });

    child.stderr.on('data', (chunk) => {
      stderrAll += chunk.toString();
      const parsed = parseLines(chunk, stderrCarry);
      stderrCarry = parsed.rest;
      for (const line of parsed.lines) emit('stderr', line);
    });

    let killedByTimeout = false;
    const timer = setTimeout(() => {
      killedByTimeout = true;
      onLog?.(`[${stepName || cmd}] timeout after ${timeoutMs}ms`);
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000);
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (stdoutCarry) emit('stdout', stdoutCarry);
      if (stderrCarry) emit('stderr', stderrCarry);

      if (killedByTimeout) {
        reject(new Error(`${stepName || cmd} timed out after ${timeoutMs}ms`));
        return;
      }

      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${stepName || cmd} exited with ${code}: ${stderrAll.trim()}`));
      }
    });
  });
}

async function execShell(command, cwd, options = {}) {
  await execCmd('sh', ['-c', command], { ...options, cwd });
}

async function hasCommand(cmd) {
  try {
    await execCmd('sh', ['-c', `command -v ${cmd}`], { timeoutMs: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function generatePreview(resultPath, previewPath) {
  const canConvert = await hasCommand('convert');
  if (!canConvert) return null;
  await execCmd('convert', [resultPath, '-resize', '2000x1000>', previewPath], {
    stepName: 'preview',
    timeoutMs: 5 * 60 * 1000
  });
  return previewPath;
}

function listMissing(required, availability) {
  const missing = [];
  for (let i = 0; i < required.length; i += 1) {
    if (!availability[i]) missing.push(required[i]);
  }
  return missing;
}

function shouldSkipByPitch(image) {
  if (config.skipExtremePitchAbsDeg <= 0) return false;
  return Math.abs(Number(image.pitch_deg || 0)) >= config.skipExtremePitchAbsDeg;
}

function buildSelectedFiles(manifest) {
  const explicitSkipFiles = new Set(config.skipImageFiles.map(normalizeFileRef));
  const explicitSkipTargets = new Set(config.skipTargetIndexes);

  const selected = [];
  const skipped = [];

  for (const image of manifest.images || []) {
    const normalizedFile = normalizeFileRef(image.file);
    const reasons = [];

    if (explicitSkipTargets.has(image.target_index)) reasons.push(`target_index=${image.target_index}`);
    if (explicitSkipFiles.has(normalizedFile)) reasons.push(`file=${normalizedFile}`);
    if (shouldSkipByPitch(image)) reasons.push(`abs(pitch)>=${config.skipExtremePitchAbsDeg}`);

    if (reasons.length > 0) {
      skipped.push({ file: normalizedFile, reasons });
      continue;
    }

    selected.push(normalizedFile);
  }

  return { selected, skipped };
}

async function huginStitch(workDir, selectedImages, onLog) {
  const outputDir = path.join(workDir, 'output');
  const projectFile = path.join(workDir, 'project.pto');
  const remapPrefix = path.join(workDir, 'remap');

  const absoluteImages = selectedImages.map((file) => path.join(workDir, 'input', 'images', file));
  const quotedImages = absoluteImages.map((p) => `"${p}"`).join(' ');

  onLog?.(`Selected ${selectedImages.length} images for stitch`);
  onLog?.(`Target output size: ${config.outputWidth}x${config.outputHeight}`);

  await execShell(`pto_gen -o "${projectFile}" ${quotedImages}`, workDir, {
    stepName: 'pto_gen',
    onLog
  });

  await execShell(`cpfind --multirow --celeste -o "${projectFile}" "${projectFile}"`, workDir, {
    stepName: 'cpfind',
    onLog
  });

  await execShell(`autooptimiser -a -m -l -o "${projectFile}" "${projectFile}"`, workDir, {
    stepName: 'autooptimiser',
    onLog
  });

  await execShell(`pano_modify --projection=2 --fov=360x180 --canvas=${config.outputWidth}x${config.outputHeight} --crop=0,${config.outputWidth},0,${config.outputHeight} -o "${projectFile}" "${projectFile}"`, workDir, {
    stepName: 'pano_modify',
    onLog
  });

  await execShell(`nona -m TIFF_m -o "${remapPrefix}" "${projectFile}"`, workDir, {
    stepName: 'nona',
    onLog
  });

  const remapInputs = await buildRemapInputs(workDir);
  if (remapInputs.length === 0) {
    throw new Error('Hugin did not produce remap TIFF files');
  }

  await execCmd('enblend', ['-o', path.join(outputDir, 'result.jpg'), ...remapInputs], {
    stepName: 'enblend',
    onLog,
    timeoutMs: config.huginStepTimeoutMs
  });

  return path.join(outputDir, 'result.jpg');
}

async function buildRemapInputs(workDir) {
  const files = await fs.readdir(workDir);
  return files
    .filter((f) => /^remap\d+\.tif$/i.test(f))
    .sort()
    .map((f) => path.join(workDir, f));
}

export async function stitchScene({ workDir, manifest, onProgress, onLog }) {
  const outputDir = path.join(workDir, 'output');
  await fs.mkdir(outputDir, { recursive: true });

  await onProgress(0.3, 'Preparing stitch pipeline');

  const required = ['pto_gen', 'cpfind', 'autooptimiser', 'pano_modify', 'nona', 'enblend'];
  const availability = await Promise.all(required.map(hasCommand));
  const huginReady = availability.every(Boolean);

  if (!huginReady) {
    const missing = listMissing(required, availability);
    throw new Error(`Hugin CLI tools are required for 360 stitch. Missing: ${missing.join(', ')}`);
  }

  const { selected, skipped } = buildSelectedFiles(manifest || {});
  if (skipped.length > 0) {
    onLog?.(`Skipped ${skipped.length} images: ${skipped.map((s) => `${s.file} (${s.reasons.join('|')})`).join(', ')}`);
  }

  if (selected.length < 6) {
    throw new Error(`Too few images after filtering (${selected.length}). Adjust SKIP_* settings.`);
  }

  await onProgress(0.6, 'Running Hugin stitching');
  const resultPath = await huginStitch(workDir, selected, onLog);

  const previewPath = config.enablePreview ? path.join(outputDir, 'preview.jpg') : null;
  const producedPreviewPath = previewPath ? await generatePreview(resultPath, previewPath) : null;

  const resultBuffer = await fs.readFile(resultPath);
  const dimensions = probe.sync(resultBuffer) || {};
  const width = dimensions.width || 0;
  const height = dimensions.height || 0;
  if (!width || !height) {
    throw new Error('Unable to read output image dimensions');
  }
  if (width !== height * 2) {
    throw new Error(`Stitch output must be equirectangular 2:1, got ${width}x${height}`);
  }

  await onProgress(0.9, 'Stitching finished, finalizing artifacts');

  return {
    resultPath,
    previewPath: producedPreviewPath,
    width,
    height
  };
}
