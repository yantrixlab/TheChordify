# One container serves the site and the API on port 8000 (deploy with Coolify's Dockerfile build pack).

FROM node:22-slim AS web
WORKDIR /web
COPY absolute-ablation/package*.json ./
RUN npm ci
COPY absolute-ablation/ ./
RUN npm run build

FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend

COPY backend/requirements.txt ./
# torch is listed in requirements.txt; install the CPU-only wheel first so pip doesn't pull the CUDA build.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
RUN python scripts/fetch_models.py
COPY --from=web /web/dist ./static

# Job state lives in memory, so keep a single worker.
ENV CHORD_WORKERS=2
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]
