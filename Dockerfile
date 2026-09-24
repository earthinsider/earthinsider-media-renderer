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

ENV PORT=10000
EXPOSE 10000

CMD ["node", "server.js"]
