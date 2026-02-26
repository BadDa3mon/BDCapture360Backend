import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import yauzl from 'yauzl';
import { config } from '../config.js';
import { ensureDir, writeBuffer } from '../utils/fs.js';

function openZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, decodeStrings: true }, (err, zipfile) => {
      if (err) {
        reject(Object.assign(new Error('Corrupted ZIP archive'), { statusCode: 400 }));
        return;
      }
      resolve(zipfile);
    });
  });
}

function assertSafePath(entryName) {
  const unixName = entryName.replaceAll('\\', '/');
  if (unixName.startsWith('/') || unixName.includes('../')) {
    throw new Error(`Unsafe path: ${entryName}`);
  }
  return unixName;
}

function isAllowedEntry(entryName) {
  const normalized = entryName.toLowerCase();
  if (normalized === 'manifest.json') return true;
  return normalized.startsWith('images/') && normalized.endsWith('.jpg');
}

export async function saveIncomingZip(jobId, bodyBuffer) {
  const dir = path.join(config.uploadRoot, jobId);
  await ensureDir(dir);
  const zipPath = path.join(dir, 'scene.zip');
  await writeBuffer(zipPath, bodyBuffer);
  return zipPath;
}

export async function extractAndValidateZip(zipPath, workDir) {
  await ensureDir(workDir);

  const zip = await openZip(zipPath);
  const imageFiles = new Set();
  let manifestPath = null;
  let unzippedBytes = 0;

  return new Promise((resolve, reject) => {
    let closed = false;

    const fail = async (err) => {
      if (closed) return;
      closed = true;
      zip.close();
      reject(err);
    };

    zip.readEntry();
    zip.on('entry', async (entry) => {
      try {
        const safeName = assertSafePath(entry.fileName);

        if (/\/$/.test(safeName)) {
          zip.readEntry();
          return;
        }

        if (!isAllowedEntry(safeName)) {
          throw Object.assign(new Error(`Unsupported file in ZIP: ${safeName}`), { statusCode: 400 });
        }

        unzippedBytes += entry.uncompressedSize;
        if (unzippedBytes > config.maxUnzippedBytes) {
          throw Object.assign(new Error('Unzipped payload exceeds limit'), { statusCode: 413 });
        }

        const outPath = path.join(workDir, safeName);
        await ensureDir(path.dirname(outPath));

        zip.openReadStream(entry, async (streamErr, readStream) => {
          if (streamErr) {
            fail(streamErr);
            return;
          }

          const writeStream = fs.createWriteStream(outPath);
          readStream.pipe(writeStream);

          writeStream.on('error', fail);
          readStream.on('error', fail);
          writeStream.on('finish', () => {
            const normalized = safeName.replace(/^images\//, '');
            if (safeName === 'manifest.json') manifestPath = outPath;
            if (safeName.toLowerCase().startsWith('images/')) imageFiles.add(normalized);
            zip.readEntry();
          });
        });
      } catch (err) {
        fail(err);
      }
    });

    zip.on('end', async () => {
      if (closed) return;
      closed = true;
      zip.close();

      if (!manifestPath) {
        reject(Object.assign(new Error('manifest.json is required'), { statusCode: 400 }));
        return;
      }
      if (imageFiles.size === 0) {
        reject(Object.assign(new Error('At least one JPG image is required'), { statusCode: 400 }));
        return;
      }

      const manifestRaw = await fsp.readFile(manifestPath, 'utf8');
      let manifest;
      try {
        manifest = JSON.parse(manifestRaw);
      } catch {
        reject(Object.assign(new Error('Invalid manifest.json'), { statusCode: 422 }));
        return;
      }

      resolve({ manifest, imageFiles, manifestPath, unzippedBytes });
    });

    zip.on('error', fail);
  });
}
