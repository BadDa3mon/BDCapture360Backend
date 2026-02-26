import { z } from 'zod';

const uuidOrString = z.string().min(1);

const gridSchema = z.object({
  yaw_step_deg: z.number().positive(),
  pitches_deg: z.array(z.number()).min(1),
  zenith_deg: z.number(),
  nadir_deg: z.number()
});

const imageSchema = z.object({
  target_index: z.number().int().nonnegative(),
  file: z.string().min(1),
  yaw_deg: z.number(),
  pitch_deg: z.number(),
  roll_deg: z.number(),
  timestamp_utc: z.string().min(1),
  exposure_locked: z.boolean(),
  focus_locked: z.boolean(),
  fov_deg: z.number().optional()
});

export const manifestSchema = z.object({
  scene_id: uuidOrString,
  scene_complete: z.boolean().optional(),
  total_targets: z.number().int().positive().optional(),
  device: z.object({
    model: z.string().min(1),
    ios_version: z.string().min(1),
    app_version: z.string().min(1)
  }),
  capture: z.object({
    timestamp_utc: z.string().min(1),
    grid: gridSchema,
    constants: z.object({
      thresholdDeg: z.number(),
      dwellMs: z.number().int().positive(),
      cooldownMs: z.number().int().nonnegative()
    })
  }),
  images: z.array(imageSchema).min(1)
});

export function validateManifest(manifest, imageFilesSet) {
  const parsed = manifestSchema.safeParse(manifest);
  if (!parsed.success) {
    return {
      ok: false,
      code: 422,
      message: parsed.error.issues[0]?.message || 'Invalid manifest'
    };
  }

  const data = parsed.data;

  const dedupByTarget = new Map();
  for (const image of data.images) {
    // "Last write wins" for duplicate target_index (allowed by spec).
    dedupByTarget.set(image.target_index, image);

    const normalized = image.file.replace(/^\.\//, '').replace(/^images\//, '');
    if (!imageFilesSet.has(normalized)) {
      return {
        ok: false,
        code: 422,
        message: `Missing image file in ZIP: ${image.file}`
      };
    }
  }

  if (data.scene_complete) {
    const estimatedTargets = data.total_targets || estimateTotalTargets(data.capture.grid);
    if (dedupByTarget.size !== estimatedTargets) {
      return {
        ok: false,
        code: 422,
        message: `Scene marked complete but has ${dedupByTarget.size}/${estimatedTargets} unique targets`
      };
    }
  }

  return { ok: true, data };
}

function estimateTotalTargets(grid) {
  const yawTargets = Math.round(360 / grid.yaw_step_deg);
  const pitchRows = grid.pitches_deg.length;
  return yawTargets * pitchRows + 2;
}
