import path from 'node:path';
import process from 'node:process';
import { VoiceConnectionStatus, entersState } from '@discordjs/voice';
import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { finalizeRecording, notifyN8n } from './finalize.js';
import { MeetingRecorder } from './recorder.js';

const config = {
  token: process.env.DISCORD_TOKEN,
  recordingsDir: path.resolve(process.env.RECORDINGS_DIR ?? './recordings'),
  webhookUrl: process.env.MEETING_ENDED_WEBHOOK_URL,
  minSegmentMs: Number(process.env.MIN_SEGMENT_MS ?? 700),
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

/** 서버 ID → 진행 중인 녹음 */
const recorders = new Map();

function formatDuration(ms) {
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes}분` : `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
}

async function finish(guildId) {
  const recorder = recorders.get(guildId);
  if (!recorder) return null;
  recorders.delete(guildId);

  const result = await recorder.stop();
  const { manifest, dropped } = await finalizeRecording(result, config);

  let n8nStatus;
  try {
    const { skipped } = await notifyN8n(config.webhookUrl, manifest);
    n8nStatus = skipped ? 'MEETING_ENDED_WEBHOOK_URL이 없어 n8n에는 보내지 않았습니다.' : 'n8n 회의록 워크플로에 넘겼습니다.';
  } catch (error) {
    n8nStatus = `n8n 전송에 실패했습니다(${error.message}). 녹음은 로컬에 남아 있습니다.`;
  }

  const duration = Date.parse(manifest.endedAt) - Date.parse(manifest.startedAt);
  return [
    `⏹️ 회의 녹음을 마쳤습니다. (${formatDuration(duration)}, 참석자 ${manifest.participants.length}명, 발화 ${manifest.segments.length}개, 짧아서 뺀 발화 ${dropped}개)`,
    `저장 위치: \`${recorder.dir}\``,
    n8nStatus,
  ].join('\n');
}

/** 연결이 끊기면 다시 붙어 보고, 안 되면 그때까지의 녹음이라도 마무리한다. */
function watchDisconnect(recorder) {
  recorder.connection.on('stateChange', async (_, newState) => {
    if (newState.status !== VoiceConnectionStatus.Disconnected || recorder.stopping) return;
    try {
      await Promise.race([
        entersState(recorder.connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(recorder.connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      const summary = await finish(recorder.guild.id);
      if (summary) await recorder.textChannel.send(`음성 연결이 끊겨 녹음을 자동으로 종료했습니다.\n${summary}`);
    }
  });
}

async function handleStart(interaction) {
  const voiceChannel = interaction.member.voice.channel;
  if (!voiceChannel) {
    await interaction.reply({ content: '음성 채널에 먼저 들어간 뒤 다시 실행해 주세요.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (recorders.has(interaction.guildId)) {
    await interaction.reply({ content: '이미 녹음 중입니다. `/회의녹음 종료`로 먼저 끝내 주세요.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();
  const recorder = new MeetingRecorder({
    guild: interaction.guild,
    voiceChannel,
    textChannel: interaction.channel,
    recordingsDir: config.recordingsDir,
  });
  recorders.set(interaction.guildId, recorder);

  try {
    await recorder.start();
  } catch (error) {
    recorders.delete(interaction.guildId);
    recorder.connection?.destroy();
    await interaction.editReply(`음성 채널에 들어가지 못했습니다: ${error.message}`);
    return;
  }

  watchDisconnect(recorder);
  await interaction.editReply(
    `🔴 **${voiceChannel.name}** 채널의 회의 녹음을 시작합니다.\n` +
      '말하는 사람별로 녹음되고, 회의록을 만들기 위해 음성 인식 API로 전송됩니다. 끝낼 때는 `/회의녹음 종료`를 입력해 주세요.',
  );
}

async function handleStop(interaction) {
  if (!recorders.has(interaction.guildId)) {
    await interaction.reply({ content: '진행 중인 녹음이 없습니다.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply();
  await interaction.editReply(await finish(interaction.guildId));
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.inCachedGuild() || !interaction.isChatInputCommand()) return;
  if (interaction.commandName !== '회의녹음') return;

  try {
    const sub = interaction.options.getSubcommand();
    if (sub === '시작') await handleStart(interaction);
    else if (sub === '종료') await handleStop(interaction);
  } catch (error) {
    console.error(error);
    const reply = { content: `오류가 났습니다: ${error.message}` };
    if (interaction.deferred || interaction.replied) await interaction.editReply(reply).catch(() => {});
    else await interaction.reply({ ...reply, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

// Ctrl+C로 봇을 끌 때도 진행 중인 녹음을 마무리한다.
process.once('SIGINT', async () => {
  for (const [guildId, recorder] of recorders) {
    const summary = await finish(guildId);
    if (summary) await recorder.textChannel.send(`봇을 종료해서 녹음을 마쳤습니다.\n${summary}`).catch(() => {});
  }
  client.destroy();
  process.exit(0);
});

client.once(Events.ClientReady, (c) => console.log(`${c.user.tag} 준비 완료. 녹음 저장 위치: ${config.recordingsDir}`));
client.on(Events.Error, console.error);

await client.login(config.token);
