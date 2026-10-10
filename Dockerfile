# Oracle Always Free(Ampere A1, arm64)와 Apple Silicon에서 같은 이미지가 돈다.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
# node-crc는 설치할 때 node-gyp로 빌드한다.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/* \
  && mkdir /recordings && chown node:node /recordings
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
USER node
ENV RECORDINGS_DIR=/recordings
CMD ["node", "src/index.js"]
