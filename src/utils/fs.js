import fs from 'node:fs/promises';

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function safeRm(target) {
  await fs.rm(target, { recursive: true, force: true });
}

export async function writeBuffer(filePath, buffer) {
  await fs.writeFile(filePath, buffer);
}
