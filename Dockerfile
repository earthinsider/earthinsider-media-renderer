FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg python3 python3-pip fonts-liberation && \
    (apt-get install -y --no-install-recommends fonts-montserrat || true) && \
    pip3 install "edge-tts>=7.3.1" --break-system-packages && \
    fc-cache -f && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=10000
EXPOSE 10000

CMD ["node", "server.js"]
