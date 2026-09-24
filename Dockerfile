FROM node:20-slim

# ffmpeg (includes ffprobe) from Debian's repos — full codec support
# (libx264, aac, atempo, zoompan) with no extra build steps.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Bake the TTS model into the image now, in a clean build environment,
# instead of downloading it on the first real request. Change this value
# (and redeploy, which rebuilds the image) if you want a different quality
# level — it must match what the app actually uses at runtime.
ENV KOKORO_DTYPE=q4
RUN node scripts/prefetch-model.js

ENV PORT=10000
EXPOSE 10000

CMD ["node", "server.js"]
