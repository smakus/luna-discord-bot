require('dotenv').config();
const { joinVoiceChannel, createAudioResource, StreamType, AudioPlayerStatus, VoiceConnectionStatus, createAudioPlayer, EndBehaviorType } = require('@discordjs/voice');
const { GatewayIntentBits } = require('discord-api-types/v10');
const { Events, Client } = require('discord.js');
const prism = require('prism-media');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Config ──────────────────────────────────────────────────────────────────

const WAKE_WORDS = ['luna', 'loona'];
const IGNORED_USERS = new Set(
  (process.env.IGNORED_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean)
);
const WHISPER_CLI = 'whisper-cli';
const WHISPER_MODEL = '/opt/homebrew/share/whisper-cli/models/ggml-small.en.bin';
const LM_STUDIO_URL = process.env.LM_STUDIO_URL;
const LM_SYSTEM_PROMPT = 'You are Luna, a helpful voice assistant in a Discord voice channel. The user will address you by saying "Luna" at the start of their message — ignore this prefix and just respond to the rest. Keep responses concise and conversational — no markdown, no bullet points, no emojis, just natural spoken sentences. Do not ask follow-up questions unless necessary for data.';
const KOKORO_URL = process.env.KOKORO_URL;
const KOKORO_VOICE = process.env.KOKORO_VOICE;

// ─── Discord client ───────────────────────────────────────────────────────────

const client = new Client({
  intents: [GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.Guilds],
});

let lmStudioModel = null;

async function resolveModel() {
  try {
    const res = await fetch(process.env.LM_STUDIO_URL.replace('/api/v1/chat', '/api/v1/models'), {
      headers: { 'Authorization': `Bearer ${process.env.LM_STUDIO_MCP_BEARER_TOKEN}` },
    });
    const data = await res.json();
    const loaded = data?.models?.find(m => m.type === 'llm' && m.loaded_instances?.length > 0);
    if (!loaded) throw new Error('No models loaded');
    lmStudioModel = loaded.loaded_instances[0].id;
    console.log(`Using LM Studio model: ${lmStudioModel}`);
  } catch (err) {
    console.error('Failed to resolve LM Studio model:', err.message);
    process.exit(1);
  }
}

client.on(Events.ClientReady, async () => {
  await resolveModel();
  console.log('Ready! Wake word: ' + WAKE_WORDS[0]);
});

client.on(Events.MessageCreate, async message => {
  if (message.content.toLowerCase() === '!' + WAKE_WORDS[0]) {
    const channel = message.member.voice.channel;
    if (!channel) return message.reply('You need to join a voice channel first!');

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator,
    });

    connection.on(VoiceConnectionStatus.Ready, () => {
      message.reply(`Joined **${channel.name}**!  Say "${WAKE_WORDS[0]}" to wake me up.  Also, you can say "${WAKE_WORDS[0]}, play song ___" to play music.`);
      activeConnection = connection;
      activeVoiceChannel = channel;
      startListening(connection, message.channel);

      // Subscribe to users already in the channel at join time
      channel.members.forEach(member => {
        if (member.user.bot) return;
        if (IGNORED_USERS.has(member.id)) return;
        if (listeningUsers.has(member.id)) return;
        listeningUsers.add(member.id);
        continuousCapture(connection, member.id, message.channel);
      });
    });
  }
});

// ─── Core listening loop ──────────────────────────────────────────────────────

const listeningUsers = new Set();

// ─── Empty channel disconnect ─────────────────────────────────────────────────

let activeConnection = null;
let activeVoiceChannel = null;

function getRealMemberCount(voiceChannel) {
  if (!voiceChannel) return 0;
  return voiceChannel.members.filter(m => !m.user.bot && !IGNORED_USERS.has(m.id)).size;
}

function startListening(connection, channel) {
  connection.receiver.speaking.on('start', (userId) => {
    if (listeningUsers.has(userId)) return;
    if (userId === client.user.id) return; // ignore bot's own audio
    if (IGNORED_USERS.has(userId)) return; // ignore configured bots/users
    listeningUsers.add(userId);
    continuousCapture(connection, userId, channel);
  });
}

const SILENCE_MS = 1500;      // ms of silence before utterance is considered done
const ENERGY_THRESHOLD = 500; // minimum avg sample amplitude to count as speech
const MIN_SPEECH_MS = 300;    // ignore utterances shorter than this (noise/clicks)

function hasEnergy(chunk) {
  let sum = 0;
  for (let i = 0; i < chunk.length - 1; i += 2) {
    sum += Math.abs(chunk.readInt16LE(i));
  }
  return (sum / (chunk.length / 2)) > ENERGY_THRESHOLD;
}

function continuousCapture(connection, userId, channel) {
  const audioStream = connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 60000 },
  });

  const decoder = new prism.opus.Decoder({ rate: 48000, channels: 1, frameSize: 960 });
  audioStream.setMaxListeners(20);
  audioStream.pipe(decoder);
  decoder.on('error', () => {}); // ignore corrupted Opus packets

  let speechChunks = [];
  let silenceTimer = null;
  let speaking = false;
  let speechStartTime = null;

  let flushing = false;
  function flushUtterance() {
    silenceTimer = null;
    if (flushing || speechChunks.length === 0) return;
    flushing = true;

    const pcm = Buffer.concat(speechChunks);
    speechChunks = [];
    speaking = false;

    const durationMs = (pcm.length / 2 / 48000) * 1000;
    if (durationMs < MIN_SPEECH_MS) {
      flushing = false;
      return;
    }

    console.log(`[${userId}] Processing ${Math.round(durationMs)}ms utterance...`);
    processUtterance(pcm, userId, connection, channel).finally(() => { flushing = false; });
  }

  decoder.on('data', chunk => {
    // Don't collect audio while we're processing/responding
    if (processingUsers.has(userId)) return;
    if (hasEnergy(chunk)) {
      if (!speaking) {
        speaking = true;
        console.log(`[${userId}] Speech started`);
      }
      speechChunks.push(chunk);
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(flushUtterance, SILENCE_MS);
    } else if (speaking) {
      speechChunks.push(chunk);
    }
  });

  // Discord stops sending Opus packets when truly silent — track real time elapsed
  // and flush if we've been speaking and no data arrives for SILENCE_MS
  let lastDataTime = Date.now();
  const dataWatchdog = setInterval(() => {
    if (processingUsers.has(userId)) {
      // Reset state while this user is being processed
      speaking = false;
      speechChunks = [];
      lastDataTime = Date.now();
      return;
    }
    if (speaking && Date.now() - lastDataTime > SILENCE_MS) {
      flushUtterance();
    }
  }, 100);

  decoder.on('data', () => { lastDataTime = Date.now(); });

  audioStream.once('close', () => {
    clearInterval(dataWatchdog);
    if (silenceTimer) clearTimeout(silenceTimer);
    listeningUsers.delete(userId);
    // Stream closed — speaking.start will re-trigger continuousCapture next time user speaks
  });

  audioStream.once('error', (err) => {
    console.error(`[${userId}] Stream error:`, err);
    clearInterval(dataWatchdog);
    if (silenceTimer) clearTimeout(silenceTimer);
    listeningUsers.delete(userId);
  });
}

const processingUsers = new Set(); // tracks who is currently being transcribed/responded to

// ─── Playback queue ───────────────────────────────────────────────────────────
// Serializes TTS responses so multiple users don't fight over the voice channel
let playbackQueue = Promise.resolve();

function queuePlayback(fn) {
  playbackQueue = playbackQueue.then(fn).catch(() => {});
  return playbackQueue;
}



function writeWav(filePath, pcmData, sampleRate, channels, bitDepth) {
  const byteRate = sampleRate * channels * (bitDepth / 8);
  const blockAlign = channels * (bitDepth / 8);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmData.length, 4);  // file size - 8
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);                   // fmt chunk size
  header.writeUInt16LE(1, 20);                    // PCM format
  header.writeUInt16LE(channels, 22);             // num channels
  header.writeUInt32LE(sampleRate, 24);           // sample rate (was 26 — off by 2!)
  header.writeUInt32LE(byteRate, 28);             // byte rate
  header.writeUInt16LE(blockAlign, 32);           // block align
  header.writeUInt16LE(bitDepth, 34);             // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcmData.length, 40);       // data chunk size
  fs.writeFileSync(filePath, Buffer.concat([header, pcmData]));
}

function transcribeWithWhisper(wavPath) {
  return new Promise((resolve, reject) => {
    const proc = execFile(
      WHISPER_CLI,
      ['-m', WHISPER_MODEL, '-f', wavPath],
      { timeout: 15000 }, // kill if whisper hangs for 15s
      (error, stdout, stderr) => {
        if (error) {
          console.error('Whisper error:', error.message);
          return resolve(null); // resolve null instead of reject to keep bot running
        }
        const lines = stdout.split('\n')
          .map(l => l.replace(/\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\]\s*/g, '').trim())
          .filter(l => l && l !== '[BLANK_AUDIO]');
        resolve(lines.join(' ').trim() || null);
      }
    );
  });
}

async function processUtterance(pcm, userId, connection, channel) {
  // Per-user lock — prevents same user from stacking up multiple transcriptions
  if (processingUsers.has(userId)) return;
  processingUsers.add(userId);

  const wav16Path = `/tmp/discordai_${userId}_${Date.now()}_16k.wav`;
  try {
    writeWav(wav16Path, pcm, 48000, 1, 16);
    const transcript = await transcribeWithWhisper(wav16Path);
    fs.unlinkSync(wav16Path);
    if (!transcript) return;

    const lower = transcript.toLowerCase().trim();
    // Check if transcript starts with or contains wake word near the beginning
    const startsWithWake = WAKE_WORDS.some(w => {
      const idx = lower.indexOf(w);
      return idx !== -1 && idx < 6; // allow up to 5 chars before wake word (e.g. leading space/punct)
    });
    if (!startsWithWake) return;

    console.log(`[${userId}] Query:`, transcript);
    await handleQuery(transcript, connection, channel);
  } catch (err) {
    console.error(`[${userId}] Error processing utterance:`, err);
    try { fs.unlinkSync(wav16Path); } catch (_) {}
  } finally {
    processingUsers.delete(userId);
  }
}


async function playSound(filePath, connection) {
  try {
    const player = createAudioPlayer();
    const resource = createAudioResource(filePath, { inputType: StreamType.Arbitrary, inlineVolume: true });
    resource.volume?.setVolume(0.2);
    connection.subscribe(player);
    player.play(resource);
    await new Promise(resolve => {
      player.on(AudioPlayerStatus.Idle, () => { player.stop(); resolve(); });
      player.on('error', () => resolve()); // don't block if file missing
      setTimeout(resolve, 5000); // safety timeout
    });
  } catch (_) {}
}

function extractSmakbotCommand(query) {
  const match = query.match(/play(?:\s+the)?\s+song[,.]?\s*(.+)/i);
  console.log(`play song regex test on: "${query}" → match: ${match ? match[1] : 'null'}`);
  if (match) {
    return match[1].trim().replace(/[,.]+$/, '');
  }
  return null;
}

async function handleQuery(query, connection, channel) {
  // Check for smakbot music command first
  const songRequest = extractSmakbotCommand(query);
  if (songRequest) {
    console.log(`Smakbot command: !play ${songRequest}`);
    await channel.send(`!play ${songRequest}`).catch(err => console.error('Failed to send play music command:', err.message));
    await queuePlayback(() => speakResponse(`Okay, playing ${songRequest}.`, connection));
    return;
  }

  // Play chime and send status simultaneously
  const [_, statusMsg] = await Promise.all([
    playSound('./chime.mp3', connection),
    channel.send('🤔 *Luna is thinking...*').catch(() => null),
  ]);

  const response = await getLMStudioResponse(query);
  console.log('Luna:', response);

  try { if (statusMsg) await statusMsg.delete(); } catch (_) {}

  // Queue playback so multiple users don't play audio simultaneously
  await queuePlayback(() => speakResponse(response, connection));
}

// ─── Intent detection ────────────────────────────────────────────────────────

const SEARCH_KEYWORDS = [
  // time-sensitive
  'today', 'tonight', 'yesterday', 'tomorrow', 'this week', 'this month',
  'right now', 'currently', 'current', 'latest', 'recent',
  // factual lookups
  'price', 'cost', 'weather', 'forecast', 'temperature',
  'news', 'score', 'result', 'standing', 'ranking',
  'stock', 'crypto', 'bitcoin', 'market',
  // question patterns that imply real-world data
  'who is', 'who are', 'who won', 'who plays',
  'what happened', 'what time is',
  'when is', 'when does', 'when did',
  'where is', 'where are',
  'how much does', 'how much is',
  'is there a',
];

function needsWebSearch(query) {
  const lower = query.toLowerCase();
  return SEARCH_KEYWORDS.some(k => lower.includes(k));
}

// Conversation memory via response_id chaining
let previousResponseId = null;

async function getLMStudioResponse(text) {
  const useSearch = needsWebSearch(text);
  const body = {
    model: lmStudioModel,
    input: text,
    ...(useSearch && {
      integrations: [
        {
          type: 'ephemeral_mcp',
          server_label: 'tavily',
          server_url: `https://mcp.tavily.com/mcp/?tavilyApiKey=${process.env.TAVILY_API_KEY}`,
        }
      ],
    }),
  };

  // Chain conversation via previous_response_id instead of managing history array
  if (previousResponseId) {
    body.previous_response_id = previousResponseId;
  } else {
    body.system_prompt = LM_SYSTEM_PROMPT;
  }

  try {
    const res = await fetch(LM_STUDIO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.LM_STUDIO_MCP_BEARER_TOKEN}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`LM Studio ${res.status}: ${await res.text()}`);
    const data = await res.json();

    // Store response_id for conversation chaining
    if (data.response_id) previousResponseId = data.response_id;

    // Extract the message content — last output item with type 'message'
    const messageItem = data.output?.filter(o => o.type === 'message').pop();
    const reply = messageItem?.content?.trim();
    if (!reply) throw new Error('No message content in response');

    return reply;
  } catch (error) {
    console.error('LM Studio error:', error);
    return 'I am having trouble processing that right now.';
  }
}

// ─── ElevenLabs TTS ──────────────────────────────────────────────────────────

async function speakResponse(text, connection) {
  const audioPath = await convertTextToSpeech(text);
  if (!audioPath) return;
  try {
    const player = createAudioPlayer();
    const resource = createAudioResource(audioPath);
    connection.subscribe(player);
    player.play(resource);

    await new Promise((resolve, reject) => {
      player.on(AudioPlayerStatus.Idle, () => { player.stop(); resolve(); });
      player.on('error', err => { console.error('Player error:', err); reject(err); });
      setTimeout(resolve, 30000); // safety timeout
    });
  } catch (err) {
    console.error('speakResponse error:', err);
  } finally {
    try { fs.unlinkSync(audioPath); } catch (_) {}
  }
}

async function convertTextToSpeech(text) {
  const fileName = `${Date.now()}.wav`;
  try {
    const res = await fetch(KOKORO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: text, voice: KOKORO_VOICE }),
    });

    if (!res.ok) {
      console.error(`Kokoro error ${res.status}:`, await res.text());
      return null;
    }

    fs.writeFileSync(fileName, Buffer.from(await res.arrayBuffer()));
    return fileName;
  } catch (error) {
    console.error('TTS error:', error);
    return null;
  }
}

client.on(Events.Error, console.warn);

// Disconnect when the last real user (non-bot, non-ignored) leaves
client.on(Events.VoiceStateUpdate, (oldState, _newState) => {
  if (!activeVoiceChannel || oldState.channelId !== activeVoiceChannel.id) return;
  if (getRealMemberCount(activeVoiceChannel) === 0) {
    console.log('[voice] Last real user left — disconnecting.');
    activeConnection.destroy();
    activeConnection = null;
    activeVoiceChannel = null;
    listeningUsers.clear();
  }
});
void client.login(process.env.DISCORD_TOKEN);