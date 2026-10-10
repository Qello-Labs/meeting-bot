import path from 'node:path';
import process from 'node:process';
import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { finalizeRecording, notifyN8n } from './finalize.js';
import { MeetingRecorder } from './recorder.js';
import { findUnfinished, readState } from './state.js';

const config = {
  token: process.env.DISCORD_TOKEN,
  recordingsDir: path.resolve(process.env.RECORDINGS_DIR ?? './recordings'),
  webhookUrl: process.env.MEETING_ENDED_WEBHOOK_URL,
  minSegmentMs: Number(process.env.MIN_SEGMENT_MS ?? 700),
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

// 봇이 재시작된 뒤 이 시간 안이면 끝나지 않은 회의를 이어 간다. 더 지났으면 회의가 끝났을 수 있으므로
// 음성 채널에 다시 들어가지 않고 그때까지의 녹음으로 마무리한다.
const RESUME_WINDOW_MS = 10 * 60_000;

/** 서버 ID → 진행 중인 녹음 */
const recorders = new Map();

function send(recorder, text) {
  return recorder.textChannel?.send(text).catch((error) => console.warn(`채널 알림 실패: ${error.message}`));
}

function formatDuration(ms) {
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes}분` : `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
}

async function finish(guildId) {
  const recorder = recorders.get(guildId);
  if (!recorder) return null;
  recorders.delete(guildId);

  const result = await recorder.stop();
  if (!result) return null;
  const { manifest, dropped } = await finalizeRecording(result, config);

  let n8nStatus;
  try {
    const { skipped } = await notifyN8n(config.webhookUrl, manifest);
    n8nStatus = skipped ? 'MEETING_ENDED_WEBHOOK_URL이 없어 n8n에는 보내지 않았습니다.' : 'n8n 회의록 워크플로에 넘겼습니다.';
  } catch (error) {
    n8nStatus = `n8n 전송에 실패했습니다(${error.message}). 녹음은 로컬에 남아 있습니다.`;
  }

  const duration = Date.parse(manifest.endedAt) - Date.parse(manifest.startedAt);
  const gapMs = manifest.gaps.reduce((sum, g) => sum + (g.endMs - g.startMs), 0);
  const gapText = manifest.gaps.length ? `, 끊긴 구간 ${manifest.gaps.length}번 약 ${Math.round(gapMs / 1000)}초` : '';
  return [
    `⏹️ 회의 녹음을 마쳤습니다. (${formatDuration(duration)}, 참석자 ${manifest.participants.length}명, 발화 ${manifest.segments.length}개, 짧아서 뺀 발화 ${dropped}개${gapText})`,
    `저장 위치: \`${recorder.dir}\``,
    n8nStatus,
  ].join('\n');
}

/** 녹음 객체의 알림을 회의 채널로 보내고, 음성 채널이 삭제되면 그때까지의 녹음으로 마무리한다. */
function track(recorder) {
  recorders.set(recorder.guild.id, recorder);
  recorder.on('notice', (text) => send(recorder, text));
  recorder.on('channelDeleted', async () => {
    const summary = await finish(recorder.guild.id);
    if (summary) await send(recorder, `음성 채널이 삭제되어 그때까지의 녹음으로 회의를 마쳤습니다.\n${summary}`);
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
  track(recorder);

  try {
    await recorder.start();
  } catch (error) {
    recorders.delete(interaction.guildId);
    recorder.connection?.destroy();
    await interaction.editReply(`음성 채널에 들어가지 못했습니다: ${error.message}`);
    return;
  }

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

/**
 * 봇이 회의 중에 재시작됐으면 상태 파일로 같은 회의를 이어 간다. 음성 채널이 없어졌거나 재시작까지
 * 너무 오래 걸렸으면 다시 들어가지 않고 그때까지의 녹음으로 마무리한다.
 */
async function resumeMeeting(dir) {
  const state = await readState(dir);
  const guild = client.guilds.cache.get(state.guildId);
  if (!guild || recorders.has(guild.id)) {
    console.warn(`이어 갈 수 없는 회의 ${state.meetingId}: 서버가 없거나 이미 녹음 중입니다.`);
    return;
  }
  const textChannel = await client.channels.fetch(state.textChannelId).catch(() => null);
  const voiceChannel = await guild.channels.fetch(state.voiceChannel.id).catch(() => null);
  const recorder = await MeetingRecorder.resume({
    guild,
    voiceChannel: voiceChannel ?? state.voiceChannel,
    textChannel,
    recordingsDir: config.recordingsDir,
    state,
  });
  track(recorder);

  const downMs = Date.now() - (Date.parse(state.startedAt) + state.aliveMs);
  const reason = !voiceChannel ? '음성 채널이 없어져' : downMs > RESUME_WINDOW_MS ? '재시작까지 10분이 넘게 걸려' : null;
  if (!reason) {
    try {
      await recorder.start();
      await send(
        recorder,
        `🔴 봇이 재시작되어 **${recorder.voiceChannel.name}** 채널의 회의 녹음을 같은 회의로 이어 갑니다. ` +
          `(끊긴 시간 약 ${Math.round(downMs / 1000)}초) 끝낼 때는 \`/회의녹음 종료\`를 입력해 주세요.`,
      );
      return;
    } catch (error) {
      console.warn(`회의 ${state.meetingId} 이어 가기 실패: ${error.message}`);
    }
  }
  const summary = await finish(guild.id);
  if (summary) await send(recorder, `봇이 재시작되었지만 ${reason ?? '음성 채널에 다시 들어가지 못해'} 그때까지의 녹음으로 회의를 마쳤습니다.\n${summary}`);
}

client.once(Events.ClientReady, async (c) => {
  console.log(`${c.user.tag} 준비 완료. 녹음 저장 위치: ${config.recordingsDir}`);
  for (const dir of await findUnfinished(config.recordingsDir)) {
    await resumeMeeting(dir).catch((error) => console.error(`회의 이어 가기 실패 ${dir}:`, error));
  }
});
client.on(Events.Error, console.error);

await client.login(config.token);
