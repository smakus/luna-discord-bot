
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
- A Discord bot token
- [LM Studio](https://lmstudio.ai) with a loaded model (required no matter what method of install you do)
- Docker for convenient install and running
- OPTIONAL, BUT RECOMMENDED (modify index.js as needed if you don't want web search):  A [Tavily](https://tavily.com) API key (free tier, for web search)

---

## Installation

### 1. Clone the repo

```bash
git clone https://github.com/yourname/luna-discord-bot
cd luna-discord-bot
```

## Docker Installation - Dockerfiles

When you clone the repo, you can find docerfiles in the dockerfiles subdirectory for each service if you want to run containerized these services via Docker.

For the Kokoro text to speech server, go to the dockerfiles subdirectory and create a kokoro-tts docker image.

Or to run Luna and Kokoro together as one Docker Compose group, just run the same command from the root directory that contains `docker-compose.yml` and both the Kokoro and Luna subdirectories.

From Root directory that contains `docker-compose.yml`:
```bash
docker compose up --build
```

### 2. Set up LM Studio (required for all installation methods)

1. Download and install [LM Studio](https://lmstudio.ai)
2. Download a model — recommended: **Qwen3.5 9B** or similar instruction-tuned model
3. Load the model and start the local server
4. Enable authentication in LM Studio settings and copy the bearer token
5. Enable MCP if you want web search (see `.env` setup below)

### 3. Create a Discord bot (required for all installation methods)

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

### 4. Configure environment variables

Create a `.env` file in the luna docker subdirectory (see example.env file):

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

### 5. Add a chime sound

Place a file named `chime.mp3` in the luna docker project root. This plays when Luna is activated. Any short MP3 will work — keep it under 2 seconds.

---

## Running Luna

**LM Studio:** 
Start LM Studio, load your model, and ensure the local server is running (green toggle in the Server tab).

Luna should already be running in Docker, but if not, start the Docker compose group that will run both the Kokoro and Luna Docker images.

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
Check the terminal logs in Docker — you should see `[userId] Processing Xms utterance...` when you speak. If not, `ENERGY_THRESHOLD` may be too high for your microphone. Try lowering it to `200`.

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

