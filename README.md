# Capture360 Backend

Backend для iOS guided-capture 360° со server-side stitching.

## Что реализовано

- `POST /api/pano/stitch` принимает `application/zip`, валидирует вход и возвращает `job_id`.
- `GET /api/pano/stitch/{job_id}` возвращает состояние `pending|processing|done|failed`.
- Асинхронная обработка через Redis + BullMQ worker.
- Валидация `manifest.json` + наличие `images/*.jpg`.
- Безопасная распаковка ZIP: блок `../`, лимит распакованного объема, whitelist файлов.
- Пайплайн склейки через Hugin CLI (`pto_gen`, `cpfind`, `autooptimiser`, `nona`, `enblend`) обязателен для 360.
- Если Hugin CLI отсутствует, job получает `failed` с явным списком недостающих утилит.
- Dev fallback (первый кадр как result) можно включить только через `ALLOW_FALLBACK_STITCH=true`.
- Подробные логи Hugin-CLI выводятся в worker для каждого шага (`stdout/stderr`).
- Можно скипать проблемные кадры через конфиг (`SKIP_TARGET_INDEXES`, `SKIP_IMAGE_FILES`, `SKIP_EXTREME_PITCH_ABS_DEG`).
- Артефакты отдаются как прямые ссылки: `/artifacts/{job_id}/result.jpg` и `preview.jpg`.
- Health endpoints:
  - `/health/live`
  - `/health/ready`
- Metrics endpoint:
  - `/metrics/json`

## Запуск через Docker Compose

```bash
docker compose up --build
```

API будет на `http://localhost:3000`.

## Локальный запуск

```bash
cp .env.example .env
npm install
npm run worker
npm start
```

## API

### POST /api/pano/stitch

- `Content-Type: application/zip`
- body: ZIP c `manifest.json` и `images/*.jpg`

Ответ:

```json
{ "job_id": "uuid" }
```

### GET /api/pano/stitch/{job_id}

Ответ:

```json
{
  "job_id": "string",
  "status": "pending|processing|done|failed",
  "progress": 0.0,
  "message": "optional",
  "result_url": "https://.../scene.jpg",
  "preview_url": "https://.../preview.jpg",
  "width": 6000,
  "height": 3000
}
```

## Ограничения и конфиги

Смотри `.env.example`:
- `MAX_UPLOAD_BYTES`
- `MAX_UNZIPPED_BYTES`
- `MAX_JOB_MS`
- `MAX_CONCURRENT_JOBS`
- `ALLOWED_ORIGINS`
- `ALLOW_FALLBACK_STITCH`
- `HUGIN_BIN_PATHS` (macOS app-bundle paths for Hugin CLI binaries)
- `HUGIN_STEP_TIMEOUT_MS` (таймаут одного шага Hugin)
- `KEEP_FAILED_TEMP` (сохранять temp при ошибке для дебага)
- `SKIP_TARGET_INDEXES` (например `36,37`)
- `SKIP_IMAGE_FILES` (например `img_0037.jpg,img_0038.jpg`)
- `SKIP_EXTREME_PITCH_ABS_DEG` (автоскип зенит/надир по pitch)
- `OUTPUT_WIDTH` / `OUTPUT_HEIGHT` (фиксированный размер equirect, например `3000x1500` для быстрых тестов)

## Примечание по production

Для реальной склейки нужны системные пакеты Hugin/Panorama Tools в image/host.
