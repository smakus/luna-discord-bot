FROM node:20-alpine

RUN apk add --no-cache ffmpeg curl cmake make g++ git

WORKDIR /app

RUN git clone https://github.com/ggerganov/whisper.cpp /whisper && \
    cd /whisper && cmake -B build && cmake --build build --target whisper-cli -j4

RUN mkdir -p /opt/whisper/models && \
    curl -L https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin \
    -o /opt/whisper/models/ggml-small.en.bin

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

CMD ["node", "index.js"]
