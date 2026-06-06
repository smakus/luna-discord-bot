
# Luna — Discord AI Voice Assistant

Luna is a locally-hosted AI voice assistant for Discord. She listens for her wake word, transcribes speech using Whisper, generates responses via LM Studio, and speaks back using Kokoro TTS — all running on your own machine with no cloud AI dependencies.

## Features

- 🎤 Wake word detection — say "Luna" to activate (configurable)
- 🧠 Local LLM via LM Studio with conversation memory
- 🔊 Local TTS via Kokoro (high quality, low latency)
- 🌐 Optional web search via Tavily MCP
- 👥 Multi-user support with serialized playback queue
- 🔇 Configurable ignored users (e.g. music bots)

---

## Requirements

- macOS or Linux
- Docker for convenient install and running, otherwise:
- Node.js 18+
- Python 3.12 (exactly — Kokoro requires `<3.13`)
- [LM Studio](https://lmstudio.ai) with a loaded model (required no matter what method of install you do)
- [whisper-cli](https://github.com/ggerganov/whisper.cpp) (`brew install whisper-cpp` on Mac)
- [espeak-ng](https://github.com/espeak-ng/espeak-ng) (`brew install espeak-ng` on Mac)
- A Discord bot token
- OPTIONAL, BUT RECOMMENDED (modify index.js as needed if you don't want web search):  A [Tavily](https://tavily.com) API key (free tier, for web search)

---

## Installation (for Docker install, see Convenience section)

### 1. Clone the repo

```bash
git clone https://github.com/yourname/luna-discord-bot
cd luna-discord-bot
```

### 2. Install Node dependencies (non-Docker only)

```bash
npm install
```

The required packages are:

```
discord.js
discord-api-types
@discordjs/voice
prism-media
dotenv
```

You will also need the following native dependencies for `@discordjs/voice` to handle audio encoding:

```bash
npm install @discordjs/opus sodium-native
```

> **Linux only:** you may also need `apt install ffmpeg libsodium-dev`

### 3. Install whisper-cli and download a model (non-Docker only)

**macOS:**
```bash
brew install whisper-cpp
mkdir -p /opt/homebrew/share/whisper-cli/models
curl -L -o /opt/homebrew/share/whisper-cli/models/ggml-small.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin
```

**Linux:**
```bash
# Build from source
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp && make
# Download model
bash models/download-ggml-model.sh small.en
```

> Update `WHISPER_MODEL` in `index.js` if your model path differs from the default.

Test that Whisper works:
```bash
whisper-cli -m /opt/homebrew/share/whisper-cli/models/ggml-small.en.bin --help
```

### 4. Set up the Kokoro TTS server (non-Docker only)

Kokoro requires Python 3.12 exactly.

```bash
# Create a Python 3.12 virtual environment
python3.12 -m venv ~/kokoro-env312
source ~/kokoro-env312/bin/activate

# Install dependencies
pip install "kokoro>=0.9.4" soundfile fastapi uvicorn

# Install espeak-ng (required for text-to-phoneme)
brew install espeak-ng        # macOS
# sudo apt install espeak-ng  # Linux
```

Copy `kokoro_server.py` into your project folder. The first run will automatically download the Kokoro model (~300MB from HuggingFace).

### 5. Set up LM Studio (required for all installation methods)

1. Download and install [LM Studio](https://lmstudio.ai)
2. Download a model — recommended: **Qwen3.5 9B** or similar instruction-tuned model
3. Load the model and start the local server
4. Enable authentication in LM Studio settings and copy the bearer token
5. Enable MCP if you want web search (see `.env` setup below)

### 6. Create a Discord bot (required for all installation methods)

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application and add a bot
3. Under **Privileged Gateway Intents**, enable:
   - Server Members Intent
   - Message Content Intent
   - Voice States
4. Copy the bot token
5. Invite the bot to your server with the following permissions:
   - Read Messages / View Channels
   - Send Messages
   - Connect
   - Speak
   - Use Voice Activity

### 7. Configure environment variables (required for all installation methods)

Create a `.env` file in the project root (see example.env file):

```env
# Discord
DISCORD_TOKEN=your_discord_bot_token

# LM Studio
LM_STUDIO_URL=http://127.0.0.1:1234/api/v1/chat
LM_STUDIO_MCP_BEARER_TOKEN=your_lm_studio_bearer_token

# Kokoro TTS
KOKORO_URL=http://localhost:8880/v1/audio/speech
KOKORO_VOICE=af_heart

# Tavily web search (optional)
TAVILY_API_KEY=your_tavily_api_key

# Comma-separated Discord user IDs to ignore (e.g. music bots)
IGNORED_USER_IDS=
```

**Available Kokoro voices:**
| Voice | Description |
|-------|-------------|
| `af_heart` | American female (warm) |
| `af_sarah` | American female (clear) |
| `af_bella` | American female (expressive) |
| `af_sky` | American female (bright) |
| `bf_emma` | British female |
| `bf_isabella` | British female (formal) |

### 8. Add a chime sound

Place a file named `chime.mp3` in the project root. This plays when Luna is activated. Any short MP3 will work — keep it under 2 seconds.

---

## Running Luna (non-Docker only)

You need three processes running simultaneously. Open three terminal windows (Or two terminal windows, and one app window for LM Studio):

**Terminal 1 — Kokoro TTS server:** (non-Docker only)
```bash
source ~/kokoro-env312/bin/activate
python3 kokoro_server.py
```

**Terminal 2 (or App window) — LM Studio:** (required for all installation methods)
Start LM Studio, load your model, and ensure the local server is running (green toggle in the Server tab).

**Terminal 3 — Luna bot:** (non-Docker only)
```bash
npm start
```

You should see:
```
Using LM Studio model: qwen/qwen3.5-9b
Ready! Wake word: luna
```

---

## Usage

1. Join a Discord voice channel
2. In any text channel, type `!luna`
3. Luna will join your voice channel
4. Say **"Luna"** followed by your question or command

**Examples:**
- *"Luna, what's the weather today?"* — triggers web search
- *"Luna, tell me a joke"* — direct LLM response
- *"Luna, what did I just ask you?"* — uses conversation memory

---

## Project Structure

```
luna-discord-bot/
├── index.js          # Main bot (Node.js)
├── kokoro_server.py  # Local TTS server (Python)
├── chime.mp3         # Wake word activation sound
├── .env              # Environment variables (not committed)
├── package.json
└── README.md
```

---

## Tuning

The following constants at the top of `index.js` can be adjusted:

| Constant | Default | Description |
|----------|---------|-------------|
| `WAKE_WORDS` | `['luna', 'loona']` | Wake word variants to listen for |
| `SILENCE_MS` | `1500` | ms of silence before processing utterance |
| `ENERGY_THRESHOLD` | `500` | Minimum audio energy to count as speech |
| `MIN_SPEECH_MS` | `300` | Minimum utterance length to process |

---

## Troubleshooting

**Luna doesn't respond to the wake word**
Check the terminal logs — you should see `[userId] Processing Xms utterance...` when you speak. If not, `ENERGY_THRESHOLD` may be too high for your microphone. Try lowering it to `200`.

**Whisper returns empty transcripts**
Ensure the model file exists at the path set in `WHISPER_MODEL`. Run a manual test:
```bash
whisper-cli -m /opt/homebrew/share/whisper-cli/models/ggml-small.en.bin -f /tmp/test.wav
```

**Kokoro TTS not working**
Test the server directly:
```bash
curl -X POST http://localhost:8880/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"input": "Hello, I am Luna."}' \
  --output test.wav && afplay test.wav
```

**LM Studio not responding**
Ensure a model is loaded and the server is running. Test:
```bash
curl http://127.0.0.1:1234/api/v1/models \
  -H "Authorization: Bearer $LM_STUDIO_MCP_BEARER_TOKEN"
```

**No audio in voice channel**
Make sure the bot has **Connect** and **Speak** permissions in your Discord server.

---

## Convenience - Docker Installation - Dockerfiles

When you clone the repo, you can find docerfiles in the dockerfiles subdirectory for each service if you want to run containerized these services via Docker.

For the Kokoro text to speech server, go to the dockerfiles subdirectory and create a kokoro-tts docker image.

Or to run Luna and Kokoro together as one Docker Compose group, just run the same command from the root directory that contains `docker-compose.yml` and both the Kokoro and Luna subdirectories.

From Root directory that contains `docker-compose.yml`:
```bash
docker compose up --build
```

## Advanced — Red-DiscordBot Music Integration (VoiceBridge)

If you run [Red-DiscordBot](https://github.com/Cog-Creators/Red-DiscordBot) with the Audio cog in the same server, you can give Luna the ability to control music playback by saying *"Luna, play song [song name]"*.

### How it works

Luna detects the phrase "play song" in a query, extracts the song name, and posts `!play <song>` to the text channel. Because Discord bots ignore messages from other bots by default, a small Red cog called **VoiceBridge** is needed to bridge the gap — it whitelists Luna's user ID and relays the command to Red's Audio cog.

### Setup

**1. Get Luna's Discord user ID**

Right-click Luna in Discord (with Developer Mode enabled) and copy her user ID.

**2. Install the VoiceBridge cog**

Copy the `voicebridge/` folder (containing `__init__.py` and `voicebridge.py`) into your Red-DiscordBot cogs directory:

```bash
cp -r voicebridge/ /path/to/redbot/cogs/voicebridge/
```

**3. Update the bot ID**

In `voicebridge.py`, replace `AI_BOT_ID` with Luna's actual Discord user ID:

```python
AI_BOT_ID = 123456789012345678  # Luna's Discord user ID
```

**4. Load the cog in Red**

```
[p]load voicebridge
```

**5. Usage**

Say: *"Luna, play song Bohemian Rhapsody"*

Luna will post `!play Bohemian Rhapsody` to the text channel, VoiceBridge will intercept it and invoke Red's Audio cog, and music will start playing.

> The trigger phrase is somewhat flexible — variants are mostly handled by the regex in `index.js`.

---

## License

MIT

