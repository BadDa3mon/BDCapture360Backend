import path from 'node:path';
import fs from 'node:fs/promises';
import { Worker } from 'bullmq';
import { queueNames, config } from './config.js';
import { buildQueueConnection } from './redis.js';
import { updateJobState } from './job-store.js';
import { extractAndValidateZip } from './services/zip-service.js';
import { validateManifest } from './services/manifest-schema.js';
import { stitchScene } from './services/stitcher.js';
import { persistArtifacts } from './services/storage.js';
import { ensureDir, safeRm } from './utils/fs.js';

const worker = new Worker(
  queueNames.stitch,
  async (job) => {
    const { jobId, zipPath } = job.data;
    const workDir = path.join(config.workRoot, jobId);
    const inputDir = path.join(workDir, 'input');

    const mark = async (status, progress, message, extra = {}) => {
      await updateJobState(jobId, {
        status,
        progress: String(progress),
        message,
        ...extra
      });
    };
    const startedAtMs = Date.now();
    let completedOk = false;

    try {
      await ensureDir(inputDir);
      await mark('processing', 0.1, 'Worker picked up the job', {
        started_at: new Date(startedAtMs).toISOString()
      });

      const extracted = await extractAndValidateZip(zipPath, inputDir);
      const manifestCheck = validateManifest(extracted.manifest, extracted.imageFiles);
      if (!manifestCheck.ok) {
        throw Object.assign(new Error(manifestCheck.message), { statusCode: manifestCheck.code });
      }
      console.info('Processing stitch job', {
        job_id: jobId,
        scene_id: manifestCheck.data.scene_id,
        stage: 'processing'
      });

      let timer;
      const timerPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Job timed out')), config.maxJobMs);
      });

      const stitchPromise = stitchScene({
        workDir,
        manifest: manifestCheck.data,
        onProgress: async (value, message) => {
          await mark('processing', value, message);
          console.info('Stitch progress', {
            job_id: jobId,
            scene_id: manifestCheck.data.scene_id,
            progress: value,
            message
          });
        },
        onLog: async (line) => {
          console.info('Stitch log', {
            job_id: jobId,
            scene_id: manifestCheck.data.scene_id,
            line
          });
        }
      });

      const stitched = await Promise.race([stitchPromise, timerPromise]);
      clearTimeout(timer);
      const urls = await persistArtifacts(jobId, stitched.resultPath, stitched.previewPath);

      await mark('done', 1.0, 'Completed', {
        result_url: urls.resultUrl,
        preview_url: urls.previewUrl || '',
        width: String(stitched.width || 0),
        height: String(stitched.height || 0),
        completed_at: new Date().toISOString(),
        duration_ms: String(Date.now() - startedAtMs)
      });
      try {
        await fs.unlink(zipPath);
      } catch {
      }
      console.info('Stitch job completed', { job_id: jobId, scene_id: manifestCheck.data.scene_id, stage: 'done' });
      completedOk = true;

      return true;
    } catch (err) {
      await mark('failed', 1.0, err.message || 'Stitching failed', {
        completed_at: new Date().toISOString(),
        duration_ms: String(Date.now() - startedAtMs)
      });
      console.error('Stitch job failed', { job_id: jobId, stage: 'failed', reason: err.message });
      throw err;
    } finally {
      if (completedOk || !config.keepFailedTemp) {
        await safeRm(workDir);
      }
    }
  },
  {
    connection: buildQueueConnection(),
    concurrency: config.maxConcurrentJobs
  }
);

worker.on('failed', (job, err) => {
  console.error('Worker job failed', { jobId: job?.id, err: err?.message });
});

worker.on('error', (err) => {
  console.error('Worker runtime error', err);
});

console.log('Stitch worker started');
