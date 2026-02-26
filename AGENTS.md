# AGENTS.md

## Purpose
This repository contains backend service for iOS guided 360 capture with server-side stitching.

## Stack
- Node.js (ESM)
- Fastify API
- Redis + BullMQ queue/worker
- Hugin CLI tools (`pto_gen`, `cpfind`, `autooptimiser`, `pano_modify`, `nona`, `enblend`)

## Run
- API: `npm start`
- Worker: `npm run worker`
- Local infra: Redis on `REDIS_URL`

## Required API Contract
- `POST /api/pano/stitch` (`application/zip`)
- `GET /api/pano/stitch/:jobId`
- Health: `/health/live`, `/health/ready`

## Operational Notes
- Worker must run in parallel with API.
- Use `.env` for runtime tuning:
  - `MAX_JOB_MS`
  - `HUGIN_STEP_TIMEOUT_MS`
  - `OUTPUT_WIDTH`, `OUTPUT_HEIGHT`
  - `SKIP_TARGET_INDEXES`, `SKIP_IMAGE_FILES`, `SKIP_EXTREME_PITCH_ABS_DEG`
  - `KEEP_FAILED_TEMP`
- For macOS Hugin app bundle, ensure `HUGIN_BIN_PATHS` is configured.

## Debugging
- Worker logs include per-step Hugin stdout/stderr.
- If stitching fails and `KEEP_FAILED_TEMP=true`, inspect files in `temp/<job_id>/`.
