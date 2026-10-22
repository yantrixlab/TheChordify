# One container serves the site and the API on port 8000 (deploy with Coolify's Dockerfile build pack).
#
# The stages run one after the other on purpose: the Python image first (large downloads), then the website build.
# BuildKit would otherwise run `npm ci` and the PyTorch download at the same time, and on a small VPS that
# has dropped connections mid-download ("Broken pipe"). Downloads are retried for the same reason.

FROM python:3.12-slim AS app
# yt-dlp needs ffmpeg/ffprobe. Static binaries are ~130 MB versus ~470 MB and 200 packages from apt,
# which matters on a busy VPS. soundfile's wheel bundles libsndfile (with MP3), so no apt packages are needed.
COPY --from=mwader/static-ffmpeg:9.0.2 /ffmpeg /ffprobe /usr/local/bin/
# yt-dlp runs YouTube's player scripts in a JavaScript runtime; reuse the Node binary from the image that builds the site.
COPY --from=node:22-slim /usr/local/bin/node /usr/local/bin/node
WORKDIR /app/backend

# torch is the big download (~200 MB) and never changes, so it is its own layer, ahead of anything that does: editing
# requirements.txt then reinstalls only the small packages instead of the whole thing. It is the CPU-only wheel, so pip
# doesn't pull the CUDA build.
RUN for i in 1 2 3 4 5; do \
      pip install --no-cache-dir --retries 10 --timeout 60 torch torchaudio --index-url https://download.pytorch.org/whl/cpu && break; \
      [ "$i" = 5 ] && exit 1; echo "download failed, retrying ($i)"; sleep 5; \
    done
COPY backend/requirements.txt ./
RUN for i in 1 2 3; do \
      pip install --no-cache-dir --retries 10 --timeout 60 -r requirements.txt && break; \
      [ "$i" = 3 ] && exit 1; echo "download failed, retrying ($i)"; sleep 5; \
    done
# Trained song-structure model (optional: if it cannot install, sections fall back to the model-free analysis).
COPY backend/requirements-structure.txt ./
RUN for i in 1 2 3; do \
      pip install --no-cache-dir --retries 10 --timeout 60 -r requirements-structure.txt && break; \
      [ "$i" = 3 ] && echo "structure model not installed"; sleep 5; \
    done; true

COPY backend/ ./
RUN for i in 1 2 3; do python scripts/fetch_models.py && break; [ "$i" = 3 ] && exit 1; sleep 5; done

FROM node:22-slim AS web
# Only here to make this stage wait until the Python image above is finished (see the note at the top).
COPY --from=app /usr/local/bin/ffprobe /tmp/wait-for-app
WORKDIR /web
COPY absolute-ablation/package*.json ./
RUN npm ci --fetch-retries=5
COPY absolute-ablation/ ./
RUN npm run build

FROM app
COPY --from=web /web/dist ./static

# Saved results, uploads and the song catalog (songs.db) live in /data. Mount a persistent volume there in Coolify
# (Storage -> add -> destination /data), or every redeploy starts with an empty catalog and re-analyses every song.
ENV DATA_DIR=/data
RUN mkdir -p /data

# Job state lives in memory, so keep a single worker.
ENV CHORD_WORKERS=1
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]
