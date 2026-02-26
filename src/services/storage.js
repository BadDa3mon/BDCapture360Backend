import path from 'node:path';
import fs from 'node:fs/promises';
import { config } from '../config.js';
import { ensureDir } from '../utils/fs.js';

export async function persistArtifacts(jobId, sourceResultPath, sourcePreviewPath) {
  const dstDir = path.join(config.artifactRoot, jobId);
  await ensureDir(dstDir);

  const resultName = 'result.jpg';
  const resultPath = path.join(dstDir, resultName);
  await fs.copyFile(sourceResultPath, resultPath);

  let previewUrl;
  if (sourcePreviewPath) {
    const previewName = 'preview.jpg';
    const previewPath = path.join(dstDir, previewName);
    await fs.copyFile(sourcePreviewPath, previewPath);
    previewUrl = `${config.publicBaseUrl}/artifacts/${jobId}/${previewName}`;
  }

  return {
    resultUrl: `${config.publicBaseUrl}/artifacts/${jobId}/${resultName}`,
    previewUrl
  };
}
