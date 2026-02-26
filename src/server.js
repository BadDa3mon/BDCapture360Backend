import path from 'node:path';
import fs from 'node:fs/promises';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { panoRoutes } from './routes/pano.js';
import { redis } from './redis.js';
import { stitchQueue } from './queue.js';
import { getMetricsSnapshot } from './job-store.js';
import { ensureDir } from './utils/fs.js';

const app = Fastify({
  logger: true,
  bodyLimit: config.maxUploadBytes
});

app.addContentTypeParser('application/zip', { parseAs: 'buffer' }, (request, payload, done) => {
  done(null, payload);
});

await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin || config.allowedOrigins.length === 0) {
      cb(null, true);
      return;
    }
    cb(null, config.allowedOrigins.includes(origin));
  }
});

await app.register(rateLimit, {
  max: 30,
  timeWindow: '1 minute'
});

await ensureDir(config.artifactRoot);
await ensureDir(config.uploadRoot);
await ensureDir(config.workRoot);

await app.register(fastifyStatic, {
  root: config.artifactRoot,
  prefix: '/artifacts/'
});

app.get('/health/live', async () => ({ status: 'ok' }));

app.get('/health/ready', async (request, reply) => {
  try {
    await redis.ping();
    await stitchQueue.getJobCounts();
    await fs.access(path.resolve(config.artifactRoot));
    return { status: 'ready' };
  } catch (err) {
    request.log.error({ err }, 'Readiness check failed');
    return reply.code(503).send({ status: 'not-ready' });
  }
});

app.get('/metrics/json', async () => {
  const queueCounts = await stitchQueue.getJobCounts();
  const jobMetrics = await getMetricsSnapshot();
  return {
    queue: queueCounts,
    jobs: jobMetrics
  };
});

await app.register(panoRoutes);

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, 'Unhandled error');
  if (error.statusCode) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  return reply.code(500).send({ error: 'Internal server error' });
});

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
