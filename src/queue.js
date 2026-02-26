import { Queue } from 'bullmq';
import { queueNames } from './config.js';
import { buildQueueConnection } from './redis.js';

export const stitchQueue = new Queue(queueNames.stitch, {
  connection: buildQueueConnection(),
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 200,
    removeOnFail: 200,
    backoff: {
      type: 'exponential',
      delay: 5000
    }
  }
});
