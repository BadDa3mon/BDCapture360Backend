import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { stitchQueue } from '../queue.js';
import { createJobState, getJobState } from '../job-store.js';
import { config } from '../config.js';
import { ensureDir, safeRm } from '../utils/fs.js';
import { saveIncomingZip, extractAndValidateZip } from '../services/zip-service.js';
import { validateManifest } from '../services/manifest-schema.js';

export async function panoRoutes(fastify) {
  fastify.post('/api/pano/stitch', async (request, reply) => {
    const contentType = request.headers['content-type']?.split(';')[0]?.trim();
    if (contentType !== 'application/zip') {
      return reply.code(415).send({ error: 'Unsupported content type. Use application/zip' });
    }

    const contentLength = Number.parseInt(String(request.headers['content-length'] || '0'), 10);
    if (contentLength > config.maxUploadBytes) {
      return reply.code(413).send({ error: 'Payload too large' });
    }

    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return reply.code(400).send({ error: 'ZIP payload is required' });
    }
    if (body.length > config.maxUploadBytes) {
      return reply.code(413).send({ error: 'Payload too large' });
    }

    const jobId = uuidv4();
    const validationWorkDir = path.join(config.workRoot, `validate-${jobId}`);
    let queued = false;

    try {
      await ensureDir(config.workRoot);
      await ensureDir(config.uploadRoot);
      await ensureDir(config.artifactRoot);

      const zipPath = await saveIncomingZip(jobId, body);
      const extracted = await extractAndValidateZip(zipPath, validationWorkDir);
      const manifestCheck = validateManifest(extracted.manifest, extracted.imageFiles);

      if (!manifestCheck.ok) {
        await safeRm(validationWorkDir);
        return reply.code(manifestCheck.code).send({ error: manifestCheck.message });
      }

      request.log.info(
        { job_id: jobId, scene_id: manifestCheck.data.scene_id, stage: 'accepted' },
        'Stitch job accepted'
      );

      await createJobState({
        job_id: jobId,
        scene_id: manifestCheck.data.scene_id,
        status: 'pending',
        progress: '0.1',
        message: 'Queued for stitching',
        input_zip_bytes: String(body.length)
      });

      await stitchQueue.add('stitch-scene', {
        jobId,
        zipPath,
        sceneId: manifestCheck.data.scene_id,
        manifest: manifestCheck.data
      }, {
        jobId
      });
      queued = true;

      try {
        await safeRm(validationWorkDir);
      } catch (cleanupErr) {
        request.log.warn({ err: cleanupErr, jobId }, 'Validation temp cleanup failed');
      }
      return reply.code(200).send({ job_id: jobId });
    } catch (err) {
      request.log.error({ err, jobId }, 'Failed to create stitching job');
      const statusCode = err.statusCode || 500;
      const message = statusCode >= 500 ? 'Internal server error' : err.message;
      try {
        await safeRm(validationWorkDir);
      } catch (cleanupErr) {
        request.log.warn({ err: cleanupErr, jobId }, 'Validation temp cleanup failed');
      }
      if (queued) {
        return reply.code(200).send({ job_id: jobId });
      }
      return reply.code(statusCode).send({ error: message });
    }
  });

  fastify.get('/api/pano/stitch/:jobId', async (request, reply) => {
    const { jobId } = request.params;
    const state = await getJobState(jobId);
    if (!state) {
      return reply.code(404).send({ error: 'Job not found' });
    }

    return reply.code(200).send({
      job_id: state.job_id,
      status: state.status,
      progress: state.progress,
      message: state.message,
      result_url: state.result_url,
      preview_url: state.preview_url,
      width: state.width,
      height: state.height
    });
  });
}
