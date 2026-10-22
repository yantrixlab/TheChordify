# One container serves the site and the API on port 8000 (deploy with Coolify's Dockerfile build pack).

FROM node:22-slim AS web
WORKDIR /web
COPY absolute-ablation/package*.json ./
RUN npm ci
COPY absolute-ablation/ ./
RUN npm run build

FROM python:3.12-slim
# yt-dlp needs ffmpeg/ffprobe. Static binaries are ~130 MB versus ~470 MB and 200 packages from apt,
# which matters on a busy VPS. soundfile's wheel bundles libsndfile (with MP3), so no apt packages are needed.
COPY --from=mwader/static-ffmpeg:9.0.2 /ffmpeg /ffprobe /usr/local/bin/
WORKDIR /app/backend

COPY backend/requirements.txt ./
# torch is listed in requirements.txt; install the CPU-only wheel first so pip doesn't pull the CUDA build.
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt
# Trained song-structure model (optional: if it cannot install, sections fall back to the model-free analysis).
COPY backend/requirements-structure.txt ./
RUN pip install --no-cache-dir -r requirements-structure.txt || echo "structure model not installed"

COPY backend/ ./
RUN python scripts/fetch_models.py
COPY --from=web /web/dist ./static

# Job state lives in memory, so keep a single worker.
ENV CHORD_WORKERS=1
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]
