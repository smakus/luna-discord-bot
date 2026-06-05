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
from fastapi.responses import Response
from pydantic import BaseModel
from kokoro import KPipeline
import soundfile as sf
import numpy as np
import io

app = FastAPI()

# 'a' = American English, 'b' = British English
pipeline = KPipeline(lang_code='a')

# Good female voices to try:
# af_bella, af_sarah, af_sky, af_nicole, af_heart
DEFAULT_VOICE = 'af_heart'

class TTSRequest(BaseModel):
    input: str
    voice: str = DEFAULT_VOICE
    speed: float = 1.0

@app.post("/v1/audio/speech")
async def text_to_speech(req: TTSRequest):
    try:
        generator = pipeline(req.input, voice=req.voice, speed=req.speed)

        # Collect all audio chunks
        audio_chunks = []
        for _, _, audio in generator:
            if audio is not None:
                audio_chunks.append(audio)

        if not audio_chunks:
            raise HTTPException(status_code=500, detail="No audio generated")

        combined = np.concatenate(audio_chunks)

        # Write as WAV to bytes
        buf = io.BytesIO()
        sf.write(buf, combined, 24000, format='WAV')
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