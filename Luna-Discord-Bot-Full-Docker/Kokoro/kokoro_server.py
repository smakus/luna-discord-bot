#!/usr/bin/env python3
"""
Kokoro TTS server — OpenAI-compatible /v1/audio/speech endpoint
Setup:
  source ~/kokoro-env/bin/activate
  pip install kokoro>=0.9.4 soundfile fastapi uvicorn
  apt-get install espeak-ng  # or: brew install espeak-ng
Run: python3 kokoro_server.py
"""
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from kokoro import KPipeline
import soundfile as sf
import numpy as np
import io
import struct

app = FastAPI()

# 'a' = American English, 'b' = British English
pipeline = KPipeline(lang_code='a')

# Good female voices to try:
# af_bella, af_sarah, af_sky, af_nicole, af_heart
DEFAULT_VOICE = 'af_heart'

SAMPLE_RATE = 24000

class TTSRequest(BaseModel):
    input: str
    voice: str = DEFAULT_VOICE
    speed: float = 1.0
    stream: bool = False

def make_wav_header(sample_rate: int, num_channels: int = 1, bits_per_sample: int = 16) -> bytes:
    """
    Build a WAV header with an unknown data size (0xFFFFFFFF).
    This is the standard trick for streaming WAV — players start decoding
    immediately without needing to know the total file size up front.
    """
    byte_rate    = sample_rate * num_channels * bits_per_sample // 8
    block_align  = num_channels * bits_per_sample // 8
    # Use max uint32 for sizes since we don't know them yet
    data_size    = 0xFFFFFFFF
    riff_size    = 0xFFFFFFFF

    header = struct.pack('<4sI4s', b'RIFF', riff_size, b'WAVE')
    fmt    = struct.pack('<4sIHHIIHH',
        b'fmt ', 16,            # chunk size
        1,                      # PCM format
        num_channels,
        sample_rate,
        byte_rate,
        block_align,
        bits_per_sample,
    )
    data   = struct.pack('<4sI', b'data', data_size)
    return header + fmt + data

def pcm_chunk(audio) -> bytes:
    """Convert float32 Tensor or numpy array to int16 PCM bytes."""
    import torch
    if isinstance(audio, torch.Tensor):
        audio = audio.detach().cpu().numpy()
    clipped = np.clip(audio, -1.0, 1.0)
    return (clipped * 32767).astype(np.int16).tobytes()

async def stream_audio(input_text: str, voice: str, speed: float):
    """
    Async generator that yields WAV header then PCM chunks as Kokoro produces them.
    The client (Node.js PassThrough) starts receiving and playing audio
    before Kokoro has finished generating the full response.
    Must be async so FastAPI's StreamingResponse doesn't block the event loop.
    """
    yield make_wav_header(SAMPLE_RATE)

    generator = pipeline(input_text, voice=voice, speed=speed)
    for _, _, audio in generator:
        if audio is not None:
            yield pcm_chunk(audio)

@app.post("/v1/audio/speech")
async def text_to_speech(req: TTSRequest):
    try:
        # ── Streaming mode ────────────────────────────────────────────────────
        # Returns WAV header + PCM chunks as they're generated.
        # Node.js receives and plays audio before generation is complete,
        # eliminating the wait-for-full-audio latency.
        if req.stream:
            return StreamingResponse(
                stream_audio(req.input, req.voice, req.speed),
                media_type="audio/wav",
            )

        # ── Non-streaming mode (original behaviour) ───────────────────────────
        generator = pipeline(req.input, voice=req.voice, speed=req.speed)
        audio_chunks = []
        for _, _, audio in generator:
            if audio is not None:
                audio_chunks.append(audio)

        if not audio_chunks:
            raise HTTPException(status_code=500, detail="No audio generated")

        combined = np.concatenate(audio_chunks)
        buf = io.BytesIO()
        sf.write(buf, combined, SAMPLE_RATE, format='WAV')
        buf.seek(0)
        return Response(content=buf.read(), media_type="audio/wav")

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
def health():
    return {"status": "ok", "voice": DEFAULT_VOICE}

if __name__ == "__main__":
    import uvicorn
    print(f"Starting Kokoro TTS server on http://localhost:8880")
    print(f"Default voice: {DEFAULT_VOICE}")
    uvicorn.run(app, host="0.0.0.0", port=8880)
